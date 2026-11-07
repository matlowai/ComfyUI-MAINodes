// Dial Rack — one row per dial (on/off, dial, strength, solo, hold) over the MAIDialRack node's hidden `rack` JSON widget.
// The widget IS the state (saved with the workflow, read by the backend); this UI only edits it.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const DEFAULT_STRENGTH = 0.5;   // the sane everyday range is +0.5 .. +1
const SLIDER = [-3, 3];
const NUMBER = [-1000, 1000];  // typed strengths: past any useful range on purpose; the slider covers everyday use
const PRESETS = "/mainodes/dials/presets";
const LEFT_PX = 590;     // the rows column keeps this width; the map takes the rest of the node
const MAP_MIN = 160;
const READOUT_MIN = 44;   // the map leaves the readout this much; longer readouts (wheel hover) scroll instead of shrinking the map
const PAD_RANGES = ["auto", 1.5, 3, 6, 12];
const UNKNOWN = { useful: null, overcook: null };
const INFO_DEFAULTS = { version: 2, description: "", negative: "", positive: "", neg: UNKNOWN, pos: UNKNOWN, evidence: null, pipeline: "", notes: "" };
const EVIDENCE = ["creator", "one-seed", "multi-seed", "multi-scene"];
const QUADRANTS = [[1, -1], [-1, -1], [1, 1], [-1, 1]];  // [x sign, y sign] of the map's quarters; ring labels go in the first drawn
const side = (info, s) => (s < 0 ? info.neg : info.pos);
const SWEEP_STEPS = [0.25, 0.5, 1];
const BLOCKS = 50;  // MiniMax H3's DiT blocks, until a run reports the model's count
const BLOCK_PRESETS = [
  ["all", "every block: the plain post-refiner hook", () => true],
  ["none", "no block: the row adds nothing", () => false],
  ["first half", "blocks 0 to n/2 - 1", (i, n) => i < n / 2],
  ["second half", "blocks n/2 to n - 1", (i, n) => i >= n / 2],
  ["26–37", "blocks 26 to 37 only", (i) => i >= 26 && i <= 37],
  ["odd", "odd blocks", (i) => i % 2 === 1],
  ["even", "even blocks", (i) => i % 2 === 0],
];
const BLOCKS_HELP = "How much of the dial the text tokens carry into each block, times the row strength. Lowering a later " +
  "block subtracts the dial there; the blocks before it have already read it.";

// one bar per block, height = strength 0..top (top is at least 1); also the row's mini strip
function drawBlocks(c, w, hover, W, H, top = Math.max(1, ...w)) {
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  const g = c.getContext("2d"), cw = W / w.length, gap = cw > 3 ? 1 : 0;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#101114"; g.fillRect(0, 0, W, H);
  w.forEach((v, i) => {
    g.fillStyle = i % 10 === 0 && gap ? "#252831" : "#1b1d23";
    g.fillRect(i * cw, 0, cw - gap, H);
    g.fillStyle = i === hover ? "#ffe2a0" : "#ffc145";
    const h = Math.min(1, v / top);
    g.fillRect(i * cw, H * (1 - h), cw - gap, H * h);
  });
  if (H < 30) return;
  g.fillStyle = "#777"; g.font = "9px sans-serif";
  for (let i = 0; i < w.length; i += 10) g.fillText(String(i), i * cw + 2, 10);
}

const CLIP_SECONDS = 124 / 24;  // H3's default length, until a run reports the clip
const FEATURES = ["onset", "rms", "low", "mid", "high"];
const SHAPING = { gain: 1, offset: 0, threshold: 0, attack: 0.01, release: 0.15 };
const TIME_HELP = "Strength over clip time: for the first k steps the model runs without and with this dial and blends the " +
  "two per latent frame (about 1/6 s), v = v0 + M(t)·(v_dial − v0), M times the row strength; the dial is off after step k. " +
  "Each blended step costs one more model call. Audio: follow uses the same curve on the soundtrack, protect keeps the " +
  "soundtrack undialled.";
const TIME_KEYS = [
  ["off → on", "0 for the first half, 1 for the second", [[0, 0], [0.5, 1]], "step"],
  ["on → off", "1 for the first half, 0 for the second", [[0, 1], [0.5, 0]], "step"],
  ["ramp up", "0 at the start to 1 at the end", [[0, 0], [1, 1]], "linear"],
  ["ramp down", "1 at the start to 0 at the end", [[0, 1], [1, 0]], "linear"],
  ["dip", "1, with a short dip to −1 (the dial reversed) in the middle", [[0, 1], [0.4, 1], [0.45, -1], [0.55, -1], [0.6, 1]], "linear"],
];

// the curve through [x, y] points at each of xs, held flat outside them; smooth > 0 ramps the rate across each point
// (mirrors dials/envelopes.py keyframes, which explains the math)
function keyframes(p, smooth, xs) {
  const n = p.length - 1;
  if (!smooth || !n) return xs.map((t) => {
    const i = p.findIndex(([pt]) => pt > t);
    if (i === 0) return p[0][1];
    if (i < 0) return p[n][1];
    const [t0, m0] = p[i - 1], [t1, m1] = p[i];
    return m0 + (m1 - m0) * (t - t0) / (t1 - t0);
  });
  const h = p.slice(1).map(([t], i) => t - p[i][0]), d = h.map((v, i) => (p[i + 1][1] - p[i][1]) / v);
  const m = p.map((_, i) => (i && i < n && d[i - 1] * d[i] > 0 ? 2 * d[i - 1] * d[i] / (d[i - 1] + d[i]) : 0));
  const w = h.map((v) => smooth * v / 2), k = d.map((v, i) => (v - smooth * (m[i] + m[i + 1]) / 4) / (1 - smooth / 2));
  return xs.map((t) => {
    let i = 0;
    while (i < n - 1 && p[i + 1][0] <= t) i++;
    const u = Math.min(h[i], Math.max(0, t - p[i][0])), v = h[i] - u;
    if (u < w[i]) return p[i][1] + m[i] * u + (k[i] - m[i]) * u * u / (2 * w[i]);
    if (v < w[i]) return p[i + 1][1] - m[i + 1] * v - (k[i] - m[i + 1]) * v * v / (2 * w[i]);
    return p[i][1] + (m[i] + k[i]) * w[i] / 2 + k[i] * (u - w[i]);
  });
}

// M(t) of a row's time curve at the given seconds (mirrors dials/timecurve.py curve_fn and shape)
function timeCurve(spec, seconds, times, audio) {
  if (spec.type === "audio") {
    const x = audio?.features?.[spec.feature || "onset"];
    if (!x) return null;
    const s = Object.assign({}, SHAPING, spec), rate = audio.rate;
    const coef = [s.attack, s.release].map((v) => (v > 0 ? 1 - Math.exp(-1 / (v * rate)) : 1));
    let level = Math.max(0, (x[0] - s.threshold) / (1 - s.threshold));
    const y = x.map((v) => {
      v = Math.max(0, (v - s.threshold) / (1 - s.threshold));
      level += coef[v > level ? 0 : 1] * (v - level);
      return s.offset + s.gain * (s.invert ? 1 - level : level);
    });
    return times.map((t) => { const i = Math.min(y.length - 1, Math.max(0, t * rate)), a = Math.floor(i); return y[a] + (y[Math.min(a + 1, y.length - 1)] - y[a]) * (i - a); });
  }
  const scale = (spec.unit || "normalized") === "normalized" ? seconds : 1;
  const p = (spec.points || []).map(([t, m]) => [t * scale, m]);
  if (!p.length) return null;
  if (spec.interp !== "step") return keyframes(p, spec.smooth, times);
  return times.map((t) => {
    const i = p.findIndex(([pt]) => pt > t);
    return p[i === 0 ? 0 : i < 0 ? p.length - 1 : i - 1][1];
  });
}

const CURVE_GAP = 1 / 6;  // seconds a dragged point keeps from its neighbours: one latent frame
const SNAPS = [["off", "snap: off"], ["frame", "snap: latent frames"], ["0.1", "snap: 0.1 s"], ["0.5", "snap: 0.5 s"], ["1", "snap: 1 s"], ["onset", "snap: onsets"]];
const CURVE_HELP = "Click to add a point, drag to move it (Shift: fine, Alt: no snap), double-click or right-click to delete it. " +
  "Shift+click adds points to the selection, Ctrl+drag selects a box; dragging a selected point moves them all. Arrows nudge the " +
  "selection (Shift ×10), Delete removes it, Esc deselects, Ctrl+Z / Ctrl+Shift+Z undo / redo. Wheel zooms time, Shift+wheel " +
  "or middle-drag pans. Between levels 0 and 1, level × the row strength is the dial strength (right axis); outside that range the " +
  "blend extrapolates and acts weaker than that strength (greyed axis, 'extrapolated' in the readout). " +
  "The model resolves one latent frame (about 1/6 s, the ticks under the axis): sharper changes are averaged per frame, " +
  "and renders ramp over about 1.5 s.";
// level × row strength is the dial strength only between levels 0 and 1; outside, the blend extrapolates and acts weaker
const levelStrength = (v, strength) => v >= 0 && v <= 1 ? `strength ${(v * strength).toFixed(2)}` : `extrapolated (weaker than ${(v * strength).toFixed(2)})`;
let curveClipboard = null;  // Copy / Paste fallback when the browser clipboard is blocked

const validPoints = (v) => Array.isArray(v) && v.length > 0 && v.every((p, i) => Array.isArray(p) && p.length === 2 &&
  p.every((n) => typeof n === "number" && Number.isFinite(n)) && (!i || p[0] > v[i - 1][0]));

// pasted text -> a row's time spec, a bare [[time, M], ...] list, or null
function parseTime(text) {
  let v;
  try { v = JSON.parse(text); } catch (e) { return null; }
  return validPoints(v) || v?.type === "audio" || (v?.type === "keys" && validPoints(v.points)) ? v : null;
}

// pixel-frame starts of H3's video latent frames (1, 4, 4, 4, 4 frames at 24 fps) up to the clip's end
function frameStarts(seconds) {
  const f = [0];
  for (let k = 0; f[k] < Math.round(seconds * 24); k++) f.push(f[k] + [1, 4, 4, 4, 4][k % 5]);
  return f;
}

// [start s, end s, M] per video latent frame: the curve's mean over the frame's pixel frames
function frameCurve(spec, seconds, audio) {
  const f = frameStarts(seconds);
  return f.slice(1).map((b, k) => {
    const m = timeCurve(spec, seconds, Array.from({ length: b - f[k] }, (_, j) => (f[k] + j) / 24), audio);
    return [f[k] / 24, b / 24, m.reduce((x, y) => x + y, 0) / m.length];
  });
}

// onset times of the music: peaks of its onset strength above 0.3, at least 80 ms apart
function onsetTimes(audio) {
  const x = audio?.features?.onset || [];
  return x.flatMap((v, i) => (v >= 0.3 && v > x[i - 1] && Math.max(...x.slice(Math.max(0, i - 8), i + 9)) === v ? [i / audio.rate] : []));
}

// the curve over the clip: waveform behind, the curve, and the M each video latent frame gets. The editor's canvas (H >= 30)
// adds a seconds grid, latent-frame ticks, onsets, level lines and the keyframes. Returns the axes (seconds and M <-> pixels).
// view: {axes (span, lo, hi fixed during a drag), top, bottom, win [t0, t1] seconds shown (zoom), strength (the row's: a
// second axis of level × strength when not 1), sel (selected indices), main (the primary one), hover, ghost [s, M],
// box [x0, y0, x1, y1] (box select), label}
function drawTime(c, spec, seconds, audio, W, H, view = {}) {
  const dpr = window.devicePixelRatio || 1;
  c.width = Math.round(W * dpr); c.height = Math.round(H * dpr);
  const g = c.getContext("2d"), big = H >= 30, keys = spec.type === "keys";
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#101114"; g.fillRect(0, 0, W, H);
  const scale = (spec.unit || "normalized") === "normalized" ? seconds : 1;
  const points = keys ? (spec.points || []).map(([t, m]) => [t * scale, m]) : [];
  const span = view.axes?.span ?? Math.max(seconds, ...points.map(([t]) => t));
  const [t0, t1] = view.win || [0, span], strength = big && view.strength !== undefined && view.strength !== 1 ? view.strength : null;
  const [L, R, T, B] = big ? [30, strength === null ? 9 : 44, 9, 16] : [0, 0, 2, 2], pw = W - L - R, ph = H - T - B;
  const x = (t) => L + (t - t0) / (t1 - t0) * pw;
  g.save(); g.beginPath(); g.rect(L, 0, pw, H); g.clip();
  if (audio?.peaks && big) {
    g.fillStyle = "#2b3442";
    const n = audio.peaks.length, per = audio.seconds / n;
    for (let i = 0; i < n && i * per < span; i++) {
      const h = audio.peaks[i] * ph;
      g.fillRect(x(i * per), T + (ph - h) / 2, Math.max(1, per / (t1 - t0) * pw), h);
    }
  }
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 30].find((s) => s / (t1 - t0) * pw >= 44 && (view.win || s >= 1)) ?? 60;
  if (big) {
    g.font = "10px sans-serif"; g.lineWidth = 1;
    for (let k = Math.ceil(t0 / step * 2); k * step / 2 <= t1 + 1e-9; k++) {
      if (k % 2 && step / 2 / (t1 - t0) * pw < 30) continue;
      const px = Math.round(x(k * step / 2)) + 0.5;
      g.strokeStyle = k % 2 ? "#1a1c22" : "#262a33";
      g.beginPath(); g.moveTo(px, T); g.lineTo(px, T + ph); g.stroke();
    }
    if (4 / 24 / (t1 - t0) * pw >= 5) {
      g.strokeStyle = "#4a4d57"; g.beginPath();
      for (const v of frameStarts(span)) { const px = Math.round(x(v / 24)) + 0.5; g.moveTo(px, T + ph - 4); g.lineTo(px, T + ph); }
      g.stroke();
    }
    if (span > seconds + 1e-9) {
      g.fillStyle = "rgba(255,255,255,0.05)"; g.fillRect(x(seconds), T, x(span) - x(seconds), ph);
      g.fillStyle = "#888"; g.fillText("past the clip end", x(seconds) + 4, T + 10);
    }
    g.strokeStyle = "#6d84b0"; g.beginPath();
    for (const t of onsetTimes(audio)) if (t <= span) { const px = Math.round(x(t)) + 0.5; g.moveTo(px, T); g.lineTo(px, T + 5); }
    g.stroke();
  }
  const times = Array.from({ length: pw + 1 }, (_, i) => t0 + (i / pw) * (t1 - t0));
  const m = timeCurve(spec, seconds, times, audio);
  if (!m) {
    g.restore();
    if (big) { g.fillStyle = "#777"; g.font = "10px sans-serif"; g.fillText("run once with curve_audio connected to see the music's curve", 12, H / 2); }
    return null;
  }
  const lo = view.axes?.lo ?? Math.min(view.bottom ?? 0, ...m), hi = view.axes?.hi ?? Math.max(view.top ?? 1, ...m);
  const y = (v) => T + (hi - v) / (hi - lo) * ph;
  const axes = { span, lo, hi, pw, x, y, t: (px) => t0 + (px - L) / pw * (t1 - t0), v: (py) => hi - (py - T) / ph * (hi - lo) };
  const whole = hi - lo <= 8 ? Array.from({ length: Math.floor(hi) - Math.ceil(lo) + 1 }, (_, i) => Math.ceil(lo) + i) : [0, 1];
  if (big) {  // dashed whole levels, zero solid
    g.strokeStyle = "#2f333d"; g.setLineDash([3, 3]); g.beginPath();
    for (const v of whole) if (v && v > lo && v < hi) { g.moveTo(L, Math.round(y(v)) + 0.5); g.lineTo(L + pw, Math.round(y(v)) + 0.5); }
    g.stroke(); g.setLineDash([]);
    if (lo < 0 && hi > 0) { g.strokeStyle = "#5b6070"; g.beginPath(); g.moveTo(L, Math.round(y(0)) + 0.5); g.lineTo(L + pw, Math.round(y(0)) + 0.5); g.stroke(); }
    g.strokeStyle = "#ffc145"; g.lineWidth = 1.5; g.beginPath();
    for (const [a, b, v] of frameCurve(spec, seconds, audio)) { g.lineTo(x(a), y(v)); g.lineTo(x(b), y(v)); }
    g.stroke();
  }
  g.strokeStyle = big ? "#8fb4ff" : "#ffc145"; g.lineWidth = big ? 1.5 : 1; g.beginPath();
  if (keys && (spec.interp === "step" || !spec.smooth)) {  // through the points, held flat past the first and last; step holds each level until the next point
    g.moveTo(x(0), y(points[0][1]));
    points.forEach(([t, v], i) => { if (i && spec.interp === "step") g.lineTo(x(t), y(points[i - 1][1])); g.lineTo(x(t), y(v)); });
    g.lineTo(x(span), y(points[points.length - 1][1]));
  } else m.forEach((v, i) => g.lineTo(x(times[i]), y(v)));
  g.stroke();
  g.restore();
  if (!big) return axes;
  g.font = "10px sans-serif"; g.fillStyle = "#888";
  for (let k = Math.ceil(t0 / step); k * step <= t1 + 1e-9; k++) {
    const text = `${+(k * step).toFixed(2)} s`, w = g.measureText(text).width;
    g.fillText(text, Math.min(W - R - w, Math.max(0, x(k * step) - w / 2)), H - 3);
  }
  const marks = [];  // level labels left, strength labels right: top, bottom, then whole levels where they fit
  for (const v of [hi, lo, ...whole]) {
    const py = Math.min(T + ph, Math.max(T + 8, y(v) + 4));
    if (v >= lo && v <= hi && marks.every(([, q]) => Math.abs(q - py) >= 13)) marks.push([v, py]);
  }
  for (const [v, py] of marks) {
    g.textAlign = "right"; g.fillStyle = "#888"; g.fillText(`${+v.toFixed(2)}`, L - 6, py);
    g.textAlign = "left"; g.fillStyle = v >= 0 && v <= 1 ? "#c39bff" : "#666";
    if (strength !== null) g.fillText(v >= 0 && v <= 1 ? `${+(v * strength).toFixed(2)}` : `(${+(v * strength).toFixed(2)})`, L + pw + 5, py);
  }
  if (strength !== null) {  // the strength axis is exact from level 0 to 1, dashed grey where the blend extrapolates
    const ax = L + pw + 2.5, y0 = Math.min(T + ph, Math.max(T, y(0))), y1 = Math.min(T + ph, Math.max(T, y(1)));
    g.lineWidth = 1; g.strokeStyle = "#555"; g.setLineDash([2, 3]);
    g.beginPath(); g.moveTo(ax, T); g.lineTo(ax, T + ph); g.stroke(); g.setLineDash([]);
    g.strokeStyle = "#c39bff"; g.beginPath(); g.moveTo(ax, y0); g.lineTo(ax, y1); g.stroke();
    g.fillStyle = "#c39bff";
    g.save(); g.translate(W - 3, T + ph / 2); g.rotate(-Math.PI / 2); g.textAlign = "center";
    g.fillText(`strength (×${+strength.toFixed(2)})`, 0, 0); g.restore();
  }
  if (!keys) return axes;
  const sel = view.sel || [];
  points.forEach(([t, v], i) => {
    if (x(t) < L - 7 || x(t) > L + pw + 7) return;
    g.beginPath(); g.arc(x(t), y(v), i === view.main ? 7 : i === view.hover ? 6.5 : sel.includes(i) ? 6 : 5.5, 0, 2 * Math.PI);
    g.fillStyle = sel.includes(i) ? "#ffc145" : i === view.hover ? "#c9dbff" : "#8fb4ff"; g.fill();
    g.strokeStyle = i === view.main ? "#fff" : "#101114"; g.lineWidth = 1.5; g.stroke();
  });
  if (view.ghost) {
    g.beginPath(); g.arc(x(view.ghost[0]), y(view.ghost[1]), 5.5, 0, 2 * Math.PI);
    g.strokeStyle = "#8fb4ff"; g.lineWidth = 1; g.stroke();
  }
  if (view.box) {
    const [x0, y0, x1, y1] = view.box;
    g.fillStyle = "rgba(255,193,69,0.08)"; g.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
    g.strokeStyle = "#ffc145"; g.lineWidth = 1; g.setLineDash([4, 3]);
    g.strokeRect(Math.min(x0, x1) + 0.5, Math.min(y0, y1) + 0.5, Math.abs(x1 - x0), Math.abs(y1 - y0)); g.setLineDash([]);
  }
  if (view.label) {  // next to its point, flipped to stay inside the canvas
    const [t, v, text] = view.label, px = x(t), py = y(v);
    g.font = "11px sans-serif";
    const w = g.measureText(text).width + 8, bx = px + 10 + w > W - R ? px - 10 - w : px + 10, by = py - 24 < 0 ? py + 8 : py - 24;
    g.fillStyle = "rgba(16,17,20,0.88)"; g.fillRect(bx, by, w, 16);
    g.fillStyle = "#eee"; g.fillText(text, bx + 4, by + 12);
  }
  return axes;
}

