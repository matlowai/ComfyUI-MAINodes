// What a picture is, and what is near it in the data model (U106; the operator, 2026-11-07, on the Room's first question:
// "is that image a frame from a video or is it a seed image for making a video? Things like this should be generally
// clearer through metadata, and there should be a way to get a modal to pop up to look at nearby things or other takes
// and related things nearby in the data model").
// what(): one plain line, and a second, from stored metadata only (never guessed): a still or a frame of a video (which
// take, which second), its kind (board: opening or key, New view, settei, plate, master, Cast picture …), the cut ›
// shot, Cast or location it belongs to, whether it is the cut's active / approved one, then the model and the pictures it
// was made from. nearby(): its neighbours, both ways and whole: the cut's boards and video takes, the other candidates
// and takes of its shot or decision, what it was made from and what was made from it, the Cast and location versions it
// cites, the story beat it is pinned to (stale or not) and its critiques; every neighbour carries its own ref and line.
// openNearby(): the modal over any page, one click from a picture; a tile re-centres it, Back walks back. It reads and
// never writes: no take is marked opened, nothing is applied, nothing navigates (SNAP-R5).
// SNAP-R197 what this is · SNAP-R198 the Nearby modal · SNAP-R199 nearby {ref}, whole · SNAP-R5 viewing changes nothing ·
// SNAP-R58 nothing cut, paged explicitly · SNAP-R70 in the Room no machinery (the Room passes its plain()) · SNAP-R174 a
// blind pair is never named · see docs/snap/SNAP_RULES.md
import * as T from "./takes.js";
import * as C from "./candidates.js";
import * as W from "./world.js";
import * as SC from "./scenes.js";
import * as CR from "./critiques.js";
import * as B from "./book.js";
import * as RT from "./retake.js";
import * as S from "./slots.js";
import * as M from "./models.js";
import * as PL from "./plates.js";
import { url } from "./checks.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; };
const FPS = 24, SEVERITY = { high: "Serious", medium: "Worth fixing", low: "Small" };
const TYPES = /^(input|output|temp)\//;
const FRAME = /^snap\/(take-.+?)_f(\d+)(?:_c[\d-]+)?\.\w+$/; // T.frameAt's file: snap/<take id>_f<frame>[_c<crop>].png
export const PARTS = ["cut", "shot", "candidates", "made_from", "made_into", "records", "critiques"];

export const load = () => Promise.all([T.load(), C.load(), W.load(), SC.load(), CR.load(), S.load()]);
const pathOf = (m) => [m.type ?? "output", m.subfolder, m.filename].filter(Boolean).join("/");
const mediaAt = (path) => { const [type, ...rest] = path.split("/"), filename = rest.pop(); return { type, subfolder: rest.join("/"), filename }; };
const kindOf = (f) => (/\.(mp4|webm|mov|mkv)$/i.test(f) ? "video" : /\.(wav|flac|mp3|ogg)$/i.test(f) ? "audio" : "image");
const isVideo = (t) => !!t?.media.some((m) => m.kind === "video");
const mainOf = (t) => t.media.find((m) => m.kind === "video") ?? t.media.find((m) => m.kind === "image") ?? t.media[0] ?? null;
const pinOf = (t) => t.story ?? t.graph?.extra?.snap?.story ?? null;
const seconds = (frame) => `${(frame / FPS).toFixed(2).replace(/\.?0+$/, "")} s`;
const nameOf = (ref) => { try { return W.get(ref)?.version.body.name ?? null; } catch { return null; } };
const listWords = (l) => (l.length > 1 ? `${l.slice(0, -1).join(", ")} and ${l.at(-1)}` : l[0] ?? "");

// ---- where pictures are kept ------------------------------------------------------------------------------------------
// every Book cut: a shot of a Book's scene with its unit (no story needed to find them)
const cuts = () => SC.all().filter((s) => s.book).flatMap((scene) => scene.shots.filter((shot) => shot.unit).map((shot) => ({ scene, shot, unit: shot.unit })));
const cutName = (c) => c.shot.name || c.unit.cut || SC.shotTitle(c.scene, c.shot);
const picturesOf = (kind, b) => (kind === "cast" ? (b.refs ?? []).map((p, i) => ({ ...p, part: `picture ${i + 1}` }))
  : [b.master && { ...b.master, part: "master" }, b.plan && { ...b.plan, part: "plan" }, b.map && { ...b.map, part: "camera map" }, ...(b.plates ?? []).map((p) => ({ ...p, part: `plate ${p.name}` }))].filter((p) => p?.file));
const holderName = (x) => (x.kind === "board" ? `the ${x.approved ? "approved " : ""}board of ${x.cut}` : x.kind === "key" ? `the key drawing of ${x.cut}`
  : x.kind === "cast" ? `${x.name}'s Cast picture ${x.part.split(" ")[1]}${x.role ? ` (${x.role})` : ""}`
  : x.part === "master" ? `the master picture of ${x.name}` : x.part === "plan" ? `the set plan of ${x.name}` : x.part === "camera map" ? `the camera map of ${x.name}` : `${x.part} of ${x.name}`);
