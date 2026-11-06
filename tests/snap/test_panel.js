// The side panel stays open until its collapse button (the brick's icon with ›) or Esc: dragging the chain's horizontal
// scrollbar and pressing the empty chain leave it open; another brick switches it. In brick mode an empty-chain press still
// closes the open brick, the scrollbar doesn't. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true, ignoreDefaultArgs: ["--hide-scrollbars"] }); // real scrollbars, as in a desktop Chrome
  const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => r.request().method() === "POST" ? (q++, r.abort()) : r.continue());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    app.extensionManager.setting.set("MAINodes.Snap.OpenIn", "Side panel");
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "first_frame", "refs", "render", "upscale", "save_video"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(1200);
  const state = () => page.evaluate(() => ({ inspecting: window.__snap.view.root.classList.contains("inspecting"), selected: window.__snap.view.selected, opened: window.__snap.view.opened, scrollLeft: Math.round(document.querySelector(".snap-stack").scrollLeft) }));
  // a point in the stack where the stack itself (not a brick or the lanes) is under the pointer, and its scrollbar
  const spots = () => page.evaluate(() => {
    const s = document.querySelector(".snap-stack"), r = s.getBoundingClientRect();
    let empty = null;
    for (let y = r.top + 4; y < r.top + s.clientHeight && !empty; y += 12) for (let x = r.left + 4; x < r.left + s.clientWidth; x += 12) if (document.elementFromPoint(x, y) === s) { empty = [x, y]; break; }
    return { barH: s.offsetHeight - s.clientHeight, atBar: document.elementFromPoint(r.left + s.clientWidth / 2, r.top + s.clientHeight + 2)?.className, overflows: s.scrollWidth > s.clientWidth, bar: [r.left + s.clientWidth / 2, r.top + s.clientHeight + Math.max(2, (s.offsetHeight - s.clientHeight) / 2)], empty };
  });
  await page.click('.snap-brick[data-brick="models"] .snap-name'); await page.waitForTimeout(700);
  R.opened = await state();
  const sp = await spots();
  R.overflows = sp.overflows; R.barH = sp.barH; R.atBar = sp.atBar;
  await page.mouse.move(...sp.bar); await page.mouse.down(); await page.mouse.move(sp.bar[0] + 120, sp.bar[1], { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(500);
  R.afterScrollbar = await state();
  await page.screenshot({ path: path.join(out, "76-panel-after-scrollbar.png") });
  const sp2 = await spots();
  R.emptyFound = !!sp2.empty;
  if (sp2.empty) { await page.mouse.click(...sp2.empty); await page.waitForTimeout(400); }
  R.afterEmpty = await state();
  await page.click('.snap-brick[data-brick="rack"] .snap-name'); await page.waitForTimeout(600);
  R.switched = await state();
  R.collapseIcon = await page.textContent(".snap-inspector .snap-collapse");
  await page.click(".snap-inspector .snap-collapse"); await page.waitForTimeout(600);
  R.afterCollapse = await state();
  await page.click('.snap-brick[data-brick="render"] .snap-name'); await page.waitForTimeout(600);
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
  R.afterEsc = await state();
  // brick mode: the empty chain closes an opened brick, its scrollbar doesn't
  await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.OpenIn", "The brick itself")); await page.waitForTimeout(400);
  await page.click('.snap-brick[data-brick="rack"] .snap-name'); await page.waitForTimeout(700);
  R.brickOpened = (await state()).opened;
  const sp3 = await spots();
  if (sp3.overflows) { await page.mouse.click(...sp3.bar); await page.waitForTimeout(400); }
  R.brickAfterScrollbar = (await state()).opened;
  const sp4 = await spots();
  if (sp4.empty) { await page.mouse.click(...sp4.empty); await page.waitForTimeout(500); }
  R.brickAfterEmpty = (await state()).opened;
  await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.OpenIn", "Side panel")); await page.waitForTimeout(300);
  R.queue = q;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_panel_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
