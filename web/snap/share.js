// Snap examples and share files (lane S): a brick or recipe card can carry one small example picture, the person's own
// pick from a take (a still scaled down, or a video's first, middle and last frames side by side), kept on the card body
// so the Library shows what it does. A share file (<title>.snap.json) is that card, its blueprints and its example as one
// download or copy: never weights, identity (Cast) LoRA rows, the exact graph, reference picture names or take ids. A
// share file someone hands over is untrusted text: readShare validates it strictly and keeps only known fields, the page
// shows it as text only, and nothing in it runs or queues by itself. Importing lands it in the Library first and says
// what is missing here; adding it to a recipe or opening it is a second act (L.applyBrick, R.open).
// SNAP-R287 an example is the person's explicit pick, small, on the card · SNAP-R288 what a share file carries and never
// carries · SNAP-R289 a share file is untrusted · SNAP-R290 importing lands in the Library and says what is missing ·
// SNAP-R18 local only (a file downloaded or copied, a file dropped or opened) · SNAP-R12/R37 identity rows ·
// SNAP-R275 a recipe's graph stays home · SNAP-R282 blueprints travel with their bricks · SNAP-R17 by · see docs/snap/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import * as W from "./world.js";
import * as R from "./recipes.js";
import * as T from "./takes.js";
import * as M from "./models.js";
import * as D from "./dials.js";
import { rackOf } from "./retake.js";
import { BRICKS, PACK_BRICKS } from "./bricks.js";

export const EXAMPLE_TARGET = 60_000, EXAMPLE_CAP = 120_000, SHARE_CAP = 2_000_000; // bytes of the data URL / the file text
const STR_CAP = 20_000, NAME_CAP = 300, LIST_CAP = 500;

// ---- the example's size (pure: the canvas encode is injected; tests/snap/test_share.mjs fakes it)
// widths are per frame, largest first; quality steps down within each width. The size is the data URL's length, which is
// what the card body keeps
export const exampleSteps = (frames = 1) => (frames === 3 ? [320, 272, 224, 192, 160, 128, 96] : [512, 448, 384, 320, 256, 192, 128]).flatMap((w) => [0.8, 0.62, 0.45].map((q) => ({ w, q })));
// the first step under target; else the smallest under the hard cap; else refused
export async function fitExample(encode, { frames = 1, target = EXAMPLE_TARGET, cap = EXAMPLE_CAP } = {}) {
  let best = null;
  for (const s of exampleSteps(frames)) {
    const url = await encode(s.w, s.q);
    if (url.length <= target) return { url, ...s, bytes: url.length };
    if (url.length <= cap && (!best || url.length < best.bytes)) best = { url, ...s, bytes: url.length };
  }
  if (best) return best;
  throw new Error(`This take's picture stays over ${Math.round(cap / 1000)} KB even at its smallest size: pick another take`);
}
const IMAGE = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/;
export const safeImage = (src) => typeof src === "string" && src.length <= EXAMPLE_CAP && IMAGE.test(src);

// a take as the example picture: a still scaled down, or a video's first, middle and last frames side by side as one strip
// (T.frames hands them as JPEG pictures). WebP where the browser encodes it, else JPEG
export async function pictureOf(take) {
  const video = take.media.some((m) => m.kind === "video");
  const got = await T.frames(take, video ? { count: 3, maxWidth: 640 } : { count: 1, maxWidth: 1024 });
  const pics = await Promise.all(got.map(async (f) => { const i = new Image(); i.src = `data:${f.mimeType};base64,${f.data}`; await i.decode(); return i; }));
  const n = pics.length, aspect = pics[0].naturalHeight / pics[0].naturalWidth;
  let type = "image/webp";
  const encode = (w, q) => {
    const c = Object.assign(document.createElement("canvas"), { width: w * n, height: Math.max(1, Math.round(w * aspect)) }), g = c.getContext("2d");
    pics.forEach((p, i) => g.drawImage(p, i * w, 0, w, c.height));
    let url = c.toDataURL(type, q);
    if (!url.startsWith(`data:${type}`)) { type = "image/jpeg"; url = c.toDataURL(type, q); } // no WebP encoder here
    return url;
  };
  const fit = await fitExample(encode, { frames: n });
  return { image: fit.url, w: fit.w * n, h: Math.max(1, Math.round(fit.w * aspect)), frames: n };
}

