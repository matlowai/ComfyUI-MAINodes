// Re-run dependents (U94, DESIGN_U93_U94 §4.7): after a record's new version (a location's master fixed at the source, a
// Cast's new picture), the takes pinned to an older version are re-made upstream first, in stages: plates (stills that
// are a location's master or plates, or made for that purpose), then boards (other stills), then cuts (video takes).
// Each take of a stage is re-run with the record swapped to its newest version (rerun.js, SNAP-R63) and lands as a
// candidate beside the old take, which stays active until a pick (SNAP-R23). A stage starts when the one before it has
// its picks: a picked plate is written into the location as its next version first, so the boards cite the plate's new
// file, not the old one. chain "ask" waits for the person's picks; chain "run" applies a candidate by itself when its
// critique has no high note and the scene's note says "approval: critic" (else it waits for the person). `through`
// says where the chain stops: boards by default (stop before video), cuts to run through. A batch is the person's
// record in snap/dependents/<id>.json; its plan says each stage's takes, swap and time from their own runs.
// SNAP-R106 staged candidates with plan, time and cost · SNAP-R140 a record's own takes are not its dependents; lineage follows · SNAP-R105 fix at the source · SNAP-R107 approval · SNAP-R23 the
// old take stays until a pick · SNAP-R16 GPU time waits for the person (rerun_dependents is consequential) · see docs/snap/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as T from "./takes.js";
import * as C from "./candidates.js";
import * as W from "./world.js";
import * as SC from "./scenes.js";
import * as RT from "./retake.js";
import * as RR from "./rerun.js";
import * as ED from "./edits.js";
import * as L from "./library.js";
import * as CR from "./critiques.js";

