// SNAP-R287..R290: examples and share files. The real share.js, recipes.js, world.js (parse, refOf, diff), retake.js
// (rackOf) and sharetools.js over an in-memory record store with the server's versioning; no canvas, server or browser.
// Run: node --experimental-vm-modules --test tests/snap/test_share.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const src = (f) => readFile(new URL(`../../web/snap/${f}`, import.meta.url), 'utf8');
const canonical = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((y) => [y, v[y]])) : v));
const plain = (x) => JSON.parse(JSON.stringify(x));
function imports(source) {
  const out = new Map();
  for (const m of source.matchAll(/import\s+(?:\*\s+as\s+\w+|\{([^}]*)\})\s+from\s+"([^"]+)"/g)) out.set(m[2], m[1] ? m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean) : null);
  return out;
}
async function load(context, file, stubs, modules = {}) {
  const source = await src(file), wanted = imports(source);
  const mod = new vm.SourceTextModule(source, { context, identifier: file });
  await mod.link(async (spec) => {
    if (modules[spec]) return modules[spec];
    const given = stubs[spec] ?? {}, names = wanted.get(spec) ?? Object.keys(given), all = [...new Set([...names, ...Object.keys(given)])];
    return new vm.SyntheticModule(all, function () { for (const k of all) this.setExport(k, k in given ? given[k] : () => {}); }, { context });
  });
  await mod.evaluate();
  return mod;
}

// what this install has: node definitions (CLIPTextEncode's text is multiline), dials, model files
const REGISTERED = {
  CLIPTextEncode: { nodeData: { input: { required: { text: ['STRING', { multiline: true }], clip: ['CLIP'] } } } },
  LoadImage: { nodeData: { input: { required: { image: [['a.png', 'b.png']] } } } },
  Blur: { nodeData: { input: { required: { image: ['IMAGE'], radius: ['INT', {}], label: ['STRING', {}] } } } },
  MAIDialRack: { nodeData: { input: { required: { rack: ['STRING', {}] } } } },
  LoraLoader: { nodeData: { input: { required: { lora_name: [['style.safetensors']], strength: ['FLOAT', {}] } } } },
};
const isFile = (v) => typeof v === 'string' && /\.(safetensors|gguf|sft|ckpt)$/.test(v); // models.js isFile
async function fixture({ privacy = false, registered = REGISTERED } = {}) {
  const context = vm.createContext({ console, structuredClone, setTimeout, clearTimeout, LiteGraph: { registered_node_types: registered } });
  const world = (await load(context, 'world.js', { '../../../scripts/api.js': { api: { addEventListener() {}, clientId: 'test' } } })).namespace;
  const records = new Map(), listeners = [];
  let clock = 1.8e12;
  const W = {
    KINDS: world.KINDS, parse: world.parse, refOf: world.refOf, diff: world.diff, headOf: world.headOf, short: world.short, sha: async () => 'x',
    load: async () => records, onChange: (fn) => listeners.push(fn), onWritten() {}, setPack() {}, packCard: () => null,
    all: (kind) => [...records.values()].filter((r) => (!kind || r.kind === kind) && !r.archived),
    record: (kind, id) => records.get(`${kind}:${id}`) ?? null,
    get: (ref) => { const { kind, id, n } = world.parse(ref), r = records.get(`${kind}:${id}`); const v = r && (n == null ? world.headOf(r) : r.versions.find((x) => x.n === n)); return v ? { record: r, version: v } : null; },
    async save(kind, id, body, { note = '', by = 'person' } = {}) {
      const key = `${kind}:${id}`, r = records.get(key) ?? { kind, id, head: 0, versions: [] }, hash = canonical(body), head = world.headOf(r);
      if (head?.hash === hash) return { ref: world.refOf(kind, id), n: head.n, made: false, record: r };
      const n = (r.versions.at(-1)?.n ?? 0) + 1;
      r.versions.push({ n, hash, at: ++clock, by, note, body: plain(body) });
      r.head = n; records.set(key, r);
      for (const fn of listeners) fn();
      return { ref: world.refOf(kind, id), n, made: true, record: r };
    },
    fields: async () => ({}),
  };
  const snap = { version: 1, bricks: [], bindings: [] };
  let bricks = [];
  const takes = {};
  const app = { graph: { serialize: () => ({ nodes: [], links: [], extra: { snap } }) } };
  const E = { state: () => snap, tag: (field, value) => { snap[field] = value; }, recipe: () => plain(bricks), restore: async (b) => b.map((x) => x.key) };
  const T = { privacyOn: async () => privacy, load: async () => [], find: (id) => takes[id] ?? null, openAsTab: async () => {}, all: () => [] };
  const BRICKS = { cast: { title: 'Cast', stack: { role: 'identity' }, nodes: [{ key: 'cast', type: 'LoraLoader' }] }, render: { title: 'Render', blueprint: 'Dials - H3 + De-rope', nodes: [{ key: 'render', type: 'sg-render' }] }, rack: { title: 'Dials', nodes: [{ key: 'rack', type: 'MAIDialRack' }] }, first_frame: { title: 'First frame', nodes: [{ key: 'image', type: 'LoadImage' }] } };
  const M = { isFile, named: (c) => c.brick.bricks.flatMap((b) => Object.values(b.values).flatMap((ws) => Object.values(ws))).filter(isFile), readiness: (f) => ({ installed: f === 'here.safetensors' }), load: async () => new Map(), freshTab: async () => {} };
  const D = { all: () => [{ dial: 'dials/warm.safetensors' }], load: async () => [] };
  const stubs = { '../../../scripts/app.js': { app }, '../../../scripts/api.js': { api: { fetchApi: async () => { throw new Error('no server in tests'); }, addEventListener() {} } },
    './engine.js': E, './world.js': W, './takes.js': T, './models.js': M, './dials.js': D, './bricks.js': { BRICKS, PACK_BRICKS: Object.keys(BRICKS), kit: () => null } };
  const recipes = await load(context, 'recipes.js', stubs);
  const retake = await load(context, 'retake.js', stubs);
  const share = await load(context, 'share.js', stubs, { './recipes.js': recipes, './retake.js': retake });
  const tools = (await load(context, 'sharetools.js', stubs, { './share.js': share, './recipes.js': recipes })).namespace.SHARE_TOOLS;
  const tool = (name, args = {}) => tools.find((t) => t.name === name).run(args);
  return { S: share.namespace, R: recipes.namespace, W, E, snap, takes, records, tool, tools, setBricks: (b) => { bricks = b; } };
}

