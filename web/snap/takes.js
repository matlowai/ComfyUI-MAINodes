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
// A video take keeps its sound's loudness (`sound`, read once at capture); below QUIET_DB it carries a "sound is quiet" note
// with two actions the person picks from (SNAP-R36): nothing is applied by itself.
// A take is rated as what made it (SNAP-R39): the rating the server gave its prompt (its text and the files it loads), raised
// to the rating of any take it came from (a version, an edit, a run from a take's frame); the person's own rating wins.
// SNAP-R27 locks follow the current rules · SNAP-R36 quiet sound is a note · SNAP-R39 ratings from how a thing was made ·
// A private take on an install with privacy on is kept encrypted (U79): the server reads its record to the page as is,
// or as a stub (kept_encrypted, locked; no prompt, graph or notes) while the vault is locked; reopen() reads them again after an unlock.
// SNAP-R96 kept encrypted · SNAP-R54 takes above the account's cap are left out · SNAP-R60 a take keeps the world pins it ran with (`world`) and its
// stale flag names the records that moved on · SNAP-R173 one-key verdicts, the option cemetery, retractions kept · SNAP-R174 blind pairs held on the server · SNAP-R65 a paint or check (takes: false) is no take; catchUp writes the takes of runs that finished during a reload · see docs/snap/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import { BRICKS } from "./bricks.js";
import * as ACC from "./account.js";
import * as W from "./world.js";

// U78: an ambience-only H3 soundscape renders about -57 dB mean, one naming the action's sounds -27..-41 dB
export const QUIET_DB = -45;
export const quiet = (t) => t.sound?.mean_db != null && t.sound.mean_db < QUIET_DB;
const LOCKED = "This take is kept encrypted and the vault is locked: the person signs in (or unlocks it from the take's lock) first";
const DIR = "snap/takes", RANKS = "snap/rankings", JUDGED = "snap/judgments", FPS = 24;

// what people tag a moment with; free text always goes alongside
export const TAGS = {
  wrong: ["identity drift", "face", "hands", "anatomy", "too static", "janky motion", "physics", "flicker", "artifacts", "color", "prompt ignored", "framing", "continuity", "audio sync", "text", "set logic", "unheld"], // SNAP-R103: the critic's two biggest classes
  right: ["identity", "motion", "physics", "camera", "lighting", "composition", "acting", "prompt", "audio", "continuity", "texture"],
};

let takes = [], loading = null, marks = {}, privacy = false, marked = null;
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) fn(); };
// a run that failed, once its take is written (upscale.js keeps the render of a run whose upscale failed, F-C26); one that
// ran, once its take is written by the page that captured it (voices.js checks a take that cites a Cast voice, G1b)
const failures = new Set(), arrivals = new Set();
export const onFailed = (fn) => failures.add(fn);
export const onLanded = (fn) => arrivals.add(fn);

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
    remark();
    return takes;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

// a server from before the route answers 404: the saved marks stand alone until its restart; a read that fails (a restart)
// keeps the last answer and is asked again when the socket comes back (U76 L4)
function remark() {
  marked = api.fetchApi("/mainodes/snap/take_marks").then((r) => (r.ok ? r.json() : { takes: {} })).then((r) => { marks = r.takes; privacy = r.privacy === true; changed(); }, () => {});
}
api.addEventListener("reconnected", () => { if (loading) remark(); });

