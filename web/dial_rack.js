// Dial Rack — one row per dial (on/off, dial, strength, solo, hold) over the MAIDialRack node's hidden `rack` JSON widget.
// The widget IS the state (saved with the workflow, read by the backend); this UI only edits it.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const DEFAULT_STRENGTH = 0.5;   // the sane everyday range is +0.5 .. +1
const SLIDER = [-3, 3];
const NUMBER = [-20, 20];
const PRESETS = "/mainodes/dials/presets";
const LEFT_PX = 590;     // the rows column keeps this width; the map takes the rest of the node
const MAP_MIN = 160;
const PAD_RANGES = ["auto", 1.5, 3, 6, 12];
const UNKNOWN = { useful: null, overcook: null };
const INFO_DEFAULTS = { version: 2, description: "", negative: "", positive: "", neg: UNKNOWN, pos: UNKNOWN, evidence: null, pipeline: "", notes: "" };
const EVIDENCE = ["creator", "one-seed", "multi-seed", "multi-scene"];
const QUADRANTS = [[1, -1], [-1, -1], [1, 1], [-1, 1]];  // [x sign, y sign] of the map's quarters; ring labels go in the first drawn
const side = (info, s) => (s < 0 ? info.neg : info.pos);
const SWEEP_STEPS = [0.25, 0.5, 1];

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
    this.stage = el("div", { flex: "1 1 auto", minHeight: "0", display: "flex", alignItems: "flex-start", justifyContent: "center" }, this.box);
    this.canvas = el("canvas", { cursor: "crosshair", borderRadius: "4px", outline: "none" }, this.stage);
    this.canvas.tabIndex = 0;
    this.canvas.title = "drag: move both dials · Shift+drag: fine · arrows: ±0.05 (Shift ±0.25) · double-click: back to 0";
    this.readout = el("div", { color: "#9a9ba0", fontSize: "11px", whiteSpace: "pre-wrap", flex: "0 0 auto" }, this.box);
    new ResizeObserver(() => this.fit()).observe(this.stage);

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

  fit() {  // the map is the only thing that follows the node's size: the largest square the stage can hold
    const size = Math.max(MAP_MIN, Math.floor(Math.min(this.stage.clientWidth, this.stage.clientHeight || this.stage.clientWidth)));
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
      g.fillStyle = "#5c5f68";
      g.fillText(bank.negative[j], C + zero * 0.55 * Math.cos(angle(j)), C + zero * 0.55 * Math.sin(angle(j)));
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
          body: JSON.stringify({ dial: file, info: { version: 2, description: desc.value, negative: neg.value, positive: pos.value,
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

  render() {
    this.list.replaceChildren();
    const files = dialFiles || [];
    const active = (r) => r.on && (r.hold || Number(r.strength) !== 0);
    const anySolo = this.rows.some((r) => active(r) && r.solo);
    if (!this.rows.length) this.el("div", { color: "#777", padding: "4px 2px" }, this.list, "No dials yet: add one, or wire a dial into a dial_ input.");
    this.rows.forEach((r, i) => {
      const live = active(r) && (!anySolo || r.solo);
      const row = this.el("div", { display: "flex", alignItems: "center", gap: "6px", padding: "3px 4px", borderRadius: "4px",
        background: live ? "#1f2128" : "#191a1e", opacity: live ? "1" : "0.55" }, this.list);
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
      slider.oninput = () => { r.strength = parseFloat(slider.value); num.value = r.strength.toFixed(2); this.commit(); if (this.pad.open) { this.map.draw(); this.matrix.draw(); } };
      num.onchange = () => { const v = Math.min(NUMBER[1], Math.max(NUMBER[0], parseFloat(num.value) || 0)); r.strength = v; slider.value = v; num.value = v.toFixed(2); this.commit(); if (this.pad.open) { this.map.draw(); this.matrix.draw(); } };
      slider.ondblclick = () => { r.strength = 0; slider.value = 0; num.value = "0.00"; this.commit(); };
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
      if (!("input" in r)) this.button(row, "⚙", "dial info: description, what − and + give, useful and overcook strengths per side, evidence (saved in the dial file)",
        () => { this.editing = this.editing === i ? null : i; this.render(); },
        this.editing === i ? { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145", padding: "2px 6px" } : { padding: "2px 6px" });
      this.button(row, "S", "solo: hear only the soloed rows", () => { r.solo = !r.solo; this.commit(); this.render(); },
        r.solo ? { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145", padding: "2px 6px" } : { padding: "2px 6px" });
      const hold = this.button(row, "H", "hold: remove this direction from the summed shift (post-refiner dials only)",
        () => { r.hold = !r.hold; this.commit(); this.render(); },
        r.hold ? { background: "#20323b", borderColor: "#8fb4ff", color: "#8fb4ff", padding: "2px 6px" } : { padding: "2px 6px" });
      hold.setAttribute("aria-pressed", String(!!r.hold));
      if (!("input" in r)) this.button(row, "✕", "remove row", () => { this.rows.splice(i, 1); this.commit(); this.render(); }, { padding: "2px 6px" });
      if (this.editing === i && !("input" in r)) this.infoEditor(r.dial);
      if (r.envelope?.type === "manual") {
        const points = this.el("input", { boxSizing: "border-box", width: "100%", background: "#111", color: "#ddd", border: "1px solid #333" }, this.list);
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
    const key = [this.rows.length, open, this.report, this.presetMessage, this.presetBar.style.display, this.editing].join("|");
    if (key !== this.contentKey) {  // content changed: grow to show it; never shrink what the user sized
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
    api.addEventListener("mai-dial-envelope", ({ detail }) => {
      const rack = app.graph?.getNodeById(detail.node)?.dialRack;
      if (rack) { rack.report = detail.text; rack.render(); }
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
      if (this.dialRack) { this.dialRack.report = (message?.text || []).join("\n"); this.dialRack.render(); }
    };
  },
});
