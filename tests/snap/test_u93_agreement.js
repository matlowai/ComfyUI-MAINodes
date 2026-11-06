// U93 B7 (SNAP-R108) on a CPU test server: critic_report and Add as fixture from a miss.
// - takes with written critiques: the person kept/rejected two in agreement (keep + clean, reject + high), kept one
//   against a high note (disagree), and applied the critic's cleanest of 3 candidates (its pick keeps it: 3/4 verdicts, 1/1 picks);
// - a person's "went wrong" note on a critiqued take that no critic note covers is a miss; add_fixture on it copies the
//   picture to the fixtures folder, stamps the note, and the report lists the miss with its fixture;
// - a fixtures score recorded in snap/critic_report/fixtures.json shows in the report's one line; the day's file is kept.
// usage: node test_u93_agreement.js <port> <base>   prints "u93agree n/m" last
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, out = path.join(CFG.out, "ui", "u93"), R = {};
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d}-u93a-${Date.now()}`)); } };
(async () => {
  ["critiques", "takes", "candidates", "critic_fixtures", "critic_report"].forEach(park);
  fs.copyFileSync(CFG.fixture("short03", "settei_bg", "plates", "Pd_houses.png"), path.join(base, "output", "snaptest", "u93_agree.png"));
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  await fetch(`http://127.0.0.1:${port}/userdata/${encodeURIComponent("snap/critic_report/fixtures.json")}?overwrite=true`, { method: "POST", body: JSON.stringify({ caught: 25, of: 29, fa: 0, clean: 9, at: "2026-11-06T08:00:00", holds: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(async ([n, x]) => { const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); I.setCaller("critic-a"); return window.__X.callTool(n, x).catch((e) => ({ error: e.message })); }, [name, args]);
    await page.evaluate(async () => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); await CR.reload(); window.__CR = CR; });
    await page.evaluate(async () => {
      const T = window.__T, C = window.__C, mk = (id, n) => ({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), finished: Date.now(), seconds: 9, group: app.graph.id, number: n, status: "success", text: "u93 agree", seed: 1, media: [{ kind: "image", filename: "u93_agree.png", subfolder: "snaptest", type: "output" }], prompt: {}, graph: {}, verdict: null, notes: [] });
      for (const [id, n] of [["take-ag-1", 1], ["take-ag-2", 2], ["take-ag-3", 3], ["take-ag-c1", 4], ["take-ag-c2", 5], ["take-ag-c3", 6]]) await T.save(mk(id, n));
      await C.create({ kind: "rerun", target: "take-ag-1", title: "three seeds", by: "agent", take: "take-ag-1" }, ["take-ag-c1", "take-ag-c2", "take-ag-c3"].map((take) => ({ take, prompt_id: take.slice(5), state: "ready" })));
    });
    const rowOf = (t) => page.evaluate(async (t) => { for (let i = 0; i < 40; i++) { await window.__CR.reload(); const r = window.__CR.all().find((x) => x.subject.take === t); if (r) return r.id; await new Promise((ok) => setTimeout(ok, 250)); } return null; }, t);
    const crit = async (t, notes) => { const id = await rowOf(t); await call("claim_critique", { critique: id }); return call("write_critique", { critique: id, verdict: notes.length ? "flaws" : "clean", notes }); };
    const high = [{ severity: "high", pass: "map", text: "the wall stops at the right edge", region: [0.7, 0.1, 0.3, 0.4], owner: "take" }];
    await crit("take-ag-1", []); await crit("take-ag-2", high); await crit("take-ag-3", high);
    await crit("take-ag-c1", high); await crit("take-ag-c2", []); await crit("take-ag-c3", high);
    // the person's verdicts and pick, and a note the critic missed
    await page.evaluate(async () => { const T = window.__T, C = window.__C;
      for (const [id, v] of [["take-ag-1", "keep"], ["take-ag-2", "reject"], ["take-ag-3", "keep"]]) { const t = T.get(id); t.verdict = v; await T.save(t); }
      await T.note(T.get("take-ag-1"), { t: 0, region: [0.05, 0.6, 0.2, 0.3], sentiment: "wrong", tags: ["physics"], text: "a lantern floats over the left doorway" });
      const d = C.all().find((x) => x.title === "three seeds"); await C.apply(d.id, "c2", "person"); });
    R.report = await call("critic_report", {});
    const miss = R.report.misses?.[0];
    R.add = await call("add_fixture", { take: miss?.take, note: miss?.note, words: "the critic missed the floating lantern" });
    R.report2 = await call("critic_report", {});
    R.local = JSON.parse(fs.readFileSync(path.join(snap, "critic_fixtures", "fixtures.local.json"))).fixtures.at(-1);
    R.day = fs.readdirSync(path.join(snap, "critic_report"));
    R.errors = A.errors;
  } finally { await b.close(); }
  const checks = [
    R.report.verdicts?.agree === 3 && R.report.verdicts.of === 4 && R.report.verdicts.rows.find((x) => x.take === "take-ag-3")?.agree === false,
    R.report.picks?.agree === 1 && R.report.picks.of === 1 && R.report.picks.rows[0].cleanest === "c2",
    R.report.misses?.length === 1 && R.report.misses[0].take === "take-ag-1" && /lantern floats/.test(R.report.misses[0].text),
    R.add?.fixture === "L01" && R.local?.expected?.[0]?.flaw === "a lantern floats over the left doorway" && /box x 0.05/.test(R.local.expected[0].where) && R.local.note === "the critic missed the floating lantern",
    R.report2.misses?.[0]?.fixture?.id === "L01" && /3\/4 verdicts and 1\/1 picks; 1 miss, 1 now fixtures; fixtures 25\/29 caught, 0 false alarms/.test(R.report2.said),
    R.day.some((f) => /^\d{4}-\d\d-\d\d\.json$/.test(f)),
    !R.errors.length,
  ];
  R.checks = checks;
  fs.writeFileSync(path.join(out, "test_u93_agreement_result.json"), JSON.stringify(R, null, 1));
  console.log(`u93agree ${checks.filter(Boolean).length}/${checks.length} ${checks.every(Boolean) ? "PASS" : "FAIL " + JSON.stringify(checks.map((x, i) => (x ? null : i)).filter((x) => x != null))}`);
})();
