// Dial Rack — one row per dial (on/off, dial, strength, solo) over the MAIDialRack node's hidden `rack` JSON widget.
// The widget IS the state (saved with the workflow, read by the backend); this UI only edits it.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const DEFAULT_STRENGTH = 0.5;   // the sane everyday range is +0.5 .. +1
const SLIDER = [-3, 3];
const NUMBER = [-20, 20];

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

class DialRackUI {
  constructor(node) {
    this.node = node;
    this.rows = [];
    this.report = "";
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
    const bar = this.el("div", { display: "flex", gap: "6px", alignItems: "center" }, root);
    this.button(bar, "+ Add dial", "add a dial row", () => this.addRow(), { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145" });
    this.button(bar, "↻", "refresh the list of dial files", async () => { await listDials(true); this.render(); });
    this.hint = this.el("span", { color: "#888", marginLeft: "auto" }, bar);
    this.out = this.el("pre", { margin: 0, whiteSpace: "pre-wrap", color: "#9a9ba0", fontSize: "11px", display: "none",
      borderTop: "1px solid #2a2c33", paddingTop: "4px" }, root);
    this.widget = this.node.addDOMWidget("dial_rack_ui", "div", root, { serialize: false });
    this.widget.computeSize = (w) => [w, 64 + 34 * Math.max(this.rows.length, 1) + (this.report ? 18 * this.report.split("\n").length + 8 : 0)];
    this.root = root;
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
    const anySolo = this.rows.some((r) => r.on && r.solo);
    if (!this.rows.length) this.el("div", { color: "#777", padding: "4px 2px" }, this.list, "No dials yet: add one, or wire a dial into a dial_ input.");
    this.rows.forEach((r, i) => {
      const live = r.on && (!anySolo || r.solo);
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
      slider.oninput = () => { r.strength = parseFloat(slider.value); num.value = r.strength.toFixed(2); this.commit(); };
      num.onchange = () => { const v = Math.min(NUMBER[1], Math.max(NUMBER[0], parseFloat(num.value) || 0)); r.strength = v; slider.value = v; num.value = v.toFixed(2); this.commit(); };
      slider.ondblclick = () => { r.strength = 0; slider.value = 0; num.value = "0.00"; this.commit(); };
      this.button(row, "S", "solo: hear only the soloed rows", () => { r.solo = !r.solo; this.commit(); this.render(); },
        r.solo ? { background: "#3b3220", borderColor: "#ffc145", color: "#ffc145", padding: "2px 6px" } : { padding: "2px 6px" });
      if (!("input" in r)) this.button(row, "✕", "remove row", () => { this.rows.splice(i, 1); this.commit(); this.render(); }, { padding: "2px 6px" });
    });
    const n = this.rows.filter((r) => r.on && (!anySolo || r.solo) && Number(r.strength) !== 0).length;
    this.hint.textContent = anySolo ? `solo · ${n} active` : `${n} active`;
    this.out.style.display = this.report ? "block" : "none";
    this.out.textContent = this.report;
    this.node.setSize([Math.max(this.node.size[0], 470), this.node.computeSize()[1]]);
    this.node.setDirtyCanvas(true, true);
  }
}

app.registerExtension({
  name: "MAINodes.DialRack",
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
