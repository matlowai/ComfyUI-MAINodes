// SNAP-R274..R277: the real recipes.js and library.js over an in-memory record store with the server's versioning
// (a body equal to the head makes no version); no live graph, server or browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const src = (f) => readFile(new URL(`../../web/snap/${f}`, import.meta.url), 'utf8');
const canonical = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((y) => [y, v[y]])) : v));
// the names a module imports from each specifier, so a stub module can export exactly those
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

async function fixture({ privacy = false } = {}) {
  const context = vm.createContext({ console, structuredClone, setTimeout, clearTimeout });
  // the real world.js for parse, refOf and diff; the store below keeps records in memory
  const world = (await load(context, 'world.js', { '../../../scripts/api.js': { api: { addEventListener() {}, clientId: 'test' } } })).namespace;
  const records = new Map(), listeners = [];
  let clock = 1.8e12; // one tick per version: the newest is never tied with an older one
  const W = {
    KINDS: world.KINDS, parse: world.parse, refOf: world.refOf, diff: world.diff, headOf: world.headOf, short: world.short, sha: async () => 'x',
    load: async () => records, onChange: (fn) => listeners.push(fn), onWritten() {}, setPack() {}, packCard: () => null,
    all: (kind) => [...records.values()].filter((r) => (!kind || r.kind === kind) && !r.archived),
    record: (kind, id) => records.get(`${kind}:${id}`) ?? null,
    get: (ref) => { const { kind, id, n } = world.parse(ref), r = records.get(`${kind}:${id}`); const v = r && (n == null ? world.headOf(r) : r.versions.find((x) => x.n === n)); return v ? { record: r, version: v } : null; },
    writes: 0,
    async save(kind, id, body, { note = '', by = 'person' } = {}) {
      W.writes++;
      const key = `${kind}:${id}`, r = records.get(key) ?? { kind, id, head: 0, versions: [] }, hash = canonical(body), head = world.headOf(r);
      if (head?.hash === hash) return { ref: world.refOf(kind, id), n: head.n, made: false, record: r };
      const n = (r.versions.at(-1)?.n ?? 0) + 1;
      r.versions.push({ n, hash, at: ++clock, by, note, body: JSON.parse(JSON.stringify(body)) });
      r.head = n; records.set(key, r);
      for (const fn of listeners) fn();
      return { ref: world.refOf(kind, id), n, made: true, record: r };
    },
    fields: async () => ({}),
  };
  const graph = { id: 'tab-a', nodes: [{ id: 1, type: 'Render', widgets_values: [97, 'a prompt'] }], links: [], extra: { ds: { scale: 1, offset: [0, 0] }, snap: { version: 1, bricks: [], bindings: [] } } };
  let bricks = [{ key: 'cast', values: { cast: { lora_1: 'someone.safetensors' } } }, { key: 'render', values: { render: { length: 97, prompt: 'a prompt' } } }];
  const restored = [], opened = [], takes = {};
  const app = { graph: { serialize: () => JSON.parse(JSON.stringify(graph)) }, canvas: { emitBeforeChange() {}, emitAfterChange() {}, setDirty() {} } };
  const E = { state: () => graph.extra.snap, tag: (field, value) => { graph.extra.snap[field] = value; }, recipe: () => JSON.parse(JSON.stringify(bricks)), restore: async (b) => { restored.push(b); return b.map((x) => x.key); } };
  const T = { privacyOn: async () => privacy, load: async () => [], find: (id) => takes[id] ?? null, openAsTab: async (t) => { opened.push(t); }, all: () => [], onFirstFrame() {}, onChange() {} };
  const BRICKS = { cast: { title: 'Cast', stack: { role: 'identity' } }, render: { title: 'Render' }, rack: { title: 'Dials' } };
  const stubs = { '../../../scripts/app.js': { app }, '../../../scripts/api.js': { api: { fetchApi: async () => ({ json: async () => ({ cards: [] }) }), addEventListener() {} } },
    './engine.js': E, './world.js': W, './takes.js': T, './models.js': { freshTab: async () => {} }, './bricks.js': { BRICKS, kit: () => null },
    './dials.js': { all: () => [] }, './profile.js': { sfwOnly: () => false } };
  const recipes = await load(context, 'recipes.js', stubs);
  const library = await load(context, 'library.js', stubs, { './recipes.js': recipes });
  const tools = (await load(context, 'recipetools.js', stubs, { './recipes.js': recipes })).namespace.RECIPE_TOOLS;
  const tool = (name, args = {}) => tools.find((t) => t.name === name).run(args);
  return { R: recipes.namespace, L: library.namespace, tool, W, E, T, graph, takes, restored, opened, records, setBricks: (b) => { bricks = b; } };
}
const render = (length) => ({ key: 'render', values: { render: { length, prompt: 'a prompt' } } });

