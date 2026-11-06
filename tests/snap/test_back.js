// Back/forward: "Show in graph" (or the Graph switch) adds one history entry, so the browser's back (mouse back button,
// Alt+Left, swipe) returns to Snap with the brick still selected, forward goes to the graph again, repeated trips add no
// entries, and the page and its route stay put. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => r.request().method() === "POST" ? (q++, r.abort()) : r.continue());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const warns = []; page.on("console", (m) => { if (/router|history\.state/i.test(m.text())) warns.push(m.text()); });
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap; app.graph.clear(); app.graph.extra = {}; for (const k of ["models", "preset", "rack", "refs", "render"]) await snap.engine.snap(k); });
  await page.keyboard.press("Alt+s"); await page.waitForTimeout(900);
  const state = () => page.evaluate(() => ({ showing: window.__snap.switch.showing, selected: window.__snap.view.selected, len: history.length, url: location.href }));
  R.start = await state();
  await page.click('.snap-brick[data-brick="render"] .snap-name'); await page.waitForTimeout(500);
  await page.click('.snap-inspector button:has-text("Show in graph")'); await page.waitForTimeout(900);
  R.inGraph = await state();
  await page.goBack({ waitUntil: "commit" }).catch(() => {}); await page.waitForTimeout(900);
  R.afterBack = await state();
  await page.goForward({ waitUntil: "commit" }).catch(() => {}); await page.waitForTimeout(900);
  R.afterForward = await state();
  await page.goBack({ waitUntil: "commit" }).catch(() => {}); await page.waitForTimeout(900);
  await page.keyboard.press("Alt+s"); await page.waitForTimeout(900); // a second trip, by the toggle this time
  R.secondTrip = await state();
  await page.goBack({ waitUntil: "commit" }).catch(() => {}); await page.waitForTimeout(900);
  R.secondBack = await state();
  R.queue = q; R.errors = errs; R.routerWarnings = warns;
  fs.writeFileSync(path.join(out, "test_back_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
