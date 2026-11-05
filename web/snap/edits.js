// Change something in a take, or recast a person in it (U54, U73; the method registry's "edit" and "recast" slots): a
// method makes a new take from an existing one. MOSS paints the change into the take's frames (core
// TextEncodeMOSSImageEdit and an edit LoRA), each set of painted frames is a candidate with identity notes against the take
// (the MOSS edit turned hair grey-silver in U53b), and once the person applies one, the change is carried over the whole
// take: H3 Ripple with the take as its guide (relight, U53b), or Viggle Remake with the painted frames pinned at the frames
// they were painted from (remake_edit, remake_swap, U69). Night, rain and snow are examples of a change, not features: any
// change can be written. A recast swaps the identity notes for a "new person" note, and nothing is refused. The render
// lands as a new take in the same group whose parent is the original. What a method runs is registry data.
// SNAP-R13 data, not code branches · SNAP-R14 method slots · SNAP-R16 GPU work waits for the person · SNAP-R17 by ·
// SNAP-R23 candidates · SNAP-R51 change something, recast, pins · see docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as C from "./candidates.js";
import * as K from "./checks.js";
import * as M from "./models.js";
import * as S from "./slots.js";
import * as T from "./takes.js";

const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
const SLOTS = ["edit", "recast"];
export async function method(id) {
  await Promise.all([S.load(), M.load()]);
  const all = SLOTS.flatMap((s) => S.list(s)), m = all.find((x) => x.id === id);
  if (!m) throw new Error(`No method "${id}" to change or recast with; there are: ${all.map((x) => x.id).join(", ")}`);
  return m;
}
const clock = (frame) => { const ms = Math.round((frame / 24) * 1000); return `${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`; };

// the take's clip as the edit sees it: its video file, frame count (the render's length snapped up to H3's 17k + 5
// grid, as the take was rendered), the mid frame and the size
export function clip(take) {
  const m = take.media.find((x) => x.kind === "video");
  if (!m) throw new Error(`Take ${take.number} has no video to edit`);
  const r = Object.values(take.prompt ?? {}).map((x) => x.inputs ?? {}).filter((x) => typeof x.length === "number" && typeof x.width === "number").sort((a, b) => b.length - a.length)[0];
  if (!r) throw new Error(`Take ${take.number}: its prompt has no render length and size to edit at`);
  const frames = Math.ceil((r.length - 5) / 17) * 17 + 5;
  return { video: K.annotated(m), frames, mid: Math.floor(frames / 2), width: r.width, height: r.height };
}

// the painted frames of one candidate, as one prompt (U53b's edit graph: 1.0 MP, SLG 22, 30 steps euler/normal)
async function anchorsGraph(take, a, recipe, frames, values, seed) {
  const c = clip(take), files = { unet: await M.choice("UNETLoader", "unet_name", a.unet), clip: await M.choice("CLIPLoader", "clip_name", a.clip), vae: await M.choice("VAELoader", "vae_name", a.vae), lora: await M.choice("LoraLoaderModelOnly", "lora_name", recipe.lora) };
  const g = {
    1: { class_type: "UNETLoader", inputs: { unet_name: files.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: files.clip, type: "moss_image", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: files.vae } },
    4: { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: files.lora, strength_model: 1.0 } },
    5: { class_type: "SkipLayerGuidanceDiTSimple", inputs: { model: ["4", 0], double_layers: "", single_layers: a.slg_single, start_percent: 0.0, end_percent: 1.0 } },
    6: { class_type: "LoadVideo", inputs: { file: c.video } },
    7: { class_type: "GetVideoComponents", inputs: { video: ["6", 0] } },
  };
  // a recast from a Cast with a picture: its picture is the paint's Picture 2, and the prompt says who it shows (U89 3b)
  const who = values.picture && a.identity_picture ? { 8: { class_type: "LoadImage", inputs: { image: values.picture } } } : null;
  if (who) g[8] = who[8];
  frames.forEach((frame, i) => {
    const k = (x) => `a${i}${x}`, enc = (text) => ({ class_type: "TextEncodeMOSSImageEdit", inputs: { clip: ["2", 0], prompt: text, vae: ["3", 0], edit_format: recipe.format, "images.image_0": [k("s"), 0], ...(who ? { "images.image_1": ["8", 0] } : {}), image_strength: 1.0 } });
    Object.assign(g, {
      [k("f")]: { class_type: "ImageFromBatch", inputs: { image: ["7", 0], batch_index: frame, length: 1 } },
      [k("s")]: { class_type: "ImageScaleToTotalPixels", inputs: { image: [k("f"), 0], upscale_method: "lanczos", megapixels: 1.0, resolution_steps: 16 } },
      [k("z")]: { class_type: "GetImageSize", inputs: { image: [k("s"), 0] } },
      [k("l")]: { class_type: "EmptyFlux2LatentImage", inputs: { width: [k("z"), 0], height: [k("z"), 1], batch_size: 1 } },
      [k("p")]: enc(fill(who ? `${a.prompt} ${a.identity_picture}` : a.prompt, values)), [k("n")]: enc(fill(a.negative, values)),
      [k("k")]: { class_type: "KSampler", inputs: { model: ["5", 0], seed, steps: a.steps, cfg: recipe.cfg, sampler_name: a.sampler, scheduler: a.scheduler, positive: [k("p"), 0], negative: [k("n"), 0], latent_image: [k("l"), 0], denoise: 1.0 } },
      [k("d")]: { class_type: "VAEDecode", inputs: { samples: [k("k"), 0], vae: ["3", 0] } },
      [k("o")]: { class_type: "SaveImage", inputs: { images: [k("d"), 0], filename_prefix: `snap_edits/${take.id}_f${frame}` }, _meta: { title: `frame ${frame}` } },
    });
  });
  return g;
}

