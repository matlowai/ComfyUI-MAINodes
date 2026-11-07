// What a critic reads for one critique row (U93, DESIGN_U93_U94 §4.2): the subject whole at its native size first (no
// cap), then 100% tiles of every subject picture bigger than the tile size, each labelled with its grid cell and pixel
// box, then the context pictures whole (a location's master, plan and plates, the Cast pictures pinned, the previous
// cut's last frame, an upscale's or edit's source, a cut pair's two frames), then the words: the purpose and checklist with
// its passes, the prompt (the beat), the Cast lines, the location's notes, the pins, the sound. A region the critic names
// on a tile maps back to the subject's own fractions through the tile's box (critiques.js). Frames of a take kept
// encrypted open only through the vault, as the viewer reads them; a locked one says so instead.
// G3: a still's subject pictures and tiles go as PNG (lossless: seams and ghost faces survive), video frames as JPEG, and
// every label says which (F-E07; G5: a still's context pictures go as PNG too, F-G07); a location's plan also goes with its camera marks and plate poses drawn as
// the Location sheet draws them, beside the bare plan, and its camera map when it has one (F-E17); each plate's words
// carry its camera mark and eye gap; the record's notes are flagged as claims to check, never evidence (F-E22).
// SNAP-R102 whole frame first, nothing shrunk · SNAP-R104 what is read follows the checklist · SNAP-R58 nothing an agent
// reads is cut: part, offset and limit page it · SNAP-R136 what the sheet shows, the packet shows · SNAP-R155 the place's
// scale anchors and how to measure against them (scale_rule) · see docs/snap/SNAP_RULES.md
import * as L from "./library.js";
import * as T from "./takes.js";
import * as C from "./candidates.js";
import * as W from "./world.js";
import * as SC from "./scenes.js";
import * as RT from "./retake.js";

const FPS = 24, Q = 0.9;
export const PARTS = ["all", "whole", "tiles", "context"];
const LOCKED = "kept encrypted and the vault is locked: the person signs in (or unlocks it) first, then ask for the packet again";
const inputMedia = (file) => { const cut = file.lastIndexOf("/"); return { filename: file.slice(cut + 1), subfolder: file.slice(0, Math.max(cut, 0)), type: "input" }; };
const pathOf = (m) => [m.type, m.subfolder, m.filename].filter(Boolean).join("/");
const isVideo = (m) => /\.(mp4|webm|mov|mkv)$/i.test(m.filename);

