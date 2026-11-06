// U20 compatibility: a workflow saved with the older H3 Render (SaveVideo and the "upscale: off / RelayVSR 2x" switch
// inside it, Snap's Upscale brick with no nodes of its own) loads, shows, and queues exactly what it did; video bricks
// refuse with a reason; one press upgrades it (the new Render, Upscale with the old RelayVSR settings, on only when the
// old switch was, Save with the old prefix) and Undo takes it back. Fixture: the operator's U19 workflow (fixtures/). Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"), R = {};
const OLD = JSON.parse(fs.readFileSync(CFG.fixture("old_snap_workflow_u19.json"), "utf8"));
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { q++; return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  // the prompt as ComfyUI queues it, by node id: class and inputs
  const prompt = () => page.evaluate(async () => Object.fromEntries(Object.entries((await app.graphToPrompt()).output).map(([id, n]) => [id, { type: n.class_type, inputs: n.inputs }])));
  const tail = () => page.evaluate(() => { const E = window.__snap.engine; return { bricks: E.state().bricks.map((x) => x.key), legacy: E.legacy(), shown: [...document.querySelectorAll(".snap-stack > .snap-brick")].map((e) => e.dataset.brick), note: document.querySelector(".snap-legacy .snap-note-text")?.textContent ?? null }; });

  await page.evaluate(async (wf) => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    await app.loadGraphData(structuredClone(wf), true, true, "old u19 workflow");
  }, OLD);
  await page.waitForTimeout(1200);
  R.before = await prompt();
  await page.evaluate(() => window.__snap.toggle()); await page.waitForTimeout(1500);
  R.loaded = await tail();
  R.after = await prompt();
  R.sameQueue = JSON.stringify(R.after) === JSON.stringify(R.before);
  R.innerSave = Object.entries(R.before).filter(([, n]) => n.type === "SaveVideo").map(([id, n]) => [id.includes(":"), n.inputs.filename_prefix]);
  R.switchValue = Object.values(R.before).find((n) => n.type === "CustomCombo" && JSON.stringify(n.inputs).includes("RelayVSR"))?.inputs.choice ?? null;
  await page.screenshot({ path: path.join(out, "110-u20-old-workflow.png") });

  // video bricks and the upscale method wait for the upgrade, with the reason
  R.refuse = await page.evaluate(async () => {
    const { callTool } = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"), why = (p) => p.then(() => null, (e) => e.message);
    return { save: await why(callTool("snap", { brick: "save_video" })), method: await why(callTool("set_method", { slot: "upscale", method: "relayvsr" })), describe: (await callTool("describe_recipe")).older_render };
  });

  // the old switch on, then the one-press upgrade
  await page.evaluate(() => window.__snap.engine.setValue("render", "render", "upscale", "RelayVSR 2x")); await page.waitForTimeout(400);
  R.onBefore = await prompt();
  await page.click(".snap-legacy button:has-text('Upgrade')"); await page.waitForTimeout(2500);
  R.upgraded = await tail();
  R.toast = await page.textContent(".snap-toast");
  R.up = await prompt();
  const of = (p, type) => Object.entries(p).filter(([, n]) => n.type === type);
  const render = (p) => of(p, "MiniMaxH3ImageToVideo").map(([, n]) => n.inputs.prompt)[0];
  R.compare = {
    prompt: render(R.up) === render(R.onBefore), seed: JSON.stringify(of(R.up, "RandomNoise").map(([, n]) => n.inputs)) === JSON.stringify(of(R.onBefore, "RandomNoise").map(([, n]) => n.inputs)),
    relay: JSON.stringify(of(R.up, "RelayVSRModelSettings").map(([, n]) => n.inputs)) === JSON.stringify(of(R.onBefore, "RelayVSRModelSettings").map(([, n]) => n.inputs)),
    save: of(R.up, "SaveVideo").map(([id, n]) => [id.includes(":"), n.inputs.filename_prefix, R.up[n.inputs.video[0]]?.type]),
    switches: of(R.up, "CustomCombo").length, classes: Object.values(R.up).length - Object.values(R.onBefore).length,
  };
  await page.screenshot({ path: path.join(out, "111-u20-upgraded.png") });
  R.upscaleOn = await page.evaluate(() => window.__snap.engine.state().bricks.some((b) => b.key === "upscale") && !document.querySelector('.snap-brick[data-brick="upscale"]').classList.contains("off"));
  await page.evaluate(() => app.extensionManager.workflow.activeWorkflow.changeTracker.undo()); await page.waitForTimeout(1500);
  R.undone = await tail();
  R.undoSameQueue = JSON.stringify(await prompt()) === JSON.stringify(R.onBefore);

  // the switch off: the upgrade adds Upscale bypassed (the brick was there) and Save fed by the Render through it
  await page.evaluate(() => window.__snap.engine.setValue("render", "render", "upscale", "off")); await page.waitForTimeout(300);
  await page.evaluate(() => window.__snap.engine.upgrade()); await page.waitForTimeout(1500);
  R.offUpgrade = await page.evaluate(async () => { const E = window.__snap.engine, out = (await app.graphToPrompt()).output, save = Object.values(out).find((n) => n.class_type === "SaveVideo");
    return { bricks: E.state().bricks.map((x) => x.key), off: document.querySelector('.snap-brick[data-brick="upscale"]')?.classList.contains("off"), relayQueued: Object.values(out).some((n) => n.class_type === "RelayVSRUpscaleVideo"), saveFrom: String(save.inputs.video[0]).includes(":") }; });
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_compat_result.json"), JSON.stringify({ ...R, before: undefined, after: undefined, onBefore: undefined, up: undefined }, null, 1));
  console.log(JSON.stringify({ ...R, before: undefined, after: undefined, onBefore: undefined, up: undefined }, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
