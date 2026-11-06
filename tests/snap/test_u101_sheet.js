// U101 turnaround round 2 (SNAP-R77) on the CPU test server: make_character_sheet and the sheet slot.
// - list_methods {slot: sheet} lists the seven methods in order; a method whose nodes aren't installed says which (the
//   contact sheet's are the pack's own, contact_sheet.py);
// - with the packs' node types registered in the page (the CPU server has none; the prompts are rewritten or answered
//   here, nothing of theirs runs), each method's graph is checked: the contact sheet (H3ContactSheet on the ref2va
//   model + the five-view LoRA, its decode saving the views and the strip), the five-reference H3 sheet (Ref2V, five
//   pictures in order, 5 frames, max ref size, frame 0), the Fizgig one-sheet (its latent and the turbo), Krea 2
//   QuadView / Dynamic (krea2edit's patch and grounded encodes, the LoRA, the identity locks from `design`), MOSS
//   CharRef (core MOSS edit encode in the ai-toolkit layout, SLG 22, 50 steps cfg 3); the words are the method's with
//   the Cast's name and design; fizgig_still's New view graph is unchanged;
// - a contact sheet's candidate answered with a strip and five views lists the sheet first, then view 1..5;
// - the other candidates land as still takes in the shot asked for, with the Cast pinned, kind sheet in
//   list_candidates; refusals say what to give; the sheet tile has no stray null.
// Model files are empty placeholders (parked afterwards, moved, never deleted).
// usage: node test_u101_sheet.js [port 8195] [base dir]     BEFORE=234ee8d node test_u101_sheet.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
const base = process.argv[3] || CFG.base;
const FILES = ["diffusion_models/h3/minimax_h3_ref2va_pruned_int8_convrot.safetensors", "diffusion_models/h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors", "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors",
  "vae/h3/minimax_h3_video_vae_fp16.safetensors", "loras/h3/minimax_h3_five_view_512_s1500.safetensors", "loras/h3/minimax_h3_five_view_512_s400_instruct.safetensors", "loras/h3/minimax_h3_turbo_v4_step600_ema.safetensors",
  "diffusion_models/krea2/krea2_turbo_fp8_scaled.safetensors", "text_encoders/krea2/qwen3vl_4b_fp8_scaled.safetensors", "vae/krea2/qwen_image_vae.safetensors", "loras/krea2/QuadView_krea2_v1.safetensors", "loras/krea2/DynamicCharacterSheet_krea2_v1.safetensors",
  "diffusion_models/moss_image_base_int8_convrot.safetensors", "text_encoders/qwen3.5_9b_int8_convrot.safetensors", "vae/flux2-vae.safetensors", "loras/moss_image_charref_v2.safetensors"];
