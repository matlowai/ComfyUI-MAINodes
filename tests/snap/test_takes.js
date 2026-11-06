// Takes end to end on the CPU server. This suite DOES run prompts (on purpose): a tiny EmptyImage -> SaveImage graph that
// executes on CPU with no models. Each Run becomes a take read from /history with its real output; the person ranks by
// drag, keeps / rejects, pins a note at a moment with a region, keeps a prior (it shows in the Library and restores the
// settings), judges a blind A/B; the export script then turns it into takes/notes/pairs rows.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  R.group = await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    app.graph.clear(); app.graph.extra = {};
    const img = LiteGraph.createNode("EmptyImage"); img.pos = [0, 0]; app.graph.add(img);
    const save = LiteGraph.createNode("SaveImage"); save.pos = [400, 0]; app.graph.add(save);
    img.connect(0, save, 0);
    snap.engine.adopt(); snap.toggle();
    return app.graph.id;
  });
  await page.waitForTimeout(900);
  const setColor = (c, w) => page.evaluate(([c, w]) => { const n = app.graph.nodes.find((x) => x.type === "EmptyImage"); n.widgets.find((x) => x.name === "color").value = c; n.widgets.find((x) => x.name === "width").value = w; }, [c, w]);
  for (const [c, w] of [[0xff3030, 256], [0x30ff30, 320], [0x3030ff, 384]]) {
    await setColor(c, w);
    await page.click(".snap-run");
    await page.waitForFunction((n) => window.__snap && document.querySelectorAll(".snap-take").length >= n, (await page.$$eval(".snap-take", (e) => e.length)) + 1, { timeout: 60000 });
    await page.waitForTimeout(400);
  }
  R.strip = await page.$$eval(".snap-take", (els) => els.map((e) => ({ id: e.dataset.take, caption: e.querySelector("figcaption").textContent, img: !!e.querySelector("img")?.src })));
  await page.screenshot({ path: path.join(out, "49-takes-strip.png") });
  const ids = R.strip.map((s) => s.id); // newest first: take 3, 2, 1
  // rank by drag: take 1 onto take 3 (first) -> ranked [1]; then take 3 onto take 1 -> [3, 1]
  const drag = (from, to) => page.dragAndDrop(`.snap-take[data-take="${from}"]`, `.snap-take[data-take="${to}"]`);
  await drag(ids[2], ids[0]); await page.waitForTimeout(400);
  await drag(ids[0], ids[2]); await page.waitForTimeout(400);
  R.rankingAfterDrags = await page.evaluate(async () => (await (await import("/extensions/ComfyUI-MAINodes/snap/takes.js")).ranking()));
  R.stripOrder = await page.$$eval(".snap-take", (els) => els.map((e) => [e.dataset.take, e.querySelector(".snap-take-rank").textContent]));
  // viewer: keep, a note with a region, prior
  await page.click(`.snap-take[data-take="${ids[0]}"] figcaption`); await page.waitForTimeout(600);
  await page.click(".snap-verdict.keep"); await page.waitForTimeout(300);
  await page.click('.snap-sentiment button:has-text("Went right")');
  await page.click('.snap-tag:has-text("composition")');
  await page.click('button:has-text("Mark region")');
  const st = await page.locator(".snap-take-stage").boundingBox();
  await page.mouse.move(st.x + st.width * 0.4, st.y + st.height * 0.3); await page.mouse.down(); await page.mouse.move(st.x + st.width * 0.6, st.y + st.height * 0.7, { steps: 5 }); await page.mouse.up();
  await page.fill(".snap-take-sheet .snap-note-input", "clean flat blue, centred");
  await page.click('.snap-take-sheet button:has-text("Add note")'); await page.waitForTimeout(400);
  await page.click('.snap-take-sheet button:has-text("Keep as a prior")'); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, "50-take-viewer.png") });
  R.viewerNotes = await page.$$eval(".snap-take-notes li", (els) => els.map((e) => e.textContent));
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  // reject take 2 from its viewer
  await page.click(`.snap-take[data-take="${ids[1]}"] figcaption`); await page.waitForTimeout(500);
  await page.click(".snap-verdict.reject"); await page.waitForTimeout(300); await page.keyboard.press("Escape");
  // blind A/B between takes 1 and 2
  await page.click(`.snap-take[data-take="${ids[1]}"] .snap-take-pick`); await page.click(`.snap-take[data-take="${ids[2]}"] .snap-take-pick`);
  await page.click('.snap-takes button:has-text("Compare")'); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, "51-compare.png") });
  R.compareCaptions = await page.$$eval(".snap-compare figcaption", (els) => els.map((e) => e.textContent));
  await page.fill(".snap-compare-pick .snap-lib-q", "the green reads better");
  await page.click('.snap-compare-pick button:has-text("A is better")'); await page.waitForTimeout(500);
  R.judgeToast = await page.textContent(".snap-toast");
  // the prior is in the Library and restores its settings
  await setColor(0x000000, 64);
  await page.fill(".snap-lib-q", "centred"); await page.waitForTimeout(200);
  R.libraryPrior = await page.$$eval(".snap-card", (els) => els.map((e) => ({ title: e.querySelector(".snap-card-title").textContent, thumb: !!e.querySelector(".snap-card-thumb") })));
  await page.click('.snap-card:has-text("Prior:")'); await page.waitForTimeout(500);
  R.priorToast = await page.textContent(".snap-toast");
  R.restored = await page.evaluate(() => { const n = app.graph.nodes.find((x) => x.type === "EmptyImage"); return { color: n.widgets.find((x) => x.name === "color").value, width: n.widgets.find((x) => x.name === "width").value }; });
  await page.evaluate(() => app.extensionManager.workflow.activeWorkflow.changeTracker.undo()); await page.waitForTimeout(500);
  R.afterUndo = await page.evaluate(() => app.graph.nodes.find((x) => x.type === "EmptyImage").widgets.find((x) => x.name === "width").value);
  // agent view of the same data
  const call = async (tool, args = {}) => (await (await fetch(`http://127.0.0.1:${CFG.port}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) })).json());
  R.agentList = (await call("list_takes")).result?.map((t) => [t.number, t.rank, t.verdict, t.prior, t.notes]);
  R.agentNote = (await call("note_take", { take: ids[1], t: 0, sentiment: "wrong", tags: ["color"], text: "green too saturated" })).result;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_takes_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
