// U52 camera plates (SNAP-R21/R22) on the CPU server: doors and windows said from each camera; the orbit pass's prompts and
// plate provenance (renders faked: /prompt and /history answered by the test, the plate picture is a real upload); the
// shot compiler's picture choice (plate, wide plate, first frame, none, a plate whose camera moved); the copy check on
// fixture images through the real MAISnapCopyScore node and DINOv3 on CPU (the only prompts this suite queues).
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
const HOST = `http://127.0.0.1:${CFG.port}`;
const call = async (tool, args = {}) => (await (await fetch(`${HOST}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) })).json());
const FIX = { plate: CFG.fixture("u21/plate.png"), copy: CFG.fixture("u49/pool/u21b_S1_20261111_f106.png"), view: CFG.fixture("u49/pool/orbit_S1_20261123_f106.png") };
async function upload(file, name) {
  const form = new FormData();
  form.append("image", new Blob([fs.readFileSync(file)], { type: "image/png" }), name);
  form.append("subfolder", "snaptest"); form.append("overwrite", "true");
  const r = await (await fetch(`${HOST}/upload/image`, { method: "POST", body: form })).json();
  return `${r.subfolder}/${r.name}`;
}
(async () => {
  const files = { plate: await upload(FIX.plate, "u21_plate.png"), copy: await upload(FIX.copy, "copy_f106.png"), view: await upload(FIX.view, "newview_f106.png") };
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  // orbit renders are answered here (fake ids); the copy check's small CPU prompts go through; anything else is refused
  const orbit = [];
  let queuedReal = 0, refused = 0;
  await page.route(/\/(api\/)?prompt$/, (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const body = JSON.parse(r.request().postData()), types = Object.values(body.prompt).map((n) => n.class_type);
    if (types.includes("H3ReferenceToVideoRefs")) { orbit.push(body); return r.fulfill({ json: { prompt_id: `fake-orbit-${orbit.length}`, number: orbit.length, node_errors: {} } }); }
    if (types.includes("MAISnapCopyScore")) { queuedReal++; return r.continue(); }
    refused++; return r.abort();
  });
  // the H3 files the orbit names, as a GPU machine lists them (the CPU server has none)
  const SHELF = { "MAIRenderPreset.model": "h3/minimax_h3_ref2va_pruned_int8_convrot.safetensors", "MAIRenderPreset.lora": "h3/pika_h3_flex_ref2va_comfy_bf16.safetensors",
    "CLIPLoader.clip_name": "h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "VAELoader.vae_name": ["h3/minimax_h3_video_vae_fp16.safetensors", "h3/minimax_h3_audio_vae_fp32.safetensors"] };
  await page.route(/\/api\/object_info\/(MAIRenderPreset|CLIPLoader|VAELoader)$/, async (r) => {
    const res = await r.fetch(), info = await res.json(), [type, spec] = Object.entries(info)[0];
    for (const [k, v] of Object.entries(SHELF)) if (k.startsWith(`${type}.`)) { const x = spec.input.required[k.split(".")[1]]; const add = [v].flat(); if (Array.isArray(x[0])) x[0].push(...add); else x[1].options = [...(x[1].options ?? []), ...add]; }
    r.fulfill({ response: res, json: info });
  });
  const fakeHistory = {};
  // a fake render with no history yet waits in the queue (a candidate the server has no record of counts as failed)
  await page.route(/\/api\/queue$/, async (r) => {
    if (r.request().method() !== "GET") return r.continue();
    const res = await r.fetch(), q = await res.json(), waiting = orbit.map((_, i) => `fake-orbit-${i + 1}`).filter((id) => !fakeHistory[id]);
    r.fulfill({ response: res, json: { ...q, queue_pending: [...q.queue_pending, ...waiting.map((id, i) => [100 + i, id, {}, {}, []])] } });
  });
  await page.route(/\/(api\/)?history\/fake-orbit-\d+$/, (r) => { const id = r.request().url().split("/").pop(); return r.fulfill({ json: fakeHistory[id] ? { [id]: fakeHistory[id] } : {} }); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${HOST}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    window.__L = await import("/extensions/ComfyUI-MAINodes/snap/library.js");
    window.__P = await import("/extensions/ComfyUI-MAINodes/snap/plates.js");
    window.__G = await import("/extensions/ComfyUI-MAINodes/snap/setsnap.js");
    window.__T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
    window.__C = await import("/extensions/ComfyUI-MAINodes/snap/candidates.js");
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "first_frame", "refs", "render"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(900);

  // 1. doors and windows from the plan, per camera (the U21 cameras S1 / S2 / S3)
  R.openings = await page.evaluate(async () => {
    await __L.ready();
    const s = __L.get("set-lamp-room-end-s3").brick.snapshot, at = (c) => __G.atCamera(s, c);
    const cams = { S1: { at: [-2, -2], facing: 35, lens: 24 }, S2: { at: [2, 2], facing: 215, lens: 24 }, S3: { at: [2.2, 0.2], facing: 270, lens: 24 } };
    return { ...Object.fromEntries(Object.entries(cams).map(([k, c]) => [k, __G.openings(at(c))])), walls: s.room.openings.map((o) => __G.wallOf(s, o)), block: __G.setBlock(at(cams.S3)), cameras: __G.plateCameras(s).map((c) => c.name) };
  });

  // 2. the orbit pass: wide plate by hand, an agent's make waits as a proposal, the person's runs; renders answered here
  R.wide = (await call("set_set_plate", { set: "set-lamp-room-end-s3", camera: "wide", image: files.plate })).result;
  R.agentMake = (await call("make_set_plates", { set: "set-lamp-room-end-s3", cameras: ["master"] })).result;
  R.made = await page.evaluate(() => __P.make("set-lamp-room-end-s3", { cameras: ["OTS on Ferro", "master"], count: 1, by: "person" }));
  R.orbitPrompts = orbit.map((o) => ({ text: Object.values(o.prompt).find((n) => n.class_type === "H3ReferenceToVideoRefs").inputs.prompt, wide: Object.values(o.prompt).find((n) => n.class_type === "LoadImage").inputs.image,
    preset: Object.values(o.prompt).find((n) => n.class_type === "MAIRenderPreset").inputs, group: o.extra_data.extra_pnginfo.workflow.id, score: Object.values(o.prompt).some((n) => n.class_type === "MAISnapCopyScore") }));
  R.pendingStatus = (await call("set_plates", { set: "set-lamp-room-end-s3" })).result.cameras.filter((c) => c.candidates?.rendering).map((c) => c.camera);
  // master's render moved the camera (its last frame scores 0.58 against the wide plate); OTS on Ferro's copied it (0.90)
  const scores = (last) => [last];
  for (const { camera, prompt_id } of R.made.queued) { const kept = camera === "master"; fakeHistory[prompt_id] = { status: { status_str: "success", completed: true, messages: [] }, prompt: [1, prompt_id, {}, {}],
    outputs: { 16: { images: [{ filename: "x.mp4", subfolder: "video", type: "output" }] }, 18: { images: [{ filename: kept ? "newview_f106.png" : "copy_f106.png", subfolder: "snaptest", type: "input" }] }, 20: { copy_scores: scores(kept ? 0.5822 : 0.8969) } } }; }
  await page.evaluate(() => __C.settle());
  // both renders are candidates now (a copy is marked, not rejected: U55); the person picks master's
  R.ferro = await page.evaluate(() => __C.describe(__C.about("plate", "set-lamp-room-end-s3/OTS on Ferro")));
  await page.evaluate(() => __C.apply(__C.about("plate", "set-lamp-room-end-s3/master").id, "c1", "person"));
  R.status = (await call("set_plates", { set: "set-lamp-room-end-s3" })).result;

  // the set editor shows doors and windows and the plates
  await page.click('.snap-brick[data-brick="refs"] .snap-name'); await page.waitForTimeout(200);
  await page.click('.snap-card:has-text("lamp room") .snap-edit[title^="open the set plan"] >> nth=0'); await page.waitForTimeout(1200);
  R.editor = await page.evaluate(() => ({ doors: [...document.querySelectorAll(".snap-set-door")].map((d) => [...d.querySelectorAll("select")].map((x) => x.value).concat(d.querySelector("input").value)),
    tiles: [...document.querySelectorAll(".snap-set-plate")].map((f) => [f.querySelector("b").textContent, f.querySelector("figcaption span").textContent, !!f.querySelector("img") && !f.querySelector("img").hidden]),
    make: document.querySelector(".snap-set-plates + .snap-set-actions .snap-primary")?.textContent, block: document.querySelector(".snap-set-block").textContent }));
  await page.screenshot({ path: path.join(out, "99-u52-set-editor-plates.png") });
  // drag the door along the south wall onto the east wall: the list follows the plan
  const px = (w) => page.evaluate((w) => { const c = document.querySelector(".snap-set-plan"), r = c.getBoundingClientRect(), f = __G.planFrame(__L.get("set-lamp-room-end-s3").brick.snapshot);
    return [r.left + (f.X(w[0]) / c.width) * r.width, r.top + (f.Y(w[1]) / c.height) * r.height]; }, w);
  const [dx, dy] = await px([0, -2.5]), [ex, ey] = await px([2.3, -1.6]);
  await page.mouse.move(dx, dy); await page.mouse.down(); await page.mouse.move((dx + ex) / 2, (dy + ey) / 2, { steps: 4 }); await page.mouse.move(ex, ey, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(300);
  R.doorDrag = await page.evaluate(() => ({ wall: document.querySelectorAll(".snap-set-door select")[1].value, block: document.querySelector(".snap-set-block").textContent }));
  await page.screenshot({ path: path.join(out, "99-u52-door-dragged.png") });
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  // 3. the shot compiler's picture: plate (Ref2V, preset switched), wide plate, first frame, nothing, a moved camera
  R.compiled = (await call("compile_shot", { card: "shot-letter" })).result;
  R.presetBefore = await page.evaluate(() => __snap.engine.getValue("preset", "preset", "conditioning"));
  R.applied = (await call("apply_card", { card: "shot-letter" })).result;
  R.after = await page.evaluate(() => { const E = __snap.engine; return { conditioning: E.getValue("preset", "preset", "conditioning"), pictures: (E.state().bricks.find((x) => x.key === "refs").pictures ?? []).map((p) => [p.role, p.file]),
    first: E.getValue("render", "render", "prompt").split("\n")[0], parts: E.state().bricks.find((x) => x.key === "render").shot.parts.map((x) => x.field) }; });
  await page.click('.snap-brick[data-brick="render"] .snap-name'); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, "99-u52-shot-with-plate.png") });
  R.choices = await page.evaluate(async () => {
    const shot = __L.get("shot-letter"), mk = async (id, patch) => { await __L.save({ ...structuredClone(shot), id, example: false, brick: { ...shot.brick, ...patch } }); return __L.compile(__L.get(id)); };
    const pick = (c) => c.picture && { use: c.picture.use, image: c.picture.image, ref: c.parts.find((p) => p.field === "reference")?.text ?? null };
    const master = pick(await mk("shot-test-master", { setup: "master" }));
    master.done = await __L.apply(__L.get("shot-test-master")); // the plate takes the wide plate's slot: still <Picture 1>
    master.pictures = (__snap.engine.state().bricks.find((x) => x.key === "refs").pictures ?? []).map((p) => [p.role, p.file]);
    const exact = pick(await mk("shot-test-exact", { setup: "master", start: "exact" }));
    exact.done = await __L.apply(__L.get("shot-test-exact"));
    exact.firstFrame = __snap.engine.getValue("first_frame", "image", "image"); exact.conditioning = __snap.engine.getValue("preset", "preset", "conditioning");
    // the set's own camera gets a plate by hand; then the camera moves half a metre and the plate stops counting
    const hand = await __P.setPlate("set-lamp-room-end-s3", "set camera", "snaptest/newview_f106.png");
    const own = pick(await mk("shot-test-own", { setup: undefined }));
    const card = __L.get("set-lamp-room-end-s3-mine"), s = structuredClone(card.brick.snapshot);
    s.camera.at = [s.camera.at[0] + 0.5, s.camera.at[1]];
    await __L.save(__L.version(card, s, true));
    const moved = { ...pick(__L.compile(__L.get("shot-test-own"))), fits: __P.status(__L.get("set-lamp-room-end-s3-mine")).cameras.find((c) => c.camera === "set camera").fits };
    await __P.setPlate("set-lamp-room-end-s3", "wide", null);
    const none = __L.compile(__L.get("shot-test-own"));
    return { master, exact, hand: { by: hand.by, copy_score: hand.copy_score }, own, moved, none: none.picture, noneRef: none.parts.some((p) => p.field === "reference") };
  });

  // 4. the copy check on fixture images: a take that re-rendered the plate's view, one that shows a new view
  R.copy = await page.evaluate(async ({ files }) => {
    await __T.load();
    const mk = async (id, file, n) => {
      const t = { id, kind: "run", prompt_id: id, created: Date.now() - n * 1000, group: __T.groupOf(), workflow: "", number: n, status: "success", text: "fixture take", seed: n, verdict: null, prior: false, notes: [],
        media: [{ kind: "image", filename: file.split("/")[1], subfolder: "snaptest", type: "input", node: "1" }],
        prompt: { 5: { class_type: "LoadImage", inputs: { image: files.plate } }, 6: { class_type: "H3References", inputs: { "ref_images.ref_image_0": ["5", 0] } } } };
      await __T.save(t); return t;
    };
    const run = Date.now().toString(36), copy = await mk(`take-fixture-copy-${run}`, files.copy, 1), view = await mk(`take-fixture-view-${run}`, files.view, 2);
    const q = [await __P.checkTake(copy), await __P.checkTake(view)];
    for (let i = 0; i < 400 && [copy, view].some((t) => !t.copy || t.copy.pending); i++) await new Promise((r) => setTimeout(r, 1000));
    return { queued: q, ids: [copy.id, view.id], copy: copy.copy, view: view.copy };
  }, { files });
  R.agentCheck = (await call("check_copies", { take: R.copy.ids[1] })).result;
  await page.waitForTimeout(800);
  R.chips = await page.$$eval(".snap-take", (els) => els.map((e) => [e.dataset.take, e.querySelector(".snap-take-copy")?.textContent ?? null]));
  await page.screenshot({ path: path.join(out, "99-u52-takes-copy-flag.png") });
  await page.click(`.snap-take[data-take="${R.copy.ids[0]}"]`); await page.waitForTimeout(600);
  R.viewerLine = await page.$eval(".snap-take-copyline", (e) => e.textContent);
  await page.screenshot({ path: path.join(out, "99-u52-take-copy-viewer.png") });
  R.listed = (await call("list_takes")).result.filter((t) => R.copy.ids.includes(t.id)).map((t) => [t.id === R.copy.ids[0] ? "copy" : "view", t.copy?.copied]);
  R.chips = R.chips.filter(([id]) => R.copy.ids.includes(id)).map(([id, chip]) => [id === R.copy.ids[0] ? "copy" : "view", chip]);
  R.queuedReal = queuedReal; R.refused = refused;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_plates_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
