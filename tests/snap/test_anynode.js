// Any installed node as a brick: VAE Decode from the palette asks "which one?" for its vae (two VAEs fit), the pick is
// kept; KSampler (via the agent tool) binds model by type to the Render Preset, then upgrades to the Dial Rack when that
// arrives; the bricks survive a workflow reload. Never queues.
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
    for (const k of ["models", "preset", "render"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(900);
  const bindings = (key) => page.evaluate((k) => window.__snap.engine.describe().find((x) => x.brick === k)?.bindings, key);
  await page.locator(".snap-root").focus();
  await page.keyboard.press("Control+k"); await page.keyboard.type("vae decode"); await page.waitForTimeout(200);
  R.paletteHits = await page.$$eval(".snap-hit", (els) => els.map((e) => e.textContent).slice(0, 4));
  await page.evaluate(() => [...document.querySelectorAll(".snap-hit")].find((e) => e.children[1]?.textContent === "VAE Decode")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));
  await page.waitForTimeout(800);
  R.keys = await page.evaluate(() => window.__snap.engine.state().bricks.map((x) => x.key));
  R.selectedAfterPalette = await page.evaluate(() => window.__snap.view.selected);
  R.renderFirstFrame = (await bindings("render"))?.find((x) => x.role === "first_frame") ?? null; // our bricks bind by their own rules only
  R.ask = (await bindings("node:VAEDecode#1"))?.find((x) => x.role === "vae");
  R.askChips = await page.$$eval('[data-brick="node:VAEDecode#1"] .snap-choice', (els) => els.map((e) => e.textContent));
  await page.screenshot({ path: path.join(out, "33-any-node-ask.png") });
  await page.click('[data-brick="node:VAEDecode#1"] .snap-choice:has-text("video vae")'); await page.waitForTimeout(400);
  R.chosen = (await bindings("node:VAEDecode#1"))?.find((x) => x.role === "vae");
  R.linkFromVideoVae = await page.evaluate(() => { const E = window.__snap.engine, d = E.nodeFor("node:VAEDecode#1", "node"); return String(app.graph.getLink(d.inputs[d.findInputSlot("vae")].link)?.origin_id) === String(E.nodeFor("models", "video_vae").id); });
  R.ks = (await call("snap", { brick: "node:KSampler" })).result;
  R.ksModel1 = (await bindings("node:KSampler#1"))?.find((x) => x.role === "model");
  await call("snap", { brick: "rack", after: "preset" });
  R.ksModel2 = (await bindings("node:KSampler#1"))?.find((x) => x.role === "model");
  R.chosenKept = (await bindings("node:VAEDecode#1"))?.find((x) => x.role === "vae")?.rule;
  R.unknown = await call("snap", { brick: "node:NoSuchNode" });
  // a loop is never made: Decode -> Encode by image, so Encode's latent must not go back into Decode's samples
  R.loop = await page.evaluate(async () => {
    const E = window.__snap.engine;
    app.graph.clear(); app.graph.extra = {};
    await E.snap("node:VAEDecode"); await E.snap("node:VAEEncode");
    const d = E.describe(), dec = d.find((x) => x.brick === "node:VAEDecode#1"), enc = d.find((x) => x.brick === "node:VAEEncode#1");
    return { encPixels: enc.bindings.find((x) => x.role === "pixels")?.from, decSamples: dec.bindings.find((x) => x.role === "samples")?.from ?? null };
  });
  // review 3: inherited names are not bricks; a downstream provider doesn't rewire an earlier input; removing a
  // candidate's brick clears its ask; a saved brick whose node is no longer installed still shows and can be removed
  R.constructorRefused = (await call("snap", { brick: "constructor" })).error ?? null;
  R.review3 = await page.evaluate(async () => {
    const E = window.__snap.engine, r = {};
    E.useRules([]); // the earlier pick in this test is remembered now; these checks are about asks themselves
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "node:KSampler", "rack"]) await E.snap(k); // the rack comes after KSampler
    r.ksModelFrom = E.describe().find((x) => x.brick === "node:KSampler#1").bindings.find((x) => x.role === "model")?.from;
    await E.snap("node:VAEDecode");
    r.askBefore = E.describe().find((x) => x.brick === "node:VAEDecode#1").bindings.some((x) => x.rule === "ask");
    E.unsnap("models");
    r.askAfterUnsnap = E.state().bindings.some((x) => x.rule === "ask");
    const s = E.state(); s.bricks.push({ key: "node:NoLongerInstalled#1", nodes: { node: 999999 }, placed: {} });
    try { r.describeMissing = E.describe().find((x) => x.brick === "node:NoLongerInstalled#1")?.title; window.__snap.view.render(null); E.unsnap("node:NoLongerInstalled#1"); r.missingRemoved = !E.state().bricks.some((x) => x.key === "node:NoLongerInstalled#1"); } catch (e) { r.missingError = e.message; }
    return r;
  });
  // reload the workflow: the any-node bricks are rebuilt from their node definitions
  await page.evaluate(async () => { await app.loadGraphData(app.graph.serialize(), true, true, app.extensionManager.workflow.activeWorkflow); });
  await page.waitForTimeout(1200);
  R.afterReload = await page.evaluate(() => window.__snap.engine.describe().map((x) => `${x.brick}:${x.title}`));
  R.queueAttempts = globalThis.__queued || 0;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_anynode_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