// what to change: an example of the method's (night), or the person's own words; a recast names who and who instead
function asked(m, { example, change, who, becomes }) {
  if (m.slot === "recast") {
    if (!who?.trim() || !becomes?.trim()) throw new Error(`${m.title}: say who is in the take now (who) and who they become (becomes)`);
    return { who: who.trim(), becomes: becomes.trim(), avoid: "", label: fill(m.face, { who: who.trim(), becomes: becomes.trim() }) };
  }
  const ex = example && m.options?.examples?.[example];
  if (example && !ex) throw new Error(`${m.title}: no example "${example}"; there are ${Object.keys(m.options?.examples ?? {}).join(", ")}, or write your own change`);
  const text = (change ?? ex?.change ?? "").trim();
  if (!text) throw new Error(`${m.title}: say what changes (change), e.g. "the benches into a yellow phone booth", or pick an example: ${Object.keys(m.options?.examples ?? {}).join(", ")}`);
  return { change: text, avoid: ex && !change ? ex.avoid : "", label: ex && !change ? example : text.length > 40 ? `${text.slice(0, 38)}…` : text, ...(ex && !change ? { example } : {}) };
}
// the frames painted: the take's first and middle (relight, U53b), or the frames asked for (a moving object: where it
// enters and where it leaves, U69), else the middle one
function paintAt(m, c, frames) {
  if (frames?.length) {
    const bad = frames.filter((f) => !Number.isInteger(f) || f < 0 || f >= c.frames);
    if (bad.length) throw new Error(`frames: whole frame numbers from 0 to ${c.frames - 1} (24 per second); not ${bad.join(", ")}`);
    return [...new Set(frames)].sort((a, b) => a - b);
  }
  return m.anchors.frames === "ends" ? [0, c.mid] : [c.mid];
}

