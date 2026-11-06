// The Book (U97, CONCEPT_PRODUCTION §11): Snap's production layer, layer 3 in the same app. Three record kinds in the
// world store (world.js), versioned like a Cast: `book` (the production root: its story, its production style, the
// autonomy dial, its Cast, locations and scenes in telling order), `story` (one record per Book: the beats on the spine,
// each with its changes, plants and payoffs, and groups over beat ids) and `look` (the production style: the style
// paragraph first in every prompt, a palette the compile lints Cast colour words against, one reference still, an
// optional LoRA, the house voice direction, the sound palette and the genre playbook).
// Units are a scene's shots (scenes.js): each shot of a Book scene carries `unit` (its cut number, beats, Cast, place and
// plate, timing, board, trim, transition). Two clocks: records version on the production clock (cast:kon@5); a beat is
// a moment on the story clock, and an entity's state at a beat is its base folded with every change on a beat at or
// before it in story order (`order`, never `told`). A unit compiles from the state at its beat with provenance (which
// beat and change set each field); a render never writes state, and a take that pins a story version reads stale only
// when a field its unit used moved. Story, style and the dial are canon: an agent's write to them is always a proposal,
// at every dial position; everything else obeys the dial per stage.
// SNAP-R67 the Book and the story clock · SNAP-R68 compile with provenance; a render never writes state · SNAP-R69 a
// state is held by its pictures · SNAP-R130 the production style record · SNAP-R131 boards and the animatic · SNAP-R132
// the Cut · SNAP-R60 versions · SNAP-R11 nothing blocks · see docs/snap/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as W from "./world.js";
import * as SC from "./scenes.js";
import * as T from "./takes.js";
import * as L from "./library.js";
import * as E from "./engine.js";
import * as K from "./checks.js";
import * as P from "./proposals.js";

export const MEDIA = ["anime", "film", "manga", "novel"];
export const DIAL = ["assist", "collaborate", "automatic"];
// the lenses that are stages of the dial (CONCEPT_PRODUCTION §11.1), with the first anime's mix as the default (DECISIONS
// 2026-11-05 09:15: Beat sheet + Pages assist; Settei collaborate; Boards / Cut bag / Dailies collaborate; the Cut assist)
export const STAGES = { beat_sheet: "Beat sheet", pages: "Pages", settei: "Settei", boards: "Boards", cut_bag: "Cut bag", dailies: "Dailies", the_cut: "the Cut" };
export const FIRST_MIX = { default: "collaborate", stages: { beat_sheet: "assist", pages: "assist", settei: "collaborate", boards: "collaborate", cut_bag: "collaborate", dailies: "collaborate", the_cut: "assist" } };
export const OPS = ["set", "add", "remove", "note"];
export const SOURCES = ["canon", "adapted", "invented"];
export const PALETTES = ["monochrome", "limited", "full"];
// which stage a tool's work belongs to, for the dial (the person's "Let agents run" stays the default outside a Book)
const STAGE_OF = { make_set_plates: "settei", make_character_sheet: "settei", save_cast_state: "settei", upscale_take: "settei", make_board: "boards", set_board: "boards",
  run: "cut_bag", retake: "cut_bag", rerun: "cut_bag", rerun_batch: "cut_bag", edit_take: "cut_bag", extend_take: "cut_bag", apply_candidate: "dailies", reject_candidate: "dailies", judge_takes: "dailies", export_cut: "the_cut", animatic: "boards" };

const stamp = (kind) => `${kind}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const clone = (x) => structuredClone(x);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const words = (id) => id.replace(/^[a-z]+:/, "").replace(/[-_]+/g, " ");

// ---- records ------------------------------------------------------------------------------------------------------
export const books = () => W.all("book").map((r) => ({ id: r.id, ref: `book:${r.id}`, head: r.head, body: W.headOf(r).body }));
export function bookOf(ref) {
  const { kind, id, n } = W.parse(String(ref).includes(":") ? ref : `book:${ref}`);
  if (kind !== "book") throw new Error(`${ref} isn't a Book reference (book:<id>; list_books lists them)`);
  const got = W.get(W.refOf("book", id, n));
  if (!got) throw new Error(`No Book ${ref}; the Books: ${books().map((b) => `book:${b.id} (${b.body.name})`).join(", ") || "none yet (create_book makes one)"}`);
  return { id, n: got.version.n, body: got.version.body, ref: W.refOf("book", id, got.version.n) };
}
// the story a Book holds, at a version (the head unless n), as {id, n, body, ref}
export function storyOf(book, n = null) {
  const b = typeof book === "string" ? bookOf(book).body : book;
  if (!b.story) throw new Error(`${b.name} has no story yet`);
  const { id } = W.parse(b.story), got = W.get(W.refOf("story", id, n));
  if (!got) throw new Error(`${b.name}'s story ${b.story}${n ? `@${n}` : ""} isn't here`);
  return { id, n: got.version.n, body: got.version.body, ref: W.refOf("story", id, got.version.n) };
}
export function styleOf(book, n = null) {
  const b = typeof book === "string" ? bookOf(book).body : book;
  if (!b.style) return null;
  const { id, n: pinned } = W.parse(b.style), got = W.get(W.refOf("look", id, n ?? pinned));
  return got ? { id, n: got.version.n, body: got.version.body, ref: W.refOf("look", id, got.version.n) } : null;
}
// the Book a scene belongs to (its document's `book`), or null
export const bookOfScene = (scene) => { const s = typeof scene === "string" ? SC.get(scene) : scene; return s?.book ? books().find((b) => `book:${b.id}` === s.book) ?? null : null; };
export const scenesOf = (book) => (book.body.scenes ?? []).map((id) => SC.get(id)).filter(Boolean);

