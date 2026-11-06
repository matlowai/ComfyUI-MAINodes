// What the recipe loads, and switching it (MODEL_SWITCHING.md P0/P1). The CPU server has no models, so the page sees a
// fake model shelf: object_info gets H3 file names in sub-folders (h3/) and /experiment/models lists them with sizes; the
// audio VAE is left out, so it must show as missing. Checks: Render Preset filled from its preset on creation + "edited";
// Models values resolved by basename, the unresolved one counted missing; model chips with sizes; nodes outside the
// recipe shown and left out of Run's targets; the Setup pill + sheet switching presets as one undo step; the agent tools;
// the dial picker's family default and the rack's family warning; the Upscale brick's settings and readiness. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
const GB = 1e9;
const SHELF = {
  text_encoders: [["h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", 15.7], ["anima/qwen_3_06b_base.safetensors", 1.2]],
  vae: [["h3/minimax_h3_video_vae_fp16.safetensors", 5.2]],
  diffusion_models: [["Chroma1-HD.safetensors", 17.8], ["h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors", 21.0]],
  loras: [["h3/pika_h3_flex_fl2va_v1_bf16.safetensors", 2.0], ["h3/minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors", 0.4]],
};
const ADD = { CLIPLoader: { clip_name: "text_encoders" }, VAELoader: { vae_name: "vae" }, MAIRenderPreset: { model: "diffusion_models", lora: "loras" } };
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
  await page.route(/\/api\/object_info$/, async (r) => {
    const res = await r.fetch(), info = await res.json();
    for (const [type, inputs] of Object.entries(ADD)) for (const [name, folder] of Object.entries(inputs)) {
      const spec = info[type].input.required[name], names = SHELF[folder].map(([n]) => n);
      if (Array.isArray(spec[0])) spec[0] = [...names, ...spec[0].filter((x) => x !== "pixel_space")]; else spec[1].options = [...(spec[1].options ?? []), ...names];
    }
    info.CLIPLoader.input.required.clip_name[0].push("gone/offloaded_te.safetensors"); // listed, but no folder list has it: not readable
    r.fulfill({ response: res, json: info });
  });
  await page.route(/\/api\/experiment\/models(\/[^/]+)?$/, (r) => {
    const folder = r.request().url().match(/experiment\/models\/([^/?]+)/)?.[1];
    r.fulfill({ json: folder ? (SHELF[folder] ?? []).map(([name, gb]) => ({ name, size: gb * GB, modified: 1, pathIndex: 0 })) : Object.keys(SHELF).map((name) => ({ name, folders: [], extensions: [".ckpt", ".pt", ".pth", ".safetensors", ".sft"] })) });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap; const E = snap.engine;
    window.__tools = await import("/extensions/ComfyUI-MAINodes/snap/tools.js");
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "first_frame", "refs", "render", "upscale", "save_video"]) await E.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(1500);
  const preset = () => page.evaluate(() => { const n = window.__snap.engine.nodeFor("preset", "preset"), w = (k) => n.widgets.find((x) => x.name === k).value; return { model: w("model"), lora: w("lora"), steps: w("steps"), schedule: w("schedule"), current: n.presets.current() }; });
  R.created = await preset();
  R.models = await page.evaluate(() => { const E = window.__snap.engine; return { clip: E.getValue("models", "clip", "clip_name"), type: E.getValue("models", "clip", "type"), video: E.getValue("models", "video_vae", "vae_name"), audio: E.getValue("models", "audio_vae", "vae_name"), missing: E.missing().map((m) => `${m.brick}.${m.setting}=${m.value}`) }; });
  R.chips = await page.$$eval('.snap-brick[data-brick="models"] .snap-model', (els) => els.map((e) => ({ text: e.textContent, missing: e.classList.contains("missing"), title: e.title })));
  R.presetFace = await page.$$eval('.snap-brick[data-brick="models"] .snap-preset, .snap-brick[data-brick="models"] .snap-model', (els) => els.map((e) => e.textContent)); // the Setup card (U58)
  // edited: a field off the preset marks the bar, the brick's chip and the pill
  await page.evaluate(() => window.__snap.engine.setValue("preset", "preset", "steps", 8)); await page.waitForTimeout(400);
  R.edited = { current: (await preset()).current, bar: await page.evaluate(() => [...window.__snap.engine.nodeFor("preset", "preset").widgets.find((w) => w.name === "render_preset").element.querySelectorAll("span")].find((s) => s.textContent === "edited").style.display),
    chip: await page.textContent('.snap-brick[data-brick="models"] .snap-preset'), pill: await page.textContent(".snap-setup") };
  await page.screenshot({ path: path.join(out, "70-models-chain.png") });
  // outside the recipe: a stray loader with a file that isn't installed
  await page.evaluate(() => { const n = LiteGraph.createNode("CLIPLoader"); n.pos = [0, 2000]; app.graph.add(n); n.widgets[0].value = "qwen_3_4b.safetensors"; window.__stray = n.id; window.__snap.view.render(null); });
  await page.waitForTimeout(300);
  R.outside = await page.evaluate(() => { const E = window.__snap.engine, t = E.targets(); return { button: document.querySelector(".snap-outside:not([hidden])")?.textContent ?? null, strayInTargets: t.includes(String(window.__stray)), innerTargets: t.filter((x) => x.includes(":")).length, strayMissing: E.missing().some((m) => m.brick === null && m.value === "qwen_3_4b.safetensors"), status: document.querySelector(".snap-status").title }; });
  await page.evaluate(() => { app.graph.remove(app.graph.getNodeById(window.__stray)); window.__snap.view.render(null); });
  // a choice the folder lists don't have: shown as not readable and counted missing
  await page.evaluate(() => window.__snap.engine.setValue("models", "clip", "clip_name", "gone/offloaded_te.safetensors")); await page.waitForTimeout(400);
  R.unreadable = { chip: await page.textContent('.snap-brick[data-brick="models"] .snap-model.missing'), status: await page.evaluate(() => document.querySelector(".snap-status").title),
    describe: (await page.evaluate(() => window.__tools.callTool("describe_recipe", {}))).models.missing };
  await page.evaluate(() => window.__snap.engine.setValue("models", "clip", "clip_name", "h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"));
  // the Setup pill opens the setups; a card applies its preset as one undo step
  await page.click(".snap-setup"); await page.waitForTimeout(400);
  R.sheet = await page.$$eval(".snap-setup-card", (els) => els.map((e) => ({ name: e.querySelector("strong").firstChild.textContent, on: e.classList.contains("on"), files: e.querySelectorAll(".snap-setup-files span").length, text: e.textContent })));
  R.sheetTitle = await page.textContent(".snap-setup-sheet .snap-rail-title");
  await page.screenshot({ path: path.join(out, "71-setups-sheet.png") });
  await page.click('.snap-setup-card:has-text("DMAD speed LoRA")'); await page.waitForTimeout(500);
  R.dmad = { ...(await preset()), sheetClosed: !(await page.$(".snap-setup-sheet")), pill: await page.textContent(".snap-setup") };
  await page.evaluate(() => app.extensionManager.workflow.activeWorkflow.changeTracker.undo()); await page.waitForTimeout(800);
  R.afterUndo = await preset();
  // agents: setups, models, basename resolution
  const call = (name, args) => page.evaluate(([n, a]) => window.__tools.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  R.listSetups = (await call("list_setups", {})).map((s) => [s.name, s.family, s.current, s.models.length]);
  R.applySetup = await call("apply_setup", { name: "Pika H3 Flex" });
  R.listModels = await call("list_models", { folder: "vae" });
  R.listFolders = await call("list_models", {});
  await call("set_widget", { node: await page.evaluate(() => window.__snap.engine.nodeFor("models", "audio_vae").id), name: "vae_name", value: "minimax_h3_video_vae_fp16.safetensors" });
  R.basenameWidget = await page.evaluate(() => window.__snap.engine.getValue("models", "audio_vae", "vae_name"));
  R.basenameSetting = await call("set_setting", { brick: "preset", name: "lora", value: "minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors" });
  R.badSetting = await call("set_setting", { brick: "preset", name: "lora", value: "not_here.safetensors" });
  R.describe = (await call("describe_recipe", {})).models;
  await call("apply_setup", { name: "Pika H3 Flex" });
  // the dial picker opens on the recipe's family (the encoder type); another family's dial on the rack is flagged
  await call("ui", { action: "dials" }); await page.waitForTimeout(400);
  R.pickerH3 = { on: await page.textContent(".snap-dial-sheet .snap-seg button.on"), tiles: await page.$$eval(".snap-dial-tile", (els) => els.length) };
  await call("ui", { action: "close" });
  await call("add_dial", { dial: "dials/h3_motion_hook.safetensors" });
  await page.evaluate(() => window.__snap.engine.setValue("models", "clip", "type", "krea2")); await page.waitForTimeout(400);
  await call("ui", { action: "dials" }); await page.waitForTimeout(400);
  R.pickerKrea = { on: await page.textContent(".snap-dial-sheet .snap-seg button.on"), tiles: await page.$$eval(".snap-dial-tile", (els) => els.length) };
  await call("ui", { action: "close" }); await page.waitForTimeout(300);
  R.rackWarn = await page.$eval('.snap-brick[data-brick="rack"] .snap-dial-warn', (e) => e.textContent).catch(() => null);
  R.typeWarn = await page.$eval('.snap-brick[data-brick="models"] .snap-warn', (e) => e.textContent).catch(() => null);
  R.pill = await page.textContent(".snap-setup");
  await page.evaluate(() => window.__snap.engine.setValue("models", "clip", "type", "minimax"));
  // Upscale: the blueprint's RelayVSR settings on its face and in the panel, and what a run would fail on
  await call("ui", { action: "select", target: "upscale" }); await page.waitForTimeout(800);
  R.upscale = await page.evaluate(() => ({ face: [...document.querySelectorAll('.snap-brick[data-brick="upscale"] .snap-fact span')].map((s) => s.textContent),
    check: document.querySelector('.snap-brick[data-brick="upscale"] .snap-check')?.textContent ?? null, fields: document.querySelectorAll(".snap-inspector .snap-field").length,
    inside: document.querySelector(".snap-inspector .snap-insp-node:not(.snap-insp-main) .snap-insp-type")?.textContent ?? null }));
  R.upscaleStatus = await page.evaluate(() => document.querySelector(".snap-status").title.includes("Upscale: LightX2V not found"));
  await page.screenshot({ path: path.join(out, "72-upscale-check.png") });
  await call("ui", { action: "close" });
  // a LoRA card applies the setup it names
  R.card = await call("apply_card", { card: "lora-dmad" });
  R.cardPreset = (await preset()).current;
  R.queueAttempts = globalThis.__queued || 0;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_models_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
