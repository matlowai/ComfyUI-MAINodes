// Takes (LIBRARY "run" cards, BRAINSTORM dailies): every run from this page becomes a take, read from ComfyUI's own
// history so it holds exactly what ran (the workflow, the executed prompt, the outputs) for any workflow. People rank
// takes, keep or reject them, and pin notes to the moment (and region) where something went wrong or right; kept takes
// are the Library's priors. Everything is local JSON in the user's ComfyUI data folder; tools/snap_dataset.py turns it
// into training rows (takes, notes, preference pairs) for a judge model, only when someone runs it.
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const DIR = "snap/takes", RANKS = "snap/rankings", JUDGED = "snap/judgments";

// what people tag a moment with; free text always goes alongside
export const TAGS = {
  wrong: ["identity drift", "face", "hands", "anatomy", "too static", "janky motion", "physics", "flicker", "artifacts", "color", "prompt ignored", "framing", "continuity", "audio sync", "text"],
  right: ["identity", "motion", "physics", "camera", "lighting", "composition", "acting", "prompt", "audio", "continuity", "texture"],
};

let takes = [], loading = null;
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
    return takes;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}

export const all = () => takes;
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

// what a node wrote: every listed file in its outputs, by kind from the extension
const KIND = (f) => (/\.(mp4|webm|mov|mkv)$/i.test(f) ? "video" : /\.(png|jpe?g|webp|gif|avif)$/i.test(f) ? "image" : /\.(wav|flac|mp3|ogg|m4a)$/i.test(f) ? "audio" : null);
function media(outputs) {
  const found = [];
  for (const [node, out] of Object.entries(outputs ?? {})) for (const list of Object.values(out)) {
    if (!Array.isArray(list)) continue;
    for (const f of list) if (f?.filename && KIND(f.filename) && f.type !== "temp") found.push({ kind: KIND(f.filename), filename: f.filename, subfolder: f.subfolder ?? "", type: f.type ?? "output", node });
  }
  return found.sort((a, b) => ["video", "image", "audio"].indexOf(a.kind) - ["video", "image", "audio"].indexOf(b.kind));
}
export const url = (m) => api.apiURL(`/view?filename=${encodeURIComponent(m.filename)}&subfolder=${encodeURIComponent(m.subfolder)}&type=${m.type}`);

// the words and the seed of a run, read from the executed prompt: the longest text input and the first seed-like number
function summary(prompt) {
  let text = "", seed = null;
  for (const n of Object.values(prompt ?? {})) for (const [k, v] of Object.entries(n.inputs ?? {})) {
    if (typeof v === "string" && v.length > text.length && /prompt|text/i.test(k)) text = v;
    if (seed == null && typeof v === "number" && /seed/i.test(k)) seed = v;
  }
  return { text, seed };
}

// capture: execution events from this page's own client, then the run's record from /history
const running = new Map(); // prompt_id -> started at
api.addEventListener("execution_start", ({ detail }) => running.set(detail.prompt_id, Date.now()));
api.addEventListener("execution_success", ({ detail }) => capture(detail.prompt_id, "success"));
api.addEventListener("execution_error", ({ detail }) => capture(detail.prompt_id, "error", `${detail.node_type ?? ""}: ${detail.exception_message ?? ""}`.trim(), detail.node_id));
api.addEventListener("execution_interrupted", ({ detail }) => capture(detail.prompt_id, "interrupted"));

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
  const { text, seed } = summary(prompt);
  await save({
    id: `take-${id}`, kind: "run", prompt_id: id, created: started, finished: Date.now(), seconds: Math.round((Date.now() - started) / 100) / 10,
    group, workflow: app.extensionManager.workflow.activeWorkflow?.filename ?? "", number: n,
    status, ...(error ? { error, failed_node: failedNode } : {}), text, seed, media: media(h.outputs),
    verdict: null, prior: false, notes: [], graph, prompt,
  });
}

// ranking: one ordered list of take ids per group (the people's order; everything not in it is unranked)
const slug = (g) => g.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 120);
const ranks = new Map();
export async function ranking(group = groupOf()) {
  if (!ranks.has(group)) ranks.set(group, (await readJson(`${RANKS}/${slug(group)}.json`, { order: [] })).order);
  return ranks.get(group);
}
export async function rank(id, index, group = groupOf()) {
  const order = (await ranking(group)).filter((x) => x !== id);
  if (index != null) order.splice(Math.max(0, Math.min(index, order.length)), 0, id);
  ranks.set(group, order);
  changed();
  await store(`${RANKS}/${slug(group)}.json`, { group, order, updated: Date.now() });
}

// a preference between two takes (blind or not), with the reason: the pairwise rows a judge model learns from
export async function judge(a, b, winner, { blind, why }) {
  const file = `${JUDGED}/${new Date().toISOString().slice(0, 10)}.json`;
  const rows = await readJson(file, []);
  rows.push({ at: new Date().toISOString(), a, b, winner, blind: !!blind, why: why ?? "", by: "person" });
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

// the last frame of a video take as a picture in ComfyUI's input folder ("continue from end of shot")
export async function lastFrame(take) {
  const m = take.media.find((x) => x.kind === "video") ?? take.media.find((x) => x.kind === "image");
  if (!m) throw new Error("This take has no picture or video");
  const blob = m.kind === "image" ? await (await fetch(url(m))).blob() : await new Promise((resolve, reject) => {
    const v = Object.assign(document.createElement("video"), { src: url(m), muted: true, preload: "auto" });
    v.onloadedmetadata = () => { v.currentTime = Math.max(0, v.duration - 0.05); };
    v.onseeked = () => { const c = Object.assign(document.createElement("canvas"), { width: v.videoWidth, height: v.videoHeight }); c.getContext("2d").drawImage(v, 0, 0); c.toBlob(resolve, "image/png"); };
    v.onerror = () => reject(new Error("couldn't read the video's last frame"));
  });
  const form = new FormData();
  form.append("image", blob, `${take.id}_last.png`);
  form.append("subfolder", "snap");
  form.append("overwrite", "true");
  const r = await (await api.fetchApi("/upload/image", { method: "POST", body: form })).json();
  return `${r.subfolder}/${r.name}`;
}
