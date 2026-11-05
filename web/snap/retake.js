// Re-take and re-run (U87 §4.4, Dylan 22:44): a take, or a saved file opened in Snap, re-runs "as it was" (the
// versions it pinned: the graph already holds what they put in, seed included) or "with today's world" (each pinned
// record that moved on is updated to its newest version first). "Edit then run" opens the pinned versions to change.
// A re-take opens where SNAP-R24 says: the shot's own scene tab when the take belongs to a shot, else a new scratch
// tab with the take's workflow; it never lands on an unrelated open graph (SNAP-R5). The run carries
// `extra.snap.retake` in its workflow, so the new take nests under the original as "Retake · as it was" / "· today's
// world". Saved files: core writes the queued prompt and workflow (extra.snap.world inside) as it always does; with
// Save metadata off they hold nothing (SNAP-R38).
// SNAP-R5 open work untouched · SNAP-R16 GPU tools wait as proposals · SNAP-R24 scenes own the work · SNAP-R60 pins ·
// SNAP-R61 re-run as it was, with today's world, or edited · see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import * as E from "./engine.js";
import * as L from "./library.js";
import * as SC from "./scenes.js";
import * as T from "./takes.js";
import * as W from "./world.js";

export const WORLDS = ["pinned", "latest"], SEEDS = ["same", "new"];
const shown = { pinned: "as it was", latest: "today's world" };
export const worldShown = (w) => shown[w] ?? w;

// what "today's world" would change: the pinned records that moved on, each with its field changes
export async function differs(world) {
  await W.load();
  return T.moves(world).map((m) => {
    const { kind, id } = W.parse(m.ref), was = W.get(W.refOf(kind, id, m.was))?.version.body, now = m.now != null ? W.get(W.refOf(kind, id, m.now))?.version.body : null;
    return { ...m, text: T.moveText(m), fields: was && now ? W.diff(was, now) : [] };
  });
}

// the scene shot a take belongs to (its workflow's group is one of the shot's), or null
function shotOf(take) {
  for (const scene of SC.all()) for (const shot of scene.shots) if (shot.groups.includes(take.group) || shot.takes.some((e) => e.take === take.id)) return { scene, shot };
  return null;
}

// open the take's chain as it ran: the shot's tab with the take's settings and pins put back, else a scratch tab
async function openTake(take) {
  await SC.load();
  const home = shotOf(take);
  if (home) {
    await SC.openShot(home.scene.id, home.shot.id);
    // the take's whole graph into the shot's own tab (a scene tab is never a saved file, SNAP-R24): widget-by-widget restore
    // misplaces dynamic rows (a LoRA stack's), so "as it was" would not be exact
    const tabs = app.extensionManager.workflow, mark = app.graph.extra.snap_scene;
    await app.loadGraphData({ ...structuredClone(take.graph), extra: { ...structuredClone(take.graph.extra ?? {}), snap_scene: mark } }, true, true, tabs.activeWorkflow);
    await SC.saveOpen();
    return `${SC.shotTitle(home.scene, home.shot)} of ${home.scene.name}`;
  }
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

// mark the next queued run as a re-take of `take` (read from the queued workflow at capture), then queue it as Run does
async function queue(take, world, seed) {
  E.tag("retake", { take: take.id, world, seed });
  try {
    const before = T.runs().length;
    await app.queuePrompt(0, 1, { queueNodeIds: E.targets() });
    const errors = Object.entries(app.lastNodeErrors ?? {}).map(([id, e]) => `${id}: ${e.errors?.[0]?.message}`);
    if (errors.length) throw new Error(`Not queued: ${errors.join("; ")}`);
    return T.runs()[before]?.id ?? null;
  } finally { E.tag("retake", undefined); }
}

// re-take a take: open its chain, today's world when asked, the same seed or a new one, then run (queue: false only opens)
export async function retake(take, { world = "pinned", seed = "same", refs, queue: go = true } = {}) {
  if (!WORLDS.includes(world)) throw new Error(`world is one of ${WORLDS.join(", ")}`);
  if (!SEEDS.includes(seed)) throw new Error(`seed is one of ${SEEDS.join(", ")}`);
  if (!take.graph) throw new Error(`Take ${take.number} has no workflow saved with it`);
  const where = await openTake(take), updated = world === "latest" ? await toToday(refs) : [];
  const seedKey = E.state().bricks.find((b) => E.seedMode(b.key))?.key, newSeed = seed === "new" && seedKey ? E.newSeed(seedKey) : null;
  const run = go ? await queue(take, world, seed) : null;
  return { take: take.id, world, seed, opened: where, updated, ...(newSeed != null ? { new_seed: newSeed } : {}), run,
    said: `Take ${take.number} ${go ? "re-taken" : "opened"} ${worldShown(world)} in ${where}${updated.length ? ` · ${updated.join(" · ")}` : ""}${go ? "" : " · nothing is queued"}` };
}
// the open workflow, run as it is or with today's world (a saved file opened in Snap: it is no take, so no parent)
export async function runOpen({ world = "pinned" } = {}) {
  const updated = world === "latest" ? await toToday() : [];
  const before = T.runs().length;
  await app.queuePrompt(0, 1, { queueNodeIds: E.targets() });
  return { world, updated, run: T.runs()[before]?.id ?? null };
}
