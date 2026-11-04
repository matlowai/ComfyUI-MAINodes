// Dials in Snap: the Dial Rack brick shows each dial as a two-sided slider labelled with what each side gives ("frozen ◀ ● ▶
// zoomies"), its useful range shaded and its overcook zone marked, all read from the dial file's own info. A picker lists
// every installed dial (/mainodes/dials/catalog); "Make a dial" fills the pack's own Make Dial node and runs only that
// node, then puts the new dial on the rack. Rows live in the rack's `rack` widget (the backend's source of truth).
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const H3 = "MiniMax H3";

let catalog = null, loading = null;
export function load(force) {
  if (force) { catalog = null; loading = null; }
  loading ??= api.fetchApi("/mainodes/dials/catalog").then((r) => (r.ok ? r.json() : [])).then((list) => (catalog = list), () => (catalog = []));
  return loading;
}
export const all = () => catalog ?? [];
export const find = (dial) => all().find((d) => d.dial === dial);
const short = (f) => f.replace(/^dials\//, "").replace(/\.safetensors$/, "").replace(/^h3_/, "").replace(/_hook$/, "").replace(/_/g, " ");
// "frozen ↔ zoomies" when the dial says what its sides give, else its file name
const side = (t) => (t && !/^\?+$/.test(t.trim()) ? t : ""); // "???" means the side was never named
export const label = (d) => (side(d?.info?.negative) || side(d?.info?.positive) ? `${side(d.info.negative) || "−"} ↔ ${side(d.info.positive) || "+"}` : short(d?.dial ?? ""));
export const calibrated = (d) => !!(d?.info?.pos?.useful || d?.info?.neg?.useful);

// rack rows: [{on, dial, strength, solo, hold?, ...}]; rows wired from Make Dial inputs have `input` instead of a file
export const rows = () => { try { const v = JSON.parse(E.getValue("rack", "rack", "rack") || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (next) => E.setValue("rack", "rack", "rack", JSON.stringify(next)); // the rack UI follows its widget's callback

export function add(dial, strength) {
  if (!E.state().bricks.some((b) => b.key === "rack")) throw new Error("Add the Dial Rack brick first");
  const r = rows();
  if (r.some((x) => x.dial === dial)) return `${label(find(dial) ?? { dial })} is already on the rack`;
  const d = find(dial), s = strength ?? d?.info?.pos?.useful ?? 0.5;
  write([...r, { on: true, dial, strength: s, solo: false }]);
  return `${label(d ?? { dial })} on the rack at ${s >= 0 ? "+" : ""}${s}`;
}
export function set(dial, patch) {
  const r = rows();
  if (!r.some((x) => x.dial === dial)) throw new Error(`${dial} isn't on the rack`);
  write(r.map((x) => (x.dial === dial ? { ...x, ...patch } : x)));
}
export const remove = (dial) => write(rows().filter((x) => x.dial !== dial));

// ---- the rack brick's face ---------------------------------------------------------------------------------------
// the slider's reach: everyday ±2, wider when a dial's own overcook says so
const reach = (d) => Math.max(2, Math.ceil(Math.max(d?.info?.pos?.overcook ?? 0, d?.info?.neg?.overcook ?? 0) + 0.5));
function bands(d, max) { // shaded useful range and amber overcook beyond it, per side, as a gradient on the track
  const at = (v) => `${(50 + (50 * v) / max).toFixed(1)}%`;
  const nu = d?.info?.neg?.useful, pu = d?.info?.pos?.useful, no = d?.info?.neg?.overcook, po = d?.info?.pos?.overcook;
  if (!nu && !pu) return "linear-gradient(90deg, #ffffff14, #ffffff14)";
  const ok = "hsl(150 55% 50% / .38)", hot = "hsl(35 90% 55% / .45)", none = "#ffffff12";
  return `linear-gradient(90deg, ${no ? `${hot} 0 ${at(-no)},` : ""} ${none} ${no ? at(-no) : "0"} ${nu ? at(-nu) : "50%"}, ${ok} ${nu ? at(-nu) : "50%"} ${pu ? at(pu) : "50%"}, ${none} ${pu ? at(pu) : "50%"} ${po ? at(po) : "100%"}${po ? `, ${hot} ${at(po)} 100%` : ""})`;
}

export function face({ onChange, onPick, onMake }) {
  const list = rows().filter((r) => r.dial);
  const body = list.map((r) => {
    const d = find(r.dial), max = reach(d);
    const value = h("b", { className: "snap-dial-v", textContent: `${r.strength >= 0 ? "+" : ""}${Number(r.strength).toFixed(2)}` });
    const range = h("input", { type: "range", min: -max, max, step: 0.05, value: r.strength, className: "snap-dial-range", title: `${d?.info?.description || r.dial}\nuseful ${d?.info?.pos?.useful ?? "?"} · overcooks ${d?.info?.pos?.overcook ?? "?"}` });
    range.style.setProperty("--bands", bands(d, max));
    range.addEventListener("input", () => { value.textContent = `${range.value >= 0 ? "+" : ""}${Number(range.value).toFixed(2)}`; });
    range.addEventListener("change", () => { set(r.dial, { strength: Number(range.value) }); onChange(); });
    range.addEventListener("dblclick", () => { set(r.dial, { strength: 0 }); onChange(); });
    return h("div", { className: `snap-dial${r.on === false ? " off" : ""}` },
      h("div", { className: "snap-dial-top" },
        h("input", { type: "checkbox", checked: r.on !== false, title: "on / off", onchange: (e) => { set(r.dial, { on: e.target.checked }); onChange(); } }),
        h("span", { className: "snap-dial-name", textContent: label(d ?? r), title: r.dial }),
        value,
        h("button", { className: "snap-x", textContent: "×", title: "take it off the rack", onclick: (e) => { e.stopPropagation(); remove(r.dial); onChange(); } })),
      range,
      h("div", { className: "snap-dial-ends" }, h("span", { textContent: side(d?.info?.negative) || "−" }), calibrated(d) ? null : h("em", { textContent: "uncalibrated" }), h("span", { textContent: side(d?.info?.positive) || "+" })));
  });
  return h("div", { className: "snap-dials" }, ...(body.length ? body : [h("div", { className: "snap-quiet", textContent: "No dials yet" })]),
    h("div", { className: "snap-dial-actions" },
      h("button", { className: "snap-link snap-quiet-btn", textContent: "+ Dial", title: "pick one of the installed dials", onclick: (e) => { e.stopPropagation(); onPick(); } }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "✦ Make a dial", title: "make a new dial from prompt pairs", onclick: (e) => { e.stopPropagation(); onMake(); } })));
}

// ---- the picker --------------------------------------------------------------------------------------------------
export async function openPicker(host, { say, onChange, onMake }) {
  await load();
  let family = H3;
  const q = h("input", { className: "snap-lib-q", placeholder: "Search dials (what it does, either side, the file)…" });
  const grid = h("div", { className: "snap-dial-grid" });
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const fam = h("div", { className: "snap-seg" });
  function draw() {
    const on = new Set(rows().map((r) => r.dial));
    fam.replaceChildren(...[H3, "all"].map((f) => h("button", { className: f === family ? "on" : "", textContent: f === H3 ? "H3 dials" : "All models", onclick: () => { family = f; draw(); } })));
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const found = all().filter((d) => (family === "all" || d.family === family) && words.every((w) => `${label(d)} ${d.info.description} ${d.dial}`.toLowerCase().includes(w)))
      .sort((a, b) => (a.mode === "pre") - (b.mode === "pre") || calibrated(b) - calibrated(a) || label(a).localeCompare(label(b)));
    grid.replaceChildren(...(found.length ? found.map((d) => h("button", { className: `snap-dial-tile${on.has(d.dial) ? " on" : ""}`, title: d.dial,
      onclick: () => { try { say(add(d.dial)); onChange(); close(); } catch (err) { say(err.message, true); } } },
      h("strong", { textContent: label(d) }),
      h("span", { className: "snap-quiet", textContent: d.info.description || "No description yet" }),
      h("span", { className: "snap-dial-meta" },
        calibrated(d) ? h("i", { textContent: `useful ±${d.info.pos.useful ?? d.info.neg.useful}` }) : h("i", { className: "warn", textContent: "uncalibrated" }),
        h("i", { className: "file", textContent: d.dial.replace(/^dials\//, "").replace(/\.safetensors$/, "") }),
        d.mode === "pre" ? h("i", { title: "pre-refiner LoRA file: an approximation of the hook, keep it at strength 1 or below", textContent: "LoRA file" }) : null,
        d.family !== H3 ? h("i", { textContent: d.family }) : null, on.has(d.dial) ? h("i", { className: "ok", textContent: "on the rack" }) : null))) : [h("div", { className: "snap-quiet", textContent: "No dial matches. Make one?" })]));
  }
  q.addEventListener("input", draw);
  const sheet = h("div", { className: "snap-sheet snap-dial-sheet", role: "dialog", ariaLabel: "Dials" },
    h("header", {}, h("strong", { textContent: "Dials" }), h("span", { className: "snap-quiet", textContent: `${all().length} installed` }), fam, h("span", { className: "snap-spacer" }),
      h("button", { className: "snap-primary", textContent: "✦ Make a dial", onclick: () => { close(); onMake(); } }), h("button", { className: "snap-x", textContent: "×", onclick: close })),
    h("div", { className: "snap-dial-pick" }, q, grid));
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  draw();
  host.append(sheet);
  q.focus();
}

// ---- making a dial -----------------------------------------------------------------------------------------------
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 60);

// fill the pack's Make Dial node from the spec, wire it to the recipe's text encoder and H3 model, run only that node,
// put the new dial on the rack, and take the node away again. Resolves with { dial, report }.
export async function make({ name, negative, positive, pairs, subjects, description }, onStatus = () => {}) {
  const clip = E.nodeFor("models", "clip"), model = E.nodeFor("preset", "preset");
  if (!clip || !model) throw new Error("Making a dial needs the Models and Render Preset bricks (its text encoder and H3 model)");
  const lines = pairs.filter(([a, b]) => a.trim() && b.trim()).map(([a, b]) => `${a.trim()} ||| ${b.trim()}`);
  if (!lines.length) throw new Error("Write at least one pair: the same sentence twice, changed only in the quality to steer");
  const file = slug(name || `${negative}_${positive}`) || "my_dial";
  const n = LiteGraph.createNode("MAIDialMake");
  n.pos = [model.pos[0], model.pos[1] + model.size[1] + 120];
  app.graph.add(n);
  try {
    clip.connect(clip.outputs.findIndex((o) => o.type === "CLIP"), n, n.findInputSlot("clip"));
    model.connect(model.outputs.findIndex((o) => o.type === "MODEL"), n, n.findInputSlot("model"));
    const values = { pairs: lines.join("\n"), subjects: subjects ?? "", name: file, description: description ?? "", negative_label: negative ?? "", positive_label: positive ?? "",
      useful: 0, overcook: 0, evidence: "unknown" }; // a new dial's strengths are unknown until someone tries it
    for (const [k, v] of Object.entries(values)) { const w = n.widgets.find((x) => x.name === k); if (w) w.value = v; }
    onStatus("Making the dial (only the Make Dial node runs)…");
    const done = new Promise((resolve, reject) => {
      const executed = ({ detail }) => { if (String(detail.node) === String(n.id)) { off(); resolve((detail.output?.text ?? []).join("\n")); } };
      const failed = ({ detail }) => { off(); reject(new Error(`${detail.node_type ?? "Make Dial"}: ${detail.exception_message ?? "failed"}`)); };
      const off = () => { api.removeEventListener("executed", executed); api.removeEventListener("execution_error", failed); };
      api.addEventListener("executed", executed);
      api.addEventListener("execution_error", failed);
    });
    let queued = false;
    const mark = () => { queued = true; };
    api.addEventListener("promptQueued", mark, { once: true });
    await app.queuePrompt(0, 1, { queueNodeIds: [n.id] });
    api.removeEventListener("promptQueued", mark);
    const errors = Object.values(app.lastNodeErrors ?? {}).map((e) => `${e.class_type}: ${e.errors?.[0]?.message ?? "error"}${e.errors?.[0]?.details ? ` (${e.errors[0].details})` : ""}`);
    if (errors.length) throw new Error(`Can't make it yet · ${errors[0]}`);
    if (!queued) throw new Error("ComfyUI didn't take the job (see its message)");
    const report = await done;
    await load(true);
    const dial = `dials/${file}.safetensors`;
    add(dial, 0.5);
    return { dial, report };
  } finally {
    app.graph.remove(n);
    app.canvas.setDirty(true, true);
  }
}

export function openMaker(host, { say, onChange }) {
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const field = (label, input, hint) => h("label", { className: "snap-field" }, h("span", { textContent: label }), input, hint ? h("em", { className: "snap-quiet", textContent: hint }) : null);
  const neg = h("input", { placeholder: "e.g. stands still" }), pos = h("input", { placeholder: "e.g. runs" });
  const name = h("input", { placeholder: "file name (from the two sides if empty)" });
  const desc = h("input", { placeholder: "what it does, for whoever loads it" });
  const subjects = h("textarea", { rows: 4, value: "A young woman\nAn old man\nA golden dog\nA horse" });
  const pairsBox = h("div", { className: "snap-pairs" });
  const status = h("div", { className: "snap-quiet snap-dial-status" });
  const pair = (a = "", b = "") => {
    const row = h("div", { className: "snap-pair" },
      h("textarea", { rows: 2, value: a, placeholder: "A: {subject} stands perfectly still, posing for a photograph." }),
      h("textarea", { rows: 2, value: b, placeholder: "B: {subject} runs quickly across the scene, moving energetically." }),
      h("button", { className: "snap-x", textContent: "×", title: "remove this pair", onclick: () => row.remove() }));
    pairsBox.append(row);
  };
  pair("{subject} stands perfectly still, posing for a photograph.", "{subject} runs quickly across the scene, moving energetically.");
  const makeBtn = h("button", { className: "snap-primary", textContent: "Make dial" });
  makeBtn.onclick = async () => {
    makeBtn.disabled = true;
    try {
      const pairs = [...pairsBox.querySelectorAll(".snap-pair")].map((r) => [...r.querySelectorAll("textarea")].map((t) => t.value));
      const { dial, report } = await make({ name: name.value, negative: neg.value, positive: pos.value, pairs, subjects: subjects.value, description: desc.value }, (t) => { status.textContent = t; });
      status.textContent = report;
      say(`Made ${dial}: it's on the rack at +0.5. Try a take at −1 and +1 to find its useful strength.`);
      onChange();
    } catch (err) { status.textContent = err.message; say(err.message, true); }
    makeBtn.disabled = false;
  };
  const sheet = h("div", { className: "snap-sheet snap-dial-sheet", role: "dialog", ariaLabel: "Make a dial" },
    h("header", {}, h("strong", { textContent: "Make a dial" }), h("span", { className: "snap-quiet", textContent: "negative strength moves toward A, positive toward B" }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", onclick: close })),
    h("div", { className: "snap-dial-make" },
      h("div", { className: "snap-dial-sides" }, field("A side (−) gives", neg), h("span", { className: "snap-dial-arrow", textContent: "↔" }), field("B side (+) gives", pos)),
      h("div", { className: "snap-rail-title", textContent: "Pairs" }),
      h("div", { className: "snap-quiet", textContent: "Write the same sentence twice, changing only the quality to steer. {subject} is replaced by each subject below, so the subjects cancel out and only the A → B difference is left. More pairs, cleaner dial." }),
      pairsBox,
      h("button", { className: "snap-link snap-quiet-btn", textContent: "+ pair", onclick: () => pair() }),
      h("div", { className: "snap-dial-two" }, field("Subjects", subjects, "one per line"), h("div", {}, field("Name", name), field("Description", desc))),
      h("div", { className: "snap-dial-go" }, status, makeBtn)));
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  host.append(sheet);
  neg.focus();
}
