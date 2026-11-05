// The job stamp (SNAP-R65): every prompt Snap queues carries extra_data.snap_job = { kind, title, about, by, eta_s, takes,
// at }. `title` is the job's question in the person's words ("Change something: make her jacket sparkle"), refused when
// empty; `about` names what the job belongs to in the page's own ids (take, group, decision, set, camera; book, beat, unit,
// entity and state are kept for the Book); `takes: false` keeps a paint or a check out of the takes. Core copies
// extra_data into /queue and /history, so every page and every agent reads a job back from the server (activity.js);
// nothing is stored anywhere new. Runs go through ComfyUI's own app.queuePrompt (seed control, its errors, its queue
// panel), which sends a run later when it is still sending another, so a run's stamp waits here and its id comes from
// the send itself: a run always returns its id or says why not (anime dogfood F-A13).
// SNAP-R52 values outside the choices are refused naming them · SNAP-R65 the Work card · see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";

export const KINDS = ["run", "retake", "rerun", "paint", "propagate", "extend", "louder", "plate", "check", "preview", "make_dial", "settei", "board", "compile", "prose"];
export const ABOUT = ["take", "group", "scene", "shot", "decision", "candidate", "set", "camera", "slot", "book", "beat", "unit", "entity", "state"];
export const BY = ["person", "agent"];

export function job({ kind, title, about = {}, by = "person", eta_s = null, takes = true } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`A job's kind is one of ${KINDS.join(", ")}; not ${JSON.stringify(kind)}`);
  if (typeof title !== "string" || !title.trim()) throw new Error(`Not queued: this ${kind} job has no question (title): say what it answers, in the person's words`);
  if (!BY.includes(by)) throw new Error(`A job's by is one of ${BY.join(", ")}; not ${JSON.stringify(by)}`);
  const odd = Object.keys(about).filter((k) => !ABOUT.includes(k));
  if (odd.length) throw new Error(`A job's about takes ${ABOUT.join(", ")}; not ${odd.join(", ")}`);
  return { kind, title: title.trim(), about: Object.fromEntries(Object.entries(about).filter(([, v]) => v != null)), by, eta_s: eta_s ?? null, ...(takes ? {} : { takes: false }), at: Date.now() };
}

// the open tab, as a run's title names it and as its `about` (a scene tab's shot mark, SNAP-R24)
export const where = () => app.extensionManager?.workflow?.activeWorkflow?.filename ?? "the open workflow";
export const here = () => { const m = app.graph?.extra?.snap_scene; return { group: app.graph?.id ?? "unsaved", scene: m?.scene, shot: m?.shot }; };
// a run from the graph view, ComfyUI's Queue button or Ctrl+Enter: Snap didn't start it, the person did
const plain = () => job({ kind: "run", title: `Run ${where()}`, about: here() });

// the jobs this page queued, by prompt id, as soon as the server took them (the Work card reads the rest from the server)
const mine = new Map();
export const own = (id) => mine.get(id) ?? null;
export const sentHere = () => mine;

let outgoing = null, delivered = null, lock = Promise.resolve();
// snap_view's queuePrompt wrap: the stamp the prompt it is about to send carries
export function sending() { const j = outgoing ?? plain(); outgoing = null; return j; }
// ... and what the send answered: the prompt id, or null when the server refused it
export function sent(j, id) { if (id) mine.set(id, j); if (delivered?.job === j) delivered.done(id); }

// queue a run with its stamp through `go` (app.queuePrompt): one at a time, so each stamp meets its own send. Returns the
// prompt id, or null when ComfyUI refused it (app.lastNodeErrors says why)
export function queueRun(spec, go) {
  const j = job(spec);
  const run = lock.then(async () => {
    const id = new Promise((done) => { delivered = { job: j, done }; });
    outgoing = j;
    try {
      await go();
      if (outgoing === j && Object.keys(app.lastNodeErrors ?? {}).length) return null; // refused before it was sent
      // app.queuePrompt returns at once while ComfyUI still sends an earlier run; this one goes out after it
      const got = await Promise.race([id, new Promise((done) => setTimeout(() => done(undefined), 30000))]);
      if (got === undefined) throw new Error(`ComfyUI hasn't sent "${j.title}" within 30 s (it is still sending an earlier run); list_activity shows it once it goes out`);
      return got;
    } finally { if (outgoing === j) outgoing = null; delivered = null; }
  });
  lock = run.catch(() => {});
  return run;
}
