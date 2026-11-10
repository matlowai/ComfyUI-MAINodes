#!/usr/bin/env python3
"""SNAP-R17/R18/R30/R70: connect an existing Codex conversation to the durable local Snap journal.
This external adapter owns agent transport; it never creates a thread or changes its policies.
Requires websockets >=15. Native Snap tools and creative approvals remain separate.
"""
import argparse
import asyncio
import fcntl
import hashlib
import json
import os
from pathlib import Path
import time
import uuid
import urllib.request
import urllib.error


class JournalClient:
    def __init__(self, base, project):
        self.base, self.project, self.identity, self.token = base.rstrip('/'), project, None, None

    async def call(self, suffix='', body=None, root=False):
        def perform():
            headers = {'Content-Type': 'application/json'}
            if os.environ.get('SNAP_TOKEN'):
                headers['Authorization'] = 'Bearer ' + os.environ['SNAP_TOKEN']
            if os.environ.get('SNAP_USER'):
                headers['comfy-user'] = os.environ['SNAP_USER']
            if self.token:
                headers['X-Snap-Conversation-Token'] = self.token
            url = self.base + '/mainodes/snap/conversations'
            if not root:
                url += '/' + self.identity + suffix
            request = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, headers=headers)
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.load(response)
        return await asyncio.to_thread(perform)

    async def open(self):
        result = await self.call(body={'project': self.project}, root=True)
        self.identity = result['id']
        return result

    async def publish(self, events=None, phase='idle'):
        return await self.call('/adapter', {'events': events or [], 'phase': phase})


class RpcError(RuntimeError):
    pass


class Codex:
    def __init__(self, socket, thread):
        self.socket, self.thread = socket, thread
        self.pending, self.events, self.counter = {}, asyncio.Queue(), 0

    async def connect(self):
        from websockets.asyncio.client import unix_connect
        self.ws = await unix_connect(self.socket, open_timeout=5, max_size=None)
        self.reader = asyncio.create_task(self.read())
        await self.rpc('initialize', {'clientInfo': {'name': 'snap_conversation', 'title': 'Snap conversation', 'version': '0.1'},
            'capabilities': {'experimentalApi': True}})
        await self.ws.send(json.dumps({'method': 'initialized'}))
        # Attaches to the existing runtime; deliberately pass no model, cwd or policy overrides.
        await self.rpc('thread/resume', {'threadId': self.thread, 'excludeTurns': True})

    async def read(self):
        try:
            async for line in self.ws:
                msg = json.loads(line)
                if 'id' in msg and 'method' not in msg:
                    future = self.pending.pop(msg['id'], None)
                    if future and not future.done():
                        if 'error' in msg:
                            future.set_exception(RpcError(json.dumps(msg['error'])))
                        else:
                            future.set_result(msg.get('result'))
                else:
                    await self.events.put(msg)
        finally:
            for future in self.pending.values():
                if not future.done():
                    future.set_exception(ConnectionError('Agent socket disconnected'))
            await self.events.put({'method': '_disconnected'})

    async def rpc(self, method, params):
        self.counter += 1
        identity = self.counter
        future = asyncio.get_running_loop().create_future()
        self.pending[identity] = future
        try:
            await self.ws.send(json.dumps({'id': identity, 'method': method, 'params': params}))
            return await asyncio.wait_for(future, 15)
        finally:
            self.pending.pop(identity, None)

    async def latest(self):
        data = await self.rpc('thread/turns/list', {'threadId': self.thread, 'limit': 1, 'itemsView': 'full'})
        return next(iter(data['data']), None)

    async def turns(self, wanted):
        found, cursor = {}, None
        while True:
            args = {'threadId': self.thread, 'limit': 10, 'itemsView': 'full'}
            if cursor:
                args['cursor'] = cursor
            page = await self.rpc('thread/turns/list', args)
            for turn in page['data']:
                if turn['id'] in wanted:
                    found[turn['id']] = turn
            cursor = page.get('nextCursor')
            if not cursor or wanted.issubset(found):
                return found

    async def deliver(self, text, turn):
        args = {'threadId': self.thread, 'input': [{'type': 'text', 'text': text}]}
        if turn and turn['status'] == 'inProgress':
            args['expectedTurnId'] = turn['id']
            result = await self.rpc('turn/steer', args)
            return result['turnId']
        result = await self.rpc('turn/start', args)
        return result['turn']['id']

    async def respond(self, request_id, result):
        await self.ws.send(json.dumps({'id': request_id, 'result': result}))

    async def close(self):
        await self.ws.close()
        await self.reader



