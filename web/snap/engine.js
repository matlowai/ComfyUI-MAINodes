// Snap engine: turns bricks into real graph nodes and links, records every binding (and which rule made it) in
// graph.extra.snap, and finds user overrides by diffing the live links against that record.
// Only node ids are kept: undo/redo reloads the graph and replaces every node object (frontend 1.57.1).
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { BRICKS } from "./bricks.js";

const GAP = 80;

export function state() {
  const extra = (app.graph.extra ??= {});
  return (extra.snap ??= { version: 1, bricks: [], bindings: [] });
}

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

export function nodeFor(brickKey, nodeKey) {
  const b = state().bricks.find((x) => x.key === brickKey);
  return b && node(b.nodes[nodeKey]);
}

export function setValue(brickKey, nodeKey, name, value) {
  const n = nodeFor(brickKey, nodeKey), w = widget(n, name);
  if (!w) throw new Error(`${brickKey}: no setting "${name}"`);
  transaction(() => { w.value = value; w.callback?.(value); });
  app.canvas.setDirty(true, true);
}

export function getValue(brickKey, nodeKey, name) {
  return widget(nodeFor(brickKey, nodeKey), name)?.value;
}

function column(key) {
  const order = ["models", "preset", "rack", "first_frame", "refs", "render", "upscale"];
  const i = order.indexOf(key);
  return { models: 0, preset: 0, rack: 1, first_frame: 1, refs: 1, render: 2 }[key] ?? Math.max(i, 0);
}

// pack rule first (role names match), then a unique type match from the nearest brick upstream
function resolve(toBrick, role, [toKey, inputName]) {
  const s = state();
  const dst = node(s.bricks.find((b) => b.key === toBrick).nodes[toKey]);
  const slot = dst?.findInputSlot(inputName);
  if (!dst || slot < 0) return null;
  const order = s.bricks.map((b) => b.key);
  const upstream = order.slice(0, order.indexOf(toBrick)).reverse().concat(order.slice(order.indexOf(toBrick) + 1));
  for (const key of upstream) {
    const out = BRICKS[key].provides?.[role];
    if (out) return { from: key, out, rule: `pack:${key}.${role}` };
  }
  const type = dst.inputs[slot].type;
  for (const key of upstream) {
    const hits = Object.entries(BRICKS[key].provides ?? {}).filter(([, [nk, o]]) => {
      const src = node(s.bricks.find((b) => b.key === key).nodes[nk]);
      return src?.outputs[src.findOutputSlot(o)]?.type === type;
    });
    if (hits.length === 1) return { from: key, out: hits[0][1], rule: `inferred:${type}` };
  }
  return null;
}

// (re)bind every brick input that has a provider; returns the bindings made
function bindAll() {
  const s = state(), made = [];
  for (const b of s.bricks) {
    for (const [role, target] of Object.entries(BRICKS[b.key].needs ?? {})) {
      const existing = s.bindings.find((x) => x.to === b.key && x.role === role);
      if (existing?.override) continue;
      const r = resolve(b.key, role, target);
      if (!r) continue;
      const src = node(s.bricks.find((x) => x.key === r.from).nodes[r.out[0]]);
      const dst = node(b.nodes[target[0]]);
      const o = src.findOutputSlot(r.out[1]), i = dst.findInputSlot(target[1]);
      if (dst.inputs[i].link != null) {
        if (!existing) continue; // wired by hand: leave it
        const l = app.graph.getLink(dst.inputs[i].link);
        if (l && l.origin_id === src.id && l.origin_slot === o) continue;
      }
      const link = src.connect(o, dst, i);
      if (!link) continue;
      const binding = { to: b.key, role, input: target[1], from: r.from, output: r.out[1], rule: r.rule, link: link.id, origin: src.id, target: dst.id };
      s.bindings = s.bindings.filter((x) => !(x.to === b.key && x.role === role));
      s.bindings.push(binding);
      made.push(binding);
    }
  }
  return made;
}

