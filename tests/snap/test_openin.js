// Open in the brick: a ComfyUI setting (kept with the user's settings) switches where a clicked brick shows its settings.
// Side panel stays the default; in brick mode a click opens the brick in place with the same generic details (the rack's
// own panel included), a header click / Esc closes it, a drag doesn't open it, the in-view buttons switch modes and the
// choice survives a reload. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => r.request().method() === "POST" ? (q++, r.abort()) : r.continue());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const open = async () => {
    await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
    await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap; app.graph.clear(); app.graph.extra = {}; for (const k of ["models", "preset", "rack", "refs", "render"]) await snap.engine.snap(k); });
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__snap.toggle()); await page.waitForTimeout(900);
  };
  const state = () => page.evaluate(() => ({ setting: app.extensionManager.setting.get("MAINodes.Snap.OpenIn"), inspecting: window.__snap.view.root.classList.contains("inspecting"), opened: window.__snap.view.opened,
    openWidth: Math.round(document.querySelector(".snap-brick.open")?.getBoundingClientRect().width ?? 0), junk: document.querySelector(".snap-stack").textContent.includes("[object"), wiredLists: document.querySelectorAll(".snap-brick.open .snap-details .snap-binds").length, chipsOutside: document.querySelectorAll(".snap-brick.open > .snap-binds .snap-bind").length, rackPanelInBrick: !!document.querySelector('.snap-brick[data-brick="rack"] .snap-dom > *'), panelInInspector: !!document.querySelector(".snap-inspector .snap-dom > *") }));
  await open();
  await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.OpenIn", "Side panel")); await page.waitForTimeout(300);
  R.defaultSetting = await page.evaluate(() => app.extensionManager.setting.get("MAINodes.Snap.OpenIn"));
  await page.click('.snap-brick[data-brick="rack"] .snap-name'); await page.waitForTimeout(600);
  R.panelMode = await state();
  // switch from the side panel's own button
  await page.click(".snap-inspector .snap-mode"); await page.waitForTimeout(800);
  R.switched = await state();
  await page.screenshot({ path: path.join(out, "46-open-in-brick.png") });
  // the rack's own panel works inside the open brick
  R.addDial = await page.evaluate(() => { const b = [...document.querySelectorAll('.snap-brick[data-brick="rack"] .snap-dom button')].find((x) => /add dial/i.test(x.textContent)); b?.click(); return !!b; });
  await page.waitForTimeout(500);
  R.rackAfter = await page.evaluate(() => window.__snap.engine.getValue("rack", "rack", "rack"));
  R.stillOpen = (await state()).opened;
  // header click closes; a click on another brick opens that one
  await page.click('.snap-brick[data-brick="rack"] .snap-name'); await page.waitForTimeout(500);
  R.closedByHeader = (await state()).opened;
  await page.click('.snap-brick[data-brick="render"] .snap-face'); await page.waitForTimeout(700);
  R.renderOpen = await state();
  await page.screenshot({ path: path.join(out, "47-render-open.png") });
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  R.afterEsc = (await state()).opened;
  // a drag doesn't open the brick
  const head = await page.locator('.snap-brick[data-brick="refs"] .snap-head').boundingBox();
  await page.mouse.move(head.x + 40, head.y + 10); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(head.x + 40 + 12 * i, head.y + 10);
  await page.mouse.up(); await page.waitForTimeout(900);
  R.afterDrag = (await state()).opened;
  // remembered across a reload
  await open();
  await page.click('.snap-brick[data-brick="models"] .snap-face'); await page.waitForTimeout(700);
  R.afterReload = await state();
  // and back to the side panel from the open brick's own button
  await page.click('.snap-brick[data-brick="models"] .snap-mode'); await page.waitForTimeout(800);
  R.backToPanel = await state();
  await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.OpenIn", "Side panel"));
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_openin_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e.message.split("\n")[0]); process.exit(1); });
