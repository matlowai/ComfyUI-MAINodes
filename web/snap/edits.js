// Change something in a take, or recast a person in it (U54, U73; the method registry's "edit" and "recast" slots): a
// method makes a new take from an existing one. MOSS paints the change into the take's frames (core
// TextEncodeMOSSImageEdit and an edit LoRA), each set of painted frames is a candidate with identity notes against the take
// (the MOSS edit turned hair grey-silver in U53b), and once the person applies one, the change is carried over the whole
// take: H3 Ripple with the take as its guide (relight, U53b), or Viggle Remake with the painted frames pinned at the frames
// they were painted from (remake_edit, remake_swap, U69). Night, rain and snow are examples of a change, not features: any
// change can be written. A recast swaps the identity notes for a "new person" note, and nothing is refused. The render
// lands as a new take in the same group whose parent is the original. What a method runs is registry data.
// New view from these pictures (U101, the "view" slot) is the stills' route: an H3 model from ordered context pictures
// and free words, each seed a candidate take in a shot (fromContext, below). A character sheet of a Cast (the "sheet"
// slot, sheet below) rides the same pictures, landing and candidates.
// SNAP-R13 data, not code branches · SNAP-R14 method slots · SNAP-R16 GPU work waits for the person · SNAP-R17 by ·
// SNAP-R23 candidates · SNAP-R51 change something, recast, pins · SNAP-R71 a new view from context, in the asker's words ·
// SNAP-R72 what Picture 1 is, per model · SNAP-R75 the view slot's models are data (P-H3-Image, H3 still) ·
// SNAP-R77 a character sheet is a sheet-slot method whose candidates are takes · SNAP-R79 a new view says which
// picture it copied · see docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as C from "./candidates.js";
import * as K from "./checks.js";
import * as M from "./models.js";
import { copyCheck } from "./plates.js";
import * as RT from "./retake.js";
import * as S from "./slots.js";
import * as SC from "./scenes.js";
import * as T from "./takes.js";
import * as W from "./world.js";

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
  if (!m) throw new Error(`Take ${take.number} has no video to edit${take.media.some((x) => x.kind === "image") ? ": it is a still. To make a new still from it, use New view from these pictures (edit_from_context {pictures: [{take}], prompt})" : ""}`);
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
    const job = { kind: "paint", title: `${m.title}: ${values.change ?? `${values.who} becomes ${values.becomes}`} (take ${take.number}, candidate ${i + 1} of ${count})`, about: { take: take.id, group: take.group }, by, eta_s: 20 * at.length, takes: false };
    list.push({ prompt_id: await K.queue(g, { job }), seed, take: take.id, frame: at, made: { lora: recipe.lora, cfg: recipe.cfg },
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
  if (m.identity === "new person") return { new_person: m.does, ...(d.options?.picture ? { cast: await castFace(d, c) } : {}) }; // a recast's point is someone else (U69: ArcFace ~0, "hair" on a bald head +65)
  const v = d.clip.video, more = [Math.round(d.clip.frames / 4), Math.round((3 * d.clip.frames) / 4)].map((frame) => ({ video: v, frame }));
  try { return await K.identityCheck(c.pictures.map((p) => [{ video: v, frame: p.frame }, { image: K.annotated(p.media) }]), more, { does: await does(d), about: { take: d.take, decision: d.id, candidate: c.id }, title: `Identity check: did ${d.title} keep the person (${c.id})?` }); } catch (e) { return { error: e.message }; }
}
// a recast painted from a Cast's picture (U89 Reuse the motion): each painted face against that picture, so a person sees
// which candidate kept the Cast's face (run 7: c1 matched, c2 was another woman). The same check as an edit's, the
// picture in the take's place; a note, never a gate (SNAP-R23)
async function castFace(d, c) {
  const name = Object.values(d.world ?? {})[0]?.name ?? "the Cast";
  try {
    const n = await K.identityCheck(c.pictures.map((p) => [{ image: d.options.picture }, { image: K.annotated(p.media) }]), [], { about: { take: d.take, decision: d.id, candidate: c.id }, title: `Face check: does ${c.id} of ${d.title} look like ${name}'s picture?` });
    return n.error ? { name, picture: d.options.picture, error: n.error } : { name, picture: d.options.picture, face_low: n.face_low, different: n.face_low != null && n.face_low < n.different_person, different_person: n.different_person, scores: n.scores.map(({ face, crops, no_head }) => ({ face, crops, ...(no_head ? { no_head } : {}) })) };
  } catch (e) { return { name, picture: d.options.picture, error: e.message }; }
}
// G1 (short03 F-C19): any take or still against Cast pictures, one to one (SNAP-R76): the frames asked for (a video's
// first, middle and last by default; a still is one), each face in a frame matched to one Cast's picture `ref` (default
// its first). A note, never a gate (SNAP-R23); a few seconds of detection on the server's queue, nothing renders
export async function castIdentity(take, casts, { frames, ref = 0 } = {}) {
  await W.load();
  const video = take.media.find((m) => m.kind === "video"), still = take.media.find((m) => m.kind === "image");
  if (!video && !still) throw new Error(`Take ${take.number} has no picture or video`);
  const who = casts.map((c) => {
    const got = W.get(c), { id } = W.parse(c), b = got?.version.body, r = b?.refs?.[ref];
    if (!got) throw new Error(`No Cast ${c} (list_cast shows them)`);
    if (!r) throw new Error(`${b.name} v${got.version.n} has no picture ${ref}; it has ${b.refs.length}`);
    return { cast: W.refOf("cast", id, got.version.n), name: b.name, file: r.file, role: r.role };
  });
  let list, srcs;
  if (video) {
    const c = clip(take);
    list = frames?.length ? frames : [0, c.mid, c.frames - 1];
    const bad = list.filter((f) => !Number.isInteger(f) || f < 0 || f >= c.frames);
    if (bad.length) throw new Error(`frames are whole frame numbers of take ${take.number}, from 0 to ${c.frames - 1}; not ${bad.join(", ")}`);
    srcs = list.map((frame) => ({ video: c.video, frame }));
  } else { list = [0]; srcs = [{ image: K.annotated(still) }]; }
  const n = await K.identityCheck(srcs.flatMap((src) => who.map((w) => [{ image: w.file }, src])), [], { about: { take: take.id }, title: `Face check: is each Cast in take ${take.number} themselves?` });
  if (n.error) throw new Error(n.error);
  const rows = list.map((frame, i) => ({ frame, casts: who.map((w, j) => { const x = n.scores[i * who.length + j];
    return { name: w.name, cast: w.cast, face: x.face, different: x.face != null && x.face < n.different_person, crops: x.crops, ...(x.no_head ? { no_face: x.no_head[1] ? "no face found in the take's frame" : "no face found in the Cast picture" } : {}) }; }) }));
  const low = who.map((w, j) => { const got = rows.map((r) => r.casts[j].face).filter((f) => f != null); return { name: w.name, cast: w.cast, picture: `${w.file} (${w.role})`, lowest: got.length ? Math.min(...got) : null, read: got.length, of: rows.length }; });
  return { take: take.id, different_person: n.different_person, casts: low, frames: rows,
    said: low.map((x) => (x.lowest == null ? `${x.name}: no face read` : `${x.name}: lowest ${x.lowest} over ${x.read} frame${x.read === 1 ? "" : "s"}${x.lowest < n.different_person ? ` (below ${n.different_person}: probably someone else in a frame; look at the crops)` : ""}`)).join("; ") };
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
async function propagate(d, c, by = "person") {
  const take = T.get(d.take), m = await method(d.method);
  if (!take) throw new Error(`The take ${d.take} isn't here any more`);
  const g = m.propagate.kind === "remake" ? await remakeGraph(d, c, m, take) : await rippleGraph(d, c, m, take);
  const job = { kind: "propagate", title: `${d.title}: ${c.id} carried over the whole take`, about: { take: take.id, group: take.group, decision: d.id, candidate: c.id }, by, eta_s: [m.cost?.local_s].flat().at(-1) ?? null }; // a measured range: its upper end
  const id = await K.queue(g, { group: take.group, world: d.world, job, extra: { snap_parent: { take: take.id, method: `${m.slot}/${d.method}`, options: d.options, decision: d.id, candidate: c.id } } });
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

// ---- New view from these pictures (U101, SNAP-R71/R72) --------------------------------------------------------------
// A new still from context pictures in order and words the person or agent writes, on an H3 model of the view slot
// (P-H3-Image, the Fizgig H3 still; MOSS Image Edit was tested on short03's C2 and left out by Dylan: it copied Picture 1
// or redesigned the set and the people). What Picture 1 is depends on the model (its registry `picture_one`), and the
// order is the person's to choose.
// A picture is a still take, a video take's frame, an input/ file or a Cast's picture, whole or cropped. Each seed is a
// candidate take in the shot it lands in; its parent names every context picture.

// how big a picture is, in pixels (a crop is asked for in fractions of it)
const sizeOf = (src) => new Promise((done, fail) => { const i = new Image(); i.onload = () => done({ width: i.naturalWidth, height: i.naturalHeight }); i.onerror = () => fail(new Error(`couldn't read ${src}`)); i.src = src; });
const inputUrl = (file) => { const cut = file.lastIndexOf("/"); return K.url({ filename: file.slice(cut + 1), subfolder: file.slice(0, Math.max(cut, 0)), type: "input" }); };
// one context picture: the nodes that load it (keys prefixed `c<i>`), its output, and what the provenance says
async function contextPicture(p, i) {
  const k = (x) => `c${i}${x}`, nodes = {}, said = { n: i + 1 };
  let out, size, world = null;
  if (p.take) {
    const t = T.get(p.take);
    if (!t) throw new Error(`Picture ${i + 1}: no take ${p.take}`);
    const v = t.media.find((m) => m.kind === "video"), m = v ?? t.media.find((x) => x.kind === "image");
    if (!m) throw new Error(`Picture ${i + 1}: take ${t.number} has no picture or video`);
    if (v) {
      const c = clip(t), frame = p.frame ?? c.mid;
      if (!Number.isInteger(frame) || frame < 0 || frame >= c.frames) throw new Error(`Picture ${i + 1}: frame is a whole frame number of take ${t.number}, from 0 to ${c.frames - 1}; not ${frame}`);
      Object.assign(nodes, { [k("v")]: { class_type: "LoadVideo", inputs: { file: c.video } }, [k("g")]: { class_type: "GetVideoComponents", inputs: { video: [k("v"), 0] } },
        [k("f")]: { class_type: "ImageFromBatch", inputs: { image: [k("g"), 0], batch_index: frame, length: 1 } } });
      out = [k("f"), 0]; size = { width: c.width, height: c.height };
      Object.assign(said, { take: t.id, frame, label: p.label ?? `take ${t.number}, frame ${frame}` });
    } else {
      nodes[k("l")] = { class_type: "LoadImage", inputs: { image: K.annotated(m) } };
      out = [k("l"), 0]; size = p.crop && await sizeOf(K.url(m));
      Object.assign(said, { take: t.id, label: p.label ?? `take ${t.number}` });
    }
  } else if (p.cast) {
    const got = W.get(p.cast), { id } = W.parse(p.cast), b = got?.version.body, r = b?.refs?.[p.ref ?? 0];
    if (!got) throw new Error(`Picture ${i + 1}: no Cast ${p.cast} (list_cast shows them)`);
    if (!r) throw new Error(`Picture ${i + 1}: ${b.name} v${got.version.n} has no picture ${p.ref ?? 0}; it has ${b.refs.length}`);
    nodes[k("l")] = { class_type: "LoadImage", inputs: { image: r.file } };
    out = [k("l"), 0]; size = p.crop && await sizeOf(inputUrl(r.file));
    Object.assign(said, { cast: W.refOf("cast", id, got.version.n), file: r.file, label: p.label ?? `${b.name}, ${r.role}` });
    world = [`cast:${id}`, { n: got.version.n, hash: W.short(got.version.hash), name: b.name }];
  } else if (p.location) { // SNAP-R84: a location's master, plan or plate by name; the still pins the location's version
    const got = W.get(p.location), { kind, id } = W.parse(p.location), b = got?.version.body, which = p.plate ?? "master";
    if (kind !== "location" || !got) throw new Error(`Picture ${i + 1}: no location ${p.location} (list_locations lists them)`);
    const pic = which === "master" || which === "plan" ? b[which] : b.plates?.find((x) => x.name === which);
    if (!pic) throw new Error(`Picture ${i + 1}: ${b.name} v${got.version.n} has no ${which === "master" || which === "plan" ? which : `plate "${which}"`}; it has ${[...["master", "plan"].filter((k) => b[k]), ...(b.plates ?? []).map((x) => x.name)].join(", ") || "nothing yet"}`);
    nodes[k("l")] = { class_type: "LoadImage", inputs: { image: pic.file } };
    out = [k("l"), 0]; size = p.crop && await sizeOf(inputUrl(pic.file));
    Object.assign(said, { location: W.refOf("location", id, got.version.n), plate: which, file: pic.file, label: p.label ?? `${b.name}, ${which === "master" || which === "plan" ? which : `plate ${which}`}` });
    world = [`location:${id}`, { n: got.version.n, hash: W.short(got.version.hash), name: b.name }];
  } else if (p.file) {
    const at = await (await api.fetchApi(`/mainodes/snap/info?input=${encodeURIComponent(p.file)}`)).json();
    if (!at.input_exists) throw new Error(`Picture ${i + 1}: "${p.file}" isn't in this server's input folder (${at.input}); upload it with POST /upload/image (subfolder=snap) and give "snap/<its name>"`);
    nodes[k("l")] = { class_type: "LoadImage", inputs: { image: p.file } };
    out = [k("l"), 0]; size = p.crop && await sizeOf(inputUrl(p.file));
    Object.assign(said, { file: p.file, label: p.label ?? p.file.split("/").pop() });
  } else throw new Error(`Picture ${i + 1}: give take (and frame for a video), file (in input/), cast (cast:<id>, ref: its picture's number from 0) or location (location:<id>, plate: a plate's name, master or plan)`);
  if (p.crop) { // fractions of the picture, as the take viewer's marked region holds them
    const [x, y, w, hgt] = p.crop;
    if (![x, y, w, hgt].every((v) => typeof v === "number" && v >= 0 && v <= 1) || w <= 0 || hgt <= 0) throw new Error(`Picture ${i + 1}: crop is [x, y, width, height] in fractions of the picture (0 to 1); not ${JSON.stringify(p.crop)}`);
    nodes[k("c")] = { class_type: "ImageCropV2", inputs: { image: out, crop_region: { x: Math.round(x * size.width), y: Math.round(y * size.height), width: Math.max(1, Math.round(w * size.width)), height: Math.max(1, Math.round(hgt * size.height)) } } };
    out = [k("c"), 0]; said.crop = p.crop; if (!p.label) said.label += " (cropped)";
  }
  return { nodes, out, said, world };
}
// where the new view lands: the shot asked for, else the shot Picture 1's take (or the first take among the pictures) is
// in, else the open tab's shot, else the open tab
async function landing(land, said) {
  await SC.load();
  if (land === "tab") return { group: T.groupOf(), where: "this tab" };
  let home = null;
  if (land) {
    const scene = SC.get(land.scene);
    if (!scene) throw new Error(`land: "tab", or {scene, shot} of ${SC.all().map((x) => `${x.id} (${x.name}: ${x.shots.map((y) => y.id).join(", ")})`).join("; ") || "no scenes yet"}`);
    home = { scene, shot: SC.shotOf(scene, land.shot) };
  } else {
    const first = said.map((x) => x.take && T.get(x.take)).find(Boolean);
    home = (first && RT.shotOf(first)) ?? SC.current();
  }
  if (!home) return { group: T.groupOf(), where: "this tab" };
  const group = home.shot.groups[0] ?? crypto.randomUUID();
  if (!home.shot.groups.includes(group)) await SC.addGroup(home.scene.id, home.shot.id, group);
  return { group, scene: home.scene.id, shot: home.shot.id, where: `${SC.shotTitle(home.scene, home.shot)} of ${home.scene.name}` };
}
// one P-H3-Image candidate (Pruna's edit graph: ModelSamplingMiniMaxH3 1.0/1.0, BasicGuider, 8 euler steps on their
// ManualSigmas grid): core PH3ImageConditioning edits image_1 with the rest as references; width and height 0 is
// image_1's own size
async function ph3Graph(a, pics, values, seed, size, prefix) {
  const files = { unet: await M.choice("UNETLoader", "unet_name", a.unet), clip: await M.choice("CLIPLoader", "clip_name", a.clip), vae: await M.choice("VAELoader", "vae_name", a.vae) };
  const g = {
    1: { class_type: "UNETLoader", inputs: { unet_name: files.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: files.clip, type: "minimax", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: files.vae } },
    4: { class_type: "MiniMaxH3SigmaShift", inputs: { model: ["1", 0], shift_video: a.shift[0], shift_audio: a.shift[1] } },
  };
  pics.forEach((p) => Object.assign(g, p.nodes));
  Object.assign(g, {
    p: { class_type: "PH3ImageConditioning", inputs: { clip: ["2", 0], vae: ["3", 0], prompt: fill(a.prompt, values), width: size?.width ?? 0, height: size?.height ?? 0, ...Object.fromEntries(pics.map((x, i) => [`images.image_${i + 1}`, x.out])) } },
    g: { class_type: "BasicGuider", inputs: { model: ["4", 0], conditioning: ["p", 0] } },
    r: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    s: { class_type: "KSamplerSelect", inputs: { sampler_name: a.sampler } },
    m: { class_type: "ManualSigmas", inputs: { sigmas: a.sigmas } },
    k: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["r", 0], guider: ["g", 0], sampler: ["s", 0], sigmas: ["m", 0], latent_image: ["p", 1] } },
    d: { class_type: "VAEDecode", inputs: { samples: ["k", 0], vae: ["3", 0] } },
    o: { class_type: "SaveImage", inputs: { images: ["d", 0], filename_prefix: prefix } },
  });
  return g;
}
// one H3 still (the Fizgig H3 Still pack's edit graph): core MiniMax H3 Reference to Video with the pictures as
// <Picture n>, the pack's one-frame latent and its decode, the turbo LoRA at the pack's strength, er_sde. The still is
// Picture 1's size at the method's megapixels unless a size is given. A method with `frames: 5` (the five-reference
// sheet) samples Ref2V's own frozen 5-frame clip and keeps frame 0, and one without `turbo` runs the model as it is
async function fizgigGraph(a, pics, values, seed, size, prefix) {
  const files = { unet: await M.choice("UNETLoader", "unet_name", a.unet), clip: await M.choice("CLIPLoader", "clip_name", a.clip), vae: await M.choice("VAELoader", "vae_name", a.vae), turbo: a.turbo && await M.choice("LoraLoaderModelOnly", "lora_name", a.turbo.lora) };
  const g = {
    1: { class_type: "UNETLoader", inputs: { unet_name: files.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: files.clip, type: "minimax", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: files.vae } },
    ...(a.turbo ? { 4: { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: files.turbo, strength_model: a.turbo.strength } } } : {}),
  };
  const model = a.turbo ? ["4", 0] : ["1", 0], clipFrames = a.frames === 5;
  pics.forEach((p) => Object.assign(g, p.nodes));
  if (!size) Object.assign(g, { s0: { class_type: "ImageScaleToTotalPixels", inputs: { image: pics[0].out, upscale_method: "lanczos", megapixels: a.megapixels, resolution_steps: 32 } }, z: { class_type: "GetImageSize", inputs: { image: ["s0", 0] } } });
  const w = size?.width ?? ["z", 0], hgt = size?.height ?? ["z", 1];
  Object.assign(g, {
    p: { class_type: "MiniMaxH3ReferenceToVideo", inputs: { clip: ["2", 0], vae: ["3", 0], prompt: fill(a.prompt, values), width: w, height: hgt, length: 5, ref_image_size: a.ref_image_size ?? "match", ...Object.fromEntries(pics.map((x, i) => [`ref_images.ref_image_${i}`, x.out])) } },
    g: { class_type: "BasicGuider", inputs: { model, conditioning: ["p", 0] } },
    r: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    s: { class_type: "KSamplerSelect", inputs: { sampler_name: a.sampler } },
    m: { class_type: "BasicScheduler", inputs: { model, scheduler: a.scheduler, steps: a.steps, denoise: 1.0 } },
    ...(clipFrames ? {} : { l: { class_type: "FizgigH3StillLatent", inputs: { width: w, height: hgt, batch_size: 1 } } }),
    k: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["r", 0], guider: ["g", 0], sampler: ["s", 0], sigmas: ["m", 0], latent_image: clipFrames ? ["p", 1] : ["l", 0] } },
    ...(clipFrames ? { v: { class_type: "VAEDecode", inputs: { samples: ["k", 0], vae: ["3", 0] } }, d: { class_type: "ImageFromBatch", inputs: { image: ["v", 0], batch_index: 0, length: 1 } } }
      : { d: { class_type: "FizgigH3StillDecode", inputs: { samples: ["k", 0], vae: ["3", 0] } } }),
    o: { class_type: "SaveImage", inputs: { images: ["d", 0], filename_prefix: prefix } },
  });
  return g;
}
// one five-view contact sheet (ComfyUI-H3-ContactSheet's graph): the H3 Turnaround LoRA on the ref2va model, the
// node's five-slot latent from Picture 1, a stock sampler, the node's per-slot decode: the five views (`v`) and their
// strip (`o`). Each view is `size.width` square, else the method's size
async function contactGraph(a, pics, values, seed, size, prefix) {
  const files = { unet: await M.choice("UNETLoader", "unet_name", a.unet), clip: await M.choice("CLIPLoader", "clip_name", a.clip), vae: await M.choice("VAELoader", "vae_name", a.vae), lora: await M.choice("LoraLoaderModelOnly", "lora_name", a.lora) };
  const g = {
    1: { class_type: "UNETLoader", inputs: { unet_name: files.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: files.clip, type: "minimax", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: files.vae } },
    4: { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: files.lora, strength_model: a.strength } },
  };
  pics.forEach((p) => Object.assign(g, p.nodes));
  Object.assign(g, {
    p: { class_type: "H3ContactSheet", inputs: { clip: ["2", 0], vae: ["3", 0], prompt: fill(a.prompt, values), ref_image: pics[0].out, size: size?.width ?? a.size } },
    g: { class_type: "BasicGuider", inputs: { model: ["4", 0], conditioning: ["p", 0] } },
    r: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    s: { class_type: "KSamplerSelect", inputs: { sampler_name: a.sampler } },
    m: { class_type: "BasicScheduler", inputs: { model: ["4", 0], scheduler: a.scheduler, steps: a.steps, denoise: 1.0 } },
    k: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["r", 0], guider: ["g", 0], sampler: ["s", 0], sigmas: ["m", 0], latent_image: ["p", 1] } },
    d: { class_type: "H3ContactSheetDecode", inputs: { vae: ["3", 0], samples: ["k", 0] } },
    o: { class_type: "SaveImage", inputs: { images: ["d", 1], filename_prefix: prefix } },
    v: { class_type: "SaveImage", inputs: { images: ["d", 0], filename_prefix: `${prefix}_views` } },
  });
  return g;
}
// one Krea 2 edit (the CharacterSheet LoRAs' workflow, comfyui-krea2edit): Picture 1 at most `ref_max` px, grounded in
// the text encoder and given to the model as source tokens fitted to the output, Krea 2 Turbo at cfg 1
async function kreaGraph(a, pics, values, seed, size, prefix) {
  const files = { unet: await M.choice("UNETLoader", "unet_name", a.unet), clip: await M.choice("CLIPLoader", "clip_name", a.clip), vae: await M.choice("VAELoader", "vae_name", a.vae), lora: await M.choice("LoraLoaderModelOnly", "lora_name", a.lora) };
  const [w, hgt] = size ? [size.width, size.height] : a.size, grounded = (text, px) => ({ class_type: "Krea2EditGroundedEncode", inputs: { clip: ["2", 0], prompt: text, image: ["q", 0], grounding_px: px, system_prompt: "" } });
  const g = {
    1: { class_type: "UNETLoader", inputs: { unet_name: files.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: files.clip, type: "krea2", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: files.vae } },
    4: { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: files.lora, strength_model: 1.0 } },
  };
  pics.forEach((p) => Object.assign(g, p.nodes));
  Object.assign(g, {
    q: { class_type: "ImageScaleToMaxDimension", inputs: { image: pics[0].out, upscale_method: "lanczos", largest_size: a.ref_max } },
    e: { class_type: "VAEEncode", inputs: { pixels: ["q", 0], vae: ["3", 0] } },
    l: { class_type: "EmptySD3LatentImage", inputs: { width: w, height: hgt, batch_size: 1 } },
    x: { class_type: "Krea2EditModelPatch", inputs: { model: ["4", 0], source_latent: ["e", 0], ref_boost: a.ref_boost, ref_boost_a: 1.0, fit_mode: "fit", vae: ["3", 0], source_image: ["q", 0], target_latent: ["l", 0] } },
    p: grounded(fill(a.prompt, values), 0), n: grounded("", 768),
    k: { class_type: "KSampler", inputs: { model: ["x", 0], seed, steps: a.steps, cfg: a.cfg, sampler_name: a.sampler, scheduler: a.scheduler, positive: ["p", 0], negative: ["n", 0], latent_image: ["l", 0], denoise: 1.0 } },
    d: { class_type: "VAEDecode", inputs: { samples: ["k", 0], vae: ["3", 0] } },
    o: { class_type: "SaveImage", inputs: { images: ["d", 0], filename_prefix: prefix } },
  });
  return g;
}
// one MOSS-Image picture from a reference (a character-reference LoRA on MOSS-Image Base): core Text Encode MOSS-Image
// Edit in the LoRA's layout with Picture 1 at the method's megapixels, its empty-prompt twin as the negative, SLG
async function mossRefGraph(a, pics, values, seed, size, prefix) {
  const files = { unet: await M.choice("UNETLoader", "unet_name", a.unet), clip: await M.choice("CLIPLoader", "clip_name", a.clip), vae: await M.choice("VAELoader", "vae_name", a.vae), lora: await M.choice("LoraLoaderModelOnly", "lora_name", a.lora) };
  const [w, hgt] = size ? [size.width, size.height] : a.size, enc = (text) => ({ class_type: "TextEncodeMOSSImageEdit", inputs: { clip: ["2", 0], prompt: text, vae: ["3", 0], edit_format: a.format, "images.image_0": ["q", 0], image_strength: 1.0 } });
  const g = {
    1: { class_type: "UNETLoader", inputs: { unet_name: files.unet, weight_dtype: "default" } },
    2: { class_type: "CLIPLoader", inputs: { clip_name: files.clip, type: "moss_image", device: "default" } },
    3: { class_type: "VAELoader", inputs: { vae_name: files.vae } },
    4: { class_type: "LoraLoaderModelOnly", inputs: { model: ["1", 0], lora_name: files.lora, strength_model: 1.0 } },
    5: { class_type: "SkipLayerGuidanceDiTSimple", inputs: { model: ["4", 0], double_layers: "", single_layers: a.slg_single, start_percent: 0.0, end_percent: 1.0 } },
  };
  pics.forEach((p) => Object.assign(g, p.nodes));
  Object.assign(g, {
    q: { class_type: "ImageScaleToTotalPixels", inputs: { image: pics[0].out, upscale_method: "lanczos", megapixels: a.megapixels, resolution_steps: 16 } },
    p: enc(fill(a.prompt, values)), n: enc(fill(a.negative, values)),
    l: { class_type: "EmptyFlux2LatentImage", inputs: { width: w, height: hgt, batch_size: 1 } },
    k: { class_type: "KSampler", inputs: { model: ["5", 0], seed, steps: a.steps, cfg: a.cfg, sampler_name: a.sampler, scheduler: a.scheduler, positive: ["p", 0], negative: ["n", 0], latent_image: ["l", 0], denoise: 1.0 } },
    d: { class_type: "VAEDecode", inputs: { samples: ["k", 0], vae: ["3", 0] } },
    o: { class_type: "SaveImage", inputs: { images: ["d", 0], filename_prefix: prefix } },
  });
  return g;
}
// the graph each method kind runs (the registry's anchors.kind)
const GRAPHS = { ph3: ph3Graph, fizgig: fizgigGraph, h3: fizgigGraph, contact: contactGraph, krea2edit: kreaGraph, moss_ref: mossRefGraph };
// make a new view: `pictures` in order (what Picture 1 is: the method's `picture_one`), `prompt` the person's or agent's
// words, one candidate per seed (`seeds`, else `count` new ones), on the view slot's `method` (ph3_view, fizgig_still; by
// default the first the registry lists).
// Returns at once; each candidate is a take in the shot it lands in once its paint finishes
export async function fromContext(pictures, prompt, { method, seeds, count = 2, width, height, land, by = "person" } = {}) {
  await Promise.all([S.load(), M.load(), T.load(), W.load()]);
  const id = method ?? S.list("view")[0]?.id, m = S.list("view").find((x) => x.id === id);
  if (!m) throw new Error(`No method "${id}" for a new view; there are: ${S.list("view").map((x) => x.id).join(", ")}`);
  if (m.install_state !== "ready") throw new Error(`${m.title} ${m.install_state}`);
  if (!pictures?.length) throw new Error(`${m.title}: give at least one picture (Picture 1 ${m.picture_one?.label ?? "comes first"})`);
  if (!prompt?.trim()) throw new Error(`${m.title}: say what the new still shows (prompt), naming the pictures as Picture 1, Picture 2, … if you like`);
  if ((width == null) !== (height == null)) throw new Error(`${m.title}: give width and height together, or neither (then the still is Picture 1's size)`);
  if (m.anchors.max_pictures && pictures.length > m.anchors.max_pictures) throw new Error(`${m.title} reads up to ${m.anchors.max_pictures} pictures; ${pictures.length} given`);
  const pics = []; for (const [i, p] of pictures.entries()) pics.push(await contextPicture(p, i));
  const said = pics.map((p) => p.said), where = await landing(land, said), world = Object.fromEntries(pics.map((p) => p.world).filter(Boolean));
  const list = seeds?.length ? seeds : Array.from({ length: count }, () => Math.floor(Math.random() * 2 ** 32));
  const label = prompt.trim().length > 40 ? `${prompt.trim().slice(0, 38)}…` : prompt.trim(), first = said.find((x) => x.take)?.take ?? null;
  const made = [], size = width != null ? { width, height } : null, prefix = `snap_views/${where.group.slice(0, 8)}`, build = GRAPHS[m.anchors.kind];
  for (const [i, seed] of list.entries()) {
    const g = await build(m.anchors, pics, { prompt: prompt.trim() }, seed, size, prefix);
    const job = { kind: "paint", title: `New view (${label}), candidate ${i + 1} of ${list.length}`, about: { take: first, group: where.group, scene: where.scene, shot: where.shot }, by, eta_s: [m.cost?.local_s].flat().at(-1) ?? null };
    made.push({ prompt_id: await K.queue(g, { group: where.group, world, job, extra: { snap_parent: { take: first, method: `view/${id}`, options: { label, prompt: prompt.trim(), context: said } } } }),
      seed, made: { model: m.anchors.unet.split("/").pop() }, label: "new view" }); // a take, no check to wait for (its tile's chips)
  }
  const d = await C.create({ kind: "view", target: first ?? where.group, title: `New view (${label}) from ${said.map((x) => `Picture ${x.n} ${x.label}`).join(", ")}`, by, take: first, method: id,
    options: { prompt: prompt.trim(), context: said, ...(size ?? {}) }, land: where.shot ? { scene: where.scene, shot: where.shot } : null, ...(Object.keys(world).length ? { world } : {}) }, made);
  // F-C15: landed away from the shot a context board belongs to: say where it would sit beside that board
  const board = land && land !== "tab" ? said.map((x) => x.take && T.get(x.take)).map((t) => t && { t, home: RT.shotOf(t) }).find((x) => x?.home && x.home.shot.id !== where.shot) : null;
  return { decision: d.id, pictures: said.map((x) => `Picture ${x.n}${x.n === 1 && m.picture_one ? ` (${m.picture_one.label})` : ""}: ${x.label}`), lands: where.where,
    ...(board ? { land_hint: `take ${board.t.number} among the pictures is in ${SC.shotTitle(board.home.scene, board.home.shot)} of ${board.home.scene.name}: to put this view beside it (each cut's shot holds its own board), land {scene: "${board.home.scene.id}", shot: "${board.home.shot.id}"}, or leave land out` } : {}),
    candidates: d.candidates.map((c) => ({ id: c.id, prompt_id: c.prompt_id, take: `take-${c.prompt_id}`, seed: c.seed, ...c.made })), seconds_each: [m.cost?.local_s].flat().at(-1) ?? null };
}
// each Cast picture a new view was made from, against the face in the still matched to it (all Casts at once, so two
// people in a two-shot are each scored against their own Cast, SNAP-R76): a note per Cast, never a gate (SNAP-R23)
async function castFaces(d, c) {
  const casts = d.options.context.filter((x) => x.cast && x.file), still = c.pictures[0]?.media;
  if (!casts.length || !still) return null;
  try {
    const n = await K.identityCheck(casts.map((x) => [{ image: x.file }, { image: K.annotated(still) }]), [], { about: { decision: d.id, candidate: c.id }, title: `Face check: is each Cast in ${c.id} of ${d.title} themselves?` });
    if (n.error) return { error: n.error };
    return { different_person: n.different_person, casts: casts.map((x, i) => ({ name: x.label.split(",")[0], cast: x.cast, face: n.scores[i].face, different: n.scores[i].face != null && n.scores[i].face < n.different_person, crops: n.scores[i].crops })) };
  } catch (e) { return { error: e.message }; }
}
// F-C14: the new still against each context picture with the copy check's score (DINOv3 patch tokens at the same grid
// position, plates.js): at or above the model graph's threshold it "copied Picture n" (P01's aerial views copied the
// master). A note, never a gate (SNAP-R23)
async function contextCopies(d, c) {
  const still = c.pictures[0]?.media;
  if (!still || !d.options.context?.length) return null;
  try {
    const { encoder, threshold } = await copyCheck(), g = { e: { class_type: "CLIPVisionLoader", inputs: { clip_name: encoder } }, s: { class_type: "LoadImage", inputs: { image: K.annotated(still) } } };
    for (const [i, x] of d.options.context.entries()) {
      const p = await contextPicture(x.cast || x.location ? { file: x.file, crop: x.crop } : { take: x.take, frame: x.frame, file: x.file, crop: x.crop }, i);
      Object.assign(g, p.nodes, { [`q${i}`]: { class_type: "MAISnapCopyScore", inputs: { clip_vision: ["e", 0], reference: p.out, images: ["s", 0] } } });
    }
    const h = await K.screen(g, { title: `Copy check: did ${c.id} of ${d.title} copy one of its pictures?`, about: { decision: d.id, candidate: c.id } });
    const against = d.options.context.map((x, i) => ({ n: x.n, label: x.label, score: h.outputs?.[`q${i}`]?.copy_scores?.[0] ?? null }));
    return { threshold, against, copied: against.filter((a) => a.score != null && a.score >= threshold).map((a) => a.n) };
  } catch (e) { return { error: e.message }; }
}
C.kind("view", { ...RT.takeCandidate, finish: (d, c, h) => { RT.takeCandidate.finish(d, c, h);
  castFaces(d, c).then((r) => r && C.note(d, c, "identity", r)).then(() => contextCopies(d, c)).then((r) => r && C.note(d, c, "copied", r)); } });

