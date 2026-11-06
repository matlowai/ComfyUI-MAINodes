// Setup switches after review P2 (REVIEW_P2_2026-11-04): an in-place switch replaces only the core rows and the card's
// own bricks (H1, M1), the Turbo chip reads the graph (M3), a preset keeps same-family encoder/VAE choices (M2), a family
// card from the Library or apply_card opens a new tab (H2, SNAP-R5) and an agent's switch keeps no "Last used" (L8),
// readable() doesn't cry wolf (M4), add_lora routes by role (M6), a malformed snap/models.json warns once and the tools
// still work (M8). Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { SHELF, useShelf } = require("./shelf.js");
const out = path.join(CFG.out, "ui"); const R = {};
const CARDS = JSON.parse(fs.readFileSync(path.join(CFG.pack, "snap_cards", "setups.json"), "utf8"));
const cardImage = (id) => CARDS.find((c) => c.id === id).brick.bricks.find((b) => b.key === "image").values.image;
async function open(browser, { modelsJson } = {}) {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const io = { q: 0, writes: [], errs: [] };
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { io.q++; return r.abort(); } return r.continue(); });
  await page.route(/\/api\/userdata\//, (r) => {
    const url = decodeURIComponent(r.request().url());
    if (r.request().method() === "POST") io.writes.push(url.split("/userdata/")[1].split("?")[0]);
    if (modelsJson && url.includes("snap/models.json") && r.request().method() === "GET") return r.fulfill({ status: 200, contentType: "application/json", body: modelsJson });
    return r.continue();
  });
  // U87: a Library card is a world record, saved through the pack's route as snap/<kind>/<id>.json
  await page.route(/\/mainodes\/snap\/world\/save$/, (r) => { const q = JSON.parse(r.request().postData() ?? "{}"); io.writes.push(`snap/${q.kind}/${q.id}.json`); return r.continue(); });
  await useShelf(page, { extra: { vae: [["h3/minimax_h3_lightvae_lite_vae_int8_convrot.safetensors", 0.3]] } });
  page.on("pageerror", (e) => io.errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    window.__tools = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); window.__M = await import("/extensions/ComfyUI-MAINodes/snap/models.js"); window.__L = await import("/extensions/ComfyUI-MAINodes/snap/library.js");
    window.__loadError = await window.__M.load().then(() => null, (e) => e.message); await window.__L.ready();
  });
  return { page, io };
}
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const { page, io } = await open(b);
  const call = (name, args) => page.evaluate(([n, a]) => window.__tools.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  const E = (fn, arg) => page.evaluate(fn, arg);
  const tabs = () => E(() => app.extensionManager.workflow.openWorkflows.length);
  const st = () => E(() => { const e = window.__snap.engine, M = window.__M; window.__snap.view.render(null);
    return { bricks: e.state().bricks.map((x) => x.key), rows: M.rows("loras").map((r) => [String(r.file).split("/").pop(), r.strength, r.on]), steps: e.getValue("image", "image", "steps"), cfg: e.getValue("image", "image", "cfg"),
      unet: e.getValue("image_models", "unet", "unet_name"), chip: document.querySelector(".snap-turbo")?.textContent ?? null, warnings: M.warnings().map((w) => w.text), family: M.family() }; });
  await E(async () => { app.graph.clear(); app.graph.extra = {}; await window.__M.applyCard(window.__L.get("setup-moss-base"), { fresh: true }); window.__snap.toggle(); });
  await page.waitForTimeout(1500);

  // H1: a turbo LoRA on Base, then Kromoss in place: the core row goes, the card's sampling comes, the chip says off
  await call("set_method", { slot: "turbo", method: "lodestones_kromoss_8step_dmd2_lora" });
  R.h1Before = await st();
  R.h1Apply = await call("apply_setup", { name: "Kromoss (int8)" });
  await page.waitForTimeout(600);
  R.h1 = await st();
  R.kromoss = { steps: cardImage("setup-kromoss").steps, cfg: cardImage("setup-kromoss").cfg };
  await page.screenshot({ path: path.join(out, "95-switch-kromoss-in-place.png") });
  // M3: the chip follows the graph: a turbo row removed by hand reads off
  await call("set_method", { slot: "turbo", method: "lodestones_kromoss_8step_dmd2_lora" });
  await call("remove_lora", { brick: "loras", row: 0 });
  R.m3Removed = await st();

  // M1: Kromoss (SLG patch) + Upscale 2x + a hand-added patch + own size and negative, then Base in place
  await call("set_method", { slot: "upscale", method: "esrgan", factor: 2 });
  await call("snap", { brick: "node:FreeU_V2", after: "rack" });
  await E(() => { const e = window.__snap.engine; e.setValues("image", "image", { width: 768, height: 1152, negative: "my own negative" }); });
  R.m1Before = await st();
  await call("apply_setup", { name: "MOSS-Image Base (int8)" });
  await page.waitForTimeout(600);
  R.m1 = await E(async () => { const e = window.__snap.engine, p = (await app.graphToPrompt()).output, save = Object.values(p).find((n) => n.class_type === "SaveImage");
    return { bricks: e.state().bricks.map((x) => x.key), width: e.getValue("image", "image", "width"), height: e.getValue("image", "image", "height"), negative: e.getValue("image", "image", "negative"),
      prompt: e.getValue("image", "image", "prompt"), saveFrom: p[save.inputs.images[0]].class_type, freeu: Object.values(p).filter((n) => n.class_type === "FreeU_V2").length }; });
  await page.screenshot({ path: path.join(out, "96-switch-keeps-own-bricks.png") });

  // M3: a turbo merge survives a "Last used" round trip, and Off still swaps it back
  await call("apply_setup", { name: "MOSS-Image SFT DeBand (int8)" });
  await call("set_method", { slot: "turbo", method: "moss_image_sft_deband_fast_dmd035_int8_convrot" });
  R.m3Merge = await st();
  await E(async () => { await window.__L.saveLast("MOSS-Image"); await window.__L.ready(); const was = app.extensionManager.workflow.activeWorkflow;
    await app.extensionManager.command.execute("Comfy.NewBlankWorkflow"); while (app.extensionManager.workflow.activeWorkflow === was || app.graph.nodes.length) await new Promise((r) => setTimeout(r, 30)); });
  R.m3Apply = await call("apply_setup", { name: "Last used: MOSS-Image" });
  await page.waitForTimeout(800);
  R.m3Round = await st();
  R.m3Off = await call("set_method", { slot: "turbo", method: "off" });
  R.m3AfterOff = await st();
  R.sft = { steps: cardImage("setup-moss-sft-deband").steps, cfg: cardImage("setup-moss-sft-deband").cfg };

  // M2: a same-family lower-VRAM VAE stays when the person picks another H3 preset
  await E(async () => { const e = window.__snap.engine; app.graph.clear(); app.graph.extra = {}; for (const k of ["models", "preset", "rack", "render"]) await e.snap(k);
    e.setValue("models", "video_vae", "vae_name", "h3/minimax_h3_lightvae_lite_vae_int8_convrot.safetensors"); });
  await call("apply_setup", { name: "DMAD speed LoRA" });
  R.m2 = await E(() => { const e = window.__snap.engine; return { vae: e.getValue("models", "video_vae", "vae_name"), type: e.getValue("models", "clip", "type"), lora: e.getValue("preset", "preset", "lora") }; });

  // M4: `none` is a real option, not an unreadable file; a .gguf choice core's list leaves out isn't one either; a file
  // downloaded after the page opened is found once the lists are asked again
  await E(() => window.__snap.engine.setValue("preset", "preset", "lora", "none"));
  R.m4None = await E(async () => { await window.__M.load(); return window.__M.unreadable().map((u) => u.value); });
  SHELF.diffusion_models.push(["h3/fresh_download_int8.safetensors", 21.0]);
  await E(() => { const w = window.__snap.engine.nodeFor("preset", "preset").widgets.find((x) => x.name === "model"); w.options.values.push("h3/fresh_download_int8.safetensors", "h3/some_model_Q4.gguf"); });
  await E(() => window.__snap.engine.setValue("preset", "preset", "model", "h3/fresh_download_int8.safetensors"));
  R.m4Fresh = (await call("describe_recipe", {})).models.missing;
  await page.waitForTimeout(800);
  R.m4FreshChip = await E(() => { window.__snap.view.render(null); return [...document.querySelectorAll('.snap-brick[data-brick="models"] .snap-model em')].map((x) => x.textContent); });
  await E(() => window.__snap.engine.setValue("preset", "preset", "model", "h3/some_model_Q4.gguf"));
  R.m4Gguf = (await call("describe_recipe", {})).models.missing;

  // M6: a dial file goes to the Dial Rack, an H3 turbo LoRA to the Render Preset: add_lora refuses both with the way there
  R.m6Before = (await st()).bricks;
  R.m6Dial = await call("add_lora", { file: "dials/moss_day_night_hook.safetensors" });
  R.m6Turbo = await call("add_lora", { file: "minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16.safetensors" });
  R.m6After = (await st()).bricks;

  // H2 + L8: a family card from apply_card (agent) and from the Library (person) opens a new tab; the agent's keeps no Last used
  const h3Tab = await E(() => app.extensionManager.workflow.activeWorkflow.path);
  R.h2TabsBefore = await tabs();
  io.writes.length = 0;
  R.h2Apply = await call("apply_card", { card: "setup-krea2-raw" });
  await page.waitForTimeout(1500);
  R.h2 = await E((p) => { const wf = app.extensionManager.workflow, old = wf.openWorkflows.find((w) => w.path === p);
    return { tabs: wf.openWorkflows.length, active: wf.activeWorkflow.path !== p, bricks: window.__snap.engine.state().bricks.map((x) => x.key), family: window.__M.family(), setup: window.__snap.engine.state().setup,
      old: (old.changeTracker?.activeState ?? old.activeState)?.extra?.snap?.bricks.map((x) => x.key) }; }, h3Tab);
  R.h2Writes = [...io.writes];
  io.writes.length = 0;
  await E(() => window.__snap.switch.showing || window.__snap.toggle()); await page.waitForTimeout(600);
  await page.fill(".snap-lib-q", "MOSS-Image Base"); await page.waitForTimeout(600);
  await page.click('.snap-card[data-card="setup-moss-base"]'); await page.waitForTimeout(2500);
  R.h2Lib = await E(() => ({ tabs: app.extensionManager.workflow.openWorkflows.length, bricks: window.__snap.engine.state().bricks.map((x) => x.key), family: window.__M.family(), toast: document.querySelector(".snap-toast")?.textContent ?? null }));
  R.h2LibWrites = [...io.writes];
  await page.screenshot({ path: path.join(out, "97-library-family-card-new-tab.png") });
  R.queue = io.q; R.errors = io.errs;

  // M8: a hand-edited snap/models.json with a trailing comma: one warning, the pack's graph, and every model tool still answers
  const bad = await open(b, { modelsJson: '[{"file": "odd_thing_v3.safetensors", "role": "style",}]' });
  const call2 = (name, args) => bad.page.evaluate(([n, a]) => window.__tools.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  await bad.page.evaluate(async () => { app.graph.clear(); app.graph.extra = {}; await window.__M.applyCard(window.__L.get("setup-moss-base"), { fresh: true }); window.__snap.toggle(); });
  await bad.page.waitForTimeout(1500);
  R.m8 = { loadError: await bad.page.evaluate(() => window.__loadError), describe: await call2("describe_recipe", {}).then((r) => r.error ?? r.models.warnings), setups: await call2("list_setups", {}).then((r) => r.error ?? r.length),
    methods: await call2("list_methods", { slot: "turbo" }).then((r) => r.error ?? r.methods.length), toast: await bad.page.evaluate(() => document.querySelector(".snap-toast")?.textContent ?? null) };
  R.m8Teach = await bad.page.evaluate(() => window.__M.teach("odd_thing_v3.safetensors", { role: "style" }).then(() => "taught", (e) => e.message));
  R.m8Writes = bad.io.writes.filter((w) => w.includes("models.json"));
  await bad.page.screenshot({ path: path.join(out, "98-malformed-model-graph.png") });
  R.errors8 = bad.io.errs; R.queue8 = bad.io.q;
  fs.writeFileSync(path.join(out, "test_switch_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e.message.split("\n")[0]); process.exit(1); });
