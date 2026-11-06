// continuity_check v0 probe set: planted breaks between two states of the example set; catch rate + false alarms.
// node test_continuity.mjs  (pure data; no server, no browser)
import path from "node:path";
import CFG from "./snaptest_config.js";
import { readFileSync, writeFileSync } from "node:fs";
const { diff } = await import(path.join(CFG.pack, "web", "snap", "continuity.js"));
const base = JSON.parse(readFileSync(path.join(CFG.pack, "snap_cards", "sets.json"), "utf8"))[0].brick.snapshot;
const v = (edit) => { const s = structuredClone(base); edit(s); return s; };
const prop = (s, n) => s.props.find((p) => p.name === n), actor = (s, n) => s.actors.find((a) => a.name === n);
// [name, edit, expected findings as [severity, substring]]
const PAIRS = [
  ["clean", () => {}, []],
  ["jitter under thresholds", (s) => { prop(s, "chair").at = [-1.5, 0.85]; actor(s, "Ferro").facing += 10; actor(s, "Kon").at = [0.7, -1.5]; }, []],
  ["camera crossed the line", (s) => { s.camera.at = [2.0, -2.0]; }, [["break", "screen direction flips"]]],
  ["wardrobe change", (s) => { actor(s, "Ferro").wardrobe = 2; }, [["break", "wardrobe 1 -> 2"]]],
  ["prop state change", (s) => { prop(s, "radio").state = "off"; }, [["break", "radio: on, dial lit -> off"]]],
  ["prop vanished", (s) => { s.props = s.props.filter((p) => p.name !== "lantern"); }, [["break", "lantern is gone"]]],
  ["prop appeared", (s) => { s.props.push({ name: "teacup", at: [-1.4, 1.5], size: [0.1, 0.1], height: 0.85 }); }, [["break", "teacup appeared"]]],
  ["time of day jump", (s) => { s.light.description = "warm morning sun through the east window"; }, [["check", "light:"]]],
  ["big turn", (s) => { actor(s, "Ferro").facing = 270; }, [["check", "Ferro turned 180"]]],
  // Kon walks from the door to the centre: from this camera she ends up left of Ferro instead of right, so the
  // line has swung past the camera and screen direction flips (worked by hand 04:57; the old expectation was wrong)
  ["actor moved", (s) => { actor(s, "Kon").at = [0.6, -0.1]; }, [["note", "Kon moved 1.5 m"], ["break", "screen direction flips"]]],
  ["actor moved without swinging the line past the camera", (s) => { actor(s, "Kon").at = [0.2, -1.9]; }, [["note", "Kon moved 0.5 m"]]],
  ["hands change", (s) => { actor(s, "Kon").hands = "empty-handed"; }, [["check", "Kon's hands"]]],
  // review 2 (04:56): the 180-degree test must follow the actors, not their list positions
  ["actors swap places, camera follows to the far side (direction kept)", (s) => { const f = actor(s, "Ferro").at, k = actor(s, "Kon").at; actor(s, "Ferro").at = k; actor(s, "Kon").at = f; s.camera.at = [2.0, -2.0]; }, [["note", "Ferro moved"], ["note", "Kon moved"]]],
  ["actors swap places, camera stays (direction flips)", (s) => { const f = actor(s, "Ferro").at, k = actor(s, "Kon").at; actor(s, "Ferro").at = k; actor(s, "Kon").at = f; }, [["break", "screen direction flips"], ["note", "Ferro moved"], ["note", "Kon moved"]]],
  ["two chairs, the first is removed", (s) => { s.props = s.props.filter((p) => p !== prop(s, "chair")); }, [["break", "chair is gone"]], (s) => s.props.push({ name: "chair", at: [-1.0, 0.8], size: [0.5, 0.5], height: 0.9 })],
  ["two breaks at once", (s) => { s.camera.at = [2.0, -2.0]; actor(s, "Kon").wardrobe = 3; }, [["break", "screen direction flips"], ["break", "Kon: wardrobe 1 -> 3"]]],
];
let caught = 0, planted = 0, falseAlarms = 0;
const rows = PAIRS.map(([name, edit, want, prep]) => {
  const a = prep ? v(prep) : base, b = structuredClone(a); edit(b);
  const found = diff(a, b);
  const hit = want.map(([sev, sub]) => found.some((f) => f.severity === sev && f.what.includes(sub)));
  const extra = found.filter((f) => !want.some(([sev, sub]) => f.severity === sev && f.what.includes(sub)));
  planted += want.length; caught += hit.filter(Boolean).length; falseAlarms += extra.length;
  return { name, ok: hit.every(Boolean) && !extra.length, found: found.map((f) => `${f.severity}: ${f.what}`), missed: want.filter((_, i) => !hit[i]), extra: extra.map((f) => f.what) };
});
const summary = { pairs: PAIRS.length, planted, caught, falseAlarms, rows };
writeFileSync(path.join(CFG.out, "ui", "test_continuity_result.json"), JSON.stringify(summary, null, 1));
console.log(`continuity v0: caught ${caught}/${planted} planted changes, ${falseAlarms} false alarms over ${PAIRS.length} pairs`);
for (const r of rows) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.name}: ${r.found.join("; ") || "(nothing)"}${r.missed.length ? `  MISSED ${JSON.stringify(r.missed)}` : ""}${r.extra.length ? `  EXTRA ${JSON.stringify(r.extra)}` : ""}`);
