// Polish after U73 (fake shelf, CPU test server; never queues): (1) an empty recipe offers both kits' Models, Render,
// Upscale and Save: the rail and the palette name each by kit ("Models · video", "Models · pictures") instead of
// listing a title twice, and a recipe of one kit lists only its own; (2) a turbo file in two folders under one name
// (krea2/krea2_turbo_fp8_scaled and krea2_turbo_fp8_scaled) is one row in the Turbo slot, the copy in the setup's folder.
// Screenshot: ui/270-polish-rail-kits.png. usage: node test_polish2.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const HOST = `http://127.0.0.1:${process.argv[2] || CFG.port}`, out = path.join(CFG.out, "ui"), R = { queued: 0 };
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await useShelf(page, { extra: { diffusion_models: [["krea2_turbo_fp8_scaled.safetensors", 13.14]] } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/mainodes\/snap\/register$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"tools":0}' }));
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { R.queued++; return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${HOST}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snapv = snap; window.__X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js");
    app.graph.clear(); app.graph.extra = {}; snap.toggle(); });
  await page.waitForTimeout(1500);
  const rail = () => page.$$eval(".snap-rail .snap-tile", (els) => els.map((e) => { const t = e.children[1]; return [t.firstChild.textContent, t.querySelector(".snap-tile-kit")?.textContent].filter(Boolean).join(" · "); }));
  const palette = async () => { await page.locator(".snap-root").focus(); await page.keyboard.press("Control+k"); await page.waitForSelector(".snap-palette:not([hidden]) .snap-hit");
    const hits = await page.$$eval(".snap-hit", (els) => els.map((e) => e.children[1].textContent)); await page.keyboard.press("Escape"); return hits; };
  R.emptyRail = await rail(); R.emptyPalette = await palette();
  await page.screenshot({ path: path.join(out, "270-polish-rail-kits.png") });
  await page.evaluate(() => window.__X.callTool("apply_setup", { name: "Krea 2 Raw (fp8)" })); await page.waitForTimeout(1500);
  R.imageRail = await rail(); R.imagePalette = await palette();
  R.kreaTurbos = (await page.evaluate(() => window.__X.callTool("list_methods", { slot: "turbo" }))).methods?.map((t) => t.file);
  R.errors = errs;
  await b.close();
  const dup = (l) => l.length !== new Set(l).size;
  const c = {
    "empty recipe: no title twice in the rail": !dup(R.emptyRail) && R.emptyRail.includes("Models · video") && R.emptyRail.includes("Models · pictures") && R.emptyRail.includes("Save · pictures"),
    "empty recipe: no title twice in the palette": !dup(R.emptyPalette) && R.emptyPalette.includes("Render · video") && R.emptyPalette.includes("Render · pictures"),
    "a picture recipe lists only its own kit, plain titles": !dup(R.imagePalette) && !R.imagePalette.some((t) => t.includes(" · ")) && !R.imagePalette.includes("Render Preset"),
    "Krea turbo once, from the setup's folder": R.kreaTurbos?.filter((f) => f.endsWith("krea2_turbo_fp8_scaled.safetensors")).length === 1 && R.kreaTurbos.includes("krea2/krea2_turbo_fp8_scaled.safetensors"),
    "never queued, no page errors": R.queued === 0 && !R.errors.length };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_polish2_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`polish2  ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
