import test from 'node:test';
import assert from 'node:assert/strict';
import { projectEvents, connectionLabel } from '../../web/snap/conversation_state.mjs';
const event = (id, type, data) => ({ id, type, data });
test('streamed replies and unsolicited agent messages need no director note', () => {
  const events = [event('1', 'agent.delta', { id: 'a', text: 'Hello ' }), event('2', 'agent.delta', { id: 'a', text: 'there' })];
  assert.equal(projectEvents(events).messages[0].text, 'Hello there');
});
test('full recovery snapshot replaces partial text without duplicating a reply', () => {
  const state = projectEvents([event('1', 'agent.delta', { id: 'a', text: 'Hel' }), event('2', 'agent.message', { id: 'a', text: 'Hello', phase: 'final' })]);
  assert.equal(state.messages.length, 1); assert.equal(state.messages[0].text, 'Hello');
});
test('human text is preserved, and receipts never imply a reply before completion', () => {
  const text = 'Can we inspect /path/file.ext and +2?';
  const state = projectEvents([event('h', 'human.message', { text, wake: true }), event('d', 'delivery', { message: 'h', state: 'delivered', turn: 't' })]);
  assert.equal(state.messages[0].text, text); assert.equal(state.messages[0].state, 'delivered');
});
test('request answers and resolution stay distinct from creative approvals', () => {
  const events = [event('q', 'agent.request', { id: 'q', title: 'Allow command?' }), event('a', 'human.response', { request: 'q', response: { choice: 'decline' } })];
  assert.equal(projectEvents(events).requests[0].response.choice, 'decline');
  events.push(event('r', 'request.resolved', { id: 'q' })); assert.deepEqual(projectEvents(events).requests, []);
});
test('projects are independent projections and activity details stay separate from chat', () => {
  const a = projectEvents([event('1', 'human.message', { text: 'A' }), event('2', 'agent.activity', { id: 'tool', title: 'Inspecting', details: { output: 'log' } })]);
  const b = projectEvents([event('3', 'human.message', { text: 'B' })]);
  assert.equal(a.messages[0].text, 'A'); assert.equal(b.messages[0].text, 'B'); assert.equal(a.activities.length, 1); assert.equal(b.activities.length, 0);
});
test('provider identity and offline state are data rather than hardcoded Codex UI', () => {
  assert.equal(connectionLabel({ provider: 'Another agent', online: true, phase: 'working' }), 'Another agent · Working');
  assert.match(connectionLabel({ provider: 'Another agent', online: false }), /disconnected/);
});