// the records and cut slots that hold a picture (input/ path), each at the newest version that has it
function holders(file) {
  const out = [];
  for (const kind of ["cast", "location"]) for (const r of W.all(kind)) for (const v of [...r.versions].reverse()) {
    const hit = picturesOf(kind, v.body).find((p) => p.file === file);
    if (hit) { out.push({ kind, ref: W.refOf(kind, r.id, v.n), name: v.body.name, n: v.n, head: r.head, part: hit.part, role: hit.role ?? null, from: hit.from ?? null }); break; }
  }
  for (const c of cuts()) for (const slot of ["board", "key"]) if (c.unit[slot]?.file === file) out.push({ kind: slot, cut: cutName(c), scene: c.scene.id, shot: c.shot.id, book: c.scene.book, approved: slot === "board" ? !!c.unit.board.approved : null, from: c.unit[slot].from ?? null });
  return out;
}
// the take a kept picture came from: its `from`, else the frame file's own name
const sourceOf = (file, hold = holders(file)) => { const from = hold.find((x) => x.from?.take)?.from, m = FRAME.exec(file); return from ? { take: T.get(from.take), frame: from.frame ?? null } : m ? { take: T.get(m[1]), frame: +m[2] } : null; };
// the pictures records and cut slots keep from this take (a frame of it, or its still)
function keptFrom(t) {
  const files = new Set(), mine = (p) => p?.file && (FRAME.exec(p.file)?.[1] === t.id || p.from?.take === t.id);
  for (const r of [...W.all("cast"), ...W.all("location")]) for (const v of r.versions) for (const p of picturesOf(r.kind, v.body)) if (mine(p)) files.add(p.file);
  for (const c of cuts()) for (const s of ["board", "key"]) if (mine(c.unit[s])) files.add(c.unit[s].file);
  return [...files];
}

// ---- what made it ---------------------------------------------------------------------------------------------------
const methodTitle = (id) => { const [slot, m] = String(id ?? "").split("/"); return (m && S.list(slot).find((x) => x.id === m)?.title) || null; };
// the model a run loaded, from the prompt that ran: its diffusion model and LoRAs by file name, with the model graph's family
function modelOf(t, seen = new Set()) {
  const title = t.parent?.method && methodTitle(t.parent.method);
  if (title) return title.split(" · ").slice(-1)[0];
  const base = (v) => v.split("/").pop().replace(/\.safetensors$/, ""), models = [], loras = [];
  for (const n of Object.values(t.prompt ?? {})) for (const [k, v] of Object.entries(n.inputs ?? {})) {
    if (typeof v !== "string" || !v.endsWith(".safetensors")) continue;
    if (/lora/i.test(k)) loras.push(base(v)); else if (/^(unet_name|ckpt_name|model|model_name)$/.test(k)) models.push(v);
  }
  const parent = t.parent?.take && T.get(t.parent.take);
  if (!models.length) return parent && !seen.has(parent.id) ? modelOf(parent, seen.add(t.id)) : t.parent?.method ?? null; // a retake or a re-run runs its parent's recipe
  const family = M.entry(models[0])?.family;
  return `${models.map(base).join(" + ")}${loras.length ? ` with ${listWords(loras)}` : ""}${family ? ` (${family})` : ""}`;
}
// a picture by what holds it, else by its own name
const pictureName = (file, room) => { const x = holders(file)[0]; if (x) return holderName(x); const src = sourceOf(file); return src?.take ? `a frame of take ${src.take.number}` : room ? "a picture" : file.split("/").pop(); };
// the sounds a run loaded (<Audio n>: a Cast's voice reference, music), and whose voice a file is
const soundsOf = (t) => Object.values(t.prompt ?? {}).filter((n) => /^LoadAudio/.test(n.class_type) && typeof n.inputs?.audio === "string").map((n) => n.inputs.audio);
const voiceName = (f) => { const r = W.all("cast").find((x) => W.headOf(x).body.voice?.file === f); return r ? `${W.headOf(r).body.name}'s voice` : null; };
// what it was made from, numbered as the model got them (Picture n / Audio n)
function madeFrom(t, room) {
  const ctx = t.parent?.options?.context;
  if (ctx?.length) return ctx.map((c) => `Picture ${c.n} ${c.label ?? (c.file ? pictureName(c.file, room) : c.take ? `take ${T.get(c.take)?.number ?? "?"}` : "")}`.trim());
  const refs = PL.referencePictures(t.prompt), out = refs.map((f, i) => `Picture ${i + 1} ${pictureName(f, room)}`);
  const first = Object.values(t.prompt ?? {}).filter((n) => n.class_type === "LoadImage" && !refs.includes(n.inputs?.image)).map((n) => n.inputs.image);
  if (first.length) out.unshift(`opening on ${listWords(first.map((f) => pictureName(f, room)))}`);
  out.push(...soundsOf(t).map((f, i) => `Audio ${i + 1} ${voiceName(f) ?? (room ? "a sound" : f.split("/").pop())}`));
  const p = t.parent?.take && T.get(t.parent.take);
  if (p && !out.length) out.push(`take ${p.number}`);
  return out;
}
function madeLine(t, room) {
  const from = madeFrom(t, room), by = room ? null : modelOf(t);
  return `${by ? `Made by ${by}` : "Made"} ${from.length ? `from ${listWords(from)}` : "from words only"}.`;
}

