// Snap engine: turns bricks into real graph nodes and links, records every binding (and which rule made it) in
// graph.extra.snap, and finds user overrides by diffing the live links against that record.
// Only node ids are kept: undo/redo reloads the graph and replaces every node object (frontend 1.57.1).
// SNAP-R2 graph round-trip · SNAP-R3 unresolved stays missing · SNAP-R19 no view DOM here · SNAP-R30 a recipe opens runnable ·
// see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { BRICKS, RENDER_BLUEPRINT, SIMPLE_RECIPE } from "./bricks.js";

const GAP = 80;
const COLUMN = { models: 0, preset: 0, image_models: 0, loras: 0, style: 0, cast: 0, rack: 1, first_frame: 1, refs: 1, render: 2, image: 2, upscale: 3, image_upscale: 3, image_resize: 3, save_video: 4, save_image: 4 };
const column = (key) => (Object.hasOwn(COLUMN, key) ? COLUMN[key] : key.startsWith("node:") ? 3 : 0); // any-node bricks go right of the render
const EMPTY = Object.freeze({ version: 1, bricks: Object.freeze([]), bindings: Object.freeze([]) });

// the recipe record; reading never writes it, so a workflow that never used Snap stays untouched
export const state = () => app.graph.extra?.snap ?? EMPTY;
const record = () => ((app.graph.extra ??= {}).snap ??= { version: 1, bricks: [], bindings: [] });

// one undo step for a batch of edits (the same pair the node library's paste path emits); pairs nest, so callers can
// group several engine edits into one step with `batch`
export const batch = (fn) => transaction(fn);
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

// every node inside a blueprint node (nested ones too)
const inner = (n) => (n?.subgraph?.nodes ?? []).flatMap((x) => [x, ...inner(x)]);

export function nodeFor(brickKey, nodeKey) {
  const b = brick(brickKey);
  return b && node(b.nodes[nodeKey]);
}

// a value as this machine has it: the exact choice, else the one choice with the same file name in another sub-folder
// (recipes and presets name plain files; this machine may keep them in h3/); undefined when no choice fits
export function resolveChoice(values, value) {
  if (!Array.isArray(values) || values.includes(value) || typeof value !== "string") return value;
  const base = (f) => String(f).replace(/\\/g, "/").split("/").pop();
  const hits = values.filter((v) => base(v) === base(value));
  return hits.length === 1 ? hits[0] : undefined;
}
// how Snap writes every setting: a choice that isn't installed is kept as the wanted value, so it shows as missing
// (and fails validation) instead of a default quietly standing in for it
function put(w, v) {
  w.value = resolveChoice(w.options?.values, v) ?? v;
  w.callback?.(w.value);
}

// a brick that starts off (`off`: First frame, until it has a picture) turns on when its face's first value is given
const givesFace = (key, nodeKey, values) => { const [k, name] = BRICKS[key]?.off ? BRICKS[key].face[0] : []; return k === nodeKey && values?.[name] != null; };
// a LoRA stack whose rows name no file (no LoRAs installed yet) fails core's validation even with every row off, so it
// stays off until a row gets a file (SNAP-R30: a recipe opens runnable)
const noFile = (n) => { const names = (n.widgets ?? []).filter((w) => w.name.endsWith(".lora_name")); return names.length > 0 && names.every((w) => w.value == null); };
const givesFile = (key, values) => !!BRICKS[key]?.stack && Object.entries(values).some(([name, v]) => name.endsWith(".lora_name") && v != null);

// several settings on one brick node as one undo step
export function setValues(brickKey, nodeKey, values) {
  const n = nodeFor(brickKey, nodeKey);
  const ws = Object.keys(values).map((name) => widget(n, name) ?? (() => { throw new Error(`${brickKey}: no setting "${name}"`); })());
  transaction(() => {
    for (const w of ws) put(w, values[w.name]);
    if (givesFace(brickKey, nodeKey, values) || givesFile(brickKey, values)) for (const id of Object.values(brick(brickKey).nodes)) if (node(id)) node(id).mode = 0;
  });
  app.canvas.setDirty(true, true);
}

export const setValue = (brickKey, nodeKey, name, value) => setValues(brickKey, nodeKey, { [name]: value });

