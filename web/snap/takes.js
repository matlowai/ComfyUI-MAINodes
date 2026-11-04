// Takes (LIBRARY "run" cards, BRAINSTORM dailies): every run from this page becomes a take, read from ComfyUI's own
// history so it holds exactly what ran (the workflow, the executed prompt, the outputs) for any workflow. People rank
// takes, keep or reject them, and pin notes to the moment (and region) where something went wrong or right; kept takes
// are the Library's priors. Everything is local JSON in the user's ComfyUI data folder; tools/snap_dataset.py turns it
// into training rows (takes, notes, preference pairs) for a judge model, only when someone runs it.
// Each take keeps a content hash of what ran (`hash`, seeds left out, and `seed_hash` for them), so stale() can say
// when the chain no longer matches it and name the brick and field that changed (UX_GEMS #1); never re-renders.
// A take an edit made (edits.js: a night version) names its parent take and the method; "Use as input" puts any frame of
// a take on the First frame or References brick, with where it came from (U32), and a run that starts on a take's frame
// that way names that take as its parent too ("continue", U59: a version in the scene's takes tree). `frames` hands an
// agent a take's frames as pictures (U23 agent eyes), `eta` what such a run took, for a GPU tool's plan (U35).
// A take the server's save gate marked private or NSFW (history extra_data.snap_marks) says so, and the export leaves
// both out unless asked; a take run with metadata off says its files hold no recipe. The lock also follows the current
// rules: the server re-checks the saved takes on load (`locked`), as the export does, without saving anything.
// SNAP-R17 person and agent kept apart (notes, judgments, rankings) · SNAP-R18 local only · SNAP-R20 private takes, metadata
// SNAP-R27 locks follow the current rules · see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import { BRICKS } from "./bricks.js";

const DIR = "snap/takes", RANKS = "snap/rankings", JUDGED = "snap/judgments", FPS = 24;

// what people tag a moment with; free text always goes alongside
export const TAGS = {
  wrong: ["identity drift", "face", "hands", "anatomy", "too static", "janky motion", "physics", "flicker", "artifacts", "color", "prompt ignored", "framing", "continuity", "audio sync", "text"],
  right: ["identity", "motion", "physics", "camera", "lighting", "composition", "acting", "prompt", "audio", "continuity", "texture"],
};

let takes = [], loading = null, marks = {};
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) fn(); };

async function readJson(path, missing) {
  const r = await api.getUserData(path);
  if (r.status === 404) return missing;
  if (r.status !== 200) throw new Error(`${path} unreadable (${r.status})`);
  return r.json();
}

