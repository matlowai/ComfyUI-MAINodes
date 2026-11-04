// Snap Library (LIBRARY.md): cards that snap onto bricks. Each kind goes to one brick and does one visible thing there;
// search is slot-aware (a selected brick narrows it to the kinds that brick takes). Keyword search for now; the
// multimodal embedder plugs in behind `search` once its runtime is chosen.
import { api } from "../../../scripts/api.js";
import { app } from "../../../scripts/app.js";
import * as E from "./engine.js";
import * as T from "./takes.js";
import * as D from "./dials.js";
import * as M from "./models.js";
import { BRICKS, kit } from "./bricks.js";
import { setBlock, blocking, drawPlan, drawElevation, toBlob, coverage } from "./setsnap.js";

// the brick each kind of card goes on; a recipe goes on the whole stack (null)
export const TARGET = { recipe: null, shot: "render", set_snapshot: "refs", dial: "rack", lora: "preset", character: "render", setting: "render", scene: "render", principle: "render", pose: "first_frame", motion_guide: "refs", run: "render" };
export const KIND_LABEL = { recipe: "Recipes", shot: "Shots", set_snapshot: "Set snapshots", character: "Characters", setting: "Settings", scene: "Scenes", principle: "Principles", motion_guide: "Motion", pose: "Poses", dial: "Dials", lora: "LoRAs", run: "Runs" };

let cards = [], loading;
// cards load once per page; the view and the agent tools both wait on the same request
const USER_DIR = "snap/cards"; // the user's own cards, in ComfyUI's per-user data folder

async function loadAll() {
  const pack = (await (await api.fetchApi("/mainodes/snap/cards")).json()).cards;
  const mine = await Promise.all((await api.listUserDataFullInfo(USER_DIR)).filter((f) => f.path.endsWith(".json"))
    .map(async (f) => (await api.getUserData(`${USER_DIR}/${f.path}`)).json()));
  return [...mine.flat(), ...pack].filter((c) => c.kind in TARGET); // kinds Snap doesn't know are dropped
}

// pack cards and the user's cards, loaded once per page; a failed load is retried on the next call
export const ready = () => (loading ??= loadAll().then((all) => (cards = all), (e) => { loading = null; throw e; }));

// a version of a set card holding an edited snapshot: `mine` is the one working copy Apply keeps, otherwise a new card
export function version(card, snapshot, mine) {
  const lineage = card.lineage ?? card.id;
  const stamp = new Date().toTimeString().slice(0, 8);
  return { id: mine ? `${lineage}-mine` : `${lineage}-${Date.now().toString(36)}`, kind: "set_snapshot", lineage, saved: Date.now(),
    title: mine ? `Set snapshot: ${snapshot.name}, end of ${snapshot.shot} (my edit)` : `Set snapshot: ${snapshot.name}, end of ${snapshot.shot} (saved ${stamp})`,
    text: card.text, brick: { snapshot } };
}

// every saved state of one set, in shot order: the original first, then versions by when they were saved
export function lineage(card) {
  const root = card.lineage ?? card.id;
  return cards.filter((c) => c.kind === "set_snapshot" && (c.id === root || c.lineage === root)).sort((a, b) => (a.id === root ? -1 : b.id === root ? 1 : (a.saved ?? 0) - (b.saved ?? 0)));
}

// keep an edited card as the user's own (never overwrites a pack card)
export async function save(card) {
  await api.storeUserData(`${USER_DIR}/${card.id}.json`, [card]);
  loading = null;
  await ready();
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
const everything = () => [...priors(), ...cards, ...installed().filter((d) => !cards.some((c) => c.kind === "dial" && c.brick?.dial === d.brick.dial))];
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
  first = first.replace(/\s*,\s*(?=[,.])/g, "").replace(/\s{2,}/g, " ").replace(/\s+\./g, ".").trimEnd();
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

export function compile(card) {
  const b = card.brick, set = shotSet(b.set), s = set?.brick.snapshot;
  if (!s) throw new Error(`${card.title}: its set ${b.set} isn't in the Library`);
  const part = (field, text, from) => (text ? [{ field, text: text[0].toUpperCase() + text.slice(1), from }] : []); // each part reads as a sentence
  const cam = b.setup && coverage(s).find((c) => c.name === b.setup);
  if (b.setup && !cam) throw new Error(`${card.title}: "${b.setup}" isn't a setup for this set's two actors`);
  const parts = [
    ...part("beat", `${b.beat}.`, card.id),
    ...(b.characters ?? []).map(get).filter(Boolean).flatMap((c) => part("character", `${cues(c).join(", ")}.`, c.id)),
    ...part("set", setBlock(s), set.id),
    ...part("blocking", blocking(s), set.id),
    ...part("camera", cam && `Camera: ${cam.name.replace(/^OTS on/, "over the shoulder, on").replace(/^single/, "a single on")}, ${cam.lens} mm lens.`, set.id),
    ...(b.principles ?? []).map(get).filter(Boolean).flatMap((p) => part("direction", cues(p).length ? `${cues(p).join(", ")}.` : "", p.id)),
  ];
  return { line: `integrated_multimodal_description: [${b.shot}] ${parts.map((x) => x.text).join(" ")}`, parts };
}

async function applyShot(card) {
  const { line, parts } = compile(card), set = shotSet(card.brick.set);
  app.canvas.emitBeforeChange(); // the set pictures, the prompt line, the length and the record are one undo step
  try {
    await applySet(set, set.brick.snapshot, { prompt: false });
    const [, ...rest] = (E.getValue("render", "render", "prompt") ?? "").split("\n");
    E.setValues("render", "render", { prompt: [line, ...rest].join("\n"), ...(card.brick.length ? { length: card.brick.length } : {}) });
    E.remember("render", "shot", { card: card.id, parts: parts.map(({ field, from, text }) => ({ field, from, text })) });
  } finally { app.canvas.emitAfterChange(); }
  return `${card.title}: compiled into the prompt (${parts.length} parts), set in References`;
}

// the stack as a card keeps a Cast brick but never its rows: identity LoRAs are private (SNAP-R12)
const shareable = () => E.recipe().map((b) => (BRICKS[b.key]?.stack?.role === "identity" ? { key: b.key, values: {} } : b));

// before leaving a family: the open stack as that family's "Last used" card (one per family, replaced each time)
export async function saveLast(family) {
  const bricks = shareable(), output = kit(bricks.map((b) => b.key)) === "image" ? "image" : "video + audio";
  const card = { id: `recipe-last-${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, kind: "recipe", family, output, title: `Last used: ${family}`, saved: Date.now(),
    about: "Your own stack, kept when you switched to another family.", text: `${bricks.length} bricks: ${bricks.map((b) => BRICKS[b.key]?.title ?? b.key).join(", ")}`, brick: { bricks } };
  await save(card);
  return card;
}

// save the current stack as a recipe card in the user's Library
export async function saveRecipe(name) {
  const bricks = shareable(), stamp = new Date().toTimeString().slice(0, 8);
  const card = { id: `recipe-${Date.now().toString(36)}`, kind: "recipe", title: `Recipe: ${name} (saved ${stamp})`, saved: Date.now(),
    text: `${bricks.length} bricks: ${bricks.map((b) => BRICKS[b.key]?.title ?? b.key).join(", ")}`, brick: { bricks } };
  await save(card);
  return card;
}

// apply a card to its brick; returns what happened, or throws with the reason it can't
export async function apply(card) {
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