const PACKS = ["Krea2EditModelPatch", "Krea2EditGroundedEncode", "FizgigH3StillLatent", "FizgigH3StillDecode"];
const sh = (cmd, args) => new Promise((done, fail) => execFile(cmd, args, (e) => (e ? fail(e) : done())));
(async () => {
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  fs.mkdirSync(path.join(base, "input", "snap"), { recursive: true });
  for (const [n, c] of [["front", "0x406080"], ["left", "0x604080"], ["back", "0x806040"], ["face", "0x408060"], ["boots", "0x202020"]])
    await sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${c}:s=60x100`, "-frames:v", "1", path.join(base, "input", "snap", `snaptest_sheet_${n}.png`)]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const prompts = [];
    await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") prompts.push(JSON.parse(r.request().postData())); r.fallback(); });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    R.tools = await page.evaluate(() => window.__X.TOOLS?.map((t) => t.name) ?? []).catch(() => []);
    R.fix = await page.evaluate(async () => {
      const SC = window.__SC; await SC.load();
      const s = await SC.create({ name: "U101 sheets" }); await SC.addShot(s.id, { name: "Maren settei" });
      return { scene: s.id, shot: SC.get(s.id).shots[0].id };
    });
    const land = { scene: R.fix.scene, shot: R.fix.shot };
    R.cast = await call("save_cast", { name: "Maren", details: "a tall swordswoman, white braid", lora: null, refs: [{ file: "snap/snaptest_sheet_front.png", role: "identity: front" }] });
    R.listedBare = (await call("list_methods", { slot: "sheet" }))?.methods?.map((m) => [m.id, m.install_state]);
    R.kreaBare = await call("make_character_sheet", { cast: R.cast.cast, method: "krea2_quadview", seeds: [1] });
    // the packs' node types, as a GPU server with them installed lists them
    await page.evaluate((packs) => { for (const t of packs) LiteGraph.registered_node_types[t] ??= function () {}; }, PACKS);
    R.listed = (await call("list_methods", { slot: "sheet" }))?.methods?.map((m) => [m.id, m.install_state]);
    const design = "white-silver hair in one low braid; two steel pauldrons; red cord sash";
    const graphOf = async (args) => { const n = prompts.length, r = await call("make_character_sheet", { cast: R.cast.cast, land, ...args });
      for (let i = 0; i < 40 && prompts.slice(n).filter((x) => x.extra_data?.snap_parent?.method === `sheet/${args.method}`).length < (r.candidates?.length ?? 0); i++) await page.waitForTimeout(50); // the route records a request after the page's fetch returns
      const mine = prompts.slice(n).filter((x) => x.extra_data?.snap_parent?.method === `sheet/${args.method}`); return { r, graphs: mine.map((x) => x.prompt), extra: mine.map((x) => x.extra_data) }; };
    const by = (g, t) => Object.values(g ?? {}).filter((n) => n.class_type === t);
    const up = (g, link) => g?.[link?.[0]];
    // the contact sheet: its prompts are answered here with a strip and five views (the server has no such nodes)
    let fakes = 0;
    await page.route(/\/(api\/)?prompt$/, (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      const body = JSON.parse(r.request().postData());
      if (!Object.values(body.prompt).some((x) => x.class_type === "H3ContactSheet")) return r.fallback();
      prompts.push(body);
      const id = `fake-sheet-${++fakes}`, img = (f) => ({ filename: f, subfolder: "snaptest", type: "output" });
      page.__fake = { ...(page.__fake ?? {}), [id]: { status: { status_str: "success", completed: true, messages: [] }, prompt: [0, id, body.prompt, body.extra_data, ["o", "v"]],
        outputs: { o: { images: [img(`sheet_${fakes}.png`)] }, v: { images: [1, 2, 3, 4, 5].map((i) => img(`sheet_${fakes}_view${i}.png`)) } } } };
      return r.fulfill({ json: { prompt_id: id, number: 1, node_errors: {} } });
    });
    await page.route(/\/(api\/)?history\/fake-sheet-\d+$/, (r) => { const id = r.request().url().split("/").pop(); return r.fulfill({ json: page.__fake?.[id] ? { [id]: page.__fake[id] } : {} }); });
    const cs = await graphOf({ method: "contact_sheet", seeds: [901, 902] });
    const pad = by(cs.graphs[0], "PadImageNode")[0];
    R.pad = pad && { left: pad.inputs["padding_type.left"], right: pad.inputs["padding_type.right"], top: pad.inputs["padding_type.top"], color: pad.inputs["padding_style.color"], from: up(cs.graphs[0], pad.inputs.image)?.inputs?.image, into: up(cs.graphs[0], by(cs.graphs[0], "H3ContactSheet")[0]?.inputs.ref_image)?.class_type };
    R.contact = { r: cs.r, n: cs.graphs.length, seeds: cs.graphs.map((g) => by(g, "RandomNoise")[0]?.inputs.noise_seed), sheet: by(cs.graphs[0], "H3ContactSheet")[0]?.inputs, ref: up(cs.graphs[0], by(cs.graphs[0], "H3ContactSheet")[0]?.inputs.ref_image)?.inputs,
      unet: by(cs.graphs[0], "UNETLoader")[0]?.inputs.unet_name, lora: by(cs.graphs[0], "LoraLoaderModelOnly")[0]?.inputs, steps: by(cs.graphs[0], "BasicScheduler")[0]?.inputs, sampler: by(cs.graphs[0], "KSamplerSelect")[0]?.inputs.sampler_name,
      saves: by(cs.graphs[0], "SaveImage").map((x) => up(cs.graphs[0], x.inputs.images)?.class_type + ":" + x.inputs.images[1]), parent: cs.extra[0]?.snap_parent };
    R.contactDecision = await page.evaluate(async (d) => { const C = window.__C; if (!C.get(d ?? "")) return null; for (let i = 0; i < 40; i++) { await C.settle(); if (C.get(d)?.candidates.every((c) => c.state !== "rendering")) break; await new Promise((r) => setTimeout(r, 250)); } return C.describe(C.get(d)); }, cs.r?.decision);
    const instruct = await graphOf({ method: "contact_sheet_instruct", seeds: [3] });
    R.instruct = { prompt: by(instruct.graphs[0], "H3ContactSheet")[0]?.inputs.prompt, lora: by(instruct.graphs[0], "LoraLoaderModelOnly")[0]?.inputs.lora_name, size: by(instruct.graphs[0], "H3ContactSheet")[0]?.inputs.size };
    const sized = await graphOf({ method: "contact_sheet", seeds: [4], width: 512, height: 512 });
    R.contactSized = by(sized.graphs[0], "H3ContactSheet")[0]?.inputs.size;
    // the five-reference H3 sheet: the Cast's picture, then four more
    const five = await graphOf({ method: "h3_ref_sheet", seeds: [901], pictures: ["left", "back", "face", "boots"].map((n) => ({ file: `snap/snaptest_sheet_${n}.png`, label: `Maren, ${n}` })) });
    const ref = by(five.graphs[0], "MiniMaxH3ReferenceToVideo")[0];
    R.five = { r: five.r, refs: Object.keys(ref?.inputs ?? {}).filter((k) => k.startsWith("ref_images.")).map((k) => up(five.graphs[0], ref.inputs[k])?.inputs.image), length: ref?.inputs.length, size: [ref?.inputs.width, ref?.inputs.height], refSize: ref?.inputs.ref_image_size,
      words: ref?.inputs.prompt, unet: by(five.graphs[0], "UNETLoader")[0]?.inputs.unet_name, loras: by(five.graphs[0], "LoraLoaderModelOnly").length, fizgig: by(five.graphs[0], "FizgigH3StillLatent").length + by(five.graphs[0], "FizgigH3StillDecode").length,
      frame: by(five.graphs[0], "ImageFromBatch")[0]?.inputs.batch_index, latent: up(five.graphs[0], by(five.graphs[0], "SamplerCustomAdvanced")[0]?.inputs.latent_image)?.class_type, steps: by(five.graphs[0], "BasicScheduler")[0]?.inputs, guider: up(five.graphs[0], by(five.graphs[0], "BasicGuider")[0]?.inputs.model)?.class_type };
    const fz = await graphOf({ method: "fizgig_sheet", seeds: [902], design });
    R.fizgig = { words: by(fz.graphs[0], "MiniMaxH3ReferenceToVideo")[0]?.inputs.prompt, latent: by(fz.graphs[0], "FizgigH3StillLatent")[0]?.inputs, turbo: by(fz.graphs[0], "LoraLoaderModelOnly")[0]?.inputs, decode: by(fz.graphs[0], "FizgigH3StillDecode").length };
    // fizgig_still's New view graph as before: the turbo LoRA feeds the guider and the scheduler, the one-frame latent and decode
    const n5 = prompts.length;
    R.still = await call("edit_from_context", { method: "fizgig_still", pictures: [{ cast: R.cast.cast }], prompt: "<Picture 1> at night", seeds: [1], width: 1280, height: 704, land });
    const still = () => prompts.slice(n5).find((x) => x.extra_data?.snap_parent?.method === "view/fizgig_still");
    for (let i = 0; i < 40 && !still(); i++) await page.waitForTimeout(50);
    const sg = still()?.prompt;
    R.stillGraph = sg && { guider: up(sg, by(sg, "BasicGuider")[0]?.inputs.model)?.class_type, sched: up(sg, by(sg, "BasicScheduler")[0]?.inputs.model)?.class_type, latent: up(sg, by(sg, "SamplerCustomAdvanced")[0]?.inputs.latent_image)?.class_type,
      decode: by(sg, "FizgigH3StillDecode").length, refSize: by(sg, "MiniMaxH3ReferenceToVideo")[0]?.inputs.ref_image_size, length: by(sg, "MiniMaxH3ReferenceToVideo")[0]?.inputs.length };
    const kq = await graphOf({ method: "krea2_quadview", seeds: [901] }), kg = kq.graphs[0];
    R.kreaCall = kq.r;
    const patch = by(kg, "Krea2EditModelPatch")[0], enc = by(kg, "Krea2EditGroundedEncode"), ks = by(kg, "KSampler")[0];
    R.krea = { patch: patch && { fit: patch.inputs.fit_mode, boost: patch.inputs.ref_boost, model: up(kg, patch.inputs.model)?.inputs.lora_name, source: up(kg, patch.inputs.source_image)?.class_type, target: up(kg, patch.inputs.target_latent)?.inputs },
      enc: enc.map((x) => [x.inputs.prompt, x.inputs.grounding_px, up(kg, x.inputs.image)?.class_type]), ks: ks && [ks.inputs.steps, ks.inputs.cfg, ks.inputs.sampler_name, ks.inputs.scheduler, up(kg, ks.inputs.model)?.class_type],
      clip: by(kg, "CLIPLoader")[0]?.inputs.type, unet: by(kg, "UNETLoader")[0]?.inputs.unet_name, refMax: by(kg, "ImageScaleToMaxDimension")[0]?.inputs.largest_size };
    const kd = await graphOf({ method: "krea2_dynamic", seeds: [901], design });
    R.dynamic = { words: by(kd.graphs[0], "Krea2EditGroundedEncode").find((x) => x.inputs.prompt)?.inputs.prompt, sampler: by(kd.graphs[0], "KSampler")[0]?.inputs.sampler_name, lora: by(kd.graphs[0], "LoraLoaderModelOnly")[0]?.inputs.lora_name };
    const mo = await graphOf({ method: "moss_charref", seeds: [901], design }), mg = mo.graphs[0];
    R.moss = { enc: by(mg, "TextEncodeMOSSImageEdit").map((x) => [x.inputs.prompt, x.inputs.edit_format, up(mg, x.inputs["images.image_0"])?.class_type]), slg: by(mg, "SkipLayerGuidanceDiTSimple")[0]?.inputs.single_layers,
      ks: by(mg, "KSampler")[0] && ["steps", "cfg", "sampler_name", "scheduler"].map((k) => by(mg, "KSampler")[0].inputs[k]), lora: by(mg, "LoraLoaderModelOnly")[0]?.inputs.lora_name, unet: by(mg, "UNETLoader")[0]?.inputs.unet_name, latent: by(mg, "EmptyFlux2LatentImage")[0]?.inputs, clip: by(mg, "CLIPLoader")[0]?.inputs.type };
    R.refusals = { many: await call("make_character_sheet", { cast: R.cast.cast, method: "krea2_quadview", pictures: [{ file: "snap/snaptest_sheet_left.png" }] }), cast: await call("make_character_sheet", { cast: "cast:nope", method: "moss_charref" }),
      half: await call("make_character_sheet", { cast: R.cast.cast, method: "moss_charref", width: 512 }), method: await call("make_character_sheet", { cast: R.cast.cast, method: "nope" }) };
    // the fwork-rewritten candidates land as still takes in the shot asked for
    await F.idle(port);
    R.landed = await page.evaluate(async ([d, shot, scene, cast]) => {
      const C = window.__C, T = window.__T, SC = window.__SC;
      if (!C.get(d)) return null;
      for (let i = 0; i < 80; i++) { await C.settle(); await T.reload(); if (C.get(d).candidates.every((c) => c.state !== "rendering" && T.get(c.take ?? ""))) break; await new Promise((r) => setTimeout(r, 250)); }
      const x = C.get(d), takes = x.candidates.map((c) => T.get(c.take)).filter(Boolean), sh = SC.get(scene).shots.find((y) => y.id === shot);
      return { states: x.candidates.map((c) => c.state), pictures: x.candidates.map((c) => c.pictures.map((p) => p.label)), takes: takes.map((t) => ({ method: t.parent?.method, cast: t.parent?.options?.cast, world: Object.keys(t.world ?? {}) })),
        inShot: takes.length > 0 && takes.every((t) => SC.takesOf(sh).some((e) => e.take === t.id)), activity: window.__A.all().find((r) => r.decision === d)?.kind };
    }, [mo.r?.decision, R.fix.shot, R.fix.scene, R.cast.cast]);
    R.listedKind = (await call("list_candidates", { kind: "sheet" }))?.map?.((d) => d.id) ?? [];
    R.tile = await page.evaluate(async (d) => { const { candidatesEl } = await import("/extensions/ComfyUI-MAINodes/snap/candidateview.js"); const el = candidatesEl(window.__C.get(d)); document.body.append(el); return el.textContent; }, cs.r?.decision).catch((e) => `error ${e.message}`);
    const P = R.contact?.parent;
    const checks = {
      "make_character_sheet is a tool": R.tools.includes("make_character_sheet") || !!R.contact?.r?.decision,
      "the sheet slot lists its seven methods in order": JSON.stringify(R.listed?.map(([id]) => id)) === JSON.stringify(["contact_sheet", "contact_sheet_instruct", "h3_ref_sheet", "fizgig_sheet", "krea2_quadview", "krea2_dynamic", "moss_charref"]) && R.listed.every(([, s]) => s === "ready"),
      "without its nodes a method says which, and is refused; the contact sheet's nodes are the pack's own": /needs the nodes Krea2EditModelPatch, Krea2EditGroundedEncode/.test(R.listedBare?.find(([id]) => id === "krea2_quadview")?.[1] ?? "") && /needs the nodes Krea2EditModelPatch/.test(R.kreaBare?.error ?? "")
        && R.listedBare.find(([id]) => id === "contact_sheet")?.[1] === "ready" && R.listedBare.find(([id]) => id === "moss_charref")?.[1] === "ready",
      "contact sheet: one prompt per seed, the Cast's picture into H3ContactSheet with the LoRA's orbit words at 1024": R.contact?.n === 2 && JSON.stringify(R.contact.seeds) === "[901,902]" && R.pad?.from === "snap/snaptest_sheet_front.png" && R.pad.into === "PadImageNode"
        && R.contact.sheet?.prompt === "the camera orbits the subject of <Picture 1> ninety degrees clockwise" && R.contact.sheet.size === 1024,
      "contact sheet: the portrait Cast picture is padded to a square in its own corner colour (60x100: 20 px each side)": R.pad?.left === 20 && R.pad.right === 20 && R.pad.top === 0 && /^#[0-9a-f]{6}$/.test(R.pad.color ?? "") && Math.abs(parseInt(R.pad.color.slice(1, 3), 16) - 0x40) <= 3 && Math.abs(parseInt(R.pad.color.slice(5, 7), 16) - 0x80) <= 3,
      "contact sheet: the five-view LoRA on the ref2va model, res_multistep/simple 28 steps": /minimax_h3_ref2va_pruned/.test(R.contact?.unet ?? "") && /five_view_512_s1500/.test(R.contact?.lora?.lora_name ?? "") && R.contact.lora.strength_model === 1 && R.contact.steps?.steps === 28 && R.contact.steps.scheduler === "simple" && R.contact.sampler === "res_multistep",
      "contact sheet: the decode saves the strip and the five views": JSON.stringify(R.contact?.saves?.sort()) === JSON.stringify(["H3ContactSheetDecode:0", "H3ContactSheetDecode:1"]),
      "contact sheet: the instruct checkpoint adds its studio words; width is each view's size": /s400_instruct/.test(R.instruct?.lora ?? "") && R.instruct.prompt === "the camera orbits the subject of <Picture 1> ninety degrees clockwise, neutral studio background, constant lighting" && R.instruct.size === 1024 && R.contactSized === 512,
      "a contact sheet's candidate: the sheet first, then view 1..5": R.contactDecision?.candidates?.every((c) => JSON.stringify(c.pictures.map((p) => p.label)) === JSON.stringify(["sheet", "view 1", "view 2", "view 3", "view 4", "view 5"])) && R.contactDecision.kind === "sheet" && R.contactDecision.target === R.cast.cast,
      "the parent names the method, the Cast and its picture": P?.method === "sheet/contact_sheet" && P.options?.cast === R.cast.cast && P.options.context?.[0]?.cast?.startsWith(R.cast.cast) && P.take === null,
      "five-reference sheet: Ref2V with the five pictures in order, 5 frames, max ref size, 1920x1088, frame 0, no LoRA, no Fizgig nodes": JSON.stringify(R.five?.refs) === JSON.stringify(["snap/snaptest_sheet_front.png", "snap/snaptest_sheet_left.png", "snap/snaptest_sheet_back.png", "snap/snaptest_sheet_face.png", "snap/snaptest_sheet_boots.png"])
        && R.five.length === 5 && R.five.refSize === "max" && JSON.stringify(R.five.size) === "[1920,1088]" && R.five.frame === 0 && R.five.loras === 0 && R.five.fizgig === 0 && R.five.latent === "MiniMaxH3ReferenceToVideo" && R.five.guider === "UNETLoader" && /ref2va_pruned/.test(R.five.unet ?? "")
        && R.five.steps?.steps === 20 && /<Picture 5>/.test(R.five.words ?? "") && !/MANNEQUIN/.test(R.five.words ?? ""),
      "Fizgig one sheet: the name and design in the words, the one-frame latent at 2112x1184, the turbo": /model sheet of Maren from <Picture 1>/.test(R.fizgig?.words ?? "") && R.fizgig.words.includes(design) && R.fizgig.latent?.width === 2112 && R.fizgig.latent.height === 1184 && /turbo_v4/.test(R.fizgig.turbo?.lora_name ?? "") && R.fizgig.decode === 1,
      "New view's Fizgig still graph is unchanged": R.stillGraph?.guider === "LoraLoaderModelOnly" && R.stillGraph.sched === "LoraLoaderModelOnly" && R.stillGraph.latent === "FizgigH3StillLatent" && R.stillGraph.decode === 1 && R.stillGraph.refSize === "match" && R.stillGraph.length === 5,
      "Krea QuadView: krea2edit's patch (fit, boost 1) on the LoRA, grounded words and empty negative, Turbo 10 steps cfg 1 euler": R.krea?.patch?.fit === "fit" && R.krea.patch.boost === 1 && /QuadView_krea2_v1/.test(R.krea.patch.model ?? "") && R.krea.patch.source === "ImageScaleToMaxDimension" && R.krea.patch.target?.width === 1536 && R.krea.patch.target.height === 1024
        && JSON.stringify(R.krea.enc) === JSON.stringify([["Convert the character in the image to a Character Sheet showing a face close-up, front full body, side full body and back full body views", 0, "ImageScaleToMaxDimension"], ["", 768, "ImageScaleToMaxDimension"]])
        && JSON.stringify(R.krea.ks) === JSON.stringify([10, 1, "euler", "simple", "Krea2EditModelPatch"]) && R.krea.clip === "krea2" && /krea2_turbo_fp8_scaled/.test(R.krea.unet ?? "") && R.krea.refMax === 1024,
      "Krea Dynamic: the Cast's name and the design's ';' parts as identity locks, LCM": /\[ENTITY_ID: Maren\]/.test(R.dynamic?.words ?? "") && R.dynamic.words.includes("IDENTITY LOCKS\n- white-silver hair in one low braid\n- two steel pauldrons\n- red cord sash\n") && R.dynamic.sampler === "lcm" && /DynamicCharacterSheet/.test(R.dynamic.lora ?? ""),
      "MOSS CharRef: core MOSS edit encode (ai-toolkit) with the picture at 1 MP, its empty negative, SLG 22, 50 steps cfg 3 euler/sgm_uniform, MOSS Base": R.moss?.enc?.length === 2 && R.moss.enc[0][0].startsWith("Same character and art style as Picture 1. A character turnaround model sheet of Maren") && R.moss.enc[0][0].endsWith(design)
        && R.moss.enc[1][0] === "" && R.moss.enc.every((e) => e[1] === "ai-toolkit" && e[2] === "ImageScaleToTotalPixels") && R.moss.slg === "22" && JSON.stringify(R.moss.ks) === JSON.stringify([50, 3, "euler", "sgm_uniform"]) && /charref_v2/.test(R.moss.lora ?? "") && /moss_image_base/.test(R.moss.unet ?? "") && R.moss.clip === "moss_image" && R.moss.latent?.width === 1536,
      "refusals say what to give": /reads up to 1 picture/.test(R.refusals.many.error ?? "") && /no Cast cast:nope/.test(R.refusals.cast.error ?? "") && /width and height together/.test(R.refusals.half.error ?? "") && /No method "nope" for a character sheet; there are: contact_sheet/.test(R.refusals.method.error ?? ""),
      "the candidates land as still takes in the shot asked for, the Cast pinned": R.landed?.states?.every((s) => s === "ready") && R.landed.inShot && R.landed.takes.length === 1 && R.landed.takes.every((t) => t.method === "sheet/moss_charref" && t.cast === R.cast.cast && t.world.includes(R.cast.cast)) && JSON.stringify(R.landed.pictures) === JSON.stringify([["sheet"]]),
      "the Work card folds it as a paint; list_candidates kind sheet lists them": R.landed?.activity === "paint" && R.listedKind.includes(cs.r?.decision) && R.listedKind.includes(mo.r?.decision),
      "no stray null on the sheet tile": typeof R.tile === "string" && !/^error/.test(R.tile) && !/\bnull\b|undefined|\[object/.test(R.tile),
      "no page errors": !A.errors.length,
    };
    console.log(JSON.stringify(R, null, 1));
    let bad = 0;
    for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
    console.log(`u101sheet ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
    process.exitCode = bad ? 1 : 0;
  } finally {
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `u101sheet-${Date.now()}`);
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
})().catch((e) => { console.error(e); process.exit(2); });