function cleanAutonomy(a) {
  const out = { default: a?.default ?? FIRST_MIX.default, stages: {} };
  if (!DIAL.includes(out.default)) throw new Error(`autonomy.default is one of ${DIAL.join(", ")}; not ${JSON.stringify(out.default)}`);
  for (const [k, v] of Object.entries(a?.stages ?? {})) {
    if (!(k in STAGES)) throw new Error(`autonomy.stages: no stage ${k}; the stages are ${Object.keys(STAGES).join(", ")}`);
    if (!DIAL.includes(v)) throw new Error(`autonomy.stages.${k} is one of ${DIAL.join(", ")}; not ${JSON.stringify(v)}`);
    out.stages[k] = v;
  }
  return out;
}
export async function saveBook(id, body, { note = "", by = "person" } = {}) {
  await W.load();
  if (!body?.name?.trim()) throw new Error("A Book needs a name");
  if (body.medium && !MEDIA.includes(body.medium)) throw new Error(`medium is one of ${MEDIA.join(", ")}; not ${JSON.stringify(body.medium)}`);
  const clean = { name: body.name.trim(), logline: body.logline?.trim() ?? "", medium: body.medium ?? "anime", story: body.story ?? null, style: body.style ?? null,
    autonomy: cleanAutonomy(body.autonomy ?? FIRST_MIX), numbers: !!body.numbers, cast: [...new Set(body.cast ?? [])], locations: [...new Set(body.locations ?? [])], scenes: [...new Set(body.scenes ?? [])] };
  for (const r of [...clean.cast, ...clean.locations]) W.parse(r);
  id ??= stamp("book");
  const out = await W.save("book", id, clean, { note, by });
  return { id, ref: out.ref, n: out.n, made: out.made };
}

// a story body, checked and put in order: beats by story order with ranks 1..n for `order` and `told`, every change
// with an id, groups over beats that exist. Ids are kept: a beat id or cut number is an id, never a position
export function cleanStory(body) {
  const beats = clone(body?.beats ?? []), ids = new Set();
  for (const [i, b] of beats.entries()) {
    if (!b.id) b.id = `b${Math.max(0, ...beats.map((x) => +String(x.id ?? "").replace(/^b/, "") || 0)) + 1}`;
    if (ids.has(b.id)) throw new Error(`Two beats are ${b.id}: a beat id is cited by units and takes, so each once`);
    ids.add(b.id);
    if (typeof b.text !== "string") throw new Error(`beat ${b.id}: text (what happens) is the beat; give it as words`);
    if (b.source != null && !SOURCES.includes(b.source)) throw new Error(`beat ${b.id}: source is one of ${SOURCES.join(", ")}; not ${JSON.stringify(b.source)}`);
    b.order ??= i + 1; b.told ??= b.order;
    const cids = new Set();
    b.changes = (b.changes ?? []).map((c, k) => {
      if (!c.entity || !c.path) throw new Error(`beat ${b.id} change ${k + 1}: a change needs entity (cast:<id>, prop:<name>, rel:<a>|<b>, location:<id>) and path (wardrobe, carried.right_hand, holder, mood, position, facing, knows…)`);
      if (!OPS.includes(c.op ?? "set")) throw new Error(`beat ${b.id} change ${k + 1}: op is one of ${OPS.join(", ")}; not ${JSON.stringify(c.op)}`);
      if (c.source != null && !SOURCES.includes(c.source)) throw new Error(`beat ${b.id} change ${k + 1}: source is one of ${SOURCES.join(", ")}`);
      const id = c.id ?? `c${Math.max(0, ...(b.changes ?? []).map((x) => +String(x.id ?? "").replace(/^c/, "") || 0), ...[...cids].map((x) => +x.slice(1))) + 1}`;
      cids.add(id);
      return { id, entity: c.entity, path: c.path, op: c.op ?? "set", value: c.value ?? null, ...(c.why ? { why: c.why } : {}), ...(c.source ? { source: c.source } : {}) };
    });
    b.plants = (b.plants ?? []).map((p, k) => ({ id: p.id ?? `${b.id}p${k + 1}`, what: p.what ?? "", ...(p.window != null ? { window: +p.window } : {}) }));
    b.pays_off = [...new Set(b.pays_off ?? [])];
  }
  const rank = (key) => { [...beats].sort((a, b) => a[key] - b[key]).forEach((b, i) => { b[key] = i + 1; }); };
  rank("order"); rank("told");
  beats.sort((a, b) => a.order - b.order);
  const groups = (body?.groups ?? []).map((g, i) => {
    const missing = (g.beats ?? []).filter((x) => !ids.has(x));
    if (missing.length) throw new Error(`group ${g.name ?? g.id ?? i + 1}: no beat ${missing.join(", ")}`);
    return { id: g.id ?? `g${i + 1}`, kind: g.kind ?? "scene", name: g.name ?? "", beats: g.beats ?? [], ...(g.place ? { place: g.place } : {}), ...(g.scene ? { scene: g.scene } : {}), ...(g.contract ? { contract: g.contract } : {}) };
  });
  return { title: body?.title?.trim() ?? "", shape_locked: !!body?.shape_locked, beats, groups, ...(body?.props?.length ? { props: body.props.map((p) => ({ id: p.id, name: p.name ?? words(p.id) })) } : {}) };
}
export async function saveStory(id, body, { note = "", by = "person", proposal = null } = {}) {
  await W.load();
  // SNAP-R67: a story version by an agent exists only from a proposal the person accepted, at every dial position
  if (by !== "person" && !proposal && (body?.beats?.length || body?.groups?.length)) throw new Error("A story edit by an agent is always a proposal the person accepts (canon, SNAP-R67): call it again with propose: true, or as it is to have it proposed");
  const clean = cleanStory(body);
  id ??= stamp("story");
  const out = await W.save("story", id, clean, { note: proposal ? `${note ? `${note} · ` : ""}accepted proposal ${proposal}` : note, by });
  return { id, ref: out.ref, n: out.n, made: out.made };
}
export async function saveLook(id, body, { note = "", by = "person" } = {}) {
  await W.load();
  if (!body?.name?.trim()) throw new Error("A production style needs a name");
  if (!body.paragraph?.trim()) throw new Error("A production style starts from its paragraph: 2-3 sentences in the catalogue's register (medium, line, shading, texture, finish), placed first in every prompt");
  if (body.palette != null && !PALETTES.includes(body.palette)) throw new Error(`palette is one of ${PALETTES.join(", ")}; not ${JSON.stringify(body.palette)}`);
  const clean = { name: body.name.trim(), paragraph: body.paragraph.trim(), palette: body.palette ?? "full", still: body.still?.file ? { file: body.still.file, ...(body.still.from ? { from: body.still.from } : {}) } : null,
    lora: body.lora?.file ? { file: body.lora.file, strength: +(body.lora.strength ?? 1) } : null, voice: body.voice?.trim() ?? "", sound: body.sound?.trim() ?? "", genre: body.genre?.trim() ?? "", source: body.source?.trim() ?? "" };
  id ??= stamp("look");
  const out = await W.save("look", id, clean, { note, by });
  return { id, ref: out.ref, n: out.n, made: out.made };
}

