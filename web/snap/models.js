// What a recipe loads, read generically: a combo setting is a model setting when its value or choices are files in one of
// ComfyUI's model folders (core /experiment/models lists them with sizes), so any loader, pack node or any-node brick gets
// model chips without per-node code. Setups are what a brick's node offers through its own `presets` interface
// ({ names(), values(name), current(), apply(name) }, e.g. the Render Preset's) plus the Library's family recipe cards.
// SNAP-R1 generic pass-through · SNAP-R3 unresolved stays missing · SNAP-R9 setups own the model set · SNAP-R10 turbo
// merge vs LoRA · SNAP-R11 warn, never block · SNAP-R12 LoRA roles · SNAP-R13 family rules from the model graph
// SNAP-R25 SFW only hides what the graph tags nsfw · SNAP-R26 a name files a turbo LoRA only on strong signals ·
// SNAP-R27 a lock on LoRAs the private rules match · SNAP-R35 a rating from move to…, the admin's on a gated install ·
// see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import * as D from "./dials.js";
import * as L from "./library.js";
import { BRICKS } from "./bricks.js";
import * as PF from "./profile.js";
import * as ACC from "./account.js";

let files = new Map(), exts = [], loading = null, notify = () => {};
// name -> { folder, size, modified } from core's folder lists (every model folder; the first folder wins a name in two),
// with the model graph; read once per page, and again when a recipe names a file they don't have yet (readable)
export function load() {
  loadGraph();
  locks();
  loading ??= api.fetchApi("/experiment/models").then((r) => r.json())
    .then((folders) => Promise.all(folders.map(async ({ name, extensions }) => [name, extensions, await (await api.fetchApi(`/experiment/models/${encodeURIComponent(name)}`)).json()])))
    .then((lists) => {
      files = new Map();
      exts = [...new Set(lists.flatMap(([, x]) => x))];
      for (const [folder, , list] of lists) for (const f of list) if (!files.has(f.name)) files.set(f.name, { folder, size: f.size, modified: f.modified });
      return files;
    }).then(async (f) => { await loadGraph(); return f; });
  return loading;
}
// the folders read again (a file downloaded or copied after the page loaded), and the loaders' choices with them (G1:
// short03's new ORB360 LoRA was refused as missing until a reload)
export async function reload() {
  loading = null;
  await Promise.all([load(), app.refreshComboInNodes()]);
  return files;
}
// LoRA files the person's private rules match now (the server checks; the page never reads private.json): a lock beside
// them, marking only, so the row still works (SNAP-R27). Asked once per page and again after a move; a server before the
// route has none, and a read that fails (a restart) is asked again next time instead of leaving the sheet dead (U76 L4)
let locked = new Set(), locking = null, privacy = false;
export function locks() {
  locking ??= api.fetchApi("/mainodes/snap/private_loras").then((r) => (r.ok ? r.json() : { loras: [] })).then((r) => { locked = new Set(r.loras); privacy = r.privacy === true; notify(); })
    .catch(() => { locking = null; });
  return locking;
}
api.addEventListener("reconnected", () => { locking = null; locks(); });
export const isLocked = (name) => locked.has(name);
export const lockCount = () => locked.size; // in the faces' signatures: rows get their lock when the answer arrives
// the lists as a tool should read them: loaded, and asked again for any recipe file they didn't have yet
export async function current() {
  await load();
  settings();
  return load();
}
export const file = (name) => files.get(name);
// a file a graph Snap builds names, as this server's loader lists it (basename matching, SNAP-R3); one that isn't there
// fails here, by name. Legacy combos list their choices as [[...]], V3 ones as ["COMBO", { options }]
export async function choice(type, input, value) {
  const spec = (await (await api.fetchApi(`/object_info/${type}`)).json())[type].input.required[input], list = Array.isArray(spec[0]) ? spec[0] : spec[1].options;
  const hit = E.resolveChoice(list, value);
  if (hit === undefined || !list.includes(hit)) throw new Error(`${type}.${input}: ${value} isn't installed`);
  return hit;
}
// folder -> the file names in it (core's lists), for readiness checks that look at what is installed now
export const folders = () => { const m = new Map(); for (const [name, f] of files) m.set(f.folder, [...(m.get(f.folder) ?? []), name]); return m; };

