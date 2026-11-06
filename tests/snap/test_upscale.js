// The Upscale face shows the outcome (MODEL_SWITCHING follow-up, the operator 2026-11-04): headline = the size the clip ends up,
// one inline Off / 2× / 4× control (Off keeps the brick and its settings, dimmed), the quality preset's short name, the
// readiness line only when something is wrong; Render says nothing about upscaling; the inline control never selects or
// opens the brick. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { q++; return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "render", "upscale", "save_video"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(1500);
  const U = '.snap-brick[data-brick="upscale"]';
  const state = () => page.evaluate((U) => { const E = window.__snap.engine, el = document.querySelector(U);
    return { headline: el.querySelector(".snap-headline")?.textContent, on: el.querySelector(".snap-inline button.on")?.textContent, off: el.classList.contains("off"),
      switch: E.nodeFor("upscale", "upscale").mode === 4 ? "off" : "on", scale: E.getValue("upscale", "settings", "output_scale"), quality: [...el.querySelectorAll(".snap-fact b")].map((x) => x.textContent),
      check: el.querySelector(".snap-check")?.textContent ?? null, faces: [...document.querySelectorAll(".snap-face")].map((x) => x.textContent).join(" | "),
      inspecting: document.querySelector(".snap-root").classList.contains("inspecting"), selected: window.__snap.view.selected, opened: window.__snap.view.opened }; }, U);
  R.start = await state();
  await page.screenshot({ path: path.join(out, "80-upscale-2x.png"), clip: { x: 0, y: 0, width: 1600, height: 520 } });
  await page.click(`${U} .snap-inline button:has-text("4×")`); await page.waitForTimeout(500);
  R.four = await state();
  await page.screenshot({ path: path.join(out, "81-upscale-4x.png"), clip: { x: 0, y: 0, width: 1600, height: 520 } });
  await page.evaluate(() => window.__snap.engine.setValue("render", "render", "width", 960)); await page.waitForTimeout(400);
  R.liveWidth = (await state()).headline;
  await page.evaluate(() => window.__snap.engine.setValue("render", "render", "width", 1280));
  await page.click(`${U} .snap-inline button:has-text("Off")`); await page.waitForTimeout(500);
  R.off = await state();
  await page.screenshot({ path: path.join(out, "82-upscale-off.png"), clip: { x: 0, y: 0, width: 1600, height: 520 } });
  await page.click(`${U} .snap-inline button:has-text("2×")`); await page.waitForTimeout(500);
  R.two = await state();
  await page.evaluate(() => app.extensionManager.workflow.activeWorkflow.changeTracker.undo()); await page.waitForTimeout(900);
  R.undo = await state();
  // the panels: Render has no upscale field; Upscale explains the model
  await page.click('.snap-brick[data-brick="render"] .snap-head'); await page.waitForTimeout(600);
  R.renderPanel = await page.$$eval(".snap-inspector .snap-field > span", (els) => els.map((e) => e.textContent));
  await page.click(`${U} .snap-head`); await page.waitForTimeout(800);
  R.upscalePanel = await page.$$eval(".snap-inspector .snap-insp-type, .snap-inspector .snap-quiet", (els) => els.map((e) => e.textContent));
  await page.screenshot({ path: path.join(out, "83-upscale-panel.png") });
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_upscale_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e.message.split("\n")[0]); process.exit(1); });