// ---- which card: card:<id>[@n], its id (brick-<title>, recipe-<name>) or its name; a brick card or a plain recipe only
const isBrick = (b) => b?.kind === "brick", isRecipe = (b) => b?.kind === "recipe" && !b.family; // a family's recipe card is a setup
const usable = (r) => !!r && (isBrick(W.headOf(r)?.body) || isRecipe(W.headOf(r)?.body));
export function cardOf(ref, version) {
  const s = String(ref ?? "").trim();
  let id = s, n = version ?? null;
  if (/^card:/.test(s)) { const p = W.parse(s); id = p.id; n = version ?? p.n; }
  const all = W.all("card").filter(usable), low = s.toLowerCase();
  const r = [W.record("card", id), all.find((x) => W.headOf(x).body.title?.toLowerCase() === low), W.record("card", R.idFor(s, 0)), W.record("card", `brick-${R.slug(s)}`)].find(usable);
  if (!r) throw new Error(`No brick or recipe card ${JSON.stringify(ref ?? "")}: give card:<id>[@n], its id (brick-<title>, recipe-<name>) or its name; yours: ${all.map((x) => x.id).join(", ") || "none yet"}`);
  const v = n == null ? W.headOf(r) : r.versions.find((x) => x.n === +n);
  if (!v) throw new Error(`${W.headOf(r).body.title} has no version ${n}; it has v${r.versions.map((x) => x.n).join(", v")}`);
  return { id: r.id, ref: W.refOf("card", r.id, v.n), kind: W.headOf(r).body.kind, title: W.headOf(r).body.title, record: r, version: v };
}
// the Library card a brick of the open recipe was kept as (keepBrick's id for its title), or null
export const keptBrickId = (key) => { const id = `brick-${R.slug(BRICKS[key]?.title ?? "")}`; return isBrick(W.headOf(W.record("card", id))?.body) ? id : null; };

// ---- the example on a card: always the person's (or their agent's) explicit act, one card at a time, never a default
// a new version of the card's newest body with the example set or taken out; the open graph's recipe marker follows when
// it named that newest version (the bricks are the same)
async function writeExample(c, example, { note, by }) {
  const head = W.headOf(c.record), { example: _, ...rest } = head.body, body = example ? { ...rest, example } : rest;
  const out = await W.save("card", c.id, body, { note, by });
  const m = E.state().recipe;
  if (isRecipe(body) && m?.id === c.id && m.n === head.n && out.n !== head.n) E.tag("recipe", { id: c.id, n: out.n });
  return { id: c.id, ref: W.refOf("card", c.id, out.n), n: out.n, made: out.made, title: body.title };
}
export async function setExample(ref, takeId, { caption, by = "person" } = {}) {
  await Promise.all([W.load(), T.load()]);
  if (await T.privacyOn()) throw new Error("Privacy is on here, so takes are private (SNAP-R37): an example would put a picture of one on a card meant for sharing. Examples work where privacy is off");
  const c = cardOf(ref), t = T.find(takeId);
  if (!t) throw new Error(`No take ${JSON.stringify(takeId ?? "")}; list_takes lists them`);
  if (t.locked) throw new Error(`take ${t.number} is private: it can't be an example`);
  const pic = await pictureOf(t), cap = typeof caption === "string" ? caption.trim().slice(0, NAME_CAP) : "";
  const example = { ...pic, from: { take: t.id, number: t.number }, ...(cap ? { caption: cap } : {}) };
  const out = await writeExample(c, example, { note: `example from take ${t.number}`, by });
  return { ...out, example: { w: pic.w, h: pic.h, frames: pic.frames, bytes: pic.image.length, from: example.from, ...(cap ? { caption: cap } : {}) }, said: `${out.title}: take ${t.number} is its example (${Math.round(pic.image.length / 1000)} KB${pic.frames === 3 ? ", first, middle and last frames" : ""})` };
}
export async function clearExample(ref, { by = "person" } = {}) {
  await W.load();
  const c = cardOf(ref);
  if (!W.headOf(c.record).body.example) throw new Error(`${c.title} has no example`);
  const out = await writeExample(c, null, { note: "example removed", by });
  return { ...out, said: `${out.title}: example removed (v${out.n})` };
}

