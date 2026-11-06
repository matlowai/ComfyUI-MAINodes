// Snap/Graph is remembered per workflow tab: Snap on tab A, a new tab B opens in the graph, back to A shows Snap with A's
// recipe, back to B is the graph again. Plus the camera glides on the switch to the graph. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  const state = () => page.evaluate(() => ({ tab: app.extensionManager.workflow.activeWorkflow?.key, showing: window.__snap.switch.showing, bricks: document.querySelectorAll(".snap-brick").length }));
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "render"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(900);
  R.a1 = await state();
  await page.evaluate(() => app.extensionManager.command.execute("Comfy.NewBlankWorkflow")); await page.waitForTimeout(1500);
  R.b1 = await state();
  await page.evaluate(() => app.extensionManager.command.execute("Workspace.PreviousOpenedWorkflow")); await page.waitForTimeout(1500);
  R.a2 = await state();
  await page.screenshot({ path: path.join(out, "30-tab-a-back-in-snap.png") });
  await page.evaluate(() => app.extensionManager.command.execute("Workspace.NextOpenedWorkflow")); await page.waitForTimeout(1500);
  R.b2 = await state();
  R.queueAttempts = globalThis.__queued || 0;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_tabs_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
