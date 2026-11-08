// Batch G17b, continuity across cuts on the CPU test server with short05 v3a2's real pair (fixtures short05_v3: C1 take-
// 00767c8d trimmed 0.125-3.75 s, C2 take-f2da44fb):
// - SNAP-R252: C2 follows C1 on the same plate with no opens_on: a lint says how to continue; set_unit {opens_on: {cut:
//   "C1"}} puts C1's active take at its out-point (frame 89, v3a2's own) first in the package and References as
//   "opening: C1's out-frame", C2's own board left out, the place pictures out, the hint "the first frame"; the frame is
//   the clip's own frame 89 (PSNR); a take made from C2 reads stale "its opening frame changed" after C1's trim moves
//   and after C1's active take changes; the critic packet of C2's take carries the continuity sentence; use_take
//   {as: "reference", role} names the frame's job (F-SQ49);
// - SNAP-R253: picking C1's take offers make_set_reference; make_set_reference {book, cut} lands its people-removed
//   candidates in a design lane beside the Book (not C1's shot); {pick} saves the still as plate "P1 street set" (side,
//   set: true, the camera plate's mark and pose) and names the cuts on that side; compile_unit lints C3, still on P1.
// usage: node test_g17b_continuity.js [port] [base]   prints "g17bcontinuity n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const FX = CFG.fixture("short05_v3");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g17bcont-${Date.now()}`)); } };
const sh = (cmd, args) => new Promise((done) => execFile(cmd, args, { maxBuffer: 1 << 26 }, (e, o, err) => done({ code: e ? e.code ?? 1 : 0, out: String(o), err: String(err) })));
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "location", "production", "proposals.json", "critiques"]) park(d); // moved, never deleted
  const fin = path.join(base, "input", "snap", "g17bc"), fout = path.join(base, "output", "snaptest_g17bc");
  fs.mkdirSync(fin, { recursive: true }); fs.mkdirSync(fout, { recursive: true });
  fs.copyFileSync(path.join(FX, "c1_take-00767c8d.mp4"), path.join(fout, "c1.mp4"));
  fs.copyFileSync(path.join(FX, "c2_take-f2da44fb.mp4"), path.join(fout, "c2.mp4"));
  fs.copyFileSync(path.join(FX, "c3_take-b02bee92_softer.mp4"), path.join(fout, "c1_other.mp4"));
  for (const [clip, frame, name] of [["c1_take-00767c8d.mp4", 0, "p1"], ["c2_take-f2da44fb.mp4", 0, "c2board"]])
    await sh("ffmpeg", ["-v", "error", "-y", "-i", path.join(FX, clip), "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", path.join(fin, `${name}.png`)]);
  await sh("ffmpeg", ["-v", "error", "-y", "-i", path.join(FX, "c1_take-00767c8d.mp4"), "-vf", "select=eq(n\\,89)", "-frames:v", "1", path.join(fout, "c1_f89_ffmpeg.png")]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const loc = await call("save_location", { name: "Yatai g17bc", cameras: [{ name: "street", x: 0.5, y: 0.8, heading: 0, eye_height: 1.5, lens: 35 }], plates: [{ name: "P1 street", file: "snap/g17bc/p1.png", role: "camera", camera: "street", pose: { x: 0.5, y: 0.8, heading: 0, eye_height: 1.5, lens: 35 } }] });
    const locRef = loc.ref ?? `location:${loc.id}`;
    const mio = (await call("save_cast", { name: "Mio g17bc", details: "a young cook in a white headscarf" })).cast;
    const book = R.book = (await call("create_book", { name: "G17b Continuity", cast: [mio] })).book;
    await page.evaluate(async ({ book }) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { beats: [{ id: "b1", text: "Mio ladles steaming broth into a white bowl." }, { id: "b2", text: "Mio sets the full bowl down on the counter." }, { id: "b3", text: "Mio wipes the counter." }] }, { note: "g17b continuity" }); }, { book });
    const c1 = await call("add_cut", { book, scene_name: "G17b continuity", beats: ["b1"], cast: [mio], location: locRef, plate: "P1 street", seconds: 3.8 });
    const c2 = await call("add_cut", { book, scene: c1.scene, beats: ["b2"], cast: [mio], location: locRef, plate: "P1 street", seconds: 4.5 });
    const c3 = await call("add_cut", { book, scene: c1.scene, beats: ["b3"], cast: [mio], location: locRef, plate: "P1 street", seconds: 3 });
    await call("set_board", { scene: c2.scene, shot: c2.shot, file: "snap/g17bc/c2board.png", approved: true });
    const seed = (id, file, shotOf, group) => page.evaluate(async ([id, file, scene, shot, group]) => {
      await window.__T.save({ id, kind: "run", prompt_id: id, created: Date.now(), seconds: 60, group, number: 6, status: "success", text: "Mio ladles broth", seed: 7101, verdict: "keep", notes: [], media: [{ kind: "video", filename: file, subfolder: "snaptest_g17bc", type: "output" }], graph: {}, world: {}, prompt: {} });
      await window.__SC.addGroup(scene, shot, group); }, [id, file, shotOf.scene, shotOf.shot, group]);
    await seed("take-g17bc-c1", "c1.mp4", c1, "g17bc-c1"); await seed("take-g17bc-c1b", "c1_other.mp4", c1, "g17bc-c1b");
    R.pick = await call("set_active_take", { scene: c1.scene, shot: c1.shot, take: "take-g17bc-c1" });
    await call("set_unit", { scene: c1.scene, shot: c1.shot, trim: { in_s: 0.125, out_s: 3.75, gain_db: 15 } });
    R.before = await call("compile_unit", { scene: c2.scene, shot: c2.shot });
    R.opens = await call("set_unit", { scene: c2.scene, shot: c2.shot, opens_on: { cut: "C1" } });
    R.sheet = await call("compile_unit", { scene: c2.scene, shot: c2.shot });
    R.open2 = await call("open_shot", { scene: c2.scene, shot: c2.shot });
    R.apply = await call("apply_unit", { scene: c2.scene, shot: c2.shot });
    R.refs = (await call("describe_recipe", {}))?.references?.pictures ?? [];
    // a take made from C2's compile (its graph carries the story pin)
    await page.evaluate(async () => { const g = app.graph.serialize(); await window.__T.save({ id: "take-g17bc-c2", kind: "run", prompt_id: "g17bc-c2", created: Date.now(), seconds: 60, group: g.id, number: 1, status: "success", text: "g17bc", seed: 1, media: [{ kind: "video", filename: "c2.mp4", subfolder: "snaptest_g17bc", type: "output" }], verdict: "keep", notes: [], prompt: {}, graph: g, story: g.extra.snap.story, world: g.extra.snap.world ?? {} }); });
    R.stale0 = (await call("story_stale", { book }))?.stale?.find((x) => x.take === "take-g17bc-c2") ?? null;
    await call("set_unit", { scene: c1.scene, shot: c1.shot, trim: { in_s: 0.125, out_s: 3.5, gain_db: 15 } });
    R.staleTrim = (await call("story_stale", { book }))?.stale?.find((x) => x.take === "take-g17bc-c2") ?? null;
    await call("set_unit", { scene: c1.scene, shot: c1.shot, trim: { in_s: 0.125, out_s: 3.75, gain_db: 15 } });
    R.staleBack = (await call("story_stale", { book }))?.stale?.find((x) => x.take === "take-g17bc-c2") ?? null;
    await call("set_active_take", { scene: c1.scene, shot: c1.shot, take: "take-g17bc-c1b" });
    R.staleTake = (await call("story_stale", { book }))?.stale?.find((x) => x.take === "take-g17bc-c2") ?? null;
    await call("set_active_take", { scene: c1.scene, shot: c1.shot, take: "take-g17bc-c1" });
    // the critic packet of C2's take: the continuity sentence
    R.packet = await page.evaluate(async () => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); await CR.forTake(window.__T.get("take-g17bc-c2"), { trigger: "test" }).catch(() => null); await CR.load(); return CR.all().find((r) => r.subject?.take === "take-g17bc-c2")?.id ?? null; });
    R.words = R.packet && (await call("critique_packet", { critique: R.packet, part: "context", limit: 1 }))?.words;
    // F-SQ49: a hand-pulled frame says its job
    R.useRole = await call("use_take", { take: "take-g17bc-c1", as: "reference", frame: 88, role: "opening: C1's out-frame (by hand)" });
    R.refsUse = (await call("describe_recipe", {}))?.references?.pictures ?? [];
    // ---- SNAP-R253: the set reference for side "street" from C1's look ----
    R.make = await call("make_set_reference", { book, cut: "C1", count: 2 });
    for (let i = 0; i < 120 && !R.cand; i++) { const d = await page.evaluate((id) => window.__C.get(id), R.make.decision); R.cand = d?.candidates?.find((c) => c.state === "ready" || c.pictures?.length); if (!R.cand) await page.waitForTimeout(1000); }
    R.candTake = R.make.candidates?.[0]?.take;
    for (let i = 0; i < 120 && !(await page.evaluate((t) => !!window.__T.get(t), R.candTake)); i++) await page.waitForTimeout(1000);
    R.saved = await call("make_set_reference", { book, cut: "C1", pick: R.candTake });
    R.loc2 = await page.evaluate(async (ref) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); const r = W.record("location", W.parse(ref).id); return W.headOf(r).body.plates; }, locRef);
    R.sheet3 = await call("compile_unit", { scene: c3.scene, shot: c3.shot });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const op = R.sheet?.opening, mf = op?.file && path.join(base, "input", op.file);
  if (mf && fs.existsSync(mf)) { const p = await sh("ffmpeg", ["-v", "info", "-i", mf, "-i", path.join(fout, "c1_f89_ffmpeg.png"), "-lavfi", "psnr", "-f", "null", "-"]); R.psnr = Number((p.err.match(/average:([\d.]+|inf)/) ?? [])[1]?.replace("inf", "99")); }
  const S = R, said = (S.apply?.said ?? []).join("\n"), set = (S.loc2 ?? []).find((p) => p.name === "P1 street set");
  const checks = {
    "C2 on C1's plate with no opens_on: a lint says how to continue (R252)": (S.before?.lint ?? []).some((w) => /C2 follows C1 on the same plate \(P1 street\): if it continues C1's action, set_unit \{opens_on: \{cut: "C1"\}\}/.test(w)),
    "opens_on resolves C1's out-point 3.75 s to frame 89 of its active take": op?.cut === "C1" && op.take === "take-g17bc-c1" && op.frame === 89 && /out 3\.75 s/.test(op.at),
    "the opening frame is the clip's own frame 89 (PSNR > 35 dB)": S.psnr > 35,
    "the package opens on it; C2's own board is left out, said": S.sheet?.package?.[0]?.role === "opening: C1's out-frame (take 6, frame 89)" && !(S.sheet.package ?? []).some((p) => /^board: /.test(p.role)) && (S.sheet.left_out ?? []).some((x) => /^board: C2/.test(x.role)),
    "apply_unit puts it first in References, the place pictures out, the board out": S.refs[0]?.role === "opening: C1's out-frame" && !S.refs.some((p) => /^location: |^board: /.test(p.role ?? "")) && /opens on C1's out-frame \(take 6, frame 89, out 3\.75 s\)/.test(said) && /the location's pictures are left out: C1's out-frame holds the set/.test(said),
    "the prompt cites it as the first frame": /<Picture 1> is the first frame: the shot opens exactly on it and keeps its camera, framing, set and light\./.test(S.apply?.prompt ?? ""),
    "a take from C2 isn't stale until C1 moves": !S.stale0,
    "C1's trim moving makes it stale: its opening frame changed": (S.staleTrim?.reasons ?? []).some((r) => /^its opening frame changed \(C1's active take or trim moved\)/.test(r)) && !S.staleBack,
    "C1's active take changing makes it stale too": (S.staleTake?.reasons ?? []).some((r) => /^its opening frame changed/.test(r)),
    "the critic packet carries the continuity sentence": /^C2 continues C1's action \(opens_on, SNAP-R252\): its frame 0 should equal C1's active take at its trim out-point/.test(S.words?.continuity ?? ""),
    "use_take as reference takes the frame's role (F-SQ49)": /a reference picture, <Picture \d+>/.test(S.useRole?.said ?? "") && (S.refsUse ?? []).some((p) => p.role === "opening: C1's out-frame (by hand)"),
    "picking C1's take offers make_set_reference (R253)": /side street of Yatai g17bc has no set reference yet: .*make_set_reference \{book: "book:[^"]+", cut: "C1"\}/.test(S.pick?.set_reference ?? ""),
    "make_set_reference lands its candidates in a design lane beside the Book, not C1's shot": !!S.make?.decision && S.make.candidates?.length === 2 && /G17b Continuity · set references/.test(S.make.lands ?? "") && /Yatai g17bc · street/.test(S.make.lands ?? "") && S.make.from?.frame === 89,
    "the pick is saved as the side's set plate with the camera mark and pose": set?.set === true && set.side === "street" && set.camera === "street" && set.pose?.eye_height === 1.5 && set.role === "camera" && S.saved?.plate === "P1 street set" && /: C3: set_unit \{plate: "P1 street set"\}/.test(S.saved?.next ?? ""),
    "the walkthrough plate stays": (S.loc2 ?? []).some((p) => p.name === "P1 street" && !p.set),
    "compile_unit lints a cut on the side that doesn't play from its set reference": (S.sheet3?.lint ?? []).some((w) => /plate P1 street is on side street, and P1 street set is that side's set reference .*set_unit \{plate: "P1 street set"\}/.test(w)),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify(R, null, 1));
  console.log(`g17bcontinuity ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
