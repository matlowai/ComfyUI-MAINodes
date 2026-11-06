// U101 (SNAP-R71..R74) on the CPU test server: New view from these pictures, and audio references.
// - edit_from_context on a still take (Change something refused it: "has no video to edit", F-C09), with a video take's
//   frame, a cropped input/ file and a Cast's picture: the queued graph puts them on PH3ImageConditioning's (P-H3-Image,
//   the first view model listed; MOSS is no longer one, the operator 2026-11-05)
//   images.image_0..3 in the order given, the prompt is exactly the words given (no keep-the-composition text), the crop
//   is in pixels, the still is Picture 1's size or the size asked; each seed is a candidate take in Picture 1's shot,
//   whose parent names every context picture; apply_candidate makes it the shot's active take, undo puts the old one back;
//   refusals say what to give;
// - the take viewer's tray: Add this picture, a marked region as a crop, a Cast's picture, reorder, ✕, "Picture 1 sets
//   the camera", no stray "null";
// - add_audio_ref wires a Load Audio into H3 References' ref_audios and answers <Audio n>; remove renumbers; a Cast's
//   voice goes in with apply_cast and out with a version that has none; Load Audio lists input/snap/ audio (F-C08);
//   References shows <Audio n>.
// Model files are empty placeholders (parked afterwards, moved, never deleted); queued prompts are rewritten to 64 px CPU
// prompts by fwork.js with their extra_data kept, so the candidates become real takes. Screens 420-422.
// usage: node test_u101.js [port 8195] [base dir]     BEFORE=e77909c node test_u101.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const base = process.argv[3] || CFG.base;
const FILES = [  "diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"];
const sh = (cmd, args) => new Promise((done, fail) => execFile(cmd, args, (e) => (e ? fail(e) : done())));
(async () => {
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  fs.mkdirSync(path.join(base, "input", "snap"), { recursive: true });
  await sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=3", path.join(base, "input", "snap", "snaptest_u101_voice.wav")]);
  await sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=3", path.join(base, "input", "snap", "snaptest_u101_voice2.wav")]);
  await sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x406080:s=200x100", "-frames:v", "1", path.join(base, "input", "snap", "snaptest_u101_master.png")]);
  await sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x804060:s=60x100", "-frames:v", "1", path.join(base, "input", "snap", "snaptest_u101_face.png")]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const prompts = []; // the graphs as Snap built them, before fwork rewrites them
    // a New view's own prompts (its candidates' notes queue face and copy checks meanwhile, F-C14); the route records a
    // request after the page's fetch returns, so wait for them
    const views = (n) => prompts.slice(n).filter((x) => x.extra_data?.snap_parent?.method?.startsWith("view/"));
    const settle = async (n, want) => { for (let i = 0; i < 40 && views(n).length < want; i++) await page.waitForTimeout(50); return views(n); };
    await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") prompts.push(JSON.parse(r.request().postData())); r.fallback(); });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    // a scene shot with a still take, and a video take (a record only: its frame is read by the graph, never run here)
    R.fix = await page.evaluate(async () => {
      const SC = window.__SC, T = window.__T, J = window.__J; await T.load(); await SC.load();
      const s = await SC.create({ name: "U101 gate" }); await SC.addShot(s.id, { name: "C2" }); await SC.openShot(s.id, SC.get(s.id).shots[0].id);
      const id = await J.queueRun({ kind: "run", title: "a still: the old C2 board", about: J.here() }, () => app.queuePrompt(0, 1));
      for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((r) => setTimeout(r, 250));
      const still = T.get(`take-${id}`);
      await T.save({ id: "take-u101-video", kind: "run", prompt_id: "u101-video", created: Date.now(), group: "u101-elsewhere", number: 1, status: "success", text: "", seed: 1, verdict: null, notes: [],
        media: [{ kind: "video", filename: "u101.mp4", subfolder: "snaptest", type: "output" }], prompt: { 1: { class_type: "MiniMaxH3ImageToVideo", inputs: { length: 97, width: 64, height: 64 } } } });
      return { scene: s.id, shot: SC.get(s.id).shots[0].id, still: still?.id, media: still?.media.map((m) => m.kind) };
    });
    R.cast = await call("save_cast", { name: "Maren", details: "a tall swordswoman, white braid", lora: null, refs: [{ file: "snap/snaptest_u101_face.png", role: "identity: front" }] });
    // Change something on a still says where to go
    R.editStill = await call("edit_take", { take: R.fix.still, method: "remake_edit", change: "the camera inside the square" });
    // the new route
    const n0 = prompts.length;
    R.view = await call("edit_from_context", { method: "ph3_view", pictures: [{ take: R.fix.still, label: "old C2 board" }, { file: "snap/snaptest_u101_master.png", crop: [0.25, 0, 0.5, 1], label: "master, the gatehouse" }, { take: "take-u101-video", frame: 40 }, { cast: R.cast.cast }],
      prompt: "Replace the gate in Picture 1 with the gatehouse from Picture 2. The woman on the left is the woman in Picture 4.", seeds: [901, 902] });
    const graphs = (await settle(n0, 2)).map((x) => x.prompt);
    const enc = graphs[0] && Object.values(graphs[0]).filter((n) => n.class_type === "PH3ImageConditioning");
    const src = (g, link) => g[link[0]];
    R.graph = graphs[0] && {
      count: graphs.length, words: enc.map((e) => e.inputs.prompt), images: Object.keys(enc[0].inputs).filter((k) => k.startsWith("images.")),
      chain: Object.keys(enc[0].inputs).filter((k) => k.startsWith("images.")).map((k) => { let n = src(graphs[0], enc[0].inputs[k]), types = []; while (n) { types.push(n.class_type); const up = Object.values(n.inputs).find((v) => Array.isArray(v)); n = up && graphs[0][up[0]]; if (types.length > 6) break; } return types; }),
      crop: Object.values(graphs[0]).find((n) => n.class_type === "ImageCropV2")?.inputs.crop_region, frame: Object.values(graphs[0]).find((n) => n.class_type === "ImageFromBatch")?.inputs.batch_index,
      size: [enc[0].inputs.width, enc[0].inputs.height], seeds: graphs.map((g) => Object.values(g).find((n) => n.class_type === "RandomNoise")?.inputs.noise_seed),
      negatives: Object.values(graphs[0]).filter((n) => /Encode|Conditioning/.test(n.class_type)).length, parent: views(n0)[0]?.extra_data?.snap_parent, world: views(n0)[0]?.extra_data?.extra_pnginfo?.workflow?.extra?.snap?.world };
    const n1 = prompts.length;
    R.sized = await call("edit_from_context", { pictures: [{ take: R.fix.still }], prompt: "the same place at night", seeds: [7], width: 1280, height: 704 });
    R.sizedGraph = (await settle(n1, 1)).map((x) => { const c = Object.values(x.prompt).find((n) => n.class_type === "PH3ImageConditioning"); return c && [c.inputs.width, c.inputs.height]; })[0];
    R.viewMethods = (await call("list_methods", { slot: "view" }))?.methods?.map((m) => [m.id, m.picture_one?.label]);
    // P-H3-Image (ph3_view): the same pictures, core PH3ImageConditioning (image_1 edited, the rest references), 8 steps
    const n3 = prompts.length;
    R.ph3 = await call("edit_from_context", { method: "ph3_view", pictures: [{ take: R.fix.still }, { file: "snap/snaptest_u101_master.png", crop: [0.25, 0, 0.5, 1] }, { cast: R.cast.cast }], prompt: "Edit <Picture 1>. The gate of <Picture 2>; the woman of <Picture 3> on the left.", seeds: [5], width: 1280, height: 704 });
    R.ph3Graph = (await settle(n3, 1)).map((x) => { const g = x.prompt, by = (t) => Object.values(g).filter((n) => n.class_type === t);
      const c = by("PH3ImageConditioning")[0]; return { cond: c && { prompt: c.inputs.prompt, width: c.inputs.width, height: c.inputs.height, images: Object.keys(c.inputs).filter((k) => k.startsWith("images.")), first: g[c.inputs["images.image_1"]?.[0]]?.class_type, second: g[c.inputs["images.image_2"]?.[0]]?.class_type },
        shift: by("MiniMaxH3SigmaShift")[0]?.inputs, steps: by("ManualSigmas")[0]?.inputs.sigmas.split(",").length - 1, guider: by("BasicGuider").length, moss: by("TextEncodeMOSSImageEdit").length, clip: by("CLIPLoader")[0]?.inputs.type, made: x.extra_data?.snap_parent?.method }; })[0];
    // fizgig_still on a server without the Fizgig H3 Still pack: refused, naming the nodes it needs (nothing queued)
    const n4 = prompts.length;
    R.fizgig = await call("edit_from_context", { method: "fizgig_still", pictures: [{ take: R.fix.still }], prompt: "<Picture 1> at night", seeds: [1] });
    R.fizgigQueued = views(n4).length;
    R.fizgigListed = (await call("list_methods", { slot: "view" }))?.methods?.map((m) => [m.id, m.install_state]);
    R.ph3Many = await call("edit_from_context", { method: "ph3_view", pictures: Array.from({ length: 10 }, () => ({ take: R.fix.still })), prompt: "x" });
    R.refusals = { none: await call("edit_from_context", { pictures: [], prompt: "x" }), words: await call("edit_from_context", { pictures: [{ take: R.fix.still }], prompt: " " }),
      crop: await call("edit_from_context", { pictures: [{ take: R.fix.still, crop: [0.5, 0.5, 2, 0.1] }], prompt: "x" }), half: await call("edit_from_context", { pictures: [{ take: R.fix.still }], prompt: "x", width: 512 }),
      missing: await call("edit_from_context", { pictures: [{ file: "snap/not_here.png" }], prompt: "x" }), lora: await call("edit_from_context", { pictures: [{ take: R.fix.still }], prompt: "x", lora: "nope.safetensors" }) };
    // the candidates land as takes in the shot
    await F.idle(port);
    R.landed = await page.evaluate(async ([d, shot, scene]) => {
      const C = window.__C, T = window.__T, SC = window.__SC;
      if (!C.get(d)) return null; // the code before U101 made no decision
      for (let i = 0; i < 80; i++) { await C.settle(); await T.reload(); if (C.get(d).candidates.every((c) => c.state !== "rendering") && C.get(d).candidates.every((c) => T.get(c.take ?? ""))) break; await new Promise((r) => setTimeout(r, 250)); }
      const x = C.get(d), takes = x.candidates.map((c) => T.get(c.take)).filter(Boolean), sh = SC.get(scene).shots.find((y) => y.id === shot);
      return { states: x.candidates.map((c) => c.state), takes: takes.map((t) => ({ id: t.id, label: SC.label(t), method: t.parent?.method, context: t.parent?.options?.context?.map((p) => p.label), made_from: t.made_from ?? [], world: Object.keys(t.world ?? {}) })),
        inShot: takes.every((t) => SC.takesOf(sh).some((e) => e.take === t.id)), activity: window.__A.all().find((r) => r.decision === d)?.kind };
    }, [R.view.decision, R.fix.shot, R.fix.scene]);
    R.apply = await call("apply_candidate", { decision: R.view.decision, candidate: "c2" });
    R.active = await page.evaluate(([scene, shot]) => window.__SC.get(scene).shots.find((y) => y.id === shot).active, [R.fix.scene, R.fix.shot]);
    R.undo = await call("undo_candidate", { decision: R.view.decision });
    R.activeAfterUndo = await page.evaluate(([scene, shot]) => window.__SC.get(scene).shots.find((y) => y.id === shot).active, [R.fix.scene, R.fix.shot]);
    R.listed = (await call("list_candidates", { kind: "view" }))?.map?.((d) => d.id) ?? [];
    // the tray in the take viewer
    R.tray = await page.evaluate(async (id) => {
      const D = await import("/extensions/ComfyUI-MAINodes/snap/dailies.js").catch(() => null), T = window.__T;
      document.querySelector(".snap-take-sheet")?.remove();
      const strip = document.querySelector(`.snap-take[data-take="${id}"]`);
      if (strip) strip.click(); else return { error: "no take card" };
      for (let i = 0; i < 20 && !document.getElementById(`snap-viewer-${id}`); i++) await new Promise((r) => setTimeout(r, 150));
      return { viewer: !!document.getElementById(`snap-viewer-${id}`), panel: [...document.querySelectorAll(".snap-take-sheet .snap-rail-title")].map((x) => x.textContent).includes("New view from these pictures") };
    }, R.fix.still);
    const sheet = ".snap-take-sheet";
    if (R.tray.panel) {
      await page.click(`${sheet} button:has-text("＋ Add this picture")`);
      // a marked region as the second picture
      await page.click(`${sheet} button:has-text("Mark region")`);
      const box = await page.locator(`${sheet} .snap-take-overlay`).boundingBox();
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3); await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.7, { steps: 5 }); await page.mouse.up();
      await page.click(`${sheet} button:has-text("＋ Add this picture")`);
      await page.selectOption(`${sheet} select[aria-label="add a Cast picture"]`, { index: 1 });
      R.models = await page.$$eval(`${sheet} select[aria-label="model"] option`, (xs) => xs.map((x) => [x.value, x.textContent]));
      await page.selectOption(`${sheet} select[aria-label="model"]`, "ph3_view");
      R.loraMenu = await page.$$eval(`${sheet} select[aria-label="edit LoRA"]`, (xs) => xs.length);
      await page.selectOption(`${sheet} select[aria-label="model"]`, "fizgig_still");
      R.firstOnFizgig = await page.$eval(`${sheet} .snap-ctx-row .snap-ctx-what`, (x) => x.textContent);
      await page.selectOption(`${sheet} select[aria-label="model"]`, "ph3_view");
      await page.waitForTimeout(300);
      R.rows = await page.$$eval(`${sheet} .snap-ctx-row .snap-ctx-what`, (xs) => xs.map((x) => x.textContent));
      await page.locator(`${sheet} .snap-ctx-row`).nth(2).locator('button:has-text("↑")').click();
      R.rowsMoved = await page.$$eval(`${sheet} .snap-ctx-row .snap-ctx-what`, (xs) => xs.map((x) => x.textContent));
      await page.fill(`${sheet} textarea[aria-label="what the new still shows"]`, "the same gatehouse from inside the square, the woman in Picture 2 on the left");
      await page.locator(`${sheet} .snap-ctx-row`).first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(out, "420-u101-new-view-tray.png") });
      const n2 = prompts.length;
      await page.click(`${sheet} button:has-text("Make 2 candidates")`);
      await page.waitForFunction(() => /Painting|isn't|no /.test(document.querySelector(".snap-take-sheet .snap-ctx ~ .snap-quiet[role=status], .snap-take-sheet [role=status]")?.textContent ?? ""), null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(800);
      R.made = { note: await page.$$eval(`${sheet} [role=status]`, (xs) => xs.map((x) => x.textContent).find((t) => /Painting|Picture/.test(t)) ?? xs.map((x) => x.textContent).join(" | ")),
        order: (await settle(n2, 1)).map((x) => x.extra_data?.snap_parent?.options?.context?.map((p) => p.label))[0] };
      await page.locator(`${sheet} .snap-ctx-row`).first().locator('button:has-text("✕")').click();
      R.rowsAfterRemove = await page.$$eval(`${sheet} .snap-ctx-row .snap-ctx-what`, (xs) => xs.map((x) => x.textContent));
      R.trayNull = await page.$eval(sheet, (el) => /\bnull\b|undefined|\[object/.test([...el.querySelectorAll(".snap-ctx, .snap-ctx ~ *")].map((x) => x.textContent).join(" ")));
      await page.keyboard.press("Escape");
    }
    // audio references
    await F.idle(port);
    R.audioChoices = await page.evaluate(() => { const n = LiteGraph.createNode("LoadAudio"); return n?.widgets?.find((w) => w.name === "audio")?.options?.values ?? []; });
    await page.evaluate(async () => { await window.__X.callTool("start_recipe", {}); });
    R.a1 = await call("add_audio_ref", { file: "snap/snaptest_u101_voice.wav", role: "voice: test" });
    R.a2 = await call("add_audio_ref", { file: "snap/snaptest_u101_voice2.wav" });
    R.aMissing = await call("add_audio_ref", { file: "snap/not_here.wav" });
    R.wired = await page.evaluate(async () => { const p = (await app.graphToPrompt()).output, r = Object.values(p).find((n) => n.class_type === "H3References");
      return Object.entries(r?.inputs ?? {}).filter(([k]) => k.startsWith("ref_audios.")).map(([k, v]) => [k, p[v[0]]?.class_type, p[v[0]]?.inputs.audio]); });
    R.describeRefs = (await call("describe_recipe", {}))?.references;
    R.removed = await call("remove_audio_ref", { audio: 1 });
    R.cv = await call("save_cast", { cast: R.cast.cast, name: "Maren", details: "a tall swordswoman, white braid", lora: null, refs: [{ file: "snap/snaptest_u101_face.png", role: "identity: front" }], voice: { file: "snap/snaptest_u101_voice.wav", casting: "young woman, low cool alto" } });
    R.cvMissing = await call("save_cast", { cast: R.cast.cast, name: "Maren", lora: null, voice: { file: "snap/no_voice.wav" } });
    R.applied = await call("apply_cast", { cast: R.cast.cast });
    R.afterCast = (await call("describe_recipe", {}))?.references?.audio;
    await page.evaluate(async () => { const m = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); m.snap.view?.render?.(); }).catch(() => {});
    await page.waitForTimeout(500);
    R.face = await page.$$eval(".snap-ref-audio", (xs) => xs.map((x) => x.textContent));
    await page.locator(".snap-ref-audio").first().scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: path.join(out, "421-u101-audio-refs.png") });
    R.cv2 = await call("save_cast", { cast: R.cast.cast, name: "Maren", details: "a tall swordswoman, white braid", lora: null, refs: [{ file: "snap/snaptest_u101_face.png", role: "identity: front" }] });
    R.applied2 = await call("apply_cast", { cast: R.cast.cast });
    R.afterNoVoice = (await call("describe_recipe", {}))?.references?.audio;
    R.errors = A.errors;
    const pics = R.view?.pictures ?? [];
    const checks = {
      "Change something on a still points to the new route": /edit_from_context/.test(R.editStill?.error ?? ""),
      "edit_from_context returns a decision and says what Picture 1 is (P-H3-Image, listed first)": !!R.view?.decision && /^Picture 1 \(is the picture edited\): old C2 board/.test(pics[0] ?? ""),
      "the view slot holds only H3 models, each saying what Picture 1 is": JSON.stringify(R.viewMethods) === JSON.stringify([["ph3_view", "is the picture edited"], ["fizgig_still", "is the first reference"]]),
      "one prompt per seed, seeds as given": R.graph?.count === 2 && JSON.stringify(R.graph.seeds) === "[901,902]",
      "four pictures on images.image_1..4 in the order given": JSON.stringify(R.graph?.images) === JSON.stringify(["images.image_1", "images.image_2", "images.image_3", "images.image_4"]),
      "Picture 1 the still, 2 a crop, 3 a video frame, 4 the Cast picture": R.graph?.chain?.[0]?.[0] === "LoadImage" && R.graph.chain[1][0] === "ImageCropV2" && R.graph.chain[2][0] === "ImageFromBatch" && R.graph.chain[3][0] === "LoadImage",
      "the crop is in pixels of the picture (200x100: x 50, w 100)": JSON.stringify(R.graph?.crop) === JSON.stringify({ x: 50, y: 0, width: 100, height: 100 }) && R.graph.frame === 40,
      "the words are exactly the asker's: no keep-the-composition text, no negative": R.graph?.words?.length === 1 && R.graph.words[0] === "Replace the gate in Picture 1 with the gatehouse from Picture 2. The woman on the left is the woman in Picture 4." && R.graph.negatives === 1,
      "the still is Picture 1's size unless asked": JSON.stringify(R.graph?.size) === "[0,0]" && JSON.stringify(R.sizedGraph) === "[1280,704]",
      "the parent names every context picture; the Cast picture pins its version": R.graph?.parent?.method === "view/ph3_view" && R.graph.parent.options.context.length === 4 && R.graph.parent.options.context[3].cast?.startsWith(R.cast.cast) && Object.keys(R.graph.world ?? {}).includes(R.cast.cast),
      "ph3_view: core PH3ImageConditioning, Picture 1 edited and the rest in order, the words as given, 8 steps at shift 1/1, no MOSS": R.ph3Graph?.cond?.prompt === "Edit <Picture 1>. The gate of <Picture 2>; the woman of <Picture 3> on the left." && JSON.stringify(R.ph3Graph.cond.images) === JSON.stringify(["images.image_1", "images.image_2", "images.image_3"])
        && R.ph3Graph.cond.first === "LoadImage" && R.ph3Graph.cond.second === "ImageCropV2" && R.ph3Graph.cond.width === 1280 && R.ph3Graph.cond.height === 704 && R.ph3Graph.steps === 8 && R.ph3Graph.shift?.shift_video === 1 && R.ph3Graph.shift?.shift_audio === 1 && R.ph3Graph.guider === 1 && R.ph3Graph.moss === 0 && R.ph3Graph.clip === "minimax" && R.ph3Graph.made === "view/ph3_view",
      "ph3_view refuses more than 9 pictures, saying why": /up to 9 pictures; 10 given/.test(R.ph3Many?.error ?? ""),
      "fizgig_still without its pack is refused naming the nodes, nothing queued; list_methods says so": /needs the nodes FizgigH3StillLatent, FizgigH3StillDecode/.test(R.fizgig?.error ?? "") && R.fizgigQueued === 0 && /needs the nodes Fizgig/.test(R.fizgigListed?.find(([id]) => id === "fizgig_still")?.[1] ?? ""),
      "what Picture 1 is follows the model (P-H3-Image: the picture edited; Fizgig: the first reference)": /^Picture 1 is the first reference · /.test(R.firstOnFizgig ?? "") && /^Picture 1 is the picture edited · /.test(R.rows?.[0] ?? ""),
      "the tray picks among the H3 models, with no LoRA menu": JSON.stringify(R.models?.map(([v]) => v)) === JSON.stringify(["ph3_view", "fizgig_still"]) && /needs the nodes/.test(R.models?.[1]?.[1] ?? "") && R.loraMenu === 0,
      "refusals say what to give": /at least one picture/.test(R.refusals.none.error ?? "") && /say what the new still shows/.test(R.refusals.words.error ?? "") && /crop is \[x, y, width, height\]/.test(R.refusals.crop.error ?? "")
        && /width and height together/.test(R.refusals.half.error ?? "") && /isn't in this server's input folder/.test(R.refusals.missing.error ?? ""),
      "the candidates land as takes in Picture 1's shot, labelled New view": R.landed?.states?.every((s) => s === "ready") && R.landed.inShot && R.landed.takes.length === 2 && R.landed.takes.every((t) => t.method === "view/ph3_view" && /^New view · /.test(t.label) && t.context.length === 4),
      "the takes follow every context take (made_from) and pin the Cast": R.landed?.takes?.every((t) => t.made_from.includes("take-u101-video") && t.world.includes(R.cast.cast)),
      "the Work card folds it as a paint": R.landed?.activity === "paint",
      "apply makes the candidate the shot's take, undo puts the old one back": R.active === R.landed?.takes?.[1]?.id && R.activeAfterUndo !== R.active,
      "list_candidates kind view lists it": R.listed.includes(R.view?.decision),
      "the tray: this picture, a marked region, a Cast picture, what Picture 1 is": R.rows?.length === 3 && /^Picture 1 is the picture edited · take \d+$/.test(R.rows[0]) && /marked region/.test(R.rows[1]) && /Maren, identity: front/.test(R.rows[2]),
      "↑ moves a picture and renumbers": /^Picture 2 · Maren/.test(R.rowsMoved?.[1] ?? "") && /marked region/.test(R.rowsMoved?.[2] ?? ""),
      "Make sends the tray in its order and says where it lands": /Painting 2 candidates into Shot 1 · C2 of U101 gate/.test(R.made?.note ?? "") && JSON.stringify(R.made?.order) === JSON.stringify([R.rows?.[0]?.replace(/^Picture 1 is the picture edited · /, ""), "Maren, identity: front", R.rows?.[1]?.replace(/^Picture 2 · /, "")]),
      "✕ takes a picture out": R.rowsAfterRemove?.length === 2 && /^Picture 1 is the picture edited · Maren/.test(R.rowsAfterRemove[0]),
      "no stray null in the tray": R.trayNull === false,
      "Load Audio lists input/snap/ audio (F-C08)": R.audioChoices.includes("snap/snaptest_u101_voice.wav"),
      "add_audio_ref answers <Audio 1>, then <Audio 2>": R.a1?.cite === "<Audio 1>" && R.a2?.cite === "<Audio 2>" && /isn't in this server's input folder/.test(R.aMissing?.error ?? ""),
      "the Load Audio nodes feed H3 References' ref_audios": JSON.stringify(R.wired) === JSON.stringify([["ref_audios.ref_audio_0", "LoadAudio", "snap/snaptest_u101_voice.wav"], ["ref_audios.ref_audio_1", "LoadAudio", "snap/snaptest_u101_voice2.wav"]]),
      "describe_recipe lists references with their cites": R.describeRefs?.audio?.map((a) => a.cite).join() === "<Audio 1>,<Audio 2>",
      "remove renumbers": R.removed?.references?.audio?.length === 1 && R.removed.references.audio[0].cite === "<Audio 1>" && R.removed.references.audio[0].file === "snap/snaptest_u101_voice2.wav",
      "a Cast's voice is saved, a missing voice file is refused naming it": R.cv?.version === 2 && /voice reference "snap\/no_voice.wav"/.test(R.cvMissing?.error ?? ""),
      "apply_cast puts the voice in and says its <Audio n>": /voice reference as <Audio 2>/.test(R.applied?.done ?? "") && R.afterCast?.some((a) => a.file === "snap/snaptest_u101_voice.wav" && a.role === "cast: Maren, voice"),
      "References shows each <Audio n>, no stray null": R.face?.length === 2 && R.face.every((t) => /^<Audio \d>/.test(t) && !/null|undefined/.test(t)),
      "a version without a voice takes it out": R.cv2?.version === 3 && !(R.afterNoVoice ?? []).some((a) => a.role === "cast: Maren, voice"),
      "no page errors": !A.errors.length,
    };
    console.log(JSON.stringify(R, null, 1));
    let bad = 0;
    for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
    console.log(`u101     ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
    process.exitCode = bad ? 1 : 0;
  } finally {
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `u101-${Date.now()}`);
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
})().catch((e) => { console.error(e); process.exit(2); });