test('slug and id: one recipe per slug, a timestamp when the name has none', async () => {
  const { R } = await fixture();
  assert.equal(R.slug('  Night Walk!  '), 'night-walk');
  assert.equal(R.idFor('Night Walk!'), 'recipe-night-walk');
  assert.equal(R.idFor('night-walk'), R.idFor('Night  WALK'));
  assert.equal(R.idFor('!!!', 36), 'recipe-10');
});

test('first save is v1, the same body makes no version, a change makes v2; the graph names its version', async () => {
  const f = await fixture();
  const a = await f.R.save({ name: 'Night walk', note: 'first' });
  assert.deepEqual([a.id, a.n, a.made, a.name, a.graph], ['recipe-night-walk', 1, true, 'Night walk', true]);
  assert.deepEqual({ ...f.graph.extra.snap.recipe }, { id: 'recipe-night-walk', n: 1 });
  const body = f.W.headOf(f.W.record('card', a.id)).body;
  assert.equal(body.graph.id, undefined, 'the tab id is not stored');
  assert.equal(body.graph.extra.ds, undefined, 'the canvas view is not stored');
  assert.equal(body.graph.extra.snap.recipe, undefined, 'the marker is not stored');
  assert.equal(body.text, '2 bricks: Cast, Render');
  f.graph.extra.ds = { scale: 2, offset: [40, 9] }; // panning is not an edit
  const b = await f.R.save({});
  assert.deepEqual([b.n, b.made], [1, false]);
  f.setBricks([render(121)]); f.graph.nodes[0].widgets_values[0] = 121;
  const c = await f.R.save({ note: 'longer' });
  assert.deepEqual([c.id, c.n, c.made], ['recipe-night-walk', 2, true]);
  assert.deepEqual(JSON.parse(JSON.stringify(f.R.versions(c.id).map((v) => [v.n, v.note, v.workflow]))), [[2, 'longer', true], [1, 'first', true]]);
  await assert.rejects(f.R.save({ asNew: true }), /needs a name/);
});

test('a graph with no recipe needs a name; asNew suffixes a taken id', async () => {
  const f = await fixture();
  await assert.rejects(f.R.save({}), /no recipe yet: give it a name/);
  assert.equal((await f.R.save({ name: 'Walk' })).id, 'recipe-walk');
  assert.equal((await f.R.save({ name: 'Walk', asNew: true })).id, 'recipe-walk-2');
  assert.equal((await f.R.save({ name: 'walk', asNew: true })).id, 'recipe-walk-3');
  assert.deepEqual({ ...f.graph.extra.snap.recipe }, { id: 'recipe-walk-3', n: 1 });
});

test('current(): edited is computed from the brick list', async () => {
  const f = await fixture();
  assert.equal(await f.R.current(), null);
  await f.R.save({ name: 'Walk' });
  assert.deepEqual({ ...(await f.R.current()) }, { id: 'recipe-walk', n: 1, name: 'Walk', head: 1, edited: false });
  f.setBricks([render(121)]);
  assert.equal((await f.R.current()).edited, true);
  assert.equal(f.graph.extra.snap.edited, undefined, 'edited is never stored');
});

test('privacy on: no graph, no identity rows, and the answer says so', async () => {
  const f = await fixture({ privacy: true });
  const out = await f.R.save({ name: 'Private walk' });
  assert.equal(out.graph, false);
  assert.match(out.why, /privacy is on/);
  const body = f.W.headOf(f.W.record('card', out.id)).body;
  assert.equal('graph' in body, false);
  assert.deepEqual(body.brick.bricks[0], { key: 'cast', values: {} });
  assert.equal((await f.R.current()).edited, false, 'the stripped list compares as a save would strip it');
  assert.equal(f.R.workflow(out.id, 1), null);
  await f.R.open(out.id, 1, { how: 'tab' });
  assert.equal(f.opened.length, 0, 'no workflow: rebuilt, not the take opener');
  assert.equal(f.restored.length, 1);
});

test('list(): newest first, old-style cards as one-version recipes, setups left out', async () => {
  const f = await fixture();
  await f.W.save('card', 'recipe-lq1x2', { id: 'recipe-lq1x2', kind: 'recipe', title: 'Recipe: old (saved 10:00:00)', saved: 1, text: '1 bricks: Render', brick: { bricks: [render(97)] } });
  await f.W.save('card', 'recipe-last-h3', { id: 'recipe-last-h3', kind: 'recipe', family: 'H3', title: 'Last used: H3', brick: { bricks: [] } });
  await f.R.save({ name: 'New one' });
  const list = f.R.list();
  assert.deepEqual(list.map((r) => r.id), ['recipe-new-one', 'recipe-lq1x2']);
  assert.deepEqual([list[1].name, list[1].versions, list[1].workflow], ['Recipe: old (saved 10:00:00)', 1, false]);
  assert.equal(list[0].workflow, true);
});