export function load() {
  loading ??= (async () => {
    const files = (await api.listUserDataFullInfo(DIR)).filter((f) => f.path.endsWith(".json"));
    takes = (await Promise.all(files.map((f) => readJson(`${DIR}/${f.path}`, null)))).filter(Boolean).sort((a, b) => a.created - b.created);
    changed();
    // a server from before the route answers 404: the saved marks stand alone until its restart
    api.fetchApi("/mainodes/snap/take_marks").then((r) => (r.ok ? r.json() : { takes: {} })).then((r) => { marks = r.takes; changed(); });
    return takes;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

export const all = () => takes;
// private by its saved mark, by the rules now, or as a version of a private take (SNAP-R27): what the lock shows and the
// export leaves out
export const locked = (t) => !!(t.private || marks[t.id]?.private || (t.parent && get(t.parent.take) && locked(get(t.parent.take))));
export const get = (id) => takes.find((t) => t.id === id);
// takes of one workflow rank together; the workflow's own id is saved in its JSON, so renames and tab switches don't split it
export const groupOf = () => app.graph.id ?? "unsaved";
export const inGroup = (group = groupOf()) => takes.filter((t) => t.group === group);

// one write per file at a time, newest wins
const writes = new Map();
function store(path, data) {
  const prev = writes.get(path) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(() => api.storeUserData(path, data));
  writes.set(path, next);
  return next;
}
export async function save(take) {
  take.updated = Date.now();
  if (!takes.includes(take)) takes.push(take);
  changed();
  await store(`${DIR}/${take.id}.json`, take);
}

// what a node wrote: every listed file in its outputs, by kind from the extension; a loader's preview of an input file
// (LoadVideo shows the guide clip an edit read) is not something the run made
const KIND = (f) => (/\.(mp4|webm|mov|mkv)$/i.test(f) ? "video" : /\.(png|jpe?g|webp|gif|avif)$/i.test(f) ? "image" : /\.(wav|flac|mp3|ogg|m4a)$/i.test(f) ? "audio" : null);
function media(outputs) {
  const found = [];
  for (const [node, out] of Object.entries(outputs ?? {})) for (const list of Object.values(out)) {
    if (!Array.isArray(list)) continue;
    for (const f of list) if (f?.filename && KIND(f.filename) && f.type !== "temp" && f.type !== "input") found.push({ kind: KIND(f.filename), filename: f.filename, subfolder: f.subfolder ?? "", type: f.type ?? "output", node });
  }
  return found.sort((a, b) => ["video", "image", "audio"].indexOf(a.kind) - ["video", "image", "audio"].indexOf(b.kind));
}
export const url = (m) => api.apiURL(`/view?filename=${encodeURIComponent(m.filename)}&subfolder=${encodeURIComponent(m.subfolder)}&type=${m.type}`);

// the words and the seed of a run, read from the executed prompt: the longest text input and the first noise seed, else
// the first seed-like number (an upscaler's own seed, RelayVSR's 42, is not the take's)
function summary(prompt) {
  let text = "", seed = null, noise = null;
  for (const n of Object.values(prompt ?? {})) for (const [k, v] of Object.entries(n.inputs ?? {})) {
    if (typeof v === "string" && v.length > text.length && /prompt|text/i.test(k)) text = v;
    if (typeof v !== "number") continue;
    if (noise == null && k === "noise_seed") noise = v;
    if (seed == null && /seed/i.test(k)) seed = v;
  }
  return { text, seed: noise ?? seed };
}

// capture: execution events from this page's own client, then the run's record from /history
const running = new Map(); // prompt_id -> started at
api.addEventListener("execution_start", ({ detail }) => running.set(detail.prompt_id, Date.now()));
api.addEventListener("execution_success", ({ detail }) => capture(detail.prompt_id, "success"));
api.addEventListener("execution_error", ({ detail }) => capture(detail.prompt_id, "error", `${detail.node_type ?? ""}: ${detail.exception_message ?? ""}`.trim(), detail.node_id));
api.addEventListener("execution_interrupted", ({ detail }) => capture(detail.prompt_id, "interrupted"));

// the take a run continued from: its First frame is still the frame Use as input put there (a bypassed First frame
// isn't in the prompt)
function continued(graph, prompt) {
  const b = graph?.extra?.snap?.bricks?.find((x) => x.key === "first_frame"), from = b?.from;
  return from && prompt?.[b.nodes.image]?.inputs?.image === from.file ? { take: from.take, method: "continue", frame: from.frame } : null;
}

async function capture(id, status, error, failedNode) {
  if (!id || !running.has(id)) return; // a run this page didn't start
  const started = running.get(id);
  running.delete(id);
  await load();
  const h = (await (await api.fetchApi(`/history/${id}`)).json())[id];
  if (!h) return;
  const [, , prompt, extra] = h.prompt;
  const graph = extra?.extra_pnginfo?.workflow ?? null;
  const group = graph?.id ?? groupOf(), n = takes.filter((t) => t.group === group).length + 1;
  const { text, seed } = summary(prompt), swapped = extra?.snap_marks?.swapped ?? {}, parent = extra?.snap_parent ?? continued(graph, prompt);
  await save({
    id: `take-${id}`, kind: "run", prompt_id: id, created: started, finished: Date.now(), seconds: Math.round((Date.now() - started) / 100) / 10,
    group, workflow: app.extensionManager.workflow.activeWorkflow?.filename ?? "", number: n,
    status, ...(error ? { error, failed_node: failedNode } : {}), text, seed, media: media(h.outputs),
    ...(extra?.snap_marks?.private ? { private: true } : {}), ...(extra?.snap_marks?.nsfw ? { nsfw: true } : {}),
    ...(extra?.snap_marks?.metadata === false ? { metadata: false } : {}), ...(Object.keys(swapped).length ? { swapped } : {}), ...(parent ? { parent } : {}), ...await hashes(canonical(prompt, swapped)),
    verdict: null, prior: false, notes: [], graph, prompt,
  });
}

// what a prompt does, in a form that compares: per node its type (a save gate twin counts as the saver it stands in
// for) and its inputs, links included; seeds go apart, so a new seed is not a change; titles only name things. The page
// sends a list value as {"__value__": [...]} and the server keeps it plain (BranchNode's branch_names), so it is unwrapped
const SEED = /seed/i;
export function canonical(prompt, swapped = {}) {
  const recipe = {}, seeds = {}, titles = {};
  for (const id of Object.keys(prompt ?? {}).sort()) {
    const n = prompt[id], inputs = {};
    for (const k of Object.keys(n.inputs ?? {}).sort()) {
      const v = n.inputs[k]?.__value__ ?? n.inputs[k];
      if (SEED.test(k) && typeof v === "number") seeds[`${id}.${k}`] = v;
      else inputs[k] = v;
    }
    recipe[id] = { type: swapped[id] ?? n.class_type, inputs };
    titles[id] = n._meta?.title ?? n.class_type;
  }
  return { recipe, seeds, titles };
}
const sha = async (x) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(x))))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const hashes = async (c) => ({ hash: await sha(c.recipe), seed_hash: await sha(c.seeds) });
// the live chain as Run would queue it
export const live = async () => canonical((await app.graphToPrompt()).output);
// the agent tools' revision: the live recipe and its seeds, so any edit (a seed too) moves it
export const revisionOf = async (c) => { const h = await hashes(c); return `${h.hash.slice(0, 12)}.${h.seed_hash.slice(0, 4)}`; };

