import test from 'node:test';
import assert from 'node:assert/strict';
import { projectEvents, connectionLabel, deliveryLine, COMPOSE_HINT } from '../../web/snap/conversation_state.mjs';
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
// SNAP-R279: the composer footer says the newest human message's receipt state, never a fixed waiting text
test('footer is a neutral hint when nothing is pending, whatever came before', () => {
  const on = { provider: 'Agent', online: true, phase: 'idle' };
  assert.equal(deliveryLine([], on), COMPOSE_HINT); assert.equal(deliveryLine([], null), COMPOSE_HINT);
  const done = projectEvents([event('h', 'human.message', { text: 'hi', wake: true }), event('d1', 'delivery', { message: 'h', state: 'delivered', turn: 't' }), event('d2', 'delivery', { message: 'h', state: 'completed', turn: 't' }), event('a', 'agent.message', { id: 'r', text: 'hello' })]);
  assert.equal(deliveryLine(done.messages, on), COMPOSE_HINT);
  assert.equal(deliveryLine(projectEvents([event('h', 'human.message', { text: 'why', wake: false })]).messages, on), COMPOSE_HINT, 'recorded with a decision: nothing to deliver');
});
test('footer follows the newest message: saved, sending, delivered, and a newer send wins over an older receipt', () => {
  const on = { provider: 'Agent', online: true, phase: 'working' }, events = [event('h1', 'human.message', { text: 'one', wake: true }), event('d1', 'delivery', { message: 'h1', state: 'completed', turn: 't1' }), event('h2', 'human.message', { text: 'two', wake: true })];
  assert.match(deliveryLine(projectEvents(events).messages, on), /waiting for delivery/);
  events.push(event('d2', 'delivery', { message: 'h2', state: 'sending' })); assert.match(deliveryLine(projectEvents(events).messages, on), /Delivering/);
  events.push(event('d3', 'delivery', { message: 'h2', state: 'delivered', turn: 't2' })); assert.equal(deliveryLine(projectEvents(events).messages, on), 'Delivered · agent working.');
  events.push(event('d4', 'delivery', { message: 'h1', state: 'completed', turn: 't1' })); assert.equal(deliveryLine(projectEvents(events).messages, on), 'Delivered · agent working.', 'a late receipt for an older message changes nothing');
  events.push(event('d5', 'delivery', { message: 'h2', state: 'completed', turn: 't2' })); assert.equal(deliveryLine(projectEvents(events).messages, on), COMPOSE_HINT);
});
test('footer names a missing or offline agent and failed receipts in their own words', () => {
  const saved = projectEvents([event('h', 'human.message', { text: 'x', wake: true })]).messages;
  assert.match(deliveryLine(saved, null), /no agent connected, so not delivered yet/);
  assert.match(deliveryLine(saved, { provider: 'Agent', online: false }), /Agent disconnected/);
  const failed = projectEvents([event('h', 'human.message', { text: 'x', wake: true }), event('d', 'delivery', { message: 'h', state: 'uncertain', error: 'Delivery uncertain: reset. Not resent.' })]).messages;
  assert.equal(deliveryLine(failed, { provider: 'Agent', online: true }), 'Your last message: Delivery uncertain: reset. Not resent.');
});
test('an acknowledged send the stream has not brought back yet reads as saved', () => {
  const done = projectEvents([event('h', 'human.message', { text: 'a', wake: true }), event('d', 'delivery', { message: 'h', state: 'completed' })]).messages, on = { provider: 'Agent', online: true, phase: 'idle' };
  assert.match(deliveryLine(done, on, { id: 'new', wake: true }), /waiting for delivery/);
  assert.equal(deliveryLine(done, on, { id: 'h', wake: true }), COMPOSE_HINT, 'once in the journal, its receipt speaks');
});
