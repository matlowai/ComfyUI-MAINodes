// Candidates (U32, UX_GEMS #2): N results for one decision, shown before anything changes. A decision ("master's plate",
// "night version of take 2") holds its candidates, each with where it came from (take, frame, seed, who asked) and the
// pre-screen notes a check left on it (copy score, layout against the plan, identity). The person previews a candidate
// in place (the plate slot or the take viewer shows it, nothing is edited), applies one or rejects it; Apply is one step
// that Undo takes back. A check never rejects alone: it only leaves a note. Agents list, pre-screen and recommend; their
// apply / reject waits for the person as a proposal unless "Let agents run" is on (tools.js).
// What applying means belongs to the decision's kind (plates.js: the camera's plate; edits.js: the edit's render):
// kind(name, { finish, apply, undo }) registers it. Decisions are local JSON in the user's snap/candidates folder.
// SNAP-R16 the person's pick · SNAP-R17 by: person|agent · SNAP-R18 local only · SNAP-R23 candidates · SNAP-R65 the Work card reads decisions (reload merges another page's) · see docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";

const DIR = "snap/candidates";
const kinds = new Map();
let decisions = [], loading = null;
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) fn(); };

// finish(decision, candidate, history) fills a rendered candidate; apply(decision, candidate, by) returns what
// undo(decision, candidate, that) needs; reject(decision, candidate, by), when a kind has it, follows a Reject
export const kind = (name, handlers) => kinds.set(name, handlers);
const handler = (d) => kinds.get(d.kind) ?? (() => { throw new Error(`No handler for ${d.kind} candidates on this page`); })();

