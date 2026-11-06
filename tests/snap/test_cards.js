// U24 card numbers (MOSS defaults measured 2026-11-04) on a fake model shelf: MOSS Base = ER-SDE 25 with the expander
// on and its caveat in `about` (no 50-step hedge); Kromoss = ER-SDE 25 + SLG 22, and its text-heavy option is a second
// same-family setup (Euler 50) that applies in place and keeps the SLG patch; the model graph's recommended sampling
// matches. Never queues.
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
    snap.toggle();
  });
  const call = (name, args) => page.evaluate(([n, a]) => window.__tools.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  const now = () => page.evaluate(() => { const e = window.__snap.engine; return { bricks: e.state().bricks.map((b) => b.key), setup: e.state().setup, sampler: e.getValue("image", "image", "sampler_name"), steps: e.getValue("image", "image", "steps"), expand: e.getValue("image", "image", "switch"), tabs: app.extensionManager.workflow.openWorkflows.length }; });
  const setups = await call("list_setups", {});
  const card = (name) => setups.find((s) => s.name === name);
  R.base = card("MOSS-Image Base (int8)"); R.kromoss = card("Kromoss (int8)"); R.text = card("Kromoss text-heavy (Euler 50)"); R.sft = card("MOSS-Image SFT DeBand (int8)");
  await call("apply_setup", { name: "MOSS-Image Base (int8)" }); await page.waitForTimeout(1500);
  R.baseApplied = await now();
  await call("apply_setup", { name: "Kromoss (int8)" }); await page.waitForTimeout(1200);
  R.kromossApplied = await now();
  await call("apply_setup", { name: "Kromoss text-heavy (Euler 50)" }); await page.waitForTimeout(1200);
  R.textApplied = await now();
  await call("ui", { action: "setups" }); await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "105-setups-moss-cards.png") });
  R.graph = await page.evaluate(async () => { await window.__M.load(); return ["moss_image_base_int8_convrot.safetensors", "kromoss_int8_convrot.safetensors"].map((f) => window.__M.entry(f).recommended); });
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_cards_result.json"), JSON.stringify(R, null, 1));
  await b.close();
})();
