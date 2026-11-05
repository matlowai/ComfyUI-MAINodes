// Pre-screen checks (U55, U54): small local prompts that leave a note on a candidate, never a decision. They run under a
// throwaway client id, so they never become takes, and the page polls /history for them.
// - layout: where the plan puts each door, window and prop for this camera against where SAM 3.1 finds it by name
//   (core SAM3_Detect, mask centroid left to right). It answers "is each opening on the expected side, are the props in
//   order", which the copy score can't (U52: push-ins 0.56-0.68 overlap new views 0.50-0.66). Openings out of view count
//   too (a door the plan puts behind the camera must not be found); props out of view don't (SAM 3.1 reads the lamp
//   room's "lamp housing" as the floor lantern).
// - identity (U61): did an edit keep the person? Two notes from SAM 3.1's face and hair masks (MAISnapIdentity), with
//   thresholds from the model graph: "probably a different person" when ArcFace scores a pair's faces below
//   different_person (U56), "hair lighter than original" when an edit's lit hair (L* p90) rises more than hair_check's
//   lighter over the take's own frames (U56b). Both miss things (profiles, dark frames, blonder hair), so the tile shows
//   SAM 3.1 head crops of both and the person decides.
// - people: each person SAM 3.1 finds in a frame, boxed and numbered left to right, so a person and an agent can name
//   "person 2" (U35 agent eyes, UX_GEMS #5).
// SNAP-R18 local only · SNAP-R21 plates · SNAP-R23 checks are notes, never rejections · see docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as M from "./models.js";
import * as MD from "./metadata.js";
import { layout as planned } from "./setsnap.js";

// the files the checks need, from the model graph: the encoder with copy_check, the face model with identity_check, the
// text detector (with the hair check's threshold)
export async function needs() {
  await M.load();
  const f = M.folders(), pick = (folder, has) => (f.get(folder) ?? []).find((n) => has(M.entry(n))) ?? null;
  const encoder = pick("clip_vision", (e) => e?.copy_check), face = pick("face_recognition", (e) => e?.identity_check), detector = pick("checkpoints", (e) => e?.detects === "text");
  return { encoder, face, detector, copy: encoder && M.entry(encoder).copy_check, identity: face && M.entry(face).identity_check, hair: detector && M.entry(detector).hair_check };
}

// an API prompt this page builds. A take is made only from a run queued under this page's client id (takes.js), into
// the take group `group` names (the workflow id it carries); any other client id keeps a run out of the takes. `extra`
// goes into extra_data (takes.js reads snap_parent from there); `world` is the record pins the take will carry (a re-run's
// recast pins the Cast it painted in, SNAP-R63)
export async function queue(prompt, { group, client = api.clientId, extra, world } = {}) {
  const workflow = group || !MD.on() ? MD.mark({ ...(group ? { id: group } : {}), nodes: [], links: [], extra: world ? { snap: { world } } : {} }) : null; // SNAP-R20: metadata off reaches these saves too
  const r = await api.fetchApi("/prompt", { method: "POST", body: JSON.stringify({ client_id: client, prompt,
    extra_data: { ...extra, ...(workflow ? { extra_pnginfo: { workflow } } : {}) } }) });
  const out = await r.json();
  if (r.status !== 200) throw new Error(`Not queued: ${out.error?.message ?? ""} ${JSON.stringify(out.node_errors ?? {})}`.trim());
  return out.prompt_id;
}