// a node as the person knows it: its brick's title (the outer node of a blueprint's inner one), else its own title
const label = (id, titles) => { const outer = String(id).split(":")[0], b = E.state().bricks.find((x) => Object.values(x.nodes).some((n) => String(n) === outer));
  return b ? BRICKS[b.key]?.title ?? b.key : titles[id] ?? `node ${id}`; };
// what differs between two canonical prompts, as "Render.steps", "Save.images rewired", "Upscale added": only nodes of the
// recipe count when the workflow has nodes outside it (Run leaves those out), and a node is "added" only when a brick owns it
export function changes(was, now) {
  const scope = E.targets() && new Set(E.targets().map(String)), out = [];
  const owned = (id) => E.state().bricks.some((b) => Object.values(b.nodes).some((n) => String(n) === String(id).split(":")[0]));
  for (const id of new Set([...Object.keys(was.recipe), ...Object.keys(now.recipe)])) {
    if (scope && !scope.has(id)) continue;
    const a = was.recipe[id], b = now.recipe[id], name = label(id, { ...was.titles, ...now.titles });
    if (!b) out.push(`${name} removed`);
    else if (!a) { if (owned(id)) out.push(`${name} added`); }
    else if (a.type !== b.type) out.push(`${name} swapped`);
    else for (const k of new Set([...Object.keys(a.inputs), ...Object.keys(b.inputs)])) {
      if (JSON.stringify(a.inputs[k]) !== JSON.stringify(b.inputs[k])) out.push(`${name}.${k}${Array.isArray(a.inputs[k]) || Array.isArray(b.inputs[k]) ? " rewired" : ""}`);
    }
  }
  return [...new Set(out)];
}
// null when the live chain still makes this take (seeds aside), else what changed; takes from before hashes were kept
// are hashed from their prompt. An edit's take was never made by the chain, so it is never stale (a continued one was)
export async function stale(take, now) {
  if (!take.prompt || (take.parent && take.parent.method !== "continue")) return null;
  now ??= await live();
  if ((take.hash ?? (await hashes(canonical(take.prompt, take.swapped))).hash) === (await hashes(now)).hash) return null;
  const list = changes(canonical(take.prompt, take.swapped), now);
  return list.length ? { changed: list } : null;
}

// ranking: one ordered list of take ids per group and author (SNAP-R17: the person's order drives the strip; an agent's
// is kept in its own file, so a judge model never learns an agent's ranking as the person's)
const slug = (g) => g.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 120);
const ranks = new Map();
const rankFile = (group, by) => `${RANKS}/${slug(group)}${by === "agent" ? ".agent" : ""}.json`;
export async function ranking(group = groupOf(), by = "person") {
  const key = `${by}|${group}`;
  if (!ranks.has(key)) ranks.set(key, (await readJson(rankFile(group, by), { order: [] })).order);
  return ranks.get(key);
}
export async function rank(id, index, group = groupOf(), by = "person") {
  const order = (await ranking(group, by)).filter((x) => x !== id);
  if (index != null) order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
  await setRanking(order, group, by);
}
export async function setRanking(order, group = groupOf(), by = "person") {
  ranks.set(`${by}|${group}`, order);
  changed();
  await store(rankFile(group, by), { group, order, by, updated: Date.now() });
}

