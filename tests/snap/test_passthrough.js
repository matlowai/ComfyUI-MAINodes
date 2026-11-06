// Pass-through: the inspector shows whatever a brick's node offers, read generically: custom DOM panels (the node's own
// element, lent and given back), button widgets, widgets fed by a wire, every other widget. Never queues.
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"); const out = path.join(CFG.out, "ui");
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => r.request().method() === "POST" ? (q++, r.abort()) : r.continue());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap; app.graph.clear(); app.graph.extra = {}; for (const k of ["models", "preset", "rack", "first_frame", "refs", "render", "upscale"]) await snap.engine.snap(k); });
  await page.waitForTimeout(1500); // let the frontend mount the DOM widgets on the canvas first
  await page.evaluate(() => window.__snap.toggle()); await page.waitForTimeout(1200);
  const R = {};
  for (const k of ["rack", "models", "first_frame", "render"]) {
    await page.click(`.snap-brick[data-brick="${k}"] .snap-name`); await page.waitForTimeout(700);
    await page.screenshot({ path: `${out}/42-insp-${k}.png` });
    R[k] = await page.evaluate(() => ({ dom: document.querySelectorAll(".snap-inspector .snap-dom > *").length, buttons: [...document.querySelectorAll(".snap-inspector .snap-widget-btn")].map((b) => b.textContent), wired: [...document.querySelectorAll(".snap-inspector .snap-wired")].map((x) => x.parentElement.firstChild.textContent + ": " + x.textContent), fields: document.querySelectorAll(".snap-inspector .snap-field").length }));
  }
  // the lent panel works in the inspector: the rack's "+ Add dial" adds a row
  await page.click(`.snap-brick[data-brick="rack"] .snap-name`); await page.waitForTimeout(600);
  R.addDial = await page.evaluate(() => { const b = [...document.querySelectorAll(".snap-inspector .snap-dom button")].find((x) => /add dial/i.test(x.textContent)); b?.click(); return !!b; });
  await page.waitForTimeout(600);
  R.rackAfter = await page.evaluate(() => window.__snap.engine.getValue("rack", "rack", "rack"));
  await page.screenshot({ path: `${out}/43-rack-panel.png` });
  // back to the graph: every lent panel is home in its node's slot
  await page.evaluate(() => window.__snap.toggle()); await page.waitForTimeout(1200);
  R.home = await page.evaluate(() => ["rack", "preset"].map((k) => { const n = window.__snap.engine.nodeFor(k, k); const w = n.widgets.find((x) => x.element); return { k, inSnap: !!w.element.closest(".snap-root"), connected: w.element.isConnected }; }));

  R.queue = q; R.errs = errs;
  fs.writeFileSync(path.join(out, "test_passthrough_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})();
