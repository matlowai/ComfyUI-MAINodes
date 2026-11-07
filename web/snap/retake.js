// Re-take and re-run (U87 §4.4, the operator, 22:44): a take, or a saved file opened in Snap, re-runs "as it was" (the
// versions it pinned: the graph already holds what they put in, seed included) or "with today's world" (each pinned
// record that moved on is updated to its newest version first). "Edit then run" opens the pinned versions to change.
// A re-take opens where SNAP-R24 says: the shot's own scene tab when the take belongs to a shot, else a new scratch
// tab with the take's workflow; it never lands on an unrelated open graph, nor on a shot tab with unsaved changes (a
// new tab of the shot then, SNAP-R5); after the run the shot's workflow is saved as it ran. The run carries
// `extra.snap.retake` in its workflow, so the new take nests under the original as "Retake · as it was" / "· today's
// world". Saved files: core writes the queued prompt and workflow (extra.snap.world inside) as it always does; with
// Save metadata off they hold nothing (SNAP-R38).
// SNAP-R5 open work untouched · SNAP-R214 a take with no workflow nodes never opens · SNAP-R16 GPU tools wait as proposals · SNAP-R24 scenes own the work · SNAP-R60 pins ·
// SNAP-R61 re-run as it was, with today's world, or edited · SNAP-R65 the run carries its job stamp · SNAP-R23 a candidate
// that is a take (takeCandidate: re-run batches, new views) · SNAP-R185 a still in a cut's shot is a board, never its
// active take · SNAP-R234 a re-take takes the cut's dial rows as they stand, or only opens · see docs/snap/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import * as E from "./engine.js";
import * as L from "./library.js";
import * as SC from "./scenes.js";
import * as T from "./takes.js";
import * as W from "./world.js";
import * as J from "./jobs.js";
import * as D from "./dials.js";

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

// F-S07 (SNAP-R185): a Book cut's shot holds the cut's video; a still landed there is a board candidate. The person's
// pick fills the cut's board slot (its key drawing for a key candidate); an agent is refused with set_board named,
// since the pick is the boards stage's (the Book's dial), and the cut's active take never becomes a still
const cutHome = (home) => (home?.scene.book && home.shot.unit ? home : null);
const still = (d, t) => (t ? !t.media.some((m) => m.kind === "video") : ["view", "sheet"].includes(d.kind));
export function cutStill(d, c) {
  const t = T.get(c.take ?? `take-${c.prompt_id}`), home = cutHome(t ? shotOf(t) : d.land && (() => { const scene = SC.get(d.land.scene), shot = scene?.shots.find((x) => x.id === d.land.shot); return shot && { scene, shot }; })());
  if (!home || !still(d, t)) return null;
  const unit = home.shot.unit, key = t?.story?.role === "key", active = home.shot.active && T.get(home.shot.active);
  return { home, t, slot: key ? "key" : "board", cut: unit.cut ?? SC.shotTitle(home.scene, home.shot),
    refusal: `apply_candidate would make ${t ? `still take ${t.number}` : "a still"} the active take of ${unit.cut ?? SC.shotTitle(home.scene, home.shot)}, a cut of the Book${active ? ` whose active take is take ${active.number} (${active.media.some((m) => m.kind === "video") ? "its video" : "a still"})` : ""}: a still in a cut's shot is a board, never its take. Pick it with set_board {scene: "${home.scene.id}", shot: "${home.shot.id}", take: "${t?.id ?? `take-${c.prompt_id}`}"${key ? ", role: \"key\"" : ""}} (the Book's boards dial decides), or pass it to make_board as context: [{take}]` };
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
    const board = cutStill(d, c);
    if (board && by === "agent") throw new Error(board.refusal);
    if (board) {
      const { home, slot } = board, was = home.shot.unit[slot] ?? null, f = await T.frameAt(t, "last", { frame: 0 }), name = slot === "key" ? "key drawing" : "board";
      await SC.setUnit(home.scene.id, home.shot.id, { ...home.shot.unit, [slot]: { file: f.file, from: { take: t.id, frame: f.frame } } }, by, `${board.cut} ${name} picked`);
      const active = home.shot.active && T.get(home.shot.active);
      return { take: t.id, scene: home.scene.id, shot: home.shot.id, slot, board_was: was, said: `take ${t.number} is now ${board.cut}'s ${name}${slot === "board" ? " (not approved yet: approve it in the Book's Boards lens)" : ""}; the cut's active take stays ${active ? `take ${active.number}` : "unset"}` };
    }
    const home = shotOf(t);
    if (!home) { t.verdict = "keep"; await T.save(t); return { take: t.id, kept: true }; }
    const was = home.shot.active ?? null, old = was && T.get(was), title = SC.shotTitle(home.scene, home.shot);
    await SC.setActive(home.scene.id, home.shot.id, t.id, by);
    // F-G08: the answer names the take it replaced, and how to put it back
    return { take: t.id, scene: home.scene.id, shot: home.shot.id, was, said: `take ${t.number} is now ${title}'s active take${was === t.id ? " (it already was)" : was ? `, in place of take ${old?.number ?? was} (${was}); undo_candidate {decision: "${d.id}"} puts that one back` : " (it had none)"}` };
  },
  undo: async (d, c, that) => {
    if (that.slot) { await SC.load(); const shot = SC.get(that.scene)?.shots.find((x) => x.id === that.shot), { [that.slot]: _, ...rest } = shot?.unit ?? {}; if (shot) await SC.setUnit(that.scene, that.shot, that.board_was ? { ...rest, [that.slot]: that.board_was } : rest, "person", "board pick undone"); return; }
    if (that.scene) await SC.setActive(that.scene, that.shot, that.was, "person"); else { const t = T.get(that.take); if (t) { t.verdict = null; await T.save(t); } } },
  reject: async (d, c, by) => { await T.load(); const t = T.get(`take-${c.prompt_id}`); if (t) { t.verdict = "reject"; t.verdict_by = by; await T.save(t); } },
};