// a video length as frames and seconds (U72 F7): the recipe's own fps (the first fps setting inside the brick, the H3
// Render's Create Video) and the length setting's grid (min + n × step: H3 takes 17n + 5 frames). Null when the brick
// has no length face or no fps
export function timing(key) {
  const f = BRICKS[key]?.face?.find((x) => x[3]?.frames), w = f && widget(nodeFor(key, f[0]), f[1]);
  if (!w) return null;
  const all = (n) => [n, ...(n.subgraph?.nodes ?? []).flatMap(all)];
  const fps = Object.values(brick(key).nodes).map(node).filter(Boolean).flatMap(all).map((n) => widget(n, "fps")?.value).find((v) => typeof v === "number");
  return fps ? { node: f[0], name: f[1], fps, min: w.options?.min ?? 1, step: w.options?.step2 ?? 1 } : null;
}
export const seconds = (t, frames) => Math.round((frames / t.fps) * 100) / 100;
// "5s" / "5 s" / "5 seconds" -> the nearest frame count on the grid; null when the text isn't a length in seconds
export function framesFor(t, text) {
  const s = Number(String(text).match(/^\s*(\d+(?:\.\d+)?)\s*s(?:ec(?:ond)?s?)?\s*$/i)?.[1]);
  return s > 0 ? t.min + Math.max(0, Math.round((s * t.fps - t.min) / t.step)) * t.step : null;
}

export function getValue(brickKey, nodeKey, name) {
  return widget(nodeFor(brickKey, nodeKey), name)?.value;
}

// a text setting still holding the text its blueprint ships with (run notes a prompt nobody wrote, U72 F11)
export async function shipped(brickKey, nodeKey, name) {
  const v = getValue(brickKey, nodeKey, name), def = BRICKS[brickKey];
  if (!def?.blueprint || typeof v !== "string") return false;
  const bp = await fetchBlueprint(def.blueprint);
  return [...bp.nodes, ...(bp.definitions?.subgraphs ?? []).flatMap((g) => g.nodes)].some((n) => Array.isArray(n.widgets_values) && n.widgets_values.includes(v));
}

// the node of brick `key` that provides output `[nodeKey, slotName]`, if the user hasn't deleted it
function provider(key, [nodeKey, out]) {
  const src = nodeFor(key, nodeKey), o = src?.findOutputSlot(out);
  return src && o >= 0 ? { src, o } : null;
}

// remembered picks (rules.js loads them; the engine only reads them): an ask whose answer is on record binds itself
let remembered = [];
export const useRules = (list) => { remembered = list; };
// a candidate as a rule sees it: the node type behind it, the role its brick gives it, and that node's title
function fingerprint(c) {
  const n = provider(c.from, [c.nodeKey, c.output])?.src;
  return n ? `${n.type}|${c.via}|${n.title}` : null;
}

// is `target` already upstream of `from` (following links)? then linking from -> target would close a loop
function feeds(target, from) {
  const seen = new Set(), todo = [from];
  while (todo.length) {
    const n = todo.pop();
    if (String(n.id) === String(target.id)) return true;
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    for (const i of n.inputs ?? []) { const l = app.graph.getLink(i.link); const up = l && node(l.origin_id); if (up) todo.push(up); }
  }
  return false;
}

// pack rule first (role names match), then, for any-node bricks only (our own bricks bind by their curated rules), a
// type match from the nearest brick that has one: a single match binds, several make an `ask` (the person picks)
function resolve(toBrick, role, type, downstream) {
  const order = state().bricks.map((b) => b.key), at = order.indexOf(toBrick);
  const upstream = order.slice(0, at).reverse().concat(downstream ? order.slice(at + 1) : []);
  const fits = (p) => !toBrick.startsWith("node:") || [p.src.outputs[p.o].type, "*"].includes(type) || type === "*"; // our bricks' rules are curated
  // an any-node brick that takes and gives the same type (a model patch such as skip-layer guidance) sits in that chain:
  // the nearest one feeds the next input of that type, whatever its output is called
  const patch = (key) => {
    if (!key.startsWith("node:")) return null;
    const def = BRICKS[key], takes = Object.values(def.needs ?? {}).some(([k, name]) => nodeFor(key, k)?.inputs?.find((i) => i.name === name)?.type === type);
    const gives = Object.values(def.provides ?? {}).filter((out) => provider(key, out)?.src.outputs[provider(key, out).o].type === type);
    return takes && gives.length === 1 ? gives[0] : null;
  };
  for (const key of upstream) {
    const through = order.indexOf(key) < at && patch(key); // only from upstream: a later patch never feeds back
    if (through) return { from: key, out: through, rule: `patch:${type}` };
    const out = BRICKS[key].provides?.[role], p = out && provider(key, out);
    if (p && fits(p)) return { from: key, out, rule: `pack:${key}.${role}` };
  }
  if (!toBrick.startsWith("node:")) return null;
  for (const key of upstream) {
    const hits = Object.entries(BRICKS[key].provides ?? {}).filter(([, out]) => {
      const p = provider(key, out);
      return p && p.src.outputs[p.o].type === type;
    });
    if (hits.length === 1) return { from: key, out: hits[0][1], rule: `inferred:${type}` };
    // candidates are named by the role their brick gives them (two outputs can both be called "VAE")
    if (hits.length > 1) return { ask: hits.map(([via, out]) => ({ from: key, via, output: out[1], nodeKey: out[0] })) };
  }
  return null;
}

