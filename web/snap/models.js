// What a recipe loads, read generically: a combo setting is a model setting when its value or choices are files in one of
// ComfyUI's model folders (core /experiment/models lists them with sizes), so any loader, pack node or any-node brick gets
// model chips without per-node code. Setups are what a brick's node offers through its own `presets` interface
// ({ names(), values(name), current(), apply(name) }, e.g. the Render Preset's); recipe cards of other families join later.
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import * as D from "./dials.js";
import { BRICKS } from "./bricks.js";

let files = new Map(), loading = null;
// name -> { folder, size, modified }, read once per page (every model folder; the first folder wins a name in two), with
// the model graph
export function load() {
  loadGraph();
  loading ??= api.fetchApi("/experiment/models").then((r) => r.json())
    .then((folders) => Promise.all(folders.map(async ({ name }) => [name, await (await api.fetchApi(`/experiment/models/${encodeURIComponent(name)}`)).json()])))
    .then((lists) => {
      files = new Map();
      for (const [folder, list] of lists) for (const f of list) if (!files.has(f.name)) files.set(f.name, { folder, size: f.size, modified: f.modified });
      return files;
    }).then(async (f) => { await loadGraph(); return f; });
  return loading;
}
export const file = (name) => files.get(name);

// The model graph (SNAP-R10, SNAP-R12, SNAP-R13): one entry per file saying how it fits with others (family, kind
// base / sft / finetune / turbo_merge / lora, turbo merged or LoRA with its steps / cfg / sampler, deband, LoRA role,
// trained_on, loads_in_core). The pack's entries (snap_cards/models.json) under the person's own (userdata
// snap/models.json, merged field by field: the person wins); a file neither knows is inferred from its folder and name.
const MINE = "snap/models.json";
const base = (f) => String(f ?? "").replace(/\\/g, "/").split("/").pop();
let relations = new Map(), relating = null;
const mine = () => api.getUserData(MINE).then((r) => (r.ok ? r.json() : []), () => []);
export function loadGraph() {
  relating ??= Promise.all([api.fetchApi("/mainodes/snap/models").then((r) => r.json()).then((r) => r.models, () => []), mine()]).then(([pack, own]) => {
    relations = new Map(pack.map((e) => [base(e.file), e]));
    for (const e of own) relations.set(base(e.file), { ...relations.get(base(e.file)), ...e });
    return relations;
  });
  return relating;
}
const FAMILIES = [[/kromoss|moss/, "MOSS-Image"], [/krea/, "Krea 2"], [/minimax|pika|(^|_)h3(_|$)/, "MiniMax H3"]];
function infer(name) {
  const n = base(name).toLowerCase(), folder = file(name)?.folder ?? null, steps = Number(n.match(/(\d+)[-_ ]?steps?/)?.[1]) || null;
  const kind = { loras: "lora", text_encoders: "encoder", clip: "encoder", vae: "vae" }[folder] ?? (/turbo|dmd|dmad|lightning|hyper/.test(n) ? "turbo_merge" : "base");
  const fast = ["lora", "turbo_merge"].includes(kind) && (/turbo|dmd|dmad|lightning|hyper/.test(n) || !!steps);
  const e = { file: base(name), folder, family: FAMILIES.find(([re]) => re.test(n))?.[1] ?? null, kind, inferred: true,
    turbo: fast ? { how: kind === "lora" ? "lora" : "merged", steps, cfg: null, sampler: null, scheduler: null } : null, deband: /deband|banding/.test(n) ? (kind === "lora" ? "lora" : "merged") : "none" };
  if (kind === "lora") Object.assign(e, String(name).startsWith("dials/") ? { role: "dial" } : fast ? { role: "core", core: "turbo" } : e.deband !== "none" ? { role: "core", core: "fix" } : { role: "unsorted" });
  return e;
}
export const entry = (name) => (name ? relations.get(base(name)) ?? infer(name) : null);
// the person files a file ("what is this?"): kept in their snap/models.json, so the answer is remembered
export async function teach(name, patch) {
  const own = await mine(), at = own.findIndex((e) => base(e.file) === base(name));
  const e = { ...(own[at] ?? { file: base(name) }), ...patch };
  own.splice(at < 0 ? own.length : at, at < 0 ? 0 : 1, e);
  await api.storeUserData(MINE, own);
  const { inferred, ...was } = entry(name);
  relations.set(base(name), { ...was, ...e });
  return entry(name);
}
export const known = () => files.size;
export const gb = (bytes) => `${(bytes / 1e9).toFixed(bytes < 1e9 ? 2 : 1)} GB`;

