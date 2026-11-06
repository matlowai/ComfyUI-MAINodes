// Make a take bigger (U102b, the upscale slot's take methods, SNAP-R81/R82): a finished take goes through a second pass at
// a bigger size and lands as a new take whose parent is the take. The slot's media methods (RelayVSR, ESRGAN, resize) run
// inside a new render; these start from a take that exists. Stage 2 (`stage2`; the operator, 2026-11-05: "a full pixels through
// vae like a stage 2 upscale with a light denoise") runs the take's own executed prompt again (its model, LoRAs, words,
// references and seed) from its own frames: decoded, upscaled (Lanczos, or a pixel model first), VAE-encoded at the
// target and given to H3V2VInit with the sound pinned, sampled from `denoise` on the take's own schedule (H3DeropeSigmas):
// the jerk/oracle branch's video-to-video start, so only the empty latent, the size and the start change. `h3_latent` is
// the same with the take's latent made bigger by a latent model. Tessera (`tessera`, hashu786/ComfyUI-Tessera) refines
// the upscaled take tile by tile with the take as <Video 1>, a hero tile on the face (SAM 3.1) and a first-frame still as
// <Picture 1>. What each runs (files, words, sigmas, tiling) is registry data, the method's `run` and `options`.
// Stage 2 runs on stills too (G1): a New view or sheet still's own graph at the bigger size, its sampler starting from the
// still itself (VAE-encoded, the empty AV latent's audio kept) at `denoise`. A take whose purpose is a reference (a Cast
// picture, a turnaround, a location's master or plate, settei) is redrawn this way by default, and the answer says why.
// Stage 2's `speed` (G1b) is time against softness: "quality" keeps the take's own cfg, "fast" samples at cfg 1 (one model
// pass per step: 1.7x faster, a touch softer); quality stays the default.
// SNAP-R85 a reference is redrawn, never only sharpened · SNAP-R113 stage 2 fast is a choice, never the default ·
// SNAP-R81 a take's upscale is a second pass of its own recipe · SNAP-R82 Tessera tiles a take · SNAP-R13 data, not code
// branches · SNAP-R14 method slots · SNAP-R16 GPU work waits for the person · SNAP-R60 pins · see docs/snap/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as ED from "./edits.js";
import * as K from "./checks.js";
import * as M from "./models.js";
import * as S from "./slots.js";
import * as T from "./takes.js";

const FPS = 24;
export const methods = () => S.list("upscale").filter((m) => m.kind === "take");
export async function method(id) {
  await Promise.all([S.load(), M.load()]);
  const m = methods().find((x) => x.id === id);
  if (!m) throw new Error(`No take upscale "${id}"; there are: ${methods().map((x) => x.id).join(", ")}`);
  return m;
}

// a still take's picture size (a video take's render size is ED.clip's)
export const still = (take) => !take.media.some((x) => x.kind === "video") && take.media.find((x) => x.kind === "image");
export async function dims(take) {
  const m = still(take);
  if (!m) return ED.clip(take);
  const img = new Image(); img.src = K.url(m); await img.decode();
  return { width: img.naturalWidth, height: img.naturalHeight };
}
// the size it comes out: `width` and/or `height` (the other keeps the take's shape), else `factor` (the method's when not
// given) times the size the take rendered at (a still's own size: `from`, from dims); snapped down to the method's grid (H3: 32)
export function size(take, m, { factor, width, height } = {}, from = null) {
  const c = from ?? ED.clip(take), q = m.run.grid, f = factor ?? m.run.factor;
  const w = width ?? (height ? (height * c.width) / c.height : c.width * f), hh = height ?? (width ? (width * c.height) / c.width : c.height * f);
  return { from: [c.width, c.height], width: Math.floor(w / q) * q, height: Math.floor(hh / q) * q };
}

const link = (v) => Array.isArray(v) && v.length === 2 && typeof v[0] === "string" && Number.isInteger(v[1]);
// the server keeps a list value plain (BranchNode's branch_names, takes.js canonical); /prompt wants it wrapped again
function sendable(prompt) {
  const g = structuredClone(prompt);
  for (const n of Object.values(g)) for (const [k, v] of Object.entries(n.inputs ?? {})) if (Array.isArray(v) && !link(v)) n.inputs[k] = { __value__: v };
  return g;
}