// (re)bind every brick input that has a provider; inputs the user rewired or cleared in the graph are left alone.
// Two passes: providers earlier in the recipe first (it reads top to bottom, like the flow), then later ones.
function bindAll() {
  const s = record(), made = [];
  for (const downstream of [false, true]) for (const b of s.bricks) {
    for (const [role, [nodeKey, inputName]] of Object.entries(BRICKS[b.key].needs ?? {})) {
      const dst = node(b.nodes[nodeKey]), i = dst?.findInputSlot(inputName);
      if (!dst || i < 0) continue;
      const existing = s.bindings.find((x) => x.to === b.key && x.role === role);
      const link = app.graph.getLink(dst.inputs[i].link);
      if (existing?.rule === "ask" && link) { s.bindings = s.bindings.filter((x) => x !== existing); continue; } // answered by hand in the graph
      if (existing ? existing.rule !== "ask" && String(link?.origin_id) !== String(existing.origin) : link) continue; // the user's wiring wins
      if (existing?.rule === "chosen") continue; // the person picked this one: it stays while its wire does
      if (downstream && link) continue; // pass 2 only fills what pass 1 left empty
      const r = resolve(b.key, role, dst.inputs[i].type, downstream);
      const ask = r?.ask?.filter((c) => !feeds(dst, provider(c.from, [c.nodeKey, c.output]).src)); // no candidate may close a loop
      if (existing?.rule === "ask") s.bindings = s.bindings.filter((x) => x !== existing); // an ask is rebuilt every time
      const rule = ask?.length > 1 && remembered.find((x) => x.to === dst.type && x.input === inputName);
      const known = rule && ask.filter((c) => fingerprint(c) === rule.pick);
      if (known?.length === 1) Object.assign(r, { ask: null, from: known[0].from, out: [known[0].nodeKey, known[0].output], via: known[0].via, rule: "remembered" });
      else if (ask?.length > 1) { s.bindings.push({ to: b.key, role, input: inputName, rule: "ask", candidates: ask, target: dst.id }); continue; }
      if (!r || (r.ask && !ask?.length)) continue;
      if (r.ask) Object.assign(r, { from: ask[0].from, out: [ask[0].nodeKey, ask[0].output], rule: `inferred:${dst.inputs[i].type}` }); // only one candidate is loop-free
      const { src, o } = provider(r.from, r.out);
      if (link && link.origin_id === src.id && link.origin_slot === o) continue;
      if (feeds(dst, src)) continue; // dst already feeds src: binding src -> dst would make a loop
      if (!src.connect(o, dst, i)) continue;
      const binding = { to: b.key, role, input: inputName, from: r.from, output: r.out[1], rule: r.rule, ...(r.via ? { via: r.via } : {}), origin: src.id, target: dst.id };
      s.bindings = s.bindings.filter((x) => x !== existing);
      s.bindings.push(binding);
      made.push(binding);
    }
  }
  return made;
}

// snaps of the same brick share one call: a double click or an agent racing the user inserts it once
const inflight = new Map();
export function snap(key, options) {
  if (key.startsWith("node:") && !key.includes("#")) { // a new instance of any node: node:<Type>#<n>
    let n = 1;
    while (brick(`${key}#${n}`) || inflight.has(`${key}#${n}`)) n++;
    key = `${key}#${n}`;
  }
  if (!BRICKS[key]) return Promise.reject(new Error(`No brick or installed node "${key.replace(/^node:/, "").split("#")[0]}"`));
  if (!inflight.has(key)) inflight.set(key, snapOnce(key, options).finally(() => inflight.delete(key)));
  return inflight.get(key);
}

