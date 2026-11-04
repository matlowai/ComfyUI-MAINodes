// Agent proposals (BRAINSTORM G1): an agent call with `propose: true` doesn't touch the graph; it waits here, shown in
// the Snap view as a ghost brick or a dashed chip with the agent's reason, until the person accepts or rejects it.
// Page-scoped on purpose: a proposal is a question to whoever is looking, not part of the workflow; each one belongs
// to the graph it was made against and only shows (and can only be accepted) there.
import { app } from "../../../scripts/app.js";
let next = 1;
const list = [];
const listeners = new Set();
const changed = () => { for (const fn of listeners) fn(); };

export const onChange = (fn) => listeners.add(fn);
export const pending = () => list.filter((p) => p.status === "waiting" && p.graph === app.graph.id);
export const all = () => list.map(({ id, tool, args, reason, note, plan, status, result }) => ({ id, tool, args, reason, status, ...(note ? { note } : {}), ...(plan ? { plan } : {}), ...(result ? { result } : {}) }));

// `note`: the director's note this proposal answers, if any; `plan`: what a GPU tool would run and about how long
// (plan-then-approve, U35), shown with the proposal
export function add(tool, args, reason, note, plan) {
  const p = { id: `p${next++}`, tool, args, reason: reason || "", note, plan, status: "waiting", graph: app.graph.id };
  list.push(p);
  changed();
  return p;
}

// accept runs the call for real through `run`; reject just records the answer
export async function decide(id, accept, run) {
  const p = list.find((x) => x.id === id && x.status === "waiting" && x.graph === app.graph.id);
  if (!p) return null;
  p.status = "running"; // a double click or Accept all while this runs must not apply it twice
  if (accept) {
    try { p.result = await run(p.tool, p.args); p.status = "accepted"; } catch (e) { p.result = e.message; p.status = "failed"; }
  } else p.status = "rejected";
  changed();
  return p;
}