// open the take's chain as it ran: the shot's tab (or the shot `home` names, U89's "lands in") with the take's settings
// and pins put back, else a scratch tab (home null)
export async function openTake(take, home) {
  // F-AC08 (SNAP-R214): a paint or edit queued as a bare prompt keeps a workflow with no nodes; opening it emptied the
  // shot's tab and saved that over the shot. Refuse before anything opens or is written
  if (!take.graph?.nodes?.length) throw new Error(`take ${take.number} has no recipe to open (it was made by ${take.parent?.method ?? "a paint or an edit"}, queued as a prompt with no workflow nodes); make it again with the call that made it (get_take shows its parent). Nothing was opened or saved`);
  await SC.load();
  if (home === undefined) home = shotOf(take);
  // the take's whole graph as the shot's workflow (widget-by-widget restore misplaces dynamic rows, a LoRA stack's, so
  // "as it was" would not be exact); a shot tab with unsaved changes keeps them and the graph opens in a new tab (SNAP-R5)
  if (home) return SC.loadIntoShot(home.scene.id, home.shot.id, take.graph, `take ${take.number}`);
  const { snap_scene, ...extra } = take.graph.extra ?? {};
  await app.loadGraphData({ ...structuredClone(take.graph), id: crypto.randomUUID(), extra: structuredClone(extra) }, true, true, `${take.workflow || "take"} #${take.number} · retake`); // F-F21: a scratch tab's takes are its own, not the source shot's
  return "a new tab";
}

// put each moved pin (or only `refs`) at its record's newest version; returns what was said
export async function toToday(refs) {
  const said = [];
  for (const m of T.moves(E.state().world)) if (!m.missing && (!refs?.length || refs.includes(m.ref))) said.push(await L.updatePin(m.ref));
  return said;
}

