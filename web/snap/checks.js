// Pre-screen checks (U55, U54): small local prompts that leave a note on a candidate, never a decision. They run under the
// page's own client id with a job stamp that says `takes: false` (SNAP-R65), so they never become takes and the page that
// started them gets their events; the page polls /history for them.
// - layout: where the plan puts each door, window and prop for this camera against where SAM 3.1 finds it by name
//   (core SAM3_Detect, mask centroid left to right). It answers "is each opening on the expected side, are the props in
//   order", which the copy score can't (U52: push-ins 0.56-0.68 overlap new views 0.50-0.66). Openings out of view count
//   too (a door the plan puts behind the camera must not be found); props out of view don't (SAM 3.1 reads the lamp
//   room's "lamp housing" as the floor lantern).
// - identity (U61, G1b): did an edit keep the person? Two notes from SAM 3.1's face and hair masks (MAISnapIdentity),
//   with thresholds from the model graph: "probably a different person" when the character score (DINOv3's CLS on a head
//   crop 1.5x the face, the encoder's character_check) of a pair falls below `different` (G1b: 0 false alarms in 21
//   same-character pairs, profiles and bowed heads included, where ArcFace below 0.35 raised 7), "hair lighter than
//   original" when an edit's lit hair (L* p90) rises more than hair_check's lighter over the take's own frames (U56b).
//   ArcFace is kept as a number to look at, never the flag. Both notes miss things (dark frames, blonder hair), so the
//   tile shows head crops of both and the person decides. Every face is measured on its own, and the faces of pictures
//   compared with the same picture are matched one to one, best total first: a two-shot scores each person against their
//   own face and shows the crop that belongs to each score (U101: one union crop scored Maren and showed Brann).
// - people: each person SAM 3.1 finds in a frame, boxed and numbered left to right, so a person and an agent can name
//   "person 2" (U35 agent eyes, UX_GEMS #5).
// SNAP-R18 local only · SNAP-R21 plates · SNAP-R23 checks are notes, never rejections · SNAP-R65 every queued prompt
// carries its job stamp · SNAP-R76 every face its own measurement, matched one to one · SNAP-R111 the character score
// raises the identity note, ArcFace is shown · see docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as M from "./models.js";
import * as MD from "./metadata.js";
import { layout as planned } from "./setsnap.js";
import * as J from "./jobs.js";

// the files the checks need, from the model graph: the encoder with copy_check (and the character score's
// character_check), the face model with identity_check, the text detector (with the hair check's threshold)
export async function needs() {
  await M.load();
  const f = M.folders(), pick = (folder, has) => (f.get(folder) ?? []).find((n) => has(M.entry(n))) ?? null;
  const encoder = pick("clip_vision", (e) => e?.copy_check), face = pick("face_recognition", (e) => e?.identity_check), detector = pick("checkpoints", (e) => e?.detects === "text");
  return { encoder, face, detector, copy: encoder && M.entry(encoder).copy_check, character: encoder && M.entry(encoder).character_check, identity: face && M.entry(face).identity_check, hair: detector && M.entry(detector).hair_check };
}

// an API prompt this page builds, under this page's client id with its job stamp (jobs.js: the question is required). A
// take is made from it into the take group `group` names (the workflow id it carries) unless the job says `takes: false`
// (takes.js). `extra` goes into extra_data (takes.js reads snap_parent from there); `world` is the record pins the take
// will carry (a re-run's recast pins the Cast it painted in, SNAP-R63)
export async function queue(prompt, { group, extra, world, job } = {}) {
  const snap_job = J.job(job);
  const workflow = group || !MD.on() ? MD.mark({ ...(group ? { id: group } : {}), nodes: [], links: [], extra: world ? { snap: { world } } : {} }) : null; // SNAP-R20: metadata off reaches these saves too
  const r = await api.fetchApi("/prompt", { method: "POST", body: JSON.stringify({ client_id: api.clientId, prompt,
    extra_data: { ...extra, snap_job, ...(workflow ? { extra_pnginfo: { workflow } } : {}) } }) });
  const out = await r.json();
  if (r.status !== 200) {
    const why = `${out.error?.message ?? ""} ${JSON.stringify(out.node_errors ?? {})}`.trim();
    J.refuse(job, why, () => queue(prompt, { group, extra, world, job }));
    throw new Error(`Not queued: ${why}`);
  }
  J.sent(snap_job, out.prompt_id);
  return out.prompt_id;
}