async function snapOnce(key, { values, at } = {}) {
  const def = BRICKS[key];
  const bp = def.blueprint && !brick(key) ? await fetchBlueprint(def.blueprint) : null;
  if (brick(key)) return { brick: key, bindings: [] }; // read after the fetch: the graph may have changed meanwhile
  if (def.needs?.video && legacy()) throw new Error(`${def.title} needs the Render to give its video: this workflow has the older H3 Render, with Save and RelayVSR inside it. Upgrade it first (upgrade_render)`);
  const s = record();
  // graph layout: columns by role, each starting right of the widest node to its left, stacked below its column
  const nodesIn = (test) => s.bricks.filter((b) => test(column(b.key))).flatMap((b) => Object.values(b.nodes)).map(node).filter(Boolean);
  const left = nodesIn((c) => c < column(key)), below = nodesIn((c) => c === column(key));
  const x = left.length ? Math.max(...left.map((n) => n.pos[0] + n.size[0])) + GAP : 0;
  const y = below.length ? Math.max(...below.map((n) => n.pos[1] + n.size[1])) + 80 : 0;
  const bindings = transaction(() => {
    const ids = {};
    if (bp) { // a blueprint saved against another core version may hold a choice that moved: resolve it, else it shows as missing
      const outer = insertBlueprint(bp, [x, y]);
      ids[key] = outer.id;
      for (const n of inner(outer)) for (const w of n.widgets ?? []) if (Array.isArray(w.options?.values) && !w.options.values.includes(w.value)) put(w, w.value);
    }
    let dy = 0;
    for (const spec of def.nodes ?? []) {
      const n = LiteGraph.createNode(spec.type);
      if (!n) throw new Error(`Node type ${spec.type} is not installed`);
      n.pos = [x, y + dy];
      if (spec.title) n.title = spec.title;
      app.graph.add(n);
      for (const [name, v] of Object.entries({ ...spec.values, ...values?.[spec.key] })) { const w = widget(n, name); if (w) put(w, v); }
      ids[spec.key] = n.id;
      dy += (n.size?.[1] ?? 120) + 40;
    }
    if (def.off && !(def.nodes ?? []).some((spec) => givesFace(key, spec.key, { ...spec.values, ...values?.[spec.key] }))) for (const id of Object.values(ids)) node(id).mode = 4; // runs nothing until given
    if (def.stack && noFile(node(ids[def.stack.node]))) node(ids[def.stack.node]).mode = 4;
    for (const [a, out, b, inp] of def.links ?? []) node(ids[a]).connect(node(ids[a]).findOutputSlot(out), node(ids[b]), node(ids[b]).findInputSlot(inp)); // a brick's own inner wiring
    const placed = Object.fromEntries(Object.values(ids).map((id) => [id, [...node(id).pos]]));
    s.bricks.splice(at ?? s.bricks.length, 0, { key, nodes: ids, placed });
    return bindAll();
  });
  app.canvas.setDirty(true, true);
  return { brick: key, bindings };
}

// the recommended recipe on the open graph (Start, and a scene's first shot); an older served blueprint saves its own video.
// An optional brick whose own check fails here (Upscale without RelayVSR's weights) starts off, so the recipe runs as
// opened (SNAP-R30); the brick keeps its settings and says why on its face
let checkBrick = async () => null;
export const useCheck = (fn) => { checkBrick = fn; }; // models.js asks the server (injected: models.js imports this module)
export async function simple() {
  for (const key of SIMPLE_RECIPE) if (!(BRICKS[key].needs?.video && legacy())) await snap(key);
  for (const key of SIMPLE_RECIPE) if (BRICKS[key].optional && BRICKS[key].check && brick(key) && (await checkBrick(key))?.ready === false) batch(() => { for (const id of Object.values(brick(key).nodes)) node(id).mode = 4; });
}

