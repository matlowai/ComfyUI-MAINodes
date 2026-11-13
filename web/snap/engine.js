// Snap engine: turns bricks into real graph nodes and links, records every binding (and which rule made it) in
// graph.extra.snap, and finds user overrides by diffing the live links against that record.
// Only node ids are kept: undo/redo reloads the graph and replaces every node object (frontend 1.57.1).
// SNAP-R2 graph round-trip · SNAP-R3 unresolved stays missing · SNAP-R19 no view DOM here · SNAP-R30 a recipe opens runnable ·
// SNAP-R73 audio references, cited <Audio n> · SNAP-R118 pictures move and cites follow · SNAP-R119 missing = gone ·
// SNAP-R280 a made brick is a subgraph · SNAP-R281 an any-node brick's face and title are the person's (setFace, pinWidget,
// setTitle) · SNAP-R282 a recipe entry carries its subgraph's blueprint · SNAP-R283 any installed blueprint is a brick
// (snapBlueprint) · SNAP-R284 grouping is one undo step and never touches pack bricks (group) · see docs/snap/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { live as snapLive } from "./enabled.js";
import { BRICKS, RENDER_BLUEPRINT, IMAGE_BLUEPRINT, SIMPLE_RECIPE, useGraph } from "./bricks.js";

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
// bricks.js reads an any-node brick's entry (its face and title), its live node and the graph's subgraphs through these
useGraph({ entry: (key) => brick(key) ?? null, node: (key) => nodeFor(key, "node") ?? null, subgraph: (type) => app.graph?.subgraphs?.get?.(type) ?? null });

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

// graph layout: columns by role, each starting right of the widest node to its left, stacked below its column
function spot(key) {
  const nodesIn = (test) => state().bricks.filter((b) => test(column(b.key))).flatMap((b) => Object.values(b.nodes)).map(node).filter(Boolean);
  const left = nodesIn((c) => c < column(key)), below = nodesIn((c) => c === column(key));
  return [left.length ? Math.max(...left.map((n) => n.pos[0] + n.size[0])) + GAP : 0, below.length ? Math.max(...below.map((n) => n.pos[1] + n.size[1])) + 80 : 0];
}
// the next free instance key of a node type (node:<Type>#<n>)
const freeKey = (type, taken = new Set(state().bricks.map((b) => b.key))) => { let n = 1; while (taken.has(`node:${type}#${n}`)) n++; return `node:${type}#${n}`; };

// snaps of the same brick share one call: a double click or an agent racing the user inserts it once
const inflight = new Map();
export function snap(key, options) {
  if (key.startsWith("node:") && !key.includes("#")) { // a new instance of any node: node:<Type>#<n>
    let n = 1;
    while (brick(`${key}#${n}`) || inflight.has(`${key}#${n}`)) n++;
    key = `${key}#${n}`;
  }
  if (!BRICKS[key]) return Promise.reject(new Error(`No brick or installed node "${key.replace(/^node:/, "").split("#")[0]}"`));
  // a subgraph type this graph holds (the palette's node list offers it): created bare it would lack its promoted widgets
  // and values, so it is inserted as snapBlueprint inserts a present definition, as another instance of it, saved under
  // the type its other bricks were saved as (SNAP-R280, R282)
  const type = key.slice(5).split("#")[0], sub = key.startsWith("node:") && !brick(key) && app.graph?.subgraphs?.has?.(type);
  const as = sub ? state().bricks.find((b) => b.subgraph && b.key.slice(5).split("#")[0] === type)?.subgraph : undefined;
  if (!inflight.has(key)) inflight.set(key, (sub ? snapBlueprint(instanceOf(type), { ...options, as }) : snapOnce(key, options)).finally(() => inflight.delete(key)));
  return inflight.get(key);
}