// the speed's cfg on the guider of every sampler in the recipe, as the A/B set the Render Preset's cfg for both passes
// (null: the take's own)
function guide(g, cfg) {
  if (cfg == null) return;
  for (const n of Object.values(g)) if (n.class_type === "SamplerCustomAdvanced") { const gd = g[n.inputs.guider[0]]; if ("cfg" in gd.inputs) gd.inputs.cfg = cfg; }
}

// stage 2 and h3_latent: the take's own prompt, its empty H3 latent replaced by the take's frames at the target (`plate`
// adds the nodes that make node "u2p", a video latent, from the take's frames and the take's video VAE); every sampler
// that started from the empty latent starts at `denoise` on its own sigmas; every size input at the render size takes the
// target; the saved video carries the take's own sound
function secondPass(take, m, t, denoise, plate, cfg) {
  const c = ED.clip(take), g = sendable(take.prompt), run = m.run;
  const empty = Object.keys(g).filter((k) => run.empty.includes(g[k].class_type));
  if (!empty.length) throw new Error(`Take ${take.number}: its prompt has no ${run.empty.join(" / ")} to start from (${m.title} runs on H3 renders)`);
  const samplers = Object.keys(g).filter((k) => g[k].class_type === "SamplerCustomAdvanced" && empty.includes(g[k].inputs.latent_image?.[0]));
  const decode = Object.values(g).find((n) => n.class_type === "VAEDecode" && samplers.includes(n.inputs.samples?.[0]));
  const sound = Object.keys(g).find((k) => g[k].class_type === "VAEDecodeAudio" && samplers.includes(g[k].inputs.samples?.[0]));
  if (!decode || !sound) throw new Error(`Take ${take.number}: no sampler from its empty latent is decoded to video and sound`);
  for (const n of Object.values(g)) if (n.inputs?.width === c.width && n.inputs?.height === c.height) Object.assign(n.inputs, { width: t.width, height: t.height });
  for (const k of samplers) {
    const s = g[k].inputs;
    g[`u2s${k}`] = { class_type: "H3DeropeSigmas", inputs: { model: g[s.guider[0]].inputs.model, sigmas: s.sigmas, inject: denoise, steps: 0 } };
    s.sigmas = [`u2s${k}`, 0];
  }
  guide(g, cfg);
  for (const n of Object.values(g)) {
    if (n.class_type === "CreateVideo" && n.inputs.audio?.[0] === sound) n.inputs.audio = ["u2c", 1];
    if (n.class_type === "SaveVideo") n.inputs.filename_prefix = `video/snap_upscale/${take.id}`;
  }
  Object.assign(g, {
    u2v: { class_type: "LoadVideo", inputs: { file: c.video } },
    u2c: { class_type: "GetVideoComponents", inputs: { video: ["u2v", 0] } },
    u2a: { class_type: "VAEEncodeAudio", inputs: { audio: ["u2c", 1], vae: g[sound].inputs.vae } },
    ...plate(["u2c", 0], decode.inputs.vae),
  });
  for (const k of empty) g[k] = { class_type: "H3V2VInit", inputs: { samples: ["u2p", 0], audio_latent: ["u2a", 0], audio_mode: run.audio_mode } };
  return g;
}

