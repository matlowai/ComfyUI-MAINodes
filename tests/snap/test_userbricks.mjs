// SNAP-R280..R284: bricks people make. The real bricks.js, engine.js, recipes.js and library.js over a small fake of the
// frontend's graph (plain nodes, subgraph definitions and their instance nodes, the paste path that gives every pasted
// definition a new id, as LGraphCanvas._deserializeItems does in 1.57.6) and an in-memory record store; no browser.
// Run: node --experimental-vm-modules --test tests/snap/test_userbricks.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const src = (f) => readFile(new URL(`../../web/snap/${f}`, import.meta.url), 'utf8');
const canonical = (x) => JSON.stringify(x, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((y) => [y, v[y]])) : v));
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

// ---- a fake of the frontend graph: just what the engine touches
function frontend() {
  let nextId = 1, nextLink = 1, nextSg = 1;
  const nodes = [], links = new Map(), subgraphs = new Map(), counts = { inserts: 0, definitions: 0, steps: 0, brackets: 0 };
  let depth = 0;
  const registered = {
    Blur: { nodeData: { display_name: 'Blur', category: 'image/filters', input: { required: { image: ['IMAGE'], radius: ['INT', {}], sigma: ['FLOAT', {}], mode: [['box', 'gauss']], note: ['STRING', {}] } }, output: ['IMAGE'], output_name: ['IMAGE'] } },
    LoadPic: { nodeData: { display_name: 'Load Pic', category: 'image', input: { required: { file: [['a.png', 'b.png']] } }, output: ['IMAGE'], output_name: ['IMAGE'] } },
  };
  class Node {
    constructor(type) { Object.assign(this, { type, title: type, pos: [0, 0], size: [200, 100], mode: 0, widgets: [], inputs: [], outputs: [] }); }
    findInputSlot(name) { return this.inputs.findIndex((i) => i.name === name); }
    findOutputSlot(name) { return this.outputs.findIndex((o) => o.name === name); }
    getSlotFromWidget(w) { return w && this.inputs.find((i) => i.widget?.name === w.name); }
    connect(o, dst, i) {
      if (o < 0 || i < 0 || !dst) return null;
      if (dst.inputs[i].link != null) links.delete(dst.inputs[i].link);
      const l = { id: nextLink++, origin_id: this.id, origin_slot: o, target_id: dst.id, target_slot: i, type: this.outputs[o].type };
      links.set(l.id, l); dst.inputs[i].link = l.id;
      return l;
    }
    serialize() { return { id: this.id, type: this.type, title: this.title, pos: [...this.pos], size: [...this.size], inputs: this.inputs.map((i) => ({ ...i })), outputs: this.outputs.map((o) => ({ ...o, links: [] })), widgets_values: this.widgets.map((w) => w.value) }; }
  }
  const subgraphOf = (def) => ({ ...JSON.parse(JSON.stringify(def)), nodes: [], asSerialisable() { const { nodes, asSerialisable, ...rest } = this; return JSON.parse(JSON.stringify({ ...rest, nodes: [] })); } });
  function createNode(type) {
    const sg = subgraphs.get(type);
    if (sg) { // an instance: its inputs are the subgraph's, the promoted ones carry widget (and show as widgets)
      const n = new Node(type);
      n.isSubgraphNode = () => true; n.subgraph = sg; n.title = sg.name;
      n.inputs = sg.inputs.map((i) => ({ name: i.name, type: i.type, link: null, ...(i.label ? { label: i.label } : {}), ...(sg.promoted.includes(i.name) ? { widget: { name: i.name } } : {}) }));
      n.widgets = sg.promoted.map((name) => ({ name, value: sg.defaults?.[name] ?? 0, options: {} }));
      n.outputs = sg.outputs.map((o) => ({ ...o, links: [] }));
      return n;
    }
    const nd = registered[type]?.nodeData;
    if (!nd) return null;
    const n = new Node(type);
    for (const [name, spec] of Object.entries(nd.input.required)) {
      if (Array.isArray(spec[0])) n.widgets.push({ name, value: spec[0][0], options: { values: spec[0] } });
      else if (['INT', 'FLOAT', 'STRING'].includes(spec[0])) n.widgets.push({ name, value: spec[0] === 'STRING' ? '' : 1, options: {} });
      else n.inputs.push({ name, type: spec[0], link: null });
    }
    for (const w of n.widgets) n.inputs.push({ name: w.name, type: 'WIDGET', link: null, widget: { name: w.name } });
    n.outputs = nd.output.map((t, i) => ({ name: nd.output_name[i], type: t, links: [] }));
    return n;
  }
  const graph = {
    extra: {}, nodes, subgraphs,
    getNodeById: (id) => nodes.find((n) => String(n.id) === String(id)) ?? null,
    getLink: (id) => links.get(id) ?? null,
    add(n) { n.id = nextId++; nodes.push(n); },
    remove(n) { const i = nodes.indexOf(n); if (i >= 0) nodes.splice(i, 1); },
    computeExecutionOrder: () => [...nodes],
    serialize: () => ({ nodes: nodes.map((n) => n.serialize()), links: [...links.values()], extra: JSON.parse(JSON.stringify(graph.extra)) }),
  };
  const canvas = {
    graph, emitBeforeChange() { counts.steps++; if (!depth++) counts.brackets++; }, emitAfterChange() { depth--; }, setDirty() {}, setGraph(g) { this.graph = g; },
    // the paste path: every pasted definition gets a new id, node types follow; nodes are created and configured
    _deserializeItems(items, { position }) {
      counts.inserts++;
      const remap = new Map();
      for (const def of items.subgraphs ?? []) {
        const id = `sg-${nextSg++}`;
        remap.set(def.id, id); subgraphs.set(id, subgraphOf({ ...def, id })); registered[id] = { nodeData: { display_name: def.name } }; counts.definitions++;
      }
      const made = new Map();
      for (const info of items.nodes) {
        const n = createNode(remap.get(info.type) ?? info.type);
        graph.add(n);
        n.pos = [...position];
        (info.widgets_values ?? []).forEach((v, i) => { if (n.widgets[i]) n.widgets[i].value = v; });
        made.set(info.id, n);
      }
      return { nodes: made };
    },
  };
  // LGraph.convertToSubgraph(items) -> {subgraph, node}: the items leave the graph, a new definition holds them, its
  // instance takes their place, and every wire across the boundary is reconnected to that instance
  graph.convertToSubgraph = (items) => {
    counts.steps++;
    const inside = new Set([...items].map((n) => n.id)), all = [...links.values()];
    const ins = all.filter((l) => inside.has(l.target_id) && !inside.has(l.origin_id)), outs = all.filter((l) => inside.has(l.origin_id) && !inside.has(l.target_id));
    const outKeys = [...new Set(outs.map((l) => `${l.origin_id}:${l.origin_slot}`))];
    const id = `sg-${nextSg++}`, typeOf = (l) => l.type;
    subgraphs.set(id, subgraphOf({ id, name: 'New Subgraph', inputs: ins.map((l) => ({ name: graph.getNodeById(l.target_id).inputs[l.target_slot].name, type: typeOf(l) })),
      outputs: outKeys.map((k) => { const l = outs.find((x) => `${x.origin_id}:${x.origin_slot}` === k); return { name: graph.getNodeById(l.origin_id).outputs[l.origin_slot].name, type: typeOf(l) }; }), promoted: [] }));
    registered[id] = { nodeData: { display_name: 'New Subgraph' } };
    const sg = subgraphs.get(id), inner = new Map();
    Object.assign(sg, {
      inputNode: { id: -10 }, getNodeById: (x) => [...items].find((n) => String(n.id) === String(x)) ?? null, getLink: (x) => inner.get(x) ?? null,
      // Subgraph.addInput: every instance gets the input ('input-added'); SubgraphInput.connect: the instance shows the widget ('input-connected')
      addInput(name, type) {
        const si = { name, type, connect(slot, node) {
          const w = node.widgets.find((x) => x.name === slot.widget.name), l = { id: nextLink++, origin_id: -10, origin_slot: sg.inputs.indexOf(si), target_id: node.id };
          inner.set(l.id, l); slot.link = l.id; sg.promoted.push(name); counts.promotions = (counts.promotions ?? 0) + 1;
          for (const o of nodes.filter((x) => x.type === id)) { o.inputs.find((i) => i.name === name).widget = { name }; o.widgets.push({ name, value: w.value, options: {} }); }
          return l;
        } };
        sg.inputs.push(si);
        for (const o of nodes.filter((x) => x.type === id)) o.inputs.push({ name, type, link: null });
        return si;
      },
      removeInput(si) { sg.inputs.splice(sg.inputs.indexOf(si), 1); },
    });
    for (const n of items) { for (const l of all) if (l.origin_id === n.id || l.target_id === n.id) links.delete(l.id); graph.remove(n); }
    const outer = createNode(id);
    graph.add(outer);
    ins.forEach((l, i) => graph.getNodeById(l.origin_id).connect(l.origin_slot, outer, i));
    for (const l of outs) outer.connect(outKeys.indexOf(`${l.origin_id}:${l.origin_slot}`), graph.getNodeById(l.target_id), l.target_slot);
    return { subgraph: subgraphs.get(id), node: outer };
  };
  // LiteGraph.createNode for a subgraph type, unconfigured: no promoted widgets (what the palette's node list used to get)
  const bare = (type) => { const n = createNode(type); if (n && subgraphs.has(type)) { n.widgets = []; for (const i of n.inputs) delete i.widget; } return n; };
  return { graph, canvas, registered, counts, createNode, bare, links };
}

