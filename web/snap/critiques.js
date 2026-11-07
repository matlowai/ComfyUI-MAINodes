// The critic as a docket job (U93, DESIGN_U93_U94 §4). Every landed picture gets one critique row in the person's
// critiques store (the server keeps them, snap_critiques.py): a take (a still, a board, a New view candidate, a video
// cut, an upscale), an edit's painted candidate, a location version (its master, plan and each new plate, and every view
// side by side), a Cast version's pictures, and a cut pair (two shots' active takes in a row). A row is due until an agent
// claims it (claim_critique, one claim on the server), reads its packet (critique_packet.js: whole frames at native size,
// then 100% tiles, then context) with the snap-critic skill, and writes the verdict, the passes and its notes
// (write_critique). Each note is mirrored onto the take's notes (by agent, with its severity, pass, region, owner and
// fix), so get_take and the take viewer read them where they read every note. Snap never calls a model (SNAP-R18).
// The Work card shows each row (folded per decision); a due row nobody claimed for five minutes says "no critic on duty".
// Where a scene's or Book's note says "approval: critic", a critique with no high note sets the take's verdict to keep,
// by agent; the person's own verdict always wins. A critique goes stale when its subject was re-made or the part it read
// (a location's master, plan or plate, a Cast's pictures) changed in a later version; a row nobody wrote that went stale
// leaves the due list (state "stale"). Only a record's newest version gets rows, and a location or Cast saved before the
// critic started gets rows for its newest version once (F-E01).
// SNAP-R101 the critic is a docket job · SNAP-R103 notes: severity, pass, region as a mask, owner, fix; they inform · SNAP-R156 the owner's part as written ·
// SNAP-R104 checks by purpose · SNAP-R107 approval: the person's, or the critic's where a note says so · SNAP-R110 stale ·
// SNAP-R17 by: person|agent · SNAP-R58 whole lists, explicit paging · SNAP-R65 the Work card · SNAP-R136 a row holds
// while its part's picture holds; stale rows leave the docket · see docs/snap/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as T from "./takes.js";
import * as C from "./candidates.js";
import * as W from "./world.js";
import * as SC from "./scenes.js";
import * as RT from "./retake.js";
import * as ED from "./edits.js";
import * as I from "./instructions.js";
import * as PK from "./critique_packet.js";

const FPS = 24;
let rows = [], since = null, claimS = 1800, skew = 0, table = null, loading = null, dueAfterS = 300;
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) fn(); };
export const all = () => rows;
export const get = (id) => rows.find((r) => r.id === id) ?? null;
export const sinceAt = () => since;
const now = () => Date.now() + skew;

async function call(path, body) {
  const r = await api.fetchApi(path, body ? { method: "POST", body: JSON.stringify(body) } : undefined), out = await r.json().catch(() => ({ error: `${path} answered ${r.status}` }));
  if (!r.ok || out.error) throw new Error(out.error ?? `${path} answered ${r.status}`);
  return out;
}
export const critic = () => (table ??= call("/mainodes/snap/critic").then((t) => { dueAfterS = t.due_after_s; return t; }, (e) => { table = null; throw e; }));

async function read() {
  const out = await call("/mainodes/snap/critiques");
  skew = out.now - Date.now(); since = out.since; claimS = out.claim_s;
  for (const r of out.rows) { const mine = get(r.id); if (!mine) rows.push(r); else if ((r.updated ?? 0) > (mine.updated ?? 0)) Object.assign(mine, r); }
  rows.sort((a, b) => a.created - b.created);
  changed();
  wake();
}
export function load() { loading ??= read().catch((e) => { loading = null; throw e; }); return loading; }
export const reload = () => read();
// another page or agent wrote a row: read the store again (the server says which row changed)
api.addEventListener("mainodes-snap-critique", () => { read().catch(() => {}); });
// a due row turns into "no critic on duty" after a while: wake the Work card then, nothing polls
let timer = 0;
function wake() {
  clearTimeout(timer);
  critic().then((t) => {
    const next = rows.filter((r) => stateOf(r) === "due").map((r) => r.created + t.due_after_s * 1000).filter((at) => at > now()).sort((a, b) => a - b)[0];
    if (next) timer = setTimeout(changed, next - now() + 50);
  }, () => {});
}

// F-E14: a row nobody wrote whose subject moved on is "stale", not due: the docket and the Work card leave it out
export const stateOf = (r) => (r.skipped ? "skipped" : r.done ? "done" : r.claimed && now() - r.claimed.touched < claimS * 1000 ? "claimed" : staleOf(r) ? "stale" : "due");
export const counts = (r) => ({ high: r.notes.filter((n) => n.severity === "high").length, medium: r.notes.filter((n) => n.severity === "medium").length, low: r.notes.filter((n) => n.severity === "low").length });
export const ofTake = (id) => rows.filter((r) => r.subject.take === id || r.subject.pair?.includes(id));
export const latestOf = (id) => rows.filter((r) => r.subject.take === id).at(-1) ?? null;
export const ofRecord = (ref) => rows.filter((r) => r.subject.kind === "record" && W.parse(r.subject.ref).id === W.parse(ref).id && W.parse(r.subject.ref).kind === W.parse(ref).kind);
export const countText = (r) => { const c = counts(r); return r.verdict === "clean" ? `clean, ${Object.keys(r.passes ?? {}).length} passes` : [c.high && `${c.high} high`, c.medium && `${c.medium} medium`, c.low && `${c.low} low`].filter(Boolean).join(" · ") || "flaws"; };

// ---- what a critique is about, in words, and whether it still holds (SNAP-R110) -------------------------------------
const takeName = (id) => { const t = T.get(id); return t ? `take ${t.number}` : id; };
const recordName = (ref) => { const got = W.get(ref); return got ? `${got.version.body.name} v${got.version.n}` : ref; };
export function subjectText(s) {
  if (s.kind === "take") return takeName(s.take);
  if (s.kind === "candidate") return `${C.get(s.decision)?.title ?? s.decision}, candidate ${s.candidate}`;
  if (s.kind === "pair") return `cut ${takeName(s.pair[0])} → ${takeName(s.pair[1])}`;
  return `${recordName(s.ref)}${s.part === "views" ? ", every view side by side" : s.part ? `, ${s.part}` : ""}`;
}
// the files a part of a record version is: a location's master, plan, map or "plate <name>" (its file and pose), every
// view, or a Cast's pictures. A row holds while these are the same in the newest version (F-E16: v10 kept v4's master)
export function partFiles(body, part) {
  const plate = (p) => p && `${p.file}|${JSON.stringify(p.pose ?? null)}`;
  if (part === "pictures") return JSON.stringify((body?.refs ?? []).map((x) => x.file));
  // F-G06: every view also reads the notes and the camera marks, so a notes-only version gets its own views row
  if (part === "views") return JSON.stringify([body?.master?.file, body?.plan?.file, body?.map?.file, ...(body?.plates ?? []).map(plate), body?.notes ?? "", body?.cameras ?? []]);
  if (["master", "plan", "map"].includes(part)) return body?.[part]?.file ?? null;
  if (part === "marks") return JSON.stringify([body?.cameras ?? [], (body?.plates ?? []).map((p) => [p.name, p.pose ?? null, p.camera ?? null])]); // F-K09: typed numbers, no picture
  if (part === "notes") return JSON.stringify([body?.notes ?? "", body?.scale ?? []]);
  return plate(body?.plates?.find((x) => `plate ${x.name}` === part)) ?? null;
}
const moved = (ref, part) => { const { kind, id, n } = W.parse(ref), rec = W.record(kind, id), head = rec?.head; if (!head || !n || head <= n) return null;
  const was = rec.versions.find((v) => v.n === n)?.body, now = W.headOf(rec).body;
  return !part || partFiles(was, part) !== partFiles(now, part) ? { name: was?.name ?? id, n, head } : null; };
