"""SNAP-R17/R18/R30/R70: durable conversation journal, independent of graph undo and agent tools.
Agent transports run in optional external adapters; this service makes no outbound requests.
"""
import asyncio
import json
import os
from pathlib import Path
import re
import secrets
import time
import uuid


class Journal:
    def __init__(self, path):
        self.path = Path(path)
        self.events = []
        if self.path.exists():
            with self.path.open() as source:
                for line in source:
                    self.events.append(json.loads(line))
        self.ids = {e['id']: e for e in self.events}
        self.condition = asyncio.Condition()

    def append(self, identity, kind, data):
        previous = self.ids.get(identity)
        if previous:
            if previous['type'] != kind or previous['data'] != data:
                raise ValueError('This event id already belongs to different content')
            return previous
        event = {'seq': len(self.events) + 1, 'id': identity, 'type': kind, 'at': int(time.time() * 1000), 'data': data}
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open('a') as target:
            target.write(json.dumps(event, ensure_ascii=False) + '\n')
            target.flush()
            os.fsync(target.fileno())
        self.events.append(event)
        self.ids[identity] = event
        return event

    async def wait(self, after, seconds):
        async with self.condition:
            if len(self.events) <= after:
                try:
                    await asyncio.wait_for(self.condition.wait(), seconds)
                except TimeoutError:
                    pass
        return self.events[after:]

    async def notify(self):
        async with self.condition:
            self.condition.notify_all()


class Conversations:
    def __init__(self):
        self.journals, self.leases = {}, {}

    def journal(self, root, identity):
        if not re.fullmatch(r'[a-f0-9]{32}', identity):
            raise ValueError('Invalid conversation id')
        path = Path(root) / (identity + '.jsonl')
        key = str(path)
        if key not in self.journals:
            self.journals[key] = Journal(path)
        journal = self.journals[key]
        if not journal.events:
            raise FileNotFoundError('Conversation does not exist for this account')
        return journal

    def ensure(self, root, project):
        if not isinstance(project, str) or not project:
            raise ValueError('A conversation needs its project identity')
        root = Path(root)
        for path in sorted(root.glob('*.jsonl')):
            journal = self.journal(root, path.stem)
            if journal.events[0]['data']['project'] == project:
                return path.stem, journal
        identity = uuid.uuid4().hex
        journal = Journal(root / (identity + '.jsonl'))
        journal.append('created', 'conversation.created', {'id': identity, 'project': project})
        self.journals[str(journal.path)] = journal
        return identity, journal

    def status(self, journal):
        lease = self.leases.get(str(journal.path))
        if lease:
            return {k: v for k, v in lease.items() if k != 'token'} | {'online': time.monotonic() - lease['heartbeat'] < 15}
        binding = next((e for e in reversed(journal.events) if e['type'] in ('session.bound', 'session.disconnected')), None)
        return (binding['data'] | {'online': False}) if binding else None

    def bind(self, journal, data):
        for key in ('id', 'provider', 'session', 'mode', 'capabilities'):
            if key not in data:
                raise ValueError('An adapter binding needs ' + key)
        if data['mode'] not in ('live', 'resume', 'handoff'):
            raise ValueError('Attachment mode must be live, resume or handoff')
        key = str(journal.path)
        old = self.leases.get(key)
        if old and (old['id'] != data['id'] or old['provider'] != data['provider'] or old['session'] != data['session']):
            raise ValueError('Disconnect the current conversation controller before attaching another')
        # One live Snap controller per provider session within this account.
        for path, lease in self.leases.items():
            if Path(path).parent == journal.path.parent and path != key and lease['provider'] == data['provider'] and lease['session'] == data['session']:
                raise ValueError('This agent session is already attached to another Snap conversation')
        token = secrets.token_urlsafe(32)
        self.leases[key] = {**data, 'token': token, 'heartbeat': time.monotonic(), 'phase': 'idle', 'online': True, 'epoch': uuid.uuid4().hex}
        journal.append('binding:' + data['id'] + ':' + uuid.uuid4().hex, 'session.bound', data)
        return token

    def authorize(self, journal, token):
        lease = self.leases.get(str(journal.path))
        if not lease or not secrets.compare_digest(lease['token'], token or ''):
            raise ValueError('This adapter is no longer the conversation controller')
        return lease

    def disconnect(self, journal):
        self.leases.pop(str(journal.path), None)
        journal.append(uuid.uuid4().hex, 'session.disconnected', {'phase': 'disconnected'})


