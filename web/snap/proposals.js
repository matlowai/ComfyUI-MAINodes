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
// SNAP-R139 proposals kept on the server, stacked on each other · SNAP-R173 the option cemetery · SNAP-R67 canon waits for the person, and a driven press is the agent's · SNAP-R172 a stacked reason reads as it stands · see docs/snap/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import * as sight from "./sight.js";
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
export const all = () => list.map(({ id, tool, args, reason, note, plan, status, result, book, needs, makes, stacked, answered_by, because, revive_if }) => ({ id, tool, args, reason, status, ...(book ? { book } : {}), ...(needs?.length ? { needs } : {}), ...(makes?.length ? { makes } : {}), ...(stacked ? { stacked } : {}), ...(note ? { note } : {}), ...(plan ? { plan } : {}), ...(result !== undefined ? { result } : {}), ...(answered_by ? { answered_by } : {}), ...(because ? { because } : {}), ...(revive_if ? { revive_if } : {}) }));
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
export async function add(tool, args, reason, note, plan, { book = null, needs = [], makes = [], stacked = null } = {}) {
  await load();
  return (await write({ add: { tool, args, reason: reason || "", graph: book ? null : app.graph.id, ...(book ? { book } : {}), ...(needs.length ? { needs } : {}), ...(makes.length ? { makes } : {}), ...(stacked ? { stacked } : {}), ...(note ? { note } : {}), ...(plan ? { plan } : {}) } })).row;
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
