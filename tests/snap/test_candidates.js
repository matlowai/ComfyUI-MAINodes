// U32 / U55 / U54 candidates on the CPU server: plate candidates (2 per camera, the copy score and the layout check only
// leave notes, the person applies, Undo takes it back, an agent's apply waits as a proposal), plates made on demand when
// a shot compiles with no plate and the shot compiling again once one is picked; the edit-a-take flow (MOSS anchors as
// candidates with an identity check, Apply queues H3 Ripple, the render lands as a take whose parent is the original);
// Use as input on a take. Every GPU prompt is answered here (fake ids and histories built from fixtures in u32/); none runs.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"), R = {};
const HOST = `http://127.0.0.1:${CFG.port}`;
const call = async (tool, args = {}) => (await (await fetch(`${HOST}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) })).json());
const FIX = CFG.fixture("u32");
const LOOKS = JSON.parse(fs.readFileSync(CFG.fixture("u61/looks.json"))); // test_identity_notes.py writes it
const OUTPUT = path.join(CFG.base, "output"); // the CPU server's output folder
async function upload(file, name) {
  const form = new FormData();
  form.append("image", new Blob([fs.readFileSync(file)]), name);
  form.append("subfolder", "snaptest"); form.append("overwrite", "true");
  const r = await (await fetch(`${HOST}/upload/image`, { method: "POST", body: form })).json();
  return `${r.subfolder}/${r.name}`;
}
const inp = (name) => ({ filename: name, subfolder: "snaptest", type: "input" });
(async () => {
  const files = { plate: await upload(CFG.fixture("u21/plate.png"), "u21_plate.png"), copy: await upload(CFG.fixture("u49/pool/u21b_S1_20261111_f106.png"), "copy_f106.png"),
    view: await upload(CFG.fixture("u49/pool/orbit_S1_20261123_f106.png"), "newview_f106.png"), video: await upload(path.join(FIX, "day_take.mp4"), "day_take.mp4") };
  for (const f of ["mask_left", "mask_right", "mask_none", "night_f0", "night_f45", "crop_orig_f0", "crop_night_f0", "crop_orig_f45", "crop_night_f45"]) await upload(path.join(FIX, `${f}.png`), `${f}.png`);
  fs.mkdirSync(path.join(OUTPUT, "video/snap_edits"), { recursive: true });
  fs.copyFileSync(path.join(FIX, "day_take.mp4"), path.join(OUTPUT, "video/snap_edits/fixture_night_00001_.mp4"));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  // every GPU prompt is answered here; the kind is read from its nodes
  const got = { orbit: [], layout: [], identity: [], edit: [], ripple: [] }, fake = {};
  let refused = 0;
  const MASK = { window: "mask_right", door: "mask_right", lantern: "mask_right" }; // the rest: nothing found
  await page.route(/\/(api\/)?prompt$/, (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const body = JSON.parse(r.request().postData()), nodes = body.prompt, types = Object.values(nodes).map((n) => n.class_type);
    const kind = types.includes("H3ReferenceToVideoRefs") ? "orbit" : types.includes("TextEncodeMOSSImageEdit") ? "edit" : types.includes("MiniMaxH3AddGuide") ? "ripple"
      : types.includes("SAM3_Detect") ? (types.includes("MAISnapIdentity") ? "identity" : "layout") : null;
    if (!kind) { refused++; return r.abort(); }
    got[kind].push(body);
    const id = `fake-${kind}-${got[kind].length}`;
    if (kind === "layout") fake[id] = { status: { status_str: "success", completed: true, messages: [] }, outputs: Object.fromEntries(Object.keys(nodes).filter((k) => /^p\d+$/.test(k)).map((k) => {
      const text = nodes[`f${k.slice(1)}t`].inputs.text; return [k, { images: [inp(`${MASK[text] ?? "mask_none"}.png`)] }]; })) };
    // identity notes (U61, G1b): each picture's face and character embeddings and hair from test_identity_notes.py's run on
    // U56b's frames: the first candidate is U53b's silver edit of seed A (hair lighter), the second U54's kept night anchor
    // c1 (ArcFace 0.29 against the day frame; a relight never gets the different-person flag)
    if (kind === "identity") { const pick = got.identity.length === 1 ? { "00": "seedA_day_f0", "01": "seedA_edit_akh", "10": "seedA_day_f48", "11": "seedA_edit_akh", b0: "seedA_day_f24", b1: "seedA_day_f24" }
      : { "00": "U19_day_f0", "01": "U54_c1_f0", "10": "U19_day_f53", "11": "U54_c1_f53", b0: "U19_day_f30", b1: "U19_day_f90" };
      const crop = { "00": "crop_orig_f0.png", "01": "crop_night_f0.png", "10": "crop_orig_f45.png", "11": "crop_night_f45.png" }; // SNAP-R76: each face's head crop comes with its measurement
      fake[id] = { status: { status_str: "success", completed: true, messages: [] }, outputs: Object.fromEntries(Object.entries(pick).map(([k, n]) => [`x${k}`, { faces: [[LOOKS[n].face]], characters: [[LOOKS[n].character]], boxes: [[[0.4, 0.2, 0.1, 0.15]]], hair_l90: [LOOKS[n].hair], ...(crop[k] ? { images: [inp(crop[k])] } : {}) }])) };
      R.identityNodes = R.identityNodes ?? { identity: types.filter((t) => t === "MAISnapIdentity").length, sam: Object.values(nodes).filter((n) => n.class_type === "CLIPTextEncode").map((n) => n.inputs.text).sort(), loader: nodes.fm?.inputs.model_name, encoder: nodes.ce?.inputs.clip_name }; }
    return r.fulfill({ json: { prompt_id: id, number: 1, node_errors: {} } });
  });
  // a fake render with no history yet waits in the queue (a candidate the server has no record of counts as failed)
  await page.route(/\/api\/queue$/, async (r) => {
    if (r.request().method() !== "GET") return r.continue();
    const res = await r.fetch(), q = await res.json(), waiting = Object.values(got).flatMap((list, k) => list.map((_, i) => `fake-${Object.keys(got)[k]}-${i + 1}`)).filter((id) => !fake[id]);
    r.fulfill({ response: res, json: { ...q, queue_pending: [...q.queue_pending, ...waiting.map((id, i) => [100 + i, id, {}, {}, []])] } });
  });
  await page.route(/\/(api\/)?history\/fake-[a-z]+-\d+$/, (r) => { const id = r.request().url().split("/").pop(); return r.fulfill({ json: fake[id] ? { [id]: fake[id] } : {} }); });
  // the files the graphs name, as a GPU machine lists them (the CPU server has none)
  const SHELF = { "MAIRenderPreset.model": "h3/minimax_h3_ref2va_pruned_int8_convrot.safetensors", "MAIRenderPreset.lora": "h3/pika_h3_flex_ref2va_comfy_bf16.safetensors",
    "CLIPLoader.clip_name": ["h3/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "qwen3.5_9b_int8_convrot.safetensors"], "VAELoader.vae_name": ["h3/minimax_h3_video_vae_fp16.safetensors", "h3/minimax_h3_audio_vae_fp32.safetensors", "flux2-vae.safetensors"],
    "UNETLoader.unet_name": ["moss_image_sft_int8_convrot.safetensors", "h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors"],
    "LoraLoaderModelOnly.lora_name": ["akhaliq_moss_edit_hq_armV5.safetensors", "chinoll_moss_image_edit_adapter.safetensors", "h3/minimax_H3_Ripple-v1.safetensors", "h3/minimax_h3_fl2v_lightx2v_turbo_4step_v1.0_768p_resized_avg_rank_31_bf16.safetensors"] };
  await page.route(/\/api\/object_info\/(MAIRenderPreset|CLIPLoader|VAELoader|UNETLoader|LoraLoaderModelOnly)$/, async (r) => {
    const res = await r.fetch(), info = await res.json(), [type, spec] = Object.entries(info)[0];
    for (const [k, v] of Object.entries(SHELF)) if (k.startsWith(`${type}.`)) { const x = spec.input.required[k.split(".")[1]]; const add = [v].flat(); if (Array.isArray(x[0])) x[0].push(...add); else x[1].options = [...(x[1].options ?? []), ...add]; }
    r.fulfill({ response: res, json: info });
  });
  const FOLDERS = { diffusion_models: SHELF["UNETLoader.unet_name"], loras: SHELF["LoraLoaderModelOnly.lora_name"], checkpoints: ["sam3.1_multiplex_fp16.safetensors"] };
  await page.route(/\/api\/experiment\/models\/(diffusion_models|loras|checkpoints)$/, async (r) => {
    const res = await r.fetch(), list = await res.json(), folder = r.request().url().split("/").pop();
    r.fulfill({ response: res, json: [...list, ...FOLDERS[folder].map((name) => ({ name, pathIndex: 0, modified: 0, size: 1e9 }))] });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${HOST}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    for (const [k, f] of Object.entries({ L: "library", P: "plates", T: "takes", C: "candidates", ED: "edits", PR: "proposals" })) window[`__${k}`] = await import(`/extensions/ComfyUI-MAINodes/snap/${f}.js`);
    window.__api = (await import("/scripts/api.js")).api;
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "first_frame", "refs", "render"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(900);
  const SET = "set-lamp-room-end-s3";
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 60000, polling: 300 });
  const describe = (id) => page.evaluate((id) => __C.describe(__C.get(id)), id);

  // 1. plate candidates: 2 renders for one camera, both kept with notes (a likely copy is marked, never rejected)
  R.wide = (await call("set_set_plate", { set: SET, camera: "wide", image: files.plate })).result.plate.by;
  R.agentMake = (await call("make_set_plates", { set: SET, cameras: ["master"], count: 2 })).result;
  R.made = await page.evaluate((SET) => __P.make(SET, { cameras: ["master"], count: 2, by: "person" }), SET);
  R.orbitSeeds = got.orbit.map((o) => Object.values(o.prompt).find((n) => n.class_type === "RandomNoise").inputs.noise_seed);
  const decision = R.made.queued[0].decision;
  R.made.queued.forEach(({ prompt_id }, i) => { fake[prompt_id] = { status: { status_str: "success", completed: true, messages: [] },
    outputs: { 16: { images: [{ filename: "x.mp4", subfolder: "video", type: "output" }] }, 18: { images: [inp(i === 0 ? "newview_f106.png" : "copy_f106.png")] }, 20: { copy_scores: [i === 0 ? 0.5822 : 0.8969] } } }; });
  await page.evaluate(() => __C.settle());
  await until((id) => __C.get(id).candidates.every((c) => c.notes.layout), decision);
  R.plateCands = await describe(decision);
  R.layoutWords = got.layout[0] && Object.values(got.layout[0].prompt).filter((n) => n.class_type === "CLIPTextEncode").map((n) => n.inputs.text);
  R.listed = (await call("list_candidates", { kind: "plate", open: true })).result.map((d) => [d.target, d.candidates.length]);

  // preview in place: the camera's plate slot shows the hovered candidate; the recipe doesn't change
  R.revBefore = (await call("describe_recipe")).result.revision;
  await page.click('.snap-brick[data-brick="refs"] .snap-name'); await page.waitForTimeout(200);
  await page.click('.snap-card:has-text("lamp room") .snap-edit[title^="open the set plan"] >> nth=0'); await page.waitForTimeout(1200);
  await page.hover(`.snap-cands[data-decision="${decision}"] .snap-cand[data-candidate="c2"]`); await page.waitForTimeout(400);
  R.preview = await page.evaluate(() => { const t = [...document.querySelectorAll(".snap-set-plate")].find((f) => f.querySelector("b").textContent === "master");
    const tag = t.querySelector(".snap-set-preview"); return { previewing: t.classList.contains("previewing"), tag: tag && !tag.hidden ? tag.textContent : null, src: t.querySelector("img")?.src ?? null }; });
  await page.screenshot({ path: path.join(out, "100-u55-plate-candidates-preview.png") });
  R.revPreview = (await call("describe_recipe")).result.revision;
  R.nullText = await page.$eval(".snap-set-plates", (e) => /\bnull\b/.test(e.textContent));
  R.tiles = await page.$$eval(`.snap-cands[data-decision="${decision}"] .snap-cand`, (els) => els.map((e) => [e.dataset.candidate, [...e.querySelectorAll(".snap-cand-note")].map((n) => n.textContent), [...e.querySelectorAll("button")].map((x) => x.textContent)]));

  // an agent's apply waits as a proposal (the recommendation shows on the tile); the person applies, undoes, applies again
  R.agentApply = (await call("apply_candidate", { decision, candidate: "c1", reason: "c1 moved off the wide plate (copy 0.58) and its door is on the right as planned" })).result;
  await page.waitForTimeout(500);
  R.rec = await page.$$eval(`.snap-cand.recommended`, (els) => els.map((e) => [e.dataset.candidate, e.querySelector(".snap-cand-rec")?.textContent]));
  await page.mouse.move(5, 5); await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(out, "100-u55-plate-recommended.png") });
  R.noPlateYet = (await call("set_plates", { set: SET })).result.cameras.find((c) => c.camera === "master").plate;
  await page.click(`.snap-cands[data-decision="${decision}"] .snap-cand[data-candidate="c1"] .snap-primary`); await page.waitForTimeout(1500);
  R.applied = (await call("set_plates", { set: SET })).result.cameras.find((c) => c.camera === "master");
  R.proposalAfter = (await call("list_proposals")).result.filter((p) => p.tool === "apply_candidate").map((p) => p.status);
  await page.screenshot({ path: path.join(out, "100-u55-plate-applied.png") });
  await page.click(`.snap-cands[data-decision="${decision}"] .snap-cand[data-candidate="c1"] button:has-text("Undo")`); await page.waitForTimeout(1200);
  R.undone = { plate: (await call("set_plates", { set: SET })).result.cameras.find((c) => c.camera === "master").plate, state: (await describe(decision)).candidates.map((c) => c.state) };
  await page.click(`.snap-cands[data-decision="${decision}"] .snap-cand[data-candidate="c2"] button:has-text("Reject")`); await page.waitForTimeout(600);
  await page.click(`.snap-cands[data-decision="${decision}"] .snap-cand[data-candidate="c1"] .snap-primary`); await page.waitForTimeout(1500);
  R.final = { decision: await describe(decision), plate: (await call("set_plates", { set: SET })).result.cameras.find((c) => c.camera === "master").plate };
  await page.screenshot({ path: path.join(out, "100-u55-plate-picked.png") });
  await page.click('.snap-sheet[aria-label^="edit Set"] header .snap-x'); await page.waitForTimeout(300);

  // 2. on demand: shot 4 (OTS on Ferro) has no plate. An agent's apply_card asks for candidates as a proposal; the
  // person's apply from the Library makes them, and picking one compiles the shot again with that plate
  R.agentShot = (await call("apply_card", { card: "shot-letter" })).result;
  await page.click('.snap-brick[data-brick="render"] .snap-name'); await page.waitForTimeout(300);
  const before = got.orbit.length;
  await page.click('.snap-card:has-text("Kon hands Ferro the letter")'); await page.waitForTimeout(2500);
  R.demand = { queued: got.orbit.length - before, toast: await page.$eval(".snap-toast", (e) => e.textContent).catch(() => null), picture: await page.evaluate(() => __snap.engine.state().bricks.find((x) => x.key === "render").shot.picture.use) };
  const ferro = await page.evaluate((SET) => __C.about("plate", `${SET}/OTS on Ferro`).id, SET);
  const ferroIds = (await describe(ferro)).candidates.map((c) => c.take.replace("take-", ""));
  ferroIds.forEach((id, i) => { fake[id] = { status: { status_str: "success", completed: true, messages: [] }, outputs: { 16: { images: [{ filename: "x.mp4", subfolder: "video", type: "output" }] }, 18: { images: [inp("newview_f106.png")] }, 20: { copy_scores: [0.55 + i / 100] } } }; });
  await page.evaluate(() => __C.settle());
  await until((id) => __C.get(id).candidates.every((c) => c.state === "ready"), ferro);
  R.again = (await call("apply_card", { card: "shot-letter" })).result.plates;
  await page.evaluate((id) => __C.apply(id, "c1", "person"), ferro); await page.waitForTimeout(800);
  R.recompiled = await page.evaluate(() => { const s = __snap.engine.state().bricks.find((x) => x.key === "render").shot; return { use: s.picture.use, camera: s.picture.camera, ref: s.parts.find((p) => p.field === "reference")?.text ?? null }; });

  // 3. edit a take: night version of a fixture take (107 frames: anchors at 0 and 53)
  const take = await page.evaluate(async (video) => {
    await __T.load();
    const t = { id: `take-fixture-day-${Date.now().toString(36)}`, kind: "run", prompt_id: "fixture", created: Date.now() - 5000, group: __T.groupOf(), workflow: "", number: 1, status: "success", seconds: 66, text: "An adult woman in a red coat walks along an empty train platform", seed: 20261104,
      verdict: null, prior: false, notes: [], media: [{ kind: "video", filename: video.split("/")[1], subfolder: "snaptest", type: "input", node: "1" }],
      prompt: { 1: { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "An adult woman in a red coat", width: 1280, height: 704, length: 97 } } } };
    await __T.save(t); return t.id;
  }, files.video);
  R.agentEdit = (await call("edit_take", { take, example: "night" })).result; // U73: night is an example of a change
  await page.evaluate((id) => __snap.dailies?.view?.(__T.get(id)), take);
  if (!(await page.$(".snap-take-sheet"))) { await page.waitForTimeout(500); await page.click(`.snap-take[data-take="${take}"]`); }
  await page.waitForSelector('.snap-take-sheet button:has-text("Make 2 candidates")'); await page.waitForTimeout(600);
  await page.selectOption('select[aria-label="example"]', "night"); // U73: night is an example of Change something
  await page.click('.snap-take-sheet button:has-text("Make 2 candidates")'); await page.waitForTimeout(1500);
  R.anchors = got.edit.map((e) => { const n = Object.values(e.prompt); return { frames: n.filter((x) => x.class_type === "ImageFromBatch").map((x) => x.inputs.batch_index), lora: n.find((x) => x.class_type === "LoraLoaderModelOnly").inputs.lora_name,
    cfg: n.find((x) => x.class_type === "KSampler").inputs.cfg, text: n.find((x) => x.class_type === "TextEncodeMOSSImageEdit").inputs.prompt, client: e.client_id, job: e.extra_data?.snap_job ?? null }; });
  const edit = await page.evaluate((id) => __C.about("edit", id).id, take);
  (await describe(edit)).candidates.forEach((c, i) => { fake[`fake-edit-${i + 1}`] = { status: { status_str: "success", completed: true, messages: [] }, outputs: { a0o: { images: [inp("night_f0.png")] }, a1o: { images: [inp("night_f45.png")] } } }; });
  await page.evaluate(() => __C.settle());
  await until((id) => __C.get(id).candidates.every((c) => c.notes.identity), edit);
  R.editCands = await describe(edit);
  await page.waitForTimeout(500);
  R.identityChips = await page.$$eval(`.snap-cands[data-decision="${edit}"] .snap-cand`, (ts) => ts.map((t) => [...t.querySelectorAll(".snap-cand-note")].map((n) => [n.textContent, n.classList.contains("warn")])));
  R.crops = await page.$$eval(`.snap-cands[data-decision="${edit}"] .snap-cand-crops img`, (x) => x.length);
  R.identityPairs = got.identity[0] && Object.values(got.identity[0].prompt).filter((n) => n.class_type === "ImageFromBatch").map((n) => n.inputs.batch_index);
  await page.waitForTimeout(800);
  R.revEditBefore = (await call("describe_recipe")).result.revision;
  await page.hover(`.snap-cands[data-decision="${edit}"] .snap-cand[data-candidate="c1"] .snap-cand-pics img >> nth=1`); await page.waitForTimeout(600);
  R.editPreview = await page.evaluate(() => ({ shown: !document.querySelector(".snap-take-preview").hidden, tag: document.querySelector(".snap-take-preview-tag").textContent, t: +document.querySelector(".snap-take-stage video").currentTime.toFixed(2) }));
  await page.screenshot({ path: path.join(out, "101-u54-edit-candidates-preview.png") });
  R.revEdit = (await call("describe_recipe")).result.revision;
  await page.click(`.snap-cands[data-decision="${edit}"] .snap-cand[data-candidate="c1"] .snap-primary`); await page.waitForTimeout(1500);
  const rp = got.ripple[0], rn = rp && Object.values(rp.prompt);
  R.ripple = rp && { loras: rn.filter((x) => x.class_type === "LoraLoaderModelOnly").map((x) => x.inputs.lora_name), guides: rn.filter((x) => x.class_type === "MiniMaxH3AddGuide").map((x) => x.inputs.frame_idx),
    length: rn.find((x) => x.class_type === "MiniMaxH3ImageToVideo").inputs.length, guide: rn.find((x) => x.class_type === "LoadVideo").inputs.file, anchors: rn.filter((x) => x.class_type === "LoadImage").map((x) => x.inputs.image),
    group: rp.extra_data.extra_pnginfo.workflow.id, parent: rp.extra_data.snap_parent, mine: rp.client_id === (await page.evaluate(() => __api.clientId)) };
  // the Ripple render finishes: the page captures it as a take whose parent is the original
  fake["fake-ripple-1"] = { status: { status_str: "success", completed: true, messages: [] }, prompt: [1, "fake-ripple-1", rp.prompt, rp.extra_data], outputs: { 11: { images: [inp("day_take.mp4")] }, 28: { images: [{ filename: "fixture_night_00001_.mp4", subfolder: "video/snap_edits", type: "output" }] } } };
  await page.evaluate(() => { const ev = (type) => __api.dispatchCustomEvent ? __api.dispatchCustomEvent(type, { prompt_id: "fake-ripple-1" }) : __api.dispatchEvent(new CustomEvent(type, { detail: { prompt_id: "fake-ripple-1" } })); ev("execution_start"); ev("execution_success"); });
  await until(() => !!__T.get("take-fake-ripple-1"));
  await page.waitForTimeout(800);
  R.child = await page.evaluate(async () => { const t = __T.get("take-fake-ripple-1"); return { parent: t.parent, group: t.group, stale: await __T.stale(t), media: t.media.map((m) => `${m.type}/${m.subfolder}/${m.filename}`) }; });
  R.childGroup = await page.evaluate((id) => __T.get(id).group, take);
  R.editAfter = await page.$eval(`.snap-cands[data-decision="${edit}"]`, (e) => e.parentNode.textContent).catch(() => null);
  await page.screenshot({ path: path.join(out, "101-u54-edit-applied.png") });
  R.editUndo = await page.evaluate(async (id) => { try { await __C.undo(id); return "undone"; } catch (e) { return e.message; } }, edit);
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  R.chip = await page.$eval('.snap-take[data-take="take-fake-ripple-1"] .snap-take-parent', (e) => e.textContent).catch(() => null);
  await page.screenshot({ path: path.join(out, "101-u54-parent-chip.png") });

  // 4. use as input: a frame of a take as the First frame (one undo step, the brick says where it came from) or a reference
  R.firstBefore = await page.evaluate(() => __snap.engine.getValue("first_frame", "image", "image"));
  R.useFirst = (await call("use_take", { take, as: "first_frame", at: 1.0 })).result;
  await page.waitForTimeout(600);
  R.fromChip = await page.$eval('.snap-brick[data-brick="first_frame"] .snap-from', (e) => e.textContent).catch(() => null);
  await page.screenshot({ path: path.join(out, "102-u32-use-as-first-frame.png") });
  await call("ui", { action: "undo" }); await page.waitForTimeout(600);
  R.firstUndone = await page.evaluate(() => __snap.engine.getValue("first_frame", "image", "image"));
  R.useRef = (await call("use_take", { take, as: "reference", at: "last" })).result;
  R.refPics = await page.evaluate(() => (__snap.engine.state().bricks.find((x) => x.key === "refs").pictures ?? []).map((p) => p.role));

  R.got = Object.fromEntries(Object.entries(got).map(([k, v]) => [k, v.length])); R.refused = refused;
  R.queue = (await (await fetch(`${HOST}/queue`)).json()).queue_pending.length;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_candidates_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
