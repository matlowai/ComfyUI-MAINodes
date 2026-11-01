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
const INFO_DEFAULTS = { description: "", negative: "", positive: "", useful: 1, overcook: 1.5 };
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
    this.selStep.value = pad.step;
    this.fit();
    this.draw();
  }

  draw() {
    if (!this.size) return;
    const c = this.canvas, g = c.getContext("2d"), S = this.size, rack = this.rack;
    const [rx, ry] = this.axes();
    const info = (r) => (r && !("input" in r) ? rack.dialInfo(r.dial) : INFO_DEFAULTS);
    const ix = info(rx), iy = info(ry);
    // auto range: room for both dials' overcook ellipse plus a margin
    const R = this.R = rack.pad.range === "auto" ? Math.max(1.5, Math.ceil(Math.max(ix.overcook, iy.overcook) * 1.25 * 2) / 2) : rack.pad.range;
    const px = (v) => (v / R + 1) / 2 * S;
    g.setTransform(c.width / S, 0, 0, c.width / S, 0, 0);
    g.fillStyle = "#101114"; g.fillRect(0, 0, S, S);
    g.strokeStyle = "#1e2026"; g.lineWidth = 1;
    const grid = R > 4 ? 1 : 0.5;
    for (let v = -Math.floor(R / grid) * grid; v <= R + 1e-9; v += grid) {
      g.beginPath(); g.moveTo(px(v), 0); g.lineTo(px(v), S); g.moveTo(0, px(v)); g.lineTo(S, px(v)); g.stroke();
    }
    g.strokeStyle = "#3a3d46"; g.beginPath(); g.moveTo(px(0), 0); g.lineTo(px(0), S); g.moveTo(0, px(0)); g.lineTo(S, px(0)); g.stroke();
    const ring = (rxv, ryv, color, dash) => {  // per-axis radii from each dial's own info
      g.setLineDash(dash); g.strokeStyle = color; g.beginPath();
      g.ellipse(px(0), px(0), rxv / R * S / 2, ryv / R * S / 2, 0, 0, 2 * Math.PI); g.stroke(); g.setLineDash([]);
    };
    ring(ix.useful, iy.useful, "#3f6b4a", []);
    ring(ix.overcook, iy.overcook, "#7a5a22", [4, 4]);
    g.fillStyle = "#666"; g.font = "10px sans-serif";
    g.fillText("useful", px(0) + 3, px(iy.useful) + 11);
    g.fillText("overcooked", px(0) + 3, px(iy.overcook) + 11);
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
    const past = Math.hypot(sx / ix.useful, sy / iy.useful) > 1, cooked = Math.hypot(sx / ix.overcook, sy / iy.overcook) > 1;
    g.fillStyle = cooked ? "#ff6b5c" : past ? "#ffa64d" : "#ffc145";
    g.beginPath(); g.arc(px(Math.max(-R, Math.min(R, sx))), px(-Math.max(-R, Math.min(R, sy))), 6, 0, 2 * Math.PI); g.fill();
    g.fillStyle = "#ddd";
    const xl = `${ix.positive || rack.rowName(this.pair.x)} →`;
    g.fillText(xl, S - 4 - g.measureText(xl).width, px(0) - 4);
    if (ix.negative) g.fillText(`← ${ix.negative}`, 4, px(0) - 4);
    g.fillText(`↑ ${iy.positive || rack.rowName(this.pair.y)}`, px(0) + 4, 12);
    if (iy.negative) g.fillText(`↓ ${iy.negative}`, px(0) + 4, S - 6);
    let text = `X ${rack.rowName(this.pair.x)} ${fmt(sx)}  ·  Y ${rack.rowName(this.pair.y)} ${fmt(sy)}  ·  ` +
      (cooked ? "overcooked" : past ? "past useful" : "within useful");
    const geo = rack.padGeometry[rx.dial + "|" + ry.dial];
    if (geo === undefined) rack.padNorms(rx, ry);
    if (geo?.error) text += `\n${geo.error}`;
    else if (geo && geo.mode[0] !== geo.mode[1]) text += "\ndifferent injection points (pre/post): no combined readout";
    else if (geo && geo.cos[0][1] !== null) {
      const [nx, ny] = geo.norm, cos = geo.cos[0][1];
      const push = Math.sqrt(Math.max(0, (sx * nx) ** 2 + (sy * ny) ** 2 + 2 * sx * sy * nx * ny * cos)) / ((nx + ny) / 2);
      text += `\noverlap cos ${fmt(cos)}${Math.abs(cos) >= 0.5 ? (cos > 0 ? " (they reinforce)" : " (they cancel)") : ""}` +
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
    this.widget = this.node.addDOMWidget("dial_rack_ui", "div", root, { serialize: false, getMinHeight: () => 140 });
    this.root = root;
  }

  // ---------- map: UI-only state saved with the workflow, {open, pairs: [{x, y}], active, range, step} ----------
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
    const useful = input("useful ±", info.useful, { props: { type: "number", min: 0.05, max: 20, step: 0.05,
      title: "strength where the effect is clearly there (inner ellipse on the map)" } });
    const over = input("overcook ±", info.overcook, { props: { type: "number", min: 0.05, max: 20, step: 0.05,
      title: "strength where side effects take over (outer ellipse on the map)" } });
    const actions = this.el("div", { gridColumn: "span 4", display: "flex", gap: "6px", alignItems: "center" }, box);
    const msg = this.el("span", { color: "#ff8a5c" }, actions);
    this.button(actions, "Save to dial file", "write this info into the dial's .safetensors metadata (the vector is unchanged)", async (b) => {
      b.disabled = true;
      try {
        const r = await api.fetchApi("/mainodes/dials/info", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dial: file, info: { description: desc.value, negative: neg.value, positive: pos.value,
            useful: parseFloat(useful.value), overcook: parseFloat(over.value) } }) });
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
        sel.title = r.dial + (about.description ? "\n\n" + about.description : "") +
          `\nuseful ±${about.useful}, overcooked past ±${about.overcook}`;
        sel.onchange = () => { r.dial = sel.value; this.commit(); this.render(); };
      }
      const slider = this.el("input", { width: "110px", accentColor: "#ffc145" }, row);
      Object.assign(slider, { type: "range", min: SLIDER[0], max: SLIDER[1], step: 0.05, value: r.strength });
      const num = this.el("input", { width: "58px", background: "#111", color: "#ffc145", border: "1px solid #333", borderRadius: "3px", textAlign: "right" }, row);
      Object.assign(num, { type: "number", min: NUMBER[0], max: NUMBER[1], step: 0.05, value: Number(r.strength).toFixed(2) });
      num.title = "negative = toward the pairs' A side, positive = toward B. +0.5 to +1 is the sane range; past ~1.5 side effects appear";
      slider.disabled = num.disabled = !!r.hold;
      if (r.hold) slider.title = num.title = "Hold removes this direction fully; strength is retained for when H is turned off.";
      slider.oninput = () => { r.strength = parseFloat(slider.value); num.value = r.strength.toFixed(2); this.commit(); };
      num.onchange = () => { const v = Math.min(NUMBER[1], Math.max(NUMBER[0], parseFloat(num.value) || 0)); r.strength = v; slider.value = v; num.value = v.toFixed(2); this.commit(); };
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
      if (!("input" in r)) this.button(row, "⚙", "dial info: description, what − and + give, useful and overcook strengths (saved in the dial file)",
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
    if (open) this.map.render();
    const key = [this.rows.length, open, this.report, this.presetMessage, this.presetBar.style.display, this.editing].join("|");
    if (key !== this.contentKey) {  // content changed: grow to show it; never shrink what the user sized
      this.contentKey = key;
      const rowsHeight = [...this.left.children].reduce((h, c) => h + (c.offsetParent ? c.offsetHeight + 6 : 0), 12);
      const extra = Math.max(this.node.size[1] - this.root.clientHeight, 30);  // title bar and inputs
      const minW = open ? LEFT_PX + 10 + 360 + 24 : 600;
      this.node.setSize([Math.max(this.node.size[0], minW), Math.max(this.node.size[1], Math.max(rowsHeight, open ? 420 : 0) + extra)]);
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