export function load() {
  loading ??= (async () => {
    const files = (await api.listUserDataFullInfo(DIR)).filter((f) => f.path.endsWith(".json"));
    decisions = (await Promise.all(files.map(async (f) => { const r = await api.getUserData(`${DIR}/${f.path}`); return r.ok ? r.json() : null; }))).filter(Boolean).sort((a, b) => a.created - b.created);
    changed();
    return decisions;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}
export const all = () => decisions;
// read the folder again: a decision another tab or page wrote joins the list, one it changed since is updated in place
export async function reload() {
  await load();
  const files = (await api.listUserDataFullInfo(DIR)).filter((f) => f.path.endsWith(".json"));
  let moved = false;
  for (const f of files) {
    const mine = get(f.path.replace(/\.json$/, ""));
    if (mine && f.modified <= (mine.updated ?? 0)) continue;
    const r = await api.getUserData(`${DIR}/${f.path}`), read = r.ok ? await r.json() : null;
    if (!read || (mine && (read.updated ?? 0) <= (mine.updated ?? 0))) continue;
    if (mine) Object.assign(mine, read); else decisions.push(read);
    moved = true;
  }
  if (moved) { decisions.sort((a, b) => a.created - b.created); changed(); }
}
export const get = (id) => decisions.find((d) => d.id === id);
// the newest decision about one thing (a set's camera, a take): open ones first
export const about = (kind, target) => decisions.filter((d) => d.kind === kind && d.target === target).sort((a, b) => (a.status === "open") - (b.status === "open") || a.created - b.created).at(-1) ?? null;
export const candidate = (d, cid) => d?.candidates.find((c) => c.id === cid) ?? null;
export const rendering = (d) => !!d?.candidates.some((c) => c.state === "rendering");

const writes = new Map();
export async function save(d) {
  d.updated = Date.now();
  if (!decisions.includes(d)) decisions.push(d);
  changed();
  const path = `${DIR}/${d.id}.json`, next = (writes.get(path) ?? Promise.resolve()).catch(() => {}).then(() => api.storeUserData(path, d));
  writes.set(path, next);
  await next;
}

// a new decision: `candidates` are { prompt_id?, seed?, take?, frame?, pictures?, notes? }, each numbered c1, c2, …
export async function create({ kind: k, target, title, by = "person", ...rest }, list) {
  const d = { id: `cand-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, kind: k, target, title, by, created: Date.now(), status: "open", applied: null, ...rest,
    candidates: list.map((c, i) => ({ id: `c${i + 1}`, state: c.prompt_id ? "rendering" : "ready", by, notes: {}, pictures: [], ...c })) };
  await save(d);
  return d;
}

// Apply: the kind does what picking means and returns what undo needs; applying another candidate of the same decision
// first takes the earlier one back, so there is always one step to undo
export async function apply(id, cid, by = "person") {
  const d = get(id), c = candidate(d, cid);
  if (!c) throw new Error(`No candidate ${cid} in ${id}`);
  if (c.state !== "ready") throw new Error(`${d.title}: candidate ${cid} is ${c.state}`);
  if (d.applied) await undo(id, by);
  const was = await handler(d).apply(d, c, by);
  c.state = "applied";
  d.applied = { candidate: cid, by, at: new Date().toISOString(), undo: was ?? null };
  d.status = "applied";
  await save(d);
  return { decision: id, applied: cid, by };
}
export async function undo(id, by = "person") {
  const d = get(id);
  if (!d?.applied) throw new Error(`${d?.title ?? id}: nothing applied to undo`);
  await handler(d).undo?.(d, candidate(d, d.applied.candidate), d.applied.undo);
  candidate(d, d.applied.candidate).state = "ready";
  d.undone = [...(d.undone ?? []), { candidate: d.applied.candidate, by, at: new Date().toISOString() }];
  d.applied = null;
  d.status = "open";
  await save(d);
  return { decision: id, undone: true, by };
}
export async function reject(id, cid, by = "person") {
  const d = get(id), c = candidate(d, cid);
  if (!c) throw new Error(`No candidate ${cid} in ${id}`);
  if (c.state === "applied") throw new Error(`${d.title}: candidate ${cid} is applied; undo it first`);
  c.state = "rejected";
  c.rejected = { by, at: new Date().toISOString() };
  await kinds.get(d.kind)?.reject?.(d, c, by); // a kind whose candidates are takes marks the take (rerun: verdict reject, SNAP-R17)
  if (d.candidates.every((x) => x.state === "rejected" || x.state === "failed")) d.status = "closed";
  await save(d);
  return { decision: id, rejected: cid, by };
}

// a pre-screen note on a candidate (copy, layout, identity): data only, the decision stays the person's
export async function note(d, c, name, value) {
  c.notes[name] = value;
  await save(d);
}

// rendering candidates finish from /history (after a reload too: their prompt ids are in the decision); a candidate is
// finished once even when several events ask at the same time. One the server has no record of, in its history or its
// queue, failed (a restart drops both)
const finishing = new Set();
export async function settle() {
  await load();
  let queued = null;
  for (const d of decisions) for (const c of d.candidates) {
    if (c.state !== "rendering" || finishing.has(c.prompt_id) || !kinds.has(d.kind)) continue;
    finishing.add(c.prompt_id);
    try {
      const h = (await (await api.fetchApi(`/history/${c.prompt_id}`)).json())[c.prompt_id];
      if (!h) {
        queued ??= await api.fetchApi("/queue").then((r) => r.json()).then((q) => new Set([...q.queue_running, ...q.queue_pending].map((x) => x[1])));
        if (!queued.has(c.prompt_id)) { c.state = "failed"; c.error = "the server has no record of this render (restarted?)"; await save(d); }
        continue;
      }
      if (!h.status?.completed && h.status?.status_str !== "error") continue;
      if (h.status.status_str !== "success") { c.state = "failed"; c.error = h.status.messages?.find(([k]) => k === "execution_error")?.[1]?.exception_message ?? h.status.status_str; }
      else { await kinds.get(d.kind).finish(d, c, h); c.state = c.state === "rendering" ? "ready" : c.state; }
      await save(d);
    } catch (e) { console.warn(`candidate ${d.id}/${c.id}: ${e.message}`); } finally { finishing.delete(c.prompt_id); }
  }
}
// this page's own renders send events; another page's are read when the Work card reconciles (activity.js, SNAP-R65)
for (const ev of ["execution_success", "execution_error", "execution_interrupted"]) api.addEventListener(ev, () => { settle().catch(() => {}); });
load().catch(() => {}); // a reload picks up decisions still rendering

// a picture's file as an agent names it: output/<subfolder>/<name> (U72 F28)
export const path = (m) => [m.type, m.subfolder, m.filename].filter(Boolean).join("/");
// what an agent reads: the decision, each candidate's state, provenance and notes, what is applied, and how to undo
export const describe = (d) => ({ id: d.id, kind: d.kind, target: d.target, title: d.title, by: d.by, status: d.status, applied: d.applied && { candidate: d.applied.candidate, by: d.applied.by, at: d.applied.at },
  candidates: d.candidates.map(({ id, state, by, prompt_id, take, frame, seed, pictures, notes, error, rejected, made }) => ({ id, state, by, take: take ?? (prompt_id ? `take-${prompt_id}` : null), frame, seed, pictures: pictures.map((p) => ({ label: p.label, ...(p.media ? { path: path(p.media) } : {}) })), notes, ...(made ? { made } : {}), ...(error ? { error } : {}), ...(rejected ? { rejected } : {}) })) });

// the candidate shown in place right now (hover or press): page state only, never saved and never an edit
let shown = null;
const previewers = new Set();
export const onPreview = (fn) => previewers.add(fn);
export function preview(d, c) {
  shown = d && c ? { decision: d.id, candidate: c.id } : null;
  for (const fn of previewers) fn(shown);
}
export const previewed = () => shown;