// make `count` candidates (sets of painted frames) for a change or a recast of a take; the recipes take turns (U53b:
// each edit LoRA won on one seed), seeds vary. Returns at once; the candidates fill in as their paints finish (12-19 s a
// frame on a 5090). A method that pins (Remake) pins each candidate at the frames it was painted from until the person
// turns that off (SNAP-R51)
// A re-run (rerun.js, SNAP-R63) passes `rerun` (its swap, kept on the decision and the take's parent), `label` (the
// swap's names for the title), `picture` (the new Cast's picture for the paint) and `world` (the pin the take carries)
export async function start(take, id = "relight", { example, change, who, becomes, frames, lighter = false, by = "person", count = 2, rerun, label, picture, world } = {}) {
  const m = await method(id), c = clip(take);
  if (m.install_state !== "ready") throw new Error(`${m.title} ${m.install_state}`);
  const values = { ...asked(m, { example, change, who, becomes }), ...(label ? { label } : {}), ...(picture ? { picture } : {}) }, at = paintAt(m, c, frames), list = [];
  if (m.propagate.kind === "remake" && at.length > 4) throw new Error(`${m.title} takes up to 4 painted frames (Viggle Remake's ref_1..ref_4); ${at.length} asked`);
  for (let i = 0; i < count; i++) {
    const recipe = m.anchors.recipes[i % m.anchors.recipes.length], seed = Math.floor(Math.random() * 2 ** 32);
    const g = await anchorsGraph(take, m.anchors, recipe, at, values, seed);
    list.push({ prompt_id: await K.queue(g, { client: `snap-edit-${Date.now().toString(36)}` }), seed, take: take.id, frame: at, made: { lora: recipe.lora, cfg: recipe.cfg },
      ...(m.anchors.pin ? { pin: true } : {}) });
  }
  const { avoid, ...options } = values;
  const d = await C.create({ kind: "edit", target: take.id, title: `${m.title} (${values.label}) of take ${take.number}`, by, take: take.id, method: id,
    options: { ...options, ...(lighter ? { lighter: true } : {}), ...(rerun ? { rerun } : {}) }, clip: c, ...(world ? { world } : {}) }, list);
  return { decision: d.id, candidates: d.candidates.map((x) => ({ id: x.id, prompt_id: x.prompt_id, seed: x.seed, lora: x.made.lora, frames: x.frame, ...(x.pin ? { pin: true } : {}) })), seconds_each: 20 * at.length };
}
// "pin at frame N" on a candidate of a pinning method: on, its painted frames are placed at the frames they came from;
// off, they are only references and the model decides where they land (U69: as good on a one-shot clip, worse at cuts)
export async function pin(d, c, on) {
  if (!("pin" in c)) throw new Error(`${d.title}: this method doesn't pin its painted frames`);
  c.pin = !!on;
  await C.save(d);
  return { decision: d.id, candidate: c.id, pin: c.pin, frames: c.frame };
}

// an anchor pair finished: its two frames are the candidate's pictures; the identity notes (face and hair against the
// take's own frames, its quarter and three-quarter frames too for the hair's baseline) follow
async function finish(d, c, h) {
  c.pictures = c.frame.map((frame, i) => ({ label: `frame ${frame}`, frame, media: h.outputs[`a${i}o`]?.images?.[0] }));
  if (c.pictures.some((p) => !p.media)) { c.state = "failed"; c.error = "the edit saved no frame"; return; }
  identity(d, c).then((r) => C.note(d, c, "identity", r));
}
// what an edit does, for the face check: its example's `does` (night, dusk, dawn relight), else its method's. Only a
// relight mutes the face check (U56 measured the same woman at 0.34-0.60 at night); words written for Change something
// ("make her jacket sparkle") keep it, so a painted frame with another woman's face is flagged
export async function does(d) {
  const m = await method(d.method);
  return m.options?.examples?.[d.options?.example]?.does ?? m.does;
}
async function identity(d, c) {
  const m = await method(d.method);
  if (m.identity === "new person") return { new_person: m.does }; // a recast's point is someone else (U69: ArcFace ~0, "hair" on a bald head +65)
  const v = d.clip.video, more = [Math.round(d.clip.frames / 4), Math.round((3 * d.clip.frames) / 4)].map((frame) => ({ video: v, frame }));
  try { return await K.identityCheck(c.pictures.map((p) => [{ video: v, frame: p.frame }, { image: K.annotated(p.media) }]), more, { does: await does(d) }); } catch (e) { return { error: e.message }; }
}
// the identity notes again, for every candidate of an edit that has its frames (a note from an older check, or after the
// model graph's thresholds changed); a few seconds of detection, nothing renders
export async function recheck(id) {
  await C.load();
  const d = C.get(id);
  if (d?.kind !== "edit") throw new Error(`No edit decision ${id}`);
  const list = d.candidates.filter((c) => c.pictures.length && c.pictures.every((p) => p.media));
  for (const [c, r] of await Promise.all(list.map(async (c) => [c, await identity(d, c)]))) await C.note(d, c, "identity", r);
  return { decision: id, identity: Object.fromEntries(list.map((c) => [c.id, c.notes.identity])) };
}

