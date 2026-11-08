// SNAP-R240: the AudioCPP loader advertises GGUF files omitted by the core model inventory.
// CPU-only: node tests/snap/test_voice_qa_discovery.js
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const pack = path.resolve(__dirname, "../..");
const source = fs.readFileSync(path.join(pack, "web/snap/voices.js"), "utf8").replace(/^import .*;$/gm, "").replace(/^export /gm, "");
const graph = JSON.parse(fs.readFileSync(path.join(pack, "snap_cards/models.json"), "utf8")).files;
const decoder = graph.find((e) => e.voice_qa?.role === "transcribe"), speaker = graph.find((e) => e.voice_qa?.role === "speaker");
function page({ options = ["unrelated.gguf", decoder.file], inventory = [], speakers = [speaker.file], installed = true } = {}) {
  const requests = [], context = vm.createContext({
    api: { fetchApi: async (url) => { requests.push(url); return { json: async () => url.endsWith("/AudioCPPH3VoiceQA") ? (installed ? { AudioCPPH3VoiceQA: {} } : {}) : { AudioCPPLocalServer: { input: { required: { model: ["COMBO", { options }] } } } } }; } },
    M: { load: async () => {}, folders: () => new Map([["audiocpp_gguf", inventory], ["audio_encoders", speakers]]), entry: (name) => graph.find((e) => e.file === name) },
    T: { onLanded() {}, load: async () => [] },
  });
  vm.runInContext(source, context);
  return { kit: () => vm.runInContext("qaKit()", context), requests };
}
(async () => {
  const native = page();
  const kit = await native.kit();
  assert.equal(kit.transcribe, decoder.file);
  assert.equal(kit.speaker, speaker.file);
  assert.equal(kit.margin, speaker.voice_qa.margin);
  assert.equal(kit.missing, undefined);
  await native.kit();
  assert.deepEqual(native.requests, ["/object_info/AudioCPPH3VoiceQA", "/object_info/AudioCPPLocalServer"]);
  const absent = await page({ options: [], inventory: [decoder.file] }).kit();
  assert.match(absent.missing, /Nemotron Transcribe GGUF/);
  const noSpeaker = await page({ speakers: [] }).kit();
  assert.match(noSpeaker.missing, /WavLM-large ECAPA/);
  assert.doesNotMatch(noSpeaker.missing, /Nemotron Transcribe GGUF/);
  const noFork = page({ installed: false });
  assert.match((await noFork.kit()).missing, /AudioCPP fork/);
  assert.deepEqual(noFork.requests, ["/object_info/AudioCPPH3VoiceQA"]);
  console.log("voice_qa_discovery 5/5 (native GGUF choices, role metadata, page cache, missing models, absent fork)");
})().catch((e) => { console.error(e); process.exitCode = 1; });
