// U94 B6 (SNAP-R105, R106, R110) on a CPU test server: re-run dependents, staged.
// - village v1 imported; five real takes (64 px CPU prompts) pinned to v1 in a scene's shots: two become plates (add_plate,
//   v2 and v3), two are boards, one is a cut (its media a video);
// - rerun_dependents with agents off waits as a proposal whose plan has three stages (plates 2, boards 2, cuts 1) with
//   times from the takes' own seconds, and says the chain stops before cuts;
// - run: the plate stage's two re-runs are candidates (one decision each), the boards wait; applying both plate picks
//   writes each re-made plate into the location (v4, v5), then the boards stage runs on the newest version; applying the
//   boards leaves the batch held before cuts;
// - a critique of a v1 board whose note's owner is the location master reads stale once v2+ exists (list_critiques {stale});
// - chain run, through cuts, on the same record: only the cut is left; a clean critique of its re-made take under
//   "approval: critic" applies it by itself and the batch is done.
// usage: node test_u94_dependents.js <port> <base>   prints "u94deps n/m" last
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, out = path.join(CFG.out, "ui", "u93"), R = {};
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-u94-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  ["critiques", "takes", "candidates", "scenes", "location", "dependents", "instruction", "_archived/instruction", "cast"].forEach(park);
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) }); // an earlier run's finished jobs would be adopted as takes (F-C25)
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    await page.evaluate(async () => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); await CR.reload(); });
    R.import = JSON.parse(execFileSync("python3", ["-I", path.join(__dirname, "import_village_location.py"), "--port", port]).toString());
    const call = (name, args) => page.evaluate(async ([n, x]) => { const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); I.setCaller("u94"); return window.__X.callTool(n, x).catch((e) => ({ error: e.message })); }, [name, args]);
    await page.evaluate(async () => { window.__DP = await import("/extensions/ComfyUI-MAINodes/snap/dependents.js"); window.__CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); });
    R.scene = await page.evaluate(async () => { const SC = window.__SC, s = await SC.create({ name: "U94 village" }); const ids = []; for (const n of ["plates", "board one", "board two", "the cut"]) ids.push((await SC.addShot(s.id, { name: n })).shot.id); return { id: s.id, shots: ids }; });
    const waitTake = (n) => page.evaluate(async (n) => { const T = window.__T; for (let i = 0; i < 240 && T.all().length < n; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, 500)); return T.all().at(-1)?.id; }, n);
    const made = [];
    for (const [i, shot] of [[0, 0], [1, 0], [2, 1], [3, 2], [4, 3]]) {
      await call("start_recipe", {}); await page.waitForTimeout(2000);
      await call("apply_location", { location: "location:location-village@1", plates: ["Pc square + well"] });
      const n = await page.evaluate(() => window.__T.all().length);
      await page.evaluate(() => app.queuePrompt(0, 1));
      const id = await waitTake(n + 1);
      await page.evaluate(async ([scene, shot, id, i]) => { const t = window.__T.get(id); t.seconds = 10 + i; await window.__T.save(t); await window.__SC.addGroup(scene, shot, t.group); }, [R.scene.id, R.scene.shots[shot], id, i]); // a 64 px CPU run takes no time: give each its own measured seconds
      made.push(id);
    }
    R.takes = made;
    await page.evaluate(async (id) => { const t = window.__T.get(id); t.media = [{ kind: "video", filename: "identity_video_00001_.mp4", subfolder: "snaptest", type: "output" }]; await window.__T.save(t); }, made[4]);
    R.plate1 = await call("add_plate", { location: "location:location-village", name: "Pz first plate", take: made[0] });
    R.plate2 = await call("add_plate", { location: "location:location-village", name: "Py second plate", take: made[1] });
    // fix at the source: a new master (v4); the plates, boards and the cut were made on v1
    const loc = (await call("list_locations", {}))[0];
    R.fixed = await call("save_location", { location: "location:location-village", name: loc.name, notes: loc.notes, master: { file: "snap/location/village/Pd_houses.png" }, plan: { file: loc.plan.file }, cameras: loc.cameras, plates: loc.plates, note: "master fixed at the source" });
    R.deps = await call("dependents", { ref: "location:location-village" });
    R.proposal = await call("rerun_dependents", { ref: "location:location-village" });
    // a critique on board one, owner the master at v1
    const crit = await page.evaluate(async (take) => { const CR = window.__CR; for (let i = 0; i < 40; i++) { await CR.reload(); const r = CR.all().find((x) => x.subject.take === take); if (r) return r.id; await new Promise((ok) => setTimeout(ok, 250)); } return null; }, made[2]);
    await call("claim_critique", { critique: crit });
    R.critWrite = await call("write_critique", { critique: crit, verdict: "flaws", notes: [{ severity: "high", pass: "map", text: "the palisade does not close behind the houses", owner: "location master", fix: "close the ring on the master" }] });
    R.stale = await call("list_critiques", { stale: true });
    // run it
    await page.evaluate(async () => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true));
    const n0 = await page.evaluate(() => window.__T.all().length);
    R.run = await call("rerun_dependents", { ref: "location:location-village" });
    await waitTake(n0 + 2);
    const ready = (ids) => page.evaluate(async (ids) => { const C = window.__C; for (let i = 0; i < 80; i++) { await C.settle(); if (ids.every((id) => C.get(id)?.candidates[0]?.state === "ready")) return true; await new Promise((ok) => setTimeout(ok, 500)); } return false; }, ids);
    const plateDecisions = R.run.stages?.find((s) => s.name === "plates")?.decisions ?? [];
    R.platesReady = await ready(plateDecisions);
    R.mid = await call("list_dependents", {});
    for (const d of plateDecisions) await page.evaluate(async (d) => window.__C.apply(d, "c1", "person"), d);
    const boards = async () => { for (let i = 0; i < 60; i++) { const l = await call("list_dependents", {}); const s = l[0]?.stages.find((x) => x.name === "boards"); if (s?.decisions.length === 2) return { l, s }; await page.waitForTimeout(500); } return {}; };
    const got = await boards();
    R.afterPlates = got.l?.[0];
    R.location = await call("list_locations", {});
    R.boardsReady = await ready(got.s?.decisions ?? []);
    R.boardPins = await page.evaluate(async (ids) => ids.map((id) => { const d = window.__C.get(id), t = window.__T.get(d.candidates[0].take ?? `take-${d.candidates[0].prompt_id}`); return t?.world?.["location:location-village"]?.n ?? null; }), got.s?.decisions ?? []);
    for (const d of got.s?.decisions ?? []) await page.evaluate(async (d) => window.__C.apply(d, "c1", "person"), d);
    await page.waitForTimeout(1500);
    R.held = (await call("list_dependents", {}))[0];
    // chain run through cuts: only the cut is left
    await call("save_instruction", { scope: `scene:${R.scene.id}`, kind: "note", text: "approval: critic" });
    const n1 = await page.evaluate(() => window.__T.all().length);
    R.run2 = await call("rerun_dependents", { ref: "location:location-village", chain: "run", through: "cuts" });
    const cutTake = await waitTake(n1 + 1);
    R.cutReady = await ready(R.run2.stages?.find((s) => s.name === "cuts")?.decisions ?? []);
    const cutCrit = await page.evaluate(async (take) => { const CR = window.__CR; for (let i = 0; i < 60; i++) { await CR.reload(); const r = CR.all().find((x) => x.subject.take === take); if (r) return r.id; await new Promise((ok) => setTimeout(ok, 250)); } return null; }, cutTake);
    await call("claim_critique", { critique: cutCrit });
    R.cutWrite = await call("write_critique", { critique: cutCrit, verdict: "clean", passes: { scan: "nothing odd" } });
    for (let i = 0; i < 40; i++) { R.after = (await call("list_dependents", {})).find((x) => x.batch === R.run2.batch); if (R.after?.state === "done") break; await page.waitForTimeout(500); }
    R.cutApplied = await page.evaluate((d) => window.__C.get(d)?.applied, R.run2.stages?.find((s) => s.name === "cuts")?.decisions[0]);
    R.errors = A.errors;
  } finally { await b.close(); }
  const st = (b, n) => b?.stages?.find((s) => s.name === n);
  const p = R.proposal.plan;
  const checks = [
    R.deps.stale?.length === 5 && !!R.deps.rerun_dependents,
    !!R.proposal.proposed && p?.stages?.map((s) => s.takes.length).join() === "2,2,1" && p.stages.map((s) => s.eta_s).join() === "21,25,14" && /chain stops before cuts/.test(p.stages[2].runs) && /plate's new file/.test(p.stages[1].runs),
    R.stale.rows?.some((r) => /→ v4: /.test(r.stale ?? "")), // G3 F-E15: "v1 → v4: its master changed",
    st(R.run, "plates")?.state === "running" && st(R.run, "plates").decisions.length === 2 && st(R.run, "boards").state === "waiting" && R.platesReady,
    st(R.mid?.[0], "boards")?.decisions.length === 0,
    st(R.afterPlates, "plates")?.state === "picked" && st(R.afterPlates, "plates").records?.length === 2,
    R.location?.[0]?.head === 6 && ["Pz first plate", "Py second plate"].every((n) => { const x = R.location[0].plates.find((q) => q.name === n); return x && !R.takes.slice(0, 2).includes(x.from?.take); }),
    R.boardsReady && R.boardPins?.length === 2 && R.boardPins.every((n) => n === 6),
    R.held?.state === "held" && /stopped before cuts/.test(R.held.held ?? ""),
    st(R.run2, "cuts")?.decisions.length === 1 && st(R.run2, "plates")?.state === "empty" && R.cutReady,
    R.after?.state === "done" && R.cutApplied?.by === "agent",
    !R.errors.length,
  ];
  R.checks = checks;
  fs.writeFileSync(path.join(out, "test_u94_dependents_result.json"), JSON.stringify(R, null, 1));
  console.log(`u94deps ${checks.filter(Boolean).length}/${checks.length} ${checks.every(Boolean) ? "PASS" : "FAIL " + JSON.stringify(checks.map((x, i) => (x ? null : i)).filter((x) => x != null))}`);
})();
