// Snap engine: turns bricks into real graph nodes and links, records every binding (and which rule made it) in
// graph.extra.snap, and finds user overrides by diffing the live links against that record.
// Only node ids are kept: undo/redo reloads the graph and replaces every node object (frontend 1.57.1).
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { BRICKS } from "./bricks.js";

const GAP = 80;
const COLUMN = { models: 0, preset: 0, rack: 1, first_frame: 1, refs: 1, render: 2 };
const column = (key) => COLUMN[key] ?? COLUMN[BRICKS[key].attach?.brick] ?? 0;
const EMPTY = Object.freeze({ version: 1, bricks: Object.freeze([]), bindings: Object.freeze([]) });

// the recipe record; reading never writes it, so a workflow that never used Snap stays untouched
export const state = () => app.graph.extra?.snap ?? EMPTY;
const record = () => ((app.graph.extra ??= {}).snap ??= { version: 1, bricks: [], bindings: [] });

// one undo step for a batch of edits (the same pair the node library's paste path emits)
function transaction(fn) {
  app.canvas.emitBeforeChange();
  try { return fn(); } finally { app.canvas.emitAfterChange(); }
}

async function fetchBlueprint(name) {
  const list = await (await api.fetchApi("/global_subgraphs")).json();
  const id = Object.keys(list).find((k) => list[k].name === name);
  if (!id) throw new Error(`Blueprint "${name}" is not installed`);
  return JSON.parse((await (await api.fetchApi(`/global_subgraphs/${id}`)).json()).data);
}

// the node library's own blueprint insert; private in 1.57.1, so it stays behind this one function
function insertBlueprint(bp, position) {
  if (app.canvas.graph !== app.graph) app.canvas.setGraph(app.graph);
  const res = app.canvas._deserializeItems({ nodes: bp.nodes, subgraphs: bp.definitions?.subgraphs }, { position });
  return res.nodes.values().next().value;
}

const node = (id) => app.graph.getNodeById(id);
const widget = (n, name) => n?.widgets?.find((w) => w.name === name);
const brick = (key) => state().bricks.find((b) => b.key === key);

export function nodeFor(brickKey, nodeKey) {
  const b = brick(brickKey);
  return b && node(b.nodes[nodeKey]);
}

// several settings on one brick node as one undo step
export function setValues(brickKey, nodeKey, values) {
  const n = nodeFor(brickKey, nodeKey);
  const ws = Object.keys(values).map((name) => widget(n, name) ?? (() => { throw new Error(`${brickKey}: no setting "${name}"`); })());
  transaction(() => { for (const w of ws) { w.value = values[w.name]; w.callback?.(w.value); } });
  app.canvas.setDirty(true, true);
}

export const setValue = (brickKey, nodeKey, name, value) => setValues(brickKey, nodeKey, { [name]: value });

export function getValue(brickKey, nodeKey, name) {
  return widget(nodeFor(brickKey, nodeKey), name)?.value;
}

// the node of brick `key` that provides output `[nodeKey, slotName]`, if the user hasn't deleted it
function provider(key, [nodeKey, out]) {
  const src = nodeFor(key, nodeKey), o = src?.findOutputSlot(out);
  return src && o >= 0 ? { src, o } : null;
}

// pack rule first (role names match), then a unique type match from the nearest brick upstream
function resolve(toBrick, role, type) {
  const order = state().bricks.map((b) => b.key), at = order.indexOf(toBrick);
  const upstream = order.slice(0, at).reverse().concat(order.slice(at + 1));
  for (const key of upstream) {
    const out = BRICKS[key].provides?.[role];
    if (out && provider(key, out)) return { from: key, out, rule: `pack:${key}.${role}` };
  }
  for (const key of upstream) {
    const hits = Object.values(BRICKS[key].provides ?? {}).filter((out) => {
      const p = provider(key, out);
      return p && p.src.outputs[p.o].type === type;
    });
    if (hits.length === 1) return { from: key, out: hits[0], rule: `inferred:${type}` };
  }
  return null;
}

