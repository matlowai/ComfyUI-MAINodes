// Camera plates (U48 §7, U49.5, U55): one people-free picture of a set per camera, so a shot's reference shows its own
// camera's view. One wide plate as everyone's reference makes H3 copy its viewpoint (U21: 8/12), so the plates come from
// an orbit pass: H3 Ref2V from the set's wide plate, saying "the camera is not where <Picture 1> was taken" plus that
// camera's doors and windows. One render per camera is unreliable (U49 moved off the plate 8/9, U52 pass 1 copied 3/3),
// so each camera gets 2-3 renders as candidates (candidates.js) and the person picks: the copy score (DINOv3 patch tokens
// matched by grid position, MAISnapCopyScore) marks likely copies and the layout check (checks.js) says where the doors,
// windows and props landed against the plan; neither rejects. A shot that compiles with no plate for its camera gets its
// candidates made on demand. The person can swap any plate by hand. Plates live on the set's working copy card
// (`<set>-mine`), each with its provenance: take, frame, copy score, seed, the camera it was made for, who made it.
// The same score flags takes that copied their own reference picture (U48 §3: DINOv3's room score can't see it).
// SNAP-R16 GPU work waits as a proposal for agents · SNAP-R17 by: person|agent · SNAP-R18 local only ·
// SNAP-R21 a reference shows the shot's own camera · SNAP-R23 candidates · see docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as L from "./library.js";
import * as M from "./models.js";
import * as T from "./takes.js";
import * as E from "./engine.js";
import * as C from "./candidates.js";
import * as K from "./checks.js";
import { BRICKS } from "./bricks.js";
import { setBlock, plateCameras, atCamera, cameraAt, inFrame, frameSides, keeps, sameCamera } from "./setsnap.js";

const REF2V = "Ref2V (reference pictures)"; // the Render Preset's conditioning the orbit needs (U49: the ref2va pair)
const SIZE = { width: 1280, height: 704, length: 97 }; // U49's orbit renders (length 97 runs as 107 frames, about 64 s)
const SOUND = "overall_soundscape: Quiet room tone.\n\nnon_diegetic_music: N/A";
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) fn(); };

// the U49 orbit wording for one camera: a camera sentence that says what sits where in its frame (as U49's did; without
// it the first Snap orbit copied the wide plate 3/3), which side of the frame each door and window is on (the sides the
// layout check expects), the wide plate is <Picture 1>, this camera is somewhere else, and the set block says what this
// camera sees; nobody in the room
export function orbitText(s, cam) {
  const v = atCamera(s, cam);
  const seen = inFrame(v), size = cam.lens <= 28 ? "wide" : cam.lens <= 60 ? "medium" : "close";
  return `integrated_multimodal_description: [Shot 1] Cinematic ${size} shot, ${cam.lens} mm, ${cameraAt(v)}${seen ? `: ${seen}` : ""}. ${frameSides(v)} This is the same ${s.name} shown in <Picture 1>, but the camera is not where <Picture 1> was taken: `
    + `this is a new eye-height view from the position above, with a ${cam.lens} mm lens. Keep its ${keeps(s)} exactly as in <Picture 1>. ${s.look ? `${s.look} ` : ""}`
    + `${setBlock(v)} Nobody is in the room. The camera slowly pushes in.\n\n${SOUND}`;
}

const working = (lineage) => L.get(`${lineage}-mine`) ?? L.get(lineage);
const lineageOf = (id) => { const c = L.get(id); return c?.lineage ?? c?.id ?? id; };
export const platesOf = (card) => ({ wide: null, cameras: {}, ...card?.plates });
// plates of a set (any version of it): what each camera has, whether it still fits the camera, and its candidates
// (rendering, waiting for the pick) for the cameras its snapshot has now
export function status(card, s = card.brick.snapshot) {
  const lineage = card.lineage ?? card.id, p = platesOf(working(lineage));
  return { wide: p.wide, cameras: plateCameras(s).map((cam) => {
    const plate = p.cameras[cam.name], d = C.about("plate", `${lineage}/${cam.name}`), n = (st) => d?.candidates.filter((c) => c.state === st).length ?? 0;
    return { camera: cam.name, at: cam.at, facing: cam.facing, lens: cam.lens, plate: plate ?? null, fits: !!plate && sameCamera(plate.camera, cam),
      candidates: d && d.status !== "closed" ? { decision: d.id, rendering: n("rendering"), ready: n("ready"), failed: n("failed"), applied: d.applied?.candidate ?? null } : null };
  }) };
}

