// Render Preset: a preset bar on the node. Picking a preset fills the node's widgets (the backend only ever reads the widgets,
// so a queued graph does not depend on preset files); "Save as" stores the current widgets as a new named preset. A new
// node starts filled from its named preset, and the bar says when the widgets no longer match it ("edited").
// Other UIs (Snap, agents) use the same presets through `node.presets`: { names(), values(name), current(), apply(name) }.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const URL = "/mainodes/render/presets";
const DEFAULT = "Pika H3 Flex";
const FIELDS = ["model", "lora", "lora_strength", "conditioning", "sampler", "schedule", "sigmas", "steps", "derope_steps", "shift_video", "shift_audio", "cfg"];

async function request(path = "", options) {
  const r = await api.fetchApi(URL + path, options);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Render preset request failed (${r.status})`);
  return data;
}

// every preset's fields, read when the node type registers (a few small files), so a new node fills itself at once;
// a saved preset that no longer loads is left out
const presets = new Map();
async function loadPresets() {
  const names = await request();
  const read = await Promise.allSettled(names.map((n) => request(`/${encodeURIComponent(n)}`)));
  presets.clear();
  names.forEach((n, i) => { if (read[i].status === "fulfilled") presets.set(n, read[i].value); });
}

// shipped presets name plain files (e.g. pika_h3_flex_fl2va_v1_bf16.safetensors); use this machine's copy in any sub-folder
function pick(widget, value) {
  const options = widget.options?.values || [];
  if (!Array.isArray(options) || options.includes(value)) return value;
  const base = (f) => String(f).replace(/\\/g, "/").split("/").pop();
  return options.find((o) => base(o) === base(value)) ?? value;
}

function setup(node) {
  const widget = (name) => node.widgets.find((w) => w.name === name);
  const bar = document.createElement("div");
  Object.assign(bar.style, { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", fontSize: "12px", color: "#ddd", padding: "2px 0" });
  for (const ev of ["pointerdown", "keydown", "wheel"]) bar.addEventListener(ev, (e) => e.stopPropagation());
  const style = { background: "#2a2c33", color: "#ddd", border: "1px solid #444", borderRadius: "4px", padding: "2px 6px", fontSize: "12px" };
  const select = Object.assign(document.createElement("select"), { title: "render preset: fills the fields below" });
  Object.assign(select.style, style, { flex: "1 1 120px", background: "#111" });
  const edited = Object.assign(document.createElement("span"), { textContent: "edited", title: "the fields below differ from this preset; pick it again to restore it" });
  Object.assign(edited.style, { color: "#ffc145", display: "none" });
  const name = Object.assign(document.createElement("input"), { placeholder: "new preset name", title: "letters, digits, '_' and '-'" });
  Object.assign(name.style, style, { flex: "1 1 90px", background: "#111" });
  const save = Object.assign(document.createElement("button"), { textContent: "Save as", title: "save the fields below as a new preset (models/loras/dials/presets/render/)" });
  const refresh = Object.assign(document.createElement("button"), { textContent: "↻", title: "reload the preset list" });
  for (const b of [save, refresh]) Object.assign(b.style, style, { cursor: "pointer" });
  const message = document.createElement("div");
  Object.assign(message.style, { color: "#ffc145", width: "100%", display: "none" });
  bar.append(select, edited, name, save, refresh, message);
  const say = (text) => { message.textContent = text; message.style.display = text ? "block" : "none"; };

  // a preset's fields as this machine has them (model and LoRA resolved into their sub-folders)
  const values = (preset) => Object.fromEntries(Object.entries(presets.get(preset) ?? {}).filter(([f]) => FIELDS.includes(f) && widget(f))
    .map(([f, v]) => [f, typeof v === "string" ? pick(widget(f), v) : v]));
  const same = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-6 : a === b);
  function current() {
    const preset = presets.has(node.properties.renderPreset) ? node.properties.renderPreset : null;
    return { name: preset, edited: !!preset && Object.entries(values(preset)).some(([f, v]) => !same(widget(f).value, v)) };
  }
  function show() {
    const { name: preset, edited: changed } = current();
    select.replaceChildren(...["(custom)", ...presets.keys()].map((n) => Object.assign(document.createElement("option"), { value: n, textContent: n })));
    select.value = preset ?? "(custom)";
    edited.style.display = changed ? "inline" : "none";
  }
  function apply(preset) {
    if (!presets.has(preset)) throw new Error(`No render preset "${preset}"`);
    for (const [f, v] of Object.entries(values(preset))) { const w = widget(f); w.value = v; w.callback?.(v); }
    node.properties.renderPreset = preset;
    show();
    node.setDirtyCanvas(true, true);
  }
  // a field edited anywhere (on the node, in Snap, by an agent) updates the "edited" mark
  for (const f of FIELDS) {
    const w = widget(f), callback = w?.callback;
    if (w) w.callback = function () { const r = callback?.apply(this, arguments); show(); return r; };
  }
  select.onchange = () => {
    if (select.value === "(custom)") return;
    app.canvas.emitBeforeChange();
    try { apply(select.value); say(""); } catch (e) { say(e.message); } finally { app.canvas.emitAfterChange(); }
  };
  save.onclick = async () => {
    try {
      const preset = Object.fromEntries(FIELDS.map((f) => [f, widget(f).value]));
      await request(`/${encodeURIComponent(name.value.trim())}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preset) });
      node.properties.renderPreset = name.value.trim();
      await loadPresets();
      show();
      say(`Saved preset ${name.value.trim()}.`);
      name.value = "";
    } catch (e) { say(e.message); }
  };
  refresh.onclick = () => loadPresets().then(show, (e) => say(e.message));
  node.addDOMWidget("render_preset", "div", bar, { serialize: false, getMinHeight: () => 30 });
  return { names: () => [...presets.keys()], values, current, apply, show };
}

app.registerExtension({
  name: "MAINodes.RenderPreset",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "MAIRenderPreset") return;
    await loadPresets();
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = created?.apply(this, arguments);
      this.properties ||= {};
      this.properties.renderPreset ??= DEFAULT;
      this.presets = setup(this);
      // a loaded workflow's own values replace these right after, in configure
      if (presets.has(this.properties.renderPreset)) this.presets.apply(this.properties.renderPreset);
      else this.presets.show();
      return r;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = configure?.apply(this, arguments);
      // shipped workflows name plain files; use this machine's copy when it sits in a sub-folder (e.g. h3/)
      for (const name of ["model", "lora"]) { const w = this.widgets.find((x) => x.name === name); if (w) w.value = pick(w, w.value); }
      this.presets?.show();
      return r;
    };
  },
});
