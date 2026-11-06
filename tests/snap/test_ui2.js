// Snap view checks, part 2: palette, App mode export, reduced motion, touch drag, phone width, layout shift. Never queues.
// NODE_PATH=<playwright's node_modules> node test_ui2.js [url] [outdir]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), os = require("os"), path = require("path");
const url = process.argv[2] || `http://127.0.0.1:${CFG.port}/`;
const out = process.argv[3] || path.join(CFG.out, "ui");
const R = {};

async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...opts });
  const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    window.__cls = 0; window.__shifts = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) { window.__cls += e.value; window.__shifts.push([Math.round(e.value * 1000) / 1000, e.sources.map((s) => { const n = s.node; return n ? `${n.nodeName}.${n.className?.baseVal ?? n.className ?? ""}`.slice(0, 60) : "?"; })]); } }).observe({ type: "layout-shift", buffered: false });
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js");
    window.__snap = snap;
    app.canvas.emitBeforeChange(); app.graph.clear(); app.graph.extra = {}; app.canvas.emitAfterChange();
    for (const k of ["models", "preset", "rack", "first_frame", "refs", "render", "upscale", "save_video"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(900);
  return { ctx, page };
}

// ms from toggle until the switch to the graph has fully settled
// ms from toggle until it looks done (veil < 2 %, every card within 2 px of its node) and until fully at rest
const switchMs = (page) => page.evaluate(() => new Promise((done) => {
  const t0 = performance.now(), root = window.__snap.view.root;
  let looks = 0;
  window.__snap.toggle();
  const poll = () => {
    const veil = Number(getComputedStyle(root).getPropertyValue("--veil") || 0);
    if (!looks && veil < 0.02) looks = Math.round(performance.now() - t0);
    if (root.style.display === "none") return done({ looksDone: looks, rest: Math.round(performance.now() - t0) });
    requestAnimationFrame(poll);
  };
  requestAnimationFrame(poll);
}));

(async () => {
  const browser = await chromium.launch({ executablePath: CFG.chrome, headless: true });

  // palette + App mode
  {
    const { ctx, page } = await open(browser);
    R.clsOpenAndBuild = await page.evaluate(() => Math.round(window.__cls * 1000) / 1000);
    R.shifts = await page.evaluate(() => window.__shifts);
    await page.evaluate(() => { window.__snap.engine.unsnap("refs"); window.__snap.view.render(null); window.__snap.view.select("render"); });
    await page.locator(".snap-root").focus();
    const t0 = Date.now();
    await page.keyboard.press("Control+k");
    await page.waitForSelector(".snap-palette:not([hidden]) .snap-hit");
    R.paletteOpenMs = Date.now() - t0;
    await page.keyboard.type("ref");
    R.paletteHits = await page.$$eval(".snap-hit", (els) => els.map((e) => e.textContent));
    await page.screenshot({ path: path.join(out, "12-palette.png") });
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
    R.orderAfterPalette = await page.$$eval(".snap-brick", (els) => els.map((e) => e.dataset.brick));
    await page.click("text=Make app");
    await page.waitForTimeout(3000);
    R.appMode = await page.evaluate(() => [...document.querySelectorAll("*")].filter((e) => e.childElementCount === 0 && /^(Render|Models|Render Preset|First frame) · /.test(e.textContent.trim())).map((e) => e.textContent.trim()));
    await page.screenshot({ path: path.join(out, "13-make-app.png") });
    R.errorsA = page.errors;
    await ctx.close();
  }

  // dragging a brick moves it alone (no brick rides on another since U20)
  {
    const { ctx, page } = await open(browser);
    const head = await page.locator('.snap-brick[data-brick="render"] .snap-head').boundingBox();
    const top = await page.locator('.snap-brick[data-brick="models"]').boundingBox();
    await page.mouse.move(head.x + 40, head.y + 10); await page.mouse.down();
    for (let i = 1; i <= 20; i++) await page.mouse.move(head.x + 40 + ((top.x + 6 - head.x - 40) * i) / 20, head.y + 10);
    await page.waitForTimeout(100);
    R.groupMidDrag = await page.evaluate(() => { const t = (k) => document.querySelector(`.snap-brick[data-brick="${k}"]`).style.transform; return t("render") !== "" && t("upscale") === ""; });
    await page.screenshot({ path: path.join(out, "21-host-drag.png") });
    await page.waitForTimeout(150);
    await page.mouse.up(); await page.waitForTimeout(900);
    R.groupOrder = await page.evaluate(() => window.__snap.engine.state().bricks.map((b) => b.key));
    R.groupDom = await page.$$eval(".snap-brick", (els) => els.map((e) => e.dataset.brick));
    R.errorsG = page.errors;
    await ctx.close();
  }

  // switch duration, normal vs reduced motion
  {
    const { ctx, page } = await open(browser);
    R.switchMsNormal = await switchMs(page);
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser, { reducedMotion: "reduce" });
    R.switchMsReduced = await switchMs(page);
    await ctx.close();
  }

  // touch: drag References' header above Models with real touch events; the page must not scroll
  {
    const { ctx, page } = await open(browser, { hasTouch: true, isMobile: false });
    const cdp = await ctx.newCDPSession(page);
    const head = await page.locator('.snap-brick[data-brick="refs"] .snap-head').boundingBox();
    const top = await page.locator('.snap-brick[data-brick="models"]').boundingBox();
    const scroll0 = await page.evaluate(() => [scrollY, document.querySelector(".snap-stack").scrollTop, document.querySelector(".snap-stack").scrollLeft]);
    const pt = (x) => [{ x, y: head.y + 10, id: 1 }];
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pt(head.x + 40) });
    for (let i = 1; i <= 20; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pt(head.x + 40 + ((top.x + 8 - head.x - 40) * i) / 20) }); await page.waitForTimeout(16); }
    await page.waitForTimeout(150);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(900);
    R.touchOrder = await page.$$eval(".snap-brick", (els) => els.map((e) => e.dataset.brick));
    R.touchScroll = { before: scroll0, after: await page.evaluate(() => [scrollY, document.querySelector(".snap-stack").scrollTop, document.querySelector(".snap-stack").scrollLeft]) };
    R.errorsT = page.errors;
    await ctx.close();
  }

  // phone width: no horizontal scroll
  {
    const { ctx, page } = await open(browser, { viewport: { width: 390, height: 844 }, hasTouch: true });
    R.phone = await page.evaluate(() => { const r = window.__snap.view.root, s = window.__snap.view.stack; return { docOverflow: document.documentElement.scrollWidth - innerWidth, rootOverflow: r.scrollWidth - r.clientWidth, stackOverflow: s.scrollWidth - s.clientWidth }; });
    await page.screenshot({ path: path.join(out, "14-phone.png") });
    await ctx.close();
  }

  fs.writeFileSync(path.join(out, "test_ui2_result.json"), JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
