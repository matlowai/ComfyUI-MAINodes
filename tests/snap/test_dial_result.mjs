// SNAP-R2/R65/R230: real dial UI/module with a minimal DOM and native queue stubs, no inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.style = {}; this.listeners = {}; this.className = ''; this.value = ''; this.hidden = false; this.classList = { add: (s) => { this.className += ` ${s}`; } }; }
  append(...items) { for (const item of items) { this.children.push(item); if (item instanceof Element) item.parent = this; } }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(k, v) { this[k] = String(v); }
  remove() { this.parent.children = this.parent.children.filter((x) => x !== this); }
  focus() {}
  addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
  dispatchEvent(e) { for (const fn of this.listeners[e.type] ?? []) fn(e); return true; }
  async fire(type) { for (const fn of this.listeners[type] ?? []) await fn({ target: this }); }
  querySelectorAll(selector) { const out = []; for (const c of this.children) if (c instanceof Element) { if (selector.startsWith('.') && c.className.split(/\s+/).includes(selector.slice(1))) out.push(c); out.push(...c.querySelectorAll(selector)); } return out; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}
function walk(el) { return [el, ...el.children.filter((c) => c instanceof Element).flatMap(walk)]; }
const control = (el, name) => walk(el).find((e) => e.ariaLabel === name);
const button = (el, text) => walk(el).find((e) => e.tagName === 'button' && e.textContent === text);
async function fixture({ row, family = 'MiniMax H3', mode = 'post' } = {}) {
  const dial = 'dials/test.safetensors', values = { length: 39, noise_seed: 42, prompt: 'test action', rack: JSON.stringify(row ? [{ dial, ...row }] : []) }, captures = [];
  const app = { graph: { id: 'project-a', getNodeById: () => ({ widgets: [] }) }, lastNodeErrors: {}, queuePrompt: async () => { captures.push(JSON.parse(JSON.stringify(values))); } };
  let seedMode = 'fixed';
  const E = { state: () => ({ bricks: [{ key: 'render', nodes: { render: 1 } }, { key: 'rack', nodes: { rack: 2 } }], bindings: [] }), getValue: (b, n, k) => values[k], setValue: (b, n, k, v) => { values[k] = v; }, seedMode: () => seedMode, setSeedMode: (b, v) => { seedMode = v; }, targets: () => [] };
  const api = { fetchApi: async () => ({ ok: true, json: async () => ({ dials: [{ dial, family, mode, info: { negative: 'Hard', positive: 'Soft' } }] }) }) };
  const J = { here: () => ({ group: app.graph.id }), queueRun: async (job, queue) => { await queue(); return `run-${captures.length}`; } };
  const root = new Element('div'), room = new Element('div'), artifacts = new Element('div'); room.className = 'snap-room'; artifacts.className = 'snap-room-artifacts'; room.append(artifacts); root.append(room);
  const document = { createElement: (tag) => new Element(tag), createElementNS: (ns, tag) => new Element(tag) };
  const context = vm.createContext({ console, document, Event, structuredClone });
  const mod = new vm.SourceTextModule(await readFile(new URL('../../web/snap/dials.js', import.meta.url), 'utf8'), { context });
  await mod.link(async (name) => { const exports = name.endsWith('/app.js') ? { app } : name.endsWith('/api.js') ? { api } : name === './engine.js' ? E : name === './jobs.js' ? J : {}; return new vm.SyntheticModule(Object.keys(exports), function () { for (const [k, v] of Object.entries(exports)) this.setExport(k, v); }, { context }); }); await mod.evaluate();
  const D = mod.namespace, open = (options = {}) => D.openResult(root, { dial, ...options });
  return { D, open, app, values, captures, artifacts, card: await open() };
}
test('new trial defaults to constant and queues baseline/strength at selected duration', async () => { const f = await fixture(); assert.equal(control(f.card, 'Steering mode').value, 'constant'); assert.equal(f.card.snapAgentContext().time, null); assert.equal(f.card.querySelector('.snap-dial-envelope').style.display, 'none'); const strength = control(f.card, 'Dial strength value'); strength.value = '-6'; await strength.fire('input'); await button(f.card, 'Try it with this project').onclick(); assert.equal(f.captures.length, 2); assert.deepEqual(f.captures.map((c) => JSON.parse(c.rack)[0].strength), [0, -6]); assert.ok(f.captures.every((c) => c.length === 39 && !JSON.parse(c.rack)[0].time)); });
test('unchanged recipe keeps trial edits; changed recipe refuses stale edits until reload', async () => { const f = await fixture(); const strength = control(f.card, 'Dial strength value'); strength.value = '-6'; await strength.fire('input'); assert.equal(await f.open(), f.card); f.values.length = 22; const stale = await f.open(); assert.equal(stale, f.card); assert.equal(control(stale, 'Trial clip length').value, '39'); assert.equal(button(stale, 'Try it with this project').disabled, true); await button(stale, 'Try it with this project').onclick(); assert.equal(f.captures.length, 0); const fresh = await f.open({ refresh: true }); assert.notEqual(fresh, stale); assert.equal(control(fresh, 'Trial clip length').value, '22'); });
test('unedited card refreshes from changed recipe and cards are isolated by project', async () => { const f = await fixture(); f.values.length = 22; const refreshed = await f.open(); assert.notEqual(refreshed, f.card); assert.equal(control(refreshed, 'Trial clip length').value, '22'); f.app.graph.id = 'project-b'; const other = await f.open(); assert.notEqual(other, refreshed); assert.equal(refreshed.hidden, true); assert.equal(other.dataset.project, 'project-b'); });
test('existing step curve is preserved and punch is only an explicit choice', async () => { const time = { points: [[0, 0], [.5, -1], [1, 1], [1.625, 0]], unit: 'seconds', interp: 'step', steps: 6, audio: 'protect' }; const f = await fixture({ row: { strength: 2, time } }); assert.equal(control(f.card, 'Steering mode').value, 'existing'); assert.deepEqual(JSON.parse(JSON.stringify(f.card.snapAgentContext().time)), time); const duration = control(f.card, 'Trial clip length'); duration.value = '73'; await duration.fire('change'); assert.equal(f.card.snapAgentContext().time.interp, 'step'); assert.equal(f.card.snapAgentContext().time.points.at(-1)[0], 1.625 * 73 / 39); control(f.card, 'Steering mode').value = 'constant'; await control(f.card, 'Steering mode').fire('change'); assert.equal(f.card.snapAgentContext().time, null); control(f.card, 'Steering mode').value = 'punch'; await control(f.card, 'Steering mode').fire('change'); const keys = f.card.snapAgentContext().time.points; assert.ok(keys.some((p) => p[1] < 0)); assert.ok(keys.every((p, i) => !i || p[0] > keys[i - 1][0])); });
test('flat sweep uses selected length and restores live rack', async () => { const f = await fixture(); const original = f.values.rack; const duration = control(f.card, 'Trial clip length'); duration.value = '73'; await duration.fire('change'); await button(f.card, 'Compare flat strengths').onclick(); assert.ok(f.captures.every((c) => c.length === 73)); assert.equal(f.values.rack, original); assert.equal(f.values.length, 39); });
test('unsupported families do not offer a punch preset', async () => { const f = await fixture({ family: 'MOSS-Image' }); assert.equal(control(f.card, 'Steering mode').children.some((e) => e.value === 'punch'), false); });