// a blind A/B an agent sets up for the person to judge (only a person judges it); judging it takes it off the list
const PENDING = "snap/ab_pending.json";
export const pending = () => readJson(PENDING, []);
export async function setupAB(a, b, by = "agent") {
  const list = (await pending()).filter((p) => !(p.a === a && p.b === b));
  list.push({ a, b, by, at: new Date().toISOString() });
  await store(PENDING, list);
  changed();
  return list.length;
}
export async function settleAB(a, b) {
  await store(PENDING, (await pending()).filter((p) => !((p.a === a && p.b === b) || (p.a === b && p.b === a))));
  changed();
}

// a preference between two takes (blind or not), with the reason: the pairwise rows a judge model learns from
export async function judge(a, b, winner, { blind, why, by = "person" }) {
  const file = `${JUDGED}/${new Date().toISOString().slice(0, 10)}.json`;
  const rows = await readJson(file, []);
  rows.push({ at: new Date().toISOString(), a, b, winner, blind: !!blind, why: why ?? "", by });
  await store(file, rows);
}

export async function note(take, { t, region, sentiment, tags, text, by = "person" }) {
  take.notes.push({ id: `n${Date.now().toString(36)}`, t, ...(region ? { region } : {}), sentiment, tags, text, by, at: new Date().toISOString() });
  await save(take);
}

// put a take's settings back: every top-level node of the same id and type gets its saved widget values (one undo step)
export function restore(take) {
  if (!take.graph) throw new Error("This take has no workflow saved with it");
  let changedNodes = 0;
  app.canvas.emitBeforeChange();
  try {
    for (const saved of take.graph.nodes) {
      const n = app.graph.getNodeById(saved.id);
      if (!n || n.type !== saved.type || !Array.isArray(saved.widgets_values)) continue;
      n.widgets?.forEach((w, i) => { // widgets_values keeps each widget's index; widgets that don't serialize are holes
        if (w.serialize === false || saved.widgets_values[i] === undefined || w.value === saved.widgets_values[i]) return;
        w.value = saved.widgets_values[i]; w.callback?.(w.value); changedNodes++;
      });
    }
  } finally { app.canvas.emitAfterChange(); }
  app.canvas.setDirty(true, true);
  return changedNodes;
}

export const openAsTab = (take) => app.loadGraphData(structuredClone(take.graph), true, true, `${take.workflow || "take"} #${take.number}`);

// what changed between two takes' executed prompts: [{node, input, from, to}]
export function delta(a, b) {
  const out = [];
  for (const [id, n] of Object.entries(b?.prompt ?? {})) {
    const was = a?.prompt?.[id];
    if (!was) continue;
    for (const [k, v] of Object.entries(n.inputs ?? {})) {
      if (Array.isArray(v) || JSON.stringify(v) === JSON.stringify(was.inputs?.[k])) continue;
      out.push({ node: n._meta?.title ?? n.class_type, input: k, from: was.inputs?.[k], to: v });
    }
  }
  return out;
}

// what a run like this took, from measured takes (U35 plan-then-approve): the median seconds of successful takes that
// ran this same recipe (seeds aside), else of this workflow's; null when nothing was measured yet
export function eta(hash, group = groupOf()) {
  const ok = takes.filter((t) => t.status === "success" && t.seconds > 0);
  return measured(ok.filter((t) => t.hash === hash), "of this same recipe") ?? measured(ok.filter((t) => t.group === group), "of this workflow") ?? { eta_s: null, from: "no measured takes yet" };
}
// the median seconds of these takes, or null for none
export function measured(list, what) {
  if (!list.length) return null;
  const s = list.map((t) => t.seconds).sort((a, b) => a - b);
  return { eta_s: s[Math.floor(s.length / 2)], from: `median of ${list.length} take${list.length === 1 ? "" : "s"} ${what}` };
}

