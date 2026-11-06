// Shot compiler: the Kon-and-the-letter shot card compiles into the Render prompt's first line with provenance per part,
// sets the length, puts the set in References; re-applying is idempotent; undo is one step. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
const call = async (tool, args = {}) => (await (await fetch(`http://127.0.0.1:${CFG.port}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) })).json());
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
    for (const k of ["models", "preset", "rack", "refs", "render"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(900);
  const state = () => page.evaluate(() => { const E = window.__snap.engine; return { first: E.getValue("render", "render", "prompt").split("\n")[0], lines: E.getValue("render", "render", "prompt").split("\n").length, length: E.getValue("render", "render", "length"), pictures: (E.state().bricks.find((x) => x.key === "refs").pictures ?? []).length, parts: (E.state().bricks.find((x) => x.key === "render").shot?.parts ?? []).map((x) => x.field) }; });
  R.before = await state();
  R.preview = (await call("compile_shot", { card: "shot-letter" })).result;
  await page.click('.snap-brick[data-brick="render"] .snap-name'); await page.waitForTimeout(150);
  await page.click('.snap-card:has-text("Kon hands Ferro")'); await page.waitForTimeout(2000);
  R.applied = await state();
  R.chips = await page.$$eval('.snap-inspector .snap-part', (els) => els.map((e) => e.textContent));
  R.dots = await page.locator('.snap-brick[data-brick="render"] .snap-dot').count();
  await page.screenshot({ path: path.join(out, "36-shot-compiled.png") });
  await page.click('.snap-card:has-text("Kon hands Ferro")'); await page.waitForTimeout(2000);
  R.again = await state();
  // re-applying the same shot changes nothing, so it leaves no undo step: one undo goes back to before the shot
  await page.evaluate(() => app.extensionManager.workflow.activeWorkflow.changeTracker.undo()); await page.waitForTimeout(700);
  R.afterUndo = await state();
  // the person's edit of the set (the editor's "-mine" working copy) is what the shot compiles from
  R.mine = await page.evaluate(async () => {
    const L = await import("/extensions/ComfyUI-MAINodes/snap/library.js"); await L.ready();
    const card = L.get("set-lamp-room-end-s3"), s = structuredClone(card.brick.snapshot);
    s.actors.find((a) => a.name === "Kon").at = [1.0, -1.2];
    await L.save(L.version(card, s, true));
    await L.apply(L.get("shot-letter"));
    const shot = window.__snap.engine.state().bricks.find((x) => x.key === "render").shot;
    return { setFrom: shot.parts.filter((x) => x.field === "set" || x.field === "blocking").map((x) => x.from), pictureCards: (window.__snap.engine.state().bricks.find((x) => x.key === "refs").pictures ?? []).map((x) => x.card) };
  });
  R.queueAttempts = globalThis.__queued || 0;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_shot_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
