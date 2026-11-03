// Snap Library (LIBRARY.md): cards that snap onto bricks. Each kind goes to one brick and does one visible thing there;
// search is slot-aware (a selected brick narrows it to the kinds that brick takes). Keyword search for now; the
// multimodal embedder plugs in behind `search` once its runtime is chosen.
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";

export const TARGET = { dial: "rack", lora: "preset", character: "render", setting: "render", scene: "render", principle: "render", pose: "first_frame", motion_guide: "refs", run: "render" };
export const KIND_LABEL = { character: "Characters", setting: "Settings", scene: "Scenes", principle: "Principles", motion_guide: "Motion", pose: "Poses", dial: "Dials", lora: "LoRAs", run: "Runs" };

let cards = [];
export async function load() {
  cards = (await (await api.fetchApi("/mainodes/snap/cards")).json()).cards;
  return cards;
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

// add the phrases not already there to the first line of the H3 prompt (the integrated description)
function addToPrompt(phrases) {
  const prompt = E.getValue("render", "render", "prompt") ?? "";
  const [first, ...rest] = prompt.split("\n");
  const fresh = phrases.filter((x) => !first.includes(x));
  if (!fresh.length) return false;
  E.setValue("render", "render", "prompt", [`${first.replace(/\s*$/, "")} ${fresh.join(", ")}.`.trimStart(), ...rest].join("\n"));
  return true;
}

// apply a card to its brick; returns what happened, or throws with the reason it can't
export function apply(card) {
  const brick = TARGET[card.kind];
  if (!E.state().bricks.some((b) => b.key === brick)) throw new Error(`${card.title} goes on the ${brick} brick; add it first`);
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
    E.setValue("preset", "preset", "lora", file);
    E.setValue("preset", "preset", "lora_strength", card.brick.strength);
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
