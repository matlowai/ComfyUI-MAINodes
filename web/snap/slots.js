// Method slots (SNAP-R14, UX_GEMS §5): a slot is a named position holding one interchangeable method. A media slot sits
// between two media sockets (upscale: the image Render's IMAGE and Save; RelayVSR is H3's switch inside its Render until
// that blueprint gives VIDEO); a delta slot edits values on nodes that exist (turbo: its methods are the model graph's
// turbos, in models.js). The registry is snap_cards/methods.json under the person's userdata snap/methods.json (field by
// field, the person wins, as the model graph). Readiness comes from the model folders and installed nodes at run time.
// SNAP-R1 generic pass-through · SNAP-R4 outcome faces · SNAP-R11 warn, never block · SNAP-R13 data, not code branches ·
// SNAP-R14 method slots · SNAP-R19 the tool table is the API · see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import * as M from "./models.js";
import { BRICKS, kit } from "./bricks.js";

const MINE = "snap/methods.json";
let registry = { slots: [], methods: [] }, loading = null, problem = null;
const merged = (pack = [], own = [], id) => { const out = new Map(pack.map((x) => [id(x), x])); for (const x of own) out.set(id(x), M.overlay(out.get(id(x)), x)); return [...out.values()]; };
export function load() {
  loading ??= Promise.all([api.fetchApi("/mainodes/snap/methods").then((r) => r.json()),
    api.getUserData(MINE).then((r) => (r.ok ? r.json() : {})).catch((e) => { problem = `Your snap/methods.json was skipped (${e.message})`; return {}; })])
    .then(([pack, own]) => (registry = { slots: merged(pack.slots, own.slots, (s) => s.id), methods: merged(pack.methods, own.methods, (m) => `${m.slot}/${m.id}`) }), (e) => { loading = null; throw e; });
  return loading;
}
export const registryProblem = () => problem;
export const slots = () => registry.slots.map((s) => s.id);
export function slot(id) {
  const s = registry.slots.find((x) => x.id === id);
  if (!s) throw new Error(`No slot "${id}"; there are: ${slots().join(", ")}`);
  return s;
}
const methods = (id) => registry.methods.filter((m) => m.slot === id);
// the registered method a pack brick runs
const methodOf = (key) => registry.methods.find((m) => m.brick && m.brick === key) ?? null;

// a hand-wired step in a media slot: an any-node brick that takes one input of the slot's media, wired in, and gives one
// output of the same type, and isn't an output node (Save passes its picture on). Decided from the wiring, never from the
// node's name: RescaleCFG is a MODEL patch, not an upscaler
function passes(key, media) {
  const n = key.startsWith("node:") && E.nodeFor(key, "node");
  return !!n && !output(n) && media.some((t) => { const ins = (n.inputs ?? []).filter((i) => i.type === t); return ins.length === 1 && ins[0].link != null && (n.outputs ?? []).filter((o) => o.type === t).length === 1; });
}
// the brick that fills a slot now: a method brick, else a hand-wired step (Custom); a delta slot's is the brick it edits
export function holder(id) {
  const s = slot(id), keys = E.state().bricks.map((b) => b.key);
  if (s.kind === "delta") return M.turboHost();
  return keys.find((k) => methodOf(k)?.slot === id) ?? keys.find((k) => passes(k, s.media)) ?? null;
}
// the media slot a brick fills, if any (the view's face)
export const slotOf = (key) => methodOf(key)?.slot ?? registry.slots.find((s) => s.kind === "media" && holder(s.id) === key)?.id ?? null;
export const method = (key) => methodOf(key)?.id ?? (key?.startsWith("node:") ? "custom" : null);