// stage 2 of a still (a New view or sheet still: P-H3-Image or the Fizgig H3 still): its own graph at the target size, the
// sampler starting from the still itself, upscaled and VAE-encoded with the graph's own VAE as the video half of the
// empty AV latent (its audio half kept), at `denoise` on its own sigmas; saved as a new still
function stillPass(take, m, t, denoise, upscaler, cfg) {
  const g = sendable(take.prompt), samplers = Object.keys(g).filter((k) => g[k].class_type === "SamplerCustomAdvanced");
  const decode = Object.values(g).find((n) => ["VAEDecode", "FizgigH3StillDecode"].includes(n.class_type) && samplers.includes(n.inputs.samples?.[0]));
  if (samplers.length !== 1 || !decode) throw new Error(`Take ${take.number}: its prompt has no one sampler decoded to a still (${m.title} runs on H3 stills made in Snap)`);
  for (const n of Object.values(g)) if ("width" in (n.inputs ?? {}) && "height" in n.inputs && n.class_type !== "ImageScale") Object.assign(n.inputs, { width: t.width, height: t.height });
  const s = g[samplers[0]].inputs;
  g.u2s = { class_type: "H3DeropeSigmas", inputs: { model: g[s.guider[0]].inputs.model, sigmas: s.sigmas, inject: denoise, steps: 0 } };
  Object.assign(g, {
    u2i: { class_type: "LoadImage", inputs: { image: K.annotated(still(take)) } },
    ...(upscaler ? { u2ml: { class_type: "UpscaleModelLoader", inputs: { model_name: upscaler } }, u2mu: { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["u2ml", 0], image: ["u2i", 0] } } } : {}),
    u2up: { class_type: "ImageScale", inputs: { image: upscaler ? ["u2mu", 0] : ["u2i", 0], upscale_method: "lanczos", width: t.width, height: t.height, crop: "disabled" } },
    u2e: { class_type: "VAEEncode", inputs: { pixels: ["u2up", 0], vae: decode.inputs.vae } },
    u2sep: { class_type: "LTXVSeparateAVLatent", inputs: { av_latent: s.latent_image } },
    u2l: { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["u2e", 0], audio_latent: ["u2sep", 1] } },
  });
  s.sigmas = ["u2s", 0]; s.latent_image = ["u2l", 0];
  guide(g, cfg);
  for (const n of Object.values(g)) if (n.class_type === "SaveImage") n.inputs.filename_prefix = `snap_upscale/${take.id}`;
  return g;
}

// pixels: an optional pixel model, then Lanczos to the target, then the VAE; latent: the take at its render size through
// the VAE, then the latent model to the target
const plates = {
  pixels: (t, upscaler) => (frames, vae) => ({
    ...(upscaler ? { u2ml: { class_type: "UpscaleModelLoader", inputs: { model_name: upscaler } }, u2mu: { class_type: "ImageUpscaleWithModel", inputs: { upscale_model: ["u2ml", 0], image: frames } } } : {}),
    u2up: { class_type: "ImageScale", inputs: { image: upscaler ? ["u2mu", 0] : frames, upscale_method: "lanczos", width: t.width, height: t.height, crop: "disabled" } },
    u2p: { class_type: "VAEEncode", inputs: { pixels: ["u2up", 0], vae } },
  }),
  latent: (t, upscaler) => (frames, vae) => ({
    u2r: { class_type: "ImageScale", inputs: { image: frames, upscale_method: "area", width: t.from[0], height: t.from[1], crop: "disabled" } },
    u2e: { class_type: "VAEEncode", inputs: { pixels: ["u2r", 0], vae } },
    u2l: { class_type: "LatentUpscaleModelLoader", inputs: { model_name: upscaler } },
    u2p: { class_type: "MiniMaxH3LatentUpscaleWithModel", inputs: { model: ["u2l", 0], samples: ["u2e", 0], width: t.width, height: t.height } },
  }),
};

// Tessera's first-frame still (<Picture 1>): frame 0 of `anchor` (a take, e.g. this take's stage 2), else the take's own
// frame 0. Tessera crops it per tile (`image_ref_crop: per_tile`), so it must be a view of frame 0: a Cast picture given
// whole to every tile painted small copies of the person into the backdrop tiles (U102b)
function anchorOf(anchor, g) {
  if (!anchor) { g.an = { class_type: "ImageFromBatch", inputs: { image: ["srcs", 0], batch_index: 0, length: 1 } }; return "its own frame 0"; }
  Object.assign(g, { anv: { class_type: "LoadVideo", inputs: { file: ED.clip(anchor).video } }, anc: { class_type: "GetVideoComponents", inputs: { video: ["anv", 0] } },
    an: { class_type: "ImageFromBatch", inputs: { image: ["anc", 0], batch_index: 0, length: 1 } } });
  return `take ${anchor.number}, frame 0`;
}

