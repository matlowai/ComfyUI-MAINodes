// Render Preset: a preset bar on the node. Picking a preset fills the node's widgets (the backend only ever reads the widgets,
// so a queued graph does not depend on preset files); "Save as" stores the current widgets as a new named preset.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const URL = "/mainodes/render/presets";

async function request(path = "", options) {
  const r = await api.fetchApi(URL + path, options);
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `Render preset request failed (${r.status})`);
  return data;
}

// shipped presets name plain files (e.g. pika_h3_flex_fl2va_v1_bf16.safetensors); use this machine's copy in any sub-folder
function pick(widget, value) {
  const options = widget.options?.values || [];
  if (!Array.isArray(options) || options.includes(value)) return value;
  const base = (f) => String(f).replace(/\\/g, "/").split("/").pop();
  return options.find((o) => base(o) === base(value)) ?? value;
}

function setup(node) {
  const fields = ["model", "lora", "lora_strength", "conditioning", "sampler", "schedule", "sigmas", "steps", "derope_steps", "audio_shift"];
  const widget = (name) => node.widgets.find((w) => w.name === name);
  const bar = document.createElement("div");
  Object.assign(bar.style, { display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap", fontSize: "12px", color: "#ddd", padding: "2px 0" });
  for (const ev of ["pointerdown", "keydown", "wheel"]) bar.addEventListener(ev, (e) => e.stopPropagation());
  const style = { background: "#2a2c33", color: "#ddd", border: "1px solid #444", borderRadius: "4px", padding: "2px 6px", fontSize: "12px" };
  const select = Object.assign(document.createElement("select"), { title: "render preset: fills the fields below" });
  Object.assign(select.style, style, { flex: "1 1 120px", background: "#111" });
  const name = Object.assign(document.createElement("input"), { placeholder: "new preset name", title: "letters, digits, '_' and '-'" });
  Object.assign(name.style, style, { flex: "1 1 90px", background: "#111" });
  const save = Object.assign(document.createElement("button"), { textContent: "Save as", title: "save the fields below as a new preset (models/loras/dials/presets/render/)" });
  const refresh = Object.assign(document.createElement("button"), { textContent: "↻", title: "reload the preset list" });
  for (const b of [save, refresh]) Object.assign(b.style, style, { cursor: "pointer" });
  const message = document.createElement("div");
  Object.assign(message.style, { color: "#ffc145", width: "100%", display: "none" });
  bar.append(select, name, save, refresh, message);
  const say = (text) => { message.textContent = text; message.style.display = text ? "block" : "none"; };

  async function fill(selected) {
    const names = await request();
    select.replaceChildren(...["(custom)", ...names].map((n) => Object.assign(document.createElement("option"), { value: n, textContent: n })));
    select.value = names.includes(selected) ? selected : "(custom)";
  }
  select.onchange = async () => {
    if (select.value === "(custom)") return;
    try {
      const preset = await request(`/${encodeURIComponent(select.value)}`);
      for (const f of fields) { const w = widget(f); if (w) { w.value = typeof preset[f] === "string" ? pick(w, preset[f]) : preset[f]; w.callback?.(w.value); } }
      node.properties.renderPreset = select.value;
      say("");
      node.setDirtyCanvas(true, true);
    } catch (e) { say(e.message); }
  };
  save.onclick = async () => {
    try {
      const preset = Object.fromEntries(fields.map((f) => [f, widget(f).value]));
      await request(`/${encodeURIComponent(name.value.trim())}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(preset) });
      node.properties.renderPreset = name.value.trim();
      await fill(node.properties.renderPreset);
      say(`Saved preset ${name.value.trim()}.`);
      name.value = "";
    } catch (e) { say(e.message); }
  };
  refresh.onclick = () => fill(node.properties.renderPreset).catch((e) => say(e.message));
  node.addDOMWidget("render_preset", "div", bar, { serialize: false, getMinHeight: () => 30 });
  fill(node.properties.renderPreset).catch((e) => say(e.message));
  return { fill, select };
}

app.registerExtension({
  name: "MAINodes.RenderPreset",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "MAIRenderPreset") return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const r = created?.apply(this, arguments);
      this.properties ||= {};
      this.properties.renderPreset ??= "Pika H3 Flex";
      this.renderPreset = setup(this);
      return r;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const r = configure?.apply(this, arguments);
      this.renderPreset?.fill(this.properties.renderPreset).catch(() => {});
      return r;
    };
  },
});
