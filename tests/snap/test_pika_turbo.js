// Pika is a turbo (the operator 2026-11-04: "pika is turbo"), on the fake shelf of the CPU server (shelf.js, plus two more H3
// turbo LoRAs): the Pika H3 Flex LoRAs are core·turbo in the model graph with the numbers the Pika setups run (6 steps,
// lcm, cfg 1, Pika's manual knots), so describe_recipe's models.turbo and the Setup card name the Pika LoRA, not none.
// list_methods {slot: turbo} lists H3's turbos (it was empty: H3's LoRA lives on the Render Preset, not a Core LoRAs
// stack), the ones for this base variant first (ref2v vs fl2v), the others labelled "made for …", none hidden; set_method
// swaps the preset's LoRA and its sampling (DMAD: simple schedule; back to Pika: manual with Pika's knots); a second
// turbo stacked on top warns, never blocks. U90(2): a swap carries every sampling setting the turbo was made for, the
// shifts too (DMAD: audio 2; Pika: 12 / 3). Never queues. Screenshot: ui/283-pika-turbo-setup.png.
// usage: node test_pika_turbo.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = { queued: 0 };
const REF_ACC = "h3/MiniMax-H3-Ref2VA-Acc-8Step_comfy.safetensors", FL_LX = "h3/minimax_h3_fl2v_lightx2v_turbo_4step_v1.0_768p_resized_avg_rank_31_bf16.safetensors";
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await useShelf(page, { extra: { loras: [[REF_ACC, 0.6], [FL_LX, 0.4]] } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/mainodes\/snap\/register$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"tools":0}' }));
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { R.queued++; return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => { app.graph.clear(); app.graph.extra = {}; window.__X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); });
  const call = (name, args = {}) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  const look = async () => {
    const d = await call("describe_recipe");
    const preset = d.bricks?.find((x) => x.id === "preset")?.settings ?? [];
    const v = (n) => preset.find((s) => s.name === n)?.value;
    const m = await call("list_methods", { slot: "turbo" });
    return { turbo: d.models?.turbo ?? null, lora: v("lora"), steps: v("steps"), sampler: v("sampler"), schedule: v("schedule"), sigmas: v("sigmas"), shifts: [v("shift_video"), v("shift_audio")], warnings: d.models?.warnings ?? [],
      methods: (m.methods ?? []).map((x) => [x.title, x.does, x.current]), current: m.current ?? null, chip: await page.$$eval(".snap-turbo", (els) => els.map((e) => e.textContent)) };
  };
  await call("start_recipe"); await call("apply_setup", { name: "Pika H3 Flex" }); await page.waitForTimeout(800);
  R.fl2v = await look();
  await call("apply_setup", { name: "Pika + reference pictures" }); await page.waitForTimeout(800);
  R.ref2v = await look();
  await call("ui", { action: "close" }); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, "283-pika-turbo-setup.png") });
  R.toDmad = await call("set_method", { slot: "turbo", method: "minimax_h3_DMAD_4step_full_lora_avg_rank_39_bf16" });
  R.dmad = await look();
  R.toPika = await call("set_method", { slot: "turbo", method: "pika_h3_flex_ref2va_comfy_bf16" });
  R.back = await look();
  // a second turbo on top: a Core LoRAs stack with a turbo row, as a person who asked for it would add it
  await call("snap", { brick: "loras" });
  R.stack = await call("add_lora", { file: REF_ACC, person_asked: true });
  R.stacked = await look();
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_pika_turbo_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
