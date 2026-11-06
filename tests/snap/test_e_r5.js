// Batch E task 1 (SNAP-R5): a re-take or re-run never replaces unsaved work in the shot's tab. On the CPU test server,
// queued prompts rewritten as test_retake.js does. Take A runs in a scene shot with Kon v1; Mara is saved.
// - the shot's tab gets an unsaved edit (a line added to the prompt); re-take A as it was: the edit is still in that tab,
//   the rebuild opened in a new tab of the same shot, and the new take nests under A as "Retake · as it was";
// - back in the edited tab (still unsaved), re-run A with Kon → Mara: the edit is still there, another new tab, the take
//   nests under A as "Re-run · Kon → Mara";
// - in a tab that holds the shot's saved workflow, a re-run opens in place (no new tab) and Undo brings the shot's
//   workflow back; a batch of 2 re-runs from that clean tab opens no extra tab either (both in the graph view, where
//   drawing resizes nodes). Screen 380 (the tab bar).
// usage: node test_e_r5.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const KON = "snaptest_cast_kon_identity.safetensors", MARA = "snaptest_cast_mara_identity.safetensors", EDIT = "my unsaved line about the lantern";
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await useShelf(page, { extra: { loras: [[KON, 0.1], [MARA, 0.1]] } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const queued = [];
  await page.route(/\/(api\/)?prompt$/, (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const body = JSON.parse(r.request().postData());
    queued.push({ workflow: body.extra_data?.extra_pnginfo?.workflow ?? null });
    body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 + queued.length } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/batchE_r5" } } };
    delete body.partial_execution_targets;
    return r.continue({ postData: JSON.stringify(body) });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["E", "engine"], ["M", "models"], ["W", "world"], ["T", "takes"], ["SC", "scenes"], ["RT", "retake"], ["RR", "rerun"]]) window[`__${k}`] = await at(m); });
  const waitTakes = (n) => ev(async (n) => { const T = window.__T; for (let i = 0; i < 200 && T.all().length < n; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, 400)); return T.all().length; }, n);
  // what every open tab holds: its path, whether it is the active one, its shot mark, and whether it has the edit
  const tabs = () => ev((edit) => { const s = app.extensionManager.workflow; return s.openWorkflows.map((w) => { const st = w === s.activeWorkflow ? app.graph.serialize() : w.changeTracker?.activeState;
    return { path: w.path, active: w === s.activeWorkflow, shot: st?.extra?.snap_scene?.shot ?? null, edit: JSON.stringify(st ?? {}).includes(edit) }; }); }, EDIT);
  // a person's edit: a line added to the prompt, then the mouseup the frontend's change tracker listens for
  const edit = () => ev(async (edit) => { const E = window.__E; E.setValue("render", "render", "prompt", `${E.getValue("render", "render", "prompt")}\n${edit}`); window.dispatchEvent(new MouseEvent("mouseup")); await new Promise((r) => setTimeout(r, 200)); }, EDIT);
  R.a = await ev(async ([kon, mara]) => {
    const L = window.__L, T = window.__T, SC = window.__SC;
    await T.load(); await SC.load(); await window.__M.load();
    const scene = await SC.create({ name: "R5 test" });
    await SC.addShot(scene.id, { name: "Kon walks" });
    const shot = SC.get(scene.id).shots[0].id;
    await SC.openShot(scene.id, shot);
    const k = `cast-konr5${Date.now().toString(36)}`, m = `cast-marar5${Date.now().toString(36)}`;
    await L.saveCast(k, { name: "Kon", trigger: "kon_fennec", details: "a fennec-eared courier girl", lora: { file: kon, strength: 0.8 }, refs: [] });
    await L.applyCast(`cast:${k}`);
    await L.saveCast(m, { name: "Mara", trigger: "", details: "a young woman with long dark wavy hair and a mustard coat", lora: { file: mara, strength: 0.7 }, refs: [] });
    await SC.saveOpen();
    return { scene: scene.id, shot, kon: k, mara: m, takes: T.all().length, tab: app.extensionManager.workflow.activeWorkflow.path };
  }, [KON, MARA]);
  const kon = `cast:${R.a.kon}`, mara = `cast:${R.a.mara}`;
  await ev(() => app.queuePrompt(0, 1));
  await waitTakes(R.a.takes + 1);
  R.a.take = await ev(() => window.__T.all().at(-1).id);
  // ---- an unsaved edit, then a re-take ----
  await edit();
  R.beforeRetake = await tabs();
  let n = await ev(() => window.__T.all().length);
  R.retake = await ev(async (take) => { const r = await window.__RT.retake(window.__T.get(take), { world: "pinned" }); return { said: r.said, opened: r.opened }; }, R.a.take);
  await waitTakes(n + 1);
  R.retake.take = await ev(() => window.__T.all().at(-1).id);
  R.afterRetake = await tabs();
  await page.waitForTimeout(500);
  // the graph view shows ComfyUI's tab bar: the edited shot tab and the rebuild's own tab of the same shot. The rest runs
  // in the graph view, where drawing resizes nodes (the clean-tab check must not count that as unsaved)
  await page.click('button[role="tab"]:has-text("Graph")').catch((e) => { R.shotErr = e.message; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "380-e-r5-tabs.png"), clip: { x: 0, y: 0, width: 1600, height: 90 } }).catch((e) => { R.shotErr = e.message; });
  // ---- back in the edited tab, a re-run with a swap ----
  await ev(async (p) => { const s = app.extensionManager.workflow; for (let i = 0; i < 6 && s.activeWorkflow.path !== p; i++) await app.extensionManager.command.execute("Workspace.PreviousOpenedWorkflow"); }, R.a.tab);
  R.backIn = await tabs();
  n = await ev(() => window.__T.all().length);
  R.rerun = await ev(async ([take, kon, mara]) => { const r = await window.__RR.rerun(window.__T.get(take), { swaps: { [kon]: { to: mara } } }); return { said: r.said, opened: r.opened }; }, [R.a.take, kon, mara]);
  await waitTakes(n + 1);
  R.rerun.take = await ev(() => window.__T.all().at(-1).id);
  R.afterRerun = await tabs();
  // ---- a clean shot tab: in place, and Undo brings the shot's workflow back ----
  R.clean = await ev(async ([take, kon, mara]) => {
    const s = app.extensionManager.workflow, before = s.openWorkflows.length, prompt = () => window.__E.getValue("render", "render", "prompt") ?? "";
    const had = prompt(), r = await window.__RR.rerun(window.__T.get(take), { swaps: {}, queue: false });
    const now = prompt(), tracker = s.activeWorkflow.changeTracker;
    let undos = 0;
    while (undos < 3 && prompt() !== had) { await tracker.undo(); undos++; }
    return { tabsBefore: before, tabsAfter: s.openWorkflows.length, had: had.split("\n")[0], now: now.split("\n")[0], undone: prompt() === had, undos, opened: r.opened };
  }, [R.a.take, kon, mara]);
  // ---- a batch from the clean tab: no extra tabs ----
  n = await ev(() => window.__T.all().length);
  R.batch = await ev(async ([take, kon, mara]) => { const s = app.extensionManager.workflow, before = s.openWorkflows.length; await window.__SC.saveOpen(); const r = await window.__RR.rerun(window.__T.get(take), { swaps: { [kon]: { to: [mara, "pinned"] } } }); return { tabsBefore: before, tabsAfter: s.openWorkflows.length, runs: r.runs?.length ?? 0 }; }, [R.a.take, kon, mara]);
  await waitTakes(n + 2);
  R.scene = await ev(async (scene) => window.__X.callTool("get_scene", { scene }), R.a.scene);
  R.errors = errs;

  const tree = R.scene.shots?.[0]?.takes ?? [], root = tree.find((x) => x.take === R.a.take), labels = (root?.versions ?? []).map((v) => [v.take, v.label]);
  const orig = (list) => list.find((t) => t.path === R.a.tab);
  const c = {
    "before the re-take, the shot's tab holds the unsaved edit": orig(R.beforeRetake)?.edit === true,
    "re-take: the edited tab still holds the edit": orig(R.afterRetake)?.edit === true,
    "re-take: the rebuild opened in a new tab of the same shot": R.afterRetake.length === R.beforeRetake.length + 1 && R.afterRetake.find((t) => t.active)?.path !== R.a.tab && R.afterRetake.find((t) => t.active)?.shot === R.a.shot && /new tab/.test(R.retake.said),
    "re-take: the new take nests under A as 'Retake · as it was'": labels.some(([t, l]) => t === R.retake.take && l === "Retake · as it was"),
    "back in the edited tab, the edit is still there": orig(R.backIn)?.active === true && orig(R.backIn)?.edit === true,
    "re-run: the edited tab still holds the edit, the rebuild is in another new tab": orig(R.afterRerun)?.edit === true && R.afterRerun.length === R.backIn.length + 1 && R.afterRerun.find((t) => t.active)?.path !== R.a.tab,
    "re-run: the new take nests under A as 'Re-run · Kon → Mara'": labels.some(([t, l]) => t === R.rerun.take && l === "Re-run · Kon → Mara"),
    "a clean shot tab: the re-run opens in place": R.clean.tabsAfter === R.clean.tabsBefore && /mustard coat/.test(R.clean.had) && /fennec/.test(R.clean.now) && !/new tab/.test(R.clean.opened),
    "a clean shot tab: Undo brings the shot's workflow back in one step": R.clean.undone && R.clean.undos === 1,
    "a batch of 2 from the clean tab opens no extra tab": R.batch.tabsAfter === R.batch.tabsBefore && R.batch.runs === 2,
    "no page errors": !R.errors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_e_r5_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`e_r5     ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