// The model graph (SNAP-R10, SNAP-R12, SNAP-R13): one entry per file saying how it fits with others (family, kind
// base / sft / finetune / turbo_merge / lora, turbo merged or LoRA with its steps / cfg / sampler, deband, LoRA role,
// trained_on, loads_in_core, an upscaler's scale). The pack's entries (snap_cards/models.json) under the person's own
// (userdata snap/models.json, merged field by field: the person wins, a null leaves the pack value); what neither says is
// inferred from the file's folder and name.
const MINE = "snap/models.json";
const base = (f) => String(f ?? "").replace(/\\/g, "/").split("/").pop();
// the pack's `families` say which family a file's name puts it in when no entry does (SNAP-R13: data, not code)
let relations = new Map(), packed = new Map(), families = [], variants = new Map(), relating = null, problem = null;
// the person's file; one that doesn't parse or can't be read (a 5xx) throws, so nothing writes over it; only a missing one is
// empty (U76 L10)
const mine = async () => {
  const r = await api.getUserData(MINE);
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`reading it answered ${r.status}`);
  return r.json();
};
// U76 M5: every write of the person's file reads it fresh inside one chain, so parallel moves (an agent filing several
// LoRAs at once) each keep their change
let writing = Promise.resolve();
const serial = (fn) => (writing = writing.catch(() => {}).then(fn));
export const overlay = (pack, own) => ({ ...pack, ...Object.fromEntries(Object.entries(own).filter(([, v]) => v != null)) });
function loadGraph() {
  relating ??= Promise.all([api.fetchApi("/mainodes/snap/models").then((r) => r.json()).catch(() => ({ models: [], families: [] })),
    mine().catch((e) => { problem = `Your snap/models.json was skipped (${e.message}); Snap uses the pack's model graph until it parses`; return []; })]).then(([pack, own]) => {
    families = pack.families.map((f) => [new RegExp(f.names), f.name]);
    variants = new Map(pack.families.map((f) => [f.name, f.variants ?? []]));
    relations = new Map(pack.models.map((e) => [base(e.file), e]));
    packed = new Map(relations);
    for (const e of own) relations.set(base(e.file), overlay(relations.get(base(e.file)), e));
    return relations;
  });
  return relating;
}
// why the person's model graph isn't used (SNAP-R11: say it once, keep working)
export const graphProblem = () => problem;
// SNAP-R26 (U84): a LoRA's name says its kind only with a sampling step count; anything else is unsorted until an agent
// reads the file (describe_lora) or the person files it
function infer(name) {
  const n = base(name).toLowerCase(), folder = file(name)?.folder ?? null, found = Number(n.match(/(\d+)[-_ ]?steps?(?![-_ ]?\d)/)?.[1]) || null;
  const steps = found && found <= 16 ? found : null; // "step1500" / "v2_step_1500" / "5000steps" are training steps, not a turbo's
  const kind = { loras: "lora", text_encoders: "encoder", clip: "encoder", vae: "vae" }[folder] ?? (/turbo|dmd|dmad|lightning|hyper/.test(n) ? "turbo_merge" : "base");
  const fast = kind === "turbo_merge" || (kind === "lora" && !!steps);
  const e = { file: base(name), folder, family: families.find(([re]) => re.test(n))?.[1] ?? null, kind, inferred: true,
    turbo: fast ? { how: kind === "lora" ? "lora" : "merged", steps, cfg: null, sampler: null, scheduler: null } : null, deband: /deband|banding/.test(n) ? (kind === "lora" ? "lora" : "merged") : "none" };
  if (kind === "lora") Object.assign(e, String(name).startsWith("dials/") ? { role: "dial" } : fast ? { role: "core", core: "turbo" } : { role: "unsorted" });
  return e;
}
export function entry(name) {
  if (!name) return null;
  const e = relations.get(base(name)), { inferred, ...guess } = infer(name);
  return e ? { ...guess, ...e } : { ...guess, inferred };
}
// the person files a file ("what is this?"): kept in their snap/models.json, so the answer is remembered
export const teach = (name, patch) => serial(() => write(name, patch));
async function write(name, patch) {
  const own = await mine().catch((e) => { throw new Error(`snap/models.json couldn't be read or doesn't parse (${e.message}); nothing was written over it`); });
  const at = own.findIndex((e) => base(e.file) === base(name));
  const e = { ...(own[at] ?? { file: base(name) }), ...patch };
  own.splice(at < 0 ? own.length : at, at < 0 ? 0 : 1, e);
  await api.storeUserData(MINE, own);
  const { inferred, ...was } = entry(name);
  relations.set(base(name), { ...was, ...e });
  return entry(name);
}
// SFW only (the person's profile): a file the model graph tags nsfw is left out of pickers and agent lists. A preference
// filter on the person's own tags, not a safety guarantee (SNAP-R25)
export const hidden = (name) => PF.sfwOnly() && (entry(name)?.tags ?? []).includes("nsfw");
D.useHidden(hidden);
// ---- LoRAs by category (SNAP-R12, SNAP-R25): a LoRA's category is its role from the model graph (core with its sub-kind,
// style, identity, dial, unsorted), and each tag (nsfw) is one more; the chips and "move to…" are built from these
export const ROLES = ["core·turbo", "core·fix", "core·task", "core·hires", "core·edit", "core·control", "style", "identity", "dial", "unsorted"];
export const TAGS = ["nsfw"];
// ratings as move to… sets them ("rating:" clears the person's own): anyone's on an ungated install; behind snap-gate only
// the admin's count (SNAP-R32), so only the admin is offered them
export const RATINGS = ["pg", "mature", "adult"];
export const RATING_SHOWN = { pg: "PG", mature: "Mature", adult: "Adult" };
export const mayRate = () => !ACC.account() || ACC.account().role === "admin";
export const categoryOf = (e) => (e.role === "core" ? `core·${e.core ?? "task"}` : e.role ?? "unsorted");
// every LoRA file here with its category and tags; SFW only leaves the nsfw ones out (and so their chip)
export const loraFiles = () => [...files].filter(([name, f]) => f.folder === "loras" && !hidden(name)).map(([name]) => { const e = entry(name); return { file: name, entry: e, category: categoryOf(e), tags: e.tags ?? [] }; });
export const inCategory = (r, id) => r.category === id || r.tags.includes(id);
// the categories present, with how many files each holds, roles in ROLES order then tags
export function categories() {
  const n = new Map();
  for (const r of loraFiles()) for (const id of [r.category, ...r.tags]) n.set(id, (n.get(id) ?? 0) + 1);
  const at = (id) => (ROLES.includes(id) ? ROLES.indexOf(id) : ROLES.length + (TAGS.includes(id) ? TAGS.indexOf(id) : TAGS.length));
  return [...n].map(([id, count]) => ({ id, count })).sort((a, b) => at(a.id) - at(b.id) || a.id.localeCompare(b.id));
}
// file a LoRA under a role ("style", "core·fix") or switch a tag on or off ("nsfw"), in the person's snap/models.json, so it
// wins over the pack everywhere at once, with who filed it and why (`filed`, SNAP-R55). Returns the undo: the person's own
// entry as it was (null when there was none)
export const moveTo = (file, id, opts) => serial(() => move(file, id, opts));
async function move(file, id, { by = "person", reason = null } = {}) {
  const own = await mine().catch((e) => { throw new Error(`snap/models.json couldn't be read or doesn't parse (${e.message}); nothing was written over it`); });
  const before = own.find((e) => base(e.file) === base(file)) ?? null, e = entry(file);
  // SNAP-R55: the person's filing wins over an agent's (an entry of theirs from before `filed` existed counts as theirs)
  if (by === "agent" && !id.startsWith("rating:") && (before?.role || before?.tags) && before.filed?.by !== "agent")
    throw new Error(`The person filed ${base(file)} as ${categoryOf(e)}${(e.tags ?? []).length ? ` (${e.tags.join(", ")})` : ""}; their filing wins. Ask them, or propose it (propose: true)`);
  let patch;
  if (TAGS.includes(id)) patch = { tags: e.tags?.includes(id) ? e.tags.filter((t) => t !== id) : [...(e.tags ?? []), id] };
  else if (ROLES.includes(id)) {
    const [role, core] = id.split("·");
    patch = { role, core: core ?? null };
    // the Turbo slot lists it (SNAP-R26: the person beats the name); back to turbo, the pack's numbers stand again (null)
    if (core === "turbo" && !e.turbo) patch.turbo = packed.get(base(file))?.turbo ? null : infer(file).turbo ?? { how: "lora", steps: null, cfg: null, sampler: null, scheduler: null };
    // U76 M4: any other role is no turbo, whatever the pack or the name said (false survives overlay; null wouldn't)
    if (core !== "turbo") patch.turbo = false;
  }
  else if (id.startsWith("rating:") && (RATINGS.includes(id.slice(7)) || id === "rating:")) {
    if (!mayRate()) throw new Error("On this install only the admin rates files (their ratings are the ones the gate reads)");
    patch = { rating: id.slice(7) || null };
  }
  else throw new Error(`No category "${id}"; there are: ${[...ROLES, ...TAGS, ...RATINGS.map((r) => `rating:${r}`), "rating:"].join(", ")}`);
  if (!id.startsWith("rating:")) patch.filed = { by, reason, at: new Date().toISOString() };
  await write(file, patch);
  locking = null; locks(); // a move can change what the private rules match (the identity role)
  notify();
  // U76 L7: leaving identity can end its privacy quietly; say so where privacy is on (SNAP-R37)
  const left = privacy && e.role === "identity" && ROLES.includes(id) && id !== "identity";
  return { file: base(file), before, ...(left ? { note: `${base(file)} was private as an identity LoRA; now it is private only if your private rules match it` } : {}) };
}
// put back the person's own entry from a move's undo (or take it out, so the pack's entry stands again)
export const restore = (undo) => serial(() => putBack(undo));
async function putBack({ file, before }) {
  const own = (await mine()).filter((e) => base(e.file) !== file);
  await api.storeUserData(MINE, before ? [...own, before] : own);
  relations.set(file, before ? overlay(packed.get(file), before) : packed.get(file));
  if (!relations.get(file)) relations.delete(file);
  notify();
  return entry(file);
}
export const known = () => files.size;
export const gb = (bytes) => `${(bytes / 1e9).toFixed(bytes < 1e9 ? 2 : 1)} GB`;

