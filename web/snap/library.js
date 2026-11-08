// Snap Library (LIBRARY.md): cards that snap onto bricks. Each kind goes to one brick and does one visible thing there;
// search is slot-aware (a selected brick narrows it to the kinds that brick takes). Keyword search for now; the
// multimodal embedder plugs in behind `search` once its runtime is chosen.
// SNAP-R5 another family opens a new tab · SNAP-R12 identity rows never leave in a card · SNAP-R18 local only ·
// SNAP-R21 a shot's reference shows its own camera · SNAP-R25 SFW only leaves out cards tagged or loading nsfw ·
// SNAP-R59 Cast by reference (applyCast) · SNAP-R196 a Cast picture replaced as a new version · SNAP-R60 the person's cards are world records (world.js) ·
// SNAP-R73 a Cast's voice reference goes in as an <Audio n> · SNAP-R84 a location by reference: its master, plan and named
// plates (applyLocation), in one order on every apply · SNAP-R143 a take's sound as a Cast's voice (takeToVoice) · SNAP-R115 under Ref2V the First frame opens the shot as <Picture 1> (syncOpening) ·
// SNAP-R148 one plate or camera mark changes alone (addPlate) · SNAP-R177 a dry run writes nothing (saveLocation dry) · SNAP-R155 a place's scale anchors (scaleOf) · SNAP-R165 a Cast line folds through the story state (applyCast line) · SNAP-R237 a Cast's voice only where that Cast speaks (voiceWanted) · see docs/snap/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import * as E from "./engine.js";
import * as T from "./takes.js";
import * as D from "./dials.js";
import * as M from "./models.js";
import * as PF from "./profile.js";
import * as W from "./world.js";
import { BRICKS, kit } from "./bricks.js";
import { setBlock, blocking, drawPlan, drawElevation, toBlob, coverage, atCamera, cameraAt, keeps, ownCamera, sameCamera } from "./setsnap.js";

// the brick each kind of card goes on; a recipe goes on the whole stack (null)
export const TARGET = { recipe: null, shot: "render", set_snapshot: "refs", location: "refs", dial: "rack", lora: "preset", cast: "render", setting: "render", scene: "render", principle: "render", pose: "first_frame", motion_guide: "refs", run: "render" };
export const KIND_LABEL = { recipe: "Recipes", shot: "Shots", set_snapshot: "Set snapshots", location: "Locations", cast: "Cast", setting: "Settings", scene: "Scenes", principle: "Principles", motion_guide: "Motion", pose: "Poses", dial: "Dials", lora: "LoRAs", run: "Runs" };

let cards = [], pack = [], loading;
// cards load once per page; the view and the agent tools both wait on the same request. The person's own cards are
// world records (world.js): a card record's head, every listed state of a set and its working copy (`<set>-mine`)
const origins = new Map(); // card id -> the record version it shows ({kind, id, n}; n null for a set's working copy)
const loadPack = async () => (pack = (await (await api.fetchApi("/mainodes/snap/cards")).json()).cards);
function rebuild() {
  origins.clear();
  const mine = [];
  for (const r of W.all("card")) { const v = W.headOf(r); if (v) { mine.push(v.body); origins.set(v.body.id, { kind: "card", id: r.id, n: v.n }); } }
  for (const r of W.all("set_snapshot")) {
    const withPlates = (c) => (r.plates ? { ...c, plates: r.plates } : c);
    for (const v of r.versions.filter((x) => x.listed !== false)) { mine.push(withPlates(v.body)); origins.set(v.body.id, { kind: "set_snapshot", id: r.id, n: v.n }); }
    if (r.draft) { mine.push(withPlates(r.draft)); origins.set(r.draft.id, { kind: "set_snapshot", id: r.id, n: null }); }
  }
  for (const r of W.all("cast")) { const v = W.headOf(r); if (v) { mine.push(castCard(r.id, v.body)); origins.set(r.id, { kind: "cast", id: r.id, n: v.n }); } }
  for (const r of W.all("location")) { const v = W.headOf(r); if (v) { mine.push(locationCard(r.id, v.body)); origins.set(r.id, { kind: "location", id: r.id, n: v.n }); } }
  cards = [...mine, ...pack].filter((c) => c.kind in TARGET); // kinds Snap doesn't know are dropped
  return cards;
}
W.onChange(() => { if (pack.length) rebuild(); });
// the record version a card shows ({kind, id, n}; n null for a set's working copy), null for a pack card
export const originOf = (id) => origins.get(id) ?? null;

// pack cards and the user's cards, loaded once per page; a failed load is retried on the next call
export const ready = () => (loading ??= Promise.all([loadPack(), W.load()]).then(rebuild).then(hashPack).catch((e) => { loading = null; throw e; }));
// a pack card is version 0 of its reference, known by its hash: the world store keeps today's hash of each, so a pin on
// one reads as moved when a pack update changes the card, and as missing when the pack drops it (SNAP-R60)
const packRef = (card) => `${["set_snapshot", "cast", "location"].includes(card.kind) ? card.kind : "card"}:${card.lineage ?? card.id}`;
async function hashPack() {
  W.setPack(new Map(await Promise.all(pack.map(async (c) => [packRef(c), { hash: W.short(await W.sha(c)), name: nameOf(c), id: c.id }]))));
}

// a version of a set card holding an edited snapshot: `mine` is the one working copy Apply keeps, otherwise a new card.
// The set's camera plates come along (the working copy's, which plates.js keeps current): each records its camera, so
// one a later edit moved away from stops counting by itself
export function version(card, snapshot, mine) {
  const lineage = card.lineage ?? card.id, plates = get(`${lineage}-mine`)?.plates ?? card.plates;
  const stamp = new Date().toTimeString().slice(0, 8);
  return { id: mine ? `${lineage}-mine` : `${lineage}-${Date.now().toString(36)}`, kind: "set_snapshot", lineage, saved: Date.now(),
    title: mine ? `Set snapshot: ${snapshot.name}, end of ${snapshot.shot} (my edit)` : `Set snapshot: ${snapshot.name}, end of ${snapshot.shot} (saved ${stamp})`,
    text: card.text, brick: { snapshot }, ...(plates ? { plates: structuredClone(plates) } : {}) };
}

// every saved state of one set, in shot order: the original first, then versions by when they were saved
export function lineage(card) {
  const root = card.lineage ?? card.id;
  return cards.filter((c) => c.kind === "set_snapshot" && (c.id === root || c.lineage === root)).sort((a, b) => (a.id === root ? -1 : b.id === root ? 1 : (a.saved ?? 0) - (b.saved ?? 0)));
}

// keep an edited card as the user's own (never overwrites a pack card): a set's working copy is its record's draft (with
// the plates), any other state of a set a new version of its record, any other card a new version of its own record
export async function save(card, { note = "", by = "person" } = {}) {
  await ready();
  if (card.kind === "set_snapshot") {
    const lineage = card.lineage ?? card.id, { plates, ...body } = card;
    if (card.id === `${lineage}-mine`) await W.fields("set_snapshot", lineage, { draft: body, ...(plates ? { plates } : {}) }, by);
    else { await W.save("set_snapshot", lineage, body, { note, by, listed: true }); if (plates && !W.record("set_snapshot", lineage)?.plates) await W.fields("set_snapshot", lineage, { plates }); }
  } else await W.save("card", card.id, card, { note, by });
  rebuild();
}
// kept takes are the Library's priors: a run card that restores the take's settings; its notes are what it's searched by
const priors = () => T.all().filter((t) => t.prior).map((t) => ({
  id: t.id, kind: "run", title: `Prior: ${t.workflow || "take"} #${t.number}${t.seed != null ? ` · seed ${t.seed}` : ""} · ${new Date(t.created).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`,
  text: [t.text, ...t.notes.map((n) => `${n.sentiment === "right" ? "went right" : "went wrong"}: ${n.tags.join(", ")} ${n.text}`)].join(". "),
  media: t.media.slice(0, 1), brick: { take: t.id, seed: t.seed },
}));
const installed = () => D.all().map((d) => ({ id: `dial:${d.dial}`, kind: "dial", title: `Dial: ${D.label(d)}${d.mode === "pre" ? " · LoRA file" : ""}`, family: d.family,
  text: `${d.info.description || "No description yet."} Negative gives ${d.info.negative || "?"}, positive gives ${d.info.positive || "?"}. ${d.dial} (${d.family})`,
  brick: { dial: d.dial, strength: d.info.pos.useful ?? 0.5 } }));