// a take's frames as JPEG pictures for an agent to look at (U23 agent eyes): the frames asked for, or `count` of them
// spread over the take (its first and last included), at most `maxWidth` wide; the screenshot tool's image shape
export async function frames(take, { frames: want, count = 4, maxWidth = 768 } = {}) {
  const m = take.media.find((x) => x.kind === "video") ?? take.media.find((x) => x.kind === "image");
  if (!m) throw new Error("This take has no picture or video");
  const grab = (src, w, h) => { const k = Math.min(1, maxWidth / w), c = Object.assign(document.createElement("canvas"), { width: Math.round(w * k), height: Math.round(h * k) });
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height); return { mimeType: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1], width: c.width, height: c.height }; };
  if (m.kind === "image") { const img = new Image(); img.src = url(m); await img.decode(); return [{ frame: 0, t: 0, ...grab(img, img.naturalWidth, img.naturalHeight) }]; }
  const v = Object.assign(document.createElement("video"), { src: url(m), muted: true, preload: "auto" });
  await new Promise((done, fail) => { v.onloadedmetadata = done; v.onerror = () => fail(new Error("couldn't read the take's video")); });
  const last = Math.max(0, Math.floor(v.duration * FPS) - 1);
  const list = want?.length ? want.map((f) => Math.max(0, Math.min(last, Math.round(f)))) : Array.from({ length: Math.max(1, count) }, (_, i) => Math.round((last * i) / Math.max(1, count - 1)));
  const out = [];
  for (const frame of list) {
    await new Promise((done) => { v.onseeked = done; v.currentTime = Math.min(v.duration - 0.01, (frame + 0.5) / FPS); });
    out.push({ frame, t: +(frame / FPS).toFixed(3), ...grab(v, v.videoWidth, v.videoHeight) });
  }
  return out;
}

// a frame of a take as a picture in ComfyUI's input folder: `t` in seconds, "last" for its end ("continue from end of shot")
export async function frameAt(take, t = "last") {
  const m = take.media.find((x) => x.kind === "video") ?? take.media.find((x) => x.kind === "image");
  if (!m) throw new Error("This take has no picture or video");
  let at = 0;
  const blob = m.kind === "image" ? await (await fetch(url(m))).blob() : await new Promise((resolve, reject) => {
    const v = Object.assign(document.createElement("video"), { src: url(m), muted: true, preload: "auto" });
    v.onloadedmetadata = () => { at = t === "last" ? Math.max(0, v.duration - 0.05) : Math.min(Math.max(0, t), v.duration - 0.05); v.currentTime = at; };
    v.onseeked = () => { const c = Object.assign(document.createElement("canvas"), { width: v.videoWidth, height: v.videoHeight }); c.getContext("2d").drawImage(v, 0, 0); c.toBlob(resolve, "image/png"); };
    v.onerror = () => reject(new Error("couldn't read the video's frame"));
  });
  const frame = Math.round(at * FPS), form = new FormData();
  form.append("image", blob, `${take.id}_f${frame}.png`);
  form.append("subfolder", "snap");
  form.append("overwrite", "true");
  const r = await (await api.fetchApi("/upload/image", { method: "POST", body: form })).json();
  return { file: `${r.subfolder}/${r.name}`, frame };
}

// "Use as input" (U32): a take's frame becomes the First frame (FL2V's start) or a reference picture, through the bricks'
// own loaders, as one undo step; the brick remembers the take and frame it came from
export async function use(take, { as = "first_frame", t = "last", by = "person" } = {}) {
  if (!["first_frame", "reference"].includes(as)) throw new Error(`Use a take as first_frame or reference, not ${as}`);
  const key = as === "first_frame" ? "first_frame" : "refs";
  if (!E.state().bricks.some((b) => b.key === key)) throw new Error(`Add the ${BRICKS[key].title} brick to use a take ${as === "first_frame" ? "as its first frame" : "as a reference"}`);
  const { file, frame } = await frameAt(take, t), from = { take: take.id, number: take.number, frame, file, by };
  app.canvas.emitBeforeChange();
  try {
    if (as === "reference") E.addPicture(file, { role: `take ${take.number}, frame ${frame}`, reason: `frame ${frame} of take ${take.number} (${take.id})`, source: take.id });
    else {
      const w = E.nodeFor("first_frame", "image").widgets.find((x) => x.name === "image");
      if (!w.options.values.includes(file)) w.options.values.push(file); // uploaded after the page loaded
      E.setValue("first_frame", "image", "image", file);
      E.remember("first_frame", "from", from);
    }
  } finally { app.canvas.emitAfterChange(); }
  return { as, file, ...from, said: `Frame ${frame} of take ${take.number} is now ${as === "first_frame" ? "the First frame" : "a reference picture"}` };
}