// ---- the line ---------------------------------------------------------------------------------------------------------
// the cut or shot a take belongs to: its story pin's cut, else the shot it landed in
function homeOf(t) {
  const pin = pinOf(t), shot = RT.shotOf(t), all = cuts();
  const cut = (pin?.unit?.shot && all.find((c) => c.shot.id === pin.unit.shot)) || (shot && all.find((c) => c.shot.id === shot.shot.id)) || null;
  return { pin, shot, cut };
}
const decisionOf = (t) => { for (const d of C.all()) { const c = d.candidates.find((x) => x.take === t.id || `take-${x.prompt_id}` === t.id); if (c) return { d, c }; } return null; };
// a still take's kind in words
// the cut slot a board candidate fills now: its own cut's board or key holding a picture kept from it
const inSlot = (t, home) => { if (!["board", "key"].includes(home.pin?.role)) return null; const slot = home.pin.role, b = home.cut?.unit[slot]; return b && (b.from?.take === t.id || FRAME.exec(b.file ?? "")?.[1] === t.id) ? b : null; };
function kindWords(t, home, room) {
  const pin = home.pin, p = t.parent, of = (id) => `take ${T.get(id)?.number ?? "?"}`, cut = home.cut ? cutName(home.cut) : null, held = inSlot(t, home);
  if (pin?.role === "key") return held ? `the key drawing of ${cut}, the picture its video builds to` : `a key drawing candidate${cut ? ` for ${cut}` : ""}, a picture a video would build to`;
  if (pin?.role === "board") return held ? `the board of ${cut}${held.approved ? ", approved" : ", not approved yet"}, the frame its video opens on` : `a board candidate${cut ? ` for ${cut}` : ""}, a frame a video would open on`;
  if (pin?.role === "settei") return `a settei of ${nameOf(pin.cast) ?? "a Cast"}${pin.state ? ` (${[pin.state, pin.view && `${pin.view} view`].filter(Boolean).join(", ")})` : ""}`;
  if (!p?.method) return "a still render";
  if (p.method.startsWith("view/")) return p.options?.pasted ? `a region edit${p.options?.context?.[0] ? ` of ${p.options.context[0].label ?? "Picture 1"}` : ""}` : "a New view";
  if (p.method.startsWith("sheet/")) return "a character sheet";
  if (p.method.startsWith("upscale/")) return `a bigger version of ${of(p.take)}`;
  if (p.method === "continue") return `continued from ${of(p.take)} at frame ${p.frame}`;
  if (p.method === "retake") return `a retake of ${of(p.take)}`;
  if (p.method.startsWith("rerun/")) return `a re-run of ${of(p.take)}`;
  if (p.method === "eyecolour") return `${of(p.take)} with its eye colour kept`;
  return `a changed version of ${of(p.take)}${!room && p.options?.label ? ` (${p.options.label})` : ""}`;
}
// where it stands: the cut's active take, its board (approved or not), a pick, a verdict, a record's picture
function standing(t, home) {
  const out = [], kept = keptFrom(t), cand = decisionOf(t);
  if (home.shot?.shot.active === t.id) out.push(home.cut ? `It is the active take of ${cutName(home.cut)}.` : "It is the shot's active take.");
  const own = inSlot(t, home); // said in its kind already
  for (const f of kept) for (const x of holders(f)) {
    if (own && f === own.file && (x.kind === "key" || x.kind === "board") && x.shot === home.cut.shot.id) continue;
    const frame = x.from?.frame ?? (FRAME.exec(f) ? +FRAME.exec(f)[2] : null);
    out.push(`${isVideo(t) && frame != null ? `Its frame ${frame} (${seconds(frame)}) is` : "It is"} ${holderName(x)}${x.kind === "cast" || x.kind === "location" ? `, version ${x.n}${x.n !== x.head ? ` (the newest is ${x.head})` : ""}` : ""}${x.kind === "board" && !x.approved ? ", not approved yet" : ""}.`);
  }
  if (cand && !out.length) out.push({ applied: "It was picked.", rejected: "It was turned down.", ready: "Not picked yet.", rendering: "Still being made.", failed: "It failed." }[cand.c.state] ?? "");
  if (t.verdict) out.push({ keep: "Kept.", reject: "Set aside.", neither: "Neither: the same problem as the others." }[t.verdict]);
  return out.filter(Boolean);
}
// the line for any subject; `room` leaves the model out (the Room's leak test bans model names; it passes its plain())
export function what(ref, { room = false } = {}) {
  const s = typeof ref === "object" && ref?.kind ? ref : subjectOf(ref);
  if (s.kind === "record") {
    const b = s.version.body, kind = s.record.kind, pics = picturesOf(kind, b).length;
    const head = s.version.n === s.record.head ? "the newest" : `the newest is ${s.record.head}`;
    return { form: "record", line: `${{ cast: "A Cast record", location: "A location", book: "A Book", story: "A story", look: "A production style" }[kind] ?? `A ${kind} record`}: ${b.name ?? b.title ?? s.record.id}, version ${s.version.n} (${head}).`, more: pics ? `${pics} picture${pics === 1 ? "" : "s"}.` : null };
  }
  if (s.kind === "picture") {
    const hold = holders(s.file), src = sourceOf(s.file, hold), held = hold.map((x) => `${holderName(x)}${x.kind === "cast" || x.kind === "location" ? `, version ${x.n}` : ""}`);
    const is = held.length ? ` It is ${listWords(held)}.` : "";
    if (src?.take && isVideo(src.take)) return { form: "frame", take: src.take.id, frame: src.frame, line: `A frame of a video: take ${src.take.number}${src.frame != null ? ` at ${seconds(src.frame)} (frame ${src.frame})` : ""}.${is}`, more: madeLine(src.take, room) };
    if (src?.take) { const home = homeOf(src.take), own = inSlot(src.take, home), rest = own ? hold.filter((x) => !(["board", "key"].includes(x.kind) && x.shot === home.cut.shot.id)) : hold; // its kind says its own slot
      return { form: "still", take: src.take.id, line: `A still, not a frame of a video: take ${src.take.number}, ${kindWords(src.take, home, room)}.${rest.length ? ` It is ${listWords(rest.map((x) => `${holderName(x)}${x.kind === "cast" || x.kind === "location" ? `, version ${x.n}` : ""}`))}.` : ""}`, more: madeLine(src.take, room) }; }
    if (src) return { form: "frame", frame: src.frame, line: `A frame of a take that isn't on this install${src.frame != null ? ` (frame ${src.frame})` : ""}.${is}`, more: null };
    return { form: "picture", line: `A picture brought in, not made here${room ? "" : ` (${s.path})`}.${is}`, more: null };
  }
  const t = s.take, home = homeOf(t), shot = home.shot ? ` in ${home.shot.scene.name} › ${SC.shotTitle(home.shot.scene, home.shot.shot)}` : "";
  const stand = standing(t, home), tail = stand.length ? ` ${stand.join(" ")}` : "";
  if (isVideo(t)) return { form: "video", take: t.id, line: `A video: take ${t.number}${home.cut ? ` of ${cutName(home.cut)}` : shot}.${tail}`, more: madeLine(t, room) };
  const where = !home.cut ? shot : ["board", "key"].includes(home.pin?.role) ? "" : ` in ${cutName(home.cut)}`; // a board's words name its cut
  return { form: "still", take: t.id, line: `A still, not a frame of a video: take ${t.number}, ${kindWords(t, home, room)}${where}.${tail}`, more: madeLine(t, room) };
}