async function presetRequest(path = "", options) {
  const response = await api.fetchApi(PRESETS + path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Preset request failed (${response.status})`);
  return data;
}

let dialFiles = null;
async function listDials(force) {
  if (!dialFiles || force) {
    const r = await api.fetchApi("/models/loras");
    const all = r.ok ? await r.json() : [];
    // folders starting with "_" hold parked or invalid dials (e.g. dials/_v1_contaminated/): not offered
    dialFiles = all.map((f) => (typeof f === "string" ? f : f.name)).map((f) => f.replace(/\\/g, "/"))
      .filter((f) => f.startsWith("dials/") && !f.split("/").slice(1, -1).some((d) => d.startsWith("_"))).sort();
  }
  return dialFiles;
}

const shortName = (f) => f.replace(/\\/g, "/").replace(/^dials\//, "").replace(/\.safetensors$/, "")
  .replace(/^h3_/, "").replace(/_hook$/, "").replace(/_/g, " ");
// readable names, falling back to the file name where two files would read the same (e.g. h3_x and h3_x_hook)
function labels(files) {
  const count = {};
  for (const f of files) count[shortName(f)] = (count[shortName(f)] || 0) + 1;
  return (f) => (count[shortName(f)] > 1 ? f.replace(/^dials\//, "").replace(/\.safetensors$/, "") : shortName(f));
}
const fmt = (v) => (v >= 0 ? "+" : "") + Number(v).toFixed(2);
const snap = (v) => Math.round(v * 20) / 20;
const clampStrength = (v) => Math.min(NUMBER[1], Math.max(NUMBER[0], v));

// The map: two rack rows are the axes and the dot is the prompt; dragging it sets both rows' strengths.
// Saved pairings (X/Y row pairs) are chips above it; clicking one switches the map to that pair.
class DialMap {
  constructor(rack, parent) {
    this.rack = rack;
    this.size = 0;
    const el = (...a) => rack.el(...a);
    this.box = el("div", { display: "flex", flexDirection: "column", gap: "5px", height: "100%", minWidth: "0" }, parent);
    this.chips = el("div", { display: "flex", gap: "4px", flexWrap: "wrap", alignItems: "center" }, this.box);
    const controls = el("div", { display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap" }, this.box);
    const pick = (label, title) => {
      el("span", { color: "#888" }, controls, label);
      const sel = el("select", { background: "#111", color: "#eee", border: "1px solid #333", maxWidth: "130px" }, controls);
      sel.title = title;
      return sel;
    };
    this.selX = pick("X", "row moved by left/right in this pairing");
    this.selY = pick("Y", "row moved by up/down in this pairing");
    this.selRange = pick("±", "how far the map edges reach");
    for (const v of PAD_RANGES) el("option", {}, this.selRange, String(v)).value = v;
    this.selStep = pick("step", "spacing of the 3×3 sweep around the dot");
    for (const v of SWEEP_STEPS) el("option", {}, this.selStep, String(v)).value = v;
    this.selX.onchange = () => { this.pair.x = Number(this.selX.value); rack.render(); };
    this.selY.onchange = () => { this.pair.y = Number(this.selY.value); rack.render(); };
    this.selRange.onchange = () => { rack.pad.range = this.selRange.value === "auto" ? "auto" : Number(this.selRange.value); this.draw(); };
    this.selStep.onchange = () => { rack.pad.step = Number(this.selStep.value); this.draw(); };
    this.selView = pick("view", "map: two rows on X/Y · wheel: every live post row on the probe-bank axes");
    for (const v of ["map", "wheel"]) el("option", {}, this.selView, v).value = v;
    this.selFit = pick("fit", "wheel: direct probe coefficients, or the joint ridge fit (shares credit between correlated probes)");
    for (const v of ["direct", "joint"]) el("option", {}, this.selFit, v).value = v;
    this.selView.onchange = () => { rack.pad.view = this.selView.value; rack.render(); };
    this.selFit.onchange = () => { rack.pad.fit = this.selFit.value; this.draw(); };
    this.sweepButton = rack.button(controls, "Sweep 3×3", "queue 9 renders on a grid around the dot, then put the dot back", () => this.sweep());
    this.stage = el("div", { flex: "0 0 auto", display: "flex", justifyContent: "center" }, this.box);
    this.canvas = el("canvas", { cursor: "crosshair", borderRadius: "4px", outline: "none" }, this.stage);
    this.canvas.tabIndex = 0;
    this.canvas.title = "drag: move both dials · Shift+drag: fine · arrows: ±0.05 (Shift ±0.25) · double-click: back to 0";
    this.readout = el("div", { color: "#9a9ba0", fontSize: "11px", whiteSpace: "pre-wrap", flex: "0 1 auto", minHeight: READOUT_MIN + "px", overflowY: "auto" }, this.box);
    this.sizer = new ResizeObserver(() => this.fit());
    this.sizer.observe(this.box);

    const toStrength = (px) => (px / this.size * 2 - 1) * this.R;
    let drag = null;
    this.canvas.addEventListener("pointerdown", (e) => {
      const [rx, ry] = this.axes();
      if (!rx || !ry || rx === ry) return;
      this.canvas.setPointerCapture(e.pointerId);
      drag = { x0: e.offsetX, y0: e.offsetY, sx: Number(rx.strength), sy: Number(ry.strength) };
      if (!e.shiftKey) this.set(toStrength(e.offsetX), -toStrength(e.offsetY));
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (e.shiftKey) {  // fine: relative motion at a fifth of the speed
        const k = 0.2 * 2 * this.R / this.size;
        this.set(drag.sx + (e.offsetX - drag.x0) * k, drag.sy - (e.offsetY - drag.y0) * k);
      } else {
        this.set(toStrength(e.offsetX), -toStrength(e.offsetY));
        const [rx, ry] = this.axes();
        drag = { x0: e.offsetX, y0: e.offsetY, sx: Number(rx.strength), sy: Number(ry.strength) };
      }
    });
    this.canvas.addEventListener("pointerup", () => { drag = null; });
    this.canvas.addEventListener("dblclick", () => this.set(0, 0));
    this.canvas.addEventListener("keydown", (e) => {
      const d = e.shiftKey ? 0.25 : 0.05;
      const move = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key];
      const [rx, ry] = this.axes();
      if (!move || !rx || !ry || rx === ry) return;
      e.preventDefault();
      this.set(Number(rx.strength) + move[0], Number(ry.strength) + move[1]);
    });
  }

  get pair() { return this.rack.pad.pairs[this.rack.pad.active]; }
  axes() { return [this.rack.rows[this.pair.x], this.rack.rows[this.pair.y]]; }

  set(sx, sy) {
    const [rx, ry] = this.axes();
    rx.strength = snap(clampStrength(sx));
    ry.strength = snap(clampStrength(sy));
    this.rack.commit();
    this.rack.render();
  }

  fit() {  // the map is the only thing that follows the node's size: the largest square left after the controls and readouts
    const shown = [...this.box.children].filter((c) => c !== this.stage && c !== this.readout && c.offsetHeight > 0);
    const free = this.box.clientHeight - shown.reduce((h, c) => h + c.offsetHeight + 5, READOUT_MIN + 5);
    const size = Math.max(MAP_MIN, Math.floor(Math.min(this.stage.clientWidth, free)));
    if (size === this.size) return;
    this.size = size;
    const dpr = window.devicePixelRatio || 1;
    Object.assign(this.canvas.style, { width: size + "px", height: size + "px" });
    this.canvas.width = this.canvas.height = Math.round(size * dpr);
    Object.assign(this.rack.wheel.canvas.style, { width: size + "px", height: size + "px" });
    this.rack.wheel.canvas.width = this.rack.wheel.canvas.height = this.canvas.width;
    this.draw();
  }

  render() {
    const rack = this.rack, pad = rack.pad, axes = rack.padAxes();
    for (const pr of pad.pairs) {
      if (!axes.includes(pr.x)) pr.x = axes[0];
      if (!axes.includes(pr.y) || (pr.y === pr.x && axes.length > 1)) pr.y = axes.find((i) => i !== pr.x) ?? axes[0];
    }
    this.chips.replaceChildren();
    pad.pairs.forEach((pr, i) => {
      const label = [pr.x, pr.y].map((r) => (rack.rows[r] ? rack.rowName(r).replace(/^\d+\. /, "") : "?")).join(" × ");
      const on = i === pad.active;
      rack.button(this.chips, label, "switch the map to this pairing", () => { pad.active = i; rack.render(); },
        on ? { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145", padding: "1px 7px" } : { padding: "1px 7px" });
    });
    rack.button(this.chips, "+ pairing", "add another X/Y pairing and switch to it", () => {
      const used = pad.pairs.flatMap((pr) => [pr.x, pr.y]);
      const fresh = axes.filter((i) => !used.includes(i));
      pad.pairs.push({ x: fresh[0] ?? axes[0], y: fresh[1] ?? axes.find((i) => i !== (fresh[0] ?? axes[0])) });
      pad.active = pad.pairs.length - 1;
      rack.render();
    }, { padding: "1px 7px" });
    if (pad.pairs.length > 1) rack.button(this.chips, "✕", "remove this pairing", () => {
      pad.pairs.splice(pad.active, 1); pad.active = Math.max(0, pad.active - 1); rack.render();
    }, { padding: "1px 6px" });
    for (const [sel, v] of [[this.selX, this.pair.x], [this.selY, this.pair.y]]) {
      sel.replaceChildren();
      for (const i of axes) rack.el("option", {}, sel, rack.rowName(i)).value = i;
      if (v !== undefined) sel.value = v;
    }
    this.selRange.value = String(pad.range);
    this.selView.value = pad.view || "map";
    this.selFit.value = pad.fit || "direct";
    this.selStep.value = pad.step;
    this.fit();
    this.draw();
  }

  draw() {
    if (!this.size) return;
    const wheel = this.rack.pad.view === "wheel";
    this.canvas.style.display = wheel ? "none" : "";
    this.rack.wheel.canvas.style.display = wheel ? "" : "none";
    if (wheel) return this.rack.wheel.draw();
    const c = this.canvas, g = c.getContext("2d"), S = this.size, rack = this.rack;
    const [rx, ry] = this.axes();
    const info = (r) => (r && !("input" in r) ? rack.dialInfo(r.dial) : INFO_DEFAULTS);
    const ix = info(rx), iy = info(ry);
    // auto range: room for the largest known overcook plus a margin
    const overcooks = [ix.neg, ix.pos, iy.neg, iy.pos].map((v) => v.overcook).filter((v) => v != null);
    const R = this.R = rack.pad.range !== "auto" ? rack.pad.range
      : overcooks.length ? Math.max(1.5, Math.ceil(Math.max(...overcooks) * 1.25 * 2) / 2) : 3;
    const px = (v) => (v / R + 1) / 2 * S;
    g.setTransform(c.width / S, 0, 0, c.width / S, 0, 0);
    g.fillStyle = "#101114"; g.fillRect(0, 0, S, S);
    g.strokeStyle = "#1e2026"; g.lineWidth = 1;
    const grid = R > 4 ? 1 : 0.5;
    for (let v = -Math.floor(R / grid) * grid; v <= R + 1e-9; v += grid) {
      g.beginPath(); g.moveTo(px(v), 0); g.lineTo(px(v), S); g.moveTo(0, px(v)); g.lineTo(S, px(v)); g.stroke();
    }
    g.strokeStyle = "#3a3d46"; g.beginPath(); g.moveTo(px(0), 0); g.lineTo(px(0), S); g.moveTo(0, px(0)); g.lineTo(S, px(0)); g.stroke();
    // a quarter-ellipse per quadrant from the matching sides' info; a quadrant without any known ring is uncalibrated
    g.font = "10px sans-serif";
    const labelled = new Set();
    for (const [qx, qy] of QUADRANTS) {
      const a0 = qy > 0 ? (qx > 0 ? -Math.PI / 2 : Math.PI) : (qx > 0 ? 0 : Math.PI / 2);
      const arc = (rxv, ryv, color, dash, text) => {
        const ax = rxv / R * S / 2, ay = ryv / R * S / 2;
        g.setLineDash(dash); g.strokeStyle = color; g.beginPath();
        g.ellipse(px(0), px(0), ax, ay, 0, a0, a0 + Math.PI / 2); g.stroke(); g.setLineDash([]);
        if (labelled.has(text)) return;
        labelled.add(text);
        g.fillStyle = "#666";
        g.fillText(text, px(0) + 3, px(0) - qy * ay + 11);
      };
      const hx = side(ix, qx), hy = side(iy, qy);
      let known = false;
      for (const [kind, color, dash, text] of [["useful", "#3f6b4a", [], "useful"], ["overcook", "#7a5a22", [4, 4], "overcooked"]]) {
        if (hx[kind] == null || hy[kind] == null) continue;
        arc(hx[kind], hy[kind], color, dash, text);
        known = true;
      }
      if (!known) arc(1, 1, "#5d6069", [2, 4], "uncalibrated");
    }
    if (!rx || !ry || rx === ry) {
      g.fillStyle = "#888"; g.fillText(rack.rows.length < 2 ? "add two dial rows to use the map" : "pick two different rows", 8, 16);
      this.readout.textContent = "";
      this.sweepButton.disabled = true;
      return;
    }
    this.sweepButton.disabled = !!rack.sweeping;
    const sx = Number(rx.strength), sy = Number(ry.strength), step = rack.pad.step;
    g.fillStyle = "#4a4d57";
    for (const dy of [-step, 0, step]) for (const dx of [-step, 0, step]) {
      if (dx || dy) { g.beginPath(); g.arc(px(sx + dx), px(-(sy + dy)), 2, 0, 2 * Math.PI); g.fill(); }
    }
    const reach = (kind) => {  // the dot's ellipse distance in its own quadrant; null when a side it leans on is unknown
      let d = 0;
      for (const [s, info] of [[sx, ix], [sy, iy]]) {
        if (!s) continue;
        const r = side(info, s)[kind];
        if (r == null) return null;
        d += (s / r) ** 2;
      }
      return Math.sqrt(d);
    };
    const useful = reach("useful"), over = reach("overcook");
    const status = over > 1 ? "overcooked" : useful === null ? "uncalibrated" : useful <= 1 ? "within useful"
      : over === null ? "past useful (overcook unknown)" : "past useful";
    g.fillStyle = { overcooked: "#ff6b5c", uncalibrated: "#b4b7bf", "within useful": "#ffc145" }[status] || "#ffa64d";
    g.beginPath(); g.arc(px(Math.max(-R, Math.min(R, sx))), px(-Math.max(-R, Math.min(R, sy))), 6, 0, 2 * Math.PI); g.fill();
    g.fillStyle = "#ddd";
    const xl = `${ix.positive || rack.rowName(this.pair.x)} →`;
    g.fillText(xl, S - 4 - g.measureText(xl).width, px(0) - 4);
    if (ix.negative) g.fillText(`← ${ix.negative}`, 4, px(0) - 4);
    g.fillText(`↑ ${iy.positive || rack.rowName(this.pair.y)}`, px(0) + 4, 12);
    if (iy.negative) g.fillText(`↓ ${iy.negative}`, px(0) + 4, S - 6);
    let text = `X ${rack.rowName(this.pair.x)} ${fmt(sx)}  ·  Y ${rack.rowName(this.pair.y)} ${fmt(sy)}  ·  ${status}`;
    const geo = rack.padGeometry[rx.dial + "|" + ry.dial];
    if (geo === undefined) rack.padNorms(rx, ry);
    if (geo?.error) text += `\n${geo.error}`;
    else if (geo && geo.mode[0] !== geo.mode[1]) text += "\ndifferent injection points (pre/post): no combined readout";
    else if (geo && geo.cos[0][1] !== null) {
      const [nx, ny] = geo.norm, cos = geo.cos[0][1];
      const push = Math.sqrt(Math.max(0, (sx * nx) ** 2 + (sy * ny) ** 2 + 2 * sx * sy * nx * ny * cos)) / ((nx + ny) / 2);
      text += `\noverlap cos ${fmt(cos)}${Math.abs(cos) >= 0.5 ? (sx * sy * cos > 0 ? " (they reinforce)" : sx * sy * cos < 0 ? " (they cancel)" : "") : ""}` +
        `  ·  push ≈ ${push.toFixed(2)}× one dial at +1`;
    } else if ("input" in rx || "input" in ry) text += "\nwired dial: strengths only (no file to measure)";
    this.readout.textContent = text;
  }

  async sweep() {
    const rack = this.rack, [rx, ry] = this.axes(), step = rack.pad.step, pair = this.pair;
    const sx = Number(rx.strength), sy = Number(ry.strength);
    rack.sweeping = true;
    rack.render();
    let queued = 0;
    try {
      for (const dy of [step, 0, -step]) for (const dx of [-step, 0, step]) {
        rx.strength = snap(clampStrength(sx + dx));
        ry.strength = snap(clampStrength(sy + dy));
        rack.commit();
        await app.queuePrompt(0, 1);
        queued++;
      }
      rack.presetMessage = `Queued ${queued} renders: ${rack.rowName(pair.x)} ${fmt(sx - step)}…${fmt(sx + step)}, ` +
        `${rack.rowName(pair.y)} ${fmt(sy - step)}…${fmt(sy + step)} (rows top to bottom = Y high to low).`;
    } catch (e) {
      rack.presetMessage = `Sweep stopped after ${queued} of 9: ${e.message}`;
    } finally {
      rx.strength = sx; ry.strength = sy;
      rack.sweeping = false;
      rack.commit();
      rack.render();
    }
  }
}

// Exact energy bookkeeping of stacked post-refiner rows, as core.interactions: own_i = s_i²|v_i|², pair_ij = 2 s_i s_j v_i·v_j
// (warm = reinforcing, blue = cancelling), both as shares of |Σ s_i v_i|², and push_i = s_i v_i·u along the unit sum.
function interactions(dots, s) {
  const w = dots.map((r, i) => r.map((d, j) => s[i] * s[j] * d));
  const own = w.map((r, i) => r[i]);
  const energy = w.flat().reduce((a, b) => a + b, 0);
  const cancelled = energy <= 1e-12 * own.reduce((a, b) => a + b, 0);
  const combined = cancelled ? 0 : Math.sqrt(energy);
  const norm = dots.map((r, i) => Math.sqrt(Math.max(0, r[i])));
  return {
    combined,
    cos: dots.map((r, i) => r.map((d, j) => (norm[i] * norm[j] > 0 ? d / (norm[i] * norm[j]) : 0))),
    pair: w.map((r, i) => r.map((v, j) => (i === j || cancelled ? 0 : 2 * v / energy))),
    own: own.map((v) => (cancelled ? 0 : v / energy)),
    push: w.map((r) => (combined ? r.reduce((a, b) => a + b, 0) / combined / combined : 0)),
  };
}

const pct = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(Math.round(v * 100)) + "%";
const shade = (v) => (Math.abs(v) < 0.005 ? "#1b1d23" : v > 0 ? `rgba(255,140,60,${0.15 + 0.7 * Math.min(1, v / 0.5)})`
  : `rgba(80,140,255,${0.15 + 0.7 * Math.min(1, -v / 0.5)})`);

// Under the map: rows × rows matrix of the live post-refiner rows and a "who pushes" bar per row. Dot products come from
// the server once per set of dial files; strengths are applied here, so it follows the sliders without a request.
// Row layers on the wheel: identity colours only. Nothing here is a risk colour; the wheel stays uncalibrated (grey).
const WHEEL_COLOURS = ["#8fb4ff", "#c39bff", "#6fd3c9", "#e3a6ec", "#9d9dff", "#7fd0ff", "#b8c4ff", "#a6e3e0"];
const BANK_NOTES = {  // measured for the bank in the atlas P3 study
  "h3-probes-v1": "Probe labels are hypotheses, not output evidence. Read the top few axes, not one: the single top axis " +
    "flips between two wordings of the bank for 7 of 28 seeded dials. Unexplained: ≈0.53 is what a re-worded probe " +
    "itself leaves (in-bank ceiling), ≈0.97 what a placebo direction leaves; seeded dials average ≈0.69.",
};

// The influence wheel: fixed sectors = the probe bank's axes; each live post row is a layer of its probe profile times its
// strength, outward = the axis' + label, inward = its − label, around the zero ring; the sum is drawn on top.
class DialWheel {
  constructor(rack, map) {
    this.rack = rack;
    this.map = map;
    this.profiles = {};
    this.hover = null;
    this.canvas = rack.el("canvas", { display: "none", borderRadius: "4px" }, map.stage);
    this.canvas.addEventListener("pointermove", (e) => { this.hover = this.sectorAt(e.offsetX, e.offsetY); this.draw(); });
    this.canvas.addEventListener("pointerleave", () => { this.hover = null; this.draw(); });
  }

  profile(file) {  // fetched once per file; the server caches by vector hash and bank version
    if (!(file in this.profiles)) {
      this.profiles[file] = null;
      api.fetchApi(`/mainodes/dials/profile?dial=${encodeURIComponent(file)}`).then(async (r) => {
        const data = await r.json();
        this.profiles[file] = r.ok ? data : { error: data.error };
        this.map.draw();
      }).catch((e) => { this.profiles[file] = { error: e.message }; this.map.draw(); });
    }
    return this.profiles[file];
  }

  sectorAt(x, y) {
    const n = this.axes?.length, c = this.map.size / 2;
    if (!n || Math.hypot(x - c, y - c) > c) return null;
    const a = Math.atan2(y - c, x - c) + Math.PI / 2;
    return Math.round(((a / (2 * Math.PI)) * n + n) % n) % n;
  }

  layers() {
    const rack = this.rack, rows = rack.rows, fit = rack.pad.fit || "direct", notes = [], layers = [];
    let bank = null;
    for (const i of rack.matrix.live()) {
      if ("input" in rows[i]) { notes.push(`${rack.rowName(i)}: wired, not measured`); continue; }
      const p = this.profile(rows[i].dial);
      if (!p) { notes.push(`${rack.rowName(i)}: measuring…`); continue; }
      if (p.error) { notes.push(`${rack.rowName(i)}: ${p.error}`); continue; }
      bank ||= p;
      if (p.bank !== bank.bank || p.version !== bank.version) { notes.push(`${rack.rowName(i)}: profile from another bank version`); continue; }
      const s = Number(rows[i].strength);
      layers.push({ i, values: p[fit].map((v) => s * v), unexplained: p.unexplained, colour: WHEEL_COLOURS[layers.length % WHEEL_COLOURS.length] });
    }
    const sum = bank ? bank.axes.map((_, j) => layers.reduce((t, l) => t + l.values[j], 0)) : [];
    return { bank, layers, sum, notes, fit };
  }

  draw() {
    const S = this.map.size, c = this.canvas, g = c.getContext("2d"), rack = this.rack, el = (...a) => rack.el(...a);
    const { bank, layers, sum, notes, fit } = this.layers();
    this.axes = bank?.axes;
    g.setTransform(c.width / S, 0, 0, c.width / S, 0, 0);
    g.fillStyle = "#101114"; g.fillRect(0, 0, S, S);
    const readout = this.map.readout;
    readout.replaceChildren();
    if (!bank) {
      g.fillStyle = "#888"; g.font = "11px sans-serif";
      g.fillText(layers.length || notes.length ? "no post-refiner row with a probe profile" : "add a live post-refiner dial row", 8, 16);
      for (const n of notes) el("div", {}, readout, n);
      return;
    }
    const n = bank.axes.length, C = S / 2, outer = S / 2 - 26, zero = outer * 0.5;
    const top = Math.max(0.25, ...sum.map(Math.abs), ...layers.flatMap((l) => l.values.map(Math.abs)));
    const k = (outer - zero) * 0.95 / top;
    const angle = (j) => -Math.PI / 2 + 2 * Math.PI * j / n;
    const point = (j, v) => { const r = Math.max(4, zero + v * k); return [C + r * Math.cos(angle(j)), C + r * Math.sin(angle(j))]; };
    const ring = (r, dash, colour) => { g.setLineDash(dash); g.strokeStyle = colour; g.beginPath(); g.arc(C, C, r, 0, 2 * Math.PI); g.stroke(); g.setLineDash([]); };
    if (this.hover !== null) {
      g.fillStyle = "#1c1e24"; g.beginPath(); g.moveTo(C, C);
      g.arc(C, C, outer, angle(this.hover) - Math.PI / n, angle(this.hover) + Math.PI / n); g.fill();
    }
    g.strokeStyle = "#23252c"; g.lineWidth = 1;
    for (let j = 0; j < n; j++) { g.beginPath(); g.moveTo(C, C); g.lineTo(C + outer * Math.cos(angle(j)), C + outer * Math.sin(angle(j))); g.stroke(); }
    if (k < outer - zero) { ring(zero + k, [2, 4], "#3a3d46"); ring(Math.max(4, zero - k), [2, 4], "#3a3d46"); }
    ring(zero, [5, 4], "#6a6d76");
    const shape = (values, stroke, fill, width) => {
      g.beginPath();
      values.forEach((v, j) => { const [x, y] = point(j, v); j ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); }
      g.lineWidth = width; g.strokeStyle = stroke; g.stroke(); g.lineWidth = 1;
    };
    for (const l of layers) shape(l.values, l.colour, l.colour + "26", 1.5);
    shape(sum, "#d8d8d8", null, 2.5);
    g.fillStyle = "#d8d8d8";
    sum.forEach((v, j) => { const [x, y] = point(j, v); g.beginPath(); g.arc(x, y, 2.5, 0, 2 * Math.PI); g.fill(); });
    g.font = "10px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    bank.axes.forEach((_, j) => {
      g.fillStyle = j === this.hover ? "#eee" : "#9a9ba0";
      g.fillText(bank.positive[j], C + (outer + 13) * Math.cos(angle(j)), C + (outer + 13) * Math.sin(angle(j)));
      if (j === this.hover) g.fillText(bank.negative[j], C + zero * 0.55 * Math.cos(angle(j)), C + zero * 0.55 * Math.sin(angle(j)));
    });
    g.textAlign = "start"; g.textBaseline = "alphabetic";
    g.fillStyle = "#777";
    g.fillText(`${bank.bank} v${bank.version} · ${fit} · probe units · uncalibrated`, 6, S - 6);

    const line = (text, colour) => el("div", { color: colour || "#9a9ba0" }, readout, text);
    if (this.hover !== null) {
      const j = this.hover;
      line(`${bank.axes[j]}: ${bank.negative[j]} ↔ ${bank.positive[j]} (a probe dial from prompt pairs; the label is a hypothesis) · sum ${fmt(sum[j])}`, "#ddd");
      for (const l of layers) line(`  ${rack.rowName(l.i)} ${fmt(l.values[j])}`, l.colour);
      const partners = (bank.correlated || []).filter((c) => c[0] === bank.axes[j] || c[1] === bank.axes[j]);
      if (partners.length) line(`correlated probes: ${partners.map((c) => `${c[0] === bank.axes[j] ? c[1] : c[0]} (cos ${c[2].toFixed(2)})`).join(", ")}: they share credit`);
    } else {
      for (const l of layers) line(`${rack.rowName(l.i)}: unexplained by the bank ${l.unexplained.toFixed(2)}`, l.colour);
    }
    for (const note of notes) line(note);
    line(`${fit === "joint" ? `joint ridge fit (λ ${bank.lambda})` : "direct coefficients (v·p)/(p·p)"}; outward = + label, inward = − label, ` +
      "dashed rings = ±1 probe. " + (BANK_NOTES[bank.bank] || "Probe labels are hypotheses, not output evidence."), "#777");
  }
}

class DialMatrix {
  constructor(rack, parent) {
    this.rack = rack;
    this.dots = {};
    this.box = rack.el("div", { flex: "0 0 auto", display: "flex", flexDirection: "column", gap: "4px", fontSize: "11px", color: "#9a9ba0" }, parent);
  }

  live() {  // rows the rack applies, in the backend's on / strength / solo terms, minus holds
    const rows = this.rack.rows, active = (r) => r.on && (r.hold || Number(r.strength) !== 0);
    const anySolo = rows.some((r) => active(r) && r.solo);
    return rows.map((r, i) => i).filter((i) => active(rows[i]) && (!anySolo || rows[i].solo) && !rows[i].hold);
  }

  async fetch(key, files) {
    this.dots[key] = null;
    try {
      const r = await api.fetchApi("/mainodes/dials/interactions", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: files.map((dial) => ({ dial, strength: 1 })) }) });
      const data = await r.json();
      this.dots[key] = r.ok ? { files, ...data } : { error: data.error };
    } catch (e) { this.dots[key] = { error: e.message }; }
    this.draw();
  }

  draw() {
    const rack = this.rack, rows = rack.rows, live = this.live(), el = (...a) => rack.el(...a);
    this.box.replaceChildren();
    const files = [...new Set(live.filter((i) => !("input" in rows[i])).map((i) => rows[i].dial))].sort();
    const key = files.join("|"), geo = this.dots[key];
    if (files.length && geo === undefined) this.fetch(key, files);
    if (!geo) { if (files.length) el("div", {}, this.box, "interactions: measuring…"); return; }
    if (geo.error) { el("div", { color: "#ff8a5c" }, this.box, `interactions: ${geo.error}`); return; }
    const at = (i) => geo.files.indexOf(rows[i].dial);
    const post = live.filter((i) => !("input" in rows[i]) && geo.mode[at(i)] === "post");
    const notes = [];
    const pre = live.filter((i) => !("input" in rows[i]) && geo.mode[at(i)] === "pre");
    if (pre.length) notes.push(`pre-refiner rows are a separate space, not in the matrix: ${pre.map((i) => rack.rowName(i)).join(", ")}`);
    const wired = live.filter((i) => "input" in rows[i]);
    if (wired.length) notes.push(`wired rows are not measured: ${wired.map((i) => rows[i].input).join(", ")}`);
    if (post.length < 2) notes.unshift("interactions: needs two live post-refiner dial rows");
    else this.matrix(post, interactions(post.map((i) => post.map((j) => geo.dot[at(i)][at(j)])), post.map((i) => Number(rows[i].strength))));
    for (const n of notes) el("div", {}, this.box, n);
  }

  matrix(post, it) {
    const rack = this.rack, el = (...a) => rack.el(...a), n = post.length;
    const pairs = it.pair.flat().reduce((a, b) => a + b, 0) / 2;
    el("div", { color: "#ccc" }, this.box, it.combined ? `interactions · |sum| ${it.combined.toFixed(1)} · pairs add ${pct(pairs)} of |sum|²` : "interactions · the rows sum to zero");
    const grid = el("div", { display: "grid", gridTemplateColumns: `minmax(60px, max-content) repeat(${n}, 38px)`, gap: "2px", alignItems: "center" }, this.box);
    el("span", {}, grid, "");
    for (const j of post) el("span", { textAlign: "center", color: "#888" }, grid, String(j + 1));
    post.forEach((i, a) => {
      el("span", { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "140px" }, grid, rack.rowName(i));
      post.forEach((j, b) => {
        const v = a === b ? it.own[a] : it.pair[a][b];
        const cell = el("span", { textAlign: "center", padding: "2px 0", borderRadius: "3px", color: "#eee",
          background: a === b ? "#2a2c33" : shade(v) }, grid, it.combined ? pct(v) : "·");
        cell.title = a === b
          ? `${rack.rowName(i)} alone: ${pct(v)} of |sum|²`
          : `${rack.rowName(i)} × ${rack.rowName(j)}: cos ${fmt(it.cos[a][b])}, pair energy ${pct(v)} of |sum|² — ` +
            (v > 0.005 ? "reinforcing: they push the same way" : v < -0.005 ? "cancelling: they push against each other" : "about independent") +
            "\nexact vector math on the dial files; the output effect is untested";
      });
    });
    el("div", { color: "#ccc", marginTop: "2px" }, this.box, "who pushes (along the sum)");
    const bars = el("div", { display: "grid", gridTemplateColumns: "minmax(60px, max-content) 120px 40px", gap: "2px 6px", alignItems: "center" }, this.box);
    post.forEach((i, a) => {
      const v = it.push[a], w = Math.min(1, Math.abs(v)) * 60;
      el("span", { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "140px" }, bars, rack.rowName(i));
      const track = el("span", { position: "relative", height: "8px", background: "#1b1d23", borderRadius: "2px" }, bars);
      el("span", { position: "absolute", top: 0, bottom: 0, left: v >= 0 ? "60px" : `${60 - w}px`, width: `${w}px`,
        background: v >= 0 ? "#ffa64d" : "#5a8cff", borderRadius: "2px" }, track);
      el("span", { position: "absolute", top: "-2px", bottom: "-2px", left: "60px", width: "1px", background: "#555" }, track);
      track.title = `${rack.rowName(i)} moves the combined shift by ${pct(v)} of |sum| (negative: it pulls against the others)`;
      el("span", { textAlign: "right" }, bars, pct(v));
    });
  }
}

// The dial editor: v' = v + Σ c_j q_j over the bank's probe vectors (c = Δβ in probe units) and the library's PC1/PC2 (unit
// vectors). The server sends the Gram numbers once (/mainodes/dials/editor); every readout below is exact from them, and
// export redoes the edit from the edit list on the server. Nothing here touches the rack's rows until "add as row".
const dotv = (a, b) => a.reduce((t, x, i) => t + x * b[i], 0);
const quad = (c, m) => c.reduce((t, x, i) => t + x * dotv(c, m[i]), 0);
const NEAR = 5;  // labelled neighbours
const signed = (v, d = 2) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d);
function solve2(J, d) {  // J·[a, b] = d; a singular J (identical directions, a zero component) moves along the first only
  const det = J[0][0] * J[1][1] - J[0][1] * J[1][0];
  if (Math.abs(det) > 1e-9 * Math.abs(J[0][0] * J[1][1])) return [(d[0] * J[1][1] - d[1] * J[0][1]) / det, (d[1] * J[0][0] - d[0] * J[1][0]) / det];
  return [J[0][0] ? d[0] / J[0][0] : 0, 0];
}

class DialEditor {
  constructor(rack, r) {
    this.rack = rack;
    this.r = r;
    this.file = r.dial;
    this.ops = [];
    this.view = "bars";
    this.basis = { kind: "pca", x: 0, y: 1 };
    const el = (...a) => rack.el(...a);
    this.box = el("div", { display: "flex", flexDirection: "column", gap: "5px", padding: "6px", background: "#1b1d23",
      border: "1px solid #2f323b", borderRadius: "4px" });
    this.head = el("div", { display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap" }, this.box);
    this.status = el("div", { color: "#9a9ba0" }, this.box, "loading the probe profile and the dial library…");
    api.fetchApi(`/mainodes/dials/editor?dial=${encodeURIComponent(this.file)}`).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      this.s = data;
      this.build();
    }).catch((e) => {
      this.status.textContent = `Dial editor not available because ${e.message}.`;
      this.status.style.color = "#ff8a5c";
      rack.button(this.head, "Close", "close the dial editor", () => rack.closeEditor(), { padding: "1px 6px" });
      rack.render();
    });
  }

  get fit() { return this.rack.pad.fit || "direct"; }
  get K() { return this.s.bank.axes.length; }

  build() {
    const rack = this.rack, el = (...a) => rack.el(...a), s = this.s;
    this.status.remove();
    el("span", { color: "#ffc145" }, this.head, `Dial editor · ${shortName(this.file)}`);
    const pick = (label, options, value, title, cb) => {
      el("span", { color: "#888" }, this.head, label);
      const sel = el("select", { background: "#111", color: "#eee", border: "1px solid #333" }, this.head);
      for (const [v, text] of options) el("option", {}, sel, text).value = v;
      sel.value = value; sel.title = title; sel.onchange = () => cb(sel.value);
      return sel;
    };
    this.selView = pick("view", [["bars", "probe bars"], ["library", "library map"]], this.view,
      "probe bars: the dial's probe profile, drag a bar · library map: the dial among the saved dials, drag the dot", (v) => { this.view = v; this.draw(); });
    this.selFit = pick("fit", [["direct", "direct"], ["joint", "joint"]], this.fit,
      "direct (v·p)/(p·p), or the joint ridge fit that shares credit between correlated probes (same setting as the wheel)",
      (v) => { rack.pad.fit = v; this.draw(); if (rack.pad.open) rack.map.draw(); });
    rack.button(this.head, "Undo", "undo the last edit", () => { this.ops.pop(); this.draw(); }, { padding: "1px 6px" });
    rack.button(this.head, "Reset", "back to the original dial", () => { this.ops = []; this.draw(); }, { padding: "1px 6px" });
    rack.button(this.head, "Close", "close the editor (unsaved edits are dropped)", () => rack.closeEditor(), { padding: "1px 6px", marginLeft: "auto" });
    this.axisBar = el("div", { display: "flex", gap: "5px", alignItems: "center", flexWrap: "wrap" }, this.box);
    this.canvas = el("canvas", { display: "block", width: "100%", cursor: "ew-resize", touchAction: "none", borderRadius: "4px" }, this.box);
    this.readout = el("div", { color: "#9a9ba0", fontSize: "11px", whiteSpace: "pre-wrap" }, this.box);
    this.pointer();
    this.exportForm();
    rack.render();
  }

  // ---------- the math (exact, from the Gram numbers) ----------
  coeffs() {
    const K = this.K, c = Array(K + 2).fill(0), axes = this.s.bank.axes;
    for (const op of this.ops) {
      if (op.kind === "axis") c[axes.indexOf(op.axis)] += op.delta;
      else if (op.basis === "probes") op.axes.forEach((a, i) => { c[axes.indexOf(a)] += op.delta[i]; });
      else { c[K] += op.delta[0]; c[K + 1] += op.delta[1]; }
    }
    return c;
  }
  coef(c, fit, k) {  // fit coefficient of v' on probe k
    const s = this.s, pp = s.qq[k][k];
    return fit === "joint" ? s.joint[k] + c.reduce((t, x, j) => t + x * s.jq[j][k], 0)
      : s.direct[k] + (pp > 0 ? c.reduce((t, x, j) => t + x * s.qq[j][k], 0) / pp : 0);
  }
  response(fit, k, j) {  // change of coefficient k per unit move along direction j
    const s = this.s;
    return fit === "joint" ? s.jq[j][k] : s.qq[k][k] > 0 ? s.qq[j][k] / s.qq[k][k] : 0;
  }
  measure(c) {
    const s = this.s, K = this.K, n2 = Math.max(0, s.vv + 2 * dotv(c, s.vq) + quad(c, s.qq)), norm = Math.sqrt(n2);
    const one = [1, ...c], r2 = Math.max(0, quad(one, s.rr));
    const cosWith = (vw, qw, ww) => (n2 * ww > 0 ? (vw + dotv(c, qw)) / Math.sqrt(n2 * ww) : 0);
    return {
      norm, cos: cosWith(s.vv, s.vq, s.vv), unexplained: norm > 0 ? Math.sqrt(r2) / norm : 0,
      direct: s.bank.axes.map((_, k) => this.coef(c, "direct", k)), joint: s.bank.axes.map((_, k) => this.coef(c, "joint", k)),
      pc: [0, 1].map((i) => s.pc[i] + c.reduce((t, x, j) => t + x * s.qq[j][K + i], 0)),
      lib: s.library.map((w) => ({ w, cos: cosWith(w.vw, w.qw, w.ww), was: s.vv * w.ww > 0 ? w.vw / Math.sqrt(s.vv * w.ww) : 0 })),
    };
  }
  coords(m, w) {  // library-map position of v' (w = null) or of a library dial
    const b = this.basis;
    if (b.kind === "pca") return w ? w.pc : m.pc;
    const src = w ? w[this.fit] : m[this.fit];
    return [src[b.x], src[b.y]];
  }

  // ---------- drawing ----------
  draw() {
    if (!this.s) return;
    const c = this.coeffs(), m = this.measure(c);
    this.selFit.value = this.fit;
    this.canvas.style.cursor = this.view === "bars" ? "ew-resize" : "move";
    this.axisControls();
    if (this.view === "bars") this.drawBars(m); else this.drawLibrary(m);
    this.readouts(m);
  }

  surface(H) {
    const W = this.canvas.clientWidth || 560, dpr = window.devicePixelRatio || 1;
    this.canvas.style.height = H + "px";
    this.canvas.width = Math.round(W * dpr); this.canvas.height = Math.round(H * dpr);
    const g = this.canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#101114"; g.fillRect(0, 0, W, H);
    g.font = "10px sans-serif";
    return [g, W, H];
  }

  barLayout(W) {
    const left = 190, right = 110, row = 19, top = 16;
    return { left, right, row, top, x0: left, x1: W - right, zero: (left + W - right) / 2 };
  }

  drawBars(m) {
    const s = this.s, K = this.K, fit = this.fit, [g, W] = this.surface(16 + K * 19 + 18), L = this.barLayout(W);
    const orig = s[fit], live = m[fit];
    if (!this.drag) this.R = Math.max(0.5, Math.ceil(Math.max(...orig.map(Math.abs), ...live.map(Math.abs)) * 1.3 * 4) / 4);
    const R = this.R, half = (L.x1 - L.x0) / 2, X = (v) => L.zero + Math.max(-1, Math.min(1, v / R)) * half;
    this.barX = X; this.barValue = (px) => (px - L.zero) / half * R;
    const clustered = new Set((s.bank.correlated || []).flat().filter((x) => typeof x === "string"));
    g.fillStyle = "#777";
    g.fillText(`${signed(-R)}`, L.x0, 11); g.fillText("0", L.zero - 3, 11); g.fillText(`${signed(R)}`, L.x1 - 24, 11);
    s.bank.axes.forEach((axis, k) => {
      const y = L.top + k * L.row, active = this.drag?.k === k || this.hover === k;
      g.fillStyle = active ? "#1f2128" : k % 2 ? "#15161a" : "#121317"; g.fillRect(0, y, W, L.row - 1);
      g.fillStyle = active ? "#eee" : "#bbb"; g.textAlign = "left";
      g.fillText(axis + (clustered.has(axis) ? " ∿" : ""), 4, y + 13);
      g.fillStyle = "#888"; g.textAlign = "right"; g.fillText(`− ${s.bank.negative[k]}`, L.x0 - 6, y + 13);
      g.textAlign = "left"; g.fillText(`${s.bank.positive[k]} +`, L.x1 + 6, y + 13);
      g.fillStyle = live[k] >= 0 ? "#ffa64d" : "#5a8cff";
      g.fillRect(Math.min(X(0), X(live[k])), y + 4, Math.abs(X(live[k]) - X(0)), L.row - 9);
      g.strokeStyle = "#d8d8d8"; g.setLineDash([2, 2]);
      g.strokeRect(Math.min(X(0), X(orig[k])) + 0.5, y + 3.5, Math.abs(X(orig[k]) - X(0)), L.row - 8); g.setLineDash([]);
      if (this.drag?.k === k) { g.fillStyle = "#ffc145"; g.fillRect(X(this.drag.target) - 1, y + 1, 2, L.row - 3); }
      g.fillStyle = Math.abs(live[k] - orig[k]) > 0.005 ? "#ffc145" : "#9a9ba0"; g.textAlign = "right";
      g.fillText(signed(live[k]), W - 4, y + 13);
      g.textAlign = "left";
    });
    g.strokeStyle = "#555"; g.beginPath(); g.moveTo(L.zero + 0.5, L.top); g.lineTo(L.zero + 0.5, L.top + K * L.row); g.stroke();
    g.fillStyle = "#777";
    g.fillText(`${s.bank.bank} v${s.bank.version} · ${fit} · probe units · dashed = original, filled = edited · ∿ correlated probes`, 4, L.top + K * L.row + 12);
  }

  drawLibrary(m) {
    const s = this.s, [g, W, H] = this.surface(300), self = s.vector_sha256;
    const pts = s.library.filter((w) => w.vector_sha256 !== self).map((w) => ({ w, at: this.coords(m, w) }));
    const here = this.coords(m, null), start = this.coords(this.measure(Array(this.K + 2).fill(0)), null);
    if (!this.drag) {
      const xs = [...pts.map((p) => p.at[0]), here[0], start[0]], ys = [...pts.map((p) => p.at[1]), here[1], start[1]];
      const pad = (lo, hi) => { const d = (hi - lo) * 0.12 || 1; return [lo - d, hi + d]; };
      this.frame = [pad(Math.min(...xs), Math.max(...xs)), pad(Math.min(...ys), Math.max(...ys))];
    }
    const [[x0, x1], [y0, y1]] = this.frame, M = 28;
    const px = (v) => M + (v - x0) / (x1 - x0) * (W - 2 * M), py = (v) => H - M - (v - y0) / (y1 - y0) * (H - 2 * M);
    this.libPx = { x: (v) => (v - x0) / (x1 - x0) * (W - 2 * M), y: (v) => (v - y0) / (y1 - y0) * (H - 2 * M) };
    g.strokeStyle = "#2a2c33";
    if (x0 < 0 && x1 > 0) { g.beginPath(); g.moveTo(px(0), M); g.lineTo(px(0), H - M); g.stroke(); }
    if (y0 < 0 && y1 > 0) { g.beginPath(); g.moveTo(M, py(0)); g.lineTo(W - M, py(0)); g.stroke(); }
    const near = new Set(m.lib.filter((l) => l.w.vector_sha256 !== self).sort((a, b) => b.cos - a.cos).slice(0, NEAR).map((l) => l.w));
    const cos = new Map(m.lib.map((l) => [l.w, l.cos])), placed = [];
    const label = (text, x, y) => {  // first of a few offsets that overlaps no earlier label
      const w = g.measureText(text).width;
      for (const dy of [-4, 12, -16, 24, -28]) {
        if (!placed.some((r) => x < r[0] + r[2] && r[0] < x + w && y + dy - 9 < r[1] && r[1] - 9 < y + dy)) {
          placed.push([x, y + dy, w]); return g.fillText(text, x, y + dy);
        }
      }
      g.fillText(text, x, y - 4);
    };
    for (const p of pts) {
      const on = near.has(p.w);
      g.fillStyle = on ? "#8fb4ff" : "#4a4d57";
      g.beginPath(); g.arc(px(p.at[0]), py(p.at[1]), on ? 3.5 : 2.5, 0, 2 * Math.PI); g.fill();
    }
    g.fillStyle = "#b8c4ff";
    for (const p of pts) if (near.has(p.w)) label(`${shortName(p.w.names[0])} ${signed(cos.get(p.w))}`, px(p.at[0]) + 5, py(p.at[1]));
    g.strokeStyle = "#d8d8d8"; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(px(start[0]), py(start[1])); g.lineTo(px(here[0]), py(here[1])); g.stroke(); g.setLineDash([]);
    g.lineWidth = 1.5; g.beginPath(); g.arc(px(start[0]), py(start[1]), 6, 0, 2 * Math.PI); g.stroke(); g.lineWidth = 1;
    g.fillStyle = "#ffc145"; g.beginPath(); g.arc(px(here[0]), py(here[1]), 6, 0, 2 * Math.PI); g.fill();
    label(shortName(this.file) + (this.ops.length ? " (edited)" : ""), px(here[0]) + 8, py(here[1]) + 18);
    const b = this.basis, names = b.kind === "pca" ? ["PC1", "PC2"] : [b.x, b.y].map((k) => s.bank.axes[k]);
    g.fillStyle = "#999";
    const xl = b.kind === "pca" ? "PC1 →" : `${s.bank.positive[b.x]} (${names[0]}) →`;
    g.fillText(xl, W - M - g.measureText(xl).width, H - 8);
    g.fillText(b.kind === "pca" ? "↑ PC2" : `↑ ${s.bank.positive[b.y]} (${names[1]})`, 4, 12);
    g.fillStyle = "#777";
    const scope = `${s.library.length} saved dials · ${s.family} post-refiner · ` + (b.kind === "pca" ? "top 2 principal components of the library" : `${this.fit} fit, probe units`);
    g.fillText(scope, M, H - 8 - (g.measureText(scope).width + g.measureText(xl).width > W - 2 * M - 10 ? 12 : 0));
  }

  axisControls() {
    const rack = this.rack, el = (...a) => rack.el(...a), s = this.s, b = this.basis;
    this.axisBar.replaceChildren();
    this.axisBar.style.display = this.view === "library" ? "flex" : "none";
    if (this.view !== "library") return;
    const sel = (value, options, cb) => {
      const e = el("select", { background: "#111", color: "#eee", border: "1px solid #333" }, this.axisBar);
      for (const [v, t] of options) el("option", {}, e, t).value = v;
      e.value = value; e.onchange = () => { cb(e.value); this.draw(); };
    };
    el("span", { color: "#888" }, this.axisBar, "axes");
    sel(b.kind, [["pca", "library PC1 / PC2"], ["probes", "two probe axes"]], (v) => {
      b.kind = v;
      if (v === "probes" && b.x === b.y) b.y = (b.x + 1) % this.K;
    });
    const axes = s.bank.axes.map((a, k) => [k, a]);
    if (b.kind === "probes") {
      el("span", { color: "#888" }, this.axisBar, "X"); sel(b.x, axes, (v) => { b.x = Number(v); });
      el("span", { color: "#888" }, this.axisBar, "Y"); sel(b.y, axes, (v) => { b.y = Number(v); });
    }
    el("span", { color: "#888", flexBasis: "100%" }, this.axisBar, b.kind === "pca"
      ? "Dragging moves the dial along PC1 and PC2 only (the library's two main directions of spread); every other direction stays."
      : `Dragging moves the dial along the ${s.bank.axes[b.x]} and ${s.bank.axes[b.y]} probe vectors only; every other direction stays.`);
    if (b.kind === "probes" && b.x === b.y) el("span", { color: "#ff8a5c" }, this.axisBar, "pick two different axes");
  }

  readouts(m) {
    const s = this.s, fit = this.fit, el = (...a) => this.rack.el(...a), line = (t, colour) => el("div", { color: colour || "#9a9ba0" }, this.readout, t);
    this.readout.replaceChildren();
    const was = Math.sqrt(s.vv);
    line(`size |v'| ${m.norm.toFixed(2)} (original ${was.toFixed(2)}${was > 0 ? `, ×${(m.norm / was).toFixed(2)}` : ""})  ·  ` +
      `cos with the original ${signed(m.cos, 3)}  ·  unexplained by the bank ${m.unexplained.toFixed(2)} (was ${s.unexplained.toFixed(2)})`, "#ddd");
    const near = m.lib.filter((l) => l.w.vector_sha256 !== s.vector_sha256).sort((a, b) => b.cos - a.cos).slice(0, NEAR);
    line("nearest saved dials: " + near.map((l) => `${shortName(l.w.names[0])} ${signed(l.cos)}` +
      (Math.abs(l.cos - l.was) >= 0.005 ? ` (was ${signed(l.was)})` : "")).join("  ·  "));
    const change = s.bank.axes.map((a, k) => [a, m[fit][k] - s[fit][k]]).filter(([, d]) => Math.abs(d) >= 0.005).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    line(`probe changes (${fit}): ` + (change.length ? change.map(([a, d]) => `${a} ${signed(d)}`).join(", ") : "none"));
    if (this.ops.length) line("edits: " + this.ops.map((op) => (op.kind === "axis" ? `${op.axis} Δβ ${signed(op.delta)} (${op.fit})`
      : op.basis === "probes" ? `drag ${op.axes.join("/")} Δβ ${op.delta.map((d) => signed(d)).join(", ")} (${op.fit})`
        : `drag PC1/PC2 ${op.delta.map((d) => signed(d)).join(", ")}`)).join("  ·  "));
    if (this.hover != null && this.view === "bars") {
      const a = s.bank.axes[this.hover], partners = (s.bank.correlated || []).filter((c) => c[0] === a || c[1] === a);
      line(`${a}: ${s.bank.negative[this.hover]} ↔ ${s.bank.positive[this.hover]} · original ${signed(s[fit][this.hover])} → ${signed(m[fit][this.hover])}` +
        (partners.length ? ` · correlated with ${partners.map((c) => `${c[0] === a ? c[1] : c[0]} (cos ${c[2].toFixed(2)})`).join(", ")}: editing one moves the others` : ""), "#ddd");
    }
    line((this.view === "library" ? "" : fit === "joint"
      ? `Joint fit (ridge λ ${s.bank.lambda}): a drag adds Δβ·p, Δβ = how far you dragged; dragging to 0 removes the fitted component β·p, ` +
        "and the re-fit lands near 0, not on it (ridge shrinkage). "
      : "Direct fit: a drag adds Δβ·p, Δβ = how far you dragged; dragging to 0 removes the dial's projection on that probe. ") +
      "Probes are correlated (light, expression and mood are one \"intensity\" cluster, cos ≈ 0.56–0.59), so moving one moves others" +
      (this.view === "library" ? ". " : "; double-click a bar to remove that axis. ") +
      "Exact vector math; whether an edit shows in renders is untested.", "#777");
  }

  // ---------- dragging ----------
  pointer() {
    const cv = this.canvas, at = (e) => {  // in the canvas' own CSS pixels, whatever the graph zoom
      const b = cv.getBoundingClientRect();
      return [(e.clientX - b.left) * cv.clientWidth / b.width, (e.clientY - b.top) * cv.clientHeight / b.height];
    };
    const rowAt = (y) => { const L = this.barLayout(cv.clientWidth), k = Math.floor((y - L.top) / L.row); return k >= 0 && k < this.K ? k : null; };
    const snap0 = (v) => (Math.abs(this.barX(v) - this.barX(0)) < 4 ? 0 : v);
    const bank = () => ({ bank: this.s.bank.bank, bank_version: this.s.bank.version });
    cv.addEventListener("pointerdown", (e) => {
      if (!this.s) return;
      const [x, y] = at(e), fit = this.fit, c = this.coeffs();
      if (this.view === "bars") {
        const k = rowAt(y);
        if (k == null) return;
        const op = { kind: "axis", axis: this.s.bank.axes[k], delta: 0, fit, ...bank() };
        this.drag = { k, op, from: this.coef(c, fit, k), target: this.coef(c, fit, k) };
      } else {
        const b = this.basis;
        if (b.kind === "probes" && b.x === b.y) return;
        const dirs = b.kind === "pca" ? [this.K, this.K + 1] : [b.x, b.y];
        const J = b.kind === "pca" ? dirs.map((i) => dirs.map((j) => this.s.qq[i][j])) : [b.x, b.y].map((k) => dirs.map((j) => this.response(fit, k, j)));
        const op = b.kind === "pca" ? { kind: "drag", basis: "library_pca", library_sha256: this.s.library_sha256, components_sha256: this.s.components_sha256, delta: [0, 0] }
          : { kind: "drag", basis: "probes", axes: [b.x, b.y].map((k) => this.s.bank.axes[k]), delta: [0, 0], fit, ...bank() };
        this.drag = { J, op, x0: x, y0: y };
      }
      this.ops.push(this.drag.op);
      cv.setPointerCapture(e.pointerId);
      this.move(x, y, snap0);
    });
    cv.addEventListener("pointermove", (e) => {
      const [x, y] = at(e);
      if (this.drag) return this.move(x, y, snap0);
      const k = this.view === "bars" ? rowAt(y) : null;
      if (k !== this.hover) { this.hover = k; this.draw(); }
    });
    const end = () => {
      if (!this.drag) return;
      if (this.drag.op.delta === 0 || (Array.isArray(this.drag.op.delta) && this.drag.op.delta.every((d) => d === 0))) this.ops.pop();
      this.drag = null; this.draw();
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", () => { if (!this.drag && this.hover != null) { this.hover = null; this.draw(); } });
    cv.addEventListener("dblclick", (e) => {
      if (this.view !== "bars" || !this.s) return;
      const k = rowAt(at(e)[1]);
      if (k == null) return;
      const v = this.coef(this.coeffs(), this.fit, k);
      if (v) { this.ops.push({ kind: "axis", axis: this.s.bank.axes[k], delta: -v, fit: this.fit, ...bank() }); this.draw(); }
    });
  }

  move(x, y, snap0) {
    const d = this.drag;
    if (this.view === "bars") {
      d.target = snap0(this.barValue(x));
      d.op.delta = d.target - d.from;  // Δβ along p_k: lands exactly under direct, removes the fitted component under joint
    } else {
      const p = this.libPx;  // the frame stays fixed while dragging, so pixels per unit are constant
      d.op.delta = solve2(d.J, [(x - d.x0) / (p.x(1) - p.x(0)), -(y - d.y0) / (p.y(1) - p.y(0))]);
    }
    this.draw();
  }

  // ---------- export ----------
  exportForm() {
    const rack = this.rack, el = (...a) => rack.el(...a), info = this.s.info, parent = this.file.replace(/^dials\//, "").replace(/\.safetensors$/, "");
    const box = el("div", { display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: "4px 6px", alignItems: "center",
      borderTop: "1px solid #2a2c33", paddingTop: "5px" }, this.box);
    const input = (label, value, attrs, span) => {
      el("span", { color: "#888" }, box, label);
      const e = el(attrs.tag || "input", { background: "#111", color: "#eee", border: "1px solid #333", gridColumn: span ? "span 3" : "",
        minWidth: "0", resize: "vertical" }, box);
      Object.assign(e, attrs.props || {}, { value });
      return e;
    };
    const name = input("new name", `${parent.split("/").pop()}_edit`, { props: { maxLength: 161, title: "saved as models/loras/dials/<name>.safetensors; folder/name puts it in a sub-folder (folders starting with _ stay out of the rack's list). An existing file is never replaced." } }, true);
    const desc = input("description", info.description, { tag: "textarea", props: { rows: 2, maxLength: 2000 } }, true);
    const neg = input("− gives", info.negative, { props: { maxLength: 60 } });
    const pos = input("+ gives", info.positive, { props: { maxLength: 60 } });
    const notes = input("notes", `made in the Dial editor from ${shortName(this.file)}; output untested`, { tag: "textarea", props: { rows: 1, maxLength: 500 } }, true);
    el("span", { gridColumn: "span 4", color: "#777", fontSize: "11px" }, box,
      "Useful and overcook strengths and the evidence start unknown: an edited dial has not been rendered yet. The file records the parent, its hash and every edit.");
    const actions = el("div", { gridColumn: "span 4", display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }, box);
    const msg = el("span", { color: "#9a9ba0", whiteSpace: "pre-wrap", flex: "1 1 200px" }, actions);
    rack.button(actions, "Export new dial", "save the edited vector as a new dial file (never overwrites)", async (b) => {
      b.disabled = true; msg.style.color = "#9a9ba0"; msg.textContent = "saving…";
      try {
        const r = await api.fetchApi("/mainodes/dials/editor/export", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dial: this.file, edits: this.ops, name: name.value.trim(), info: { version: 2, description: desc.value,
            negative: neg.value, positive: pos.value, neg: UNKNOWN, pos: UNKNOWN, evidence: null, pipeline: "", notes: notes.value } }) });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        this.saved = data;
        msg.style.color = "#ffc145";
        msg.textContent = `saved ${data.file} · |v'| ${data.norm.toFixed(2)} · cos with the original ${signed(data.cos_parent, 3)} · nearest ` +
          data.neighbours.slice(0, 3).map((n) => `${shortName(n.dial)} ${signed(n.cos)}`).join(", ");
        this.addButton.style.display = "";
        await listDials(true);
      } catch (e) { msg.style.color = "#ff8a5c"; msg.textContent = e.message; }
      finally { b.disabled = false; }
    }, { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145" });
    this.addButton = rack.button(actions, "add as row", "add the saved dial as a new rack row at this row's strength", () => {
      rack.addRow({ on: true, dial: this.saved.file, strength: this.r.strength, solo: false });
    });
    this.addButton.style.display = "none";
  }
}

