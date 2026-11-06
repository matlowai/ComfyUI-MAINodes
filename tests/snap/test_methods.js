// The method registry (PLAN U43, UX_GEMS §5): snap_cards/methods.json under the person's snap/methods.json (person wins,
// field by field), the slot enum from the registry, one list_methods shape for media and delta slots, Off and preview on
// every slot, guidance / local-API / cost on the sheet. Review P2: Custom is decided from the wiring, never a name (H4);
// swapping a Custom holder computes the factor from the method's scale kind and feeds Save from the new step (H3); a model
// with no known factor says so (M5); `fits` follows the recipe's kit (L6). Never queues (the preview POST is aborted).
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const out = path.join(CFG.out, "ui"); const R = {};
const MINE_METHODS = { slots: [{ id: "smooth", kind: "media", title: "Smooth", media: ["VIDEO"], off: "frames as rendered" }],
  methods: [{ slot: "upscale", id: "esrgan", guidance: { line: "my own line", evidence: "measured", source: "my takes", n: 3, hardware: "5090" } },
    { slot: "smooth", id: "rife", title: "RIFE (core FrameInterpolate)", kind: "media", media: { in: "VIDEO", out: "VIDEO" }, kit: "video", needs: [{ folder: "frame_interpolation" }], local_or_api: "local", unwired: "not wired yet" }] };