// ---- the subject a ref names ----------------------------------------------------------------------------------------
// a take (its id or a unique start), a record (kind:id[@n]), or a picture's path (input/…, output/…, a bare input/ path,
// or a /view URL as the viewer has it)
export function subjectOf(ref) {
  if (ref && typeof ref === "object") return ref.media ? { kind: "take", take: ref } : ref;
  const r = String(ref ?? "").trim();
  if (!r) throw new Error("nearby takes ref: a take (its id or the start of it), a record (cast:…, location:…, book:…, @n for a version) or a picture's path (input/… or output/…)");
  if (/[?&]filename=/.test(r)) { const q = new URLSearchParams(r.slice(r.indexOf("?") + 1)); return picture([q.get("type") || "output", q.get("subfolder"), q.get("filename")].filter(Boolean).join("/")); }
  if (/^[a-z_]+:[^/]/.test(r)) {
    const got = W.get(r);
    if (!got) throw new Error(`No record ${r} on this install (list_cast, list_locations and list_books name them)`);
    return { kind: "record", ref: W.refOf(got.record.kind, got.record.id, got.version.n), record: got.record, version: got.version };
  }
  if (r.includes("/") || /\.(png|jpe?g|webp|gif|mp4|webm|mov|wav|flac|mp3)$/i.test(r)) return picture(r);
  const t = T.find(r);
  if (!t) throw new Error(`No take ${r}: give a take id (or its start), a record ref or a picture's path (find_take finds takes by file or seed)`);
  return { kind: "take", take: t };
}
function picture(p) {
  const typed = TYPES.test(p), path = typed ? p : `input/${p}`;
  const t = T.all().find((x) => x.media.some((m) => pathOf(m) === path || (!typed && pathOf(m).replace(TYPES, "") === p)));
  return t ? { kind: "take", take: t } : { kind: "picture", path, file: path.replace(TYPES, "") };
}