const choices = (w) => (Array.isArray(w?.options?.values) ? w.options.values : null);
export const isModel = (w) => !!choices(w) && (files.has(w.value) || choices(w).some((v) => files.has(v)));
// a choice the folder lists don't have, with an extension they list, is a file the server can't read (moved away, a
// broken link): it stays in the combo until a restart, but a run would fail on it (SNAP-R3). `none` and a .gguf aren't
// such files. A file downloaded after the page opened is in the combo before it is in these lists, so the lists are
// fetched once more first; the view re-renders when they arrive (onCheck)
const asked = new Set();
export function readable(name) {
  if (!files.size || files.has(name) || !exts.some((x) => String(name).endsWith(x))) return true;
  if (!asked.has(name)) { asked.add(name); loading = null; load().then(() => notify()); }
  return false;
}

// a brick's nodes as [nodeKey, node]
export function nodesOf(brickKey) {
  const b = E.state().bricks.find((x) => x.key === brickKey);
  return Object.keys(b?.nodes ?? {}).map((k) => [k, E.nodeFor(brickKey, k)]).filter(([, n]) => n);
}

// a dynamic group's placeholder: a LoRA stack keeps one row (the node's minimum), so an empty stack is its only row, off
// at strength 0; it loads nothing
const placeholder = (n, g) => { const at = (f) => n.widgets.find((w) => w.name === `${g}${f}`)?.value; return at("") === 1 && at(".0.enabled") === false && Number(at(".0.strength")) === 0; };
const idle = (n, w) => { const g = w.name.match(/^(.+)\.0\.lora_name$/)?.[1]; return !!g && placeholder(n, g); };
// every model setting in the recipe: which file, how big, and whether it is installed
export function settings() {
  return E.state().bricks.flatMap((b) => nodesOf(b.key).flatMap(([nodeKey, n]) => (n.widgets ?? []).filter((w) => isModel(w) && !idle(n, w)).map((w) => ({
    brick: b.key, node: nodeKey, setting: w.name, file: w.value, folder: file(w.value)?.folder ?? null, size: file(w.value)?.size ?? null,
    installed: choices(w).includes(w.value) && readable(w.value), ...(choices(w).includes(w.value) && !readable(w.value) ? { unreadable: true } : {}),
  }))));
}
// model settings a run would fail on although the combo lists them: a file the server can't read, or one the model graph
// says core ComfyUI can't load; the readiness badge counts them with E.missing()
export const unreadable = () => settings().filter((s) => s.unreadable || entry(s.file)?.loads_in_core === false)
  .map((s) => ({ brick: s.brick, node: E.nodeFor(s.brick, s.node)?.title, setting: s.setting, value: s.file, ...(s.unreadable ? { unreadable: true } : { cant_load: true }) }));
