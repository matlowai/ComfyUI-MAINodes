// Batch G8, dry_run on the location and clean-up writes G7 left (SNAP-R177) on the CPU test server:
// - add_plate {dry_run}: a new plate and camera mark, one plate's pose alone (kept names the rest), a take's frame (named,
//   not pulled into input/): each answers the version it would make and its diff by plate and mark name, and the
//   location stays at its version; a bad camera mark is refused as the real call refuses it; F-P01: a pose merges by
//   field ({eye_height: 1.7} changes that alone, {lens: null} clears the lens), in the dry run and the real call;
// - draw_set_plan {dry_run}: the preview's picture and labels plus the would-be version and the plan's diff; no picture
//   saved into input/, no version;
// - delete_record {dry_run}: answers at once what it would delete and keep and which takes pinned it, with no proposal,
//   while the same call without dry_run still waits for the person.
// usage: node test_g8_dryrun.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
const base = process.argv[3] || CFG.base;
const D = CFG.fixture("short04");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
const files = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).sort() : []);
(async () => {
  for (const d of ["takes", "scenes", "location", "proposals.json"]) park(d); // moved, never deleted
  const fx = path.join(base, "input", "snaptest_dry");
  fs.mkdirSync(fx, { recursive: true });
  for (const f of ["settei_bg/MASTER_shrine_v1.png", "settei_bg/P1_torii_eyelevel.png"]) fs.copyFileSync(path.join(D, f), path.join(fx, path.basename(f)));
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); });
    const sc = await call("create_scene", { name: "Yard" }), sid = sc.scene?.id ?? sc.id ?? sc.scene;
    const shot = (await call("add_shot", { scene: sid, name: "walk" })).shot?.id;
    await call("open_shot", { scene: sid, shot }); await page.waitForTimeout(2500);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const run = await call("run", { question: "a walk through the yard" });
    for (let i = 0; i < 40; i++) { const s = await call("run_status", { run: run.run, wait_s: 5 }); if (["done", "failed"].includes(s.runs?.[0]?.state)) break; }
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); });
    const take = `take-${run.run}`;
    const made = await call("save_location", { name: "Yard", master: { file: "snaptest_dry/MASTER_shrine_v1.png" }, cameras: [{ name: "C1", x: 0.5, y: 0.9, heading: 0, eye_height: 1.6 }], plates: [{ name: "P1", file: "snaptest_dry/P1_torii_eyelevel.png", camera: "C1", pose: { x: 0.5, y: 0.9, heading: 0, eye_height: 1.6, lens: 35 } }] });
    const loc = made.location, id = loc.replace(/^location:/, ""), locDir = path.join(base, "input", "snap", "location", id), inputBefore = files(path.join(base, "input", "snap"));
    const head = () => page.evaluate(async (loc) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); return W.get(loc)?.version.n ?? null; }, loc);
    R.headBefore = await head();
    R.newPlate = await call("add_plate", { location: loc, name: "P2", file: "snaptest_dry/P1_torii_eyelevel.png", camera: { name: "C2", x: 0.2, y: 0.5, heading: 90, eye_height: 1.5 }, pose: { x: 0.2, y: 0.5, heading: 90, eye_height: 1.5 }, dry_run: true });
    R.poseOnly = await call("add_plate", { location: loc, name: "P1", pose: { eye_height: 1.7 }, dry_run: true });
    R.fromTake = await call("add_plate", { location: loc, name: "P3", take, dry_run: true });
    R.badMark = await call("add_plate", { location: loc, name: "P4", file: "snaptest_dry/P1_torii_eyelevel.png", camera: "C9", dry_run: true });
    R.plan = await call("draw_set_plan", { location: loc, shapes: [{ kind: "rect", x: 0.5, y: 0.4, w: 0.4, h: 0.2, label: "Barn" }, { kind: "line", x: 0.5, y: 0.9, x2: 0.5, y2: 0.5, label: "path" }], dry_run: true });
    R.planImages = R.plan?.images?.length ?? 0; if (R.plan?.images) R.plan.images = R.plan.images.map((x) => ({ ...x, url: undefined, data: `${(x.data ?? x.url ?? "").length} chars` }));
    R.proposalsBefore = (await call("list_proposals", {}))?.length ?? null;
    R.delDry = await call("delete_record", { ref: loc, dry_run: true });
    R.proposalsAfterDry = (await call("list_proposals", {}))?.length ?? null;
    R.headAfter = await head();
    R.inputSame = JSON.stringify(files(path.join(base, "input", "snap"))) === JSON.stringify(inputBefore) && !fs.existsSync(locDir);
    R.delReal = await call("delete_record", { ref: loc, reason: "the dry run's twin: it must still wait" });
    const real = await call("add_plate", { location: loc, name: "P1", pose: { eye_height: 1.7, lens: null } });
    R.poseReal = { version: real.version, pose: await page.evaluate(async (ref) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); return W.get(ref)?.version.body.plates.find((p) => p.name === "P1")?.pose ?? null; }, real.ref) };
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, has = (x, re) => (x?.diff ?? []).some((l) => re.test(l));
  const checks = {
    newPlateDry: S.newPlate?.dry_run === true && S.newPlate.from_version === 1 && S.newPlate.would_be === 2 && has(S.newPlate, /^plate P2 added: /) && has(S.newPlate, /^camera mark C2 added: /) && /nothing was written: the real call saves Yard v2/.test(S.newPlate.said ?? ""),
    poseAloneDry: S.poseOnly?.dry_run === true && JSON.stringify(S.poseOnly.diff) === JSON.stringify(["plate P1.pose.eye_height 1.6 → 1.7"]) && S.poseOnly.kept?.P1?.includes("file"),
    poseMergesReal: JSON.stringify(S.poseReal?.pose) === JSON.stringify({ x: 0.5, y: 0.9, heading: 0, eye_height: 1.7 }) && S.poseReal.version === 2, // F-P01: one field changes, a null clears one (lens)
    takeNotPulled: S.fromTake?.dry_run === true && has(S.fromTake, /plate P3 added: .*take \d+'s frame, saved into input\/ by the real call/) && /pulling each take's frame into input\//.test(S.fromTake.said ?? ""),
    refusedLikeReal: /no camera mark "C9"/.test(S.badMark?.error ?? ""),
    planDry: S.plan?.dry_run === true && S.plan.would_be === 2 && has(S.plan, /^plan /) && S.planImages === 1 && Array.isArray(S.plan.labels) && /nothing was written: the real call saves the picture into input\/ and Yard v2/.test(S.plan.said ?? ""),
    deleteDry: S.delDry?.dry_run === true && /Yard: the record and its 1 version/.test(S.delDry.deletes ?? "") && !S.delDry.proposed && /nothing was deleted/.test(S.delDry.said ?? "") && S.proposalsAfterDry === S.proposalsBefore,
    deleteStillWaits: !!S.delReal?.proposed,
    nothingWritten: S.headBefore === 1 && S.headAfter === 1 && S.inputSame === true,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g8_dryrun_result.json"), JSON.stringify(R, null, 1));
  console.log(`g8dryrun ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
