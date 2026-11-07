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
// the Cut · SNAP-R139 canon proposals stack · SNAP-R141 apply cites References as they stand · SNAP-R142 opening board
// and key drawing · SNAP-R165 a Cast line folds through the state · SNAP-R166 apply_unit lands off the Cut · SNAP-R167 holder and
// mood sentences · SNAP-R168 a cut opens before its beat · SNAP-R169 boards pin the story · SNAP-R170 a re-board keeps its own
// board · SNAP-R172 the reversal cost says what moves · SNAP-R178 a wardrobe state folds the items it names · SNAP-R60 versions ·
// SNAP-R11 nothing blocks · SNAP-R230 a cut owns its dial rows · SNAP-R231 their defaults · SNAP-R236 an insert cites a frame of its master ·
// SNAP-R237 a Cast's voice only where it speaks · SNAP-R181 a held-prop cut is boarded at its key · SNAP-R189 a board says absent what its
// pictures may still show · SNAP-R212 the Cut opens in Astrid, private takes stay out · SNAP-R213 a cut's take may come from another shot ·
// SNAP-R215 the archive Astrid can edit, its clips named by cut · SNAP-R216 a speaking cut's sound on its own lane · SNAP-R217 a pushed Book
// changes in place, its diff says what moved · SNAP-R223 a production is the record above the Book · SNAP-R224 the push is the person's (button,
// auto-push) · SNAP-R225 Snap remembers where a Cut went · SNAP-R226 the style shared with Astrid is the person's switch · see docs/snap/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as W from "./world.js";
import * as SC from "./scenes.js";
import * as T from "./takes.js";
import * as L from "./library.js";
import * as E from "./engine.js";
import * as K from "./checks.js";
import * as P from "./proposals.js";
import * as RT from "./retake.js";
import * as I from "./instructions.js";
import * as D from "./dials.js";
import * as M from "./models.js";

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
const STAGE_OF = { make_set_plates: "settei", make_character_sheet: "settei", save_cast_state: "settei", design_state: "settei", upscale_take: "settei", make_board: "boards", set_board: "boards",
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
  if (!got) throw new Error(`${b.name}'s story ${b.story}${n ? `@${n}` : ""} isn't on this install: import it (export_records of the Book carries its story and look, F-Q12)`);
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
    autonomy: cleanAutonomy(body.autonomy ?? FIRST_MIX), numbers: !!body.numbers, cast: [...new Set(body.cast ?? [])], locations: [...new Set(body.locations ?? [])], scenes: [...new Set(body.scenes ?? [])],
    to_astrid: { auto_push: !!body.to_astrid?.auto_push, share_style: !!body.to_astrid?.share_style } }; // SNAP-R224, R226: the person's two Astrid settings, off by default
  for (const r of [...clean.cast, ...clean.locations]) W.parse(r);
  id ??= stamp("book");
  const out = await W.save("book", id, clean, { note, by });
  return { id, ref: out.ref, n: out.n, made: out.made };
}