// ---- story edits (pure: a new body from the head's) ------------------------------------------------------------------
const beatIn = (story, id) => { const b = story.beats.find((x) => x.id === id); if (!b) throw new Error(`No beat ${id}; the beats: ${story.beats.map((x) => x.id).join(", ") || "none yet"}`); return b; };
const nextBeat = (story) => `b${Math.max(0, ...story.beats.map((x) => +x.id.replace(/^b/, "") || 0)) + 1}`;
export function withBeat(story, { text, after, ...rest }) {
  const s = clone(story), id = rest.id ?? nextBeat(s), at = after ? beatIn(s, after) : s.beats.at(-1), order = at ? at.order + 0.5 : 0.5, told = at ? at.told + 0.5 : 0.5;
  s.beats.push({ id, order, told, text: text ?? "", ...rest, id });
  return { story: cleanStory(s), beat: id };
}
export function withMove(story, beat, { to, told }) {
  const s = clone(story), b = beatIn(s, beat);
  if (to != null) b.order = to < b.order ? to - 0.5 : to + 0.5; // to: the story position it takes (1 = first)
  if (told != null) b.told = told < b.told ? told - 0.5 : told + 0.5;
  return cleanStory(s);
}
export function withEdit(story, beat, fields) {
  const s = clone(story), b = beatIn(s, beat);
  for (const [k, v] of Object.entries(fields)) if (v !== undefined && !["id", "order", "told", "changes"].includes(k)) { if (v === null) delete b[k]; else b[k] = v; }
  return cleanStory(s);
}
export function withChange(story, beat, change) {
  const s = clone(story);
  beatIn(s, beat).changes.push({ ...change, id: undefined });
  const out = cleanStory(s);
  return { story: out, change: beatIn(out, beat).changes.at(-1).id };
}

// what changed between two story bodies, by beat and field ("b6 told 6 → 1", "b4 changes + c3 cast:ferro.carried.right_hand
// set \"prop:letter\"", "b7 added"), so a version list names what moved instead of two whole beat lists
export function storyDiff(a, b) {
  const out = [], was = new Map((a?.beats ?? []).map((x) => [x.id, x])), now = new Map((b?.beats ?? []).map((x) => [x.id, x])), say = (c) => `${c.id} ${c.entity}.${c.path} ${c.op} ${JSON.stringify(c.value)}`;
  for (const [id, x] of now) {
    const y = was.get(id);
    if (!y) { out.push(`${id} added: "${x.text}"`); continue; }
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (k === "changes") {
        const cw = new Map(y.changes.map((c) => [c.id, c])), cn = new Map(x.changes.map((c) => [c.id, c]));
        for (const [cid, c] of cn) if (!cw.has(cid)) out.push(`${id} change + ${say(c)}`); else if (JSON.stringify(cw.get(cid)) !== JSON.stringify(c)) out.push(`${id} change ${say(cw.get(cid))} → ${say(c)}`);
        for (const [cid, c] of cw) if (!cn.has(cid)) out.push(`${id} change − ${say(c)}`);
      } else if (JSON.stringify(x[k]) !== JSON.stringify(y[k])) out.push(`${id} ${k} ${JSON.stringify(y[k]) ?? "none"} → ${JSON.stringify(x[k]) ?? "none"}`);
    }
  }
  for (const id of was.keys()) if (!now.has(id)) out.push(`${id} removed: "${was.get(id).text}"`);
  return [...out, ...W.diff({ ...a, beats: undefined }, { ...b, beats: undefined })];
}

// ---- the story clock: state at a beat ---------------------------------------------------------------------------------
// every field of an entity at a beat: base ⊕ the changes on beats with order ≤ the beat's, in order; each field with the
// beat and change that set it last (provenance). knows/injuries/… accumulate with add and remove
export function stateAt(story, entity, beatId) {
  const at = beatId ? beatIn(story, beatId).order : Infinity, out = {};
  for (const b of story.beats.filter((x) => x.order <= at)) for (const c of b.changes.filter((x) => x.entity === entity)) {
    const was = out[c.path]?.value, from = { beat: b.id, change: c.id, ...(c.why ? { why: c.why } : {}) };
    if (c.op === "set") out[c.path] = { value: c.value, ...from };
    else if (c.op === "add") out[c.path] = { value: typeof was === "number" && typeof c.value === "number" ? was + c.value : [...[was ?? []].flat(), c.value], ...from };
    else if (c.op === "remove") out[c.path] = { value: Array.isArray(was) ? was.filter((v) => v !== c.value) : null, ...from };
    else out[c.path] = { value: [...[was ?? []].flat(), c.value], ...from, note: true };
  }
  return out;
}
// the entities a story names (in changes), and the Cast a unit lists
export const entitiesOf = (story) => [...new Set(story.beats.flatMap((b) => b.changes.map((c) => c.entity)))];