// ready: every model folder the method needs has a file (matching its name pattern) and its nodes are installed
function installState(m) {
  const lists = M.folders(), nodes = (m.packs ?? []).filter((t) => !LiteGraph.registered_node_types[t]);
  const missing = (m.needs ?? []).filter((n) => !(lists.get(n.folder) ?? []).some((f) => !n.match || f.toLowerCase().includes(n.match)));
  if (nodes.length) return `needs the nodes ${nodes.join(", ")}`;
  return missing.length ? `needs weights in ${missing.map((n) => `models/${n.folder}${n.match ? ` (${n.match})` : ""}`).join(", ")}` : "ready";
}
// every method of a slot in one shape (media and delta alike): id, title, install_state, wired, fits this recipe, current
export function list(id) {
  if (slot(id).kind === "delta") {
    const now = M.turbo()?.file;
    return M.turbos().map((t) => ({ ...t, id: t.file, title: t.name, does: t.how === "merged" ? "merged checkpoint" : "LoRA", same_lineage: t.fits, install_state: "ready", wired: true, fits: true, current: t.file === now, local_or_api: "local" }));
  }
  const now = holder(id), k = kit(E.state().bricks.map((b) => b.key));
  return methods(id).map((m) => ({ ...m, install_state: installState(m), wired: !!m.brick && !m.unwired, fits: !k || m.kit === k, current: !!now && method(now) === m.id }))
    .concat(now?.startsWith("node:") ? [{ id: "custom", title: `Custom: ${BRICKS[now].title}`, does: "hand-wired", scale: null, install_state: "ready", wired: true, fits: true, current: true }] : []);
}

// on / off: an attachment flips its host's switch (H3 RelayVSR); a slot brick is bypassed, its settings kept
export function on(key) {
  const a = BRICKS[key]?.attach;
  if (a) return E.getValue(a.brick, a.brick, a.widget) !== a.off;
  return M.nodesOf(key).some(([, n]) => n.mode !== 4);
}
export function setOn(key, value) {
  const a = BRICKS[key].attach;
  if (a) return E.setValue(a.brick, a.brick, a.widget, value ? a.on : a.off);
  E.batch(() => { for (const [, n] of M.nodesOf(key)) n.mode = value ? 0 : 4; });
  app.canvas.setDirty(true, true);
}

// a fixed model's own factor: the model graph's `scale` for its file, else the factor in its name ("4x-UltraSharp");
// null when neither says (SNAP-R3: no default stands in)
function modelScale(key, s) {
  const v = String(E.getValue(key, ...s.model) ?? "");
  return M.entry(v)?.scale ?? (Number(v.match(/(\d+)x|x(\d+)/i)?.slice(1).find(Boolean)) || null);
}
// the factor a slot brick gives, by its method's scale kind: a fixed model times the resize after it, or the set / free
// widget's own value; null when a fixed model's factor is unknown
export function factor(key) {
  const s = methodOf(key)?.scale;
  if (!s?.widget) return null;
  const v = Number(E.getValue(key, ...s.widget));
  if (s.type !== "fixed") return v;
  const n = modelScale(key, s);
  return n ? +(n * v).toFixed(3) : null;
}
export function setFactor(key, f) {
  const s = methodOf(key).scale, n = s.type === "fixed" ? modelScale(key, s) : 1;
  const w = E.nodeFor(key, s.widget[0]).widgets.find((x) => x.name === s.widget[1]), v = n ? +(f / n).toFixed(4) : 1; // an unknown model stays at its own size
  E.batch(() => {
    E.setValue(key, ...s.widget, Array.isArray(w.options?.values) ? String(v) : v);
    if (!on(key)) setOn(key, true);
  });
}
// where a method starts when the factor isn't known (a Custom holder, an empty slot): a fixed model at its own factor, a
// set at its first value, a free one at 2
const start = (m, key) => (m.scale.type === "fixed" ? modelScale(key, m.scale) ?? 1 : m.scale.type === "set" ? m.scale.values[0] : 2);
// what the face's quality line says about a fixed model (the brick's own face facts say the rest)
export function quality(key) {
  const s = methodOf(key)?.scale;
  if (s?.type !== "fixed") return null;
  const n = modelScale(key, s), f = factor(key);
  return n ? `${n}× model${Math.abs(f - n) > 1e-3 ? `, scaled to ${f}×` : ""}` : "unknown model factor: not resized";
}
// the size the picture or clip comes out: the Render's width × height, times the factor while the slot is on
export function headline(key) {
  const src = E.state().bricks.map((b) => b.key).find((k) => ["image", "render"].includes(k)), w = src && E.getValue(src, src, "width"), ht = src && E.getValue(src, src, "height");
  if (!w) return null;
  const f = factor(key);
  return !on(key) ? `${w}×${ht} (not upscaled)` : f ? `${w}×${ht} → ${Math.round(w * f)}×${Math.round(ht * f)}` : `${w}×${ht} → ? (model factor unknown)`;
}