// ---- the production (SNAP-R223): the record above Books, and what an Astrid project is -------------------------------
export const productions = () => W.all("production").map((r) => ({ id: r.id, ref: `production:${r.id}`, head: r.head, body: W.headOf(r).body }));
export function productionOf(ref) {
  const { kind, id, n } = W.parse(String(ref).includes(":") ? ref : `production:${ref}`);
  if (kind !== "production") throw new Error(`${ref} isn't a production reference (production:<id>; list_productions lists them)`);
  const got = W.get(W.refOf("production", id, n));
  if (!got) throw new Error(`No production ${ref}; the productions: ${productions().map((p) => `production:${p.id} (${p.body.name})`).join(", ") || "none yet (create_production makes one; a Book gets one of its own name)"}`);
  return { id, n: got.version.n, body: got.version.body, ref: W.refOf("production", id, got.version.n) };
}
const slugOf = (name) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "production";
// a Book is in one production: listing it here takes it out of any other (a new version of that one, saying where it went)
export async function saveProduction(id, body, { note = "", by = "person" } = {}) {
  await W.load();
  if (!body?.name?.trim()) throw new Error("A production needs a name");
  const clean = { name: body.name.trim(), books: [...new Set(body.books ?? [])], cast: [...new Set(body.cast ?? [])], locations: [...new Set(body.locations ?? [])], style: body.style ?? null,
    astrid: { project: body.astrid?.project?.trim() || slugOf(body.name) } };
  for (const r of [...clean.books, ...clean.cast, ...clean.locations, ...(clean.style ? [clean.style] : [])]) W.parse(r);
  for (const r of clean.books) if (!W.record("book", W.parse(r).id)) throw new Error(`No Book ${r} (list_books lists them)`);
  id ??= stamp("production");
  const out = await W.save("production", id, clean, { note, by });
  for (const other of productions().filter((p) => p.id !== id && p.body.books.some((b) => clean.books.includes(b)))) {
    const moved = other.body.books.filter((b) => clean.books.includes(b));
    await W.save("production", other.id, { ...other.body, books: other.body.books.filter((b) => !moved.includes(b)) }, { note: `${moved.map((b) => W.get(b)?.version.body.name ?? b).join(", ")} moved to ${clean.name}`, by });
  }
  return { id, ref: out.ref, n: out.n, made: out.made };
}
// the production a Book is in; a Book alone gets one of its own name the first time one is needed (R15: made, never a
// refusal), under one id per Book so two pages asking at once make one
export async function productionFor(book, { by = "migration" } = {}) {
  const ref = `book:${book.id}`, found = productions().find((p) => p.body.books.includes(ref));
  if (found) return found;
  await saveProduction(`of-${book.id}`, { name: book.body.name, books: [ref] }, { note: "made for a Book that was in none (SNAP-R223)", by });
  return productions().find((p) => p.id === `of-${book.id}`);
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
    return { id: g.id ?? `g${i + 1}`, kind: g.kind ?? "scene", name: g.name ?? "", beats: g.beats ?? [], ...(g.place ? { place: g.place } : {}), ...(g.scene ? { scene: g.scene } : {}), ...(g.contract ? { contract: g.contract } : {}), ...(g.colour ? { colour: g.colour } : {}) }; // colour: the colour script's frame (SNAP-R175)
  });
  return { title: body?.title?.trim() ?? "", shape_locked: !!body?.shape_locked, beats, groups, ...(body?.props?.length ? { props: body.props.map((p) => ({ id: p.id, name: p.name ?? words(p.id) })) } : {}) };
}
export async function saveStory(id, body, { note = "", by = "person", proposal = null, accepted_by = null } = {}) {
  await W.load();
  // SNAP-R67: a story version by an agent exists only from a proposal the person accepted, at every dial position
  if (by !== "person" && !proposal && (body?.beats?.length || body?.groups?.length)) throw new Error("A story edit by an agent is always a proposal the person accepts (canon, SNAP-R67): call it again with propose: true, or as it is to have it proposed");
  const clean = cleanStory(body);
  id ??= stamp("story");
  // F-L17: the version says who accepted the proposal and where (`accepted_by`), not only the agent that wrote it
  const who = accepted_by ? ` by ${accepted_by.by === "person" ? "the person" : accepted_by.by} on ${accepted_by.where}${accepted_by.driven_by ? ` (driven by ${accepted_by.driven_by})` : ""}` : "";
  const out = await W.save("story", id, clean, { note: proposal ? `${note ? `${note} · ` : ""}accepted proposal ${proposal}${who}` : note, by, ...(accepted_by ? { accepted_by } : {}), ...(proposal ? { proposal } : {}) });
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

// ---- Pages: Fountain in and out (§11.5 step 12) -----------------------------------------------------------------------
// Fountain (fountain.io) is the Pages lens' plain text for film and anime: a scene heading (INT./EXT./EST./I/E, or one
// forced with ".") is a scene group, an action paragraph a beat, a character cue with its dialogue a line on the beat
// before it, a section (#) an act, a synopsis (=) the intent of the beat before it. The script is telling order; story order
// stays the story's (a moved scene is a telling change). Importing keeps ids: a beat whose
// text is unchanged keeps its id, changes, plants and payoffs; a group keeps its id by kind and name. Notes [[…]], the
// boneyard /*…*/ and transitions are left out. Cue names match the Book's Cast by name (case aside), else stay words
const HEADING = /^(?:\.(?=[A-Za-z0-9])|(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s])/i;
const CUE = /^@?[A-Z0-9][A-Z0-9 .'-]*(?:\s*\([^)]*\))?\s*\^?$/;
const TRANSITION = /^(?:>|[A-Z ]+TO:$)/;
export function fromFountain(text, { story = cleanStory({}), cast = [] } = {}) {
  const src = String(text ?? "").replace(/\r\n?/g, "\n").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\[\[[\s\S]*?\]\]/g, "");
  const blocks = src.split(/\n[ \t]*\n/).map((b) => b.replace(/^\n+|\n+$/g, "")).filter((b) => b.trim());
  const byName = new Map(cast.map((ref) => [String(W.get(ref)?.version.body.name ?? "").toUpperCase(), ref]).filter(([n]) => n));
  const oldByText = new Map(story.beats.map((b) => [b.text.trim(), b])), oldGroup = new Map(story.groups.map((g) => [`${g.kind}:${g.name}`, g]));
  const beats = [], groups = [], used = new Set();
  let title = story.title, scene = null, act = null;
  const group = (kind, name) => { const was = oldGroup.get(`${kind}:${name}`), g = { ...(was ? structuredClone(was) : { kind, name }), list: [] }; groups.push(g); return g; };
  const beat = (words) => {
    const was = oldByText.get(words.trim()), b = was && !used.has(was.id) ? { ...structuredClone(was), lines: [], intent: undefined } : { text: words.trim(), changes: [], lines: [] }; // lines and the intent come from the script
    // a script is telling order: a kept beat keeps its story order (a flashback stays one), a new one follows the beat before it
    if (was && !used.has(was.id)) { used.add(was.id); b.order = was.order; } else { delete b.id; b.order = (beats.at(-1)?.order ?? 0) + 0.5; }
    b.told = beats.length + 1;
    beats.push(b); scene?.list.push(b); act?.list.push(b);
    return b;
  };
  for (const [i, block] of blocks.entries()) {
    const lines = block.split("\n").map((l) => l.trimEnd()), first = lines[0].trim();
    if (i === 0 && /^title\s*:/i.test(first)) { title = first.replace(/^title\s*:\s*/i, "").trim() || title; continue; }
    if (/^#/.test(first)) { act = group("act", first.replace(/^#+\s*/, "")); continue; }
    if (/^=/.test(first)) { if (beats.length) beats.at(-1).intent = first.replace(/^=\s*/, ""); continue; }
    if (lines.length === 1 && HEADING.test(first)) { scene = group("scene", first.replace(/^\./, "")); continue; }
    if (lines.length === 1 && TRANSITION.test(first)) continue;
    if (lines.length > 1 && CUE.test(first) && !HEADING.test(first)) {
      const name = first.replace(/^@/, "").replace(/\s*\([^)]*\)/g, "").replace(/\^$/, "").trim(), who = byName.get(name.toUpperCase()) ?? name;
      const said = lines.slice(1).filter((l) => !/^\s*\(.*\)\s*$/.test(l)).map((l) => l.trim()).join(" ");
      const last = beats.at(-1), at = last && (!scene || scene.list.includes(last)) ? last : beat(`${name} speaks.`);
      at.lines.push({ who, text: said });
      continue;
    }
    beat(lines.map((l) => l.trim()).join(" ").replace(/^!/, ""));
  }
  // a beat whose words were edited keeps its id (and its changes) when its scene still has an old beat left unmatched:
  // the first such one in telling order, so an edited line is a changed beat, not a new one
  const oldScene = new Map(story.groups.filter((g) => g.kind === "scene").flatMap((g) => g.beats.map((id) => [id, g.name])));
  const sceneName = new Map(groups.filter((g) => g.kind === "scene").flatMap((g) => g.list.map((b) => [b, g.name])));
  const left = [...story.beats].sort((a, b) => a.told - b.told).filter((b) => !used.has(b.id));
  for (const b of beats.filter((x) => !x.id)) {
    const was = left.find((o) => !used.has(o.id) && oldScene.get(o.id) === sceneName.get(b));
    if (was) { used.add(was.id); Object.assign(b, { ...structuredClone(was), text: b.text, lines: b.lines, intent: b.intent, order: was.order, told: b.told }); }
  }
  let next = Math.max(0, ...story.beats.map((b) => +b.id.replace(/^b/, "") || 0));
  for (const b of beats) { b.id ??= `b${++next}`; if (!b.lines.length) delete b.lines; if (b.intent == null) delete b.intent; }
  const ids = new Set(groups.map((g) => g.id).filter(Boolean));
  const count = {};
  const out = groups.map(({ list, ...g }) => { const pre = g.kind === "act" ? "act" : "sc"; if (!g.id) { do g.id = `${pre}${(count[pre] = (count[pre] ?? 0) + 1)}`; while (ids.has(g.id)); ids.add(g.id); } return { ...g, beats: list.map((b) => b.id) }; });
  return cleanStory({ ...story, title, beats, groups: out });
}
// the story as Fountain: title, then telling order, a heading when a scene starts, each beat's action, its intent as a
// synopsis, its lines under the speaker's name
export function toFountain(story) {
  const told = [...story.beats].sort((a, b) => a.told - b.told), sceneOf = new Map(), actOf = new Map();
  for (const g of story.groups) for (const id of g.beats) (g.kind === "act" ? actOf : sceneOf).set(id, g);
  const out = [`Title: ${story.title || "Untitled"}`];
  let scene = null, act = null;
  for (const b of told) {
    const a = actOf.get(b.id), s = sceneOf.get(b.id);
    if (a && a !== act) { act = a; out.push(`# ${a.name || a.id}`); }
    if (s && s !== scene) { scene = s; out.push(HEADING.test(s.name) ? s.name.toUpperCase() : `.${(s.name || s.id).toUpperCase()}`); }
    out.push(b.text || `(${b.id})`);
    if (b.intent) out.push(`= ${b.intent}`);
    for (const l of b.lines ?? []) out.push(`${String(nameOf(story, l.who)).toUpperCase()}\n${l.text}`);
  }
  return `${out.join("\n\n")}\n`;
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
// F-L07 (SNAP-R167): a holder is a person ("in Kuroe's hand") or a place said as written ("on the counter", "hanging
// from its chain on his lapel"); a mood is a look ("looks calm") or a face ("has a confident grin")
const PLACE_WORD = /^(on|in|at|under|over|beside|behind|by|near|inside|against|across|between|above|below|from|off|out|into|onto|upon|around|[a-z]+ing)\b/i;
const FACE_WORD = /\b(grin|smile|smirk|frown|scowl|glare|pout|stare|look|expression|face|sneer|glower|tears|sigh|blush)$/i;
export const stateSentence = (story, who, path, value) => sentence(story, who, path, value); // a state field as the compile says it (settei design, SNAP-R176)
function sentence(story, who, path, value) {
  const thing = (v) => nameOf(story, v), hand = path.match(/^carried\.(right|left)_hand$/);
  if (PROSE_ONLY.has(path.split(".")[0])) return null;
  if (hand) return value ? `${who} holds ${thing(value)} in the ${hand[1]} hand` : `${who}'s ${hand[1]} hand is empty`;
  if (path === "holder") {
    if (!value) return null;
    const person = String(value).startsWith("cast:") || entitiesOf(story).some((e) => e.startsWith("cast:") && nameOf(story, e) === value);
    return person ? `${who} is in ${thing(value)}'s hand` : PLACE_WORD.test(String(thing(value))) ? `${who} is ${thing(value)}` : `${who} is on ${thing(value)}`;
  }
  if (value == null || (Array.isArray(value) && !value.length)) return null;
  const v = Array.isArray(value) ? value.map(thing).join(", ") : thing(value);
  if (path === "wardrobe" || path === "carried.worn") return `${who} wears ${v}`;
  if (path === "mood") return /^(is|looks|has|seems|wears)\b/i.test(v) ? `${who} ${v}` : FACE_WORD.test(v.trim()) ? `${who} has ${/^(a|an|the)\s/i.test(v) ? "" : /^[aeiou]/i.test(v) ? "an " : "a "}${v}` : `${who} looks ${v}`;
  if (path === "position") return `${who} is ${v}`; // "on the path between the lanterns", "bursting out of the pile"
  if (path === "facing") return `${who} faces ${v}`;
  if (path === "hair") return `${who}'s hair is ${v}`;
  if (path === "injuries") return `${who} has ${v}`;
  return `${who}: ${path.replaceAll(/[._]/g, " ")} ${v}`;
}
const cap = (s) => s && s[0].toUpperCase() + s.slice(1);
// F-L02 (SNAP-R165): a Cast's details line folded through the story's state at a beat. A clause the state speaks for (a
// hand, a thing worn or carried that the story moves) goes for this cut when the state disagrees with it ("a steel ladle
// in her right hand" while her right hand is empty at b2), named with the beat and change that override it; a clause
// the state agrees with stays, look words and all. {line, left_out: [{clause, path, value, beat, change, said}]}
const HANDS = { right: "carried.right_hand", left: "carried.left_hand" };
const escaped = (s) => s.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
// F-SQ02: the item a carried value names is its head ("the greatsword in its long scabbard on her back" is a greatsword),
// never its place words (back, shoulder), which other clauses share
const nounOf = (story, v) => headOf(String(nameOf(story, v) ?? "")) ?? "";
// a Cast line's clauses: split on commas and semicolons outside brackets ("(hilt above her right shoulder, tip by her left
// calf)" stays one clause)
function clausesOf(line) {
  const out = [];
  let depth = 0, at = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "(" || c === "[") depth++;
    else if ((c === ")" || c === "]") && depth) depth--;
    else if ((c === "," || c === ";") && !depth) { out.push(line.slice(at, i)); at = i + 1; }
  }
  return [...out, line.slice(at)].map((x) => x.trim()).filter(Boolean);
}
const HAIR = /\b(hair|braids?|ponytail|bun|plaits?|fringe|bangs|locks)\b/i; // a hair clause is the person, never something carried
// F-N01 (SNAP-R178): a wardrobe value read as items: its parts ("no apron", "sleeves rolled up"), each with its head (the
// garment it names: the last word before a preposition or a participle, never a colour), its words, and whether it takes
// the item off. The operator hasn't ruled on dropping every clothing clause, so only clauses naming these items fold
const STOP = new Set(["a", "an", "the", "no", "not", "without", "bare", "her", "his", "their", "its", "and", "or", "up", "down", "off", "out", "now"]);
const PREP = new Set(["with", "of", "over", "under", "on", "in", "at", "from", "to", "into", "across", "around", "wearing"]);
const unplural = (w) => w.replace(/(?<=[^s])s$/, "");
const wordsOf = (text) => (String(text).toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => !STOP.has(w)).map(unplural);
const headOf = (part) => { const ws = part.toLowerCase().match(/[a-z]+/g) ?? [], cut = ws.findIndex((w, i) => i > 0 && (PREP.has(w) || (/ed$/.test(w) && w.length > 4 && !COLOURS.includes(w)))); return wordsOf((cut < 0 ? ws : ws.slice(0, cut)).join(" ")).filter((w) => !COLOURS.includes(w)).at(-1) ?? null; };
const GARMENTS = [["coat", "jacket", "cloak", "oilskin", "parka", "cape", "overcoat", "raincoat", "poncho", "haori", "mantle"], ["dress", "gown", "robe", "kimono", "yukata", "frock"], ["shirt", "blouse", "tunic", "sweater", "jumper", "top", "hoodie", "vest", "waistcoat"], ["trouser", "pant", "skirt", "short", "jean", "hakama", "legging"], ["boot", "shoe", "sandal", "geta", "slipper", "clog"], ["hat", "cap", "hood", "helmet", "bonnet", "headband", "bandana", "kerchief"], ["apron", "smock", "pinafore"], ["armour", "armor", "breastplate"], ["suit"], ["scarf", "shawl", "stole"], ["glove", "gauntlet", "mitten"]];
const garmentClass = (w) => GARMENTS.findIndex((g) => g.includes(w));
export function wardrobeItems(story, value) {
  const text = [value].flat().filter(Boolean).map((v) => nameOf(story, v)).join(", ");
  return text.split(/\s*(?:[,;]|\band\b)\s*/i).filter(Boolean).map((part) => {
    const off = /^(no|without|not wearing|bare)\b/i.test(part) || /\b(off|removed)$/i.test(part), item = part.replace(/^(no|without|not wearing)\s+/i, "");
    return { part, off, head: headOf(item), words: wordsOf(item) };
  }).filter((x) => x.head);
}
export function foldCastLine(story, ref, line, fields) {
  if (!line) return { line: line ?? "", left_out: [], lint: [] };
  const things = new Set();
  for (const b of story.beats) for (const c of b.changes.filter((x) => x.entity === ref && /^carried\./.test(x.path))) for (const v of [c.value].flat()) if (v && typeof v === "string") things.add(nounOf(story, v));
  for (const b of story.beats) for (const c of b.changes.filter((x) => x.entity.startsWith("prop:") && x.path === "holder" && x.value === ref)) things.add(nounOf(story, c.entity));
  const holds = (path, noun) => [fields[path]?.value].flat().some((v) => v && typeof v === "string" && nounOf(story, v) === noun);
  const where = (noun) => Object.keys(fields).filter((p) => /^carried\./.test(p) && holds(p, noun));
  // F-N01: the items a wardrobe change of this person names anywhere in the story, and the wardrobe at this moment
  const ward = fields.wardrobe?.value != null ? wardrobeItems(story, fields.wardrobe.value) : [], items = new Set(ward.map((x) => x.head));
  for (const b of story.beats) for (const c of b.changes.filter((x) => x.entity === ref && x.path === "wardrobe")) for (const x of wardrobeItems(story, c.value)) items.add(x.head);
  const keep = [], left_out = [], lint = [];
  for (const clause of clausesOf(line)) {
    const side = clause.match(/\b(right|left) hand\b/i)?.[1]?.toLowerCase(), hand = side && HANDS[side];
    const noun = HAIR.test(clause) ? null : [...things].find((n) => n && new RegExp(`\\b${escaped(n)}e?s?\\b`, "i").test(clause)), said = new Set(wordsOf(clause)), head = headOf(clause);
    let by = null;
    if (noun) {
      const now = where(noun), agree = hand ? now.includes(hand) : now.includes("carried.worn");
      if (!agree && hand && fields[hand]) by = hand;
      else if (!agree && now.length) by = now[0];
      else if (!agree && !hand && (fields["carried.worn"] || fields.wardrobe)) by = fields["carried.worn"] ? "carried.worn" : "wardrobe";
    } else if (hand && fields[hand]) by = hand;
    // F-N01: a clause that is an item the story's wardrobe moves goes, unless the wardrobe here says that item the same way
    // ("green apron" under "no apron": out; "oilskin coat" under "the oilskin": kept, look words and all)
    else if (fields.wardrobe && items.has(head) && !ward.some((x) => !x.off && x.head === head && x.words.every((w) => said.has(w)))) by = "wardrobe";
    if (!by) {
      keep.push(clause);
      // what the narrow fold leaves, as lint: a clause that mentions an item the wardrobe words otherwise ("white blouse with
      // long sleeves" under "sleeves rolled up"), or a garment of the same kind ("green coat" under "the oilskin")
      const clash = fields.wardrobe && ward.find((x) => (said.has(x.head) && (x.off || !x.words.every((w) => said.has(w)))) || (!x.off && !said.has(x.head) && garmentClass(x.head) >= 0 && [...said].some((w) => garmentClass(w) === garmentClass(x.head))));
      if (clash) lint.push(`${nameOf(story, ref)}'s Cast line says '${clause}' while the wardrobe is ${clash.part} (${fields.wardrobe.beat} ${fields.wardrobe.change}): check they agree (a wardrobe change leaves out only the clauses that are its items)`);
      continue;
    }
    const f = fields[by];
    left_out.push({ clause, path: by, value: f.value ?? null, beat: f.beat, change: f.change, said: `Cast line '${clause}' left out: ${f.beat} ${f.change} (${by} ${f.value == null || (Array.isArray(f.value) && !f.value.length) ? "is empty" : `is ${[f.value].flat().map((v) => nameOf(story, v)).join(", ")}`})` });
  }
  return { line: keep.join(", "), left_out, lint };
}
// F-L02 / F-L09 (SNAP-R165, SNAP-R168): words of a beat or the blocking that put a thing in a hand where the state puts
// it elsewhere ("the bowl raised to his lips" while the bowl is on the counter; "the ladle in her right hand" while that
// hand is empty), as lint lines: the compile says it, and the person or the writer settles it
const HAND_WORDS = /\b(hands?|holds?|holding|raised?|raising|lifts?|lifting|grips?|gripping|carr(?:y|ies|ying)|lips)\b/i;
function stateLint(story, unit, present, entities) {
  const out = [], people = entities.filter((e) => e.ref.startsWith("cast:")), things = new Set();
  for (const b of story.beats) for (const c of b.changes) { if (c.entity.startsWith("prop:")) things.add(nounOf(story, c.entity)); if (/^carried\./.test(c.path)) for (const v of [c.value].flat()) if (v && typeof v === "string") things.add(nounOf(story, v)); }
  const names = (clause, noun) => noun && new RegExp(`\\b${escaped(noun)}e?s?\\b`, "i").test(clause), low = (x) => x.replace(/^(The|A|An) /, (m) => m.toLowerCase());
  for (const [text, where] of [...present.map((b) => [b.text, `${b.id}'s text`]), ...(unit.blocking ? [[unit.blocking, "the blocking"]] : [])]) for (const clause of String(text ?? "").split(/(?<=[.;!?])\s+|,\s+/).filter((x) => HAND_WORDS.test(x))) {
    for (const e of entities.filter((x) => x.ref.startsWith("prop:"))) {
      const holder = e.fields.find((f) => f.path === "holder");
      if (holder?.value && !String(holder.value).startsWith("cast:") && names(clause, nounOf(story, e.ref))) out.push(`${where} says "${clause.trim()}" while ${low(holder.sentence ?? `${e.name} is ${holder.value}`)} (${holder.beat} ${holder.change}): check they agree`);
    }
    for (const e of people.filter((x) => people.length === 1 || new RegExp(`\\b${escaped(x.name.split(" ")[0])}\\b`, "i").test(clause))) for (const f of e.fields.filter((x) => /^carried\.(right|left)_hand$/.test(x.path))) {
      const side = f.path.includes("right") ? "right" : "left", noun = [...things].find((n) => names(clause, n));
      if (new RegExp(`\\b${side} hand\\b`, "i").test(clause) && noun && !(f.value && nounOf(story, f.value) === noun)) out.push(`${where} says "${clause.trim()}" while ${f.sentence} (${f.beat} ${f.change}): check they agree`);
    }
  }
  // F-N01: the beat's words or the blocking still putting on an item the wardrobe takes off ("wipes her hands on her apron"
  // while Aya wears no apron); the words that take it off, and the beat that does, aren't a contradiction
  const OFF_WORDS = /\b(takes? off|took off|taking off|removes?|removing|unties?|untying|sheds?|shedding|drops?|without|no)\b/i;
  for (const e of people) for (const f of e.fields.filter((x) => x.path === "wardrobe" && x.value != null)) for (const x of wardrobeItems(story, f.value).filter((x) => x.off)) {
    for (const [text, where] of [...present.filter((b) => b.id !== f.beat).map((b) => [b.text, `${b.id}'s text`]), ...(unit.blocking ? [[unit.blocking, "the blocking"]] : [])]) for (const clause of String(text ?? "").split(/(?<=[.;!?])\s+|,\s+/).filter((c) => !OFF_WORDS.test(c))) {
      if (names(clause, x.head) && (people.length === 1 || new RegExp(`\\b${escaped(e.name.split(" ")[0])}\\b`, "i").test(clause))) out.push(`${where} says "${clause.trim()}" while ${f.sentence ?? `${e.name} wears ${f.value}`} (${f.beat} ${f.change}): check they agree`);
    }
  }
  return out;
}
// a change as a person reads it:"Kon's carried.right_hand → none (hands over the letter)"
// an op as its sign (F-L08: a remove read as "→ the ladle", the reverse of what it does)
export const OP_SIGN = { set: "→", add: "+", remove: "−", note: "note:" };
export const changeText = (story, c) => `${nameOf(story, c.entity)}'s ${c.path} ${OP_SIGN[c.op ?? "set"] ?? c.op} ${c.value == null ? "none" : Array.isArray(c.value) ? c.value.map((v) => nameOf(story, v)).join(", ") : nameOf(story, c.value)}${c.why ? ` (${c.why})` : ""}`;
// F-L11: a prop and the people who carry it agree. Who carries or wears a prop at a beat (a person's carried.* names it)
export function carriersOf(story, prop, beatId) {
  return entitiesOf(story).filter((e) => e.startsWith("cast:")).flatMap((who) => Object.entries(stateAt(story, who, beatId)).filter(([path, f]) => /^carried\./.test(path) && [f.value].flat().includes(prop)).map(([path, f]) => ({ who, path, beat: f.beat, change: f.change })));
}
// where a prop's holder and its carriers disagree at a beat, in words (a holder unset while someone carries it is fine: the
// carrier holds it)
export function propMismatch(story, beatId) {
  const props = [...new Set([...(story.props ?? []).map((p) => `prop:${p.id}`), ...entitiesOf(story).filter((e) => e.startsWith("prop:")), ...story.beats.flatMap((b) => b.changes.filter((c) => /^carried\./.test(c.path)).flatMap((c) => [c.value].flat()).filter((v) => typeof v === "string" && v.startsWith("prop:")))])];
  const out = [];
  for (const prop of props) {
    const hold = stateAt(story, prop, beatId).holder, carry = carriersOf(story, prop, beatId), name = nameOf(story, prop), said = (c) => `${nameOf(story, c.who)}'s ${c.path} names it (${c.beat} ${c.change})`;
    if (hold?.value && carry.length && !carry.some((c) => c.who === hold.value)) out.push({ prop, text: `${name}'s holder is ${nameOf(story, hold.value)} (${hold.beat} ${hold.change}) while ${carry.map(said).join(" and ")}` });
    else if (String(hold?.value ?? "").startsWith("cast:") && !carry.length) out.push({ prop, text: `${name}'s holder is ${nameOf(story, hold.value)} (${hold.beat} ${hold.change}) while nothing ${nameOf(story, hold.value)} carries or wears names it` });
  }
  return out;
}
// the Beat sheet's flags: each mismatch at the first beat it shows (story order), never blocking
export function propFlags(story) {
  const seen = new Map(), out = [];
  for (const b of story.beats) { const now = new Map(propMismatch(story, b.id).map((m) => [m.prop, m.text.replace(/\([^)]*\)/g, "")])); for (const [prop, key] of now) if (seen.get(prop) !== key) out.push(`${b.id}: ${propMismatch(story, b.id).find((m) => m.prop === prop).text}`); for (const prop of seen.keys()) if (!now.has(prop)) seen.delete(prop); for (const [k, v] of now) seen.set(k, v); }
  return out;
}
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
export function stateFor(cast, fields) {
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
// `beats` compiles the unit at other beats than its own (the Beat slot: the same shot at another story moment)
export async function compile(sceneId, shotId, { story: draft = null, beats: at_ = null } = {}) {
  await Promise.all([W.load(), SC.load(), T.load(), L.ready()]);
  const { scene, shot, book, unit } = unitOf(sceneId, shotId), st = book.body.story ? storyOf(book.body) : null, story = draft ?? st?.body ?? cleanStory({});
  const beats = (at_ ?? unit.beats ?? []).map((id) => story.beats.find((b) => b.id === id) ?? { id, missing: true }), present = beats.filter((b) => !b.missing);
  const at = present.length ? present.reduce((a, b) => (b.order > a.order ? b : a)) : null; // the unit's moment: its latest beat in story order
  const style = styleOf(book.body), sentences = [], package_ = [], lint = [], from = {}, words = [];
  const S = (text) => cap(text.replace(/\.?$/, "."));
  const say = (text, src) => { if (text) sentences.push({ text: S(text), from: src }); };
  // F-L09 (SNAP-R168): a cut opens on the state before its own beats (the beat before them in story order) and ends on
  // the state after; the still parts are kept apart so the opening board draws the start and the key drawing the end
  const own = new Set(present.map((b) => b.id)), prev = at ? story.beats.filter((b) => b.order < at.order && !own.has(b.id)).reduce((x, b) => (!x || b.order > x.order ? b : x), null) : null;
  const head = [], tail = [], ends = [], opens = [], whoEnd = [], whoOpen = [], held = [];
  let moved = false;
  for (const b of present) { say(b.text, `story ${b.id} text`); if (b.text) head.push(S(b.text)); from[`${b.id}.text`] = b.text; }
  // F-F09: the unit's own blocking and camera are the cut's action too (a cut whose beats wait as proposals still moves)
  if (unit.blocking) { say(unit.blocking, "the unit's blocking"); head.push(S(unit.blocking)); }
  if (unit.camera) { say(`Camera: ${unit.camera}`, "the unit's camera"); head.push(S(`Camera: ${unit.camera}`)); }
  const waiting = waitingBeats(book);
  for (const b of beats.filter((x) => x.missing)) lint.push(waiting.has(b.id) ? `beat ${b.id} is waiting in proposal ${waiting.get(b.id)} (not accepted yet): the unit compiles without it until the person accepts` : `beat ${b.id} isn't in the story any more: the unit compiles without it`);
  // entities: the unit's Cast, then any other entity the story changes that the unit names (props)
  const castRefs = unit.cast ?? [], other = entitiesOf(story).filter((e) => !e.startsWith("cast:") && (unit.props ?? []).includes(e));
  const entities = [];
  for (const ref of [...castRefs, ...other]) {
    const got = ref.startsWith("cast:") ? W.get(ref) : null, body = got?.version.body, name = nameOf(story, ref), fields = at ? stateAt(story, ref, at.id) : {}, opening = prev ? stateAt(story, ref, prev.id) : {};
    const state = ref.startsWith("cast:") ? stateFor(body, fields) : null, rows = [];
    for (const [path, f] of Object.entries(fields)) {
      const text = sentence(story, name, path, f.value), provenance = `${st ? `story:${st.id}@${st.n}` : "draft"} ${f.beat} change ${f.change}`;
      from[`${ref}.${path}`] = JSON.stringify([f.value, f.beat, f.change]);
      const pictured = state && Object.keys(state.covers ?? {}).includes(path), here = own.has(f.beat), was = here ? opening[path] ?? null : null, wasText = was ? sentence(story, name, path, was.value) : null;
      rows.push({ path, value: f.value, beat: f.beat, change: f.change, ...(f.why ? { why: f.why } : {}), provenance, ...(text ? { sentence: S(text) } : { prose_only: true }), backing: pictured ? `picture: state ${state.name}` : text ? "words only" : "not shown in a picture",
        ...(here ? { opens: was ? { value: was.value, beat: was.beat, change: was.change, ...(wasText ? { sentence: S(wasText) } : {}) } : { value: null, said: "not set before this beat (the Cast's own look)" } } : {}) });
      if (here && text) moved = true;
      // F-Q09 (SNAP-R181): the cut's own beat changes what a hand holds (or where a prop is held): its action words belong
      // to the end, so an opening drawn under them mixes the two (the ladle still in her hand "with both hands"); a hand that
      // takes something up from nothing opens empty, which agrees with the action
      const empty = f.value == null || (Array.isArray(f.value) && !f.value.length);
      if (here && (/^carried\.(right|left)_hand$/.test(path) || (!ref.startsWith("cast:") && path === "holder")) && (was || empty) && JSON.stringify(was?.value ?? null) !== JSON.stringify(f.value ?? null)) held.push({ who: name, path, beat: f.beat, ...(wasText ? { opens: S(wasText) } : {}), ...(text ? { ends: S(text) } : {}), ...(empty && was?.value ? { put_down: [was.value].flat().filter((v) => typeof v === "string").map((v) => nameOf(story, v)).join(", ") } : {}) }); // F-S05: what the beat takes out of the hand
      if (here && wasText && wasText !== text) { say(`At the start of the cut, ${wasText}`, `${was.beat} change ${was.change} (before ${f.beat})`); if (text) say(`By the end, ${text}`, provenance); }
      else if (text) say(text, provenance);
      if (text) ends.push(S(text));
      const openText = here ? wasText : text; // a field this beat sets with nothing before it isn't said at the opening
      if (openText) opens.push(S(openText));
    }
    // F-L02: the Cast's details line as this cut tells it, at its end and at its opening
    const line = body ? L.castLine(body) : "", endLine = foldCastLine(story, ref, line, fields), openLine = foldCastLine(story, ref, line, opening);
    lint.push(...endLine.lint, ...openLine.lint.filter((x) => !endLine.lint.includes(x))); // F-N01: what the narrow wardrobe fold leaves
    if (endLine.line) whoEnd.push(`${name} is ${endLine.line}.`);
    if (openLine.line) whoOpen.push(`${name} is ${openLine.line}.`);
    if (body?.refs?.length) for (const [i, r] of body.refs.entries()) package_.push({ file: r.file, role: `cast: ${body.name}, ${r.role}`, why: `identity, ${ref}@${got.version.n}`, from: ref, order: state ? 2 : 1, i });
    if (state) for (const p of state.pictures ?? []) package_.push({ file: p.file, role: `state: ${state.name}${p.view ? `, ${p.view}` : ""}`, why: `${body.name} at ${at.id} is in state ${state.name}`, from: ref, order: 1 });
    if (style && style.body.palette !== "full" && body) {
      const found = colourWords(line), stated = colourWords(rows.map((r) => r.sentence).join(" "));
      if (found.length) lint.push(`${body.name}'s Cast line names colours (${found.join(", ")}) and the style is ${style.body.palette}: a colour word in a subject beats the style's palette (style scout 2026-11-06); take them out of the Cast line for this Book if the picture should keep the palette`);
      if (stated.length) lint.push(`${body.name}'s state names colours (${stated.join(", ")}) under a ${style.body.palette} style`);
    }
    if (body?.voice?.file) words.push({ cast: ref, name: body.name });
    entities.push({ ref, name, ...(got ? { n: got.version.n } : {}), fields: rows, ...(state ? { state: state.name } : {}), ...(ref.startsWith("cast:") && !got ? { missing: true } : {}),
      ...(body ? { cast_line: { line: endLine.line, ...(endLine.left_out.length ? { left_out: endLine.left_out } : {}), ...(openLine.line !== endLine.line ? { opens: openLine.line } : {}) } } : {}) });
  }
  // F-L02: what the state still contradicts after the fold (the blocking or a beat naming a thing in a hand, or a prop
  // put somewhere else), as lint: the compile says it, the person or the writer settles it
  lint.push(...stateLint(story, unit, present, entities));
  if (held.length) lint.push(`${unit.cut ?? "This cut"}'s own beat ${held[0].beat} changes what is held (${held.map((x) => x.opens ?? `${x.who} as the Cast line has them.`).join(" ")} → ${held.map((x) => x.ends ?? `${x.who}: nothing`).join(" ")}): an opening board would draw the hands before the beat under its action words ("${present.map((b) => b.text).filter(Boolean).join(" ")}"), so make_board draws the key (the beat at its peak) unless role: "opening" is asked (F-Q09)`);
  if (at) lint.push(...propMismatch(story, at.id).filter((m) => (unit.props ?? []).includes(m.prop) || carriersOf(story, m.prop, at.id).some((c) => castRefs.includes(c.who))).map((m) => `${m.text}: check they agree (F-L11)`));
  // dialogue on the unit's beats, each line citing the speaker's voice reference (voice scout 2026-11-06: no voice words)
  const lines = present.flatMap((b) => (b.lines ?? []).map((l) => ({ ...l, beat: b.id })));
  for (const l of lines) { const who = nameOf(story, l.who), text = `${who} says "${l.text}"${words.some((x) => x.cast === l.who) ? ` in the voice of {voice:${l.who}}` : ""}`; from[`${l.beat}.line.${l.who}`] = l.text; say(text, `story ${l.beat} line`); tail.push(S(text)); }
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
  // SNAP-R236 (the operator, 2026-11-07; F-SQ23): an insert cites a frame of its master: that cut's active take at at_s
  let master = null;
  const closeUp = /\b(ECU|MCU|CU|close[- ]?up|insert|detail)\b/i.test(unit.camera ?? "");
  if (unit.master) {
    const m = units(book).find((x) => x.unit.cut === unit.master.cut), t = m?.shot.active && T.get(m.shot.active);
    if (!m) lint.push(`master ${unit.master.cut}: no such cut in this Book; the cuts: ${units(book).map((x) => x.unit.cut).filter(Boolean).join(", ")}`);
    else if (!t) lint.push(`master ${unit.master.cut} has no active take yet: the continuity frame comes in when it has one`);
    else {
      const f = await T.frameAt(t, unit.master.at_s, { crop: unit.master.crop }).catch((e) => ({ error: e.message }));
      if (f.error) lint.push(`master ${unit.master.cut}: its take ${t.number}'s frame at ${unit.master.at_s} s can't be read: ${f.error}`);
      else {
        master = { cut: unit.master.cut, take: t.id, number: t.number, at_s: unit.master.at_s, frame: f.frame, file: f.file, ...(unit.master.crop ? { crop: unit.master.crop } : {}) };
        package_.push({ file: f.file, role: `continuity: ${unit.master.cut} at ${unit.master.at_s} s`, why: "an insert cites a frame of its master shot (the operator, 2026-11-07)", from: "master", order: -0.5 });
        from.master = `${t.id}@${f.frame}${unit.master.crop ? `:${unit.master.crop.join(",")}` : ""}`;
      }
    }
  } else if (closeUp) lint.push(`this cut reads like an insert or close-up (camera "${unit.camera}") and names no master: set_unit {master: {cut: "C8", at_s: 1.9}} cites a frame of the shot it cuts in from, so light, colours and background match (SNAP-R236)`);
  // F-SQ20: a key picture cited inside the action made H3 jump-cut to it; the key belongs in apply_unit's closing hint
  const cited = [...present.map((b) => b.text), unit.blocking, unit.camera].filter((x) => /<Picture \d+>/.test(x ?? ""));
  if (cited.length) lint.push(`the action cites a picture ("${cited[0]}"): citing a key board inside the action made H3 jump-cut to it and stall the clash (F-SQ20); write the motion out, and the key stays in the closing hint apply_unit writes`);
  // every speaking Cast needs a voice reference, or its voice can't be checked (SNAP-R237)
  for (const who of new Set(lines.map((l) => l.who))) if (who.startsWith("cast:") && !W.get(who)?.version.body.voice?.file) lint.push(`${nameOf(story, who)} speaks here and has no Cast voice reference: the voice can't be held or checked (snap-voice: use_take {as: "voice"} on a take of theirs)`);
  // SNAP-R230/R231: the cut's dial rows, what they give over the clip, and what to look at
  let dials = null;
  if (unit.dials) {
    const open = SC.current()?.shot.id === shot.id, pipe = open ? M.pipeline() : null, fam = open ? D.family() : null, speaks = lines.length > 0, length = unit.timing?.seconds;
    await D.load();
    for (const r of unit.dials) {
      const d = D.find(r.dial), name = D.label(d ?? r), kind = d?.info?.kind, measured = d?.info?.pipelines ?? {}, here = pipe && measured[pipe], top = r.time?.type === "keys" ? Math.max(...r.time.points.map((x) => x[1])) : 1, peak = r.strength * top;
      if (!d) { lint.push(`${r.dial} isn't installed here: the rack fails at run time (list_dials lists the dials)`); continue; }
      if (fam && d.family !== fam) lint.push(`${name} is a ${d.family} dial and this cut's recipe renders with ${fam}: it fails at run time`);
      if (pipe && Object.keys(measured).length && !here) lint.push(`${name}: measured on ${Object.entries(measured).map(([k, v]) => `${k}${v.useful ? ` (useful ${v.useful})` : ""}`).join(", ")}; this cut is ${pipe}: check its frames`);
      const over = here?.overcook ?? d.info?.pos?.overcook;
      if (over && Math.abs(peak) > over) lint.push(`${name} peaks at ${+peak.toFixed(3)}, past its overcook ${over}${here ? ` on ${pipe}` : ""}`);
      if (closeUp && r.on !== false && (kind === "look" || kind === "light" || !kind)) lint.push(`${name} at ${+peak.toFixed(3)} on a close-up${kind ? "" : " (if it is a look or light dial)"}: close-ups needed half the wide's strength on the one dial measured (dramatic light 1.5 vs 3.0, bake-off round 3); a held look row at 3 replaced a face within a second (F-SQ21)`);
      if (kind === "weather" && r.time?.audio === "protect") lint.push(`${name} is a weather dial: protect is partial for weather, the sound follows the action (+3.4 LU, F-SQ22); plan the attack's sound in post`);
      if (speaks && r.time && r.time.audio !== "protect") lint.push(`${name} runs audio: ${r.time.audio} on a speaking cut: every look or mood row on a speaking cut runs audio: protect (dials steer voices)`);
      const late = r.time?.type === "keys" && r.time.unit === "seconds" && length ? r.time.points.filter(([t]) => t > length + 0.5) : [];
      if (late.length) lint.push(`${name}: key${late.length > 1 ? "s" : ""} at ${late.map(([t]) => `${t} s`).join(", ")} past the cut's ${length} s: the curve holds flat after the clip ends`);
    }
    dials = { rows: unit.dials, ...(pipe ? { pipeline: pipe } : { pipeline: null, pipeline_note: "the cut's shot isn't open: the pipeline (and its measured numbers) is read from its recipe when it is" }), effective: unit.dials.map(D.effective) };
    from.dials = JSON.stringify(unit.dials);
  }
  const pictures = package_.sort((a, b) => a.order - b.order).map(({ order: _, i: __, ...p }) => p);
  if (style) from.style = `${style.ref}`;
  const budget = 9, dropped = pictures.slice(budget).map((p) => p.role);
  const description = [style?.body.paragraph, ...sentences.map((s) => s.text)].filter(Boolean).join(" ");
  // a still has no Cast brick to add each Cast's line (apply_unit's applyCast does it for video): the subject says who each
  // one is, so a board doesn't draw a lantern spirit with a girl's body (U97 GPU board, C2); the line folded at its moment
  const still = (fieldsSaid, who) => [style?.body.paragraph, [...head, ...fieldsSaid, ...tail, ...who].join(" ")].filter(Boolean).join("\n\n");
  const out = {
    book: book.ref ?? `book:${book.id}`, scene: scene.id, shot: shot.id, cut: unit.cut ?? null, unit_kind: unit.kind ?? "cut",
    story: st ? { ref: st.ref, n: st.n } : null, at: at ? { beat: at.id, order: at.order, told: at.told, text: at.text, ...(at.intent ? { intent: at.intent } : {}), ...(at.intensity ? { intensity: at.intensity } : {}) } : null,
    ...(present.length ? {} : { note: beats.some((b) => waiting.has(b.id)) ? `no accepted beat yet (${beats.filter((b) => waiting.has(b.id)).map((b) => `${b.id} waits in ${waiting.get(b.id)}`).join(", ")}): this unit compiles from the Cast's base and its own blocking and camera` : "no beat: this unit compiles from the Cast's base, as any shot does" }),
    style: style ? { ref: style.ref, name: style.body.name, palette: style.body.palette, ...(style.body.still ? { still: style.body.still.file } : {}) } : null,
    entities, place, package: pictures, budget: { used: Math.min(pictures.length, budget), of: budget, ...(dropped.length ? { over: dropped } : {}) },
    prompt: { description, sentences, soundscape: unit.sound ?? "", music: unit.music ?? "N/A" },
    still_prompt: still(ends, whoEnd),
    ...(moved ? { opens: { after: prev?.id ?? null, said: `the cut opens on the state ${prev ? `after ${prev.id}` : "before any beat"} and ends on the state after ${at.id}: the opening board draws the start, the key drawing the end`, still_prompt: still(opens, whoOpen), ...(held.length ? { held, board_role: "key" } : {}) } } : {}),
    ends: at ? { beat: at.id } : null,
    speakers: [...new Set(lines.map((l) => l.who))], transition: unit.transition ?? null, timing: unit.timing ?? null, ...(dials ? { dials } : {}), ...(master ? { master } : {}), lint,
    from: Object.fromEntries(await Promise.all(Object.entries(from).map(async ([k, v]) => [k, W.short(await W.sha(v))]))),
  };
  out.board = await boardPackage(out).catch((e) => ({ error: e.message }));
  return out;
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
  if (u.key !== undefined) out.key = u.key; // F-F16: the beat's peak, a reference the cut builds to (the board is what it opens on)
  for (const k of ["dials", "master"]) if (u[k] !== undefined) { if (u[k] === null) delete out[k]; else out[k] = u[k]; } // SNAP-R230 rows; SNAP-R236 the insert's master
  if (out.master && (typeof out.master.cut !== "string" || !Number.isFinite(out.master.at_s) || out.master.at_s < 0 || (out.master.crop != null && !(Array.isArray(out.master.crop) && out.master.crop.length === 4 && out.master.crop.every((v) => typeof v === "number" && v >= 0 && v <= 1)))))
    throw new Error(`master is {cut: "C8", at_s: <seconds into its active take>, crop?: [x, y, width, height] in fractions}; not ${JSON.stringify(out.master)}`);
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

// ---- the board's package: what make_board sends, and compile_unit shows (SNAP-R131, F-F03) ---------------------------
// the context pictures with their labels and the still prompt citing each by number: the plate as the camera (or the
// master as the place), the nearest prior view (F-L20, SNAP-R170: the cut's own approved board when it has one, so a
// re-board keeps its blocking; else the previous cut's board in telling order; or `context` when given: [{cut} its
// board, {take, frame}, {file, label}], F-F16), the Cast's state and identity pictures. role: opening draws the state
// the cut opens on (F-L09), key the state at the beat's peak; the role sentence is part of the prompt (F-L14)
const ROLE_LINE = { opening: "This frame is the moment the cut starts, before the beat's peak.", key: "This frame is the beat at its peak." };
// F-Q09 (SNAP-R181): a cut whose own beat changes what a hand holds is boarded at its key by default; else its opening
export const boardRole = (sheet) => (sheet.opens?.board_role === "key" ? "key" : "opening");
export async function boardPackage(sheet, { context = null, role = boardRole(sheet) } = {}) {
  const { book, unit } = unitOf(sheet.scene, sheet.shot), list = units(book), i = list.findIndex((x) => x.shot.id === sheet.shot), near = [];
  const own = unit.board?.file && unit.board.approved ? [{ file: unit.board.file, label: `${unit.cut ?? "this cut"}'s approved board`, keep: "keep its blocking: who stands or sits where, facing which way" }] : null;
  // SNAP-R236: an insert's master frame is its nearest prior view, unless it has its own approved board or context says
  const master = sheet.master ? [{ file: sheet.master.file, label: `${sheet.master.cut} at ${sheet.master.at_s} s, the shot this insert cuts in from`, keep: "keep its light, colours and background" }] : null;
  for (const c of context ?? own ?? master ?? (list[i - 1]?.unit.board?.file ? [{ file: list[i - 1].unit.board.file, label: "the previous cut's board" }] : [])) {
    if (c.cut) { const u = list.find((x) => x.unit.cut === c.cut); if (!u?.unit.board?.file) throw new Error(`context: ${u ? `${c.cut} has no board yet` : `no cut ${c.cut}; the cuts: ${list.map((x) => x.unit.cut).join(", ")}`}`); near.push({ file: u.unit.board.file, label: c.cut === unit.cut ? `${c.cut}'s own board` : `${c.cut}'s board`, ...(c.cut === unit.cut ? { keep: "keep its blocking: who stands or sits where, facing which way" } : {}) }); }
    else if (c.take) { const t = T.find(c.take); if (!t) throw new Error(`context: no take ${c.take}`); const f = await T.frameAt(t, "last", { frame: c.frame ?? (t.media.some((m) => m.kind === "video") ? undefined : 0) }); near.push({ file: f.file, label: c.label ?? `take ${t.number}`, ...(c.keep ? { keep: c.keep } : {}) }); }
    else if (c.file) near.push({ file: c.file, label: c.label ?? c.file, ...(c.keep ? { keep: c.keep } : {}) });
    else throw new Error("context: each picture is {cut}, {take, frame} or {file, label}");
  }
  const pictures = [...(unit.location ? [{ location: unit.location, plate: unit.plate ?? "master", label: unit.plate ? `${unit.cut}'s camera` : "the place" }] : []), ...near.map(({ keep: _, ...n }) => n),
    ...sheet.package.filter((p) => p.role.startsWith("state: ") || p.role.startsWith("cast: ")).map((p) => ({ file: p.file, label: p.role }))];
  const at = unit.location ? 1 : 0, cast = sheet.entities.filter((e) => e.ref.startsWith("cast:")).map((e) => { const n = pictures.map((p, k) => (sheet.package.some((x) => x.file === p.file && x.from === e.ref) ? `<Picture ${k + 1}>` : null)).filter(Boolean); return n.length ? `${e.name} is ${n.join(" and ")}.` : null; });
  const cites = [unit.location ? `<Picture 1> is ${unit.plate ? "this cut's camera on the place: keep its framing" : "the place"}.` : null, ...near.map((n, k) => `<Picture ${at + k + 1}> is ${n.label}: ${n.keep ?? "the same place and light"}.`), ...cast].filter(Boolean).join(" ");
  const still = role === "key" ? sheet.still_prompt : sheet.opens?.still_prompt ?? sheet.still_prompt;
  // F-S05 (SNAP-R189): pictures beat words, so what the drawn frame's state takes away is said absent even where a
  // context picture shows it: a thing the cut's own beat puts down (the key is drawn after it, the boards around it
  // before), and a Cast line clause the state leaves out (the Cast's own picture still shows it). The key board's pin
  // keeps the list, so its critic packet asks the critic to look for each one
  const absent = [];
  if (role === "key" || !sheet.opens) {
    for (const x of sheet.opens?.held ?? []) if (x.put_down) absent.push({ who: x.who, thing: x.put_down, path: x.path, beat: x.beat });
    for (const e of sheet.entities) for (const l of e.cast_line?.left_out ?? []) if (l.value == null || (Array.isArray(l.value) && !l.value.length)) {
      const same = absent.find((a) => a.who === e.name && a.path === l.path);
      if (same) same.clause = l.clause; else absent.push({ who: e.name, thing: l.clause, clause: l.clause, path: l.path, beat: l.beat });
    }
  }
  const shows = (a) => pictures.map((p, k) => (near.some((n) => n.file === p.file) || (a.clause && p.label.startsWith("cast: ") && sheet.package.some((x) => x.file === p.file && sheet.entities.some((e) => e.ref === x.from && e.name === a.who))) ? `<Picture ${k + 1}>` : null)).filter(Boolean);
  const unsaid = absent.map((a) => ({ ...a, shows: shows(a) })).filter((a) => a.shows.length);
  const lines = unsaid.map((a) => `${a.who} is without ${a.thing} in this frame, even where ${a.shows.join(" and ")} show${a.shows.length > 1 ? "" : "s"} it.`);
  const lint = unsaid.map((a) => `${a.shows.join(" and ")} may show ${a.thing} with ${a.who}, which the state leaves out here (${a.beat}, ${a.path}): the board prompt says it is absent, and the critic packet lists it (F-S05)`);
  return { role, ...(own && !context ? { context: `${own[0].label} (re-boarding keeps its blocking; give context to choose another)` } : {}), pictures, prompt: [still, cites, ...lines, ROLE_LINE[role] ?? ROLE_LINE.opening].filter(Boolean).join(" "),
    ...(unsaid.length ? { absent: unsaid.map(({ who, thing, path, beat, shows: on }) => ({ who, thing, path, beat, shows: on })), lint } : {}) };
}

// ---- apply a compile to the open recipe (the Snap chain of the unit's shot) ------------------------------------------
// land (F-L10, SNAP-R166): {scene, shot}, another shot (any scene) to compile into: the unit's shot and the Cut stay as
// they are, and the takes made there pin the story and the unit they were compiled from (a test render at a moment)
export async function apply(sceneId, shotId, { by = "agent", beats = null, land = null } = {}) {
  const sheet = await compile(sceneId, shotId, { beats }), { unit } = unitOf(sceneId, shotId);
  const to = land ? { scene: land.scene, shot: land.shot } : { scene: sceneId, shot: shotId };
  if (land) {
    const s = SC.get(land.scene);
    if (!s || !land.shot) throw new Error(`land is {scene, shot}: a shot to compile into${s ? "" : ` (no scene ${land.scene})`}; add_shot {scene, from: {scene: "${sceneId}", shot: "${shotId}"}} makes one that starts from ${unit.cut ?? "this cut"}'s recipe`);
    SC.shotOf(s, land.shot);
    if (land.shot === shotId) throw new Error(`land is the cut's own shot: leave land out to apply ${unit.cut ?? "it"} in place`);
  }
  if (SC.current()?.shot.id !== to.shot) await SC.openShot(to.scene, to.shot);
  if (!E.state().bricks.some((b) => b.key === "render")) throw new Error(`${land ? "The shot to land in" : unit.cut ?? "This cut"} has no recipe yet: start_recipe first (it opens on the shot), then apply_unit again`);
  const said = [], number = units(bookOfScene(sceneId)).findIndex((x) => x.shot.id === shotId) + 1, refs = () => E.state().bricks.find((x) => x.key === "refs");
  const t = unit.timing?.seconds && E.timing("render");
  if (t) {
    let f = E.framesFor(t, `${unit.timing.seconds}s`);
    while (E.seconds(t, f) < unit.timing.seconds) f += t.step; // F-F09: the next length the model takes, never a shorter one
    E.setValue("render", t.node, t.name, f);
    said.push(`length ${E.seconds(t, f)} s${E.seconds(t, f) !== unit.timing.seconds ? ` (${unit.timing.seconds} s asked: the next length the model takes)` : ""}`);
  }
  const rest = (E.getValue("render", "render", "prompt") ?? "").split("\n").slice(1).filter((l) => !/^(overall_soundscape|non_diegetic_music):/.test(l));
  E.setValue("render", "render", "prompt", [`integrated_multimodal_description: [Shot ${number}] ${sheet.prompt.description}`, `overall_soundscape: ${sheet.prompt.soundscape || "N/A"}`, `non_diegetic_music: ${sheet.prompt.music || "N/A"}`, ...rest].join("\n"));
  const casts = sheet.entities.filter((x) => x.ref.startsWith("cast:") && !x.missing);
  // F-L02: the Cast line as this cut tells it; F-F09 (SNAP-R237): a Cast's voice only on a cut where that Cast has a line
  for (const e of casts) said.push(await L.applyCast(e.ref, { line: e.cast_line?.line ?? null, voice: sheet.speakers.includes(e.ref), why: `no line in ${unit.cut ?? "this cut"}` }));
  for (const e of casts) for (const x of e.cast_line?.left_out ?? []) said.push(`${e.name}: ${x.said}`);
  // state pictures go in after the Cast's own (their source is the Book, so a Cast apply never takes them out)
  for (const p of refs()?.pictures ?? []) if (p.source === `book-state:${shotId}`) E.removePicture(p.node);
  for (const p of sheet.package.filter((x) => x.role.startsWith("state: "))) E.addPicture(p.file, { role: p.role, reason: p.why, source: `book-state:${shotId}` });
  if (unit.location) said.push((await L.applyLocation(unit.location, { plates: unit.plate ? [unit.plate] : [], plan: false, ...(unit.plate ? { camera: unit.plate } : {}) })).said);
  for (const p of refs()?.pictures ?? []) if (p.source === `book-board:${shotId}` || p.source === `book-key:${shotId}`) E.removePicture(p.node);
  if (unit.board?.file && unit.board.approved) {
    E.addPicture(unit.board.file, { role: `board: ${unit.cut}, the cut opens on it`, reason: "the approved board frame (SNAP-R131)", source: `book-board:${shotId}`, first: true });
    said.push("the approved board as a reference picture (Ref2V reads no first frame: for an exact opening, run FL2V with the board as the First frame)");
  }
  if (unit.key?.file) E.addPicture(unit.key.file, { role: `key: ${unit.cut}, the beat's peak`, reason: "the cut's key drawing (F-F16): it builds to it", source: `book-key:${shotId}` });
  for (const p of refs()?.pictures ?? []) if (p.source === `book-master:${shotId}`) E.removePicture(p.node);
  if (sheet.master) E.addPicture(sheet.master.file, { role: `continuity: ${sheet.master.cut} at ${sheet.master.at_s} s`, reason: "an insert cites a frame of its master shot (SNAP-R236)", source: `book-master:${shotId}` });
  // SNAP-R230: the cut owns the rack: exactly its rows, and what was taken off is named
  if (unit.dials) {
    if (!E.state().bricks.some((b) => b.key === "rack")) await E.snap("rack");
    const off = D.replace(unit.dials), name = unit.cut ?? "the cut";
    said.push(`dial rows from ${name}'s plan: ${unit.dials.length ? unit.dials.map((r) => `${D.label(D.find(r.dial) ?? r)} at ${r.strength}${r.time ? " with its time curve" : ""}`).join(", ") : "none"}${off.length ? `; took off the rack: ${off.map((r) => `${D.label(D.find(r.dial) ?? r)} at ${r.strength >= 0 ? "+" : ""}${r.strength}`).join(", ")} (not in ${name}'s plan; set_cut_dials {from_rack: true} adopts the rack into the plan)` : ""}`);
  }
  if (E.state().bricks.some((b) => b.key === "upscale")) said.push("the Upscale brick is in this recipe: its takes come out bigger than the Cut (take it out for the Cut's size)"); // F-F15
  // F-F09: every cite from References as they stand now, after the last picture went in
  const pics = E.references()?.pictures ?? [], heard = E.references()?.audio ?? [], cite = (test) => pics.filter((p) => p.role && test(p.role)).map((p) => p.cite);
  const board = cite((r) => r.startsWith(`board: ${unit.cut}`)), key = cite((r) => r.startsWith(`key: ${unit.cut}`)), cam = cite((r) => r.startsWith("location: ") && r.endsWith("(camera)")),
    place = cite((r) => r.startsWith("location: ") && r.endsWith("(place)"));
  const who = casts.map((e) => [e.name, pics.filter((p) => p.role?.startsWith(`cast: ${e.name},`) || (p.role?.startsWith("state: ") && sheet.package.some((x) => x.from === e.ref && x.file === p.file))).map((p) => p.cite)]).filter(([, c]) => c.length);
  const hint = [board.length && `The cut opens on ${board[0]}: keep its framing and blocking.`, cam.length && `${cam.join(" and ")} ${cam.length > 1 ? "are" : "is"} this cut's camera on the place${board.length ? "" : ": keep its framing"}.`,
    place.length && `${place.join(", ")} show${place.length > 1 ? "" : "s"} the place (the same set, its buildings and layout), not this cut's framing.`,
    key.length && `${key[0]} is the beat's peak (a key drawing): the cut builds to it and does not open on it.`, ...who.map(([n, c]) => `${n} is ${c.join(" and ")}.`),
    ...cite((r) => r.startsWith(`continuity: ${unit.master?.cut} at`)).map((c) => `${c} is ${unit.master.cut}'s frame at ${unit.master.at_s} s, the shot this cuts in from: keep its light, colours and background.`)].filter(Boolean).join(" ");
  let [first, ...others] = E.getValue("render", "render", "prompt").split("\n");
  for (const e of casts) { const a = heard.find((x) => x.role === `cast: ${e.name}, voice`)?.cite; first = a ? first.replaceAll(`{voice:${e.ref}}`, a) : first.replaceAll(` in the voice of {voice:${e.ref}}`, ""); }
  first = first.replace(/ in the voice of \{voice:[^}]+\}/g, "");
  if (hint) first = `${first.replace(/\s*$/, "")} ${hint}`;
  E.setValue("render", "render", "prompt", [first, ...others].join("\n"));
  if (sheet.style) L.pin(sheet.style.ref.replace(/@\d+$/, ""), { n: +sheet.style.ref.split("@")[1], hash: W.short(W.get(sheet.style.ref).version.hash), name: sheet.style.name });
  E.tag("story", { book: sheet.book, ...(sheet.story ? { ref: sheet.story.ref } : {}), beat: sheet.at?.beat ?? null, ...(beats ? { beats } : {}), unit: { scene: sceneId, shot: shotId, cut: unit.cut ?? null }, ...(land ? { landed: to } : {}), from: sheet.from });
  if (land) said.push(`compiled ${unit.cut ?? "the cut"} into ${SC.shotTitle(SC.get(to.scene), SC.shotOf(SC.get(to.scene), to.shot))} of ${SC.get(to.scene).name}; ${unit.cut ?? "the cut"}'s own shot and the Cut are unchanged`);
  return { said: said.filter(Boolean), sheet, prompt: E.getValue("render", "render", "prompt"), ...(land ? { landed: to } : {}) };
}

// ---- stale on the story clock -------------------------------------------------------------------------------------
// a take made from a unit's compile, against today's compile of the same unit: which fields it used moved, named by beat
// `compiled`: a Map the caller keeps for one pass, so each unit compiles once however many takes it has
export async function storyStale(take, { story = null, compiled = new Map() } = {}) {
  const s = take?.story ?? take?.graph?.extra?.snap?.story;
  if (!s?.unit || !s.from) return null;
  const key = `${s.unit.scene}/${s.unit.shot}/${s.beats?.join() ?? ""}`; // a take made at another beat compiles at that beat
  if (!compiled.has(key)) compiled.set(key, compile(s.unit.scene, s.unit.shot, { story, beats: s.beats ?? null }).catch((e) => ({ error: e.message })));
  const now = await compiled.get(key);
  if (now.error) return { reasons: [`its unit can't compile now: ${now.error}`] };
  // a field now, by its key (cast:kon.carried.right_hand), with the beat that set it
  const fields = new Map(now.entities.flatMap((e) => e.fields.map((f) => [`${e.ref}.${f.path}`, { ...f, name: e.name }]))), reasons = [];
  for (const k of new Set([...Object.keys(s.from), ...Object.keys(now.from)])) {
    if (s.from[k] === now.from[k]) continue;
    const f = fields.get(k), [head, ...rest] = k.split(".");
    if (k === "style") reasons.push(`the production style ${s.from[k] ? "changed" : "was added"}`);
    else if (k === "dials") reasons.push(`dial rows ${!(k in s.from) ? "were planned" : !(k in now.from) ? "were taken out of the plan" : "changed"}`); // SNAP-R230
    else if (k === "master") reasons.push(`its master's frame ${k in now.from ? "changed (the master cut's active take or the frame moved)" : "is no longer cited"}`); // SNAP-R236
    else if (/^b\d+$/.test(head)) reasons.push(`story: ${head}'s ${rest.join(" ")} changed`);
    else if (head.startsWith("location:") && !rest.length) reasons.push(`its place ${head} changed`);
    else if (!(k in now.from)) reasons.push(`story: ${k} is no longer set at this beat`);
    else reasons.push(`story: ${f?.name ?? head}.${rest.join(".")} ${k in s.from ? "changed" : "set"}${f ? ` at ${f.beat}` : ""}`);
  }
  return reasons.length ? { reasons, was: s.ref ?? null, now: now.story?.ref ?? null } : null;
}
// every take of a Book's units with what moved under it (story fields and the style), and the count per unit: the takes
// in its cuts' shots, and the takes that pin one of its cuts from elsewhere (apply_unit {land}, board candidates landed
// off the cut, F-L04/F-L10). board says a board or key candidate (its pin's role) or the cut's picked board
export async function bookStale(bookRef, { story = null } = {}) {
  await T.load();
  const book = bookOf(bookRef), out = [], compiled = new Map(), seen = new Set(), list = units(book), ref = `book:${book.id}`;
  const row = async (t, u, where = null) => {
    seen.add(t.id);
    const st = await storyStale(t, { story, compiled }), pin = t.story ?? t.graph?.extra?.snap?.story;
    if (u && pin?.unit?.shot && pin.unit.shot !== u.shot.id) { where = { scene: u.scene.id, shot: u.shot.id }; u = list.find((x) => x.shot.id === pin.unit.shot); } // landed in another shot of the Book
    const board = pin?.role === "board" || pin?.role === "key" ? pin.role : u && (u.unit.board?.from?.take === t.id ? "board" : u.unit.key?.from?.take === t.id ? "key" : null);
    if (st) out.push({ take: t.id, number: t.number, cut: u?.unit.cut ?? pin?.unit?.cut ?? null, scene: u?.scene.id ?? pin?.unit?.scene, shot: u?.shot.id ?? pin?.unit?.shot, active: !!u && !where && u.shot.active === t.id, ...(board ? { board } : {}), ...(where ? { landed: where } : {}), reasons: st.reasons });
  };
  for (const u of list) for (const e of SC.takesOf(u.shot)) { const t = T.get(e.take); if (t) await row(t, u); }
  for (const t of T.all().filter((x) => !seen.has(x.id) && (x.story ?? x.graph?.extra?.snap?.story)?.book === ref)) {
    const pin = t.story ?? t.graph?.extra?.snap?.story, u = list.find((x) => x.shot.id === pin.unit?.shot), home = RT.shotOf(t);
    await row(t, u, home ? { scene: home.scene.id, shot: home.shot.id } : pin.landed ?? { scene: null, shot: null });
  }
  return out;
}
// what a story edit would re-open before it is saved (reversal cost, box1:43), its own words for what moves (F-L03,
// SNAP-R172): the cuts whose compile changes and by which fields, the takes and boards it newly flags, and the takes
// already stale that it flags again for more (counted, never left out: "nothing" only when nothing moves)
// `base`: measure from that story instead of canon (F-L06: a stacked proposal's own delta over the waiting ones it builds on)
export async function reversalCost(bookRef, story, { base = null } = {}) {
  const book = bookOf(bookRef), draft = cleanStory(story), from = base ? cleanStory(base) : null, before = new Map((await bookStale(bookRef, { story: from })).map((x) => [x.take, x])), after = await bookStale(bookRef, { story: draft });
  const flagged = after.filter((x) => !before.has(x.take)), also = after.filter((x) => before.has(x.take)).map((x) => ({ ...x, also: x.reasons.filter((r) => !before.get(x.take).reasons.includes(r)) })).filter((x) => x.also.length);
  const cuts = [], field = (k) => { const [h, ...rest] = k.split("."); return /^b\d+$/.test(h) ? `${h} ${rest.join(" ").replace(/\b(cast|prop|location):[\w-]+/g, (r) => nameOf(draft, r))}` : rest.length ? `${nameOf(draft, h)}.${rest.join(".")}` : k; }; // names, never ids (F-L12)
  for (const { scene, shot, unit } of units(book)) {
    const [a, b] = await Promise.all([compile(scene.id, shot.id, from ? { story: from } : {}).catch(() => null), compile(scene.id, shot.id, { story: draft }).catch(() => null)]);
    const keys = a && b ? [...new Set([...Object.keys(a.from), ...Object.keys(b.from)])].filter((k) => a.from[k] !== b.from[k]) : [];
    if (keys.length) cuts.push({ cut: unit.cut ?? shot.id, scene: scene.id, shot: shot.id, fields: keys.map(field) });
  }
  const boards = flagged.filter((x) => x.board).length, takes = flagged.length - boards, why = [...new Set(also.flatMap((x) => x.also.map((r) => r.replace(/^story: /, ""))))];
  const said = [cuts.length ? `changes the compile of ${cuts.map((c) => `${c.cut} (${c.fields.join(", ")})`).join(", ")}` : null,
    takes || boards ? `re-flags ${[takes ? plural(takes, "take") : null, boards ? plural(boards, "board") : null].filter(Boolean).join(" and ")}` : null,
    also.length ? `${plural(also.length, also.some((x) => x.board) && also.every((x) => x.board) ? "board" : "take")} already stale ${also.length === 1 ? "is" : "are"} now also stale for ${why.join("; ")}` : null].filter(Boolean);
  return { takes, boards, also: also.length, cuts, moves: said.length > 0, said: said.join("; ") || "nothing moves: no cut's compile changes and no take or board is flagged", list: flagged, ...(also.length ? { also_list: also } : {}) };
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
// they belong to the Book, not a graph (SNAP-R139); the accept names its id in the version it makes
export const propose = (tool, args, reason, { book, needs = [], makes = [], stacked = null, base = null }) => P.add(tool, args, reason, null, null, { book, needs, makes, stacked, base });
// the beats waiting in a Book's story proposals: beat id -> the proposal that would add it
export const waitingBeats = (book) => new Map(P.all().filter((p) => p.status === "waiting" && p.book === `book:${book.id}`).flatMap((p) => (p.makes ?? []).map((id) => [id, p.id])));

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
// ---- where the Cut went in Astrid (SNAP-R225): the bridge's receipt (snap/astrid.json), the only source of truth for
// the link; a push or link_astrid announces itself, and the next read fetches it again
let receiptNow = null;
const astridListeners = new Set();
export const onAstrid = (fn) => astridListeners.add(fn);
api.addEventListener("mainodes-snap-astrid", ({ detail }) => { receiptNow = null; for (const fn of astridListeners) fn(detail); });
export async function receipt() {
  if (!receiptNow) {
    const r = await api.fetchApi("/mainodes/snap/astrid"), out = await r.json();
    if (!r.ok) throw new Error(out.error ?? `/mainodes/snap/astrid answered ${r.status}`);
    receiptNow = out;
  }
  return receiptNow;
}
export async function linkAstrid(q) {
  const r = await api.fetchApi("/mainodes/snap/astrid/link", { method: "POST", body: JSON.stringify(q) }), out = await r.json();
  if (!r.ok) throw new Error(out.error ?? `/mainodes/snap/astrid/link answered ${r.status}`);
  receiptNow = null;
  return out;
}
// a Book's link: its production, the production's project, the Book's entry (null: not pushed yet) and the setup
export async function astridOf(book) {
  const pr = await productionFor(book), r = await receipt(), at = r.productions[`production:${pr.id}`] ?? null;
  return { production: pr, project: at?.project ?? null, entry: at?.books?.[`book:${book.id}`] ?? null, setup: r.setup, at, jobs: (r.jobs ?? []).filter((j) => j.book === `book:${book.id}`) };
}
const trimOf = (t) => ({ in_s: t?.in_s ?? 0, out_s: t?.out_s ?? null, gain_db: t?.gain_db ?? 0 });
// SNAP-R217: what changed in the Cut since its push, from the receipt: {changed, added, removed, order_changed, shape,
// cuts: {C7: {state, clip, media, said}}}; a cut is changed when its active take or its trim / sound level moved
export function astridDiff(book, entry) {
  const now = units(book).map(({ shot, unit }) => { const t = shot.active ? T.get(shot.active) : null, video = t?.media.find((m) => m.kind === "video");
    return { cut: unit.cut ?? shot.name, take: video ? t.id : null, trim: trimOf(unit.trim), private: !!t && !!(t.private || t.kept_encrypted || T.locked(t)) }; });
  const clips = entry?.clips ?? {}, here = now.filter((x) => x.take && !x.private), cuts = {};
  const changed = here.filter((x) => clips[x.cut] && (clips[x.cut].take !== x.take || JSON.stringify(trimOf(clips[x.cut].trim)) !== JSON.stringify(x.trim))).map((x) => x.cut);
  const added = here.filter((x) => !clips[x.cut]).map((x) => x.cut), removed = Object.keys(clips).filter((c) => !here.some((x) => x.cut === c));
  const was = (entry?.order ?? []).filter((c) => clips[c] && here.some((x) => x.cut === c)), is = here.map((x) => x.cut).filter((c) => clips[c]);
  const order_changed = JSON.stringify(was) !== JSON.stringify(is);
  for (const x of now) {
    const c = clips[x.cut], at = c?.swapped_at ? new Date(c.swapped_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;
    const state = !entry ? "not in Astrid" : x.private ? "a gap in Astrid (kept private)" : !c ? (x.take ? "not in Astrid yet" : "a gap in Astrid (no take)") : changed.includes(x.cut) ? "changed here since the push" : at ? `swapped ${at}` : "in sync";
    cuts[x.cut] = { state, ...(c ? { clip: c.clip, media: c.media, take: c.take } : {}) };
  }
  const shape = added.length || removed.length || order_changed;
  return { changed, added, removed, order_changed, shape: !!shape, cuts,
    said: !entry ? "not in Astrid yet" : shape ? `the Cut's shape changed (${[added.length && `added ${added.join(", ")}`, removed.length && `removed ${removed.join(", ")}`, order_changed && "the order moved"].filter(Boolean).join("; ")}): a push makes a new timeline and keeps the one in Astrid`
      : changed.length ? `${plural(changed.length, "cut")} changed since the push (${changed.join(", ")})` : "in sync with Astrid" };
}
// SNAP-R226: the style section in Astrid's preferences differs from the setting: shared and a newer style accepted (or
// never written), or not shared and still there
export function styleMoved(book, ax) {
  const shared = ax.at?.style?.[book.id], style = styleOf(book.body);
  return book.body.to_astrid?.share_style ? !!style && shared?.look !== style.ref : !!shared?.look;
}
// SNAP-R224: the person's push (their button, or their Book's auto-push): this page writes the archive (its probe said
// whether Astrid can edit it), then the server runs tools/astrid_push.py as the Book's one job
export async function pushAstrid(bookRef, { by = "button", new_timeline = false } = {}) {
  const out = await otio(bookRef), probe = out.astrid?.probe;
  if (probe?.ok === false) throw new Error(`Astrid can't edit the archive Snap wrote, so nothing was pushed: ${JSON.stringify(probe)}`);
  const r = await api.fetchApi("/mainodes/snap/astrid/push", { method: "POST", body: JSON.stringify({ book: `book:${bookOf(bookRef).id}`, what: "push", by, client: api.clientId, archive: out.astrid.archive, ...(new_timeline ? { new_timeline: true } : {}) }) });
  const res = await r.json();
  if (!r.ok) throw new Error(res.message ?? res.error ?? `/mainodes/snap/astrid/push answered ${r.status}`);
  receiptNow = null;
  return res;
}
// SNAP-R224: auto-push, the person's per-Book setting. When the Cut's canon moves (an active take, a trim or sound level,
// the Book's style while it is shared), a push waits until the Cut has been still STILL_MS; the server runs one at a
// time per Book; a changed shape stops it, said on the Cut lens (autoNote), never a silent new timeline
const STILL_MS = 20000, autoTimers = new Map(), autoNotes = new Map();
export const autoNote = (bookRef) => autoNotes.get(bookRef) ?? null;
async function autoCheck() {
  await Promise.all([W.load(), SC.load(), T.load()]);
  for (const b of books().filter((x) => x.body.to_astrid?.auto_push)) {
    const book = bookOf(b.ref), ax = await astridOf(book).catch(() => null);
    if (!ax || ax.setup?.said || ax.jobs?.some((j) => j.book === b.ref && j.state === "running")) continue;
    const diff = astridDiff(book, ax.entry);
    if (ax.entry && diff.shape) { autoNotes.set(b.ref, `Auto-push stopped: ${diff.said}. Press Push to make it.`); continue; }
    autoNotes.delete(b.ref);
    if (ax.entry && !diff.changed.length && !styleMoved(book, ax)) continue;
    clearTimeout(autoTimers.get(b.ref));
    autoTimers.set(b.ref, setTimeout(() => { autoTimers.delete(b.ref); pushAstrid(b.ref, { by: "auto-push" }).catch((e) => { autoNotes.set(b.ref, `Auto-push: ${e.message}`); for (const fn of astridListeners) fn({ book: b.ref }); }); }, STILL_MS));
  }
}
let watching = false;
export function watchAutoPush() {
  if (watching) return;
  watching = true;
  const kick = () => { autoCheck().catch((e) => console.warn(`Snap's auto-push couldn't look: ${e.message}`)); };
  SC.onChange(kick); W.onChange(kick); onAstrid(kick); kick();
}
// OpenTimelineIO of the Cut: one video track of the active takes as source ranges, a marker per cut, and the same Cut as
// an Astrid timeline archive (SNAP-R212); the server writes the files beside the outputs (/mainodes/snap/book/otio).
// Each clip says what made it (`snap`): its take, cut, Book, beat, world pins, instruction stack and recipe digest, or
// ids alone when the take ran with metadata off (SNAP-R20). A take kept private, or one this page can't read, is `private`:
// its bytes stay out of the archive (fails closed)
// SNAP-R216: a cut with a line carries it (speaker, words, the voice reference the take cited) for the Dialogue lane, and
// every clip its scene group's name (§14.1: the Book's structure stays readable on one timeline)
async function madeOf(c, bookRef, unit, story) {
  const t = T.get(c.take), ids = { take: c.take, cut: c.cut, book: bookRef };
  if (!t) return { snap: ids, private: true };
  const pin = t.story ?? t.graph?.extra?.snap?.story, stack = t.graph?.extra?.snap?.instructions;
  const snap = t.metadata === false ? { ...ids, metadata: false } : { ...ids, ...(pin?.beat ? { beat: pin.beat } : {}), ...(pin?.beats?.length ? { beats: pin.beats } : {}),
    world: Object.fromEntries(Object.entries(t.world ?? {}).map(([ref, x]) => [ref, x.n])), ...(stack?.refs ? { instructions: await I.hashOf(stack) } : {}), ...(await T.digestOf(t) ? { recipe_digest: await T.digestOf(t) } : {}) };
  const beats = (unit?.beats ?? []).map((id) => story.beats.find((b) => b.id === id)).filter(Boolean), group = story.groups.find((g) => beats.some((b) => g.beats.includes(b.id)))?.name || null;
  const lines = beats.flatMap((b) => (b.lines ?? []).map((l) => ({ who: l.who, name: nameOf(story, l.who), text: l.text })));
  const voiced = lines.map((l) => { const n = t.world?.[l.who]?.n; return W.get(n ? `${l.who}@${n}` : l.who)?.version.body.voice?.file; }).find(Boolean);
  return { snap, label: `${c.cut} · take ${t.number}`, private: !!(t.private || t.kept_encrypted || T.locked(t)), ...(group ? { group } : {}),
    ...(lines.length ? { lines, ...(t.voice?.words?.length ? { words: t.voice.words } : {}), ...(voiced ? { voice_reference: voiced } : {}) } : {}) };
}
export async function otio(bookRef, { fps = 24, width = 1280, height = 704 } = {}) {
  const { book, clips, gaps } = plan(bookRef, "cut"), ref = `book:${book.id}@${book.n}`, story = book.body.story ? storyOf(book.body).body : cleanStory({});
  const unitOfCut = new Map(units(book).map((u) => [u.unit.cut ?? u.shot.name, u.unit])), production = await productionFor(book);
  const made = await Promise.all(clips.map(async (c) => ({ ...c, ...(c.take ? await madeOf(c, ref, unitOfCut.get(c.cut), story) : {}) })));
  const r = await api.fetchApi("/mainodes/snap/book/otio", { method: "POST", body: JSON.stringify({ name: book.body.name, book: ref, project: production.body.astrid.project, fps, width, height, clips: made }) }), out = await r.json();
  if (!r.ok) throw new Error(out.error ?? `writing the OTIO failed (${r.status})`);
  return { ...out, gaps };
}
