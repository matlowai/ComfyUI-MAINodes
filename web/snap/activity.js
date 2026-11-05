// The Work card's model (SNAP-R65): every asynchronous job Snap or an agent started, derived from the server's own records
// whenever something may have moved, never from promises in this page. Sources: the server's queue and history with each
// prompt's job stamp (/mainodes/snap/jobs, jobs.js), the candidates store (a decision's paints or re-runs fold into one
// row: painting → checking → waiting for a pick), the proposals and blind pairs waiting for the person, and refusals at
// queue (page memory, until parked or retried). Each row has a state (queued | running | checking | waiting | done |
// failed | gone) and a zone, a query over the states: In flight (queued, running, checking, failed, gone), Landed,
// unjudged (waiting, and done rows nobody opened yet), Parked (the person's Park: kept, never counted) and closed (done
// and opened: it lives in Takes now). Parked and opened marks are the person's, in snap/work.json. The docket is the
// waiting rows. It survives a reload, a closed viewer and another tab because every row is read back from the server:
// the `status` broadcast every tab gets wakes a reconcile, and while work is live a 2 s tick reads again.
// SNAP-R5 an arrival never moves the person · SNAP-R17 by: person|agent · SNAP-R23 candidates wait for the person's pick ·
// SNAP-R58 whole lists, explicit paging · SNAP-R65 the Work card · SNAP-R66 arrivals announce, a press moves · see
// docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as T from "./takes.js";
import * as C from "./candidates.js";
import * as P from "./proposals.js";
import * as SC from "./scenes.js";
import * as ACC from "./account.js";
import * as J from "./jobs.js";

export const STATES = ["queued", "running", "checking", "waiting", "done", "failed", "gone"];
export const ZONES = ["in_flight", "landed", "parked", "closed"];
export const ZONE_NAMES = { in_flight: "In flight", landed: "Landed, unjudged", parked: "Parked", closed: "Closed" };
const LIVE = new Set(["queued", "running", "checking"]);
const WORK = "snap/work.json", DAY = 86400000;

let rows = [], server = [], marks = { parked: {}, opened: {} }, progress = { prompt_id: null, nodes: {} }, problem = null, seen = null;
const arrivals = new Set();
// live jobs a server restart dropped (the socket reconnected and they are in neither the queue nor the history): kept as
// "gone" rows so the person learns what was lost; a job cancelled here just leaves
let restarted = false;
const lost = new Map();
// the person hears of a job when it starts elsewhere (an agent, another tab), lands or fails: fn(what, row), what is
// "start" | "landed" | "failed" | "lost"; the view decides where it is said (SNAP-R66: it never moves anyone)
export const onArrive = (fn) => arrivals.add(fn);
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const all = () => rows;
export const get = (id) => rows.find((r) => r.id === id || r.decision === id || r.prompts?.includes(id)) ?? null;
export const routeProblem = () => problem;