export async function snap(key, { values, at } = {}) {
  const def = BRICKS[key], s = state();
  if (s.bricks.some((b) => b.key === key)) return { brick: key, bindings: [] };
  if (def.attach) {
    const host = s.bricks.find((b) => b.key === def.attach.brick);
    if (!host) throw new Error(`${def.title} snaps onto ${BRICKS[def.attach.brick].title}; add that first`);
    s.bricks.splice(at ?? s.bricks.length, 0, { key, nodes: {} });
    setValue(def.attach.brick, def.attach.brick, def.attach.widget, def.attach.on);
    return { brick: key, bindings: [{ to: def.attach.brick, role: def.attach.widget, rule: `pack:${key}.attach`, value: def.attach.on }] };
  }
  // graph layout: columns by role, each starting right of the widest node to its left, stacked below its column
  const nodesIn = (test) => s.bricks.filter((b) => test(column(b.key))).flatMap((b) => Object.values(b.nodes)).map(node).filter(Boolean);
  const left = nodesIn((c) => c < column(key));
  const x = left.length ? Math.max(...left.map((n) => n.pos[0] + n.size[0])) + GAP : 0;
  const below = nodesIn((c) => c === column(key));
  const y = below.length ? Math.max(...below.map((n) => n.pos[1] + n.size[1])) + 80 : 0;
  const bp = def.blueprint ? await fetchBlueprint(def.blueprint) : null;
  const bindings = transaction(() => {
    const ids = {};
    const blueprintNode = bp && insertBlueprint(bp, [x, y]);
    if (blueprintNode) {
      ids[key] = blueprintNode.id;
      blueprintNode.properties.snap = { brick: key, version: 1 };
    }
    let dy = 0;
    for (const spec of def.nodes ?? []) {
      const n = LiteGraph.createNode(spec.type);
      if (!n) throw new Error(`Node type ${spec.type} is not installed`);
      n.pos = [x, y + dy];
      if (spec.title) n.title = spec.title;
      n.properties.snap = { brick: key, version: 1 };
      app.graph.add(n);
      for (const [name, v] of Object.entries({ ...spec.values, ...values?.[spec.key] })) {
        const w = widget(n, name);
        if (w && (!w.options?.values || w.options.values.includes(v))) w.value = v;
      }
      ids[spec.key] = n.id;
      dy += (n.size?.[1] ?? 120) + 40;
    }
    const placed = Object.fromEntries(Object.values(ids).map((id) => [id, [...node(id).pos]]));
    s.bricks.splice(at ?? s.bricks.length, 0, { key, nodes: ids, placed });
    return bindAll();
  });
  app.canvas.setDirty(true, true);
  return { brick: key, bindings };
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

// reading order only: pack rules bind by role, so reordering never rewires
export function move(key, index) {
  const s = state(), i = s.bricks.findIndex((b) => b.key === key);
  if (i < 0) return;
  transaction(() => { const [b] = s.bricks.splice(i, 1); s.bricks.splice(index, 0, b); });
}

export function unsnap(key) {
  const s = state(), b = s.bricks.find((x) => x.key === key);
  if (!b) return;
  const def = BRICKS[key];
  transaction(() => {
    if (def.attach) setValue(def.attach.brick, def.attach.brick, def.attach.widget, def.attach.off);
    for (const id of Object.values(b.nodes)) { const n = node(id); if (n) app.graph.remove(n); }
    s.bricks = s.bricks.filter((x) => x.key !== key);
    s.bindings = s.bindings.filter((x) => x.to !== key && x.from !== key);
  });
  app.canvas.setDirty(true, true);
}

// a binding is overridden when its target input is now fed by something else (or nothing)
export function overrides(workflow = app.graph.serialize()) {
  // node ids are strings on nodes but numbers in serialized links
  const feeds = new Map(workflow.links.map(([id, from, fromSlot, to, toSlot]) => [`${to}:${toSlot}`, { id, from: String(from), fromSlot }]));
  const out = [];
  for (const b of state().bindings) {
    if (b.target == null) continue;
    const dst = node(b.target);
    const slot = dst?.findInputSlot(b.input);
    if (slot == null || slot < 0) continue;
    const now = feeds.get(`${b.target}:${slot}`);
    if (!now) out.push({ ...b, change: "removed" });
    else if (now.from !== String(b.origin)) out.push({ ...b, change: "rewired", now: { node: now.from, slot: now.fromSlot } });
  }
  return out;
}

export function describe() {
  const s = state();
  return s.bricks.map((b) => ({
    brick: b.key, title: BRICKS[b.key].title, nodes: b.nodes,
    bindings: s.bindings.filter((x) => x.to === b.key).map(({ role, from, output, rule, value }) => ({ role, from, output, rule, value })),
  }));
}