// ---- the compile (SNAP-R68) ----------------------------------------------------------------------------------------
const PROSE_ONLY = new Set(["knows", "wants", "relationships", "location"]); // a picture can't show these: the prose packet's
const COLOURS = ["red", "orange", "yellow", "green", "blue", "teal", "cyan", "purple", "violet", "magenta", "pink", "brown", "amber", "gold", "golden", "silver", "crimson", "scarlet", "navy", "turquoise", "beige", "maroon", "olive", "lime", "indigo", "blonde", "auburn"];
const colourWords = (text) => [...new Set((String(text ?? "").toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => COLOURS.includes(w)))];
export function nameOf(story, ref) {
  if (!ref || typeof ref !== "string" || !/^[a-z_]+:/.test(ref)) return ref;
  if (ref.startsWith("cast:")) return W.get(ref)?.version.body.name ?? words(ref);
  if (ref.startsWith("prop:")) return story.props?.find((p) => `prop:${p.id}` === ref)?.name ?? `the ${words(ref)}`;
  if (ref.startsWith("location:")) return W.get(ref)?.version.body.name ?? words(ref);
  return words(ref);
}
// one field of a state as a sentence for a picture prompt, or null (prose-only fields, a value with nothing to show)
function sentence(story, who, path, value) {
  const thing = (v) => nameOf(story, v), hand = path.match(/^carried\.(right|left)_hand$/);
  if (PROSE_ONLY.has(path.split(".")[0])) return null;
  if (hand) return value ? `${who} holds ${thing(value)} in the ${hand[1]} hand` : `${who}'s ${hand[1]} hand is empty`;
  if (path === "holder") return value ? `${who} is in ${thing(value)}'s hand` : null;
  if (value == null || (Array.isArray(value) && !value.length)) return null;
  const v = Array.isArray(value) ? value.map(thing).join(", ") : thing(value);
  if (path === "wardrobe" || path === "carried.worn") return `${who} wears ${v}`;
  if (path === "mood") return `${who} looks ${v}`;
  if (path === "position") return `${who} stands ${v}`;
  if (path === "facing") return `${who} faces ${v}`;
  if (path === "hair") return `${who}'s hair is ${v}`;
  if (path === "injuries") return `${who} has ${v}`;
  return `${who}: ${path.replaceAll(/[._]/g, " ")} ${v}`;
}
const cap = (s) => s && s[0].toUpperCase() + s.slice(1);
// a change as a person reads it: "Kon's carried.right_hand → none (hands over the letter)"
export const changeText = (story, c) => `${nameOf(story, c.entity)}'s ${c.path} ${c.op === "set" ? "→" : c.op} ${c.value == null ? "none" : Array.isArray(c.value) ? c.value.map((v) => nameOf(story, v)).join(", ") : nameOf(story, c.value)}${c.why ? ` (${c.why})` : ""}`;
// the beats told out of their story order: the fewest beats whose moving explains the telling (the ones off the longest
// run that keeps story order), so a cold open marks one beat, not every beat after it
export function outOfOrder(story) {
  const seq = [...story.beats].sort((a, b) => a.told - b.told), best = seq.map(() => 1), prev = seq.map(() => -1);
  for (let i = 0; i < seq.length; i++) for (let j = 0; j < i; j++) if (seq[j].order < seq[i].order && best[j] + 1 > best[i]) { best[i] = best[j] + 1; prev[i] = j; }
  const keep = new Set();
  for (let i = best.indexOf(Math.max(0, ...best)); i >= 0; i = prev[i]) keep.add(seq[i].id);
  return new Set(seq.filter((b) => !keep.has(b.id)).map((b) => b.id));
}
// the Cast state whose `covers` the folded fields match ({wardrobe: "oilskin"}), most fields matched first
function stateFor(cast, fields) {
  const states = cast?.states ?? [];
  return states.map((s) => ({ s, hit: Object.entries(s.covers ?? {}).every(([p, v]) => String(fields[p]?.value ?? "") === String(v)) ? Object.keys(s.covers ?? {}).length : -1 })).filter((x) => x.hit > 0).sort((a, b) => b.hit - a.hit)[0]?.s ?? null;
}
// where a unit is: its scene and shot, with the Book
export function unitOf(sceneId, shotId) {
  const scene = SC.get(sceneId);
  if (!scene) throw new Error(`No scene ${sceneId}`);
  const shot = SC.shotOf(scene, shotId), book = bookOfScene(scene);
  if (!book) throw new Error(`${scene.name} isn't a Book scene (add_cut makes cuts in a Book)`);
  return { scene, shot, book, unit: shot.unit ?? {} };
}
// the compiled state sheet of a unit: every entity's state at the unit's beat with provenance, the place, the reference
// package with roles, the prompt sentences with their sources, palette notes, and `from` (a hash per field the compile
// used, which takes pin to read story staleness). `story` overrides the head's body (reversal cost, a draft)
export async function compile(sceneId, shotId, { story: draft = null } = {}) {
  await Promise.all([W.load(), SC.load(), T.load(), L.ready()]);
  const { scene, shot, book, unit } = unitOf(sceneId, shotId), st = book.body.story ? storyOf(book.body) : null, story = draft ?? st?.body ?? cleanStory({});
  const beats = (unit.beats ?? []).map((id) => story.beats.find((b) => b.id === id) ?? { id, missing: true }), present = beats.filter((b) => !b.missing);
  const at = present.length ? present.reduce((a, b) => (b.order > a.order ? b : a)) : null; // the unit's moment: its latest beat in story order
  const style = styleOf(book.body), sentences = [], package_ = [], lint = [], from = {}, words = [];
  const say = (text, src) => { if (text) sentences.push({ text: cap(text.replace(/\.?$/, ".")), from: src }); };
  for (const b of present) { say(b.text, `story ${b.id} text`); from[`${b.id}.text`] = b.text; }
  for (const b of beats.filter((x) => x.missing)) lint.push(`beat ${b.id} isn't in the story any more: the unit compiles without it`);
  // entities: the unit's Cast, then any other entity the story changes that the unit names (props)
  const castRefs = unit.cast ?? [], other = entitiesOf(story).filter((e) => !e.startsWith("cast:") && (unit.props ?? []).includes(e));
  const entities = [];
  for (const ref of [...castRefs, ...other]) {
    const got = ref.startsWith("cast:") ? W.get(ref) : null, body = got?.version.body, name = nameOf(story, ref), fields = at ? stateAt(story, ref, at.id) : {};
    const state = ref.startsWith("cast:") ? stateFor(body, fields) : null, rows = [];
    for (const [path, f] of Object.entries(fields)) {
      const text = sentence(story, name, path, f.value), provenance = `${st ? `story:${st.id}@${st.n}` : "draft"} ${f.beat} change ${f.change}`;
      from[`${ref}.${path}`] = JSON.stringify([f.value, f.beat, f.change]);
      const pictured = state && Object.keys(state.covers ?? {}).includes(path);
      rows.push({ path, value: f.value, beat: f.beat, change: f.change, ...(f.why ? { why: f.why } : {}), provenance, ...(text ? { sentence: cap(text) + "." } : { prose_only: true }), backing: pictured ? `picture: state ${state.name}` : text ? "words only" : "not shown in a picture" });
      if (text) say(text, provenance);
    }
    if (body?.refs?.length) for (const [i, r] of body.refs.entries()) package_.push({ file: r.file, role: `cast: ${body.name}, ${r.role}`, why: `identity, ${ref}@${got.version.n}`, from: ref, order: state ? 2 : 1, i });
    if (state) for (const p of state.pictures ?? []) package_.push({ file: p.file, role: `state: ${state.name}${p.view ? `, ${p.view}` : ""}`, why: `${body.name} at ${at.id} is in state ${state.name}`, from: ref, order: 1 });
    if (style && style.body.palette !== "full" && body) {
      const found = colourWords(L.castLine(body)), stated = colourWords(rows.map((r) => r.sentence).join(" "));
      if (found.length) lint.push(`${body.name}'s Cast line names colours (${found.join(", ")}) and the style is ${style.body.palette}: a colour word in a subject beats the style's palette (style scout 2026-11-06); take them out of the Cast line for this Book if the picture should keep the palette`);
      if (stated.length) lint.push(`${body.name}'s state names colours (${stated.join(", ")}) under a ${style.body.palette} style`);
    }
    if (body?.voice?.file) words.push({ cast: ref, name: body.name });
    entities.push({ ref, name, ...(got ? { n: got.version.n } : {}), fields: rows, ...(state ? { state: state.name } : {}), ...(ref.startsWith("cast:") && !got ? { missing: true } : {}) });
  }
  // dialogue on the unit's beats, each line citing the speaker's voice reference (voice scout 2026-11-06: no voice words)
  const lines = present.flatMap((b) => (b.lines ?? []).map((l) => ({ ...l, beat: b.id })));
  for (const l of lines) { const who = nameOf(story, l.who); from[`${l.beat}.line.${l.who}`] = l.text; say(`${who} says "${l.text}"${words.some((x) => x.cast === l.who) ? ` in the voice of {voice:${l.who}}` : ""}`, `story ${l.beat} line`); }
  // the place: the unit's location at its plate (camera) and the master
  let place = null;
  if (unit.location) {
    const got = W.get(unit.location), b = got?.version.body;
    if (!b) lint.push(`${unit.location} isn't here: the unit compiles without its place`);
    else {
      const plate = unit.plate ? b.plates?.find((p) => p.name === unit.plate) : null;
      if (unit.plate && !plate) lint.push(`${b.name} v${got.version.n} has no plate "${unit.plate}"`);
      place = { ref: W.refOf("location", W.parse(unit.location).id, got.version.n), name: b.name, ...(plate ? { plate: plate.name, pose: plate.pose ?? null } : {}), master: !!b.master };
      if (plate) package_.push({ file: plate.file, role: `location: ${b.name}, plate ${plate.name} (camera)`, why: `this cut's camera`, from: unit.location, order: 0 });
      if (b.master) package_.push({ file: b.master.file, role: `location: ${b.name}, master (place)`, why: "the place's topology", from: unit.location, order: 3 });
      from[`${unit.location}`] = got.version.hash;
    }
  }
  if (unit.board?.file) package_.unshift({ file: unit.board.file, role: `board: ${unit.cut ?? "this cut"}${unit.board.approved ? "" : " (not approved yet)"}`, why: "the cut opens on its board frame", from: "board", order: -1 });
  const pictures = package_.sort((a, b) => a.order - b.order).map(({ order: _, i: __, ...p }) => p);
  if (style) from.style = `${style.ref}`;
  const budget = 9, dropped = pictures.slice(budget).map((p) => p.role);
  const description = [style?.body.paragraph, ...sentences.map((s) => s.text)].filter(Boolean).join(" ");
  const subject = sentences.map((s) => s.text).join(" ");
  return {
    book: book.ref ?? `book:${book.id}`, scene: scene.id, shot: shot.id, cut: unit.cut ?? null, unit_kind: unit.kind ?? "cut",
    story: st ? { ref: st.ref, n: st.n } : null, at: at ? { beat: at.id, order: at.order, told: at.told, text: at.text, ...(at.intent ? { intent: at.intent } : {}), ...(at.intensity ? { intensity: at.intensity } : {}) } : null,
    ...(present.length ? {} : { note: "no beat: this unit compiles from the Cast's base, as any shot does" }),
    style: style ? { ref: style.ref, name: style.body.name, palette: style.body.palette, ...(style.body.still ? { still: style.body.still.file } : {}) } : null,
    entities, place, package: pictures, budget: { used: Math.min(pictures.length, budget), of: budget, ...(dropped.length ? { over: dropped } : {}) },
    prompt: { description, sentences, soundscape: unit.sound ?? "", music: unit.music ?? "N/A" },
    still_prompt: [style?.body.paragraph, subject].filter(Boolean).join("\n\n"),
    transition: unit.transition ?? null, timing: unit.timing ?? null, lint,
    from: Object.fromEntries(await Promise.all(Object.entries(from).map(async ([k, v]) => [k, W.short(await W.sha(v))]))),
  };
}

