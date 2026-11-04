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
// name -> { folder, size, modified }, read once per page (every model folder; the first folder wins a name in two)
export function load() {
  loading ??= api.fetchApi("/experiment/models").then((r) => r.json())
    .then((folders) => Promise.all(folders.map(async ({ name }) => [name, await (await api.fetchApi(`/experiment/models/${encodeURIComponent(name)}`)).json()])))
    .then((lists) => {
      files = new Map();
      for (const [folder, list] of lists) for (const f of list) if (!files.has(f.name)) files.set(f.name, { folder, size: f.size, modified: f.modified });
      return files;
    });
  return loading;
}
export const file = (name) => files.get(name);
export const known = () => files.size;
export const gb = (bytes) => `${(bytes / 1e9).toFixed(bytes < 1e9 ? 2 : 1)} GB`;

const choices = (w) => (Array.isArray(w?.options?.values) ? w.options.values : null);
export const isModel = (w) => !!choices(w) && (files.has(w.value) || choices(w).some((v) => files.has(v)));

// a brick's nodes, its attachment's inner ones included, as [nodeKey, node]
export function nodesOf(brickKey) {
  const b = E.state().bricks.find((x) => x.key === brickKey);
  const keys = [...Object.keys(b?.nodes ?? {}), ...Object.keys(BRICKS[brickKey]?.attach?.inner ?? {})];
  return keys.map((k) => [k, E.nodeFor(brickKey, k)]).filter(([, n]) => n);
}

// every model setting in the recipe: which file, how big, and whether it is installed
export function settings() {
  return E.state().bricks.flatMap((b) => nodesOf(b.key).flatMap(([nodeKey, n]) => (n.widgets ?? []).filter(isModel).map((w) => ({
    brick: b.key, node: nodeKey, setting: w.name, file: w.value, folder: file(w.value)?.folder ?? null, size: file(w.value)?.size ?? null, installed: choices(w).includes(w.value),
  }))));
}
export const total = (list = settings()) => [...new Map(list.filter((s) => s.size).map((s) => [s.file, s.size])).values()].reduce((a, b) => a + b, 0);

// setups the recipe's nodes offer (one entry per preset), each with the model files it would load
export function setups() {
  const fam = D.family();
  return E.state().bricks.flatMap((b) => nodesOf(b.key).filter(([, n]) => n.presets).flatMap(([nodeKey, n]) => {
    const now = n.presets.current();
    return n.presets.names().map((name) => {
      const values = n.presets.values(name);
      const models = Object.entries(values).map(([setting, v]) => [setting, v, n.widgets.find((w) => w.name === setting)]).filter(([, , w]) => isModel(w))
        .map(([setting, v, w]) => ({ setting, file: v, size: file(v)?.size ?? null, installed: choices(w).includes(v) }));
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
function entry(brickKey) {
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
export const check = (brickKey) => entry(brickKey)?.result ?? null;
export async function checkNow(brickKey) {
  await entry(brickKey)?.done;
  return check(brickKey);
}