async function tessera(take, m, t, { hero, anchor, seed }) {
  const run = m.run, c = ED.clip(take), by = t.width / c.width, H = Math.round(c.height * by);
  const f = { clip: await M.choice("CLIPLoader", "clip_name", run.clip), vae: await M.choice("VAELoader", "vae_name", run.vae), audio: await M.choice("VAELoader", "vae_name", run.audio_vae),
    unet: await M.choice("UNETLoader", "unet_name", run.model), turbo: await M.choice("LoraLoaderModelOnly", "lora_name", run.turbo), detail: await M.choice("LoraLoaderModelOnly", "lora_name", run.detail.file) };
  const g = {
    clip: { class_type: "CLIPLoader", inputs: { clip_name: f.clip, type: "minimax", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: f.vae } },
    avae: { class_type: "VAELoader", inputs: { vae_name: f.audio } },
    unet: { class_type: "UNETLoader", inputs: { unet_name: f.unet, weight_dtype: "default" } },
    turbo: { class_type: "LoraLoaderModelOnly", inputs: { model: ["unet", 0], lora_name: f.turbo, strength_model: 1.0 } },
    // Tessera's split: the head on the turbo + some detail LoRA, the released tail below fine_below_sigma on more of it
    main: { class_type: "LoraLoaderModelOnly", inputs: { model: ["turbo", 0], lora_name: f.detail, strength_model: run.detail.head } },
    fine: { class_type: "LoraLoaderModelOnly", inputs: { model: ["turbo", 0], lora_name: f.detail, strength_model: run.detail.tail } },
    src: { class_type: "LoadVideo", inputs: { file: c.video } },
    srcp: { class_type: "GetVideoComponents", inputs: { video: ["src", 0] } },
    // the take at the size it rendered at (an upscaled take's file is bigger): the factor counts from there
    srcs: { class_type: "ImageScale", inputs: { image: ["srcp", 0], upscale_method: "area", width: c.width, height: c.height, crop: "disabled" } },
  };
  const from = anchorOf(anchor, g);
  Object.assign(g, {
    refs: { class_type: "H3References", inputs: { "ref_images.ref_image_0": ["an", 0], "ref_videos.ref_video_0": ["srcs", 0] } },
    pos0: { class_type: "H3ReferenceToVideoRefs", inputs: { clip: ["clip", 0], vae: ["vae", 0], audio_vae: ["avae", 0], refs: ["refs", 0], prompt: run.prompt, width: t.width, height: H, length: c.frames, ref_image_size: "match" } },
    // the plate latent and the guide, encoded window by window (Tessera's Streamed Encode: no whole 4K clip in memory)
    enc: { class_type: "TesseraEncode", inputs: { images: ["srcs", 0], vae: ["vae", 0], positive: ["pos0", 0], upscale_by: by, upscale_method: "lanczos", segment_frames: run.segment_frames } },
    neg: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["pos0", 0] } },
    aenc: { class_type: "VAEEncodeAudio", inputs: { audio: ["srcp", 1], vae: ["avae", 0] } },
    amask: { class_type: "SolidMask", inputs: { value: 0.0, width: 32, height: 32 } }, // the sound is kept, not sampled
    alat: { class_type: "SetLatentNoiseMask", inputs: { samples: ["aenc", 0], mask: ["amask", 0] } },
    av: { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["enc", 1], audio_latent: ["alat", 0] } },
    smp: { class_type: "KSamplerSelect", inputs: { sampler_name: run.sampler } },
    smpf: { class_type: "KSamplerSelect", inputs: { sampler_name: run.sampler_fine } },
    sig: { class_type: "ManualSigmas", inputs: { sigmas: run.sigmas } },
    args: { class_type: "TesseraArgs", inputs: { ...run.args } },
  });
  const heroIn = {};
  if (hero) {
    Object.assign(g, {
      sam: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: await M.choice("CheckpointLoaderSimple", "ckpt_name", run.hero.detector) } },
      samt: { class_type: "CLIPTextEncode", inputs: { clip: ["sam", 1], text: hero } },
      trk: { class_type: "SAM3_VideoTrack", inputs: { images: ["srcs", 0], model: ["sam", 0], conditioning: ["samt", 0], detection_threshold: run.hero.threshold, max_objects: 1, detect_interval: 1 } },
      hmask: { class_type: "SAM3_TrackToMask", inputs: { track_data: ["trk", 0], object_indices: "" } },
      hsig: { class_type: "ManualSigmas", inputs: { sigmas: run.hero.sigmas } },
    });
    Object.assign(heroIn, { hero_mask: ["hmask", 0], hero_sigmas: ["hsig", 0] });
  }
  Object.assign(g, {
    ref: { class_type: "TesseraRefine", inputs: { model: ["main", 0], model_fine: ["fine", 0], clip: ["clip", 0], positive: ["enc", 0], negative: ["neg", 0], latent: ["av", 0], vae: ["vae", 0],
      sampler: ["smp", 0], sampler_fine: ["smpf", 0], sigmas: ["sig", 0], args: ["args", 0], ...heroIn, ...run.refine, seed, prompt: run.prompt } },
    out: { class_type: "CreateVideo", inputs: { images: ["ref", 2], audio: ["srcp", 1], fps: FPS, bit_depth: 8, color_space: "sRGB", chroma_subsampling: "auto", codec: "none" } },
    save: { class_type: "SaveVideo", inputs: { video: ["out", 0], filename_prefix: `video/snap_upscale/${take.id}`, format: "auto", "format.codec": "auto", codec: "auto" } },
  });
  return { g, anchor: from, height: H };
}