class DialRackUI {
  constructor(node) {
    this.node = node;
    this.rows = [];
    this.report = "";
    this.presetWarnings = [];
    this.presetMessage = "";
    this.sw = node.widgets.find((w) => w.name === "rack");
    if (this.sw) {
      this.sw.hidden = true;
      this.sw.options = Object.assign({}, this.sw.options, { hidden: true });
      this.sw.computeSize = () => [0, -4];
      for (const el of [this.sw.element, this.sw.inputEl]) if (el) el.style.display = "none";
    }
    // rows written from elsewhere (Snap, a Library card, an agent) set the widget and call its callback: follow them
    if (this.sw) this.sw.callback = () => { this.load(); this.render(); };
    this.load();
    this.build();
    listDials().then(() => this.render());
  }

  load() {
    try { const v = JSON.parse(this.sw?.value || "[]"); this.rows = Array.isArray(v) ? v : []; } catch (e) { this.rows = []; }
  }
  commit() {
    if (this.sw) this.sw.value = JSON.stringify(this.rows);
    this.node.setDirtyCanvas(true, true);
  }

  el(tag, style, parent, text) {
    const e = document.createElement(tag);
    Object.assign(e.style, style || {});
    if (text !== undefined) e.textContent = text;
    parent?.appendChild(e);
    return e;
  }
  button(parent, label, title, cb, style) {
    const b = this.el("button", Object.assign({ background: "#2a2c33", color: "#ddd", border: "1px solid #444", borderRadius: "4px",
      padding: "2px 8px", cursor: "pointer", fontSize: "12px" }, style || {}), parent, label);
    b.title = title;
    b.onclick = (e) => { e.stopPropagation(); cb(b); };
    return b;
  }

