// The voice note on takes (G1b): a take whose recipe cites a Cast's voice reference (an <Audio n> in References, SNAP-R73)
// gets, once it lands, its soundtrack compared with that reference and with every other Cast's voice: WavLM-SV speaker
// embeddings and the median F0 of the loud voiced frames (MAISnapVoice, snap_voice.py), thresholds from the model graph's
// voice_check. The note says "voice matches Maren 0.98, next closest Liesl 0.91 (+0.07), F0 184 Hz vs ref 184 Hz" ("voice
// vs Maren ..." when it isn't ok) with a
// status: ok (own at least `ok`, ahead of every other Cast by `margin`, F0 within `f0_semitones`), check (any of those
// missed, said why) or no voice (nothing voiced in the take). Two similar voices overlap in WavLM (short03's two young
// women 0.81-0.95), so it gives numbers and the margin and never claims a person; it never blocks anything. The check is
// a small prompt under this page's client id whose job says `takes: false` (SNAP-R65); the take keeps its prompt id
// while it runs, so a page reloaded meanwhile finishes it.
// G17b: with the AudioCPP fork's nodes on the server and its two files in the model graph (voice_qa: Nemotron Transcribe,
// WavLM-large ECAPA), the same prompt runs the H3 Voice QA: Nemotron for the words, their times and any speech nobody
// scripted, ECAPA for who said each line (unsure under the pack's 0.08), every Cast voice of the Book as the reference
// speakers, a prompt Snap writes in H3's dialogue grammar from the cut's lines (the fork's parser reads <d>…</d> only),
// and a PreviewAny on its report so the JSON lands in /history. The words of the take come from the same pass (take
// seconds), so a cut where nobody speaks is checked too: that is where a voice reference leaks.
// SNAP-R18 local only · SNAP-R23 checks are notes, never rejections · SNAP-R65 job stamps · SNAP-R73 a Cast's voice is
// an <Audio n> · SNAP-R114 the voice note · SNAP-R227 the take's words, timed by Nemotron · SNAP-R240 the Voice QA ·
// see docs/snap/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
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

// ---- SNAP-R240: the H3 Voice QA (matlowai/ComfyUI-AudioCPP, branch nemotron-diarization) ------------------------------
// the operator, 2026-11-07 17:51: the QA's Nemotron server runs on GPU 0 by default (ComfyUI is on GPU 1), the slower
// same-card mode is a setting; the barks are English
export const QA_GPU = "MAINodes.Snap.VoiceQAGPU";
export const QA_GPU_CHOICES = ["the other GPU", "this GPU, experts in RAM", "off"];
const QA_LANGUAGE = "en", QA_PORT = 8090, MAX_SPEAKERS = 7; // the fork's diarizer keeps one of its 8 columns free
let kit = null;
// what this server has for the QA: {transcribe, speaker, margin} or {missing: why}; asked once per page
export function qaKit() {
  kit ??= (async () => {
    const info = await (await api.fetchApi("/object_info/AudioCPPH3VoiceQA")).json().catch(() => ({}));
    if (!info.AudioCPPH3VoiceQA) return { missing: "the AudioCPP fork's nodes aren't on this server (matlowai/ComfyUI-AudioCPP, branch nemotron-diarization)" };
    await M.load();
    const own = (folder, role) => (M.folders().get(folder) ?? []).find((n) => M.entry(n)?.voice_qa?.role === role);
    const transcribe = own("audiocpp_gguf", "transcribe"), speaker = own("audio_encoders", "speaker");
    const gone = [!transcribe && "the Nemotron Transcribe GGUF (models/audio_encoders/nemotron/)", !speaker && "the WavLM-large ECAPA voice model (models/audio_encoders/wavlm_large_ecapa_sv/model.safetensors)"].filter(Boolean);
    return gone.length ? { missing: `the model graph's ${gone.join(" and ")} isn't installed` } : { transcribe, speaker, margin: M.entry(speaker).voice_qa.margin };
  })().catch((e) => { kit = null; return { missing: e.message }; });
  return kit;
}
// where the QA's server runs, from the setting: the first card that isn't ComfyUI's (by UUID), or ComfyUI's own with the
// experts in RAM (6.7 GB of VRAM, about 3x slower); null when the setting is off
export async function qaPlace() {
  const pick = app.extensionManager?.setting?.get(QA_GPU) ?? QA_GPU_CHOICES[0];
  if (pick === "off") return null;
  const { gpus = [], comfy = null } = await (await api.fetchApi("/mainodes/snap/gpus")).json().catch(() => ({}));
  const other = gpus.find((g) => g.uuid !== comfy);
  if (pick === QA_GPU_CHOICES[0] && other) return { gpu: other.uuid, memory: "all on GPU", said: `on GPU ${other.index} (${other.name}), not ComfyUI's` };
  return { gpu: "", memory: "experts in RAM", said: `on ComfyUI's own GPU with the experts in RAM (${pick === QA_GPU_CHOICES[0] ? "there is no other GPU" : "the Voice QA setting"})` };
}