export function staleOf(r) {
  const why = [];
  if (r.subject.kind === "take") {
    const kid = T.all().find((x) => x.parent?.take === r.subject.take && /^(rerun|retake|upscale)/.test(x.parent.method ?? "") && x.created > r.created);
    if (kid) why.push(`its subject was re-made as take ${kid.number}`);
    // F-F11: a candidate passed over is off the docket: its decision was made without it
    const d = decisionOf(r.subject.take), c = d?.candidates.find((x) => x.take === r.subject.take || (x.prompt_id && `take-${x.prompt_id}` === r.subject.take));
    if (c?.state === "rejected") why.push(`candidate ${c.id} was rejected`);
    else if (d?.applied && c && d.applied.candidate !== c.id) why.push(`another candidate (${d.applied.candidate}) was picked`);
  }
  if (r.subject.kind === "record") { const m = moved(r.subject.ref, r.subject.part); if (m) why.push(`${m.name} v${m.n} → v${m.head}: ${r.subject.part === "views" ? "a view" : `its ${r.subject.part}`} changed`); // F-E15: the version it read, then the head
    // F-G06: a later version's written row read the same picture: this one is answered there
    const x = W.parse(r.subject.ref), rec = W.record(x.kind, x.id), body = (n) => rec?.versions.find((v) => v.n === n)?.body, mine = partFiles(body(x.n), r.subject.part);
    const read = rec && !r.done && ofRecord(r.subject.ref).find((o) => o.done && o.subject.part === r.subject.part && W.parse(o.subject.ref).n > x.n && partFiles(body(W.parse(o.subject.ref).n), r.subject.part) === mine);
    if (read) why.push(`read on v${W.parse(read.subject.ref).n} (${read.id}): the same ${r.subject.part === "views" ? "views" : r.subject.part}`); }
  for (const x of r.notes) {
    if (!x.owner?.ref?.includes("@") || (r.subject.kind === "record" && W.parse(x.owner.ref).id === W.parse(r.subject.ref).id)) continue; // the subject's own record moving is said once, above
    const m = moved(x.owner.ref, x.owner.part);
    if (m) why.push(`owner ${m.name} v${m.n} → v${m.head}${x.owner.part ? `: its ${x.owner.part} changed` : ""} (fixed at source?)`);
  }
  return why.length ? [...new Set(why)].join("; ") : null;
}
// the rows that hold for a record version: its own, and earlier versions' rows whose part is unchanged since (F-E16)
export function holding(ref) {
  const { kind, id, n } = W.parse(ref), rec = W.record(kind, id), at = rec?.versions.find((v) => v.n === (n ?? rec.head))?.body;
  return ofRecord(ref).filter((r) => { const { n: rn } = W.parse(r.subject.ref), was = rec?.versions.find((v) => v.n === rn)?.body; return rn === (n ?? rec?.head) || (rn < (n ?? rec?.head) && was && partFiles(was, r.subject.part) === partFiles(at, r.subject.part)); })
    .filter((r, i, all) => !all.slice(i + 1).some((x) => x.subject.part === r.subject.part && (x.done || !r.done))); // the newest row per part, a written one over a due one
}