const DIR = "snap/dependents";
export const STAGES = ["plates", "boards", "cuts"], CHAINS = ["ask", "run"];
const PLATE_PURPOSES = new Set(["plate", "master", "settei"]);
let batches = [], loading = null;
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) fn(); };
export const all = () => batches;
export function load() {
  loading ??= (async () => {
    const files = (await api.listUserDataFullInfo(DIR)).filter((f) => f.path.endsWith(".json"));
    batches = (await Promise.all(files.map(async (f) => { const r = await api.getUserData(`${DIR}/${f.path}`); return r.ok ? r.json() : null; }))).filter(Boolean).sort((a, b) => a.created - b.created);
    return batches;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}
async function save(b) { b.updated = Date.now(); if (!batches.includes(b)) batches.push(b); changed(); await api.storeUserData(`${DIR}/${b.id}.json`, b); }

// the record's stale takes by stage, in scene and shot order: [{name, takes: [{take, number, n, scene, shot, seconds}], eta_s}]
const isVideo = (t) => t.media.some((m) => m.kind === "video");
function plateTakes(key) {
  const ids = new Set(), r = key.startsWith("location:") ? W.record("location", W.parse(key).id) : null;
  for (const v of r?.versions ?? []) for (const p of [v.body.master, ...(v.body.plates ?? [])]) if (p?.from?.take) ids.add(p.from.take);
  return ids;
}
// F-F07: what a record's new version leaves behind. Not a dependent: the record itself (each version's master take, the
// takes it was edited from, and the other candidates of the decision that made each), and a candidate that was rejected
// or not picked. A take made from a stale take (an edit, a first frame, a reference) follows it, even when it pins
// nothing of the record: `follows` names it and its parent, to re-make from the parent's pick
const takeOfCandidate = (c) => c.take ?? `take-${c.prompt_id}`;
function decisionOf(id) {
  for (const d of C.all()) { const c = d.candidates.find((x) => takeOfCandidate(x) === id); if (c) return { d, c }; }
  return null;
}
export function staleOf(ref) {
  const { kind, id } = W.parse(ref), key = W.refOf(kind, id), r = W.record(kind, id);
  if (!r) throw new Error(`No ${kind} record ${id} (list_world lists them)`);
  const source = new Set(), up = (tid) => { for (let t = T.get(tid); t && !source.has(t.id); t = T.get(t.parent?.take)) { source.add(t.id); for (const c of decisionOf(t.id)?.d.candidates ?? []) source.add(takeOfCandidate(c)); } };
  for (const v of r.versions) if (v.body.master?.from?.take) up(v.body.master.from.take);
  const unpicked = (t) => { const x = decisionOf(t.id); return !x ? null : x.c.state === "rejected" ? "a rejected candidate" : x.d.applied && x.d.applied.candidate !== x.c.id ? "a candidate that wasn't picked" : null; };
  const left_out = [], keep = (t) => { const why = source.has(t.id) ? `the ${W.headOf(r).body.name ?? id} record's own picture (a master, the take it was edited from, or a candidate beside it)` : unpicked(t); if (why) left_out.push({ take: t.id, number: t.number, why }); return !why; };
  // already re-made on a newer version; and a take the newest version holds as its own picture (a plate) moved only
  // when what a plate is made from moved (master, plan, notes), not when sibling plates did
  const remade = (t) => T.all().some((k) => k.parent?.take === t.id && (k.world?.[key]?.n ?? 0) > t.world[key].n);
  const head = W.headOf(r).body, own = new Set([head.master, ...(head.plates ?? [])].map((p) => p?.from?.take).filter(Boolean));
  const core = (b) => JSON.stringify({ ...b, plates: null }), moved = (t) => !own.has(t.id) || core(W.get(W.refOf(kind, id, t.world[key].n))?.version.body ?? {}) !== core(head);
  const stale = T.all().filter((t) => t.world?.[key] && t.world[key].n < r.head && t.status === "success" && keep(t) && !remade(t) && moved(t));
  const ids = new Set(stale.map((t) => t.id)), follows = [];
  for (let grew = true; grew;) {
    grew = false;
    for (const t of T.all()) {
      if (ids.has(t.id) || t.status !== "success" || source.has(t.id) || unpicked(t)) continue;
      const via = [t.parent?.take, ...(t.made_from ?? [])].find((x) => ids.has(x));
      if (!via) continue;
      ids.add(t.id); grew = true;
      follows.push({ take: t.id, number: t.number, via: { take: via, number: T.get(via)?.number ?? null }, why: `made from take ${T.get(via)?.number ?? via}, which is stale: re-make it from that take's re-made pick` });
    }
  }
  return { key, record: r, stale, follows, left_out };
}
export function stagesOf(ref) {
  const { key, stale: list0 } = staleOf(ref);
  const plates = plateTakes(key), order = (t) => { const h = RT.shotOf(t); return h ? SC.all().indexOf(h.scene) * 1000 + h.scene.shots.indexOf(h.shot) : 1e9 + t.created; };
  const stale = [...list0].sort((a, b) => order(a) - order(b));
  const stageOf = (t) => (plates.has(t.id) || PLATE_PURPOSES.has(ED.purposeOf(t)?.purpose) ? "plates" : isVideo(t) ? "cuts" : "boards");
  return STAGES.map((name) => {
    const list = stale.filter((t) => stageOf(t) === name).map((t) => { const h = RT.shotOf(t); return { take: t.id, number: t.number, n: t.world[key].n, ...(h ? { scene: h.scene.name, shot: SC.shotTitle(h.scene, h.shot) } : {}), seconds: t.seconds > 0 ? t.seconds : null }; });
    const known = list.filter((x) => x.seconds != null), eta = known.reduce((s, x) => s + x.seconds, 0);
    return { name, takes: list, eta_s: known.length ? Math.round(eta) : null, from: !list.length ? "nothing to re-run" : known.length === list.length ? "the sum of their own times" : known.length ? `${known.length} of ${list.length} timed; the others: no estimate yet` : "no estimate yet" };
  });
}
// what rerun_dependents would do, as its plan
export function plan(ref, { through = "boards", chain = "ask" } = {}) {
  const { kind, id } = W.parse(ref), r = W.record(kind, id), stages = stagesOf(ref), stop = STAGES.indexOf(through), name = W.headOf(r)?.body.name ?? id;
  const lines = stages.map((s, i) => ({ stage: s.name, takes: s.takes, swap: { [W.refOf(kind, id)]: { to: "latest" } }, eta_s: s.eta_s, from: s.from, runs: !s.takes.length ? "nothing" : i > stop ? `waits: the chain stops before ${s.name} (through: ${through}); rerun_dependents {through: "${s.name}"} runs them` : i === stages.findIndex((x) => x.takes.length) ? "first" : `after the ${stages.slice(0, i).filter((x) => x.takes.length).at(-1)?.name}' picks${s.name === "boards" ? " (a board cites the plate's new file)" : ""}` }));
  const go = lines.filter((l, i) => l.takes.length && i <= stop), eta = go.reduce((n, l) => n + (l.eta_s ?? 0), 0), { follows, left_out } = staleOf(ref);
  return { ...(follows.length ? { follows } : {}), ...(left_out.length ? { left_out } : {}), runs: `re-run what still uses an older ${name} than v${r.head}: ${lines.filter((l) => l.takes.length).map((l) => `${l.stage} (${l.takes.length})`).join(", ") || "nothing"}; each re-made take lands as a candidate beside the old one; chain ${chain}${chain === "run" ? " (the critic's clean pick applies where the scene says approval: critic)" : " (each stage waits for the picks)"}`,
    stages: lines, eta_s: go.some((l) => l.eta_s != null) ? eta : null, from: go.length ? `about ${Math.round(eta / 60)} min of GPU for ${go.reduce((n, l) => n + l.takes.length, 0)} takes, from their own times` : "nothing runs" };
}

// run one stage: every take re-run on the newest version, one candidates decision per take (its shot keeps its active take)
async function runStage(b, i) {
  const s = b.stages[i], key = b.record;
  s.state = "running"; s.started = Date.now(); s.decisions = []; s.queuing = true; // its picks count once every take is queued
  await save(b);
  for (const x of s.takes) {
    const t = T.get(x.take);
    if (!t) { s.missing = [...(s.missing ?? []), x.take]; continue; }
    const out = await RR.rerun(t, { swaps: { [key]: { to: "latest" } }, seed: b.seed, by: b.by });
    const d = await C.create({ kind: "rerun", target: t.id, title: `Re-run dependents of ${b.name}: ${s.name}, take ${t.number}`, by: b.by, take: t.id, route: "regenerate", seed: b.seed, dependents: { batch: b.id, stage: s.name } }, [{ prompt_id: out.run, label: `on ${b.name} v${b.head}` }]);
    s.decisions.push(d.id);
    await save(b);
  }
  delete s.queuing;
  await save(b);
  step().catch((e) => console.warn(`re-run dependents: ${e.message}`));
  return s;
}
// a picked plate or master becomes the location's next version (the stage's picks flow into the record the boards cite)
async function intoRecord(b, s) {
  if (s.name !== "plates" || !b.record.startsWith("location:")) return [];
  const made = [];
  for (const id of s.decisions) {
    const d = C.get(id), c = d?.applied && C.candidate(d, d.applied.candidate), t = c && T.get(c.take ?? `take-${c.prompt_id}`);
    if (!t) continue;
    const { id: lid, body } = L.locationOf(b.record), was = d.target;
    if (body.master?.from?.take === was) { const out = await L.saveLocation(lid, { ...body, master: { take: t.id, ...(body.master.role ? { role: body.master.role } : {}) } }, { note: `master re-made as take ${t.number} (re-run dependents)`, by: b.by }); made.push(out.ref); }
    for (const p of body.plates ?? []) if (p.from?.take === was) { const { file, from, ...rest } = p; const out = await L.addPlate(b.record, { ...rest, take: t.id, ...(isVideo(t) ? { frame: from.frame } : {}) }, { note: `plate ${p.name} re-made as take ${t.number} (re-run dependents)`, by: b.by }); made.push(out.ref); }
  }
  return made;
}
// a stage is settled when every one of its decisions was applied or closed; then the next stage runs, or the chain stops
const settled = (s) => !s.queuing && s.decisions.every((id) => { const d = C.get(id); return !d || d.status === "applied" || d.status === "closed"; });
let stepping = false;
export async function step() {
  if (stepping) return;
  stepping = true;
  try {
    await Promise.all([load(), C.load(), T.load()]);
    for (const b of batches.filter((x) => x.state === "running")) {
      const i = b.stages.findIndex((s) => s.state === "running"), s = b.stages[i];
      if (!s) continue;
      if (b.chain === "run") await autoPick(s);
      if (!settled(s)) continue;
      s.state = "picked"; s.records = await intoRecord(b, s);
      const next = b.stages.findIndex((x, k) => k > i && x.takes.length);
      if (next < 0) b.state = "done";
      else if (next > STAGES.indexOf(b.through)) { b.state = "held"; b.held = `stopped before ${b.stages[next].name} (through: ${b.through}): rerun_dependents {ref: "${b.record}", through: "${b.stages[next].name}"} runs them`; }
      else { await save(b); await runStage(b, next); continue; }
      await save(b);
    }
  } finally { stepping = false; }
}
// chain run: a candidate whose critique is written with no high note is applied, where its scene says approval: critic
async function autoPick(s) {
  for (const id of s.decisions) {
    const d = C.get(id), c = d?.candidates[0];
    if (!d || d.status !== "open" || c?.state !== "ready") continue;
    const t = T.get(c.take ?? `take-${c.prompt_id}`), r = t && CR.latestOf(t.id);
    if (!r?.done || CR.counts(r).high) continue;
    if ((await CR.approvalOf(t)).approval === "critic") await C.apply(d.id, c.id, "agent");
  }
}
C.onChange(() => { if (batches.some((b) => b.state === "running")) step().catch((e) => console.warn(`re-run dependents: ${e.message}`)); });
CR.onChange(() => { if (batches.some((b) => b.state === "running" && b.chain === "run")) step().catch((e) => console.warn(`re-run dependents: ${e.message}`)); });
load().then(() => step(), () => {});

export async function start(ref, { chain = "ask", through = "boards", seed = "same", by = "person" } = {}) {
  if (!CHAINS.includes(chain)) throw new Error(`chain is one of ${CHAINS.join(", ")}; not ${JSON.stringify(chain)}`);
  if (!STAGES.includes(through)) throw new Error(`through is one of ${STAGES.join(", ")}; not ${JSON.stringify(through)}`);
  await Promise.all([load(), T.load(), W.load(), SC.load(), C.load()]);
  const { kind, id } = W.parse(ref), r = W.record(kind, id), stages = stagesOf(ref);
  const b = { id: `deps-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, record: W.refOf(kind, id), head: r.head, name: W.headOf(r).body.name ?? id, chain, through, seed, by, created: Date.now(), state: "running",
    stages: stages.map((s) => ({ name: s.name, takes: s.takes, eta_s: s.eta_s, state: s.takes.length ? "waiting" : "empty", decisions: [] })) };
  const first = b.stages.findIndex((s) => s.takes.length);
  if (first < 0) return { batch: null, said: `nothing uses an older ${b.name} than v${r.head}` };
  if (first > STAGES.indexOf(through)) return { batch: null, said: `only ${b.stages[first].name} use an older version, and the chain stops before them (through: ${through})` };
  await save(b);
  await runStage(b, first);
  return describe(b);
}
export const describe = (b) => ({ batch: b.id, record: b.record, head: b.head, chain: b.chain, through: b.through, state: b.state, ...(b.held ? { held: b.held } : {}),
  stages: b.stages.map((s) => ({ name: s.name, state: s.state, takes: s.takes.map((x) => x.take), decisions: s.decisions, ...(s.records?.length ? { records: s.records } : {}), ...(s.missing ? { missing: s.missing } : {}), eta_s: s.eta_s })),
  said: `Re-run dependents of ${b.name} v${b.head}: ${b.stages.filter((s) => s.takes.length).map((s) => `${s.name} (${s.takes.length}) ${s.state}`).join(" · ")}${b.held ? ` · ${b.held}` : ""}` });

export const TOOLS = [
  {
    name: "rerun_dependents",
    description: "Re-run what a record's new version should change (U94, SNAP-R106; fix at the source first, SNAP-R105): ref is kind:id (a location or a Cast). The takes pinned to an older version are re-made on the newest, upstream first in stages: plates (stills that are the location's master or plates, or made as plate, master or settei), then boards (other stills), then cuts (video takes); within a stage in scene and shot order. Each re-made take lands as a candidates decision beside the old take (the old one stays active until a pick). A stage starts when the one before it has its picks: a picked plate or master is written into the location as its next version first, so the boards cite the new file. chain: ask (default: each stage waits for the person's picks) or run (a candidate whose critique has no high note is applied by itself where the scene's notes say approval: critic; others wait). through: where the chain stops, boards by default (it stops before video: say through: cuts to run the cuts). plan: each stage's takes, the swap, and the time from their own runs (no estimate yet where none was measured). Uses GPU time: unless the person lets agents run, this waits as a proposal with the plan. list_dependents shows a batch's stages as they go.",
    inputSchema: { type: "object", properties: { ref: { type: "string" }, chain: { type: "string", enum: CHAINS }, through: { type: "string", enum: STAGES }, seed: { type: "string", enum: ["same", "new"] } }, required: ["ref"] },
    annotations: { consequentialHint: true },
    consequential: true,
    plan: async ({ ref, chain, through }) => { await Promise.all([T.load(), W.load(), SC.load()]); return plan(ref, { chain, through }); },
    run: async ({ ref, chain, through, seed }) => ({ ...await start(ref, { chain, through, seed, by: "agent" }), next: "wait_for each decision (until waiting), look with candidate_frames, apply_candidate the ones to keep; the next stage starts by itself after the picks" }),
  },
  {
    name: "list_dependents",
    description: "Re-run dependents batches (U94, SNAP-R106): each with its record and version, chain, through, state (running, held: stopped before a stage by through, done) and its stages (plates, boards, cuts): state (waiting, running, picked, empty), the takes, the decisions to pick from, and the location versions the picks wrote.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async () => { await load(); return batches.map(describe); },
  },
];