export const all = () => takes;
// read the folder again: a take another tab or page wrote joins the list, one it changed since is updated in place (the
// objects open views hold stay the same)
export async function reload() {
  await load();
  const files = (await api.listUserDataFullInfo(DIR)).filter((f) => f.path.endsWith(".json"));
  let moved = false;
  for (const f of files) {
    const mine = get(f.path.replace(/\.json$/, ""));
    if (mine && f.modified <= (mine.updated ?? 0)) continue;
    const read = await readJson(`${DIR}/${f.path}`, null);
    if (!read || (mine && (read.updated ?? 0) <= (mine.updated ?? 0))) continue;
    if (mine) Object.assign(mine, read); else takes.push(read);
    moved = true;
  }
  if (moved) { takes.sort((a, b) => a.created - b.created); changed(); }
}
// the takes read as locked stubs, read again (after the vault is unlocked, or locked)
export async function reopen() {
  for (const t of takes.filter((x) => x.kept_encrypted)) {
    const read = await readJson(`${DIR}/${t.id}.json`, null);
    if (!read) continue;
    for (const k of Object.keys(t)) if (!(k in read)) delete t[k];
    Object.assign(t, read);
  }
  changed();
}
// private by its saved mark, by the rules now, or as a version of a private take (SNAP-R27): what the lock shows and the
// export leaves out
// SNAP-R37: no lock at all on an install with privacy off, whatever a take recorded when it ran
export const privacyOn = async () => { await load(); await marked; return privacy; };
// ... or one made from a private take's frame (a reference picture, U76 M2); `seen` stops a hand-edited loop
export const locked = (t, seen = new Set()) => privacy && !seen.has(t.id) && (seen.add(t.id), !!(t.private || marks[t.id]?.private || [t.parent?.take, ...(t.made_from ?? [])].some((id) => get(id) && locked(get(id), seen))));
export const get = (id) => takes.find((t) => t.id === id);
// a take as an agent names it (F-E12): its whole id, or a unique start of it with or without "take-" (the 8 characters
// notes quote); an ambiguous start names every match. Internal reads use get(), which never guesses
export function find(ref) {
  const r = String(ref ?? "").trim(), whole = get(r) ?? get(`take-${r}`);
  if (whole || r.length < 4) return whole ?? null;
  const hits = takes.filter((t) => t.id.startsWith(r) || t.id.startsWith(`take-${r}`));
  if (hits.length > 1) throw new Error(`"${r}" starts ${hits.length} takes: ${hits.map((t) => `${t.id} (take ${t.number})`).join(", ")}; give more of the id`);
  return hits[0] ?? null;
}
export const RATINGS = ["pg", "mature", "adult"], RATING_SHOWN = { pg: "PG", mature: "Mature", adult: "Adult" };
export const ratingOf = (t) => t.rating_set ?? t.rating ?? null;
// SNAP-R54: on a signed-in install a take rated above the account's cap is left out of list_takes, get_take and Dailies
// (snap-gate refuses its files too, its SNAP-R56); no gate, no cap
export const aboveCap = (t) => { const cap = ACC.account()?.max_rating; return !!cap && RATINGS.indexOf(ratingOf(t)) > RATINGS.indexOf(cap); };
// what a version is called on its card and in the scene: an example's name, the change in short, or "X → Y"
export const versionOf = (o = {}) => o.label ?? o.time ?? null;
export async function setRating(take, rating) {
  if (!RATINGS.includes(rating)) throw new Error(`A rating is one of ${RATINGS.join(", ")}`);
  take.rating_set = rating;
  await save(take);
}
// the takes a run came from: the one it versions or continues, every take a picture of its bricks was taken from, and a
// new view's context pictures (U101)
const sources = (graph, parent) => [...new Set([parent?.take, ...(parent?.options?.context ?? []).map((p) => p.take), ...(JSON.stringify(graph?.extra?.snap ?? {}).match(/"(?:source|take)":"take-[^"]+"/g) ?? []).map((x) => x.split('":"')[1].slice(0, -1))])].map(get).filter(Boolean);
function rated(marks, graph, parent) {
  if (!marks?.rating) return {}; // a server from before SNAP-R39 rates nothing
  let rating = marks.rating;
  const why = [...(marks.rating_why ?? [])];
  for (const [ref, p] of Object.entries(graph?.extra?.snap?.world ?? {})) { // a pinned record rated by the person (a Cast swapped in by a re-run) raises it too
    const b = p.n ? W.get(W.refOf(W.parse(ref).kind, W.parse(ref).id, p.n))?.version.body : null;
    if (!b?.rating) continue;
    if (RATINGS.indexOf(b.rating) > RATINGS.indexOf(rating)) rating = b.rating;
    if (b.rating !== "pg") why.push(`${p.name ?? ref} is rated ${RATING_SHOWN[b.rating]}`);
  }
  for (const from of sources(graph, parent)) {
    const r = ratingOf(from);
    if (RATINGS.indexOf(r) > RATINGS.indexOf(rating)) rating = r;
    if (r && r !== "pg") why.push(`made from take ${from.number}, rated ${RATING_SHOWN[r]}`);
  }
  return { rating, rating_why: why };
}
// the takes a picture of its bricks came from, beside the parent (U76 M2: the lock and the export follow them)
const madeFrom = (graph, parent) => { const ids = sources(graph, parent).map((t) => t.id).filter((id) => id !== parent?.take); return ids.length ? { made_from: ids } : {}; };
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
export function media(outputs) {
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

// the prompts this page queued (Run, an agent's run, a preview), newest last: run_status follows them by id (U72 F6)
const queued = [];
export const runs = () => queued;
export function queuedRun(id) {
  if (id) queued.push({ id, at: Date.now() });
}
// where ComfyUI saves, as a path on the server's machine (an agent with a shell reads the files there)
let outputDir = null;
const outputs = () => (outputDir ??= api.fetchApi("/mainodes/snap/kits").then((r) => r.json()).then((k) => k.folders.output, () => null));
// one run: queued | running | done | failed (unknown: not on this server), with its take and files once done. A run that
// finished but whose take isn't saved yet still counts as running, so a wait ends with the take
export async function runState(id) {
  const q = await (await api.fetchApi("/queue")).json();
  if (q.queue_running?.some((x) => x[1] === id)) return { run: id, state: "running" };
  const ahead = (q.queue_pending ?? []).map((x) => x[1]).indexOf(id);
  if (ahead >= 0) return { run: id, state: "queued", ahead: q.queue_running.length + ahead };
  const h = (await (await api.fetchApi(`/history/${id}`)).json())[id];
  if (!h) return { run: id, state: "unknown" };
  if (h.status?.status_str !== "success") {
    const err = h.status?.messages?.find((m) => m[0] === "execution_error")?.[1];
    return { run: id, state: "failed", error: err ? `${err.node_type}: ${err.exception_message}`.trim() : h.status?.status_str ?? "interrupted" };
  }
  await load();
  if (running.has(id) || saving.has(id)) return { run: id, state: "running", saving: "the take" };
  const dir = await outputs(), files = media(h.outputs).filter((m) => m.type === "output");
  const kept = h.prompt?.[3]?.snap_marks?.kept; // SNAP-R38: metadata was off, and these nodes wrote it anyway
  // F-F24: whether it rendered or came back from ComfyUI's cache, from the history's own record of cached nodes
  const cached = h.status?.messages?.find((m) => m[0] === "execution_cached")?.[1]?.nodes?.length ?? 0, nodes = Object.keys(h.prompt?.[2] ?? {}).length;
  return { run: id, state: "done", take: get(`take-${id}`)?.id ?? null, ...(kept ? { metadata_kept: kept } : {}), ...(nodes ? { cache: cached >= nodes ? "served from ComfyUI's cache: nothing rendered" : `rendered (${nodes - cached} of ${nodes} nodes ran)` } : {}),
    outputs: files.map((m) => ({ kind: m.kind, ...(dir ? { path: [dir, m.subfolder, m.filename].filter(Boolean).join("/") } : {}), url: new URL(url(m), location.href).href })) };
}

// U72 F25: a pin claims only what reached the render: a sentence missing from every text the queued prompt holds, or
// pictures the apply found no reading for, are listed under placed.missing (the card says so)
// F-L05 (SNAP-R171): a sound-only version (a louder copy) is its parent's picture: it carries the parent's world and story
// pins, so dependents, story_stale and the reversal cost see the Cut's take whichever version is active
function pinsOfParent(parent) {
  const p = parent?.method === "louder" ? get(parent.take) : null;
  return p ? { ...(p.world ? { world: p.world } : {}), ...(p.story ? { story: p.story } : {}) } : {};
}
function placedCheck(world, prompt) {
  const texts = Object.values(prompt ?? {}).flatMap((n) => Object.values(n.inputs ?? {})).filter((v) => typeof v === "string");
  const loads = Object.values(prompt ?? {}).some((n) => n.class_type === "LoadImage"); // a prompt with references: another Cast's line ran without its own
  return Object.fromEntries(Object.entries(world).map(([ref, p]) => {
    // F-C31: its line ran but its pictures didn't (a Cast left in the prompt after its pictures went)
    const files = ref.startsWith("cast:") ? (W.get(`${ref}@${p.n}`)?.version.body.refs ?? []).map((r) => r.file) : [];
    const pictureless = p.placed?.text && files.length && loads && texts.some((t) => t.includes(p.placed.text)) && !files.some((f) => texts.includes(f));
    const missing = [...(p.placed?.text && !texts.some((t) => t.includes(p.placed.text)) ? ["its details line isn't in the prompt that ran"] : []), ...(p.placed?.unread ? [`its pictures weren't read: ${p.placed.unread}`] : []),
      ...(pictureless ? ["its line is in the prompt but its pictures weren't in References"] : [])];
    return [ref, missing.length ? { ...p, placed: { ...p.placed, missing } } : p];
  }));
}
// the take a run continued from: its First frame is still the frame Use as input put there (a bypassed First frame
// isn't in the prompt)
function continued(graph, prompt) {
  const b = graph?.extra?.snap?.bricks?.find((x) => x.key === "first_frame"), from = b?.from;
  return from && prompt?.[b.nodes.image]?.inputs?.image === from.file ? { take: from.take, method: "continue", frame: from.frame } : null;
}
// a re-take (retake.js marks the queued workflow): a version of the take it re-made, "as it was" or "with today's world";
// a re-run (rerun.js, SNAP-R63): a version made with swaps, each swap's text kept for its label
const retaken = (graph) => { const r = graph?.extra?.snap?.retake, x = graph?.extra?.snap?.rerun;
  if (x?.take) return { take: x.take, method: `rerun/${x.route}`, options: { swaps: x.swaps, seed: x.seed, ...(x.land != null ? { land: x.land } : {}) } };
  return r?.take ? { take: r.take, method: "retake", options: { world: r.world, seed: r.seed } } : null; };

const saving = new Set(); // runs whose take is being written
// this page's runs that finished while it was reloading (the Work card's rows from the server, SNAP-R65): their events
// went to the page before the reload, so their takes are written now, once
export async function catchUp(rows) {
  await load();
  for (const r of rows) {
    if (get(`take-${r.id}`) || running.has(r.id) || saving.has(r.id)) continue;
    saving.add(r.id);
    const status = r.state === "error" ? "error" : r.state === "interrupted" ? "interrupted" : "success";
    try { await captureRun(r.id, r.started ?? Date.now(), status, r.error ? `${r.error.node_type ?? ""}: ${r.error.exception_message ?? ""}`.trim() : undefined, r.error?.node_id); } finally { saving.delete(r.id); }
  }
}
async function capture(id, status, error, failedNode) {
  if (!id || !running.has(id)) return; // a run this page didn't start
  const started = running.get(id);
  running.delete(id);
  saving.add(id);
  try { await captureRun(id, started, status, error, failedNode); } finally { saving.delete(id); }
}
async function captureRun(id, started, status, error, failedNode) {
  await Promise.all([load(), W.load()]);
  const h = (await (await api.fetchApi(`/history/${id}`)).json())[id];
  if (!h) return;
  const [, , prompt, extra] = h.prompt;
  if (extra?.snap_job?.takes === false) return; // a paint or a check (SNAP-R65): its result is a note or a candidate, not a take
  const graph = extra?.extra_pnginfo?.workflow ?? null;
  const group = graph?.id ?? groupOf(), n = takes.filter((t) => t.group === group).length + 1;
  const { text, seed } = summary(prompt), swapped = extra?.snap_marks?.swapped ?? {}, parent = extra?.snap_parent ?? retaken(graph) ?? continued(graph, prompt);
  const files = media(h.outputs), video = files.find((m) => m.kind === "video");
  // an identical recipe (seed included) is served from core's cache: the same files as an earlier take, not a new render
  const twin = files.length ? takes.find((t) => t.status === "success" && t.media.length === files.length && t.media.every((m, i) => m.filename === files[i].filename && m.subfolder === files[i].subfolder && m.type === files[i].type)) : null;
  const read = video && await api.fetchApi(`/mainodes/snap/loudness?filename=${encodeURIComponent(video.filename)}&subfolder=${encodeURIComponent(video.subfolder)}&type=${video.type}`);
  const sound = read?.ok ? await read.json() : null; // no ffmpeg here: no note, the take is saved all the same
  await save({
    id: `take-${id}`, kind: "run", prompt_id: id, created: started, finished: Date.now(), seconds: Math.round((Date.now() - started) / 100) / 10,
    group, workflow: app.extensionManager.workflow.activeWorkflow?.filename ?? "", number: n,
    status, ...(error ? { error, failed_node: failedNode } : {}), text, seed, media: files, ...(sound?.sound ? { sound: { mean_db: sound.mean_db, max_db: sound.max_db } } : {}),
    ...(extra?.snap_marks?.private ? { private: true } : {}), ...(extra?.snap_marks?.nsfw ? { nsfw: true } : {}), ...(extra?.snap_marks?.encrypted ? { kept_encrypted: true } : {}),
    ...rated(extra?.snap_marks, graph, parent), ...madeFrom(graph, parent),
    ...(extra?.snap_marks?.metadata === false ? { metadata: false } : {}), ...(extra?.snap_marks?.kept ? { metadata_kept: extra.snap_marks.kept } : {}), ...(Object.keys(swapped).length ? { swapped } : {}), ...(parent ? { parent } : {}), ...await hashes(canonical(prompt, swapped)), recipe_digest: `sha256:${await W.sha(prompt)}`,
    ...(graph?.extra?.snap?.world ? { world: placedCheck(graph.extra.snap.world, prompt) } : {}), ...(graph?.extra?.snap?.story ? { story: graph.extra.snap.story } : {}), ...pinsOfParent(parent), ...(twin ? { cached_from: twin.id } : {}), verdict: null, prior: false, notes: [], graph, prompt,
  });
  for (const fn of status === "error" ? failures : status === "success" ? arrivals : []) fn(get(`take-${id}`));
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
// SNAP-R212: the sha-256 of the prompt a take ran (canonical JSON, seeds in): "the same recipe" is one compare, and Astrid's
// join key. A take from before it was stored gets it from its kept prompt; a locked stub has none
export const digestOf = async (t) => t.recipe_digest ?? (t.prompt ? `sha256:${await W.sha(t.prompt)}` : null);
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
// the records a take (or a recipe) pins that moved on since (SNAP-R60): [{ref, name, was, now}] for a newer version,
// with archived: true or missing: true when the record was archived or isn't here; a pack card (version 0) never moves
export function moves(world) {
  const out = [];
  for (const [ref, p] of Object.entries(world ?? {})) {
    if (!p.n) { // a pack card: moved when the pack changed it, missing when the pack dropped it
      const now = W.packKnown() && W.packCard(ref);
      if (W.packKnown() && !now) out.push({ ref, name: p.name ?? ref, was: 0, now: null, missing: true, pack: true });
      else if (now && now.hash !== p.hash) out.push({ ref, name: now.name, was: 0, now: 0, pack: true });
      continue;
    }
    const { kind, id } = W.parse(ref), r = W.record(kind, id);
    if (!r) { out.push({ ref, name: p.name ?? id, was: p.n, now: null, missing: true }); continue; }
    const name = r.kind === "cast" ? W.headOf(r).body.name : p.name ?? id;
    if (r.head !== p.n || r.archived) out.push({ ref, name, was: p.n, now: r.head, ...(r.archived ? { archived: true } : {}) });
  }
  return out;
}
// how a move reads: "Kon v1 → v3", "Kon v2 (record archived)", "Kon v2 (record missing)", "Squash and stretch (the pack
// updated this card)"
export const moveText = (m) => (m.pack ? `${m.name} (${m.missing ? "no longer in the pack" : "the pack updated this card"})`
  : `${m.name} v${m.was}${m.missing ? " (record missing)" : m.now !== m.was ? ` → v${m.now}` : ""}${m.archived ? " (record archived)" : ""}`);
// null when the live chain still makes this take and nothing it pinned moved on, else {changed, world}: what changed in
// the chain (seeds aside) and which pinned records have newer versions. Takes from before hashes were kept are hashed
// from their prompt. An edit's take was never made by the chain, so it is never stale (a continued, re-taken or re-generated one was)
export async function stale(take, now) {
  if (!take.prompt || (take.parent && !["continue", "retake", "rerun/regenerate"].includes(take.parent.method))) return null;
  await W.load();
  const world = moves(take.world);
  now ??= await live();
  const same = (take.hash ?? (await hashes(canonical(take.prompt, take.swapped))).hash) === (await hashes(now)).hash;
  const list = same ? [] : changes(canonical(take.prompt, take.swapped), now);
  return list.length || world.length ? { changed: list, world } : null;
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

// a blind A/B an agent sets up for the person to judge (only a person judges it). The server holds which take is A and
// which is B until the verdict (SNAP-R174): the page lists pairs by id and shows their two sides from /blind/media
async function blindCall(route, body) {
  const r = await api.fetchApi(route, body ? { method: "POST", body: JSON.stringify(body) } : undefined), out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error ?? `${route} answered ${r.status}`);
  return out;
}
export const pending = async () => (await blindCall("/mainodes/snap/blind")).pairs;
export const blindUrl = (pair, side) => api.apiURL(`/mainodes/snap/blind/media?pair=${encodeURIComponent(pair)}&side=${side}`);
export async function setupAB(a, b, by = "agent") {
  const side = (id) => { const t = get(id), m = t?.media.find((x) => x.kind === "video") ?? t?.media[0]; if (!m) throw new Error(`Take ${t?.number ?? id} has no picture or clip to show`); return { take: id, media: { filename: m.filename, subfolder: m.subfolder, type: m.type } }; };
  const out = await blindCall("/mainodes/snap/blind", { a: side(a), b: side(b), group: get(a).group, by });
  changed();
  return out;
}
// the person's verdict on a blind pair: written on the server first, then the labels come back
export async function judgeBlind(pair, side, why = "") { const out = await blindCall("/mainodes/snap/blind/judge", { pair, side, why }); changed(); return out; }
api.addEventListener("mainodes-snap-blind", () => changed());

// a verdict on a take (SNAP-R173): keep, reject or neither ("neither, same problem" is a value, not the absence of one),
// with the one line why (`because`) and when it is worth another look (`revive_if`): the option cemetery. A verdict
// replaced or taken back stays on the take, struck through, with the reason that names what failed, never the person
export const RETRACT = { misfire: "a misfire (the interface took the wrong press)", evidence: "new evidence", changed_mind: "changed mind", superseded: "superseded" };
export async function setVerdict(take, verdict, { because, revive_if, by = "person", reason } = {}) {
  if (verdict != null && !["keep", "reject", "neither"].includes(verdict)) throw new Error(`verdict is keep, reject or neither; not ${JSON.stringify(verdict)}`);
  if (reason != null && !RETRACT[reason]) throw new Error(`a retraction's reason is one of ${Object.keys(RETRACT).join(", ")}`);
  const at = new Date().toISOString();
  if (take.verdict) (take.verdicts_past ??= []).push({ verdict: take.verdict, ...(take.verdict_note ? { because: take.verdict_note } : {}), ...(take.revive_if ? { revive_if: take.revive_if } : {}), by: take.verdict_by ?? "person", ...(take.verdict_at ? { at: take.verdict_at } : {}), retracted: { reason: reason ?? (verdict ? "superseded" : "changed_mind"), at } });
  take.verdict = verdict;
  for (const k of ["verdict_note", "revive_if", "verdict_by", "verdict_at"]) delete take[k];
  if (verdict) Object.assign(take, { verdict_by: by, verdict_at: at, ...(because ? { verdict_note: because } : {}), ...(revive_if ? { revive_if } : {}) });
  await save(take);
  return take;
}
// what a take's verdicts say to an agent: the current one and every one taken back (the option cemetery)
export const verdictOf = (t) => ({ verdict: t.verdict ?? null, ...(t.verdict ? { by: t.verdict_by ?? "person", ...(t.verdict_note ? { because: t.verdict_note } : {}), ...(t.revive_if ? { revive_if: t.revive_if } : {}), ...(t.verdict_at ? { at: t.verdict_at } : {}) } : {}), ...(t.verdicts_past?.length ? { retracted: t.verdicts_past } : {}) });

// a preference between two takes (blind or not), with the reason: the pairwise rows a judge model learns from
export async function judge(a, b, winner, { blind, why, by = "person" }) {
  const file = `${JUDGED}/${new Date().toISOString().slice(0, 10)}.json`;
  const rows = await readJson(file, []);
  rows.push({ at: new Date().toISOString(), a, b, winner, blind: !!blind, why: why ?? "", by });
  await store(file, rows);
}

export async function note(take, { t, region, sentiment, tags, text, by = "person", severity, owner, fix }) {
  take.notes.push({ id: `n${Date.now().toString(36)}`, t, ...(region ? { region } : {}), sentiment, tags, text, by, at: new Date().toISOString(), ...(severity ? { severity } : {}), ...(owner ? { owner } : {}), ...(fix ? { fix } : {}) }); // SNAP-R103
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

// F-F23: a scratch tab of its own (no shot, a new graph id: its runs land here, not in the take's shot)
export function openAsTab(take) {
  const { snap_scene, ...extra } = take.graph.extra ?? {};
  return app.loadGraphData({ ...structuredClone(take.graph), id: crypto.randomUUID(), extra: structuredClone(extra) }, true, true, `${take.workflow || "take"} #${take.number}`);
}

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
export async function frames(take, { frames: want, count = 5, maxWidth = 768 } = {}) {
  const m = take.media.find((x) => x.kind === "video") ?? take.media.find((x) => x.kind === "image");
  if (!m) throw new Error("This take has no picture or video");
  if (take.locked) throw new Error(LOCKED);
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

// a frame of a take as a picture in ComfyUI's input folder: `t` in seconds, "last" for its end ("continue from end of
// shot"), or `frame` (a frame number, as take_frames and edit_from_context count them); `crop` [x, y, width, height] in
// fractions keeps a part of it (G1: the front and the back of one sheet still are two pictures). The file is named by the
// take, the frame and the crop, so another frame or part of the same take is another picture
export async function frameAt(take, t = "last", { frame: want, crop } = {}) {
  const m = take.media.find((x) => x.kind === "video") ?? take.media.find((x) => x.kind === "image");
  if (!m) throw new Error("This take has no picture or video");
  if (crop && !(crop.length === 4 && crop.every((v) => typeof v === "number" && v >= 0 && v <= 1) && crop[2] > 0 && crop[3] > 0)) throw new Error(`crop is [x, y, width, height] in fractions of the picture (0 to 1); not ${JSON.stringify(crop)}`);
  if (take.locked) throw new Error(LOCKED);
  let at = 0;
  const cut = (src, w, h) => { const [x, y, cw, ch] = crop ?? [0, 0, 1, 1], c = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(cw * w)), height: Math.max(1, Math.round(ch * h)) });
    c.getContext("2d").drawImage(src, Math.round(x * w), Math.round(y * h), c.width, c.height, 0, 0, c.width, c.height); return new Promise((done) => c.toBlob(done, "image/png")); };
  const blob = m.kind === "image" ? await (async () => { const img = new Image(); img.src = url(m); await img.decode(); return cut(img, img.naturalWidth, img.naturalHeight); })() : await new Promise((resolve, reject) => {
    const v = Object.assign(document.createElement("video"), { src: url(m), muted: true, preload: "auto" });
    v.onloadedmetadata = () => {
      const last = Math.max(0, Math.floor(v.duration * FPS) - 1);
      if (want != null && !(Number.isInteger(want) && want >= 0 && want <= last)) return reject(new Error(`frame is a whole frame number of take ${take.number}, from 0 to ${last}; not ${want}`));
      at = want != null ? (want + 0.5) / FPS : t === "last" ? Math.max(0, v.duration - 0.05) : Math.min(Math.max(0, t), v.duration - 0.05); v.currentTime = at;
    };
    v.onseeked = () => cut(v, v.videoWidth, v.videoHeight).then(resolve);
    v.onerror = () => reject(new Error("couldn't read the video's frame"));
  });
  const frame = m.kind === "image" ? 0 : want ?? Math.round(at * FPS), part = crop ? `_c${crop.map((x) => Math.round(x * 1000)).join("-")}` : "", form = new FormData();
  form.append("image", blob, `${take.id}_f${frame}${part}.png`);
  form.append("subfolder", "snap");
  form.append("overwrite", "true");
  if (take.kept_encrypted) form.append("snap_vault", "1"); // the frame of a take kept encrypted is kept encrypted too
  const r = await (await api.fetchApi("/upload/image", { method: "POST", body: form })).json();
  return { file: `${r.subfolder}/${r.name}`, frame, ...(crop ? { crop } : {}) };
}

// "Use as input" (U32): a take's frame becomes the First frame (FL2V's start) or a reference picture, through the bricks'
// own loaders, as one undo step; the brick remembers the take and frame it came from. A new First frame goes to whatever
// follows it (library.js: under Ref2V it is also <Picture 1>, the opening frame, F-C32), which says what it did
const firstFrames = new Set();
export const onFirstFrame = (fn) => firstFrames.add(fn);
// F-SQ49: `role` says a reference picture's job ("opening: C1's out-frame"), so References and the cites name it
export async function use(take, { as = "first_frame", t = "last", frame: want, crop, role, by = "person" } = {}) {
  if (!["first_frame", "reference"].includes(as)) throw new Error(`Use a take as first_frame or reference, not ${as}`);
  const key = as === "first_frame" ? "first_frame" : "refs";
  if (!E.state().bricks.some((b) => b.key === key)) throw new Error(`Add the ${BRICKS[key].title} brick to use a take ${as === "first_frame" ? "as its first frame" : "as a reference"}`);
  const { file, frame } = await frameAt(take, t, { frame: want, crop }), from = { take: take.id, number: take.number, frame, file, by };
  const part = crop ? ` (part ${crop.map((x) => +x.toFixed(2)).join(", ")})` : "", had = as === "reference" && E.references()?.pictures.some((p) => p.file === file);
  let opening = null;
  app.canvas.emitBeforeChange();
  try {
    if (as === "reference") E.addPicture(file, { role: role?.trim() || `take ${take.number}, frame ${frame}${part}`, reason: `frame ${frame} of take ${take.number} (${take.id})${part}`, source: take.id });
    else {
      const w = E.nodeFor("first_frame", "image").widgets.find((x) => x.name === "image");
      if (!w.options.values.includes(file)) w.options.values.push(file); // uploaded after the page loaded
      E.setValue("first_frame", "image", "image", file);
      E.remember("first_frame", "from", from);
    }
    if (as === "first_frame") opening = [...firstFrames].map((fn) => fn()).find(Boolean) ?? null;
  } finally { app.canvas.emitAfterChange(); }
  const cite = as === "reference" ? E.references()?.pictures.find((p) => p.file === file)?.cite : null;
  return { as, file, ...from, ...(cite ? { cite } : {}), ...(opening ? { opening: opening.cite } : {}), said: had ? `Frame ${frame}${part} of take ${take.number} is already in References as ${cite}: another frame (frame) or part (crop) is another picture`
    : `Frame ${frame}${part} of take ${take.number} is now ${as === "first_frame" ? "the First frame" : `a reference picture, ${cite}`}${opening ? `; ${opening.said}` : ""}` };
}