// every write to a set's plates goes through one queue, so two renders finishing together can't drop each other
let writing = Promise.resolve();
function update(lineage, fn) {
  writing = writing.catch(() => {}).then(async () => {
    await L.ready();
    const card = working(lineage);
    if (!card) throw new Error(`No set ${lineage} in the Library`);
    const next = card.id.endsWith("-mine") ? structuredClone(card) : L.version(card, card.brick.snapshot, true);
    next.plates = platesOf(next);
    const out = fn(next.plates, next);
    await L.save(next);
    changed();
    return out;
  });
  return writing;
}

// a picture into ComfyUI's input folder (snap/plates), from a file the server already has or a blob the person chose
async function upload(blob, name) {
  const form = new FormData();
  form.append("image", blob, name);
  form.append("subfolder", "snap/plates");
  form.append("overwrite", "true");
  const r = await (await api.fetchApi("/upload/image", { method: "POST", body: form })).json();
  return `${r.subfolder}/${r.name}`;
}
const slug = (x) => String(x).replace(/[^a-z0-9-]+/gi, "_");
export const uploadPlate = (file, lineage, camera) => upload(file, `${slug(lineage)}_${slug(camera)}_${Date.now().toString(36)}.png`);

// a plate set by hand (the wide plate, or any camera's): an input-folder picture, or null to clear it
export function setPlate(lineage, camera, image, by = "person") {
  return update(lineage, (p, card) => {
    const at = new Date().toISOString();
    if (camera === "wide") { p.wide = image ? { image, by, at } : null; return p.wide; }
    const cam = plateCameras(card.brick.snapshot).find((c) => c.name === camera);
    if (!cam) throw new Error(`${card.title} has no camera "${camera}"; it has ${plateCameras(card.brick.snapshot).map((c) => c.name).join(", ")}`);
    if (!image) { delete p.cameras[camera]; return null; }
    p.cameras[camera] = { image, by, at, camera: { at: cam.at, facing: cam.facing, lens: cam.lens, height: cam.height }, copy_score: null };
    return p.cameras[camera];
  });
}

// the copy check's encoder and threshold come from the model graph: the clip_vision file whose entry has `copy_check`
export async function copyCheck() {
  await M.load();
  const name = (M.folders().get("clip_vision") ?? []).find((n) => M.entry(n)?.copy_check);
  if (!name) throw new Error("The copy check needs an encoder the model graph gives a copy_check (DINOv3 ViT-H, models/clip_vision/dino_v3_vit_h_bf16.safetensors)");
  return { encoder: name, threshold: M.entry(name).copy_check.threshold };
}

// the orbit's models: the first Render Preset that conditions on reference pictures (Pika + reference pictures), with
// the Models brick's own H3 encoder and VAEs
async function orbitModels() {
  const names = await (await api.fetchApi("/mainodes/render/presets")).json();
  let preset = null;
  for (const name of names) {
    const p = await (await api.fetchApi(`/mainodes/render/presets/${encodeURIComponent(name)}`)).json();
    if (p.conditioning === REF2V) { preset = { ...p, name }; break; }
  }
  if (!preset) throw new Error("No Render Preset conditions on reference pictures (Pika + reference pictures)");
  const [clip, video, audio] = BRICKS.models.nodes.map((n) => n.values);
  return { preset: { ...preset, model: await M.choice("MAIRenderPreset", "model", preset.model), lora: preset.lora === "none" ? "none" : await M.choice("MAIRenderPreset", "lora", preset.lora) },
    clip: { clip_name: await M.choice("CLIPLoader", "clip_name", clip.clip_name), type: clip.type, device: "default" },
    video: await M.choice("VAELoader", "vae_name", video.vae_name), audio: await M.choice("VAELoader", "vae_name", audio.vae_name) };
}