// a Render made from the older H3 blueprint (before U20): Save and the RelayVSR switch live inside it and it gives no
// VIDEO. It runs as saved; upgrade() puts the current blueprint in its place with Upscale and Save as bricks after it
export function legacy() {
  const n = nodeFor("render", "render");
  if (!n?.isSubgraphNode?.() || n.outputs?.some((o) => o.type === "VIDEO")) return null;
  return { node: n.id, upscale: widget(n, "upscale")?.value ?? null };
}
const valuesOf = (n) => Object.fromEntries((n?.widgets ?? []).filter((w) => w.name && typeof w.value !== "object").map((w) => [w.name, w.value]));
// one undo step: the current blueprint takes the old Render's place, wires and settings (its inner nodes' too: the
// blueprint keeps their ids), then Upscale with the old RelayVSR settings (on when the old switch was) and Save with
// the old Save's settings
export async function upgrade() {
  const was = legacy();
  if (!was) throw new Error("This Render is already the current blueprint");
  const old = node(was.node), bp = await fetchBlueprint(RENDER_BLUEPRINT), olds = inner(old);
  if (!bp.nodes[0].outputs?.some((o) => o.type === "VIDEO")) throw new Error("This ComfyUI still serves the older H3 blueprint (it keeps blueprints from its start): restart it, then upgrade");
  const kept = (type) => valuesOf(olds.find((x) => x.type === type));
  const relay = { settings: kept("RelayVSRModelSettings"), upscale: kept("RelayVSRUpscaleVideo") }, save = { save: kept("SaveVideo") };
  const on = was.upscale === "RelayVSR 2x", upscale = on || !!brick("upscale");
  app.canvas.emitBeforeChange();
  try {
    transaction(() => {
      const fresh = insertBlueprint(bp, [...old.pos]), byId = new Map(olds.map((x) => [x.id, x]));
      for (const w of fresh.widgets ?? []) { const v = widget(old, w.name); if (v) put(w, v.value); }
      for (const x of inner(fresh)) { const o = byId.get(x.id); if (o?.type === x.type) for (const w of x.widgets ?? []) { const v = widget(o, w.name); if (v) put(w, v.value); } }
      for (const input of old.inputs ?? []) { const l = app.graph.getLink(input.link), i = fresh.findInputSlot(input.name); if (l && i >= 0) node(l.origin_id).connect(l.origin_slot, fresh, i); }
      const s = record(), b = brick("render");
      s.bindings = s.bindings.map((x) => (String(x.target) === String(old.id) ? { ...x, target: fresh.id } : x));
      b.nodes = { render: fresh.id };
      b.placed = { [fresh.id]: [...fresh.pos] };
      app.graph.remove(old);
      s.bricks = s.bricks.filter((x) => x.key !== "upscale"); // the old switch brick: no nodes of its own
    });
    const at = () => state().bricks.findIndex((b) => b.key === "render") + 1;
    if (upscale) {
      await snap("upscale", { values: relay, at: at() });
      if (!on) transaction(() => { for (const id of Object.values(brick("upscale").nodes)) node(id).mode = 4; });
    }
    await snap("save_video", { values: save, at: at() + (upscale ? 1 : 0) });
  } finally { app.canvas.emitAfterChange(); }
  app.canvas.setDirty(true, true);
  return { render: brick("render").nodes.render, upscale: upscale ? (on ? "on" : "off") : null, save: brick("save_video").nodes.save };
}

// answer an `ask`: bind `role` on brick `to` from one of its candidates; returns the rule to remember for next time
export function choose(to, role, from, via) {
  const s = state(), ask = s.bindings.find((x) => x.to === to && x.role === role && x.rule === "ask");
  const pick = ask?.candidates.find((c) => c.from === from && c.via === via);
  if (!pick) throw new Error(`${to}.${role} has no open choice ${from}.${via}`);
  const p = provider(from, [pick.nodeKey, pick.output]), dst = node(ask.target);
  if (!p || !dst) throw new Error(`${from} or ${to} is no longer in the graph`);
  const { src, o } = p, output = pick.output, i = dst.findInputSlot(ask.input);
  transaction(() => {
    if (!src.connect(o, dst, i)) throw new Error(`Couldn't connect ${from}.${via} to ${to}.${role}`);
    s.bindings = s.bindings.map((x) => (x === ask ? { to, role, input: ask.input, from, output, via, rule: "chosen", origin: src.id, target: dst.id } : x));
  });
  app.canvas.setDirty(true, true);
  return { to: dst.type, input: ask.input, pick: fingerprint(pick) };
}