// a subgraph brick with a blueprint: a prompt node and a picture loader inside, its outer node promoting the prompt
const blueprint = () => ({
  nodes: [{ id: 7, type: 'sg-1', pos: [0, 0], widgets_values: ['a red fox at dusk'] }],
  definitions: { subgraphs: [{ id: 'sg-1', name: 'Fox look', nodes: [{ id: 1, type: 'CLIPTextEncode', widgets_values: ['a red fox at dusk'] }, { id: 2, type: 'LoadImage', widgets_values: ['my_face.png', 'image'] }, { id: 3, type: 'LoraLoader', widgets_values: ['style.safetensors', 0.8] }, { id: 4, type: 'MAIDialRack', widgets_values: ['[{"dial":"dials/inner.safetensors","strength":1}]'] }], links: [] }] },
});
const foxEntry = () => ({ key: 'node:sg-1', values: { node: { prompt: 'a red fox at dusk' } }, face: [['node', 'prompt', 'Look']], title: 'Fox look', blueprint: blueprint() });
const recipeBricks = () => [
  { key: 'cast', values: { cast: { lora_name: 'someone.safetensors', strength: 1 } } },
  { key: 'first_frame', values: { image: { image: 'portrait_of_me.png' } } },
  { key: 'rack', values: { rack: { rack: '[{"on":true,"dial":"dials/warm.safetensors","strength":0.6},{"on":true,"dial":"dials/cold.safetensors","strength":-0.2}]' } } },
  { key: 'render', values: { render: { prompt: 'A man walks\nthrough rain', length: 97, model: 'here.safetensors' } } },
  { key: 'node:CLIPTextEncode#1', values: { node: { text: 'secret words' } } },
];
async function keptRecipe(f, extra = {}) {
  f.setBricks(recipeBricks());
  const body = { id: 'recipe-rain-walk', kind: 'recipe', title: 'Rain walk', text: '5 bricks', saved: 1, brick: { bricks: recipeBricks() }, graph: { nodes: [{ id: 1, type: 'LoadImage', widgets_values: ['portrait_of_me.png'] }], extra: {} }, from: { take: 'take-abc123' }, ...extra };
  await f.W.save('card', 'recipe-rain-walk', body, { note: 'first' });
  f.snap.recipe = { id: 'recipe-rain-walk', n: 1 };
  return body;
}
const EX = { image: 'data:image/webp;base64,UklGRg==', w: 512, h: 288, frames: 1, from: { take: 'take-abc123', number: 4 } };