// what the job is about, as a person reads it: "Scene › Shot 2", else the tab's workflow
function where(about = {}) {
  const t = about.take && T.get(about.take), group = about.group ?? t?.group;
  for (const s of SC.all()) for (const shot of s.shots) if (shot.id === about.shot || (group && shot.groups.includes(group))) return `${s.name} › ${SC.shotTitle(s, shot)}`;
  return about.set ? `set ${about.set}${about.camera ? ` · ${about.camera}` : ""}` : "a scratch tab";
}
const errorText = (e) => (e ? `${e.node_type ?? "node"}${e.node_id != null ? ` #${e.node_id}` : ""}: ${e.exception_message ?? e.exception_type ?? "failed"}` : null);
const eta = (r) => { if (r.eta_s == null) return "no estimate yet"; if (!r.started_at) return `about ${Math.round(r.eta_s)} s`; const left = r.eta_s - (Date.now() - r.started_at) / 1000; return left > 0 ? `about ${Math.round(left)} s left` : "running past its estimate"; };
// the running prompt's progress as core tracks it: the node working now and how many nodes are done
function progressOf(id) {
  if (progress.prompt_id !== id) return null;
  const nodes = Object.entries(progress.nodes), now = nodes.find(([, n]) => n.state === "running");
  return { nodes: nodes.length, finished: nodes.filter(([, n]) => n.state === "finished").length, ...(now ? { node: now[0], value: now[1].value, max: now[1].max } : {}) };
}

// one row per prompt the server knows (folded into its decision when it belongs to one)
function fromPrompt(p, ahead) {
  const mine = !p.user || !ACC.account() || p.user === ACC.account().name;
  const job = p.job ?? { kind: "run", title: "A run queued outside Snap", about: {}, by: "outside" };
  const take = job.takes !== false ? T.get(`take-${p.id}`) : null;
  // a finished run whose take isn't written yet is still being saved (by whichever page queued it) for up to a minute
  const saving = p.state === "success" && job.takes !== false && p.job && !take && Date.now() - (p.finished ?? 0) < 60000;
  const state = saving ? "checking" : { running: "running", queued: "queued", success: "done", done: "done", error: "failed", interrupted: "failed" }[p.state];
  return { id: p.id, source: "prompt", kind: job.kind, title: mine ? job.title : "Another account's job", by: mine ? job.by : "another account", owner: mine ? (job.by === "agent" ? "agents" : job.by === "person" ? "you" : "others") : "others",
    state, about: mine ? job.about ?? {} : {}, where: mine ? where(job.about) : "", eta_s: job.eta_s ?? null, queued_at: job.at ?? null, started_at: p.started ?? null, finished_at: p.finished ?? null,
    ...(state === "queued" ? { ahead } : {}), ...(state === "running" ? { progress: progressOf(p.id) } : {}),
    ...(p.state === "interrupted" ? { error: "stopped before it finished (interrupted)" } : p.error ? { error: errorText(p.error), traceback: p.error.traceback } : {}),
    result: take ? { take: take.id, number: take.number } : saving ? { take: null, saving: "the take is being written" } : job.takes !== false && state === "done" ? { take: null, note: "no take was written for it (the page that queued it closed before it finished?)" } : null, client: p.client, takes: job.takes !== false };
}
// a decision's candidates: one row from painting to the person's pick
function fromDecision(d, byId) {
  const prompts = d.candidates.map((c) => c.prompt_id).filter(Boolean), states = d.candidates.map((c) => c.state);
  const queued = prompts.map((id) => byId.get(id)).filter((p) => p?.state === "queued");
  const checking = d.kind === "edit" && d.candidates.some((c) => c.state === "ready" && !c.notes.identity);
  const ready = states.filter((s) => s === "ready").length;
  const state = d.status === "applied" || d.status === "closed" ? "done" : states.includes("rendering") ? (queued.length === prompts.length ? "queued" : "running") : checking ? "checking" : ready ? "waiting" : states.every((s) => s === "failed") ? "failed" : "done";
  const running = prompts.map((id) => byId.get(id)).find((p) => p?.state === "running");
  return { id: `d:${d.id}`, decision: d.id, source: "decision", kind: { edit: "paint", rerun: "rerun", plate: "plate" }[d.kind] ?? d.kind, title: d.title, by: d.by, owner: d.by === "agent" ? "agents" : "you",
    state, about: { take: d.take ?? (d.kind === "plate" ? undefined : d.target), decision: d.id, set: d.set, camera: d.camera }, where: where({ take: d.take, set: d.set, camera: d.camera }),
    candidates: { count: d.candidates.length, ready, rendering: states.filter((s) => s === "rendering").length, failed: states.filter((s) => s === "failed").length, rejected: states.filter((s) => s === "rejected").length },
    prompts, queued_at: d.created, started_at: running?.started ?? null, eta_s: null, ...(running ? { progress: progressOf(running.id) } : {}), ...(queued.length ? { ahead: Math.min(...queued.map((p) => p.ahead)) } : {}),
    ...(state === "failed" ? { error: d.candidates.map((c) => `${c.id}: ${c.error ?? "failed"}`).join("; ") } : {}),
    result: d.applied ? { applied: d.applied.candidate, by: d.applied.by } : null };
}

function build() {
  const byId = new Map(server.map((p) => [p.id, p])), folded = new Set();
  const decisions = C.all().filter((d) => Date.now() - (d.updated ?? d.created) < DAY || d.status === "open").map((d) => { const r = fromDecision(d, byId); r.prompts.forEach((id) => folded.add(id)); return r; });
  let ahead = server.filter((p) => p.state === "running").length;
  const prompts = server.filter((p) => !folded.has(p.id) && (p.job || p.state === "running" || p.state === "queued")).map((p) => fromPrompt(p, p.state === "queued" ? ahead++ : undefined));
  const asked = P.all().filter((p) => p.status === "waiting").map((p) => ({ id: `p:${p.id}`, proposal: p.id, source: "proposal", kind: "proposal", title: p.reason || p.tool.replaceAll("_", " "), by: "agent", owner: "agents", state: "waiting",
    about: { take: p.args?.take, slot: p.args?.slot }, where: where({ take: p.args?.take }), tool: p.tool, eta_s: p.plan?.eta_s ?? null, plan: p.plan ?? null, queued_at: null }));
  const refusals = J.refusals().map((x) => ({ id: x.id, source: "refusal", kind: x.spec.kind, title: x.spec.title, by: x.spec.by ?? "person", owner: x.spec.by === "agent" ? "agents" : "you", state: "failed",
    about: x.spec.about ?? {}, where: where(x.spec.about), error: `refused at queue: ${x.error}`, queued_at: x.at, retry: x.retry }));
  rows = [...prompts, ...decisions, ...asked, ...pairs, ...refusals, ...lost.values()].map((r) => {
    const parked = marks.parked[r.id] ?? null, opened = marks.opened[r.id] ?? null;
    const zone = parked ? "parked" : LIVE.has(r.state) || r.state === "failed" || r.state === "gone" ? "in_flight" : r.state === "waiting" || (r.state === "done" && !opened) ? "landed" : "closed";
    return { ...r, zone, eta: eta(r), ...(parked ? { parked } : {}), ...(opened ? { opened } : {}) };
  }).sort((a, b) => (b.queued_at ?? b.started_at ?? 0) - (a.queued_at ?? a.started_at ?? 0));
  if (readOnce) announce();
  for (const fn of listeners) fn();
}
// what changed since the last build, said once. The first build after the server was read only remembers; after that a
// row is said when it moves out of a live state, or when it is new and was queued after this page loaded (a job can run
// whole between two reads), never for the history a page finds when it loads
const loadedAt = Date.now();
let readOnce = false;
function announce() {
  const was = seen;
  seen = new Map(rows.map((r) => [r.id, r.state]));
  if (!was) return;
  const dropped = rows.filter((r) => r.state === "gone" && was.get(r.id) && was.get(r.id) !== "gone");
  for (const r of rows) {
    const before = was.get(r.id), fresh = !before && (r.queued_at ?? 0) > loadedAt;
    if (before === r.state || r.zone === "parked" || r.source === "refusal" || (!before && !fresh && !LIVE.has(r.state))) continue;
    const what = r.state === "failed" ? "failed" : r.state === "done" || r.state === "waiting" ? "landed" : !before && LIVE.has(r.state) && (r.by === "agent" || !J.own(r.id)) ? "start" : null;
    if (what) for (const fn of arrivals) fn(what, r);
  }
  if (dropped.length) for (const fn of arrivals) fn("lost", { count: dropped.length });
}

let pairs = [];
let reading = null, again = false;
// read every source again; overlapping calls fold into one more read
export function reconcile() {
  if (reading) { again = true; return reading; }
  reading = (async () => {
    const r = await api.fetchApi("/mainodes/snap/jobs");
    problem = r.ok ? null : `The server runs older Snap code (its jobs route answered ${r.status}): restart ComfyUI for the Work card`;
    const before = new Set(server.filter((p) => LIVE.has(p.state)).map((p) => p.id));
    server = r.ok ? (await r.json()).rows : [];
    const gone = [...before].filter((id) => !server.some((p) => p.id === id));
    if (restarted) for (const id of gone) { const r = rows.find((x) => x.id === id); if (r) lost.set(id, { ...r, state: "gone", error: "the server restarted before it finished: it is in neither the queue nor the history" }); }
    restarted = false;
    if (gone.length || server.some((p) => before.has(p.id) && !LIVE.has(p.state)) || rows.some((r) => r.result?.saving)) await Promise.all([T.reload(), C.reload()]); // something left the queue: another page may have written its take or decision
    if (server.some((p) => p.state === "running")) progress = await (await api.fetchApi("/mainodes/snap/progress")).json().catch(() => progress);
    pairs = (await T.pending()).map((p) => ({ id: `ab:${p.a}|${p.b}`, source: "blind_pair", kind: "blind_pair", title: `Blind pair: take ${T.get(p.a)?.number ?? "?"} or take ${T.get(p.b)?.number ?? "?"}?`, by: p.by, owner: p.by === "agent" ? "agents" : "you", state: "waiting", about: { take: p.a }, where: where({ take: p.a }), queued_at: Date.parse(p.at) || null, pair: [p.a, p.b] }));
    await C.settle();
    await T.catchUp(server.filter((p) => p.client === api.clientId && p.job?.takes !== false && ["success", "error", "interrupted"].includes(p.state)));
    readOnce = r.ok;
    build();
  })().catch((e) => { problem = `The Work card couldn't read the server: ${e.message}`; build(); }).finally(() => { reading = null; if (again) { again = false; reconcile(); } });
  return reading;
}


async function loadMarks() { const r = await api.getUserData(WORK); if (r.status === 200) marks = { parked: {}, opened: {}, ...await r.json() }; }
const saveMarks = () => api.storeUserData(WORK, marks);
// Park (the sheet's button, SNAP-R65): out of In flight and Landed, kept in Parked with no count; Unpark puts it back
export async function park(id, on = true) {
  const r = get(id);
  if (!r) throw new Error(`No job ${id} on the Work card`);
  if (on) marks.parked[r.id] = new Date().toISOString(); else delete marks.parked[r.id];
  build();
  await saveMarks();
  return { job: r.id, parked: on };
}
// the person opened a job's result (Open, or the take's own viewer): it leaves Landed
export async function opened(match) {
  const ids = rows.filter((r) => r.zone === "landed" && r.state === "done" && (r.id === match || r.result?.take === match)).map((r) => r.id);
  if (!ids.length) return;
  for (const id of ids) marks.opened[id] = new Date().toISOString();
  build();
  await saveMarks();
}

// the agents' list (list_activity, list_docket): every row matching, whole, with the counts per zone (SNAP-R58: offset and
// limit page it explicitly, nothing is cut otherwise)
export async function list({ zone, state, kind, by, about, offset = 0, limit } = {}) {
  await reconcile();
  const match = rows.filter((r) => (!zone || r.zone === zone) && (!state || r.state === state) && (!kind || r.kind === kind) && (!by || r.by === by)
    && (!about || Object.values(r.about ?? {}).includes(about) || r.decision === about || r.id === about));
  const counts = Object.fromEntries(ZONES.map((z) => [z, rows.filter((r) => r.zone === z).length]));
  const page = match.slice(offset, limit == null ? undefined : offset + limit);
  return { rows: page.map(({ retry, client, ...r }) => r), count: match.length, offset, ...(limit != null && offset + page.length < match.length ? { next: { offset: offset + page.length, limit } } : {}), zones: counts,
    window: "the server's queue, its history of the last 24 hours, open decisions, waiting proposals and blind pairs", ...(problem ? { problem } : {}) };
}

// waking up: on load, on every queue change any tab makes (core's `status` broadcast), on this page's own events and
// store changes, and every 2 s while anything is live
let remaining = null, timer = null;
api.addEventListener("status", ({ detail }) => { const n = detail?.exec_info?.queue_remaining ?? null; if (n !== remaining) { remaining = n; reconcile(); } });
for (const ev of ["execution_start", "execution_success", "execution_error", "execution_interrupted"]) api.addEventListener(ev, () => reconcile());
api.addEventListener("reconnected", () => { restarted = true; reconcile(); });
C.onChange(() => build());
J.onRefuse(() => build());
T.onChange(() => build());
P.onChange(() => build());
onChange(() => {
  const live = rows.some((r) => LIVE.has(r.state));
  if (live && !timer) timer = setInterval(() => reconcile(), 2000);
  if (!live && timer) { clearInterval(timer); timer = null; }
});
Promise.all([loadMarks().catch(() => {}), T.load(), C.load(), SC.load()]).then(() => reconcile(), () => reconcile());
