// Camera plates (U48 §7, U49.5): one people-free picture of a set per camera, so a shot's reference shows its own
// camera's view. One wide plate as everyone's reference makes H3 copy its viewpoint (U21: 8/12), so the plates come from
// an orbit pass: H3 Ref2V from the set's wide plate, once per camera, saying "the camera is not where <Picture 1> was
// taken" plus that camera's doors and windows. The last frame becomes the camera's plate unless it re-renders the wide
// plate's view: the copy score (DINOv3 patch tokens matched by grid position, MAISnapCopyScore) at or above the model
// graph's threshold rejects it. The person can swap any plate by hand. Plates live on the set's working copy card
// (`<set>-mine`), each with its provenance: take, frame, copy score, seed, the camera it was made for, who made it.
// The same score flags takes that copied their own reference picture (U48 §3: DINOv3's room score can't see it).
// SNAP-R16 GPU work waits as a proposal for agents · SNAP-R17 by: person|agent · SNAP-R18 local only ·
// SNAP-R21 a reference shows the shot's own camera · see docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as L from "./library.js";
import * as M from "./models.js";
import * as T from "./takes.js";
import { BRICKS } from "./bricks.js";
import { setBlock, plateCameras, atCamera, cameraAt, inFrame, keeps, sameCamera } from "./setsnap.js";

const REF2V = "Ref2V (reference pictures)"; // the Render Preset's conditioning the orbit needs (U49: the ref2va pair)
const SIZE = { width: 1280, height: 704, length: 97 }; // U49's orbit renders (length 97 runs as 107 frames, about 64 s)
const SOUND = "overall_soundscape: Quiet room tone.\n\nnon_diegetic_music: N/A";
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) fn(); };

// the U49 orbit wording for one camera: a camera sentence that says what sits where in its frame (as U49's did; without
// it the first Snap orbit copied the wide plate 3/3), the wide plate is <Picture 1>, this camera is somewhere else, and the
// set block says what this camera sees, doors and windows included; nobody in the room
export function orbitText(s, cam) {
  const v = atCamera(s, cam);
  const seen = inFrame(v), size = cam.lens <= 28 ? "wide" : cam.lens <= 60 ? "medium" : "close";
  return `integrated_multimodal_description: [Shot 1] Cinematic ${size} shot, ${cam.lens} mm, ${cameraAt(v)}${seen ? `: ${seen}` : ""}. This is the same ${s.name} shown in <Picture 1>, but the camera is not where <Picture 1> was taken: `
    + `this is a new eye-height view from the position above, with a ${cam.lens} mm lens. Keep its ${keeps(s)} exactly as in <Picture 1>. ${s.look ? `${s.look} ` : ""}`
    + `${setBlock(v)} Nobody is in the room. The camera slowly pushes in.\n\n${SOUND}`;
}

