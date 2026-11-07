// Dials in Snap: the Dial Rack brick shows each dial as a two-sided slider labelled with what each side gives ("frozen ◀ ● ▶
// zoomies"), its useful range shaded and its overcook zone marked, all read from the dial file's own info. A picker lists
// every installed dial (/mainodes/dials/catalog); "Make a dial" fills the pack's own Make Dial node and runs only that
// node (the sheet then puts the new dial on the rack; an agent's make_dial only when asked). Rows live in the rack's `rack` widget (the backend's source of truth).
// SNAP-R2 the rack follows its widget · SNAP-R13 family from the setup, strength scale from the dials' own data ·
// SNAP-R25 SFW only leaves out dials the model graph tags nsfw · SNAP-R230 rows with time curves, keys in clip seconds ·
// SNAP-R231 a time row's defaults (every step, protect), said · SNAP-R232 a dial's per-pipeline strengths ·
// SNAP-R239 make puts nothing on the rack unless asked and says where the file landed · see docs/snap/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import * as PF from "./profile.js";
import * as J from "./jobs.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };

let catalog = null, kinds = {}, loading = null;
export function load(force) {
  if (force) { catalog = null; loading = null; }
  loading ??= api.fetchApi("/mainodes/dials/catalog").then((r) => (r.ok ? r.json() : { dials: [] })).then((c) => { kinds = c.families ?? {}; return (catalog = c.dials); }, () => (catalog = []));
  return loading;
}
// SFW only: models.js says which dial files the person's model graph tags nsfw (set there, like the family)
let hidden = () => false;
export const useHidden = (fn) => { hidden = fn; };
export const all = () => (catalog ?? []).filter((d) => !hidden(d.dial));
export const types = () => kinds; // encoder type -> dial family (minimax -> MiniMax H3)
// the dial family a recipe is for: the recipe's own family (models.js says, from the applied setup card) and else what the
// graph declares, a `type` setting naming an encoder type the dials know (CLIPLoader type minimax -> MiniMax H3)
let declared = () => null;
export const useFamily = (fn) => { declared = fn; };
export const family = () => declared() ?? typeFamily();
export function typeFamily() {
  for (const b of E.state().bricks) for (const id of Object.values(b.nodes)) {
    const w = app.graph.getNodeById(id)?.widgets?.find((x) => x.name === "type" && Object.hasOwn(kinds, x.value));
    if (w) return kinds[w.value];
  }
  return null;
}
export const find = (dial) => all().find((d) => d.dial === dial);
const short = (f) => f.replace(/^dials\//, "").replace(/\.safetensors$/, "").replace(/^h3_/, "").replace(/_hook$/, "").replace(/_/g, " ");
// "frozen ↔ zoomies" when the dial says what its sides give, else its file name
const side = (t) => (t && !/^\?+$/.test(t.trim()) ? t : ""); // "???" means the side was never named
export const label = (d) => (side(d?.info?.negative) || side(d?.info?.positive) ? `${side(d.info.negative) || "−"} ↔ ${side(d.info.positive) || "+"}` : short(d?.dial ?? ""));
export const calibrated = (d) => !!(d?.info?.pos?.useful || d?.info?.neg?.useful);
// how strong a family's dials run, from their own calibrated useful strengths (median), next to MiniMax H3's: a family
// whose dials need far more strength says so where dials are picked and set (MOSS-Image ≈ ±4 vs H3 ≈ ±1); agents read
// the same numbers (list_dials)
export function typical(fam) {
  const u = all().filter((d) => d.family === fam).map((d) => d.info?.pos?.useful ?? d.info?.neg?.useful).filter(Boolean).sort((a, b) => a - b);
  return u.length ? u[Math.floor(u.length / 2)] : null;
}
export const scale = (fam) => (typical(fam) && typical("MiniMax H3") ? typical(fam) / typical("MiniMax H3") : null);
export function scaleNote(fam) {
  const own = typical(fam), h3 = typical("MiniMax H3");
  return fam && own && h3 && own >= 2 * h3 ? `${fam} dials work near ±${own} (about ${Math.round(own / h3)}× the H3 strength)` : null;
}

// rack rows: [{on, dial, strength, solo, hold?, ...}]; rows wired from Make Dial inputs have `input` instead of a file
export const rows = () => { try { const v = JSON.parse(E.getValue("rack", "rack", "rack") || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (next) => E.setValue("rack", "rack", "rack", JSON.stringify(next)); // the rack UI follows its widget's callback

// the strength a dial runs at on a pipeline: its info's measured useful strength there, else its own useful, else 0.5
export const useful = (d, pipeline) => d?.info?.pipelines?.[pipeline]?.useful ?? d?.info?.pos?.useful ?? 0.5;

// a row's time curve, checked with dials/timecurve.check_spec's rules and the rack's refusals (nodes.py timed), so an
// agent hears before the run what the rack would say during it. Keys are clip seconds unless unit says normalized
// (SNAP-R230: the clock of the take's words). Defaults (SNAP-R231): every step of the setup unless the dial's info
// measured fewer for this pipeline, and audio protect; each default comes back in words. -> { time, defaulted }
const UNITS = ["seconds", "normalized"], INTERPS = ["linear", "step"], AUDIO = ["follow", "protect"], FEATURES = ["rms", "onset", "low", "mid", "high"];
const SHAPING = ["gain", "offset", "threshold", "attack", "release", "invert"];
export function timeOf(dial, t, { steps: setup, pipeline } = {}) {
  if (t == null) return { time: null, defaulted: [] };
  if (typeof t !== "object" || Array.isArray(t)) throw new Error("time is {points: [[seconds, level], …], unit?: seconds | normalized, interp?: linear | step, smooth?: 0..1, steps?, audio?: protect | follow}");
  const d = find(dial), type = t.type ?? "keys", defaulted = [];
  if (d?.mode === "pre") throw new Error(`${dial} is a pre-refiner (LoRA file) dial: time curves need a post-refiner dial (the rack refuses a LoRA-file row with a curve)`);
  if (d && d.family !== "MiniMax H3") throw new Error(`${dial} is a ${d.family} dial: time curves support MiniMax H3 only (they blend video and audio latent frames)`);
  if (type !== "keys" && type !== "audio") throw new Error(`time type ${JSON.stringify(type)}: keys (points over clip time) or audio (a feature of the rack's curve_audio)`);
  const measured = d?.info?.pipelines?.[pipeline]?.steps;
  const steps = t.steps ?? measured ?? setup ?? 6;
  if (!Number.isInteger(steps) || steps < 1) throw new Error(`time steps ${JSON.stringify(t.steps)}: a whole number of blend steps, at least 1`);
  if (t.steps == null) defaulted.push(measured ? `steps ${steps}: ${label(d)}'s info measured ${steps} blend steps on ${pipeline}` : `steps ${steps}: a time row blends on every step of the setup (${steps}) unless the dial's info gives a measured number for this pipeline (SNAP-R231: look dials under reference pictures drew nothing at 2)`);
  const audio = t.audio ?? "protect";
  if (!AUDIO.includes(audio)) throw new Error(`time audio ${JSON.stringify(t.audio)}: follow (the sound changes with the dial) or protect (the soundtrack is left alone)`);
  if (t.audio == null) defaulted.push("audio protect: the row leaves the soundtrack alone (SNAP-R231: look rows under follow added 6-9 dB of roar); audio: follow lets the dial steer the sound too");
  if (type === "audio") {
    const feature = t.feature ?? "onset";
    if (!FEATURES.includes(feature)) throw new Error(`time feature ${JSON.stringify(t.feature)}: one of ${FEATURES.join(", ")}`);
    return { time: { type, feature, ...Object.fromEntries(SHAPING.filter((k) => t[k] != null).map((k) => [k, t[k]])), steps, audio }, defaulted };
  }
  const unit = t.unit ?? "seconds", interp = t.interp ?? "linear", smooth = t.smooth ?? 0, points = t.points;
  if (!UNITS.includes(unit)) throw new Error(`time unit ${JSON.stringify(t.unit)}: seconds (clip seconds, the default) or normalized (0 = first frame, 1 = clip end)`);
  if (!INTERPS.includes(interp)) throw new Error(`time interp ${JSON.stringify(t.interp)}: linear or step`);
  if (typeof smooth !== "number" || !(smooth >= 0 && smooth <= 1)) throw new Error(`time smooth ${JSON.stringify(t.smooth)}: a number from 0 to 1 (0 = straight lines)`);
  if (!Array.isArray(points) || !points.length || points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))
    throw new Error("time points: [[time, level], …], at least one, each two finite numbers (level 0 = off, 1 = the row's strength)");
  const u = unit === "seconds" ? " s" : "";
  for (let i = 1; i < points.length; i++) if (points[i][0] <= points[i - 1][0]) throw new Error(`key ${i + 1} at ${points[i][0]}${u} comes after key ${i} at ${points[i - 1][0]}${u}: times must increase`);
  if (t.unit == null) defaulted.push("unit seconds: keys are clip seconds from the take's first frame, the clock of its words");
  return { time: { type, points: points.map(([a, b]) => [a, b]), unit, interp, smooth, steps, audio }, defaulted };
}
const holdBeside = (r, time) => time && r.some((x) => x.hold && x.on !== false) && new Error("a hold row is on this rack: the rack refuses hold rows beside a time curve (turn the hold rows off first)");

export function add(dial, strength, time) {
  if (hidden(dial)) throw new Error(`${dial} is tagged nsfw and SFW only is on (the person's profile)`);
  if (!E.state().bricks.some((b) => b.key === "rack")) throw new Error("Add the Dial Rack brick first");
  const r = rows();
  if (r.some((x) => x.dial === dial)) return `${label(find(dial) ?? { dial })} is already on the rack`;
  const bad = holdBeside(r, time);
  if (bad) throw bad;
  const d = find(dial), s = strength ?? d?.info?.pos?.useful ?? 0.5;
  write([...r, { on: true, dial, strength: s, solo: false, ...(time ? { time } : {}) }]);
  return `${label(d ?? { dial })} on the rack at ${s >= 0 ? "+" : ""}${s}${time ? " with a time curve" : ""}`;
}
// patch.time: a checked spec, or null to make the row constant again
export function set(dial, patch) {
  const r = rows();
  if (!r.some((x) => x.dial === dial)) throw new Error(`${dial} isn't on the rack`);
  const bad = holdBeside(r, patch.time);
  if (bad) throw bad;
  write(r.map((x) => {
    if (x.dial !== dial) return x;
    const { time, ...rest } = { ...x, ...patch };
    return time ? { ...rest, time } : rest;
  }));
}
// the whole rack as given (a Book cut's rows, SNAP-R230); answers the rows it took off
export function replace(next) {
  if (!E.state().bricks.some((b) => b.key === "rack")) throw new Error("Add the Dial Rack brick first");
  const keep = new Set(next.map((x) => x.dial)), off = rows().filter((x) => x.dial && !keep.has(x.dial));
  write(next);
  return off;
}
export const remove = (dial) => write(rows().filter((x) => x.dial !== dial));

// ---- a Book cut's rows (SNAP-R230) ---------------------------------------------------------------------------------
// one row of a cut's plan as the rack stores it, from what an agent gives: the dial installed and allowed, its strength
// the pipeline's measured useful one when not given, its time curve checked with every default filled and said
export function planRow(x, { steps, pipeline } = {}) {
  if (!x || typeof x !== "object" || typeof x.dial !== "string") throw new Error("a row is {dial, strength?, on?, solo?, time?}: dial is a file from list_dials");
  const d = find(x.dial);
  if (!d) throw new Error(`no dial ${x.dial}${hidden(x.dial) ? " shown here (it is tagged nsfw and SFW only is on)" : ""}; list_dials lists them`);
  const t = timeOf(x.dial, x.time, { steps, pipeline }), measured = d.info?.pipelines?.[pipeline]?.useful, defaulted = t.defaulted.map((w) => `${label(d)}: ${w}`);
  if (x.strength != null && !Number.isFinite(x.strength)) throw new Error(`${x.dial}: strength is a number, not ${JSON.stringify(x.strength)}`);
  const strength = x.strength ?? useful(d, pipeline);
  if (x.strength == null) defaulted.push(`${label(d)}: strength ${strength}: ${measured ? `its info's useful strength on ${pipeline}` : d.info?.pos?.useful ? "its own useful strength" : "0.5, the dial is uncalibrated"}`);
  return { row: { on: x.on ?? true, dial: x.dial, strength, solo: x.solo ?? false, ...(t.time ? { time: t.time } : {}) }, defaulted };
}
// what each row gives over the clip: a constant row its strength; a key row strength × level at each key, in its unit
export const effective = (r) => ({ dial: r.dial, label: label(find(r.dial) ?? r), ...(r.on === false ? { off: true } : {}),
  ...(r.time?.type === "keys" ? { unit: r.time.unit, keys: r.time.points.map(([t, m]) => ({ at: t, level: m, strength: +(r.strength * m).toFixed(3) })) } : r.time ? { curve: `${r.time.feature} of the rack's curve_audio` } : { strength: r.strength }) });
// one key of a row's curve moved in time, kept between its neighbours. key: its number from 1, "peak" (the first key at
// the curve's highest level) or "last"; to_s in clip seconds
export function moveKey(r, key, to_s) {
  const t = r.time, name = label(find(r.dial) ?? r);
  if (t?.type !== "keys") throw new Error(`${name} has no keyed time curve to move a key of${t ? " (its curve follows the music)" : " (it is constant)"}: set its time first`);
  if (t.unit !== "seconds") throw new Error(`${name}'s keys are in normalized clip time: give its rows again in seconds (time.unit seconds) to move a key onto a time`);
  if (!Number.isFinite(to_s) || to_s < 0) throw new Error(`to_s is a time in clip seconds, from 0; not ${JSON.stringify(to_s)}`);
  const p = t.points, top = Math.max(...p.map((x) => x[1])), i = key === "peak" ? p.findIndex((x) => x[1] === top) : key === "last" ? p.length - 1 : Number.isInteger(key) && key >= 1 && key <= p.length ? key - 1 : -1;
  if (i < 0) throw new Error(`key ${JSON.stringify(key)}: its number from 1 to ${p.length}, "peak" or "last"`);
  if (i > 0 && to_s <= p[i - 1][0]) throw new Error(`${to_s} s would pass the key before it at ${p[i - 1][0]} s (key ${i}): move that one first, or give rows`);
  if (i < p.length - 1 && to_s >= p[i + 1][0]) throw new Error(`${to_s} s would pass the next key at ${p[i + 1][0]} s (key ${i + 2}): move that one first, or give rows`);
  return { row: { ...r, time: { ...t, points: p.map((x, j) => (j === i ? [to_s, x[1]] : x)) } }, moved: { key: i + 1, from: p[i][0], to: to_s } };
}

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
  const list = rows().filter((r) => r.dial), fam = family();
  const others = fam ? list.map((r) => find(r.dial)?.family).filter((f) => f && f !== fam) : [];
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
    scaleNote(fam) ? h("div", { className: "snap-quiet snap-dial-scale", textContent: scaleNote(fam) }) : null,
    others.length ? h("div", { className: "snap-dial-warn", title: `this recipe renders with ${fam}; a dial made for another model fails at run time`, textContent: `${others.length} dial${others.length === 1 ? " is" : "s are"} for ${[...new Set(others)].join(", ")}` }) : null,
    h("div", { className: "snap-dial-actions" },
      h("button", { className: "snap-link snap-quiet-btn", textContent: "+ Dial", title: "pick one of the installed dials", onclick: (e) => { e.stopPropagation(); onPick(); } }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "✦ Make a dial", title: "make a new dial from prompt pairs", onclick: (e) => { e.stopPropagation(); onMake(); } })));
}

// ---- the picker --------------------------------------------------------------------------------------------------
export async function openPicker(host, { say, onChange, onMake, move }) {
  await load();
  const own = family();
  let shown = own ?? "all";
  const q = h("input", { className: "snap-lib-q", placeholder: "Search dials (what it does, either side, the file)…" });
  const grid = h("div", { className: "snap-dial-grid" });
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const fam = h("div", { className: "snap-seg" });
  function draw() {
    const on = new Set(rows().map((r) => r.dial));
    fam.replaceChildren(...[own, "all"].filter(Boolean).map((f) => h("button", { className: f === shown ? "on" : "", textContent: f === "all" ? "All models" : `${f} dials`, onclick: () => { shown = f; draw(); } })));
    const words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    const found = all().filter((d) => (shown === "all" || d.family === shown) && words.every((w) => `${label(d)} ${d.info.description} ${d.dial}`.toLowerCase().includes(w)))
      .sort((a, b) => (a.mode === "pre") - (b.mode === "pre") || calibrated(b) - calibrated(a) || label(a).localeCompare(label(b)));
    grid.replaceChildren(...(found.length ? found.map((d) => h("button", { className: `snap-dial-tile${on.has(d.dial) ? " on" : ""}`, title: d.dial,
      onclick: () => { try { say(add(d.dial)); onChange(); close(); } catch (err) { say(err.message, true); } } },
      h("strong", { textContent: label(d) }),
      h("span", { className: "snap-quiet", textContent: d.info.description || "No description yet" }),
      h("span", { className: "snap-dial-meta" },
        calibrated(d) ? h("i", { textContent: `useful ±${d.info.pos.useful ?? d.info.neg.useful}` }) : h("i", { className: "warn", textContent: "uncalibrated" }),
        h("i", { className: "file", textContent: d.dial.replace(/^dials\//, "").replace(/\.safetensors$/, "") }),
        d.mode === "pre" ? h("i", { title: "pre-refiner LoRA file: an approximation of the hook, keep it at strength 1 or below", textContent: "LoRA file" }) : null,
        d.family !== own ? h("i", { textContent: d.family }) : null, on.has(d.dial) ? h("i", { className: "ok", textContent: "on the rack" }) : null), move?.(d.dial))) : [h("div", { className: "snap-quiet", textContent: "No dial matches. Make one?" })]));
  }
  q.addEventListener("input", draw);
  const sheet = h("div", { className: "snap-sheet snap-dial-sheet", role: "dialog", ariaLabel: "Dials" },
    h("header", {}, h("strong", { textContent: "Dials" }), h("span", { className: "snap-quiet", textContent: [`${all().length} installed`, scaleNote(own), PF.sfwOnly() && "SFW only · nsfw-tagged dials hidden (a preference filter)"].filter(Boolean).join(" · ") }), fam, h("span", { className: "snap-spacer" }),
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
// and take the node away again; the new dial goes on the rack only with add_to_rack. Resolves with { dial, report,
// saved, folder, shared, folders }: shared is false when the file went into this server's own models folder (the first
// loras folder; on a --base-directory server, that base's) and folders names the others it reads (SNAP-R239, F-SQ33).
export async function make({ name, negative, positive, pairs, subjects, description, folder, add_to_rack = false, by = "person" }, onStatus = () => {}) {
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
    const folders = n.widgets.find((x) => x.name === "folder")?.options?.values ?? [];
    if (folder != null && !folders.includes(folder)) throw new Error(`folder ${JSON.stringify(folder)}: this server's loras folders are ${folders.map((f) => JSON.stringify(f)).join(", ") || "not listed (the Make Dial node has no folder input: update the pack)"}`);
    const values = { pairs: lines.join("\n"), subjects: subjects ?? "", name: file, description: description ?? "", negative_label: negative ?? "", positive_label: positive ?? "",
      useful: 0, overcook: 0, evidence: "unknown", ...(folder != null ? { folder } : {}) }; // a new dial's strengths are unknown until someone tries it
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
    await J.queueRun({ kind: "make_dial", title: `Make the dial ${file}: ${negative || "A"} ↔ ${positive || "B"}`, by, eta_s: null }, () => app.queuePrompt(0, 1, { queueNodeIds: [n.id] }));
    api.removeEventListener("promptQueued", mark);
    const errors = Object.values(app.lastNodeErrors ?? {}).map((e) => `${e.class_type}: ${e.errors?.[0]?.message ?? "error"}${e.errors?.[0]?.details ? ` (${e.errors[0].details})` : ""}`);
    if (errors.length) throw new Error(`Can't make it yet · ${errors[0]}`);
    if (!queued) throw new Error("ComfyUI didn't take the job (see its message)");
    const report = await done;
    await load(true);
    const dial = `dials/${file}.safetensors`, into = folder ?? folders[0] ?? null;
    if (add_to_rack) add(dial, 0.5);
    return { dial, report, saved: report.match(/^saved (.+)$/m)?.[1] ?? null, folder: into, shared: !!into && into !== folders[0], folders, on_rack: add_to_rack };
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
      const { dial, report } = await make({ name: name.value, negative: neg.value, positive: pos.value, pairs, subjects: subjects.value, description: desc.value, add_to_rack: true }, (t) => { status.textContent = t; });
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