def register(routes, manager):
    from aiohttp import web
    service = Conversations()
    prefix = '/mainodes/snap/conversations'

    def root(request):
        path = manager.get_request_user_filepath(request, 'snap_conversations/index', create_dir=False)
        if path is None:
            raise web.HTTPForbidden(text='No conversation storage for this user')
        return Path(path).parent

    def journal(request):
        return service.journal(root(request), request.match_info['conversation'])

    def error(exc):
        return web.json_response({'error': str(exc)}, status=409 if isinstance(exc, ValueError) else 404)

    @routes.post(prefix)
    async def create(request):
        try:
            body = await request.json()
            identity, log = service.ensure(root(request), body.get('project'))
            return web.json_response({'id': identity, 'project': log.events[0]['data']['project'], 'events': log.events, 'connection': service.status(log)})
        except (ValueError, FileNotFoundError) as exc:
            return error(exc)

    @routes.get(prefix + '/{conversation}')
    async def read(request):
        try:
            log = journal(request)
            return web.json_response({'id': request.match_info['conversation'], 'project': log.events[0]['data']['project'], 'events': log.events, 'connection': service.status(log)})
        except (ValueError, FileNotFoundError) as exc:
            return error(exc)

    @routes.post(prefix + '/{conversation}/send')
    async def send(request):
        try:
            log, body = journal(request), await request.json()
            if body.get('project') != log.events[0]['data']['project']:
                raise ValueError('Message project does not match its conversation')
            if not isinstance(body.get('text'), str) or not body['text'].strip() or not body.get('id'):
                raise ValueError('A message needs stable id and text')
            event = log.append(body['id'], 'human.message', {'text': body['text'], 'context': body.get('context', {}), 'wake': body.get('wake', True)})
            await log.notify()
            return web.json_response(event)
        except (ValueError, FileNotFoundError) as exc:
            return error(exc)

    @routes.post(prefix + '/{conversation}/respond')
    async def respond(request):
        try:
            log, body = journal(request), await request.json()
            pending = next((e for e in reversed(log.events) if e['type'] == 'agent.request' and e['data']['id'] == body['request']), None)
            resolved = any(e['type'] == 'request.resolved' and e['data']['id'] == body['request'] for e in log.events)
            if not pending or resolved:
                raise ValueError('This request is no longer waiting')
            status = service.status(log)
            if not status or not status['online']:
                raise ValueError('Agent is disconnected; reconnect before answering')
            if pending['data'].get('controller') != status.get('epoch'):
                raise ValueError('This question belongs to an earlier connection; wait for the agent to reconcile it')
            response = body['response']
            if not isinstance(response, dict):
                raise ValueError('A response must contain an offered choice or question answers')
            choices = pending['data'].get('choices') or []
            questions = pending['data'].get('questions') or []
            if set(response) == {'choice'}:
                if response['choice'] not in {c['id'] for c in choices}:
                    raise ValueError('Choose one of the offered answers')
                if response['choice'] == 'accept' and not (isinstance(pending['data'].get('operation'), dict) and pending['data']['operation']):
                    raise ValueError('The exact reviewed operation is unavailable')
            elif set(response) == {'answers'} and questions:
                values = response['answers']
                if not isinstance(values, dict) or set(values) != {q['id'] for q in questions} or not all(isinstance(v, str) for v in values.values()):
                    raise ValueError('Every question needs a text answer')
            else:
                raise ValueError('This request does not offer that response')
            event = log.append('response:' + body['request'], 'human.response', {'request': body['request'], 'response': response})
            await log.notify()
            return web.json_response(event)
        except (ValueError, FileNotFoundError) as exc:
            return error(exc)

    @routes.post(prefix + '/{conversation}/bind')
    async def bind(request):
        try:
            log, body = journal(request), await request.json()
            token = service.bind(log, body)
            await log.notify()
            return web.json_response({'token': token, 'connection': service.status(log), 'events': log.events})
        except (ValueError, FileNotFoundError) as exc:
            return error(exc)

    @routes.post(prefix + '/{conversation}/disconnect')
    async def disconnect(request):
        try:
            log = journal(request)
            service.disconnect(log)
            await log.notify()
            return web.json_response({'disconnected': True})
        except (ValueError, FileNotFoundError) as exc:
            return error(exc)

    @routes.post(prefix + '/{conversation}/adapter')
    async def adapter(request):
        try:
            log, body = journal(request), await request.json()
            lease = service.authorize(log, request.headers.get('X-Snap-Conversation-Token'))
            lease.update(heartbeat=time.monotonic(), phase=body.get('phase', 'idle'))
            for event in body.get('events', []):
                if event['type'] not in ('delivery', 'agent.message', 'agent.delta', 'agent.activity', 'agent.request', 'request.resolved', 'agent.error'):
                    raise ValueError('Unsupported adapter event type')
                data = event['data'] | {'controller': lease['epoch']} if event['type'] == 'agent.request' else event['data']
                log.append(event['id'], event['type'], data)
            await log.notify()
            return web.json_response({'accepted': True})
        except (ValueError, FileNotFoundError) as exc:
            return error(exc)

    @routes.get(prefix + '/{conversation}/events')
    async def events(request):
        try:
            log = journal(request)
            after = int(request.query.get('after', '0'))
            if after < 0 or after > len(log.events):
                raise ValueError('Invalid event cursor; reload conversation')
            found = await log.wait(after, min(20, max(0, float(request.query.get('wait', '0')))))
            return web.json_response({'events': found, 'connection': service.status(log)})
        except (ValueError, FileNotFoundError) as exc:
            return error(exc)

    @routes.get(prefix + '/{conversation}/stream')
    async def stream(request):
        try:
            log = journal(request)
            after = int(request.query.get('after', '0'))
            if after < 0 or after > len(log.events):
                raise ValueError('Invalid event cursor; reload conversation')
        except (ValueError, FileNotFoundError) as exc:
            return error(exc)
        response = web.StreamResponse(headers={'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
        await response.prepare(request)
        try:
            while True:
                found = await log.wait(after, 3)
                if found:
                    after = found[-1]['seq']
                payload = json.dumps({'events': found, 'connection': service.status(log)}, ensure_ascii=False)
                await response.write(('data: ' + payload + '\n\n').encode())
        except (ConnectionResetError, asyncio.CancelledError):
            pass
        return response
