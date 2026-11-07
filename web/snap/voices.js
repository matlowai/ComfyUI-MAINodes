// The voice note on takes (G1b): a take whose recipe cites a Cast's voice reference (an <Audio n> in References, SNAP-R73)
// gets, once it lands, its soundtrack compared with that reference and with every other Cast's voice: WavLM-SV speaker
// embeddings and the median F0 of the loud voiced frames (MAISnapVoice, snap_voice.py), thresholds from the model graph's
// voice_check. The note says "voice matches Maren 0.98, next closest Liesl 0.91 (+0.07), F0 184 Hz vs ref 184 Hz" ("voice
// vs Maren ..." when it isn't ok) with a
// status: ok (own at least `ok`, ahead of every other Cast by `margin`, F0 within `f0_semitones`), check (any of those
// missed, said why) or no voice (nothing voiced in the take). Two similar voices overlap in WavLM (short03's two young
// women 0.81-0.95), so it gives numbers and the margin and never claims a person; it never blocks anything. The check is
// a small prompt under this page's client id whose job says `takes: false` (SNAP-R65); the take keeps its prompt id
// while it runs, so a page reloaded meanwhile finishes it. With a Whisper in the model graph (word_timing) the same prompt
// times the take's words ([[start, end, word]], the take's seconds) and says how its text matches the cut's line.
// SNAP-R18 local only · SNAP-R23 checks are notes, never rejections · SNAP-R65 job stamps · SNAP-R73 a Cast's voice is
// an <Audio n> · SNAP-R114 the voice note · SNAP-R227 the take's words timed by a Whisper, matched against its line · see
// docs/snap/SNAP_RULES.md
import * as K from "./checks.js";
import * as M from "./models.js";
import * as T from "./takes.js";
import * as W from "./world.js";
import * as SC from "./scenes.js";

// the voice model and its thresholds from the model graph: the audio_encoders file whose entry has voice_check
async function voiceModel() {
  await M.load();
  const name = (M.folders().get("audio_encoders") ?? []).find((n) => M.entry(n)?.voice_check);
  if (!name) throw new Error("The voice note needs WavLM-SV with voice_check in the model graph (models/audio_encoders/wavlm_base_plus_sv.safetensors)");
  return { name, check: M.entry(name).voice_check };
}

// SNAP-R227: the Whisper that times a take's words, when the model graph has one (an audio_encoders entry with word_timing)
function wordsModel() { return (M.folders().get("audio_encoders") ?? []).find((n) => M.entry(n)?.word_timing) ?? null; }
// the line the take's cut speaks, as the story says it at the version the take pinned (its beats' dialogue), or ""
function lineOf(take) {
  const pin = take.story ?? take.graph?.extra?.snap?.story, scene = pin?.unit && SC.get(pin.unit.scene), unit = scene?.shots.find((x) => x.id === pin.unit.shot)?.unit;
  const story = pin?.ref && W.get(pin.ref)?.version.body;
  return (unit?.beats ?? []).flatMap((id) => story?.beats.find((b) => b.id === id)?.lines ?? []).map((l) => l.text).join(" ");
}
const plain = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
// Whisper's text against the line as written: exact (same words in order, punctuation and case aside) or how many of the
// line's words it heard, in order
export function lineMatch(heard, line) {
  const a = plain(heard), b = plain(line);
  if (!b.length) return null;
  let i = 0, hit = 0;
  for (const w of b) { const k = a.indexOf(w, i); if (k >= 0) { hit++; i = k + 1; } }
  const exact = a.join(" ") === b.join(" ");
  return { exact, heard: heard.trim(), line, words: `${hit} of ${b.length}`, said: exact ? "Whisper exact" : `Whisper heard ${hit} of the line's ${b.length} words: "${heard.trim()}"` };
}
// the audio files a take's prompt gave H3 as references: LoadAudio files wired into any ref_audios.* input, in slot order
export function referenceAudios(prompt) {
  const out = [];
  for (const n of Object.values(prompt ?? {})) for (const [k, v] of Object.entries(n.inputs ?? {}).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    const src = k.startsWith("ref_audios.") && Array.isArray(v) && prompt[v[0]];
    if (src?.class_type === "LoadAudio") out.push(src.inputs.audio);
  }
  return out;
}
// every Cast's voice files: per file the Cast it belongs to (any version), and per Cast its newest voice
function castVoices() {
  const byFile = new Map(), newest = [];
  for (const r of W.all("cast")) {
    for (const v of r.versions) if (v.body?.voice?.file) byFile.set(v.body.voice.file, { cast: W.refOf("cast", r.id, v.n), id: r.id, name: v.body.name });
    const head = W.headOf(r)?.body;
    if (head?.voice?.file) newest.push({ id: r.id, name: head.name, file: head.voice.file });
  }
  return { byFile, newest };
}
// the Cast voices a take cites: [{cast, id, name, file, cite}]
export function cited(take) {
  const { byFile } = castVoices();
  return referenceAudios(take.prompt).map((file, i) => ({ ...byFile.get(file), file, cite: `<Audio ${i + 1}>` })).filter((x) => x.id);
}

