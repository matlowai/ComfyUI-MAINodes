// Batch G17b, the Voice QA in the voice note (SNAP-R240), a GPU proof on the builders' GPU server (SNAP_TEST_GPU_PORT and
// SNAP_TEST_GPU_BASE: a base with the AudioCPP fork (matlowai/ComfyUI-AudioCPP, nemotron-diarization) in its custom_nodes,
// the Nemotron Transcribe GGUF and the WavLM-large ECAPA file in its audio_encoders, AUDIOCPP_SERVER in its unit;
// skipped, said, without them), on real footage (fixtures short05_v3, short03 voices):
// - F-SQ11's leak: short03 v4 C1 (take-0d77cb14), a cut where nobody speaks that cites Maren's voice: the QA lists
//   unscripted speech by Maren and the note says check;
// - short05 C4 (take-b80dc620, Kuroe: "One more bowl."), its cut's line from the story pin: the line ok by voice,
//   margin above 0.08 against Maren, Liesl and Brann, its words in take seconds, "Nemotron exact";
// - short05 C1 (take-00767c8d, nobody speaks, no voice cited): checked anyway (a Book cut), nothing unscripted, ok;
// - the QA's server runs where the setting says, named in the answer: here ComfyUI's own card with the experts in RAM,
//   because the dev server is on GPU 0 and "the other GPU" would be the operator's GPU 1 (the default suits :8193).
// usage: node test_g17b_voice_qa.js   prints "g17bvoiceqa n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.env.SNAP_TEST_GPU_PORT, base = process.env.SNAP_TEST_GPU_BASE, R = {};
(async () => {
  const qa = port && await fetch(`http://127.0.0.1:${port}/object_info/AudioCPPH3VoiceQA`).then((r) => r.json()).catch(() => ({}));
  const has = (f) => base && fs.existsSync(path.join(base, "models", "audio_encoders", f));
  if (!(port && base && qa?.AudioCPPH3VoiceQA && has("nemotron/nemotron-transcribe-30b-a4b-experts-Q4_K_S.gguf") && has("wavlm_large_ecapa_sv/model.safetensors"))) {
    console.log("SKIP SNAP_TEST_GPU_PORT / SNAP_TEST_GPU_BASE unset, the AudioCPP fork's nodes not on that server, or its audio_encoders lack the Nemotron GGUF / the WavLM-large ECAPA file"); console.log("g17bvoiceqa 0/0 (skipped)"); return;
  }
  const FX = CFG.fixture("short05_v3"), VOICES = CFG.fixture("short03", "voices");
  const fin = path.join(base, "input", "snap", "g17bqa"), fout = path.join(base, "output", "snaptest_g17bqa");
  fs.mkdirSync(fin, { recursive: true }); fs.mkdirSync(fout, { recursive: true });
  for (const [from, to] of [["c4_take-b80dc620_one_more_bowl.mp4", "c4.mp4"], ["c1_take-00767c8d.mp4", "c1.mp4"], ["short03_c1_take-0d77cb14_leak.mp4", "leak.mp4"]]) fs.copyFileSync(path.join(FX, from), path.join(fout, to));
  fs.copyFileSync(path.join(FX, "kuroe_voice_ref.wav"), path.join(fin, "kuroe.wav"));
  for (const n of ["maren", "liesl", "brann"]) fs.copyFileSync(path.join(VOICES, `${n}_voice_ref.wav`), path.join(fin, `${n}.wav`));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    await page.unroute(/\/(api\/)?prompt$/); // the GPU proof runs the real prompts (fwork rewrites them for the CPU server)
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.VoiceQAGPU", "this GPU, experts in RAM"); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const cast = {};
    for (const [n, d] of [["Kuroe", "a gaunt baron in a dark coat"], ["Maren", "a tall swordswoman"], ["Liesl", "a young village mother"], ["Brann", "an old headman"]])
      cast[n] = (await call("save_cast", { name: `${n} g17b`, details: d, voice: { file: `snap/g17bqa/${n.toLowerCase()}.wav`, casting: "" } })).cast;
    const book = (await call("create_book", { name: "G17b Voice QA", cast: [cast.Kuroe] })).book;
    const story = await page.evaluate(async ({ book, kuroe }) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body);
      return (await B.saveStory(st.id, { beats: [{ id: "b1", text: "Mio ladles broth into a white bowl." }, { id: "b2", text: "Kuroe pushes the empty bowl back.", lines: [{ who: kuroe, text: "One more bowl." }] }] }, { note: "g17b qa" })).ref; }, { book, kuroe: cast.Kuroe });
    const c1 = await call("add_cut", { book, scene_name: "G17b QA", beats: ["b1"], cast: [cast.Kuroe], seconds: 3.8 });
    const c4 = await call("add_cut", { book, scene: c1.scene, beats: ["b2"], cast: [cast.Kuroe], seconds: 4.5 });
    const seed = (id, file, extra) => page.evaluate(async ([id, file, extra]) => { await window.__T.save({ id, kind: "run", prompt_id: id, created: Date.now(), seconds: 60, group: `${id}-g`, number: 1, status: "success", text: "", seed: 1, verdict: null, notes: [],
      media: [{ kind: "video", filename: file, subfolder: "snaptest_g17bqa", type: "output" }], graph: {}, world: {}, prompt: {}, ...extra }); }, [id, file, extra]);
    const audio = (file) => ({ 1: { class_type: "LoadAudio", inputs: { audio: file } }, 2: { class_type: "H3Refs", inputs: { "ref_audios.audio1": ["1", 0] } } });
    await seed("take-g17bqa-leak", "leak.mp4", { text: "Maren walks toward the gate. Nobody speaks.", prompt: audio("snap/g17bqa/maren.wav") });
    await seed("take-g17bqa-c4", "c4.mp4", { prompt: audio("snap/g17bqa/kuroe.wav"), story: { book, ref: story, beat: "b2", unit: { scene: c4.scene, shot: c4.shot, cut: "C2" } } });
    await seed("take-g17bqa-c1", "c1.mp4", { story: { book, ref: story, beat: "b1", unit: { scene: c1.scene, shot: c1.shot, cut: "C1" } } });
    const wait = async (take) => { for (let i = 0; i < 600; i++) { const t = await call("get_take", { take }); if (t.voice && !t.voice.pending) return t.voice; await page.waitForTimeout(1000); } return null; };
    for (const [k, take] of [["leak", "take-g17bqa-leak"], ["c4", "take-g17bqa-c4"], ["c1", "take-g17bqa-c1"]]) { const t0 = Date.now(); R[`${k}Check`] = await call("check_voice", { take }); R[k] = await wait(take); R[`${k}Seconds`] = (Date.now() - t0) / 1000; }
    R.gpus = await (await fetch(`http://127.0.0.1:${port}/mainodes/snap/gpus`)).json();
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, line = S.c4?.qa?.lines?.[0], other = S.gpus?.gpus?.find((g) => g.uuid !== S.gpus.comfy);
  const checks = {
    "the leak (a silent cut citing Maren's voice): unscripted speech by Maren, status check (F-SQ11)": S.leak?.qa?.unscripted?.length > 0 && S.leak.qa.unscripted.some((u) => /Maren/.test(u.voice ?? "")) && S.leak.status === "check" && S.leak.qa.why?.some((w) => /^unscripted: /.test(w)),
    "C4's line from its story pin: ok by voice, Kuroe, margin above 0.08": line?.text === "One more bowl." && line.verdict === "ok" && /^Kuroe/.test(line.voice ?? "") && line.margin > 0.08,
    "C4's words in take seconds, in order, Nemotron exact against the line": (S.c4?.words ?? []).length >= 3 && S.c4.words.every((w, i, all) => w[0] <= w[1] && w[1] <= 4.5 && (!i || all[i - 1][0] <= w[0])) && S.c4.line_match?.said === "Nemotron exact",
    "the QA prompt was written in H3's dialogue grammar from the cut's line": S.c4Check?.qa?.prompt === "[Shot 1] <Audio 1> <d>One more bowl.</d>" && line?.expected === "Kuroe g17b",
    "four Cast voices as references, the voice model on (two or more)": S.c4Check?.qa?.speakers?.length === 4 && /WavLM-large ECAPA/.test(S.c4Check.qa.by_voice ?? ""),
    "a silent Book cut citing no voice is checked too: nothing unscripted, ok": S.c1Check?.queued === true && S.c1?.qa && S.c1.qa.unscripted.length === 0 && S.c1.status === "ok" && /no line: nobody should speak/.test(S.c1Check.qa.lines),
    "the QA ran where the setting says, named in the answer (ComfyUI's own card here, never GPU 1)": /on ComfyUI's own GPU with the experts in RAM \(the Voice QA setting\)/.test(S.c4Check?.words ?? "") && !!other,
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  console.log(JSON.stringify({ leak: S.leak?.qa, c4: { qa: S.c4?.qa, words: S.c4?.words, line_match: S.c4?.line_match, status: S.c4?.status }, c1: S.c1?.qa, seconds: [S.leakSeconds, S.c4Seconds, S.c1Seconds], checks: [S.leakCheck, S.c4Check, S.c1Check], crash: S.crash, errors: S.errors }, null, 1));
  console.log(`g17bvoiceqa ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
