// Ghost bricks: agent calls with propose: true (through the real /mainodes/snap bridge) wait for the person; accept by
// click, reject by keyboard, accept all; list_proposals reports the answers. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
const call = async (tool, args) => (await (await fetch(`http://127.0.0.1:${CFG.port}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) })).json());
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "render"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(900);
  const keys = () => page.evaluate(() => window.__snap.engine.state().bricks.map((x) => x.key));
  R.p1 = await call("snap", { brick: "rack", after: "preset", propose: true, reason: "the recipe has no dials yet" });
  R.p2 = await call("set_setting", { brick: "render", name: "length", value: 97, propose: true, reason: "4 s is enough for this beat" });
  R.p3 = await call("apply_card", { card: "char-kon", propose: true, reason: "the scene is about Kon" });
  await page.waitForTimeout(500);
  R.ghostAfterPreset = await page.evaluate(() => document.querySelector('[data-brick="models"]')?.nextElementSibling?.classList.contains("snap-ghost-brick"));
  R.chipsOnRender = await page.locator('[data-brick="render"] .snap-proposal').count();
  R.pill = await page.textContent(".snap-proposals span");
  R.nothingChangedYet = { bricks: await keys(), length: await page.evaluate(() => window.__snap.engine.getValue("render", "render", "length")) };
  await page.screenshot({ path: path.join(out, "24-proposals.png") });
  await page.click(".snap-ghost-brick .snap-accept"); await page.waitForTimeout(800);
  R.afterAccept = await keys();
  R.rackBound = await page.evaluate(() => window.__snap.engine.describe().find((x) => x.brick === "render").bindings.find((x) => x.role === "model")?.from);
  await page.locator('.snap-proposal:has-text("length")').focus(); await page.keyboard.press("Backspace"); await page.waitForTimeout(500);
  R.lengthAfterReject = await page.evaluate(() => window.__snap.engine.getValue("render", "render", "length"));
  await page.click("text=Accept all"); await page.waitForTimeout(800);
  R.konInPrompt = await page.evaluate(() => window.__snap.engine.getValue("render", "render", "prompt").includes("fennec-eared"));
  R.pillHidden = await page.evaluate(() => getComputedStyle(document.querySelector(".snap-proposals")).display === "none");
  R.libForHiddenWhenNothingSelected = await page.evaluate(() => { window.__snap.view.select(null); return getComputedStyle(document.querySelector(".snap-lib-for")).display === "none"; });
  R.list = (await call("list_proposals", {})).result.map((p) => `${p.tool}:${p.status}`);
  await page.waitForTimeout(500);
  R.crew = (await call("crew_report", {})).result;
  R.readOnlyIgnoresPropose = (await call("describe_recipe", { propose: true })).result?.bricks?.length;
  await page.screenshot({ path: path.join(out, "25-after-proposals.png") });
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_proposals_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
