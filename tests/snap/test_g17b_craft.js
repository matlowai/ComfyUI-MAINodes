// Batch G17b, prompt craft from the 2026-11-07 measurements (SNAP-R242, R243, R248, R250) on the CPU test server, with
// short05 v3's real footage (fixtures short05_v3: frames of C1, C3 and C4 as the board, key, plate and master):
// - apply_unit leaves the key drawing out of References on a cut without hold and the master out beside its camera
//   plate, each said with its measurement; compile_unit lists both in left_out; References are said as the prompt cites
//   them (F-SQ42);
// - set_unit {hold: true, cite_master: true} puts them in; the master beside the camera plate is an error in `errors`;
//   a key picture put back by hand on a cut without hold is an error in run's lint (the proposal's plan);
// - compile lints: the G17a test story's "Corvin holds like <Picture 4>" as an error look-alike cite (R243), a hit timed
//   "at the middle of the shot" (R250), one prop in two places (R250), a soundscape that opens on "a low hiss" (R248);
// - AGENT_START no longer tells agents to end a shot by citing a picture (M6).
// usage: node test_g17b_craft.js [port] [base]   prints "g17bcraft n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const FX = CFG.fixture("short05_v3");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g17bcraft-${Date.now()}`)); } };
const sh = (cmd, args) => new Promise((done) => execFile(cmd, args, { maxBuffer: 1 << 26 }, (e, o, err) => done({ code: e ? e.code ?? 1 : 0, out: String(o), err: String(err) })));
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "location", "production", "proposals.json"]) park(d); // moved, never deleted
  const fin = path.join(base, "input", "snap", "g17b");
  fs.mkdirSync(fin, { recursive: true });
  // real frames of short05 v3: C1's opening as the board, C3's burst as the key, C1's out-frame as the plate, C4 as the master
  for (const [clip, frame, name] of [["c1_take-00767c8d.mp4", 0, "board"], ["c3_take-6f3e2b88_boom.mp4", 60, "key"], ["c1_take-00767c8d.mp4", 89, "plate"], ["c4_take-b80dc620_one_more_bowl.mp4", 0, "master"]])
    await sh("ffmpeg", ["-v", "error", "-y", "-i", path.join(FX, clip), "-vf", `select=eq(n\\,${frame}),scale=1280:-2`, "-frames:v", "1", path.join(fin, `${name}.png`)]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const loc = (await call("save_location", { name: "Yatai g17b", master: { file: "snap/g17b/master.png" }, plates: [{ name: "P1 street", file: "snap/g17b/plate.png", role: "camera" }] }));
    R.loc = loc;
    const mio = (await call("save_cast", { name: "Mio g17b", details: "a young cook in a white headscarf" })).cast;
    const book = (await call("create_book", { name: "G17b Craft", cast: [mio] })).book;
    await page.evaluate(async ({ book }) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { beats: [{ id: "b1", text: "At the middle of the shot Mio slams the ladle down." }, { id: "b2", text: "Corvin waits." }] }, { note: "g17b craft" }); }, { book });
    const locRef = loc.ref ?? `location:${loc.id}`;
    const c1 = R.c1 = await call("add_cut", { book, scene_name: "G17b craft", beats: ["b1"], cast: [mio], location: locRef, plate: "P1 street", seconds: 3.8, sound: "the gas burner's low hiss under the pot, a ladle clinking" });
    const c2 = R.c2 = await call("add_cut", { book, scene: c1.scene, beats: ["b2"], cast: [mio], seconds: 3, camera: "ECU insert on Corvin's face", blocking: "Corvin holds like <Picture 4>, unbothered. The monocle in his left hand catches the light; the monocle hanging on his lapel swings." });
    R.board = await call("set_board", { scene: c1.scene, shot: c1.shot, file: "snap/g17b/board.png", approved: true });
    R.key = await call("set_board", { scene: c1.scene, shot: c1.shot, file: "snap/g17b/key.png", role: "key" });
    R.sheet1 = await call("compile_unit", { scene: c1.scene, shot: c1.shot });
    R.sheet2 = await call("compile_unit", { scene: c2.scene, shot: c2.shot });
    R.open1 = await call("open_shot", { scene: c1.scene, shot: c1.shot });
    R.apply1 = await call("apply_unit", { scene: c1.scene, shot: c1.shot });
    R.refs1 = (await call("describe_recipe", {}))?.references?.pictures ?? [];
    R.hold = await call("set_unit", { scene: c1.scene, shot: c1.shot, hold: true, cite_master: true });
    R.apply2 = await call("apply_unit", { scene: c1.scene, shot: c1.shot });
    R.refs2 = (await call("describe_recipe", {}))?.references?.pictures ?? [];
    // hold off again, the key put back by hand: run's lint (the proposal's plan, agents may not run) names it
    await call("set_unit", { scene: c1.scene, shot: c1.shot, hold: null, cite_master: null });
    R.apply3 = await call("apply_unit", { scene: c1.scene, shot: c1.shot });
    R.byHand = await call("add_ref", { file: "snap/g17b/key.png", role: "key: C1, the beat's peak" });
    await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false)); // run waits as a proposal: its plan carries the lint, nothing renders
    R.run = await call("run", { question: "g17b craft lint" });
    R.screen = path.join(CFG.out, "ui", "g17b"); fs.mkdirSync(R.screen, { recursive: true });
    await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); if (!snap.visible?.()) snap.toggle?.(); });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, said1 = (S.apply1?.said ?? []).join("\n"), lint1 = S.sheet1?.lint ?? [], lint2 = S.sheet2?.lint ?? [], role = (list, re) => list.some((p) => re.test(p.role ?? ""));
  const agent = fs.readFileSync(path.join(CFG.pack, "docs", "snap", "AGENT_START.md"), "utf8"), runLint = JSON.stringify(S.run ?? {});
  const checks = {
    "apply_unit leaves the key drawing out of a cut without hold, saying M6 (R242)": !role(S.refs1, /^key: /) && /the key drawing is left out of References: on an action cut H3 turns into a key picture by 1\.5-2\.5 s/.test(said1),
    "apply_unit leaves the master out beside the camera plate, saying M2/M7 (R242)": !role(S.refs1, /master \(place\)$/) && role(S.refs1, /plate P1 street \(camera\)$/) && /the location's master is left out of References: .*M2 13\/18/.test(said1),
    "compile_unit lists both in left_out": (S.sheet1?.left_out ?? []).some((x) => /^key: /.test(x.role)) && (S.sheet1?.left_out ?? []).some((x) => /master \(place\)$/.test(x.role)),
    "the said lines name References as the prompt cites them (F-SQ42)": /References as the prompt cites them: <Picture 1> board: C1, the cut opens on it; <Picture 2> location: Yatai g17b, plate P1 street \(camera\)/.test(said1) && !/as <Picture \d+>/.test((S.apply1?.said ?? []).find((x) => /^Yatai g17b/.test(x)) ?? ""),
    "no errors on what apply_unit put in": !S.apply1?.errors,
    "hold and cite_master put the key and the master in": role(S.refs2, /^key: C1/) && role(S.refs2, /master \(place\)$/) && /the key drawing is in References \(set_unit \{hold: true\}/.test((S.apply2?.said ?? []).join(" ")),
    "the master beside the camera plate is an error in apply_unit's errors (R242)": (S.apply2?.errors ?? []).some((e) => /^error: <Picture \d> \(Yatai g17b, master \(place\)\) is in References beside this cut's camera picture/.test(e)) && !(S.apply2?.errors ?? []).some((e) => /key drawing/.test(e)),
    "a key put back by hand on a cut without hold: run's lint says error (R242)": /error: <Picture \d> is a key drawing in References and this cut doesn't end on a held pose/.test(runLint),
    "the look-alike cite in the action is an error (R243; G17a's test story)": lint2.some((w) => /^error: the action cites a picture as a look-alike \("Corvin holds like <Picture 4>, unbothered\.", <Picture 4>\)/.test(w)),
    "one prop in two places is linted (R250)": lint2.some((w) => /puts the monocle in two places \("in his left hand" and "on his lapel"\)/.test(w)),
    "a hit timed by a place-word is linted (R250)": lint1.some((w) => /"At the middle of the shot Mio slams the ladle down\." times the action with a place-word/.test(w)),
    "a soundscape opening on a low hiss is linted (R248)": lint1.some((w) => /the soundscape opens on "the gas burner's low hiss under the pot": "hiss" is a steady or tonal source/.test(w)) && /soundscape opens on/.test(runLint),
    "AGENT_START no longer says to end a shot by citing a picture (M6)": !/end on a\s+picture by citing it as a reference/.test(agent) && /Citing a\s+picture as the ending does NOT work/.test(agent),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify({ ...R, sheet1: { lint: S.sheet1?.lint, left_out: S.sheet1?.left_out, error: S.sheet1?.error }, sheet2: { lint: S.sheet2?.lint, error: S.sheet2?.error } }, null, 1));
  console.log(`g17bcraft ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
