// Recipe cards: save a tuned stack, clear the graph, click the card: the bricks come back in order with their settings,
// as one undo step. Never queues.
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
  const snapshot = () => page.evaluate(() => { const E = window.__snap.engine; return { keys: E.state().bricks.map((x) => x.key), length: E.getValue("render", "render", "length"), seed: E.getValue("render", "render", "noise_seed"), derope: E.getValue("render", "render", "choice"), prompt: E.getValue("render", "render", "prompt"), upscale: E.getValue("render", "render", "upscale") }; });
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap; const E = snap.engine;
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "first_frame", "refs", "render", "upscale", "save_video", "node:VAEDecode"]) await E.snap(k);
    E.setValues("render", "render", { length: 97, noise_seed: 7, choice: "oracle" });
    snap.toggle();
  });
  await page.waitForTimeout(900);
  R.before = await snapshot();
  await page.click(".snap-recipe-chip"); await page.fill(".snap-recipe-menu [aria-label=\"recipe name\"]", "Gate recipe"); await page.click(".snap-recipe-menu >> text=Save version"); await page.waitForTimeout(800); // SNAP-R274: the chip opens the recipe menu; the first save names it
  R.saveToast = await page.textContent(".snap-toast");
  await page.evaluate(() => { app.canvas.emitBeforeChange(); app.graph.clear(); app.graph.extra = {}; app.canvas.emitAfterChange(); window.__snap.view.render(null); });
  await page.waitForTimeout(300);
  await page.click('.snap-card:has-text("Gate recipe")'); await page.waitForTimeout(2000);
  R.after = await snapshot();
  R.applyToast = await page.textContent(".snap-toast");
  await page.screenshot({ path: path.join(out, "35-recipe-restored.png") });
  await page.evaluate(() => app.extensionManager.workflow.activeWorkflow.changeTracker.undo()); await page.waitForTimeout(700);
  R.afterUndo = await page.evaluate(() => ({ length: window.__snap.engine.getValue("render", "render", "length"), bricks: window.__snap.engine.state().bricks.length }));
  // the card applied twice onto a graph that already has the stack rebuilds nothing: no second VAE Decode
  await page.click('.snap-card:has-text("Gate recipe")'); await page.waitForTimeout(2000);
  await page.click('.snap-card:has-text("Gate recipe")'); await page.waitForTimeout(2000);
  R.twice = (await snapshot()).keys;
  R.queueAttempts = globalThis.__queued || 0;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_recipe_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify({ ...R, before: { ...R.before, prompt: R.before.prompt.length }, after: { ...R.after, prompt: R.after.prompt?.length } }, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