// a picture or a video's frames as canvases at their own size
async function canvases(m, frames) {
  const draw = (src, w, h) => { const c = Object.assign(document.createElement("canvas"), { width: w, height: h }); c.getContext("2d").drawImage(src, 0, 0, w, h); return c; };
  if (!isVideo(m)) { const img = new Image(); img.src = T.url(m); await img.decode(); return [{ frame: null, canvas: draw(img, img.naturalWidth, img.naturalHeight) }]; }
  const v = Object.assign(document.createElement("video"), { src: T.url(m), muted: true, preload: "auto" });
  await new Promise((done, fail) => { v.onloadedmetadata = done; v.onerror = () => fail(new Error(`couldn't read ${pathOf(m)}`)); });
  const last = Math.max(0, Math.floor(v.duration * FPS) - 1), want = typeof frames === "number" ? Array.from({ length: Math.max(1, frames) }, (_, i) => Math.round((last * i) / Math.max(1, frames - 1))) : frames.map((f) => (f === "last" ? last : Math.max(0, Math.min(last, f))));
  const out = [];
  for (const frame of [...new Set(want)]) {
    await new Promise((done) => { v.onseeked = done; v.currentTime = Math.min(v.duration - 0.01, (frame + 0.5) / FPS); });
    out.push({ frame, canvas: draw(v, v.videoWidth, v.videoHeight) });
  }
  return out;
}
const jpeg = (c) => ({ mimeType: "image/jpeg", data: c.toDataURL("image/jpeg", Q).split(",")[1], width: c.width, height: c.height });
const png = (c) => ({ mimeType: "image/png", data: c.toDataURL("image/png").split(",")[1], width: c.width, height: c.height });
const encode = (c, lossless) => (lossless ? png(c) : jpeg(c));
const fmt = (lossless) => (lossless ? "png" : `jpeg q${Math.round(Q * 100)}`);
// the plan as the Location sheet draws it: a dot and a wedge per camera mark (blue) and plate pose (amber), each named
const fov = (lens) => (2 * Math.atan(18 / lens) * 180) / Math.PI;
function marked(plan, b) {
  const c = Object.assign(document.createElement("canvas"), { width: plan.width, height: plan.height }), g = c.getContext("2d"), r = c.width * 0.01, len = c.width * 0.075;
  g.drawImage(plan, 0, 0);
  const marks = [...(b.cameras ?? []).map((m) => ({ ...m, kind: "camera" })), ...(b.plates ?? []).filter((p) => p.pose?.x != null).map((p) => ({ name: p.name, ...p.pose, kind: "plate" }))];
  g.font = `bold ${Math.round(c.width * 0.016)}px sans-serif`; g.lineWidth = 2;
  for (const m of marks) {
    const x = m.x * c.width, y = m.y * c.height, col = m.kind === "plate" ? "#f0b445" : "#3d8bff";
    if (m.heading != null) {
      const half = (fov(m.lens || 35) / 2) * (Math.PI / 180), h0 = (m.heading * Math.PI) / 180;
      g.beginPath(); g.moveTo(x, y); g.arc(x, y, len, h0 - half - Math.PI / 2, h0 + half - Math.PI / 2); g.closePath();
      g.fillStyle = `${col}40`; g.strokeStyle = col; g.fill(); g.stroke();
    }
    g.beginPath(); g.arc(x, y, r, 0, 2 * Math.PI); g.fillStyle = col; g.fill(); g.strokeStyle = "#0b0c0f"; g.stroke();
    g.fillStyle = "#0b0c0f"; g.strokeStyle = "#ffffffd0"; g.lineWidth = 4; const label = `${m.kind === "plate" ? "plate" : "mark"} ${m.name}`;
    g.strokeText(label, x + r * 1.4, y + (m.kind === "plate" ? -r : r * 2.6)); g.fillText(label, x + r * 1.4, y + (m.kind === "plate" ? -r : r * 2.6)); g.lineWidth = 2;
  }
  return c;
}
// F-G07: a measuring copy of a plate or master: lines every 10 % of each side with their pixel position, so a critic reads
// a camera height or a wall ratio off the picture instead of cropping its own
function measured(src) {
  const c = Object.assign(document.createElement("canvas"), { width: src.width, height: src.height }), g = c.getContext("2d"), fs = Math.max(11, Math.round(c.width * 0.011));
  g.drawImage(src, 0, 0);
  g.font = `bold ${fs}px sans-serif`; g.lineWidth = 1;
  for (let k = 1; k < 10; k++) {
    const x = Math.round((c.width * k) / 10), y = Math.round((c.height * k) / 10);
    g.strokeStyle = "#ff3df0a0"; g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, c.height); g.moveTo(0, y + 0.5); g.lineTo(c.width, y + 0.5); g.stroke();
    g.fillStyle = "#0b0c0f"; g.strokeStyle = "#ffffffd0"; g.lineWidth = 3;
    for (const [t, tx, ty] of [[`x ${x}`, x + 3, fs + 2], [`y ${y}`, 3, y - 3]]) { g.strokeText(t, tx, ty); g.fillText(t, tx, ty); }
    g.lineWidth = 1;
  }
  return c;
}
// 100% tiles with overlap over a picture bigger than the tile size, row by row
export function grid(w, h, size, overlap) {
  const axis = (n) => { if (n <= size) return [[0, n]]; const k = Math.ceil((n - size) / (size * (1 - overlap))) + 1, step = (n - size) / (k - 1); return Array.from({ length: k }, (_, i) => [Math.round(i * step), size]); };
  return axis(h).flatMap(([y, th], r) => axis(w).map(([x, tw], c) => ({ cell: `r${r + 1}c${c + 1}`, box: [x, y, tw, th] })));
}
function tiles(c, size, overlap) {
  return grid(c.width, c.height, size, overlap).map((t) => { const out = Object.assign(document.createElement("canvas"), { width: t.box[2], height: t.box[3] }); out.getContext("2d").drawImage(c, t.box[0], t.box[1], t.box[2], t.box[3], 0, 0, t.box[2], t.box[3]); return { ...t, canvas: out }; });
}

