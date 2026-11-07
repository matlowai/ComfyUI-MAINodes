// Batch G4, preset-options findings (SNAP-R24, R120) on the CPU test server:
// - F-F21 rerun {land: {scene, shot}} lands the new take in the shot named, and the source shot's take list stays as it was;
// - F-F22 add_shot {from: {scene, shot}} copies that shot's recipe into another scene now (a graph id of its own, no
//   takes); add_shot {start: "copy"} into another scene copies the open recipe now;
// - F-F23 run_from_take opens a scratch tab of its own (no shot, a new graph id) with the take's own seed.
// usage: node test_g4_shots.js [port] [base]   prints "g4shots n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-g4shots-${Date.now()}`)); } };
(async () => {
  ["takes", "candidates", "scenes", "proposals.json"].forEach(park); // moved, never deleted
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const wait = async (run) => { for (let i = 0; i < 40; i++) { const s = await call("run_status", { run, wait_s: 5 }); const r = s.runs?.[0]; if (r && ["done", "failed"].includes(r.state)) return r; } return null; };
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const cut = await call("create_scene", { name: "The Cut" }), opts = await call("create_scene", { name: "Options" });
    const a1 = await call("add_shot", { scene: cut.scene?.id ?? cut.id ?? cut.scene, name: "C1" });
    R.ids = { cut: cut.scene?.id ?? cut.id ?? cut.scene, opts: opts.scene?.id ?? opts.id ?? opts.scene, a1: a1.shot?.id };
    await call("open_shot", { scene: R.ids.cut, shot: R.ids.a1 }); await page.waitForTimeout(2500); // an empty shot opens on the recommended recipe
    await call("set_setting", { brick: "render", name: "prompt", value: "integrated_multimodal_description: [Shot 1] a lantern by a gate" });
    const run = await call("run", { question: "the Cut's C1" });
    R.first = await wait(run.run);
    await page.waitForTimeout(1500);
    R.t1 = `take-${run.run}`;
    R.seed = await page.evaluate((id) => window.__T.get(id)?.seed ?? null, R.t1);
    R.cutBefore = await page.evaluate(([s, sh]) => window.__SC.takesOf(window.__SC.get(s).shots.find((x) => x.id === sh)).length, [R.ids.cut, R.ids.a1]);
    // F-F22: copy C1's recipe into Options, now, while C1 is open: start copy and from
    R.copy = await call("add_shot", { scene: R.ids.opts, name: "copy now", start: "copy" });
    R.fromCopy = await call("add_shot", { scene: R.ids.opts, name: "from C1", from: { scene: R.ids.cut, shot: R.ids.a1 } });
    R.copied = await page.evaluate(async ([o, c1, c2, cut, a1]) => { const SC = window.__SC, s = SC.get(o), x = (id) => s.shots.find((y) => y.id === id), src = SC.get(cut).shots.find((y) => y.id === a1);
      return { a: { workflow: !!x(c1).workflow, groups: x(c1).groups, takes: SC.takesOf(x(c1)).length, copied_from: x(c1).copied_from }, b: { workflow: !!x(c2).workflow, groups: x(c2).groups, takes: SC.takesOf(x(c2)).length }, src: src.groups }; },
      [R.ids.opts, R.copy.shot?.id, R.fromCopy.shot?.id, R.ids.cut, R.ids.a1]).catch((e) => ({ error: e.message }));
    // F-F21: re-run C1's take into the Options' "from C1" shot
    R.rerun = await call("rerun", { take: R.t1, land: { scene: R.ids.opts, shot: R.fromCopy.shot?.id }, seed: "new" });
    R.second = await wait(R.rerun.run);
    await page.waitForTimeout(2000);
    R.after = await page.evaluate(([cut, a1, o, b1, run]) => { const SC = window.__SC; return { cut: SC.takesOf(SC.get(cut).shots.find((x) => x.id === a1)).map((e) => e.take), opts: SC.takesOf(SC.get(o).shots.find((x) => x.id === b1)).map((e) => e.take), landed: `take-${run}` }; },
      [R.ids.cut, R.ids.a1, R.ids.opts, R.fromCopy.shot?.id, R.rerun.run]);
    // F-F23: run from the first take: a scratch tab of its own with the take's seed
    R.groupsBefore = await page.evaluate(() => window.__SC.all().flatMap((s) => s.shots.flatMap((x) => x.groups)));
    if (R.seed == null) await page.evaluate(async (id) => { const t = window.__T.get(id); t.seed = 7401; await window.__T.save(t); }, R.t1); // a 64 px stand-in run records no sampler seed
    R.seed = await page.evaluate((id) => window.__T.get(id).seed, R.t1);
    R.runFrom = await call("run_from_take", { take: R.t1 });
    await page.waitForTimeout(1500);
    R.tab = await page.evaluate(() => ({ id: app.graph.id, scene: app.graph.extra?.snap_scene ?? null }));
    R.seedNow = await call("describe_recipe", {});
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
  }
  const S = R;
  const checks = {
    firstRan: S.first?.state === "done" && S.cutBefore === 1,
    copyNow: S.copied?.a?.workflow && S.copied.a.takes === 0 && S.copied.a.groups?.length === 1 && !S.copied.src?.includes(S.copied.a.groups[0]) && /C1/.test(S.copied.a.copied_from ?? ""),
    fromCopy: S.copied?.b?.workflow && S.copied.b.takes === 0 && S.copied.b.groups?.length === 1 && !S.copied.src?.includes(S.copied.b.groups[0]),
    rerunLandsThere: S.second?.state === "done" && S.after?.opts?.includes(S.after.landed) && !S.after?.cut?.includes(S.after.landed) && S.after?.cut?.length === 1,
    runFromScratch: !S.tab?.scene && !S.groupsBefore?.includes(S.tab?.id),
    runFromSeed: S.seed != null && JSON.stringify(S.seedNow ?? {}).includes(String(S.seed)),
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g4_shots_result.json"), JSON.stringify(R, null, 1));
  console.log(`g4shots ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
