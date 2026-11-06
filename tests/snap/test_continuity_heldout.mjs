// continuity_check v0 on the held-out probes (written blind to the checker by a separate agent; see continuity_heldout.md)
import path from "node:path";
import CFG from "./snaptest_config.js";
import { readFileSync, writeFileSync } from "node:fs";
const { diff } = await import(path.join(CFG.pack, "web", "snap", "continuity.js"));
const base = JSON.parse(readFileSync(path.join(CFG.pack, "snap_cards", "sets.json"), "utf8"))[0].brick.snapshot;
const pairs = JSON.parse(readFileSync(new URL("./continuity_heldout.json", import.meta.url), "utf8"));
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
let pass = 0, planted = 0, caught = 0, cleanAlarms = 0;
const rows = pairs.map((p) => {
  const a = apply(base, p.base), b = apply(a, p.edits);
  const found = diff(a, b);
  const hits = p.expect.map(([sev, kw]) => found.some((f) => f.severity === sev && f.what.toLowerCase().includes(kw.toLowerCase())));
  const ok = p.expect.length ? hits.every(Boolean) : found.length === 0;
  pass += ok; planted += p.expect.length; caught += hits.filter(Boolean).length;
  if (!p.expect.length) cleanAlarms += found.length;
  return { name: p.name, ok, expect: p.expect, found: found.map((f) => `${f.severity}: ${f.what}`) };
});
writeFileSync(path.join(CFG.out, "ui", "test_continuity_heldout_result.json"), JSON.stringify({ pass, pairs: pairs.length, planted, caught, cleanAlarms, rows }, null, 1));
console.log(`continuity v0 held-out: ${pass}/${pairs.length} pairs pass; caught ${caught}/${planted} expected findings; ${cleanAlarms} findings on ${pairs.filter((p) => !p.expect.length).length} clean pairs`);
for (const r of rows) if (!r.ok) console.log(`FAIL ${r.name}\n   expect ${JSON.stringify(r.expect)}\n   found  ${JSON.stringify(r.found)}`);
