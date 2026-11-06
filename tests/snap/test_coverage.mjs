// coverage setups + eyeline check (pure data). node test_coverage.mjs
import path from "node:path";
import CFG from "./snaptest_config.js";
import { readFileSync, writeFileSync } from "node:fs";
const { coverage, side, bridges, between, sideTrack } = await import(path.join(CFG.pack, "web", "snap", "setsnap.js"));
const { eyelines, diff } = await import(path.join(CFG.pack, "web", "snap", "continuity.js"));
const base = JSON.parse(readFileSync(path.join(CFG.pack, "snap_cards", "sets.json"), "utf8"))[0].brick.snapshot;
const bearing = (f, t) => ((Math.atan2(t[0] - f[0], t[1] - f[1]) * 180) / Math.PI + 360) % 360;
const off = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const checks = {};
function coverageChecks(s, tag) {
  const c = coverage(s), [A, B] = s.actors, mid = [(A.at[0] + B.at[0]) / 2, (A.at[1] + B.at[1]) / 2];
  const target = { master: mid, [`OTS on ${B.name}`]: B.at, [`OTS on ${A.name}`]: A.at, [`single ${A.name}`]: A.at, [`single ${B.name}`]: B.at };
  checks[`${tag}: five setups`] = c.length === 5;
  checks[`${tag}: all on the camera's side of the line`] = c.every((x) => side(s, x.at) === side(s));
  checks[`${tag}: all inside the room`] = c.every((x) => Math.abs(x.at[0]) <= s.room.size[0] / 2 && Math.abs(x.at[1]) <= s.room.size[1] / 2);
  checks[`${tag}: no camera stands in a prop`] = c.every((x) => !s.props.some((p) => Math.abs(x.at[0] - p.at[0]) < p.size[0] / 2 && Math.abs(x.at[1] - p.at[1]) < p.size[1] / 2));
  checks[`${tag}: each aims at its subject (< 1.5 deg)`] = c.every((x) => off(x.facing, bearing(x.at, target[x.name])) < 1.5);
  checks[`${tag}: OTS sits behind the near actor (< 1.2 m)`] = Math.hypot(c[1].at[0] - A.at[0], c[1].at[1] - A.at[1]) < 1.2 && Math.hypot(c[2].at[0] - B.at[0], c[2].at[1] - B.at[1]) < 1.2;
  return c;
}
const setups = coverageChecks(base, "lamp room");
const mirrored = structuredClone(base); mirrored.camera.at = [2.0, -2.0]; // no previous shot: follows the current camera
const msetups = coverageChecks(mirrored, "camera on the other side");
checks["mirrored setups flip sides"] = msetups.every((x) => side(base, x.at) === -side(base));
const continuing = structuredClone(mirrored); continuing.previous = structuredClone(base); // camera crossed; the last shot was on base's side
checks["with a previous shot, coverage keeps the previous shot's side"] = coverage(continuing).every((x) => side(base, x.at) === side(base));
const eye = (edit) => { const s = structuredClone(base); edit(s); return eyelines(s); };
const toward = (s, who, other, plus) => { const a = s.actors.find((x) => x.name === who), b = s.actors.find((x) => x.name === other); a.facing = (bearing(a.at, b.at) + plus + 360) % 360; };
checks["eyeline: off outside a dialogue scene"] = eye(() => {}).length === 0;
checks["eyeline: Ferro at the window, in dialogue -> check"] = eye((s) => { s.dialogue = true; toward(s, "Kon", "Ferro", 0); }).some((f) => f.what.startsWith("Ferro looks"));
checks["eyeline: both looking at each other -> nothing"] = eye((s) => { s.dialogue = true; toward(s, "Kon", "Ferro", 0); toward(s, "Ferro", "Kon", 0); }).length === 0;
checks["eyeline: 29 deg off -> nothing"] = eye((s) => { s.dialogue = true; toward(s, "Kon", "Ferro", 29); toward(s, "Ferro", "Kon", -29); }).length === 0;
checks["eyeline: 31 deg off -> check"] = eye((s) => { s.dialogue = true; toward(s, "Kon", "Ferro", 31); toward(s, "Ferro", "Kon", 0); }).length === 1;
// bridges (C6): a neutral camera on the axis cuts with either side; a cutaway sees a prop and no actor
const br = bridges(base), crossed = structuredClone(base); crossed.camera.at = [2.0, -2.0];
const neutralState = { ...structuredClone(base), camera: br.neutral };
checks["bridge: neutral camera sits on the line"] = side(base, br.neutral.at) === 0 || Math.abs((() => { const [A, B] = base.actors; return ((B.at[0] - A.at[0]) * (br.neutral.at[1] - A.at[1]) - (B.at[1] - A.at[1]) * (br.neutral.at[0] - A.at[0])) / Math.hypot(B.at[0] - A.at[0], B.at[1] - A.at[1]); })()) < 0.02;
checks["bridge: neutral inside the room"] = Math.abs(br.neutral.at[0]) <= 2.5 && Math.abs(br.neutral.at[1]) <= 2.5;
checks["bridge: last shot -> neutral is not a break"] = !diff(base, neutralState).some((f) => f.severity === "break");
checks["bridge: neutral -> crossed shot is not a break"] = !diff(neutralState, crossed).some((f) => f.severity === "break");
checks["bridge: without it the crossing is a break"] = diff(base, crossed).some((f) => f.what.startsWith("screen direction flips"));
const cut = br.cutaway, half = Math.atan(36 / (2 * cut.lens)) * 180 / Math.PI;
const inView = (pt) => off(cut.facing, bearing(cut.at, pt)) <= half;
checks["bridge: cutaway frames its prop"] = base.props.some((p) => cut.setup.includes(p.name) && inView(p.at));
checks["bridge: cutaway has no actor in frame"] = base.actors.every((a) => !inView(a.at));
// matched reciprocal pairs (C7)
const ots = Object.fromEntries(setups.map((x) => [x.name, x]));
const withCam = (cam) => ({ ...structuredClone(base), camera: { ...cam } });
const pairFindings = (a, b) => diff(withCam(a), withCam(b)).filter((f) => f.what.includes("pair doesn't match"));
checks["pair: matched OTS lenses -> nothing"] = pairFindings(ots["OTS on Kon"], ots["OTS on Ferro"]).length === 0;
checks["pair: OTS 50 vs 35 mm -> check"] = pairFindings(ots["OTS on Kon"], { ...ots["OTS on Ferro"], lens: 35 }).some((f) => f.severity === "check" && f.what.includes("50 mm vs 35 mm"));
checks["pair: OTS height 1.5 vs 1.8 m -> check"] = pairFindings(ots["OTS on Kon"], { ...ots["OTS on Ferro"], height: 1.8 }).some((f) => f.what.includes("height"));
checks["pair: OTS vs single (not a pair) -> nothing"] = pairFindings(ots["OTS on Kon"], { ...ots["single Ferro"], lens: 35 }).length === 0;
checks["pair: hand-moved camera (no setup tag) -> nothing"] = pairFindings(ots["OTS on Kon"], { ...ots["OTS on Ferro"], lens: 35, setup: undefined }).length === 0;
// in-shot scrub (C8)
const still = sideTrack(base, base);
checks["scrub: nothing moves -> one side all shot, no flips"] = still.flips.length === 0 && new Set(still.track).size === 1;
const walk = structuredClone(base); walk.actors.find((a) => a.name === "Kon").at = [0.6, -0.1]; // the walk that swings the line past the camera
const tw = sideTrack(base, walk);
checks["scrub: Kon's walk flips the side once, mid-shot"] = tw.flips.length === 1 && tw.flips[0] > 0 && tw.flips[0] < 1;
checks["scrub: ends agree with the cut test"] = tw.track[0] === side(base) && tw.track.at(-1) === side(walk);
const mid = between(base, walk, 0.5);
checks["scrub: halfway is halfway"] = Math.abs(mid.actors.find((a) => a.name === "Kon").at[1] - -0.85) < 1e-9;
const spin = structuredClone(base); spin.actors.find((a) => a.name === "Kon").facing = 340; // 20 -> 340 turns 40 deg the short way
checks["scrub: turns the short way round"] = Math.abs(between(base, spin, 0.5).actors.find((a) => a.name === "Kon").facing - 0) < 1e-9;
const pass = Object.values(checks).filter(Boolean).length;
writeFileSync(path.join(CFG.out, "ui", "test_coverage_result.json"), JSON.stringify({ pass, total: Object.keys(checks).length, checks, setups, msetups }, null, 1));
console.log(`coverage + eyeline: ${pass}/${Object.keys(checks).length}`);
for (const [k, v] of Object.entries(checks)) if (!v) console.log("FAIL", k);
for (const x of setups) console.log(`  ${x.name}: at ${x.at} facing ${x.facing} ${x.lens} mm`);