const choices = (w) => (Array.isArray(w?.options?.values) ? w.options.values : null);
export const isModel = (w) => !!choices(w) && (files.has(w.value) || choices(w).some((v) => files.has(v)));
// a choice the folder lists don't have is a file the server can't read (moved away, broken link): it stays in the combo
// until a restart, but a run would fail on it (SNAP-R3)
export const readable = (name) => !files.size || files.has(name);

// a brick's nodes, its attachment's inner ones included, as [nodeKey, node]
export function nodesOf(brickKey) {
  const b = E.state().bricks.find((x) => x.key === brickKey);
  const keys = [...Object.keys(b?.nodes ?? {}), ...Object.keys(BRICKS[brickKey]?.attach?.inner ?? {})];
  return keys.map((k) => [k, E.nodeFor(brickKey, k)]).filter(([, n]) => n);
}

// every model setting in the recipe: which file, how big, and whether it is installed
export function settings() {
  return E.state().bricks.flatMap((b) => nodesOf(b.key).flatMap(([nodeKey, n]) => (n.widgets ?? []).filter(isModel).map((w) => ({
    brick: b.key, node: nodeKey, setting: w.name, file: w.value, folder: file(w.value)?.folder ?? null, size: file(w.value)?.size ?? null,
    installed: choices(w).includes(w.value) && readable(w.value), ...(choices(w).includes(w.value) && !readable(w.value) ? { unreadable: true } : {}),
  }))));
}
// model settings whose file is in the list but can't be read; the readiness badge counts them with E.missing()
export const unreadable = () => settings().filter((s) => s.unreadable).map((s) => ({ brick: s.brick, node: E.nodeFor(s.brick, s.node)?.title, setting: s.setting, value: s.file, unreadable: true }));
export const total = (list = settings()) => [...new Map(list.filter((s) => s.size).map((s) => [s.file, s.size])).values()].reduce((a, b) => a + b, 0);

// setups the recipe's nodes offer (one entry per preset), each with the model files it would load
export function setups() {
  const fam = D.family();
  return E.state().bricks.flatMap((b) => nodesOf(b.key).filter(([, n]) => n.presets).flatMap(([nodeKey, n]) => {
    const now = n.presets.current();
    return n.presets.names().map((name) => {
      const values = n.presets.values(name);
      const models = Object.entries(values).map(([setting, v]) => [setting, v, n.widgets.find((w) => w.name === setting)]).filter(([, , w]) => isModel(w))
        .map(([setting, v, w]) => ({ setting, file: v, size: file(v)?.size ?? null, installed: choices(w).includes(v) && readable(v) }));
      return { name, family: fam, source: "preset", brick: b.key, node: nodeKey, current: now.name === name, edited: now.name === name && now.edited, models, values };
    });
  }));
}

// apply a setup as one undo step
export function apply(name) {
  const s = setups().find((x) => x.name === name);
  if (!s) throw new Error(`No setup "${name}"; there are: ${setups().map((x) => x.name).join(", ")}`);
  E.batch(() => E.nodeFor(s.brick, s.node).presets.apply(name));
  app.canvas.setDirty(true, true);
  return s;
}

// a brick's `check` (see bricks.js): the server says whether a run would find what the brick's settings point at. One
// request per distinct set of values; the view re-renders when an answer arrives (onCheck)
const checked = new Map();
let notify = () => {};
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
