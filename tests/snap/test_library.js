// Snap Library: slot-aware scope, click and drag cards onto bricks, wrong-brick drop, scene composition, reasons, undo.
const { chromium } = require("playwright"); const fs=require("fs"),path=require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async()=>{const b=await chromium.launch({executablePath:CFG.chrome,headless:true}); const page=await (await b.newContext({viewport:{width:1600,height:1000}})).newPage();
await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/,r=>r.abort()); const errs=[]; page.on("pageerror",e=>errs.push(e.message));
await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(()=>window.app?.extensionManager?.workflow?.activeWorkflow,null,{timeout:90000}); await page.waitForTimeout(2000);
await page.evaluate(async()=>{ const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap=snap; app.graph.clear(); app.graph.extra={};
  for (const k of ["models","preset","rack","first_frame","refs","render","upscale","save_video"]) await snap.engine.snap(k); snap.toggle(); });
await page.waitForTimeout(900);
const titles = () => page.$$eval(".snap-lib-results .snap-card-title", (els) => els.map((e) => e.textContent));
const toast = () => page.textContent(".snap-toast");
const prompt = () => page.evaluate(() => window.__snap.engine.getValue("render", "render", "prompt").split("\n")[0]);
await page.click('.snap-brick[data-brick="rack"] .snap-name'); await page.waitForTimeout(200);
R.rackScope = { for: await page.textContent(".snap-lib-for"), cards: await titles() };
await page.click('.snap-card:has-text("h3_motion")'); await page.waitForTimeout(400);
R.dialApplied = { toast: await toast(), rows: await page.evaluate(() => JSON.parse(window.__snap.engine.getValue("rack", "rack", "rack")).map((r) => `${r.dial} ${r.strength}`)), chips: await page.$$eval('.snap-brick[data-brick="rack"] .snap-dial', (e) => e.map((x) => `${x.querySelector(".snap-dial-name").textContent} ${x.querySelector(".snap-dial-v").textContent}`)) };
await page.click('.snap-brick[data-brick="render"] .snap-name'); await page.waitForTimeout(200);
R.renderScope = (await titles()).length;
await page.fill(".snap-lib-q", "fox"); await page.waitForTimeout(150);
R.foxSearch = await titles(); // keyword search: "fox" is not in the card (it says fennec); the embedder found it
 await page.fill(".snap-lib-q", "fennec"); await page.waitForTimeout(150); await page.waitForFunction(() => document.querySelector(".snap-lib-results.by-meaning"), null, { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(200); R.fennecSearch = await titles();
// drag Kon onto Models first (wrong brick: nothing happens), then onto Render
const card = await page.locator('.snap-card:has-text("Kon")').first().boundingBox();
const drag = async (to) => { await page.mouse.move(card.x + 40, card.y + 10); await page.mouse.down(); for (let i = 1; i <= 15; i++) await page.mouse.move(card.x + 40 + (to.x - card.x - 40) * i / 15, card.y + 10 + (to.y - card.y - 10) * i / 15); await page.waitForTimeout(120); };
const p0 = await prompt();
const models = await page.locator('.snap-brick[data-brick="models"]').boundingBox();
await drag({ x: models.x + models.width / 2, y: models.y + 30 }); R.wrongTargetLit = await page.locator(".snap-target").count(); await page.mouse.up(); await page.waitForTimeout(700);
R.wrongDropChanged = (await prompt()) !== p0;
const render = await page.locator('.snap-brick[data-brick="render"]').boundingBox();
await drag({ x: render.x + render.width / 2, y: render.y + 40 }); R.rightTargetLit = await page.locator(".snap-target").count();
await page.screenshot({ path: path.join(out, "16-card-drag.png") });
await page.mouse.up(); await page.waitForTimeout(800);
R.kon = { toast: await toast(), promptHasKon: (await prompt()).includes("fennec-eared") };
await page.fill(".snap-lib-q", "leaps"); await page.waitForTimeout(150);
await page.click('.snap-card:has-text("Kon leaps")'); await page.waitForTimeout(400);
R.scene = { toast: await toast(), prompt: (await prompt()).slice(-300), konTimes: (await prompt()).split("fennec-eared").length - 1 };
await page.fill(".snap-lib-q", "timing"); await page.waitForTimeout(150);
await page.click('.snap-card:has-text("Timing")'); await page.waitForTimeout(300);
R.noCue = await toast();
await page.click('.snap-brick[data-brick="models"] .snap-name'); await page.fill(".snap-lib-q", ""); await page.waitForTimeout(150);
R.presetScope = await titles();
await page.click('.snap-card:has-text("Pika")'); await page.waitForTimeout(300);
R.lora = await toast();
await page.screenshot({ path: path.join(out, "17-library.png") });
// set snapshot: plan + elevation into References, set block into the prompt
await page.click('.snap-brick[data-brick="refs"] .snap-name'); await page.fill(".snap-lib-q", ""); await page.waitForTimeout(150);
R.refsScope = await titles();
await page.click('.snap-card:has-text("lamp room, end of shot 3")'); await page.waitForTimeout(1500);
R.set = await page.evaluate(async () => {
  const E = window.__snap.engine, b = E.state().bricks.find((x) => x.key === "refs");
  const { output } = await app.graphToPrompt();
  const refs = Object.values(output).find((v) => v.class_type === "H3References");
  return { pictures: b.pictures.map((p) => `${p.role}: ${p.file}`), refInputs: Object.entries(refs.inputs).map(([k, v]) => `${k}<-${output[v[0]]?.class_type}:${output[v[0]]?.inputs.image}`),
    thumbs: [...document.querySelectorAll(".snap-pics img")].map((i) => i.complete && i.naturalWidth), meter: document.querySelector(".snap-meter em")?.textContent,
    promptHasBlock: E.getValue("render", "render", "prompt").includes("Exactly these 4 objects and nothing else") };
});
R.setToast = await toast();
await page.screenshot({ path: path.join(out, "20-set-snapshot.png") });
const before = await prompt();
await page.evaluate(() => app.extensionManager.workflow.activeWorkflow.changeTracker.undo()); await page.waitForTimeout(500);
R.undoReverted = (await prompt()) !== before;
R.errors = errs;
fs.writeFileSync(path.join(out, "test_library_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();})().catch(e=>{console.error(e);process.exit(1);});
