// U73 (SNAP-R51) on the CPU test server: Change something and Recast in the method registry. relight is "Change
// something · Ripple" (night an example: its paint prompt is the same words as before), remake_edit paints the frames
// asked for and pins them, remake_swap needs who and who instead, says "X → Y", gets a "new person" note, and runs on a
// private take like any other; "pin at frame N" off makes the painted frames references only; the lighter LoRA is the
// rank-128 file; a method's credit is its tooltip. Builds graphs only: the page's POST /prompt is held and answered with a
// fake id (the real recast ran on :8193). The Remake node types are registered in the page (as test_u58.js does) and the
// model files are empty placeholders, parked afterwards (moved, never deleted).
// Screenshots: ui/267-u73-change-and-recast.png, ui/268-u73-recast-candidate.png.
// usage: node test_u73_methods.js [port 8195] [base dir]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const base = process.argv[3] || CFG.base;
const FILES = ["diffusion_models/moss_image_sft_int8_convrot.safetensors", "text_encoders/qwen3.5_9b_int8_convrot.safetensors", "vae/flux2-vae.safetensors",
  "loras/akhaliq_moss_edit_hq_armV5.safetensors", "loras/chinoll_moss_image_edit_adapter.safetensors", "loras/minimax_H3_Ripple-v1.safetensors",
  "loras/minimax_h3_fl2v_lightx2v_turbo_4step_v1.0_768p_resized_avg_rank_31_bf16.safetensors", "diffusion_models/h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "vae/minimax_h3_video_vae_fp16.safetensors", "vae/minimax_h3_audio_vae_fp32.safetensors",
  ...["edit", "edit_r128", "swap", "swap_r128"].map((x) => `loras/h3/viggle_remake/viggle_remake_${x}_comfyui.safetensors`)];