// priors and the Library's own cards first; installed dials (dozens) after them, minus the ones a card already covers
// SFW only: a card tagged nsfw, or one whose bricks load a file the model graph tags nsfw, is left out
const nsfw = (c) => PF.sfwOnly() && ((c.tags ?? []).includes("nsfw") || (JSON.stringify(c.brick ?? {}).match(/[^"/]+\.safetensors/g) ?? []).some(M.hidden));
const everything = () => [...priors(), ...cards, ...installed().filter((d) => !cards.some((c) => c.kind === "dial" && c.brick?.dial === d.brick.dial))].filter((c) => !nsfw(c));
export const get = (id) => everything().find((c) => c.id === id);
// recipe cards that are a family's setup (their `family` says which), for the Setups sheet
export const setupCards = () => cards.filter((c) => c.kind === "recipe" && c.family);

export function search(query, brick) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const kinds = brick ? Object.keys(TARGET).filter((k) => TARGET[k] === brick) : null; // a selected brick never shows recipes
  return everything()
    .filter((c) => !kinds || kinds.includes(c.kind))
    .map((c) => {
      const title = c.title.toLowerCase(), text = `${c.kind} ${c.text}`.toLowerCase();
      return [c, words.reduce((s, w) => s + (title.includes(w) ? 3 : 0) + (text.includes(w) ? 1 : 0), 0)];
    })
    .filter(([, score]) => !words.length || score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
}

// search by meaning: EmbeddingGemma 2 in a local sidecar (snap_bridge /mainodes/snap/search), slot-filtered like the
// keyword search. null = use the keyword order (the sidecar is warming up, or this machine doesn't have it)
let meaningOff = null;
export async function meaning(query, brick) {
  if (meaningOff || !query.trim()) return null;
  const kinds = brick ? Object.keys(TARGET).filter((k) => TARGET[k] === brick) : undefined;
  const list = everything().filter((c) => !kinds || kinds.includes(c.kind)).map(({ id, kind, title, text }) => ({ id, kind, title, text }));
  const r = await (await api.fetchApi("/mainodes/snap/search", { method: "POST", body: JSON.stringify({ query, kinds, cards: list }) })).json();
  if (r.unavailable) meaningOff = r.unavailable;
  if (r.engine !== "embeddinggemma-2") return r.warming ? "warming" : null;
  return r.ids.map(get).filter(Boolean);
}

// the phrases a card adds to a prompt: its fragment, a principle's "Prompt cue: ...", or a scene's parts
function cues(card) {
  if (card.kind === "scene") return [...(card.brick.characters ?? []), card.brick.setting, ...(card.brick.principles ?? [])].map(get).filter(Boolean).flatMap(cues);
  const one = card.brick?.prompt_fragment ?? card.text.split("Prompt cue: ")[1]?.replace(/\.$/, "");
  return one ? [one] : [];
}

// the line a Cast's words go on: the first, or, when the prompt opens with a bare section header ("subject_definitions:"
// alone on its line, a LoRA's trained caption), the first line of text under it, so the caption keeps its shape (F-D08)
const lineFor = (lines) => (/^\s*[a-z_]+:\s*$/i.test(lines[0] ?? "") ? Math.max(1, lines.findIndex((l, i) => i > 0 && l.trim())) : 0);
function removeFromPrompt(phrases) {
  const lines = (E.getValue("render", "render", "prompt") ?? "").split("\n"), at = lineFor(lines);
  const before = lines[at] ?? "";
  let line = before;
  for (const x of phrases) line = line.replace(x, "");
  if (line === before) return; // nothing of ours was there: leave the person's text exactly as it is
  lines[at] = line.replace(/\s*,\s*(?=[,.])/g, "").replace(/\s{2,}/g, " ").replace(/\s+\./g, ".").replace(/\.{2,}/g, ".").trimEnd();
  E.setValue("render", "render", "prompt", lines.join("\n"));
}

// add the phrases not already there to the H3 prompt's integrated description (its first line, or the first line under
// a bare section header)
function addToPrompt(phrases) {
  const lines = (E.getValue("render", "render", "prompt") ?? "").split("\n"), at = lineFor(lines), line = lines[at] ?? "";
  const fresh = phrases.filter((x) => !line.includes(x));
  if (!fresh.length) return false;
  lines[at] = `${line.replace(/\s*$/, "")} ${fresh.join(", ")}.`.trimStart();
  E.setValue("render", "render", "prompt", lines.join("\n"));
  return true;
}

// ---- pins (SNAP-R60): the recipe remembers which version of each record it holds, in extra.snap.world
// the pin a recipe keeps for one record: which version it holds, and where that version's pieces went
export const pinOf = (ref) => E.state().world?.[ref] ?? null;
// the pinned version's own rating rides on the pin, so the server rates and caps the run with it (SNAP-R39, SNAP-R33)
export function pin(ref, { rating: _, ...entry }) {
  const { kind, id } = W.parse(ref), rating = W.get(W.refOf(kind, id, entry.n))?.version.body.rating;
  E.tag("world", { ...E.state().world, [ref]: { follow: pinOf(ref)?.follow ?? true, ...entry, ...(rating ? { rating } : {}) } });
}
// a record as a person names it: a Cast's name, a set's name and moment, else the card's title
export const nameOf = (body) => body?.name ?? (body?.brick?.snapshot ? `${body.brick.snapshot.name}, end of ${body.brick.snapshot.shot}` : body?.title ?? "?");
// the version a card stands for, saved first when it is a set's working copy (a take never pins a draft; the same
// state saved before is reused): {ref, n, hash}; a pack card is version 0 with its own hash
async function versionOf(card) {
  const o = originOf(card.id);
  if (o?.kind === "set_snapshot" && o.n == null) {
    const { plates, ...body } = card, out = await W.save("set_snapshot", o.id, body, { note: "used in References", listed: false, if_absent: true });
    rebuild();
    return { ref: W.refOf("set_snapshot", o.id), n: out.n, hash: W.short(W.get(out.ref).version.hash) };
  }
  if (o) return { ref: W.refOf(o.kind, o.id), n: o.n, hash: W.short(W.get(W.refOf(o.kind, o.id, o.n)).version.hash) };
  return { ref: packRef(card), n: 0, hash: W.short(await W.sha(card)) };
}
async function pinCard(card) { const v = await versionOf(card); pin(v.ref, { n: v.n, hash: v.hash, name: nameOf(card) }); return v; }
// the setup a recipe was applied from (a family recipe card) is pinned like any card, one at a time: applying another
// drops the pin of the one it replaces (`was`, the card id the recipe held). Called on the tab the card went onto, so a
// setup that opened a new tab pins there and the tab it left keeps its own pins
export async function pinSetup(card, was) {
  const old = was && was !== card.id ? get(was) : null;
  if (old) { const o = originOf(old.id), { [o ? W.refOf(o.kind, o.id) : packRef(old)]: _, ...rest } = E.state().world ?? {}; E.tag("world", rest); }
  const v = await versionOf(card);
  pin(v.ref, { n: v.n, hash: v.hash, name: nameOf(card), setup: true });
  return v;
}

// local upload into ComfyUI's input/snap folder; returns the LoadImage value ("snap/<name>")
async function upload(canvas, name) {
  const form = new FormData();
  form.append("image", await toBlob(canvas), name);
  form.append("subfolder", "snap");
  form.append("overwrite", "true");
  const r = await (await api.fetchApi("/upload/image", { method: "POST", body: form })).json();
  return `${r.subfolder}/${r.name}`;
}

// file names follow the set's state, so an edited set gets new pictures and an unchanged one reuses its own
const digest = (text) => [...text].reduce((h, c) => (h * 33 + c.charCodeAt(0)) >>> 0, 5381).toString(36);

// a set snapshot: plan + elevation compiled from the set data go into References (replacing this card's earlier
// pictures), the set block and blocking into the prompt, so the next shot starts from where this one ended
export async function applySet(card, s = card.brick.snapshot, { prompt = true, version } = {}) {
  const v = version ?? await versionOf(card);
  const stem = `${card.id.replace(/[^a-z0-9-]/gi, "_")}_${digest(JSON.stringify(s))}`;
  const plan = await upload(drawPlan(s), `${stem}_plan.png`);
  const elevation = await upload(drawElevation(s), `${stem}_elevation.png`);
  const source = card.lineage ?? card.id; // every version of one set shares its picture slots
  E.batch(() => { // pictures, prompt and the remembered set text are one undo step
    E.addPicture(plan, { role: "set: plan", reason: `${s.name}, end of ${s.shot}, top down`, source, card: card.id });
    E.addPicture(elevation, { role: "set: elevation", reason: `${s.name}, end of ${s.shot}, looking north`, source, card: card.id });
    if (prompt && E.state().bricks.some((b) => b.key === "render")) { // this set's earlier block and blocking give way to the new ones
      const refs = E.state().bricks.find((b) => b.key === "refs"), text = [setBlock(s), blocking(s)];
      removeFromPrompt(refs.setText?.[source] ?? []);
      addToPrompt(text);
      E.remember("refs", "setText", { ...refs.setText, [source]: text });
    }
    pin(v.ref, { n: v.n, hash: v.hash, name: nameOf(card) });
  });
  return `${card.title}: plan and elevation in References, set block in the prompt`;
}

// the shot compiler (BRAINSTORM S1): a shot card's beat, characters, set, camera setup and principles become the first
// line of the Render prompt, each part remembering the card it came from; the set's pictures go into References
// the set a shot uses: the person's edit of it (the set editor's working copy) when there is one
const shotSet = (id) => get(`${id}-mine`) ?? get(id);

// the picture of the set a shot gets (SNAP-R21, U49): the plate made from this shot's camera, seen from this camera;
// else the set's wide plate, told the camera is somewhere else; null when the set has neither (its plan and elevation
// go in as before). A shot that asks to start on an exact frame gets its plate as FL2V's first frame instead
function setPicture(set, key, cam, b) {
  const p = set.plates ?? {}, plate = p.cameras?.[key];
  if (plate && sameCamera(plate.camera, cam)) return { use: b.start === "exact" ? "first_frame" : "plate", image: plate.image, camera: key, why: `the plate made from ${key}` };
  const moved = plate ? ` (its plate was made before the camera moved)` : "";
  if (b.start === "exact") return null;
  return p.wide ? { use: "wide", image: p.wide.image, camera: key, why: `the set's wide plate: ${key} has no plate yet${moved}` } : null;
}
// the number H3 gives the set's plate among References' pictures (in socket order): its slot when it is there, else the next
const PLATE_ROLE = "set: plate";
function pictureNumber(source) {
  const pics = E.state().bricks.find((x) => x.key === "refs")?.pictures ?? [], i = pics.findIndex((x) => x.source === source && x.role === PLATE_ROLE);
  return (i >= 0 ? i : pics.length) + 1;
}

export function compile(card) {
  const b = card.brick, set = shotSet(b.set), s = set?.brick.snapshot;
  if (!s) throw new Error(`${card.title}: its set ${b.set} isn't in the Library`);
  const part = (field, text, from) => (text ? [{ field, text: text[0].toUpperCase() + text.slice(1), from }] : []); // each part reads as a sentence
  const cam = b.setup && coverage(s).find((c) => c.name === b.setup);
  if (b.setup && !cam) throw new Error(`${card.title}: "${b.setup}" isn't a setup for this set's two actors`);
  const view = cam ? atCamera(s, cam) : s; // the set as this shot's camera sees it: what is in frame, where the doors are
  const picture = setPicture(set, cam?.name ?? ownCamera(s), view.camera, b), n = picture && pictureNumber(set.lineage ?? set.id);
  const reference = !picture || picture.use === "first_frame" ? ""
    : picture.use === "plate" ? `This is the ${s.name} shown in <Picture ${n}>, seen from this camera; keep its ${keeps(s)} exactly as in <Picture ${n}>.`
    : `This is the same ${s.name} shown in <Picture ${n}>, but the camera is not where <Picture ${n}> was taken: this is a new view from this shot's camera. Keep its ${keeps(s)} exactly as in <Picture ${n}>.`;
  const shooting = cam ? `${cam.name.replace(/^OTS on/, "over the shoulder, on").replace(/^single/, "a single on")}, ${cam.lens} mm lens` : `${s.camera.lens} mm lens`;
  const parts = [
    ...part("beat", `${b.beat}.`, card.id),
    ...(b.characters ?? []).map(get).filter(Boolean).flatMap((c) => part("character", `${cues(c).join(", ")}.`, c.id)),
    ...part("set", setBlock(view), set.id),
    ...part("blocking", blocking(s), set.id),
    ...part("camera", `Camera: ${shooting}, ${cameraAt(view)}.`, set.id),
    ...part("reference", reference, set.id),
    ...(b.principles ?? []).map(get).filter(Boolean).flatMap((p) => part("direction", cues(p).length ? `${cues(p).join(", ")}.` : "", p.id)),
  ];
  return { line: `integrated_multimodal_description: [${b.shot}] ${parts.map((x) => x.text).join(" ")}`, parts, picture };
}

// the Render Preset a picture needs: Ref2V for a reference, FL2V for a first frame. The first preset that conditions
// that way (Pika + reference pictures / Pika H3 Flex) takes over when the current one doesn't; null when it already does
// F-C32 (short03): a Ref2V render reads no first frame, so while the Render Preset conditions on Ref2V and the First
// frame brick holds a picture, that picture opens the shot as <Picture 1> in References, ahead of the others: an
// eye-level still as Picture 1 of a Ref2V walk set the walk's camera height (2/2), where words never did (0/2). Under any
// other conditioning the First frame is read as it is, and the copy in References goes. Runs after every setup change
// and every new First frame; answers {cite, said} while the copy is there, else null
export const OPENING = "first frame: the shot opens on it";
export function syncOpening() {
  const keys = E.state().bricks.map((x) => x.key), refs = keys.includes("refs") && E.state().bricks.find((x) => x.key === "refs");
  if (!refs) return null;
  const ff = keys.includes("first_frame") && E.nodeFor("first_frame", "image"), file = ff && ff.mode === 0 ? E.getValue("first_frame", "image", "image") : null;
  const ref2v = keys.includes("preset") && String(E.getValue("preset", "preset", "conditioning") ?? "").startsWith("Ref2V");
  for (const p of refs.pictures ?? []) if (p.source === "first_frame" && (!ref2v || p.file !== file)) E.removePicture(p.node);
  if (!ref2v || !file) return null;
  E.addPicture(file, { role: OPENING, reason: "the First frame: Ref2V reads no first frame, so the shot opens on this picture", source: "first_frame", first: true });
  const cite = E.references()?.pictures.find((p) => p.file === file)?.cite;
  return { cite, said: `the First frame is ${cite} too, the opening frame (Ref2V reads no first frame): say the shot opens on ${cite}` };
}
T.onFirstFrame(syncOpening);

function conditionFor(want) {
  if (!E.state().bricks.some((x) => x.key === "preset") || String(E.getValue("preset", "preset", "conditioning")).startsWith(want)) return null;
  const s = M.setups().find((x) => x.source === "preset" && String(x.values.conditioning).startsWith(want));
  if (!s) throw new Error(`No Render Preset conditions on ${want}; the set's picture would do nothing`);
  M.apply(s.name);
  return s.name;
}

async function applyShot(card) {
  const { line, parts, picture } = compile(card), set = shotSet(card.brick.set);
  if (picture?.use === "first_frame" && !E.state().bricks.some((x) => x.key === "first_frame")) throw new Error(`${card.title} starts on its plate's exact frame: add the First frame brick first`);
  app.canvas.emitBeforeChange(); // the set pictures, the prompt line, the length, the preset and the record are one undo step
  let preset = null;
  try {
    if (!picture) await applySet(set, set.brick.snapshot, { prompt: false });
    else if (picture.use === "first_frame") {
      const w = E.nodeFor("first_frame", "image").widgets.find((x) => x.name === "image");
      if (!w.options.values.includes(picture.image)) w.options.values.push(picture.image); // uploaded after the page loaded
      E.setValue("first_frame", "image", "image", picture.image);
      preset = conditionFor("FL2V");
    }
    else { E.addPicture(picture.image, { role: PLATE_ROLE, reason: picture.why, source: set.lineage ?? set.id, card: set.id }); preset = conditionFor("Ref2V"); }
    const [, ...rest] = (E.getValue("render", "render", "prompt") ?? "").split("\n");
    E.setValues("render", "render", { prompt: [line, ...rest].join("\n"), ...(card.brick.length ? { length: card.brick.length } : {}) });
    E.remember("render", "shot", { card: card.id, parts: parts.map(({ field, from, text }) => ({ field, from, text })), ...(picture ? { picture } : {}) });
    await pinCard(card);
    if (picture) await pinCard(set); // without a picture applySet pinned it
    for (const c of (card.brick.characters ?? []).map(get).filter(Boolean)) await pinCard(c);
  } finally { app.canvas.emitAfterChange(); }
  const where = !picture ? "set in References" : picture.use === "first_frame" ? `its plate as the first frame` : `${picture.why} in References`;
  return `${card.title}: compiled into the prompt (${parts.length} parts), ${where}${preset ? `; Render Preset now ${preset} (the picture needs it)` : ""}`;
}

// ---- Cast (U86, SNAP-R59): a character's details live once, on its Cast record; a recipe holds what ran (the Cast row,
// the details sentence, the pictures), written by applyCast from one version and pinned in extra.snap.world
// the sentence a Cast version puts into the prompt: its trigger words, then its details line
export const castLine = (b) => [b.trigger, b.details].map((x) => x?.trim()).filter(Boolean).join(", ");
const castCard = (id, b) => ({ id, kind: "cast", title: `Cast: ${b.name}`, text: [b.details, b.lore].filter(Boolean).join(" ") || b.name,
  brick: { cast: `cast:${id}`, ...(castLine(b) ? { prompt_fragment: castLine(b) } : {}) }, ...(b.rating ? { rating: b.rating } : {}) });
// SNAP-R59 + R11: a version whose words change while its pictures stay the same rarely changes the look (H3 copies a
// reference picture over the words): one line that says so, never a refusal
export function lookWarning(was, now) {
  if (!was || !now?.refs?.length) return null;
  const words = (b) => `${b.trigger ?? ""}|${b.details ?? ""}`, pics = (b) => JSON.stringify((b.refs ?? []).map((r) => r.file));
  return words(was) !== words(now) && pics(was) === pics(now) ? `${now.name}'s pictures still show the old look; pictures usually win over the details line. Change the pictures too.` : null;
}
export const castStamp = () => `cast-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// a new version of a Cast record (a new record when id is null): {id, ref, n, made}
export async function saveCast(id, body, { note = "", by = "person" } = {}) {
  await ready();
  if (!body?.name?.trim()) throw new Error("A cast member needs a name");
  const clean = { name: body.name.trim(), alias: body.alias?.trim() ?? "", trigger: body.trigger?.trim() ?? "", details: body.details?.trim() ?? "",
    lora: body.lora?.file ? { file: body.lora.file, strength: +(body.lora.strength ?? 1) } : null, refs: (body.refs ?? []).map((r) => ({ file: r.file, role: r.role || "identity" })),
    lore: body.lore?.trim() ?? "", rating: body.rating ?? null,
    ...(body.voice?.file ? { voice: { file: body.voice.file, casting: body.voice.casting?.trim() ?? "", ...(body.voice.words?.trim() ? { words: body.voice.words.trim() } : {}) } } : {}), // U101: a voice reference only when given, so older records save unchanged; SNAP-R241 the words it says
    ...(body.states?.length ? { states: body.states } : {}) }; // SNAP-R69: settei per state, only when there are some
  // F-C30: each file's hash goes on the record (the exact file it used), and a newer upload of the same name is said
  const newer = [];
  for (const r of [...clean.refs, ...(clean.voice ? [clean.voice] : [])]) {
    const at = await (await api.fetchApi(`/mainodes/snap/info?input=${encodeURIComponent(r.file)}`)).json();
    if (at.input_sha256) r.sha = at.input_sha256.slice(0, 16);
    if (at.input_newer?.length) newer.push(`${r.file} is older than ${at.input_newer.join(", ")} in input/: an upload of a name already there is saved under a new name and never replaces it. Give that name if you meant the new file`);
  }
  id ??= castStamp();
  const was = W.headOf(W.record("cast", id))?.body, out = await W.save("cast", id, clean, { note, by });
  rebuild();
  const warning = [out.made ? lookWarning(was, clean) : null, ...newer].filter(Boolean).join("; ") || null;
  return { id, ref: out.ref, n: out.n, made: out.made, ...(warning ? { warning } : {}) };
}
// a reference picture for a Cast record, into input/snap/cast/<id>/; returns the LoadImage value
export async function uploadCastPicture(file, id) {
  const form = new FormData();
  form.append("image", file, file.name);
  form.append("subfolder", `snap/cast/${id}`);
  form.append("overwrite", "false");
  const r = await (await api.fetchApi("/upload/image", { method: "POST", body: form })).json();
  return `${r.subfolder}/${r.name}`;
}
// UI-03 (SNAP-R123): a take's frame sent where it is going, from the take viewer's "Send to" and use_take: a Cast's next
// picture (a new version saying which take and frame) or a location's plate (a new version, the plate's from = the take)
// F-U01 (SNAP-R196): `replace` (a picture's number from 0) puts the take's picture in that picture's place, keeping its
// role unless one is given: one detail of a Cast picture fixed (a region edit of it) is a new version, the old one kept
export async function takeToCast(t, ref, { at = "last", frame, crop, role, replace, by = "person" } = {}) {
  await ready();
  const { kind, id } = W.parse(ref), r = kind === "cast" && W.record("cast", id);
  if (!r) throw new Error(`No Cast ${ref}; list_cast lists them`);
  const b = W.headOf(r).body, was = replace != null ? b.refs[replace] : null;
  if (replace != null && !was) throw new Error(`${b.name} v${W.headOf(r).n} has no picture ${replace}; it has ${b.refs.length} (0 to ${b.refs.length - 1})`);
  const got = await T.frameAt(t, at, { frame, crop }), what = role?.trim() || was?.role || `from take ${t.number}${t.media.some((m) => m.kind === "video") ? `, frame ${got.frame}` : ""}`;
  const refs = was ? b.refs.map((x, i) => (i === replace ? { ...x, file: got.file, role: what } : x)) : [...b.refs, { file: got.file, role: what }];
  const out = await saveCast(id, { ...b, refs }, { note: was ? `picture ${replace} ("${was.role}") from take ${t.number}, frame ${got.frame}` : `a picture from take ${t.number}, frame ${got.frame}`, by });
  return { cast: `cast:${id}`, version: out.n, file: got.file, role: what, ...(was ? { replaced: { picture: replace, file: was.file, kept_in: `v${out.n - 1}` } } : {}),
    said: was ? `${b.name} v${out.n}: picture ${replace} ("${what}") is now frame ${got.frame} of take ${t.number}; v${out.n - 1} keeps the old one, and what pinned v${out.n - 1} still reads it (rerun_dependents re-makes them)` : `${b.name} v${out.n}: frame ${got.frame} of take ${t.number} is picture ${b.refs.length + 1} ("${what}")${role ? "" : "; say what it shows in the Cast sheet"}` };
}
// F-F06 (SNAP-R143): a stretch of a take's sound becomes the Cast's voice reference, a new version naming the take;
// SNAP-R241: with the words the stretch says, from the take's Voice QA words (take seconds), so a reference that says a
// line of the script can be linted (F-SQ12: H3 copies a reference's words)
export async function takeToVoice(t, ref, { at = 0, length, casting, by = "person" } = {}) {
  await ready();
  const { kind, id } = W.parse(ref), r = kind === "cast" && W.record("cast", id), video = t.media.find((m) => m.kind === "video" || m.kind === "audio");
  if (!r) throw new Error(`No Cast ${ref}; list_cast lists them`);
  if (!video) throw new Error(`take ${t.number} is a still: it has no sound`);
  const b = W.headOf(r).body, name = `${b.name}_voice_take${t.number}_${String(at).replace(".", "p")}s`;
  const res = await api.fetchApi("/mainodes/snap/take_voice", { method: "POST", body: JSON.stringify({ video: `${video.subfolder ? `${video.subfolder}/` : ""}${video.filename} [${video.type ?? "output"}]`, at, ...(length ? { length } : {}), name }) }), got = await res.json();
  if (!res.ok) throw new Error(got.error ?? `cutting the sound failed (${res.status})`);
  const end = at + got.seconds, said = (t.voice?.words ?? []).filter(([s, e]) => (s + e) / 2 >= at && (s + e) / 2 <= end).map((w) => w[2]).join(" ");
  const out = await saveCast(id, { ...b, voice: { file: got.file, casting: casting ?? b.voice?.casting ?? "", ...(said ? { words: said } : {}) } }, { note: `voice from take ${t.number}, ${at} s${length ? ` for ${length} s` : " to the end"}`, by });
  return { cast: `cast:${id}`, version: out.n, voice: got.file, seconds: got.seconds, ...(said ? { words: said } : {}),
    said: `${b.name} v${out.n}: the voice is ${got.seconds} s of take ${t.number}'s sound from ${at} s (${got.file}); ${said ? `it says "${said}" (the take's Voice QA words): a line of the script that says the same is linted (SNAP-R241)` : t.voice?.words ? "no words heard in that stretch" : `its words aren't known: check_voice on take ${t.number} first (the Voice QA hears them), or save_cast voice {words}`}` };
}
export async function takeToPlate(t, ref, { frame, name, by = "person" } = {}) {
  await ready();
  const video = t.media.some((m) => m.kind === "video"), plate = { name: name?.trim() || `take ${t.number}${video && frame != null ? ` f${frame}` : ""}`, take: t.id, ...(video && frame != null ? { frame } : {}) };
  const out = await addPlate(ref, plate, { note: `plate ${plate.name} from take ${t.number}`, by });
  return { location: `location:${out.id}`, version: out.n, plate: plate.name, said: `${locationOf(out.ref).body.name} v${out.n}: plate "${plate.name}" from take ${t.number}${plate.frame != null ? `, frame ${plate.frame}` : ""}; place it on the plan in the Location sheet` };
}
// put one Cast version into the open recipe, replacing what an earlier apply of the same record put there: its LoRA row
// on the Cast brick (snapped in when missing), its sentence in the prompt's first line, its pictures in References.
// `strength` overrides the record's for this recipe (the pin says so). Returns what happened
// line (F-L02, SNAP-R165): the details line as a Book cut tells it (the Cast's clauses its story state overrides left out);
// the pin keeps it, so a re-apply takes that text back out
// voice (SNAP-R237): true puts the Cast's voice reference in, false keeps it out (why: the reason said); unset, voiceWanted decides
export async function applyCast(ref, { strength, pictures, line: told = null, voice = null, why = null } = {}) {
  await ready();
  const { kind, id, n } = W.parse(ref);
  if (kind !== "cast") throw new Error(`${ref} isn't a Cast reference (cast:<id> or cast:<id>@n)`);
  const got = W.get(ref);
  if (!got) throw new Error(W.record("cast", id) ? `Cast ${id} has no version ${n}; it has v1-v${W.record("cast", id).head}` : `No Cast record ${id}`);
  // UI-04 (SNAP-R124): pictures picks which of the record's pictures this shot uses, by role (a state, a view); the pin keeps
  // the choice, so an update or a re-apply puts the same ones in
  const all = got.version.body, pick = pictures?.length ? pictures : pictures ? null : pinOf(`cast:${id}`)?.placed?.pictures ?? null; // [] = every picture again
  const absent = (pick ?? []).filter((x) => !all.refs.some((r) => r.role === x));
  if (absent.length) throw new Error(`${all.name} v${got.version.n} has no picture ${absent.map((x) => `"${x}"`).join(", ")}; its pictures: ${all.refs.map((r) => `"${r.role}"`).join(", ") || "none"}`);
  const b = pick ? { ...all, refs: all.refs.filter((r) => pick.includes(r.role)) } : all, key = `cast:${id}`, was = pinOf(key)?.placed ?? {}, placed = pick ? { pictures: pick } : {}, line = told ?? castLine(b);
  let preset = null, opening = null;
  if (!E.state().bricks.some((x) => x.key === "render")) throw new Error(`${b.name} goes into the Render prompt: add the Render brick first`);
  const keys = () => E.state().bricks.map((x) => x.key);
  app.canvas.emitBeforeChange(); // the row, the sentence, the pictures and the pin are one undo step
  try {
    const rows = keys().includes("cast") ? M.rows("cast") : [], mine = was.row != null && rows[was.row] ? was.row : null;
    if (b.lora) {
      const s = strength ?? b.lora.strength;
      if (mine != null) { M.setRow("cast", mine, { file: b.lora.file, strength: s, on: true }); placed.row = mine; }
      else {
        if (!keys().includes("cast")) await E.snap("cast", { at: keys().includes("rack") ? keys().indexOf("rack") : undefined });
        placed.row = M.addRow("cast", b.lora.file, s);
      }
    } else if (mine != null) { // this version has no LoRA: its row goes, and the other Cast pins' rows below it move up
      M.removeRow("cast", mine);
      for (const [r, p] of Object.entries(E.state().world ?? {})) if (r !== key && p.placed?.row > mine) pin(r, { ...p, placed: { ...p.placed, row: p.placed.row - 1 } });
    }
    if (was.text && was.text !== line) removeFromPrompt([was.text]);
    if (line) { addToPrompt([line]); placed.text = line; }
    if (b.refs.length || was.roles?.length) {
      if (!keys().includes("refs")) await E.snap("refs");
      const roles = b.refs.map((r) => `cast: ${b.name}, ${r.role}`);
      for (const p of E.state().bricks.find((x) => x.key === "refs").pictures ?? []) if (p.source === key && !roles.includes(p.role)) E.removePicture(p.node);
      b.refs.forEach((r, i) => E.addPicture(r.file, { role: roles[i], reason: `${b.name}, cast v${got.version.n}`, source: key, card: W.refOf("cast", id, got.version.n) }));
      placed.roles = roles;
      // U72 F23: References reach only a render that reads them (H3: a Ref2V conditioning). Switch the Render Preset to a
      // setup that does, saying so (SNAP-R11); where none can, the pin says the pictures go unread
      if (b.refs.length) { try { preset = conditionFor("Ref2V"); } catch (e) { placed.unread = e.message; } }
    }
    // SNAP-R73: the Cast's voice reference goes into References as an audio reference, cited <Audio n>; a version without
    // one takes the last apply's out. SNAP-R237 (F-SQ11/12, F-AC11): only where that Cast speaks, else it stays out, said
    const voiced = E.state().bricks.find((x) => x.key === "refs")?.audios?.find((x) => x.source === key);
    const wanted = b.voice?.file && voice == null ? voiceWanted(key, b.name, !!voiced) : { want: voice !== false, why: why ?? (voice === false ? "asked to leave it out" : "asked for") };
    if (b.voice?.file && !wanted.want) {
      if (voiced) E.removeAudio(voiced.node);
      placed.no_voice = wanted.why;
    } else if (b.voice?.file) {
      if (!keys().includes("refs")) await E.snap("refs");
      const a = E.addAudio(b.voice.file, { role: `cast: ${b.name}, voice`, reason: `${b.name}, cast v${got.version.n}${b.voice.casting ? `: ${b.voice.casting}` : ""}`, source: key, card: W.refOf("cast", id, got.version.n) });
      placed.voice = `<Audio ${E.audioNumber(a.node)}>`;
    } else if (voiced) E.removeAudio(voiced.node);
    opening = syncOpening();
    pin(key, { n: got.version.n, hash: W.short(got.version.hash), name: b.name, placed, ...(strength != null ? { strength } : {}) });
  } finally { app.canvas.emitAfterChange(); }
  app.canvas.setDirty(true, true);
  return `${b.name} v${got.version.n}: ${[b.lora && `${b.lora.file.split("/").pop().replace(/\.safetensors$/, "")} at ${strength ?? b.lora.strength} on Cast`, line && "the details in the prompt", b.refs.length && `${b.refs.length} picture${b.refs.length === 1 ? "" : "s"} in References`, placed.voice && `the voice reference as ${placed.voice} (cite it in the prompt)`, placed.no_voice && `no voice for ${b.name}: ${placed.no_voice} (apply_cast {voice: true} puts it in)`].filter(Boolean).join(", ") || "nothing to put in (no LoRA, words or pictures)"}${preset ? `; Render Preset now ${preset} (the pictures need it)` : ""}${opening ? `; ${opening.said}` : ""}${placed.unread ? `; the pictures are not read by this render: ${placed.unread}` : ""}`;
}

// SNAP-R237: whether a Cast's voice reference belongs in the open recipe. A recipe a Book cut compiled (its story pin)
// says it by its lines: the voice goes in only where that Cast has one, so a re-take or re-run with today's world never
// brings a voice into a silent cut (F-AC11). On a plain shot it stays when already in (a version update) and goes in when
// the prompt gives the Cast a line ("Kuroe says…", "Kuroe: \"…\"", "Kuroe <d>…</d>"). -> {want, why}
const SPEECH = "says|said|asks|asked|shouts|shouted|whispers|whispered|yells|yelled|mutters|muttered|replies|replied|calls out|exclaims|gasps";
export function voiceWanted(key, name, voiced) {
  const from = E.state().story?.from;
  if (from) {
    const speaks = Object.keys(from).some((k) => k.split(".line.")[1] === key);
    return { want: speaks, why: speaks ? "a line in this cut" : `no line in this cut${E.state().story.unit?.cut ? ` (${E.state().story.unit.cut})` : ""}` };
  }
  if (voiced) return { want: true, why: "already in this recipe" };
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), prompt = E.getValue("render", "render", "prompt") ?? "";
  const line = new RegExp(`\\b${n}\\b[^.\\n"“]{0,40}\\b(${SPEECH})\\b|\\b${n}\\b\\s*(\\(S\\d+\\))?\\s*:?\\s*(<d>|["“])`, "i").test(prompt);
  return { want: line, why: line ? "the prompt gives a line" : "the prompt gives no line" };
}

// U72 F23: References that this render won't read (H3 reads pictures only with a Ref2V conditioning), as one line, or null
export function picturesUnread() {
  const n = E.state().bricks.find((x) => x.key === "refs")?.pictures?.length ?? 0, c = E.state().bricks.some((x) => x.key === "preset") ? String(E.getValue("preset", "preset", "conditioning") ?? "") : null;
  return n && c && !c.startsWith("Ref2V") ? `References holds ${n} picture${n === 1 ? "" : "s"}, but the Render Preset conditions on ${c}: this render doesn't read them. Pick a reference-pictures setup (list_setups, apply_setup), or apply_cast again` : null;
}
// ---- Locations (G1, U99 / F-C17, SNAP-R84): a place kept once as a record, snap/location/<id>.json, versioned like a Cast:
// its master picture, its set plan (an overhead map), camera marks on the plan and named plates, each a picture with
// its camera pose and the take/frame it came from. A pose is {x, y} on the plan in fractions of the picture from its
// top left, heading in degrees clockwise from the plan's up (north), eye_height in metres, lens in mm. A shot cites a
// plate by name: applyLocation puts the master, the plan and the named plates into References as <Picture n> and pins
// the version, so every take made there says which version of the place it used.
const POSE = ["x", "y", "heading", "eye_height", "lens"];
// F-D10: a plate whose eye height differs from its camera mark's by more than 0.2 m: the walk came out lower or higher
// than planned, and figures placed on it stand at the wrong scale. Snap doesn't measure a picture: it compares the two
// typed numbers the record holds, says so, and asks for a look at the horizon instead of stating a fact (F-E18: a plate
// typed 2 m read at eye height in the picture). A plate with no mark is compared with the eye height every mark of the
// place shares, named as such (F-E18: the highest plate had no mark and no line). {plate: {pose, plan, mark, by}}
export function eyeGapsOf(b) {
  const out = {}, heights = [...new Set((b.cameras ?? []).map((c) => c.eye_height).filter((x) => x != null))], shared = heights.length === 1 ? heights[0] : null;
  for (const p of b.plates ?? []) {
    const c = p.camera && (b.cameras ?? []).find((x) => x.name === p.camera), got = p.pose?.eye_height, plan = c ? c.eye_height : shared;
    if (got != null && plan != null && Math.abs(got - plan) > 0.2) out[p.name] = { pose: got, plan, mark: c?.name ?? null, by: +(got - plan).toFixed(1) };
  }
  return out;
}
// the same as lines for agents: which numbers, where each came from, and what to check
export function eyeGaps(b, only = null) {
  return Object.fromEntries(Object.entries(eyeGapsOf(b)).filter(([name]) => !only || only.includes(name)).map(([name, g]) => [name,
    `pose says eye ${g.pose} m, ${g.mark ? `camera mark ${g.mark} says ${g.plan} m` : `no camera mark (every mark of this place is at ${g.plan} m)`}: ${Math.abs(g.by)} m ${g.by < 0 ? "lower" : "higher"} than planned by the typed numbers. Snap compares what was typed, not the picture: check the horizon against the doors; if the pose is right, figures on it stand ${g.by < 0 ? "too tall" : "too small"}`]));
}
// SNAP-R84: master, plan, and the camera map (F-E11: the walks' wedges drawn over the plan, kept as its own picture so the
// plan stays bare); the map is for people and critics, never a render's reference (SNAP-R133: marks leak into renders)
export const LOCATION_PICTURES = ["master", "plan", "map"];
const locationStamp = () => `location-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const locationCard = (id, b) => ({ id, kind: "location", title: `Location: ${b.name}`, text: [b.notes, ...(b.plates ?? []).map((p) => `plate ${p.name}${p.use ? `: ${p.use}` : ""}`)].filter(Boolean).join(" ") || b.name,
  brick: { location: `location:${id}` }, ...(b.master ? { media: [{ kind: "image", ...inputMedia(b.master.file) }] } : {}), ...(b.rating ? { rating: b.rating } : {}) });
const inputMedia = (file) => { const cut = file.lastIndexOf("/"); return { filename: file.slice(cut + 1), subfolder: file.slice(0, Math.max(cut, 0)), type: "input" }; };
function poseOf(p, what) {
  if (p == null) return null;
  if (typeof p !== "object") throw new Error(`${what}: a pose is {x, y, heading, eye_height, lens}; not ${JSON.stringify(p)}`);
  const wrong = Object.keys(p).filter((k) => !POSE.includes(k) || (p[k] != null && typeof p[k] !== "number"));
  if (wrong.length) throw new Error(`${what}: a pose takes numbers for ${POSE.join(", ")} (x and y in fractions of the plan from its top left, heading in degrees clockwise from its up, eye_height in metres, lens in mm); not ${wrong.map((k) => `${k} ${JSON.stringify(p[k])}`).join(", ")}`);
  for (const k of ["x", "y"]) if (p[k] != null && !(p[k] >= 0 && p[k] <= 1)) throw new Error(`${what}: ${k} is a fraction of the plan, 0 to 1; not ${p[k]}`);
  return Object.fromEntries(POSE.filter((k) => p[k] != null).map((k) => [k, k === "heading" ? ((p[k] % 360) + 360) % 360 : p[k]]));
}
// a picture of a location: an input/ file as it is, or a take's frame (frame; a still has one) saved into input/ with
// where it came from; {file, from} as the record keeps it
async function locationPicture(p, what, dry = false) {
  if (p == null) return null;
  if (p.take) {
    await T.load();
    const t = T.find(p.take);
    if (!t) throw new Error(`${what}: no take ${p.take} (list_takes lists them)`);
    // F-S08: the take by its id's start too (two shots each have a take 3)
    if (dry) return { file: `(take ${t.number}'s frame, saved into input/ by the real call; ${t.id.slice(0, 13)})`, from: { take: t.id, frame: p.frame ?? (t.media.some((m) => m.kind === "video") ? "last" : 0) } }; // SNAP-R177: nothing pulled
    const { file, frame } = await T.frameAt(t, "last", { frame: p.frame ?? (t.media.some((m) => m.kind === "video") ? undefined : 0) });
    return { file, from: { take: t.id, frame } };
  }
  if (!p.file) throw new Error(`${what}: give file (a picture in input/) or take (and frame for a video)`);
  const at = await (await api.fetchApi(`/mainodes/snap/info?input=${encodeURIComponent(p.file)}`)).json();
  if (!at.input_exists) throw new Error(`${what}: "${p.file}" isn't in this server's input folder (${at.input}); upload it with POST /upload/image (subfolder=snap) and give "snap/<its name>", or give take (and frame)`);
  return { file: p.file, ...(p.from ? { from: p.from } : {}) };
}
// F-C28: what a picture is for when a shot cites it: camera (this exact framing) or place (same set, new camera)
const roleIn = (r, what) => { if (r != null && !["camera", "place"].includes(r)) throw new Error(`${what}: role is camera (this exact framing) or place (the same set, a new camera); not ${JSON.stringify(r)}`); return r ? { role: r } : {}; };
// SNAP-R155: the place's scale anchors, things of a known real size the critic measures heights against (a house door
// 2.0 m, the gate door 3.7 m): [{name, height_m, note}]. Without one, a camera height read off a picture is a guess at
// some door's size (village v21: "~2 m" on a 2.7 m gate door was ~2.7 m on the houses' own doors)
function scaleOf(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error(`scale is a list of anchors [{name: "house door", height_m: 2.0, note}], things in the pictures of a known real height; not ${JSON.stringify(list)}`);
  const seen = new Set();
  return list.map((a, i) => {
    const name = a?.name?.trim();
    if (!name) throw new Error(`scale[${i}]: an anchor needs a name (what it is: "house door", "gate door", "palisade")`);
    if (!(typeof a.height_m === "number" && a.height_m > 0)) throw new Error(`scale ${name}: height_m is its real height in metres, a number above 0; not ${JSON.stringify(a.height_m)}`);
    if (seen.has(name)) throw new Error(`Two scale anchors are named "${name}"`);
    seen.add(name);
    return { name, height_m: a.height_m, ...(a.note?.trim() ? { note: a.note.trim() } : {}) };
  });
}
export const scaleText = (scale) => (scale?.length ? scale.map((a) => `${a.name} ${a.height_m} m`).join(", ") : "");
// camera marks as a location keeps them: each named, its pose checked
export function camerasOf(list) {
  return (list ?? []).map((c, i) => {
    if (!c?.name?.trim()) throw new Error(`cameras[${i}]: a camera mark needs a name (C1, P01, …)`);
    return { name: c.name.trim(), ...poseOf(Object.fromEntries(POSE.filter((k) => c[k] != null).map((k) => [k, c[k]])), `camera ${c.name}`), ...(c.note?.trim() ? { note: c.note.trim() } : {}) };
  });
}
// a location's change in words (SNAP-R177 dry runs): plates and camera marks by name ("plate P1 added", "plate P1.pose.eye_height
// 1.6 → 1.7", "camera mark C2 taken out"), every other field as diff_record says it
export function locationDiff(a, b) {
  const byName = (list) => new Map((list ?? []).map((x) => [x.name, x])), out = [], rest = (x) => Object.fromEntries(Object.entries(x ?? {}).filter(([k]) => !["plates", "cameras"].includes(k)));
  for (const [k, what] of [["plates", "plate"], ["cameras", "camera mark"]]) {
    const was = byName(a?.[k]), now = byName(b?.[k]);
    for (const [n, x] of now) out.push(...(was.has(n) ? W.diff(was.get(n), x, `${what} ${n}.`) : [`${what} ${n} added: ${JSON.stringify(x)}`]));
    for (const n of was.keys()) if (!now.has(n)) out.push(`${what} ${n} taken out`);
  }
  return [...W.diff(rest(a), rest(b)), ...out];
}
// a new version of a location (a new record when id is null): {id, ref, n, made}. The whole place each time; a picture
// given as a take's frame is saved into input/ first. dry (SNAP-R177): every check runs, nothing is pulled or saved, and
// the answer is the would-be version with its diff
export async function saveLocation(id, body, { note = "", by = "person", dry = false } = {}) {
  await ready();
  if (!body?.name?.trim()) throw new Error("A location needs a name");
  const names = new Set(), cameras = camerasOf(body.cameras), plates = [], scale = scaleOf(body.scale);
  // F-K05: a picture given by its file alone keeps the take and frame it came from when the newest version had that file
  const prev = id && W.record("location", id) ? W.headOf(W.record("location", id)).body : null;
  const was = (file) => [prev?.master, prev?.plan, prev?.map, ...(prev?.plates ?? [])].find((x) => x?.file === file && x.from)?.from;
  const sourced = (p) => (p && p.file && !p.take && !p.from && was(p.file) ? { ...p, from: was(p.file) } : p);
  for (const [i, p] of (body.plates ?? []).entries()) {
    const name = p?.name?.trim();
    if (!name) throw new Error(`plates[${i}]: a plate needs a name (it is cited by it)`);
    if (names.has(name)) throw new Error(`Two plates are named "${name}": a plate is cited by its name, so each name once`);
    names.add(name);
    if (p.camera && !cameras.some((c) => c.name === p.camera)) throw new Error(`plate ${name}: no camera mark "${p.camera}"; the marks are ${cameras.map((c) => c.name).join(", ") || "none"}`);
    plates.push({ name, ...await locationPicture(sourced(p), `plate ${name}`, dry), ...roleIn(p.role, `plate ${name}`), pose: poseOf(p.pose, `plate ${name}`), ...(p.camera ? { camera: p.camera } : {}), ...(p.use?.trim() ? { use: p.use.trim() } : {}), ...(p.note?.trim() ? { note: p.note.trim() } : {}) });
  }
  const master = await locationPicture(sourced(body.master), "master", dry);
  const plan = await locationPicture(sourced(body.plan), "plan", dry), shapes = body.plan?.shapes; // SNAP-R133: a plan drawn in Snap keeps its shapes beside its picture
  const map = await locationPicture(sourced(body.map), "map", dry);
  const clean = { name: body.name.trim(), notes: body.notes?.trim() ?? "", master: master && { ...master, ...roleIn(body.master.role, "master") }, plan: plan && shapes ? { ...plan, shapes, ...(body.plan.render ? { render: body.plan.render } : {}) } : plan, ...(map ? { map } : {}), cameras, plates, ...(scale.length ? { scale } : {}), rating: body.rating ?? null,
    ...(body.from_cast ? { from_cast: body.from_cast } : {}) };
  if (dry) { const n = id ? W.record("location", id)?.head ?? 0 : 0, diff = locationDiff(prev, clean); return { id, dry_run: true, from_version: prev ? n : null, would_be: !prev || diff.length ? n + 1 : n, made: !prev || diff.length > 0, diff, note, body: clean }; }
  id ??= locationStamp();
  const out = await W.save("location", id, clean, { note, by });
  rebuild();
  return { id, ref: out.ref, n: out.n, made: out.made };
}
// the location a reference names, at its version: {id, n, body, version}
export function locationOf(ref) {
  const { kind, id, n } = W.parse(ref);
  if (kind !== "location") throw new Error(`${ref} isn't a location reference (location:<id> or location:<id>@n)`);
  const got = W.get(ref);
  if (!got) throw new Error(W.record("location", id) ? `Location ${id} has no version ${n}; it has v1-v${W.record("location", id).head}` : `No location ${id} (list_locations lists them)`);
  return { id, n: got.version.n, body: got.version.body, version: got.version };
}
// add or replace one plate (by name) as a new version of the location
// (a list of plates is one version: F-D10, four corrections made four versions)
// F-G03 (SNAP-R148): a plate already there keeps every field the call leaves out, its picture too (so one pose or note
// changes alone), and a pose the fields it leaves out (F-P01); camera may be a mark {name, x, y, heading, eye_height, lens, note}, added to the place or moved, the
// rest of the marks kept. Returns kept: per plate, what it kept
export async function addPlate(ref, plate, { note, by = "person", dry = false } = {}) {
  const { id, body } = locationOf(W.refOf("location", W.parse(ref).id)), cameras = [...(body.cameras ?? [])], kept = {};
  const list = [plate].flat().map((p) => {
    let x = { ...p, ...(typeof p.name === "string" ? { name: p.name.trim() } : {}) };
    if (x.camera && typeof x.camera === "object") {
      const c = { ...x.camera, name: x.camera.name?.trim() };
      if (!c.name) throw new Error(`plate ${x.name}: a camera mark needs a name`);
      const i = cameras.findIndex((m) => m.name === c.name);
      if (i < 0) cameras.push(c); else cameras[i] = { ...cameras[i], ...c };
      x.camera = c.name;
    }
    const was = (body.plates ?? []).find((q) => q.name === x.name);
    if (!was) return x;
    // F-P01: a pose merges by field like a camera mark ({eye_height: 1.7} keeps x, y, heading and lens; a null clears one)
    if (x.pose && typeof x.pose === "object" && was.pose) x.pose = Object.fromEntries(Object.entries({ ...was.pose, ...x.pose }).filter(([, v]) => v !== null));
    const fresh = x.take != null || x.file != null, left = Object.keys(was).filter((k) => x[k] === undefined && !(fresh && ["file", "from"].includes(k)));
    if (left.length) kept[x.name] = left;
    return { ...Object.fromEntries(left.map((k) => [k, was[k]])), ...Object.fromEntries(Object.entries(x).filter(([, v]) => v !== undefined)) };
  });
  const names = new Set(list.map((p) => p.name)), plates = [...(body.plates ?? []).filter((p) => !names.has(p.name)), ...list];
  return { ...await saveLocation(id, { ...body, cameras, plates }, { note: note ?? `plate${list.length > 1 ? "s" : ""} ${list.map((p) => p.name).join(", ")}`, by, dry }), kept };
}
// F-K05: take plates out of a location as a new version; the others keep everything, their provenance too
export async function removePlate(ref, names, { note, by = "person" } = {}) {
  const { id, body } = locationOf(W.refOf("location", W.parse(ref).id)), want = [names].flat().map((x) => String(x).trim());
  const missing = want.filter((x) => !(body.plates ?? []).some((p) => p.name === x));
  if (missing.length) throw new Error(`${body.name} has no plate ${missing.map((x) => `"${x}"`).join(", ")}; its plates are ${(body.plates ?? []).map((p) => p.name).join(", ") || "none"}`);
  const out = await saveLocation(id, { ...body, plates: body.plates.filter((p) => !want.includes(p.name)) }, { note: note ?? `plate${want.length > 1 ? "s" : ""} ${want.join(", ")} taken out`, by });
  return { ...out, removed: want };
}
// put a location version into the open recipe's References, replacing what an earlier apply of it put there: its master
// and plan (each unless false) and the plates named (in that order). Pins the version. Returns {said, cite}
// short03 F-C28: Ref2V takes a reference picture as the shot's camera and copies its framing (3/3 in the pano test), so
// each cited picture says what it is for: `camera` (this exact framing) or `place` (the same set; the words set the
// camera). `camera` names the one picture used as the camera (a plate's name or "master"); else each keeps its record's
// role (place by default); the camera picture goes in first (F-D06). The answer's prompt_hint words it for the prompt
export async function applyLocation(ref, { plates = [], master = true, plan = true, camera } = {}) {
  await ready();
  const { id, n, body: b, version } = locationOf(ref), key = `location:${id}`;
  const missing = plates.filter((x) => !(b.plates ?? []).some((p) => p.name === x));
  if (missing.length) throw new Error(`${b.name} v${n} has no plate ${missing.map((x) => `"${x}"`).join(", ")}; its plates: ${(b.plates ?? []).map((p) => p.name).join(", ") || "none"}`);
  if (camera != null && camera !== "master" && !plates.includes(camera)) throw new Error(`camera names the picture this shot keeps the framing of: "master" or one of the plates given (${plates.join(", ") || "none"}); not "${camera}"`);
  const roleOf = (what, pic) => (camera != null ? (camera === what ? "camera" : "place") : pic.role ?? "place");
  const want = [...(master && b.master ? [["master", b.master.file, roleOf("master", b.master)]] : []), ...(plan && b.plan ? [["plan", b.plan.render ?? b.plan.file, "map"]] : []), // F-F04: shapes alone, cropped to the drawing
    ...plates.map((x) => { const p = b.plates.find((q) => q.name === x); return [`plate ${x}`, p.file, roleOf(x, p)]; })];
  if (!want.length) throw new Error(`${b.name} v${n}: nothing to put in (no master, no plan, no plates named)`);
  const keys = () => E.state().bricks.map((x) => x.key);
  let preset = null, unread = null, opening = null;
  app.canvas.emitBeforeChange(); // the pictures and the pin are one undo step
  try {
    if (!keys().includes("refs")) await E.snap("refs");
    const roles = want.map(([what, , use]) => `location: ${b.name}, ${what}${use === "map" ? "" : ` (${use})`}`);
    for (const p of E.state().bricks.find((x) => x.key === "refs").pictures ?? []) if (p.source === key && !roles.includes(p.role)) E.removePicture(p.node);
    want.forEach(([what, file], i) => E.addPicture(file, { role: roles[i], reason: `${b.name}, location v${n}${what.startsWith("plate") ? `, ${what}` : ""}`, source: key, card: W.refOf("location", id, n) }));
    // F-D06: the camera picture is <Picture 1> (after an opening frame only, which syncOpening puts first): H3 keeps the
    // framing of the picture the walkthrough starts from. F-F08: the place's pictures stand in this order every time it is
    // applied (camera, then master, plan, plates), however an earlier apply left them
    const order = () => E.references()?.pictures.map((p) => p.node) ?? [], mine = E.state().bricks.find((x) => x.key === "refs").pictures;
    const nodes = [...want.keys()].sort((a, c) => (want[c][2] === "camera") - (want[a][2] === "camera")).map((i) => mine.find((p) => p.role === roles[i])?.node).filter((x) => x != null && order().includes(x));
    const at = want.some(([, , use]) => use === "camera") ? 0 : Math.min(...nodes.map((x) => order().indexOf(x)));
    nodes.forEach((node, k) => { if (order().indexOf(node) !== at + k) E.recite(E.movePicture(node, at + k)); });
    try { preset = conditionFor("Ref2V"); } catch (e) { unread = e.message; }
    opening = syncOpening();
    pin(key, { n, hash: W.short(version.hash), name: b.name, placed: { roles, plates, master: !!(master && b.master), plan: !!(plan && b.plan), ...(camera != null ? { camera } : {}), ...(unread ? { unread } : {}) } });
  } finally { app.canvas.emitAfterChange(); }
  app.canvas.setDirty(true, true);
  const pics = E.references()?.pictures ?? [], citeOf = (what) => pics.find((p) => p.role?.startsWith(`location: ${b.name}, ${what}`) && (p.role.length === `location: ${b.name}, ${what}`.length || p.role[`location: ${b.name}, ${what}`.length] === " "))?.cite ?? null;
  const cite = { ...(master && b.master ? { master: citeOf("master") } : {}), ...(plan && b.plan ? { plan: citeOf("plan") } : {}), plates: Object.fromEntries(plates.map((x) => [x, citeOf(`plate ${x}`)])) };
  const as = Object.fromEntries(want.filter(([, , u]) => u !== "map").map(([what, , u]) => [what, u])), cams = Object.keys(as).filter((w) => as[w] === "camera"), places = Object.keys(as).filter((w) => as[w] === "place");
  const prompt_hint = [opening && `${opening.cite} is this shot's opening frame: it starts exactly there, at that camera height.`, cams.length && `${cams.map(citeOf).join(" and ")} ${cams.length > 1 ? "are" : "is"} this shot's camera: keep ${cams.length > 1 ? "their" : "its"} framing.`,
    places.length && `${places.map(citeOf).join(", ")} show${places.length > 1 ? "" : "s"} the place (the same set, its buildings and layout), not this shot's framing: the camera is the one these words describe.`,
    plan && b.plan && `${citeOf("plan")} is the set plan from above, not a view.`].filter(Boolean).join(" ");
  return { said: `${b.name} v${n}: ${want.map(([what, , u]) => `${what}${u === "map" ? "" : ` (${u})`} as ${citeOf(what)}`).join(", ")} in References${preset ? `; Render Preset now ${preset} (the pictures need it)` : ""}${opening ? `; ${opening.said}` : ""}${unread ? `; the pictures are not read by this render: ${unread}` : ""}`, cite, use: as, prompt_hint, ...(opening ? { opening: opening.cite } : {}) };
}
// short03 F-C29: a place kept as a Cast (the workaround before location records) becomes a location record: its first
// picture the master (or the one whose role says master), the one whose role says map or plan the plan, the others plates
// named by their roles; its details and lore the notes; from_cast names the version it came from. The Cast stays
export async function castToLocation(ref, { by = "person" } = {}) {
  await ready();
  const { kind, id } = W.parse(ref), got = W.get(ref);
  if (kind !== "cast" || !got) throw new Error(`No Cast ${ref} (list_cast lists them)`);
  const b = got.version.body, refs = b.refs ?? [], from = W.refOf("cast", id, got.version.n);
  const done = W.all("location").find((r) => W.headOf(r).body.from_cast?.startsWith(`cast:${id}@`));
  if (done) return { location: `location:${done.id}`, id: done.id, ref: W.refOf("location", done.id, done.head), n: done.head, made: false, said: `${b.name} is already location:${done.id} (from ${W.headOf(done).body.from_cast})` };
  const plan = refs.find((r) => /\b(map|plan)\b/i.test(r.role)), master = refs.find((r) => r !== plan && /master/i.test(r.role)) ?? refs.find((r) => r !== plan);
  const plates = refs.filter((r) => r !== plan && r !== master).map((r, i) => ({ name: r.role || `plate ${i + 1}`, file: r.file }));
  const out = await saveLocation(null, { name: b.name.replace(/\s*\(set\)/i, ""), notes: [b.details, b.lore].filter(Boolean).join(" "), master: master && { file: master.file }, plan: plan && { file: plan.file }, plates, from_cast: from },
    { note: `made from the Cast ${from}`, by });
  return { location: `location:${out.id}`, ...out, said: `${b.name} is now location:${out.id} v${out.n} (master, ${plan ? "plan, " : ""}${plates.length} plate${plates.length === 1 ? "" : "s"}); the Cast stays` };
}
// U72 F24: a prompt written over a Cast's sentence gets it back (the agent's words and the Cast both reach the render);
// returns what was put back
export function keepPinnedText() {
  const kept = [];
  for (const [ref, p] of Object.entries(E.state().world ?? {})) {
    if (!p.placed?.text || !ref.startsWith("cast:")) continue;
    // F-C31: a Cast whose pictures and LoRA row were taken out of this recipe is no longer in it: its line stays out (a
    // Cast of words only is in use while pinned)
    const pics = !!p.placed.roles?.length, row = p.placed.row != null;
    const used = (pics && (E.state().bricks.find((x) => x.key === "refs")?.pictures ?? []).some((x) => x.source === ref)) || (row && M.rows("cast")[p.placed.row]?.on);
    if ((pics || row) && !used) continue;
    const lines = (E.getValue("render", "render", "prompt") ?? "").split("\n"), first = lines[lineFor(lines)] ?? "";
    if (!first.includes(p.placed.text) && addToPrompt([p.placed.text])) kept.push(`${p.name} v${p.n}'s details line (${ref})`);
  }
  return kept;
}