test('changes() names bricks and never reads the graph', async () => {
  const f = await fixture();
  await f.R.save({ name: 'Walk' });
  f.setBricks([render(121), { key: 'rack', values: { rack: { rack: '[]' } } }]);
  f.graph.nodes.push({ id: 2, type: 'Huge', widgets_values: ['x'.repeat(1000)] });
  await f.R.save({});
  const lines = f.R.changes('recipe-walk', 1, 2);
  assert.ok(lines.includes('Render (render): render.length 97 → 121'), lines.join('\n'));
  assert.ok(lines.some((l) => l.startsWith('Dials (rack): added')));
  assert.ok(lines.some((l) => l.startsWith('Cast (cast): taken out')));
  assert.ok(lines.every((l) => !/graph|nodes|widgets_values|Huge/.test(l)), lines.join('\n'));
  assert.equal(f.R.changes('recipe-walk', 2, 2).length, 0);
});

test('the Library lists a recipe without its graph and never writes that copy back', async () => {
  const f = await fixture();
  await f.L.ready();
  const saved = await f.L.saveRecipe('Walk'); // the old export still works: a new recipe, then versions of it
  assert.equal(saved.id, 'recipe-walk');
  const card = f.L.get('recipe-walk');
  assert.equal('graph' in card, false);
  assert.equal(card.workflow, true);
  assert.deepEqual(card.brick.bricks.map((b) => b.key), ['cast', 'render']);
  assert.ok(f.L.search('walk').some((c) => c.id === 'recipe-walk' && !('graph' in c)));
  assert.ok(f.W.headOf(f.W.record('card', 'recipe-walk')).body.graph, 'the record keeps it');
  const writes = f.W.writes;
  await assert.rejects(f.L.save(card), /light copy/);
  assert.equal(f.W.writes, writes);
  assert.equal(f.W.record('card', 'recipe-walk').head, 1);
  f.setBricks([render(121)]);
  await f.L.saveRecipe('ignored: the graph names its recipe');
  assert.equal(f.W.record('card', 'recipe-walk').head, 2);
  assert.equal(f.R.list().length, 1);
  assert.match(await f.L.apply(f.L.get('recipe-walk')), /2 bricks|1 bricks/); // apply here, as before
});

test('open: the exact graph in a new tab with its marker, or here; saveFromTake needs the take open', async () => {
  const f = await fixture();
  await f.R.save({ name: 'Walk' });
  await f.R.open('recipe-walk', 1, { how: 'tab' });
  assert.equal(f.opened.length, 1);
  assert.deepEqual({ ...f.opened[0].graph.extra.snap.recipe }, { id: 'recipe-walk', n: 1 });
  assert.equal(f.opened[0].graph.nodes.length, 1);
  await assert.rejects(f.R.open('recipe-walk', 1, { how: 'window' }), /"tab".*"here"/);
  await assert.rejects(f.R.open('recipe-walk', 7), /no version 7; it has v1/);
  f.takes.t1 = { id: 't1', number: 4, graph: f.graph && JSON.parse(JSON.stringify(f.graph)) };
  f.takes.t2 = { id: 't2', number: 5, graph: { ...JSON.parse(JSON.stringify(f.graph)), nodes: [{ id: 1, type: 'Render', widgets_values: [33, 'other'] }] } };
  await assert.rejects(f.R.saveFromTake('t2'), /isn't the one open here/);
  f.setBricks([render(121)]);
  const out = await f.R.saveFromTake('t1');
  assert.deepEqual([out.n, out.made], [2, true]);
  const v = f.W.headOf(f.W.record('card', 'recipe-walk'));
  assert.deepEqual([{ ...v.body.from }, v.note], [{ take: 't1' }, 'from take 4']);
});

test('the tools: an agent save, names that resolve, workflow only when asked', async () => {
  const f = await fixture();
  const a = await f.tool('save_recipe', { name: 'Walk', note: 'agent take' });
  assert.equal(a.said, 'Walk v1 saved');
  assert.equal(f.W.headOf(f.W.record('card', 'recipe-walk')).by, 'agent');
  assert.equal((await f.tool('save_recipe', {})).said, 'nothing changed: Walk stays v1');
  f.setBricks([render(121)]);
  await f.tool('save_recipe', { note: 'longer' });
  const listed = await f.tool('list_recipes');
  assert.deepEqual([listed.recipes.length, listed.recipes[0].head, listed.current.n, listed.current.edited], [1, 2, 2, false]);
  const got = await f.tool('get_recipe', { recipe: 'Walk', version: 1 });
  assert.deepEqual([got.ref, 'graph' in got.version.body, 'workflow' in got], ['card:recipe-walk@1', false, false]);
  assert.ok((await f.tool('get_recipe', { recipe: 'card:recipe-walk@1', with_workflow: true })).workflow.nodes);
  assert.ok((await f.tool('recipe_changes', { recipe: 'recipe-walk', from: 1, to: 2 })).changes.includes('Render (render): render.length 97 → 121'));
  await assert.rejects(f.tool('get_recipe', { recipe: 'nope' }), /give its id \(recipe-<name>\), card:<id>, card:<id>@n or its name; list_recipes lists 1: recipe-walk/);
});