// adopt the open workflow (BRAINSTORM O3): known nodes become their pack bricks, the rest any-node bricks, existing
// links become `imported` bindings. Only the recipe record changes; nodes stay where the person put them.
const KNOWN = { MAIRenderPreset: "preset", MAIDialRack: "rack", H3References: "refs" };
const NOTES = new Set(["Note", "MarkdownNote"]);
export function adopt() {
  const s = record(), owned = new Set(s.bricks.flatMap((b) => Object.values(b.nodes).map(String)));
  const order = app.graph.computeExecutionOrder(false, true).filter((n) => !owned.has(String(n.id)) && !NOTES.has(n.type));
  const taken = new Set(s.bricks.map((b) => b.key)), added = [];
  const freeKey = (type) => { let n = 1; while (taken.has(`node:${type}#${n}`)) n++; return `node:${type}#${n}`; };
  for (const n of order) {
    let key = n.isSubgraphNode?.() && n.subgraph?.name === RENDER_BLUEPRINT ? "render" : KNOWN[n.type];
    if (!key || taken.has(key)) key = freeKey(n.type);
    if (!BRICKS[key]) continue; // a node type with no definition (a missing pack): leave it to the graph
    taken.add(key);
    added.push({ key, nodes: { [key.startsWith("node:") ? "node" : key]: n.id }, placed: {} });
  }
  const brickOf = new Map([...s.bricks, ...added].flatMap((b) => Object.values(b.nodes).map((id) => [String(id), b.key])));
  const bindings = [];
  for (const b of added) {
    const dst = node(Object.values(b.nodes)[0]), needs = Object.entries(BRICKS[b.key].needs ?? {});
    for (const [role, [, inputName]] of needs) {
      const link = app.graph.getLink(dst.inputs[dst.findInputSlot(inputName)]?.link), src = link && node(link.origin_id);
      if (!src || !brickOf.has(String(src.id))) continue;
      bindings.push({ to: b.key, role, input: inputName, from: brickOf.get(String(src.id)), output: src.outputs[link.origin_slot].name, rule: "imported", origin: src.id, target: dst.id });
    }
  }
  transaction(() => { s.bricks = [...s.bricks, ...added]; s.bindings = [...s.bindings, ...bindings]; });
  return { bricks: added.map((b) => b.key), bindings: bindings.length };
}