// U89 (SNAP-R63): a re-run sends one pin elsewhere, to another version of its record or to another record of its kind.
// The old record's pieces come out before the new ones go in (applyCast and applySet replace only by their own key, and
// References has a slot cap): a Cast's row, sentence and pictures, a set's pictures and set text, a card's words. A Cast
// a shot card compiled in has nothing of its own placed: that shot is compiled again with the swap, the card itself
// untouched and its pin marked edited (coordinator call 2026-11-05, SNAP-R2/R5). Returns what happened
const bodyOf = (ref) => { const { kind, id, n } = W.parse(ref); return (n !== 0 && W.get(ref)?.version.body) || (W.packCard(W.refOf(kind, id)) && get(W.packCard(W.refOf(kind, id)).id)) || null; };
const unpin = (ref) => { const { [ref]: _, ...rest } = E.state().world ?? {}; E.tag("world", rest); };
export async function swapPin(from, to) {
  await ready();
  const old = pinOf(from), a = W.parse(from), b = W.parse(to), key = W.refOf(b.kind, b.id);
  if (!old) throw new Error(`${from} isn't pinned in this recipe; its pins: ${Object.keys(E.state().world ?? {}).join(", ") || "none"}`);
  if (a.kind !== b.kind) throw new Error(`${from} is a ${a.kind}: it swaps for another ${a.kind}, not ${to}`);
  const was = bodyOf(W.refOf(a.kind, a.id, old.n)), now = bodyOf(to);
  if (!now) throw new Error(`${to} isn't in your records${W.record(b.kind, b.id) ? ` (it has v1-v${W.record(b.kind, b.id).head})` : ""}`);
  const other = a.id !== b.id, said = [];
  if (b.kind === "cast") {
    const shot = E.state().bricks.find((x) => x.key === "render")?.shot, compiled = !old.placed && shot?.parts?.some((x) => x.field === "character" && x.from === a.id);
    if (compiled) { // the shot card names this Cast: compile it again with the other one, the card unchanged
      const card = get(shot.card);
      if (!card) throw new Error(`${old.name ?? from} came in through the shot card ${shot.card}, which isn't in the Library any more`);
      const edited = { ...card, brick: { ...card.brick, characters: (card.brick.characters ?? []).map((c) => (c === a.id ? b.id : c)) } };
      const o = originOf(card.id), sref = o ? W.refOf(o.kind, o.id) : packRef(card), held = pinOf(sref);
      said.push(await applyShot(edited));
      if (other) unpin(from);
      if (held) pin(sref, { ...held, edited: { characters: { ...held.edited?.characters, [a.id]: b.id } } }); // the version it held, now edited in this recipe
      return `${said.join("; ")} (the shot card ${card.title} is unchanged: this recipe's line swaps ${old.name ?? a.id} for ${nameOf(now)})`;
    }
    if (other) {
      const p = old.placed ?? {};
      app.canvas.emitBeforeChange();
      try {
        if (p.row != null && M.rows("cast")[p.row]) {
          M.removeRow("cast", p.row);
          for (const [r, q] of Object.entries(E.state().world ?? {})) if (r !== from && q.placed?.row > p.row) pin(r, { ...q, placed: { ...q.placed, row: q.placed.row - 1 } });
        }
        if (p.text) { const before = E.getValue("render", "render", "prompt"); removeFromPrompt([p.text]); if (E.getValue("render", "render", "prompt") === before) said.push(`${old.name}'s line wasn't found as written; check the prompt`); }
        for (const x of E.state().bricks.find((k) => k.key === "refs")?.pictures ?? []) if (x.source === from) E.removePicture(x.node);
        for (const x of E.state().bricks.find((k) => k.key === "refs")?.audios ?? []) if (x.source === from) E.removeAudio(x.node); // SNAP-R237: the old Cast's voice goes with it
        unpin(from);
      } finally { app.canvas.emitAfterChange(); }
    }
    // SNAP-R237: a recast speaks where the Cast it replaces spoke (the cut's line is the role's, not the person's)
    return [await applyCast(to, other ? { voice: voiceWanted(W.refOf(a.kind, a.id), old.name ?? "", !!old.placed?.voice).want } : {}), ...said].join("; ");
  }
  if (b.kind === "location") { // the same pictures of the other place or version: master, plan and the plates of the same names
    const p = old.placed ?? {};
    if (other) {
      for (const x of E.state().bricks.find((k) => k.key === "refs")?.pictures ?? []) if (x.source === from) E.removePicture(x.node);
      unpin(from);
    }
    const names = (p.plates ?? []).filter((x) => (now.plates ?? []).some((q) => q.name === x)), lost = (p.plates ?? []).filter((x) => !names.includes(x));
    return [(await applyLocation(to, { plates: names, master: p.master ?? true, plan: p.plan ?? true })).said, ...(lost.length ? [`${nameOf(now)} has no plate ${lost.join(", ")}: left out`] : [])].join("; ");
  }
  if (b.kind === "set_snapshot") {
    if (other) {
      const refs = E.state().bricks.find((x) => x.key === "refs"), source = was?.lineage ?? a.id;
      for (const x of refs?.pictures ?? []) if (x.source === source) E.removePicture(x.node);
      if (refs?.setText?.[source]) { removeFromPrompt(refs.setText[source]); const { [source]: _, ...rest } = refs.setText; E.remember("refs", "setText", rest); }
      unpin(from);
    }
    const r = W.record(b.kind, b.id), v = r && (b.n == null ? W.headOf(r) : r.versions.find((x) => x.n === b.n));
    return applySet(now, now.brick.snapshot, v ? { version: { ref: key, n: v.n, hash: W.short(v.hash) } } : {});
  }
  if (other) { if (was && was.kind !== "shot") removeFromPrompt(cues(was)); unpin(from); }
  const out = await apply(now, { keep: false }), v = W.get(to)?.version;
  if (v) pin(key, { ...pinOf(key), n: v.n, hash: W.short(v.hash), name: nameOf(now) }); // the version asked for, not the head apply pins
  return out;
}