export const total = (list = settings()) => [...new Map(list.filter((s) => s.size).map((s) => [s.file, s.size])).values()].reduce((a, b) => a + b, 0);

// setups the recipe's nodes offer (one entry per preset), each with the model files it would load
const DIFFUSION = new Set(["base", "sft", "finetune", "turbo_merge"]);
const short = (f) => base(f).replace(/\.(safetensors|gguf|sft|ckpt)$/, "");
const isFile = (v) => typeof v === "string" && /\.(safetensors|gguf|sft|ckpt)$/.test(v);
// a file as a setup card or preset names it: installed (by file name in one sub-folder, as E.resolveChoice resolves it:
// two files with that name are no match, SNAP-R3), and whether core can load it
function readiness(v) {
  const name = E.resolveChoice([...files.keys()], v);
  const e = entry(name ?? v);
  return { file: name ?? v, size: files.has(name) ? file(name).size : null, installed: files.has(name), ...(e?.loads_in_core === false ? { cant_load: true } : {}), kind: e?.kind ?? null };
}
const familyOf = (values) => Object.values(values).map((v) => typeof v === "string" && entry(v)).find((e) => e && DIFFUSION.has(e.kind) && e.family)?.family ?? null;

export function setups() {
  const presets = E.state().bricks.flatMap((b) => nodesOf(b.key).filter(([, n]) => n.presets).flatMap(([nodeKey, n]) => {
    const now = n.presets.current();
    return n.presets.names().map((name) => {
      const values = n.presets.values(name);
      const models = Object.entries(values).map(([setting, v]) => [setting, v, n.widgets.find((w) => w.name === setting)]).filter(([, , w]) => isModel(w))
        .map(([setting, v, w]) => ({ setting, ...readiness(v), installed: choices(w).includes(v) && readable(v) }));
      return { name, family: familyOf(values) ?? family(), source: "preset", brick: b.key, node: nodeKey, current: now.name === name, edited: now.name === name && now.edited, models, values };
    });
  }));
  // family recipe cards: every model file their bricks name, with readiness (✓ / missing / can't load)
  const cards = L.setupCards().map((c) => {
    const values = flat(c);
    const models = values.filter(([, v]) => isFile(v)).map(([setting, v]) => ({ setting, ...readiness(v) }));
    const first = (names) => values.find(([k]) => names.includes(k))?.[1]; // the first of each, as sampling() reads a live recipe
    return { name: c.title, family: c.family, source: "recipe", card: c.id, output: c.output, about: c.about, current: E.state().setup === c.id, models,
      values: { sampler: first(SAMPLING.sampler), schedule: first(SAMPLING.scheduler), steps: first(SAMPLING.steps), cfg: first(SAMPLING.cfg) } };
  });
  return [...presets, ...cards];
}

// a Models value fits a family when it is installed and the model graph puts it in that family (or in none); an encoder
// type fits when it is the family's own (the type the dials know for it), as warnings() says
function fits(w, fam) {
  if (!choices(w)?.includes(w.value)) return false;
  if (isModel(w)) return readable(w.value) && [fam, null, undefined].includes(entry(w.value).family);
  const want = Object.keys(D.types()).find((t) => D.types()[t] === fam);
  return !want || !choices(w).includes(want) || w.value === want;
}
// a preset setup in place, as one undo step; it brings its family's encoder and VAEs (the Models brick's own pack values)
// wherever the current one doesn't fit, so the setup never sits next to another family's encoder, and a lower-VRAM VAE
// or encoder of the same family stays (SNAP-R9). Under Ref2V the First frame opens the shot as <Picture 1>, in the same
// step (F-C32, library.js syncOpening)
export function apply(name) {
  const s = setups().find((x) => x.name === name && x.source === "preset");
  if (!s) throw new Error(`No setup "${name}" on this recipe's bricks; there are: ${setups().map((x) => x.name).join(", ")}`);
  E.batch(() => {
    E.nodeFor(s.brick, s.node).presets.apply(name);
    if (E.state().bricks.some((b) => b.key === "models")) for (const spec of BRICKS.models.nodes) {
      const n = E.nodeFor("models", spec.key);
      E.setValues("models", spec.key, Object.fromEntries(Object.entries(spec.values).filter(([k]) => !fits(n.widgets.find((w) => w.name === k), s.family))));
    }
    E.tag("family", s.family);
    if (turboHost()) E.remember(turboHost(), "turbo", null); // a new setup's quality settings are the ones "Turbo off" goes back to
    L.syncOpening();
  });
  app.canvas.setDirty(true, true);
  return s;
}

// a family recipe card: on a fresh tab every value; in place (same family) the shot's own values stay, and of the bricks
// the card doesn't list only those an earlier card brought go: a slot (Upscale), the person's own bricks, Style and Cast
// stay. A core stack always takes the card's rows: they belong to the setup, so the old setup's turbo or fix row never
// rides along (SNAP-R12). One undo step
const KEEP = new Set(["prompt", "negative", "noise_seed", "width", "height"]);
const coreRows = (b) => (BRICKS[b.key]?.stack?.role === "core" ? { ...b, values: { [BRICKS[b.key].stack.node]: { [BRICKS[b.key].stack.group]: 1, ...BRICKS[b.key].nodes[0].values, ...b.values[BRICKS[b.key].stack.node] } } } : b);
export async function applyCard(card, { fresh }) {
  const bricks = (fresh ? card.brick.bricks : card.brick.bricks.map((b) => ({ ...b, values: Object.fromEntries(Object.entries(b.values).map(([k, ws]) => [k, Object.fromEntries(Object.entries(ws).filter(([name]) => !KEEP.has(name)))])) }))).map(coreRows);
  let keys;
  const was = E.state().setup;
  app.canvas.emitBeforeChange();
  try {
    keys = await E.restore(bricks);
    for (const k of keys) E.remember(k, "card", card.id);
    const gone = E.state().bricks.filter((b) => b.card && b.card !== card.id && !BRICKS[b.key].slot && !["style", "identity"].includes(BRICKS[b.key].stack?.role)).map((b) => b.key);
    for (const b of gone) E.unsnap(b); // what they fed (the Render's model) binds to the brick before them again
    E.tag("setup", card.id);
    E.tag("family", card.family);
    if (turboHost()) E.remember(turboHost(), "turbo", null);
    await L.pinSetup(card, was); // SNAP-R60: on the tab the card went onto (useSetup opened a new one first if it had to)
  } finally { app.canvas.emitAfterChange(); }
  app.canvas.setDirty(true, true);
  return keys;
}