const MINE_MODELS = [{ file: "UltraSharpV2.safetensors", folder: "upscale_models", kind: "upscaler", scale: 4 }];
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; const targets = [];
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { q++; targets.push(r.request().postDataJSON()?.partial_execution_targets ?? null); return r.abort(); } return r.continue(); });
  await page.route(/\/api\/userdata\/snap%2F(methods|models)\.json/, (r) => r.request().method() === "GET"
    ? r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(r.request().url().includes("methods") ? MINE_METHODS : MINE_MODELS) }) : r.continue());
  await useShelf(page, { extra: { upscale_models: [["UltraSharpV2.safetensors", 0.07], ["MysteryUp.safetensors", 0.07]] } });
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
  const call = (name, args, opts) => page.evaluate(([n, a, o]) => window.__tools.callTool(n, a, o).catch((e) => ({ error: e.message })), [name, args, opts]);
  const E = (fn, arg) => page.evaluate(fn, arg);
  const state = () => E(async () => {
    const e = window.__snap.engine, keys = e.state().bricks.map((x) => x.key), up = keys.find((k) => ["image_upscale", "image_resize"].includes(k));
    const p = (await app.graphToPrompt()).output, save = Object.values(p).find((n) => n.class_type === "SaveImage"), from = (n, input) => (n.inputs[input] ? p[n.inputs[input][0]]?.class_type : null);
    window.__snap.view.render(null);
    const el = up && document.querySelector(`.snap-brick[data-brick="${up}"]`);
    const scale = Object.values(p).find((n) => n.class_type === "ImageScaleBy");
    return { keys, saveFrom: from(save, "images"), scaleBy: scale?.inputs.scale_by ?? null, scaleFrom: scale && from(scale, "image"), custom: Object.values(p).filter((n) => n.class_type === "ImageScaleToTotalPixels").length,
      headline: el?.querySelector(".snap-headline")?.textContent ?? null, facts: el ? [...el.querySelectorAll(".snap-fact b")].map((x) => x.textContent) : [], chips: [...document.querySelectorAll(".snap-method")].map((x) => [x.closest(".snap-brick")?.dataset.brick, x.textContent]) };
  });

  // the registry: slot enum, person over pack, one shape for media and delta slots
  R.enum = await E(() => window.__tools.schema().find((t) => t.name === "list_methods").inputSchema.properties.slot.enum);
  const up = await call("list_methods", { slot: "upscale" });
  R.upscale = { current: up.current, ids: up.methods?.map((m) => m.id), esrgan: up.methods?.find((m) => m.id === "esrgan"), relayFits: up.methods?.find((m) => m.id === "relayvsr")?.fits };
  const tu = await call("list_methods", { slot: "turbo" });
  R.turboShape = tu.methods?.map((m) => ["id", "title", "current", "wired", "fits", "install_state"].every((k) => k in m));
  R.turboKind = tu.kind;
  R.smooth = await call("list_methods", { slot: "smooth" });

  // H4: a model patch with "scale" in its type name is not an upscaler, and set_method upscale leaves it alone
  await call("snap", { brick: "node:RescaleCFG", after: "rack" });
  R.h4List = await call("list_methods", { slot: "upscale" }).then((r) => ({ current: r.current, custom: r.methods.filter((m) => m.id === "custom").length }));
  R.h4Set = await call("set_method", { slot: "upscale", method: "esrgan", factor: 2 });
  R.h4 = await state();

  // M5: a fixed model with no factor anywhere says so and stays at its own size; the model graph's `scale` is read
  await E(() => window.__snap.engine.setValue("image_upscale", "loader", "model_name", "MysteryUp.safetensors"));
  await call("set_method", { slot: "upscale", method: "esrgan", factor: 2 });
  R.m5Unknown = await state();
  await page.screenshot({ path: path.join(out, "99-upscale-factor-unknown.png") });
  await E(() => window.__snap.engine.setValue("image_upscale", "loader", "model_name", "UltraSharpV2.safetensors"));
  await call("set_method", { slot: "upscale", method: "esrgan", factor: 2 });
  R.m5Graph = await state();

  // Off on every slot; preview queues only up to the slot's output (a proposal unless confirmed)
  R.offUpscale = await call("set_method", { slot: "upscale", method: "off" });
  R.offTurbo = await call("set_method", { slot: "turbo", method: "off" });
  R.previewProposed = await call("preview", { slot: "upscale" });
  R.previewRun = await call("preview", { slot: "upscale" }, { confirmed: true });
  R.saveId = await E(() => String(window.__snap.engine.state().bricks.find((x) => x.key === "save_image").nodes.save));
  R.previewTargets = targets.slice();
  await page.waitForTimeout(500); // the aborted POST opens ComfyUI's error dialog: close it
  await page.locator(".p-dialog-close-button").first().click({ timeout: 3000 }).catch(() => {});
  await page.keyboard.press("Escape");

  // H3: a Custom holder placed after Save, swapped for ESRGAN: the model's own factor, and Save is fed from the new step
  await E(async () => { const e = window.__snap.engine; e.unsnap("image_upscale"); e.unsnap("node:RescaleCFG#1"); await e.snap("node:ImageScaleToTotalPixels"); });
  R.h3List = await call("list_methods", { slot: "upscale" }).then((r) => ({ current: r.current, custom: r.methods.filter((m) => m.id === "custom").map((m) => m.title) }));
  R.h3Set = await call("set_method", { slot: "upscale", method: "esrgan" });
  R.h3 = await state();
  // a Custom holder wired into Save by hand in the graph, swapped for a plain 2× resize
  await E(async () => { const e = window.__snap.engine; e.unsnap("image_upscale"); const k = (await e.snap("node:ImageScaleToTotalPixels")).brick;
    const n = e.nodeFor(k, "node"), save = e.nodeFor("save_image", "save"); n.connect(0, save, 0); });
  R.h3WiredBefore = await state();
  R.h3Wired = await call("set_method", { slot: "upscale", method: "resize", factor: 2 });
  R.h3WiredAfter = await state();
  await page.screenshot({ path: path.join(out, "100-custom-swapped.png") });

  // the sheet: guidance with its evidence grade, the local / API badge, cost; the turbo opens the same sheet
  await call("ui", { action: "methods", target: "upscale" }); await page.waitForTimeout(400);
  R.sheet = await page.$$eval(".snap-method-sheet .snap-setup-card", (els) => els.map((e) => e.textContent));
  await page.screenshot({ path: path.join(out, "101-method-sheet-registry.png") });
  await call("ui", { action: "close" }); await page.keyboard.press("Escape");
  await call("ui", { action: "methods", target: "turbo" }); await page.waitForTimeout(400);
  R.turboSheet = await page.$$eval(".snap-method-sheet .snap-setup-card", (els) => els.map((e) => e.textContent));
  await page.screenshot({ path: path.join(out, "102-turbo-sheet-registry.png") });
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_methods_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e.message.split("\n")[0]); process.exit(1); });