const working = (lineage) => L.get(`${lineage}-mine`) ?? L.get(lineage);
export const platesOf = (card) => ({ wide: null, cameras: {}, pending: {}, rejected: {}, ...card?.plates });
// plates of a set (any version of it): what each camera has, its status, and the cameras its snapshot has now
export function status(card, s = card.brick.snapshot) {
  const p = platesOf(working(card.lineage ?? card.id));
  const waiting = Object.entries(p.pending);
  return { wide: p.wide, cameras: plateCameras(s).map((cam) => {
    const plate = p.cameras[cam.name], job = waiting.find(([, j]) => j.camera === cam.name);
    return { camera: cam.name, at: cam.at, facing: cam.facing, lens: cam.lens, plate: plate ?? null, fits: !!plate && sameCamera(plate.camera, cam),
      rendering: job ? job[0] : null, rejected: p.rejected[cam.name] ?? null };
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
    delete p.rejected[camera];
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

const choices = async (type) => (await (await api.fetchApi(`/object_info/${type}`)).json())[type].input.required;
// a file the graph names, as this server lists it (basename matching, SNAP-R3); one that isn't there fails here, by name.
// Legacy combos list their choices as [[...]], V3 ones as ["COMBO", { options }]
async function resolve(type, input, value) {
  const spec = (await choices(type))[input], list = Array.isArray(spec[0]) ? spec[0] : spec[1].options, hit = list.includes(value) ? value : list.filter((v) => v.split("/").pop() === value.split("/").pop());
  if (typeof hit === "string") return hit;
  if (hit.length !== 1) throw new Error(`${type}.${input}: ${value} isn't installed`);
  return hit[0];
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
  return { preset: { ...preset, model: await resolve("MAIRenderPreset", "model", preset.model), lora: preset.lora === "none" ? "none" : await resolve("MAIRenderPreset", "lora", preset.lora) },
    clip: { clip_name: await resolve("CLIPLoader", "clip_name", clip.clip_name), type: clip.type, device: "default" },
    video: await resolve("VAELoader", "vae_name", video.vae_name), audio: await resolve("VAELoader", "vae_name", audio.vae_name) };
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

// a prompt this page queues: `group` is the take group its take lands in (takes.js reads the workflow's id), so orbit
// renders never mix into the person's strip
async function queue(prompt, group, client = api.clientId) {
  const r = await api.fetchApi("/prompt", { method: "POST", body: JSON.stringify({ client_id: client, prompt, extra_data: { extra_pnginfo: { workflow: { id: group, nodes: [], links: [], extra: {} } } } }) });
  const out = await r.json();
  if (r.status !== 200) throw new Error(`Not queued: ${out.error?.message ?? ""} ${JSON.stringify(out.node_errors ?? {})}`.trim());
  return out.prompt_id;
}

// the orbit pass: one Ref2V render per camera that has no plate yet (or the cameras named), queued at once; each lands
// on the card when it finishes. Returns the queued jobs. `s` is the set as the person is editing it (else the card's)
export async function make(lineage, { cameras, by = "person", s } = {}) {
  await L.ready();
  const card = working(lineage);
  if (!card) throw new Error(`No set ${lineage} in the Library`);
  s ??= card.brick.snapshot;
  const p = platesOf(card), all = plateCameras(s);
  if (!p.wide) throw new Error(`${card.title} has no wide plate yet: choose one (a people-free picture of the whole set) first`);
  const unknown = (cameras ?? []).filter((c) => !all.some((x) => x.name === c));
  if (unknown.length) throw new Error(`No camera ${unknown.join(", ")} on this set; it has ${all.map((c) => c.name).join(", ")}`);
  const busy = new Set(Object.values(p.pending).map((j) => j.camera));
  const todo = all.filter((c) => (cameras ? cameras.includes(c.name) : !sameCamera(p.cameras[c.name]?.camera, c)) && !busy.has(c.name));
  if (!todo.length) return { queued: [], note: busy.size ? "the cameras asked for are rendering" : "every camera has a plate" };
  const [{ encoder, threshold }, models] = await Promise.all([copyCheck(), orbitModels()]);
  const jobs = [];
  for (const cam of todo) {
    const seed = Math.floor(Math.random() * 2 ** 32), text = orbitText(s, cam);
    const id = await queue(orbitGraph({ text, seed, wide: p.wide.image, prefix: `${slug(lineage)}_${slug(cam.name)}`, models, encoder }), `snap-plates-${lineage}`);
    jobs.push([id, { camera: cam.name, view: { at: cam.at, facing: cam.facing, lens: cam.lens, height: cam.height }, seed, threshold, by, queued: new Date().toISOString() }]);
  }
  await update(lineage, (q) => { for (const [id, job] of jobs) q.pending[id] = job; });
  return { queued: jobs.map(([id, j]) => ({ camera: j.camera, prompt_id: id, seed: j.seed })), threshold, encoder, seconds_each: 64 }; // U49 on a 5090, one after another
}

// a finished orbit render onto the card: its last frame is the camera's plate, unless its copy score says it re-rendered
// the wide plate's view; a failed render is recorded as rejected with its error
async function finish(lineage, id) {
  const h = (await (await api.fetchApi(`/history/${id}`)).json())[id];
  if (!h?.status?.completed && h?.status?.status_str !== "error") return false;
  const job = platesOf(working(lineage)).pending[id];
  if (!job) return false;
  let result;
  if (h.status.status_str !== "success") result = { rejected: { take: `take-${id}`, error: h.status.messages?.find(([k]) => k === "execution_error")?.[1]?.exception_message ?? h.status.status_str, at: new Date().toISOString() } };
  else {
    const scores = Object.values(h.outputs).find((o) => o.copy_scores)?.copy_scores ?? [];
    const frame = Object.values(h.outputs).find((o) => o.images?.some((f) => /\.png$/i.test(f.filename)))?.images[0];
    const record = { take: `take-${id}`, frame: "last", copy_score: scores.at(-1), threshold: job.threshold, seed: job.seed, camera: job.view, by: job.by, at: new Date().toISOString() };
    if (!frame || !scores.length) result = { rejected: { ...record, error: "the render gave no last frame or copy score" } };
    else if (record.copy_score >= job.threshold) result = { rejected: { ...record, image: null, copy: true } };
    else {
      const blob = await (await api.fetchApi(`/view?filename=${encodeURIComponent(frame.filename)}&subfolder=${encodeURIComponent(frame.subfolder ?? "")}&type=${frame.type ?? "output"}`)).blob();
      result = { plate: { image: await upload(blob, `${slug(lineage)}_${slug(job.camera)}_${id.slice(0, 8)}.png`), ...record } };
    }
  }
  await update(lineage, (p) => {
    delete p.pending[id];
    if (result.plate) { p.cameras[job.camera] = result.plate; delete p.rejected[job.camera]; } else p.rejected[job.camera] = result.rejected;
  });
  return true;
}

// settle every set's finished renders (after a reload too: the jobs are on the cards, the results in /history); a job
// is finished once even when several events ask at the same time
const finishing = new Set();
export async function settle() {
  await L.ready();
  for (const card of L.search("", "refs").filter((c) => c.kind === "set_snapshot" && c.id.endsWith("-mine"))) for (const id of Object.keys(platesOf(card).pending)) {
    if (finishing.has(id)) continue;
    finishing.add(id);
    await finish(card.lineage ?? card.id, id).catch((e) => console.warn(`plate ${id}: ${e.message}`)).finally(() => finishing.delete(id));
  }
}
for (const ev of ["execution_success", "execution_error", "execution_interrupted"]) api.addEventListener(ev, () => { settle().catch(() => {}); });

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
const FRAMES = [0, 24, 48, 72, 96]; // the frames U48 §3 validated the check on (a shorter clip repeats its last)
const annotated = (m) => `${m.subfolder ? `${m.subfolder}/` : ""}${m.filename} [${m.type ?? "output"}]`;

// score five frames of a take against each of its reference pictures; the take is flagged when the mean over them
// reaches the threshold for any of them. The check runs under its own client id, so it never becomes a take itself
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
  const id = await queue(g, "snap-copy-check", `snap-copy-check-${Date.now().toString(36)}`);
  take.copy = { pending: id, by };
  await T.save(take);
  const done = async () => { const h = (await (await api.fetchApi(`/history/${id}`)).json())[id]; return h?.status?.completed || h?.status?.status_str === "error" ? h : null; };
  (async () => {
    let h = null;
    for (let i = 0; i < 600 && !(h = await done()); i++) await new Promise((r) => setTimeout(r, 1000));
    const against = refs.map((image, i) => { const s = h?.outputs?.[String(21 + 2 * i)]?.copy_scores ?? []; return { image, mean: s.length ? +(s.reduce((a, b) => a + b) / s.length).toFixed(3) : null, max: s.length ? +Math.max(...s).toFixed(3) : null, frames: s.length }; });
    take.copy = h?.status?.status_str === "success"
      ? { against, threshold, copied: against.some((a) => a.mean >= threshold), by, at: new Date().toISOString() }
      : { error: h?.status?.status_str ?? "the check didn't finish", by, at: new Date().toISOString() };
    await T.save(take);
  })().catch((e) => console.warn(`copy check ${id}: ${e.message}`));
  return { queued: id, references: refs.length, threshold };
}
