// U46c (SNAP-R50) on the CPU test server: the extend slot's two methods, wired. Standard carries the sampler's latent:
// the take's last 39 frames are encoded once (one VAEEncode in the whole graph), clip 1 continues from them and clip k
// from clip k-1's sampler output; Seam Normalize per clip; Anti-Burn only when its slider is above 0. Strong adds Geiru's
// keystone (from the take's end), late lock, context noise and protection. The take viewer's "Make it longer" button says
// the length it makes; the methods sheet shows each face. Builds graphs only: the page's POST /prompt for them is held and
// answered with a fake id (the real graph ran on :8193, U46c GPU check). Geiru's node types are registered in the page
// (as test_u58.js does) and the H3 files are empty placeholders, parked afterwards (moved, never deleted).
// Screenshots: ui/263-u46c-make-it-longer.png, ui/264-u46c-extend-methods.png.
// usage: node test_u46c_extend.js [port 8195] [base dir]
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
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=5", path.join(base, "input", "snaptest_u46c.wav")]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    const held = [];
    await page.route(/\/api\/prompt$/, (r) => { const body = r.request().method() === "POST" && JSON.parse(r.request().postData()); if (!body || !body.prompt?.tailav) return r.continue(); held.push(body); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prompt_id: `held-${held.length}`, number: 0, node_errors: {} }) }); });
    await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
    await page.evaluate(async (geiru) => { for (const t of geiru) LiteGraph.registered_node_types[t] ??= class {}; app.graph.clear(); app.graph.extra = {}; window.__X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); await window.__X.callTool("start_recipe", {}); }, GEIRU);
    // a 107-frame take with sound, its prompt saying the render's size and length as an H3 take's does
    R.take = await page.evaluate(async () => {
      const K = await import("/extensions/ComfyUI-MAINodes/snap/checks.js"), T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
      const id = await K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 107, color: 3355443 } }, 2: { class_type: "LoadAudio", inputs: { audio: "snaptest_u46c.wav" } },
        3: { class_type: "CreateVideo", inputs: { images: ["1", 0], audio: ["2", 0], fps: 24 } }, 4: { class_type: "SaveVideo", inputs: { video: ["3", 0], filename_prefix: "snaptest/u46c", format: "auto", "format.codec": "auto", codec: "auto" } },
        5: { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "integrated_multimodal_description: [Shot 1] A lighthouse keeper climbs the stairs.\n\noverall_soundscape: boots on iron steps", width: 64, height: 64, length: 107 } } }, { job: { kind: "run", title: "a test fixture take (SNAP-R65: every queued prompt carries its question)" }, group: app.graph.id });
      for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((r) => setTimeout(r, 500));
      return T.get(`take-${id}`)?.id ?? null;
    });
    R.methods = (await page.evaluate(() => window.__X.callTool("list_methods", { slot: "extend" }))).methods.map((m) => [m.id, m.title, m.face, m.wired, m.install_state]);
    R.length = await page.evaluate(async (id) => { const T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js"), EX = await import("/extensions/ComfyUI-MAINodes/snap/extend.js"); return [1, 2, 8].map((n) => EX.length(T.get(id), n)); }, R.take);
    const run = (args) => page.evaluate(([take, a]) => window.__X.callTool("edit_take", { take, ...a }), [R.take, args]);
    await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true));
    R.std = await run({ method: "chain", clips: 2 });
    R.burn = await run({ method: "chain", clips: 1, antiburn: 0.3 });
    R.strong = await run({ method: "geiru", clips: 1 });
    const [g1, g2, g3] = held.map((x) => x.prompt), types = (g) => Object.values(g).map((n) => n.class_type), count = (g, t) => types(g).filter((x) => x === t).length;
    R.graphs = held.length;
    R.std_graph = { encodes: count(g1, "VAEEncode"), seams: count(g1, "H3SeamNormalize"), samplers: count(g1, "SamplerCustomAdvanced"), lora: count(g1, "LoraLoaderModelOnly"), tail: g1.tail.inputs,
      prev: [g1.cx1.inputs.previous_shot, g1.cx2.inputs.previous_shot], protection: g1.cx1.inputs.degradation_protection, geiru: types(g1).filter((t) => /Clown(Keyframe|LateLock)/.test(t)).length,
      prompt: g1.c1.inputs.prompt, parent: held[0].extra_data.snap_parent, keep0: g1.keep0.inputs.length, last: g1.kp2.inputs };
    R.burn_graph = { lora: g2.abm?.inputs, guided: g2.gd1.inputs.model };
    R.strong_graph = { protection: g3.cx1.inputs.degradation_protection, keyframe: g3.ky1?.inputs.keyframe, lateLock: g3.ll1?.inputs.swap_step, ab: g3.pr1?.inputs.strength, guided: g3.gd1.inputs.model };
    // the viewer: the Make it longer row says the length it makes
    await page.evaluate(() => document.querySelector(".snap-takes")?.scrollIntoView());
    await page.click(`.snap-take[data-take="${R.take}"]`); await page.waitForTimeout(900);
    const row = () => page.evaluate(() => { const b = [...document.querySelectorAll(".snap-take-sheet button.snap-primary")].find((x) => /^Make it/.test(x.textContent));
      return { button: b?.textContent ?? null, disabled: b?.disabled, options: [...document.querySelectorAll('select[aria-label="how to make it longer"] option')].map((o) => o.textContent), burnHidden: document.querySelector(".snap-take-burn")?.hidden }; });
    R.viewer = await row();
    await page.fill(".snap-take-clips", "3"); await page.waitForTimeout(200);
    R.viewer3 = await row();
    await page.evaluate(() => document.querySelector(".snap-take-burn")?.scrollIntoView({ block: "center" }));
    await page.screenshot({ path: path.join(out, "263-u46c-make-it-longer.png") });
    await page.selectOption('select[aria-label="how to make it longer"]', "geiru"); await page.waitForTimeout(200);
    R.viewerStrong = await row();
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    await page.evaluate(() => window.__X.callTool("ui", { action: "methods", target: "extend" })); await page.waitForTimeout(600);
    R.sheet = await page.$$eval(".snap-extend-sheet .snap-setup-card", (els) => els.map((e) => [e.querySelector("strong").textContent, e.querySelector(".snap-face-line")?.textContent ?? null, e.title]));
    await page.screenshot({ path: path.join(out, "264-u46c-extend-methods.png") });
    R.errors = errs;
  } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "false" }); // a remembered setting: later suites expect proposals
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `u46c-${Date.now()}`);
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
  const s = R.std_graph, c = {
    "Standard and Strong wired with their faces (Long: test_u46e_long.js)": JSON.stringify(R.methods.filter((m) => m[0] !== "long").map((m) => m.slice(0, 4))) === JSON.stringify([["chain", "Standard", "colour holds, good to ~40 s", true], ["geiru", "Strong (Geiru)", "keeps the look, may reset the action", true]]),
    "lengths: 107 frames + 1, 2, 8 clips": JSON.stringify(R.length.map((l) => l.frames)) === JSON.stringify([209, 311, 923]) && R.length[1].seconds === 13 && R.length[1].added === 8.5,
    "three graphs built, none queued from the page": R.graphs === 3 && [R.std, R.burn, R.strong].every((r) => /^held-/.test(r.prompt_id)),
    "Standard: one encode (the take's last 39 frames), clip 2 carries clip 1's sampler latent": s.encodes === 1 && s.tail.batch_index === 68 && s.tail.length === 39 && JSON.stringify(s.prev) === JSON.stringify([["tailav", 0], ["s1", 0]]),
    "Standard: Seam Normalize per clip, protection off, no Anti-Burn, no Geiru protection nodes": s.seams === 2 && s.samplers === 2 && s.protection === false && s.lora === 0 && s.geiru === 0,
    "Standard: joins keep 90 + 102 + 119 frames": s.keep0 === 90 && s.last.batch_index === 22 && s.last.length === 119,
    "continuation prompt says no cut and keeps the soundscape": /continues without a cut: A lighthouse keeper climbs the stairs\./.test(s.prompt) && /Sounds continue without a fresh start: boots on iron steps/.test(s.prompt),
    "lands as a version of the take": s.parent.take === R.take && s.parent.method === "extend/chain" && s.parent.options.clips === 2,
    "Anti-Burn only above 0, at its strength": R.burn_graph.lora?.strength_model === 0.3 && /antiburn/.test(R.burn_graph.lora.lora_name) && JSON.stringify(R.burn_graph.guided) === '["abm",0]',
    "Strong: keystone from the take's end, late lock 3, Anti-Burn 0.5, protection on": R.strong_graph.protection === true && JSON.stringify(R.strong_graph.keyframe) === '["tailav",0]' && R.strong_graph.lateLock === 3 && R.strong_graph.ab === 0.5 && JSON.stringify(R.strong_graph.guided) === '["ll1",0]',
    "viewer button says the length it makes": R.viewer.button === "Make it 8.7 s (+4.3 s)" && R.viewer.disabled === false && R.viewer3.button === "Make it 17.2 s (+12.8 s)" && R.viewer.burnHidden === false,
    "Strong in the viewer: its face, no Anti-Burn slider": R.viewer.options.includes("Strong (Geiru) · keeps the look, may reset the action") && R.viewerStrong.burnHidden === true,
    "methods sheet shows the faces, Strong's credit as its tooltip": R.sheet.length === 3 && R.sheet[2][1] === "keeps the look, may reset the action" && /Powered by Geiru/.test(R.sheet[2][2]),
    "no page errors": !R.errors.length };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_u46c_extend_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`u46c     ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