// ---- the owner of a flaw (SNAP-R105): where it was born, as a record and part when the words name one --------------
// "location master", "plate Pb", "Cast record", "board", "take", "prompt", or kind:id[@n]; a place or a Cast the subject
// pinned resolves to that version
function pinsOf(r) {
  const s = r.subject;
  if (s.kind === "take") return T.get(s.take)?.world ?? {};
  if (s.kind === "pair") return T.get(s.pair[1])?.world ?? {};
  if (s.kind === "record") { const { kind, id, n } = W.parse(s.ref); return { [W.refOf(kind, id)]: { n } }; }
  return {};
}
export function ownerOf(r, owner) {
  if (owner && typeof owner === "object") return owner;
  const words = String(owner ?? "").trim(), pins = pinsOf(r), pinned = (kind) => Object.entries(pins).find(([ref]) => ref.startsWith(`${kind}:`));
  const ref = words.match(/\b(cast|location|card|set_snapshot):[A-Za-z0-9][\w.-]*(@\d+)?/)?.[0];
  if (ref) { const p = W.parse(ref); return { ref: p.n != null ? ref : W.refOf(p.kind, p.id, pins[W.refOf(p.kind, p.id)]?.n ?? W.record(p.kind, p.id)?.head), words }; }
  const loc = pinned("location"), cast = pinned("cast");
  // F-K09 (SNAP-R156): the part a location owner names, as the critic wrote it: plates by their whole name or by their
  // label (the name's first word, "Pb", as the sheet labels them), in the order the words name them; the plan; the master;
  // the record's notes; its camera marks and plate poses (typed numbers, no picture). Words that name none of these are
  // said to be unmapped, never read as the master
  const partOf = (ref) => { const plates = W.get(ref)?.version.body.plates ?? [];
    const word = (x, flags) => new RegExp(`(^|[^\\w])${x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, flags).exec(words), at = (p) => { const tag = p.name.split(/[\s,]/)[0], m = word(p.name, "i") ?? (tag !== p.name ? word(tag, "") : null); return m ? m.index + m[1].length : -1; };
    const named = plates.map((p) => [p.name, at(p)]).filter(([, i]) => i >= 0).sort((a, b) => a[1] - b[1]).map(([n]) => `plate ${n}`);
    if (named.length) return { part: named[0], ...(named.length > 1 ? { parts: named } : {}) };
    if (/\b(poses?|camera marks?|marks?|eye heights?)\b/i.test(words)) return { part: "marks" };
    if (/\bplan\b/i.test(words) && !/\bmaster\b/i.test(words)) return { part: "plan" };
    if (/\bmaster\b/i.test(words)) return { part: "master" };
    if (/\b(notes?|scale)\b/i.test(words)) return { part: "notes" }; // F-E19: "location notes" is the record's words, no picture
    if (/\bmap\b/i.test(words)) return { part: "map" };
    return { part: null, unmapped: `"${words}" names no part of the place (master, plan, plate <name>, notes, camera marks): Fix at source opens the Location sheet` }; };
  if (loc && /\b(master|plan|plates?|location|set|record|notes|marks?|poses?)\b/i.test(words)) { const ref = W.refOf("location", W.parse(loc[0]).id, loc[1].n); return { ref, ...partOf(ref), words }; }
  if (cast && /\bcast\b/i.test(words)) return { ref: W.refOf("cast", W.parse(cast[0]).id, cast[1].n), words };
  if (r.subject.kind === "record" && r.subject.ref.startsWith("location:") && /\b(master|plan|plates?|location|record|notes|marks?|poses?|map)\b/i.test(words)) return { ref: r.subject.ref, ...partOf(r.subject.ref), words };
  return { what: /\bprompt\b/i.test(words) ? "prompt" : /\bboard\b/i.test(words) ? "board" : "take", words: words || "take" };
}

// ---- making rows (SNAP-R101, R104): one per subject, idempotent on the server -----------------------------------------
const asking = new Set();
async function due(key, spec) {
  if (asking.has(key) || rows.some((r) => r.key === key)) return null;
  asking.add(key);
  try { const out = await call("/mainodes/snap/critique/due", { key, ...spec }); if (!get(out.critique.id)) rows.push(out.critique); changed(); wake(); return out.critique; } finally { asking.delete(key); }
}
// the checklist a take is read with: its purpose (SNAP-R85), a cut, an upscale, a board in a shot, else a still
export async function checklistOf(t) {
  const tb = await critic(), video = t.media.some((m) => m.kind === "video"), p = ED.purposeOf(t)?.purpose;
  if (/^upscale\//.test(t.parent?.method ?? "")) return { purpose: p ?? null, checklist: "upscale" };
  if (video) return { purpose: p ?? null, checklist: "cut" };
  if (p && tb.purpose_checklist[p]) return { purpose: p, checklist: tb.purpose_checklist[p] === "board" && !RT.shotOf(t) ? "still" : tb.purpose_checklist[p] };
  return { purpose: p ?? null, checklist: RT.shotOf(t) ? "board" : "still" };
}
const decisionOf = (id) => C.all().find((d) => d.candidates.some((c) => c.take === id || (c.prompt_id && `take-${c.prompt_id}` === id))) ?? null;
// F-F11: a row says where its take is and what made it, so the compact docket can be worked without the full rows
export function titleOf(t) {
  const h = RT.shotOf(t), d = decisionOf(t.id);
  return `Critic: ${h ? `${h.scene.name} › ${SC.shotTitle(h.scene, h.shot)} › ` : ""}take ${t.number}${t.seed != null ? ` (seed ${t.seed})` : ""}${d ? ` · ${d.title}` : ""}`;
}
const titleNow = (r) => (r.subject.kind === "take" && T.get(r.subject.take) ? titleOf(T.get(r.subject.take)) : r.title); // rows made before G4 said only "take n"
const aboutTake = (t) => { const h = RT.shotOf(t), d = decisionOf(t.id); return { take: t.id, ...(d ? { decision: d.id } : {}), ...(h ? { scene: h.scene.id, shot: h.shot.id } : {}) }; };
export async function forTake(t, { trigger = "landed", again = false, context, by = "snap" } = {}) {
  const { purpose, checklist } = await checklistOf(t);
  if (again) { const out = await call("/mainodes/snap/critique/due", { key: `take:${t.id}`, subject: { kind: "take", take: t.id }, title: titleOf(t), purpose, checklist, trigger, about: aboutTake(t), again: true, context, by }); rows.push(out.critique); changed(); wake(); return out.critique; }
  return due(`take:${t.id}`, { subject: { kind: "take", take: t.id }, title: titleOf(t), purpose, checklist, trigger, about: aboutTake(t), ...(context ? { context } : {}), by });
}
const landedAt = (t) => t.finished ?? t.created;
const critiquable = (t) => t.status === "success" && !t.locked && t.media.some((m) => m.kind === "image" || m.kind === "video");
async function scanTakes() {
  if (since == null) return;
  // F-F18: a louder copy is its parent's picture as it was: the parent's critique holds for it (a pair still reads it)
  for (const t of T.all()) if (critiquable(t) && t.parent?.method !== "louder" && landedAt(t) >= since && !rows.some((r) => r.key === `take:${t.id}`)) await forTake(t).catch((e) => console.warn(`critic: ${e.message}`));
}
async function scanCandidates() {
  if (since == null) return;
  for (const d of C.all()) for (const c of d.candidates) {
    if (c.state !== "ready" || c.take || c.prompt_id && T.get(`take-${c.prompt_id}`) || !c.pictures.length || (d.updated ?? d.created) < since || d.kind === "rerun" || d.kind === "view" || d.kind === "sheet") continue;
    await due(`candidate:${d.id}/${c.id}`, { subject: { kind: "candidate", decision: d.id, candidate: c.id }, title: `Critic: ${d.title}, ${c.id}`, checklist: d.kind === "plate" ? "plate" : "edit", trigger: "landed", about: { decision: d.id, ...(d.take ? { take: d.take } : {}) } }).catch((e) => console.warn(`critic: ${e.message}`));
  }
}
// a location version: its master, its plan and each plate that changed or came new, and one row for every view side by
// side when any did; a Cast version whose pictures changed: one sheet row
// F-E14: only the newest version gets rows (a place built plate by plate made a row set per plate, all stale at once).
// F-E01: a record whose newest version was saved before the critic started (an import, an older install) and has no
// row at all gets one set for that version, said as such; a part a written row of an earlier version still holds for
// (its picture unchanged, F-E16) gets none
async function scanRecords() {
  if (since == null) return;
  const ask = (key, spec) => due(key, spec).catch((e) => console.warn(`critic: ${e.message}`));
  for (const r of W.all("location")) {
    const v = W.headOf(r), old = v.at < since;
    if (old && rows.some((x) => x.subject.kind === "record" && W.parse(x.subject.ref).id === r.id)) continue;
    const b = v.body, ref = W.refOf("location", r.id, v.n), held = new Set(holding(ref).map((x) => x.subject.part)), parts = [];
    if (b.master) parts.push(["master", "master"]);
    if (b.plan) parts.push(["plan", "plan"]);
    for (const p of b.plates ?? []) parts.push([`plate ${p.name}`, "plate"]);
    const todo = parts.filter(([part]) => !held.has(part));
    if (!held.has("views")) todo.push(["views", "location"]); // F-G06: a notes or marks change alone makes a views row too
    for (const [part, checklist] of todo) await ask(`record:${ref}:${part}`, { subject: { kind: "record", ref, part }, title: `Critic: ${b.name} v${v.n}${part === "views" ? ", every view side by side" : `, ${part}`}${old ? " (saved before the critic started)" : ""}`, purpose: checklist === "location" ? null : checklist, checklist, trigger: old ? "existing" : "saved", about: {} });
  }
  for (const r of W.all("cast")) {
    const v = W.headOf(r), old = v.at < since, ref = W.refOf("cast", r.id, v.n);
    if (!(v.body.refs ?? []).length || holding(ref).length || (old && rows.some((x) => x.subject.kind === "record" && W.parse(x.subject.ref).id === r.id))) continue;
    await ask(`record:${ref}:pictures`, { subject: { kind: "record", ref, part: "pictures" }, title: `Critic: ${v.body.name} v${v.n}, its pictures${old ? " (saved before the critic started)" : ""}`, purpose: "cast_picture", checklist: "sheet", trigger: old ? "existing" : "saved", about: {} });
  }
}
// a cut pair: two shots in a row with active takes; made when the later one became active after the critic started
async function scanPairs() {
  if (since == null) return;
  for (const s of SC.all()) for (let i = 1; i < s.shots.length; i++) {
    const a = T.get(s.shots[i - 1].active), b = T.get(s.shots[i].active);
    if (!a || !b || !critiquable(a) || !critiquable(b) || Math.max(landedAt(a), landedAt(b)) < since) continue;
    if (!s.book && ![a, b].every((x) => x.media.some((m) => m.kind === "video"))) continue; // F-F11: two stills in a row (a front and a back sheet) are no cut
    await due(`pair:${a.id}|${b.id}`, { subject: { kind: "pair", pair: [a.id, b.id] }, title: `Critic: cut take ${a.number} → take ${b.number}`, checklist: "cut_pair", trigger: "active", about: { take: b.id, scene: s.id, shot: s.shots[i].id } }).catch((e) => console.warn(`critic: ${e.message}`));
  }
}
let scanning = null, again = false;
function scan() {
  if (scanning) { again = true; return scanning; }
  scanning = (async () => { await load(); await scanTakes(); await scanCandidates(); await scanRecords(); await scanPairs(); })().catch((e) => console.warn(`critic: ${e.message}`)).finally(() => { scanning = null; if (again) { again = false; scan(); } });
  return scanning;
}
T.onChange(() => scan());
C.onChange(() => scan());
W.onChange(() => scan());
SC.onChange(() => scan());
Promise.all([T.load(), C.load(), W.load(), SC.load()]).then(() => scan(), () => {});

// ---- claim, write, skip (the agent's side) -----------------------------------------------------------------------------
async function put(out) { const mine = get(out.critique.id); if (mine) Object.assign(mine, out.critique); else rows.push(out.critique); changed(); wake(); return mine ?? out.critique; }
export async function claim(id, by, { release = false } = {}) { await load(); return put(await call("/mainodes/snap/critique/claim", { id, by, release })); }
export async function skip(id, by, why) { await load(); return put(await call("/mainodes/snap/critique/update", { id, set: { skipped: { by, why, at: now() } } })); }
export const pin = async (id, packet) => put(await call("/mainodes/snap/critique/update", { id, set: { packet } }));

// a note's region as the subject's own fractions: a region given on a tile is mapped through the tile's pixel box
function placed(r, n) {
  const pics = r.packet?.pictures ?? [], p = pics[n.picture ?? 0];
  if (!p) return { picture: 0, ...(n.region ? { region: n.region } : {}) };
  const whole = p.tile ? pics[p.tile.of] : p, at = p.tile ? p.tile.of : n.picture ?? 0;
  const region = n.region && p.tile ? [(p.tile.box[0] + n.region[0] * p.tile.box[2]) / whole.width, (p.tile.box[1] + n.region[1] * p.tile.box[3]) / whole.height, (n.region[2] * p.tile.box[2]) / whole.width, (n.region[3] * p.tile.box[3]) / whole.height].map((x) => +Math.min(1, Math.max(0, x)).toFixed(4)) : n.region;
  return { picture: at, ...(whole.frame != null ? { frame: whole.frame } : {}), ...(whole.take ? { take: whole.take } : {}), ...(region ? { region } : {}) };
}
const TAG = { scan: "artifacts", map: "set logic", support: "unheld", cast: "identity drift", beat: "prompt ignored", cross_view: "continuity", cut_pair: "continuity" };
// "approval: critic" in the subject's scene or Book stack lets a critique with no high note keep it (SNAP-R107)
export async function approvalOf(t) {
  const h = t && RT.shotOf(t);
  if (!h) return { approval: "person", from: "not in a scene: the person approves" };
  const st = (await I.answer(await I.contextOf(`shot:${h.scene.id}/${h.shot.id}`))).stack, said = st.filter((n) => /^\s*approval:\s*(critic|person)\b/i.test(n.text ?? "")).at(-1);
  return said ? { approval: said.text.match(/approval:\s*(critic|person)/i)[1].toLowerCase(), from: said.ref } : { approval: (await critic()).approval.default, from: "the pack default" };
}
export async function write(id, by, { verdict, passes = {}, notes = [] }) {
  await load();
  const r = get(id);
  if (!r) throw new Error(`No critique ${id} (list_critiques lists them)`);
  const out = notes.map((n, i) => ({ id: `cn${i + 1}`, severity: n.severity, pass: n.pass, text: n.text, ...placed(r, n), owner: ownerOf(r, n.owner), ...(n.fix ? { fix: n.fix } : {}), ...(n.mask ? { mask: n.mask } : {}), tags: [...new Set([TAG[n.pass], ...(n.tags ?? [])].filter(Boolean))], by, at: new Date(now()).toISOString() }));
  const done = await put(await call("/mainodes/snap/critique/write", { id, by, verdict, passes, notes: out }));
  // mirror each note onto the take it is about (SNAP-R103): one place agents and the viewer read notes
  const mirrored = [];
  for (const n of out) {
    const take = T.get(n.take ?? r.subject.take ?? (r.subject.kind === "pair" ? r.subject.pair[1] : null));
    if (!take) continue;
    take.notes.push({ id: `${r.id}-${n.id}`, t: n.frame != null ? +(n.frame / FPS).toFixed(3) : 0, ...(n.region ? { region: n.region } : {}), sentiment: "wrong", severity: n.severity, pass: n.pass, tags: n.tags, text: n.text, owner: n.owner, ...(n.fix ? { fix: n.fix } : {}), ...(n.mask ? { mask: n.mask } : {}), by: "agent", agent: by, critique: r.id, at: n.at });
    await T.save(take);
    mirrored.push(`${take.id}:${r.id}-${n.id}`);
  }
  if (r.subject.kind === "candidate") { const d = C.get(r.subject.decision), c = C.candidate(d, r.subject.candidate); if (c) await C.note(d, c, "critic", { critique: r.id, verdict, ...counts(done) }); }
  let verdict_set = null;
  const t = r.subject.kind === "take" ? T.get(r.subject.take) : null;
  if (t) {
    const a = await approvalOf(t);
    if (a.approval === "critic" && !counts(done).high && !(t.verdict && t.verdict_by !== "agent")) {
      t.verdict = "keep"; t.verdict_by = "agent"; t.verdict_note = `critic: ${verdict === "clean" ? "clean" : "no high notes"} (critique ${r.id})`; await T.save(t);
      verdict_set = { take: t.id, verdict: "keep", by: "agent", because: a.from };
    } else verdict_set = { take: t.id, verdict: null, because: a.approval === "person" ? `approval is the person's (${a.from})` : counts(done).high ? "a high note: the person decides" : "the person already set a verdict" };
  }
  await put(await call("/mainodes/snap/critique/update", { id, set: { mirrored, ...(verdict_set ? { verdict_set } : {}) } }));
  return get(id);
}

// what an agent reads of a row (whole, SNAP-R58)
export const describe = (r) => ({ critique: r.id, title: titleNow(r), subject: r.subject, about: r.about, purpose: r.purpose, checklist: r.checklist, trigger: r.trigger, state: stateOf(r), created: new Date(r.created).toISOString(),
  claimed: r.claimed ? { by: r.claimed.by, at: new Date(r.claimed.at).toISOString() } : null, done: r.done ? { by: r.done.by, at: new Date(r.done.at).toISOString() } : null, ...(r.skipped ? { skipped: r.skipped } : {}),
  ...(r.context ? { context: r.context } : {}), verdict: r.verdict, passes: r.passes, notes: r.notes, ...(r.done ? { counts: counts(r) } : {}), ...(r.verdict_set ? { verdict_set: r.verdict_set } : {}), ...(r.private ? { private: "its notes' words are on the take (private: sealed with it); get_take reads them once the vault is open" } : {}),
  ...(r.packet ? { packet: { pictures: r.packet.pictures.length, at: r.packet.at } } : {}), stale: staleOf(r), ...(r.replaces ? { replaces: r.replaces } : {}) });

// ---- the Work card's rows (SNAP-R65): one per critique, folded per decision -----------------------------------------
const STATE = { due: "queued", claimed: "running", done: "done", skipped: "failed" };
// the decision a row's take is a candidate of, as the store says now (a take can land before its decision is written)
const decisionKey = (r) => r.about.decision ?? (r.subject.take ? decisionOf(r.subject.take)?.id : null) ?? null;
export function rowsFor(whereOf) {
  const one = (list) => {
    const r = list.at(-1), states = list.map(stateOf), c = list.filter((x) => x.done).map(counts).reduce((a, b) => ({ high: a.high + b.high, medium: a.medium + b.medium, low: a.low + b.low }), { high: 0, medium: 0, low: 0 });
    const st = states.includes("claimed") ? "claimed" : states.includes("due") ? "due" : states.every((s) => s === "skipped") ? "skipped" : "done";
    const late = st === "due" && list.some((x) => stateOf(x) === "due" && now() - x.created > dueAfterS * 1000);
    const d = list.length > 1 ? C.get(decisionKey(r)) : null, rec = list.length > 1 && r.subject.kind === "record" ? r.subject.ref : null, take = r.subject.take ? T.get(r.subject.take) : null, stale = list.map(staleOf).find(Boolean);
    const said = st === "due" ? (late ? `critique due · no critic on duty${list.length > 1 ? ` (${states.filter((s) => s === "due").length} of ${list.length})` : ""}` : "critique due · waiting for a critic")
      : st === "claimed" ? `${list.find((x) => stateOf(x) === "claimed").claimed.by} is reading it`
      : st === "skipped" ? `skipped: ${r.skipped?.why ?? ""}` : `${list.length > 1 ? `${list.filter((x) => x.done).length} of ${list.length} read · ` : ""}${c.high || c.medium || c.low ? [c.high && `${c.high} high`, c.medium && `${c.medium} medium`, c.low && `${c.low} low`].filter(Boolean).join(" · ") : "clean"}${stale ? ` · stale: ${stale}` : ""}`;
    return { id: d ? `crd:${d.id}` : rec ? `crr:${rec}` : `cr:${r.id}`, source: "critique", critiques: list.map((x) => x.id), kind: "critique", title: d ? `Critic: ${list.length} candidates of ${d.title}` : rec ? `Critic: ${recordName(rec)}, ${list.length} pictures (each, then every view side by side)` : titleNow(r),
      by: list.some((x) => x.claimed) ? "agent" : "snap", owner: "agents", state: STATE[st],
      about: { ...r.about }, where: r.subject.kind === "record" ? `${W.parse(r.subject.ref).kind} ${recordName(r.subject.ref)}` : whereOf(r.about), queued_at: list[0].created, started_at: list.find((x) => x.claimed)?.claimed.at ?? null, eta_s: null, said, ...(late ? { no_critic: true } : {}),
      ...(st === "skipped" ? { error: `skipped by ${r.skipped?.by}: ${r.skipped?.why}` } : {}),
      result: st === "done" ? { critique: r.id, verdict: c.high || c.medium || c.low ? "flaws" : "clean", ...c, ...(take ? { take: take.id, number: take.number } : {}), said: `${c.high ? `${c.high} high note${c.high > 1 ? "s" : ""}` : c.medium || c.low ? "no high notes" : "clean"}${stale ? ` · stale: ${stale}` : ""}` } : null };
  };
  const groups = new Map();
  // F-E14: a stale unwritten row is off the card (list_critiques {state: "stale"})
  for (const r of rows) { if ((Date.now() - (r.updated ?? r.created) > 86400000 && stateOf(r) !== "due") || stateOf(r) === "stale") continue; const k = decisionKey(r) ?? (r.subject.kind === "record" ? `rec:${r.subject.ref}` : r.id); groups.set(k, [...(groups.get(k) ?? []), r]); } // a decision's candidates, a record version's pictures: one row each
  return [...groups.values()].map(one);
}
// the Work card's foot line: due rows nobody claims say so, with what the critic has agreed on
export function footLine() {
  const d = rows.filter((r) => stateOf(r) === "due"), late = d.filter((r) => now() - r.created > dueAfterS * 1000);
  return d.length ? `${d.length} critique${d.length === 1 ? "" : "s"} due${late.length ? " · no critic on duty" : ""}` : rows.length ? `critic: nothing due · ${rows.filter((r) => r.done).length} read` : "";
}

// ---- the packet (critique_packet.js), pinned on the row so a note's region maps back and a fixture can be re-made ------
export async function packet(id, { part = "all", offset = 0, limit } = {}) {
  await load();
  const r = get(id);
  if (!r) throw new Error(`No critique ${id} (list_critiques lists them)`);
  if (!PK.PARTS.includes(part)) throw new Error(`part is one of ${PK.PARTS.join(", ")}; not ${JSON.stringify(part)}`);
  const tb = await critic(), out = await PK.build(r, tb), at = now();
  if (!r.done) await pin(id, { pictures: out.pictures, words: out.words, at });
  const keep = out.pictures.map((p, i) => [p, out.images[i], i]).filter(([p]) => part === "all" || (part === "whole" ? p.role === "subject" : part === "tiles" ? p.role === "tile" : p.role === "context"));
  const page = keep.slice(offset, limit == null ? undefined : offset + limit), shown = page.filter(([, img]) => img), at_ = new Map(shown.map(([, , i], k) => [i, k]));
  return { critique: r.id, title: r.title, state: stateOf(r), part, skill: { name: "snap-critic", read: "read_skill {name: \"snap-critic\"} for the prompt, then read_skill {name: \"snap-critic\", file: \"reference.md\"} for this checklist's section", section: r.checklist },
    words: out.words, pictures: keep.map(([p, , i]) => ({ index: i, ...p, ...(at_.has(i) ? { image: at_.get(i) } : {}) })), of: out.pictures.length, count: keep.length, offset, ...(limit != null && offset + page.length < keep.length ? { next: { part, offset: offset + page.length, limit } } : {}),
    images: shown.map(([p, img, i]) => ({ ...img, label: `#${i} ${p.label}` })),
    write: "write_critique {critique, verdict, passes: {scan, map, …: one line each}, notes: [{severity, pass, text, picture: <#index the region is drawn on>, region: [x, y, w, h] in that picture's fractions, owner, fix}]}" };
}

// ---- agreement with the person (SNAP-R108): a reading over takes, decisions and critiques, kept once a day -------------
const iou = (a, b) => { if (!a || !b) return 0; const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])), y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])), i = x * y; return i / (a[2] * a[3] + b[2] * b[3] - i || 1); };
export async function report({ since: from } = {}) {
  await Promise.all([load(), T.load(), C.load()]);
  const start = from ? Date.parse(from) : now() - 7 * 86400000, done = rows.filter((r) => r.done && r.done.at >= start), byTake = new Map();
  for (const r of done) if (r.subject.take) byTake.set(r.subject.take, r);
  const verdicts = [...byTake].map(([id, r]) => [T.get(id), r]).filter(([t]) => t?.verdict && t.verdict !== "neither" && t.verdict_by !== "agent")
    .map(([t, r]) => ({ take: t.id, number: t.number, person: t.verdict, critic: counts(r).high ? "flaws (high)" : "no high", agree: t.verdict === "keep" ? !counts(r).high : !!counts(r).high, critique: r.id }));
  const picks = C.all().filter((d) => d.applied?.by === "person" && d.candidates.length > 1).map((d) => {
    const scored = d.candidates.map((c) => ({ c, r: byTake.get(c.take ?? `take-${c.prompt_id}`) })).filter((x) => x.r);
    if (scored.length < 2) return null;
    const key = (x) => [counts(x.r).high, counts(x.r).medium, counts(x.r).low], best = scored.slice().sort((a, b) => key(a)[0] - key(b)[0] || key(a)[1] - key(b)[1] || key(a)[2] - key(b)[2])[0], applied = scored.find((x) => x.c.id === d.applied.candidate);
    return applied && { decision: d.id, title: d.title, applied: applied.c.id, cleanest: best.c.id, agree: counts(applied.r).high === counts(best.r).high };
  }).filter(Boolean);
  const misses = [];
  for (const [id, r] of byTake) { const t = T.get(id); for (const n of t?.notes ?? []) if (n.by === "person" && n.sentiment === "wrong" && Date.parse(n.at) >= r.done.at && !r.notes.some((x) => iou(x.region, n.region) >= 0.1 || (x.tags ?? []).some((g) => n.tags?.includes(g))))
    misses.push({ take: t.id, number: t.number, note: n.id, text: n.text, region: n.region ?? null, tags: n.tags, critique: r.id, fixture: n.fixture ?? null }); }
  const score = await api.getUserData("snap/critic_report/fixtures.json").then((x) => (x.ok ? x.json() : null), () => null);
  const ok = (l) => l.filter((x) => x.agree).length;
  const out = { since: new Date(start).toISOString(), critiques: done.length, due: rows.filter((r) => stateOf(r) === "due").length, verdicts: { agree: ok(verdicts), of: verdicts.length, rows: verdicts }, picks: { agree: ok(picks), of: picks.length, rows: picks }, misses,
    fixtures: score ?? { said: "no fixtures run recorded on this install (tests/snap/critic/run_fixtures.py score --port records one)" },
    said: `critic agreed with you on ${ok(verdicts)}/${verdicts.length} verdicts and ${ok(picks)}/${picks.length} picks; ${misses.length} miss${misses.length === 1 ? "" : "es"}${misses.length ? `, ${misses.filter((m) => m.fixture).length} now fixtures` : ""}${score ? `; fixtures ${score.caught}/${score.of} caught, ${score.fa} false alarms (${score.at?.slice(0, 10)})` : ""}` };
  await api.storeUserData(`snap/critic_report/${new Date(now()).toISOString().slice(0, 10)}.json`, out, { overwrite: true, stringify: true }).catch(() => {});
  return out;
}