// (re)bind every brick input that has a provider; inputs the user rewired or cleared in the graph are left alone
function bindAll() {
  const s = record(), made = [];
  for (const b of s.bricks) {
    for (const [role, [nodeKey, inputName]] of Object.entries(BRICKS[b.key].needs ?? {})) {
      const dst = node(b.nodes[nodeKey]), i = dst?.findInputSlot(inputName);
      if (!dst || i < 0) continue;
      const existing = s.bindings.find((x) => x.to === b.key && x.role === role);
      const link = app.graph.getLink(dst.inputs[i].link);
      if (existing ? String(link?.origin_id) !== String(existing.origin) : link) continue; // the user's wiring wins
      const r = resolve(b.key, role, dst.inputs[i].type);
      if (!r) continue;
      const { src, o } = provider(r.from, r.out);
      if (link && link.origin_id === src.id && link.origin_slot === o) continue;
      if (!src.connect(o, dst, i)) continue;
      const binding = { to: b.key, role, input: inputName, from: r.from, output: r.out[1], rule: r.rule, origin: src.id, target: dst.id };
      s.bindings = s.bindings.filter((x) => x !== existing);
      s.bindings.push(binding);
      made.push(binding);
    }
  }
  return made;
}

// an insert index that never splits a host from its attachments
function boundary(bricks, index) {
  while (BRICKS[bricks[index]?.key]?.attach) index++;
  return index;
}

// snaps of the same brick share one call: a double click or an agent racing the user inserts it once
const inflight = new Map();
export function snap(key, options) {
  if (!inflight.has(key)) inflight.set(key, snapOnce(key, options).finally(() => inflight.delete(key)));
  return inflight.get(key);
}

async function snapOnce(key, { values, at } = {}) {
  const def = BRICKS[key];
  const bp = def.blueprint && !brick(key) ? await fetchBlueprint(def.blueprint) : null;
  if (brick(key)) return { brick: key, bindings: [] }; // read after the fetch: the graph may have changed meanwhile
  if (def.attach) {
    const host = state().bricks.findIndex((b) => b.key === def.attach.brick);
    if (host < 0) throw new Error(`${def.title} snaps onto ${BRICKS[def.attach.brick].title}; add that first`);
    const w = widget(nodeFor(def.attach.brick, def.attach.brick), def.attach.widget);
    if (!w) throw new Error(`${BRICKS[def.attach.brick].title} has no ${def.attach.widget} setting`);
    transaction(() => {
      w.value = def.attach.on; w.callback?.(w.value);
      record().bricks.splice(host + 1, 0, { key, nodes: {} }); // attachments always sit right under their host
    });
    return { brick: key, bindings: [{ to: def.attach.brick, role: def.attach.widget, rule: `pack:${key}.attach`, value: def.attach.on }] };
  }
  const s = record();
  // graph layout: columns by role, each starting right of the widest node to its left, stacked below its column
  const nodesIn = (test) => s.bricks.filter((b) => test(column(b.key))).flatMap((b) => Object.values(b.nodes)).map(node).filter(Boolean);
  const left = nodesIn((c) => c < column(key)), below = nodesIn((c) => c === column(key));
  const x = left.length ? Math.max(...left.map((n) => n.pos[0] + n.size[0])) + GAP : 0;
  const y = below.length ? Math.max(...below.map((n) => n.pos[1] + n.size[1])) + 80 : 0;
  const bindings = transaction(() => {
    const ids = {};
    if (bp) ids[key] = insertBlueprint(bp, [x, y]).id;
    let dy = 0;
    for (const spec of def.nodes ?? []) {
      const n = LiteGraph.createNode(spec.type);
      if (!n) throw new Error(`Node type ${spec.type} is not installed`);
      n.pos = [x, y + dy];
      if (spec.title) n.title = spec.title;
      app.graph.add(n);
      for (const [name, v] of Object.entries({ ...spec.values, ...values?.[spec.key] })) {
        const w = widget(n, name);
        if (w && (!w.options?.values || w.options.values.includes(v))) w.value = v;
      }
      ids[spec.key] = n.id;
      dy += (n.size?.[1] ?? 120) + 40;
    }
    const placed = Object.fromEntries(Object.values(ids).map((id) => [id, [...node(id).pos]]));
    s.bricks.splice(boundary(s.bricks, at ?? s.bricks.length), 0, { key, nodes: ids, placed });
    return bindAll();
  });
  app.canvas.setDirty(true, true);
  return { brick: key, bindings };
}

