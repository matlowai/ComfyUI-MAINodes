// Re-take and re-run (U87 §4.4, the operator, 22:44): a take, or a saved file opened in Snap, re-runs "as it was" (the
// versions it pinned: the graph already holds what they put in, seed included) or "with today's world" (each pinned
// record that moved on is updated to its newest version first). "Edit then run" opens the pinned versions to change.
// A re-take opens where SNAP-R24 says: the shot's own scene tab when the take belongs to a shot, else a new scratch
// tab with the take's workflow; it never lands on an unrelated open graph, nor on a shot tab with unsaved changes (a
// new tab of the shot then, SNAP-R5); after the run the shot's workflow is saved as it ran. The run carries
// `extra.snap.retake` in its workflow, so the new take nests under the original as "Retake · as it was" / "· today's
// world". Saved files: core writes the queued prompt and workflow (extra.snap.world inside) as it always does; with
// Save metadata off they hold nothing (SNAP-R38).
// SNAP-R5 open work untouched · SNAP-R16 GPU tools wait as proposals · SNAP-R24 scenes own the work · SNAP-R60 pins ·
// SNAP-R61 re-run as it was, with today's world, or edited · SNAP-R65 the run carries its job stamp · SNAP-R23 a candidate
// that is a take (takeCandidate: re-run batches, new views) · see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import * as E from "./engine.js";
import * as L from "./library.js";
import * as SC from "./scenes.js";
import * as T from "./takes.js";
import * as W from "./world.js";
import * as J from "./jobs.js";

export const WORLDS = ["pinned", "latest"], SEEDS = ["same", "new"];
const shown = { pinned: "as it was", latest: "today's world" };
export const worldShown = (w) => shown[w] ?? w;

// what "today's world" would change: the pinned records that moved on, each with its field changes
export async function differs(world) {
  await W.load();
  return T.moves(world).map((m) => {
    const { kind, id } = W.parse(m.ref), was = W.get(W.refOf(kind, id, m.was))?.version.body, now = m.now != null ? W.get(W.refOf(kind, id, m.now))?.version.body : null;
    const warning = kind === "cast" ? L.lookWarning(was, now) : null;
    const pictures = was && now ? W.pictures(was, now) : [];
    return { ...m, text: T.moveText(m), fields: was && now ? W.diff(was, now) : [], ...(pictures.length ? { pictures } : {}), ...(warning ? { warning } : {}) };
  });
}

// the scene shot a take belongs to (its workflow's group is one of the shot's), or null
export function shotOf(take) {
  for (const scene of SC.all()) for (const shot of scene.shots) if (shot.groups.includes(take.group) || shot.takes.some((e) => e.take === take.id)) return { scene, shot };
  return null;
}

// a candidate that is a take (a re-run batch's, SNAP-R63; a new view's, U101): its media is the picture; Apply makes it
// the shot's active take (in a scratch tab it is marked keep), Undo puts back what was active, Reject marks the take
// rejected by whoever pressed it (SNAP-R17)
export const takeCandidate = {
  finish: (d, c, h) => { c.pictures = T.media(h.outputs).slice(0, 1).map((m) => ({ label: c.label, media: m })); c.take = `take-${c.prompt_id}`; },
  apply: async (d, c, by) => {
    await T.load(); await SC.load();
    const t = T.get(`take-${c.prompt_id}`);
    if (!t) throw new Error(`${d.title}: candidate ${c.id}'s take isn't here yet (run_status ${c.prompt_id})`);
    const home = shotOf(t);
    if (!home) { t.verdict = "keep"; await T.save(t); return { take: t.id, kept: true }; }
    const was = home.shot.active ?? null;
    await SC.setActive(home.scene.id, home.shot.id, t.id, by);
    return { take: t.id, scene: home.scene.id, shot: home.shot.id, was };
  },
  undo: async (d, c, that) => { if (that.scene) await SC.setActive(that.scene, that.shot, that.was, "person"); else { const t = T.get(that.take); if (t) { t.verdict = null; await T.save(t); } } },
  reject: async (d, c, by) => { await T.load(); const t = T.get(`take-${c.prompt_id}`); if (t) { t.verdict = "reject"; t.verdict_by = by; await T.save(t); } },
};

// open the take's chain as it ran: the shot's tab (or the shot `home` names, U89's "lands in") with the take's settings
// and pins put back, else a scratch tab (home null)
export async function openTake(take, home) {
  await SC.load();
  if (home === undefined) home = shotOf(take);
  // the take's whole graph as the shot's workflow (widget-by-widget restore misplaces dynamic rows, a LoRA stack's, so
  // "as it was" would not be exact); a shot tab with unsaved changes keeps them and the graph opens in a new tab (SNAP-R5)
  if (home) return SC.loadIntoShot(home.scene.id, home.shot.id, take.graph, `take ${take.number}`);
  const { snap_scene, ...extra } = take.graph.extra ?? {};
  await app.loadGraphData({ ...structuredClone(take.graph), extra: structuredClone(extra) }, true, true, `${take.workflow || "take"} #${take.number} · retake`);
  return "a new tab";
}

// put each moved pin (or only `refs`) at its record's newest version; returns what was said
export async function toToday(refs) {
  const said = [];
  for (const m of T.moves(E.state().world)) if (!m.missing && (!refs?.length || refs.includes(m.ref))) said.push(await L.updatePin(m.ref));
  return said;
}

// mark the next queued run (extra.snap[mark]: a re-take or a re-run of a take, read from the queued workflow at capture),
// then queue it as Run does, with its job stamp (`job`: its question, SNAP-R65); the mark stays on until the run is sent
export async function queue(mark, value, job) {
  E.tag(mark, value);
  try {
    const id = await J.queueRun({ kind: mark, about: { ...J.here(), take: value?.take }, ...job }, () => app.queuePrompt(0, 1, { queueNodeIds: E.targets() }));
    // a node's own refusal (the rating cap, SNAP-R33) is its reason, which core puts in details after "<input> - "
    const errors = J.nodeErrors();
    if (errors.length) throw new Error(`Not queued: ${errors.join("; ")}`);
    return id;
  } finally { E.tag(mark, undefined); }
}

// re-take a take: open its chain, today's world when asked, the same seed or a new one, then run (queue: false only opens)
export async function retake(take, { world = "pinned", seed = "same", refs, queue: go = true, by = "person" } = {}) {
  if (!WORLDS.includes(world)) throw new Error(`world is one of ${WORLDS.join(", ")}`);
  if (!SEEDS.includes(seed)) throw new Error(`seed is one of ${SEEDS.join(", ")}`);
  if (!take.graph) throw new Error(`Take ${take.number} has no workflow saved with it`);
  const where = await openTake(take), updated = world === "latest" ? await toToday(refs) : [];
  const seedKey = E.state().bricks.find((b) => E.seedMode(b.key))?.key, newSeed = seed === "new" && seedKey ? E.newSeed(seedKey) : null;
  const run = go ? await queue("retake", { take: take.id, world, seed }, { title: `Re-take take ${take.number} ${worldShown(world)}${seed === "new" ? ", new seed" : ""}`, by, eta_s: take.seconds ?? null }) : null;
  await SC.saveOpen(); // the shot's workflow as it ran, so a next re-take from this tab finds nothing unsaved
  return { take: take.id, world, seed, opened: where, updated, ...(newSeed != null ? { new_seed: newSeed } : {}), run,
    said: `Take ${take.number} ${go ? "re-taken" : "opened"} ${worldShown(world)} in ${where}${updated.length ? ` · ${updated.join(" · ")}` : ""}${go ? "" : " · nothing is queued"}` };
}