// ---- units ------------------------------------------------------------------------------------------------------------
// every unit of a Book in telling order: by the told rank of its first beat; a unit with no beat keeps its place after
// the unit before it (scene order, then shot order)
export function units(book) {
  const story = book.body.story ? storyOf(book.body).body : cleanStory({}), told = (id) => story.beats.find((b) => b.id === id)?.told;
  let last = 0;
  const list = scenesOf(book).flatMap((scene) => scene.shots.map((shot) => {
    const t = (shot.unit?.beats ?? []).map(told).filter((x) => x != null), key = t.length ? Math.min(...t) : last + 0.001;
    last = key;
    return { scene, shot, unit: shot.unit ?? {}, key };
  }));
  return list.map((x, i) => ({ ...x, i })).sort((a, b) => a.key - b.key || a.i - b.i);
}
const cutNumber = (book) => `C${Math.max(0, ...units(book).map((u) => +String(u.unit.cut ?? "").replace(/^C/, "") || 0)) + 1}`;
export function cleanUnit(u, was = {}) {
  const out = { ...was };
  for (const k of ["beats", "cast", "props", "location", "plate", "kind", "sound", "music", "transition", "camera", "blocking", "note"]) if (u[k] !== undefined) { if (u[k] === null) delete out[k]; else out[k] = u[k]; }
  if (u.seconds !== undefined) out.timing = { ...(out.timing ?? {}), seconds: +u.seconds, fps: out.timing?.fps ?? 24 };
  if (u.timing !== undefined) out.timing = u.timing;
  if (u.trim !== undefined) out.trim = u.trim;
  if (u.board !== undefined) out.board = u.board;
  for (const r of [...(out.cast ?? []), ...(out.location ? [out.location] : [])]) W.parse(r);
  return out;
}
// a cut in a Book: a shot in one of its scenes (a new scene when scene_name is given), carrying its unit
export async function addCut(bookRef, { scene, scene_name, name, ...u }, { by = "person" } = {}) {
  await Promise.all([W.load(), SC.load(), T.load()]);
  const book = bookOf(bookRef);
  let sceneId = scene;
  if (!sceneId) {
    const s = await SC.create({ name: scene_name || `${book.body.name} · scene ${(book.body.scenes?.length ?? 0) + 1}`, by });
    await SC.setBook(s.id, `book:${book.id}`, by);
    sceneId = s.id;
    await saveBook(book.id, { ...book.body, scenes: [...(book.body.scenes ?? []), s.id] }, { note: `scene ${s.name} added`, by });
  } else if (bookOfScene(sceneId)?.id !== book.id) throw new Error(`${SC.get(sceneId)?.name ?? sceneId} isn't a scene of ${book.body.name}; its scenes: ${scenesOf(bookOf(bookRef)).map((s) => `${s.id} (${s.name})`).join(", ") || "none yet (give scene_name to make one)"}`);
  const cut = cutNumber(bookOf(bookRef)), unit = cleanUnit({ ...u, kind: u.kind ?? (book.body.medium === "film" ? "shot" : "cut") }, { cut });
  const out = await SC.addShot(sceneId, { name: name ?? cut, by });
  await SC.setUnit(sceneId, out.shot.id, unit, by, `${cut} planned`);
  return { book: `book:${book.id}`, scene: sceneId, shot: out.shot.id, cut, unit };
}
export async function setUnit(sceneId, shotId, u, { by = "person" } = {}) {
  await SC.load();
  const { unit } = unitOf(sceneId, shotId), next = cleanUnit(u, unit);
  await SC.setUnit(sceneId, shotId, next, by, `${unit.cut ?? "unit"} changed`);
  return next;
}