test('fitExample: the first step under 60 KB, else the smallest under the cap, else refused', async () => {
  const { S } = await fixture();
  const size = (w, q) => 'x'.repeat(Math.round(w * w * q * 0.5)); // a fake encoder: bytes grow with width and quality
  const fit = await S.fitExample(size, { frames: 1 });
  assert.ok(fit.bytes <= 60_000, `fits the target: ${fit.bytes}`);
  assert.deepEqual([fit.w, fit.q], [512, 0.45], 'the largest width first, its quality stepped down until it fits');
  const strip = await S.fitExample(size, { frames: 3 });
  assert.ok(strip.bytes <= 60_000 && strip.w <= 320);
  const big = await S.fitExample((w, q) => 'x'.repeat(70_000 + w + Math.round(q * 100)), { frames: 1 });
  assert.ok(big.bytes > 60_000 && big.bytes <= 120_000 && big.w === 128 && big.q === 0.45, 'none under the target: the smallest under the cap');
  await assert.rejects(S.fitExample(() => 'x'.repeat(130_000)), /over 120 KB/);
});

test('setExample is refused with privacy on; clearExample needs one', async () => {
  const f = await fixture({ privacy: true });
  await keptRecipe(f);
  f.takes['take-abc123'] = { id: 'take-abc123', number: 4, media: [{ kind: 'image' }] };
  await assert.rejects(f.S.setExample('Rain walk', 'take-abc123'), /Privacy is on/);
  await assert.rejects(f.S.clearExample('recipe-rain-walk'), /has no example/);
  await assert.rejects(f.tool('set_example', { card: 'Rain walk', take: 'take-abc123' }), /Privacy is on/);
});

test('a recipe example: kept by listed(), not edited, not in the changes; clearing it is one more version', async () => {
  const f = await fixture();
  const body = await keptRecipe(f);
  await f.W.save('card', 'recipe-rain-walk', { ...body, example: EX }, { note: 'example from take 4' });
  const listed = f.R.listed(f.W.headOf(f.W.record('card', 'recipe-rain-walk')).body);
  assert.equal(listed.example.image, EX.image, 'the Library copy keeps the example');
  assert.equal(listed.graph, undefined);
  f.snap.recipe = { id: 'recipe-rain-walk', n: 2 };
  assert.equal((await f.R.current()).edited, false, 'an example does not make the graph edited');
  assert.deepEqual(plain(f.R.changes('recipe-rain-walk', 1, 2)), [], 'nor a line in the changes');
  const out = await f.S.clearExample('card:recipe-rain-walk');
  assert.equal(out.n, 3);
  assert.equal(f.W.headOf(f.W.record('card', 'recipe-rain-walk')).body.example, undefined);
  assert.deepEqual({ ...f.snap.recipe }, { id: 'recipe-rain-walk', n: 3 }, 'the open graph named the head: it follows');
});

