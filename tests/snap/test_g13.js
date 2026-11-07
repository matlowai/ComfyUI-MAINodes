// Batch G13 (dogfood F-Y04, F-Y05, F-Y07, F-Y08) on the CPU test server:
// - SNAP-R202 (F-Y04): stage 2 of a region edit (paste_back) still redraws the whole still: its recorded P-H3 graph with
//   Picture 1 = the edited still itself (no crop), the decode saved as it is (no paste back, no seam check, no mask), every
//   size at the asked one, the still VAE-encoded as the video half of the AV latent;
// - SNAP-R202 (F-Y05): stage 2 of a MOSS still (one SamplerCustomAdvanced from a plain EmptyLatentImage) and of a
//   KSampler still (a Krea or MOSS-reference edit) starts the sampler from the encoded still, with no AV split; the KSampler
//   one at denoise 0.3, fast at cfg 1;
// - SNAP-R203 (F-Y07): keep_eye_colour runs on a still that isn't a stage 2 redraw and says what it ran on; a still that
//   pins no Cast asks for one, and runs with the one given;
// - F-Y08: check_identity, upscale_take and set_purpose take a unique start of a take id, as every take tool does;
// - SNAP-R204 (F-Y09): a region edit's mask: SAM 3.1 on Picture 1's crop with the words given, grown and softened,
//   multiplied into the paste's feathered mask; refused without paste_back; its stage 2 carries no SAM.
// Model files are empty placeholders (parked afterwards); SAM 3.1 is listed as a GPU machine lists it.
// usage: node test_g13.js [port] [base]   prints "g13 n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d}-g13-${Date.now()}`)); } };
const FILES = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"];
const [UNET, CLIP, VAE] = ["h3/p-h3-image_int8_convrot.safetensors", "h3/p-h3-image_text_encoder_int8_convrot.safetensors", "h3/p-h3-image_vae_int8_convrot.safetensors"];
// a MOSS text-to-image still, as the Kuroe front's recorded graph (one SamplerCustomAdvanced from EmptyLatentImage)
const MOSS = {
  1: { class_type: "UNETLoader", inputs: { unet_name: UNET, weight_dtype: "default" } }, 2: { class_type: "CLIPLoader", inputs: { clip_name: CLIP, type: "moss_image", device: "default" } },
  3: { class_type: "VAELoader", inputs: { vae_name: VAE } }, 10: { class_type: "CLIPTextEncode", inputs: { text: "a tall thin elderly critic, front view", clip: ["2", 0] } },
  11: { class_type: "CLIPTextEncode", inputs: { text: "worst quality", clip: ["2", 0] } }, 12: { class_type: "KSamplerSelect", inputs: { sampler_name: "er_sde" } },
  13: { class_type: "BasicScheduler", inputs: { scheduler: "simple", steps: 25, denoise: 1, model: ["1", 0] } }, 14: { class_type: "CFGGuider", inputs: { cfg: 3, model: ["1", 0], positive: ["10", 0], negative: ["11", 0] } },
  15: { class_type: "RandomNoise", inputs: { noise_seed: 5202 } }, 16: { class_type: "EmptyLatentImage", inputs: { width: 1280, height: 704, batch_size: 1 } },
  17: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["15", 0], guider: ["14", 0], sampler: ["12", 0], sigmas: ["13", 0], latent_image: ["16", 0] } },
  18: { class_type: "VAEDecode", inputs: { samples: ["17", 0], vae: ["3", 0] } }, 20: { class_type: "SaveImage", inputs: { filename_prefix: "image/dials_image", images: ["18", 0] } },
};
// a KSampler still (the Krea and MOSS-reference edits sample this way)
const KS = {
  1: { class_type: "UNETLoader", inputs: { unet_name: UNET, weight_dtype: "default" } }, 2: { class_type: "CLIPLoader", inputs: { clip_name: CLIP, type: "moss_image", device: "default" } },
  3: { class_type: "VAELoader", inputs: { vae_name: VAE } }, p: { class_type: "CLIPTextEncode", inputs: { text: "the gate at dusk", clip: ["2", 0] } }, n: { class_type: "CLIPTextEncode", inputs: { text: "", clip: ["2", 0] } },
  l: { class_type: "EmptySD3LatentImage", inputs: { width: 1280, height: 704, batch_size: 1 } },
  k: { class_type: "KSampler", inputs: { model: ["1", 0], seed: 7, steps: 20, cfg: 4, sampler_name: "euler", scheduler: "simple", positive: ["p", 0], negative: ["n", 0], latent_image: ["l", 0], denoise: 1.0 } },
  d: { class_type: "VAEDecode", inputs: { samples: ["k", 0], vae: ["3", 0] } }, o: { class_type: "SaveImage", inputs: { images: ["d", 0], filename_prefix: "snap_views/x" } },
};
(async () => {
  ["takes", "cast", "candidates"].forEach(park); // moved, never deleted
  for (const d of ["input/snaptest_g13", "output/snaptest"]) fs.mkdirSync(path.join(base, d), { recursive: true });
  const plates = CFG.fixture("short03", "settei_bg", "plates");
  fs.copyFileSync(path.join(plates, "Pc_square_well.png"), path.join(base, "input", "snaptest_g13", "front.png"));
  fs.copyFileSync(path.join(plates, "Pd_houses.png"), path.join(base, "output", "snaptest", "g13_still.png")); // 1280x704
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  let cast;
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.route(/\/api\/experiment\/models\/checkpoints$/, async (r) => { const res = await r.fetch(), list = await res.json(); r.fulfill({ response: res, json: [...list, { name: "sam3.1_multiplex_fp16.safetensors", pathIndex: 0, modified: 0, size: 1e9 }] }); });
    const A = await F.open(b, port, { context: ctx }), page = A.page, prompts = [];
    await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") prompts.push(JSON.parse(r.request().postData())); r.fallback(); });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const posted = async (n, fn) => { for (let i = 0; i < 60 && !prompts.slice(n).find(fn); i++) await page.waitForTimeout(100); return prompts.slice(n).find(fn); };
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    cast = (await call("save_cast", { name: "G13 Kuroe", details: "grey eyes, a round gold monocle", refs: [{ file: "snaptest_g13/front.png", role: "identity: front" }] })).cast;
    // the region edit's real graph, as edit_from_context queues it, becomes a still take
    let n = prompts.length;
    R.maskAlone = await call("edit_from_context", { pictures: [{ file: "snaptest_g13/front.png", crop: [0.4, 0.05, 0.2, 0.3] }], prompt: "x", method: "ph3_view", mask: "the bar", seeds: [1], land: "tab" });
    R.edit = await call("edit_from_context", { pictures: [{ file: "snaptest_g13/front.png", crop: [0.4, 0.05, 0.2, 0.3] }], prompt: "he wears no eyewear at all", method: "ph3_view", paste_back: true, mask: "the gold bar across the nose:1", seeds: [9921], land: "tab" });
    const edit = await posted(n, (x) => x.extra_data?.snap_parent?.method === "view/ph3_view");
    R.editPasted = !!edit?.extra_data?.snap_parent?.options?.pasted && Object.values(edit.prompt).some((x) => x.class_type === "ImageCompositeMasked");
    const eg = edit?.prompt ?? {}, rc = Object.values(eg).find((x) => x.class_type === "ImageCompositeMasked"), mx = eg[rc?.inputs.mask[0]], sam = Object.values(eg).find((x) => x.class_type === "SAM3_Detect");
    R.mask = { comp: mx && [mx.class_type, mx.inputs.operation, eg[mx.inputs.destination[0]]?.class_type], samOn: eg[sam?.inputs.image[0]]?.class_type, words: eg[sam?.inputs.conditioning[0]]?.inputs.text, kept: edit?.extra_data?.snap_parent?.options?.pasted?.mask };
    await page.evaluate(async ([paste, parent, moss, ks, cast]) => {
      const T = window.__T, group = app.graph.id;
      const mk = (id, number, prompt, extra) => ({ id, kind: "run", prompt_id: id.slice(5), created: Date.now() + number, finished: Date.now() + number, seconds: 8, group, number, status: "success", text: "g13", seed: 5,
        media: [{ kind: "image", filename: "g13_still.png", subfolder: "snaptest", type: "output" }], prompt, graph: { extra: { snap: { world: {} } } }, world: {}, verdict: null, notes: [], ...extra });
      await T.save(mk("take-g13-paste-0001", 971, paste, { parent }));
      await T.save(mk("take-g13-moss-0002", 972, moss, { world: { [cast]: { n: 1, name: "G13 Kuroe" } } }));
      await T.save(mk("take-g13-ksam-0003", 973, ks, {}));
    }, [edit.prompt, edit.extra_data.snap_parent, MOSS, KS, cast]);
    const up = async (take, extra = {}) => { const n = prompts.length, r = await call("upscale_take", { take, method: "stage2", factor: 2, ...extra });
      const g = (await posted(n, (x) => x.extra_data?.snap_parent?.method === "upscale/stage2"))?.prompt; return { r, g }; };
    const node = (g, l) => g?.[l?.[0]], all = (g, c) => Object.values(g ?? {}).filter((x) => x.class_type === c);
    // F-Y04
    const p = await up("take-g13-paste-0001"), pg = p.g, cond = all(pg, "PH3ImageConditioning")[0], save = all(pg, "SaveImage")[0], dec = node(pg, save?.inputs.images);
    const k = all(pg, "SamplerCustomAdvanced")[0], lat = node(pg, k?.inputs.latent_image), enc = node(pg, lat?.inputs.video_latent), sc = node(pg, enc?.inputs.pixels);
    R.paste = { r: p.r, classes: Object.values(pg ?? {}).map((x) => x.class_type), one: node(pg, cond?.inputs["images.image_1"]), size: cond && [cond.inputs.width, cond.inputs.height], save: dec?.class_type, decFrom: node(pg, dec?.inputs.samples)?.class_type,
      lat: lat?.class_type, sep: node(pg, lat?.inputs.audio_latent)?.class_type, scale: sc && [sc.class_type, sc.inputs.width, sc.inputs.height, node(pg, sc.inputs.image)?.inputs.image], prompt: cond?.inputs.prompt };
    // F-Y05
    const m = await up("take-g13-moss-0002"), mg = m.g, mk2 = all(mg, "SamplerCustomAdvanced")[0], mlat = node(mg, mk2?.inputs.latent_image), msig = node(mg, mk2?.inputs.sigmas);
    R.moss = { r: m.r, classes: Object.values(mg ?? {}).map((x) => x.class_type), lat: mlat?.class_type, pix: node(mg, mlat?.inputs.pixels)?.class_type, sig: msig?.class_type, inject: msig?.inputs.inject, empty: all(mg, "EmptyLatentImage")[0]?.inputs };
    const q = await up("take-g13-ksam-0003", { speed: "fast" }), kk = all(q.g, "KSampler")[0];
    R.ks = { r: q.r, classes: Object.values(q.g ?? {}).map((x) => x.class_type), lat: node(q.g, kk?.inputs.latent_image)?.class_type, denoise: kk?.inputs.denoise, cfg: kk?.inputs.cfg };
    // F-Y08: unique starts of an id
    R.startUp = (await up("g13-moss", { factor: 1.5 })).r;
    R.startPurpose = await call("set_purpose", { take: "g13-ksam", purpose: "settei" });
    R.startIdentity = await call("check_identity", { take: "g13-paste", cast });
    R.startEyesPlan = await page.evaluate(async (c) => window.__X.TOOLS.find((t) => t.name === "keep_eye_colour").plan({ take: "g13-moss", cast: c }).catch((e) => ({ error: e.message })), cast);
    // F-Y07
    n = prompts.length;
    R.eyesMoss = await call("keep_eye_colour", { take: "take-g13-moss-0002" });
    R.eyesMossGraph = (await posted(n, (x) => Object.values(x.prompt).some((y) => y.class_type === "MAISnapEyeColour")))?.prompt;
    R.eyesNoCast = await call("keep_eye_colour", { take: "take-g13-ksam-0003" });
    n = prompts.length;
    R.eyesGiven = await call("keep_eye_colour", { take: "take-g13-ksam-0003", cast });
    R.eyesGivenGraph = (await posted(n, (x) => Object.values(x.prompt).some((y) => y.class_type === "MAISnapEyeColour")))?.prompt;
    R.errors = A.errors;
  } finally { await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {}); await b.close(); }
  for (const f of made) { const to = path.join(base, "models", "_parked_g13", path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); } // placeholders moved, never deleted
  const P = R.paste, M = R.moss, K = R.ks, front = (g) => Object.values(g ?? {}).some((x) => x.class_type === "LoadImage" && x.inputs.image === "snaptest_g13/front.png");
  const checks = {
    "the region edit's own graph pastes back (the take stage 2 starts from)": R.editPasted,
    "F-Y09: a masked region edit: SAM on the crop with the words, multiplied into the feathered paste mask; kept on the take": JSON.stringify(R.mask.comp) === JSON.stringify(["MaskComposite", "multiply", "FeatherMask"]) && R.mask.samOn === "ImageCropV2" && R.mask.words === "the gold bar across the nose:1" && R.mask.kept === "the gold bar across the nose:1",
    "F-Y09: mask without paste_back is refused": /mask keeps a region edit only where SAM finds that thing; it goes with paste_back/.test(R.maskAlone?.error ?? ""),
    "F-Y04: stage 2 of a region edit has no crop, paste back, mask, SAM or seam check": P.classes.length && !P.classes.some((c) => ["ImageCropV2", "ImageCompositeMasked", "SolidMask", "FeatherMask", "MaskComposite", "SAM3_Detect", "GrowMask", "MAISnapSeam", "ImageScaleToTotalPixels"].includes(c)),
    "F-Y04: Picture 1 is the edited still itself, the prompt kept": P.one?.class_type === "LoadImage" && P.one.inputs.image === "snaptest/g13_still.png [output]" && P.prompt === "he wears no eyewear at all",
    "F-Y04: the decode is saved as it is, at the asked size (2x the still)": P.save === "VAEDecode" && P.decFrom === "SamplerCustomAdvanced" && JSON.stringify(P.size) === JSON.stringify([2560, 1408]) && P.r?.width === 2560 && P.r?.height === 1408 && P.r?.still === true,
    "F-Y04: the still, Lanczos to the size, is the video half of the AV latent": P.lat === "LTXVConcatAVLatent" && P.sep === "LTXVSeparateAVLatent" && P.scale?.[0] === "ImageScale" && P.scale[1] === 2560 && P.scale[3] === "snaptest/g13_still.png [output]",
    "F-Y05: stage 2 of a MOSS still starts from the encoded still, no AV split": M.r?.still === true && M.lat === "VAEEncode" && M.pix === "ImageScale" && !M.classes.some((c) => /^LTXV/.test(c)) && M.sig === "H3DeropeSigmas" && M.inject === 0.3 && M.empty?.width === 2560,
    "F-Y05: a KSampler still: the encoded still at denoise 0.3, fast at cfg 1": K.r?.still === true && K.r.speed === "fast" && K.lat === "VAEEncode" && K.denoise === 0.3 && K.cfg === 1 && !K.classes.some((c) => /^LTXV|H3Derope/.test(c)),
    "F-Y08: upscale_take, set_purpose and check_identity take a unique start of the id": R.startUp?.width === 1920 && R.startPurpose?.take === "take-g13-ksam-0003" && !/No take/.test(R.startIdentity?.error ?? "") && !/No take/.test(R.startEyesPlan?.error ?? "") && /the still of take 972/.test(R.startEyesPlan?.runs ?? ""),
    "F-Y07: keep_eye_colour runs on a still that isn't a stage 2 redraw, saying what it ran on": /^A still, not a frame of a video: take 972/.test(R.eyesMoss?.ran_on ?? "") && /running on take 972 \(A still, not a frame of a video/.test(R.eyesMoss?.said ?? "") && front(R.eyesMossGraph),
    "F-Y07: a still that pins no Cast asks for one, and runs with the one given": /pins no Cast with a picture: give cast/.test(R.eyesNoCast?.error ?? "") && R.eyesGiven?.cast?.startsWith(cast) && front(R.eyesGivenGraph),
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [key, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${key}`); bad += !v; }
  console.log(`g13 ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