// ---- apply a compile to the open recipe (the Snap chain of the unit's shot) ------------------------------------------
export async function apply(sceneId, shotId, { by = "agent" } = {}) {
  const sheet = await compile(sceneId, shotId), { unit } = unitOf(sceneId, shotId);
  if (SC.current()?.shot.id !== shotId) await SC.openShot(sceneId, shotId);
  if (!E.state().bricks.some((b) => b.key === "render")) throw new Error(`${unit.cut ?? "This cut"} has no recipe yet: start_recipe first (it opens on the shot), then apply_unit again`);
  const said = [], number = units(bookOfScene(sceneId)).findIndex((x) => x.shot.id === shotId) + 1;
  const t = unit.timing?.seconds && E.timing("render");
  if (t) { const f = E.framesFor(t, `${unit.timing.seconds}s`); E.setValue("render", t.node, t.name, f); said.push(`length ${E.seconds(t, f)} s`); }
  const rest = (E.getValue("render", "render", "prompt") ?? "").split("\n").slice(1).filter((l) => !/^(overall_soundscape|non_diegetic_music):/.test(l));
  E.setValue("render", "render", "prompt", [`integrated_multimodal_description: [Shot ${number}] ${sheet.prompt.description}`, `overall_soundscape: ${sheet.prompt.soundscape || "N/A"}`, `non_diegetic_music: ${sheet.prompt.music || "N/A"}`, ...rest].join("\n"));
  const voices = {};
  for (const e of sheet.entities.filter((x) => x.ref.startsWith("cast:") && !x.missing)) {
    said.push(await L.applyCast(e.ref));
    const v = L.pinOf(e.ref)?.placed?.voice;
    if (v) voices[e.ref] = v;
  }
  // state pictures go in after the Cast's own (their source is the Book, so a Cast apply never takes them out)
  for (const p of E.state().bricks.find((x) => x.key === "refs")?.pictures ?? []) if (p.source === `book-state:${shotId}`) E.removePicture(p.node);
  for (const p of sheet.package.filter((x) => x.role.startsWith("state: "))) E.addPicture(p.file, { role: p.role, reason: p.why, source: `book-state:${shotId}` });
  let hint = "";
  if (unit.location) { const out = await L.applyLocation(unit.location, { plates: unit.plate ? [unit.plate] : [], plan: false, ...(unit.plate ? { camera: unit.plate } : {}) }); hint = out.prompt_hint; said.push(out.said); }
  if (unit.board?.file && unit.board.approved) {
    for (const p of E.state().bricks.find((x) => x.key === "refs")?.pictures ?? []) if (p.source === `book-board:${shotId}`) E.removePicture(p.node);
    E.addPicture(unit.board.file, { role: `board: ${unit.cut}, the cut opens on it`, reason: "the approved board frame (SNAP-R131)", source: `book-board:${shotId}`, first: true });
    const cite = E.references()?.pictures.find((p) => p.role?.startsWith(`board: ${unit.cut}`))?.cite;
    hint = `The cut opens on ${cite}: keep its framing and blocking. ${hint}`;
    said.push(`the board as ${cite}`);
  }
  // each Cast named by the pictures that show them, so the words and the references meet ("Kon is <Picture 2>.")
  const cites = sheet.entities.filter((e) => e.ref.startsWith("cast:") && !e.missing).map((e) => [e.name, (E.references()?.pictures ?? []).filter((p) => p.role?.startsWith(`cast: ${e.name},`) || (p.role?.startsWith("state: ") && sheet.package.some((x) => x.from === e.ref && x.file === p.file))).map((p) => p.cite)]).filter(([, c]) => c.length);
  if (cites.length) hint = `${cites.map(([n, c]) => `${n} is ${c.join(" and ")}.`).join(" ")} ${hint}`.trim();
  let [first, ...others] = E.getValue("render", "render", "prompt").split("\n");
  for (const [ref, cite] of Object.entries(voices)) first = first.replaceAll(`{voice:${ref}}`, cite);
  first = first.replace(/ in the voice of \{voice:[^}]+\}/g, "");
  if (hint) first = `${first.replace(/\s*$/, "")} ${hint}`;
  E.setValue("render", "render", "prompt", [first, ...others].join("\n"));
  if (sheet.style) L.pin(sheet.style.ref.replace(/@\d+$/, ""), { n: +sheet.style.ref.split("@")[1], hash: W.short(W.get(sheet.style.ref).version.hash), name: sheet.style.name });
  E.tag("story", { book: sheet.book, ...(sheet.story ? { ref: sheet.story.ref } : {}), beat: sheet.at?.beat ?? null, unit: { scene: sceneId, shot: shotId, cut: unit.cut ?? null }, from: sheet.from });
  return { said: said.filter(Boolean), sheet };
}