async function snapOnce(key, { values, at } = {}) {
  const def = BRICKS[key];
  const bp = def.blueprint && !brick(key) ? await fetchBlueprint(def.blueprint) : null;
  if (brick(key)) return { brick: key, bindings: [] }; // read after the fetch: the graph may have changed meanwhile
  if (def.needs?.video && legacy()) throw new Error(`${def.title} needs the Render to give its video: this workflow has the older H3 Render, with Save and RelayVSR inside it. Upgrade it first (upgrade_render)`);
  const s = record(), [x, y] = spot(key);
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

// ---- bricks a person makes (SNAP-R280..R284): a subgraph, read generically; its face and title kept on its entry

// the person's own blueprints: ComfyUI's Publish subgraph saves each as userdata subgraphs/<name>.json (frontend
// subgraphStore: SubgraphBlueprint.basePath, listed with listUserDataFullInfo), a workflow of one subgraph node and its
// definitions; it is named by its file name, as the frontend names it (getPathDetails)
const YOURS = "subgraphs";
const fileName = (path) => { const f = path.split("/").pop(), dot = f.lastIndexOf("."); return f.toLowerCase().endsWith(".app.json") && f.length > 9 ? f.slice(0, -9) : dot > 0 ? f.slice(0, dot) : f; };
async function yours() {
  const r = await api.fetchApi(`/userdata?dir=${YOURS}&recurse=true&split=false&full_info=true`);
  if (r.status !== 200) return []; // 404: nothing published yet
  return (await r.json()).filter((f) => f.path?.endsWith(".json")).map((f) => ({ id: `${YOURS}/${f.path}`, name: fileName(f.path), source: "yours", pack: null }));
}
// one of them as insertBlueprint takes it, loaded as the frontend loads it (SubgraphBlueprint.load): the definition the
// node names is renamed to the file name, and the workflow's extra is copied onto it
async function loadYours(b) {
  const r = await api.fetchApi(`/userdata/${encodeURIComponent(b.id)}`);
  if (r.status !== 200) throw new Error(`Your blueprint "${b.name}" could not be read (${r.status})`);
  const bp = JSON.parse(await r.text()), outer = bp?.nodes?.[0], sg = (bp?.definitions?.subgraphs ?? []).find((g) => g.id == outer?.type);
  if (bp?.nodes?.length !== 1 || !sg) throw new Error(`Your blueprint "${b.name}" is not one subgraph node with its definition`);
  sg.name = outer.title = b.name;
  if (bp.extra) { sg.extra ??= {}; for (const [k, v] of Object.entries(bp.extra)) if (k !== "workflowRendererVersion") sg.extra[k] = v; }
  return bp;
}
// the blueprints a brick can be made from: the person's own first, then the installed ones (/global_subgraphs; the two
// the pack bricks are made of are those bricks already), each by name. A name in both lists twice; by name, the person's wins
export async function blueprints() {
  const byName = (a, b) => a.name.localeCompare(b.name), [mine, list] = await Promise.all([yours(), api.fetchApi("/global_subgraphs").then((r) => r.json())]);
  return [...mine.sort(byName), ...Object.entries(list).map(([id, v]) => ({ id, name: v.name, source: v.source ?? null, pack: v.info?.node_pack ?? null }))
    .filter((b) => b.name && ![RENDER_BLUEPRINT, IMAGE_BLUEPRINT].includes(b.name)).sort(byName)];
}
// what a blueprint needs, gives and shows, read from its one outer node: link inputs, outputs, promoted widgets (labels)
export function blueprintFace(bp) {
  const outer = bp?.nodes?.[0], def = (bp?.definitions?.subgraphs ?? []).find((g) => g.id === outer?.type);
  const label = (i) => i.label || def?.inputs?.find((x) => x.name === i.name)?.label || i.name;
  return { name: def?.name ?? null, needs: (outer?.inputs ?? []).filter((i) => !i.widget).map((i) => ({ name: i.name, label: label(i), type: i.type })),
    gives: (outer?.outputs ?? []).map((o) => ({ name: o.name, type: o.type })), shows: (outer?.inputs ?? []).filter((i) => i.widget).map((i) => ({ name: i.widget.name ?? i.name, label: label(i) })) };
}
// a blueprint by name: the person's own first, then the installed one; `source` "yours" or "installed" asks for one of
// them (list_blueprints reads each listed one). Pack bricks read only the installed ones (fetchBlueprint)
export async function fetchBlueprintNamed(name, { source } = {}) {
  const mine = source === "installed" ? null : (await yours()).find((b) => b.name === name);
  if (mine) return loadYours(mine);
  if (source === "yours") throw new Error(`You have no published blueprint "${name}"`);
  return fetchBlueprint(name);
}

// a subgraph brick as a blueprint insertBlueprint takes: its outer node (unwired, at 0,0) and its definition with every
// definition nested in it. Null for a brick that isn't a subgraph
function blueprintOf(b) {
  const n = node(b.nodes.node);
  if (!n?.isSubgraphNode?.() || !n.subgraph) return null;
  const all = new Map(), walk = (sg) => { if (!sg || all.has(sg.id)) return; all.set(sg.id, sg); for (const x of sg.nodes ?? []) if (x.isSubgraphNode?.()) walk(x.subgraph); };
  walk(n.subgraph);
  return { nodes: [unwired(n)], definitions: { subgraphs: [...all.values()].map((sg) => JSON.parse(JSON.stringify(sg.asSerialisable()))) } };
}
// a node as the paste path takes it: serialized, unwired, at 0,0
function unwired(n) {
  const outer = JSON.parse(JSON.stringify(n.serialize()));
  outer.pos = [0, 0];
  for (const i of outer.inputs ?? []) i.link = null;
  for (const o of outer.outputs ?? []) o.links = null;
  return outer;
}
// a new instance of a subgraph this graph holds, as the paste path takes it (nodes only, the definition is here): an
// existing instance's outer node (its promoted widgets and values), else the bare type (configure builds its inputs
// from the definition)
function instanceOf(type) {
  const n = app.graph.nodes.find((x) => x.type === type && x.isSubgraphNode?.());
  return { nodes: [n ? unwired(n) : { id: -1, type, pos: [0, 0] }] };
}
// the key a brick is saved under: node:<Type> for any node, where a subgraph keeps the type it was saved as (`subgraph`:
// every insert gives a definition a new id, so the saved key would otherwise change on each rebuild)
const savedKey = (b) => (b.key.startsWith("node:") ? `node:${b.subgraph ?? b.key.slice(5).split("#")[0]}` : b.key);
// one brick as recipe() lists it (SNAP-R282: a subgraph brick carries its blueprint). An identity LoRA stack is a pack
// brick (cast), never an any-node one, so nothing here needs privacy stripping (SNAP-R277 strips it in recipes.js)
export function entryOf(b) {
  if (typeof b === "string") b = brick(b);
  if (!b) return null;
  const out = { key: savedKey(b), values: Object.fromEntries(Object.entries(b.nodes).filter(([k]) => !k.startsWith("picture_")).map(([k, id]) => [k,
    Object.fromEntries((node(id)?.widgets ?? []).filter((w) => w.name && !w.name.startsWith("$$") && w.type !== "button" && typeof w.value !== "object").map((w) => [w.name, w.value]))])) };
  if (!b.key.startsWith("node:")) return out;
  const bp = blueprintOf(b);
  return { ...out, ...(b.face ? { face: JSON.parse(JSON.stringify(b.face)) } : {}), ...(b.title ? { title: b.title } : {}), ...(bp ? { blueprint: bp } : {}) };
}

// a blueprint (or an installed blueprint's name) as a new any-node brick, wired by Snap's rules (SNAP-R283), as one undo
// step. `as` is the subgraph type it was saved under (a recipe entry's key); `reuse` maps a saved type to the one an
// earlier insert of this rebuild made: the paste path gives every pasted definition a new id, so a second brick of the
// same saved subgraph is inserted as an instance of that definition, never as a second copy of it. A definition this graph
// already holds under the blueprint's own id is used the same way (instances of one subgraph share it, as in ComfyUI)
export async function snapBlueprint(bp, { at, title, face, values, as, reuse } = {}) {
  if (typeof bp === "string") bp = await fetchBlueprintNamed(bp);
  const outer = bp?.nodes?.[0];
  if (bp?.nodes?.length !== 1 || !outer?.type) throw new Error("A blueprint is one subgraph node: {nodes: [its instance], definitions: {subgraphs: [its definition, nested ones]}}");
  const from = as ?? outer.type, have = reuse?.get(from) ?? (app.graph.subgraphs?.has?.(outer.type) ? outer.type : null);
  if (!have && !(bp.definitions?.subgraphs ?? []).some((g) => g.id === outer.type)) throw new Error(`This blueprint's definition (${outer.type}) is not in it and not in this graph`);
  const s = record(), [x, y] = spot("node:");
  const out = transaction(() => {
    const n = insertBlueprint(have ? { nodes: [{ ...outer, type: have }] } : bp, [x, y]);
    if (!n) throw new Error("ComfyUI inserted nothing for this blueprint");
    reuse?.set(from, n.type);
    for (const m of inner(n)) for (const w of m.widgets ?? []) if (Array.isArray(w.options?.values) && !w.options.values.includes(w.value)) put(w, w.value); // as snapOnce: a moved choice resolves, else shows missing
    for (const [name, v] of Object.entries(values?.node ?? {})) { const w = widget(n, name); if (w) put(w, v); }
    const key = freeKey(n.type);
    s.bricks.splice(at ?? s.bricks.length, 0, { key, nodes: { node: n.id }, placed: { [n.id]: [...n.pos] }, ...(from !== n.type ? { subgraph: from } : {}) });
    dress(key, { face, title });
    return { brick: key, bindings: bindAll() };
  });
  app.canvas.setDirty(true, true);
  return out;
}
// a kept brick (a Library card's entry, a recipe entry) into the open recipe: a subgraph's blueprint is inserted, any
// other node snapped as node:<Type>; then its values, face and title
export async function snapEntry(entry, { at, reuse } = {}) {
  if (!entry?.key?.startsWith?.("node:")) throw new Error(`A kept brick is an any-node brick (node:<Type>); ${JSON.stringify(entry?.key ?? null)} isn't one`);
  if (entry.blueprint && typeof entry.blueprint === "object") return snapBlueprint(entry.blueprint, { at, values: entry.values, face: entry.face, title: entry.title, as: entry.key.slice(5), reuse });
  const res = await snap(entry.key.split("#")[0], { at, values: entry.values });
  transaction(() => dress(res.brick, entry));
  return res;
}
// a face and title given with a brick: rows whose setting the node lacks are left out (a kept brick from another version
// of a node), never refused after the brick is already in
function dress(key, { face, title } = {}) {
  const b = brick(key);
  if (!b) return;
  if (Array.isArray(face)) { const rows = face.filter(([k, name]) => widget(node(b.nodes[k]), name)).map((r) => [...r]); if (rows.length || !face.length) b.face = rows; }
  if (typeof title === "string" && title.trim()) b.title = title.trim();
}

// SNAP-R281: an any-node brick's face and title. Pack bricks are curated (SNAP-R1) and refused, saying so
function own(key) {
  if (typeof key !== "string" || !key.startsWith("node:")) throw new Error(`${BRICKS[key]?.title ?? key} is a pack brick: its face is curated (SNAP-R1). A face and title of your own are for bricks made from any node or subgraph (node:<Type>#<n>)`);
  const b = brick(key);
  if (!b) throw new Error(`No brick ${key} in this recipe; its bricks: ${state().bricks.map((x) => x.key).join(", ") || "none"}`);
  return b;
}
const settingNames = (n) => (n?.widgets ?? []).filter((w) => w.name && !w.name.startsWith("$$") && w.type !== "button").map((w) => w.name);
function faceRow(key, b, [nodeKey, name, label]) {
  if (!Object.hasOwn(b.nodes, nodeKey)) throw new Error(`${key} has no node "${nodeKey}"; its nodes: ${Object.keys(b.nodes).join(", ")}`);
  const n = node(b.nodes[nodeKey]);
  if (!widget(n, name)) throw new Error(`${BRICKS[key].title} has no setting "${name}"; its settings: ${settingNames(n).join(", ") || "none"}`);
  return label != null && String(label).trim() ? [nodeKey, name, String(label).trim()] : [nodeKey, name];
}
const plainRows = (face) => face.map(([k, name]) => [k, name]);
// the whole face as rows [nodeKey, setting, label?] in order (a bare setting name means the brick's node), or null for the
// default again; a face equal to the default (same rows, no labels) is the default, so no override is kept. One undo step
export function setFace(key, face) {
  const b = own(key);
  if (face != null && !Array.isArray(face)) throw new Error("face is a list of settings ([node, setting, label?] or a setting name), or null for the default");
  const rows = face == null ? null : face.map((f) => faceRow(key, b, Array.isArray(f) ? f : ["node", f]));
  const seen = new Set(), dedup = rows?.filter(([k, name]) => !seen.has(`${k}.${name}`) && seen.add(`${k}.${name}`));
  const def = BRICKS[key].face_default ?? BRICKS[key].face, same = dedup && !dedup.some((r) => r[2]) && JSON.stringify(plainRows(def)) === JSON.stringify(dedup);
  transaction(() => { if (dedup && !same) b.face = dedup; else delete b.face; });
  app.canvas.setDirty(true, true);
  return BRICKS[key].face;
}
// one setting on (at the end, or relabelled in place) or off the face, starting from the face the brick shows now
export function pinWidget(key, nodeKey, name, on, label) {
  const b = own(key), now = b.face ?? plainRows(BRICKS[key].face), at = now.findIndex(([k, n]) => k === nodeKey && n === name);
  if (!on) return at < 0 ? BRICKS[key].face : setFace(key, now.filter((_, i) => i !== at));
  const row = faceRow(key, b, [nodeKey, name, label]);
  if (at >= 0 && row.length < 3) return BRICKS[key].face;
  return setFace(key, at >= 0 ? now.map((r, i) => (i === at ? row : r)) : [...now, row]);
}
// the brick's own title, or null for the node's (a subgraph's name); one undo step
export function setTitle(key, title) {
  const b = own(key), t = typeof title === "string" ? title.trim() : "";
  if (title != null && typeof title !== "string") throw new Error("title is text, or null for the node's own title");
  transaction(() => { delete b.title; if (t && t !== BRICKS[key].title) b.title = t; }); // read after the delete: the node's own title
  app.canvas.setDirty(true, true);
  return BRICKS[key].title;
}

// SNAP-R284: any-node bricks grouped into one subgraph brick, as one undo step: ComfyUI's own Convert to Subgraph
// (LGraph.convertToSubgraph(items) -> {subgraph, node}; it moves the boundary links onto the new node), then the record:
// the bricks' entries become one node:<subgraph id>#1 entry at the first one's place, bindings into the group are read
// again from the new node's live links (as adopt() reads them), and bindings elsewhere that read from a grouped brick
// now read from the new brick, through the output the live link leaves from. Pack bricks are refused, by name
export function group(keys, { title } = {}) {
  const list = [...new Set(Array.isArray(keys) ? keys : [])];
  const pack = list.filter((k) => typeof k !== "string" || !k.startsWith("node:"));
  if (pack.length) throw new Error(`Only bricks made from any node or subgraph group into one; ${pack.map((k) => BRICKS[k]?.title ?? k).join(", ")} ${pack.length === 1 ? "is a pack brick" : "are pack bricks"}, whose faces are curated (SNAP-R1)`);
  const gone = list.filter((k) => !brick(k));
  if (gone.length) throw new Error(`No brick ${gone.join(", ")} in this recipe; its bricks: ${state().bricks.map((x) => x.key).join(", ") || "none"}`);
  if (list.length < 2) throw new Error("Grouping takes two or more any-node bricks (node:<Type>#<n>)");
  const s = record(), removed = new Set(list), nodes = list.flatMap((k) => Object.values(brick(k).nodes)).map(node).filter(Boolean);
  const at = Math.min(...list.map((k) => s.bricks.findIndex((b) => b.key === k))), name = typeof title === "string" ? title.trim() : "";
  const shown = list.flatMap((k) => BRICKS[k].face.map(([nk, setting, label]) => ({ id: brick(k).nodes[nk], setting, label: label || setting }))); // what each face showed, read before the nodes move
  const out = transaction(() => {
    const { node: outer, subgraph } = app.graph.convertToSubgraph(new Set(nodes));
    if (name) { try { subgraph.name = name; } catch { /* a read-only name: the brick's own title says it */ } }
    const carried = promote(outer, subgraph, shown);
    const key = freeKey(outer.type, new Set(s.bricks.filter((b) => !removed.has(b.key)).map((b) => b.key)));
    s.bricks = s.bricks.filter((b) => !removed.has(b.key));
    const entry = { key, nodes: { node: outer.id }, placed: {}, ...(name && subgraph.name !== name ? { title: name } : {}) };
    s.bricks.splice(at, 0, entry);
    // the face in brick order; ComfyUI may have promoted other widgets on convert (its recommended ones), so an order or set
    // that differs from the default face is kept as the brick's own (SNAP-R281)
    if (carried.length && JSON.stringify(BRICKS[key].face.map((r) => r[1])) !== JSON.stringify(carried)) entry.face = carried.map((x) => ["node", x]);
    const brickOf = new Map(s.bricks.flatMap((b) => Object.values(b.nodes).map((id) => [String(id), b.key])));
    const wire = (dst, input) => app.graph.getLink(dst?.inputs?.[dst.findInputSlot(input)]?.link);
    // bindings elsewhere that read from a grouped brick: the wire now leaves the new node (convertToSubgraph reconnects it)
    const kept = s.bindings.filter((x) => !removed.has(x.to)).map((x) => {
      if (x.rule === "ask") return { ...x, candidates: x.candidates.filter((c) => !removed.has(c.from)) };
      if (!removed.has(x.from)) return x;
      const l = wire(node(x.target), x.input), { via, ...rest } = x;
      return l && String(l.origin_id) === String(outer.id) ? { ...rest, from: key, output: outer.outputs[l.origin_slot]?.name ?? x.output, origin: outer.id } : { ...rest, from: key, origin: outer.id }; // rewired by hand before: stays an override
    }).filter((x) => x.rule !== "ask" || x.candidates.length > 1);
    // bindings into the group: what the new node's inputs are wired from now, among the recipe's bricks
    const into = Object.entries(BRICKS[key].needs ?? {}).flatMap(([role, [, input]]) => {
      const l = wire(outer, input), src = l && node(l.origin_id);
      return src && brickOf.has(String(src.id)) && brickOf.get(String(src.id)) !== key ? [{ to: key, role, input, from: brickOf.get(String(src.id)), output: src.outputs[l.origin_slot].name, rule: "imported", origin: src.id, target: outer.id }] : [];
    });
    s.bindings = [...kept, ...into];
    if (s.notes?.some((n) => removed.has(n.brick))) s.notes = s.notes.map((n) => (removed.has(n.brick) ? { ...n, brick: key } : n)); // a note on a grouped brick is on the group
    return { brick: key, grouped: list, bindings: into.length, title: BRICKS[key].title };
  });
  app.canvas.setDirty(true, true);
  return out;
}
// settings promoted onto a new subgraph node, in order, under their labels, by the steps of the frontend's own promote
// action (promotionUtils promoteValueWidgetViaSubgraphInput, not reachable from an extension): a subgraph input per
// setting, named uniquely as nextUniqueName does, connected to the widget's slot; the instance then shows it as a widget.
// A setting ComfyUI already promoted keeps its input and takes the label; one wired inside the group stays wired. Returns
// the promoted input names
function promote(outer, sg, rows) {
  const names = [], hostOf = (si) => outer.inputs?.find((i) => i.name === si.name);
  for (const { id, setting, label } of rows) {
    const n = sg.getNodeById?.(id), w = widget(n, setting), slot = w && n.getSlotFromWidget?.(w);
    if (!slot) continue;
    let si = null;
    if (slot.link != null) { const l = sg.getLink(slot.link); if (l && String(l.origin_id) === String(sg.inputNode?.id)) si = sg.inputs[l.origin_slot]; }
    else {
      const taken = sg.inputs.map((i) => i.name);
      let nm = setting, k = 1;
      while (taken.includes(nm)) nm = `${setting}_${k++}`;
      si = sg.addInput(nm, String(slot.type ?? "*"));
      si.label = label;
      if (hostOf(si)) hostOf(si).label = label; // read when the instance registers the widget, so it shows under this label
      if (!si.connect(slot, n)) { sg.removeInput(si); si = null; }
    }
    if (!si || names.includes(si.name)) continue;
    si.label = label;
    if (hostOf(si)) hostOf(si).label = label;
    names.push(si.name);
  }
  return names;
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
  for (const n of order) {
    let key = n.isSubgraphNode?.() && n.subgraph?.name === RENDER_BLUEPRINT ? "render" : KNOWN[n.type];
    if (!key || taken.has(key)) key = freeKey(n.type, taken);
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
// (H3 References takes 9), recorded with its role and reason so the brick can show what each picture is for. `first`
// wires it into the first slot, every picture before it one slot down, so it is <Picture 1> (F-C32: the opening frame)
export const PICTURE_SLOTS = 9;
export function addPicture(file, { role, reason, source, card, first = false }) {
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
    const slots = () => refs.inputs.map((x, i) => [x, i]).filter(([x]) => x.name.startsWith("ref_images.")).map(([, i]) => i);
    if (first) { // each connect replaces the slot's link, so the pictures move down one by one behind it
      const wired = slots().map((i) => refs.inputs[i].link).filter((l) => l != null).map((l) => app.graph.getLink(l).origin_id);
      [n.id, ...wired].forEach((id, k) => node(id).connect(0, refs, slots()[k]));
    } else n.connect(0, refs, refs.inputs.findIndex((i) => i.name.startsWith("ref_images.") && i.link == null));
    const picture = { node: n.id, file, role, reason, ...(source ? { source, card } : {}) };
    b.nodes[`picture_${n.id}`] = n.id;
    b.placed[n.id] = [...n.pos];
    b.pictures = first ? [picture, ...pictures] : [...pictures, picture];
    return picture;
  });
}

// a picture out of References: its LoadImage node goes, the file stays in input/ (one undo step)
export function removePicture(nodeId) {
  const b = brick("refs");
  if (!b?.pictures?.some((p) => p.node === nodeId)) return;
  transaction(() => {
    const n = node(nodeId);
    if (n) app.graph.remove(n);
    b.pictures = b.pictures.filter((p) => p.node !== nodeId);
    delete b.nodes[`picture_${nodeId}`];
    delete b.placed[nodeId];
  });
}

// a picture to place `to` (0 = <Picture 1>) among References' wired pictures, the others keeping their order: every
// picture is connected again into the slots in the new order (each connect replaces that slot's link, so nothing is left
// unwired). One undo step; returns old → new picture numbers, for the prompt's <Picture n> (UI-01, SNAP-R118)
export function movePicture(nodeId, to) {
  const b = brick("refs"), refs = node(b?.nodes.refs), order = references()?.pictures.map((p) => p.node) ?? [];
  const from = order.indexOf(nodeId);
  if (from < 0) throw new Error(`That picture isn't wired into References; it holds ${order.length}`);
  const moved = order.filter((id) => id !== nodeId);
  moved.splice(Math.max(0, Math.min(order.length - 1, to)), 0, nodeId);
  transaction(() => {
    const slots = refs.inputs.map((x, i) => [x, i]).filter(([x]) => x.name.startsWith("ref_images.")).map(([, i]) => i);
    moved.forEach((id, k) => node(id).connect(0, refs, slots[k]));
    b.pictures = [...moved.map((id) => b.pictures.find((p) => p.node === id)).filter(Boolean), ...b.pictures.filter((p) => !moved.includes(p.node))];
  });
  return Object.fromEntries(order.map((id, k) => [k + 1, moved.indexOf(id) + 1]));
}
// what a picture shows: its caption and its Load Image's title (one undo step)
export function setPictureRole(nodeId, role) {
  const p = brick("refs")?.pictures?.find((x) => x.node === nodeId);
  if (!p) throw new Error("That picture isn't one of References' pictures");
  if (!role?.trim()) throw new Error('A picture\'s role says what it shows (e.g. "plate", "Suna, back view")');
  transaction(() => { p.role = role.trim(); if (node(nodeId)) node(nodeId).title = p.role; });
  return p;
}

// an audio reference (U101, SNAP-R73): a LoadAudio node owned by the References brick, wired into the next free
// ref_audios slot (H3 takes 3), recorded like a picture. The prompt cites it as <Audio n>, n its place among the wired
// ref_audios slots, which audioNumber() reads back
export const AUDIO_SLOTS = 3;
export function audioNumber(nodeId) {
  const refs = node(brick("refs")?.nodes.refs);
  const wired = (refs?.inputs ?? []).filter((i) => i.name.startsWith("ref_audios.") && i.link != null);
  return wired.findIndex((i) => app.graph.getLink(i.link)?.origin_id === nodeId) + 1 || null;
}
// what References holds as the prompt cites it: each picture as <Picture n> and each audio as <Audio n>, in slot order
export function references() {
  const b = brick("refs"), refs = node(b?.nodes.refs);
  if (!refs) return null;
  const of = (group, list, tag) => (refs.inputs ?? []).filter((i) => i.name.startsWith(group) && i.link != null).map((i, k) => {
    const from = app.graph.getLink(i.link)?.origin_id, x = list.find((p) => p.node === from);
    return { cite: `<${tag} ${k + 1}>`, node: from, file: x?.file ?? widget(node(from), tag === "Audio" ? "audio" : "image")?.value ?? null, role: x?.role ?? null };
  });
  // UI-01: named says whether the Render prompt cites it (a picture no <Picture n> names still reaches the model, unexplained)
  const prompt = String(getValue("render", "render", "prompt") ?? ""), named = (x) => ({ ...x, named: prompt.includes(x.cite) });
  return { pictures: of("ref_images.", b.pictures ?? [], "Picture").map(named), audio: of("ref_audios.", b.audios ?? [], "Audio").map(named) };
}
// the Render prompt's <Picture n> after References changed order (map: old n → new n) or lost a picture (gone: its old
// n), so each cite still names the picture it meant; a cite of a picture taken out becomes <Picture ?> and is returned,
// for the person or agent to rewrite (SNAP-R118). Nothing happens when the prompt cites no picture
export function recite(map, gone = null) {
  const prompt = getValue("render", "render", "prompt");
  if (typeof prompt !== "string" || !/<Picture \d+>/.test(prompt)) return { changed: false, orphaned: false };
  const next = prompt.replace(/<Picture (\d+)>/g, (m, n) => (+n === gone ? "<Picture ?>" : map[n] ? `<Picture ${map[n]}>` : m));
  if (next !== prompt) setValue("render", "render", "prompt", next);
  return { changed: next !== prompt, orphaned: gone != null && next.includes("<Picture ?>") };
}
export function addAudio(file, { role, reason, source, card }) {
  const b = brick("refs");
  if (!b) throw new Error("Add the References brick first");
  const audios = (b.audios ?? []).filter((x) => node(x.node)); // one deleted in the graph is gone
  const had = audios.find((x) => x.file === file);
  if (had) return { ...had, n: audioNumber(had.node) };
  const same = source && audios.find((x) => x.source === source);
  if (same) removeAudio(same.node); // the same Cast's voice, another version: its slot goes to the new file
  if (audios.length - (same ? 1 : 0) >= AUDIO_SLOTS) throw new Error(`References holds ${AUDIO_SLOTS} audio references (H3's limit); remove one first`);
  const refs = node(b.nodes.refs);
  return transaction(() => {
    const n = LiteGraph.createNode("LoadAudio");
    n.title = role;
    n.pos = [refs.pos[0] - 360, refs.pos[1] + (b.audios?.length ?? 0) * 160];
    app.graph.add(n);
    const w = widget(n, "audio");
    if (!w.options.values.includes(file)) w.options.values.push(file); // a file under input/snap/ is a choice too (SNAP-R74)
    w.value = file;
    n.connect(0, refs, refs.inputs.findIndex((i) => i.name.startsWith("ref_audios.") && i.link == null));
    const audio = { node: n.id, file, role, reason, ...(source ? { source, card } : {}) };
    b.nodes[`audio_${n.id}`] = n.id;
    b.placed[n.id] = [...n.pos];
    b.audios = [...(b.audios ?? []).filter((x) => node(x.node)), audio];
    return { ...audio, n: audioNumber(n.id) };
  });
}
// an audio reference out of References: its LoadAudio node goes, the file stays in input/ (one undo step)
export function removeAudio(nodeId) {
  const b = brick("refs");
  if (!b?.audios?.some((x) => x.node === nodeId)) return;
  transaction(() => {
    const n = node(nodeId);
    if (n) app.graph.remove(n);
    b.audios = b.audios.filter((x) => x.node !== nodeId);
    delete b.nodes[`audio_${nodeId}`];
    delete b.placed[nodeId];
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
const noteListeners = new Set();
export const onNotesChange = (fn) => { noteListeners.add(fn); return () => noteListeners.delete(fn); };
const notesChanged = () => { for (const fn of noteListeners) fn(); };
export function addNote(text, brickKey = null) {
  const note = { id: `n${Date.now().toString(36)}`, brick: brickKey, text, status: "open", created: Date.now() };
  transaction(() => { const s = record(); s.notes = [...(s.notes ?? []), note]; });
  notesChanged();
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
// random draws a seed and increment advances one after each queued run, as control_after_generate does;
// "fixed" (the default) keeps it, so takes of one chain differ only by what the person changed
const seedName = (key) => BRICKS[key]?.face?.find(([, name]) => /seed/.test(name));
export function newSeed(key) {
  const [nodeKey, name] = seedName(key) ?? (() => { throw new Error(`${key} has no seed`); })();
  const w = widget(nodeFor(key, nodeKey), name), lo = w.options?.min ?? 0, hi = Math.min(w.options?.max ?? 2 ** 32 - 1, 2 ** 32 - 1);
  setValue(key, nodeKey, name, lo + Math.floor(Math.random() * (hi - lo + 1)));
  return getValue(key, nodeKey, name);
}
export function incrementSeed(key) {
  const [nodeKey, name] = seedName(key) ?? (() => { throw new Error(`${key} has no seed`); })();
  const w = widget(nodeFor(key, nodeKey), name), lo = w.options?.min ?? 0, hi = Math.min(w.options?.max ?? Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  const next = Number(w.value) + 1;
  setValue(key, nodeKey, name, next > hi ? lo : next);
  return getValue(key, nodeKey, name);
}
export function setSeed(key, value) {
  const [nodeKey, name] = seedName(key) ?? (() => { throw new Error(`${key} has no seed`); })();
  setValue(key, nodeKey, name, value);
}
export const seedMode = (key) => (seedName(key) ? brick(key)?.seed ?? "fixed" : null);
export function setSeedMode(key, mode) {
  if (!seedName(key)) throw new Error(`${key} has no seed`);
  if (!["fixed", "increment", "random"].includes(mode)) throw new Error("A seed mode is fixed, increment or random");
  remember(key, "seed", mode === "fixed" ? undefined : mode);
}
api.addEventListener("promptQueued", () => { if (snapLive.on) for (const b of state().bricks) { if (b.seed === "random") newSeed(b.key); else if (b.seed === "increment") incrementSeed(b.key); } });

export function updateNote(id, changes) {
  const s = state();
  if (!notes().some((n) => n.id === id)) throw new Error(`No note ${id}`);
  transaction(() => { s.notes = s.notes.map((n) => (n.id === id ? { ...n, ...changes } : n)); });
  notesChanged();
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

// UI-08 (B2, F-A29): core's Load Image and Load Audio list only input/'s top level, so a picture in a subfolder (a take's
// frame in snap/, a Cast's in snap/cast/<id>/) read "missing" though it renders. One batched check of the open graph's
// input files that the lists lack; a file the server has goes into its widget's list (the dropdown shows it, missing()
// passes it). A file really gone stays missing. Returns how many were found
const UPLOADS = ["image_upload", "video_upload", "audio_upload"], present = new Set();
export async function checkInputs() {
  const ws = (app.graph?.nodes ?? []).flatMap((n) => { const def = n.constructor?.nodeData?.input ?? {};
    return (n.widgets ?? []).filter((w) => { const spec = (def.required?.[w.name] ?? def.optional?.[w.name])?.[1];
      return spec && UPLOADS.some((k) => spec[k]) && typeof w.value === "string" && w.value && Array.isArray(w.options?.values) && !w.options.values.includes(w.value); }); });
  const ask = [...new Set(ws.map((w) => w.value))].filter((f) => !present.has(f));
  if (ask.length) {
    const r = await (await api.fetchApi("/mainodes/snap/input_exists", { method: "POST", body: JSON.stringify({ files: ask }) })).json();
    for (const [f, ok] of Object.entries(r.files ?? {})) if (ok) present.add(f);
  }
  const found = ws.filter((w) => present.has(w.value));
  for (const w of found) if (!w.options.values.includes(w.value)) w.options.values.push(w.value);
  return found.length;
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
// rebuild it; values that point at files keep their names (a machine without them shows them as missing). An any-node
// brick also carries its face and title when the person set them, and a subgraph brick its blueprint (SNAP-R282)
export function recipe() {
  return state().bricks.map(entryOf);
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
  const keys = [], made = new Map(); // made: saved subgraph type -> the type its insert got here (SNAP-R282: inserted once)
  const had = (key) => (key.startsWith("node:") ? state().bricks.find((x) => savedKey(x) === key && !keys.includes(x.key))?.key : brick(key) && key);
  for (const [i, entry] of saved.entries()) { // bricks already in the stack are reused (any-node bricks of a type in order), the rest snapped
    const { key } = entry;
    if (BRICKS[key]?.needs?.video && legacy()) { keys.push(null); continue; } // an older Render saves its own video: its note offers the upgrade
    // a new brick goes where the saved recipe has it (before the next brick it lists that is already here), so it binds
    // between its neighbours instead of dangling after the render
    const next = saved.slice(i + 1).map((x) => had(x.key)).find(Boolean), at = next ? state().bricks.findIndex((b) => b.key === next) : undefined;
    // a subgraph brick comes from its blueprint (its type id is new in every graph it is inserted into); without one, a type
    // this graph lacks stays the "(not installed)" stub
    const bp = key.startsWith("node:") && entry.blueprint && typeof entry.blueprint === "object" ? entry.blueprint : null;
    keys.push(had(key) || (bp ? (await snapBlueprint(bp, { at, as: key.slice(5), reuse: made })).brick : (await snap(key, { at })).brick));
  }
  transaction(() => saved.forEach(({ values, face, title }, i) => {
    if (!keys[i]) return;
    for (const [nodeKey, ws] of Object.entries(values ?? {})) {
      const n = nodeFor(keys[i], nodeKey);
      for (const [name, v] of Object.entries(ws)) { const w = widget(n, name); if (w) put(w, v); }
    }
    if (keys[i].startsWith("node:")) dress(keys[i], { face, title }); // SNAP-R281: the face and title it was kept with
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