// the take's story pin and the lines its cut speaks, as the story says them at the version the take pinned
function cutOf(take) {
  const pin = take.story ?? take.graph?.extra?.snap?.story, scene = pin?.unit && SC.get(pin.unit.scene), unit = scene?.shots.find((x) => x.id === pin.unit.shot)?.unit;
  const story = pin?.ref && W.get(pin.ref)?.version.body, name = (ref) => W.get(ref)?.version.body.name ?? ref;
  return { pinned: !!pin?.unit, lines: (unit?.beats ?? []).flatMap((id) => story?.beats.find((b) => b.id === id)?.lines ?? []).map((l) => ({ who: l.who, name: name(l.who), text: l.text })) };
}
const lineOf = (take) => cutOf(take).lines.map((l) => l.text).join(" ");
// a plain shot's lines from its own prompt: `Name says "…"` sentences (the way the Book's compile writes them)
const SAYS = /([A-Z][\w'-]*(?: [A-Z][\w'-]*)?) (?:says|asks|shouts|whispers|mutters|replies|calls out|exclaims)[^"“]*["“]([^"”]+)["”]/g;
const promptLines = (text) => [...String(text ?? "").matchAll(SAYS)].map((m) => ({ name: m[1], text: m[2] }));
const plain = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").split(/\s+/).filter(Boolean);
// the heard text against the line as written: exact (same words in order, punctuation and case aside) or how many of the
// line's words it heard, in order
export function lineMatch(heard, line) {
  const a = plain(heard), b = plain(line);
  if (!b.length) return null;
  let i = 0, hit = 0;
  for (const w of b) { const k = a.indexOf(w, i); if (k >= 0) { hit++; i = k + 1; } }
  const exact = a.join(" ") === b.join(" ");
  return { exact, heard: heard.trim(), line, words: `${hit} of ${b.length}`, said: exact ? "Nemotron exact" : `Nemotron heard ${hit} of the line's ${b.length} words: "${heard.trim()}"` };
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
// the QA's reference speakers: the voices the take cites, then every Cast voice of its Book, then the rest of the Cast
// library as distractors (the voice model needs two), at most seven, each Cast once by its newest voice (and each name
// once: the fork's references are named)
function speakersFor(take, voices) {
  const { newest } = castVoices(), pin = take.story ?? take.graph?.extra?.snap?.story, book = pin?.book && W.get(pin.book)?.version.body;
  const ids = (book?.cast ?? []).map((r) => W.parse(r).id), out = [];
  for (const v of [...voices, ...newest.filter((x) => ids.includes(x.id)), ...newest]) if (!out.some((o) => o.id === v.id || o.name === v.name) && out.length < MAX_SPEAKERS) out.push({ id: v.id, name: v.name, file: v.file });
  return { list: out, left: newest.filter((x) => !out.some((o) => o.id === x.id)).map((x) => x.name) };
}
// the prompt the QA parses (the fork finds scripted lines only as <d>…</d>), written from the cut's lines: <Audio k> for
// a speaker among the references, the name otherwise (no reference: the QA says no_reference); one [Shot 1]
export function qaPrompt(take, speakers) {
  const cut = cutOf(take), lines = cut.pinned ? cut.lines : /<d>/.test(take.text ?? "") ? null : promptLines(take.text);
  if (!lines) return { prompt: take.text, cast: "", lines: "the take's own <d> lines" };
  const k = (name) => speakers.findIndex((s) => s.name === name) + 1;
  return { prompt: `[Shot 1] ${lines.map((l) => `${k(l.name) ? `<Audio ${k(l.name)}>` : l.name} <d>${l.text}</d>`).join(" ") || "Nobody speaks."}`,
    cast: speakers.map((s, i) => `Audio ${i + 1}: ${s.name}`).join("\n"), lines: lines.length ? `${lines.length} line${lines.length > 1 ? "s" : ""} from ${cut.pinned ? "the cut's story" : "the prompt"}` : "no line: nobody should speak" };
}

// queue the voice check of a take: with cited Cast voices, its soundtrack against each cited reference and every other
// Cast's newest voice (one MAISnapVoice each); with the Voice QA, the QA over the same sound (a take that cites no voice
// too: unscripted speech is the leak). Throws when there is nothing to check it with, or no video
export async function check(take, by = "person") {
  await W.load();
  const voices = cited(take), video = take.media.find((m) => m.kind === "video"), q = await qaKit(), place = q.missing ? null : await qaPlace();
  if (!video) throw new Error(`Take ${take.number} has no video, so no sound to check`);
  const qa = !q.missing && place;
  if (!voices.length && !qa) throw new Error(`Take ${take.number} cites no Cast voice reference (a Cast with a voice, applied, puts it in References as <Audio n>)${q.missing ? `, and the Voice QA can't run: ${q.missing}` : ", and the Voice QA setting is off"}`);
  const g = { tv: { class_type: "LoadVideo", inputs: { file: K.annotated(video) } }, tc: { class_type: "GetVideoComponents", inputs: { video: ["tv", 0] } } };
  let thresholds = null, others = [], files = [];
  if (voices.length) {
    const vm = await voiceModel();
    thresholds = vm.check; others = castVoices().newest.filter((o) => !voices.some((v) => v.id === o.id));
    files = [...new Set([...voices.map((v) => v.file), ...others.map((o) => o.file)])];
    Object.assign(g, { vm: { class_type: "MAISnapVoiceModelLoader", inputs: { model_name: vm.name } }, t: { class_type: "MAISnapVoice", inputs: { voice_model: ["vm", 0], audio: ["tc", 1] } } });
    files.forEach((file, i) => { g[`a${i}`] = { class_type: "LoadAudio", inputs: { audio: file } }; g[`r${i}`] = { class_type: "MAISnapVoice", inputs: { voice_model: ["vm", 0], audio: [`a${i}`, 0] } }; });
  }
  let plan = null;
  if (qa) {
    const sp = speakersFor(take, voices), p = qaPrompt(take, sp.list);
    g.qs = { class_type: "AudioCPPLocalServer", inputs: { model: q.transcribe, port: QA_PORT, gpu: place.gpu, memory: place.memory, idle_unload_seconds: 300, timeout: 600 } };
    g.qn = { class_type: "AudioCPPNemotronTranscribe", inputs: { server: ["qs", 0], model: "", audio: ["tc", 1], language: QA_LANGUAGE, options: "" } };
    g.qq = { class_type: "AudioCPPH3VoiceQA", inputs: { details: ["qn", 1], prompt: p.prompt, cast: p.cast } };
    if (sp.list.length) {
      sp.list.forEach((s, i) => { g[`qa${i}`] = { class_type: "LoadAudio", inputs: { audio: s.file } }; });
      g.qr = { class_type: "AudioCPPReferenceSpeakers", inputs: { names: sp.list.map((s) => s.name).join("\n"), ...Object.fromEntries(sp.list.map((_, i) => [`clips.audio${i}`, [`qa${i}`, 0]])) } };
      g.qn.inputs.speakers = ["qr", 0];
    }
    if (sp.list.length >= 2) { g.qm = { class_type: "AudioCPPVoiceModelLoader", inputs: { model_name: q.speaker } }; Object.assign(g.qq.inputs, { voice_model: ["qm", 0], audio: ["tc", 1], speakers: ["qr", 0] }); }
    g.qp = { class_type: "PreviewAny", inputs: { source: ["qq", 1] } }; // lab check L6: the report's JSON reaches /history only through a PreviewAny
    plan = { speakers: sp.list.map((s) => s.name), ...(sp.left.length ? { left_out: sp.left } : {}), by_voice: sp.list.length >= 2, prompt: p.prompt, lines: p.lines, gpu: place.said, margin: q.margin };
  }
  const line = lineOf(take), who = voices.length ? `keep ${voices.map((v) => v.name).join(" and ")}'s voice` : "speak only its script";
  const id = await K.queue(g, { job: { kind: "check", title: `Voice check: does take ${take.number} ${who}?${plan ? ` (Voice QA ${place.said})` : ""}`, about: { take: take.id, group: take.group }, by, takes: false } });
  take.voice = { pending: true, by, prompt_id: id, voices, others, files, thresholds, line, ...(plan ? { qa: plan } : {}) };
  await T.save(take);
  heard(take);
  return { queued: true, voices: voices.map((v) => `${v.name} (${v.cite})`), against: others.map((o) => o.name),
    words: plan ? `timed by Nemotron Transcribe (${q.transcribe}) in the Voice QA, ${place.said}` : `not timed: ${q.missing ?? "the Voice QA setting is off"}`,
    ...(plan ? { qa: { speakers: plan.speakers, ...(plan.left_out ? { left_out: `more than ${MAX_SPEAKERS} Cast voices: ${plan.left_out.join(", ")} not among the references` } : {}), by_voice: plan.by_voice ? "WavLM-large ECAPA scores each line against every reference" : "fewer than two Cast voices: who said a line is Nemotron's diarizer alone (the voice model needs two references)", lines: plan.lines, prompt: plan.prompt } } : {}) };
}

const cos = (a, b) => +a.reduce((s, v, k) => s + v * b[k], 0).toFixed(3);
const hz = (x) => (x == null ? "no pitch" : `${Math.round(x)} Hz`);
// the QA's report as the note keeps it: per line its verdict in words, the unscripted speech, and a status: check (a wrong
// voice, a missing or mistimed line, unscripted speech), listen (a voice under the margin: never "wrong person"), or ok
export function qaNote(report, plan) {
  const lines = report.lines.map((r) => ({ shot: r.shot, text: r.text, expected: r.expected_speaker, verdict: r.verdict, ...(r.heard ? { heard: r.heard, start: r.start, end: r.end } : {}),
    ...(r.voice_match ? { voice: r.voice_match, margin: r.voice_margin } : r.detected_speaker ? { voice: r.detected_speaker } : {}), ...(r.wrong_time ? { wrong_time: r.drift_seconds } : {}) }));
  const unscripted = report.unscripted.map((u) => ({ text: u.text, start: u.start, end: u.end, voice: u.voice_match ?? u.speaker, ...(u.voice_margin != null ? { margin: u.voice_margin } : {}) }));
  const why = [...lines.filter((l) => ["wrong_voice", "missing"].includes(l.verdict) || l.wrong_time).map((l) => l.verdict === "missing" ? `"${l.text}" (${l.expected}) wasn't heard` : l.verdict === "wrong_voice" ? `"${l.text}" sounds like ${l.voice}, not ${l.expected}${l.margin != null ? ` (margin ${l.margin})` : ""}` : `"${l.text}" starts ${l.wrong_time > 0 ? "after" : "before"} its shot (${l.wrong_time} s)`),
    ...unscripted.map((u) => `unscripted: "${u.text}" by ${u.voice} ${u.start}-${u.end} s${plan?.lines?.startsWith("no line") ? ": nobody speaks in this cut, so a voice reference may have leaked into it (H3 speaks a reference's own words)" : ""}`)];
  const unsure = lines.filter((l) => l.verdict === "unsure_voice");
  const status = why.length ? "check" : unsure.length ? "listen" : "ok";
  return { status, summary: report.summary, lines, unscripted, ...(why.length ? { why } : {}), ...(unsure.length ? { listen: unsure.map((l) => `"${l.text}": ${l.voice} by under ${plan?.margin ?? 0.08} over the next voice: listen before you recast`) } : {}),
    speakers: plan?.speakers ?? [], gpu: plan?.gpu ?? null };
}
// every word the QA heard, in take seconds: the scripted lines' words and the unscripted runs together are the transcript
const allWords = (report) => [...report.lines.flatMap((r) => r.words ?? []), ...report.unscripted.flatMap((u) => u.words ?? [])].sort((a, b) => a.start - b.start).map((w) => [w.start, w.end, w.word]);
// the note from the check's outputs: per cited voice its own score, the other Casts' (closest first), the margin and F0;
// the Voice QA's lines, unscripted speech and the take's words when it ran
export function note({ voices, others, files, thresholds: c, line, qa }, outputs, by) {
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
  const text = qa && at("qp").text?.[0], report = text ? JSON.parse(text) : null, q = report ? qaNote(report, qa) : null, words = report ? allWords(report) : null;
  const heardText = words ? words.map((w) => w[2]).join(" ") : null, match = heardText != null && line ? lineMatch(heardText, line) : null;
  const sv = rows.some((r) => r.status === "check") ? "check" : rows.length && rows.every((r) => r.status === "no voice") ? "no voice" : "ok";
  const status = sv === "check" || q?.status === "check" ? "check" : q?.status === "listen" ? "listen" : rows.length ? sv : words?.length ? "ok" : "no voice";
  return { status, voices: rows, f0, thresholds: c, by, at: new Date().toISOString(), ...(q ? { qa: q, words, text: heardText, ...(match ? { line_match: match } : {}) } : {}) };
}
// a voice check's outputs onto its take, once its prompt is done
function heard(take) {
  const v = take.voice;
  K.checked(v.prompt_id).then((h) => note(v, h.outputs, v.by), (e) => ({ error: e.message, by: v.by, at: new Date().toISOString() }))
    .then((done) => { take.voice = done; return T.save(take); }).catch((e) => console.warn(`voice check: ${e.message}`));
}
// a landed take that cites a Cast voice gets its note by itself (a few seconds on the queue), for the person whose page
// captured it; with the Voice QA, a take of a Book cut does too, voice or not (a silent cut is where a reference leaks);
// a server without the voice model leaves a note that says what it needs
T.onLanded((take) => {
  if (take.voice || !take.media.some((m) => m.kind === "video")) return;
  const pinned = !!(take.story ?? take.graph?.extra?.snap?.story)?.unit;
  if (!referenceAudios(take.prompt).length && !pinned) return;
  W.load().then(async () => (cited(take).length || (pinned && !(await qaKit()).missing && (await qaPlace())) ? check(take) : null))
    .catch(async (e) => { take.voice = { error: e.message, by: "person", at: new Date().toISOString() }; await T.save(take); });
});
// voice checks still pending when the page loaded (a reload while one ran): finish them from the server's history
export async function resume() {
  for (const t of (await T.load()).filter((x) => x.voice?.pending)) heard(t);
}
resume().catch(() => {});