// SNAP-R5: another family (or a recipe on a graph Snap doesn't own) starts in its own tab; the open workflow is left alone
export async function freshTab() {
  if (!app.graph.nodes.length) return;
  const was = app.extensionManager.workflow.activeWorkflow;
  await app.extensionManager.command.execute("Comfy.NewBlankWorkflow");
  while (app.extensionManager.workflow.activeWorkflow === was || app.graph.nodes.length) await new Promise((r) => setTimeout(r, 30));
}
// a setup from setups(), as the Setups sheet, the Library and the apply_setup / apply_card tools all apply it (SNAP-R19):
// a preset in place; a family card in place when it is this recipe's family, else in a new tab after keeping this stack
// as its family's "Last used" card (keep), so coming back is lossless
export async function useSetup(s, { keep = true } = {}) {
  if (s.source === "preset") { apply(s.name); return `Setup: ${s.name}`; }
  const card = L.get(s.card), fam = family(), leaving = E.state().bricks.length && fam !== card.family;
  const saved = leaving && keep && fam ? await L.saveLast(fam) : null;
  if (leaving || (!E.state().bricks.length && app.graph.nodes.length)) await freshTab();
  await applyCard(card, { fresh: !E.state().bricks.length });
  return `${card.title}${leaving ? " in a new tab" : ""}${saved ? ` · your ${fam} stack is kept as "${saved.title}"` : ""}`;
}

// ---- the recipe's family, its LoRAs, its sampling, and what the model graph says about them -------------------------
// the family: what the applied setup declared, else what the diffusion model is for (model graph), else what the encoder
// type says; the other two then only check it (warnings)
export function family() {
  if (E.state().family) return E.state().family;
  for (const st of settings()) { const e = entry(st.file); if (e?.family && DIFFUSION.has(e.kind) && (st.folder === "diffusion_models" || !e.inferred)) return e.family; }
  return D.typeFamily();
}
D.useFamily(() => (E.state().bricks.length ? family() : null));
E.useCheck(checkNow);
const diffusion = () => settings().find((st) => DIFFUSION.has(entry(st.file)?.kind) && (st.folder === "diffusion_models" || !entry(st.file).inferred));
// Base or SFT lineage: what a model or LoRA is built on (Kromoss is a Base fine-tune; a DeBand file an SFT one)
const lineage = (e) => (!e ? null : ["base", "sft"].includes(e.kind) ? e.kind : e.trained_on);

// every LoRA setting in the recipe with its strength and on/off, read generically: a dynamic-group row
// (<group>.<i>.lora_name with .strength / .enabled beside it) or a single `lora` with `lora_strength`
export function loras() {
  return settings().filter((st) => (st.folder ?? entry(st.file)?.folder) === "loras" && entry(st.file)?.role !== "dial").map((st) => {
    const n = E.nodeFor(st.brick, st.node), m = st.setting.match(/^(.+)\.(\d+)\.[^.]+$/), at = (f) => n.widgets.find((w) => w.name === (m ? `${m[1]}.${m[2]}.${f}` : f))?.value;
    const strength = Number(at(m ? "strength" : `${st.setting}_strength`) ?? 1), on = at("enabled") !== false && strength !== 0;
    return { ...st, row: m ? Number(m[2]) : null, strength, on, entry: entry(st.file) };
  }).filter((r) => r.on || r.strength !== 0); // an empty stack's one row (off at 0) is no LoRA
}

// the sampling a recipe runs, wherever it lives (the image Render's own widgets, H3's Render Preset): the first
// setting of each name that no wire drives
const SAMPLING = { steps: ["steps"], cfg: ["cfg"], sampler: ["sampler_name", "sampler"], scheduler: ["scheduler", "schedule"] };
export function sampling() {
  const out = {};
  for (const b of E.state().bricks) for (const [nodeKey, n] of nodesOf(b.key)) for (const [k, names] of Object.entries(SAMPLING)) {
    const w = !out[k] && n.widgets?.find((x) => names.includes(x.name) && !n.inputs?.some((i) => i.widget?.name === x.name && i.link != null));
    if (w) out[k] = { brick: b.key, node: nodeKey, name: w.name, value: w.value, choices: choices(w) };
  }
  return out;
}

