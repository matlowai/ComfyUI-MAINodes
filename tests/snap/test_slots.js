// The upscale method slot on an image recipe (SNAP-R14, review 5.2/5.3): ESRGAN-family model and plain resize as bricks
// between the image Render's IMAGE and Save, swapped in place by the method chip / set_method keeping the factor; a fixed
// 4× model resized to 2× says so; Off bypasses the brick (settings kept); unwired and other-media methods are listed with
// why; readiness from the folders; a hand-wired upscaler shows as Custom. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { q++; return r.abort(); } return r.continue(); });
  await useShelf(page);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    window.__tools = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); const M = await import("/extensions/ComfyUI-MAINodes/snap/models.js"), L = await import("/extensions/ComfyUI-MAINodes/snap/library.js");
    await M.load(); await L.ready();
    app.graph.clear(); app.graph.extra = {};
    await M.applyCard(L.get("setup-moss-base"), { fresh: true });
    snap.toggle();
  });
  await page.waitForTimeout(1500);
  const call = (name, args) => page.evaluate(([n, a]) => window.__tools.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  const state = () => page.evaluate(async () => {
    const E = window.__snap.engine, keys = E.state().bricks.map((b) => b.key), up = keys.find((k) => ["image_upscale", "image_resize"].includes(k));
    const p = (await app.graphToPrompt()).output, save = Object.entries(p).find(([, n]) => n.class_type === "SaveImage")[1];
    const el = up && document.querySelector(`.snap-brick[data-brick="${up}"]`);
    return { keys, up, saveFrom: p[save.inputs.images[0]]?.class_type, scaleBy: Object.values(p).find((n) => n.class_type === "ImageScaleBy")?.inputs.scale_by ?? null,
      headline: el?.querySelector(".snap-headline")?.textContent ?? null, on: el?.querySelector(".snap-inline button.on")?.textContent ?? null, chip: el?.querySelector(".snap-method")?.textContent ?? null,
      quality: el ? [...el.querySelectorAll(".snap-fact b")].map((x) => x.textContent) : [], off: el?.classList.contains("off") ?? null, inspecting: document.querySelector(".snap-root").classList.contains("inspecting") };
  });
  R.listed = (await call("list_methods", { slot: "upscale" })).methods.map((m) => [m.id, m.install_state, m.wired, m.fits]);
  R.esrgan = await call("set_method", { slot: "upscale", method: "esrgan", factor: 2 });
  R.a = await state();
  await page.screenshot({ path: path.join(out, "91-image-upscale.png") });
  await page.click('.snap-brick[data-brick="image_upscale"] .snap-inline button:has-text("4×")'); await page.waitForTimeout(500);
  R.four = await state();
  R.resize = await call("set_method", { slot: "upscale", method: "resize" });
  R.b = await state();
  await page.click('.snap-brick[data-brick="image_resize"] .snap-inline button:has-text("Off")'); await page.waitForTimeout(500);
  R.off = await state();
  R.offFactor = await page.evaluate(() => window.__snap.engine.getValue("image_resize", "resize", "scale_by"));
  R.unwired = await call("set_method", { slot: "upscale", method: "seedvr2" });
  R.otherMedia = await call("set_method", { slot: "upscale", method: "relayvsr" });
  await page.click('.snap-brick[data-brick="image_resize"] .snap-method'); await page.waitForTimeout(400);
  R.sheet = await page.$$eval(".snap-method-sheet .snap-setup-card", (els) => els.map((e) => ({ text: e.querySelector("strong").textContent, disabled: e.disabled })));
  await page.screenshot({ path: path.join(out, "92-upscale-methods.png") });
  await page.click('.snap-method-sheet .snap-setup-card:has-text("ESRGAN")'); await page.waitForTimeout(800);
  R.backToEsrgan = await state();
  await page.evaluate(() => app.extensionManager.workflow.activeWorkflow.changeTracker.undo()); await page.waitForTimeout(900);
  R.undo = await state();
  // a hand-wired upscaler: shown as Custom, with its own widgets
  await page.evaluate(async () => { const E = window.__snap.engine; E.unsnap("image_resize"); await E.snap("node:ImageScaleToTotalPixels", { at: E.state().bricks.findIndex((b) => b.key === "save_image") }); window.__snap.view.render(null); });
  await page.waitForTimeout(500);
  R.custom = { chip: await page.$eval('.snap-brick[data-brick^="node:ImageScaleToTotalPixels"] .snap-method', (e) => e.textContent).catch(() => null), listed: (await call("list_methods", { slot: "upscale" })).current };
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_slots_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e.message.split("\n")[0]); process.exit(1); });