// ---- Add as fixture (SNAP-R108): a note the person wrote (or one the critic wrote, marked) becomes a fixture -----------
export async function addFixture({ take: id, note: nid, polarity, words = "", by = "person" }) {
  await Promise.all([load(), T.load()]);
  const t = T.get(id);
  if (!t) throw new Error(`No take ${id}`);
  const n = nid ? t.notes.find((x) => x.id === nid) : null;
  if (nid && !n) throw new Error(`Take ${t.number} has no note ${nid}`);
  if (T.locked(t) || t.kept_encrypted) throw new Error(`Take ${t.number} is private: it can't become a fixture (fixtures are plain files)`);
  const m = t.media.find((x) => x.kind === "image"), video = !m;
  const picture = video ? `input/${(await T.frameAt(t, n?.t ?? "last", { frame: n?.t != null ? Math.round(n.t * FPS) : undefined })).file}` : pathOf(m);
  const r = latestOf(t.id), { checklist } = await checklistOf(t), tb = await critic();
  const where = n?.region ? `box x ${n.region[0].toFixed(2)}, y ${n.region[1].toFixed(2)}, w ${n.region[2].toFixed(2)}, h ${n.region[3].toFixed(2)} of the frame` : "the whole frame";
  const pol = polarity ?? (n ? "positive" : "negative");
  const out = await call("/mainodes/snap/critique/fixture", { picture, polarity: pol, what: `${tb.checklists[checklist]?.label ?? checklist} (take ${t.number}${video ? `, frame ${Math.round((n?.t ?? 0) * FPS)}` : ""})`, context: t.text ?? "",
    expected: pol === "positive" && n ? [{ flaw: n.text || n.tags.join(", "), where, severity: n.severity ?? "high", owner: typeof n.owner === "object" ? n.owner.ref ?? n.owner.words ?? n.owner.what : n.owner ?? "" }] : [], note: words || n?.text || "", by, from: { take: t.id, ...(n ? { note: n.id } : {}), ...(r ? { critique: r.id } : {}) } });
  if (n) { n.fixture = { id: out.fixture.id, at: new Date(now()).toISOString() }; await T.save(t); }
  if (r) await put(await call("/mainodes/snap/critique/update", { id: r.id, set: { fixtures: [...(r.fixtures ?? []), out.fixture.id] } }));
  return { fixture: out.fixture.id, polarity: pol, picture, file: out.file, count: out.count, said: `Fixture ${out.fixture.id} added (${out.count} of yours): the critic is measured on it from the next fixtures run` };
}
const pathOf = (m) => [m.type, m.subfolder, m.filename].filter(Boolean).join("/");