// Apply: the change carried over the whole take, queued under this page's id so it lands as a take in the original's
// group, with its parent
async function propagate(d, c) {
  const take = T.get(d.take), m = await method(d.method);
  if (!take) throw new Error(`The take ${d.take} isn't here any more`);
  const g = m.propagate.kind === "remake" ? await remakeGraph(d, c, m, take) : await rippleGraph(d, c, m, take);
  const id = await K.queue(g, { group: take.group, world: d.world, extra: { snap_parent: { take: take.id, method: `${m.slot}/${d.method}`, options: d.options, decision: d.id, candidate: c.id } } });
  return { prompt_id: id, take: `take-${id}` };
}
// H3 Ripple (U53b graph: FL2VA + Ripple + 4-step turbo, the take as guide from frame 0, the painted frames at theirs)
async function rippleGraph(d, c, m, take) {
  const p = m.propagate, v = d.clip;
  const f = { clip: await M.choice("CLIPLoader", "clip_name", p.clip), vae: await M.choice("VAELoader", "vae_name", p.vae), audio: await M.choice("VAELoader", "vae_name", p.audio_vae),
    unet: await M.choice("UNETLoader", "unet_name", p.unet), lora: await M.choice("LoraLoaderModelOnly", "lora_name", p.lora), turbo: await M.choice("LoraLoaderModelOnly", "lora_name", p.turbo) };
  const g = {
    1: { class_type: "CLIPLoader", inputs: { clip_name: f.clip, type: "minimax", device: "default" } },
    2: { class_type: "VAELoader", inputs: { vae_name: f.vae } },
    3: { class_type: "VAELoader", inputs: { vae_name: f.audio } },
    4: { class_type: "UNETLoader", inputs: { unet_name: f.unet, weight_dtype: "default" } },
    5: { class_type: "LoraLoaderModelOnly", inputs: { model: ["4", 0], lora_name: f.lora, strength_model: 1.0 } },
    6: { class_type: "LoraLoaderModelOnly", inputs: { model: ["5", 0], lora_name: f.turbo, strength_model: 1.0 } },
    7: { class_type: "MiniMaxH3SigmaShift", inputs: { model: ["6", 0], shift_video: p.shift[0], shift_audio: p.shift[1] } },
    10: { class_type: "MiniMaxH3ImageToVideo", inputs: { clip: ["1", 0], vae: ["2", 0], prompt: p.prompt, width: v.width, height: v.height, length: v.frames } },
    11: { class_type: "LoadVideo", inputs: { file: v.video } },
    12: { class_type: "GetVideoComponents", inputs: { video: ["11", 0] } },
    13: { class_type: "ImageFromBatch", inputs: { image: ["12", 0], batch_index: 0, length: v.frames } },
    16: { class_type: "MiniMaxH3AddGuide", inputs: { positive: ["10", 0], vae: ["2", 0], latent: ["10", 1], image: ["13", 0], frame_idx: 0 } },
    19: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["10", 0] } },
    21: { class_type: "KSamplerSelect", inputs: { sampler_name: p.sampler } },
    22: { class_type: "BasicScheduler", inputs: { model: ["7", 0], scheduler: p.scheduler, steps: p.steps, denoise: 1.0 } },
    23: { class_type: "RandomNoise", inputs: { noise_seed: c.seed } },
    25: { class_type: "VAEDecode", inputs: { samples: ["24", 0], vae: ["2", 0] } },
    26: { class_type: "VAEDecodeAudio", inputs: { samples: ["24", 0], vae: ["3", 0] } },
    27: { class_type: "CreateVideo", inputs: { fps: 24.0, bit_depth: 8, color_space: "sRGB", chroma_subsampling: "auto", codec: "none", images: ["25", 0], audio: ["26", 0] } },
    28: { class_type: "SaveVideo", inputs: { filename_prefix: `video/snap_edits/${take.id}`, format: "auto", "format.codec": "auto", codec: "auto", video: ["27", 0] } },
  };
  let guided = "16";
  c.pictures.forEach((pic, i) => {
    g[`17${i}`] = { class_type: "LoadImage", inputs: { image: K.annotated(pic.media) } };
    g[`18${i}`] = { class_type: "MiniMaxH3AddGuide", inputs: { positive: [guided, 0], vae: ["2", 0], latent: ["10", 1], image: [`17${i}`, 0], frame_idx: pic.frame } };
    guided = `18${i}`;
  });
  Object.assign(g, { 20: { class_type: "CFGGuider", inputs: { model: ["7", 0], positive: [guided, 0], negative: ["19", 0], cfg: 1.0 } },
    24: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["23", 0], guider: ["20", 0], sampler: ["21", 0], sigmas: ["22", 0], latent_image: ["10", 1] } } });
  return g;
}
// Viggle Remake (U69 graph: FL2VA + the Remake LoRA bypassed in, keyframes held to sigma 0.9, 6 euler steps on the method's
// sigmas): the take is the source, the candidate's painted frames its pictures, pinned at their frames unless unpinned.
// The six-section prompt is the method's, filled with the change (or who and who instead) and one line per picture.
// A take shorter than Remake's shortest output (min_frames, 90) runs with its last frame held to that length, and the
// render is cut back to the take's own length (AGENTS user-input tolerance: the smallest change that lets it run)
async function remakeGraph(d, c, m, take) {
  const p = m.propagate, v = d.clip, light = m.options.lighter.swap_lora, len = Math.max(v.frames, p.min_frames ?? 0), pad = len - v.frames;
  // the lighter LoRA when asked, or when it is the only one here (the same picture, U74)
  const lora = d.options.lighter || !(M.folders().get("loras") ?? []).some((n) => n.endsWith(p.lora)) ? light : p.lora;
  const f = { clip: await M.choice("CLIPLoader", "clip_name", p.clip), vae: await M.choice("VAELoader", "vae_name", p.vae), audio: await M.choice("VAELoader", "vae_name", p.audio_vae),
    unet: await M.choice("UNETLoader", "unet_name", p.unet), lora: await M.choice("LoraLoaderBypassModelOnly", "lora_name", lora) };
  const pinned = c.pin !== false, n = c.pictures.length;
  const lines = (fn) => c.pictures.map((pic, i) => fn(`<Picture ${i + 1}>`, clock(pic.frame))).join("\n");
  const prompt = fill(p.prompt, { ...d.options, end: clock(len - 1),
    pictures: lines((P, t) => (pinned ? `${P} is a frame of the target video at ${t}, exactly as the target video shows it at that moment.` : `${P} shows how the target video looks after the edit.`)),
    kept: lines((P) => (pinned ? `${P} (target keyframe): fully_preserved - the target video passes through this exact frame.` : `${P} (reference): the look of the target video.`)),
    moments: pinned ? c.pictures.map((pic, i) => `At ${clock(pic.frame)} the scene matches <Picture ${i + 1}>.`).join(" ") : "" });
  const short = Math.min(v.width, v.height), edge = Math.max(480, 480 + 32 * Math.floor((short - 480) / 32)); // short_edge steps by 32 from 480
  const g = {
    1: { class_type: "UNETLoader", inputs: { unet_name: f.unet, weight_dtype: "default" } },
    2: { class_type: "LoraLoaderBypassModelOnly", inputs: { model: ["1", 0], lora_name: f.lora, strength_model: 1.0 } },
    3: { class_type: "RemakeKeyframeUntil", inputs: { model: ["2", 0], keyframe_until: p.keyframe_until } },
    4: { class_type: "CLIPLoader", inputs: { clip_name: f.clip, type: "minimax", device: "default" } },
    5: { class_type: "VAELoader", inputs: { vae_name: f.vae } },
    6: { class_type: "VAELoader", inputs: { vae_name: f.audio } },
    7: { class_type: "LoadVideo", inputs: { file: v.video } },
    8: { class_type: "GetVideoComponents", inputs: { video: ["7", 0] } },
    11: { class_type: "RemakeConditioning", inputs: { clip: ["4", 0], vae: ["5", 0], audio_vae: ["6", 0], source: pad ? ["23", 0] : ["8", 0], audio: ["8", 1], prompt, pins: pinned ? c.pictures.map((x) => x.frame).join(", ") : "", frames: len, short_edge: edge } },
    12: { class_type: "RemakeNoise", inputs: { positive: ["11", 0], seed: c.seed } },
    13: { class_type: "BasicGuider", inputs: { model: ["3", 0], conditioning: ["11", 0] } },
    14: { class_type: "KSamplerSelect", inputs: { sampler_name: p.sampler } },
    15: { class_type: "ManualSigmas", inputs: { sigmas: p.sigmas } },
    16: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["12", 0], guider: ["13", 0], sampler: ["14", 0], sigmas: ["15", 0], latent_image: ["11", 1] } },
    17: { class_type: "VAEDecode", inputs: { samples: ["16", 0], vae: ["5", 0] } },
    18: { class_type: "VAEDecodeAudio", inputs: { samples: ["16", 0], vae: ["6", 0] } },
    19: { class_type: "CreateVideo", inputs: { images: pad ? ["24", 0] : ["17", 0], audio: pad ? ["25", 0] : ["18", 0], fps: 24.0, bit_depth: 8, color_space: "sRGB", chroma_subsampling: "auto", codec: "none" } },
    20: { class_type: "SaveVideo", inputs: { video: ["19", 0], filename_prefix: `video/snap_edits/${take.id}`, format: "auto", "format.codec": "auto", codec: "auto" } },
  };
  c.pictures.forEach((pic, i) => { g[`9${i}`] = { class_type: "LoadImage", inputs: { image: K.annotated(pic.media) } }; g[11].inputs[`ref_${i + 1}`] = [`9${i}`, 0]; });
  if (pad) Object.assign(g, {
    21: { class_type: "ImageFromBatch", inputs: { image: ["8", 0], batch_index: v.frames - 1, length: 1 } },
    22: { class_type: "RepeatImageBatch", inputs: { image: ["21", 0], amount: pad } },
    23: { class_type: "ImageBatch", inputs: { image1: ["8", 0], image2: ["22", 0] } },
    24: { class_type: "ImageFromBatch", inputs: { image: ["17", 0], batch_index: 0, length: v.frames } },
    25: { class_type: "TrimAudioDuration", inputs: { audio: ["18", 0], start_index: 0, duration: v.frames / 24 } },
  });
  return g;
}
// Undo takes a render back while it waits in the queue; a render that started or finished is a take: reject it there
async function cancel(d, c, was) {
  const q = await (await api.fetchApi("/queue")).json();
  if (q.queue_pending.some((x) => x[1] === was.prompt_id)) { await api.fetchApi("/queue", { method: "POST", body: JSON.stringify({ delete: [was.prompt_id] }) }); return; }
  throw new Error(`The ${T.versionOf(d.options) ?? "edit"} render ${q.queue_running.some((x) => x[1] === was.prompt_id) ? "is running" : "is done"}: reject its take in Takes instead`);
}
C.kind("edit", { finish, apply: propagate, undo: cancel });

// the take an edit's Apply made, once it is in (takes.js captures it from this page's run)
export const result = (d) => (d?.applied?.undo?.take ? T.get(d.applied.undo.take) ?? null : null);

// "Make it louder" on a quiet take (SNAP-R36): its video through MAISnapLouder (EBU R128 loudnorm, I=-23, TP=-2; the
// picture copied) into a new version of the take, queued under this page's id so it lands in the take's group
export async function louder(take) {
  const v = take.media.find((m) => m.kind === "video");
  if (!v) throw new Error(`Take ${take.number} has no video`);
  const g = { 1: { class_type: "LoadVideo", inputs: { file: K.annotated(v) } }, 2: { class_type: "MAISnapLouder", inputs: { video: ["1", 0] } },
    3: { class_type: "SaveVideo", inputs: { filename_prefix: `video/snap_louder/${take.id}`, format: "auto", "format.codec": "auto", codec: "auto", video: ["2", 0] } } };
  const id = await K.queue(g, { group: take.group, extra: { snap_parent: { take: take.id, method: "louder", options: { loudnorm: "I=-23:TP=-2" } } } });
  return { prompt_id: id, take: `take-${id}` };
}