// a blueprint as insertBlueprint takes it: one outer node and its definition (one promoted input has a label)
const BLUR_KIT = {
  nodes: [{ id: 9, type: 'def-1', pos: [0, 0], inputs: [{ name: 'image', type: 'IMAGE', link: null }, { name: 'amount', type: 'INT', link: null, widget: { name: 'amount' } }, { name: 'vae', type: 'INT', link: null, label: 'video_vae', widget: { name: 'vae' } }], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: null }], widgets_values: [3, 7] }],
  definitions: { subgraphs: [{ id: 'def-1', name: 'Soft focus', inputs: [{ name: 'image', type: 'IMAGE' }, { name: 'amount', type: 'INT' }, { name: 'vae', type: 'INT', label: 'video_vae' }], outputs: [{ name: 'IMAGE', type: 'IMAGE' }], promoted: ['amount', 'vae'], nodes: [] }] },
};

async function fixture({ yours = null } = {}) {
  const fe = frontend();
  const app = { graph: fe.graph, canvas: fe.canvas };
  const context = vm.createContext({ console, structuredClone, setTimeout, clearTimeout, LiteGraph: { registered_node_types: fe.registered, createNode: fe.bare } });
  const served = { '/global_subgraphs': { a1: { name: 'Soft focus', source: 'custom_node', info: { node_pack: 'custom_nodes.x' } }, r1: { name: 'Dials - H3 + De-rope' }, i1: { name: 'Dials - Image' } }, '/global_subgraphs/a1': { data: JSON.stringify(BLUR_KIT) }, '/mainodes/snap/cards': { cards: [] } };
  if (yours) { // the person's published blueprints: the userdata list and each file (as ComfyUI's /userdata routes give them)
    served['/userdata?dir=subgraphs&recurse=true&split=false&full_info=true'] = Object.keys(yours).map((path) => ({ path, size: 1, modified: 1 }));
    for (const [path, body] of Object.entries(yours)) served[`/userdata/${encodeURIComponent(`subgraphs/${path}`)}`] = JSON.stringify(body);
  }
  const api = { addEventListener() {}, clientId: 'test', fetchApi: async (url) => { const has = Object.hasOwn(served, url), body = served[url];
    return { status: has ? 200 : 404, ok: has, json: async () => JSON.parse(typeof body === 'string' ? body : JSON.stringify(body ?? {})), text: async () => (typeof body === 'string' ? body : JSON.stringify(body ?? {})) }; } };
  const bricks = await load(context, 'bricks.js', {});
  const engine = await load(context, 'engine.js', { '../../../scripts/app.js': { app }, '../../../scripts/api.js': { api } }, { './bricks.js': bricks });
  const world = (await load(context, 'world.js', { '../../../scripts/api.js': { api } })).namespace;
  const records = new Map(), listeners = [];
  let clock = 1.8e12;
  const W = {
    KINDS: world.KINDS, parse: world.parse, refOf: world.refOf, diff: world.diff, headOf: world.headOf, short: world.short, sha: async () => 'x',
    load: async () => records, onChange: (fn) => listeners.push(fn), onWritten() {}, setPack() {}, packCard: () => null,
    all: (kind) => [...records.values()].filter((r) => (!kind || r.kind === kind) && !r.archived),
    record: (kind, id) => records.get(`${kind}:${id}`) ?? null,
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
  const T = { privacyOn: async () => false, load: async () => [], find: () => null, openAsTab: async () => {}, all: () => [], onFirstFrame() {}, onChange() {} };
  const stubs = { '../../../scripts/app.js': { app }, '../../../scripts/api.js': { api }, './world.js': W, './takes.js': T, './models.js': { freshTab: async () => {} }, './dials.js': { all: () => [] }, './profile.js': { sfwOnly: () => false } };
  const recipes = await load(context, 'recipes.js', stubs, { './engine.js': engine, './bricks.js': bricks });
  const library = await load(context, 'library.js', stubs, { './engine.js': engine, './bricks.js': bricks, './recipes.js': recipes });
  const tools = (await load(context, 'bricktools.js', stubs, { './engine.js': engine, './bricks.js': bricks, './library.js': library })).namespace.BRICK_TOOLS;
  return { fe, app, B: bricks.namespace, E: engine.namespace, R: recipes.namespace, L: library.namespace, W, tool: (name, args = {}) => tools.find((t) => t.name === name).run(args) };
}
// values made in the vm context are another realm's arrays: compare them as JSON
const deq = (a, b, m) => assert.deepEqual(JSON.parse(JSON.stringify(a ?? null)), JSON.parse(JSON.stringify(b ?? null)), m);
const rows = (face) => JSON.parse(JSON.stringify(face.map((f) => f.slice(0, 3))));

test('default face: a plain node shows its first three settings, a subgraph every promoted widget with its input label', async () => {
  const f = await fixture();
  const plain = await f.E.snap('node:Blur');
  assert.equal(plain.brick, 'node:Blur#1');
  deq(rows(f.B.BRICKS['node:Blur#1'].face), [['node', 'radius', 'radius'], ['node', 'sigma', 'sigma'], ['node', 'mode', 'mode']]);
  deq(Object.keys(f.B.BRICKS['node:Blur#1'].needs), ['image']);
  const made = await f.E.snapBlueprint(JSON.parse(JSON.stringify(BLUR_KIT)));
  const def = f.B.BRICKS[made.brick];
  assert.equal(def.title, 'Soft focus');
  assert.equal(def.subgraph, true);
  deq(rows(def.face), [['node', 'amount', 'amount'], ['node', 'vae', 'video_vae']]);
  deq([Object.keys(def.needs), Object.keys(def.provides)], [['image'], ['image']]);
  deq(made.bindings.map((b) => [b.role, b.from]), [['image', 'node:Blur#1']], 'wired by type from the brick before it');
});

test('a face and title override is read through BRICKS[key], and no read is stale after another brick changes', async () => {
  const f = await fixture();
  await f.E.snap('node:Blur'); await f.E.snap('node:Blur');
  f.E.setFace('node:Blur#1', ['note', ['node', 'radius', 'size']]);
  f.E.setTitle('node:Blur#1', 'Soften');
  deq(rows(f.B.BRICKS['node:Blur#1'].face), [['node', 'note', 'note'], ['node', 'radius', 'size']]);
  assert.equal(f.B.BRICKS['node:Blur#1'].title, 'Soften');
  assert.equal(f.B.BRICKS['node:Blur#2'].title, 'Blur', 'the other instance keeps its own');
  f.E.setFace('node:Blur#2', ['sigma']);
  deq(rows(f.B.BRICKS['node:Blur#1'].face), [['node', 'note', 'note'], ['node', 'radius', 'size']], 'a second read after another override');
  deq(rows(f.B.BRICKS['node:Blur#2'].face), [['node', 'sigma', 'sigma']]);
  deq(rows(f.B.BRICKS['node:Blur'].face), [['node', 'radius', 'radius'], ['node', 'sigma', 'sigma'], ['node', 'mode', 'mode']], 'the type itself keeps the default');
  f.E.setTitle('node:Blur#1', '');
  assert.equal(f.B.BRICKS['node:Blur#1'].title, 'Blur');
  assert.equal('title' in f.app.graph.extra.snap.bricks[0], false);
});

test('pinWidget adds, relabels and removes one row; a face equal to the default keeps no override; refusals', async () => {
  const f = await fixture();
  await f.E.snap('node:Blur');
  const key = 'node:Blur#1', entry = () => f.app.graph.extra.snap.bricks[0];
  const steps = f.fe.counts.steps;
  f.E.pinWidget(key, 'node', 'note', true);
  assert.ok(f.fe.counts.steps > steps, 'an undo step');
  deq(rows(f.B.BRICKS[key].face).map((r) => r[1]), ['radius', 'sigma', 'mode', 'note']);
  f.E.pinWidget(key, 'node', 'radius', false);
  deq(rows(f.B.BRICKS[key].face).map((r) => r[1]), ['sigma', 'mode', 'note']);
  f.E.pinWidget(key, 'node', 'mode', true, 'filter');
  deq(rows(f.B.BRICKS[key].face)[1], ['node', 'mode', 'filter']);
  assert.equal(f.B.BRICKS[key].faced, true);
  f.E.setFace(key, null);
  assert.equal('face' in entry(), false, 'reset');
  f.E.pinWidget(key, 'node', 'note', true); f.E.pinWidget(key, 'node', 'note', false);
  assert.equal('face' in entry(), false, 'back to the default rows: no override kept');
  assert.throws(() => f.E.pinWidget(key, 'node', 'nope', true), /Blur has no setting "nope"; its settings: radius, sigma, mode, note/);
  assert.throws(() => f.E.pinWidget('render', 'render', 'prompt', true), /pack brick: its face is curated/);
  assert.throws(() => f.E.setTitle('models', 'X'), /pack brick/);
  assert.throws(() => f.E.setFace('node:Blur#7', null), /No brick node:Blur#7 in this recipe; its bricks: node:Blur#1/);
});

test('recipe() carries face, title and blueprint; rebuild inserts a blueprint for an unregistered type once', async () => {
  const f = await fixture();
  const a = await f.E.snapBlueprint(JSON.parse(JSON.stringify(BLUR_KIT)));
  const b = await f.E.snapBlueprint(JSON.parse(JSON.stringify(BLUR_KIT)), {});
  f.E.setTitle(a.brick, 'Dreamy'); f.E.pinWidget(a.brick, 'node', 'vae', false);
  f.E.setValue(a.brick, 'node', 'amount', 5);
  const saved = JSON.parse(JSON.stringify(f.E.recipe()));
  assert.equal(saved.length, 2);
  assert.equal(saved[0].key, 'node:def-1', 'saved under the type it came as, not the id this graph gave it');
  deq([saved[0].title, saved[0].face, saved[0].values.node.amount], ['Dreamy', [['node', 'amount']], 5]);
  assert.equal(saved[0].blueprint.nodes.length, 1);
  assert.equal(saved[0].blueprint.definitions.subgraphs[0].name, 'Soft focus');
  assert.equal(saved[1].face, undefined);
  // another graph that has never seen this subgraph
  const g = await fixture();
  const keys = await g.E.restore(saved);
  assert.equal(keys.length, 2);
  assert.equal(g.fe.counts.definitions, 1, 'the definition is inserted once; the second brick is an instance of it');
  assert.equal(g.fe.counts.inserts, 2);
  assert.equal(g.app.graph.getNodeById(g.E.nodeFor(keys[0], 'node').id).type, g.app.graph.getNodeById(g.E.nodeFor(keys[1], 'node').id).type);
  assert.equal(g.B.BRICKS[keys[0]].title, 'Dreamy');
  deq(rows(g.B.BRICKS[keys[0]].face), [['node', 'amount', 'amount']]);
  assert.equal(g.E.getValue(keys[0], 'node', 'amount'), 5);
  deq(g.E.recipe().map((e) => e.key), ['node:def-1', 'node:def-1'], 'the same keys again: had() finds them, edited stays false');
  deq(await g.E.restore(saved), keys, 'applied again: reused, nothing inserted');
  assert.equal(g.fe.counts.inserts, 2);
  // with no blueprint, an unknown type stays as it was (refused: not installed)
  await assert.rejects(g.E.restore([{ key: 'node:gone-type', values: {} }]), /not installed|No brick or installed node/);
});

test('listed() keeps blueprints out, a light copy is never saved, changeLines says face and title, never a blueprint', async () => {
  const f = await fixture();
  const a = await f.E.snapBlueprint(JSON.parse(JSON.stringify(BLUR_KIT)));
  await f.L.ready();
  const out = await f.L.saveRecipe('Soft walk'); // the Library's save: a recipe record, then the Library reads it again
  const card = f.L.get(out.id);
  assert.equal(card.brick.bricks[0].blueprint, true);
  assert.equal(typeof f.W.headOf(f.W.record('card', out.id)).body.brick.bricks[0].blueprint, 'object', 'the record keeps it');
  assert.equal(JSON.stringify(card).includes('definitions'), false);
  const writes = f.W.writes;
  await assert.rejects(f.L.save(card), /light copy/);
  assert.equal(f.W.writes, writes);
  assert.equal((await f.R.current()).edited, false);
  f.E.setTitle(a.brick, 'Haze'); f.E.pinWidget(a.brick, 'node', 'amount', false);
  assert.equal((await f.R.current()).edited, true);
  await f.L.saveRecipe();
  const lines = f.R.changes(out.id, 1, 2);
  assert.ok(lines.some((l) => /title its own → "Haze"/.test(l)), lines.join('\n'));
  assert.ok(lines.some((l) => /face its default → vae$/.test(l)), lines.join('\n'));
  assert.ok(lines.every((l) => !/blueprint|definitions|def-1"|sg-/.test(l.replace(/\(node:def-1\)/, ''))), lines.join('\n'));
  // the Library applies a recipe from its record (with the blueprint), not from the light card: the stack already holds
  // that brick, so it is reused and nothing is inserted
  const inserts = f.fe.counts.inserts;
  assert.match(await f.L.apply(f.L.get(out.id)), /1 bricks/);
  assert.equal(f.fe.counts.inserts, inserts);
});

test('a kept brick round-trips: keep → Library card (light) → apply adds it with its values, face and title', async () => {
  const f = await fixture();
  await f.E.snap('node:Blur', { values: { node: { radius: 4 } } });
  f.E.setTitle('node:Blur#1', 'Soft'); f.E.setFace('node:Blur#1', ['radius', ['node', 'mode', 'filter']]);
  await f.L.ready();
  const kept = await f.L.keepBrick('node:Blur#1', { note: 'mine' });
  deq([kept.id, kept.n, kept.blueprint], ['brick-soft', 1, false]);
  const card = f.L.get('brick-soft');
  deq([card.kind, card.title, card.text], ['brick', 'Soft', 'needs image · gives image · shows radius, filter']);
  assert.equal((await f.L.keepBrick('node:Blur#1')).n, 1, 'the same brick again makes no version');
  await assert.rejects(f.L.keepBrick('render'), /pack brick/);
  assert.equal(f.L.KIND_LABEL.brick, 'Bricks');
  assert.equal(f.L.TARGET.brick, null);
  const said = await f.L.apply(card);
  assert.match(said, /Soft added as a brick/);
  const key = 'node:Blur#2';
  assert.equal(f.E.getValue(key, 'node', 'radius'), 4);
  assert.equal(f.B.BRICKS[key].title, 'Soft');
  deq(rows(f.B.BRICKS[key].face), [['node', 'radius', 'radius'], ['node', 'mode', 'filter']]);
  // a subgraph brick's card is light in the Library and whole on the record
  const sub = await f.E.snapBlueprint(JSON.parse(JSON.stringify(BLUR_KIT)));
  const k2 = await f.L.keepBrick(sub.brick, { title: 'Soft focus kit' });
  assert.equal(k2.blueprint, true);
  assert.equal(f.L.get('brick-soft-focus-kit').brick.entry.blueprint, true);
  await assert.rejects(f.L.save(f.L.get('brick-soft-focus-kit')), /light copy/);
  const before = f.fe.counts.inserts;
  await f.L.apply(f.L.get('brick-soft-focus-kit'));
  assert.equal(f.fe.counts.inserts, before + 1);
});

test('installed blueprints by name, the two pack ones left out; the tools name what they take', async () => {
  const f = await fixture();
  deq((await f.E.blueprints()).map((b) => b.name), ['Soft focus']);
  const listed = await f.tool('list_blueprints');
  deq([listed.count, listed.blueprints[0].shows.map((s) => s.label), listed.blueprints[0].needs.map((s) => s.name)], [1, ['amount', 'video_vae'], ['image']]);
  const added = await f.tool('add_blueprint', { name: 'soft focus' });
  assert.equal(added.title, 'Soft focus');
  await assert.rejects(f.tool('add_blueprint', { name: 'nope' }), /list_blueprints lists 1: Soft focus/);
  const faced = f.tool('set_brick_face', { brick: 'Soft focus', show: ['amount'] });
  deq(faced.face.map((x) => x.setting), ['amount']);
  assert.equal(f.tool('rename_brick', { brick: added.brick, title: 'Glow' }).title, 'Glow');
  assert.throws(() => f.tool('set_brick_face', { brick: 'Glow' }), /takes brick and show/);
  assert.throws(() => f.tool('rename_brick', { brick: 'nothing', title: 'x' }), /No brick "nothing" in this recipe: give its id or title/);
  deq(rows(f.B.BRICKS[added.brick].face), [['node', 'amount', 'amount']]);
  const ranked = f.B.rankTypes([{ type: 'X', title: 'Upscale image', category: '' }, { type: 'Y', title: 'Image blur', category: '' }, { type: 'Z', title: 'Load', category: 'image' }, { type: 'W', title: 'Big imager', category: '' }], 'im');
  // a title starting with the query, then a word of it (shorter title first), then the category
  deq(ranked.map((n) => n.type), ['Y', 'W', 'X', 'Z']);
});

test('group: two any-node bricks become one subgraph brick in one step; bindings in and out follow, pack bricks refused', async () => {
  const f = await fixture();
  for (const k of ['node:LoadPic', 'node:Blur', 'node:Blur', 'node:Blur']) await f.E.snap(k);
  const wiring = () => f.E.describe().map((b) => [b.brick, b.bindings.map((x) => `${x.role}<-${x.from}.${x.output}`)]);
  deq(wiring(), [['node:LoadPic#1', []], ['node:Blur#1', ['image<-node:LoadPic#1.IMAGE']], ['node:Blur#2', ['image<-node:Blur#1.IMAGE']], ['node:Blur#3', ['image<-node:Blur#2.IMAGE']]]);
  f.E.setTitle('node:Blur#1', 'first');
  f.E.addNote('too soft', 'node:Blur#2');
  assert.throws(() => f.E.group(['node:Blur#1', 'render'], { title: 'x' }), /render is a pack brick|Render is a pack brick/);
  assert.throws(() => f.E.group(['node:Blur#1'], {}), /two or more/);
  const steps = f.fe.counts.steps;
  const out = f.E.group(['node:Blur#1', 'node:Blur#2'], { title: 'Double blur' });
  assert.equal(out.brick, 'node:sg-1#1');
  assert.equal(out.title, 'Double blur');
  assert.ok(f.fe.counts.steps > steps);
  deq(f.app.graph.extra.snap.bricks.map((b) => b.key), ['node:LoadPic#1', 'node:sg-1#1', 'node:Blur#3'], 'the group takes the first one\'s place');
  deq(wiring(), [['node:LoadPic#1', []], ['node:sg-1#1', ['image<-node:LoadPic#1.IMAGE']], ['node:Blur#3', ['image<-node:sg-1#1.IMAGE']]]);
  deq(f.E.overrides(), [], 'every recorded binding matches its live wire');
  assert.equal(f.E.notes()[0].brick, 'node:sg-1#1', 'a note on a grouped brick is on the group');
  deq(Object.keys(f.B.BRICKS[out.brick].needs), ['image']);
});

// a blueprint as ComfyUI's Publish subgraph saves it (frontend 1.57.6 subgraphStore.publishSubgraph: userdata
// subgraphs/<name>.json holding {revision, last_node_id, last_link_id, nodes: [the instance], links: [], version,
// definitions: {subgraphs}}); its definition keeps the name it had, the file name names it on load. Built from the source,
// not from a real published file
const published = (defName, promoted, extra) => ({ revision: 0, last_node_id: 12, last_link_id: 0, version: 0.4, links: [],
  nodes: [{ id: 12, type: 'mine-1', title: defName, pos: [40, 40], inputs: [{ name: 'image', type: 'IMAGE', link: null }, ...promoted.map((p) => ({ name: p, type: 'INT', link: null, widget: { name: p } }))], outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [] }], widgets_values: promoted.map(() => 9) }],
  definitions: { subgraphs: [{ id: 'mine-1', name: defName, inputs: [{ name: 'image', type: 'IMAGE' }, ...promoted.map((p) => ({ name: p, type: 'INT' }))], outputs: [{ name: 'IMAGE', type: 'IMAGE' }], promoted, nodes: [] }] },
  ...(extra ? { extra } : {}) });

test('the person\'s published blueprints: listed first with source "yours", resolved by name, theirs wins a shared name', async () => {
  const f = await fixture({ yours: { 'Soft focus.json': published('New Subgraph', ['amount']), 'kits/Glow kit.json': published('Glow', ['glow', 'size'], { note: 'mine' }), 'notes.txt': 'not a blueprint' } });
  deq((await f.E.blueprints()).map((b) => [b.name, b.source]), [['Glow kit', 'yours'], ['Soft focus', 'yours'], ['Soft focus', 'custom_node']]);
  const listed = await f.tool('list_blueprints');
  deq(listed.blueprints.map((b) => [b.name, b.source, b.shows.map((x) => x.name), b.error ?? null]),
    [['Glow kit', 'yours', ['glow', 'size'], null], ['Soft focus', 'yours', ['amount'], null], ['Soft focus', 'custom_node', ['amount', 'vae'], null]], 'each listed one read from its own source');
  const mine = await f.E.fetchBlueprintNamed('Glow kit');
  deq([mine.definitions.subgraphs[0].name, mine.nodes[0].title, mine.definitions.subgraphs[0].extra], ['Glow kit', 'Glow kit', { note: 'mine' }], 'loaded as the frontend loads it');
  deq((await f.E.fetchBlueprintNamed('Soft focus', { source: 'installed' })).definitions.subgraphs[0].promoted, ['amount', 'vae']);
  await assert.rejects(f.E.fetchBlueprintNamed('Nope', { source: 'yours' }), /no published blueprint "Nope"/);
  const added = await f.tool('add_blueprint', { name: 'soft focus' });
  deq([added.title, added.face.map((x) => x.setting)], ['Soft focus', ['amount']], 'the person\'s, not the installed one');
  const glow = await f.E.snapBlueprint('Glow kit');
  deq([f.B.BRICKS[glow.brick].title, f.E.getValue(glow.brick, 'node', 'size')], ['Glow kit', 9]);
  const none = await fixture();
  deq((await none.E.blueprints()).map((b) => b.source), ['custom_node'], 'nothing published: the userdata list is a 404');
});

test('group: the new brick shows the settings the grouped faces showed, in brick order under their labels, in one undo step', async () => {
  const f = await fixture();
  for (const k of ['node:LoadPic', 'node:Blur', 'node:Blur']) await f.E.snap(k);
  f.E.setValue('node:Blur#1', 'node', 'radius', 4);
  f.E.setFace('node:Blur#2', ['note', ['node', 'radius', 'size']]);
  const brackets = f.fe.counts.brackets;
  const out = f.E.group(['node:Blur#1', 'node:Blur#2'], { title: 'Double blur' });
  assert.equal(f.fe.counts.brackets, brackets + 1, 'one undo step');
  deq(rows(f.B.BRICKS[out.brick].face), [['node', 'radius', 'radius'], ['node', 'sigma', 'sigma'], ['node', 'mode', 'mode'], ['node', 'note', 'note'], ['node', 'radius_1', 'size']]);
  assert.equal(f.E.getValue(out.brick, 'node', 'radius'), 4, 'the value it had');
  assert.equal('face' in f.app.graph.extra.snap.bricks[1], false, 'the default face already reads so: no override kept');
  deq(Object.keys(f.B.BRICKS[out.brick].needs), ['image'], 'promoted settings are not needs');
  deq(f.E.describe().map((b) => [b.brick, b.bindings.map((x) => `${x.role}<-${x.from}`)]), [['node:LoadPic#1', []], [out.brick, ['image<-node:LoadPic#1']]]);
});

test('a subgraph type this graph holds, snapped from the node list, is another instance of its definition with its widgets', async () => {
  const f = await fixture();
  const first = await f.E.snapBlueprint(JSON.parse(JSON.stringify(BLUR_KIT)));
  f.E.setValue(first.brick, 'node', 'amount', 5);
  const type = f.E.nodeFor(first.brick, 'node').type, defs = f.fe.counts.definitions, inserts = f.fe.counts.inserts;
  const second = await f.E.snap(`node:${type}`);
  assert.equal(second.brick, `node:${type}#2`);
  deq([f.fe.counts.definitions, f.fe.counts.inserts], [defs, inserts + 1], 'no second definition; the paste path, not a bare createNode');
  deq(rows(f.B.BRICKS[second.brick].face), [['node', 'amount', 'amount'], ['node', 'vae', 'video_vae']]);
  assert.equal(f.E.getValue(second.brick, 'node', 'amount'), 5, 'the outer node of the instance already here');
  assert.equal(f.E.nodeFor(second.brick, 'node').type, type);
  deq(f.E.recipe().map((e) => e.key), ['node:def-1', 'node:def-1'], 'saved under the type the first one was, so a rebuild inserts the definition once');
  // no instance left at the root: the bare type through the paste path, configured from its definition
  f.E.unsnap(first.brick); f.E.unsnap(second.brick);
  const third = await f.E.snap(`node:${type}`);
  deq([rows(f.B.BRICKS[third.brick].face).map((r) => r[1]), f.fe.counts.definitions], [['amount', 'vae'], defs]);
});
