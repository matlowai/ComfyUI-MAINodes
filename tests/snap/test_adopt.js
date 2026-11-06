// Adopt the shipped Dials + Pika Simple example: pack bricks recognised, every link an `imported` binding, nothing
// overridden, and the graph serializes the same apart from extra.snap. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
const example = JSON.parse(fs.readFileSync(path.join(CFG.pack, "examples", "dials", "dials_simple_pika_derope.json"), "utf8"));
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  Object.assign(R, await page.evaluate(async (wf) => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    await app.loadGraphData(wf, true, true, app.extensionManager.workflow.activeWorkflow);
    await new Promise((d) => setTimeout(d, 1000));
    const strip = (w) => { const { extra, ...rest } = structuredClone(w); const { snap: _, ...ex } = extra ?? {}; return JSON.stringify({ ...rest, extra: ex, nodes: rest.nodes.map(({ size, ...n }) => n) }); };
    const before = strip(app.graph.serialize());
    snap.toggle(); await new Promise((d) => setTimeout(d, 600));
    const button = [...document.querySelectorAll(".snap-link")].find((x) => x.textContent.startsWith("Snap this workflow"))?.textContent;
    const res = snap.engine.adopt();
    await new Promise((d) => setTimeout(d, 300));
    snap.view.render(null);
    const d = snap.engine.describe();
    return {
      button, res, keys: d.map((x) => x.brick),
      renderBindings: d.find((x) => x.brick === "render")?.bindings.map((x) => `${x.role}<-${x.from}`),
      imported: snap.engine.state().bindings.every((x) => x.rule === "imported"),
      overrides: snap.engine.overrides().length, graphUnchanged: strip(app.graph.serialize()) === before,
      shown: document.querySelectorAll(".snap-brick").length, title: document.querySelector(".snap-title").textContent,
    };
  }, example));
  await page.screenshot({ path: path.join(out, "34-adopted.png") });
  R.fold = await page.evaluate(() => {
    const visible = () => [...document.querySelectorAll(".snap-stack > .snap-brick")].filter((e) => !e.classList.contains("snap-folded")).length;
    const pill = document.querySelector(".snap-fold"), before = visible(), text = pill?.textContent;
    pill?.click(); const opened = visible(); document.querySelector(".snap-fold")?.click(); const closed = visible();
    return { before, text, opened, closed };
  });
  // drop Dial Make in the visible gap after the folded Load Images: it must land after all seven, not after the first
  await page.evaluate(() => document.querySelector('.snap-brick[data-brick="rack"]').scrollIntoView({ inline: "center", block: "nearest" })); await page.waitForTimeout(200);
  const head = await page.locator('.snap-brick[data-brick="node:MAIDialMake#1"] .snap-head').boundingBox();
  const rack = await page.locator('.snap-brick[data-brick="rack"]').boundingBox();
  await page.mouse.move(head.x + 40, head.y + 10); await page.mouse.down();
  for (let i = 1; i <= 25; i++) await page.mouse.move(head.x + 40 + ((rack.x + 6 - head.x - 40) * i) / 25, head.y + 10);
  await page.waitForTimeout(200); await page.mouse.up(); await page.waitForTimeout(900);
  R.orderAfterFoldedDrop = await page.evaluate(() => window.__snap.engine.state().bricks.map((x) => x.key).slice(9, 13));
  // auto-scroll: hold Render (the last card) at the chain's left edge until the chain has scrolled back, drop it first
  await page.evaluate(() => document.querySelector('.snap-brick[data-brick="render"]').scrollIntoView({ inline: "end", block: "nearest" })); await page.waitForTimeout(200);
  const rh = await page.locator('.snap-brick[data-brick="render"] .snap-head').boundingBox();
  const left = await page.evaluate(() => document.querySelector(".snap-stack").getBoundingClientRect().left);
  R.scrollBefore = await page.evaluate(() => document.querySelector(".snap-stack").scrollLeft);
  await page.mouse.move(rh.x + 40, rh.y + 10); await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(rh.x + 40 + ((left + 4 - rh.x - 40) * i) / 20, rh.y + 10);
  await page.waitForTimeout(2500); // held at the edge
  R.scrollWhileHeld = await page.evaluate(() => document.querySelector(".snap-stack").scrollLeft);
  await page.mouse.up(); await page.waitForTimeout(900);
  R.firstAfterAutoscroll = await page.evaluate(() => window.__snap.engine.state().bricks[0].key);
  R.queueAttempts = globalThis.__queued || 0;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_adopt_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