// queue the voice check of a take: its soundtrack, each cited reference and every other Cast's newest voice, one
// MAISnapVoice each. Throws when the take cites no Cast voice or has no video
export async function check(take, by = "person") {
  await W.load();
  const voices = cited(take), video = take.media.find((m) => m.kind === "video");
  if (!voices.length) throw new Error(`Take ${take.number} cites no Cast voice reference (a Cast with a voice, applied, puts it in References as <Audio n>)`);
  if (!video) throw new Error(`Take ${take.number} has no video, so no sound to check`);
  const { name, check: thresholds } = await voiceModel(), others = castVoices().newest.filter((o) => !voices.some((v) => v.id === o.id));
  const files = [...new Set([...voices.map((v) => v.file), ...others.map((o) => o.file)])];
  const g = { vm: { class_type: "MAISnapVoiceModelLoader", inputs: { model_name: name } }, tv: { class_type: "LoadVideo", inputs: { file: K.annotated(video) } },
    tc: { class_type: "GetVideoComponents", inputs: { video: ["tv", 0] } }, t: { class_type: "MAISnapVoice", inputs: { voice_model: ["vm", 0], audio: ["tc", 1] } } };
  files.forEach((file, i) => { g[`a${i}`] = { class_type: "LoadAudio", inputs: { audio: file } }; g[`r${i}`] = { class_type: "MAISnapVoice", inputs: { voice_model: ["vm", 0], audio: [`a${i}`, 0] } }; });
  const words = wordsModel(), line = lineOf(take);
  if (words) Object.assign(g, { wm: { class_type: "MAISnapWordsModelLoader", inputs: { model_name: words } }, w: { class_type: "MAISnapWords", inputs: { words_model: ["wm", 0], audio: ["tc", 1] } } });
  const id = await K.queue(g, { job: { kind: "check", title: `Voice check: does take ${take.number} keep ${voices.map((v) => v.name).join(" and ")}'s voice?`, about: { take: take.id, group: take.group }, by, takes: false } });
  take.voice = { pending: true, by, prompt_id: id, voices, others, files, thresholds, ...(words ? { timed: true, line } : {}) };
  await T.save(take);
  heard(take);
  return { queued: true, voices: voices.map((v) => `${v.name} (${v.cite})`), against: others.map((o) => o.name), words: words ? `timed by ${words}` : "not timed: no Whisper with word_timing in the model graph (models/audio_encoders)" };
}

const cos = (a, b) => +a.reduce((s, v, k) => s + v * b[k], 0).toFixed(3);
const hz = (x) => (x == null ? "no pitch" : `${Math.round(x)} Hz`);
// the note from the check's outputs: per cited voice its own score, the other Casts' (closest first), the margin and F0
export function note({ voices, others, files, thresholds: c, timed, line }, outputs, by) {
  const at = (k) => outputs?.[k] ?? {}, take = at("t"), ref = (file) => at(`r${files.indexOf(file)}`);
  const f0 = take.f0?.[0] ?? null, emb = take.voices?.[0];
  const rows = voices.map((v) => {
    const r = ref(v.file), own = cos(emb, r.voices[0]), ref_f0 = r.f0?.[0] ?? null;
    const vs = others.map((o) => ({ name: o.name, score: cos(emb, ref(o.file).voices[0]) })).sort((a, b) => b.score - a.score), top = vs[0] ?? null;
    const margin = top ? +(own - top.score).toFixed(3) : null, st = f0 && ref_f0 ? +(12 * Math.log2(f0 / ref_f0)).toFixed(1) : null;
    const why = f0 == null ? ["no voice found in the take"] : [own < c.ok && `${own} is under ${c.ok}`, margin != null && margin < c.margin && `${top.name} is within ${c.margin} (${margin >= 0 ? "+" : ""}${margin.toFixed(2)})`,
      st != null && Math.abs(st) > c.f0_semitones && `F0 is ${Math.abs(st)} semitones ${st > 0 ? "above" : "below"} the reference`].filter(Boolean);
    const status = f0 == null ? "no voice" : why.length ? "check" : "ok";
    const said = f0 == null ? `no voice found (${v.name}'s reference ${hz(ref_f0)})`
      : `voice ${status === "ok" ? "matches" : "vs"} ${v.name} ${own.toFixed(2)}${top ? `, ${top.score > own ? "closer to" : "next closest"} ${top.name} ${top.score.toFixed(2)} (${margin >= 0 ? "+" : ""}${margin.toFixed(2)})` : ""}, F0 ${hz(f0)} vs ref ${hz(ref_f0)}`;
    return { name: v.name, cast: v.cast, cite: v.cite, own, others: vs, margin, f0, ref_f0, semitones: st, status, ...(why.length ? { why } : {}), said };
  });
  const status = rows.some((r) => r.status === "check") ? "check" : rows.every((r) => r.status === "no voice") ? "no voice" : "ok";
  const w = at("w"), heardText = w.text?.[0] ?? null, match = timed && heardText != null ? lineMatch(heardText, line ?? "") : null;
  return { status, voices: rows, f0, thresholds: c, by, at: new Date().toISOString(), ...(timed ? { words: w.words ?? [], text: heardText, ...(match ? { line_match: match } : {}) } : {}) };
}
// a voice check's outputs onto its take, once its prompt is done
function heard(take) {
  const v = take.voice;
  K.checked(v.prompt_id).then((h) => note(v, h.outputs, v.by), (e) => ({ error: e.message, by: v.by, at: new Date().toISOString() }))
    .then((done) => { take.voice = done; return T.save(take); }).catch((e) => console.warn(`voice check: ${e.message}`));
}
// a landed take that cites a Cast voice gets its note by itself (a few seconds on the queue), for the person whose page
// captured it; a server without the voice model leaves a note that says what it needs
T.onLanded((take) => {
  if (take.voice || !take.media.some((m) => m.kind === "video") || !referenceAudios(take.prompt).length) return;
  W.load().then(() => (cited(take).length ? check(take) : null)).catch(async (e) => { take.voice = { error: e.message, by: "person", at: new Date().toISOString() }; await T.save(take); });
});
// voice checks still pending when the page loaded (a reload while one ran): finish them from the server's history
export async function resume() {
  for (const t of (await T.load()).filter((x) => x.voice?.pending)) heard(t);
}
resume().catch(() => {});