// what doesn't fit, as one line each on the brick it concerns; never blocks anything (SNAP-R11)
// warnings other modules add (slots.js: an upscale sized past this GPU's memory), each a function giving [{brick, text}]
const sources = [];
export const addWarnings = (fn) => sources.push(fn);
export function warnings() {
  const fam = family(), types = D.types(), out = sources.flatMap((fn) => fn()), say = (brick, text) => out.push({ brick, text });
  const want = Object.keys(types).find((t) => types[t] === fam);
  for (const b of E.state().bricks) for (const [, n] of nodesOf(b.key)) {
    const w = want && n.widgets?.find((x) => x.name === "type" && choices(x)?.includes(want));
    if (w && w.value !== want) say(b.key, `encoder type ${w.value} doesn't fit ${fam} (it wants ${want})`);
  }
  for (const st of settings()) {
    const e = entry(st.file);
    if (fam && e?.family && e.family !== fam && e.role !== "dial") say(st.brick, `${short(st.file)} is for ${e.family}; this recipe is ${fam}`);
    if (e?.loads_in_core === false) say(st.brick, `${short(st.file)} can't load in core ComfyUI (${e.quant_format ?? "unsupported format"})`);
  }
  const model = diffusion(), me = model && entry(model.file), on = loras().filter((r) => r.on), turbo = on.filter((r) => r.entry.turbo);
  if (me?.kind === "sft" && me.deband === "none" && !on.some((r) => r.entry.deband === "lora")) say(model.brick, `${short(model.file)} is SFT with no deband fix: expect vertical banding; use an SFT DeBand checkpoint or add a deband LoRA`);
  if (me?.turbo?.how === "merged" && turbo.length) say(turbo[0].brick, `${short(model.file)} already has a turbo merged in; ${turbo.map((r) => short(r.file)).join(", ")} added on top anyway`);
  if (turbo.length > 1) say(turbo[0].brick, `${turbo.length} turbo LoRAs stacked: steps and cfg follow ${short(turbo[0].file)}; lower strengths (about 0.3-0.6 each) are usual`);
  for (const r of on) if (lineage(r.entry) && lineage(me) && lineage(r.entry) !== lineage(me)) say(r.brick, `${short(r.file)} was trained on ${lineage(r.entry) === "sft" ? "SFT" : "Base"}; this model is ${lineage(me) === "sft" ? "SFT" : "Base"}-built (it often transfers)`);
  const t = me?.turbo ?? turbo[0]?.entry.turbo, now = sampling();
  if (t && typeof t.steps === "number" && now.steps && (now.steps.value !== t.steps || (t.sampler && now.sampler && now.sampler.value !== t.sampler))) {
    say(now.steps.brick, `the turbo was distilled for ${t.steps} steps${t.sampler ? ` (${t.sampler}${t.cfg != null ? `, cfg ${t.cfg}` : ""})` : ""}; this runs ${now.steps.value}${now.sampler ? ` (${now.sampler.value}${now.cfg ? `, cfg ${now.cfg.value}` : ""})` : ""}`);
  }
  return out;
}

// ---- the Turbo chip (SNAP-R10, SNAP-R14): the turbos this recipe's family has, merges and LoRAs alike ----------------
// a merge swaps the diffusion model (only one built on the same Base/SFT lineage); a LoRA adds a core row; either one
// brings its steps / cfg / sampler / scheduler. "off" puts back what was there before the first turbo: one undo step
const coreStack = () => E.state().bricks.find((b) => BRICKS[b.key].stack?.role === "core")?.key ?? null;
// a family's base variants (H3: ref2v, fl2v) come from the model graph's families: a file whose name holds one is for it
const variantOf = (name) => (variants.get(family()) ?? []).find((v) => base(name).toLowerCase().includes(v)) ?? null;
// H3 carries its one LoRA on the Render Preset (`lora`), not in a core stack: that setting is where its turbo lives
// (a setting with a `<name>_strength` beside it, installed or not)
const single = () => {
  for (const [node, n] of nodesOf(turboHost())) {
    const w = n.widgets?.find((x) => n.widgets.some((y) => y.name === `${x.name}_strength`));
    if (w) return { brick: turboHost(), node, setting: w.name, file: w.value };
  }
  return null;
};
// the rest of what a turbo was made for, by the setting's own name (Pika's knots `sigmas`, H3's `shift_video` / `shift_audio`)
const exact = (t) => Object.fromEntries(Object.entries(t).filter(([k, v]) => v != null && k !== "how" && !(k in SAMPLING)));
// that setting on the turbo's host, unless a wire drives it
const hostSetting = (name) => {
  for (const [node, n] of nodesOf(turboHost())) if (n.widgets?.some((w) => w.name === name) && !n.inputs?.some((i) => i.widget?.name === name && i.link != null)) return [turboHost(), node, name];
  return null;
};
export function turbos() {
  const fam = family(), me = diffusion() && entry(diffusion().file), mine = diffusion() && variantOf(diffusion().file);
  if (!fam || (!coreStack() && !single())) return [];
  const all = [...files.keys()].map((name) => [name, entry(name)]).filter(([name, e]) => e?.turbo && e.family === fam && e.loads_in_core !== false && !hidden(name)); // U76 L8
  const merges = all.filter(([, e]) => e.kind === "turbo_merge" && lineage(e) === lineage(me));
  // the ones built for this model come first (Base / SFT lineage, and the base variant: ref2v vs fl2v); the rest stay, labelled
  const fit = ([name, e]) => (!lineage(e) || !lineage(me) || lineage(e) === lineage(me)) && (!mine || !variantOf(name) || variantOf(name) === mine);
  const rows = all.filter(([, e]) => e.kind === "lora" && e.role === "core").sort((a, b) => fit(b) - fit(a));
  // a file in two folders under one name (krea2/x and x) is one turbo: the copy in the setup model's folder, else the first
  const dir = (n) => n.replace(/\\/g, "/").replace(/[^/]*$/, ""), home = me && dir(diffusion().file);
  const once = [...merges, ...rows].filter(([name], i, list) => { const twins = list.filter(([n]) => short(n) === short(name)); return (twins.find(([n]) => dir(n) === home) ?? twins[0])[0] === name; });
  return once.map(([name, e]) => ({ file: name, name: short(name), how: e.turbo.how, steps: e.turbo.steps, cfg: e.turbo.cfg, sampler: e.turbo.sampler, scheduler: e.turbo.scheduler,
    ...exact(e.turbo), strength: e.recommended?.strength ?? 1, fits: fit([name, e]),
    ...(fit([name, e]) ? {} : { mismatch: variantOf(name) && variantOf(name) !== mine ? `made for ${variantOf(name)}; this model is ${mine}` : `trained on ${lineage(e) === "sft" ? "SFT" : "Base"}; this model is ${lineage(me) === "sft" ? "SFT" : "Base"}-built` }),
    notes: e.notes ?? "" }));
}
// the brick whose sampling a turbo edits (the image Render; H3 carries its turbo in the Render Preset, whose LoRA is a turbo)
export const turboHost = () => E.state().bricks.find((b) => BRICKS[b.key].turbo)?.key ?? null;
// every LoRA file installed, with what the model graph says about it (for "+ LoRA")
export const loraChoices = () => [...files].filter(([name, f]) => f.folder === "loras" && !hidden(name)).map(([name]) => [name, entry(name)]);
// the turbo the graph holds (SNAP-R2): the diffusion model when it is a turbo merge, else the first core row that is a turbo
export function turbo() {
  const model = diffusion();
  if (model && entry(model.file).turbo?.how === "merged") return { file: model.file, how: "merged" };
  const r = loras().find((x) => x.on && x.entry?.turbo); // a core row, or the Render Preset's one LoRA (H3: Pika Flex)
  return r ? { file: r.file, how: "lora" } : null;
}