// F-C26: a run whose Upscale brick failed (RelayVSR out of memory at 4096x2048) lost its finished render, since Save
// comes after Upscale. Snap runs the same prompt again with the upscale left out (its consumers take the upscale's own
// input), so ComfyUI serves the render from its cache and saves it: the render lands as its own take, a child of the
// failed one, whose job says what failed. Never for a rescue, and only when the failed node is the Upscale brick's
const UPSCALE_BRICKS = () => S.list("upscale").map((m) => m.brick).filter(Boolean);
export async function rescue(take) {
  await S.load();
  const nid = String(take?.failed_node ?? ""), bricks = take?.graph?.extra?.snap?.bricks ?? [], g = take?.prompt && sendable(take.prompt);
  const b = bricks.find((x) => UPSCALE_BRICKS().includes(x.key) && Object.values(x.nodes ?? {}).map(String).includes(nid));
  if (!b || !g?.[nid] || take.parent?.method === "rescue/upscale") return null;
  const own = new Set(Object.values(b.nodes).map(String)), src = Object.values(g[nid].inputs).find((v) => link(v) && !own.has(v[0]));
  if (!src) return null;
  for (const n of Object.values(g)) for (const [k, v] of Object.entries(n.inputs ?? {})) if (link(v) && v[0] === nid) n.inputs[k] = src;
  delete g[nid];
  const what = `${LiteGraph.registered_node_types[take.prompt[nid].class_type]?.title ?? take.prompt[nid].class_type}: ${take.error ?? "failed"}`;
  const job = { kind: "run", title: `Keep the render of take ${take.number}: the Upscale failed (${what})`, about: { take: take.id, group: take.group }, by: "person" };
  return K.queue(g, { group: take.group, world: take.graph?.extra?.snap?.world, job, extra: { snap_parent: { take: take.id, method: "rescue/upscale", options: { failed: what } } } });
}
T.onFailed((t) => { rescue(t).catch((e) => console.warn(`Snap couldn't keep the render of take ${t?.number}: ${e.message}`)); });

