// Method slots (SNAP-R14): a named position between two media sockets holding one interchangeable method (today the
// upscale slot: ESRGAN-family model or plain resize between the image Render and Save; RelayVSR is H3's switch inside
// its Render until that blueprint gives VIDEO). Turbo is the other slot verb, but it edits values on nodes that exist,
// so it lives in models.js. Readiness comes from the model folders at run time, never from a list in code.
// SNAP-R1 generic pass-through · SNAP-R4 outcome faces · SNAP-R11 warn, never block · SNAP-R14 method slots ·
// SNAP-R19 the tool table is the API · see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import * as E from "./engine.js";
import * as M from "./models.js";
import { BRICKS, METHODS } from "./bricks.js";

const nodesOf = (key) => Object.keys(E.state().bricks.find((b) => b.key === key)?.nodes ?? {}).map((k) => E.nodeFor(key, k)).filter(Boolean);
// the brick that fills a slot now: a method brick, or a hand-wired node whose type says it scales (shown as Custom)
const CUSTOM = /upscal|resiz|scale|vsr|superres/i;
export function holder(slot) {
  return E.state().bricks.find((b) => BRICKS[b.key].slot === slot || (slot === "upscale" && b.key === "upscale"))?.key
    ?? E.state().bricks.find((b) => b.key.startsWith("node:") && CUSTOM.test(b.key))?.key ?? null;
}
export const method = (key) => (BRICKS[key]?.method ?? (key === "upscale" ? "relayvsr" : key?.startsWith("node:") ? "custom" : null));

// ready: every model folder the method needs has a file (matching its name pattern); the folder lists are core's
function readiness(m) {
  const lists = M.folders();
  const missing = m.needs.filter((n) => !(lists.get(n.folder) ?? []).some((f) => !n.match || f.toLowerCase().includes(n.match)));
  return missing.length ? `needs weights in ${missing.map((n) => `models/${n.folder}${n.match ? ` (${n.match})` : ""}`).join(", ")}` : "ready";
}
export function list(slot) {
  const now = holder(slot), k = now && BRICKS[now].kit;
  return METHODS[slot].map((m) => ({ ...m, install_state: readiness(m), wired: !!m.brick && !m.unwired, fits: !m.brick || !k || BRICKS[m.brick].kit === k, current: method(now) === m.id }))
    .concat(now?.startsWith("node:") ? [{ id: "custom", title: `Custom: ${BRICKS[now].title}`, media: "?", kind: "hand-wired", scale: "its own widgets", install_state: "ready", wired: true, fits: true, current: true }] : []);
}

// on / off: an attachment flips its host's switch (H3 RelayVSR); a slot brick is bypassed, its settings kept
export function on(key) {
  const a = BRICKS[key]?.attach;
  if (a) return E.getValue(a.brick, a.brick, a.widget) !== a.off;
  return nodesOf(key).some((n) => n.mode !== 4);
}
export function setOn(key, value) {
  const a = BRICKS[key].attach;
  if (a) return E.setValue(a.brick, a.brick, a.widget, value ? a.on : a.off);
  E.batch(() => { for (const n of nodesOf(key)) n.mode = value ? 0 : 4; });
  app.canvas.setDirty(true, true);
}

// the factor a slot brick gives: a fixed model's own (from its file name, "4x-UltraSharp" -> 4) times the resize after it
const modelScale = (key) => { const f = BRICKS[key].scale?.fixed, v = f && String(E.getValue(key, ...f) ?? ""); return f ? Number(v.match(/(\d+)x|x(\d+)/i)?.slice(1).find(Boolean) ?? 1) : 1; };
export function factor(key) {
  const def = BRICKS[key];
  if (def.attach) return Number(E.getValue(key, "settings", "output_scale")); // RelayVSR's own setting
  return def.scale ? +(modelScale(key) * Number(E.getValue(key, ...def.scale.widget))).toFixed(3) : null;
}
export function setFactor(key, f) {
  const def = BRICKS[key];
  E.batch(() => {
    if (def.attach) E.setValue(key, "settings", "output_scale", String(f));
    else E.setValue(key, ...def.scale.widget, +(f / modelScale(key)).toFixed(4));
    if (!on(key)) setOn(key, true);
  });
}
// what the face's quality line says: a fixed model resized to another factor says so (the brick's own face facts say
// the rest: the model file, the resize filter, RelayVSR's quality preset)
export function quality(key) {
  if (!BRICKS[key].scale?.fixed) return null;
  const n = modelScale(key), f = factor(key);
  return `${n}× model${Math.abs(f - n) > 1e-3 ? `, scaled to ${f}×` : ""}`;
}
// the size the picture or clip comes out: the Render's width × height, times the factor while the slot is on
export function headline(key) {
  const src = E.state().bricks.map((b) => b.key).find((k) => ["image", "render"].includes(k)), w = src && E.getValue(src, src, "width"), ht = src && E.getValue(src, src, "height");
  if (!w) return null;
  const f = factor(key);
  return on(key) && f ? `${w}×${ht} → ${Math.round(w * f)}×${Math.round(ht * f)}` : `${w}×${ht} (not upscaled)`;
}

// pick a method (or "off") for a slot, keeping the factor; a new brick goes where the old one was (or before Save), the
// old one goes, and what it fed binds to the new one. One undo step
export async function set(slot, id, { factor: f } = {}) {
  const now = holder(slot);
  if (id === "off") { if (!now) throw new Error(`Nothing fills the ${slot} slot`); setOn(now, false); return { method: method(now), on: false }; }
  const m = METHODS[slot].find((x) => x.id === id);
  if (!m) throw new Error(`No ${slot} method "${id}"; there are: ${METHODS[slot].map((x) => x.id).join(", ")}`);
  if (!m.brick || m.unwired) throw new Error(`${m.title}: ${m.unwired ?? "not wired yet"}`);
  const k = E.state().bricks.map((b) => BRICKS[b.key].kit).find(Boolean);
  if (k && BRICKS[m.brick].kit !== k) throw new Error(`${m.title} is for ${m.media} recipes; this one makes ${k === "image" ? "pictures" : "video"}`);
  const keep = f ?? (now ? factor(now) : 2);
  let key = now;
  app.canvas.emitBeforeChange();
  try {
    if (method(now) !== id) {
      const keys = E.state().bricks.map((b) => b.key), at = now ? keys.indexOf(now) : keys.indexOf("save_image");
      key = (await E.snap(m.brick, { at: at < 0 ? undefined : at })).brick;
      if (now) { E.unsnap(now); E.rebind(); }
    }
    setFactor(key, keep);
  } finally { app.canvas.emitAfterChange(); }
  app.canvas.setDirty(true, true);
  return { method: id, brick: key, factor: factor(key), on: on(key), install_state: readiness(m), headline: headline(key) };
}
