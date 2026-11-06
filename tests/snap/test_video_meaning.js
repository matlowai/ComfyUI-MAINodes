// A real H3 render as a take (a copy of output/relayvsr_test/e2e_refs3_00001_.mp4, 1280x704, 5.9 s, recorded in the shape
// /history gives for it on :8190): it plays in the viewer, takes a note on a video frame with a region, and its last frame
// becomes the First frame. Library search by meaning (EmbeddingGemma 2 sidecar) finds Kon for "fox". Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => r.request().method() === "POST" ? (q++, r.abort()) : r.continue());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  const id = await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    const T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js"); await T.load();
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "first_frame", "refs", "render"]) await snap.engine.snap(k);
    const take = { id: `take-video-${Date.now()}`, kind: "run", prompt_id: "e3149d44", created: Date.now() - 60000, finished: Date.now(), seconds: 95.2, group: app.graph.id, workflow: "Dials Simple", number: 1,
      status: "success", text: "integrated_multimodal_description: three references land in the render", seed: 42,
      media: [{ kind: "video", filename: "e2e_refs3_00001_.mp4", subfolder: "relayvsr_test", type: "output", node: "172:139" }], verdict: null, prior: false, notes: [], graph: null, prompt: {} };
    await T.save(take);
    snap.toggle();
    return take.id;
  });
  await page.waitForTimeout(1200);
  R.stripVideo = await page.evaluate((id) => { const v = document.querySelector(`.snap-take[data-take="${id}"] video`); return v && { src: v.src.includes("e2e_refs3"), ready: v.readyState }; }, id);
  await page.click(`.snap-take[data-take="${id}"] figcaption`);
  await page.waitForFunction(() => document.querySelector(".snap-take-stage video")?.readyState >= 2, null, { timeout: 20000 });
  R.player = await page.evaluate(() => { const v = document.querySelector(".snap-take-stage video"); return { duration: Math.round(v.duration * 100) / 100, w: v.videoWidth, h: v.videoHeight }; });
  await page.evaluate(() => { const v = document.querySelector(".snap-take-stage video"); v.currentTime = 3.5; });
  await page.waitForTimeout(600);
  await page.keyboard.press("."); await page.waitForTimeout(300);
  R.afterStep = await page.evaluate(() => Math.round(document.querySelector(".snap-take-stage video").currentTime * 1000) / 1000);
  await page.click('.snap-tag:has-text("hands")');
  await page.click('button:has-text("Mark region")');
  const st = await page.locator(".snap-take-stage").boundingBox();
  await page.mouse.move(st.x + st.width * 0.45, st.y + st.height * 0.4); await page.mouse.down(); await page.mouse.move(st.x + st.width * 0.6, st.y + st.height * 0.65, { steps: 5 }); await page.mouse.up();
  R.regionShown = await page.textContent(".snap-take-noteline");
  R.overlay = await page.evaluate(() => { const o = document.querySelector(".snap-take-overlay"); const at = document.elementFromPoint(o.getBoundingClientRect().x + 200, o.getBoundingClientRect().y + 200); return { cls: o.className, w: o.width, top: at?.tagName + "." + at?.className }; });
  await page.fill(".snap-take-sheet .snap-note-input", "left hand smears into the cup");
  await page.click('.snap-take-sheet button:has-text("Add note")'); await page.waitForTimeout(500);
  R.note = await page.evaluate(async (id) => { const T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js"); const n = T.get(id).notes[0]; return { t: n.t, region: n.region?.map((x) => Math.round(x * 100) / 100), tags: n.tags, sentiment: n.sentiment }; }, id);
  R.marker = await page.locator(".snap-take-markers i").count();
  await page.screenshot({ path: path.join(out, "52-video-take.png") });
  await page.click('button:has-text("Continue from its last frame")'); await page.waitForTimeout(3000);
  R.continue = { toast: await page.textContent(".snap-toast"), firstFrame: await page.evaluate(() => window.__snap.engine.getValue("first_frame", "image", "image")) };
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  // Library by meaning: "fox" (the Kon card says fennec), scoped to Render
  await page.click('.snap-brick[data-brick="render"] .snap-name'); await page.waitForTimeout(300); // stays selected: the search is scoped to Render
  await page.fill(".snap-lib-q", "fox");
  await page.waitForFunction(() => document.querySelector(".snap-lib-results.by-meaning"), null, { timeout: 30000 }).catch(() => {});
  R.meaning = await page.evaluate(() => ({ byMeaning: document.querySelector(".snap-lib-results").classList.contains("by-meaning"), first: document.querySelector(".snap-lib-results .snap-card-title")?.textContent }));
  await page.screenshot({ path: path.join(out, "53-library-meaning.png") });
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_video_meaning_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
