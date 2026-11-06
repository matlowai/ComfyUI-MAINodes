// Batch D (a): extending a Ref2V take keeps "<Picture N>" in the continuation prompt although the extend graph wires no
// pictures (batch C's GPU check, the Mara take). The continuation prompt now names a Cast picture's person instead (the
// role "cast: Mara, …" says who; "<Picture 1> Ana" reads "Ana") and leaves out a sentence that only points at another
// picture (a set plate's "shown in <Picture 2>"); a prompt the caller gives is kept as written. Builds graphs only: the
// page's POST /prompt for them is held (as test_u46c_extend.js does), the H3 files are empty placeholders.
// usage: node test_d_extend_pictures.js [port 8195] [base dir]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const base = process.argv[3] || CFG.base;
const FILES = ["diffusion_models/h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors", "loras/pika_h3_flex_fl2va_v1_bf16.safetensors", "loras/h3_antiburn_universal_v1.safetensors",
  "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "vae/minimax_h3_video_vae_fp16.safetensors", "vae/minimax_h3_audio_vae_fp32.safetensors"];
const GEIRU = ["H3ClownContextExperimental", "H3ClownKeyframe", "H3ClownLateLock", "H3ClownContextNoise", "H3ClownProtectionLora"];
(async () => {
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f)); // placeholders made here are parked at the end (moved, never deleted)
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const park = () => { const to0 = path.join(base, "_parked_placeholders", `dext-${Date.now()}`); for (const f of made) { const to = path.join(to0, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); } };
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    const held = [];
    await page.route(/\/api\/prompt$/, (r) => { const body = r.request().method() === "POST" && JSON.parse(r.request().postData()); if (!body || !body.prompt?.tailav) return r.continue(); held.push(body); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prompt_id: `held-${held.length}`, number: 0, node_errors: {} }) }); });
    await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
    await page.evaluate((geiru) => { for (const t of geiru) LiteGraph.registered_node_types[t] ??= class {}; }, GEIRU);
    R.runs = await page.evaluate(async () => {
      const EX = await import("/extensions/ComfyUI-MAINodes/snap/extend.js");
      const take = (text, pictures) => ({ id: "take-d-fake", group: "d-fake", number: 1, text, media: [{ kind: "video", filename: "x.mp4", subfolder: "snaptest", type: "output" }],
        prompt: { 5: { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: text, width: 64, height: 64, length: 107 } } },
        graph: { extra: { snap: { bricks: [{ key: "refs", pictures }] } } } });
      const cast = (name) => ({ role: `cast: ${name}, identity: front`, source: `cast:cast-${name.toLowerCase()}`, file: `snap/${name}.png` });
      const plate = { role: "set: plate", source: "plaza", file: "snap/plaza.png" };
      const runs = [
        take("integrated_multimodal_description: [Shot 1] Medium close-up in a town square. <Picture 1> stands in front of a stone fountain, then smiles. The camera holds still.\noverall_soundscape: water splashing", [cast("Mara")]),
        take("integrated_multimodal_description: [Shot 1] Medium shot of <Picture 1> Ana standing at a fountain. This is the plaza shown in <Picture 2>, seen from this camera; keep its benches exactly as in <Picture 2>. Water splashes.", [cast("Ana"), plate]),
        take("integrated_multimodal_description: [Shot 1] <Picture 1> walks to the door.", [cast("Kon")]),
      ];
      const out = [];
      for (const t of runs) { await EX.start(t, "chain", { clips: 1 }); }
      await EX.start(runs[2], "chain", { clips: 1, prompt: "integrated_multimodal_description: [Shot 1] <Picture 1> keeps walking." });
      return out;
    });
    R.prompts = held.map((x) => x.prompt.c1.inputs.prompt);
    R.errors = errs;
    const c = {
      "four extend graphs built": held.length === 4,
      "a Cast picture's token names the person (Mara stands …)": /The shot continues without a cut: Medium close-up in a town square\. Mara stands in front of a stone fountain, then smiles\. The camera holds still\./.test(R.prompts[0] ?? ""),
      "no <Picture N> is left in the take's own continuation": R.prompts.slice(0, 3).every((p) => p && !/<Picture \d+>/.test(p)),
      "'<Picture 1> Ana' reads 'Ana', not 'Ana Ana'": /Medium shot of Ana standing at a fountain\./.test(R.prompts[1] ?? "") && !/Ana Ana/.test(R.prompts[1] ?? ""),
      "a sentence that only points at a set picture is left out, the next one kept": !/plaza shown in/.test(R.prompts[1] ?? "") && /Water splashes\./.test(R.prompts[1] ?? ""),
      "the soundscape still follows": /overall_soundscape: .*water splashing/.test(R.prompts[0] ?? ""),
      "a prompt the caller gives is kept as written": R.prompts[3] === "integrated_multimodal_description: [Shot 1] <Picture 1> keeps walking.",
      "no page errors": !errs.length,
    };
    R.checks = c;
    fs.writeFileSync(path.join(out, "test_d_extend_pictures_result.json"), JSON.stringify(R, null, 1));
    const bad = Object.keys(c).filter((k) => !c[k]);
    console.log(`dextpics ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  } finally { await b.close(); park(); }
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