// one orbit render as an API prompt (U21 (b)'s graph): the video, its last frame, and that frame's copy score against
// the wide plate (only that frame: DINOv3 runs at 1024 px, about 0.4 s a frame on a 5090)
function orbitGraph({ text, seed, wide, prefix, models, encoder }) {
  const { name, ...preset } = models.preset;
  return {
    1: { class_type: "CLIPLoader", inputs: models.clip },
    2: { class_type: "VAELoader", inputs: { vae_name: models.video } },
    3: { class_type: "VAELoader", inputs: { vae_name: models.audio } },
    4: { class_type: "MAIRenderPreset", inputs: preset, _meta: { title: name } },
    5: { class_type: "LoadImage", inputs: { image: wide }, _meta: { title: "wide plate" } },
    6: { class_type: "H3References", inputs: { "ref_images.ref_image_0": ["5", 0] } },
    7: { class_type: "H3ReferenceToVideoRefs", inputs: { prompt: text, ...SIZE, ref_image_size: "match", clip: ["1", 0], vae: ["2", 0], audio_vae: ["3", 0], refs: ["6", 0] } },
    8: { class_type: "ConditioningZeroOut", inputs: { conditioning: ["7", 0] } },
    9: { class_type: "CFGGuider", inputs: { cfg: ["4", 5], model: ["4", 0], positive: ["7", 0], negative: ["8", 0] } },
    10: { class_type: "RandomNoise", inputs: { noise_seed: seed } },
    11: { class_type: "EmptyMiniMaxH3LatentAV", inputs: SIZE },
    12: { class_type: "SamplerCustomAdvanced", inputs: { noise: ["10", 0], guider: ["9", 0], sampler: ["4", 1], sigmas: ["4", 2], latent_image: ["11", 0] } },
    13: { class_type: "VAEDecode", inputs: { samples: ["12", 0], vae: ["2", 0] } },
    14: { class_type: "VAEDecodeAudio", inputs: { samples: ["12", 0], vae: ["3", 0] } },
    15: { class_type: "CreateVideo", inputs: { fps: 24.0, bit_depth: 8, color_space: "sRGB", chroma_subsampling: "auto", codec: "none", images: ["13", 0], audio: ["14", 0] } },
    16: { class_type: "SaveVideo", inputs: { filename_prefix: `video/snap_plates/${prefix}`, format: "auto", "format.codec": "auto", codec: "auto", video: ["15", 0] } },
    17: { class_type: "ImageFromBatch", inputs: { image: ["13", 0], batch_index: -1, length: 1 } },
    18: { class_type: "SaveImage", inputs: { images: ["17", 0], filename_prefix: `snap_plates/${prefix}` }, _meta: { title: "last frame" } },
    19: { class_type: "CLIPVisionLoader", inputs: { clip_name: encoder } },
    20: { class_type: "MAISnapCopyScore", inputs: { clip_vision: ["19", 0], reference: ["5", 0], images: ["17", 0] } },
  };
}

// the orbit pass (U55): `count` Ref2V renders per camera that has no plate yet (or the cameras named), seeds varied, as
// candidates for that camera's plate; the person picks one (preview-then-Apply). The copy score and the layout check
// only leave notes. Returns the queued renders. `s` is the set as the person is editing it (else the card's)
export async function make(lineage, { cameras, by = "person", s, count = 2 } = {}) {
  await Promise.all([L.ready(), C.load()]);
  const card = working(lineage);
  if (!card) throw new Error(`No set ${lineage} in the Library`);
  s ??= card.brick.snapshot;
  const p = platesOf(card), all = plateCameras(s);
  if (!p.wide) throw new Error(`${card.title} has no wide plate yet: choose one (a people-free picture of the whole set) first`);
  const unknown = (cameras ?? []).filter((c) => !all.some((x) => x.name === c));
  if (unknown.length) throw new Error(`No camera ${unknown.join(", ")} on this set; it has ${all.map((c) => c.name).join(", ")}`);
  const busy = new Set(all.filter((c) => C.rendering(C.about("plate", `${lineage}/${c.name}`))).map((c) => c.name));
  const todo = all.filter((c) => (cameras ? cameras.includes(c.name) : !sameCamera(p.cameras[c.name]?.camera, c)) && !busy.has(c.name));
  if (!todo.length) return { queued: [], note: busy.size ? "the cameras asked for are rendering" : "every camera has a plate" };
  const [{ encoder, threshold }, models] = await Promise.all([copyCheck(), orbitModels()]);
  const queued = [];
  for (const cam of todo) {
    const text = orbitText(s, cam), view = { at: cam.at, facing: cam.facing, lens: cam.lens, height: cam.height }, list = [];
    for (let i = 0; i < count; i++) {
      const seed = Math.floor(Math.random() * 2 ** 32);
      const job = { kind: "plate", title: `${cam.name}: a camera plate for ${card.title.replace(/^Set snapshot:\s*/, "")} (candidate ${i + 1} of ${count})`, about: { set: lineage, camera: cam.name, group: `snap-plates-${lineage}` }, by, eta_s: 64 };
      list.push({ prompt_id: await K.queue(orbitGraph({ text, seed, wide: p.wide.image, prefix: `${slug(lineage)}_${slug(cam.name)}`, models, encoder }), { group: `snap-plates-${lineage}`, job }), seed, frame: "last" });
    }
    const d = await C.create({ kind: "plate", target: `${lineage}/${cam.name}`, title: `${cam.name}: camera plate`, by, set: lineage, camera: cam.name, view, threshold }, list);
    queued.push(...d.candidates.map((c) => ({ camera: cam.name, prompt_id: c.prompt_id, seed: c.seed, decision: d.id, candidate: c.id })));
  }
  return { queued, threshold, encoder, per_camera: count, seconds_each: 64 }; // U49 on a 5090, one after another
}

