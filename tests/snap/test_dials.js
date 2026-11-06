// Dials in Snap: an empty rack offers + Dial / Make a dial; the picker lists the installed dials (catalog with labels and
// strengths); picking one puts a two-sided slider on the rack brick; the slider writes the rack and the rack's own panel
// follows; "Make a dial" fills the Make Dial node and queues only that node (the POST is caught, never sent). Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const posted = []; await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { posted.push(JSON.parse(r.request().postData())); return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap; app.graph.clear(); app.graph.extra = {}; for (const k of ["models", "preset", "rack", "refs", "render"]) await snap.engine.snap(k); snap.toggle(); });
  await page.waitForTimeout(1500);
  R.empty = await page.evaluate(() => [...document.querySelectorAll('.snap-brick[data-brick="rack"] button')].map((x) => x.textContent));
  await page.click('.snap-brick[data-brick="rack"] button:has-text("+ Dial")'); await page.waitForTimeout(500);
  R.picker = await page.evaluate(() => ({ tiles: document.querySelectorAll(".snap-dial-tile").length, first: document.querySelector(".snap-dial-tile strong")?.textContent }));
  await page.click('.snap-dial-sheet .snap-seg button:has-text("All models")'); await page.waitForTimeout(200);
  R.pickerAll = await page.$$eval(".snap-dial-tile", (e) => e.length);
  await page.fill(".snap-dial-sheet .snap-lib-q", "zoomies"); await page.waitForTimeout(200);
  R.search = await page.$$eval(".snap-dial-tile strong", (e) => e.map((x) => x.textContent));
  await page.screenshot({ path: path.join(out, "54-dial-picker.png") });
  await page.click('.snap-dial-tile:has-text("frozen")'); await page.waitForTimeout(600);
  R.row = await page.evaluate(() => { const d = document.querySelector('.snap-brick[data-brick="rack"] .snap-dial'); return d && { name: d.querySelector(".snap-dial-name").textContent, ends: [...d.querySelectorAll(".snap-dial-ends span")].map((x) => x.textContent), value: d.querySelector(".snap-dial-v").textContent, bands: d.querySelector(".snap-dial-range").style.getPropertyValue("--bands").includes("hsl(150") }; });
  // move the slider: the rack widget and the rack's own panel both follow
  await page.evaluate(() => { const r = document.querySelector(".snap-dial-range"); r.value = "1.25"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); });
  await page.waitForTimeout(400);
  R.afterSlide = await page.evaluate(() => ({ widget: JSON.parse(window.__snap.engine.getValue("rack", "rack", "rack")).map((r) => [r.dial, r.strength]), panel: window.__snap.engine.nodeFor("rack", "rack").dialRack?.rows?.map((r) => r.strength) }));
  await page.screenshot({ path: path.join(out, "55-dial-on-rack.png") });
  // the Library's dial cards are the installed dials
  await page.click('.snap-brick[data-brick="rack"] .snap-name'); await page.waitForTimeout(300); await page.keyboard.press("Escape");
  R.libraryDials = await page.evaluate(() => ({ n: [...document.querySelectorAll(".snap-lib-results .snap-card")].filter((c) => c.querySelector(".snap-kind")?.textContent === "Dial").length, first: document.querySelector(".snap-lib-results .snap-card-title")?.textContent }));
  // make a dial: only the Make Dial node is queued
  await page.click('.snap-brick[data-brick="rack"] button:has-text("Make a dial")'); await page.waitForTimeout(400);
  await page.fill('.snap-dial-sheet input[placeholder="e.g. stands still"]', "calm sea");
  await page.fill('.snap-dial-sheet input[placeholder="e.g. runs"]', "stormy sea");
  const pair = page.locator(".snap-pair").first().locator("textarea");
  await pair.nth(0).fill("{subject} on a calm, glassy sea under a clear sky.");
  await pair.nth(1).fill("{subject} on a stormy sea, huge waves crashing under dark clouds.");
  await page.click('.snap-dial-sheet button:has-text("+ pair")');
  const pair2 = page.locator(".snap-pair").nth(1).locator("textarea");
  await pair2.nth(0).fill("A lighthouse beside a calm sea at dusk."); await pair2.nth(1).fill("A lighthouse beside a raging storm sea at dusk.");
  await page.screenshot({ path: path.join(out, "56-make-dial.png") });
  const nodes0 = await page.evaluate(() => app.graph.nodes.length);
  await page.click('.snap-dial-sheet button:has-text("Make dial")'); await page.waitForTimeout(2500);
  const body = posted.at(-1);
  const maker = body && Object.values(body.prompt).find((n) => n.class_type === "MAIDialMake");
  R.make = { posted: posted.length, targets: body?.partial_execution_targets, classes: body ? [...new Set(Object.values(body.prompt).map((n) => n.class_type))].sort() : null,
    pairs: maker?.inputs.pairs, name: maker?.inputs.name, labels: [maker?.inputs.negative_label, maker?.inputs.positive_label], useful: maker?.inputs.useful,
    nodeRemoved: (await page.evaluate(() => app.graph.nodes.length)) === nodes0, status: await page.textContent(".snap-dial-status") };
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_dials_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