// short03 F-C27: a record out of the open recipe: what its last apply put there goes (a Cast's row, sentence, pictures
// and voice; a location's or set's pictures and set text) and the pin with it. The record stays, and takes made before
// keep their pins. Returns what happened
export async function removePin(ref) {
  await ready();
  const { kind, id } = W.parse(ref), key = W.refOf(kind, id), old = pinOf(key);
  if (!old) throw new Error(`${key} isn't in this recipe's world; it holds ${Object.keys(E.state().world ?? {}).join(", ") || "no records"}`);
  const p = old.placed ?? {}, refs = E.state().bricks.find((x) => x.key === "refs"), body = bodyOf(W.refOf(kind, id, old.n)), source = kind === "set_snapshot" ? body?.lineage ?? id : key;
  app.canvas.emitBeforeChange();
  try {
    if (p.row != null && M.rows("cast")[p.row]) {
      M.removeRow("cast", p.row);
      for (const [r, q] of Object.entries(E.state().world ?? {})) if (r !== key && q.placed?.row > p.row) pin(r, { ...q, placed: { ...q.placed, row: q.placed.row - 1 } });
    }
    if (p.text) removeFromPrompt([p.text]);
    for (const x of refs?.pictures ?? []) if (x.source === source) E.removePicture(x.node);
    for (const x of refs?.audios ?? []) if (x.source === key) E.removeAudio(x.node);
    if (refs?.setText?.[source]) { removeFromPrompt(refs.setText[source]); const { [source]: _, ...rest } = refs.setText; E.remember("refs", "setText", rest); }
    unpin(key);
  } finally { app.canvas.emitAfterChange(); }
  app.canvas.setDirty(true, true);
  return `${old.name ?? key} is out of this recipe: ${[p.row != null && "its LoRA row", p.text && "its line in the prompt", "its pictures"].filter(Boolean).join(", ")} and its pin; the record stays, and takes made before keep their pin`;
}