// a picture reference: a LoadImage node owned by the References brick, wired into the next free ref_images slot
// (H3 References takes 9), recorded with its role and reason so the brick can show what each picture is for
export const PICTURE_SLOTS = 9;
export function addPicture(file, { role, reason, source, card }) {
  const b = brick("refs");
  if (!b) throw new Error("Add the References brick first");
  let pictures = b.pictures ?? [];
  if (pictures.some((p) => p.file === file)) return pictures.find((p) => p.file === file);
  const same = source && pictures.find((p) => p.source === source && p.role === role);
  const w = same && widget(node(same.node), "image");
  if (w) { // the same set's picture for the same role: swap the file on its LoadImage, keep its slot
    return transaction(() => {
      if (!w.options.values.includes(file)) w.options.values.push(file);
      w.value = file; w.callback?.(file);
      b.pictures = pictures.map((p) => (p === same ? { ...p, file, reason, card } : p));
      return b.pictures.find((p) => p.node === same.node);
    });
  }
  if (same) pictures = b.pictures = pictures.filter((p) => p !== same); // its LoadImage was deleted in the graph: make a new one
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
    const picture = { node: n.id, file, role, reason, ...(source ? { source, card } : {}) };
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

// reading order only: pack rules bind by role, so reordering never rewires; `index` counts the list without the moved
// brick (what a drag reports)
export function move(key, index) {
  const s = state(), i = s.bricks.findIndex((b) => b.key === key);
  if (i < 0) return;
  transaction(() => { s.bricks.splice(index, 0, ...s.bricks.splice(i, 1)); });
}

// keyboard reorder: move a brick past its neighbour above or below
export function nudge(key, dir) {
  const s = state(), i = s.bricks.findIndex((b) => b.key === key), to = i + dir;
  if (i < 0 || to < 0 || to >= s.bricks.length) return;
  transaction(() => { const list = [...s.bricks]; [list[i], list[to]] = [list[to], list[i]]; s.bricks = list; });
}

// what the removed brick fed binds by Snap's rules again (Save after a removed Upscale takes the Render's video), an
// input the person wired by hand from it too: the wire went with the brick, the person didn't clear it
export function unsnap(key) {
  const s = state(), b = brick(key);
  if (!b) return;
  const ids = new Set(Object.values(b.nodes).map(String));
  const fedByHand = (x) => { const dst = node(x.target), l = dst && app.graph.getLink(dst.inputs[dst.findInputSlot(x.input)]?.link); return !!l && ids.has(String(l.origin_id)); };
  transaction(() => {
    s.bindings = s.bindings.filter((x) => !fedByHand(x));
    for (const id of Object.values(b.nodes)) { const n = node(id); if (n) app.graph.remove(n); }
    s.bricks = s.bricks.filter((x) => x.key !== key);
    s.bindings = s.bindings.filter((x) => x.to !== key && x.from !== key)
      .map((x) => (x.rule === "ask" ? { ...x, candidates: x.candidates.filter((c) => c.from !== key) } : x))
      .filter((x) => x.rule !== "ask" || x.candidates.length > 1);
    bindAll();
  });
  app.canvas.setDirty(true, true);
}

// a binding is overridden when its target input is now fed by something else (or nothing)
export function overrides() {
  const s = state();
  if (!s.bindings.length) return [];
  const out = [];
  for (const b of s.bindings) {
    if (b.target == null || b.rule === "ask") continue;
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
// a field on the recipe's own record (e.g. the setup card it was built from), one undo step
export function tag(field, value) {
  transaction(() => { record()[field] = value; });
}
// a field on one brick's record (e.g. the set text References last put into the prompt), one undo step
export function remember(brickKey, field, value) {
  const b = brick(brickKey);
  if (b) transaction(() => { b[field] = value; });
}

// a new seed on a brick's seed setting (the face field named like `seed`), drawn within its limits; one undo step. A
// brick in seed mode "random" draws one after each run this page queues, as ComfyUI's control_after_generate does;
// "fixed" (the default) keeps it, so takes of one chain differ only by what the person changed
const seedName = (key) => BRICKS[key]?.face?.find(([, name]) => /seed/.test(name));
export function newSeed(key) {
  const [nodeKey, name] = seedName(key) ?? (() => { throw new Error(`${key} has no seed`); })();
  const w = widget(nodeFor(key, nodeKey), name), lo = w.options?.min ?? 0, hi = Math.min(w.options?.max ?? 2 ** 32 - 1, 2 ** 32 - 1);
  setValue(key, nodeKey, name, lo + Math.floor(Math.random() * (hi - lo + 1)));
  return getValue(key, nodeKey, name);
}
export const seedMode = (key) => (seedName(key) ? brick(key)?.seed ?? "fixed" : null);
export function setSeedMode(key, mode) {
  if (!seedName(key)) throw new Error(`${key} has no seed`);
  if (!["fixed", "random"].includes(mode)) throw new Error("A seed mode is fixed or random");
  remember(key, "seed", mode === "random" ? "random" : undefined);
}
api.addEventListener("promptQueued", () => { for (const b of state().bricks) if (b.seed === "random") newSeed(b.key); });

export function updateNote(id, changes) {
  const s = state();
  if (!notes().some((n) => n.id === id)) throw new Error(`No note ${id}`);
  transaction(() => { s.notes = s.notes.map((n) => (n.id === id ? { ...n, ...changes } : n)); });
  return s.notes.find((n) => n.id === id);
}

// nodes in the workflow that no brick owns (notes aside): Run would queue them too, so the view shows them
export function outside() {
  if (!state().bricks.length) return [];
  const owned = new Set(state().bricks.flatMap((b) => Object.values(b.nodes).map(String)));
  return app.graph.nodes.filter((n) => !owned.has(String(n.id)) && !NOTES.has(n.type));
}

// what Run queues: only the recipe's nodes (a blueprint's inner ones as "<outer>:<inner>", as the prompt names them) when
// other nodes share the workflow, else everything (undefined)
export function targets() {
  if (!outside().length) return undefined;
  const ids = (n, at = "") => [`${at}${n.id}`, ...(n.subgraph?.nodes ?? []).flatMap((x) => ids(x, `${at}${n.id}:`))];
  return state().bricks.flatMap((b) => Object.values(b.nodes)).map(node).filter(Boolean).flatMap((n) => ids(n));
}

// settings that point at nothing installed (a model file, an image), on brick nodes and on nodes outside the recipe
// (brick null); what the readiness badge shows. A node that is off (bypassed or muted) loads nothing
export function missing() {
  const out = [];
  const check = (key, n, at = "") => { if ([2, 4].includes(n?.mode)) return; for (const w of n?.widgets ?? []) if (Array.isArray(w.options?.values) && !w.options.values.includes(w.value)) out.push({ brick: key, node: `${at}${n.title}`, setting: w.name, value: w.value ?? null }); };
  for (const b of state().bricks) for (const id of Object.values(b.nodes)) { check(b.key, node(id)); if (![2, 4].includes(node(id)?.mode)) for (const n of inner(node(id))) check(b.key, n, `${node(id).title} › `); }
  for (const n of outside()) check(null, n);
  return out;
}

// the recipe as data (BRAINSTORM R5): bricks in order with every widget value on their nodes, so a recipe card can
// rebuild it; values that point at files keep their names (a machine without them shows them as missing)
export function recipe() {
  return state().bricks.map((b) => ({
    key: b.key.startsWith("node:") ? b.key.split("#")[0] : b.key,
    values: Object.fromEntries(Object.entries(b.nodes).filter(([k]) => !k.startsWith("picture_")).map(([k, id]) => [k,
      Object.fromEntries((node(id)?.widgets ?? []).filter((w) => w.name && !w.name.startsWith("$$") && w.type !== "button" && typeof w.value !== "object").map((w) => [w.name, w.value]))])),
  }));
}

// rebuild a saved recipe: bricks it doesn't have yet are snapped in order, then every saved value is set. The change
// pairs nest, so the whole rebuild (blueprint fetch included) is one undo step
export async function restore(saved) {
  // a card saved before the H3 Render gave its video (U20) ends at the Render or its Upscale: Save comes after them
  if (saved.some((b) => b.key === "render") && !saved.some((b) => b.key === "save_video")) saved = [...saved, { key: "save_video", values: {} }];
  app.canvas.emitBeforeChange();
  try { return await rebuild(saved); } finally { app.canvas.emitAfterChange(); }
}

async function rebuild(saved) {
  const keys = [];
  const had = (key) => (key.startsWith("node:") ? state().bricks.map((x) => x.key).find((k) => k.split("#")[0] === key && !keys.includes(k)) : brick(key) && key);
  for (const [i, { key }] of saved.entries()) { // bricks already in the stack are reused (any-node bricks of a type in order), the rest snapped
    if (BRICKS[key]?.needs?.video && legacy()) { keys.push(null); continue; } // an older Render saves its own video: its note offers the upgrade
    // a new brick goes where the saved recipe has it (before the next brick it lists that is already here), so it binds
    // between its neighbours instead of dangling after the render
    const next = saved.slice(i + 1).map((x) => had(x.key)).find(Boolean), at = next ? state().bricks.findIndex((b) => b.key === next) : undefined;
    keys.push(had(key) || (await snap(key, { at })).brick);
  }
  transaction(() => saved.forEach(({ values }, i) => {
    if (!keys[i]) return;
    for (const [nodeKey, ws] of Object.entries(values)) {
      const n = nodeFor(keys[i], nodeKey);
      for (const [name, v] of Object.entries(ws)) { const w = widget(n, name); if (w) put(w, v); }
    }
  }));
  app.canvas.setDirty(true, true);
  return keys.filter(Boolean);
}

// App mode's run-only view built from the bricks' faces and output nodes (frontend 1.57 `extra.linearData`; WidgetId =
// "<rootGraphId>:<nodeId>:<widget>"), so a finished recipe opens as a clean app anywhere without this extension
export function appData() {
  const inputs = [], outputs = [];
  for (const b of state().bricks) {
    const def = BRICKS[b.key];
    for (const [nodeKey, name, label] of def.face ?? []) {
      const id = b.nodes[nodeKey];
      if (widget(node(id), name)) inputs.push([`${app.graph.id}:${id}:${name}`, name, { description: `${def.title} · ${label}` }]);
    }
    for (const id of Object.values(b.nodes)) if ([node(id), ...inner(node(id))].some((n) => n?.constructor.nodeData?.output_node)) outputs.push(id); // Save, or an older Render with Save inside
  }
  return { inputs, outputs };
}

export function describe() {
  const s = state();
  const open = (x) => x.rule !== "ask" || !node(x.target)?.inputs[node(x.target).findInputSlot(x.input)]?.link; // wired by hand: settled
  return s.bricks.map((b) => ({
    brick: b.key, title: BRICKS[b.key].title, nodes: b.nodes,
    bindings: s.bindings.filter((x) => x.to === b.key && open(x)).map(({ role, from, output, via, rule, value, candidates }) => ({ role, from, output, rule, value, ...(via ? { via } : {}), ...(candidates ? { candidates: candidates.map(({ from, via }) => ({ from, via })) } : {}) })),
  }));
}
