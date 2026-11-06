// Plan-board: two saved versions of the lamp room (shot 4: camera crossed the line; shot 5: radio switched off) show as
// three frames in shot order with the right continuity badges on the gaps; clicking a frame opens that state. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    const L = await import("/extensions/ComfyUI-MAINodes/snap/library.js");
    await L.ready();
    const base = L.get("set-lamp-room-end-s3");
    const s4 = structuredClone(base.brick.snapshot); s4.shot = "shot 4"; s4.camera.at = [2.0, -2.0];
    await L.save(L.version(base, s4, false));
    await new Promise((d) => setTimeout(d, 20));
    const s5 = structuredClone(s4); s5.shot = "shot 5"; s5.props.find((p) => p.name === "radio").state = "off";
    await L.save(L.version(base, s5, false));
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "refs", "render"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(900);
  await page.click('.snap-brick[data-brick="refs"] .snap-name'); await page.waitForTimeout(200);
  await page.click('.snap-card:has-text("lamp room, end of shot 3") .snap-edit >> nth=0'); await page.waitForTimeout(500);
  R.frames = await page.$$eval(".snap-board-frame strong", (els) => els.map((e) => e.textContent));
  R.gaps = await page.$$eval(".snap-board-gap", (els) => els.map((g) => ({ badges: [...g.querySelectorAll(".snap-badge")].map((x) => x.textContent), why: g.title })));
  await page.screenshot({ path: path.join(out, "31-plan-board.png") });
  await page.click(".snap-board-frame >> nth=1"); await page.waitForTimeout(400);
  R.opened = await page.textContent(".snap-sheet header strong");
  R.queueAttempts = globalThis.__queued || 0;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_board_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