// ---- stale on the story clock -------------------------------------------------------------------------------------
// a take made from a unit's compile, against today's compile of the same unit: which fields it used moved, named by beat
export async function storyStale(take, { story = null } = {}) {
  const s = take?.story ?? take?.graph?.extra?.snap?.story;
  if (!s?.unit || !s.from) return null;
  let now;
  try { now = await compile(s.unit.scene, s.unit.shot, { story }); } catch (e) { return { reasons: [`its unit can't compile now: ${e.message}`] }; }
  // a field now, by its key (cast:kon.carried.right_hand), with the beat that set it
  const fields = new Map(now.entities.flatMap((e) => e.fields.map((f) => [`${e.ref}.${f.path}`, { ...f, name: e.name }]))), reasons = [];
  for (const k of new Set([...Object.keys(s.from), ...Object.keys(now.from)])) {
    if (s.from[k] === now.from[k]) continue;
    const f = fields.get(k), [head, ...rest] = k.split(".");
    if (k === "style") reasons.push(`the production style ${s.from[k] ? "changed" : "was added"}`);
    else if (/^b\d+$/.test(head)) reasons.push(`story: ${head}'s ${rest.join(" ")} changed`);
    else if (head.startsWith("location:") && !rest.length) reasons.push(`its place ${head} changed`);
    else if (!(k in now.from)) reasons.push(`story: ${k} is no longer set at this beat`);
    else reasons.push(`story: ${f?.name ?? head}.${rest.join(".")} ${k in s.from ? "changed" : "set"}${f ? ` at ${f.beat}` : ""}`);
  }
  return reasons.length ? { reasons, was: s.ref ?? null, now: now.story?.ref ?? null } : null;
}
// every take of a Book's units with what moved under it (story fields and the style), and the count per unit
export async function bookStale(bookRef, { story = null } = {}) {
  await T.load();
  const book = bookOf(bookRef), out = [];
  for (const { scene, shot, unit } of units(book)) for (const e of SC.takesOf(shot)) {
    const t = T.get(e.take), st = t && await storyStale(t, { story });
    if (st) out.push({ take: t.id, number: t.number, cut: unit.cut ?? null, scene: scene.id, shot: shot.id, active: shot.active === t.id, reasons: st.reasons });
  }
  return out;
}
// what a story edit would re-open before it is saved (reversal cost, box1:43): takes it would flag and boards it touches
export async function reversalCost(bookRef, story) {
  const before = new Set((await bookStale(bookRef)).map((x) => x.take)), after = await bookStale(bookRef, { story: cleanStory(story) });
  const flagged = after.filter((x) => !before.has(x.take));
  const boards = units(bookOf(bookRef)).filter((u) => u.unit.board?.from && flagged.some((f) => f.shot === u.shot.id)).length;
  return { takes: flagged.length, boards, said: flagged.length ? `re-flags ${plural(flagged.length, "take")}${boards ? ` and ${plural(boards, "board")}` : ""}` : "re-flags nothing", list: flagged };
}

