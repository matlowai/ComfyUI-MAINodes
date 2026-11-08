// Prompt craft from the 2026-11-07 measurements (the study's PROMPT_CRAFT_RULES §0 and §8): the lints the Book's compile,
// apply_unit and run say before a render. Pictures beat words, and a picture in References is a target whatever its
// citation syntax: a key picture on an action cut is reached by 1.5-2.5 s and frozen on (M6), a location master is
// where an end-of-take cut goes (M2, M7). A look-alike cite inside the action jump-cuts to its picture (F-SQ20); a
// soundscape that opens soft or tonal renders near-silent or drones (U78); two lines that disagree draw the wrong one
// (PC-09). Error-level lints are said, never enforced (SNAP-R11).
// SNAP-R242 a picture in References is a target · SNAP-R243 a cited picture has a job · SNAP-R248 the soundscape leads with
// hard events · SNAP-R250 one ordered action, no two lines disagree · see docs/snap/SNAP_RULES.md
export const KEY_TARGET = "on an action cut H3 turns into a key picture by 1.5-2.5 s and freezes on it (M6: 4/4 takes, with or without a sentence, \"the shot ends on <Picture n>\" too; motion after 2.5 s 3.3-6.5 against 12.7-13.3 without it)";
export const MASTER_TARGET = "a picture whose framing isn't this cut's camera is where a take cuts to (the master: M2 13/18 takes at 640, M7 3/10 at 1280, 0/3 without it; wrapping it in a <Subject N> does not stop it)";
const sentences = (text) => String(text ?? "").split(/(?<=[.!?])\s+/).filter(Boolean);

// SNAP-R243: a picture cited as something to look like, inside a description: F-SQ20's "a power clash like <Picture 4>"
// made H3 jump-cut into that picture's framing and stall (2/2)
const LOOK = /\b(?:like|as in|similar to|just as in|the same as|resembling)\s+(<Picture \d+>)/i;
export function lookAlike(text) {
  return sentences(text).filter((s) => LOOK.test(s)).map((s) => `error: "${s.trim()}" cites ${s.match(LOOK)[1]} as a look-alike: a picture cited inside the action makes H3 jump-cut into its framing and stall (F-SQ20: 2/2; motion 2.6 against ~10.8); write the motion out and cite a picture only for its job: the opening, this cut's camera, who someone is, a continuity frame (SNAP-R243)`);
}

// SNAP-R248 (U78): the soundscape's first clause is what H3 renders loudest; soft or ambience-only wording comes out
// near-silent (-57.8 dB against -39 to -42 with events) and steady or tonal sources become drones
const SOFT = /\b(soft|softly|gentle|gently|faint|faintly|distant|quiet|quietly|hushed|ambient|ambience|subtle)\b/i;
const TONAL = /\b(hiss|hissing|hum|humming|buzz|buzzing|drone|droning|rumble|rumbling|horn|engine|cicadas?|whine|whining|ringing)\b/i;
export function soundLint(soundscape, music) {
  const out = [], first = String(soundscape ?? "").split(/[,;.]/)[0].trim();
  if (first && first !== "N/A") {
    const soft = first.match(SOFT)?.[0], tonal = first.match(TONAL)?.[0];
    if (soft || tonal) out.push(`the soundscape opens on "${first}": ${tonal ? `"${tonal}" is a steady or tonal source, which H3 renders as a drone` : `"${soft}" opens it soft, and an ambience-first soundscape renders near-silent (U78: -57.8 dB against -39 to -42 with events)`}; lead with the hard, countable sounds the action makes (a clink, a knock, a thud), then a short tail (SNAP-R248)`);
  }
  if (music && !/^\s*N\/A\s*$/i.test(music)) out.push(`non_diegetic_music is "${music}": music is a reference input the production supplies, never generated per take (SNAP-R151); write N/A`);
  return out;
}

// SNAP-R250 (PC-09): one prop put in two places in one prompt ("the monocle in his left hand" and "the monocle hanging
// on his lapel"; "the wand in her right hand" and "the wand in her left hand"): the model draws one of them
const PLACE = /\b(?:the|a|an|his|her|their) ((?:[a-z]+ ){0,2}?[a-z]+) (?:is |stays |rests |hangs |hanging |held |dangling |sits |sitting |)(in (?:his|her|their) (?:left|right) hand|in both hands|on (?:his|her|their) (?:[a-z]+ ){0,1}(?:lapel|chest|eye|nose|face|head|back|belt|hip|shoulder|neck|lap))\b/gi;
export function placeLint(text) {
  const seen = new Map();
  for (const m of String(text ?? "").matchAll(PLACE)) {
    const thing = m[1].toLowerCase().split(" ").pop(), where = m[2].toLowerCase();
    if (["hand", "hands", "head", "face"].includes(thing)) continue;
    seen.set(thing, new Set([...(seen.get(thing) ?? []), where]));
  }
  return [...seen].filter(([, w]) => w.size > 1).map(([thing, w]) => `the prompt puts the ${thing} in two places (${[...w].map((x) => `"${x}"`).join(" and ")}): with two lines that disagree the model draws one of them, often the wrong one (PC-09: 2/2); say one place, once (SNAP-R250)`);
}
// SNAP-R250 (PC-02): a hit placed by a place-word ("at the middle of the shot") landed at 0.9 s; a written wind-up and
// "then" put it at 2.0 s
const PLACED = /\b(?:at|in|by) the (?:middle|midpoint|half ?way point|end|start|beginning) of the (?:shot|cut|clip|take)\b/i;
export function timingLint(text) {
  return sentences(text).filter((s) => PLACED.test(s) && !/\bthen\b/i.test(s)).map((s) => `"${s.trim()}" times the action with a place-word: "at the middle of the shot" put the hit at 0.9 s, a written wind-up and "then" at 2.0 s (PC-02); write what comes before it, then the hit (SNAP-R250)`);
}

// SNAP-R242: what References holds against the cut: a key picture on a cut that doesn't end on a held pose (unit.hold),
// and a place picture (the master, another plate) beside this cut's camera picture; error-level, whatever the citation
export function inclusion(pictures, unit = {}) {
  const out = [], role = (p) => p.role ?? "";
  for (const p of pictures.filter((x) => role(x).startsWith("key: ") && !unit.hold)) out.push(`error: ${p.cite} is a key drawing in References and this cut doesn't end on a held pose: ${KEY_TARGET}; take it out (set_unit {key: null}, or remove_ref), or set_unit {hold: true} when a 2 s build then a hold is what the cut wants (SNAP-R242)`);
  const camera = pictures.some((x) => /\(camera\)$/.test(role(x)) || role(x).startsWith("opening: "));
  if (camera) for (const p of pictures.filter((x) => /^location: .*\(place\)$/.test(role(x)))) out.push(`error: ${p.cite} (${role(p).replace(/^location: /, "")}) is in References beside this cut's camera picture: ${MASTER_TARGET}; leave it out (apply_unit does unless set_unit {cite_master: true}) (SNAP-R242)`);
  return out;
}
// every craft lint on an H3 prompt's three sections as they stand
export function promptLint(prompt) {
  const line = (k) => String(prompt ?? "").split("\n").find((l) => l.startsWith(`${k}:`))?.slice(k.length + 1).trim() ?? null;
  const description = line("integrated_multimodal_description") ?? String(prompt ?? "");
  return [...lookAlike(description), ...timingLint(description), ...placeLint(description), ...soundLint(line("overall_soundscape"), line("non_diegetic_music"))];
}