def request_card(event, turn):
    method, p = event['method'], event.get('params', {})
    card = {'id': str(event['id']), 'title': 'Your agent needs an answer', 'body': p.get('reason') or 'Your agent needs your input before continuing.', 'details': p}
    if method == 'item/commandExecution/requestApproval':
        card['title'] = 'Allow this command?'
        card['body'] += '\n\nCommand:\n' + (p.get('command') or '(see details)') + '\n\nWorking directory:\n' + (p.get('cwd') or '(not specified)')
        card['choices'] = [{'id': 'accept', 'label': 'Allow once'}, {'id': 'decline', 'label': 'Decline'}]
    elif method == 'item/fileChange/requestApproval':
        item = next((i for i in (turn or {}).get('items', []) if i.get('id') == p.get('itemId')), None)
        if not item or not item.get('changes'):
            card['title'] = 'File approval needs review in your agent'
            return card  # Never offer blind file approval without the actual changes.
        card['body'] += '\n\n' + json.dumps(item['changes'], indent=2, ensure_ascii=False)
        card['title'] = 'Allow these file changes?'
        card['choices'] = [{'id': 'accept', 'label': 'Allow once'}, {'id': 'decline', 'label': 'Decline'}]
    elif method == 'item/tool/requestUserInput':
        card['questions'] = [{'id': q['id'], 'prompt': q['question'],
            'options': [o['label'] for o in q.get('options') or []]} for q in p['questions']]
    else:
        card['title'] = 'Your agent needs attention in its own interface'
    return card


def request_response(event, answer):
    if event['method'] in ('item/commandExecution/requestApproval', 'item/fileChange/requestApproval'):
        if answer.get('choice') not in ('accept', 'decline'):
            raise ValueError('Unsupported approval decision')
        return {'decision': answer['choice']}
    if event['method'] == 'item/tool/requestUserInput':
        ids = {q['id'] for q in event['params']['questions']}
        values = answer.get('answers', {})
        if set(values) != ids:
            raise ValueError('Every question needs an answer')
        return {'answers': {k: {'answers': [v]} for k, v in values.items()}}
    raise ValueError('This request must be answered in the agent interface')


class Ledger:
    def __init__(self, path, thread, page):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = self.path.with_suffix(self.path.suffix + '.lock').open('a')
        fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.data = json.loads(self.path.read_text()) if self.path.exists() else {
            'id': uuid.uuid4().hex, 'thread': thread, 'project': page, 'messages': {}}
        if self.data['thread'] != thread or self.data['project'] != page:
            raise ValueError('Use the state file belonging to this exact session and Snap project')
        for receipt in self.data['messages'].values():
            if receipt['state'] == 'sending':
                receipt.update(state='uncertain', error='Connection ended during delivery; this message was not resent.')
        self.save()

    def save(self):
        staging = self.path.with_suffix(self.path.suffix + '.next')
        staging.write_text(json.dumps(self.data, indent=2, ensure_ascii=False) + '\n')
        os.replace(staging, self.path)


