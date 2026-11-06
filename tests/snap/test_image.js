// P2 cross-family (MODEL_SWITCHING P2, MODEL_GRAPH_ONBOARDING §2/§3/§5/§6) on a fake model shelf: family cards in the
// Setups sheet, another family opens in a new tab after keeping a "Last used" card, same family in place (prompt stays),
// the Dials - Image blueprint's prompt, the Turbo chip (LoRA and merge; off restores; one undo step), N-row LoRA stacks
// by role, agent guards and warnings, setups owning the Models brick, the "what is this?" chip, MOSS dial strength note.
// Never queues.
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
    window.__tools = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); window.__M = await import("/extensions/ComfyUI-MAINodes/snap/models.js");
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "render"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(2500);
  const call = (name, args) => page.evaluate(([n, a]) => window.__tools.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  const tabs = () => page.evaluate(() => app.extensionManager.workflow.openWorkflows.length);
  const E = (fn, arg) => page.evaluate(fn, arg);
  // setups owns the Models brick: a junk encoder + type next to the H3 preset is warned, and applying the preset fixes it
  await E(() => { const e = window.__snap.engine; e.setValue("models", "clip", "type", "stable_diffusion"); e.setValue("models", "video_vae", "vae_name", "flux2-vae.safetensors"); });
  R.h3Warn = (await call("describe_recipe", {})).models.warnings;
  await call("apply_setup", { name: "Pika H3 Flex" });
  R.h3After = await E(() => { const e = window.__snap.engine; return { type: e.getValue("models", "clip", "type"), vae: e.getValue("models", "video_vae", "vae_name"), warnings: window.__M.warnings().map((w) => w.text) }; });
  // the sheet: presets and family cards, grouped by family; another family says it opens a new tab
  await call("ui", { action: "setups" }); await page.waitForTimeout(500);
  R.sheet = await page.$$eval(".snap-setup-sheet section", (els) => els.map((s) => ({ family: s.querySelector(".snap-rail-title").textContent, cards: [...s.querySelectorAll(".snap-setup-card")].map((c) => ({ name: c.querySelector("strong").firstChild.textContent, tab: !!c.querySelector("em.tab"), about: !!c.querySelector(".snap-setup-about"), missing: c.querySelectorAll(".missing").length, text: c.textContent })) })));
  await page.screenshot({ path: path.join(out, "85-setups-families.png") });
  R.tabsBefore = await tabs();
  await page.click('.snap-setup-card:has-text("MOSS-Image Base (int8)")'); await page.waitForTimeout(3500);
  R.moss = await E(() => { const e = window.__snap.engine, s = e.state(); return { bricks: s.bricks.map((b) => b.key), setup: s.setup, unet: e.getValue("image_models", "unet", "unet_name"), type: e.getValue("image_models", "clip", "type"),
    expand: e.getValue("image", "image", "switch"), steps: e.getValue("image", "image", "steps"), family: window.__M.family(), pill: document.querySelector(".snap-setup").textContent }; });
  R.tabsAfter = await tabs();
  R.lastUsed = (await call("list_setups", {})).filter((s) => s.name.startsWith("Last used")).map((s) => [s.name, s.family]);
  R.prompt = await E(async () => { const p = (await app.graphToPrompt()).output; const by = (t) => Object.values(p).filter((n) => n.class_type === t);
    return { unet: by("UNETLoader")[0]?.inputs.unet_name, lora: by("LoadLoraModel")[0]?.inputs["loras.0.enabled"], rack: by("MAIDialRack").length, textgen: by("TextGenerate").length, switch: by("ComfySwitchNode")[0]?.inputs.switch,
      sampler: by("KSamplerSelect")[0]?.inputs.sampler_name, sched: by("BasicScheduler")[0]?.inputs, cfg: by("CFGGuider")[0]?.inputs.cfg, size: by("EmptyLatentImage")[0]?.inputs, save: by("SaveImage")[0]?.inputs.filename_prefix,
      modelFrom: p[by("BasicScheduler")[0] && Object.keys(p).find((k) => p[k].class_type === "BasicScheduler")].inputs.model }; });
  await page.screenshot({ path: path.join(out, "86-moss-base-chain.png") });
  // Turbo chip: a LoRA turbo adds a core row and its sampling; agents can't stack a second turbo unasked
  R.turbos = (await call("list_methods", { slot: "turbo" })).methods.map((t) => [t.name, t.how, t.fits]);
  await page.click(".snap-turbo"); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, "87-turbo-sheet.png") });
  await page.click('.snap-turbo-sheet .snap-setup-card:has-text("kromoss_8step_dmd2")'); await page.waitForTimeout(600);
  const state = () => E(() => { const e = window.__snap.engine; return { rows: window.__M.rows("loras").map((r) => [r.file, r.strength, r.on]), steps: e.getValue("image", "image", "steps"), cfg: e.getValue("image", "image", "cfg"),
    sampler: e.getValue("image", "image", "sampler_name"), chip: document.querySelector(".snap-turbo")?.textContent, warn: [...document.querySelectorAll(".snap-warn")].map((x) => x.textContent) }; });
  R.turboOn = await state();
  R.agentStack = await call("add_lora", { file: "lodestones_moss_sft_8step_dmd_lora_latest.safetensors" });
  R.askedStack = await call("add_lora", { file: "lodestones_moss_sft_8step_dmd_lora_latest.safetensors", strength: 0.4, person_asked: true });
  R.stacked = await state();
  await page.screenshot({ path: path.join(out, "88-turbo-stack.png") });
  R.off = await call("set_method", { slot: "turbo", method: "off" });
  R.afterOff = await state();
  await call("ui", { action: "undo" }); await page.waitForTimeout(900);
  R.undoOff = await state();
  await call("set_method", { slot: "turbo", method: "off" });
  await call("remove_lora", { brick: "loras", row: 0 });
  // same family in place: prompt stays, the SFT card's patches come in
  await E(() => window.__snap.engine.setValue("image", "image", "prompt", "my own prompt"));
  R.sft = await call("apply_setup", { name: "MOSS-Image SFT DeBand (int8)" });
  R.sftState = await E(() => { const e = window.__snap.engine; return { bricks: e.state().bricks.map((b) => b.key), prompt: e.getValue("image", "image", "prompt"), unet: e.getValue("image_models", "unet", "unet_name"), expand: e.getValue("image", "image", "switch"),
    chain: (() => { const from = (n) => { const l = app.graph.getLink(n.inputs?.find((i) => i.name === "model")?.link); return l && app.graph.getNodeById(l.origin_id); }; const out = []; let n = e.nodeFor("image", "image"); while ((n = from(n))) out.push(n.type); return out; })() }; });
  R.sftTabs = await tabs();
  R.sftTurbos = (await call("list_methods", { slot: "turbo" })).methods.map((t) => [t.name, t.how]);
  await E(() => window.__snap.engine.setValue("image_models", "unet", "unet_name", "moss_image_sft_int8_convrot.safetensors"));
  R.plainSft = (await call("describe_recipe", {})).models.warnings;
  // the dial picker follows the family, with the strength note
  await call("ui", { action: "dials" }); await page.waitForTimeout(400);
  R.picker = { on: await page.textContent(".snap-dial-sheet .snap-seg button.on"), note: await page.textContent(".snap-dial-sheet header .snap-quiet") };
  await call("ui", { action: "close" });
  R.addDial = await call("add_dial", { dial: "dials/moss_day_night_hook.safetensors" });
  R.rackNote = await page.textContent(".snap-dial-scale").catch(() => null);
  // a style LoRA lands in a Style brick; an unsorted one asks what it is, once
  R.style = await call("add_lora", { file: "odd_thing_v3.safetensors", role: "style", strength: 0.7 });
  await page.waitForTimeout(500);
  R.ask = await page.$$eval('.snap-brick[data-brick="style"] .snap-lora-ask', (els) => els.length);
  await page.screenshot({ path: path.join(out, "89-style-ask.png") });
  await page.selectOption('.snap-brick[data-brick="style"] .snap-lora-ask', "style"); await page.waitForTimeout(800);
  R.asked = await page.$$eval('.snap-brick[data-brick="style"] .snap-lora-kind', (els) => els.map((e) => e.textContent));
  // Krea 2: new tab, fp8, the merge turbo swaps the checkpoint; warnings for a file core can't load and a wrong encoder type
  R.krea = await call("apply_setup", { name: "Krea 2 Raw (fp8)" });
  R.kreaState = await E(() => { const e = window.__snap.engine; return { dtype: e.getValue("image_models", "unet", "weight_dtype"), unet: e.getValue("image_models", "unet", "unet_name"), sampler: e.getValue("image", "image", "sampler_name"), sched: e.getValue("image", "image", "scheduler"), bricks: e.state().bricks.map((b) => b.key) }; });
  R.kreaTabs = await tabs();
  R.kreaTurbo = await call("set_method", { slot: "turbo", method: "krea2_turbo_fp8_scaled" });
  R.kreaTurboUnet = await E(() => window.__snap.engine.getValue("image_models", "unet", "unet_name"));
  R.kreaOff = await call("set_method", { slot: "turbo", method: "off" });
  R.kreaOffUnet = await E(() => window.__snap.engine.getValue("image_models", "unet", "unet_name"));
  await E(() => { const e = window.__snap.engine; e.setValue("image_models", "unet", "unet_name", "krea2/krea-2-raw-int8-convrot.safetensors"); e.setValue("image_models", "clip", "type", "stable_diffusion"); });
  await page.waitForTimeout(500);
  R.kreaWarn = (await call("describe_recipe", {})).models.warnings;
  R.kreaFace = await page.$$eval('.snap-brick[data-brick="image_models"] .snap-warn', (els) => els.map((e) => e.textContent));
  R.about = (await call("describe_recipe", {})).about;
  await page.screenshot({ path: path.join(out, "90-krea-warnings.png") });
  R.rail = await page.$$eval(".snap-tile", (els) => els.map((e) => e.textContent));
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_image_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e.message.split("\n")[0]); process.exit(1); });