// SNAP-R234: the dial rows a re-take runs with. A take of a Book cut whose plan has dial rows takes the plan's rows as they
// stand now ("cut", the default there), so a key moved onto a word (set_cut_dials move_key) lands in a same-seed re-take;
// "take" keeps the rows that ran. -> null when the rack stays as the take had it, else {rows, changes: the words}
export function cutRows(take, dials) {
  if (dials && dials !== "cut" && dials !== "take") throw new Error(`dials is cut (the cut's planned rows) or take (the rows that ran); not ${JSON.stringify(dials)}`);
  // the cut its story pin names, else the Book cut whose shot holds it (a take made before the cut was planned)
  const pin = take.story ?? take.graph?.extra?.snap?.story, scene = pin?.unit && SC.get(pin.unit.scene), home = scene ? null : shotOf(take);
  const unit = scene ? scene.shots.find((x) => x.id === pin.unit.shot)?.unit : home?.scene.book ? home.shot.unit : null;
  if (dials === "take" || !unit?.dials) { if (dials === "cut") throw new Error(`take ${take.number} ${unit ? `is of ${unit.cut ?? "a cut"} whose plan has no dial rows (set_cut_dials plans them)` : "isn't a Book cut's take"}: dials "cut" has nothing to put on the rack`); return null; }
  const ran = rackOf(take.graph) ?? [], text = (r) => JSON.stringify(r ?? null), changes = [];
  for (const r of unit.dials) { const was = ran.find((x) => x.dial === r.dial); if (text(was) !== text(r)) changes.push(was ? keyWords(was, r) : `${r.dial} added (in ${unit.cut ?? "the cut"}'s plan)`); }
  for (const r of ran) if (r.dial && !unit.dials.some((x) => x.dial === r.dial)) changes.push(`${r.dial} taken off (not in ${unit.cut ?? "the cut"}'s plan)`);
  return { rows: unit.dials, changes };
}
// the rack rows a graph ran with: its Dial Rack's rack widget, at the top level or inside a blueprint
export function rackOf(graph) {
  for (const n of [...(graph?.nodes ?? []), ...(graph?.definitions?.subgraphs ?? []).flatMap((g) => g.nodes ?? [])]) if (n.type === "MAIDialRack") {
    const v = Array.isArray(n.widgets_values) ? n.widgets_values.find((x) => typeof x === "string" && x.trim().startsWith("[")) : n.widgets_values?.rack;
    try { return JSON.parse(v ?? "[]"); } catch { return null; }
  }
  return null;
}
const keyWords = (was, r) => {
  const a = was.time?.points ?? [], b = r.time?.points ?? [], moved = b.map(([t], i) => (a[i] && a[i][0] !== t ? `key ${i + 1}: ${a[i][0]} s → ${t} s` : null)).filter(Boolean);
  return `${r.dial}: ${moved.length ? moved.join(", ") : [was.strength !== r.strength && `strength ${was.strength} → ${r.strength}`, JSON.stringify(was.time) !== JSON.stringify(r.time) && "its time curve changed", was.on !== r.on && (r.on === false ? "off" : "on")].filter(Boolean).join(", ") || "changed"}`;
};

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
export async function retake(take, { world = "pinned", seed = "same", refs, dials, queue: go = true, by = "person" } = {}) {
  if (!WORLDS.includes(world)) throw new Error(`world is one of ${WORLDS.join(", ")}`);
  if (!SEEDS.includes(seed)) throw new Error(`seed is one of ${SEEDS.join(", ")}`);
  if (!take.graph) throw new Error(`Take ${take.number} has no workflow saved with it`);
  await SC.load();
  const rows = cutRows(take, dials), where = await openTake(take), updated = world === "latest" ? await toToday(refs) : [];
  if (rows) { if (!E.state().bricks.some((b) => b.key === "rack")) await E.snap("rack"); D.replace(rows.rows); if (rows.changes.length) updated.push(`dial rows from the cut's plan: ${rows.changes.join("; ")}`); }
  const seedKey = E.state().bricks.find((b) => E.seedMode(b.key))?.key, newSeed = seed === "new" && seedKey ? E.newSeed(seedKey) : null;
  const run = go ? await queue("retake", { take: take.id, world, seed }, { title: `Re-take take ${take.number} ${worldShown(world)}${seed === "new" ? ", new seed" : ""}`, by, eta_s: take.seconds ?? null }) : null;
  await SC.saveOpen(); // the shot's workflow as it ran, so a next re-take from this tab finds nothing unsaved
  return { take: take.id, world, seed, opened: where, updated, ...(newSeed != null ? { new_seed: newSeed } : {}), run,
    said: `Take ${take.number} ${go ? "re-taken" : "opened"} ${worldShown(world)} in ${where}${updated.length ? ` · ${updated.join(" · ")}` : ""}${go ? "" : " · nothing is queued"}` };
}