class Attachment:
    def __init__(self, journal, provider, ledger):
        self.journal, self.provider, self.ledger = journal, provider, ledger
        self.requests, self.message_phases, self.messages = {}, {}, {}
        self.events, self.counter, self.cursor = [], 0, 0
        self.transport = uuid.uuid4().hex
        self.phase = 'idle'

    def event(self, identity, kind, data):
        return {'id': identity, 'type': kind, 'data': data}

    async def receipt(self, identity, receipt):
        key = hashlib.sha256(json.dumps(receipt, sort_keys=True).encode()).hexdigest()
        await self.journal.publish([self.event('delivery:' + identity + ':' + key, 'delivery', {'message': identity, **receipt})], self.phase)

    def replay(self, events):
        for event in events:
            self.cursor = max(self.cursor, event['seq'])
            data = event['data']
            if event['type'] == 'human.message':
                self.messages[event['id']] = data
            elif event['type'] == 'delivery':
                receipt = {k: v for k, v in data.items() if k != 'message'}
                self.ledger.data['messages'][data['message']] = receipt

    async def attach(self):
        snapshot = await self.journal.open()
        self.replay(snapshot['events'])
        # Do not replay messages authored before attachment. Their history stays visible.
        first_binding = next((e['seq'] for e in snapshot['events'] if e['type'] == 'session.bound' and e['data']['id'] == self.ledger.data['id']), None)
        self.initial = {e['id'] for e in snapshot['events'] if e['type'] == 'human.message' and (first_binding is None or e['seq'] < first_binding)}
        await self.provider.connect()
        baseline = await self.provider.latest()
        self.ignored = {i['id'] for i in (baseline or {}).get('items', [])}
        mode = 'live' if baseline and baseline['status'] == 'inProgress' else 'resume'
        binding = await self.journal.call('/bind', {
            'id': self.ledger.data['id'], 'provider': 'Codex', 'session': self.provider.thread, 'mode': mode,
            'capabilities': {'liveAttach': True, 'resume': True, 'handoff': False, 'stream': True, 'questions': True, 'commandApproval': True, 'fileApprovalWithDiff': True}})
        self.journal.token = binding['token']
        # A durable sending intent without an acknowledgement is ambiguous after a crash.
        for identity, receipt in self.ledger.data['messages'].items():
            if receipt['state'] in ('sending', 'uncertain'):
                receipt.update(state='uncertain', error='Delivery acceptance was not recovered; not resent.')
                await self.receipt(identity, receipt)
        self.ledger.save()
        return baseline

    async def submit(self, identity, data, turn):
        receipt = {'state': 'sending', 'at': int(time.time() * 1000), 'skip': [i['id'] for i in (turn or {}).get('items', [])]}
        self.ledger.data['messages'][identity] = receipt
        self.ledger.save()
        await self.receipt(identity, receipt)
        text = (f"[Snap conversation {self.journal.identity} · project {self.journal.project} · message {identity}]\n"
            f"{data['text']}\n\n[Send-time Snap context]\n{json.dumps(data.get('context', {}), ensure_ascii=False)}\n"
            "[Reply normally in this attached conversation. Use existing native Snap tools for project actions. "
            "If the intended project is no longer open, ask to reopen it before editing. "
            "Existing execution and creative-action permissions still apply.]")
        try:
            turn_id = await self.provider.deliver(text, turn)
        except RpcError as exc:
            receipt.update(state='failed', error=str(exc))
        except (ConnectionError, TimeoutError, OSError) as exc:
            receipt.update(state='uncertain', error=f'Delivery uncertain: {exc}. Not resent.')
        else:
            receipt.update(state='delivered', turn=turn_id)
        self.ledger.save()
        await self.receipt(identity, receipt)

    async def recover(self, all_receipts=False):
        wanted = {r['turn'] for r in self.ledger.data['messages'].values() if r.get('turn') and (all_receipts or r['state'] not in ('completed', 'failed', 'interrupted'))}
        turns = await self.provider.turns(wanted) if wanted else {}
        recovered = []
        for identity, receipt in self.ledger.data['messages'].items():
            turn = turns.get(receipt.get('turn'))
            if not turn:
                continue
            for item in turn.get('items', []):
                if item['type'] == 'agentMessage' and item['id'] not in receipt.get('skip', []):
                    self.message_phases[item['id']] = item.get('phase') or 'final'
                    text_hash = hashlib.sha256(item['text'].encode()).hexdigest()
                    recovered.append(self.event('snapshot:' + item['id'] + ':' + text_hash, 'agent.message',
                        {'id': item['id'], 'text': item['text'], 'phase': item.get('phase') or 'final', 'turn': turn['id'], 'agent': 'Codex'}))
            if turn['status'] in ('completed', 'failed', 'interrupted'):
                receipt['state'] = turn['status']
                await self.receipt(identity, receipt)
        if recovered:
            await self.journal.publish(recovered, self.phase)
        self.ledger.save()

    async def consume(self, event):
        method, p = event.get('method'), event.get('params', {})
        if method == '_disconnected':
            raise ConnectionError('Agent connection closed')
        if p.get('threadId') != self.provider.thread:
            return
        self.counter += 1
        key = self.transport + ':' + str(self.counter)
        if 'id' in event:
            card = request_card(event, await self.provider.latest())
            card['id'] = self.transport + ':' + str(event['id'])
            self.requests[card['id']] = event
            self.events.append(self.event('request:' + card['id'], 'agent.request', card))
            self.phase = 'needs_input'
        elif method == 'serverRequest/resolved':
            identity = self.transport + ':' + str(p['requestId'])
            self.requests.pop(identity, None)
            self.events.append(self.event('resolved:' + identity, 'request.resolved', {'id': identity}))
        elif method in ('item/started', 'item/completed'):
            item = p['item']
            if item['type'] == 'agentMessage':
                self.message_phases[item['id']] = item.get('phase') or 'final'
                if item.get('text'):
                    self.events.append(self.event('message:' + key, 'agent.message',
                        {'id': item['id'], 'text': item['text'], 'phase': item.get('phase') or 'final', 'turn': p['turnId'], 'agent': 'Codex'}))
            elif item['type'] in ('commandExecution', 'fileChange', 'mcpToolCall', 'webSearch'):
                self.events.append(self.event('activity:' + key, 'agent.activity',
                    {'id': item['id'], 'title': {'commandExecution': 'Running command', 'fileChange': 'Editing files', 'mcpToolCall': 'Using tools', 'webSearch': 'Looking up information'}[item['type']],
                     'state': 'done' if method == 'item/completed' else 'working', 'details': item}))
        elif method == 'item/agentMessage/delta':
            self.events.append(self.event('delta:' + key, 'agent.delta',
                {'id': p['itemId'], 'text': p['delta'], 'phase': self.message_phases.get(p['itemId'], 'commentary'), 'turn': p['turnId'], 'agent': 'Codex'}))
        elif method == 'turn/started':
            self.phase = 'working'
        elif method == 'turn/completed':
            turn = p['turn']
            self.phase = 'idle'
            for identity, receipt in self.ledger.data['messages'].items():
                if receipt.get('turn') == turn['id']:
                    receipt['state'] = turn['status']
                    await self.receipt(identity, receipt)
            self.ledger.save()

    async def run(self):
        baseline = await self.attach()
        self.phase = 'working' if baseline and baseline['status'] == 'inProgress' else 'idle'
        await self.recover(all_receipts=True)
        print(json.dumps({'connected': True, 'provider': 'Codex', 'thread': self.provider.thread,
            'conversation': self.journal.identity, 'project': self.journal.project}), flush=True)
        last_recover = time.monotonic()
        try:
            while True:
                changes = await self.journal.call('/events?after=' + str(self.cursor))
                self.replay(changes['events'])
                for event in changes['events']:
                    if event['type'] == 'session.disconnected':
                        return
                    if event['type'] == 'human.message' and event['id'] not in self.initial and event['data'].get('wake', True) and event['id'] not in self.ledger.data['messages']:
                        await self.submit(event['id'], event['data'], await self.provider.latest())
                    elif event['type'] == 'human.response':
                        request = self.requests.get(event['data']['request'])
                        if request:
                            await self.provider.respond(request['id'], request_response(request, event['data']['response']))
                            identity = event['data']['request']; self.requests.pop(identity)
                            self.events.append(self.event('resolved:' + identity, 'request.resolved', {'id': identity}))
                while not self.provider.events.empty():
                    await self.consume(self.provider.events.get_nowait())
                batch, self.events = self.events, []
                await self.journal.publish(batch, 'needs_input' if self.requests else self.phase)
                if time.monotonic() - last_recover > 10:
                    await self.recover(); last_recover = time.monotonic()
                await asyncio.sleep(.15)
        finally:
            await self.provider.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default='http://127.0.0.1:8188')
    parser.add_argument('--project', required=True)
    parser.add_argument('--thread', required=True, help='Existing Codex thread; never creates one')
    parser.add_argument('--socket', default=str(Path.home() / '.codex/app-server-control/app-server-control.sock'))
    parser.add_argument('--state', required=True, help='Durable project-local adapter receipts')
    args = parser.parse_args()
    ledger = Ledger(args.state, args.thread, args.project)
    journal = JournalClient(args.base, args.project)
    attachment = Attachment(journal, Codex(args.socket, args.thread), ledger)
    try:
        asyncio.run(attachment.run())
    except urllib.error.HTTPError as exc:
        if exc.code != 409 or journal.identity is None:
            raise
        snapshot = asyncio.run(journal.call())
        last_binding = next((e for e in reversed(snapshot['events']) if e['type'] in ('session.bound', 'session.disconnected')), None)
        if last_binding and last_binding['type'] == 'session.bound' and last_binding['data']['id'] == ledger.data['id']:
            raise RuntimeError('Local service lost the adapter lease; reconnect the same session') from exc
        print('Conversation disconnected or another controller attached; stopping.', flush=True)
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
