// Snap Library (LIBRARY.md): cards that snap onto bricks. Each kind goes to one brick and does one visible thing there;
// search is slot-aware (a selected brick narrows it to the kinds that brick takes). Keyword search for now; the
// multimodal embedder plugs in behind `search` once its runtime is chosen.
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import { setBlock, blocking, drawPlan, drawElevation, toBlob } from "./setsnap.js";

export const TARGET = { set_snapshot: "refs", dial: "rack", lora: "preset", character: "render", setting: "render", scene: "render", principle: "render", pose: "first_frame", motion_guide: "refs", run: "render" };
export const KIND_LABEL = { set_snapshot: "Set snapshots", character: "Characters", setting: "Settings", scene: "Scenes", principle: "Principles", motion_guide: "Motion", pose: "Poses", dial: "Dials", lora: "LoRAs", run: "Runs" };

let cards = [], loading;
// cards load once per page; the view and the agent tools both wait on the same request
const USER_DIR = "snap/cards"; // the user's own cards, in ComfyUI's per-user data folder

async function loadAll() {
  const pack = (await (await api.fetchApi("/mainodes/snap/cards")).json()).cards;
  const mine = await Promise.all((await api.listUserDataFullInfo(USER_DIR)).filter((f) => f.path.endsWith(".json"))
    .map(async (f) => (await api.getUserData(`${USER_DIR}/${f.path}`)).json()));
  return [...mine.flat(), ...pack].filter((c) => TARGET[c.kind]); // kinds no brick takes are dropped
}

// pack cards and the user's cards, loaded once per page; a failed load is retried on the next call
export const ready = () => (loading ??= loadAll().then((all) => (cards = all), (e) => { loading = null; throw e; }));

// a version of a set card holding an edited snapshot: `mine` is the one working copy Apply keeps, otherwise a new card
export function version(card, snapshot, mine) {
  const lineage = card.lineage ?? card.id;
  const stamp = new Date().toTimeString().slice(0, 8);
  return { id: mine ? `${lineage}-mine` : `${lineage}-${Date.now().toString(36)}`, kind: "set_snapshot", lineage,
    title: mine ? `Set snapshot: ${snapshot.name}, end of ${snapshot.shot} (my edit)` : `Set snapshot: ${snapshot.name}, end of ${snapshot.shot} (saved ${stamp})`,
    text: card.text, brick: { snapshot } };
}

// keep an edited card as the user's own (never overwrites a pack card)
export async function save(card) {
  await api.storeUserData(`${USER_DIR}/${card.id}.json`, [card]);
  loading = null;
  await ready();
}
export const get = (id) => cards.find((c) => c.id === id);

export function search(query, brick) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const kinds = brick ? Object.keys(TARGET).filter((k) => TARGET[k] === brick) : null;
  return cards
    .filter((c) => !kinds || kinds.includes(c.kind))
    .map((c) => {
      const title = c.title.toLowerCase(), text = `${c.kind} ${c.text}`.toLowerCase();
      return [c, words.reduce((s, w) => s + (title.includes(w) ? 3 : 0) + (text.includes(w) ? 1 : 0), 0)];
    })
    .filter(([, score]) => !words.length || score > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([c]) => c);
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
  first = first.replace(/\s*,\s*(?=[,.])/g, "").replace(/\s{2,}/g, " ").replace(/\s+\./g, ".").trimEnd();
  if (first !== before) E.setValue("render", "render", "prompt", [first, ...rest].join("\n"));
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
export async function applySet(card, s = card.brick.snapshot) {
  const stem = `${card.id.replace(/[^a-z0-9-]/gi, "_")}_${digest(JSON.stringify(s))}`;
  const plan = await upload(drawPlan(s), `${stem}_plan.png`);
  const elevation = await upload(drawElevation(s), `${stem}_elevation.png`);
  const source = card.lineage ?? card.id; // every version of one set shares its picture slots
  E.batch(() => { // pictures, prompt and the remembered set text are one undo step
    E.addPicture(plan, { role: "set: plan", reason: `${s.name}, end of ${s.shot}, top down`, source, card: card.id });
    E.addPicture(elevation, { role: "set: elevation", reason: `${s.name}, end of ${s.shot}, looking north`, source, card: card.id });
    if (E.state().bricks.some((b) => b.key === "render")) { // this set's earlier block and blocking give way to the new ones
      const refs = E.state().bricks.find((b) => b.key === "refs"), text = [setBlock(s), blocking(s)];
      removeFromPrompt(refs.setText?.[source] ?? []);
      addToPrompt(text);
      E.remember("refs", "setText", { ...refs.setText, [source]: text });
    }
  });
  return `${card.title}: plan and elevation in References, set block in the prompt`;
}

// apply a card to its brick; returns what happened, or throws with the reason it can't
export async function apply(card) {
  const brick = TARGET[card.kind];
  if (!E.state().bricks.some((b) => b.key === brick)) throw new Error(`${card.title} goes on the ${brick} brick; add it first`);
  if (card.kind === "set_snapshot") return applySet(card);
  if (card.kind === "dial") {
    const rows = JSON.parse(E.getValue("rack", "rack", "rack") || "[]");
    if (rows.some((r) => r.dial === card.brick.dial)) return `${card.title} is already on the rack`;
    rows.push({ on: true, dial: card.brick.dial, strength: card.brick.strength, solo: false });
    E.setValue("rack", "rack", "rack", JSON.stringify(rows));
    const ui = E.nodeFor("rack", "rack")?.dialRack; // the rack owns its rows UI; tell it to re-read them
    ui?.load(); ui?.render();
    return `${card.title} added to the rack at ${card.brick.strength}`;
  }
  if (card.kind === "lora") {
    const w = E.nodeFor("preset", "preset").widgets.find((x) => x.name === "lora");
    const file = w.options.values.find((v) => String(v).split(/[\\/]/).pop() === card.brick.lora);
    if (!file) throw new Error(`${card.brick.lora} is not installed here`);
    E.setValues("preset", "preset", { lora: file, lora_strength: card.brick.strength });
    return `${card.title} on the Render Preset`;
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