// queue the bigger take: a new take in the take's group, parent the take (`upscale/<method>`), carrying the take's world
// pins (SNAP-R60); its rating follows the parent (SNAP-R39). `anchor` is a take (Tessera only; null = the take's own frame 0,
// undefined = the take's newest stage 2)
// why a take's upscale redraws: its purpose, when that is a reference (SNAP-R85); null otherwise
export function reason(take) {
  const p = ED.purposeOf(take);
  return p?.reference ? `take ${take.number} is a reference (${p.label}: ${p.from}): a reference is redrawn at the new size (stage 2, light denoise), so a face too small to read is drawn again as a face, not only sharpened` : null;
}
// the speed asked for (the method's default when not given): {name, cfg, speedup}; a method without speeds has none
export function speedOf(m, speed) {
  const o = m.options?.speed;
  if (!o) { if (speed != null) throw new Error(`${m.title} has no speed choice; stage2 has quality and fast`); return null; }
  const name = speed ?? o.default, c = o.choices[name];
  if (!c) throw new Error(`speed is one of ${Object.keys(o.choices).map((x) => `"${x}"`).join(", ")}: ${Object.entries(o.choices).map(([k, v]) => `${k} = ${v.label}`).join("; ")}`);
  return { name, cfg: c.cfg, speedup: c.speedup };
}
export async function start(take, id, { factor, width, height, denoise, upscaler, hero, anchor, speed, by = "person" } = {}) {
  const m = await method(id), pic = still(take), pace = speedOf(m, speed), fast = pace && pace.cfg != null ? { speed: pace.name, cfg: pace.cfg } : {};
  if (pic && m.run.plate !== "pixels") throw new Error(`Take ${take.number} is a still: ${m.title} runs on video takes; stage2 redraws a still`);
  if (m.install_state !== "ready") throw new Error(`${m.title}: ${m.install_state}`);
  const t = size(take, m, { factor, width, height }, pic ? await dims(take) : null), o = m.options;
  if (pic) { // a still's own nodes cap its size (the Fizgig still latent: 4096 a side): the long side comes down to it
    const most = Math.min(...await Promise.all([...new Set(Object.values(take.prompt).filter((n) => "width" in (n.inputs ?? {}) && n.class_type !== "ImageScale").map((n) => n.class_type))].map(async (c) => {
      const spec = (await (await api.fetchApi(`/object_info/${c}`)).json())[c]?.input; return [spec?.required?.width, spec?.optional?.width].find(Boolean)?.[1]?.max ?? Infinity; })));
    const k = Math.min(1, most / Math.max(t.width, t.height));
    if (k < 1) Object.assign(t, { width: Math.floor((t.width * k) / m.run.grid) * m.run.grid, height: Math.floor((t.height * k) / m.run.grid) * m.run.grid, capped: `${most} is the largest side its nodes take` });
  }
  let g, options;
  if (pic) {
    denoise ??= o.denoise.default;
    if (!(denoise >= o.denoise.min && denoise <= o.denoise.max)) throw new Error(`denoise: how much of the still is made again, ${o.denoise.min} to ${o.denoise.max} (${o.denoise.default} is light)`);
    const pick = upscaler === undefined ? o.upscaler.default : upscaler, file = pick && pick !== "none" ? await M.choice(o.upscaler.loader, "model_name", pick) : null;
    g = stillPass(take, m, t, denoise, file, pace?.cfg);
    options = { width: t.width, height: t.height, denoise, still: true, ...fast, ...(t.capped ? { capped: t.capped } : {}), ...(file ? { upscaler: file } : {}) };
  } else if (m.run.plate) {
    denoise ??= o.denoise.default;
    if (!(denoise >= o.denoise.min && denoise <= o.denoise.max)) throw new Error(`denoise: how much of the take is made again, ${o.denoise.min} to ${o.denoise.max} (${o.denoise.default} is light)`);
    const pick = upscaler === undefined ? o.upscaler.default : upscaler; // null or "none": Lanczos only
    const file = pick && pick !== "none" ? await M.choice(o.upscaler.loader, "model_name", pick) : null;
    g = secondPass(take, m, t, denoise, plates[m.run.plate](t, file), pace?.cfg);
    options = { width: t.width, height: t.height, denoise, ...fast, ...(file ? { upscaler: file } : {}) };
  } else {
    // the anchor: the take given, else this take's newest stage 2, else (null) the take's own frame 0
    if (anchor === undefined) anchor = T.all().filter((x) => x.parent?.take === take.id && x.parent.method === "upscale/stage2" && x.status === "success" && x.media.some((f) => f.kind === "video")).at(-1) ?? null;
    const made = await tessera(take, m, t, { hero: hero ?? o.hero.default, anchor, seed: take.seed ?? 0 });
    g = made.g; t.height = made.height;
    options = { width: t.width, height: t.height, hero: hero ?? o.hero.default, anchor: made.anchor, ...(anchor ? { anchor_take: anchor.id } : {}) };
  }
  const per = m.cost?.local_s_per_mp_frame, eta_s = per && !pic ? Math.round((per * ((t.width * t.height) / 1e6) * ED.clip(take).frames) / (pace?.speedup ?? 1)) : null; // measured on video only
  const job = { kind: "upscale", title: `Make take ${take.number} ${t.width}×${t.height}: ${m.title}${options.denoise != null ? ` at denoise ${options.denoise}` : ""}${fast.speed ? `, fast (cfg ${fast.cfg})` : ""}`, about: { take: take.id, group: take.group }, by, eta_s };
  const runId = await K.queue(g, { group: take.group, world: take.graph?.extra?.snap?.world, job, extra: { snap_parent: { take: take.id, method: `upscale/${id}`, options, by } } });
  const why = reason(take);
  return { prompt_id: runId, take: `take-${runId}`, ...options, eta_s, eta: eta_s ? (eta_s < 90 ? `about ${eta_s} s of GPU` : `about ${Math.round(eta_s / 60)} min of GPU`) : "no estimate yet", ...(why ? { why } : {}) };
}