// ---- the neighbours -------------------------------------------------------------------------------------------------
// a neighbour: its ref (pass it back to walk on), its media, a short name and its own line
function tile(ref, name, marks = [], { room = false } = {}) {
  const s = subjectOf(ref), w = what(s, { room });
  if (s.kind === "take") { const m = mainOf(s.take); return { ref: s.take.id, kind: m?.kind ?? "image", path: m ? pathOf(m) : null, name: name ?? `take ${s.take.number}`, marks, what: w.line }; }
  if (s.kind === "record") { const p = picturesOf(s.record.kind, s.version.body)[0]; return { ref: s.ref, kind: "image", path: p ? `input/${p.file}` : null, name, marks, what: w.line }; }
  return { ref: s.path, kind: kindOf(s.path), path: s.path, name: name ?? pictureName(s.file, room), marks, what: w.line };
}
const takeMarks = (t, shot) => [shot?.active === t.id ? "active" : null, t.verdict === "keep" ? "kept" : t.verdict === "reject" ? "set aside" : null].filter(Boolean);
// the cut a subject belongs to: its boards and video takes
function cutPart(c, room) {
  const boards = ["board", "key"].filter((s) => c.unit[s]?.file).map((s) => tile(`input/${c.unit[s].file}`, s === "key" ? `key drawing of ${cutName(c)}` : `board of ${cutName(c)}`, [s === "board" && c.unit.board.approved ? "approved" : null].filter(Boolean), { room }));
  const takes = SC.takesOf(c.shot).map((e) => T.get(e.take)).filter((t) => t && isVideo(t)).map((t) => tile(t.id, `take ${t.number}`, takeMarks(t, c.shot), { room }));
  const beats = c.unit.beats ?? [];
  return { name: cutName(c), cut: c.unit.cut ?? null, book: c.scene.book, scene: c.scene.id, shot: c.shot.id, beats, boards, takes };
}
// a record version's pictures as tiles
const recordPart = (ref, room, extra = {}) => { const got = W.get(ref), b = got.version.body, kind = got.record.kind;
  return { ref: W.refOf(kind, got.record.id, got.version.n), kind, name: b.name ?? got.record.id, n: got.version.n, head: got.record.head, moved: got.version.n !== got.record.head, ...extra,
    pictures: picturesOf(kind, b).map((p) => tile(`input/${p.file}`, `${b.name}, ${p.part}${p.role ? ` (${p.role})` : ""}`, [], { room })) }; };
const critiquePart = (rows) => rows.map((r) => ({ critique: r.id, state: CR.stateOf(r), verdict: r.verdict ?? null, title: CR.subjectText(r.subject),
  notes: [...(r.notes ?? [])].sort((a, b) => ({ high: 0, medium: 1, low: 2 }[a.severity] ?? 3) - ({ high: 0, medium: 1, low: 2 }[b.severity] ?? 3)).map((n) => ({ severity: n.severity ?? null, severity_words: SEVERITY[n.severity] ?? "A note", text: n.text ?? n.words ?? "", ...(n.owner ? { owner: n.owner } : {}), ...(n.fix ? { fix: n.fix } : {}), ...(n.region ? { region: n.region } : {}) })) }));
// what was made from a take or a picture: takes whose parent, sources or context name it, and the record pictures kept from it
function madeInto(id, file, room) {
  const t = id && T.get(id), kept = t ? keptFrom(t) : [], files = new Set([file, ...kept].filter(Boolean));
  const cites = (f) => !!f && (files.has(f) || (!!id && FRAME.exec(f)?.[1] === id)), loads = (x) => Object.values(x.prompt ?? {}).some((n) => n.class_type === "LoadImage" && cites(n.inputs?.image));
  const of = (x) => (!!id && (x.parent?.take === id || !!x.made_from?.includes(id))) || (x.parent?.options?.context ?? []).some((c) => (!!id && c.take === id) || cites(c.file)) || loads(x);
  return [...kept.map((f) => tile(`input/${f}`, null, [], { room })), ...T.all().filter((x) => x.id !== id && of(x)).map((x) => tile(x.id, `take ${x.number}`, [], { room }))];
}

