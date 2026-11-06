// eyeline check on held-out probes written blind to the code by a separate agent (eyeline_heldout.json)
import path from "node:path";
import CFG from "./snaptest_config.js";
import { readFileSync, writeFileSync } from "node:fs";
const { eyelines } = await import(path.join(CFG.pack, "web", "snap", "continuity.js"));
const base = JSON.parse(readFileSync(path.join(CFG.pack, "snap_cards", "sets.json"), "utf8"))[0].brick.snapshot;
const cases = JSON.parse(readFileSync(new URL("./eyeline_heldout.json", import.meta.url), "utf8"));
function apply(state, edits = []) {
  const s = structuredClone(state);
  for (const [path, value] of edits) {
    const keys = path.split("/").slice(1), last = keys.pop();
    let at = s;
    for (const k of keys) at = at[/^\d+$/.test(k) ? Number(k) : k];
    if (last === "-") at.push(value);
    else if (Array.isArray(at) && /^\d+$/.test(last) && value === null) at.splice(Number(last), 1);
    else if (value === null) delete at[last];
    else at[/^\d+$/.test(last) ? Number(last) : last] = value;
  }
  return s;
}
let pass = 0;
const rows = cases.map((c) => {
  const found = eyelines(apply(base, c.edits));
  const ok = c.expect.length ? c.expect.every(([sev, kw]) => found.some((f) => f.severity === sev && f.what.includes(kw) && f.what.includes("eyeline"))) && found.length === c.expect.length : found.length === 0;
  pass += ok;
  return { name: c.name, ok, expect: c.expect, found: found.map((f) => f.what) };
});
writeFileSync(path.join(CFG.out, "ui", "test_eyeline_heldout_result.json"), JSON.stringify({ pass, total: cases.length, rows }, null, 1));
console.log(`eyeline held-out: ${pass}/${cases.length}`);
for (const r of rows) if (!r.ok) console.log(`FAIL ${r.name}\n   expect ${JSON.stringify(r.expect)}\n   found  ${JSON.stringify(r.found)}`);
