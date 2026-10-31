// Dial Rack — one row per dial (on/off, dial, strength, solo, hold) over the MAIDialRack node's hidden `rack` JSON widget.
// The widget IS the state (saved with the workflow, read by the backend); this UI only edits it.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const DEFAULT_STRENGTH = 0.5;   // the sane everyday range is +0.5 .. +1
const SLIDER = [-3, 3];
const NUMBER = [-20, 20];
const PRESETS = "/mainodes/dials/presets";
const PAD_PX = 240;
const PAD_RANGES = [1.5, 3, 6];
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
    const root = this.el("div", { display: "flex", flexDirection: "column", gap: "6px", padding: "6px", boxSizing: "border-box",
      width: "100%", background: "#16171b", borderRadius: "6px", fontFamily: "sans-serif", fontSize: "12px", color: "#ddd" });
    for (const ev of ["pointerdown", "keydown", "wheel"]) root.addEventListener(ev, (e) => e.stopPropagation());
    this.list = this.el("div", { display: "flex", flexDirection: "column", gap: "4px" }, root);
    this.buildPad(root);
    const bar = this.el("div", { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }, root);
    this.button(bar, "+ Add dial", "add a dial row", () => this.addRow(), { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145" });
    this.button(bar, "↻", "refresh the list of dial files", async () => { await listDials(true); this.render(); });
    this.button(bar, "Save preset", "save these rows as a named preset", () => this.savePreset());
    this.button(bar, "Load preset", "replace these rows with a saved preset", () => this.loadPreset());
    this.padButton = this.button(bar, "Pad", "move two dials together on a 2D pad: the dot is your prompt", () => {
      this.pad.open = !this.pad.open; this.render();
    });
    this.hint = this.el("span", { color: "#888", marginLeft: "auto" }, bar);
    this.presetBar = this.el("div", { display: "none", gap: "6px", alignItems: "center" }, root);
    this.notice = this.el("div", { display: "none", color: "#ffc145", whiteSpace: "pre-wrap" }, root);
    this.out = this.el("pre", { margin: 0, whiteSpace: "pre-wrap", color: "#9a9ba0", fontSize: "11px", display: "none",
      borderTop: "1px solid #2a2c33", paddingTop: "4px" }, root);
    this.widget = this.node.addDOMWidget("dial_rack_ui", "div", root, { serialize: false });
    this.widget.computeSize = (w) => [w, 64 + 34 * Math.max(this.rows.length, 1) + (this.pad.open ? PAD_PX + 96 : 0) + 28 * this.rows.filter((r) => r.envelope?.type === "manual").length +
      (this.presetBar.style.display !== "none" ? 32 : 0) + (this.presetMessage ? 18 * this.presetMessage.split("\n").length + 8 : 0) +
      (this.report ? 18 * this.report.split("\n").length + 8 : 0)];
    this.root = root;
  }

  // ---------- pad: two rows as X/Y axes; the dot is the prompt, dragging it sets both strengths ----------
  get pad() {
    const p = (this.node.properties ||= {}).dialPad ||= {};
    p.range ??= 3; p.step ??= 0.5;
    return p;
  }

  padAxes() {  // rows that can be an axis: everything but hold rows
    return this.rows.map((r, i) => i).filter((i) => !this.rows[i].hold);
  }

  rowName(i) {
    const r = this.rows[i];
    return `${i + 1}. ` + ("input" in r ? r.input : shortName(r.dial || "?"));
  }

  buildPad(root) {
    const box = this.el("div", { display: "none", flexDirection: "column", gap: "4px", borderTop: "1px solid #2a2c33", paddingTop: "6px" }, root);
    const controls = this.el("div", { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }, box);
    const pick = (label, title) => {
      this.el("span", { color: "#888" }, controls, label);
      const sel = this.el("select", { background: "#111", color: "#eee", border: "1px solid #333", maxWidth: "150px" }, controls);
      sel.title = title;
      return sel;
    };
    this.padX = pick("X", "row moved by left/right");
    this.padY = pick("Y", "row moved by up/down");
    this.padRange = pick("range ±", "how far the pad edges reach");
    for (const v of PAD_RANGES) this.el("option", {}, this.padRange, String(v)).value = v;
    this.padStep = pick("sweep step", "spacing of the 3×3 sweep around the dot");
    for (const v of SWEEP_STEPS) this.el("option", {}, this.padStep, String(v)).value = v;
    this.padX.onchange = () => { this.pad.x = Number(this.padX.value); this.render(); };
    this.padY.onchange = () => { this.pad.y = Number(this.padY.value); this.render(); };
    this.padRange.onchange = () => { this.pad.range = Number(this.padRange.value); this.render(); };
    this.padStep.onchange = () => { this.pad.step = Number(this.padStep.value); this.drawPad(); };
    this.sweepButton = this.button(controls, "Sweep 3×3", "queue 9 renders on a grid around the dot, then put the dot back", () => this.sweep());
    const canvas = this.el("canvas", { width: PAD_PX + "px", height: PAD_PX + "px", cursor: "crosshair", alignSelf: "flex-start",
      borderRadius: "4px", outline: "none" }, box);
    canvas.width = canvas.height = PAD_PX * (window.devicePixelRatio || 1);
    canvas.tabIndex = 0;
    canvas.title = "drag: move both dials · Shift+drag: fine · arrows: ±0.05 (Shift ±0.25) · double-click: back to 0";
    this.padReadout = this.el("div", { color: "#9a9ba0", fontSize: "11px", whiteSpace: "pre-wrap" }, box);
    this.padCanvas = canvas;
    this.padBox = box;
    this.padGeometry = {};

    const axes = () => [this.rows[this.pad.x], this.rows[this.pad.y]];
    const toStrength = (px) => (px / PAD_PX * 2 - 1) * this.pad.range;
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      const [rx, ry] = axes();
      if (!rx || !ry) return;
      canvas.setPointerCapture(e.pointerId);
      drag = { x0: e.offsetX, y0: e.offsetY, sx: Number(rx.strength), sy: Number(ry.strength) };
      if (!e.shiftKey) this.setPad(toStrength(e.offsetX), -toStrength(e.offsetY));
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag) return;
      if (e.shiftKey) {  // fine: relative motion at a fifth of the speed
        const k = 0.2 * 2 * this.pad.range / PAD_PX;
        this.setPad(drag.sx + (e.offsetX - drag.x0) * k, drag.sy - (e.offsetY - drag.y0) * k);
      } else {
        this.setPad(toStrength(e.offsetX), -toStrength(e.offsetY));
        drag = { x0: e.offsetX, y0: e.offsetY, sx: Number(axes()[0].strength), sy: Number(axes()[1].strength) };
      }
    });
    canvas.addEventListener("pointerup", () => { drag = null; });
    canvas.addEventListener("dblclick", () => this.setPad(0, 0));
    canvas.addEventListener("keydown", (e) => {
      const d = e.shiftKey ? 0.25 : 0.05;
      const move = { ArrowLeft: [-d, 0], ArrowRight: [d, 0], ArrowUp: [0, d], ArrowDown: [0, -d] }[e.key];
      const [rx, ry] = axes();
      if (!move || !rx || !ry) return;
      e.preventDefault();
      this.setPad(Number(rx.strength) + move[0], Number(ry.strength) + move[1]);
    });
  }

  setPad(sx, sy) {
    const rx = this.rows[this.pad.x], ry = this.rows[this.pad.y];
    rx.strength = snap(clampStrength(sx));
    ry.strength = snap(clampStrength(sy));
    this.commit();
    this.render();
  }

  async padNorms(rx, ry) {
    if ("input" in rx || "input" in ry) return null;
    const key = rx.dial + "|" + ry.dial;
    if (!(key in this.padGeometry)) {
      this.padGeometry[key] = null;
      try {
        const r = await api.fetchApi("/mainodes/dials/geometry", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dials: [rx.dial, ry.dial] }) });
        this.padGeometry[key] = r.ok ? await r.json() : { error: (await r.json()).error };
      } catch (e) { this.padGeometry[key] = { error: e.message }; }
      this.drawPad();
    }
    return this.padGeometry[key];
  }

  renderPad() {
    this.padBox.style.display = this.pad.open ? "flex" : "none";
    this.padButton.style.borderColor = this.pad.open ? "#ffc145" : "#444";
    if (!this.pad.open) return;
    const axes = this.padAxes();
    if (!axes.includes(this.pad.x)) this.pad.x = axes[0];
    if (!axes.includes(this.pad.y) || (this.pad.y === this.pad.x && axes.length > 1)) this.pad.y = axes.find((i) => i !== this.pad.x) ?? axes[0];
    for (const [sel, v] of [[this.padX, this.pad.x], [this.padY, this.pad.y]]) {
      sel.replaceChildren();
      for (const i of axes) this.el("option", {}, sel, this.rowName(i)).value = i;
      if (v !== undefined) sel.value = v;
    }
    this.padRange.value = this.pad.range;
    this.padStep.value = this.pad.step;
    this.drawPad();
  }

  drawPad() {
    const c = this.padCanvas, g = c.getContext("2d"), dpr = c.width / PAD_PX, R = this.pad.range;
    const rx = this.rows[this.pad.x], ry = this.rows[this.pad.y];
    const px = (v) => (v / R + 1) / 2 * PAD_PX;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#101114"; g.fillRect(0, 0, PAD_PX, PAD_PX);
    g.strokeStyle = "#1e2026"; g.lineWidth = 1;
    for (let v = -R; v <= R + 1e-9; v += 0.5) {
      g.beginPath(); g.moveTo(px(v), 0); g.lineTo(px(v), PAD_PX); g.moveTo(0, px(v)); g.lineTo(PAD_PX, px(v)); g.stroke();
    }
    g.strokeStyle = "#3a3d46"; g.beginPath(); g.moveTo(px(0), 0); g.lineTo(px(0), PAD_PX); g.moveTo(0, px(0)); g.lineTo(PAD_PX, px(0)); g.stroke();
    const ring = (r, color, dash) => {
      g.setLineDash(dash); g.strokeStyle = color; g.beginPath();
      g.ellipse(px(0), px(0), r / R * PAD_PX / 2, r / R * PAD_PX / 2, 0, 0, 2 * Math.PI); g.stroke(); g.setLineDash([]);
    };
    ring(1, "#3f6b4a", []);      // everyday range
    ring(1.5, "#7a5a22", [4, 4]);  // side effects start
    g.fillStyle = "#666"; g.font = "10px sans-serif";
    g.fillText("±1 everyday", px(0) + 3, px(1) + 11);
    g.fillText("±1.5 side effects", px(0) + 3, px(1.5) + 11);
    if (!rx || !ry || rx === ry) {
      g.fillStyle = "#888"; g.fillText(this.rows.length < 2 ? "add two dial rows to use the pad" : "pick two different rows", 8, 16);
      this.padReadout.textContent = "";
      this.sweepButton.disabled = true;
      return;
    }
    this.sweepButton.disabled = !!this.sweeping;
    const sx = Number(rx.strength), sy = Number(ry.strength), step = this.pad.step;
    g.fillStyle = "#4a4d57";
    for (const dy of [-step, 0, step]) for (const dx of [-step, 0, step]) {
      if (dx || dy) { g.beginPath(); g.arc(px(sx + dx), px(-(sy + dy)), 2, 0, 2 * Math.PI); g.fill(); }
    }
    const dotX = px(Math.max(-R, Math.min(R, sx))), dotY = px(-Math.max(-R, Math.min(R, sy)));
    g.fillStyle = Math.hypot(sx, sy) > 1.5 ? "#ff8a5c" : "#ffc145";
    g.beginPath(); g.arc(dotX, dotY, 6, 0, 2 * Math.PI); g.fill();
    g.fillStyle = "#ddd"; g.fillText(`${this.rowName(this.pad.x)} →`, PAD_PX - 4 - g.measureText(`${this.rowName(this.pad.x)} →`).width, px(0) - 4);
    g.fillText(`↑ ${this.rowName(this.pad.y)}`, px(0) + 4, 12);
    let text = `X ${this.rowName(this.pad.x)} ${fmt(sx)}   ·   Y ${this.rowName(this.pad.y)} ${fmt(sy)}`;
    const geo = this.padGeometry[rx.dial + "|" + ry.dial];
    if (geo === undefined) this.padNorms(rx, ry);
    if (geo?.error) text += `\n${geo.error}`;
    else if (geo && geo.mode[0] !== geo.mode[1]) text += "\ndifferent injection points (pre/post): no combined readout";
    else if (geo && geo.cos[0][1] !== null) {
      const [nx, ny] = geo.norm, cos = geo.cos[0][1];
      const push = Math.sqrt(Math.max(0, (sx * nx) ** 2 + (sy * ny) ** 2 + 2 * sx * sy * nx * ny * cos)) / ((nx + ny) / 2);
      text += `\noverlap cos ${fmt(cos)}${Math.abs(cos) >= 0.5 ? (cos > 0 ? " (they reinforce)" : " (they cancel)") : ""}` +
        `   ·   combined push ≈ ${push.toFixed(2)}× one dial at +1${push > 1.5 ? "  — past the tested range" : ""}`;
    } else if ("input" in rx || "input" in ry) text += "\nwired dial: strengths only (no file to measure)";
    this.padReadout.textContent = text;
  }

  async sweep() {
    const rx = this.rows[this.pad.x], ry = this.rows[this.pad.y], step = this.pad.step;
    const sx = Number(rx.strength), sy = Number(ry.strength);
    this.sweeping = true;
    this.drawPad();
    let queued = 0;
    try {
      for (const dy of [step, 0, -step]) for (const dx of [-step, 0, step]) {
        rx.strength = snap(clampStrength(sx + dx));
        ry.strength = snap(clampStrength(sy + dy));
        this.commit();
        await app.queuePrompt(0, 1);
        queued++;
      }
      this.presetMessage = `Queued ${queued} renders: ${this.rowName(this.pad.x)} ${fmt(sx - step)}…${fmt(sx + step)}, ` +
        `${this.rowName(this.pad.y)} ${fmt(sy - step)}…${fmt(sy + step)} (rows top to bottom = Y high to low).`;
    } catch (e) {
      this.presetMessage = `Sweep stopped after ${queued} of 9: ${e.message}`;
    } finally {
      rx.strength = sx; ry.strength = sy;
      this.sweeping = false;
      this.commit();
      this.render();
    }
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
        sel.value = r.dial; sel.title = r.dial;
        sel.onchange = () => { r.dial = sel.value; sel.title = sel.value; this.commit(); };
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
      envelope.onchange = () => {
        if (envelope.value === "constant") delete r.envelope;
        else r.envelope = envelope.value === "manual" ? { type: "manual", points: [[0, 0], [0.5, 1], [1, 0]] } : envelope.value;
        this.commit(); this.render();
      };
      this.button(row, "S", "solo: hear only the soloed rows", () => { r.solo = !r.solo; this.commit(); this.render(); },
        r.solo ? { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145", padding: "2px 6px" } : { padding: "2px 6px" });
      const hold = this.button(row, "H", "hold: remove this direction from the summed shift (post-refiner dials only)",
        () => { r.hold = !r.hold; this.commit(); this.render(); },
        r.hold ? { background: "#20323b", borderColor: "#8fb4ff", color: "#8fb4ff", padding: "2px 6px" } : { padding: "2px 6px" });
      hold.setAttribute("aria-pressed", String(!!r.hold));
      if (!("input" in r)) this.button(row, "✕", "remove row", () => { this.rows.splice(i, 1); this.commit(); this.render(); }, { padding: "2px 6px" });
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
    this.renderPad();
    this.node.setSize([Math.max(this.node.size[0], 600), this.node.computeSize()[1]]);
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
