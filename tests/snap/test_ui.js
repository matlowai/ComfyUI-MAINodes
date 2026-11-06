// Snap view UI check on a CPU ComfyUI whose MAINodes is the snap-scout worktree (UX_SPEC section 12). Never queues.
// NODE_PATH=<playwright's node_modules> node test_ui.js [url] [outdir]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), os = require("os"), path = require("path");
const url = process.argv[2] || `http://127.0.0.1:${CFG.port}/`;
const out = process.argv[3] || path.join(CFG.out, "ui");
fs.mkdirSync(out, { recursive: true });
const R = {};
const shot = (page, name) => page.screenshot({ path: path.join(out, `${name}.png`) });

(async () => {
  const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), "pw-snapui-")), {
    executablePath: CFG.chrome, headless: true, viewport: { width: 1600, height: 1000 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(m.text())) errors.push(m.text().slice(0, 300)); });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metric = async (name) => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === name).value;

  // fresh graph, Snap view open, empty state
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js");
    window.__snap = snap;
    app.canvas.emitBeforeChange(); app.graph.clear(); app.graph.extra = {}; app.canvas.emitAfterChange();
    snap.toggle();
  });
  await page.waitForTimeout(900);
  await shot(page, "01-empty");
  R.actionBarButton = await page.locator("button:has-text('Snap')").count();

  await page.click("text=Start from Dials + Pika Simple");
  await page.waitForFunction(() => document.querySelectorAll(".snap-brick").length === 7, null, { timeout: 30000 });
  await page.waitForTimeout(700);
  await shot(page, "02-simple-recipe");
  R.bricks = await page.$$eval(".snap-brick", (els) => els.map((e) => e.dataset.brick));
  R.status = await page.textContent(".snap-status");

  // frame + layout budget while dragging a brick by its header, CPU 4x slower
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const head = await page.locator('.snap-brick[data-brick="refs"] .snap-head').boundingBox();
  const target = await page.locator('.snap-brick[data-brick="rack"]').boundingBox();
  await page.evaluate(() => { window.__frames = []; const f = (t) => { window.__frames.push(t); if (window.__frames.length < 2000) window.__raf = requestAnimationFrame(f); }; window.__raf = requestAnimationFrame(f); });
  await page.mouse.move(head.x + 60, head.y + 10);
  await page.evaluate(() => { window.__mDown = performance.now(); });
  await page.mouse.down();
  const layouts0 = await metric("LayoutCount");
  const steps = 40;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(head.x + 60, head.y + 10 + ((target.y + 10 - head.y - 10) * i) / steps);
  }
  const layouts1 = await metric("LayoutCount");
  await page.waitForTimeout(150); // hold still before letting go: a placed drop, not a throw
  await page.evaluate(() => { window.__mUp = performance.now(); });
  await page.mouse.up();
  await page.waitForTimeout(900);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const phases = await page.evaluate(() => {
    cancelAnimationFrame(window.__raf);
    const f = window.__frames, gaps = f.slice(1).map((t, i) => [f[i + 1], t - f[i]]);
    const pick = (a, b) => gaps.filter(([t]) => t > a && t <= b).map(([, g]) => g);
    const sum = (g) => ({ frames: g.length, long: g.filter((x) => x > 25).length, worstMs: Math.round(Math.max(0, ...g)) });
    return { lift: sum(pick(window.__mDown, window.__mDown + 120)), move: sum(pick(window.__mDown + 120, window.__mUp)), settle: sum(pick(window.__mUp, 1e12)) };
  });
  R.drag = { moves: steps, layoutsDuringMove: layouts1 - layouts0, ...phases };
  R.orderAfterDrag = await page.$$eval(".snap-brick", (els) => els.map((e) => e.dataset.brick));
  await shot(page, "04-after-reorder");
  const g2 = await page.locator('.snap-brick[data-brick="render"] .snap-head').boundingBox();
  await page.mouse.move(g2.x + 60, g2.y + 10); await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(g2.x + 60, g2.y + 10 - i * 14);
  await shot(page, "03-mid-drag");
  await page.mouse.up();
  await page.waitForTimeout(900);
  R.orderAfterThrow = await page.$$eval(".snap-brick", (els) => els.map((e) => e.dataset.brick));

  // remove Upscale, then drag its tile back in from the rail
  await page.hover('.snap-brick[data-brick="upscale"]');
  await page.click('.snap-brick[data-brick="upscale"] .snap-x');
  await page.waitForTimeout(600);
  const saveFrom = () => page.evaluate(() => { const E = window.__snap.engine, s = E.nodeFor("save_video", "save"); return { bricks: E.state().bricks.map((b) => b.key), from: app.graph.getNodeById(app.graph.getLink(s.inputs[s.findInputSlot("video")].link)?.origin_id)?.title ?? null }; });
  R.upscaleAfterRemove = await saveFrom();
  const tile = await page.locator('.snap-tile[data-source="upscale"]').boundingBox();
  const last = await page.locator(".snap-brick").last().boundingBox();
  await page.mouse.move(tile.x + 30, tile.y + 12); await page.mouse.down();
  for (let i = 1; i <= 25; i++) await page.mouse.move(tile.x + 30 + ((last.x + 80 - tile.x - 30) * i) / 25, tile.y + 12 + ((last.y + last.height + 20 - tile.y - 12) * i) / 25);
  await shot(page, "05-insert-drag");
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(900);
  R.upscaleAfterInsert = await saveFrom();
  R.orderAfterInsert = await page.$$eval(".snap-brick", (els) => els.map((e) => e.dataset.brick));

  // canvas draws while Snap is open
  R.drawsWhileSnap = await page.evaluate(async () => { let n = 0; const d = app.canvas.draw; app.canvas.draw = function (...a) { n++; return d.apply(this, a); }; await new Promise((r) => setTimeout(r, 1000)); app.canvas.draw = d; return { draws: n, paused: app.canvas.pause_rendering }; });

  // switch to the graph: mid-flight frame, settled frame, graph intact
  const before = await page.evaluate(() => ({ nodes: app.graph._nodes.length, links: Object.keys(app.graph.links ?? {}).length || app.graph.links?.size }));
  await page.evaluate(() => window.__snap.toggle());
  await page.waitForTimeout(140);
  await shot(page, "06-switch-mid");
  await page.waitForTimeout(800);
  await shot(page, "07-graph");
  R.toGraph = await page.evaluate(() => ({ showing: window.__snap.switch.showing, paused: app.canvas.pause_rendering, overlay: getComputedStyle(window.__snap.view.root).display, nodes: app.graph._nodes.length }));
  R.graphUnchanged = R.toGraph.nodes === before.nodes;

  // reverse mid-flight: graph -> snap -> graph within 120 ms ends in the graph with no stuck transforms
  await page.evaluate(() => window.__snap.toggle());
  await page.waitForTimeout(120);
  await page.evaluate(() => window.__snap.toggle());
  await page.waitForTimeout(1200);
  R.reverse = await page.evaluate(() => ({ showing: window.__snap.switch.showing, overlay: getComputedStyle(window.__snap.view.root).display, stuck: [...document.querySelectorAll(".snap-brick")].filter((e) => e.style.transform).length }));

  // rewire in the graph, come back: one toast naming the override
  await page.evaluate(() => { const E = window.__snap.engine, p = E.nodeFor("preset", "preset"), r = E.nodeFor("render", "render"); app.canvas.emitBeforeChange(); p.connect(p.findOutputSlot("MODEL"), r, r.findInputSlot("model")); app.canvas.emitAfterChange(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.__snap.toggle());
  await page.waitForTimeout(900);
  R.toast = await page.textContent(".snap-toast");
  R.overrideChip = await page.locator(".snap-bind.override").count();
  await shot(page, "08-override-toast");

  // Nodes 2.0: same switch
  await page.evaluate(async () => { await app.extensionManager.setting.set("Comfy.VueNodes.Enabled", true); window.__snap.toggle(); });
  await page.waitForTimeout(1500);
  await shot(page, "09-graph-vue");
  await page.evaluate(() => window.__snap.toggle());
  await page.waitForTimeout(900);
  R.vue = await page.evaluate(() => ({ showing: window.__snap.switch.showing, bricks: document.querySelectorAll(".snap-brick").length }));
  await shot(page, "10-snap-over-vue");
  await page.evaluate(async () => { window.__snap.toggle(); await app.extensionManager.setting.set("Comfy.VueNodes.Enabled", false); });
  await page.waitForTimeout(500);

  R.errors = errors;
  fs.writeFileSync(path.join(out, "test_ui_result.json"), JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, null, 1));
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
