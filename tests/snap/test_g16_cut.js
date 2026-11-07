// Batch G16 S1, archive v2 (SNAP-R215, R216), on the CPU test server: a 3-cut Book in a production, C1 silent with its
// sound at -6 dB, C2 a speaking cut (Maren's line on its beat, words on its take's voice note), C3 a private take:
// - every clip's id is its cut id; C1's sound is a linear volume (10^(-6/20)); C2 is split: the picture at volume 0 and
//   C2-dialogue on A2 "Dialogue" with the take's own 48 kHz sound, label "Maren: It's you.", app.astrid {segment, text,
//   words} and generation.snap {take, audio_of, speaker, line, voice_reference}; every clip names its scene group;
// - tracks V1, A1, A2 in that order; no app.astrid.cut, chapters, placements or shots; the private take adds nothing;
// - the import command names the production's Astrid project, not a placeholder;
// - with Astrid set up (SNAP_TEST_ASTRID_LAUNCHER and SNAP_TEST_ASTRID_ROOT: the person's settings), the archive is
//   imported and trimmed in Astrid's scratch project before the answer (probe ok); with the launcher setting empty the
//   archive is still written and the answer says the probe didn't run; Astrid's own preflight accepts it
//   (SNAP_TEST_ASTRID_PY / _VALIDATE); without those variables the Astrid checks are skipped (said).
// usage: node test_g16_cut.js [port] [base]   prints "g16cut n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), crypto = require("crypto"), { execFile } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const D = CFG.fixture("short04");
const LAUNCHER = process.env.SNAP_TEST_ASTRID_LAUNCHER, ROOT = process.env.SNAP_TEST_ASTRID_ROOT, APY = process.env.SNAP_TEST_ASTRID_PY, AVAL = process.env.SNAP_TEST_ASTRID_VALIDATE;
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g16cut-${Date.now()}`)); } };
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const sh = (cmd, args, opts = {}) => new Promise((done) => execFile(cmd, args, { maxBuffer: 1 << 26, ...opts }, (e, out, err) => done({ code: e ? e.code ?? 1 : 0, out: String(out), err: String(err) })));
const ZIP = "import json,sys,zipfile,hashlib\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({'entries':[{'name':i.filename,'stored':i.compress_type==zipfile.ZIP_STORED,'sha':hashlib.sha256(z.read(i)).hexdigest()} for i in z.infolist()],'manifest':json.loads(z.read('manifest.json')),'timeline':json.loads(z.read('timeline.json'))}))";
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "production", "proposals.json"]) park(d); // moved, never deleted
  const fout = path.join(base, "output", "snaptest_g16cut");
  fs.mkdirSync(fout, { recursive: true });
  for (const f of ["C1_pick.mp4", "C2_pick.mp4"]) fs.copyFileSync(path.join(D, "cuts", f), path.join(fout, f));
  fs.mkdirSync(path.join(base, "input", "snap", "voice"), { recursive: true });
  await sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=3", "-ar", "48000", path.join(base, "input", "snap", "voice", "maren_g16.wav")]);
  await sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x176:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(fout, "C3_private.mp4")]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const setting = (id, v) => page.evaluate(([i, x]) => app.extensionManager.setting.set(i, x), [id, v]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    await setting("MAINodes.Snap.AstridLauncher", LAUNCHER ?? ""); await setting("MAINodes.Snap.AstridDataRoot", ROOT ?? "");
    const cast = (await call("save_cast", { name: "Maren", details: "a tall swordswoman", voice: { file: "snap/voice/maren_g16.wav", casting: "low, hushed" } })).cast;
    const series = (await call("create_production", { name: "G16 Cut Series", astrid_project: "g16-cut-series" })).production;
    const book = (await call("create_book", { name: "G16 Cut", production: series, cast: [cast] })).book;
    // the story as the person saved it: b2 carries Maren's line; one scene group over every beat
    await page.evaluate(async ({ book, cast }) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { beats: [{ id: "b1", text: "Maren comes to the gate." }, { id: "b2", text: "She sees him.", lines: [{ who: cast, text: "It's you." }] }, { id: "b3", text: "The gate shuts." }], groups: [{ id: "g1", name: "At the gate", beats: ["b1", "b2", "b3"] }] }, { note: "g16 story" }); }, { book, cast });
    const c1 = await call("add_cut", { book, scene_name: "G16 gate", beats: ["b1"], cast: [cast], seconds: 3 });
    const c2 = await call("add_cut", { book, scene: c1.scene, beats: ["b2"], cast: [cast], seconds: 3 });
    const c3 = await call("add_cut", { book, scene: c1.scene, beats: ["b3"], cast: [cast], seconds: 2 });
    R.words = [[1.2, 1.4, "It's"], [1.4, 1.8, "you."]];
    await page.evaluate(async ({ c1, c2, c3, cast, words }) => {
      const T = window.__T, SC = window.__SC;
      const mk = async (id, file, group, extra = {}) => { await T.save({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 60, group, number: 1, status: "success", text: id, seed: 1, media: [{ kind: "video", filename: file, subfolder: "snaptest_g16cut", type: "output" }], verdict: "keep", notes: [], prompt: {}, graph: {}, world: { [cast]: { n: 1, name: "Maren" } }, ...extra }); return id; };
      await mk("take-g16c1", "C1_pick.mp4", "g16-c1");
      await mk("take-g16c2", "C2_pick.mp4", "g16-c2", { voice: { status: "ok", words } });
      await mk("take-g16c3", "C3_private.mp4", "g16-c3", { private: true });
      for (const [c, t, g] of [[c1, "take-g16c1", "g16-c1"], [c2, "take-g16c2", "g16-c2"], [c3, "take-g16c3", "g16-c3"]]) { await SC.addGroup(c.scene, c.shot, g); await SC.setActive(c.scene, c.shot, t, "person"); }
    }, { c1, c2, c3, cast, words: R.words });
    await call("set_unit", { scene: c1.scene, shot: c1.shot, trim: { in_s: 0.5, gain_db: -6 } });
    R.cut = await call("export_cut", { book, otio: true });
    R.ax = R.cut.otio?.astrid;
    // the launcher setting empty: the archive is written and the answer says nobody checked it
    await setting("MAINodes.Snap.AstridLauncher", "");
    R.unset = (await page.evaluate((book) => import("/extensions/ComfyUI-MAINodes/snap/book.js").then((B) => B.otio(book)).catch((e) => ({ error: e.message })), book))?.astrid;
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  if (R.ax?.archive && fs.existsSync(R.ax.archive)) R.zip = JSON.parse((await sh("python3", ["-I", "-c", ZIP, R.ax.archive])).out);
  if (APY && AVAL && R.ax?.archive) { const v = await sh(APY, ["-I", AVAL, R.ax.archive], { cwd: path.dirname(AVAL) }); try { R.astrid = JSON.parse(v.out); } catch { R.astrid = { ok: false, out: v.out + v.err }; } }
  const S = R, tl = S.zip?.timeline?.parent, m = S.zip?.manifest, clip = (id) => tl?.clips?.find((c) => c.id === id), dlg = clip("C2-dialogue");
  const wav = m?.media?.find((x) => x.media_type === "audio/x-wav"), files = { c3: sha(path.join(base, "output", "snaptest_g16cut", "C3_private.mp4")) };
  const astridSet = LAUNCHER && ROOT;
  const checks = {
    "every picture clip's id is its cut id": tl && JSON.stringify(tl.clips.filter((c) => c.track === "V1").map((c) => c.id)) === JSON.stringify(["C1", "C2"]),
    "C1's gain_db -6 is the clip's linear volume": Math.abs((clip("C1")?.volume ?? 0) - 10 ** (-6 / 20)) < 1e-3 && clip("C1")?.from === 0.5,
    "C2 is split: the picture plays at volume 0 and its sound is C2-dialogue on A2 at the same place": clip("C2")?.volume === 0 && dlg?.track === "A2" && dlg.at === clip("C2").at && dlg.from === clip("C2").from && dlg.to === clip("C2").to && dlg.asset === "take-g16c2-sound",
    "the dialogue clip is labelled with the line and carries app.astrid {segment, text, words}": dlg?.label === "Maren: It's you." && dlg.app?.astrid?.segment === "line-C2" && dlg.app.astrid.text === "It's you." && JSON.stringify(dlg.app.astrid.words) === JSON.stringify(S.words),
    "its generation.snap names the take, the cut it sounds, the speaker, the line and the voice reference": (() => { const g = dlg?.generation?.snap; return g?.take === "take-g16c2" && g.audio_of === "C2" && g.speaker === "Maren" && g.line === "It's you." && g.voice_reference === "snap/voice/maren_g16.wav"; })(),
    "the take's own sound is in the archive as a 48 kHz wav asset": !!wav && tl.registry.assets["take-g16c2-sound"]?.media_id === `sha256:${wav.sha256}` && tl.registry.assets["take-g16c2-sound"].type === "audio",
    "every clip names its scene group": tl?.clips.filter((c) => c.track === "V1").every((c) => c.generation.snap.group === "At the gate"),
    "tracks V1, A1, A2 in that order; parent mirrors equal": JSON.stringify(tl?.config.tracks.map((t) => t.id)) === JSON.stringify(["V1", "A1", "A2"]) && tl.config.tracks[2].label === "Dialogue" && JSON.stringify(tl.clips) === JSON.stringify(tl.config.clips),
    "no cut idiom, chapters, placements or shots": !!tl && !JSON.stringify(tl).includes('"cut":{') && !tl.config.app && !tl.clips.some((c) => c.app?.astrid?.cut) && JSON.stringify(S.zip.timeline.placements) === "[]" && JSON.stringify(S.zip.timeline.shots) === "{}",
    "the private take adds no clip and no bytes": !!S.zip && !S.zip.entries.some((e) => e.sha === files.c3) && !tl.clips.some((c) => c.asset === "take-g16c3") && S.ax.left_out?.[0]?.cut === "C3",
    "the import command names the production's Astrid project": / --project g16-cut-series --name /.test(S.ax?.import ?? ""),
    [`R215 the archive was imported and trimmed in Astrid before the answer${astridSet ? "" : " (skipped: SNAP_TEST_ASTRID_LAUNCHER / _ROOT unset)"}`]: !astridSet || (S.ax?.probe?.ok === true && S.ax.probe.stage === "done" && S.ax.probe.project === "snap-probe" && S.ax.probe.clip === "C1"),
    "R215 with the launcher setting empty the archive is written and the answer says the probe didn't run": S.unset?.probe?.ran === false && /Astrid isn't set up on this machine/.test(S.unset.probe.said) && fs.existsSync(S.unset.archive ?? ""),
    [`Astrid's own import preflight accepts it${APY && AVAL ? "" : " (skipped: SNAP_TEST_ASTRID_PY / _VALIDATE unset)"}`]: !(APY && AVAL) || (S.astrid?.ok === true && S.astrid.clips === 3 && S.astrid.media === 3),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify({ ...R, zip: R.zip && { entries: R.zip.entries, manifest: R.zip.manifest, clips: R.zip.timeline?.parent?.clips, tracks: R.zip.timeline?.parent?.config?.tracks } }, null, 1));
  console.log(`g16cut ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
