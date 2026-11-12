"""SNAP-R17/R18/R30/R70: CPU-only journal/adapter tests; no model or personal server."""
import importlib.util
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest

PACK = Path(__file__).resolve().parents[2]
def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value
chat = module('snap_chat', PACK / 'tools/snap_chat.py')
service = module('snap_conversations', PACK / 'snap_conversations.py')

def artifacts():
    root = Path(os.environ.get('SNAP_CHAT_TEST_ARTIFACTS', str(Path.cwd() / '.scratch/chat-adapter-tests')))
    root.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(dir=root))

class JournalTests(unittest.TestCase):
    def test_durable_replay_and_idempotent_send(self):
        path = artifacts() / 'journal.jsonl'
        log = service.Journal(path)
        event = log.append('h1', 'human.message', {'text': 'hello'})
        self.assertEqual(log.append('h1', 'human.message', {'text': 'hello'}), event)
        self.assertEqual(len(service.Journal(path).events), 1)
        with self.assertRaises(ValueError): log.append('h1', 'human.message', {'text': 'changed'})

    def test_project_and_account_isolation(self):
        root = artifacts()
        owner = service.Conversations()
        aid, a = owner.ensure(root / 'user-a', 'project-a')
        bid, b = owner.ensure(root / 'user-a', 'project-b')
        self.assertNotEqual(aid, bid)
        self.assertEqual(owner.ensure(root / 'user-a', 'project-a')[0], aid)
        with self.assertRaises(FileNotFoundError): owner.journal(root / 'user-b', aid)
        with self.assertRaises(ValueError): owner.journal(root, '../other')

    def test_single_controller_lease_and_disconnect(self):
        root = artifacts()
        owner = service.Conversations()
        aid, a = owner.ensure(root, 'a')
        bid, b = owner.ensure(root, 'b')
        binding = {'id': 'one', 'provider': 'Any agent', 'session': 's', 'mode': 'live', 'capabilities': {'liveAttach': True}}
        token = owner.bind(a, binding)
        owner.authorize(a, token)
        with self.assertRaises(ValueError): owner.bind(b, {**binding, 'id': 'two'})
        with self.assertRaises(ValueError): owner.bind(a, {**binding, 'id': 'two'})
        owner.disconnect(a)
        with self.assertRaises(ValueError): owner.authorize(a, token)
        owner.bind(b, {**binding, 'id': 'two'})

    def test_restart_retains_journal_but_never_fabricates_online_adapter(self):
        root = artifacts()
        owner = service.Conversations()
        aid, a = owner.ensure(root, 'a')
        owner.bind(a, {'id': 'one', 'provider': 'Agent', 'session': 's', 'mode': 'resume', 'capabilities': {}})
        restarted = service.Conversations()
        self.assertFalse(restarted.status(restarted.journal(root, aid))['online'])

