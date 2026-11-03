// The crew's record (BRAINSTORM G8): every answer to an agent proposal, kept in the user's ComfyUI data folder (one
// file per day, local), so acceptance per kind of proposal shows whether an agent's suggestions are getting better.
import { api } from "../../../scripts/api.js";

const DIR = "snap/crew";
const today = () => { const d = new Date(); return `${DIR}/${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.json`; }; // local day

// a missing file is an empty day; any other failure must not let a write replace the day's answers
async function read(file) {
  const r = await api.getUserData(file);
  if (r.status === 404) return [];
  if (r.status !== 200) throw new Error(`crew record unreadable (${r.status})`);
  return r.json();
}

export const kind = (p, cardKind) => (p.tool === "set_setting" ? `setting ${p.args.name}` : p.tool === "apply_card" ? `card ${cardKind ?? "?"}` : p.tool === "snap" ? `brick ${p.args.brick}` : p.tool);

// one write at a time: "Accept all" answers several proposals at once, and each write rewrites the day's file
let writing = Promise.resolve();
export function log(p, cardKind, noteText) {
  // the person's answer is what counts; whether the accepted call then applied is kept beside it
  const row = { at: new Date().toISOString(), kind: kind(p, cardKind), tool: p.tool, args: p.args, reason: p.reason, ...(noteText ? { note: noteText } : {}),
    answer: p.status === "rejected" ? "rejected" : "accepted", applied: p.status === "accepted" };
  writing = writing.catch(() => {}).then(async () => { const file = today(); await api.storeUserData(file, [...(await read(file)), row]); }); // a failed write must not stall later ones
  return writing;
}

// acceptance per kind over every day on record: { total: [accepted, answered], kinds: { "setting length": [1, 2], ... } }
export async function report() {
  const files = (await api.listUserDataFullInfo(DIR)).filter((f) => f.path.endsWith(".json"));
  const rows = (await Promise.all(files.map((f) => read(`${DIR}/${f.path}`)))).flat();
  const kinds = {};
  for (const r of rows) {
    const k = (kinds[r.kind] ??= [0, 0]);
    k[1]++;
    if (r.answer === "accepted") k[0]++;
  }
  const total = Object.values(kinds).reduce(([a, n], [x, y]) => [a + x, n + y], [0, 0]);
  return { total, kinds };
}