// "update" on a pin's chip (SNAP-R60: never by itself): the record's newest version replaces what the recipe holds
export async function updatePin(ref) {
  await ready();
  const { kind, id } = W.parse(ref), r = W.record(kind, id);
  if (!r && pinOf(ref)?.n === 0) { // a pack card the pack updated: today's card goes in as the pack has it
    const now = W.packCard(ref);
    if (!now) throw new Error(`${pinOf(ref).name ?? ref} is no longer in the pack, so it can't be updated`);
    return apply(get(now.id), { keep: false });
  }
  if (!r) throw new Error(`${ref} isn't in your records (archived records stay listed; a missing one can't be updated)`);
  if (kind === "cast") { // UI-04: a newer version keeps the shot's chosen pictures, or says it lacks them (never a silent state change)
    const pick = pinOf(ref)?.placed?.pictures, roles = W.headOf(r).body.refs.map((x) => x.role), gone = (pick ?? []).filter((x) => !roles.includes(x));
    if (gone.length) throw new Error(`${W.headOf(r).body.name} v${r.head} has no ${gone.map((x) => `"${x}"`).join(", ")} picture, which this shot uses: choose its pictures again (the Cast chip's "Which pictures…", or apply_cast with pictures)`);
    return applyCast(W.refOf(kind, id));
  }
  if (kind === "location") { const p = pinOf(ref)?.placed ?? {}; return (await applyLocation(W.refOf(kind, id), { plates: (p.plates ?? []).filter((x) => W.headOf(r).body.plates?.some((q) => q.name === x)), master: p.master ?? true, plan: p.plan ?? true })).said; }
  const card = W.headOf(r)?.body;
  if (kind === "set_snapshot") return applySet(card, card.brick.snapshot, { version: { ref: W.refOf(kind, id), n: r.head, hash: W.short(W.headOf(r).hash) } });
  return apply(card, { keep: false });
}

