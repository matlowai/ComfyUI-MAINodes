// Make a take longer (U46c, the method registry's "extend" slot): new clips continue the take past its end and land, joined
// to it, as a new version of the take. Standard carries the sampler's latent from clip to clip (Geiru Context with its
// protection off): the take's own last 39 frames are encoded once, every later clip starts from the clip before it as
// sampled, so nothing is decoded and encoded again per clip, the source of the old chain's colour creep (U46b: saturation
// 1.42 -> 1.10). Seam Normalize matches each clip's colour to the frames it continues; Anti-Burn is an opt-in slider, off by
// default (it only softened, at every length tested up to 35 s). Strong is the Geiru bundle (keystone + late lock + context
// noise + Anti-Burn): it keeps the look and may reset the action. Long (U46e-g) is Standard plus a re-anchor to the take's
// first clip on every 3rd clip (Geiru keystone front + capstone back, nothing else of Strong), and those clips don't carry
// the clip before's sound (hold_audio off): the H3 audio drone rides on that carry (U46g). The slot's default follows
// the length asked for (Standard up to ~40 s, Long beyond; Strong is a pick). Joins follow the Geiru README: each clip holds the last
// 22 kept frames of the one before, the 17 after them are generated free, so a clip adds L - 39 frames (the last L - 22).
// What runs (models, frame counts, prompts) is registry data, the slot's `run`.
// SNAP-R4 outcome faces · SNAP-R13 data, not code branches · SNAP-R14 method slots · SNAP-R16 GPU work waits for the
// person · SNAP-R50 a longer take carries the latent · SNAP-R64 Long re-anchors, the default follows the length ·
// see docs/snap/SNAP_RULES.md
import * as ED from "./edits.js";
import * as K from "./checks.js";
import * as M from "./models.js";
import * as S from "./slots.js";

const FPS = 24, HEAD = 39, DROP = 17, HELD = HEAD - DROP; // Geiru Context: head 39, drop_last 17 -> 22 held frames
export async function method(id) {
  await Promise.all([S.load(), M.load()]);
  const m = S.list("extend").find((x) => x.id === id);
  if (!m) throw new Error(`No extend method "${id}"; there are: ${S.list("extend").map((x) => x.id).join(", ")}`);
  return m;
}

// how long the take comes out: the take minus its last 17 frames, each new clip but the last L - 39, the last L - 22
export function length(take, clips) {
  const c = ED.clip(take), L = S.slot("extend").run.clip_frames;
  const frames = c.frames - DROP + (clips - 1) * (L - HEAD) + (L - HELD);
  return { frames, seconds: +(frames / FPS).toFixed(1), added: +((frames - c.frames) / FPS).toFixed(1), from: +(c.frames / FPS).toFixed(1) };
}

// the method a take this long gets by default, and why (the slot's `defaults`: the first row it fits, SNAP-R64)
export function pick(take, clips) {
  const { seconds } = length(take, clips), row = S.slot("extend").defaults.find((d) => d.up_to_s == null || seconds <= d.up_to_s);
  return { method: row.method, why: row.why, seconds };
}

// the continuation prompt: the take's description and soundscape, said to go on without a cut (U46's wording). The extend
// graph wires no pictures, so a take's "<Picture N>" (a Ref2V take's References, in socket order) can't stay: a Cast
// picture's token becomes the person's name ("<Picture 1> Ana" reads "Ana"), and a sentence that points at any other
// picture (a set plate's "shown in <Picture 2>") is left out
function unpictured(text, pictures) {
  const name = (i) => /^cast: ([^,]+),/.exec(pictures[i - 1]?.role ?? "")?.[1] ?? null;
  return text.split(/(?<=[.!?])\s+/).filter((x) => [...x.matchAll(/<Picture (\d+)>/g)].every((m) => name(+m[1]))).join(" ")
    .replace(/<Picture (\d+)>(\s+(\S+))?/g, (_, i, gap, next) => (next?.toLowerCase() === name(+i).toLowerCase() ? name(+i) : `${name(+i)}${gap ?? ""}`));
}
function continued(text, run, pictures) {
  const [desc, sound] = text.split(/\n*overall_soundscape:\s*/);
  const scene = unpictured(desc.replace(/^integrated_multimodal_description:\s*/, "").replace(/^\[Shot \d+\]\s*/, ""), pictures);
  return run.prompt.replace("{scene}", scene.trim()) + (sound ? `\n\noverall_soundscape: ${run.sound.replace("{sound}", sound.trim())}` : "");
}

