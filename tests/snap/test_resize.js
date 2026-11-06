// Inspector width: a third of the window by default (380-860 px), drag its left edge to resize, kept across reloads in
// this browser, double-click resets. Checked at 1600 and 2560 px wide. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => r.request().method() === "POST" ? (q++, r.abort()) : r.continue());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const open = async () => {
    await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
    await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap; app.graph.clear(); app.graph.extra = {}; for (const k of ["models", "preset", "rack", "refs", "render"]) await snap.engine.snap(k); snap.toggle(); });
    await page.waitForTimeout(900);
    await page.click('.snap-brick[data-brick="render"] .snap-name'); await page.waitForTimeout(700);
  };
  const width = () => page.evaluate(() => Math.round(document.querySelector(".snap-inspector").getBoundingClientRect().width));
  await page.evaluate(() => { try { localStorage.removeItem("mainodes.snap.inspectorWidth"); } catch {} }).catch(() => {});
  await open();
  await page.evaluate(() => localStorage.removeItem("mainodes.snap.inspectorWidth")); await open();
  R.default1600 = await width();
  await page.screenshot({ path: path.join(out, "44-inspector-default.png") });
  const hb = await page.locator(".snap-insp-handle").boundingBox();
  await page.mouse.move(hb.x + 5, 500); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(hb.x + 5 - (200 * i) / 10, 500);
  await page.mouse.up(); await page.waitForTimeout(400);
  R.dragged = await width();
  await page.screenshot({ path: path.join(out, "45-inspector-dragged.png") });
  await open();
  R.afterReload = await width();
  await page.dblclick(".snap-insp-handle"); await page.waitForTimeout(500);
  R.afterReset = await width();
  await page.setViewportSize({ width: 2560, height: 1440 }); await page.waitForTimeout(600);
  R.default2560 = await width();
  R.selectedVisible = await page.evaluate(() => { const r = document.querySelector('.snap-brick[data-brick="render"]').getBoundingClientRect(), i = document.querySelector(".snap-inspector").getBoundingClientRect(); return r.right <= i.left + 1 && r.left >= 0; });
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_resize_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