  build() {
    const root = this.el("div", { display: "flex", gap: "10px", padding: "6px", boxSizing: "border-box", width: "100%", height: "100%",
      background: "#16171b", borderRadius: "6px", fontFamily: "sans-serif", fontSize: "12px", color: "#ddd" });
    for (const ev of ["pointerdown", "keydown", "wheel"]) root.addEventListener(ev, (e) => e.stopPropagation());
    // left: rows and buttons at a fixed width; they never resize. right: the map, which takes whatever the node leaves.
    const left = this.el("div", { display: "flex", flexDirection: "column", gap: "6px", flex: "1 1 auto", minWidth: "0", overflowY: "auto" }, root);
    this.mapColumn = this.el("div", { display: "none", flex: "1 1 auto", minWidth: MAP_MIN + "px", borderLeft: "1px solid #2a2c33", paddingLeft: "10px" }, root);
    this.left = left;
    this.list = this.el("div", { display: "flex", flexDirection: "column", gap: "4px" }, left);
    const bar = this.el("div", { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }, left);
    this.button(bar, "+ Add dial", "add a dial row", () => this.addRow(), { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145" });
    this.button(bar, "↻", "refresh the list of dial files", async () => { await listDials(true); this.render(); });
    this.button(bar, "Save preset", "save these rows as a named preset", () => this.savePreset());
    this.button(bar, "Load preset", "replace these rows with a saved preset", () => this.loadPreset());
    this.padButton = this.button(bar, "Map", "move two dials together on a 2D map: the dot is your prompt", () => {
      this.pad.open = !this.pad.open; this.render();
    });
    this.hint = this.el("span", { color: "#888", marginLeft: "auto" }, bar);
    this.presetBar = this.el("div", { display: "none", gap: "6px", alignItems: "center" }, left);
    this.notice = this.el("div", { display: "none", color: "#ffc145", whiteSpace: "pre-wrap" }, left);
    this.out = this.el("pre", { margin: 0, whiteSpace: "pre-wrap", color: "#9a9ba0", fontSize: "11px", display: "none",
      borderTop: "1px solid #2a2c33", paddingTop: "4px" }, left);
    this.padGeometry = {};
    this.info = {};
    this.map = new DialMap(this, this.mapColumn);
    this.wheel = new DialWheel(this, this.map);
    this.matrix = new DialMatrix(this, this.map.box);
    this.map.sizer.observe(this.matrix.box);
    this.widget = this.node.addDOMWidget("dial_rack_ui", "div", root, { serialize: false, getMinHeight: () => 140 });
    this.root = root;
  }

  // ---------- map: UI-only state saved with the workflow, {open, pairs: [{x, y}], active, range, step, view, fit} ----------
  get pad() {
    const p = (this.node.properties ||= {}).dialPad ||= {};
    if (!p.pairs) {  // layouts saved earlier today: one pad {x, y} or several {pads: [...]}
      p.pairs = (p.pads || [p]).map((q) => ({ x: q.x, y: q.y }));
      p.range ??= p.pads?.[0]?.range ?? "auto";
      p.step ??= p.pads?.[0]?.step ?? 0.5;
      delete p.pads; delete p.x; delete p.y;
    }
    p.active = Math.min(p.active ?? 0, p.pairs.length - 1);
    p.range ??= "auto"; p.step ??= 0.5;
    return p;
  }

  padAxes() {  // rows that can be an axis: everything but hold rows
    return this.rows.map((r, i) => i).filter((i) => !this.rows[i].hold);
  }

  rowName(i) {
    const r = this.rows[i];
    return `${i + 1}. ` + ("input" in r ? r.input : shortName(r.dial || "?"));
  }

  dialInfo(file) {  // cached; fetched once per dial file, re-rendering when it arrives
    if (!(file in this.info)) {
      this.info[file] = INFO_DEFAULTS;
      api.fetchApi(`/mainodes/dials/info?dial=${encodeURIComponent(file)}`).then(async (r) => {
        if (r.ok) { this.info[file] = await r.json(); this.render(); }
      });
    }
    return this.info[file];
  }

  infoEditor(file) {
    const info = this.dialInfo(file);
    const box = this.el("div", { display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: "4px 6px", alignItems: "center",
      padding: "6px", background: "#1b1d23", border: "1px solid #2f323b", borderRadius: "4px" }, this.list);
    const input = (label, value, attrs, span) => {
      this.el("span", { color: "#888" }, box, label);
      const e = this.el(attrs.tag || "input", { background: "#111", color: "#eee", border: "1px solid #333", gridColumn: span ? "span 3" : "",
        minWidth: "0", resize: "vertical" }, box);
      Object.assign(e, attrs.props || {}, { value });
      return e;
    };
    const desc = input("description", info.description, { tag: "textarea", props: { rows: 2, maxLength: 2000 } }, true);
    const neg = input("− gives", info.negative, { props: { maxLength: 60, placeholder: "e.g. stoic" } });
    const pos = input("+ gives", info.positive, { props: { maxLength: 60, placeholder: "e.g. lively" } });
    const strength = (label, value, title) => input(label, value ?? "", { props: { type: "number", min: 0.05, max: 20, step: 0.05,
      placeholder: "unknown", title: title + "; empty = unknown" } });
    const negUseful = strength("− useful", info.neg.useful, "negative strength where the effect is clearly there (inner ring, left/bottom)");
    const posUseful = strength("+ useful", info.pos.useful, "positive strength where the effect is clearly there (inner ring, right/top)");
    const negOver = strength("− overcook", info.neg.overcook, "negative strength where side effects take over (outer ring)");
    const posOver = strength("+ overcook", info.pos.overcook, "positive strength where side effects take over (outer ring)");
    this.el("span", { color: "#888" }, box, "evidence");
    const evidence = this.el("select", { background: "#111", color: "#eee", border: "1px solid #333", minWidth: "0" }, box);
    evidence.title = "where the strengths come from";
    for (const v of ["", ...EVIDENCE]) this.el("option", {}, evidence, v || "unknown").value = v;
    evidence.value = info.evidence ?? "";
    const pipeline = input("pipeline", info.pipeline, { props: { maxLength: 60, placeholder: "e.g. Pika H3 Flex 6-step",
      title: "what the strengths were measured on" } });
    const notes = input("notes", info.notes, { tag: "textarea", props: { rows: 2, maxLength: 500,
      placeholder: "failures seen, e.g. the − side never lands" } }, true);
    const num = (e) => (e.value.trim() === "" ? null : parseFloat(e.value));
    const actions = this.el("div", { gridColumn: "span 4", display: "flex", gap: "6px", alignItems: "center" }, box);
    const msg = this.el("span", { color: "#ff8a5c" }, actions);
    this.button(actions, "Save to dial file", "write this info into the dial's .safetensors metadata (the vector is unchanged)", async (b) => {
      b.disabled = true;
      try {
        const r = await api.fetchApi("/mainodes/dials/info", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dial: file, info: { ...info, version: 2, description: desc.value, negative: neg.value, positive: pos.value,
            neg: { useful: num(negUseful), overcook: num(negOver) }, pos: { useful: num(posUseful), overcook: num(posOver) },
            evidence: evidence.value || null, pipeline: pipeline.value, notes: notes.value } }) });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        this.info[file] = data;
        this.editing = null;
        this.render();
      } catch (e) { msg.textContent = e.message; b.disabled = false; }
    }, { marginLeft: "auto", background: "#3b3220", borderColor: "#ffc145", color: "#ffc145" });
    this.button(actions, "Cancel", "close without saving", () => { this.editing = null; this.render(); });
  }

  blocksEditor(r, name) {
    const w = r.blocks ? [...r.blocks] : Array(this.node.properties?.dialBlocks || BLOCKS).fill(1), n = w.length;
    const box = this.el("div", { display: "flex", flexDirection: "column", gap: "4px", padding: "6px", background: "#1b1d23",
      border: "1px solid #2f323b", borderRadius: "4px" }, this.list);
    const bar = this.el("div", { display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" }, box);
    this.el("span", { color: "#888" }, bar, `${name} · blocks`);
    let hover = null, top = Math.max(this.blocksTop || 1, ...w);
    const canvas = this.el("canvas", { display: "block", width: "100%", height: "64px", cursor: "crosshair", touchAction: "none" }, box);
    const draw = () => drawBlocks(canvas, w, hover, canvas.clientWidth, 64, top);
    const save = () => {
      if (w.every((v) => v === 1)) delete r.blocks; else r.blocks = w.map((v) => Math.round(v * 100) / 100);
      this.commit(); draw();
    };
    for (const [label, title, on] of BLOCK_PRESETS) this.button(bar, label, title, () => {
      w.forEach((_, i) => { w[i] = on(i, n) ? 1 : 0; }); save(); this.render();
    }, { padding: "1px 6px" });
    this.el("span", { color: "#888" }, bar, "top");
    const topBox = this.el("input", { width: "56px", background: "#111", color: "#eee", border: "1px solid #333" }, bar);
    Object.assign(topBox, { type: "number", min: 1, step: 1, value: top, title: "strength at the top of the strip; raise it to paint blocks above 1 (e.g. 50)" });
    topBox.onchange = () => { top = this.blocksTop = Math.max(1, parseFloat(topBox.value) || 1, ...w); topBox.value = top; draw(); };
    const readout = this.el("span", { color: "#ffc145", marginLeft: "auto", minWidth: "90px", textAlign: "right" }, bar);
    this.button(bar, "Done", "close the block strengths", () => { this.blocksEditing = null; this.render(); }, { padding: "1px 6px" });
    this.el("div", { color: "#888", fontSize: "11px" }, box, BLOCKS_HELP + " Click or drag to paint: top = the top value, bottom = 0.");
    canvas.title = "click or drag to paint each block's strength (top = the top value, bottom = 0)";
    const at = (e) => {
      const b = canvas.getBoundingClientRect();
      return [Math.min(n - 1, Math.max(0, Math.floor((e.clientX - b.left) / b.width * n))),
        Math.min(1, Math.max(0, Math.round((1 - (e.clientY - b.top) / b.height) * 20) / 20)) * top];
    };
    let last = null;
    const show = (i) => { hover = i; readout.textContent = i == null ? "" : `block ${i}: ${w[i].toFixed(2)}`; };
    const paint = (e) => {  // fill the cells between drag events so a fast stroke leaves no gaps
      const [i, v] = at(e);
      for (let k = Math.min(last ?? i, i); k <= Math.max(last ?? i, i); k++) w[k] = v;
      last = i; show(i); save();
    };
    canvas.addEventListener("pointerdown", (e) => { canvas.setPointerCapture(e.pointerId); last = null; paint(e); });
    canvas.addEventListener("pointermove", (e) => { if (last !== null) paint(e); else { show(at(e)[0]); draw(); } });
    canvas.addEventListener("pointerup", () => { last = null; this.render(); });
    canvas.addEventListener("pointerleave", () => { if (last === null) { show(null); draw(); } });
    draw();
  }

  timeEditor(r, name, mini) {
    const spec = r.time || { type: "keys", points: [[0, 0], [0.5, 1]], unit: "normalized", interp: "step", steps: 2, audio: "follow" };
    const seconds = this.clipSeconds();
    const box = this.el("div", { display: "flex", flexDirection: "column", gap: "4px", padding: "6px", background: "#1b1d23",
      border: "1px solid #2f323b", borderRadius: "4px" }, this.list);
    const bar = this.el("div", { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }, box);
    const held = this.node.inputs?.some((i) => i.name === "hold_map" && i.link != null);
    this.el("span", { color: "#888" }, bar, `${name} · clip time`).title = held
      ? "hold_map connected: times are real clip time; in the stretched de-rope pass they are mapped through the hold map" : "";
    const save = () => { this.commit(); this.render(); };
    const select = (parent, options, value, title, cb) => {
      const e = this.el("select", { background: "#111", color: "#ddd", border: "1px solid #333" }, parent);
      for (const [v, label] of options) this.el("option", {}, e, label).value = v;
      e.value = value; e.title = title; e.onchange = () => cb(e.value);
      return e;
    };
    const number = (parent, label, value, title, cb, attrs) => {
      this.el("span", { color: "#888" }, parent, label);
      const e = this.el("input", { width: "52px", background: "#111", color: "#ffc145", border: "1px solid #333", textAlign: "right" }, parent);
      Object.assign(e, { type: "number", step: 0.05, value, title }, attrs || {});
      e.onchange = () => { const v = parseFloat(e.value); if (Number.isFinite(v)) cb(v); save(); };
      return e;
    };
    select(bar, [["off", "off"], ["keys", "keyframes"], ["audio", "audio-driven"]], r.time ? spec.type : "off",
      "off: constant over the clip (today's dial); keyframes: points over the clip; audio-driven: a feature of the music on curve_audio", (v) => {
        if (v === "off") delete r.time;
        else r.time = v === "keys" ? { type: "keys", points: [[0, 0], [0.5, 1]], unit: "normalized", interp: "step", steps: spec.steps, audio: spec.audio }
          : { type: "audio", feature: "onset", ...SHAPING, invert: false, steps: spec.steps, audio: spec.audio };
        this.curve = null;
        save();
      });
    if (r.time) {
      number(bar, "steps", spec.steps ?? 2, "k: how many first sampling steps blend the two branches; the dial is off after", (v) => { spec.steps = Math.max(1, Math.round(v)); }, { step: 1, min: 1, max: 50 });
      select(bar, [["follow", "audio: follow"], ["protect", "audio: protect"]], spec.audio || "follow",
        "follow: the soundtrack gets the same curve; protect: the soundtrack comes from the undialled branch (M_audio = 0)", (v) => { spec.audio = v; save(); });
      number(bar, "clip s", +seconds.toFixed(2), "clip length the editor draws, in seconds; a run sets it to the sampled clip",
        (v) => { this.node.properties.dialClipSeconds = Math.max(0.1, v); }, { step: 0.1, min: 0.1 });
      this.button(bar, "Copy", "copy this row's time curve (shape, steps, audio) to paste into another row or rack", () => {
        curveClipboard = JSON.stringify(r.time);
        navigator.clipboard?.writeText(curveClipboard).catch(() => {});
      }, { padding: "1px 6px", marginLeft: "auto" });
    }
    this.button(bar, "Paste", "paste a copied time curve, or a [[time, M], ...] list, into this row", async () => {
      const text = await navigator.clipboard?.readText?.().catch(() => null);
      const v = parseTime(text) || parseTime(curveClipboard);
      if (!v) return this.showPresetMessage("Paste: no time curve on the clipboard; use Copy on a curve, or copy a [[time, M], ...] list.");
      r.time = Array.isArray(v) ? { ...(r.time?.type === "keys" ? r.time : { type: "keys", unit: "normalized", interp: "linear", steps: 2, audio: "follow" }), points: v } : v;
      this.curve = null;
      save();
    }, { padding: "1px 6px", marginLeft: r.time ? "" : "auto" });
    this.button(bar, "Done", "close the time curve", () => { this.timeEditing = null; this.curve = null; this.render(); }, { padding: "1px 6px" });
    if (r.time?.type === "keys") this.keysEditor(r, box, mini, select);
    else if (r.time?.type === "audio") {
      const shaping = this.el("div", { display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" }, box);
      select(shaping, FEATURES.map((f) => [f, { onset: "onsets", rms: "loudness (RMS)", low: "low band", mid: "mid band", high: "high band" }[f]]),
        spec.feature || "onset", "music feature per frame, scaled to 0..1 over the track", (v) => { spec.feature = v; save(); });
      for (const [key, title] of [["gain", "M = offset + gain × feature"], ["offset", "M = offset + gain × feature"],
        ["threshold", "feature below this counts as 0 (0..1)"], ["attack", "rise time in seconds"], ["release", "fall time in seconds"]]) {
        number(shaping, key, spec[key] ?? SHAPING[key], title, (v) => { spec[key] = key === "threshold" ? Math.min(0.99, Math.max(0, v)) : ["attack", "release"].includes(key) ? Math.max(0, v) : v; },
          ["threshold", "attack", "release"].includes(key) ? { step: 0.01, min: 0 } : {});
      }
      const invert = this.el("input", { margin: 0 }, shaping);
      invert.type = "checkbox"; invert.checked = !!spec.invert; invert.title = "invert: quiet parts get the dial";
      invert.onchange = () => { spec.invert = invert.checked; save(); };
      this.el("span", { color: "#888" }, shaping, "invert");
      if (this.curveAudio) this.button(shaping, "→ keyframes", "turn this curve into keyframes (one step per latent frame, levels to 0.01) to edit by hand; it no longer follows the music", () => {
        const points = [];
        for (const [a, , v] of frameCurve(spec, seconds, this.curveAudio)) {
          if (points.at(-1)?.[1] !== Math.round(v * 100) / 100) points.push([Math.round(a * 1e4) / 1e4, Math.round(v * 100) / 100]);
        }
        r.time = { type: "keys", points, unit: "seconds", interp: "step", steps: spec.steps, audio: spec.audio };
        save();
      }, { padding: "1px 6px", marginLeft: "auto" });
      const canvas = this.el("canvas", { display: "block", width: "100%", height: "90px" }, box);
      requestAnimationFrame(() => drawTime(canvas, spec, seconds, this.curveAudio, canvas.clientWidth || 400, 90));
      canvas.title = "amber: M per video latent frame; blue: the curve; grey: the music on curve_audio (after a run)";
    }
    this.el("div", { color: "#888", fontSize: "11px" }, box, TIME_HELP);
  }

  // keyframes on a canvas: click adds, drag moves, double/right-click deletes; points, fields and JSON stay in sync.
  // this.curve keeps the selection (point arrays, the primary last), level range, zoom and undo history while the editor
  // stays on one row (render() rebuilds this DOM).
  keysEditor(r, box, mini, select) {
    const spec = r.time, seconds = this.clipSeconds(), H = this.curveTall ? 240 : 120, audio = this.curveAudio;
    const st = this.curve?.r === r ? this.curve : (this.curve = { r, past: [], future: [], sel: [], top: 1, bottom: 0, win: null });
    const norm = () => (spec.unit || "normalized") === "normalized";
    const toS = (t) => (norm() ? t * seconds : t), fromS = (s) => Math.round((norm() ? s / seconds : s) * 1e4) / 1e4;
    const state = () => JSON.stringify([spec.points, spec.unit || "normalized", spec.interp || "linear", spec.smooth || 0]);
    const restore = (text) => { [spec.points, spec.unit, spec.interp, spec.smooth] = JSON.parse(text); if (!spec.smooth) delete spec.smooth; };
    const strength = () => Number(r.strength);
    st.opened ??= state();
    const onsets = onsetTimes(audio);
    let axes = null, drag = null, lasso = null, pan = null, hover = null, ghost = null, label = null;

    const shape = this.el("div", { display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" }, box);
    for (const [name, title, preset, interp] of TIME_KEYS) this.button(shape, name, title, () => change(() => {
      Object.assign(spec, { points: preset.map(([t, m]) => [fromS(t * seconds), m]), interp });
    }), { padding: "1px 6px" });
    const interpBox = select(shape, [["linear", "linear"], ["step", "step"]], spec.interp || "linear", "between keyframes: ramp, or hold until the next",
      (v) => change(() => { spec.interp = v; }));
    const smoothLabel = this.el("span", { color: "#888" }, shape, "rate smoothing");
    const smoothBox = this.el("input", { width: "64px", accentColor: "#8fb4ff" }, shape);
    Object.assign(smoothBox, { type: "range", min: 0, max: 1, step: 0.05 });
    const smoothText = this.el("span", { color: "#ffc145", minWidth: "26px" }, shape);
    smoothLabel.title = smoothBox.title = "rounds the corners at each point (0: straight lines; 1: fully smooth), still through every point and never past it; linear only";
    let smoothFrom = null;  // one undo step per slider drag
    smoothBox.oninput = () => {
      smoothFrom ??= state();
      spec.smooth = parseFloat(smoothBox.value);
      if (!spec.smooth) delete spec.smooth;
      refresh();
    };
    smoothBox.onchange = () => {
      if (smoothFrom !== null && state() !== smoothFrom) { st.past.push(smoothFrom); st.future = []; }
      smoothFrom = null;
      refresh();
    };
    const unitBox = select(shape, [["normalized", "times: 0..1 of the clip"], ["seconds", "times: seconds"]], spec.unit || "normalized",
      "0..1 stretches with the clip length, seconds stay put; switching converts the points, so nothing moves", (v) => change(() => {
        const s = spec.points.map(([t, m]) => [toS(t), m]);
        spec.unit = v;
        spec.points = s.map(([t, m]) => [fromS(t), m]);
      }));
    select(shape, SNAPS.filter(([v]) => v !== "onset" || onsets.length), this.curveSnap || "0.1",
      "where clicks and drags land in time (levels snap to 0.05); hold Alt or Shift to place freely", (v) => { this.curveSnap = v; });
    const range = (text, title, cb) => {
      this.el("span", { color: "#888" }, shape, text);
      const e = this.el("input", { width: "46px", background: "#111", color: "#eee", border: "1px solid #333" }, shape);
      Object.assign(e, { type: "number", step: 0.5, title });
      e.onchange = () => { cb(parseFloat(e.value) || 0); refresh(); };
      return e;
    };
    const bottomBox = range("bottom", "level at the bottom of the canvas; lower it to drag points below 0. Levels below 0 extrapolate and act weaker than a negative strength: for a real negative stretch add a second row at that strength with a 0-to-1 curve",
      (v) => { st.bottom = Math.min(0, v); });
    const topBox = range("top", "level at the top of the canvas; raise it to drag points above 1 (overshoot kicks; extrapolated, weaker than level × strength)", (v) => { st.top = Math.max(1, v); });
    const fit = this.button(shape, "fit", "show the whole clip (wheel zooms the time axis, Shift+wheel or middle-drag pans)", () => zoom(null),
      { padding: "1px 6px", marginLeft: "auto" });
    this.button(shape, this.curveTall ? "shorter" : "taller", "canvas height", () => { this.curveTall = !this.curveTall; this.render(); },
      { padding: "1px 6px" });

    const canvas = this.el("canvas", { display: "block", width: "100%", height: H + "px", cursor: "crosshair", touchAction: "none", borderRadius: "3px" }, box);
    // the canvas's keys go through a hidden read-only input: ComfyUI's workflow undo takes Ctrl+Z from anything but an input
    const keys = this.el("input", { position: "absolute", width: "1px", height: "1px", opacity: "0", pointerEvents: "none" }, box);
    keys.readOnly = true;
    keys.setAttribute("aria-label", "time curve: arrows nudge the selected points, Delete removes them, Esc deselects, Ctrl+Z / Ctrl+Shift+Z undo / redo");
    keys.onfocus = () => { canvas.style.outline = "1px solid #5d6069"; };
    keys.onblur = () => { canvas.style.outline = "none"; };
    canvas.title = "amber: M per video latent frame; blue: the curve and its points; grey: the music on curve_audio (after a run)";

    const tools = this.el("div", { display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" }, box);
    const which = this.el("span", { color: "#888", minWidth: "110px", marginRight: "6px" }, tools);
    const field = (text, title, cb) => {
      this.el("span", { color: "#888" }, tools, text);
      const e = this.el("input", { width: "58px", background: "#111", color: "#ffc145", border: "1px solid #333", textAlign: "right" }, tools);
      Object.assign(e, { type: "number", step: 0.05, title });
      e.onchange = () => { const v = parseFloat(e.value), i = main(); if (Number.isFinite(v) && i >= 0) change(() => cb(i, v)); };
      return e;
    };
    const timeBox = field("time (s)", "the selected point's time in seconds; it stops 1/6 s before a neighbour",
      (i, v) => move([i], [[toS(spec.points[i][0]), spec.points[i][1]]], v - toS(spec.points[i][0]), 0, Infinity, [-Infinity, Infinity]));
    const levelBox = field("level", "the selected point's level: M multiplies the row strength", (i, v) => { spec.points[i][1] = v; });
    const effective = this.el("span", { color: "#c39bff", minWidth: "84px" }, tools);
    effective.title = "level × the row's strength: the dial strength the model gets at this point, for levels 0 to 1; outside that range the blend extrapolates and acts weaker";
    const del = this.button(tools, "delete", "delete the selected points (Delete key); a curve keeps at least two", () => remove(picked()), { padding: "1px 6px" });
    const msg = this.el("span", { color: "#ff8a5c" }, tools);
    const undo = this.button(tools, "Undo", "undo (Ctrl+Z on the canvas)", () => step(st.past, st.future), { padding: "1px 6px", marginLeft: "auto" });
    const redo = this.button(tools, "Redo", "redo (Ctrl+Shift+Z or Ctrl+Y on the canvas)", () => step(st.future, st.past), { padding: "1px 6px" });
    this.button(tools, "Reset", "back to the curve this editor opened with", () => change(() => restore(st.opened)), { padding: "1px 6px" });

    // scale tools: on the selected points, or all of them
    const scaling = this.el("div", { display: "flex", gap: "4px", alignItems: "center", flexWrap: "wrap" }, box);
    const on = this.el("span", { color: "#888", minWidth: "110px" }, scaling);
    const tool = (value, text, title, fn) => {
      const e = value === null ? null : this.el("input", { width: "46px", background: "#111", color: "#eee", border: "1px solid #333", textAlign: "right" }, scaling);
      if (e) Object.assign(e, { type: "number", step: 0.1, value, title });
      this.button(scaling, text, title, () => {
        const k = e ? parseFloat(e.value) : 0;
        let note = "";
        if (Number.isFinite(k)) change(() => { note = fn(targets(), k) || ""; });
        msg.textContent = note;
      }, { padding: "1px 6px", marginRight: "6px" });
    };
    const levels = (idx, f) => { for (const i of idx) spec.points[i][1] = Math.round(f(spec.points[i][1]) * 1e4) / 1e4; };
    tool(2, "× level", "multiply the levels by this", (idx, k) => levels(idx, (v) => v * k));
    tool(0.5, "+ level", "add this to the levels (negative lowers them)", (idx, k) => levels(idx, (v) => v + k));
    tool(null, "flip", "negate the levels: 1 becomes −1, the dial reversed", (idx) => levels(idx, (v) => -v));
    tool(1.5, "stretch time", "scale the times from the first to the last selected point (all points when none) about the first; " +
      "points keep 1/6 s apart and stop before the next point", (idx, k) => {
      const p = spec.points, s = p.map(([t]) => toS(t)), a = idx[0], z = idx.at(-1);
      if (z === a) return "stretch needs two points";
      const gap = Math.min(...s.slice(a + 1, z + 1).map((v, i) => v - s[a + i]));
      const f = Math.min(z < p.length - 1 ? (s[z + 1] - CURVE_GAP - s[a]) / (s[z] - s[a]) : Infinity, Math.max(CURVE_GAP / gap, k));
      for (let i = a + 1; i <= z; i++) p[i][0] = fromS(s[a] + (s[i] - s[a]) * f);
      return Math.abs(f - k) > 1e-9 ? `stretch held at ×${f.toFixed(2)}: points keep 1/6 s apart` : "";
    });

    const json = this.el("input", { boxSizing: "border-box", width: "100%", background: "#111", color: "#ddd", border: "1px solid #333" }, box);
    json.title = "JSON [time, M] points with increasing times, in the unit above; M multiplies the row strength";
    json.onchange = () => {
      try {
        const v = JSON.parse(json.value);
        if (!validPoints(v)) throw new Error("Use [time, M] pairs with increasing times");
        change(() => { spec.points = v; });
      } catch (e) { json.setCustomValidity(e.message); json.reportValidity(); }
    };
    this.el("div", { color: "#888", fontSize: "11px" }, box, CURVE_HELP);

    const picked = () => spec.points.flatMap((p, i) => (st.sel.includes(p) ? [i] : []));
    const main = () => spec.points.indexOf(st.sel.at(-1));
    const targets = () => (st.sel.length ? picked() : spec.points.map((_, i) => i));
    const draw = () => {
      axes = drawTime(canvas, spec, seconds, audio, canvas.clientWidth || 400, H, { axes: drag?.axes, top: st.top, bottom: st.bottom, win: st.win,
        strength: strength(), sel: picked(), main: main(), hover, ghost, box: lasso, label });
    };
    const show = () => {
      st.sel = st.sel.filter((p) => spec.points.includes(p));
      st.top = Math.max(st.top, ...spec.points.map((p) => p[1]));  // typed or pasted levels widen the range
      st.bottom = Math.min(st.bottom, ...spec.points.map((p) => p[1]));
      json.value = JSON.stringify(spec.points); json.setCustomValidity("");
      interpBox.value = spec.interp || "linear"; unitBox.value = spec.unit || "normalized"; topBox.value = st.top; bottomBox.value = st.bottom;
      smoothBox.value = spec.smooth || 0; smoothText.textContent = (spec.smooth || 0).toFixed(2);
      smoothBox.disabled = spec.interp === "step"; smoothLabel.style.opacity = smoothText.style.opacity = spec.interp === "step" ? "0.4" : "";
      const i = main(), p = spec.points[i], n = st.sel.length;
      which.textContent = p ? `point ${i + 1} of ${spec.points.length}${n > 1 ? ` (${n} selected)` : ""}:` : "no point selected:";
      timeBox.disabled = levelBox.disabled = !p; del.disabled = !n;
      timeBox.value = p ? +toS(p[0]).toFixed(3) : ""; levelBox.value = p ? +p[1].toFixed(3) : "";
      effective.textContent = p ? levelStrength(p[1], strength()) : "";
      on.textContent = n ? `${n} selected:` : `all ${spec.points.length} points:`;
      undo.disabled = !st.past.length; redo.disabled = !st.future.length; fit.disabled = !st.win;
      msg.textContent = "";
      if (mini) drawTime(mini, spec, seconds, audio, 50, 12);
      draw();
    };
    st.show = show;
    const refresh = () => { this.commit(); show(); };
    const change = (fn) => {
      const before = state();
      fn();
      if (state() !== before) { st.past.push(before); st.future = []; }
      refresh();
    };
    const step = (from, to) => {
      if (!from.length) return;
      to.push(state());
      restore(from.pop());
      refresh();
    };
    // points idx (in time order) to from[k] + [dt seconds, dv]: dt keeps them CURVE_GAP from the points that stay and within
    // 0..end, dv keeps the levels within lim
    const move = (idx, from, dt, dv, end = axes.span, lim = [axes.lo, axes.hi]) => {
      const p = spec.points, s = p.map(([t]) => toS(t));
      let a = -Infinity, b = Infinity;
      idx.forEach((i, k) => {
        if (!idx.includes(i - 1)) a = Math.max(a, (i ? s[i - 1] + CURVE_GAP : 0) - from[k][0]);
        if (!idx.includes(i + 1)) b = Math.min(b, (i < p.length - 1 ? s[i + 1] - CURVE_GAP : end) - from[k][0]);
      });
      const vs = from.map(([, v]) => v);
      dt = a <= b ? Math.min(b, Math.max(a, dt)) : 0;
      dv = Math.min(lim[1] - Math.max(...vs), Math.max(lim[0] - Math.min(...vs), dv));
      idx.forEach((i, k) => { p[i][0] = fromS(from[k][0] + dt); p[i][1] = Math.round((from[k][1] + dv) * 1e4) / 1e4; });
    };
    const remove = (idx) => {
      if (!idx.length) return;
      if (spec.points.length - idx.length < 2) { msg.textContent = "a curve keeps at least two points"; return; }
      change(() => { spec.points = spec.points.filter((_, i) => !idx.includes(i)); hover = null; });
    };
    const zoom = (win) => {  // seconds shown: at least 0.5 s, inside the clip; the whole clip is no zoom
      if (win) {
        const w = Math.max(0.5, win[1] - win[0]), a = Math.min(axes.span - w, Math.max(0, win[0]));
        win = w < axes.span ? [a, a + w] : null;
      }
      st.win = win;
      fit.disabled = !win;
      draw();
    };
    const snapTime = (s, free) => {
      const mode = this.curveSnap || "0.1", near = (list) => list.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a), list[0]);
      if (free || mode === "off") return s;
      if (mode === "frame") return near(frameStarts(axes.span).map((f) => f / 24));
      if (mode === "onset") { const o = near(onsets); return Math.abs(o - s) < 0.3 ? o : s; }
      return Math.round(s / Number(mode)) * Number(mode);
    };
    const snapLevel = (v, free) => {  // 0.05 steps; whole and half levels also pull from 3 px
      const half = Math.round(v * 2) / 2;
      v = free ? Math.round(v * 1000) / 1000 : Math.abs(axes.y(half) - axes.y(v)) <= 3 ? half : Math.round(v * 20) / 20;
      return Math.min(axes.hi, Math.max(axes.lo, v));
    };
    const at = (e) => {  // pointer -> canvas px; the node may be zoomed, so scale by the drawn size
      const b = canvas.getBoundingClientRect();
      return [(e.clientX - b.left) * canvas.clientWidth / b.width, (e.clientY - b.top) * H / b.height];
    };
    const hit = ([x, y]) => {
      let best = null, d = 10;
      spec.points.forEach(([t, v], i) => { const di = Math.hypot(axes.x(toS(t)) - x, axes.y(v) - y); if (di <= d) { d = di; best = i; } });
      return best;
    };
    const clampT = (px) => { const [t0, t1] = st.win || [0, axes.span]; return Math.min(t1, Math.max(t0, axes.t(px))); };
    const readout = (s, v, prefix) => [s, v, `${prefix}${s.toFixed(2)} s${norm() ? ` (${Math.round(s / seconds * 100)} %)` : ""} · ` +
      `level ${v.toFixed(2)} · ${levelStrength(v, strength())}`];
    const hovering = (pos, free) => {
      hover = hit(pos);
      ghost = hover === null ? [snapTime(clampT(pos[0]), free), snapLevel(axes.v(pos[1]), free)] : null;
      label = hover === null ? readout(...ghost, "add: ") : readout(toS(spec.points[hover][0]), spec.points[hover][1], `point ${hover + 1}: `);
      draw();
    };

    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.button !== 1) return;
      keys.focus({ preventScroll: true });
      canvas.setPointerCapture(e.pointerId);
      const pos = at(e), free = e.altKey || e.shiftKey;
      ghost = label = null;
      if (e.button === 1) { e.preventDefault(); pan = { x: pos[0], win: st.win || [0, axes.span] }; return; }
      if (e.ctrlKey || e.metaKey) { lasso = [...pos, ...pos, e.shiftKey]; return draw(); }
      let i = hit(pos);
      if (i !== null && e.shiftKey) {  // Shift+click toggles a point in the selection
        const p = spec.points[i];
        st.sel = st.sel.includes(p) ? st.sel.filter((q) => q !== p) : [...st.sel, p];
        return show();
      }
      const before = state();
      if (i === null) {  // add where clicked, unless a point is within one latent frame: then take that one
        const s = snapTime(clampT(pos[0]), free), k = spec.points.filter(([t]) => toS(t) < s).length;
        i = [k - 1, k].find((n) => spec.points[n] && Math.abs(toS(spec.points[n][0]) - s) < CURVE_GAP);
        if (i === undefined) { spec.points.splice(k, 0, [fromS(s), snapLevel(axes.v(pos[1]), free)]); i = k; }
      }
      const p = spec.points[i], grouped = st.sel.length > 1 && st.sel.includes(p);  // a selected point drags the selection
      st.sel = grouped ? [...st.sel.filter((q) => q !== p), p] : [p];
      const idx = picked();
      drag = { idx, k: idx.indexOf(i), before, axes, grouped, x0: pos[0], y0: pos[1], from: idx.map((j) => [toS(spec.points[j][0]), spec.points[j][1]]) };
      label = readout(...drag.from[drag.k], "");
      refresh();
    });
    canvas.addEventListener("pointermove", (e) => {
      const pos = at(e);
      if (pan) return zoom([pan.win[0] + (pan.x - pos[0]) / axes.pw * (pan.win[1] - pan.win[0]), pan.win[1] + (pan.x - pos[0]) / axes.pw * (pan.win[1] - pan.win[0])]);
      if (lasso) { lasso[2] = pos[0]; lasso[3] = pos[1]; return draw(); }
      if (!drag) return hovering(pos, e.altKey || e.shiftKey);
      const [s0, v0] = drag.from[drag.k];
      if (e.shiftKey) {  // fine: relative to where Shift went down, at a fifth of the speed
        move(drag.idx, drag.from, (axes.t(pos[0]) - axes.t(drag.x0)) * 0.2, Math.round((axes.v(pos[1]) - axes.v(drag.y0)) * 200) / 1000);
      } else {
        move(drag.idx, drag.from, snapTime(axes.t(pos[0]), e.altKey) - s0, snapLevel(axes.v(pos[1]), e.altKey) - v0);
        Object.assign(drag, { x0: pos[0], y0: pos[1], from: drag.idx.map((j) => [toS(spec.points[j][0]), spec.points[j][1]]) });
      }
      const [t, v] = spec.points[drag.idx[drag.k]];
      label = readout(toS(t), v, "");
      refresh();
    });
    canvas.addEventListener("pointerup", () => {
      if (lasso) {  // box select; Ctrl+Shift adds to the selection
        const [x0, y0, x1, y1, add] = lasso, inside = (a, b, c) => a >= Math.min(b, c) && a <= Math.max(b, c);
        const boxed = spec.points.filter(([t, v]) => inside(axes.x(toS(t)), x0, x1) && inside(axes.y(v), y0, y1));
        st.sel = add ? [...st.sel.filter((p) => !boxed.includes(p)), ...boxed] : boxed;
      }
      if (drag && state() !== drag.before) { st.past.push(drag.before); st.future = []; }
      else if (drag?.grouped) st.sel = st.sel.slice(-1);  // a click without a move on a selected point selects only it
      drag = lasso = pan = null;
      refresh();
    });
    canvas.addEventListener("pointerleave", () => { if (!drag && !lasso && !pan) { hover = ghost = label = null; draw(); } });
    canvas.addEventListener("wheel", (e) => {  // zoom the time axis around the cursor; Shift (or a sideways scroll) pans
      e.preventDefault(); e.stopPropagation();
      const pos = at(e), [t0, t1] = st.win || [0, axes.span];
      if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        const d = (e.deltaX || e.deltaY) / axes.pw * (t1 - t0);
        zoom([t0 + d, t1 + d]);
      } else {
        const t = axes.t(pos[0]), f = Math.exp(e.deltaY * 0.002);
        zoom([t - (t - t0) * f, t + (t1 - t) * f]);
      }
      if (!drag) hovering(pos, e.altKey);
    }, { passive: false });
    canvas.addEventListener("dblclick", (e) => { const i = hit(at(e)); if (i !== null) remove([i]); });
    canvas.addEventListener("contextmenu", (e) => { e.preventDefault(); const i = hit(at(e)); if (i !== null) remove([i]); });
    keys.addEventListener("keydown", (e) => {
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === "z" || key === "y")) {
        e.preventDefault();
        return key === "y" || e.shiftKey ? step(st.future, st.past) : step(st.past, st.future);
      }
      if (e.key === "Escape") { st.sel = []; return refresh(); }
      const idx = picked(), d = e.shiftKey ? 10 : 1;
      const nudge = { ArrowLeft: [-0.1 * d, 0], ArrowRight: [0.1 * d, 0], ArrowUp: [0, 0.05 * d], ArrowDown: [0, -0.05 * d] }[e.key];
      if (!idx.length || !(nudge || e.key === "Delete" || e.key === "Backspace")) return;
      e.preventDefault();
      if (!nudge) return remove(idx);
      change(() => move(idx, idx.map((i) => [toS(spec.points[i][0]), spec.points[i][1]]), ...nudge, axes.span, [-Infinity, Infinity]));
    });
    show();
    requestAnimationFrame(draw);
    st.keys = keys;
    if (st.refocus) keys.focus({ preventScroll: true });
  }

  clipSeconds() {
    return this.node.properties?.dialClipSeconds || CLIP_SECONDS;
  }

  async padNorms(rx, ry) {
    if ("input" in rx || "input" in ry) return;
    const key = rx.dial + "|" + ry.dial;
    if (key in this.padGeometry) return;
    this.padGeometry[key] = null;
    try {
      const r = await api.fetchApi("/mainodes/dials/geometry", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dials: [rx.dial, ry.dial] }) });
      this.padGeometry[key] = r.ok ? await r.json() : { error: (await r.json()).error };
    } catch (e) { this.padGeometry[key] = { error: e.message }; }
    this.map.draw();
  }

  showPresetMessage(message) {
    this.presetMessage = message;
    this.render();
  }

  presetEditor(tag) {
    this.presetBar.replaceChildren();
    this.presetBar.style.display = "flex";
    const field = this.el(tag, { flex: "1", minWidth: "80px", background: "#111", color: "#eee", border: "1px solid #444" }, this.presetBar);
    this.button(this.presetBar, "Cancel", "close preset controls", () => { this.presetBar.style.display = "none"; this.render(); });
    return field;
  }

  savePreset() {
    const name = this.presetEditor("input");
    name.placeholder = "Preset name"; name.maxLength = 80; name.setAttribute("aria-label", "Preset name");
    this.button(this.presetBar, "Save", "save to the dial presets folder", async (button) => {
      button.disabled = true;
      try {
        if (!/^[A-Za-z0-9_-]{1,80}$/.test(name.value)) throw new Error("Preset name: letters, digits, '_' and '-' only (max 80).");
        const data = await presetRequest(`/${encodeURIComponent(name.value)}`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(this.rows),
        });
        this.presetWarnings = data.warnings;
        this.presetBar.style.display = "none";
        this.showPresetMessage(`Saved preset ${name.value}.` + this.warningText());
      } catch (e) { this.showPresetMessage(e.message); }
      finally { button.disabled = false; }
    });
    this.render(); name.focus();
  }

  async loadPreset() {
    try {
      if (this.rows.some((row) => "input" in row)) throw new Error("Disconnect wired dials before loading a preset.");
      const names = await presetRequest();
      if (!names.length) { this.showPresetMessage("No saved presets yet."); return; }
      const select = this.presetEditor("select");
      select.setAttribute("aria-label", "Saved preset");
      for (const name of names) this.el("option", {}, select, name).value = name;
      this.button(this.presetBar, "Load", "load the selected preset", async (button) => {
        button.disabled = true;
        try {
          const data = await presetRequest(`/${encodeURIComponent(select.value)}`);
          await listDials(true);
          this.rows = data.preset.rows;
          this.presetWarnings = data.warnings;
          this.report = "";
          this.commit();
          this.presetBar.style.display = "none";
          this.showPresetMessage(`Loaded preset ${select.value}.` + this.warningText());
        } catch (e) { this.showPresetMessage(e.message); }
        finally { button.disabled = false; }
      });
      this.render();
    } catch (e) { this.showPresetMessage(e.message); }
  }

  warningText() {
    return this.presetWarnings.map((w) => `\nRow ${w.row + 1}: ${w.dial} — ${w.reason}`).join("");
  }

  addRow(row) {
    const files = dialFiles || [];
    this.rows.push(row || { on: true, dial: files.find((f) => /motion/.test(f)) || files[0] || "", strength: DEFAULT_STRENGTH, solo: false });
    this.commit();
    this.render();
  }

  syncInputs() {
    // rows for wired dial_N inputs come and go with their links
    const wired = (this.node.inputs || []).filter((i) => /^dials\.dial_\d+$|^dial_\d+$/.test(i.name) && i.link != null).map((i) => i.name.replace(/^dials\./, ""));
    const before = JSON.stringify(this.rows);
    this.rows = this.rows.filter((r) => !("input" in r) || wired.includes(r.input));
    for (const name of wired) if (!this.rows.some((r) => r.input === name)) this.rows.push({ on: true, input: name, strength: DEFAULT_STRENGTH, solo: false });
    if (JSON.stringify(this.rows) !== before) { this.commit(); this.render(); }
  }

  closeEditor() {
    this.dialEditor = null;
    this.render();
  }

  render() {
    if (this.dialEditor && (!this.rows.includes(this.dialEditor.r) || this.dialEditor.r.dial !== this.dialEditor.file)) this.dialEditor = null;
    if (this.curve) this.curve.refocus = document.activeElement === this.curve.keys;  // keys keep working across rebuilds
    this.list.replaceChildren();
    const files = dialFiles || [];
    const active = (r) => r.on && (r.hold || Number(r.strength) !== 0);
    const anySolo = this.rows.some((r) => active(r) && r.solo);
    if (!this.rows.length) this.el("div", { color: "#777", padding: "4px 2px" }, this.list, "No dials yet: add one, or wire a dial into a dial_ input.");
    else {
      const head = this.el("div", { display: "flex", gap: "6px", padding: "0 4px", color: "#888", fontSize: "11px" }, this.list);
      this.el("span", { flex: "1 1 auto", paddingLeft: "20px" }, head, "dial · strength");
      this.el("span", { width: "76px" }, head, "steps").title = "strength over the denoising steps (constant, early, late, bell, manual)";
      this.el("span", { width: "70px" }, head, "clip").title = "strength over the clip's time: click a row's curve to draw it";
      this.el("span", { width: "60px" }, head, "");
    }
    this.rows.forEach((r, i) => {
      const live = active(r) && (!anySolo || r.solo);
      const row = this.el("div", { display: "flex", alignItems: "center", gap: "6px", padding: "3px 4px", borderRadius: "4px",
        background: live ? "#1f2128" : "#191a1e", opacity: live ? "1" : "0.55" }, this.list);
      // calm row: on, dial, strength, steps envelope, clip curve; blocks, info, editor, solo and hold sit behind ⋯
      const more = this.el("div", { display: this.moreOpen === i ? "flex" : "none", alignItems: "center", gap: "6px", padding: "0 4px 3px 24px" }, this.list);
      const on = this.el("input", { margin: 0, cursor: "pointer" }, row);
      on.type = "checkbox"; on.checked = !!r.on; on.title = "on / off";
      on.onchange = () => { r.on = on.checked; this.commit(); this.render(); };
      if ("input" in r) {
        this.el("span", { flex: "1 1 auto", minWidth: "80px", color: "#8fb4ff" }, row, `⇠ ${r.input}`).title = "dial wired into this input";
      } else {
        const sel = this.el("select", { flex: "1 1 auto", minWidth: "80px", background: "#111", color: "#eee", border: "1px solid #333", borderRadius: "3px" }, row);
        const opts = files.includes(r.dial) || !r.dial ? files : [r.dial, ...files];
        const label = labels(opts);
        for (const f of opts) { const o = this.el("option", {}, sel, label(f) + (files.includes(f) ? "" : "  (missing)")); o.value = f; }
        sel.value = r.dial;
        const about = this.dialInfo(r.dial);
        const range = (v) => `useful ${v.useful ?? "?"}, overcook ${v.overcook ?? "?"}`;
        sel.title = r.dial + (about.description ? "\n\n" + about.description : "") +
          `\n− ${range(about.neg)}  ·  + ${range(about.pos)}  (? = unknown)\nevidence: ${about.evidence || "unknown"}` +
          (about.pipeline ? `, ${about.pipeline}` : "") + (about.notes ? `\n${about.notes}` : "");
        sel.onchange = () => { r.dial = sel.value; this.commit(); this.render(); };
      }
      const slider = this.el("input", { width: "110px", accentColor: "#ffc145" }, row);
      Object.assign(slider, { type: "range", min: SLIDER[0], max: SLIDER[1], step: 0.05, value: r.strength });
      const num = this.el("input", { width: "58px", background: "#111", color: "#ffc145", border: "1px solid #333", borderRadius: "3px", textAlign: "right" }, row);
      Object.assign(num, { type: "number", min: NUMBER[0], max: NUMBER[1], step: 0.05, value: Number(r.strength).toFixed(2) });
      num.title = "negative = toward the pairs' A side, positive = toward B. +0.5 to +1 is the sane range; past ~1.5 side effects appear";
      slider.disabled = num.disabled = !!r.hold;
      if (r.hold) slider.title = num.title = "Hold removes this direction fully; strength is retained for when H is turned off.";
      const strengthChanged = () => { this.commit(); if (this.pad.open) { this.map.draw(); this.matrix.draw(); } if (this.curve?.r === r) this.curve.show(); };
      slider.oninput = () => { r.strength = parseFloat(slider.value); num.value = r.strength.toFixed(2); strengthChanged(); };
      num.onchange = () => { const v = Math.min(NUMBER[1], Math.max(NUMBER[0], parseFloat(num.value) || 0)); r.strength = v; slider.value = v; num.value = v.toFixed(2); strengthChanged(); };
      slider.ondblclick = () => { r.strength = 0; slider.value = 0; num.value = "0.00"; strengthChanged(); };
      const envelope = this.el("select", { width: "76px", background: "#111", color: "#ddd", border: "1px solid #333" }, row);
      envelope.title = "Strength over denoising progress: early, late, bell, or manual points (post-refiner dials only)";
      for (const kind of ["constant", "early", "late", "bell", "manual"]) {
        const option = this.el("option", {}, envelope, kind); option.value = kind;
      }
      envelope.value = typeof r.envelope === "string" ? r.envelope : r.envelope?.type || "constant";
      if (this.rows.some((x) => x.on && x.hold)) {  // the backend refuses envelopes in a rack with active holds
        envelope.disabled = true;
        envelope.title = "Envelopes and hold rows cannot share a rack: turn the hold rows off to schedule this row.";
      }
      envelope.onchange = () => {
        if (envelope.value === "constant") delete r.envelope;
        else r.envelope = envelope.value === "manual" ? { type: "manual", points: [[0, 0], [0.5, 1], [1, 0]] } : envelope.value;
        this.commit(); this.render();
      };
      const strip = this.button(more, r.blocks ? "" : "blocks", "block strengths: " + BLOCKS_HELP,
        () => { this.blocksEditing = this.blocksEditing === i ? null : i; this.render(); },
        Object.assign({ padding: "1px 4px", width: "60px" }, this.blocksEditing === i ? { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145" } : {}));
      if (r.blocks) drawBlocks(this.el("canvas", { display: "block", width: "50px", height: "12px" }, strip), r.blocks, null, 50, 12);
      if (r.hold) {
        strip.disabled = true; strip.style.opacity = "0.4";
        strip.title = "Hold rows remove the whole direction; block strengths apply to strength rows.";
      }
      const clip = this.button(row, "", "clip: strength over the clip's time (click to draw a curve). " + TIME_HELP,
        () => { this.timeEditing = this.timeEditing === i ? null : i; this.curve = null; this.render(); },
        Object.assign({ padding: "1px 4px", width: "60px" }, this.timeEditing === i ? { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145" } : {}));
      const mini = this.el("canvas", { display: "block", width: "50px", height: "12px" }, clip);
      drawTime(mini, r.time || { type: "keys", points: [[0, 1], [1, 1]], unit: "normalized", interp: "linear" }, this.clipSeconds(), this.curveAudio, 50, 12);
      if (!r.time) mini.style.opacity = "0.45";  // flat: the whole clip at the row's strength
      const blocker = r.hold ? "Hold rows remove the whole direction; time curves apply to strength rows."
        : this.rows.some((x) => x.on && x.hold) ? "Time curves and hold rows cannot share a rack: turn the hold rows off."
          : r.envelope || r.blocks ? "A time curve replaces the row's step envelope and block strengths: set them back to constant / all." : "";
      if (blocker && !r.time) { clip.disabled = true; clip.style.opacity = "0.4"; clip.title = blocker; }
      if (r.time) {
        envelope.disabled = strip.disabled = true;
        envelope.style.opacity = strip.style.opacity = "0.4";
        envelope.title = strip.title = "This row has a time curve, which runs its own early-step schedule.";
      }
      const set = [r.blocks && "blocks", r.solo && "S", r.hold && "H"].filter(Boolean).join(" ");
      this.button(row, set ? "⋯ " + set : "⋯", "more: block strengths, dial info (⚙), dial editor (✎), solo (S), hold (H)",
        () => { this.moreOpen = this.moreOpen === i ? null : i; this.render(); },
        Object.assign({ padding: "2px 6px" }, this.moreOpen === i || set ? { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145" } : {}));
      if (!("input" in r)) this.button(row, "✕", "remove row", () => { this.rows.splice(i, 1); this.commit(); this.render(); }, { padding: "2px 6px" });
      if (!("input" in r)) this.button(more, "⚙", "dial info: description, what − and + give, useful and overcook strengths per side, evidence (saved in the dial file)",
        () => { this.editing = this.editing === i ? null : i; this.render(); },
        this.editing === i ? { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145", padding: "2px 6px" } : { padding: "2px 6px" });
      if (!("input" in r)) this.button(more, "✎", "dial editor: see this dial's probe profile and its place among the saved dials, drag to edit, export as a new dial",
        () => { this.dialEditor = this.dialEditor?.r === r ? null : new DialEditor(this, r); this.render(); },
        this.dialEditor?.r === r ? { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145", padding: "2px 6px" } : { padding: "2px 6px" });
      this.button(more, "S", "solo: hear only the soloed rows", () => { r.solo = !r.solo; this.commit(); this.render(); },
        r.solo ? { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145", padding: "2px 6px" } : { padding: "2px 6px" });
      const hold = this.button(more, "H", "hold: remove this direction from the summed shift (post-refiner dials only)",
        () => { r.hold = !r.hold; this.commit(); this.render(); },
        r.hold ? { background: "#20323b", borderColor: "#8fb4ff", color: "#8fb4ff", padding: "2px 6px" } : { padding: "2px 6px" });
      hold.setAttribute("aria-pressed", String(!!r.hold));
      if (this.editing === i && !("input" in r)) this.infoEditor(r.dial);
      if (this.blocksEditing === i && !r.hold) this.blocksEditor(r, this.rowName(i));
      if (this.timeEditing === i && !r.hold) this.timeEditor(r, this.rowName(i), mini);
      if (this.dialEditor?.r === r) { this.list.appendChild(this.dialEditor.box); this.dialEditor.draw(); }
      if (r.envelope?.type === "manual") {
        const line = this.el("div", { display: "flex", gap: "4px", alignItems: "center" }, this.list);
        const points = this.el("input", { boxSizing: "border-box", flex: "1 1 auto", minWidth: "0", background: "#111", color: "#ddd", border: "1px solid #333" }, line);
        const label = this.el("span", { color: "#888" }, line, "rate smoothing");
        const smooth = this.el("input", { width: "64px", accentColor: "#8fb4ff" }, line);
        Object.assign(smooth, { type: "range", min: 0, max: 1, step: 0.05, value: r.envelope.smooth || 0 });
        const value = this.el("span", { color: "#ffc145", minWidth: "26px" }, line, (r.envelope.smooth || 0).toFixed(2));
        label.title = smooth.title = "rounds the corners at each point (0: straight lines; 1: fully smooth), still through every point and never past it";
        smooth.oninput = () => {
          r.envelope.smooth = parseFloat(smooth.value);
          if (!r.envelope.smooth) delete r.envelope.smooth;
          value.textContent = (r.envelope.smooth || 0).toFixed(2); this.commit();
        };
        points.value = JSON.stringify(r.envelope.points);
        points.title = "JSON [progress, gain] points; progress increases from 0 to 1; gain multiplies the row strength";
        points.onchange = () => {
          try {
            const v = JSON.parse(points.value);
            if (!Array.isArray(v) || v.length < 2 || !v.every((p, i) => Array.isArray(p) && p.length === 2 &&
              p.every((n) => typeof n === "number" && Number.isFinite(n)) && p[0] >= 0 && p[0] <= 1 && (!i || p[0] > v[i - 1][0]))) throw new Error("Use increasing [progress, gain] pairs within progress 0..1");
            r.envelope.points = v; points.setCustomValidity(""); this.commit();
          } catch (e) { points.setCustomValidity(e.message); points.reportValidity(); }
        };
      }
    });
    const n = this.rows.filter((r) => active(r) && (!anySolo || r.solo)).length;
    this.hint.textContent = anySolo ? `solo · ${n} active` : `${n} active`;
    this.out.style.display = this.report ? "block" : "none";
    this.out.textContent = this.report;
    this.notice.style.display = this.presetMessage ? "block" : "none";
    this.notice.textContent = this.presetMessage;
    const open = this.pad.open;
    this.mapColumn.style.display = open ? "block" : "none";
    this.left.style.flex = open ? `0 0 ${LEFT_PX}px` : "1 1 auto";
    this.padButton.style.borderColor = open ? "#ffc145" : "#444";
    if (open) { this.map.render(); this.matrix.draw(); }
    const key = [this.rows.length, open, this.report, this.presetMessage, this.presetBar.style.display, this.editing, this.blocksEditing, this.dialEditor?.file, this.dialEditor?.box.childElementCount,
      this.timeEditing, this.rows[this.timeEditing]?.time?.type, this.curveTall, this.moreOpen].join("|");
    if (key !== this.contentKey && this.root.clientHeight) {  // content changed: grow to show it; never shrink what the user sized
      // (before the widget is laid out, e.g. while a workflow loads, the saved size stands)
      this.contentKey = key;
      const rowsHeight = [...this.left.children].reduce((h, c) => h + (c.offsetParent ? c.offsetHeight + 6 : 0), 12);
      const extra = Math.max(this.node.size[1] - this.root.clientHeight, 30);  // title bar and inputs
      const minW = open ? LEFT_PX + 10 + 360 + 24 : 600;
      this.node.setSize([Math.max(this.node.size[0], minW), Math.max(this.node.size[1], Math.max(rowsHeight, open ? 560 : 0) + extra)]);
    }
    this.node.setDirtyCanvas(true, true);
  }
}

app.registerExtension({
  name: "MAINodes.DialRack",
  setup() {
    // a Make Dial node that saved a file: offer it in every rack's dial list without a click on ↻
    api.addEventListener("executed", async ({ detail }) => {
      if (!(detail?.output?.text || []).some((t) => /^saved .+\.safetensors$/m.test(t))) return;
      await listDials(true);
      for (const n of app.graph?._nodes || []) n.dialRack?.render();
    });
    api.addEventListener("mai-dial-envelope", ({ detail }) => {
      const rack = app.graph?.getNodeById(detail.node)?.dialRack;
      if (!rack) return;
      rack.report = detail.text;
      const clip = /time curves over a ([\d.]+) s clip/.exec(detail.text);
      if (clip) rack.node.properties.dialClipSeconds = Number(clip[1]);
      rack.render();
    });
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "MAIDialRack") return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = created?.apply(this, arguments);
      try { this.dialRack = new DialRackUI(this); } catch (e) { console.error("Dial Rack UI failed:", e); }
      return r;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = configure?.apply(this, arguments);
      if (this.dialRack) { this.dialRack.load(); this.dialRack.render(); setTimeout(() => this.dialRack?.syncInputs(), 0); }
      return r;
    };
    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function () {
      const r = connections?.apply(this, arguments);
      setTimeout(() => this.dialRack?.syncInputs(), 0);
      return r;
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      executed?.apply(this, arguments);
      if (this.dialRack) {
        this.dialRack.report = (message?.text || []).join("\n");
        const blocks = /block strengths over (\d+) model blocks/.exec(this.dialRack.report);
        if (blocks) this.properties.dialBlocks = Number(blocks[1]);
        if (message?.timecurve) this.dialRack.curveAudio = message.timecurve[0];
        this.dialRack.render();
      }
    };
  },
});