test('shareOf a recipe: no graph, no Cast rows, no picture names, no take ids, even with privacy off; prompt text out on request', async () => {
  const f = await fixture();
  const body = await keptRecipe(f);
  await f.W.save('card', 'recipe-rain-walk', { ...body, example: EX });
  const s = await f.S.shareOf('Rain walk');
  const text = JSON.stringify(s);
  assert.equal(s.snap_share, 1); assert.equal(s.kind, 'recipe'); assert.equal(s.title, 'Rain walk');
  assert.equal(s.card.graph, undefined, 'never the graph');
  assert.ok(!text.includes('someone.safetensors'), 'never a Cast row');
  assert.deepEqual(plain(s.card.brick.bricks[0]), { key: 'cast', values: {} }, 'the Cast brick keeps its place');
  assert.ok(!text.includes('portrait_of_me.png'), 'never a reference picture name');
  assert.ok(!text.includes('take-abc123'), 'never a take id');
  assert.equal(s.card.example.image, EX.image); assert.equal(s.card.example.from, undefined);
  assert.ok(text.includes('A man walks') && text.includes('secret words'), 'prompts stay by default');
  assert.ok(s.leaves_out.some((l) => /exact workflow/.test(l)) && s.leaves_out.some((l) => /identity \(Cast\)/.test(l)) && s.leaves_out.some((l) => /reference picture name/.test(l)) && s.leaves_out.some((l) => /which take/.test(l)));
  assert.ok(s.includes.some((l) => /5 bricks/.test(l)) && s.includes.some((l) => /example picture/.test(l)));
  const quiet = await f.S.shareOf('recipe-rain-walk', { prompt: false });
  const q = JSON.stringify(quiet);
  assert.ok(!q.includes('A man walks') && !q.includes('secret words'), 'prompt text out: a multiline STRING, and a prompt-named setting');
  assert.equal(quiet.card.brick.bricks[3].values.render.length, 97, 'other settings stay');
  assert.ok(quiet.leaves_out.some((l) => /prompt text \(2 settings\)/.test(l)));
  assert.equal(f.S.shareFile(s), 'Rain walk.snap.json');
});

test('needs: node types inside a blueprint, dial files from rack strings, model files named in settings', async () => {
  const f = await fixture();
  const needs = f.S.needsOf([...recipeBricks(), foxEntry()]);
  assert.deepEqual([...needs.nodes].sort(), ['CLIPTextEncode', 'LoadImage', 'LoraLoader', 'MAIDialRack', 'sg-render'].sort());
  assert.ok(!needs.nodes.includes('sg-1'), 'a definition id is not a node type to install');
  assert.deepEqual(plain([...needs.blueprints].sort()), ['Dials - H3 + De-rope', 'Fox look']);
  assert.deepEqual(plain(needs.dials.map((d) => d.file).sort()), ['dials/cold.safetensors', 'dials/inner.safetensors', 'dials/warm.safetensors']);
  assert.ok(needs.models.includes('here.safetensors') && needs.models.includes('style.safetensors'));
});

test('a brick share drops the picture names and (prompt: false) the prompt inside its blueprint', async () => {
  const f = await fixture();
  await f.W.save('card', 'brick-fox-look', { id: 'brick-fox-look', kind: 'brick', title: 'Fox look', text: 'needs nothing', brick: { entry: foxEntry() } });
  const s = await f.S.shareOf('card:brick-fox-look', { prompt: false });
  const t = JSON.stringify(s);
  assert.ok(!t.includes('my_face.png') && !t.includes('a red fox'), t);
  const inner = s.card.brick.entry.blueprint.definitions.subgraphs[0].nodes;
  assert.equal(inner[1].widgets_values[1], 'image', 'a choice of the node stays');
  assert.equal(inner[2].widgets_values[0], 'style.safetensors');
  const all = await f.S.shareOf('Fox look');
  assert.ok(JSON.stringify(all).includes('a red fox') && !JSON.stringify(all).includes('my_face.png'));
});

