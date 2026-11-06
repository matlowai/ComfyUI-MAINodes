// U102b (SNAP-R81, R82) on the CPU test server: upscaling a take with the upscale slot's take methods.
// - list_methods {slot: upscale} lists stage2, h3_latent and tessera as take methods (wired; tessera says it needs the
//   Tessera nodes until they're registered); RelayVSR's models/relayvsr isn't a folder ComfyUI lists, so the server says
//   whether it holds weights: "needs weights" while it is empty, ready once a file is there (it said "needs weights" on
//   :8193, where RelayVSR runs);
// - stage 2 on an H3 Ref2VA orbit take (the real executed prompt of orbit 3502, fixtures/u102b_orbit_prompt.json): the
//   take's own prompt with its empty latent replaced by H3V2VInit (the take's frames, Lanczos to 1664x2048, VAE-encoded;
//   its sound encoded and pinned), the sampler starting at `denoise` on its own sigmas through H3DeropeSigmas (the
//   guider's model), every render size at the target, the saved video with the take's own sound; model, LoRAs, words,
//   references and seed untouched; list widgets wrapped for /prompt; parent upscale/stage2, the world pins carried;
// - a pixel model first (UpscaleModelLoader), h3_latent's latent model, Tessera's tiled graph (the take as <Video 1>,
//   the anchor take's frame 0 as <Picture 1> (else the take's own frame 0, cropped per tile: a Cast picture given whole
//   drew ghost copies), SAM 3.1's hero track, the method's sigmas and options);
// - refusals: a still, denoise 0, a prompt without H3's empty latent, set_method on a take method;
// - the upscaled take lands as a take whose parent is the take; the take viewer's "Make it bigger" row has no stray null.
// Model files are empty placeholders (parked afterwards, moved, never deleted).
// usage: node test_u102b.js [port 8195] [base dir]     BEFORE=89dbc8a node test_u102b.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
const base = process.argv[3] || CFG.base;
const FILES = ["diffusion_models/h3/minimax_h3_ref2va_pruned_int8_convrot.safetensors", "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "vae/minimax_h3_video_vae_fp16.safetensors", "vae/minimax_h3_audio_vae_fp32.safetensors",
  "loras/h3/pika_h3_flex_ref2va_comfy_bf16.safetensors", "loras/h3/minimax_h3_lms_v1.0_r64.safetensors", "checkpoints/sam3.1_multiplex_fp16.safetensors",
  "latent_upscale_models/minimax_h3_latent_upscaler_3d_conv_v1_bf16.safetensors", "upscale_models/2x-AnimeSharpV4_RCAN.safetensors"];