export async function nearby(ref, { room = false } = {}) {
  const s = subjectOf(ref), out = { ref: typeof ref === "string" ? ref : s.take?.id ?? s.ref ?? s.path, subject: null, what: what(s, { room }), cut: null, shot: null, candidates: null, made_from: [], made_into: [], records: [], beat: null, critiques: [] };
  if (s.kind === "record") {
    const kind = s.record.kind, pinning = T.all().filter((t) => Object.keys(t.world ?? {}).some((k) => { const p = W.parse(k); return p.kind === kind && p.id === s.record.id; }));
    out.subject = { kind: "record", ref: s.ref, name: s.version.body.name ?? s.record.id, n: s.version.n, head: s.record.head, versions: s.record.versions.map((v) => ({ n: v.n, by: v.by ?? null, note: v.note ?? "", at: v.at ? new Date(v.at).toISOString() : null })) };
    out.records = [recordPart(s.ref, room)];
    out.made_into = pinning.map((t) => tile(t.id, `take ${t.number}`, [`pins version ${t.world[Object.keys(t.world).find((k) => W.parse(k).id === s.record.id)]?.n ?? "?"}`], { room }));
    out.critiques = critiquePart(CR.ofRecord(s.ref));
  } else if (s.kind === "picture") {
    const hold = holders(s.file), src = sourceOf(s.file, hold);
    out.subject = { kind: "picture", path: s.path, media: { path: s.path, kind: kindOf(s.path) } };
    if (src?.take) out.made_from = [tile(src.take.id, `take ${src.take.number}${src.frame != null && isVideo(src.take) ? `, frame ${src.frame}` : ""}`, [], { room })];
    out.made_into = madeInto(null, s.file, room);
    out.records = hold.filter((x) => x.kind === "cast" || x.kind === "location").map((x) => recordPart(x.ref, room, { part: x.part }));
    const slot = hold.find((x) => x.kind === "board" || x.kind === "key"), c = slot && cuts().find((x) => x.shot.id === slot.shot);
    if (c) out.cut = cutPart(c, room);
    out.critiques = critiquePart(hold.filter((x) => x.ref).flatMap((x) => CR.ofRecord(x.ref).filter((r) => !r.subject.part || r.subject.part === x.part || r.subject.part === "views")));
  } else {
    const t = s.take, home = homeOf(t), d = decisionOf(t), pin = home.pin;
    out.subject = { kind: "take", take: t.id, number: t.number, media: t.media.map((m) => ({ path: pathOf(m), kind: m.kind })) };
    if (home.cut) out.cut = cutPart(home.cut, room);
    const shot = home.cut ?? (home.shot && { scene: home.shot.scene, shot: home.shot.shot }), listed = new Set([t.id, ...(out.cut?.takes ?? []).map((x) => x.ref)]);
    if (shot) out.shot = { scene: shot.scene.id, shot: shot.shot.id, name: `${shot.scene.name} › ${SC.shotTitle(shot.scene, shot.shot)}`, takes: SC.takesOf(shot.shot).map((e) => T.get(e.take)).filter((x) => x && !listed.has(x.id)).map((x) => tile(x.id, `take ${x.number}`, takeMarks(x, { shot }), { room })) };
    if (d) out.candidates = { decision: d.d.id, title: d.d.title, ...(d.d.question ? { question: d.d.question } : {}), tiles: d.d.candidates.filter((c) => c.take !== t.id && `take-${c.prompt_id}` !== t.id).map((c) => {
      const ct = T.get(c.take ?? `take-${c.prompt_id}`), marks = [{ applied: "picked", rejected: "turned down", ready: "not picked yet", rendering: "being made", failed: "failed" }[c.state]].filter(Boolean);
      return ct ? tile(ct.id, `take ${ct.number}${c.seed != null ? ` (seed ${c.seed})` : ""}`, marks, { room }) : { ref: null, kind: "image", path: c.pictures?.[0]?.media ? pathOf(c.pictures[0].media) : null, name: c.label ?? c.id, marks, what: `A candidate ${c.state === "rendering" ? "still being made" : "with no take"}.` }; }) };
    const parent = t.parent?.take && T.get(t.parent.take), ctx = t.parent?.options?.context ?? [];
    out.made_from = [
      ...(parent ? [tile(parent.id, `take ${parent.number} (${t.parent.method})`, [], { room })] : []),
      ...ctx.map((c) => (c.take && T.get(c.take) ? tile(c.take, `Picture ${c.n} ${c.label ?? ""}`.trim(), c.crop ? ["cropped"] : [], { room }) : c.file ? tile(`input/${c.file}`, `Picture ${c.n} ${c.label ?? ""}`.trim(), c.crop ? ["cropped"] : [], { room }) : null)).filter(Boolean),
      ...(ctx.length ? [] : PL.referencePictures(t.prompt).map((f, i) => tile(`input/${f}`, `Picture ${i + 1} ${pictureName(f, room)}`, [], { room }))),
      ...(t.made_from ?? []).filter((id) => id !== parent?.id && !ctx.some((c) => c.take === id) && T.get(id)).map((id) => tile(id, `take ${T.get(id).number}`, [], { room })),
      ...soundsOf(t).map((f, i) => ({ ref: null, kind: "audio", path: `input/${f}`, name: `Audio ${i + 1} ${voiceName(f) ?? (room ? "a sound" : f.split("/").pop())}`, marks: [], what: "A sound it was made with." })),
    ];
    out.made_into = madeInto(t.id, null, room);
    const refs = new Map(Object.entries(t.world ?? {}).map(([k, p]) => [W.parse(k).kind === "card" ? null : W.refOf(W.parse(k).kind, W.parse(k).id, p.n), p]));
    for (const r of [pin?.cast, ...(home.cut?.unit.cast ?? []), home.cut?.unit.location].filter(Boolean)) { const p = W.parse(r); if (![...refs.keys()].some((k) => k && W.parse(k).id === p.id)) refs.set(W.refOf(p.kind, p.id, p.n ?? W.record(p.kind, p.id)?.head), { cut: true }); }
    out.records = [...refs].filter(([k]) => k && W.get(k)).map(([k, p]) => recordPart(k, room, p.cut ? { through: "the cut" } : {}));
    const beats = pin?.beat ? [pin.beat] : pin?.beats ?? home.cut?.unit.beats ?? [];
    if (beats.length && (pin?.book ?? home.cut?.scene.book)) {
      const book = pin?.book ?? home.cut.scene.book;
      let story = null;
      try { story = B.storyOf(B.bookOf(book).body); } catch (e) { story = { error: e.message }; } // a Book whose story isn't on this install (F-Q12)
      const st = pin?.unit && pin.from ? await B.storyStale(t) : null;
      out.beat = { book, ...(story?.error ? { error: story.error } : { story: story.ref }), beats: beats.map((id) => ({ id, text: story?.body?.beats.find((b) => b.id === id)?.text ?? null })), pinned: !!pin?.from, stale: !!st, ...(st ? { reasons: st.reasons } : {}) };
    }
    out.critiques = critiquePart(CR.ofTake(t.id));
  }
  out.counts = Object.fromEntries(PARTS.map((p) => [p, p === "cut" ? (out.cut ? out.cut.boards.length + out.cut.takes.length : 0) : p === "shot" ? out.shot?.takes.length ?? 0 : p === "candidates" ? out.candidates?.tiles.length ?? 0 : out[p].length]));
  return out;
}
// one list, paged explicitly with its total (SNAP-R58: the whole answer is the default; this is the agent's choice)
export function page(all, { part, offset = 0, limit } = {}) {
  if (!part) return all;
  if (!PARTS.includes(part)) throw new Error(`part is one of ${PARTS.join(", ")}; not "${part}"`);
  const list = part === "cut" ? [...(all.cut?.boards ?? []), ...(all.cut?.takes ?? [])] : part === "shot" ? all.shot?.takes ?? [] : part === "candidates" ? all.candidates?.tiles ?? [] : all[part];
  const end = limit ? offset + limit : list.length;
  return { ref: all.ref, what: all.what, part, total: list.length, offset, items: list.slice(offset, end), ...(end < list.length ? { next: { part, offset: end, limit } } : {}) };
}