// A character sheet of a Cast (the sheet slot, U101 turnaround round 2): the method draws the Cast's picture `ref`
// (plus any more `pictures`, e.g. a turnaround's views for the five-reference sheet) as one sheet, or as five views and
// their strip (the contact sheet). `design` is the character in words for the methods whose prompt names it (else the
// Cast's details); ';' parts are the Krea sheet's identity locks. One candidate per seed, each a still take whose
// pictures are the sheet first, then each view; the parent names the Cast and every picture. Returns at once
export async function sheet(cast, { method, ref = 0, pictures = [], design, seeds, count = 2, width, height, land, by = "person" } = {}) {
  await Promise.all([S.load(), M.load(), T.load(), W.load()]);
  const id = method ?? S.list("sheet")[0]?.id, m = S.list("sheet").find((x) => x.id === id);
  if (!m) throw new Error(`No method "${id}" for a character sheet; there are: ${S.list("sheet").map((x) => x.id).join(", ")}`);
  if (m.install_state !== "ready") throw new Error(`${m.title} ${m.install_state}`);
  const got = W.get(cast);
  if (!got) throw new Error(`${m.title}: no Cast ${cast} (list_cast shows them)`);
  if ((width == null) !== (height == null)) throw new Error(`${m.title}: give width and height together, or neither (then the method's size)`);
  const all = [{ cast, ref }, ...pictures];
  if (m.anchors.max_pictures && all.length > m.anchors.max_pictures) throw new Error(`${m.title} reads up to ${m.anchors.max_pictures} picture${m.anchors.max_pictures > 1 ? "s" : ""} (the Cast's first); ${all.length} given`);
  const pics = []; for (const [i, p] of all.entries()) pics.push(await contextPicture(p, i));
  const b = got.version.body, words = (design ?? b.details ?? "").trim();
  if (m.anchors.square) await squared(pics[0], b.refs[ref]?.file);
  const values = { name: b.name, design: words, design_lines: words.split(/\s*;\s*/).filter(Boolean).map((x) => `- ${x}`).join("\n") };
  const said = pics.map((p) => p.said), where = await landing(land, said), world = Object.fromEntries(pics.map((p) => p.world).filter(Boolean));
  const list = seeds?.length ? seeds : Array.from({ length: count }, () => Math.floor(Math.random() * 2 ** 32));
  const [w, hgt] = width != null ? [width, height] : [m.anchors.size].flat(), size = { width: w, height: hgt ?? w }, prefix = `snap_sheets/${where.group.slice(0, 8)}`, prompt = fill(m.anchors.prompt, values), made = [];
  for (const [i, seed] of list.entries()) {
    const g = await GRAPHS[m.anchors.kind](m.anchors, pics, values, seed, size, prefix);
    const job = { kind: "paint", title: `Character sheet of ${b.name} (${m.title}), candidate ${i + 1} of ${list.length}`, about: { entity: cast, group: where.group, scene: where.scene, shot: where.shot }, by, eta_s: [m.cost?.local_s].flat().at(-1) ?? null };
    made.push({ prompt_id: await K.queue(g, { group: where.group, world, job, extra: { snap_parent: { take: null, method: `sheet/${id}`, options: { cast, prompt, context: said } } } }),
      seed, made: { model: m.anchors.unet.split("/").pop(), lora: m.anchors.lora?.split("/").pop() ?? m.anchors.turbo?.lora.split("/").pop() ?? null }, label: "sheet" });
  }
  const d = await C.create({ kind: "sheet", target: cast, title: `Character sheet of ${b.name} (${m.title}) from ${said.map((x) => `Picture ${x.n} ${x.label}`).join(", ")}`, by, take: null, method: id,
    options: { prompt, context: said, ...size }, land: where.shot ? { scene: where.scene, shot: where.shot } : null, ...(Object.keys(world).length ? { world } : {}) }, made);
  return { decision: d.id, method: id, pictures: said.map((x) => `Picture ${x.n}: ${x.label}`), lands: where.where, size,
    candidates: d.candidates.map((c) => ({ id: c.id, prompt_id: c.prompt_id, take: `take-${c.prompt_id}`, seed: c.seed, ...c.made })), seconds_each: [m.cost?.local_s].flat().at(-1) ?? null };
}
// Picture 1 padded to a square with its own corner colour (core Pad Image), for a method whose model wants a square
// reference: the H3 Turnaround LoRA rolled the camera in 4 of 6 sheets from the portrait Cast picture and orbited in
// 6 of 6 from the same picture padded square (U101 turnaround round 2)
async function squared(p, file) {
  const img = new Image(); img.src = inputUrl(file); await img.decode();
  const { naturalWidth: w, naturalHeight: hgt } = img, c = Object.assign(document.createElement("canvas"), { width: 1, height: 1 });
  c.getContext("2d").drawImage(img, 0, 0, 1, 1, 0, 0, 1, 1);
  const color = `#${[...c.getContext("2d").getImageData(0, 0, 1, 1).data.slice(0, 3)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  const [x, y] = w < hgt ? [hgt - w, 0] : [0, w - hgt];
  if (!x && !y) return;
  p.nodes.c0sq = { class_type: "PadImageNode", inputs: { image: p.out, padding_type: "pad dimensions", "padding_type.left": x >> 1, "padding_type.right": x - (x >> 1), "padding_type.top": y >> 1, "padding_type.bottom": y - (y >> 1),
    padding_style: "color", "padding_style.color": color, "padding_style.feathering": 0 } };
  p.out = ["c0sq", 0];
  p.said.squared = color;
}
// a sheet's pictures: the sheet (the strip of a contact sheet) first, then each view in slot order
const sheetFinish = (d, c, h) => {
  const media = T.media(h.outputs), views = media.filter((x) => x.node === "v");
  c.pictures = [...media.filter((x) => x.node !== "v").map((x) => ({ label: "sheet", media: x })), ...views.map((x, i) => ({ label: `view ${i + 1}`, media: x }))];
  c.take = `take-${c.prompt_id}`;
};
C.kind("sheet", { ...RT.takeCandidate, finish: (d, c, h) => { sheetFinish(d, c, h); castFaces(d, c).then((r) => r && C.note(d, c, "identity", r)); } });

// "Make it louder" on a quiet take (SNAP-R36): its video through MAISnapLouder (EBU R128 loudnorm, I=-23, TP=-2; the
// picture copied) into a new version of the take, queued under this page's id so it lands in the take's group
export async function louder(take, by = "person") {
  const v = take.media.find((m) => m.kind === "video");
  if (!v) throw new Error(`Take ${take.number} has no video`);
  const g = { 1: { class_type: "LoadVideo", inputs: { file: K.annotated(v) } }, 2: { class_type: "MAISnapLouder", inputs: { video: ["1", 0] } },
    3: { class_type: "SaveVideo", inputs: { filename_prefix: `video/snap_louder/${take.id}`, format: "auto", "format.codec": "auto", codec: "auto", video: ["2", 0] } } };
  const id = await K.queue(g, { group: take.group, job: { kind: "louder", title: `Make take ${take.number} louder`, about: { take: take.id, group: take.group }, by }, extra: { snap_parent: { take: take.id, method: "louder", options: { loudnorm: "I=-23:TP=-2" } } } });
  return { prompt_id: id, take: `take-${id}` };
}