const PACKS = ["TesseraEncode", "TesseraRefine", "TesseraArgs"];
(async () => {
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const orbit = JSON.parse(fs.readFileSync(CFG.fixture("u102b_orbit_prompt.json"), "utf8"));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const prompts = [];
    await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") prompts.push(JSON.parse(r.request().postData())); r.fallback(); });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    // the orbit take, a still and an FL2V-free prompt without H3's empty latent, as takes of the open workflow
    R.fix = await page.evaluate(async (prompt) => {
      const T = window.__T, group = app.graph.id, world = { "cast:cast-u102b": { n: 3, name: "Maren" } };
      const video = (f) => [{ kind: "video", filename: f, subfolder: "snaptest", type: "output" }];
      const mk = (id, number, media, p) => ({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 349, group, number, status: "success", text: "orbit", seed: 3502, media, prompt: p, graph: { extra: { snap: { world } } }, world, verdict: null, notes: [] });
      const orbitTake = mk("take-u102b-orbit", 901, video("orb3502.mp4"), prompt), anchor = mk("take-u102b-anchor", 902, video("orb3502_s2.mp4"), prompt);
      const still = mk("take-u102b-still", 903, [{ kind: "image", filename: "s.png", subfolder: "snaptest", type: "output" }], prompt);
      const bare = mk("take-u102b-bare", 904, video("bare.mp4"), { 1: { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "x", width: 832, height: 1024, length: 124 } } });
      for (const t of [orbitTake, anchor, still, bare]) await T.save(t);
      return { group };
    }, orbit);
    const listed = await call("list_methods", { slot: "upscale" });
    R.listed = listed?.methods?.map((m) => [m.id, m.kind, m.install_state, m.wired]);
    const relay = path.join(base, "models", "relayvsr", "RelayVSR", "flash.safetensors"), relayMade = !fs.existsSync(relay);
    if (relayMade) { fs.mkdirSync(path.dirname(relay), { recursive: true }); fs.writeFileSync(relay, ""); made.push(relay); }
    R.relayAfter = await page.evaluate(async () => { const S = await import("/extensions/ComfyUI-MAINodes/snap/slots.js"), r = await (await fetch("/mainodes/snap/methods")).json();
      return { present: r.methods.find((m) => m.id === "relayvsr")?.needs?.[0]?.present }; });
    const graphOf = async (args) => {
      const n = prompts.length, r = await call("upscale_take", args);
      for (let i = 0; i < 40 && !prompts.slice(n).some((x) => x.extra_data?.snap_parent?.method === `upscale/${args.method}`); i++) await page.waitForTimeout(50);
      const mine = prompts.slice(n).find((x) => x.extra_data?.snap_parent?.method === `upscale/${args.method}`);
      return { r, g: mine?.prompt, extra: mine?.extra_data };
    };
    const by = (g, t) => Object.entries(g ?? {}).filter(([, n]) => n.class_type === t);
    const node = (g, l) => g?.[l?.[0]];
    const s2 = await graphOf({ take: "take-u102b-orbit", method: "stage2", factor: 2, denoise: 0.3 });
    const g = s2.g ?? {}, init = g["191:150"], enc = node(g, init?.inputs?.samples), up = node(g, enc?.inputs?.pixels), comp = node(g, up?.inputs?.image), src = node(g, comp?.inputs?.video);
    const smp = g["191:115"], sig = node(g, smp?.inputs?.sigmas);
    R.stage2 = { r: s2.r, init: init?.class_type, audio_mode: init?.inputs?.audio_mode, audio: node(g, init?.inputs?.audio_latent)?.class_type, enc: enc?.class_type, encVae: enc?.inputs?.vae,
      up: up && [up.class_type, up.inputs.upscale_method, up.inputs.width, up.inputs.height], comp: comp?.class_type, src: src?.inputs?.file,
      sig: sig && [sig.class_type, sig.inputs.inject, sig.inputs.model, sig.inputs.sigmas], sizes: Object.values(g).filter((n) => typeof n.inputs?.width === "number" && typeof n.inputs?.length !== "undefined").map((n) => [n.inputs.width, n.inputs.height]),
      created: by(g, "CreateVideo").map(([k, n]) => [k, n.inputs.audio]), save: by(g, "SaveVideo")[0]?.[1]?.inputs?.filename_prefix,
      lora: g["202"]?.inputs?.["loras.0.lora_name"], refs: g["199"]?.inputs?.image, seed: g["191:111"]?.inputs?.noise_seed, words: g["191:173"]?.inputs?.prompt === orbit["191:173"].inputs.prompt,
      branch: g["191:177"]?.inputs?.branch_names, parent: s2.extra?.snap_parent, world: s2.extra?.extra_pnginfo?.workflow?.extra?.snap?.world };
    const s2m = await graphOf({ take: "take-u102b-orbit", method: "stage2", width: 1664, denoise: 0.25, upscaler: "2x-AnimeSharpV4_RCAN.safetensors" });
    const um = by(s2m.g, "ImageUpscaleWithModel")[0]?.[1];
    R.model = { r: s2m.r, loader: node(s2m.g, um?.inputs?.upscale_model)?.inputs?.model_name, into: by(s2m.g, "ImageScale").find(([, n]) => n.inputs.upscale_method === "lanczos")?.[1]?.inputs?.image?.[0] === by(s2m.g, "ImageUpscaleWithModel")[0]?.[0],
      inject: s2m.g?.["u2s191:115"]?.inputs?.inject };
    const lat = await graphOf({ take: "take-u102b-orbit", method: "h3_latent", factor: 2 });
    const lu = by(lat.g, "MiniMaxH3LatentUpscaleWithModel")[0]?.[1];
    R.latent = { r: lat.r, up: lu && [lu.inputs.width, lu.inputs.height, node(lat.g, lu.inputs.model)?.inputs?.model_name, node(lat.g, lu.inputs.samples)?.class_type], init: lat.g?.["191:150"]?.inputs?.samples?.[0] === by(lat.g, "MiniMaxH3LatentUpscaleWithModel")[0]?.[0] };
    R.tesseraBare = await call("upscale_take", { take: "take-u102b-orbit", method: "tessera" });
    await page.evaluate((packs) => { for (const t of packs) LiteGraph.registered_node_types[t] ??= function () {}; }, PACKS);
    R.listedPacks = (await call("list_methods", { slot: "upscale" }))?.methods?.find((m) => m.id === "tessera")?.install_state;
    const ts = await graphOf({ take: "take-u102b-orbit", method: "tessera", factor: 4, anchor: "take-u102b-anchor" });
    const te = by(ts.g, "TesseraEncode")[0]?.[1], tr = by(ts.g, "TesseraRefine")[0]?.[1], refs = by(ts.g, "H3References")[0]?.[1];
    R.tessera = { r: ts.r, enc: te && [te.inputs.upscale_by, te.inputs.upscale_method], size: by(ts.g, "H3ReferenceToVideoRefs")[0]?.[1]?.inputs && [by(ts.g, "H3ReferenceToVideoRefs")[0][1].inputs.width, by(ts.g, "H3ReferenceToVideoRefs")[0][1].inputs.height],
      pic1: node(ts.g, node(ts.g, refs?.inputs?.["ref_images.ref_image_0"])?.inputs?.image)?.class_type, pic1file: node(ts.g, node(ts.g, node(ts.g, refs?.inputs?.["ref_images.ref_image_0"])?.inputs?.image)?.inputs?.video)?.inputs?.file,
      video1: node(ts.g, refs?.inputs?.["ref_videos.ref_video_0"])?.class_type, hero: node(ts.g, tr?.inputs?.hero_mask)?.class_type, heroText: by(ts.g, "CLIPTextEncode")[0]?.[1]?.inputs?.text,
      positive: node(ts.g, tr?.inputs?.positive)?.class_type, latent: node(ts.g, node(ts.g, tr?.inputs?.latent)?.inputs?.video_latent)?.class_type, cfg: tr?.inputs?.cfg, seed: tr?.inputs?.seed,
      args: by(ts.g, "TesseraArgs")[0]?.[1]?.inputs, sigmas: node(ts.g, tr?.inputs?.sigmas)?.inputs?.sigmas, fine: node(ts.g, tr?.inputs?.model_fine)?.inputs?.strength_model, parent: ts.extra?.snap_parent };
    const own = await graphOf({ take: "take-u102b-orbit", method: "tessera", factor: 4, anchor: "none" });
    const ownRefs = by(own.g, "H3References")[0]?.[1], ownPic = node(own.g, ownRefs?.inputs?.["ref_images.ref_image_0"]);
    R.ownAnchor = { pic: ownPic?.class_type, from: node(own.g, ownPic?.inputs?.image)?.class_type, frame: ownPic?.inputs?.batch_index, said: own.r?.anchor, crop: by(own.g, "TesseraArgs")[0]?.[1]?.inputs?.image_ref_crop };
    R.refusals = {
      still: await call("upscale_take", { take: "take-u102b-still", method: "tessera" }), // G1: stage 2 redraws stills now; Tessera runs on video only
      zero: await call("upscale_take", { take: "take-u102b-orbit", method: "stage2", denoise: 0 }),
      bare: await call("upscale_take", { take: "take-u102b-bare", method: "stage2" }),
      method: await call("upscale_take", { take: "take-u102b-orbit", method: "nope" }),
      slot: await call("set_method", { slot: "upscale", method: "stage2" }),
    };
    // the run lands as a take whose parent is the orbit take (fwork rewrites the graph into a 64 px CPU one)
    R.landed = await page.evaluate(async (id) => { for (let i = 0; i < 120; i++) { const t = window.__T.all().find((x) => x.prompt_id === id); if (t) return { parent: t.parent, world: Object.keys(t.world ?? {}) }; await new Promise((r) => setTimeout(r, 500)); } return null; }, R.stage2.r?.prompt_id);
    // the take viewer's Make it bigger row
    await page.evaluate(() => document.querySelector(".snap-takes")?.scrollIntoView());
    await page.click(`.snap-take[data-take="take-u102b-orbit"]`); await page.waitForTimeout(1500);
    R.row = await page.evaluate(() => {
      const title = [...document.querySelectorAll(".snap-take-sheet .snap-rail-title")].find((x) => x.textContent === "Make it bigger");
      const btn = [...document.querySelectorAll(".snap-take-sheet button.snap-primary")].find((x) => /^Upscale to /.test(x.textContent));
      if (!title || !btn) return { error: "no Make it bigger row" };
      let text = "", el = title.nextElementSibling;
      for (let i = 0; el && i < 6; i++, el = el.nextElementSibling) text += ` ${el.textContent}`;
      return { btn: btn.textContent, text };
    });
    await page.evaluate(() => [...document.querySelectorAll(".snap-take-sheet .snap-rail-title")].find((x) => x.textContent === "Make it bigger")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300); fs.mkdirSync(path.join(CFG.out, "ui", "u102b"), { recursive: true });
    await page.screenshot({ path: path.join(CFG.out, "ui", "u102b", "make_it_bigger.png") });
    await page.selectOption('select[aria-label="how to make it bigger"]', "tessera"); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(CFG.out, "ui", "u102b", "make_it_bigger_tessera.png") });
    const ST = R.stage2, ids = (l) => JSON.stringify(l);
    const checks = {
      "list_methods upscale: stage2, h3_latent, tessera are wired take methods": ["stage2", "h3_latent", "tessera"].every((id) => R.listed?.some(([m, k, , w]) => m === id && k === "take" && w)),
      "tessera says it needs the Tessera nodes until they're installed, then ready": /needs the nodes TesseraEncode/.test(R.listed?.find(([m]) => m === "tessera")?.[2] ?? "") && /TesseraEncode/.test(R.tesseraBare?.error ?? "") && R.listedPacks === "ready",
      "RelayVSR's own folder: needs weights while empty, present once a file is there": (relayMade ? /needs weights in models\/relayvsr/.test(R.listed?.find(([m]) => m === "relayvsr")?.[2] ?? "") : true) && R.relayAfter?.present === true,
      "stage 2: H3V2VInit in the empty latent's place, sound pinned": ST.init === "H3V2VInit" && ST.audio_mode === "pin the original outright (0.0)" && ST.audio === "VAEEncodeAudio",
      "stage 2: the take's frames, Lanczos to 1664x2048, VAE-encoded with the take's VAE": ST.enc === "VAEEncode" && ids(ST.encVae) === ids(["2", 0]) && ids(ST.up) === ids(["ImageScale", "lanczos", 1664, 2048]) && ST.comp === "GetVideoComponents" && ST.src === "snaptest/orb3502.mp4 [output]",
      "stage 2: the sampler starts at 0.3 on its own sigmas and the guider's model": ids(ST.sig) === ids(["H3DeropeSigmas", 0.3, ["5", 0], ["4", 2]]),
      "stage 2: every render size at 1664x2048": ST.sizes.length >= 4 && ST.sizes.every(([w, h]) => w === 1664 && h === 2048),
      "stage 2: the saved video has the take's own sound": ST.created.some(([k, a]) => k === "191:119" && ids(a) === ids(["u2c", 1])) && ST.save === "video/snap_upscale/take-u102b-orbit",
      "stage 2: LoRA, references, words and seed untouched; list widgets wrapped": ST.lora === "h3/orb360/minimax_h3_orb360_step1500.safetensors" && ST.refs === orbit["199"].inputs.image && ST.seed === 3502 && ST.words && ids(ST.branch) === ids({ __value__: ["off", "oracle", "flat"] }),
      "stage 2: parent upscale/stage2 with its options, world pins carried": ST.parent?.take === "take-u102b-orbit" && ST.parent.options?.width === 1664 && ST.parent.options.denoise === 0.3 && ST.world?.["cast:cast-u102b"]?.n === 3 && ST.r?.take === `take-${ST.r?.prompt_id}`,
      "a pixel model first, then Lanczos; height from the width": /2x-AnimeSharpV4_RCAN/.test(R.model?.loader ?? "") && R.model.into && R.model.inject === 0.25 && R.model.r?.height === 2048,
      "h3_latent: the latent model to 1664x2048 feeds H3V2VInit": ids(R.latent?.up?.slice(0, 2)) === ids([1664, 2048]) && /latent_upscaler_3d_conv_v1/.test(R.latent.up[2] ?? "") && R.latent.up[3] === "VAEEncode" && R.latent.init,
      "tessera: 4x Streamed Encode, 3328x4096, the take as <Video 1>, the anchor's frame 0 as <Picture 1>": ids(R.tessera?.enc) === ids([4, "lanczos"]) && ids(R.tessera.size) === ids([3328, 4096]) && R.tessera.video1 === "ImageScale" && R.tessera.pic1 === "GetVideoComponents" && R.tessera.pic1file === "snaptest/orb3502_s2.mp4 [output]",
      "tessera: hero track on 'face', Encode's positive + latent, the method's sigmas, cfg 1, the take's seed, flat_skip 8, per-tile still": R.tessera.hero === "SAM3_TrackToMask" && R.tessera.heroText === "face" && R.tessera.positive === "TesseraEncode" && R.tessera.latent === "TesseraEncode" && R.tessera.sigmas === "1.0, 0.7, 0.4, 0.0" && R.tessera.cfg === 1 && R.tessera.seed === 3502 && R.tessera.args?.flat_skip === 8 && R.tessera.args.image_ref_crop === "per_tile" && R.tessera.fine === 1 && R.tessera.parent?.method === "upscale/tessera",
      "tessera without an anchor: the take's own frame 0, cropped per tile (never a Cast picture whole)": R.ownAnchor?.pic === "ImageFromBatch" && R.ownAnchor.from === "ImageScale" && R.ownAnchor.frame === 0 && R.ownAnchor.said === "its own frame 0" && R.ownAnchor.crop === "per_tile",
      "refusals say what to give": /is a still/.test(R.refusals.still?.error ?? "") && /denoise/.test(R.refusals.zero?.error ?? "") && /EmptyMiniMaxH3LatentAV/.test(R.refusals.bare?.error ?? "") && /No take upscale "nope"; there are: stage2, h3_latent, tessera/.test(R.refusals.method?.error ?? "") && /upscale_take/.test(R.refusals.slot?.error ?? ""),
      "the upscaled take lands with the orbit take as its parent": R.landed?.parent?.take === "take-u102b-orbit" && R.landed.parent.method === "upscale/stage2" && R.landed.world.includes("cast:cast-u102b"),
      "the take viewer offers Make it bigger with its time, no stray null": /^Upscale to 1664×2048 · about 18 min/.test(R.row?.btn ?? "") && !/\bnull\b|undefined|\[object/.test(R.row?.text ?? "null"),
      "no page errors": !A.errors.length,
    };
    console.log(JSON.stringify(R, null, 1));
    let bad = 0;
    for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
    console.log(`u102b ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
    process.exitCode = bad ? 1 : 0;
  } finally {
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `u102b-${Date.now()}`);
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
})().catch((e) => { console.error(e); process.exit(2); });