// ---- the tools (spread into tools.js TOOLS): one table, two transports (SNAP-R15) --------------------------------------
const STATES = ["due", "claimed", "done", "skipped", "stale"];
const NOTE = { type: "object", properties: { severity: { type: "string", enum: ["high", "medium", "low"] }, pass: { type: "string", enum: ["scan", "map", "support", "cast", "beat", "cross_view", "cut_pair"] }, text: { type: "string" },
  picture: { type: "integer", minimum: 0, description: "the packet picture (#index) the region is drawn on: a whole frame, a tile or a context picture; default 0" }, region: { type: "array", items: { type: "number", minimum: 0, maximum: 1 }, minItems: 4, maxItems: 4, description: "[x, y, w, h] in fractions of that picture, from its top left" },
  owner: { description: "where the flaw was born (fix at the source): \"location master\", \"plan\", \"plate <name>\", \"location notes\", \"camera marks\", \"Cast record\", \"board\", \"take\", \"prompt\", or a record kind:id[@n]" }, fix: { type: "string" }, tags: { type: "array", items: { type: "string" } } }, required: ["severity", "pass", "text"] };
const agentName = () => I.by();
export const TOOLS = [
  {
    name: "list_critiques",
    description: "The critic's docket (U93, SNAP-R101): one critique row per landed picture: a take (a still, a board, a New view candidate, a video cut, an upscale), an edit's painted candidate, a location version (its master, plan, each new plate, and every view side by side), a Cast version's pictures, a cut pair (two shots' active takes in a row). Each row: critique (its id), title, subject {kind: take | candidate | record | pair, …}, about, purpose, checklist (what is read and how: master, plate, location, plan, settei, sheet, board, cut, cut_pair, upscale, edit, still), state (due: nobody claimed it; claimed: an agent reads it; done; skipped; stale: nobody wrote it and the part it was to read changed since, so it is off the docket and the Work card (F-E14)), claimed/done {by, at}, verdict (clean | flaws), passes, notes (each: severity, pass, text, region [x, y, w, h] as fractions of the subject picture, picture, frame, owner {ref, part} or {what}, fix, by), counts, verdict_set (what the approval rule did), stale (why it no longer holds: its subject was re-made, or the part it read (a location's master, plan, map or plate, a Cast's pictures) changed in a later version (\"v2 → v10: its master changed\"); a row whose part is unchanged still holds for the newer version; null when it holds). A location or Cast saved before the critic started gets rows for its newest version once (trigger existing). Filter by state, take, ref (one record's rows: location:<id> or cast:<id>, @n for one version), checklist, stale; offset and limit page it (nothing is cut otherwise); compact: true lists each row as {critique, title, state, checklist, what} only, to scan a long docket (the whole row is one list_critiques {take} away). To work the docket: claim_critique, critique_packet, then write_critique.",
    inputSchema: { type: "object", properties: { state: { type: "string", enum: STATES }, take: { type: "string" }, ref: { type: "string", description: "a record (location:<id> or cast:<id>, any version, or kind:id@n for one): its own rows (every part of every version)" }, checklist: { type: "string" }, stale: { type: "boolean" }, compact: { type: "boolean" }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1 } } },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    run: async ({ state, take, ref, checklist, stale, compact, offset = 0, limit } = {}) => {
      await Promise.all([load(), T.load(), W.load()]);
      // F-G11: one record's rows in a long docket: ref matches a row about that record (any version unless @n is given)
      const of = ref && W.parse(ref), mine = (r) => { if (r.subject.kind !== "record") return false; const x = W.parse(r.subject.ref); return x.kind === of.kind && x.id === of.id && (of.n == null || x.n === of.n); };
      const match = rows.filter((r) => (!state || stateOf(r) === state) && (!take || r.subject.take === take || r.subject.pair?.includes(take)) && (!ref || mine(r)) && (!checklist || r.checklist === checklist) && (stale == null || !!staleOf(r) === stale));
      const page = match.slice(offset, limit == null ? undefined : offset + limit);
      return { rows: page.map((r) => (compact ? { critique: r.id, title: titleNow(r), state: stateOf(r), checklist: r.checklist, what: r.context?.what ?? subjectText(r.subject) } : describe(r))), count: match.length, offset, ...(limit != null && offset + page.length < match.length ? { next: { offset: offset + page.length, limit } } : {}),
        states: Object.fromEntries(STATES.map((s) => [s, rows.filter((r) => stateOf(r) === s).length])), since: since ? new Date(since).toISOString() : null };
    },
  },
  {
    name: "claim_critique",
    description: "Claim one critique row to read it (SNAP-R101): critique is its id, or leave it out for the oldest due row. One agent holds a row at a time (the server keeps the claim; a second agent is refused, naming the holder); the claim lapses when nobody touches the row for 30 minutes, and release: true lets it go. Then critique_packet {critique} gives what to read, and write_critique writes the verdict.",
    inputSchema: { type: "object", properties: { critique: { type: "string" }, release: { type: "boolean" } } },
    direct: true,
    run: async ({ critique: id, release } = {}) => {
      await load();
      const r = id ? get(id) : rows.find((x) => stateOf(x) === "due");
      if (!r) throw new Error(id ? `No critique ${id} (list_critiques lists them)` : "Nothing is due: every critique is claimed, written or skipped (list_critiques)");
      const out = await claim(r.id, agentName(), { release });
      return { ...describe(out), next: release ? null : `critique_packet {critique: "${r.id}"}, read it with the snap-critic skill, then write_critique` };
    },
  },
  {
    name: "critique_packet",
    description: "What a critique reads (SNAP-R102): the subject WHOLE at its native size first (every frame named: a still, a video's 5 spread frames, a cut pair's two frames, a location's picture, every view of a location side by side), then 100% tiles of each subject picture bigger than the tile size (1536 px; a cut's first and last frames, every picture of a still, each view of a sheet), each labelled with its grid cell and pixel box, then the context pictures whole (the location's master, plan and the plates the shot cited, the Cast pictures pinned, the previous cut's last frame, the take an upscale or edit came from, pictures the row was asked with), then words: checklist, label, passes, purpose, prompt (the beat), shot, pins with each Cast's details and each location's notes, who_should_be_here, sound. pictures lists every picture with its #index, role (subject | tile | context), path, size, frame, tile {of, cell, box} and image (its place in this answer's images; snapcall saves them in that order); images carry them, labelled #index. part (all | whole | tiles | context), offset and limit page the images (nothing is cut otherwise). Read the WHOLE frames before any tile. Read the prompt with read_skill {name: \"snap-critic\"} and this checklist's section of its reference.md.",
    inputSchema: { type: "object", properties: { critique: { type: "string" }, part: { type: "string", enum: ["all", "whole", "tiles", "context"] }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1 } }, required: ["critique"] },
    direct: true, // it pins what was read on the row; nothing else changes
    run: ({ critique: id, part, offset, limit }) => packet(id, { part, offset, limit }),
  },
  {
    name: "write_critique",
    description: "Write a critique (SNAP-R103): verdict clean | flaws, passes {scan, map, support, cast, beat, cross_view, cut_pair} (one line each of what the pass found, the r3 prompt's passes: line), and notes, each {severity: high | medium | low, pass, text (the flaw in a sentence), picture (the packet #index the region is drawn on, default 0), region [x, y, w, h] in that picture's fractions (a region on a tile is stored in the subject's own fractions), owner (where it was born: \"location master\", \"plan\", \"plate <name>\" (several plates: the first named is the part, parts lists all), \"location notes\", \"camera marks\" (typed poses and marks), \"Cast record\", \"board\", \"take\", \"prompt\", or kind:id[@n]; words naming a place or Cast the subject pinned resolve to that version and part (owner {ref, part, parts}); words that name no part are kept with part null and listed in owners_unmapped, never read as the master: F-K09, SNAP-R156), fix (one line)}. Only the claimer writes (claim_critique first). Each note lands on the take it is about (get_take notes: by agent, with severity, pass, region, owner, fix and the critique id) and is drawn there as a mask; notes inform and never block (SNAP-R23). Where the scene's notes say \"approval: critic\" (instructions {scope: \"scene:<id>\"}) a critique with no high note sets the take's verdict to keep, by agent; a high note sets nothing; the person's own verdict is never overwritten (SNAP-R107). A clean verdict is a valid answer: write it with no notes.",
    inputSchema: { type: "object", properties: { critique: { type: "string" }, verdict: { type: "string", enum: ["clean", "flaws"] }, passes: { type: "object", properties: Object.fromEntries(["scan", "map", "support", "cast", "beat", "cross_view", "cut_pair"].map((k) => [k, { type: "string" }])) }, notes: { type: "array", items: NOTE } }, required: ["critique", "verdict"] },
    direct: true, // notes only: the person's verdicts and picks stay theirs (SNAP-R17)
    run: async ({ critique: id, verdict, passes, notes }) => { const r = await write(id, agentName(), { verdict, passes, notes }), lost = r.notes.filter((n) => n.owner?.unmapped);
      return { ...describe(r), ...(lost.length ? { owners_unmapped: lost.map((n) => ({ note: n.id, owner: n.owner.words, said: n.owner.unmapped })) } : {}), said: `${r.title}: ${countText(r)}${r.verdict_set?.verdict ? ` · verdict keep by the critic (${r.verdict_set.because})` : ""}${lost.length ? ` · ${lost.length} owner${lost.length > 1 ? "s" : ""} named no part of the place (owners_unmapped): say master, plan, plate <name>, notes or camera marks` : ""}` }; },
  },
  {
    name: "skip_critique",
    description: "Skip a critique row you claimed, with why (e.g. the picture is a test pattern, or it can't be read): it leaves the docket as skipped, shown on the Work card with the reason. critique {again: true} asks for a new one later.",
    inputSchema: { type: "object", properties: { critique: { type: "string" }, why: { type: "string" } }, required: ["critique", "why"] },
    direct: true,
    run: async ({ critique: id, why }) => describe(await skip(id, agentName(), why)),
  },
  {
    name: "critique",
    description: "Put a critique row on the docket now (asked, beside the ones Snap makes when a picture lands): take (any take), or location (location:<id>[@n]) with part (master, plan, \"plate <name>\", or views: every view side by side, the default), or cast (cast:<id>[@n]: its pictures), or pair [take, take] (a cut: the first one's last frame against the second one's first). again: true makes a new row even when one exists (the old one stays, marked replaced). context {text, pictures: [input/… files]} adds words and pictures to the packet. Returns the row; nothing is read until an agent claims it.",
    inputSchema: { type: "object", properties: { take: { type: "string" }, location: { type: "string" }, part: { type: "string" }, cast: { type: "string" }, pair: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 2 }, again: { type: "boolean" },
      context: { type: "object", properties: { text: { type: "string" }, what: { type: "string" }, pictures: { type: "array", items: { type: "string" } } } } } },
    direct: true,
    run: async ({ take, location: place, part = "views", cast, pair, again = false, context }) => {
      await Promise.all([load(), T.load(), W.load()]);
      const ask = async (key, spec) => (await call("/mainodes/snap/critique/due", { key, ...spec, trigger: "asked", by: agentName(), again, ...(context ? { context } : {}) })).critique;
      let r;
      if (take) { const t = T.get(take); if (!t) throw new Error(`No take ${take} (list_takes lists them)`); r = (await forTake(t, { trigger: "asked", again, context, by: agentName() })) ?? latestOf(t.id); }
      else if (place || cast) {
        const p = W.parse(place ?? cast), rec = W.record(p.kind, p.id);
        if (!rec) throw new Error(`No ${p.kind} ${p.id} (list_${p.kind === "cast" ? "cast" : "locations"} lists them)`);
        const ref = W.refOf(p.kind, p.id, p.n ?? rec.head), b = W.get(ref).version.body, at = p.kind === "cast" ? "pictures" : part;
        const checklist = p.kind === "cast" ? "sheet" : at === "views" ? "location" : at === "plan" ? "plan" : at === "master" ? "master" : "plate";
        r = await ask(`record:${ref}:${at}`, { subject: { kind: "record", ref, part: at }, title: `Critic: ${b.name} v${W.parse(ref).n}${at === "views" ? ", every view side by side" : `, ${at}`}`, purpose: checklist === "location" ? null : checklist, checklist, about: {} });
      } else if (pair) {
        const [a, b] = pair.map((x) => T.get(x)); if (!a || !b) throw new Error(`pair is two take ids (list_takes lists them); not ${JSON.stringify(pair)}`);
        r = await ask(`pair:${a.id}|${b.id}`, { subject: { kind: "pair", pair: [a.id, b.id] }, title: `Critic: cut take ${a.number} → take ${b.number}`, checklist: "cut_pair", about: { take: b.id } });
      } else throw new Error("critique takes take, location (with part), cast, or pair");
      await reload();
      return { ...describe(get(r.id) ?? r), next: `claim_critique {critique: "${r.id}"}` };
    },
  },
  {
    name: "critic_report",
    description: "How the critic agrees with the person (SNAP-R108), over a window (since, an ISO date; default the last 7 days): verdicts (takes the person kept or rejected after a critique: agree = kept with no high note, or rejected with one), picks (decisions where the person applied a candidate: agree = the applied one has as few high notes as the critic's cleanest), misses (the person's 'went wrong' notes on a critiqued take that no critic note covers by region or tag, each with its fixture if it became one), the last fixtures run on this install (caught, false alarms), and said: the one line the person sees. Kept once a day in snap/critic_report/<date>.json.",
    inputSchema: { type: "object", properties: { since: { type: "string" } } },
    annotations: { readOnlyHint: true },
    run: ({ since: from } = {}) => report({ since: from }),
  },
  {
    name: "add_fixture",
    description: "Add as fixture (SNAP-R108): a take's picture becomes a critic fixture, so every later prompt change is measured on it. take, note (a note id from get_take: its words, region and severity become the expected flaw; a video take gives the note's frame), polarity (positive: the picture has the flaw, the default with a note; negative: it is clean), words (why, in the person's words). Copies the picture into this install's fixtures folder (fixtures.local.json beside it); a private take can't become one. tests/snap/critic/run_fixtures.py reads them with the pack's.",
    inputSchema: { type: "object", properties: { take: { type: "string" }, note: { type: "string" }, polarity: { type: "string", enum: ["positive", "negative"] }, words: { type: "string" } }, required: ["take"] },
    direct: true,
    run: ({ take, note, polarity, words }) => addFixture({ take, note, polarity, words, by: agentName() }),
  },
];