// what "off" puts back: the settings the turbo replaced when this page set it, else (a recipe rebuilt from a card) the
// setup card's: the applied one, or the family's card on the turbo's Base/SFT lineage; a card holding a turbo is no guide
const flat = (c) => c.brick.bricks.flatMap((b) => Object.values(b.values).flatMap((ws) => Object.entries(ws)));
const named = (c) => flat(c).map(([, v]) => v).filter(isFile);
function quality(was) {
  const kept = E.state().bricks.find((b) => b.key === turboHost())?.turbo;
  if (kept?.file === was.file) return kept.quality;
  const plain = (c) => c && !named(c).some((v) => entry(v).turbo);
  const cards = L.setupCards().filter((c) => c.family === family()), model = (c) => named(c).find((v) => DIFFUSION.has(entry(v).kind));
  const now = cards.find((c) => c.id === E.state().setup), card = plain(now) ? now : cards.find((c) => plain(c) && lineage(entry(model(c))) === lineage(entry(was.file)));
  if (!card) throw new Error(`Off doesn't know the settings from before ${short(was.file)}; pick a setup instead`);
  const out = [], at = sampling(), d = diffusion();
  if (was.how === "merged") out.push([[d.brick, d.node, d.setting], model(card)]);
  for (const [k, names] of Object.entries(SAMPLING)) { const v = flat(card).find(([n]) => names.includes(n))?.[1]; if (v != null && at[k]) out.push([[at[k].brick, at[k].node, at[k].name], v]); }
  for (const k of Object.keys(exact(entry(was.file).turbo ?? {}))) { const v = flat(card).find(([n]) => n === k)?.[1], where = hostSetting(k); if (v != null && where) out.push([where, v]); }
  return out;
}

// the Render Preset's quality setup per conditioning: what "Turbo off" puts on when the turbo rides on the preset and no
// setup card says what came before (render.py's "… quality (no turbo)" presets; short03 F-C11)
const QUALITY = { "FL2V (first frame)": "First frame, quality (no turbo)", "Ref2V (reference pictures)": "Reference pictures, quality (no turbo)" };
export function setTurbo(name) {
  const key = turboHost(), stack = coreStack(), one = !stack && single(), was = turbo();
  if (!key || (!stack && !one)) throw new Error("This recipe has no Render brick with a core LoRA stack or a Render Preset LoRA (the image and H3 recipes have one)");
  const plain = (!name || name === "off") && one && was && setups().find((s) => s.source === "preset" && s.name === QUALITY[String(E.getValue(one.brick, one.node, "conditioning"))]);
  if (plain) { apply(plain.name); return { turbo: null, setup: plain.name, sampling: Object.fromEntries(Object.entries(sampling()).map(([k, v]) => [k, v.value])), warnings: warnings().map((w) => w.text) }; }
  const t = name && name !== "off" ? turbos().find((x) => x.file === name || x.name === name || base(x.file) === base(name)) : null;
  if (name && name !== "off" && !t) throw new Error(`No turbo "${name}" for ${family() ?? "this recipe"}; there are: ${turbos().map((x) => x.name).join(", ") || "none installed"}`);
  // the Render Preset's one LoRA is swapped in place, so a swap needs no way back; "off" does (a setup card, else pick a setup)
  const back = was && !(one && t) ? quality(was) : [];
  E.batch(() => {
    if (was) { // back to the quality settings first, so turbos swap instead of stacking
      for (const [where, v] of back) E.setValue(...where, v);
      if (was.how === "lora" && stack) removeRow(stack, rows(stack).find((x) => x.file === was.file).row);
    }
    if (!t) return E.remember(key, "turbo", null);
    const now = sampling(), model = diffusion(), kept = [];
    const set = (where, v) => { kept.push([where, E.getValue(...where)]); E.setValue(...where, v); };
    if (t.how === "merged") set([model.brick, model.node, model.setting], t.file);
    else if (stack) addRow(stack, t.file, t.strength);
    else { set([one.brick, one.node, one.setting], t.file); set([one.brick, one.node, `${one.setting}_strength`], t.strength); }
    for (const k of ["steps", "cfg", "sampler", "scheduler"]) if (t[k] != null && now[k] && (!now[k].choices || now[k].choices.includes(t[k]))) set([now[k].brick, now[k].node, now[k].name], t[k]);
    for (const [k, v] of Object.entries(exact(entry(t.file).turbo))) { const at = hostSetting(k); if (at) set(at, v); } // U90(2): the shifts too, not only the knots
    E.remember(key, "turbo", { file: t.file, how: t.how, quality: kept });
  });
  app.canvas.setDirty(true, true);
  return { turbo: t?.file ?? null, sampling: Object.fromEntries(Object.entries(sampling()).map(([k, v]) => [k, v.value])), warnings: warnings().map((w) => w.text) };
}