test('readShare: strict, only known fields, example only a data picture, titles stay plain text', async () => {
  const { S } = await fixture();
  const good = { snap_share: 1, kind: 'brick', title: '<img src=x onerror=alert(1)>', made: '2026-11-11T10:00:00.000Z', card: { kind: 'brick', title: 'x', text: '', brick: { entry: { key: 'node:Blur', values: { node: { radius: 3 } } } } }, needs: { nodes: ['Blur'], blueprints: [], dials: [], models: [] }, includes: [], leaves_out: [], extra_field: 'dropped' };
  const ok = S.readShare(JSON.stringify(good));
  assert.ok(ok.ok, ok.why);
  assert.equal(ok.share.title, '<img src=x onerror=alert(1)>', 'kept as a plain string');
  assert.equal(ok.share.extra_field, undefined, 'unknown fields are not kept');
  assert.equal(S.readShare(JSON.stringify({ ...good, snap_share: 2 })).ok, false);
  assert.match(S.readShare(JSON.stringify({ ...good, snap_share: 2 })).why, /version 2/);
  assert.match(S.readShare(JSON.stringify({ ...good, kind: 'dial' })).why, /kind/);
  assert.match(S.readShare('x'.repeat(2_000_001)).why, /at most 2 MB/);
  assert.match(S.readShare('{not json').why, /isn't JSON/);
  const withEx = (image) => S.readShare(JSON.stringify({ ...good, card: { ...good.card, example: { image, w: 10, h: 10, frames: 1 } } }));
  assert.equal(withEx('javascript:alert(1)').ok, false);
  assert.equal(withEx('data:text/html;base64,PHNjcmlwdD4=').ok, false);
  assert.equal(withEx('data:image/svg+xml;base64,PHN2Zz4=').ok, false);
  assert.equal(withEx(`data:image/webp;base64,${'A'.repeat(130_000)}`).ok, false, 'over the example cap');
  assert.equal(withEx('data:image/webp;base64,UklGRg==').ok, true);
  assert.equal(S.readShare(JSON.stringify({ ...good, title: 'x'.repeat(301) })).ok, false, 'strings are capped');
  assert.equal(S.readShare(JSON.stringify({ ...good, card: { ...good.card, brick: { entry: { key: 'node:Blur', values: { node: { radius: { nested: 1 } } } } } } })).ok, false, 'a setting is a plain value');
  assert.equal(S.readShare(JSON.stringify({ ...good, card: { ...good.card, brick: { entry: { key: 'render', values: {} } } } })).ok, false, 'a shared brick is an any-node brick');
});

test('an ordinary workflow JSON is not a share', async () => {
  const { S } = await fixture();
  const workflow = JSON.stringify({ last_node_id: 3, nodes: [{ id: 1, type: 'Blur', widgets_values: ['snap_share'] }], links: [], extra: { snap_share: 1 } });
  assert.equal(S.looksShared(workflow), false);
  assert.match(S.readShare(workflow).why, /isn't a Snap share file/);
  assert.equal(S.looksShared(JSON.stringify({ snap_share: 1 })), true);
  const file = (text, name, type = 'application/json') => ({ name, type, size: text.length, slice: (a, b) => ({ text: async () => text.slice(a, b) }), text: async () => text });
  assert.equal(await S.isShareFile(file(workflow, 'wf.json')), false);
  assert.equal(await S.isShareFile(file('{"snap_share": 1}', 'a.snap.json')), true);
  assert.equal(await S.isShareFile(file('{"snap_share": 1}', 'a.png', 'image/png')), false, 'only JSON files are read');
});

test('previewShare: missing node types, dials and models; where it would land', async () => {
  const f = await fixture();
  await keptRecipe(f);
  const s = await f.S.shareOf('Rain walk');
  const p = await f.S.previewShare(s, { nodes: { LoadImage: 1, MAIDialRack: 1 }, dials: ['dials/warm.safetensors'], model: (x) => x === 'here.safetensors' });
  const names = (what) => plain(p.missing.filter((m) => m.what === what).map((m) => m.name).sort());
  assert.deepEqual(names('node'), ['CLIPTextEncode', 'LoraLoader', 'sg-render']);
  assert.deepEqual(names('dial'), ['dials/cold.safetensors']);
  assert.deepEqual(names('model'), []);
  assert.deepEqual([p.place.action, p.place.id], ['new', 'recipe-rain-walk-2'], 'the sender\'s own card (with its Cast rows and pictures) is left alone');
  assert.ok(p.inside[0].startsWith('a recipe of 5 bricks'));
});

test('export, read, import: a brick with a blueprint and a recipe round-trip; a second import of an edited share is a version', async () => {
  const a = await fixture();
  await a.W.save('card', 'brick-fox-look', { id: 'brick-fox-look', kind: 'brick', title: 'Fox look', text: 'needs nothing', brick: { entry: foxEntry() }, example: EX });
  const body = await keptRecipe(a);
  const brickText = a.S.shareText(await a.S.shareOf('Fox look')), recipeText = a.S.shareText(await a.S.shareOf('Rain walk'));
  const b = await fixture();
  const one = b.S.readShare(brickText), two = b.S.readShare(recipeText);
  assert.ok(one.ok && two.ok, one.why ?? two.why);
  const got = await b.S.importShare(one.share);
  assert.deepEqual([got.id, got.n, got.made, got.kind], ['brick-fox-look', 1, true, 'brick']);
  const kept = b.W.headOf(b.W.record('card', 'brick-fox-look')).body;
  assert.deepEqual(plain(kept.brick.entry.blueprint.definitions.subgraphs[0].nodes.map((n) => n.type)), ['CLIPTextEncode', 'LoadImage', 'LoraLoader', 'MAIDialRack']);
  assert.equal(kept.brick.entry.title, 'Fox look'); assert.deepEqual(plain(kept.brick.entry.face), [['node', 'prompt', 'Look']]);
  assert.equal(kept.example.image, EX.image); assert.deepEqual({ ...kept.from_share }, { title: 'Fox look', made: one.share.made });
  const r = await b.S.importShare(two.share);
  assert.equal(r.id, 'recipe-rain-walk');
  assert.equal(b.R.list().find((x) => x.id === 'recipe-rain-walk').name, 'Rain walk', 'a plain recipe record');
  assert.equal(b.W.headOf(b.W.record('card', 'recipe-rain-walk')).body.graph, undefined);
  assert.equal(b.W.headOf(b.W.record('card', 'recipe-rain-walk')).body.brick.bricks.length, body.brick.bricks.length);
  assert.equal((await b.S.importShare(two.share)).made, false, 'the same again: nothing to do');
  const edited = b.S.readShare(JSON.stringify({ ...JSON.parse(recipeText), card: { ...JSON.parse(recipeText).card, text: 'longer' } })).share;
  assert.equal((await b.S.previewShare(edited, { nodes: {}, dials: [], model: () => false })).place.action, 'version');
  assert.equal((await b.S.importShare(edited)).n, 2);
  // the person's own card under that id is never written by an import
  const c = await fixture();
  await c.W.save('card', 'brick-fox-look', { id: 'brick-fox-look', kind: 'brick', title: 'Fox look', text: 'mine', brick: { entry: { key: 'node:Blur', values: {} } } });
  const own = await c.S.importShare(one.share);
  assert.equal(own.id, 'brick-fox-look-2');
  assert.equal(c.W.record('card', 'brick-fox-look').versions.length, 1);
});

test('tools: share_card is read-only and sized, import_share takes text or an object, errors name the arguments', async () => {
  const f = await fixture();
  await keptRecipe(f);
  const names = plain(f.tools.map((t) => t.name));
  assert.deepEqual(names, ['set_example', 'clear_example', 'share_card', 'preview_share', 'import_share']);
  assert.ok(f.tools.find((t) => t.name === 'share_card').annotations.readOnlyHint);
  assert.ok(f.tools.find((t) => t.name === 'preview_share').annotations.readOnlyHint);
  const out = await f.tool('share_card', { card: 'Rain walk', include_prompt: false });
  assert.equal(out.file, 'Rain walk.snap.json'); assert.ok(out.bytes > 100); assert.ok(!JSON.stringify(out.share).includes('A man walks'));
  await assert.rejects(f.tool('import_share', { share: '{"nope": 1}' }), /share file/);
  const g = await fixture();
  const imp = await g.tool('import_share', { share: out.share });
  assert.equal(imp.id, 'recipe-rain-walk');
  assert.equal(g.W.record('card', 'recipe-rain-walk').versions[0].by, 'agent');
  await assert.rejects(f.tool('share_card', { card: 'nothing here' }), /card:<id>/);
});