// a finished orbit render: its last frame is the candidate, with its copy score against the wide plate as a note (a
// likely copy, never a rejection), then the layout check against the plan as a second note
async function finish(d, c, h) {
  const scores = Object.values(h.outputs).find((o) => o.copy_scores)?.copy_scores ?? [];
  const frame = Object.values(h.outputs).find((o) => o.images?.some((f) => /\.png$/i.test(f.filename)))?.images[0];
  if (!frame || !scores.length) { c.state = "failed"; c.error = "the render gave no last frame or copy score"; return; }
  c.take = `take-${c.prompt_id}`;
  c.pictures = [{ label: "last frame", media: { filename: frame.filename, subfolder: frame.subfolder ?? "", type: frame.type ?? "output" } }];
  c.notes.copy = { score: scores.at(-1), threshold: d.threshold, likely_copy: scores.at(-1) >= d.threshold };
  const card = working(d.set); // the camera it was rendered for, in the set as it is now
  if (card) K.layoutCheck(K.annotated(c.pictures[0].media), atCamera(card.brick.snapshot, { ...d.view, name: d.camera }), { set: d.set, camera: d.camera, decision: d.id, candidate: c.id }).catch((e) => ({ error: e.message })).then((r) => C.note(d, c, "layout", r));
}

// Apply: the candidate's frame becomes the camera's plate (in the input folder, with its provenance and who picked it);
// a shot compiled from this camera on the open chain compiles again with it. Undo puts the earlier plate back
async function pick(d, c, by) {
  const m = c.pictures[0].media, blob = await (await api.fetchApi(`/view?filename=${encodeURIComponent(m.filename)}&subfolder=${encodeURIComponent(m.subfolder)}&type=${m.type}`)).blob();
  const image = await upload(blob, `${slug(d.set)}_${slug(d.camera)}_${c.prompt_id.slice(0, 8)}.png`);
  const previous = await update(d.set, (p) => {
    const was = p.cameras[d.camera] ?? null;
    p.cameras[d.camera] = { image, take: c.take, frame: c.frame, copy_score: c.notes.copy?.score ?? null, threshold: d.threshold, seed: c.seed, camera: d.view, by: c.by, picked_by: by, candidate: `${d.id}/${c.id}`, at: new Date().toISOString() };
    return was;
  });
  await recompile(d);
  return { previous };
}
async function unpick(d, c, was) {
  await update(d.set, (p) => { if (was?.previous) p.cameras[d.camera] = was.previous; else delete p.cameras[d.camera]; });
  await recompile(d);
}
// the shot on the open chain, when it was compiled from this set's camera: compile it again (its own undo step)
async function recompile(d) {
  const shot = E.state().bricks.find((b) => b.key === "render")?.shot, card = shot && L.get(shot.card);
  if (card?.kind === "shot" && lineageOf(card.brick.set) === d.set && shot.picture?.camera === d.camera) await L.apply(card);
}
C.kind("plate", { finish, apply: pick, undo: unpick });

// on demand (U55): a shot that compiles with no plate for its camera gets plate candidates made for it. What the shot
// needs: { set, camera } when its set has a wide plate to orbit from and nothing is rendering or waiting for that
// camera; { waiting } when candidates wait for the person's pick; null when the shot has its plate or no set picture
export async function forShot(card) {
  await Promise.all([L.ready(), C.load()]);
  const picture = L.compile(card).picture, set = lineageOf(card.brick.set);
  if (picture?.use !== "wide") return null;
  const d = C.about("plate", `${set}/${picture.camera}`);
  if (C.rendering(d)) return { set, camera: picture.camera, rendering: d.id };
  if (d?.status === "open" && d.candidates.some((x) => x.state === "ready")) return { set, camera: picture.camera, waiting: d.id };
  return { set, camera: picture.camera };
}