// a picture reference: a LoadImage node owned by the References brick, wired into the next free ref_images slot
// (H3 References takes 9), recorded with its role and reason so the brick can show what each picture is for
export const PICTURE_SLOTS = 9;
export function addPicture(file, { role, reason, source }) {
  const b = brick("refs");
  if (!b) throw new Error("Add the References brick first");
  const pictures = b.pictures ?? [];
  if (pictures.some((p) => p.file === file)) return pictures.find((p) => p.file === file);
  const same = source && pictures.find((p) => p.source === source && p.role === role);
  if (same) { // the same card's picture for the same role: swap the file on its LoadImage, keep its slot
    const w = widget(node(same.node), "image");
    return transaction(() => {
      if (!w.options.values.includes(file)) w.options.values.push(file);
      w.value = file;
      b.pictures = pictures.map((p) => (p === same ? { ...p, file, reason } : p));
      return b.pictures.find((p) => p.node === same.node);
    });
  }
  if (pictures.length >= PICTURE_SLOTS) throw new Error(`References holds ${PICTURE_SLOTS} pictures; remove one first`);
  const refs = node(b.nodes.refs);
  return transaction(() => {
    const n = LiteGraph.createNode("LoadImage");
    n.title = role;
    n.pos = [refs.pos[0], refs.pos[1] + refs.size[1] + 80 + pictures.length * 340];
    app.graph.add(n);
    const w = widget(n, "image");
    if (!w.options.values.includes(file)) w.options.values.push(file);
    w.value = file;
    n.connect(0, refs, refs.inputs.findIndex((i) => i.name.startsWith("ref_images.") && i.link == null));
    const picture = { node: n.id, file, role, reason, ...(source ? { source } : {}) };
    b.nodes[`picture_${n.id}`] = n.id;
    b.placed[n.id] = [...n.pos];
    b.pictures = [...pictures, picture];
    return picture;
  });
}

// lay Snap-placed nodes out again with their current sizes (DOM widgets grow after mounting); nodes the user moved
// in the graph keep their place. One undo step, and only when something moves.
export function tidy() {
  const s = state(), moves = [];
  const ours = (b, n) => b.placed?.[n.id] && b.placed[n.id][0] === n.pos[0] && b.placed[n.id][1] === n.pos[1];
  const cols = [...new Set(s.bricks.map((b) => column(b.key)))].sort((a, c) => a - c);
  let x = 0;
  for (const c of cols) {
    let y = 0, right = x;
    for (const b of s.bricks.filter((b) => column(b.key) === c)) {
      for (const n of Object.values(b.nodes).map(node).filter(Boolean)) {
        if (ours(b, n) && (n.pos[0] !== x || n.pos[1] !== y)) moves.push([b, n, [x, y]]);
        const [nx, ny] = ours(b, n) ? [x, y] : n.pos;
        y = Math.max(y, ny + n.size[1] + 80);
        right = Math.max(right, nx + n.size[0]);
      }
    }
    x = right + GAP;
  }
  if (!moves.length) return;
  transaction(() => { for (const [b, n, pos] of moves) { n.pos = pos; b.placed[n.id] = [...pos]; } });
}

// reading order only: pack rules bind by role, so reordering never rewires. A host carries its attachments; an
// attachment can't leave its host; `index` counts the list without the moved group (what a drag reports)
export function move(key, index) {
  const s = state(), i = s.bricks.findIndex((b) => b.key === key);
  if (i < 0 || BRICKS[key].attach) return;
  let n = 1;
  while (BRICKS[s.bricks[i + n]?.key]?.attach?.brick === key) n++;
  transaction(() => {
    const group = s.bricks.splice(i, n);
    s.bricks.splice(boundary(s.bricks, index), 0, ...group);
  });
}

