// Agent proposals (BRAINSTORM G1): an agent call with `propose: true` doesn't touch the graph; it waits here, shown in
// the Snap view as a ghost brick or a dashed chip with the agent's reason, until the person accepts or rejects it.
// A recipe proposal belongs to the graph it was made against and only shows (and can only be accepted) there; a Book's
// canon proposal (story, style, dial) belongs to the Book and shows on every graph. They live on the server
// (/mainodes/snap/proposals), so a reload or a second page keeps them, with the person's answer (F-F19). A story
// proposal built on another waiting one names it in `needs`: accepting it accepts those first, rejecting one withdraws
// what was built on it (F-F02).
// An answer records who pressed it and where (`answered_by`: the person's press on a tab or in the agents' window, and
// the agent driving that page if one did), and a reject may say why and when it is worth another look (`because`,
// `revive_if`: the option cemetery).
// A proposal that writes a record (or a Book's story) keeps the version it was made against (`base`); once that record
// moves on, it is out of date: Accept refuses and it can be re-made against the new version. Two waiting proposals on one
// record at one version are either/or: accepting one leaves the other out of date. With the person's expiry setting on,
// an unanswered proposal past `expires_at` is parked (kept, never deleted).
// SNAP-R139 proposals kept on the server, stacked on each other · SNAP-R173 the option cemetery · SNAP-R67 canon waits for the person, and a driven press is the agent's · SNAP-R172 a stacked reason reads as it stands ·
// SNAP-R209 a proposal keeps its base and goes out of date when it moves; either/or on one record · SNAP-R210 expiry parks, off by default · see docs/snap/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import * as sight from "./sight.js";
import * as W from "./world.js";
export const EXPIRY = "MAINodes.Snap.ProposalExpiry"; // hours; 0 = never (the person's setting, SNAP-R210)
let list = [], loading = null;
const listeners = new Set();
const changed = () => { for (const fn of listeners) fn(); };

async function read() {
  const r = await api.fetchApi("/mainodes/snap/proposals"), out = await r.json();
  if (!r.ok) throw new Error(out.error ?? `/mainodes/snap/proposals answered ${r.status}`);
  list = out.rows;
  changed();
}
export function load() { loading ??= read().catch((e) => { loading = null; throw e; }); return loading; }
// another page or agent made or answered one
api.addEventListener("mainodes-snap-proposals", () => { read().catch(() => {}); });

export const onChange = (fn) => listeners.add(fn);
const here = (p) => p.graph == null || p.graph === app.graph.id;
export const pending = () => list.filter((p) => p.status === "waiting" && here(p));
export const get = (id) => list.find((p) => p.id === id) ?? null;
export const all = () => list.map((p) => { const { id, tool, args, reason, note, plan, status, result, book, needs, makes, stacked, answered_by, because, revive_if, base, expires_at } = p, stale = staleOf(p), rival = rivals(p);
  return { id, tool, args, reason, status, ...(book ? { book } : {}), ...(needs?.length ? { needs } : {}), ...(makes?.length ? { makes } : {}), ...(stacked ? { stacked } : {}), ...(note ? { note } : {}), ...(plan ? { plan } : {}), ...(result !== undefined ? { result } : {}), ...(answered_by ? { answered_by } : {}), ...(because ? { because } : {}), ...(revive_if ? { revive_if } : {}),
    ...(base ? { base } : {}), ...(stale ? { stale: { ...stale, remake: `out of date: the person can re-make it against v${stale.to} (or call ${tool} again with propose: true)` } } : {}), ...(rival.length ? { either_or: rival.map((x) => x.id) } : {}), ...(expires_at ? { expires_at, ...(expired(p) ? { expired: true } : {}) } : {}) }; });

