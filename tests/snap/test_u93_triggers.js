// U93 B3 (SNAP-R101, R104, R107) on a CPU test server: what makes a critique row, and the approval note.
// - takes landing in a scene's shots make one row each; two shots with active takes in a row make one cut-pair row;
// - an upscaled take reads with the upscale checklist, a video take with the cut checklist;
// - a re-run decision whose 3 candidates are takes: 3 rows, folded into one Work card row for the decision;
// - a Cast saved with a new picture makes one sheet row per version;
// - "approval: critic" on the scene: a clean critique sets the take's verdict keep, by agent; a shot note "approval:
//   person" (inner) keeps it the person's; a verdict the person set is never overwritten; a high note sets nothing;
// - a reload makes no new rows (each subject once).
// usage: node test_u93_triggers.js <port> <base>   prints "u93triggers n/m" last
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, out = path.join(CFG.out, "ui", "u93"), R = {};
const SETTEI = CFG.fixture("short03", "settei_bg");
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-u93t-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  ["critiques", "takes", "candidates", "scenes", "instruction", "_archived/instruction", "cast", "location"].forEach(park);
  fs.copyFileSync(path.join(SETTEI, "plates", "Pd_houses.png"), path.join(base, "output", "snaptest", "u93_t_still.png"));
  fs.copyFileSync(path.join(SETTEI, "plates", "Pa_road_outside.png"), path.join(base, "input", "u93_cast_a.png"));
  fs.copyFileSync(path.join(SETTEI, "plates", "Pc_square_well.png"), path.join(base, "input", "u93_cast_b.png"));
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) }); // an earlier run's finished jobs would be adopted as takes (F-C25)
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    let A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(async ([n, x]) => { const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); I.setCaller("critic-t"); return window.__X.callTool(n, x).catch((e) => ({ error: e.message })); }, [name, args]);
    const CRall = () => page.evaluate(async () => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); await CR.reload(); return CR.all().map((r) => ({ id: r.id, key: r.key, checklist: r.checklist, about: r.about, subject: r.subject })); });
    const settle = async (n) => { for (let i = 0; i < 60; i++) { const all = await CRall(); if (all.length >= n) return all; await page.waitForTimeout(250); } return CRall(); };
    await page.evaluate(async () => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); await CR.reload(); });
    R.scene = await page.evaluate(async () => {
      const SC = window.__SC, T = window.__T, C = window.__C;
      const s = await SC.create({ name: "U93 scene" }), a = (await SC.addShot(s.id, { name: "arrive" })).shot, b = (await SC.addShot(s.id, { name: "gate" })).shot;
      const mk = (id, number, group, kind, extra = {}) => ({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), finished: Date.now(), seconds: 9, group, number, status: "success", text: "u93", seed: 1,
        media: [kind === "video" ? { kind: "video", filename: "identity_video_00001_.mp4", subfolder: "snaptest", type: "output" } : { kind: "image", filename: "u93_t_still.png", subfolder: "snaptest", type: "output" }], prompt: {}, graph: {}, verdict: null, notes: [], ...extra });
      await SC.addGroup(s.id, a.id, "u93-g1"); await SC.addGroup(s.id, b.id, "u93-g2");
      await T.save(mk("take-u93-c1", 951, "u93-g1", "video")); await T.save(mk("take-u93-c2", 952, "u93-g2", "video"));
      await T.save(mk("take-u93-up", 953, "u93-g1", "video", { parent: { take: "take-u93-c1", method: "upscale/relayvsr" } }));
      await T.save(mk("take-u93-kept", 954, "u93-g1", "image", { verdict: "reject" })); // the person's own verdict
      for (const n of [1, 2, 3]) await T.save(mk(`take-u93-r${n}`, 960 + n, "u93-g1", "image"));
      const d = await C.create({ kind: "rerun", target: "take-u93-kept", title: "Take 954 with three seeds", by: "agent", take: "take-u93-kept" }, [1, 2, 3].map((n) => ({ take: `take-u93-r${n}` })));
      await SC.setActive(s.id, a.id, "take-u93-c1"); await SC.setActive(s.id, b.id, "take-u93-c2");
      return { id: s.id, a: a.id, b: b.id, decision: d.id };
    });
    const rows = await settle(8);
    R.keys = rows.map((r) => r.key).sort();
    R.byTake = Object.fromEntries(rows.filter((r) => r.subject.take).map((r) => [r.subject.take, r.checklist]));
    R.pair = rows.filter((r) => r.subject.kind === "pair").map((r) => r.subject.pair);
    R.folded = (await call("list_activity", { kind: "critique" })).rows?.filter((r) => r.id === `crd:${R.scene.decision}`).map((r) => [r.title, r.critiques.length, r.said]);
    // a Cast with a picture, then a new picture
    R.cast1 = await call("save_cast", { name: "U93 Liesl", refs: [{ file: "u93_cast_a.png", role: "front" }] });
    R.cast2 = await call("save_cast", { cast: R.cast1.cast, name: "U93 Liesl", refs: [{ file: "u93_cast_b.png", role: "front" }] });
    R.cast3 = await call("save_cast", { cast: R.cast1.cast, name: "U93 Liesl", details: "only words changed", refs: [{ file: "u93_cast_b.png", role: "front" }] });
    await page.waitForTimeout(1500);
    R.castRows = (await CRall()).filter((r) => r.key.startsWith("record:cast:")).map((r) => [r.key.replace(/^record:cast:[^@]+/, ""), r.checklist]);
    // approval
    R.note1 = await call("save_instruction", { scope: `scene:${R.scene.id}`, kind: "note", text: "approval: critic" });
    const crit = async (take, notes = []) => { const r = (await CRall()).find((x) => x.subject.take === take); await call("claim_critique", { critique: r.id }); return call("write_critique", { critique: r.id, verdict: notes.length ? "flaws" : "clean", passes: { scan: "nothing odd" }, notes }); };
    R.w1 = await crit("take-u93-c1");
    R.v1 = await call("get_take", { take: "take-u93-c1" });
    R.wKept = await crit("take-u93-kept");
    R.vKept = await call("get_take", { take: "take-u93-kept" });
    R.wHigh = await crit("take-u93-r1", [{ severity: "high", pass: "map", text: "two gates", owner: "board" }]);
    R.vHigh = await call("get_take", { take: "take-u93-r1" });
    R.note2 = await call("save_instruction", { scope: `shot:${R.scene.id}/${R.scene.b}`, kind: "note", text: "approval: person" });
    R.w2 = await crit("take-u93-c2");
    R.v2 = await call("get_take", { take: "take-u93-c2" });
    // a reload makes nothing new
    const before = (await CRall()).length;
    await page.reload(); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(4000); await F.loadMods(page);
    R.counts = [before, (await CRall()).length, (await (await fetch(`http://127.0.0.1:${port}/mainodes/snap/critiques`)).json()).rows.length];
    R.errors = A.errors;
  } finally { await b.close(); }
  const checks = [
    ["take-u93-c1", "take-u93-c2", "take-u93-up", "take-u93-kept", "take-u93-r1", "take-u93-r2", "take-u93-r3"].every((t) => R.keys.includes(`take:${t}`)),
    R.byTake["take-u93-c1"] === "cut" && R.byTake["take-u93-up"] === "upscale" && R.byTake["take-u93-r1"] === "board",
    R.pair.length === 1 && JSON.stringify(R.pair[0]) === JSON.stringify(["take-u93-c1", "take-u93-c2"]),
    R.folded?.length === 1 && R.folded[0][1] === 3 && /3 candidates of Take 954/.test(R.folded[0][0]),
    JSON.stringify(R.castRows) === JSON.stringify([["@1:pictures", "sheet"], ["@2:pictures", "sheet"]]),
    R.w1.verdict_set?.verdict === "keep" && R.v1.verdict === "keep",
    R.vKept.verdict === "reject" && /already set/.test(R.wKept.verdict_set?.because ?? ""),
    R.vHigh.verdict == null && /high note/.test(R.wHigh.verdict_set?.because ?? ""),
    R.v2.verdict == null && /approval is the person's/.test(R.w2.verdict_set?.because ?? ""),
    R.counts[0] === R.counts[1] && R.counts[1] === R.counts[2],
    !R.errors.length,
  ];
  R.checks = checks;
  fs.writeFileSync(path.join(out, "test_u93_triggers_result.json"), JSON.stringify(R, null, 1));
  console.log(`u93triggers ${checks.filter(Boolean).length}/${checks.length} ${checks.every(Boolean) ? "PASS" : "FAIL " + JSON.stringify(checks.map((x, i) => (x ? null : i)).filter((x) => x != null))}`);
})();
