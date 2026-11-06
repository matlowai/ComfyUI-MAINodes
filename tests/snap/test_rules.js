// Remembered picks: answer "which one?" once; a second VAE Decode binds itself the same way, and so does a fresh
// graph in a new page (the rule lives in ComfyUI userdata). Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
async function open(b) {
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap; app.graph.clear(); app.graph.extra = {}; });
  return page;
}
const vae = (page, key) => page.evaluate((k) => window.__snap.engine.describe().find((x) => x.brick === k)?.bindings.find((x) => x.role === "vae"), key);
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  let page = await open(b);
  await page.evaluate(async () => { const E = window.__snap.engine; for (const k of ["models", "node:VAEDecode"]) await E.snap(k); window.__snap.toggle(); });
  await page.waitForTimeout(900);
  R.first = (await vae(page, "node:VAEDecode#1"))?.rule;
  await page.click('[data-brick="node:VAEDecode#1"] .snap-choice:has-text("audio vae")'); await page.waitForTimeout(600);
  R.saved = await page.evaluate(async () => (await (await window.comfyAPI.api.api.getUserData("snap/rules.json")).json()));
  await page.evaluate(() => window.__snap.engine.snap("node:VAEDecode")); await page.waitForTimeout(400);
  R.second = await vae(page, "node:VAEDecode#2");
  R.secondChip = await page.textContent('[data-brick="node:VAEDecode#2"] .snap-binds');
  R.errorsA = page.errs;
  await page.context().close();
  page = await open(b); // a new page: the rule comes from userdata
  await page.waitForTimeout(500);
  await page.evaluate(async () => { const E = window.__snap.engine; for (const k of ["models", "node:VAEDecode"]) await E.snap(k); });
  R.freshPage = await vae(page, "node:VAEDecode#1");
  R.errorsB = page.errs;
  R.queueAttempts = globalThis.__queued || 0;
  fs.writeFileSync(path.join(out, "test_rules_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
