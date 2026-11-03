// Continuity check v0 (BRAINSTORM C1): what changed between two states of one set, graded like a script supervisor's
// notes. `break` = the cut will read as a mistake unless the script says so (camera crossed the line, wardrobe or a
// prop's state changed, something vanished); `check` = probably intended but worth a look (time of day, a big turn);
// `note` = ordinary blocking (someone moved). Pure data: no model, no pixels.
import { side } from "./setsnap.js";

const MOVE = 0.3, TURN = 45, LIGHT = 30; // metres, degrees, degrees
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const turn = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

// in a dialogue two-hander each actor should look toward their partner; a set marks itself with `dialogue: true`
const EYELINE = 30;
export function eyelines(s) {
  if (!s.dialogue || s.actors.length !== 2) return [];
  const [a, b] = s.actors, out = [];
  for (const [x, y] of [[a, b], [b, a]]) {
    const want = ((Math.atan2(y.at[0] - x.at[0], y.at[1] - x.at[1]) * 180) / Math.PI + 360) % 360;
    const off = turn(x.facing, want);
    if (off > EYELINE) out.push({ severity: "check", what: `${x.name} looks ${Math.round(off)} degrees away from ${y.name} (eyeline)` });
  }
  return out;
}

export function diff(before, after) {
  const out = [];
  const add = (severity, what) => out.push({ severity, what });
  // screen direction: each camera against its own shot's line, with the actors taken in the same order (by name), so
  // actors who swap places and a camera that follows them keep the cut; a camera that stays while they swap flips it
  const pair = before.actors.length === 2 && before.actors.map((a) => after.actors.find((b) => b.name === a.name));
  if (pair && pair.every(Boolean)) {
    const was = side(before), now = side({ ...after, actors: pair });
    if (was && now && was !== now) add("break", `screen direction flips: the camera is on the other side of the line between ${pair[0].name} and ${pair[1].name}`);
  }
  if (after.camera.lens !== before.camera.lens) add("note", `lens ${before.camera.lens} mm -> ${after.camera.lens} mm`);

  // things with the same name (two chairs) pair up closest pair first across all of them; leftovers are gone / new
  const byName = (list) => { const m = new Map(); for (const x of list) m.set(x.name, [...(m.get(x.name) ?? []), x]); return m; };
  const pairs = (a, b) => [...a].flatMap(([name, xs]) => {
    const ys = b.get(name) ?? [], match = new Map(), taken = new Set();
    const cand = xs.flatMap((x) => ys.map((y) => [dist(x.at, y.at), x, y])).sort((p, q) => p[0] - q[0]);
    for (const [, x, y] of cand) if (!match.has(x) && !taken.has(y)) { match.set(x, y); taken.add(y); }
    return xs.map((x) => [name, x, match.get(x)]);
  });
  const extra = (a, b) => [...b].flatMap(([name, ys]) => ys.slice(a.get(name)?.length ?? 0).map(() => name));
  const [pa, pb] = [byName(before.props), byName(after.props)];
  for (const [name, p, q] of pairs(pa, pb)) {
    if (!q) { add("break", `${name} is gone`); continue; }
    if ((p.state ?? "") !== (q.state ?? "")) add("break", `${name}: ${p.state || "as before"} -> ${q.state || "no state"}`);
    if (dist(p.at, q.at) > MOVE) add("check", `${name} moved ${dist(p.at, q.at).toFixed(1)} m`);
  }
  for (const name of extra(pa, pb)) add("break", `${name} appeared`);

  const [aa, ab] = [byName(before.actors), byName(after.actors)];
  for (const [name, a, b] of pairs(aa, ab)) {
    if (!b) { add("check", `${name} left the set`); continue; }
    if (a.wardrobe !== b.wardrobe) add("break", `${name}: wardrobe ${a.wardrobe} -> ${b.wardrobe}`);
    if ((a.hands ?? "") !== (b.hands ?? "")) add("check", `${name}'s hands: ${a.hands || "empty"} -> ${b.hands || "empty"}`);
    if (dist(a.at, b.at) > MOVE) add("note", `${name} moved ${dist(a.at, b.at).toFixed(1)} m`);
    if (turn(a.facing, b.facing) > TURN) add("check", `${name} turned ${Math.round(turn(a.facing, b.facing))} degrees`);
  }
  for (const name of extra(aa, ab)) add("note", `${name} entered`);

  if (before.light.description !== after.light.description) add("check", `light: "${before.light.description}" -> "${after.light.description}"`);
  if (turn(before.light.from, after.light.from) > LIGHT) add("check", `key light swung ${Math.round(turn(before.light.from, after.light.from))} degrees`);
  return out;
}