const REMAKE = ["RemakeConditioning", "RemakeKeyframeUntil", "RemakeNoise"];
(async () => {
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=5", path.join(base, "input", "snaptest_u73.wav")]);
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x404060:s=64x64", "-frames:v", "1", path.join(base, "input", "snaptest_u73_paint.png")]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    const held = [];
    await page.route(/\/api\/prompt$/, (r) => { const body = r.request().method() === "POST" && JSON.parse(r.request().postData());
      if (!body || !Object.values(body.prompt).some((n) => /TextEncodeMOSSImageEdit|RemakeConditioning|MiniMaxH3AddGuide/.test(n.class_type))) return r.continue();
      held.push(body); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prompt_id: `held-${held.length}`, number: 0, node_errors: {} }) }); });
    await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
    await page.evaluate(async (nodes) => { for (const t of nodes) LiteGraph.registered_node_types[t] ??= class {}; app.graph.clear(); app.graph.extra = {};
      window.__X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); await window.__X.callTool("start_recipe", {}); await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); }, REMAKE);
    R.take = await page.evaluate(async () => {
      const K = await import("/extensions/ComfyUI-MAINodes/snap/checks.js"), T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
      const id = await K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 107, color: 3355443 } }, 2: { class_type: "LoadAudio", inputs: { audio: "snaptest_u73.wav" } },
        3: { class_type: "CreateVideo", inputs: { images: ["1", 0], audio: ["2", 0], fps: 24 } }, 4: { class_type: "SaveVideo", inputs: { video: ["3", 0], filename_prefix: "snaptest/u73", format: "auto", "format.codec": "auto", codec: "auto" } },
        5: { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "A woman in a red coat waits on a platform", width: 64, height: 64, length: 107 } } }, { job: { kind: "run", title: "a test fixture take (SNAP-R65: every queued prompt carries its question)" }, group: app.graph.id });
      for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((r) => setTimeout(r, 500));
      const t = T.get(`take-${id}`); t.private = true; // nothing is refused on a private take
      return t.id;
    });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    R.edit = (await call("list_methods", { slot: "edit" })).methods.map((m) => [m.id, m.title, m.face, m.install_state, m.credit ?? null]);
    R.recastSlot = await call("list_methods", { slot: "recast" });
    let n = held.length;
    R.night = await call("edit_take", { take: R.take, method: "relight", example: "night", count: 1 });
    // batch E: the face check is muted only for a change that relights (an example whose `does` is relight), never for
    // words like the operator's "make her jacket sparkle magic" on the same method (U56 calibrated the mute on night only)
    R.nightOptions = await page.evaluate(async (id) => { const C = await import("/extensions/ComfyUI-MAINodes/snap/candidates.js"); await C.load(); return C.get(id)?.options ?? null; }, R.night.decision);
    R.does = await page.evaluate(async () => { const ED = await import("/extensions/ComfyUI-MAINodes/snap/edits.js");
      return Promise.all([["relight", { example: "night" }], ["relight", { change: "make her jacket sparkle magic", label: "make her jacket sparkle magic" }], ["remake_edit", { example: "night" }], ["remake_edit", { example: "rain" }], ["remake_swap", { who: "a", becomes: "b" }]]
        .map(([method, options]) => ED.does({ method, options }).catch((e) => `error: ${e.message}`))); });
    R.nightPaint = held.slice(n).map((x) => Object.values(x.prompt).filter((v) => v.class_type === "TextEncodeMOSSImageEdit").map((v) => v.inputs.prompt)[0]); n = held.length;
    R.booth = await call("edit_take", { take: R.take, method: "remake_edit", change: "the benches into a yellow phone booth", frames: [90, 20], count: 1 });
    R.boothFrames = held.slice(n).map((x) => Object.values(x.prompt).filter((v) => v.class_type === "ImageFromBatch").map((v) => v.inputs.batch_index)); n = held.length;
    R.tooMany = await call("edit_take", { take: R.take, method: "remake_edit", change: "a lamp post", frames: [1, 2, 3, 4, 5], count: 1 });
    R.noWho = await call("edit_take", { take: R.take, method: "remake_swap", becomes: "an old man", count: 1 });
    R.swap = await call("edit_take", { take: R.take, method: "remake_swap", who: "the woman in the red coat", becomes: "a bald man with a grey beard", count: 1 });
    R.swapPaint = held.slice(n).map((x) => Object.values(x.prompt).filter((v) => v.class_type === "TextEncodeMOSSImageEdit").map((v) => v.inputs.prompt)[0]); n = held.length;
    // a ready recast candidate (its painted frame given), its note, then applied unpinned and lighter
    R.recast = await page.evaluate(async (take) => {
      const T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js"), C = await import("/extensions/ComfyUI-MAINodes/snap/candidates.js"), ED = await import("/extensions/ComfyUI-MAINodes/snap/edits.js");
      await C.load(); const t = T.get(take);
      const d = await C.create({ kind: "edit", target: take, title: "Recast · Viggle Remake (the woman → a bald man) of take 1", take, method: "remake_swap",
        options: { who: "the woman", becomes: "a bald man", label: "the woman → a bald man", lighter: true }, clip: ED.clip(t) },
        [{ seed: 7, take, frame: [53], pin: true, pictures: [{ label: "frame 53", frame: 53, media: { filename: "snaptest_u73_paint.png", subfolder: "", type: "input" } }] }]);
      await ED.recheck(d.id);
      return { id: d.id, note: C.get(d.id).candidates[0].notes.identity };
    }, R.take);
    await page.evaluate((id) => window.__X.callTool("ui", { action: "open_take", target: id }), R.take); await page.waitForTimeout(1000);
    R.pinBox = await page.evaluate(() => document.querySelector(".snap-cand-pin")?.textContent ?? null);
    await page.evaluate(() => document.querySelector(".snap-cand-pin")?.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: path.join(out, "268-u73-recast-candidate.png") });
    R.notes = await page.evaluate(() => [...document.querySelectorAll(".snap-take-sheet [role=status]")].map((x) => x.textContent));
    R.viewer = await page.evaluate(() => ({ titles: [...document.querySelectorAll(".snap-take-sheet .snap-rail-title")].map((x) => x.textContent),
      edit: [...document.querySelectorAll('select[aria-label="edit method"] option')].map((o) => o.textContent), examples: [...document.querySelectorAll('select[aria-label="example"] option')].map((o) => o.textContent) }));
    await page.selectOption('select[aria-label="edit method"]', "remake_edit"); await page.waitForTimeout(200);
    R.creditTip = await page.evaluate(() => document.querySelector('select[aria-label="edit method"]').title);
    await page.evaluate(() => document.querySelector('select[aria-label="recast method"]')?.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: path.join(out, "267-u73-change-and-recast.png") });
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    n = held.length;
    R.applied = await call("apply_candidate", { decision: R.recast.id, candidate: "c1", pin: false });
    const g = held[n]?.prompt;
    R.remake = g && { pins: g["11"].inputs.pins, lora: g["2"].inputs.lora_name, refs: Object.keys(g["11"].inputs).filter((k) => k.startsWith("ref_")), prompt: g["11"].inputs.prompt, parent: held[n].extra_data.snap_parent };
    // a version names what made it: "X → Y"
    R.version = await page.evaluate(async (take) => {
      const K = await import("/extensions/ComfyUI-MAINodes/snap/checks.js"), T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
      const id = await K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 0 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/u73v" } } },
        { job: { kind: "propagate", title: "a test fixture recast take" }, group: app.graph.id, extra: { snap_parent: { take, method: "recast/remake_swap", options: { who: "the woman", becomes: "a bald man", label: "the woman → a bald man" } } } });
      for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((r) => setTimeout(r, 500));
      await new Promise((r) => setTimeout(r, 600));
      return { id: `take-${id}`, card: document.querySelector(`.snap-take[data-take="take-${id}"] .snap-take-parent`)?.textContent ?? null };
    }, R.take);
    await page.evaluate(() => window.__X.callTool("ui", { action: "methods", target: "edit" })); await page.waitForTimeout(500);
    R.sheet = await page.$$eval(".snap-edit-sheet .snap-setup-card", (els) => els.map((e) => [e.querySelector("strong").textContent, e.querySelector(".snap-face-line")?.textContent ?? null, e.title]));
    R.errors = errs;
  } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "false" }); // a remembered setting: later suites expect proposals
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `u73-${Date.now()}`);
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
  const CREDIT = "Powered by Viggle Remake (https://huggingface.co/Viggle/Viggle-Remake) · MiniMax H3", c = {
    "edit slot: Change something · Ripple and · Viggle Remake, ready, Remake credited": JSON.stringify(R.edit.map((m) => [m[0], m[1], m[3]])) === JSON.stringify([["relight", "Change something · Ripple", "ready"], ["remake_edit", "Change something · Viggle Remake", "ready"]]) && R.edit[1][4]?.startsWith("Viggle Remake"),
    "recast slot with remake_swap": R.recastSlot.kind === "take" && R.recastSlot.methods.map((m) => m.id).join() === "remake_swap",
    "night is an example: same paint words as before": R.nightPaint[0]?.startsWith("Change only the time of day to night: a dark night sky, dim cool moonlight") && R.night.candidates?.[0].frames.length === 2,
    "an example's name is kept on the decision (options.example night)": R.nightOptions?.example === "night",
    "the face check is muted for a relight only: night relights; written words, rain and a recast don't": JSON.stringify(R.does) === JSON.stringify(["relight", "edit", "relight", "edit", "recast"]),
    "remake_edit paints the asked frames, sorted, pinned": JSON.stringify(R.boothFrames[0]) === "[20,90]" && R.booth.candidates[0].pin === true && JSON.stringify(R.booth.candidates[0].frames) === "[20,90]",
    "more than 4 painted frames: Remake's limit, said": /up to 4 painted frames/.test(R.tooMany.error ?? ""),
    "recast needs who and who instead": /say who is in the take now/.test(R.noWho.error ?? ""),
    "recast paints the swap, on a private take": R.swapPaint[0]?.startsWith("Replace the woman in the red coat with a different person: a bald man with a grey beard") && !!R.swap.decision,
    "recast note is new person, no face check": R.recast.note?.new_person === "recast" && !("face_low" in (R.recast.note ?? {})),
    "candidate tile offers pin at frame 53": /pin at frame 53/.test(R.pinBox ?? ""),
    "pin off: no pins, pictures as references": R.remake?.pins === "" && /<Picture 1> shows how the target video looks after the edit/.test(R.remake.prompt) && R.remake.refs.join() === "ref_1",
    "lighter: the rank-128 swap LoRA": /viggle_remake_swap_r128_comfyui/.test(R.remake?.lora ?? ""),
    "recast prompt names who and who instead, six sections": /This person replaces the woman in <Video 1>/.test(R.remake?.prompt ?? "") && /non_diegetic_music/.test(R.remake.prompt) && R.remake.parent.method === "recast/remake_swap",
    "viewer: Change something and Recast a person, examples": R.viewer.titles.includes("Change something") && R.viewer.titles.includes("Recast a person") && R.viewer.examples.includes("e.g. night"),
    "credit is the tooltip while the method is picked": R.creditTip === CREDIT && R.sheet.some((s) => s[2] === CREDIT),
    "a recast version is named X → Y": (R.version.card ?? "").includes("the woman → a bald man of take"),
    "no page errors": !R.errors.length };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_u73_methods_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`u73      ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