// ---- on the page ------------------------------------------------------------------------------------------------------
// the line and the second beside a picture (either can be left out), with the press that opens the modal on it; filled
// once the stores are read, so any surface can put it under a picture as it draws
export function whatEl(ref, { room = false, words = (x) => x, say, line: one = true, more = true, button = true, key = "" } = {}) {
  const line = h("p", { className: "snap-what" }), second = h("p", { className: "snap-what more", hidden: true });
  const btn = button ? h("button", { className: "snap-near-open", textContent: `Nearby${key ? ` (${key})` : ""}`, title: "what is near it in the data model: its cut, the other takes, what it was made from and what was made from it (changes nothing)",
    onclick: (e) => { e.stopPropagation(); openNearby(ref, { room, words, say }); } }) : null;
  const el = h("div", { className: "snap-what-row" }, h("div", { className: "snap-what-text" }, one ? line : null, more ? second : null), btn);
  load().then(() => { const w = what(ref, { room }); line.textContent = words(w.line); second.textContent = w.more ? words(w.more) : ""; second.hidden = !w.more; }).catch(() => { el.hidden = true; }); // nothing to say yet (a candidate whose take hasn't landed): the row stays out
  return el;
}

// ---- the modal --------------------------------------------------------------------------------------------------------
let shown = null;
export const showing = () => shown && { ref: shown.at.ref, what: shown.at.what?.line ?? null, back: shown.trail.length };
export function close() { if (!shown) return; removeEventListener("keydown", shown.keys, true); shown.root.remove(); shown = null; }
const mediaEl = (x, big) => {
  if (!x.path) return h("div", { className: "snap-near-none", textContent: "no picture" });
  const src = url(mediaAt(x.path));
  if (x.kind === "video") return h("video", { src, controls: true, playsInline: true, preload: "metadata", className: big ? "snap-near-big" : "" }); // with sound: the person judges takes with it on
  if (x.kind === "audio") return h("audio", { src, controls: true, preload: "none" });
  return h("img", { src, alt: x.name ?? "", loading: "lazy", className: big ? "snap-near-big" : "" });
};
// `words` turns every text the modal shows into the page's words (the Room passes its plain()); `room` leaves models out
export function openNearby(ref, { room = false, words = (x) => x, say } = {}) {
  close();
  const body = h("div", { className: "snap-near-body" }), head = h("div", { className: "snap-near-what" }), back = h("button", { className: "snap-near-btn", textContent: "← Back", hidden: true, onclick: () => go(shown.trail.pop(), false) });
  const root = h("div", { className: "snap-near", role: "dialog", ariaModal: "true", ariaLabel: "Nearby", tabIndex: -1 },
    h("div", { className: "snap-near-bar" }, back, h("strong", { textContent: "Nearby" }), h("span", { className: "snap-near-spacer" }), h("button", { className: "snap-near-btn", textContent: "✕", title: "close (Esc)", onclick: close })),
    head, body);
  // SNAP-R5: no key reaches what is under the modal (the take viewer's p / x / n would judge its take)
  const keys = (e) => { e.stopImmediatePropagation(); if (e.key === "Escape") { e.preventDefault(); close(); } else if (e.key === "Backspace" && shown.trail.length) { e.preventDefault(); go(shown.trail.pop(), false); } };
  shown = { root, keys, trail: [], at: { ref } };
  const tileEl = (x) => { const open = x.ref ? () => go(x.ref) : null;
    const m = mediaEl(x); if (open && m.tagName === "IMG") m.addEventListener("click", open);
    return h("figure", { className: `snap-near-tile${x.marks.length ? ` ${x.marks.join(" ").replace(/\s+/g, "-")}` : ""}` }, m,
      h("figcaption", {}, open ? h("button", { className: "snap-near-name", textContent: words(x.name ?? ""), title: "look around this one", onclick: open }) : h("b", { textContent: words(x.name ?? "") }),
        x.marks.map((k) => h("span", { className: "snap-near-mark", textContent: words(k) })), h("p", { className: "snap-near-line", textContent: words(x.what ?? "") }))); };
  const section = (title, list, extra = null) => (list?.length || extra ? h("section", { className: "snap-near-part" }, h("h3", { textContent: title }), extra, list?.length ? h("div", { className: "snap-near-grid" }, list.map(tileEl)) : null) : null);
  async function go(next, push = true) {
    if (push && shown.at.data) shown.trail.push(shown.at.ref);
    back.hidden = !shown.trail.length;
    body.replaceChildren(h("p", { className: "snap-near-line", textContent: "Reading…" }));
    try {
      await load();
      const d = await nearby(next, { room });
      shown.at = { ref: next, data: d, what: d.what };
      const centre = d.subject.kind === "take" ? { kind: d.subject.media.find((m) => m.kind === "video")?.kind ?? "image", path: (d.subject.media.find((m) => m.kind === "video") ?? d.subject.media.find((m) => m.kind === "image") ?? d.subject.media[0])?.path, name: `take ${d.subject.number}` }
        : d.subject.kind === "picture" ? { ...d.subject.media, name: "" } : { kind: "image", path: d.records[0]?.pictures[0]?.path ?? null, name: d.subject.name };
      head.replaceChildren(h("p", { className: "snap-near-line1", textContent: words(d.what.line) }), d.what.more ? h("p", { className: "snap-near-line", textContent: words(d.what.more) }) : null);
      const crit = d.critiques.length ? h("ol", { className: "snap-near-notes" }, d.critiques.flatMap((r) => (r.notes.length ? r.notes : [{ severity_words: r.state === "done" ? "Clean" : "Waiting for a critic", text: r.state === "done" ? "The critic found nothing wrong." : "" }]).map((n) => h("li", { className: n.severity ?? "" }, h("strong", { textContent: `${words(n.severity_words)}: ` }), words(n.text ?? ""), n.fix ? h("span", { className: "snap-near-line", textContent: ` What would fix it: ${words(n.fix)}` }) : null)))) : null;
      const beat = d.beat ? h("div", { className: "snap-near-beat" }, d.beat.beats.map((b) => h("p", {}, h("strong", { textContent: words(b.id === d.beat.beats[0]?.id ? "The story beat: " : "and: ") }), words(b.text ?? "(not in the story now)"))),
        h("p", { className: "snap-near-line", textContent: words(d.beat.error ? `The story isn't here: ${d.beat.error}` : d.beat.stale ? `Made from an older story: ${d.beat.reasons.join("; ")}.` : d.beat.pinned ? "Made from the story as it stands." : "") })) : null;
      body.replaceChildren(...[
        h("div", { className: "snap-near-centre" }, mediaEl(centre, true), centre.path ? h("a", { className: "snap-near-btn", href: url(mediaAt(centre.path)), target: "_blank", rel: "noopener", textContent: "Open in a new tab ↗" }) : null),
        h("div", { className: "snap-near-parts" }, ...[
          d.cut ? section(words(`The cut: ${d.cut.name}`), [...d.cut.boards, ...d.cut.takes]) : null,
          d.candidates ? section(words("The other candidates of the same pick"), d.candidates.tiles) : null,
          d.shot?.takes.length ? section(words(`More takes of ${d.shot.name}`), d.shot.takes) : null,
          section(words("Made from"), d.made_from), section(words("Made from it"), d.made_into),
          d.records.length ? section(words("What it cites"), d.records.flatMap((r) => r.pictures.length ? r.pictures : [{ ref: r.ref, kind: "image", path: null, name: r.name, marks: [], what: "" }]),
            h("p", { className: "snap-near-line", textContent: words(d.records.map((r) => `${r.name}, version ${r.n}${r.moved ? ` (the newest is ${r.head})` : ""}`).join(" · ")) })) : null,
          beat ? h("section", { className: "snap-near-part" }, h("h3", { textContent: words("The story") }), beat) : null,
          crit ? h("section", { className: "snap-near-part" }, h("h3", { textContent: words("What the critic said") }), crit) : null,
        ].filter(Boolean)),
      ].filter(Boolean));
      root.scrollTop = 0;
    } catch (e) { body.replaceChildren(h("p", { className: "snap-near-line", textContent: words(e.message) })); say?.(e.message, true); }
  }
  addEventListener("keydown", keys, true); // before the take viewer's and the lightbox's own keys
  document.body.append(root);
  root.focus({ preventScroll: true });
  return go(ref, false).then(() => showing());
}