// the take's own H3 settings when it rendered from a first frame or text (model, LoRA, sampler, sigmas, shifts), else the slot's
function preset(take, run) {
  const own = Object.values(take.prompt ?? {}).find((n) => n.class_type === "MAIRenderPreset" && /^(FL2V|T2V)/.test(n.inputs?.conditioning ?? ""));
  return own && Object.values(own.inputs).every((v) => !Array.isArray(v)) ? { ...own.inputs, derope_steps: 0 } : run.preset;
}

// queue the longer version: `clips` new clips (as many as asked), Anti-Burn at `antiburn` on Standard (0 = off). Lands as
// a version of the take in its group
export async function start(take, id, { clips = 1, antiburn = 0, prompt, by = "person" } = {}) {
  await S.load(); id ??= pick(take, clips).method;
  const m = await method(id), run = S.slot("extend").run, strong = !!m.protection, every = m.anchor?.every;
  if (m.install_state !== "ready") throw new Error(`${m.title}: ${m.install_state}`);
  if (!(Number.isInteger(clips) && clips >= 1)) throw new Error("clips: how many clips to add, 1 or more");
  const c = ED.clip(take), L = run.clip_frames, F = c.frames, p = preset(take, run);
  const f = { clip: await M.choice("CLIPLoader", "clip_name", run.clip), vae: await M.choice("VAELoader", "vae_name", run.vae), audio: await M.choice("VAELoader", "vae_name", run.audio_vae),
    model: await M.choice("MAIRenderPreset", "model", p.model), lora: p.lora === "none" ? "none" : await M.choice("MAIRenderPreset", "lora", p.lora) };
  const burn = strong ? m.protection.antiburn : m.options?.antiburn ? antiburn : 0, ab = burn > 0 ? await M.choice("LoraLoaderModelOnly", "lora_name", m.options?.antiburn?.file ?? m.protection?.file) : null;
  const text = prompt ?? continued(take.text, run, take.graph?.extra?.snap?.bricks?.find((x) => x.key === "refs")?.pictures ?? []);
  const g = {
    clip: { class_type: "CLIPLoader", inputs: { clip_name: f.clip, type: "minimax", device: "default" } },
    vae: { class_type: "VAELoader", inputs: { vae_name: f.vae } },
    avae: { class_type: "VAELoader", inputs: { vae_name: f.audio } },
    rp: { class_type: "MAIRenderPreset", inputs: { ...p, model: f.model, lora: f.lora } },
    src: { class_type: "LoadVideo", inputs: { file: c.video } },
    srcp: { class_type: "GetVideoComponents", inputs: { video: ["src", 0] } },
    // the take's frames at the size it rendered at: an upscaled take's file is bigger than the clips H3 makes, and the
    // carry, the keystone and the join all need one size (the longer take comes out at the render size)
    srcs: { class_type: "ImageScale", inputs: { image: ["srcp", 0], upscale_method: "area", width: c.width, height: c.height, crop: "disabled" } },
    // the take's last 39 frames and their sound, encoded once: the first new clip continues from them
    tail: { class_type: "ImageFromBatch", inputs: { image: ["srcs", 0], batch_index: F - HEAD, length: HEAD } },
    taila: { class_type: "TrimAudioDuration", inputs: { audio: ["srcp", 1], start_index: (F - HEAD) / FPS, duration: HEAD / FPS } },
    tailv: { class_type: "VAEEncode", inputs: { pixels: ["tail", 0], vae: ["vae", 0] } },
    tailau: { class_type: "VAEEncodeAudio", inputs: { audio: ["taila", 0], vae: ["avae", 0] } },
    tailav: { class_type: "LTXVConcatAVLatent", inputs: { video_latent: ["tailv", 0], audio_latent: ["tailau", 0] } },
    keep0: { class_type: "ImageFromBatch", inputs: { image: ["srcs", 0], batch_index: 0, length: F - DROP } },
    keep0a: { class_type: "TrimAudioDuration", inputs: { audio: ["srcp", 1], start_index: 0, duration: (F - DROP) / FPS } },
    held0: { class_type: "ImageFromBatch", inputs: { image: ["srcs", 0], batch_index: F - HEAD, length: HELD } },
    // Long's anchor: the take's first clip (its first 141 frames), encoded once; its first and last single-frame latents are
    // the keystone and the capstone (U46e anchors to clip 1)
    ...(every && clips + 1 >= every ? {
      anc: { class_type: "ImageFromBatch", inputs: { image: ["srcs", 0], batch_index: 0, length: Math.min(F, L) } },
      ancv: { class_type: "VAEEncode", inputs: { pixels: ["anc", 0], vae: ["vae", 0] } },
    } : {}),
    ...(ab && !strong ? { abm: { class_type: "LoraLoaderModelOnly", inputs: { model: ["rp", 0], lora_name: ab, strength_model: burn } } } : {}),
  };
  let images = ["keep0", 0], audio = ["keep0a", 0], held = ["held0", 0];
  for (let k = 1; k <= clips; k++) {
    const end = k < clips ? L - DROP : L, prev = k === 1 ? ["tailav", 0] : [`s${k - 1}`, 0], anchor = !!every && (k + 1) % every === 0;
    Object.assign(g, {
      [`c${k}`]: { class_type: "MiniMaxH3ImageToVideo", inputs: { clip: ["clip", 0], vae: ["vae", 0], prompt: text, width: c.width, height: c.height, length: L } },
      [`sh${k}`]: { class_type: "PrimitiveInt", inputs: { value: k + 1 } }, // the take is shot 1
      [`cx${k}`]: { class_type: "H3ClownContextExperimental", inputs: { latent: [`c${k}`, 1], head_frames: HEAD, drop_last: DROP, drop_first: 0, hold_audio: !anchor || m.anchor.hold_audio, first_shot: 1, audio_frames: 0,
        audio_feather_ticks: 0, degradation_protection: strong || anchor, shot_number: [`sh${k}`, 0], previous_shot: prev } },
    });
    let model = ab && !strong ? ["abm", 0] : ["rp", 0], latent = [`cx${k}`, 0];
    if (strong) {
      const pr = m.protection;
      Object.assign(g, {
        [`pr${k}`]: { class_type: "H3ClownProtectionLora", inputs: { model: ["rp", 0], latent, lora_name: ab, strength: pr.antiburn, enabled: true, first_shot: 1, shot_number: [`sh${k}`, 0] } },
        [`cn${k}`]: { class_type: "H3ClownContextNoise", inputs: { latent: [`pr${k}`, 1], model: [`pr${k}`, 0], enabled: true, strength: pr.context_noise, fade: "linear", skip_first: true } },
        [`ky${k}`]: { class_type: "H3ClownKeyframe", inputs: { latent: [`cn${k}`, 0], enabled: true, placement: pr.placement, source_clip: 1, keyframe: ["tailav", 0], shot_number: [`sh${k}`, 0], model: [`cn${k}`, 1] } },
        [`ll${k}`]: { class_type: "H3ClownLateLock", inputs: { model: [`ky${k}`, 1], latent: [`ky${k}`, 0], swap_step: pr.late_lock_step, slots: "capstone slot (back)" } },
      });
      model = [`ll${k}`, 0]; latent = [`ll${k}`, 1];
    } else if (anchor) {
      g[`ky${k}`] = { class_type: "H3ClownKeyframe", inputs: { latent, enabled: true, placement: m.anchor.placement, source_clip: 1, keyframe: ["ancv", 0], shot_number: [`sh${k}`, 0], model } };
      model = [`ky${k}`, 1]; latent = [`ky${k}`, 0];
    }
    Object.assign(g, {
      [`nz${k}`]: { class_type: "RandomNoise", inputs: { noise_seed: Math.floor(Math.random() * 2 ** 32) } },
      [`gd${k}`]: { class_type: "BasicGuider", inputs: { model, conditioning: [`c${k}`, 0] } },
      [`s${k}`]: { class_type: "SamplerCustomAdvanced", inputs: { noise: [`nz${k}`, 0], guider: [`gd${k}`, 0], sampler: ["rp", 1], sigmas: ["rp", 2], latent_image: latent } },
      [`im${k}`]: { class_type: "VAEDecode", inputs: { samples: [`s${k}`, 0], vae: ["vae", 0] } },
      [`au${k}`]: { class_type: "VAEDecodeAudio", inputs: { samples: [`s${k}`, 0], vae: ["avae", 0] } },
      // what this clip keeps (from frame 22), its colour matched on the 22 frames it holds against what it continues
      [`kp${k}`]: { class_type: "ImageFromBatch", inputs: { image: [`im${k}`, 0], batch_index: HELD, length: end - HELD } },
      [`ka${k}`]: { class_type: "TrimAudioDuration", inputs: { audio: [`au${k}`, 0], start_index: HELD / FPS, duration: (end - HELD) / FPS } },
      [`gp${k}`]: { class_type: "ImageFromBatch", inputs: { image: [`im${k}`, 0], batch_index: 0, length: HELD } },
      [`sn${k}`]: { class_type: "H3SeamNormalize", inputs: { source_tail: held, generated_prefix: [`gp${k}`, 0], images: [`kp${k}`, 0], mode: "channels (linear-light RGB gains)", max_gain: 1.25 } },
      [`ib${k}`]: { class_type: "ImageBatch", inputs: { image1: images, image2: [`sn${k}`, 0] } },
      [`ac${k}`]: { class_type: "AudioConcat", inputs: { audio1: audio, audio2: [`ka${k}`, 0], direction: "after" } },
      // the next clip holds this one's frames L-39 .. L-18, kept here at L-61 .. L-40
      [`hd${k}`]: { class_type: "ImageFromBatch", inputs: { image: [`sn${k}`, 0], batch_index: L - HEAD - HELD, length: HELD } },
    });
    images = [`ib${k}`, 0]; audio = [`ac${k}`, 0]; held = [`hd${k}`, 0];
  }
  Object.assign(g, {
    out: { class_type: "CreateVideo", inputs: { images, audio, fps: FPS, bit_depth: 8, color_space: "sRGB", chroma_subsampling: "auto", codec: "none" } },
    save: { class_type: "SaveVideo", inputs: { video: ["out", 0], filename_prefix: `video/snap_extend/${take.id}`, format: "auto", "format.codec": "auto", codec: "auto" } },
  });
  const options = { clips, ...(m.options?.antiburn ? { antiburn } : {}), ...(prompt ? { prompt } : {}) };
  const made = length(take, clips), eta_s = clips * (m.cost?.local_s_per_clip ?? 60);
  const job = { kind: "extend", title: `Make take ${take.number} ${made.seconds} s long (${m.title}, +${clips} clip${clips === 1 ? "" : "s"})`, about: { take: take.id, group: take.group }, by, eta_s };
  const runId = await K.queue(g, { group: take.group, job, extra: { snap_parent: { take: take.id, method: `extend/${id}`, options, by } } });
  return { prompt_id: runId, take: `take-${runId}`, ...made, eta_s };
}
