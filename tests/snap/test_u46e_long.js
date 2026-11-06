// U46e/U46g code (SNAP-R64) on the CPU test server: the extend slot's Long method and the default by length. Long is
// Standard's carry plus Geiru's keystone front + capstone back from the take's first clip on every 3rd clip (shots 3, 6 …;
// the take is shot 1), Context's protection flag on and hold_audio off on exactly those clips, and nothing else of Strong
// (no Late Lock, context noise, protection LoRA or Anti-Burn). The slot's default follows the length: Standard up to 40 s,
// Long beyond, Strong only when picked; the viewer says why, and keeps the person's pick once they make one. Builds graphs
// only: the page's POST /prompt for them is held and answered with a fake id (as test_u46c_extend.js does).
// Screenshots: ui/350-u46e-long-default.png (desktop), 351-u46e-long-phone.png (390 px), 352-u46e-extend-methods.png.
// usage: node test_u46e_long.js [port 8195] [base dir]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const base = process.argv[3] || CFG.base;
const FILES = ["diffusion_models/h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors", "loras/pika_h3_flex_fl2va_v1_bf16.safetensors", "loras/h3_antiburn_universal_v1.safetensors",
  "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "vae/minimax_h3_video_vae_fp16.safetensors", "vae/minimax_h3_audio_vae_fp32.safetensors"];
const GEIRU = ["H3ClownContextExperimental", "H3ClownKeyframe", "H3ClownLateLock", "H3ClownContextNoise", "H3ClownProtectionLora"];
(async () => {
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=5", path.join(base, "input", "snaptest_u46e.wav")]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }), page = await ctx.newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    const held = [];
    await page.route(/\/api\/prompt$/, (r) => { const body = r.request().method() === "POST" && JSON.parse(r.request().postData()); if (!body || !body.prompt?.tailav) return r.continue(); held.push(body); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prompt_id: `held-${held.length}`, number: 0, node_errors: {} }) }); });
    await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
    await page.evaluate(async (geiru) => { for (const t of geiru) LiteGraph.registered_node_types[t] ??= class {}; app.graph.clear(); app.graph.extra = {}; window.__X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); await window.__X.callTool("start_recipe", {}); }, GEIRU);
    // a 107-frame take with sound, its prompt saying the render's size and length as an H3 take's does
    R.take = await page.evaluate(async () => {
      const K = await import("/extensions/ComfyUI-MAINodes/snap/checks.js"), T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
      const id = await K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 107, color: 3355443 } }, 2: { class_type: "LoadAudio", inputs: { audio: "snaptest_u46e.wav" } },
        3: { class_type: "CreateVideo", inputs: { images: ["1", 0], audio: ["2", 0], fps: 24 } }, 4: { class_type: "SaveVideo", inputs: { video: ["3", 0], filename_prefix: "snaptest/u46e", format: "auto", "format.codec": "auto", codec: "auto" } },
        5: { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "integrated_multimodal_description: [Shot 1] A woman walks round a fountain.\n\noverall_soundscape: shoes on cobbles", width: 64, height: 64, length: 107 } } }, { job: { kind: "run", title: "a test fixture take (SNAP-R65: every queued prompt carries its question)" }, group: app.graph.id });
      for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((r) => setTimeout(r, 500));
      return T.get(`take-${id}`)?.id ?? null;
    });
    const listed = await page.evaluate(() => window.__X.callTool("list_methods", { slot: "extend" }));
    R.methods = listed.methods.map((m) => [m.id, m.title, m.face, m.wired, m.install_state, m.guidance?.evidence, m.cost?.local_s_per_clip]);
    R.defaults = listed.defaults;
    R.picks = await page.evaluate(async (id) => { const T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js"), EX = await import("/extensions/ComfyUI-MAINodes/snap/extend.js"); return [1, 8, 9, 24].map((n) => ({ clips: n, ...EX.pick(T.get(id), n) })); }, R.take);
    await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true));
    const run = (args) => page.evaluate(([take, a]) => window.__X.callTool("edit_take", { take, ...a }), [R.take, args]);
    R.long6 = await run({ method: "long", clips: 6 });
    R.long1 = await run({ method: "long", clips: 1 });
    // no method named: the length decides (1 clip = 8.7 s Standard, 9 clips = 42.7 s Long)
    R.auto = await page.evaluate(async (id) => { const T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js"), EX = await import("/extensions/ComfyUI-MAINodes/snap/extend.js"); return [await EX.start(T.get(id), undefined, { clips: 1 }), await EX.start(T.get(id), undefined, { clips: 9 })]; }, R.take);
    // Anti-Burn is Standard's slider: a value left on it (or passed by an agent) never reaches Long
    R.burnLong = await run({ method: "long", clips: 1, antiburn: 0.3 });
    const gb = held[4]?.prompt;
    R.burn_graph = gb ? { lora: Object.values(gb).filter((n) => n.class_type === "LoraLoaderModelOnly").length, options: held[4].extra_data.snap_parent.options } : null;
    const [g6, g1] = held.map((x) => x.prompt), types = (g) => Object.values(g).map((n) => n.class_type), count = (g, t) => types(g).filter((x) => x === t).length;
    R.graphs = held.length;
    R.long_graph = {
      clips: [1, 2, 3, 4, 5, 6].map((k) => ({ k, hold_audio: g6[`cx${k}`].inputs.hold_audio, protection: g6[`cx${k}`].inputs.degradation_protection, keystone: g6[`ky${k}`]?.inputs ?? null, guided: g6[`gd${k}`].inputs.model, latent: g6[`s${k}`].inputs.latent_image })),
      encodes: count(g6, "VAEEncode"), anchor: g6.anc?.inputs, anchorEncode: g6.ancv?.inputs.pixels, seams: count(g6, "H3SeamNormalize"),
      scale: g6.srcs?.inputs, fromScaled: ["tail", "keep0", "held0", "anc"].map((n) => JSON.stringify(g6[n]?.inputs.image)), strongParts: types(g6).filter((t) => /Clown(LateLock|ContextNoise|ProtectionLora)|LoraLoaderModelOnly/.test(t)).length, parent: held[0].extra_data.snap_parent };
    R.long1_graph = { encodes: count(g1, "VAEEncode"), keystones: count(g1, "H3ClownKeyframe"), anchor: !!g1.anc, hold: g1.cx1.inputs.hold_audio };
    R.auto_methods = held.slice(2, 4).map((x) => x.extra_data.snap_parent.method);
    // the viewer: the pick follows the length and says why, until the person picks
    await page.evaluate(() => document.querySelector(".snap-takes")?.scrollIntoView());
    await page.click(`.snap-take[data-take="${R.take}"]`); await page.waitForTimeout(900);
    const row = () => page.evaluate(() => ({ pick: document.querySelector('select[aria-label="how to make it longer"]')?.value, why: document.querySelector(".snap-take-why")?.textContent,
      button: [...document.querySelectorAll(".snap-take-sheet button.snap-primary")].find((x) => /^Make it/.test(x.textContent))?.textContent ?? null,
      options: [...document.querySelectorAll('select[aria-label="how to make it longer"] option')].map((o) => o.textContent) }));
    R.viewer1 = await row();
    await page.fill(".snap-take-clips", "9"); await page.waitForTimeout(200);
    R.viewer9 = await row();
    await page.evaluate(() => document.querySelector(".snap-take-why")?.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: path.join(out, "350-u46e-long-default.png") });
    await page.selectOption('select[aria-label="how to make it longer"]', "geiru"); await page.waitForTimeout(200);
    await page.fill(".snap-take-clips", "2"); await page.waitForTimeout(200);
    R.viewerPicked = await row();
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    await page.evaluate(() => window.__X.callTool("ui", { action: "methods", target: "extend" })); await page.waitForTimeout(600);
    R.sheet = await page.$$eval(".snap-extend-sheet .snap-setup-card", (els) => els.map((e) => [e.querySelector("strong").textContent, e.querySelector(".snap-face-line")?.textContent ?? null]));
    R.sheetDefaults = await page.$eval(".snap-extend-sheet .snap-method-defaults", (e) => e.textContent).catch(() => null);
    await page.screenshot({ path: path.join(out, "352-u46e-extend-methods.png") });
    // 390 px: the same page narrowed, the viewer's Make it longer row with the why line
    await page.evaluate(() => window.__X.callTool("ui", { action: "close" })); await page.waitForTimeout(400);
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector(".snap-takes")?.scrollIntoView()); await page.click(`.snap-take[data-take="${R.take}"]`); await page.waitForTimeout(900);
    await page.fill(".snap-take-clips", "9"); await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelector(".snap-take-why")?.scrollIntoView({ block: "center" }));
    R.phone = await page.evaluate(() => { const w = document.querySelector(".snap-take-why"), r = w?.getBoundingClientRect(); return { why: w?.textContent ?? null, inside: !!r && r.left >= 0 && r.right <= innerWidth, scrollX: document.documentElement.scrollWidth - innerWidth }; });
    await page.screenshot({ path: path.join(out, "351-u46e-long-phone.png") });
    R.errors = errs;
  } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "false" }); // a remembered setting: later suites expect proposals
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `u46e-${Date.now()}`);
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
  const L = R.long_graph, anchors = L ? L.clips.filter((c) => c.keystone) : [], plain = L ? L.clips.filter((c) => !c.keystone) : [];
  const c = {
    "three methods in order, Long between Standard and Strong, faces with their reason": JSON.stringify(R.methods.map((m) => m.slice(0, 4))) === JSON.stringify([["chain", "Standard", "colour holds, good to ~40 s", true], ["long", "Long", "keeps the face and the sound for 2 minutes", true], ["geiru", "Strong (Geiru)", "keeps the look, may reset the action", true]]),
    "Long ready from its node types and weights, measured guidance, Standard's cost": R.methods[1][4] === "ready" && R.methods[1][5] === "measured" && R.methods[1][6] === R.methods[0][6],
    "list_methods gives the length defaults with reasons": R.defaults?.length === 2 && R.defaults[0].method === "chain" && R.defaults[0].up_to_s === 40 && R.defaults[1].method === "long" && /40 s/.test(R.defaults[1].why),
    "pick by length: 8.7 s and 38.5 s Standard, 42.7 s and 106.5 s Long": JSON.stringify(R.picks.map((p) => [p.clips, p.method, p.seconds])) === JSON.stringify([[1, "chain", 8.7], [8, "chain", 38.5], [9, "long", 42.7], [24, "long", 106.5]]),
    "Long, 6 clips: re-anchored on shots 3 and 6 only (new clips 2 and 5)": JSON.stringify(anchors.map((x) => x.k)) === "[2,5]",
    "anchor clips: protection on, hold_audio off, keystone front + capstone back from the take's first clip, sampled through it": anchors.every((x) => x.protection === true && x.hold_audio === false && x.keystone.placement === "keystone front + capstone back" && x.keystone.source_clip === 1 && JSON.stringify(x.keystone.keyframe) === '["ancv",0]' && JSON.stringify(x.keystone.model) === '["rp",0]' && JSON.stringify(x.guided) === `["ky${x.k}",1]` && JSON.stringify(x.latent) === `["ky${x.k}",0]`),
    "other clips: plain Standard (protection off, sound carried)": plain.length === 4 && plain.every((x) => x.protection === false && x.hold_audio === true && JSON.stringify(x.guided) === '["rp",0]'),
    "the anchor is the take's first clip, encoded once; nothing else of Strong": L?.encodes === 2 && L.anchor?.batch_index === 0 && L.anchor?.length === 107 && JSON.stringify(L.anchorEncode) === '["anc",0]' && L.strongParts === 0 && L.seams === 6,
    "an upscaled take's frames are scaled to its render size first (carry, anchor and join at one size)": L?.scale?.width === 64 && L.scale.height === 64 && L.fromScaled.every((x) => x === '["srcs",0]'),
    "lands as a version: extend/long": L?.parent.method === "extend/long" && L.parent.take === R.take,
    "Long, 1 clip: nothing to anchor, no extra encode": R.long1_graph?.encodes === 1 && R.long1_graph.keystones === 0 && !R.long1_graph.anchor && R.long1_graph.hold === true,
    "no method named: the length decides": JSON.stringify(R.auto_methods) === '["extend/chain","extend/long"]' && R.graphs === 5,
    "Anti-Burn never reaches Long (no LoRA, not recorded)": R.burn_graph?.lora === 0 && !("antiburn" in R.burn_graph.options),
    "viewer: Standard for 8.7 s, says why": R.viewer1.pick === "chain" && /^Standard for 8\.7 s: it holds the look up to about 40 s/.test(R.viewer1.why ?? "") && R.viewer1.options.includes("Long · keeps the face and the sound for 2 minutes"),
    "viewer: 9 clips switch to Long, says why": R.viewer9.pick === "long" && /^Long for 42\.7 s: past about 40 s Standard grows a mosaic texture/.test(R.viewer9.why ?? "") && R.viewer9.button?.startsWith("Make it 42.7 s (+"),
    "viewer: the person's pick stays and is named as theirs": R.viewerPicked.pick === "geiru" && /^Strong \(Geiru\): your pick \(for 13 s Snap picks Standard/.test(R.viewerPicked.why ?? ""),
    "methods sheet: three cards and the length rule": R.sheet.length === 3 && R.sheet[1][0].startsWith("Long") && R.sheetDefaults === "Picked by length: Standard up to 40 s, Long beyond; the others are yours to pick in the take viewer",
    "390 px: the why line fits, no sideways scroll": R.phone?.inside === true && R.phone.scrollX <= 0 && /^Long for 42\.7 s/.test(R.phone.why ?? ""),
    "no page errors": !R.errors.length };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_u46e_long_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`u46e     ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
