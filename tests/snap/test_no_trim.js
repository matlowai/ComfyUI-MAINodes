// SNAP-R58 (the operator 2026-11-04: "no limit ever"): results are never trimmed. On the CPU server's fake shelf (shelf.js) with
// 250 more LoRA files: list_loras and list_models {folder: loras} return every file and say the same count, and the
// Render Preset's LoRA setting in describe_recipe lists every choice (it was cut to 50, the lists to 200). Never queues.
// usage: node test_no_trim.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = { queued: 0 };
const MANY = Array.from({ length: 250 }, (_, i) => [`notrim/notrim_style_${String(i).padStart(3, "0")}.safetensors`, 0.1]);
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await useShelf(page, { extra: { loras: MANY } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/mainodes\/snap\/register$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"tools":0}' }));
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { R.queued++; return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => { app.graph.clear(); app.graph.extra = {}; window.__X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); });
  const call = (name, args = {}) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  const loras = await call("list_loras", { filter: "notrim" });
  R.loras = { count: loras.count, returned: loras.loras?.length };
  const models = await call("list_models", { folder: "loras", filter: "notrim" });
  R.models = { count: models.count, returned: models.files?.length };
  await call("start_recipe");
  const d = await call("describe_recipe");
  const lora = d.bricks?.find((x) => x.id === "preset")?.settings?.find((s) => s.name === "lora");
  R.choices = { returned: lora?.choices?.length ?? null, notrim: (lora?.choices ?? []).filter((c) => String(c).startsWith("notrim/")).length, more: (lora?.choices ?? []).some((c) => /more$/.test(String(c))) };
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_no_trim_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