// ---- the copy check on takes (U48 §3): a take whose frames match its own reference picture's view ------------------

// the pictures a take's prompt gave H3 as references: LoadImage files wired into any ref_images.* input, in slot order
export function referencePictures(prompt) {
  const out = [];
  for (const n of Object.values(prompt ?? {})) for (const [k, v] of Object.entries(n.inputs ?? {}).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    const src = k.startsWith("ref_images.") && Array.isArray(v) && prompt[v[0]];
    if (src?.class_type === "LoadImage") out.push(src.inputs.image);
  }
  return out;
}
const FRAMES = [0, 24, 48, 72, -1]; // the frames scored (U48 §3's, ending on the last); a shorter clip repeats its last
const annotated = K.annotated;

// score five frames of a take against each of its reference pictures; the take is flagged when its last frame reaches
// the threshold for any of them: a Ref2V take often starts on its reference's view (0.98 at frame 0 in U52's orbit
// takes) and is judged by where its camera ended up. The check's job says `takes: false`, so it never becomes a take; the
// take keeps the check's prompt id while it runs, so a page reloaded meanwhile finishes it (resume)
export async function checkTake(take, by = "person") {
  const refs = referencePictures(take.prompt);
  if (!refs.length) throw new Error(`Take ${take.number} had no reference pictures to compare with`);
  const m = take.media.find((x) => x.kind === "video") ?? take.media.find((x) => x.kind === "image");
  if (!m) throw new Error(`Take ${take.number} has no picture or video`);
  const { encoder, threshold } = await copyCheck();
  const g = { 1: { class_type: "CLIPVisionLoader", inputs: { clip_name: encoder } } };
  if (m.kind === "video") {
    Object.assign(g, { 2: { class_type: "LoadVideo", inputs: { file: annotated(m) } }, 4: { class_type: "GetVideoComponents", inputs: { video: ["2", 0] } } });
    FRAMES.forEach((f, i) => { g[5 + i] = { class_type: "ImageFromBatch", inputs: { image: ["4", 0], batch_index: f, length: 1 } }; });
    g[3] = { class_type: "BatchImagesNode", inputs: Object.fromEntries(FRAMES.map((_, i) => [`images.image${i}`, [String(5 + i), 0]])) };
  } else g[3] = { class_type: "LoadImage", inputs: { image: annotated(m) } };
  refs.forEach((image, i) => { g[20 + 2 * i] = { class_type: "LoadImage", inputs: { image } }; g[21 + 2 * i] = { class_type: "MAISnapCopyScore", inputs: { clip_vision: ["1", 0], reference: [String(20 + 2 * i), 0], images: ["3", 0] } }; });
  const id = await K.queue(g, { job: { kind: "check", title: `Copy check: did take ${take.number} re-render its reference picture's view?`, about: { take: take.id, group: take.group }, by, takes: false } });
  take.copy = { pending: true, by, prompt_id: id, refs, threshold };
  await T.save(take);
  copied(take);
  return { queued: true, references: refs.length, threshold };
}
// a copy check's scores onto its take, once its prompt is done
function copied(take) {
  const { by, prompt_id, refs, threshold } = take.copy;
  K.checked(prompt_id).then((h) => {
    const against = refs.map((image, i) => { const s = h.outputs?.[String(21 + 2 * i)]?.copy_scores ?? []; return { image, last: s.at(-1) ?? null, frames: s.map((x) => +x.toFixed(3)) }; });
    return { against, threshold, copied: against.some((a) => a.last >= threshold), by, at: new Date().toISOString() };
  }, (e) => ({ error: e.message, by, at: new Date().toISOString() })).then((copy) => { take.copy = copy; return T.save(take); }).catch((e) => console.warn(`copy check: ${e.message}`));
}
// copy checks still pending when the page loaded (a reload while one ran): finish them from the server's history; one
// from before checks kept their prompt id can't be found again and says so
export async function resume() {
  for (const t of (await T.load()).filter((x) => x.copy?.pending)) {
    if (t.copy.prompt_id) copied(t);
    else { t.copy = { error: "this check ran before checks kept their run's id; check again", by: t.copy.by, at: new Date().toISOString() }; await T.save(t); }
  }
}
resume().catch(() => {}); // a reload while a copy check ran finishes it
