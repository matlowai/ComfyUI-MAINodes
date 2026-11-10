// SNAP-R2/R7/R70: exercise the real Send/action bodies with delayed saves; no live workflow or server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../../web/snap/room.js', import.meta.url), 'utf8');
const helper = await readFile(new URL('../../web/snap/draft_guard.js', import.meta.url), 'utf8');
const { createDraftGuard } = await import(`data:text/javascript;base64,${Buffer.from(helper).toString('base64')}`);
const start = source.indexOf('  const sendMessage = async '), end = source.indexOf('  const send = h(', start);
const actionStart = source.indexOf('  let acting = false'), actionEnd = source.indexOf('\n\n  const shown', actionStart);
function fixture(save) {
  const composer = { value: 'first message' }, notes = [], storage = new Map([['project-a', 'first message']]);
  let project = 'project-a';
  const draftGuard = createDraftGuard({ read: () => composer.value, project: () => project, clear: (s) => { composer.value = ''; storage.delete(s.project); } });
  const deps = { composer, draftGuard, send: {}, delivery: {}, E: { addNote: (text) => { const n = { id: `n${notes.length}`, text }; notes.push(n); return n; }, updateNote() {} },
    app: { extensionManager: { workflow: { activeWorkflow: { filename: 'test.json' }, saveWorkflow: save } } }, artifacts: { children: [] }, activeTab: 'conversation', top: null,
    crypto: { randomUUID: () => `id${notes.length}` }, Chat: { send: async (project, text, context, id) => { if (!notes.some((n) => n.id === id)) notes.push({ id, text, context, project }); await save(); } }, draw() {}, plain: String, say() {} };
  const api = Function('d', `const {composer,draftGuard,send,delivery,E,app,artifacts,activeTab,top,Chat,crypto,draw,plain,say}=d;let sentDraft=null,sending=false,sig='',reply='';${source.slice(start, end)}${source.slice(actionStart, actionEnd)};return {sendMessage,act,sentence};`)(deps);
  return { ...api, composer, notes, storage, edit(value) { composer.value = value; draftGuard.changed(); storage.set(project, value); }, switchProject(value) { project = 'project-b'; this.edit(value); } };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
test('Send clears its own unchanged draft', async () => { const f = fixture(async () => {}); await f.sendMessage(); assert.equal(f.composer.value, ''); assert.equal(f.notes.length, 1); assert.equal(f.storage.has('project-a'), false); });
test('typing during a pending save survives completion', async () => { const wait = deferred(), f = fixture(() => wait.promise); const pending = f.sendMessage(); f.edit('new draft'); wait.resolve(); await pending; assert.equal(f.composer.value, 'new draft'); assert.equal(f.storage.get('project-a'), 'new draft'); assert.equal(f.notes[0].text, 'first message'); });
test('editing back to the same text still preserves the newer draft', async () => { const wait = deferred(), f = fixture(() => wait.promise); const pending = f.sendMessage(); f.edit('different'); f.edit('first message'); wait.resolve(); await pending; assert.equal(f.composer.value, 'first message'); });
test('switching project while saving cannot clear the new project draft', async () => { const wait = deferred(), f = fixture(() => wait.promise); const pending = f.sendMessage(); f.switchProject('project-b draft'); wait.resolve(); await pending; assert.equal(f.composer.value, 'project-b draft'); assert.equal(f.storage.get('project-b'), 'project-b draft'); });
test('retry after a failed send reuses its stable journal message id', async () => { let calls = 0; const f = fixture(async () => { if (++calls === 1) throw Error('save failed'); }); await assert.rejects(f.sendMessage(), /save failed/); assert.equal(f.composer.value, 'first message'); await f.sendMessage(); assert.equal(f.notes.length, 1); });
test('pending decision preserves new typing and uses the original reason', async () => { const wait = deferred(), f = fixture(async () => {}); let reason; const pending = f.act(async () => { await wait.promise; reason = f.sentence().value; })(); await Promise.resolve(); await Promise.resolve(); f.edit('next message'); wait.resolve(); await pending; assert.equal(reason, 'first message'); assert.equal(f.composer.value, 'next message'); });
