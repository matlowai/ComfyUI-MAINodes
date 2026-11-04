// Edit a take (U54, the method registry's "edit" slot): a method makes a new take from an existing one. The first is
// relight ("Night version", with dusk and dawn as options), U53b's best route: MOSS-edit the take's anchor frames (0 and
// mid) with core TextEncodeMOSSImageEdit and an edit LoRA, show each pair as a candidate with identity notes against the
// take (the MOSS edit turned hair grey-silver in U53b, and every route after it inherited that), and once the person
// applies one, H3 Ripple propagates the edit over the take with the original as its guide. The render lands as a new
// take in the same group whose parent is the original. What a method runs (models, prompts, steps) is registry data.
// SNAP-R13 data, not code branches · SNAP-R14 method slots · SNAP-R16 GPU work waits for the person · SNAP-R17 by ·
// SNAP-R23 candidates · see docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as C from "./candidates.js";
import * as K from "./checks.js";
import * as M from "./models.js";
import * as S from "./slots.js";
import * as T from "./takes.js";

const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? "");
export async function method(id) {
  await Promise.all([S.load(), M.load()]);
  const m = S.list("edit").find((x) => x.id === id);
  if (!m) throw new Error(`No edit method "${id}"; there are: ${S.list("edit").map((x) => x.id).join(", ")}`);
  return m;
}

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

// the two anchor edits of one candidate, as one prompt (U53b's edit graph: 1.0 MP, SLG 22, 30 steps euler/normal)
async function anchorsGraph(take, a, recipe, { time, edit, avoid }, seed) {
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
  [0, c.mid].forEach((frame, i) => {
    const k = (x) => `a${i}${x}`, enc = (text) => ({ class_type: "TextEncodeMOSSImageEdit", inputs: { clip: ["2", 0], prompt: text, vae: ["3", 0], edit_format: recipe.format, "images.image_0": [k("s"), 0], image_strength: 1.0 } });
    Object.assign(g, {
      [k("f")]: { class_type: "ImageFromBatch", inputs: { image: ["7", 0], batch_index: frame, length: 1 } },
      [k("s")]: { class_type: "ImageScaleToTotalPixels", inputs: { image: [k("f"), 0], upscale_method: "lanczos", megapixels: 1.0, resolution_steps: 16 } },
      [k("z")]: { class_type: "GetImageSize", inputs: { image: [k("s"), 0] } },
      [k("l")]: { class_type: "EmptyFlux2LatentImage", inputs: { width: [k("z"), 0], height: [k("z"), 1], batch_size: 1 } },
      [k("p")]: enc(fill(a.prompt, { time, edit })), [k("n")]: enc(fill(a.negative, { avoid })),
      [k("k")]: { class_type: "KSampler", inputs: { model: ["5", 0], seed, steps: a.steps, cfg: recipe.cfg, sampler_name: a.sampler, scheduler: a.scheduler, positive: [k("p"), 0], negative: [k("n"), 0], latent_image: [k("l"), 0], denoise: 1.0 } },
      [k("d")]: { class_type: "VAEDecode", inputs: { samples: [k("k"), 0], vae: ["3", 0] } },
      [k("o")]: { class_type: "SaveImage", inputs: { images: [k("d"), 0], filename_prefix: `snap_edits/${take.id}_${time}_f${frame}` }, _meta: { title: `frame ${frame}` } },
    });
  });
  return { g, frames: [0, c.mid] };
}

// make `count` candidates (anchor pairs) for an edit of a take; the recipes take turns (U53b: each edit LoRA won on one
// seed), seeds vary. Returns at once; the candidates fill in as their edits finish (12-19 s an anchor on a 5090)
export async function start(take, id = "relight", { time = "night", by = "person", count = 2 } = {}) {
  const m = await method(id);
  if (m.install_state !== "ready") throw new Error(`${m.title} ${m.install_state}`);
  const option = m.options.time[time];
  if (!option) throw new Error(`${m.title}: no time "${time}"; there are ${Object.keys(m.options.time).join(", ")}`);
  const list = [];
  for (let i = 0; i < count; i++) {
    const recipe = m.anchors.recipes[i % m.anchors.recipes.length], seed = Math.floor(Math.random() * 2 ** 32);
    const { g, frames } = await anchorsGraph(take, m.anchors, recipe, { time, ...option }, seed);
    list.push({ prompt_id: await K.queue(g, { client: `snap-edit-${Date.now().toString(36)}` }), seed, take: take.id, frame: frames, made: { lora: recipe.lora, cfg: recipe.cfg } });
  }
  const d = await C.create({ kind: "edit", target: take.id, title: `${m.title} (${time}) of take ${take.number}`, by, take: take.id, method: id, options: { time }, clip: clip(take) }, list);
  return { decision: d.id, candidates: d.candidates.map((c) => ({ id: c.id, prompt_id: c.prompt_id, seed: c.seed, lora: c.made.lora })), seconds_each: 40 };
}