// ---- the dial (the GPU and pick half reads it where SNAP-R16's flag is read) ------------------------------------------
export function dialOf(book, stage) { const a = book.body.autonomy ?? FIRST_MIX; return a.stages?.[stage] ?? a.default; }
// may an agent's call of this tool go ahead without the person, inside the open shot's Book? null outside a Book (the
// person's "Let agents run" decides), else from the stage's dial: automatic yes, collaborate as Let agents run, assist no
export function allows(tool, letAgentsRun) {
  const stage = STAGE_OF[tool], here = SC.current(), book = stage && here && bookOfScene(here.scene);
  if (!book) return null;
  const d = dialOf(book, stage);
  return d === "automatic" ? true : d === "collaborate" ? letAgentsRun : false;
}

// ---- proposals for canon (SNAP-R67): story, style and the dial wait for the person at every dial position -----------
export function propose(tool, args, reason, plan) {
  const p = P.add(tool, args, reason, null, plan);
  p.args = { ...p.args, proposal: p.id };
  return p;
}

// ---- the animatic and the Cut (SNAP-R131, SNAP-R132): one MAISnapCut prompt over the units in telling order --------
const annotated = (file, type = "input") => `${file} [${type}]`;
export const groupOf = (book) => `book-${book.id}`;
// the clips: animatic = each unit's kept active take where there is one (a kept take replaces its board), else its
// board held for its time; cut = each unit's active take, trimmed and levelled. Units with nothing to show are listed
export function plan(bookRef, mode = "cut") {
  const book = bookOf(bookRef), clips = [], gaps = [];
  for (const { shot, unit } of units(book)) {
    const t = shot.active ? T.get(shot.active) : null, video = t?.media.find((m) => m.kind === "video"), still = t?.media.find((m) => m.kind === "image");
    const seconds = unit.timing?.seconds ?? 4, trim = unit.trim ?? {}, label = unit.cut ?? shot.name;
    if (video && (mode === "cut" || t.verdict === "keep")) clips.push({ cut: label, take: t.id, video: K.annotated(video), in_s: trim.in_s ?? 0, ...(trim.out_s != null ? { out_s: trim.out_s } : {}), gain_db: trim.gain_db ?? 0 });
    else if (mode === "animatic" && unit.board?.file) clips.push({ cut: label, image: annotated(unit.board.file), seconds });
    else if (mode === "animatic" && still) clips.push({ cut: label, take: t.id, image: K.annotated(still), seconds });
    else gaps.push(`${label}: ${mode === "cut" ? (t ? "its active take has no video" : "no active take") : "no board and no kept take"}`);
  }
  return { book, clips, gaps };
}
// queue the assembly (the person's or an agent's), landing as a take of the Book's own group: {run, take, clips, gaps}
export async function assemble(bookRef, { mode = "cut", width = 1280, height = 704, fps = 24, name, by = "person" } = {}) {
  await Promise.all([W.load(), SC.load(), T.load()]);
  const { book, clips, gaps } = plan(bookRef, mode);
  if (!clips.length) throw new Error(`${book.body.name}: nothing to put in the ${mode === "cut" ? "Cut" : "animatic"} yet (${gaps.join("; ")})`);
  const g = {}, inputs = {};
  clips.forEach((c, i) => {
    if (c.video) { g[`v${i}`] = { class_type: "LoadVideo", inputs: { file: c.video } }; inputs[`clips.clip${i}`] = [`v${i}`, 0]; }
    else { g[`i${i}`] = { class_type: "LoadImage", inputs: { image: c.image.replace(/ \[\w+\]$/, "") } }; g[`f${i}`] = { class_type: "CreateVideo", inputs: { images: [`i${i}`, 0], fps } }; inputs[`clips.clip${i}`] = [`f${i}`, 0]; }
  });
  const spec = clips.map(({ cut, video, image, ...c }) => ({ name: cut, ...(image ? { hold_s: c.seconds } : { in_s: c.in_s, ...(c.out_s != null ? { out_s: c.out_s } : {}), gain_db: c.gain_db }) }));
  g.cut = { class_type: "MAISnapCut", inputs: { ...inputs, plan: JSON.stringify(spec), width, height, fps } };
  const prefix = `video/snap_book/${book.id}_${mode}`;
  g.save = { class_type: "SaveVideo", inputs: { filename_prefix: prefix, format: "auto", codec: "auto", video: ["cut", 0] } };
  const title = name ?? `${mode === "cut" ? "The Cut" : "Animatic"} of ${book.body.name}: ${plural(clips.length, "cut")}`;
  const id = await K.queue(g, { group: groupOf(book), job: { kind: mode === "cut" ? "cut" : "board", title, about: { book: `book:${book.id}` }, by },
    extra: { snap_parent: { method: `book/${mode}`, options: { book: `book:${book.id}@${book.n}`, clips: clips.map(({ cut, take }) => ({ cut, ...(take ? { take } : {}) })) } } } });
  return { run: id, take: `take-${id}`, mode, clips: clips.map(({ cut, take, video, image, ...c }) => ({ cut, ...(take ? { take } : {}), from: video ? "take" : "board", ...c })), gaps };
}
// OpenTimelineIO of the Cut: one video track of the active takes as source ranges, a marker per cut (server side writes
// the file beside the outputs: /mainodes/snap/book/otio)
export async function otio(bookRef, { fps = 24 } = {}) {
  const { book, clips, gaps } = plan(bookRef, "cut");
  const r = await api.fetchApi("/mainodes/snap/book/otio", { method: "POST", body: JSON.stringify({ name: book.body.name, book: `book:${book.id}@${book.n}`, fps, clips }) }), out = await r.json();
  if (!r.ok) throw new Error(out.error ?? `writing the OTIO failed (${r.status})`);
  return { ...out, gaps };
}
