// Agent proposals (BRAINSTORM G1): an agent call with `propose: true` doesn't touch the graph; it waits here, shown in
// the Snap view as a ghost brick or a dashed chip with the agent's reason, until the person accepts or rejects it.
// Page-scoped on purpose: a proposal is a question to whoever is looking, not part of the workflow.
let next = 1;
const list = [];
const listeners = new Set();
const changed = () => { for (const fn of listeners) fn(); };

export const onChange = (fn) => listeners.add(fn);
export const pending = () => list.filter((p) => p.status === "waiting");
export const all = () => list.map(({ id, tool, args, reason, note, status, result }) => ({ id, tool, args, reason, status, ...(note ? { note } : {}), ...(result ? { result } : {}) }));

// `note`: the director's note this proposal answers, if any
export function add(tool, args, reason, note) {
  const p = { id: `p${next++}`, tool, args, reason: reason || "", note, status: "waiting" };
  list.push(p);
  changed();
  return p;
}

// accept runs the call for real through `run`; reject just records the answer
export async function decide(id, accept, run) {
  const p = list.find((x) => x.id === id && x.status === "waiting");
  if (!p) return null;
  if (accept) {
    try { p.result = await run(p.tool, p.args); p.status = "accepted"; } catch (e) { p.result = e.message; p.status = "failed"; }
  } else p.status = "rejected";
  changed();
  return p;
}