// the stack as a card keeps a Cast brick but never its rows: identity LoRAs are private (SNAP-R12)
const shareable = async () => { const strip = await T.privacyOn(); return E.recipe().map((b) => (strip && BRICKS[b.key]?.stack?.role === "identity" ? { key: b.key, values: {} } : b)); }; // SNAP-R37: only where privacy is on

// before leaving a family: the open stack as that family's "Last used" card (one per family, replaced each time)
export async function saveLast(family) {
  const bricks = await shareable(), output = kit(bricks.map((b) => b.key)) === "image" ? "image" : "video + audio";
  const card = { id: `recipe-last-${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, kind: "recipe", family, output, title: `Last used: ${family}`, saved: Date.now(),
    about: "Your own stack, kept when you switched to another family.", text: `${bricks.length} bricks: ${bricks.map((b) => BRICKS[b.key]?.title ?? b.key).join(", ")}`, brick: { bricks } };
  await save(card);
  return card;
}

// save the current stack as a recipe card in the user's Library
export async function saveRecipe(name) {
  const bricks = await shareable(), stamp = new Date().toTimeString().slice(0, 8);
  const card = { id: `recipe-${Date.now().toString(36)}`, kind: "recipe", title: `Recipe: ${name} (saved ${stamp})`, saved: Date.now(),
    text: `${bricks.length} bricks: ${bricks.map((b) => BRICKS[b.key]?.title ?? b.key).join(", ")}`, brick: { bricks } };
  await save(card);
  return card;
}

// apply a card to its brick; returns what happened, or throws with the reason it can't. A family's recipe card is a setup:
// it goes the Setups sheet's way (another family opens a new tab; `keep` saves this stack as "Last used" first)
export async function apply(card, { keep = true } = {}) {
  if (card.kind === "recipe" && card.family) return M.useSetup({ source: "recipe", card: card.id }, { keep });
  if (card.kind === "recipe") {
    const keys = await E.restore(card.brick.bricks);
    return `${card.title}: ${keys.length} bricks with their settings`;
  }
  if (card.kind === "run" && card.brick.take) return `${T.restore(T.get(card.brick.take))} settings from ${card.title}`; // a prior restores any workflow's own nodes
  if (card.kind === "location" && card.brick.location) return (await applyLocation(card.brick.location)).said; // References comes with it
  const brick = TARGET[card.kind];
  if (!E.state().bricks.some((b) => b.key === brick)) throw new Error(`${card.title} goes on the ${brick} brick; add it first`);
  if (card.kind === "set_snapshot") return applySet(card);
  if (card.kind === "shot") {
    if (!E.state().bricks.some((x) => x.key === "refs")) throw new Error(`${card.title} needs the References brick for its set pictures; add it first`);
    return applyShot(card);
  }
  if (card.kind === "dial") return D.add(card.brick.dial, card.brick.strength);
  if (card.kind === "cast" && card.brick.cast) return applyCast(card.brick.cast);
  if (card.kind === "lora") { // a distilled LoRA only works on its own schedule: a LoRA card names the setup that carries both
    M.apply(card.brick.setup);
    return `${card.brick.setup} on the Render Preset`;
  }
  if (card.kind === "run") {
    E.setValue("render", "render", "noise_seed", card.brick.seed);
    return `seed ${card.brick.seed} from ${card.title}`;
  }
  if (card.kind === "pose" || card.kind === "motion_guide") throw new Error(`${card.title} has no media on this machine yet (example card)`);
  const words = cues(card);
  if (!words.length) throw new Error(`${card.title} has no prompt words: ${card.text.split(". ").at(-1)}`);
  const added = addToPrompt(words);
  await pinCard(card);
  return added ? `${card.title} added to the prompt` : `${card.title} is already in the prompt`;
}
