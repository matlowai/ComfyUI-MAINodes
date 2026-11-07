// Batch G16 S10, words timed in Snap (SNAP-R227), a GPU proof on the builders' GPU server (SNAP_TEST_GPU_PORT and
// SNAP_TEST_GPU_BASE, a base whose models/audio_encoders has whisper_large_v3.safetensors linked to the Hugging Face
// snapshot; skipped, said, without them) and, with SNAP_TEST_ASTRID_LAUNCHER/_ROOT, through to Astrid:
// - a speaking cut (Maren: "It's you." on its beat) whose take carries a real line read (the lab's C3 dialogue) and cites
//   Maren's voice; check_voice times its words in the same prompt as the voice note: voice.words [[start, end, word]],
//   voice.text and voice.line_match (exact: "It's you.");
// - export_cut puts the words on the dialogue clip (app.astrid.words), and after tools/astrid_push.py push, Astrid's
//   `timelines words --published` lists them on that clip.
// usage: node test_g16_words.js   prints "g16words n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.env.SNAP_TEST_GPU_PORT, base = process.env.SNAP_TEST_GPU_BASE, R = {};
const LAUNCHER = process.env.SNAP_TEST_ASTRID_LAUNCHER, ROOT = process.env.SNAP_TEST_ASTRID_ROOT, LAB = LAUNCHER && path.dirname(path.dirname(LAUNCHER));
const PUSH = path.join(CFG.pack, "tools", "astrid_push.py");
const run = (cmd, args, env = {}) => new Promise((done) => { const p = spawn(cmd, args, { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } }); let out = "", err = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; }); p.on("close", (code) => done({ code, out, err })); });
const json = (r) => { try { return JSON.parse(r.out.slice(r.out.indexOf("{"))); } catch { return { unparsed: r.out + r.err }; } };
const ZIP = "import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps(json.loads(z.read('timeline.json'))['parent']['clips']))";
(async () => {
  if (!(port && base && fs.existsSync(path.join(base, "models", "audio_encoders", "whisper_large_v3.safetensors")))) { console.log("SKIP SNAP_TEST_GPU_PORT / SNAP_TEST_GPU_BASE unset, or no whisper_large_v3.safetensors in its audio_encoders"); console.log("g16words 0/0 (skipped)"); return; }
  const fin = path.join(base, "input", "snap", "g16words"), fout = path.join(base, "output", "snaptest_g16words");
  fs.mkdirSync(fin, { recursive: true }); fs.mkdirSync(fout, { recursive: true });
  // the lab's real line read ("It's you.") from the A3 archive, as a take with picture and sound; Maren's voice reference
  await run("python3", ["-I", "-c", "import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1]);m=json.loads(z.read('manifest.json'))\nw=[x for x in m['media'] if x['media_type'].startswith('audio')][0]\nopen(sys.argv[2],'wb').write(z.read('media/'+w['sha256']))", path.join(LAB ?? "", "fixtures", "protocol-v1", "probe-a3.astrid"), path.join(fout, "c3_line.wav")]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x333344:s=320x176:rate=24", "-i", path.join(fout, "c3_line.wav"), "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(fout, "C3_line.mp4")]);
  await run("ffmpeg", ["-v", "error", "-y", "-i", path.join(fout, "c3_line.wav"), "-ar", "48000", "-ac", "1", path.join(fin, "maren_voice.wav")]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    await page.unroute(/\/(api\/)?prompt$/); // the GPU proof runs the real prompts (fwork rewrites them for the CPU server)
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const client = await page.evaluate(async () => (await import("/scripts/api.js")).api.clientId);
    if (LAUNCHER) await page.evaluate(async ([l, r]) => { await app.extensionManager.setting.set("MAINodes.Snap.AstridLauncher", l); await app.extensionManager.setting.set("MAINodes.Snap.AstridDataRoot", r); }, [LAUNCHER, ROOT]);
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const cast = (await call("save_cast", { name: "Maren", details: "a tall swordswoman", voice: { file: "snap/g16words/maren_voice.wav", casting: "low, hushed" } })).cast;
    const series = (await call("create_production", { name: "G16 Words", astrid_project: R.slug = `g16-words-${Date.now().toString(36)}` })).production;
    const book = (await call("create_book", { name: "G16 Words", production: series, cast: [cast] })).book;
    const story = await page.evaluate(async ({ book, cast }) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body);
      const out = await B.saveStory(st.id, { beats: [{ id: "b1", text: "She sees him.", lines: [{ who: cast, text: "It's you." }] }] }, { note: "g16 words" }); return out.ref; }, { book, cast });
    const cut = await call("add_cut", { book, scene_name: "G16 words", beats: ["b1"], cast: [cast], seconds: 3 });
    await page.evaluate(async ({ cut, cast, book, story }) => {
      await window.__T.save({ id: "take-g16w1", kind: "run", prompt_id: "g16w1", created: Date.now(), seconds: 60, group: "g16w-1", number: 1, status: "success", text: "It's you.", seed: 1, verdict: "keep", notes: [],
        media: [{ kind: "video", filename: "C3_line.mp4", subfolder: "snaptest_g16words", type: "output" }], graph: {}, world: { [cast]: { n: 1, name: "Maren" } },
        prompt: { 1: { class_type: "LoadAudio", inputs: { audio: "snap/g16words/maren_voice.wav" } }, 2: { class_type: "H3Refs", inputs: { "ref_audios.audio1": ["1", 0] } } },
        story: { book, ref: story, beat: "b1", unit: { scene: cut.scene, shot: cut.shot, cut: cut.cut } } });
      await window.__SC.addGroup(cut.scene, cut.shot, "g16w-1"); await window.__SC.setActive(cut.scene, cut.shot, "take-g16w1", "person");
    }, { cut, cast, book, story });
    R.check = await call("check_voice", { take: "take-g16w1" });
    for (let i = 0; i < 240 && !R.voice; i++) { const t = await call("get_take", { take: "take-g16w1" }); if (t.voice && !t.voice.pending) R.voice = t.voice; else await page.waitForTimeout(1000); }
    R.cut = await call("export_cut", { book, mp4: false });
    if (R.cut?.otio?.astrid?.archive) R.clips = JSON.parse((await run("python3", ["-I", "-c", ZIP, R.cut.otio.astrid.archive])).out);
    if (LAUNCHER) {
      R.push = json(await run("python3", ["-I", PUSH, "push", "--book", book, "--page", client, "--archive", R.cut.otio.astrid.archive], { SNAP_BASE: `http://127.0.0.1:${port}`, SNAP_AGENT: "astrid-g16w" }));
      if (R.push?.timeline) R.words = await run(LAUNCHER, ["astrid", "timelines", "words", R.push.timeline.timeline_id, "--project", R.slug, "--published"], { ASTRID_RUNTIME_DATA_ROOT: ROOT });
    }
    await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.AstridLauncher", "")); // later suites' exports don't probe
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, dlg = (S.clips ?? []).find((c) => c.id === "C1-dialogue"), heard = (S.voice?.words ?? []).map((w) => w[2]).join(" ");
  const checks = {
    "check_voice says the words are timed by the Whisper": /timed by whisper_large_v3\.safetensors/.test(S.check?.words ?? ""),
    "the take's words come back with their times, in order": /it's you/i.test(heard) && (S.voice?.words ?? []).every((w, i, all) => w[0] <= w[1] && (!i || all[i - 1][0] <= w[0])),
    "line_match: Whisper exact against the cut's line": S.voice?.line_match?.exact === true && S.voice.line_match.line === "It's you.",
    "the voice note itself still runs beside it": ["ok", "check", "no voice"].includes(S.voice?.status),
    "the export puts the words on the dialogue clip": (S.voice?.words?.length ?? 0) > 0 && JSON.stringify(dlg?.app?.astrid?.words) === JSON.stringify(S.voice?.words) && dlg.app.astrid.text === "It's you.",
    [`Astrid's timelines words lists them after a push${LAUNCHER ? "" : " (skipped: SNAP_TEST_ASTRID_LAUNCHER unset)"}`]: !LAUNCHER || (S.push?.ok === true && /It's/.test(S.words?.out ?? "") && /line-C1/.test(S.words?.out ?? "")),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify(R, null, 1));
  else console.log(JSON.stringify({ words: S.voice.words, text: S.voice.text, line_match: S.voice.line_match, astrid: S.words?.out }, null, 1));
  console.log(`g16words ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