// what the subject's pictures are, by subject kind: [{media, frames, what, take?}]
function takeMedia(t) { if (t.locked) throw new Error(`Take ${t.number} is ${LOCKED}`); const m = t.media.find((x) => x.kind === "video") ?? t.media.find((x) => x.kind === "image"); if (!m) throw new Error(`Take ${t.number} has no picture or video`); return m; }
function subjects(r, tb) {
  const s = r.subject, list = tb.checklists[r.checklist] ?? tb.checklists.still;
  if (s.kind === "take") { const t = T.get(s.take); if (!t) throw new Error(`No take ${s.take} here`); const m = takeMedia(t); return [{ media: m, frames: isVideo(m) ? list.frames ?? 5 : null, what: `take ${t.number}`, take: t.id }]; }
  if (s.kind === "pair") return s.pair.map((id, i) => { const t = T.get(id); if (!t) throw new Error(`No take ${id} here`); const m = takeMedia(t); return { media: m, frames: isVideo(m) ? [i === 0 ? "last" : 0] : null, what: `take ${t.number}, its ${i === 0 ? "last" : "first"} frame`, take: t.id }; });
  if (s.kind === "candidate") { const d = C.get(s.decision), c = C.candidate(d, s.candidate); if (!c) throw new Error(`No candidate ${s.candidate} in ${s.decision}`); return c.pictures.filter((p) => p.media).map((p) => ({ media: p.media, frames: isVideo(p.media) ? 3 : null, what: `${c.id} · ${p.label}` })); }
  const got = W.get(s.ref); if (!got) throw new Error(`No record ${s.ref}`);
  const b = got.version.body;
  if (s.ref.startsWith("cast:")) return (b.refs ?? []).map((x) => ({ media: inputMedia(x.file), frames: null, what: `${b.name}: ${x.role ?? "picture"}` }));
  if (s.part === "views") return [b.master && ["master", b.master], b.plan && ["plan", b.plan], ...(b.plates ?? []).map((p) => [`plate ${p.name}`, p])].filter(Boolean).map(([w, p]) => ({ media: inputMedia(p.file), frames: null, what: `${b.name} v${got.version.n}, ${w}` }));
  const p = s.part === "master" ? b.master : s.part === "plan" ? b.plan : b.plates?.find((x) => `plate ${x.name}` === s.part);
  if (!p) throw new Error(`${b.name} v${got.version.n} has no ${s.part}`);
  return [{ media: inputMedia(p.file), frames: null, what: `${b.name} v${got.version.n}, ${s.part}` }];
}
// the context pictures, whole: from the subject's pins and its place in the scene
function contextOf(r, tb) {
  const s = r.subject, want = new Set((tb.checklists[r.checklist] ?? tb.checklists.still).context), out = [];
  const add = (media, what, take, marks) => { if (marks || !out.some((x) => pathOf(x.media) === pathOf(media) && !x.marks)) out.push({ media, what, ...(take ? { take } : {}), ...(marks ? { marks } : {}) }); };
  const place = (ref, n, plates, skip) => { const got = W.get(W.refOf("location", W.parse(ref).id, n)); if (!got) return; const b = got.version.body;
    if (b.master && skip !== "master") add(inputMedia(b.master.file), `${b.name} v${got.version.n}, master`);
    if (b.plan && skip !== "plan") add(inputMedia(b.plan.file), `${b.name} v${got.version.n}, plan`);
    if (b.plan && ((b.cameras ?? []).length || (b.plates ?? []).some((p) => p.pose?.x != null))) add(inputMedia(b.plan.file), `${b.name} v${got.version.n}, plan with camera marks (blue) and plate poses (amber) drawn, as the Location sheet shows it`, null, b);
    if (b.map) add(inputMedia(b.map.file), `${b.name} v${got.version.n}, camera map`);
    for (const p of b.plates ?? []) if ((plates == null || plates.includes(p.name)) && `plate ${p.name}` !== skip) add(inputMedia(p.file), `${b.name} v${got.version.n}, plate ${p.name}`); };
  const cast = (ref, n) => { const got = W.get(W.refOf("cast", W.parse(ref).id, n)); for (const x of got?.version.body.refs ?? []) add(inputMedia(x.file), `${got.version.body.name} (Cast v${got.version.n}): ${x.role ?? "picture"}`); };
  const takeFrame = (t, frame, what) => { if (!t || t.locked) return; const m = t.media.find((x) => x.kind === "video") ?? t.media.find((x) => x.kind === "image"); if (m) add({ ...m, at: frame }, what, t.id); };
  const t = s.kind === "take" ? T.get(s.take) : s.kind === "pair" ? T.get(s.pair[1]) : s.kind === "candidate" ? T.get(C.get(s.decision)?.take) : null;
  if (t) {
    for (const [ref, p] of Object.entries(t.world ?? {})) {
      if (ref.startsWith("location:")) place(ref, p.n, want.has("plates") ? p.placed?.plates ?? null : []);
      if (ref.startsWith("cast:") && want.has("cast")) cast(ref, p.n);
    }
    if (t.parent?.take && (want.has("source") || want.has("board"))) takeFrame(T.get(t.parent.take), t.parent.frame ?? "last", `the take it was made from (${t.parent.method})`);
    const h = RT.shotOf(t), i = h ? h.scene.shots.indexOf(h.shot) : -1, before = i > 0 ? T.get(h.scene.shots[i - 1].active) : null;
    if (before && want.has("previous")) takeFrame(before, "last", `the previous cut's last frame (take ${before.number}, ${SC.shotTitle(h.scene, h.scene.shots[i - 1])})`);
    if (s.kind === "candidate") takeFrame(t, "last", `take ${t.number}, the take this edit paints over`);
    // F-F11: a New view (a board) was made from context pictures, given as files (the Cast's, the place's): they are what
    // it should agree with, so the cast pass reads pictures, not only words
    if (/^view\//.test(t.parent?.method ?? "")) for (const c of t.parent.options?.context ?? []) if (c.file && !c.take) add(inputMedia(c.file), `made from: Picture ${c.n} ${c.label ?? c.file}`);
  }
  if (s.kind === "record" && s.ref.startsWith("location:")) { const { n } = W.parse(s.ref); place(s.ref, n, null, s.part === "views" ? "all" : s.part); }
  if (s.kind === "record" && s.part === "views") out.splice(0, out.length, ...out.filter((x) => x.marks || /, camera map$/.test(x.what))); // every view is a subject already; the drawn plan and the map stay
  for (const f of r.context?.pictures ?? []) add(inputMedia(f.replace(/^input\//, "")), `context: ${f.split("/").pop()}`);
  return out;
}
// the words: purpose, checklist and passes, the beat, who and where should be in it
function words(r, tb) {
  const s = r.subject, list = tb.checklists[r.checklist] ?? tb.checklists.still, t = s.kind === "take" ? T.get(s.take) : s.kind === "pair" ? T.get(s.pair[1]) : null, out = { checklist: r.checklist, label: list.label, passes: list.passes, purpose: r.purpose ?? null };
  if (r.context?.text) out.context = r.context.text;
  if (r.context?.what) out.what = r.context.what;
  if (t) {
    out.prompt = t.text ?? "";
    const h = RT.shotOf(t); if (h) out.shot = { scene: h.scene.name, shot: SC.shotTitle(h.scene, h.shot), set: h.scene.set ?? null };
    if (t.sound?.mean_db != null) out.sound = { mean_db: t.sound.mean_db, quiet_below_db: T.QUIET_DB };
    out.pins = Object.entries(t.world ?? {}).map(([ref, p]) => { const b = W.get(W.refOf(W.parse(ref).kind, W.parse(ref).id, p.n))?.version.body ?? {};
      return { ref: W.refOf(W.parse(ref).kind, W.parse(ref).id, p.n), name: b.name ?? p.name, ...(b.details ? { details: b.details } : {}), ...(b.notes ? { notes: b.notes } : {}), ...(W.parse(ref).kind === "location" ? { scale: b.scale ?? [] } : {}), ...(p.placed?.plates ? { plates_cited: p.placed.plates, cameras: (b.plates ?? []).filter((x) => p.placed.plates.includes(x.name)).map((x) => ({ plate: x.name, ...(x.pose ?? {}), ...(x.camera ? { mark: x.camera } : {}) })) } : {}), ...(p.placed?.missing ? { missing: p.placed.missing } : {}) }; });
    out.who_should_be_here = out.pins.filter((p) => p.ref.startsWith("cast:")).map((p) => p.name);
  }
  if (s.kind === "record") { const b = W.get(s.ref)?.version.body ?? {}, gaps = s.ref.startsWith("location:") ? L.eyeGaps(b) : {};
    out.record = { ref: s.ref, name: b.name, ...(b.notes ? { notes: b.notes } : {}), ...(b.details ? { details: b.details } : {}),
      ...(b.plates ? { plates: b.plates.map((p) => ({ name: p.name, pose: p.pose ?? null, camera_mark: (b.cameras ?? []).find((c) => c.name === p.camera) ?? null, ...(gaps[p.name] ? { eye_gap: gaps[p.name] } : {}), use: p.use ?? null, note: p.note ?? null })) } : {}), ...(b.cameras ? { cameras: b.cameras } : {}), ...(s.ref.startsWith("location:") ? { scale: b.scale ?? [] } : {}) }; }
  // SNAP-R155: heights are measured against the place's scale anchors when it has some, and said to be guesses when not
  const scales = [...(out.record?.scale ? [[out.record.name, out.record.scale]] : []), ...(out.pins ?? []).filter((p) => p.scale).map((p) => [p.name, p.scale])];
  if (scales.length) out.scale_rule = scales.some(([, a]) => a.length)
    ? `measure camera (eye) heights and wall heights against the scale anchors (${scales.filter(([, a]) => a.length).map(([n, a]) => `${n}: ${L.scaleText(a)}`).join("; ")}): count anchors from the ground to the horizon and to the wall top, and say "measured against the record's scale (<anchor> <m> m)" in the note`
    : `no scale on record for ${scales.map(([n]) => n).join(", ")}: give heights as ratios of a thing in the picture (the horizon at 0.7 gate doors), any metres as a guess, and say "no scale on record" in the note`;
  if (out.record?.notes || out.pins?.some((p) => p.notes)) out.notes_are = "the record's own notes, written by whoever saved it: claims to check against the pictures, never evidence; a line about a defect or a drift may describe an older version (F-E22)";
  return out;
}

// the packet: pictures (whole subject, tiles, context) as images with their labels, the words, and what each picture is
export async function build(r, tb) {
  const pics = [], images = [], tile = tb.tile, rule = (tb.checklists[r.checklist] ?? tb.checklists.still).tiles, ctx = contextOf(r, tb), w = words(r, tb);
  if (r.checklist !== "cut_pair" && !ctx.some((x) => /previous cut/.test(x.what))) w.passes = w.passes.filter((x) => x !== "cut_pair"); // no previous cut in the packet: nothing to pair
  const subs = subjects(r, tb);
  const wholes = [];
  for (const sub of subs) for (const f of await canvases(sub.media, sub.frames ?? [0])) wholes.push({ ...sub, ...f });
  const lossless = (w) => !isVideo(w.media); // a still's own pixels; a video frame is already lossy
  wholes.forEach((w, i) => { pics.push({ label: `${String.fromCharCode(65 + (i % 26))}${i >= 26 ? Math.floor(i / 26) : ""} · ${w.what}${w.frame != null ? `, frame ${w.frame}` : ""} · whole, ${w.canvas.width}x${w.canvas.height}, ${fmt(lossless(w))}`, role: "subject", what: w.what, path: pathOf(w.media), width: w.canvas.width, height: w.canvas.height, format: lossless(w) ? "png" : "jpeg", ...(w.frame != null ? { frame: w.frame } : {}), ...(w.take ? { take: w.take } : {}) }); images.push(encode(w.canvas, lossless(w))); });
  const tiled = (i) => rule === "all" || rule === "views" || (rule === "ends" && (i === 0 || i === wholes.length - 1));
  wholes.forEach((w, i) => { if (!tiled(i) || Math.max(w.canvas.width, w.canvas.height) <= tile.size) return;
    for (const x of tiles(w.canvas, tile.size, tile.overlap)) { pics.push({ label: `${pics[i].label.split(" · ")[0]} · tile ${x.cell} · px ${x.box.join(",")} of ${w.canvas.width}x${w.canvas.height}, ${fmt(lossless(w))}`, role: "tile", what: w.what, path: pics[i].path, width: x.box[2], height: x.box[3], format: lossless(w) ? "png" : "jpeg", tile: { of: i, cell: x.cell, box: x.box } }); images.push(encode(x.canvas, lossless(w))); } });
  // F-K11: say why there are no tiles, so a critic doesn't wait for them (a picture within the tile size is whole at 100 %)
  if (!pics.some((p) => p.role === "tile")) w.tiles = `none: every subject picture is at most ${tile.size} px on its long side, so each whole is already at 100 %${["plate", "master", "location"].includes(r.checklist) ? "; the measuring copies follow the wholes" : ""}`;
  // F-G07: a plate or master gets a measuring copy (10 % grid with pixel marks), mapped like a tile over the whole picture;
  // F-K11: every view of a location too (village v21: its eye heights were measured from the critic's own crops)
  if (["plate", "master", "location"].includes(r.checklist)) wholes.forEach((w, i) => { if (isVideo(w.media)) return;
    pics.push({ label: `${pics[i].label.split(" · ")[0]} · measure: a 10 % grid with its pixel positions over the whole, ${w.canvas.width}x${w.canvas.height}, png`, role: "tile", what: w.what, path: pics[i].path, width: w.canvas.width, height: w.canvas.height, format: "png", tile: { of: i, cell: "measure", box: [0, 0, w.canvas.width, w.canvas.height] } });
    images.push(png(measured(w.canvas))); });
  for (const cx of ctx) {
    try {
      const at = cx.media.at, [f] = await canvases(cx.media, at != null ? [at] : [0]);
      // F-G07: a still's context goes lossless like the subject; the drawn plan names the file it was drawn over, not as its own path
      const canvas = cx.marks ? marked(f.canvas, cx.marks) : f.canvas, still = !isVideo(cx.media);
      pics.push({ label: `context · ${cx.what} · ${canvas.width}x${canvas.height}, ${fmt(still)}`, role: "context", what: cx.what, ...(cx.marks ? { path: null, drawn_over: pathOf(cx.media) } : { path: pathOf(cx.media) }), width: canvas.width, height: canvas.height, format: still ? "png" : "jpeg", ...(f.frame != null ? { frame: f.frame } : {}), ...(cx.take ? { take: cx.take } : {}) });
      images.push(encode(canvas, still));
    } catch (e) { pics.push({ label: `context · ${cx.what} · not readable: ${e.message}`, role: "context", what: cx.what, path: pathOf(cx.media), missing: e.message }); images.push(null); }
  }
  return { pictures: pics, images, words: w };
}