// ---- SNAP-R209 the base: the record a waiting write would change, at its version when asked -----------------------------
// (a Book's story proposal brings its own: the story head plus `on`, the waiting story proposals it was drafted over)
const WRITES = new Set(["save_cast", "save_cast_state", "save_location", "add_plate", "remove_plate", "draw_set_plan"]);
function baseOf(tool, a) {
  const named = tool === "delete_record" ? a.ref : tool === "use_take" ? (a.as === "cast" ? a.cast : a.as === "plate" ? a.location : null) : WRITES.has(tool) ? a.cast ?? a.location : null;
  if (!/^[a-z_]+:[^@\s]+/.test(named ?? "")) return null; // a new record, or a ref the tool itself will refuse on accept
  const { kind, id } = W.parse(named), r = W.record(kind, id);
  return r ? { ref: W.refOf(kind, id), version: r.head } : null;
}
// out of date: {ref, name, from, to, by (the accepted proposals that moved it), said} or null. Versions made by the
// proposals a story edit was drafted over don't count: it was built for them
export function staleOf(p) {
  if (!p?.base || p.status !== "waiting") return null;
  const { kind, id } = W.parse(p.base.ref), r = W.record(kind, id), name = kind === "story" ? "the story" : W.get(p.base.ref)?.version.body.name ?? p.base.ref;
  if (!r) return null; // not read yet, or deleted (the accept then says so itself)
  const moved = r.versions.filter((v) => v.n > p.base.version && !(p.base.on ?? []).includes(v.proposal));
  if (!moved.length) return null;
  const by = list.filter((x) => x.id !== p.id && x.status === "accepted" && x.base?.ref === p.base.ref && x.base.version >= p.base.version && !(p.base.on ?? []).includes(x.id)).map((x) => x.id); // the accepted ones that moved it
  return { ref: p.base.ref, name, from: p.base.version, to: r.head, ...(by.length ? { by } : {}), said: `${name} v${p.base.version} → v${r.head}${by.length ? ` (${by.join(", ")} accepted)` : ""}` };
}
// either/or (F-AB03): the other waiting proposals that change the same record from the same version (story edits stack
// instead, SNAP-R139)
export const rivals = (p) => (!p?.base || p.book || p.status !== "waiting" ? [] : list.filter((x) => x.id !== p.id && x.status === "waiting" && !x.book && x.base?.ref === p.base.ref && x.base.version === p.base.version));
export const expired = (p) => p?.status === "waiting" && p.expires_at != null && Date.now() > p.expires_at;

// F-Q04: a stacked proposal's reason as it reads now: its "with pN waiting: …" clause goes once any of those is answered
// (the stored reason stays whole for agents, SNAP-R58)
export const reasonNow = (p) => { const r = p?.reason ?? "", st = p?.stacked; if (!st?.said || st.on.every((id) => get(id)?.status === "waiting")) return r; return r.replace(`; ${st.said}`, "").replace(` (${st.said})`, ""); };
// who answers on this page: a press is the person's, made on their tab or in the agents' window, where an agent may drive it (F-L17)
// F-Q03: a press on the agents' window while an agent drives it is the agent's: nothing says a person made it
export const pressedBy = () => ({ by: sight.managed() && sight.driver() ? "agent" : "person", where: sight.managed() ? "the agents' window" : "a person's tab", page: api.clientId ?? null, ...(sight.driver() ? { driven_by: sight.driver() } : {}) });

async function write(body) {
  const r = await api.fetchApi("/mainodes/snap/proposals", { method: "POST", body: JSON.stringify(body) }), out = await r.json();
  if (!out.row) throw new Error(out.error ?? `/mainodes/snap/proposals answered ${r.status}`);
  const i = list.findIndex((p) => p.id === out.row.id);
  if (i < 0) list.push(out.row); else list[i] = out.row;
  changed();
  return { ok: r.ok, row: out.row };
}

