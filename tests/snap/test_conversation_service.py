"""SNAP-R17/R18/R30/R70: actual local HTTP/SSE routes on an isolated CPU test server."""
import asyncio
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

spec = importlib.util.spec_from_file_location('conversation_service', Path(__file__).resolve().parents[2] / 'snap_conversations.py')
service = importlib.util.module_from_spec(spec); spec.loader.exec_module(service)

class ServiceTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        root = Path(os.environ.get('SNAP_CHAT_TEST_ARTIFACTS', str(Path.cwd() / '.scratch/chat-service-tests')))
        root.mkdir(parents=True, exist_ok=True)
        self.root = Path(tempfile.mkdtemp(dir=root))
        class Manager:
            def get_request_user_filepath(inner, request, file, **kwargs):
                return str(self.root / request.headers.get('comfy-user', 'default') / file)
        routes = web.RouteTableDef(); service.register(routes, Manager())
        app = web.Application(); app.add_routes(routes)
        self.client = TestClient(TestServer(app)); await self.client.start_server()
        self.prefix = '/mainodes/snap/conversations'

    async def asyncTearDown(self): await self.client.close()

    async def create(self, project):
        response = await self.client.post(self.prefix, json={'project': project}); self.assertEqual(response.status, 200)
        return await response.json()

    async def bind(self, identity):
        binding = {'id': 'adapter', 'provider': 'Test', 'session': 's1', 'mode': 'live', 'capabilities': {'stream': True}}
        response = await self.client.post(self.prefix + '/' + identity + '/bind', json=binding)
        self.assertEqual(response.status, 200); return await response.json()

    async def test_duplicate_send_and_project_switch_keep_original_journal(self):
        a, b = await self.create('a'), await self.create('b'); url = self.prefix + '/' + a['id']
        message = {'id': 'm1', 'project': 'a', 'text': 'original', 'context': {'frame': 10}}
        for _ in range(2): self.assertEqual((await self.client.post(url + '/send', json=message)).status, 200)
        self.assertEqual((await self.client.post(url + '/send', json={**message, 'project': 'b'})).status, 409)
        binding = await self.bind(a['id']); headers = {'X-Snap-Conversation-Token': binding['token']}
        self.assertEqual((await self.client.post(url + '/adapter', headers=headers, json={'events': [{'id': 'r1', 'type': 'agent.message', 'data': {'id': 'reply', 'text': 'finished original'}}]})).status, 200)
        original = await (await self.client.get(url)).json()
        other = await (await self.client.get(self.prefix + '/' + b['id'])).json()
        self.assertEqual(len([e for e in original['events'] if e['type'] == 'human.message']), 1)
        self.assertFalse(any(e['type'] == 'agent.message' for e in other['events']))
        denied = await self.client.get(url, headers={'comfy-user': 'other-account'}); self.assertEqual(denied.status, 404)

    async def test_sse_stream_and_refresh_replay(self):
        c = await self.create('p'); url = self.prefix + '/' + c['id']; binding = await self.bind(c['id'])
        headers = {'X-Snap-Conversation-Token': binding['token']}
        response = await self.client.get(url + '/stream?after=0')
        first = await asyncio.wait_for(response.content.readline(), 3); self.assertTrue(first.startswith(b'data: ')); response.close()
        event = {'id': 'delta1', 'type': 'agent.delta', 'data': {'id': 'r', 'text': 'live'}}
        await self.client.post(url + '/adapter', headers=headers, json={'events': [event], 'phase': 'working'})
        replay = await (await self.client.get(url + '/events?after=2')).json()
        self.assertEqual(replay['events'][0]['data']['text'], 'live'); self.assertTrue(replay['connection']['online'])

    async def test_approval_response_is_explicit_idempotent_and_not_reused_after_reconnect(self):
        c = await self.create('p'); url = self.prefix + '/' + c['id']; binding = await self.bind(c['id'])
        headers = {'X-Snap-Conversation-Token': binding['token']}
        request = {'id': 'q', 'type': 'agent.request', 'data': {'id': 'q', 'title': 'Allow?', 'body': 'command', 'operation': {'kind': 'command', 'command': 'example', 'cwd': '/project'}, 'choices': [{'id': 'accept', 'label': 'Allow once'}]}}
        await self.client.post(url + '/adapter', headers=headers, json={'events': [request]})
        answer = {'request': 'q', 'response': {'choice': 'accept'}}
        for _ in range(2): self.assertEqual((await self.client.post(url + '/respond', json=answer)).status, 200)
        self.assertEqual((await self.client.post(url + '/respond', json={'request': 'q', 'response': {'choice': 'other'}})).status, 409)
        await self.bind(c['id'])
        self.assertEqual((await self.client.post(url + '/respond', json=answer)).status, 409)
        self.assertEqual((await self.client.post(url + '/adapter', headers=headers, json={'events': []})).status, 409)

    async def test_http_cannot_invent_acceptance_for_unreviewable_or_unoffered_action(self):
        c = await self.create('p'); url = self.prefix + '/' + c['id']; binding = await self.bind(c['id'])
        headers = {'X-Snap-Conversation-Token': binding['token']}
        for identity, choices in [('unoffered', []), ('no-operation', [{'id': 'accept', 'label': 'Allow once'}])]:
            request = {'id': identity, 'type': 'agent.request', 'data': {'id': identity, 'title': 'Unresolved operation', 'body': 'No verified action', 'choices': choices}}
            await self.client.post(url + '/adapter', headers=headers, json={'events': [request]})
            response = await self.client.post(url + '/respond', json={'request': identity, 'response': {'choice': 'accept'}})
            self.assertEqual(response.status, 409)
        request = {'id': 'decline-only', 'type': 'agent.request', 'data': {'id': 'decline-only', 'title': 'Unknown command', 'body': 'Unavailable', 'choices': [{'id': 'decline', 'label': 'Decline'}]}}
        await self.client.post(url + '/adapter', headers=headers, json={'events': [request]})
        self.assertEqual((await self.client.post(url + '/respond', json={'request': 'decline-only', 'response': {'choice': 'decline'}})).status, 200)
        history = await (await self.client.get(url)).json()
        self.assertFalse(any(e['type'] == 'human.response' and e['data']['response'].get('choice') == 'accept' for e in history['events']))

if __name__ == '__main__': unittest.main()