// an anchor pair finished: its two frames are the candidate's pictures; the identity notes (face and hair against the
// take's own frames, its quarter and three-quarter frames too for the hair's baseline) follow
async function finish(d, c, h) {
  c.pictures = [0, 1].map((i) => ({ label: `frame ${c.frame[i]}`, frame: c.frame[i], media: h.outputs[`a${i}o`]?.images?.[0] }));
  if (c.pictures.some((p) => !p.media)) { c.state = "failed"; c.error = "the edit saved no frame"; return; }
  identity(d, c).then((r) => C.note(d, c, "identity", r));
}
function identity(d, c) {
  const v = d.clip.video, more = [Math.round(d.clip.frames / 4), Math.round((3 * d.clip.frames) / 4)].map((frame) => ({ video: v, frame }));
  return K.identityCheck(c.pictures.map((p) => [{ video: v, frame: p.frame }, { image: K.annotated(p.media) }]), more).catch((e) => ({ error: e.message }));
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

// Apply: H3 Ripple over the take (U53b graph: FL2VA + Ripple + 4-step turbo, the take as guide from frame 0, the edited
// anchors at their frames), queued under this page's id so it lands as a take in the original's group, with its parent
async function propagate(d, c) {
  const take = T.get(d.take), m = await method(d.method), p = m.propagate, v = d.clip;
  if (!take) throw new Error(`The take ${d.take} isn't here any more`);
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
    28: { class_type: "SaveVideo", inputs: { filename_prefix: `video/snap_edits/${take.id}_${d.options.time}`, format: "auto", "format.codec": "auto", codec: "auto", video: ["27", 0] } },
  };
  let guided = "16";
  c.pictures.forEach((pic, i) => {
    g[`17${i}`] = { class_type: "LoadImage", inputs: { image: K.annotated(pic.media) } };
    g[`18${i}`] = { class_type: "MiniMaxH3AddGuide", inputs: { positive: [guided, 0], vae: ["2", 0], latent: ["10", 1], image: [`17${i}`, 0], frame_idx: pic.frame } };
    guided = `18${i}`;
  });
  Object.assign(g, { 20: { class_type: "CFGGuider", inputs: { model: ["7", 0], positive: [guided, 0], negative: ["19", 0], cfg: 1.0 } },
    24: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["23", 0], guider: ["20", 0], sampler: ["21", 0], sigmas: ["22", 0], latent_image: ["10", 1] } } });
  const id = await K.queue(g, { group: take.group, extra: { snap_parent: { take: take.id, method: `edit/${d.method}`, options: d.options, decision: d.id, candidate: c.id } } });
  return { prompt_id: id, take: `take-${id}` };
}
// Undo takes a render back while it waits in the queue; a render that started or finished is a take: reject it there
async function cancel(d, c, was) {
  const q = await (await api.fetchApi("/queue")).json();
  if (q.queue_pending.some((x) => x[1] === was.prompt_id)) { await api.fetchApi("/queue", { method: "POST", body: JSON.stringify({ delete: [was.prompt_id] }) }); return; }
  throw new Error(`The ${d.options.time} render ${q.queue_running.some((x) => x[1] === was.prompt_id) ? "is running" : "is done"}: reject its take in Takes instead`);
}
C.kind("edit", { finish, apply: propagate, undo: cancel });

// the take an edit's Apply made, once it is in (takes.js captures it from this page's run)
export const result = (d) => (d?.applied?.undo?.take ? T.get(d.applied.undo.take) ?? null : null);