// list_methods' answer: the slot, what fills it now, and its methods
export function describe(id) {
  if (slot(id).kind === "delta") return { slot: id, kind: "delta", family: M.family(), current: M.turbo()?.file ?? null, on: !!M.turbo(), methods: list(id) };
  const now = holder(id), ours = now && methodOf(now);
  return { slot: id, kind: "media", current: method(now), on: now ? on(now) : false, factor: ours ? factor(now) : null, headline: ours ? headline(now) : null, methods: list(id) };
}

// the bricks that take a brick's output by wire
function consumers(key) {
  const owner = (id) => E.state().bricks.find((b) => Object.values(b.nodes).some((x) => String(x) === String(id)))?.key;
  return [...new Set(M.nodesOf(key).flatMap(([, n]) => (n.outputs ?? []).flatMap((o) => (o.links ?? []).map((l) => owner(app.graph.getLink(l)?.target_id)))))].filter((k) => k && k !== key);
}
const output = (n) => !!n.constructor.nodeData?.output_node;
// the first brick with an output node that takes the slot's media (Save): a new step goes before it
const sink = (media) => E.state().bricks.findIndex((b) => M.nodesOf(b.key).some(([, n]) => output(n) && n.inputs?.some((i) => media.includes(i.type))));

// pick a method (or "off") for a slot. A media slot keeps the factor; a new brick goes where the old one was, never after
// what it fed or after Save; the old one goes, and what it fed binds to the new one. One undo step
export async function set(id, choice, { factor: f } = {}) {
  const s = slot(id);
  if (s.kind === "delta") return M.setTurbo(choice);
  const now = holder(id);
  if (choice === "off") { if (!now) throw new Error(`Nothing fills the ${id} slot`); setOn(now, false); return { method: method(now), on: false }; }
  const m = methods(id).find((x) => x.id === choice);
  if (!m) throw new Error(`No ${id} method "${choice}"; there are: off, ${methods(id).map((x) => x.id).join(", ")}`);
  if (!m.brick || m.unwired) throw new Error(`${m.title}: ${m.unwired ?? "not wired yet"}`);
  const k = kit(E.state().bricks.map((b) => b.key));
  if (k && m.kit !== k) throw new Error(`${m.title} is for ${m.kit} recipes; this one makes ${k === "image" ? "pictures" : "video"}`);
  const keep = f ?? (now && methodOf(now) ? factor(now) : null); // a Custom holder's factor isn't known
  let key = now;
  app.canvas.emitBeforeChange();
  try {
    if (method(now) !== choice) {
      const keys = E.state().bricks.map((b) => b.key), places = [now ? keys.indexOf(now) : -1, ...(now ? consumers(now) : []).map((c) => keys.indexOf(c)), sink(s.media)].filter((i) => i >= 0);
      key = (await E.snap(m.brick, { at: places.length ? Math.min(...places) : undefined })).brick;
      if (now) { E.unsnap(now); E.rebind(); }
    }
    setFactor(key, keep ?? start(m, key));
  } finally { app.canvas.emitAfterChange(); }
  app.canvas.setDirty(true, true);
  return { method: choice, brick: key, factor: factor(key), on: on(key), install_state: installState(m), headline: headline(key), quality: quality(key) };
}

// what a slot's preview queues: the output nodes downstream of the brick that fills it (a blueprint's inner ones as
// "<outer>:<inner>"), so only the chain up to the slot and what it feeds runs
export function previewTargets(id) {
  const key = holder(id);
  if (!key) throw new Error(`Nothing fills the ${id} slot`);
  const from = BRICKS[key].attach?.brick ?? key, out = [], seen = new Set();
  const todo = Object.values(E.state().bricks.find((b) => b.key === from).nodes).map((n) => app.graph.getNodeById(n)).filter(Boolean);
  while (todo.length) {
    const n = todo.pop();
    if (seen.has(n.id)) continue;
    seen.add(n.id);
    if (output(n)) out.push(String(n.id));
    for (const x of n.subgraph?.nodes ?? []) if (output(x)) out.push(`${n.id}:${x.id}`);
    for (const o of n.outputs ?? []) for (const l of o.links ?? []) { const t = app.graph.getNodeById(app.graph.getLink(l)?.target_id); if (t) todo.push(t); }
  }
  return out;
}
