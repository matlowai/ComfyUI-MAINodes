// Snap docked in the sidebar beside the live graph: renders in the tab, the canvas keeps drawing, narrow layout, graph
// edits show up live, a binding chip selects the real node, and the full-view toggle takes Snap out of the sidebar.
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
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "render"]) await snap.engine.snap(k);
    await app.extensionManager.command.execute("Workspace.ToggleSidebarTab.mainodes-snap");
  });
  await page.waitForTimeout(900);
  R.dock = await page.evaluate(async () => {
    const root = window.__snap.view.root;
    let draws = 0; const d = app.canvas.draw; app.canvas.draw = function (...a) { draws++; return d.apply(this, a); };
    app.canvas.setDirty(true, true); await new Promise((r) => setTimeout(r, 600)); app.canvas.draw = d;
    return { inSidebar: root.classList.contains("docked") && root.parentElement?.parentElement !== document.querySelector("#graph-canvas-container"), visible: root.getBoundingClientRect().width > 100, width: Math.round(root.getBoundingClientRect().width),
      bricks: root.querySelectorAll(".snap-brick").length, railHidden: getComputedStyle(root.querySelector(".snap-rail")).display === "none", paused: app.canvas.pause_rendering, draws };
  });
  // the person edits the Render node on the graph side; the docked Snap view follows
  await page.evaluate(() => { const n = window.__snap.engine.nodeFor("render", "render"), w = n.widgets.find((x) => x.name === "length"); app.canvas.emitBeforeChange(); w.value = 73; app.canvas.emitAfterChange(); });
  await page.waitForTimeout(500);
  R.liveFrames = await page.evaluate(() => [...document.querySelectorAll('.snap-brick[data-brick="render"] .snap-fact')].find((f) => f.textContent.startsWith("length"))?.querySelector("b").textContent);
  await page.screenshot({ path: path.join(out, "29-docked.png") });
  // review 3: a resize must not pull the docked view out of the sidebar, and no full-view insets may leak in
  R.afterResize = await page.evaluate(async () => { dispatchEvent(new Event("resize")); await new Promise((d) => setTimeout(d, 100)); const r = window.__snap.view.root; return { docked: r.classList.contains("docked"), inCanvasDirectly: r.parentElement === document.querySelector("#graph-canvas-container"), chromeTop: r.style.getPropertyValue("--chrome-top") }; });
  await page.click('.snap-brick[data-brick="render"] .snap-bind >> nth=0'); await page.waitForTimeout(300);
  R.chipSelects = await page.evaluate(() => Object.keys(app.canvas.selected_nodes ?? {}).map(String).includes(String(window.__snap.engine.nodeFor("render", "render").id)));
  await page.evaluate(() => window.__snap.toggle()); await page.waitForTimeout(1200);
  R.fullView = await page.evaluate(() => ({ inCanvas: !!window.__snap.view.root.closest("#graph-canvas-container"), showing: window.__snap.switch.showing, docked: window.__snap.switch.docked, paused: app.canvas.pause_rendering }));
  // dock again after the full view was shown: the full view's chrome insets must not carry over
  await page.evaluate(() => app.extensionManager.command.execute("Workspace.ToggleSidebarTab.mainodes-snap")); await page.waitForTimeout(800);
  R.redock = await page.evaluate(() => { const r = window.__snap.view.root; return { docked: window.__snap.switch.docked, chromeTop: r.style.getPropertyValue("--chrome-top"), paddingTop: getComputedStyle(r).paddingTop }; });
  R.queueAttempts = globalThis.__queued || 0;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_dock_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