// queue a check (`job`: its question and what it is about) and wait for it
export const screen = async (prompt, job) => checked(await queue(prompt, { job: { ...job, kind: "check", takes: false } }));
// a queued check's result (10 minutes at most: the first DINOv3 load on CPU is 60-90 s); a page reloaded meanwhile asks
// again with the id it kept
export async function checked(id) {
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
// SAM 3.1 keeps one detection per text unless the text says how many ("face:9", core sam3_clip): `each` asks for every
// one, as separate masks (U101: "face" alone found Maren and never Brann in a two-shot)
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
export async function layoutCheck(image, view, about = {}) {
  const { detector: name } = await needs();
  if (!name) return { error: "no text detector in the model graph (SAM 3.1: models/checkpoints/sam3.1_multiplex_fp16.safetensors)" };
  const things = planned(view).filter((x) => x.k != null || x.kind !== "prop"), g = { ...detector(name) }, img = source(g, "i", { image });
  things.forEach((x, i) => {
    find(g, `f${i}`, img, x.query);
    g[`m${i}`] = { class_type: "MaskToImage", inputs: { mask: [`f${i}`, 0] } };
    g[`p${i}`] = { class_type: "PreviewImage", inputs: { images: [`m${i}`, 0] } };
  });
  const h = await screen(g, { title: `Layout check: is each door, window and prop where the plan puts it for ${view.name ?? "this camera"}?`, about }), found = await Promise.all(things.map((_, i) => centroid(first(h, `p${i}`))));
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

// the best one-to-one matching of rows to columns of a score matrix (the largest total; a row may stay unmatched when
// there are fewer columns): the column each row gets, or -1. Faces in a frame are few, so the search is exhaustive
export function assign(m) {
  let best = { total: -Infinity, cols: m.map(() => -1) };
  const walk = (r, used, cols, total) => {
    if (r === m.length) { if (total > best.total) best = { total, cols: [...cols] }; return; }
    const free = (m[r] ?? []).map((v, c) => c).filter((c) => !used.has(c));
    if (m.length - r > free.length) { cols.push(-1); walk(r + 1, used, cols, total); cols.pop(); } // more rows than faces left: one goes unmatched
    for (const c of free) { used.add(c); cols.push(c); walk(r + 1, used, cols, total + m[r][c]); cols.pop(); used.delete(c); }
  };
  walk(0, new Set(), [], 0);
  return best.cols;
}

// the identity notes: pairs of [original, edited] pictures (see source()), and `baseline`, more of the original's frames
// for the hair's baseline (U56b compares against the take's frames, not one). Per picture SAM 3.1 finds every face (one
// mask each) and the hair; MAISnapIdentity gives each face's ArcFace and character embeddings, box and head crop. The
// faces of every original compared with the same edited picture are matched one to one to that picture's faces (best
// total of both cosines), so a two-shot gets one score per person, each with its own crops; a pair's `character` is its
// lowest match, and `face` that match's ArcFace. Per edit, its hair's rise over the originals' median. `does`: what the
// edit's method does (methods.json); one the model graph lists in identity_check.unreliable_for (relighting) keeps the
// scores but never the different-person flag
export async function identityCheck(pairs, baseline = [], { does, about = {}, title = "Identity check: did the edit keep the person?" } = {}) {
  const { detector: name, face, identity, hair, encoder, character } = await needs();
  if (!name || !face || !hair || !character) return { error: `the identity notes need ${!name ? "SAM 3.1 (models/checkpoints)" : !face ? "a face model with identity_check in the model graph (models/face_recognition/cvlface_arcface_ir101_webface4m.safetensors)" : !hair ? "hair_check on SAM 3.1 in the model graph" : "the encoder with character_check in the model graph (DINOv3 ViT-H, models/clip_vision/dino_v3_vit_h_bf16.safetensors)"}` };
  const g = { ...detector(name), fm: { class_type: "MAISnapFaceModelLoader", inputs: { model_name: face } }, ce: { class_type: "CLIPVisionLoader", inputs: { clip_name: encoder } } };
  const measure = (k, src) => {
    const img = source(g, `s${k}`, src);
    g[`x${k}`] = { class_type: "MAISnapIdentity", inputs: { face_model: ["fm", 0], encoder: ["ce", 0], image: img, faces: [find(g, `f${k}`, img, "face:9", 0.4, true), 0], hair: [find(g, `r${k}`, img, "hair"), 0] } };
  };
  pairs.forEach((pair, i) => pair.forEach((src, j) => measure(`${i}${j}`, src)));
  baseline.forEach((src, i) => measure(`b${i}`, src));
  const h = await screen(g, { title, about }), look = (k) => { const o = h.outputs[`x${k}`] ?? {};
    return { faces: o.faces?.[0] ?? [], characters: o.characters?.[0] ?? [], boxes: o.boxes?.[0] ?? [], crops: o.images ?? [], hair: o.hair_l90?.[0] ?? null }; };
  const lit = [...pairs.map((_, i) => look(`${i}0`).hair), ...baseline.map((_, i) => look(`b${i}`).hair)].filter((x) => x != null).sort((a, b) => a - b);
  const base = lit.length ? (lit[(lit.length - 1) >> 1] + lit[lit.length >> 1]) / 2 : null;
  const cos = (a, b) => +a.reduce((s, v, k) => s + v * b[k], 0).toFixed(3);
  // the originals compared with one edited picture share its faces: match them all at once (two Casts in one frame)
  const groups = new Map();
  pairs.forEach((pair, i) => { const key = JSON.stringify(pair[1]); groups.set(key, [...(groups.get(key) ?? []), i]); });
  const matches = pairs.map(() => []), unreliable = (identity.unreliable_for ?? []).includes(does);
  const different = (x) => !unreliable && x != null && x < character.different;
  for (const members of groups.values()) {
    const b = look(`${members[0]}1`), rows = members.flatMap((i) => { const a = look(`${i}0`); return a.faces.map((f, n) => ({ i, n, f, c: a.characters[n] })); });
    assign(rows.map((r) => b.faces.map((f, k) => cos(r.f, f) + cos(r.c, b.characters[k])))).forEach((c, r) => {
      const { i, n } = rows[r], a = look(`${i}0`);
      matches[i].push(c < 0 ? { face: null, character: null, crops: [a.crops[n] ?? null, null], box: [a.boxes[n], null] }
        : { face: cos(rows[r].f, b.faces[c]), character: cos(rows[r].c, b.characters[c]), different: different(cos(rows[r].c, b.characters[c])), crops: [a.crops[n] ?? null, b.crops[c] ?? null], box: [a.boxes[n], b.boxes[c]] });
    });
  }
  const scores = pairs.map((_, i) => {
    const [a, b] = [look(`${i}0`), look(`${i}1`)], got = matches[i].filter((x) => x.character != null), low = got.length ? got.reduce((x, y) => (y.character < x.character ? y : x)) : null;
    return { character: low?.character ?? null, face: low?.face ?? null, different: different(low?.character), hair: b.hair != null && base != null ? +(b.hair - base).toFixed(1) : null,
      crops: low?.crops ?? matches[i][0]?.crops ?? [null, b.crops.length === 1 ? b.crops[0] : null], // an unmatched person shows only their own face
      ...(matches[i].length > 1 ? { people: matches[i] } : {}), ...(a.faces.length && b.faces.length ? {} : { no_head: [!a.faces.length, !b.faces.length] }) };
  });
  const read = scores.filter((s) => s.character != null), rises = scores.map((s) => s.hair).filter((x) => x != null), lowest = (k) => (read.length ? Math.min(...read.map((s) => s[k])) : null);
  const low = lowest("character"), up = rises.length ? Math.max(...rises) : null;
  return { scores, character_low: low, face_low: lowest("face"), hair_up: up, hair_base: base == null ? null : +base.toFixed(1), different_below: character.different, same_from: character.same, hair_lighter: hair.lighter,
    ...(unreliable ? { face_unreliable: does } : {}), different: different(low), lighter: up != null && up > hair.lighter, ...(read.length < pairs.length || rises.length < pairs.length ? { unread: { faces: pairs.length - read.length, hair: pairs.length - rises.length } } : {}) };
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
export async function peopleCheck(src, about = {}) {
  const { detector: name } = await needs();
  if (!name) throw new Error("Finding people needs SAM 3.1 (models/checkpoints/sam3.1_multiplex_fp16.safetensors)");
  const g = { ...detector(name) }, img = source(g, "i", src);
  find(g, "f", img, "person:20", 0.4, true);
  g.m = { class_type: "MaskToImage", inputs: { mask: ["f", 0] } };
  g.p = { class_type: "PreviewImage", inputs: { images: ["m", 0] } };
  const boxes = (await Promise.all(((await screen(g, { title: "Find the people in this frame", about })).outputs?.p?.images ?? []).map(box))).filter(Boolean);
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