// ---- what a card needs (pure over BRICKS, rackOf and M.isFile / M.named): node types from each brick key and from every
// node inside its blueprint's definitions, the blueprints it uses, dial files from Dial Rack rows, model files named in
// its settings
const RACK = "MAIDialRack";
const packDef = (key) => (PACK_BRICKS.includes(key) ? BRICKS[key] : null);
const nodeTypeOf = (e, nodeKey) => (e.key.startsWith("node:") ? (nodeKey === "node" ? e.key.slice(5).split("#")[0] : null) : packDef(e.key)?.nodes?.find((n) => n.key === nodeKey)?.type ?? null);
const blueprintOf = (e) => (e?.blueprint && typeof e.blueprint === "object" ? e.blueprint : null);
const definitions = (bp) => bp?.definitions?.subgraphs ?? [];
const outerName = (bp) => definitions(bp).find((g) => g.id === bp.nodes?.[0]?.type)?.name ?? null;
const strings = (x) => (typeof x === "string" ? [x] : Array.isArray(x) ? x.flatMap(strings) : x && typeof x === "object" ? Object.values(x).flatMap(strings) : []);
export function needsOf(bricks) {
  const nodes = new Set(), blueprints = new Set(), dials = new Set(), models = new Set(M.named({ brick: { bricks: bricks.map((e) => ({ values: e.values ?? {} })) } }));
  for (const e of bricks) {
    const bp = blueprintOf(e), defs = definitions(bp), ids = new Set(defs.map((g) => g.id)), pack = packDef(e.key);
    if (e.key.startsWith("node:") && !bp) nodes.add(e.key.slice(5).split("#")[0]);
    for (const n of pack?.nodes ?? []) if (n.type) nodes.add(n.type);
    if (pack?.blueprint) blueprints.add(pack.blueprint);
    if (bp) blueprints.add(outerName(bp) ?? e.title ?? e.key.slice(5));
    for (const n of defs.flatMap((g) => g.nodes ?? [])) { if (n.type && !ids.has(n.type)) nodes.add(n.type); for (const v of strings(n.widgets_values)) if (M.isFile(v)) models.add(v); }
    const racks = [...Object.entries(e.values ?? {}).filter(([k]) => nodeTypeOf(e, k) === RACK).map(([, ws]) => rackOf({ nodes: [{ type: RACK, widgets_values: ws }] })), bp ? rackOf({ definitions: bp.definitions }) : null];
    for (const r of racks.flat()) if (typeof r?.dial === "string") dials.add(r.dial);
  }
  return { nodes: [...nodes], blueprints: [...blueprints], dials: [...dials].map((file) => ({ file })), models: [...models] };
}

