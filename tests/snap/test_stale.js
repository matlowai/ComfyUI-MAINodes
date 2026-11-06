// The side panel follows its widgets (the operator 2026-11-04: Models panel kept the old encoder/VAEs after agent edits). A
// focused select in the panel must not freeze it; a field being typed in still holds. Edits from an agent tool and from
// the graph view both show. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { q++; return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    window.__tools = await import("/extensions/ComfyUI-MAINodes/snap/tools.js");
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "render"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(1500);
  await page.click('.snap-brick[data-brick="models"] .snap-head'); await page.waitForTimeout(600);
  const panel = () => page.$$eval(".snap-inspector select", (els) => els.map((e) => e.value));
  R.before = await panel();
  await page.focus(".snap-inspector select"); // the person clicked a field in the panel
  const ids = await page.evaluate(() => ["clip", "video_vae"].map((k) => window.__snap.engine.nodeFor("models", k).id));
  const choices = await page.evaluate(() => window.__snap.engine.nodeFor("models", "clip").widgets[1].options.values);
  R.typeTo = choices.find((c) => c !== "minimax");
  await page.evaluate(([id, v]) => window.__tools.callTool("set_widget", { node: id, name: "type", value: v }), [ids[0], R.typeTo]); await page.waitForTimeout(500);
  R.afterTool = await panel();
  // typing in a text field holds the panel still
  await page.click('.snap-brick[data-brick="render"] .snap-head'); await page.waitForTimeout(600);
  await page.focus(".snap-inspector textarea"); await page.keyboard.type(" typed");
  await page.evaluate(() => window.__snap.engine.setValue("render", "render", "noise_seed", 4242)); await page.waitForTimeout(400);
  R.typing = await page.$eval(".snap-inspector textarea", (e) => e.value.endsWith(" typed"));
  await page.click('.snap-brick[data-brick="models"] .snap-head'); await page.waitForTimeout(600);
  // an edit in the graph view shows when Snap comes back
  await page.evaluate(() => window.__snap.toggle()); await page.waitForTimeout(900);
  await page.evaluate(() => { const w = window.__snap.engine.nodeFor("models", "clip").widgets.find((x) => x.name === "type"); w.value = "krea2"; w.callback?.(w.value); app.graph.setDirtyCanvas(true, true); });
  await page.evaluate(() => window.__snap.toggle()); await page.waitForTimeout(1200);
  R.afterGraph = { selected: await page.evaluate(() => window.__snap.view.selected), panel: await panel() };
  await page.screenshot({ path: path.join(out, "84-panel-follows.png") });
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_stale_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e.message.split("\n")[0]); process.exit(1); });