// ---- LoRA stacks (SNAP-R12): a brick whose `stack` names a dynamic-group node (core LoadLoraModel: rows of file,
// strength, on); an empty stack is its placeholder row
const stackNode = (brick) => E.nodeFor(brick, BRICKS[brick].stack.node);
const groupOf = (brick) => BRICKS[brick].stack.group;
export function rows(brick) {
  const n = stackNode(brick), g = groupOf(brick), count = n?.widgets.find((w) => w.name === g)?.value ?? 0;
  if (!n || placeholder(n, g)) return [];
  const at = (i, f) => n.widgets.find((w) => w.name === `${g}.${i}.${f}`)?.value;
  return Array.from({ length: count }, (_, i) => ({ row: i, file: at(i, "lora_name"), strength: at(i, "strength"), on: at(i, "enabled"), entry: entry(at(i, "lora_name")) }));
}
export function addRow(brick, file, strength = entry(file)?.recommended?.strength ?? 1) {
  const n = stackNode(brick), g = groupOf(brick), list = rows(brick);
  return E.batch(() => {
    const i = list.length;
    if (i) E.setValue(brick, BRICKS[brick].stack.node, g, i + 1);
    E.setValues(brick, BRICKS[brick].stack.node, { [`${g}.${i}.lora_name`]: file, [`${g}.${i}.strength`]: strength, [`${g}.${i}.enabled`]: true });
    app.canvas.setDirty(true, true);
    return n.widgets.some((w) => w.name === `${g}.${i}.lora_name`) ? i : null;
  });
}
// a LoRA row in the stack its role belongs in (SNAP-R12; the role from the model graph unless given). A dial goes on the
// Dial Rack, and a core LoRA needs a recipe whose Render takes a core stack: H3's LoRA rides on its Render Preset with the
// schedule it was distilled for. A second turbo is refused unless the person asked for the stack (SNAP-R10)
export async function addLora(file, { role, strength, asked } = {}) {
  if (hidden(file)) throw new Error(`${short(file)} is tagged nsfw and SFW only is on (the person's profile)`);
  const find = () => { const names = loraChoices().map(([n]) => n); return names.includes(file) ? file : E.resolveChoice(names, file); };
  let name = find();
  if (!name) { await reload(); name = find(); } // put there after the page loaded
  if (!name) throw new Error(`No LoRA file "${file}" in models/loras, read again just now; list_loras shows them (scan_models reads every folder again)`);
  const e = entry(name);
  let want = role ?? e.role;
  if (want === "dial") throw new Error(`${short(name)} is a dial: put it on the Dial Rack (add_dial)`);
  if (want === "unsorted") throw new Error(`The model graph doesn't say what ${short(name)} is; give its role (core, style or identity)`);
  // a recipe whose core LoRA rides on its Render Preset (H3) has no Core LoRAs stack: another core LoRA (a task LoRA such
  // as ORB360) goes on Style LoRAs, after the preset's, which runs it the same (short03 verified the wiring); add_lora says so
  if (want === "core" && !coreStack() && single()) {
    if (e.turbo) throw new Error(`${short(name)} is a turbo, and this recipe's turbo rides on its Render Preset with its schedule: swap it with set_method {slot: "turbo"}, pick a setup (list_setups, apply_setup) or set preset.lora`);
    want = "style";
  }
  if (e.turbo && turbo() && !asked) throw new Error(`A turbo is already on (${short(turbo().file)}); swap it with set_method {slot: "turbo"}, or pass person_asked: true when the person asked for a turbo stack`);
  const key = { core: "loras", style: "style", identity: "cast" }[want], keys = E.state().bricks.map((b) => b.key);
  if (!keys.includes(key)) await E.snap(key, { at: keys.includes("rack") ? keys.indexOf("rack") : undefined });
  addRow(key, name, strength);
  return key;
}
export function setRow(brick, i, patch) {
  const node = BRICKS[brick].stack.node, g = groupOf(brick);
  E.setValues(brick, node, Object.fromEntries(Object.entries({ lora_name: patch.file, strength: patch.strength, enabled: patch.on }).filter(([, v]) => v !== undefined).map(([f, v]) => [`${g}.${i}.${f}`, v])));
}
export function removeRow(brick, i) {
  const node = BRICKS[brick].stack.node, g = groupOf(brick), list = rows(brick);
  E.batch(() => {
    for (let k = i; k < list.length - 1; k++) setRow(brick, k, list[k + 1]);
    if (list.length > 1) E.setValue(brick, node, g, list.length - 1);
    else setRow(brick, 0, { on: false, strength: 0 });
  });
}

// a brick's `check` (see bricks.js): the server says whether a run would find what the brick's settings point at. One
// request per distinct set of values; the view re-renders when an answer arrives (onCheck)
const checked = new Map();
export const onCheck = (fn) => { notify = fn; };
function checking(brickKey) {
  const def = BRICKS[brickKey]?.check, n = def && E.nodeFor(brickKey, def[0]);
  if (!n) return null;
  const values = Object.fromEntries(n.widgets.filter((w) => w.name && typeof w.value !== "object").map((w) => [w.name, w.value]));
  const key = `${def[1]}|${JSON.stringify(values)}`;
  if (!checked.has(key)) {
    const c = { result: null };
    c.done = api.fetchApi(def[1], { method: "POST", body: JSON.stringify(values) }).then((r) => r.json())
      .catch((err) => ({ ready: false, problems: [err.message] })).then((res) => { c.result = res; notify(); });
    checked.set(key, c);
  }
  return checked.get(key);
}
export const check = (brickKey) => checking(brickKey)?.result ?? null;
export async function checkNow(brickKey) {
  await checking(brickKey)?.done;
  return check(brickKey);
}