// ---- the share file
// a setting that names a picture, video or sound (a whole file name, or one inside a JSON setting such as the
// References list) is a reference picture name: left out
const MEDIA = /\.(png|jpe?g|webp|gif|bmp|tiff?|exr|mp4|webm|mov|mkv|avi|wav|mp3|flac|ogg|m4a)$/i, MEDIA_IN = /"[^"]*\.(png|jpe?g|webp|gif|bmp|tiff?|exr|mp4|webm|mov|mkv|avi|wav|mp3|flac|ogg|m4a)"/i;
const pictureName = (v) => typeof v === "string" && (MEDIA.test(v.trim()) || (/^\s*[[{]/.test(v) && MEDIA_IN.test(v)));
// prompt-like (left out with prompt: false): a STRING its node defines as multiline; where the definition can't be read
// (a pack blueprint's or a subgraph's promoted setting) a string setting named like a prompt, or one holding a line break
const specOf = (type) => { const nd = globalThis.LiteGraph?.registered_node_types?.[type]?.nodeData?.input; return nd ? { ...nd.required, ...nd.optional } : null; };
const multiline = (spec) => spec?.[0] === "STRING" && !!spec[1]?.multiline;
// where the outputs go (a text setting of an output node, e.g. Save's file prefix): it names the person's folders and
// projects, so it is always left out and the receiver keeps their own (SNAP-R288)
const saver = (type) => !!globalThis.LiteGraph?.registered_node_types?.[type]?.nodeData?.output_node;
const savePlace = (type, name, value) => typeof value === "string" && !!value && (saver(type) ? specOf(type)?.[name]?.[0] === "STRING" : !specOf(type) && /^filename_prefix$|^output_path$|^save_path$/i.test(name)); // free text only: a format or codec choice stays
export function promptLike(type, name, value) {
  if (typeof value !== "string") return false;
  const spec = type ? specOf(type) : null;
  return spec && spec[name] ? multiline(spec[name]) : /prompt|negative|caption|text/i.test(name) || value.includes("\n");
}
// a blueprint's widget values are by position: inside a node whose definition has a multiline STRING, every free string
// (not one of its choices) goes; anywhere, a string equal to a prompt left out of the entry goes too
function scrubBlueprint(bp, { prompt, gone, count }) {
  const out = JSON.parse(JSON.stringify(bp));
  const fix = (n) => {
    if (!Array.isArray(n.widgets_values)) return;
    const spec = specOf(n.type), texty = spec && Object.values(spec).some(multiline), choices = new Set(spec ? Object.values(spec).flatMap((s) => (Array.isArray(s?.[0]) ? s[0] : [])) : []);
    n.widgets_values = n.widgets_values.map((v) => {
      if (pictureName(v)) { count.pictures++; return ""; }
      if (saver(n.type) && typeof v === "string" && v && !choices.has(v)) { count.saves++; return ""; }
      if (!prompt && typeof v === "string" && v && (gone.has(v) || (texty && !choices.has(v) && !M.isFile(v)))) { count.prompts++; return ""; }
      return v;
    });
  };
  for (const n of out.nodes ?? []) fix(n);
  for (const n of definitions(out).flatMap((g) => g.nodes ?? [])) fix(n);
  return out;
}
function scrubEntry(e, { prompt, count }) {
  const gone = new Set(), values = {};
  for (const [nodeKey, ws] of Object.entries(e.values ?? {})) {
    const type = nodeTypeOf(e, nodeKey);
    values[nodeKey] = Object.fromEntries(Object.entries(ws ?? {}).filter(([name, v]) => {
      if (pictureName(v)) { count.pictures++; return false; }
      if (savePlace(type, name, v)) { count.saves++; return false; }
      if (!prompt && promptLike(type, name, v)) { count.prompts++; if (v) gone.add(v); return false; }
      return true;
    }));
  }
  const bp = blueprintOf(e);
  const { blueprint: _, ...rest } = e;
  return { ...rest, values, ...(bp ? { blueprint: scrubBlueprint(bp, { prompt, gone, count }) } : {}) };
}
const titleOfEntry = (e) => e.title ?? (PACK_BRICKS.includes(e.key) ? BRICKS[e.key].title : e.key.startsWith("node:") ? e.key.slice(5).split("#")[0] : e.key);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fileName = (title) => `${String(title || "snap").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").trim().slice(0, 120) || "snap"}.snap.json`;
// a card version's body as a share file (pure; dial hashes are added by shareOf)
export function packShare(body, { prompt = true, made = new Date().toISOString() } = {}) {
  const kind = body?.kind;
  if (kind !== "brick" && kind !== "recipe") throw new Error(`Only a brick or a recipe card can be shared; this is ${JSON.stringify(kind ?? null)}`);
  const raw = kind === "recipe" ? body.brick?.bricks ?? [] : [body.brick?.entry].filter(Boolean);
  if (!raw.length) throw new Error(`${body.title} holds no brick to share`);
  if (raw.some((e) => e?.blueprint === true)) throw new Error(`${body.title} is the Library's light copy (its blueprints left out, SNAP-R282): share it from its record`);
  const kept = R.strip(raw, true), ids = raw.filter((e, i) => kept[i] !== e).length; // SNAP-R12: identity rows go whatever the privacy setting
  const count = { pictures: 0, prompts: 0, saves: 0 }, bricks = kept.map((e) => scrubEntry(e, { prompt, count }));
  const ex = body.example && safeImage(body.example.image) ? { image: body.example.image, w: body.example.w, h: body.example.h, frames: body.example.frames === 3 ? 3 : 1, ...(body.example.caption ? { caption: body.example.caption } : {}) } : null;
  const card = { kind, title: body.title, text: body.text ?? "", brick: kind === "recipe" ? { bricks } : { entry: bricks[0] }, ...(ex ? { example: ex } : {}) };
  const needs = needsOf(bricks), carried = bricks.filter(blueprintOf).map((e) => outerName(e.blueprint) ?? titleOfEntry(e));
  const includes = [
    kind === "recipe" ? `${plural(bricks.length, "brick")} with their settings: ${bricks.map(titleOfEntry).join(", ")}` : `the brick ${titleOfEntry(bricks[0])} with its settings${bricks[0].face ? ", face" : ""}${bricks[0].title ? " and name" : ""}`,
    carried.length ? `${plural(carried.length, "blueprint")} inside it: ${carried.join(", ")}` : null,
    ex ? (ex.frames === 3 ? "its example: first, middle and last frames of a video" : "its example picture") : null,
    needs.nodes.length + needs.dials.length + needs.models.length ? `the names of what it needs: ${[plural(needs.nodes.length, "node type"), needs.dials.length ? plural(needs.dials.length, "dial file") : null, needs.models.length ? plural(needs.models.length, "model file") : null].filter(Boolean).join(", ")}` : null,
  ].filter(Boolean);
  const leaves_out = [
    "weights: no model, LoRA or dial files, only their names",
    kind === "recipe" && body.graph ? "the exact workflow (it names your pictures and Cast rows): the bricks rebuild it" : null,
    ids ? `identity (Cast) LoRA rows of ${plural(ids, "brick")}` : null,
    count.pictures ? `${plural(count.pictures, "reference picture name")}` : null,
    count.saves ? `where your outputs are saved (${plural(count.saves, "setting")})` : null,
    body.from?.take || body.example?.from ? "which take it came from" : null,
    !prompt ? (count.prompts ? `your prompt text (${plural(count.prompts, "setting")})` : "your prompt text (it had none)") : null,
  ].filter(Boolean);
  return { snap_share: 1, kind, title: body.title, made, card, needs, includes, leaves_out };
}
// the hash of a dial file's tensors from this server (local, SNAP-R18); only the hash is kept, never the path it answers with
const dialHash = async (file) => { try { const r = await api.fetchApi(`/mainodes/dials/file?dial=${encodeURIComponent(file)}`); const h = r.ok ? (await r.json()).tensors_sha256 : null; return /^[0-9a-f]{64}$/.test(h ?? "") ? h : null; } catch { return null; } };
export async function shareOf(ref, { prompt = true, version, hash = dialHash } = {}) {
  await W.load();
  const c = cardOf(ref, version), share = packShare(c.version.body, { prompt });
  share.needs.dials = await Promise.all(share.needs.dials.map(async (d) => { const h = await hash(d.file); return h ? { ...d, sha256: h } : d; }));
  const text = shareText(share);
  if (text.length > SHARE_CAP) throw new Error(`${c.title} would make a ${Math.round(text.length / 1e6 * 10) / 10} MB share file; the cap is 2 MB (its blueprints are large)`);
  return share;
}
export const shareText = (share) => JSON.stringify(share, null, 2);
export const shareFile = (share) => fileName(share.title);

// ---- receiving: everything in a share file is untrusted text (SNAP-R289)
const fail = (why) => { throw new Error(why); };
const str = (v, what, cap = NAME_CAP, { empty = false } = {}) => (typeof v === "string" && v.length <= cap && (empty || v.trim()) ? v : fail(`${what} must be text of at most ${cap} characters`));
const list = (v, what, each, cap = LIST_CAP) => (Array.isArray(v) && v.length <= cap ? v.map((x, i) => each(x, `${what}[${i}]`)) : fail(`${what} must be a list of at most ${cap}`));
const obj = (v, what) => (v && typeof v === "object" && !Array.isArray(v) ? v : fail(`${what} must be an object`));
const prim = (v, what) => (v === null || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v)) ? v : str(v, what, STR_CAP, { empty: true }));
// a blueprint is ComfyUI subgraph data: kept as data (it reaches the graph only through the person's later insert), every
// string capped, nesting capped
function data(v, what, depth = 0) {
  if (depth > 40) fail(`${what} nests too deep`);
  if (Array.isArray(v)) return v.map((x, i) => data(x, `${what}[${i}]`, depth + 1));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).filter(([k]) => k !== "__proto__").map(([k, x]) => [str(k, `${what} key`, NAME_CAP, { empty: true }), data(x, `${what}.${k}`, depth + 1)]));
  return prim(v, what);
}
function entry(e, what) {
  obj(e, what);
  const key = str(e.key, `${what}.key`);
  if (/[\u0000-\u001f]/.test(key)) fail(`${what}.key holds control characters`);
  if (Object.keys(obj(e.values ?? {}, `${what}.values`)).length > 64) fail(`${what}.values names more than 64 nodes`);
  const values = Object.fromEntries(Object.entries(e.values ?? {}).map(([k, ws]) => [str(k, `${what}.values key`), Object.fromEntries(Object.entries(obj(ws, `${what}.values.${k}`)).map(([n, v]) => [str(n, `${what}.values.${k} key`), prim(v, `${what}.values.${k}.${n}`)]))]));
  const out = { key, values };
  if (e.face != null) out.face = list(e.face, `${what}.face`, (r, w) => list(r, w, (x, ww) => str(x, ww), 3), 64);
  if (e.title != null) out.title = str(e.title, `${what}.title`);
  if (e.subgraph != null) out.subgraph = str(e.subgraph, `${what}.subgraph`);
  if (e.blueprint != null) {
    const bp = obj(e.blueprint, `${what}.blueprint`);
    if (!Array.isArray(bp.nodes) || bp.nodes.length !== 1 || typeof bp.nodes[0]?.type !== "string" || !Array.isArray(bp.definitions?.subgraphs)) fail(`${what}.blueprint must be one subgraph node with its definitions`);
    out.blueprint = data(bp, `${what}.blueprint`);
  }
  return out;
}
function example(x) {
  obj(x, "card.example");
  if (!safeImage(x.image)) fail(`card.example.image must be a data:image/webp, png or jpeg picture of at most ${EXAMPLE_CAP / 1000} KB`);
  const dim = (v, w) => (Number.isInteger(v) && v > 0 && v <= 8192 ? v : fail(`${w} must be a whole number of pixels`));
  return { image: x.image, w: dim(x.w, "card.example.w"), h: dim(x.h, "card.example.h"), frames: x.frames === 3 ? 3 : x.frames === 1 || x.frames == null ? 1 : fail("card.example.frames must be 1 or 3"), ...(x.caption != null ? { caption: str(x.caption, "card.example.caption") } : {}) };
}
// a share object rebuilt from its known fields only; throws with the reason
function check(text) {
  if (typeof text !== "string") fail("A share file is JSON text");
  if (text.length > SHARE_CAP) fail(`This file is ${Math.round(text.length / 1e5) / 10} MB; a share file is at most 2 MB`);
  let x;
  try { x = JSON.parse(text); } catch { fail("This file isn't JSON"); }
  obj(x, "A share file");
  if (!("snap_share" in x)) fail("This isn't a Snap share file (it has no snap_share)");
  if (x.snap_share !== 1) fail(`This share file is version ${JSON.stringify(x.snap_share)}; this Snap reads version 1`);
  if (x.kind !== "brick" && x.kind !== "recipe") fail(`kind must be "brick" or "recipe", not ${JSON.stringify(x.kind)}`);
  const title = str(x.title, "title"), made = str(x.made, "made", 40);
  if (Number.isNaN(Date.parse(made))) fail("made must be a date");
  const c = obj(x.card, "card"), b = obj(c.brick, "card.brick");
  const card = { kind: x.kind, title, text: c.text == null ? "" : str(c.text, "card.text", 4000, { empty: true }),
    brick: x.kind === "recipe" ? { bricks: list(b.bricks, "card.brick.bricks", entry, 200) } : { entry: entry(b.entry, "card.brick.entry") }, ...(c.example != null ? { example: example(c.example) } : {}) };
  if (x.kind === "recipe" && !card.brick.bricks.length) fail("card.brick.bricks is empty");
  if (x.kind === "brick" && !card.brick.entry.key.startsWith("node:")) fail("A shared brick is one made from a node or subgraph (node:<Type>)");
  const n = obj(x.needs ?? {}, "needs"), names = (v, w) => list(v ?? [], w, (s, ww) => str(s, ww));
  const needs = { nodes: names(n.nodes, "needs.nodes"), blueprints: names(n.blueprints, "needs.blueprints"), models: names(n.models, "needs.models"),
    dials: list(n.dials ?? [], "needs.dials", (d, w) => ({ file: str(obj(d, w).file, `${w}.file`), ...(d.sha256 != null ? { sha256: /^[0-9a-f]{64}$/.test(d.sha256) ? d.sha256 : fail(`${w}.sha256 must be 64 hex characters`) } : {}) })) };
  const lines = (v, w) => list(v ?? [], w, (s, ww) => str(s, ww), 50);
  return { snap_share: 1, kind: x.kind, title, made, card, needs, includes: lines(x.includes, "includes"), leaves_out: lines(x.leaves_out, "leaves_out") };
}
export function readShare(text) {
  try { return { ok: true, share: check(typeof text === "string" ? text : JSON.stringify(text)) }; } catch (e) { return { ok: false, why: e.message }; }
}
// a file's text is a share file when its top level names snap_share (an ordinary workflow never does)
export function looksShared(text) {
  if (typeof text !== "string" || !text.includes("snap_share")) return false;
  try { const x = JSON.parse(text); return !!x && typeof x === "object" && !Array.isArray(x) && Object.hasOwn(x, "snap_share"); } catch { return /^\s*\{\s*"snap_share"\s*:/.test(text); }
}
// a dropped or chosen file: JSON whose top level names snap_share (its first bytes, as Snap writes it, else the whole
// parse up to the cap); everything else stays the file it was
export async function isShareFile(file) {
  if (!file || !(/json/.test(file.type) || /\.json$/i.test(file.name ?? ""))) return false;
  if (/^\s*\{\s*"snap_share"\s*:/.test(await file.slice(0, 256).text())) return true;
  return file.size <= SHARE_CAP && looksShared(await file.text());
}

// where an import would land: a card with that title's id (slug of its title, never the file's own id); the same
// content there is nothing to do, a card imported from a share of the same title gains a version, anything else (your
// own card, another share's) is left alone and the import gets the next free id (-2, -3…)
const baseId = (s) => (s.kind === "brick" ? `brick-${R.slug(s.title) || "shared"}` : `recipe-${R.slug(s.title) || "shared"}`);
const content = (b) => ({ kind: b.kind, title: b.title, text: b.text ?? "", brick: b.brick, example: b.example ?? null });
export function placeOf(share) {
  const base = baseId(share);
  for (let i = 1; ; i++) {
    const id = i === 1 ? base : `${base}-${i}`, r = W.record("card", id), head = W.headOf(r)?.body;
    if (!r) return { id, action: "new", exists: false, said: i === 1 ? `it becomes a new card, ${id}` : `${base} is already a card of yours, so it becomes a new card, ${id}` };
    if (head?.kind !== share.kind || (share.kind === "recipe" && head.family)) continue;
    if (R.same(content(head), content(share.card))) return { id, action: "nothing", exists: true, n: r.head, said: `${id} already holds exactly this: nothing to add` };
    if (head.from_share?.title === share.title) return { id, action: "version", exists: true, n: r.head, said: `${id} came from a share of the same name: it gains version ${r.head + 1}` };
  }
}
// what importing would add and what is missing here. `here` overrides what this install has (tests): node types,
// installed dials, a model file test
export async function previewShare(share, here) {
  if (!here) await Promise.all([W.load(), D.load(), M.load().catch(() => null)]);
  const has = { node: (t) => !!(here?.nodes ?? globalThis.LiteGraph?.registered_node_types ?? {})[t], dial: (f) => (here?.dials ?? D.all().map((d) => d.dial)).includes(f), model: here?.model ?? ((f) => M.readiness(f).installed) };
  const bricks = share.kind === "recipe" ? share.card.brick.bricks : [share.card.brick.entry], needs = needsOf(bricks);
  const dials = [...new Set([...needs.dials.map((d) => d.file), ...share.needs.dials.map((d) => d.file)])];
  const missing = [
    ...bricks.filter((e) => !e.key.startsWith("node:") && !PACK_BRICKS.includes(e.key)).map((e) => ({ what: "brick", name: e.key, said: `${e.key} is a pack brick this install doesn't have` })),
    ...needs.nodes.filter((t) => !has.node(t)).map((t) => ({ what: "node", name: t, said: `${t} (not installed): the node pack that has it` })),
    ...dials.filter((f) => !has.dial(f)).map((f) => ({ what: "dial", name: f, said: `${f} isn't installed here: the rack fails at run time without it` })),
    ...needs.models.filter((f) => !has.model(f)).map((f) => ({ what: "model", name: f, said: `${f} is not installed` })),
  ];
  const carried = bricks.filter(blueprintOf), ex = share.card.example;
  const inside = [
    share.kind === "recipe" ? `a recipe of ${plural(bricks.length, "brick")}: ${bricks.map(titleOfEntry).join(", ")}` : `a brick: ${titleOfEntry(bricks[0])}${bricks[0].face ? `, showing ${bricks[0].face.map((f) => f[2] || f[1]).join(", ")}` : ""}`,
    ...carried.map((e) => `the blueprint ${outerName(e.blueprint) ?? titleOfEntry(e)} (${plural(definitions(e.blueprint).reduce((a, g) => a + (g.nodes?.length ?? 0), 0), "node")} inside)`),
    ex ? (ex.frames === 3 ? "an example: three frames of a video" : "an example picture") : "no example picture",
    `${plural(bricks.reduce((a, e) => a + Object.values(e.values).reduce((b, ws) => b + Object.keys(ws).length, 0), 0), "setting")}`,
  ];
  return { kind: share.kind, title: share.title, made: share.made, inside, missing, includes: share.includes, leaves_out: share.leaves_out, place: placeOf(share) };
}
// the card into the Library (a brick card or a recipe record, with from_share); nothing else happens
export async function importShare(share, { by = "person" } = {}) {
  await W.load();
  const place = placeOf(share);
  if (place.action === "nothing") return { id: place.id, ref: W.refOf("card", place.id, place.n), n: place.n, made: false, kind: share.kind, said: place.said };
  const body = { id: place.id, ...content(share.card), from_share: { title: share.title, made: share.made }, saved: Date.now() };
  if (!body.example) delete body.example;
  const out = await W.save("card", place.id, body, { note: `from a share file: ${share.title}`, by });
  return { id: place.id, ref: W.refOf("card", place.id, out.n), n: out.n, made: out.made, kind: share.kind, said: `${share.title} is in your Library as ${place.id} v${out.n}${place.action === "version" ? " (a new version of the card it came from before)" : ""}` };
}
