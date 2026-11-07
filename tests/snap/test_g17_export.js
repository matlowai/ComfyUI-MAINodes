// Batch G17a, the Cut's export carries each clip's dial rows in the take's seconds (SNAP-R233), and a re-take takes the
// cut's rows as they stand (SNAP-R234), on the CPU test server with the seq02 bake-off's dramatic-light clash w05 (its
// real take record and graph: dramatic light 3.0, keys (0,0)(0.6,0.2)(1.6,1)(5.17,1), steps 6, protect, Ref2V):
// - export_cut: the archive's timeline.json clip C1 has generation.snap.dials {pipeline ref2v, clip_seconds = the
//   take's length, rows [{dial, strength, on, curve {interp, smooth, keys in seconds}, steps, audio}]} and the .otio
//   clip's metadata.snap.dials says the same; C1 is trimmed (in_s 0.5) and its keys stay in the take's seconds, the
//   clock of its words; C2's rows were normalized (a hand-set rack) and come out in seconds by the take's length, with
//   the rack's own defaults (steps 2, audio follow) and a constant row as curve null; C3 ran no dials and has none;
// - the take's rows adopted into the cut's plan (retake open_only restores the recipe, set_cut_dials from_rack), a key
//   moved onto a word time, then retake {dials: "cut", open_only: true} puts the moved key on the rack and queues
//   nothing; the answer names the key it moved;
// - Astrid's own import preflight accepts the archive (SNAP_TEST_ASTRID_PY / _VALIDATE; skipped, said, without them).
// usage: node test_g17_export.js [port] [base]   prints "g17export n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const FX = CFG.fixture("seq02_bakeoff"), APY = process.env.SNAP_TEST_ASTRID_PY, AVAL = process.env.SNAP_TEST_ASTRID_VALIDATE;
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g17export-${Date.now()}`)); } };
const sh = (cmd, args, opts = {}) => new Promise((done) => execFile(cmd, args, { maxBuffer: 1 << 26, ...opts }, (e, o, err) => done({ code: e ? e.code ?? 1 : 0, out: String(o), err: String(err) })));
const ZIP = "import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps(json.loads(z.read('timeline.json'))))";
const LIGHT = "dials/h3_light_dramatic_v2_hook.safetensors", PSY = "dials/h3_psychedelic_hook.safetensors";
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "production", "proposals.json"]) park(d); // moved, never deleted
  const fout = path.join(base, "output", "snaptest_g17x");
  fs.mkdirSync(fout, { recursive: true });
  fs.copyFileSync(path.join(FX, "w05_dramatic_light.mp4"), path.join(fout, "w05.mp4"));
  const w05 = JSON.parse(fs.readFileSync(path.join(FX, "w05_take.json"), "utf8"));
  R.length = Number((await sh("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(fout, "w05.mp4")])).out.trim());
  // C2's take: the same clip run from a hand-set rack (normalized keys, the rack's defaults left out, plus a constant row)
  R.ran = JSON.parse(w05.graph.nodes.find((n) => n.type === "MAIDialRack").widgets_values[0]);
  const hand = structuredClone(w05.graph), rackNode = hand.nodes.find((n) => n.type === "MAIDialRack");
  rackNode.widgets_values[0] = JSON.stringify([{ on: true, dial: PSY, strength: 2.5, solo: false, time: { type: "keys", points: [[0, 0], [0.5, 1]] } }, { on: true, dial: LIGHT, strength: 1, solo: false }]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); await app.extensionManager.setting.set("MAINodes.Snap.AstridLauncher", ""); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const book = (await call("create_book", { name: "G17 Export" })).book;
    await page.evaluate(async ({ book }) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { beats: [{ id: "b1", text: "The beam meets the palm." }, { id: "b2", text: "The ward flares." }, { id: "b3", text: "Dust settles." }], groups: [{ id: "g1", name: "The clash", beats: ["b1", "b2", "b3"] }] }, { note: "g17 export story" }); }, { book });
    const c1 = await call("add_cut", { book, scene_name: "G17 export", beats: ["b1"], seconds: 5 });
    const c2 = await call("add_cut", { book, scene: c1.scene, beats: ["b2"], seconds: 5 });
    const c3 = await call("add_cut", { book, scene: c1.scene, beats: ["b3"], seconds: 5 });
    await page.evaluate(async ({ c1, c2, c3, take, hand }) => { const T = window.__T, SC = window.__SC, media = [{ kind: "video", filename: "w05.mp4", subfolder: "snaptest_g17x", type: "output" }];
      await T.save({ ...take, id: "take-g17x1", prompt_id: "g17x1", group: "g17x-1", media, notes: [] });
      await T.save({ ...take, id: "take-g17x2", prompt_id: "g17x2", group: "g17x-2", media, notes: [], graph: { ...hand, id: "g17x-2" } });
      await T.save({ id: "take-g17x3", kind: "run", prompt_id: "g17x3", created: Date.now(), seconds: 60, group: "g17x-3", number: 1, status: "success", text: "no dials", seed: 1, media, verdict: "keep", notes: [], prompt: {}, graph: {} });
      for (const [c, t, g] of [[c1, "take-g17x1", "g17x-1"], [c2, "take-g17x2", "g17x-2"], [c3, "take-g17x3", "g17x-3"]]) { await SC.addGroup(c.scene, c.shot, g); await SC.setActive(c.scene, c.shot, t, "person"); } }, { c1, c2, c3, take: w05, hand });
    await call("set_unit", { scene: c1.scene, shot: c1.shot, trim: { in_s: 0.5 } });
    R.cut = await call("export_cut", { book, otio: true });
    R.ax = R.cut.otio?.astrid;
    R.otioFile = R.cut.otio?.file;
    // the round trip: the take's rows become the cut's plan, a key moves onto a word, a re-take opens with it
    R.restore = await call("retake", { take: "take-g17x1", open_only: true, dials: "take" });
    R.adopt = await call("set_cut_dials", { scene: c1.scene, shot: c1.shot, from_rack: true });
    R.moved = await call("set_cut_dials", { book, cut: "C1", move_key: { dial: LIGHT, key: "peak", to_s: 1.1 } });
    const queued = A.queued.length;
    R.retake = await call("retake", { take: "take-g17x1", dials: "cut", open_only: true });
    R.queuedByRetake = A.queued.length - queued;
    R.rackAfter = await page.evaluate(() => { try { return JSON.parse(window.__E.getValue("rack", "rack", "rack") || "[]"); } catch { return null; } });
    R.savedShot = await page.evaluate(async ({ c1 }) => { const SC = window.__SC; await SC.load(); const shot = SC.get(c1.scene).shots.find((x) => x.id === c1.shot); const g = await (await fetch(`/api/userdata/${encodeURIComponent(shot.workflow)}`)).json(); const n = g.nodes.find((x) => x.type === "MAIDialRack"); return n && JSON.parse(n.widgets_values[0]); }, { c1 });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  if (R.ax?.archive && fs.existsSync(R.ax.archive)) R.tl = JSON.parse((await sh("python3", ["-I", "-c", ZIP, R.ax.archive])).out);
  const otioPath = R.otioFile && path.join(base, "output", R.otioFile.replace(/ \[output\]$/, ""));
  if (otioPath && fs.existsSync(otioPath)) R.otio = JSON.parse(fs.readFileSync(otioPath, "utf8"));
  if (APY && AVAL && R.ax?.archive) { const v = await sh(APY, ["-I", AVAL, R.ax.archive], { cwd: path.dirname(AVAL) }); try { R.astrid = JSON.parse(v.out); } catch { R.astrid = { ok: false, out: v.out + v.err }; } }
  const S = R, clip = (id) => S.tl?.parent?.clips?.find((c) => c.id === id), d1 = clip("C1")?.generation?.snap?.dials, d2 = clip("C2")?.generation?.snap?.dials;
  const oclip = (id) => S.otio?.tracks?.children?.find((t) => t.kind === "Video")?.children?.find((c) => c.name === id);
  const near = (a, b) => Math.abs(a - b) < 1e-3;
  const checks = {
    "C1's generation.snap.dials: pipeline ref2v, clip_seconds = the take's length (R233)": d1?.pipeline === "ref2v" && near(d1.clip_seconds, S.length),
    "its row is the rack's as it ran: dramatic light 3.0, steps 6, audio protect": d1?.rows?.length === 1 && d1.rows[0].dial === LIGHT && d1.rows[0].strength === 3 && d1.rows[0].on === true && d1.rows[0].steps === 6 && d1.rows[0].audio === "protect",
    "its keys are in the take's seconds, unchanged by the cut's trim (in_s 0.5)": JSON.stringify(d1?.rows?.[0]?.curve?.keys) === JSON.stringify([[0, 0], [0.6, 0.2], [1.6, 1], [5.17, 1]]) && d1.rows[0].curve.interp === "linear" && !("unit" in d1.rows[0].curve) && clip("C1")?.from === 0.5,
    "normalized keys come out in seconds by the take's length, with the rack's defaults (steps 2, follow)": d2?.rows?.[0]?.dial === PSY && near(d2.rows[0].curve.keys[1][0], 0.5 * S.length) && d2.rows[0].curve.keys[0][0] === 0 && d2.rows[0].steps === 2 && d2.rows[0].audio === "follow",
    "a constant row is curve null": d2?.rows?.[1]?.dial === LIGHT && d2.rows[1].curve === null && !("steps" in d2.rows[1]),
    "a take that ran no dials has no dials block": !!clip("C3") && !("dials" in (clip("C3").generation?.snap ?? {})),
    "the .otio clip's metadata.snap.dials says the same": JSON.stringify(oclip("C1")?.metadata?.snap?.dials) === JSON.stringify(d1),
    "from_rack adopts the take's rows into the cut's plan, verbatim": !S.restore?.error && JSON.stringify(S.adopt?.rows) === JSON.stringify(S.ran),
    "move_key puts the peak on the word time": S.moved?.moved?.key === 3 && S.moved.moved.from === 1.6 && S.moved.moved.to === 1.1 && S.moved.rows[0].time.points[2][0] === 1.1,
    "retake {dials: cut, open_only} puts the moved key on the rack and saves it into the shot (R234)": S.rackAfter?.[0]?.time?.points?.[2]?.[0] === 1.1 && S.savedShot?.[0]?.time?.points?.[2]?.[0] === 1.1,
    "and queues nothing": S.queuedByRetake === 0 && !S.retake?.run && /nothing is queued/.test(S.retake?.said ?? ""),
    "its answer names the key it moved": /dial rows from the cut's plan: dials\/h3_light_dramatic_v2_hook\.safetensors: key 3: 1\.6 s → 1\.1 s/.test(JSON.stringify(S.retake?.updated ?? [])),
    [`Astrid's own import preflight accepts the archive${APY && AVAL ? "" : " (skipped: SNAP_TEST_ASTRID_PY / _VALIDATE unset)"}`]: !(APY && AVAL) || S.astrid?.ok === true,
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify({ ...R, tl: R.tl && R.tl.parent?.clips, otio: undefined }, null, 1));
  console.log(`g17export ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
