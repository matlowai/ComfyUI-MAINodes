// Snap Library (LIBRARY.md): cards that snap onto bricks. Each kind goes to one brick and does one visible thing there;
// search is slot-aware (a selected brick narrows it to the kinds that brick takes). Keyword search for now; the
// multimodal embedder plugs in behind `search` once its runtime is chosen.
// SNAP-R5 another family opens a new tab · SNAP-R12 identity rows never leave in a card · SNAP-R18 local only ·
// SNAP-R21 a shot's reference shows its own camera · SNAP-R25 SFW only leaves out cards tagged or loading nsfw ·
// SNAP-R59 Cast by reference (applyCast) · SNAP-R60 the person's cards are world records (world.js) ·
// see docs/SNAP_RULES.md
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
export const TARGET = { recipe: null, shot: "render", set_snapshot: "refs", dial: "rack", lora: "preset", cast: "render", setting: "render", scene: "render", principle: "render", pose: "first_frame", motion_guide: "refs", run: "render" };
export const KIND_LABEL = { recipe: "Recipes", shot: "Shots", set_snapshot: "Set snapshots", cast: "Characters", setting: "Settings", scene: "Scenes", principle: "Principles", motion_guide: "Motion", pose: "Poses", dial: "Dials", lora: "LoRAs", run: "Runs" };

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
  cards = [...mine, ...pack].filter((c) => c.kind in TARGET); // kinds Snap doesn't know are dropped
  return cards;
}
W.onChange(() => { if (pack.length) rebuild(); });
// the record version a card shows ({kind, id, n}; n null for a set's working copy), null for a pack card
export const originOf = (id) => origins.get(id) ?? null;

// pack cards and the user's cards, loaded once per page; a failed load is retried on the next call
export const ready = () => (loading ??= Promise.all([loadPack(), W.load()]).then(rebuild, (e) => { loading = null; throw e; }));

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

function removeFromPrompt(phrases) {
  const prompt = E.getValue("render", "render", "prompt") ?? "";
  let [first, ...rest] = prompt.split("\n");
  const before = first;
  for (const x of phrases) first = first.replace(x, "");
  if (first === before) return; // nothing of ours was there: leave the person's text exactly as it is
  first = first.replace(/\s*,\s*(?=[,.])/g, "").replace(/\s{2,}/g, " ").replace(/\s+\./g, ".").replace(/\.{2,}/g, ".").trimEnd();
  E.setValue("render", "render", "prompt", [first, ...rest].join("\n"));
}

// add the phrases not already there to the first line of the H3 prompt (the integrated description)
function addToPrompt(phrases) {
  const prompt = E.getValue("render", "render", "prompt") ?? "";
  const [first, ...rest] = prompt.split("\n");
  const fresh = phrases.filter((x) => !first.includes(x));
  if (!fresh.length) return false;
  E.setValue("render", "render", "prompt", [`${first.replace(/\s*$/, "")} ${fresh.join(", ")}.`.trimStart(), ...rest].join("\n"));
  return true;
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
export async function applySet(card, s = card.brick.snapshot, { prompt = true } = {}) {
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
const castStamp = () => `cast-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
// a new version of a Cast record (a new record when id is null): {id, ref, n, made}
export async function saveCast(id, body, { note = "", by = "person" } = {}) {
  await ready();
  if (!body?.name?.trim()) throw new Error("A cast member needs a name");
  const clean = { name: body.name.trim(), alias: body.alias?.trim() ?? "", trigger: body.trigger?.trim() ?? "", details: body.details?.trim() ?? "",
    lora: body.lora?.file ? { file: body.lora.file, strength: +(body.lora.strength ?? 1) } : null, refs: (body.refs ?? []).map((r) => ({ file: r.file, role: r.role || "identity" })),
    lore: body.lore?.trim() ?? "", rating: body.rating ?? null };
  id ??= castStamp();
  const out = await W.save("cast", id, clean, { note, by });
  rebuild();
  return { id, ref: out.ref, n: out.n, made: out.made };
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
// the pin a recipe keeps for one record: which version it holds, and where that version's pieces went
export const pinOf = (ref) => E.state().world?.[ref] ?? null;
function pin(ref, entry) { E.tag("world", { ...E.state().world, [ref]: entry }); }

// put one Cast version into the open recipe, replacing what an earlier apply of the same record put there: its LoRA row
// on the Cast brick (snapped in when missing), its sentence in the prompt's first line, its pictures in References.
// `strength` overrides the record's for this recipe (the pin says so). Returns what happened
export async function applyCast(ref, { strength } = {}) {
  await ready();
  const { kind, id, n } = W.parse(ref);
  if (kind !== "cast") throw new Error(`${ref} isn't a Cast reference (cast:<id> or cast:<id>@n)`);
  const got = W.get(ref);
  if (!got) throw new Error(W.record("cast", id) ? `Cast ${id} has no version ${n}; it has v1-v${W.record("cast", id).head}` : `No Cast record ${id}`);
  const b = got.version.body, key = `cast:${id}`, was = pinOf(key)?.placed ?? {}, placed = {}, line = castLine(b);
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
    }
    pin(key, { n: got.version.n, hash: W.short(got.version.hash), follow: pinOf(key)?.follow ?? true, placed, ...(strength != null ? { strength } : {}) });
  } finally { app.canvas.emitAfterChange(); }
  app.canvas.setDirty(true, true);
  return `${b.name} v${got.version.n}: ${[b.lora && `${b.lora.file.split("/").pop().replace(/\.safetensors$/, "")} at ${strength ?? b.lora.strength} on Cast`, line && "the details in the prompt", b.refs.length && `${b.refs.length} picture${b.refs.length === 1 ? "" : "s"} in References`].filter(Boolean).join(", ") || "nothing to put in (no LoRA, words or pictures)"}`;
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
  return addToPrompt(words) ? `${card.title} added to the prompt` : `${card.title} is already in the prompt`;
}