// `note`: the director's note this proposal answers, if any; `plan`: what a GPU tool would run and about how long
// (plan-then-approve, U35), shown with the proposal; `book`: a Book's canon proposal (no graph); `needs`: the waiting
// proposals it was built on; `makes`: the beats it would add; `stacked`: {on, said}, the waiting proposals its cost clause
// names and that clause (F-Q04)
export async function add(tool, args, reason, note, plan, { book = null, needs = [], makes = [], stacked = null, base = null } = {}) {
  await Promise.all([load(), W.load()]);
  const on = base ?? baseOf(tool, args), hours = +(app.extensionManager.setting.get(EXPIRY) ?? 0);
  return (await write({ add: { tool, args, reason: reason || "", graph: book ? null : app.graph.id, ...(book ? { book } : {}), ...(needs.length ? { needs } : {}), ...(makes.length ? { makes } : {}), ...(stacked ? { stacked } : {}), ...(note ? { note } : {}), ...(plan ? { plan } : {}),
    ...(on ? { base: on } : {}), ...(hours > 0 ? { expires_at: Date.now() + hours * 3600000 } : {}) } })).row;
}

// "re-make against v5": the same call made again as a new proposal on the record as it is now (its now/after and cost
// read from there), and this one withdrawn naming it. The call goes through callTool unconfirmed, as an agent's would
export async function remake(id) {
  if (await W.stale()) await W.reload();
  const p = get(id), st = staleOf(p);
  if (!st) throw new Error(`${id} isn't out of date: accept or reject it`);
  const { callTool } = await import("./tools.js"); // tools.js imports this module
  const out = await callTool(p.tool, { ...p.args, propose: true, ...(p.reason ? { reason: p.reason } : {}) });
  if (!out?.proposed) throw new Error(`${p.tool} didn't wait as a proposal: ${JSON.stringify(out)}`);
  await write({ id, status: "withdrawn", result: `out of date (${st.said}): re-made as ${out.proposed} against v${st.to}` });
  return { remade: out.proposed, withdrew: id, against: st.to };
}

// proposals about something that is gone (a deleted scene) are withdrawn with a short note, on every graph; returns how many
export async function withdraw(about, note) {
  const gone = list.filter((p) => p.status === "waiting" && about(p));
  for (const p of gone) await write({ id: p.id, status: "withdrawn", result: note });
  return gone.length;
}

// accept runs the call for real through `run` (what it was built on first); reject records the answer and withdraws what
// was built on it. null when it isn't waiting here, or another page answered it first
export async function decide(id, accept, run, { because, revive_if } = {}) {
  const p = list.find((x) => x.id === id && x.status === "waiting" && here(x));
  if (!p) return null;
  if (accept && p.base) { if (await W.stale()) await W.reload(); const st = staleOf(p); if (st) throw new Error(`${id} is out of date: ${st.said}. It was made against v${st.from}; re-make it against v${st.to} instead of applying it (SNAP-R209)`); }
  if (accept) for (const n of p.needs ?? []) {
    const q = get(n), first = q?.status === "waiting" ? await decide(n, true, run) : q;
    if (first?.status !== "accepted") return (await write({ id, status: "failed", result: `it was built on ${n}, which ${first ? `is ${first.status}` : "isn't here"}` })).row;
  }
  p.status = "running"; // a double click or Accept all while this runs must not apply it twice; the server holds it for other pages
  changed();
  const answered_by = pressedBy();
  if (!(await write({ id, status: "running", answered_by })).ok) return null;
  p.answered_by = answered_by;
  let status = "rejected", result;
  if (accept) { try { result = await run(p.tool, p.book ? { ...p.args, proposal: p.id } : p.args); status = "accepted"; } catch (e) { result = e.message; status = "failed"; } }
  const out = (await write({ id, status, ...(result !== undefined ? { result } : {}), ...(!accept && because ? { because } : {}), ...(!accept && revive_if ? { revive_if } : {}) })).row;
  if (!accept) for (const q of list.filter((x) => x.status === "waiting" && x.needs?.includes(id))) await write({ id: q.id, status: "withdrawn", result: `built on ${id}, which was rejected` });
  return out;
}
