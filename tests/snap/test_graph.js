// The model graph (MODEL_GRAPH_ONBOARDING §1): pack entries from /mainodes/snap/models under the person's userdata
// snap/models.json (person wins, field by field); unknown files inferred from folder + name; "what is this?" answers
// remembered; agent answers (list_models, describe_recipe.models) carry kind / turbo / role. Never queues.
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
  R.graph = await page.evaluate(async () => {
    window.__M = await import("/extensions/ComfyUI-MAINodes/snap/models.js");
    window.__tools = await import("/extensions/ComfyUI-MAINodes/snap/tools.js");
    const M = window.__M; await M.load();
    const pick = (e) => e && { family: e.family, kind: e.kind, turbo: e.turbo, role: e.role ?? null, core: e.core ?? null, loads: e.loads_in_core, inferred: !!e.inferred };
    return { base: pick(M.entry("moss_image_base_int8_convrot.safetensors")), dmd2: pick(M.entry("lodestones_kromoss_8step_dmd2_lora.safetensors")),
      int8row: pick(M.entry("krea2/krea-2-raw-int8-convrot.safetensors")), merge: pick(M.entry("krea2/krea2_turbo_fp8_scaled.safetensors")),
      ref2va: M.entry("h3/pika_h3_flex_ref2va_comfy_bf16.safetensors").stacks_with, unknown: pick(M.entry("mystery_style_v2.safetensors")),
      dial: pick(M.entry("dials/moss_day_night_hook.safetensors")), inferredTurbo: pick(M.entry("some_moss_turbo_4steps_lora.safetensors")) };
  });
  // the person files the unknown one; a fresh graph load (as on a new page) keeps the answer
  R.taught = await page.evaluate(async () => { const M = window.__M; await M.teach("mystery_style_v2.safetensors", { role: "style", family: "MOSS-Image" }); return M.entry("mystery_style_v2.safetensors"); });
  await page.reload(); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2000);
  R.afterReload = await page.evaluate(async () => { const M = await import("/extensions/ComfyUI-MAINodes/snap/models.js"); await M.load(); const e = M.entry("mystery_style_v2.safetensors"); return { role: e.role, family: e.family, inferred: !!e.inferred }; });
  R.listModels = await page.evaluate(async () => { const t = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); return (await t.callTool("list_models", { folder: "loras", filter: "dmd2" })).files; });
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_graph_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e.message.split("\n")[0]); process.exit(1); });