// queue a check and wait for it (10 minutes at most: the first DINOv3 load on CPU is 60-90 s)
export async function screen(prompt) {
  const id = await queue(prompt, { client: `snap-check-${Date.now().toString(36)}` });
  for (let i = 0; i < 600; i++) {
    const h = (await (await api.fetchApi(`/history/${id}`)).json())[id];
    if (h?.status?.completed || h?.status?.status_str === "error") {
      if (h.status.status_str !== "success") throw new Error(h.status.messages?.find(([k]) => k === "execution_error")?.[1]?.exception_message ?? h.status.status_str);
      return h;
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw new Error("the check didn't finish in 10 minutes");
}

export const annotated = (m) => `${m.subfolder ? `${m.subfolder}/` : ""}${m.filename} [${m.type ?? "output"}]`;
export const url = (m) => api.apiURL(`/view?filename=${encodeURIComponent(m.filename)}&subfolder=${encodeURIComponent(m.subfolder ?? "")}&type=${m.type ?? "output"}`);
const first = (h, id) => h.outputs?.[id]?.images?.[0] ?? null;
// a picture for a check: an input-folder file or annotated output ("x.png [output]"), or frame `frame` of a video
function source(g, key, src) {
  if (src.video) {
    g[`${key}v`] = { class_type: "LoadVideo", inputs: { file: src.video } };
    g[`${key}c`] = { class_type: "GetVideoComponents", inputs: { video: [`${key}v`, 0] } };
    g[key] = { class_type: "ImageFromBatch", inputs: { image: [`${key}c`, 0], batch_index: src.frame, length: 1 } };
  } else g[key] = { class_type: "LoadImage", inputs: { image: src.image } };
  return [key, 0];
}
const detector = (name) => ({ d: { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: name } } });
const find = (g, key, image, text, threshold = 0.4, each = false) => {
  g[`${key}t`] = { class_type: "CLIPTextEncode", inputs: { clip: ["d", 1], text } };
  g[key] = { class_type: "SAM3_Detect", inputs: { model: ["d", 0], image, conditioning: [`${key}t`, 0], threshold, refine_iterations: 0, individual_masks: each } };
  return key;
};

// where a mask's mass sits left to right, -1 to 1; null when the detector found nothing
async function centroid(m) {
  const img = new Image();
  img.src = url(m);
  await img.decode();
  const w = 160, hgt = Math.max(1, Math.round((160 * img.naturalHeight) / img.naturalWidth)), c = Object.assign(document.createElement("canvas"), { width: w, height: hgt }), g = c.getContext("2d");
  g.drawImage(img, 0, 0, w, hgt);
  const px = g.getImageData(0, 0, w, hgt).data;
  let mass = 0, moment = 0;
  for (let i = 0; i < px.length; i += 4) { const v = px[i] / 255, x = ((i / 4) % w) / (w - 1); mass += v; moment += v * (2 * x - 1); }
  return mass < 0.002 * w * hgt ? null : +(moment / mass).toFixed(2);
}
const side = (k) => (k == null ? "out of view" : Math.abs(k) <= 0.15 ? "in the centre" : Math.abs(k) > 0.5 ? `on the ${k < 0 ? "left" : "right"}` : `${k < 0 ? "left" : "right"} of centre`);

// the layout check: `image` is the candidate picture (LoadImage path), `view` the set as its camera sees it
export async function layoutCheck(image, view) {
  const { detector: name } = await needs();
  if (!name) return { error: "no text detector in the model graph (SAM 3.1: models/checkpoints/sam3.1_multiplex_fp16.safetensors)" };
  const things = planned(view).filter((x) => x.k != null || x.kind !== "prop"), g = { ...detector(name) }, img = source(g, "i", { image });
  things.forEach((x, i) => {
    find(g, `f${i}`, img, x.query);
    g[`m${i}`] = { class_type: "MaskToImage", inputs: { mask: [`f${i}`, 0] } };
    g[`p${i}`] = { class_type: "PreviewImage", inputs: { images: [`m${i}`, 0] } };
  });
  const h = await screen(g), found = await Promise.all(things.map((_, i) => centroid(first(h, `p${i}`))));
  const rows = things.map((x, i) => {
    const at = found[i], ok = x.k == null ? at == null : at == null ? null : Math.abs(at - x.k) <= 0.5;
    return { name: x.name, kind: x.kind, plan: x.k == null ? "out of view" : x.where, found: at == null ? "not found" : side(at), at, ok };
  });
  // the props found, in the plan's left-to-right order: how many neighbouring pairs keep it
  const props = rows.map((r, i) => ({ ...r, k: things[i].k })).filter((r) => r.kind === "prop" && r.at != null).sort((a, b) => a.k - b.k);
  const pairs = props.slice(1).map((r, i) => r.at >= props[i].at);
  const judged = rows.filter((r) => r.ok != null);
  return { checked: judged.length, as_planned: judged.filter((r) => r.ok).length, openings: rows.filter((r) => r.kind !== "prop"), order: pairs.length ? `${pairs.filter(Boolean).length}/${pairs.length}` : null, rows, detector: name };
}

// the identity notes: pairs of [original, edited] pictures (see source()), and `baseline`, more of the original's frames
// for the hair's baseline (U56b compares against the take's frames, not one). Per picture SAM 3.1 finds the head (its
// crop is for the person: one that isn't the crop size means no head was found), the face and the hair; per pair the
// faces' cosine, per edit its hair's rise over the originals' median. `does`: what the edit's method does (methods.json);
// one the model graph lists in identity_check.unreliable_for (relighting) keeps the cosine but never the different-person flag
export async function identityCheck(pairs, baseline = [], { does } = {}) {
  const { detector: name, face, identity, hair } = await needs();
  if (!name || !face || !hair) return { error: `the identity notes need ${!name ? "SAM 3.1 (models/checkpoints)" : !face ? "a face model with identity_check in the model graph (models/face_recognition/cvlface_arcface_ir101_webface4m.safetensors)" : "hair_check on SAM 3.1 in the model graph"}` };
  const g = { ...detector(name), fm: { class_type: "MAISnapFaceModelLoader", inputs: { model_name: face } } };
  const measure = (k, src, crop) => {
    const img = source(g, `s${k}`, src);
    g[`x${k}`] = { class_type: "MAISnapIdentity", inputs: { face_model: ["fm", 0], image: img, face: [find(g, `f${k}`, img, "face"), 0], hair: [find(g, `r${k}`, img, "hair"), 0] } };
    if (!crop) return;
    g[`c${k}`] = { class_type: "CropByBBoxes", inputs: { image: img, bboxes: [find(g, `h${k}`, img, identity.region), 1], output_width: 512, output_height: 512, padding: 8, keep_aspect: "pad" } };
    g[`v${k}`] = { class_type: "PreviewImage", inputs: { images: [`c${k}`, 0] } };
  };
  pairs.forEach((pair, i) => pair.forEach((src, j) => measure(`${i}${j}`, src, true)));
  baseline.forEach((src, i) => measure(`b${i}`, src, false));
  const h = await screen(g), look = (k) => ({ face: h.outputs[`x${k}`]?.face?.[0] ?? null, hair: h.outputs[`x${k}`]?.hair_l90?.[0] ?? null });
  const lit = [...pairs.map((_, i) => look(`${i}0`).hair), ...baseline.map((_, i) => look(`b${i}`).hair)].filter((x) => x != null).sort((a, b) => a - b);
  const base = lit.length ? (lit[(lit.length - 1) >> 1] + lit[lit.length >> 1]) / 2 : null;
  const size = async (m) => { const img = new Image(); img.src = url(m); await img.decode(); return [img.naturalWidth, img.naturalHeight]; };
  const scores = await Promise.all(pairs.map(async (_, i) => {
    const [a, b] = [look(`${i}0`), look(`${i}1`)], crops = [first(h, `v${i}0`), first(h, `v${i}1`)], heads = (await Promise.all(crops.map(size))).map(([w, ht]) => w === 512 && ht === 512);
    return { face: a.face && b.face ? +a.face.reduce((s, v, k) => s + v * b.face[k], 0).toFixed(3) : null, hair: b.hair != null && base != null ? +(b.hair - base).toFixed(1) : null, crops,
      ...(heads.every(Boolean) ? {} : { no_head: heads.map((x) => !x) }) };
  }));
  const faces = scores.map((s) => s.face).filter((x) => x != null), rises = scores.map((s) => s.hair).filter((x) => x != null);
  const low = faces.length ? Math.min(...faces) : null, up = rises.length ? Math.max(...rises) : null, unreliable = (identity.unreliable_for ?? []).includes(does);
  return { scores, face_low: low, hair_up: up, hair_base: base == null ? null : +base.toFixed(1), different_person: identity.different_person, hair_lighter: hair.lighter, region: identity.region,
    ...(unreliable ? { face_unreliable: does } : {}), different: !unreliable && low != null && low < identity.different_person, lighter: up != null && up > hair.lighter, ...(faces.length < pairs.length || rises.length < pairs.length ? { unread: { faces: pairs.length - faces.length, hair: pairs.length - rises.length } } : {}) };
}

// a mask picture's box as fractions of the frame [x, y, w, h]; null when it is empty
async function box(m) {
  const img = new Image();
  img.src = url(m);
  await img.decode();
  const w = 256, hgt = Math.max(1, Math.round((256 * img.naturalHeight) / img.naturalWidth)), c = Object.assign(document.createElement("canvas"), { width: w, height: hgt }), g = c.getContext("2d");
  g.drawImage(img, 0, 0, w, hgt);
  const px = g.getImageData(0, 0, w, hgt).data;
  let x0 = w, y0 = hgt, x1 = -1, y1 = -1;
  for (let i = 0; i < px.length; i += 4) if (px[i] > 127) { const x = (i / 4) % w, y = Math.floor(i / 4 / w); x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  return x1 < 0 ? null : [x0 / w, y0 / hgt, (x1 - x0 + 1) / w, (y1 - y0 + 1) / hgt].map((v) => +v.toFixed(3));
}

// the people check: `src` as source() takes it; each person SAM 3.1 finds, numbered left to right by the middle of
// their box ({n, box: [x, y, w, h] as fractions of the frame})
export async function peopleCheck(src) {
  const { detector: name } = await needs();
  if (!name) throw new Error("Finding people needs SAM 3.1 (models/checkpoints/sam3.1_multiplex_fp16.safetensors)");
  const g = { ...detector(name) }, img = source(g, "i", src);
  find(g, "f", img, "person", 0.4, true);
  g.m = { class_type: "MaskToImage", inputs: { mask: ["f", 0] } };
  g.p = { class_type: "PreviewImage", inputs: { images: ["m", 0] } };
  const boxes = (await Promise.all(((await screen(g)).outputs?.p?.images ?? []).map(box))).filter(Boolean);
  return boxes.sort((a, b) => a[0] + a[2] / 2 - (b[0] + b[2] / 2)).map((b, i) => ({ n: i + 1, box: b }));
}

// a picture (the screenshot tool's image shape) with each person's box and number drawn on it
export async function numbered(image, people) {
  const img = new Image();
  img.src = `data:${image.mimeType};base64,${image.data}`;
  await img.decode();
  const c = Object.assign(document.createElement("canvas"), { width: img.naturalWidth, height: img.naturalHeight }), g = c.getContext("2d"), r = Math.max(12, Math.round(c.width / 40));
  g.drawImage(img, 0, 0);
  g.lineWidth = Math.max(2, c.width / 320);
  g.font = `bold ${Math.round(r * 1.2)}px sans-serif`;
  g.textAlign = "center"; g.textBaseline = "middle";
  for (const { n, box: [x, y, w, h] } of people) {
    const [px, py] = [x * c.width, y * c.height];
    g.strokeStyle = "#ffd23f"; g.strokeRect(px, py, w * c.width, h * c.height);
    const [cx, cy] = [Math.max(r, px), Math.max(r, py)]; // on the box's corner, clear of the face below it
    g.fillStyle = "#ffd23f"; g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.fill();
    g.fillStyle = "#101418"; g.fillText(String(n), cx, cy + 1);
  }
  return { mimeType: "image/jpeg", data: c.toDataURL("image/jpeg", 0.85).split(",")[1], width: c.width, height: c.height };
}