// keyboard reorder: move a brick (with its attachments) past the neighbouring brick group above or below
export function nudge(key, dir) {
  const s = state(), groups = [];
  for (const b of s.bricks) (BRICKS[b.key].attach && groups.length ? groups.at(-1) : (groups[groups.length] = [])).push(b);
  const g = groups.findIndex((x) => x[0].key === key), to = g + dir;
  if (g < 0 || to < 0 || to >= groups.length) return;
  [groups[g], groups[to]] = [groups[to], groups[g]];
  transaction(() => { s.bricks = groups.flat(); });
}

// removing a host removes its attachments with it
export function unsnap(key) {
  const s = state(), b = brick(key);
  if (!b) return;
  const gone = new Set([key, ...s.bricks.filter((x) => BRICKS[x.key].attach?.brick === key).map((x) => x.key)]);
  const def = BRICKS[key];
  transaction(() => {
    if (def.attach) { const w = widget(nodeFor(def.attach.brick, def.attach.brick), def.attach.widget); if (w) { w.value = def.attach.off; w.callback?.(w.value); } }
    for (const id of Object.values(b.nodes)) { const n = node(id); if (n) app.graph.remove(n); }
    s.bricks = s.bricks.filter((x) => !gone.has(x.key));
    s.bindings = s.bindings.filter((x) => !gone.has(x.to) && !gone.has(x.from));
  });
  app.canvas.setDirty(true, true);
}

// a binding is overridden when its target input is now fed by something else (or nothing)
export function overrides() {
  const s = state();
  if (!s.bindings.length) return [];
  const out = [];
  for (const b of s.bindings) {
    if (b.target == null) continue;
    const dst = node(b.target), slot = dst?.findInputSlot(b.input);
    if (slot == null || slot < 0) continue;
    const link = app.graph.getLink(dst.inputs[slot].link);
    if (!link) out.push({ ...b, change: "removed" });
    else if (String(link.origin_id) !== String(b.origin)) out.push({ ...b, change: "rewired", now: { node: String(link.origin_id), slot: link.origin_slot } });
  }
  return out;
}

// director's notes, pinned to a brick or (brick null) to the whole recipe; they are part of the work, so they live in
// the recipe record and each change is one undo step. Agents answer (status "answered" + reply); the person closes.
export const notes = () => state().notes ?? [];
export function addNote(text, brickKey = null) {
  const note = { id: `n${Date.now().toString(36)}`, brick: brickKey, text, status: "open", created: Date.now() };
  transaction(() => { const s = record(); s.notes = [...(s.notes ?? []), note]; });
  return note;
}
export function updateNote(id, changes) {
  const s = state();
  if (!notes().some((n) => n.id === id)) throw new Error(`No note ${id}`);
  transaction(() => { s.notes = s.notes.map((n) => (n.id === id ? { ...n, ...changes } : n)); });
  return s.notes.find((n) => n.id === id);
}

// settings that point at nothing installed (a model file, an image), per brick node; what the readiness badge shows
export function missing() {
  const out = [];
  for (const b of state().bricks) for (const id of Object.values(b.nodes)) {
    const n = node(id);
    for (const w of n?.widgets ?? []) if (Array.isArray(w.options?.values) && !w.options.values.includes(w.value)) out.push({ brick: b.key, node: n.title, setting: w.name, value: w.value ?? null });
  }
  return out;
}

// App mode's run-only view built from the bricks' faces (frontend 1.57 `extra.linearData`; WidgetId =
// "<rootGraphId>:<nodeId>:<widget>"), so a finished recipe opens as a clean app anywhere without this extension
export function appData() {
  const inputs = [], outputs = [];
  for (const b of state().bricks) {
    const def = BRICKS[b.key];
    for (const [nodeKey, name, label] of def.face ?? []) {
      const id = b.nodes[nodeKey];
      if (widget(node(id), name)) inputs.push([`${app.graph.id}:${id}:${name}`, name, { description: `${def.title} · ${label}` }]);
    }
    if (def.blueprint) outputs.push(b.nodes[b.key]);
  }
  return { inputs, outputs };
}

export function describe() {
  const s = state();
  return s.bricks.map((b) => ({
    brick: b.key, title: BRICKS[b.key].title, nodes: b.nodes,
    bindings: s.bindings.filter((x) => x.to === b.key).map(({ role, from, output, rule, value }) => ({ role, from, output, rule, value })),
  }));
}