class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_start_and_steer_inherit_existing_runtime(self):
        provider = chat.Codex('unused', 'existing')
        calls = []
        async def rpc(method, args):
            calls.append((method, args))
            return {'turnId': 'active'} if method == 'turn/steer' else {'turn': {'id': 'new'}}
        provider.rpc = rpc
        self.assertEqual(await provider.deliver('hello', None), 'new')
        self.assertEqual(await provider.deliver('continue', {'id': 'active', 'status': 'inProgress'}), 'active')
        self.assertEqual(calls[1][1]['expectedTurnId'], 'active')
        for method, args in calls:
            self.assertNotIn('model', args)
            self.assertNotIn('approvalPolicy', args)
            self.assertNotIn('sandboxPolicy', args)

    async def test_ambiguous_delivery_is_retained_without_retry(self):
        class Provider:
            async def deliver(self, *args): raise TimeoutError('lost response')
        class Ledger:
            data = {'id': 'connection', 'messages': {}}
            def save(self): pass
        class Journal:
            identity, project = 'conversation', 'project'
            async def publish(self, *args): return {}
        adapter = chat.Attachment(Journal(), Provider(), Ledger())
        await adapter.submit('n', {'text': 'hello'}, None)
        self.assertEqual(adapter.ledger.data['messages']['n']['state'], 'uncertain')

    async def test_pagination_recovers_older_pending_turn(self):
        provider = chat.Codex('unused', 'existing')
        calls = []
        async def rpc(method, args):
            calls.append(args)
            return {'data': [{'id': 'old'}]} if args.get('cursor') else {'data': [{'id': 'new'}], 'nextCursor': 'next'}
        provider.rpc = rpc
        self.assertEqual((await provider.turns({'old'}))['old']['id'], 'old')
        self.assertEqual(calls[1]['cursor'], 'next')

    async def test_crash_during_send_becomes_uncertain(self):
        path = artifacts() / 'state.json'
        first = chat.Ledger(path, 't', 'project')
        first.data['messages']['n'] = {'state': 'sending'}
        first.save()
        first.lock.close()
        recovered = chat.Ledger(path, 't', 'project')
        self.assertEqual(recovered.data['messages']['n']['state'], 'uncertain')
        recovered.lock.close()

    async def test_no_blind_file_approval(self):
        card = chat.request_card({'id': 1, 'method': 'item/fileChange/requestApproval', 'params': {'itemId': 'x'}}, None)
        self.assertEqual([c['id'] for c in card['choices']], ['decline'])

    async def test_command_decision_has_no_persistent_permission(self):
        event, turn = self.command_fixture()
        reviewed = chat.request_card(event, turn)['operation']
        self.assertEqual(chat.request_response(event, {'choice': 'accept'}, turn, reviewed), {'decision': 'accept'})
        with self.assertRaises(ValueError): chat.request_response(event, {'choice': 'acceptForSession'})
        with self.assertRaises(ValueError): chat.request_response({'method': 'unknown'}, {})

    @staticmethod
    def command_fixture():
        event = {'id': 2, 'method': 'item/commandExecution/requestApproval', 'params': {
            'threadId': 't', 'turnId': 'turn', 'itemId': 'cmd', 'kind': 'command', 'command': "printf 'review only'", 'cwd': '/project'}}
        turn = {'id': 'turn', 'status': 'inProgress', 'items': [{'id': 'cmd', 'type': 'commandExecution',
            'status': 'inProgress', 'command': "printf 'review only'", 'cwd': '/project'}]}
        return event, turn

    async def test_missing_command_cannot_be_approved_via_card_or_outbound_helper(self):
        event, turn = self.command_fixture()
        event['params']['command'] = None
        turn['items'] = []
        card = chat.request_card(event, turn)
        self.assertEqual([c['id'] for c in card['choices']], ['decline'])
        with self.assertRaises(ValueError): chat.request_response(event, {'choice': 'accept'}, turn, {'forged': True})
        self.assertEqual(chat.request_response(event, {'choice': 'decline'}), {'decision': 'decline'})

    async def test_matching_item_resolves_exact_command_and_directory(self):
        event, turn = self.command_fixture()
        event['params'].update(command=None, cwd=None)
        card = chat.request_card(event, turn)
        self.assertIn("printf 'review only'", card['body'])
        self.assertIn('/project', card['body'])
        self.assertEqual(chat.request_response(event, {'choice': 'accept'}, turn, card['operation']), {'decision': 'accept'})
        with self.assertRaises(ValueError): chat.request_response(event, {'choice': 'accept'}, turn)

    async def test_wrong_turn_item_status_type_and_conflicting_operation_refuse_allow(self):
        event, original = self.command_fixture()
        cases = []
        for field, value in [('id', 'wrong'), ('status', 'completed')]:
            turn = copy.deepcopy(original)
            turn[field] = value
            cases.append(turn)
        for field, value in [('type', 'fileChange'), ('status', 'completed'), ('command', 'other'), ('cwd', '/other')]:
            turn = copy.deepcopy(original)
            turn['items'][0][field] = value
            cases.append(turn)
        for turn in cases:
            with self.subTest(turn=turn): self.assertNotIn('operation', chat.request_card(event, turn))

    async def test_stdin_network_and_subcommand_are_never_replaced_by_parent_command(self):
        event, turn = self.command_fixture()
        for kind in ['writeStdin', 'humanCommand', 'unknown']:
            event['params']['kind'] = kind
            self.assertNotIn('operation', chat.request_card(event, turn))
        event['params']['kind'] = 'command'
        event['params']['networkApprovalContext'] = {'host': 'example.invalid'}
        self.assertNotIn('operation', chat.request_card(event, turn))
        event['params'].pop('networkApprovalContext')
        event['params'].update(approvalId='callback', command=None)
        self.assertNotIn('operation', chat.request_card(event, turn))
        event['params']['command'] = 'exact subcommand'
        self.assertEqual(chat.request_card(event, turn)['operation']['command'], 'exact subcommand')

    async def test_file_diff_is_reviewed_and_checked_again_before_acceptance(self):
        event, turn = self.command_fixture()
        event['method'] = 'item/fileChange/requestApproval'
        item = turn['items'][0]
        item.update(type='fileChange', changes=[{'path': '/project/file', 'kind': {'type': 'update'}, 'diff': '-old\n+new'}])
        card = chat.request_card(event, turn)
        reviewed = card['operation']
        self.assertIn('+new', card['body'])
        self.assertEqual(chat.request_response(event, {'choice': 'accept'}, turn, reviewed), {'decision': 'accept'})
        item['changes'][0]['diff'] = '-old\n+different'
        with self.assertRaises(ValueError): chat.request_response(event, {'choice': 'accept'}, turn, reviewed)
        item['changes'] = []
        with self.assertRaises(ValueError): chat.request_response(event, {'choice': 'accept'}, turn, reviewed)
        event['params']['grantRoot'] = '/project'
        self.assertNotIn('operation', chat.request_card(event, turn))

    async def test_actual_adapter_response_path_blocks_stale_accept_and_keeps_decline(self):
        event, turn = self.command_fixture()
        card = chat.request_card(event, turn)
        class Provider:
            thread = 't'
            def __init__(self): self.calls = []
            async def latest(self): return {'id': 'new-turn', 'status': 'inProgress', 'items': []}
            async def respond(self, identity, result): self.calls.append((identity, result))
        class Ledger: data = {'id': 'adapter'}
        provider = Provider()
        adapter = chat.Attachment(None, provider, Ledger())
        adapter.requests['local'] = {'event': event, 'reviewed': card['operation']}
        self.assertFalse(await adapter.answer_request('local', {'choice': 'accept'}))
        self.assertEqual(provider.calls, [])
        new_id = next(iter(adapter.requests))
        new_card = adapter.events[-1]['data']
        self.assertEqual([c['id'] for c in new_card['choices']], ['decline'])
        self.assertTrue(await adapter.answer_request(new_id, {'choice': 'decline'}))
        self.assertEqual(provider.calls, [(event['id'], {'decision': 'decline'})])
        self.assertFalse(await adapter.answer_request(new_id, {'choice': 'decline'}))

    async def test_actual_adapter_forwards_only_the_displayed_unchanged_operation(self):
        event, turn = self.command_fixture()
        class Provider:
            thread = 't'
            def __init__(self): self.calls = []
            async def latest(self): return turn
            async def respond(self, identity, result): self.calls.append((identity, result))
        class Ledger: data = {'id': 'adapter'}
        provider = Provider()
        adapter = chat.Attachment(None, provider, Ledger())
        adapter.requests['local'] = {'event': event, 'reviewed': chat.request_card(event, turn)['operation']}
        self.assertTrue(await adapter.answer_request('local', {'choice': 'accept'}))
        self.assertFalse(await adapter.answer_request('local', {'choice': 'accept'}))
        self.assertEqual(provider.calls, [(event['id'], {'decision': 'accept'})])

    async def test_external_resolution_closes_a_reissued_local_review(self):
        event, turn = self.command_fixture()
        class Provider: thread = 't'
        class Ledger: data = {'id': 'adapter'}
        adapter = chat.Attachment(None, Provider(), Ledger())
        adapter.requests['replacement-local-id'] = {'event': event, 'reviewed': None}
        await adapter.consume({'method': 'serverRequest/resolved', 'params': {'threadId': 't', 'requestId': event['id']}})
        self.assertEqual(adapter.requests, {})
        self.assertEqual(adapter.events[-1]['data']['id'], 'replacement-local-id')

    async def test_unsolicited_agent_stream_is_journaled_without_human_note(self):
        class Ledger: data = {'id': 'one', 'messages': {}}
        class Provider: thread = 't'
        adapter = chat.Attachment(None, Provider(), Ledger())
        await adapter.consume({'method': 'item/agentMessage/delta', 'params': {'threadId': 't', 'turnId': 'turn', 'itemId': 'message', 'delta': 'Hi'}})
        self.assertEqual(adapter.events[0]['type'], 'agent.delta')
        self.assertEqual(adapter.events[0]['data']['text'], 'Hi')

if __name__ == '__main__': unittest.main()
