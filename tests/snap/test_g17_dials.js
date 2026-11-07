// Batch G17a, dial rows on the page and on Book cuts (SNAP-R230-R239), on the CPU test server with the seq02 bake-off's
// real footage (fixtures group seq02_bakeoff: the dramatic-light clash w05, its frame-46 crop) and short03's voices:
// - add_dial / set_dial take a time curve checked with the rack's own rules (keys in seconds, every blend step, audio
//   protect, each default said; keys out of order and a MOSS dial with a curve refused in words; time null clears);
// - list_nodes lists the rack's hidden `rack` widget, marked hidden (R238);
// - set_dial_info writes kind and per-pipeline strengths into a scratch copy of a test-base dial: the tensors' sha is
//   the same before and after, list_dials reads the block back, a kind outside the list is refused (R232);
// - make_dial adds nothing to the rack unless asked and says which loras folder it saved into (the run is answered by
//   the test, nothing reaches ComfyUI; R239); a folder outside the node's list is refused before anything is queued;
// - a Book cut: set_cut_dials fills the defaults and says them, move_key refuses a crossing, compile_unit shows the rows
//   with effective strengths and the lints (another family, a look row on a close-up, weather under protect, a
//   speaker without a voice, a picture cited inside the action), apply_unit sets the rack exactly and names the row it
//   took off, and a take made from the cut reads stale "dial rows changed" after a key moves (R230, R231);
// - an insert's master {cut, at_s, crop}: frame 46 of w05 (its active take) comes into the board package and
//   References as continuity, matching the bake-off's own crop (R236);
// - a Cast with a voice on a cut where it has no line gets no <Audio n> from apply_unit; apply_cast on a plain shot
//   with no line leaves it out unless voice: true; a retake with today's world adds none (R237, F-SQ11/12, F-AC11);
// - make_board's Cast pictures pin the Cast (F-AC02).
// usage: node test_g17_dials.js [port] [base]   prints "g17dials n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const FX = CFG.fixture("seq02_bakeoff"), VOICES = CFG.fixture("short03", "voices");
const out = path.join(CFG.out, "ui", "g17a"); fs.mkdirSync(out, { recursive: true });
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g17dials-${Date.now()}`)); } };
const sh = (cmd, args) => new Promise((done) => execFile(cmd, args, { maxBuffer: 1 << 26 }, (e, o, err) => done({ code: e ? e.code ?? 1 : 0, out: String(o), err: String(err) })));
const LIGHT = "dials/h3_light_dramatic_v2_hook.safetensors", PSY = "dials/h3_psychedelic_hook.safetensors", MOSS = "dials/moss_weather_calm_storm_hook.safetensors";
const SCRATCH = "dials/g17_scratch_light.safetensors", STORM = "dials/g17_scratch_storm.safetensors";
const ENVELOPE = [[0, 0], [0.6, 0.2], [1.6, 1], [5.17, 1]]; // the bake-off's round-2 envelope (BAKEOFF.md)
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "production", "proposals.json"]) park(d); // moved, never deleted
  const dials = path.join(base, "models", "loras", "dials"); // the test base's own dial folder (never the shared one)
  fs.copyFileSync(path.join(dials, "h3_light_dramatic_v2_hook.safetensors"), path.join(dials, "g17_scratch_light.safetensors"));
  fs.copyFileSync(path.join(dials, "h3_weather_storm_hook.safetensors"), path.join(dials, "g17_scratch_storm.safetensors"));
  const fout = path.join(base, "output", "snaptest_g17"), fin = path.join(base, "input", "snap", "g17");
  fs.mkdirSync(fout, { recursive: true }); fs.mkdirSync(fin, { recursive: true });
  fs.copyFileSync(path.join(FX, "w05_dramatic_light.mp4"), path.join(fout, "w05.mp4"));
  fs.copyFileSync(path.join(FX, "w05_f46_crop.png"), path.join(fin, "corvin_wide_crop.png"));
  fs.copyFileSync(path.join(VOICES, "brann_voice_ref.wav"), path.join(fin, "corvin_voice.wav"));
  const w05 = JSON.parse(fs.readFileSync(path.join(FX, "w05_take.json"), "utf8"));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const rack = () => page.evaluate(() => { try { return JSON.parse(window.__E.getValue("rack", "rack", "rack") || "[]"); } catch { return null; } });

    // ---- the page's rack ----
    R.start = await call("start_recipe", {});
    R.add = await call("add_dial", { dial: LIGHT, strength: 3, time: { points: ENVELOPE } });
    R.badOrder = await call("set_dial", { dial: LIGHT, time: { points: [[0, 0], [1.6, 1], [0.5, 0.2]] } });
    R.moss = await call("add_dial", { dial: MOSS, time: { points: [[0, 0], [1, 1]] } });
    R.cleared = await call("set_dial", { dial: LIGHT, time: null });
    R.nodes = await call("list_nodes", { brick: "rack" });
    R.rackWidget = (Array.isArray(R.nodes) ? R.nodes : []).flatMap((n) => n.widgets).find((w) => w.name === "rack");
    await call("remove_dial", { dial: LIGHT });
    // ---- dial info (R232) ----
    R.info = await call("set_dial_info", { dial: SCRATCH, info: { kind: "light", negative: "flat light", positive: "dramatic light", pipelines: { ref2v: { useful: 3, overcook: 4.5, steps: 6, evidence: "one-seed", notes: "wide 3.0; the close-up insert ran 1.5 (bake-off round 3)" } } } });
    R.badKind = await call("set_dial_info", { dial: SCRATCH, info: { kind: "glow" } });
    R.stormInfo = await call("set_dial_info", { dial: STORM, info: { kind: "weather" } });
    R.listed = (await call("list_dials", { query: "g17_scratch_light" }))?.[0];
    // ---- make_dial (R239): the run is answered here, nothing reaches ComfyUI ----
    const before = await rack();
    const answer = async (r) => {
      if (r.request().method() !== "POST") return r.continue();
      const body = JSON.parse(r.request().postData()), id = Object.keys(body.prompt ?? {}).find((k) => body.prompt[k].class_type === "MAIDialMake");
      R.makePosted = { nodes: Object.values(body.prompt ?? {}).map((n) => n.class_type), folder: id && body.prompt[id].inputs.folder };
      await r.fulfill({ contentType: "application/json", body: JSON.stringify({ prompt_id: "g17-make", number: 1, node_errors: {} }) });
      setTimeout(() => page.evaluate(([node, b]) => import("/scripts/api.js").then(({ api }) => api.dispatchCustomEvent("executed", { node, output: { text: [`made g17 test\nsaved ${b}/models/loras/dials/g17_made.safetensors`] } })), [id, base]), 300);
    };
    await page.route(/\/(api\/)?prompt$/, answer);
    R.badFolder = await call("make_dial", { name: "g17_made", negative: "calm", positive: "furious", pairs: [["{subject} stands calm.", "{subject} shakes with fury."]], folder: "nowhere/at/all" });
    R.make = await call("make_dial", { name: "g17_made", negative: "calm", positive: "furious", pairs: [["{subject} stands calm.", "{subject} shakes with fury."]] });
    await page.unroute(/\/(api\/)?prompt$/, answer); // only this handler: fwork's CPU rewrite stays
    R.rackAfterMake = await rack(); R.rackBeforeMake = before;

    // ---- a Book: C1 the wide clash (w05 its active take), C2 the sweat-drop insert ----
    const corvin = (await call("save_cast", { name: "Corvin", details: "a calm examiner mage in a grey robe with dark trim", refs: [{ file: "snap/g17/corvin_wide_crop.png", role: "identity: in the wide" }], voice: { file: "snap/g17/corvin_voice.wav", casting: "dry, unbothered" } })).cast;
    const liora = (await call("save_cast", { name: "Liora", details: "a student mage with a gold beam" })).cast;
    const book = (await call("create_book", { name: "G17 Exam", cast: [corvin, liora] })).book;
    await page.evaluate(async ({ book, liora }) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { beats: [{ id: "b1", text: "Liora's beam meets Corvin's calm palm mid-terrace." }, { id: "b2", text: "A single drop of sweat runs down Corvin's temple.", lines: [{ who: liora, text: "What the—!" }] }], groups: [{ id: "g1", name: "The clash", beats: ["b1", "b2"] }] }, { note: "g17 story" }); }, { book, liora });
    const c1 = R.c1 = await call("add_cut", { book, scene_name: "G17 terrace", beats: ["b1"], cast: [corvin], seconds: 5, camera: "wide, both duelists" });
    const c2 = R.c2 = await call("add_cut", { book, scene: c1.scene, beats: ["b2"], cast: [corvin], seconds: 3, camera: "ECU insert on Corvin's face", blocking: "Corvin holds like <Picture 4>, unbothered" });
    await page.evaluate(async ({ c1, take }) => { const T = window.__T, SC = window.__SC;
      await T.save({ ...take, id: "take-g17w05", prompt_id: "g17w05", group: "g17-w05", media: [{ kind: "video", filename: "w05.mp4", subfolder: "snaptest_g17", type: "output" }], notes: [] });
      await SC.addGroup(c1.scene, c1.shot, "g17-w05"); await SC.setActive(c1.scene, c1.shot, "take-g17w05", "person"); }, { c1, take: w05 });
    // set_cut_dials by {book, cut}, the way an Astrid-side agent names it
    R.plan = await call("set_cut_dials", { book, cut: "C1", rows: [{ dial: LIGHT, strength: 3, time: { points: ENVELOPE } }] });
    R.cross = await call("set_cut_dials", { book, cut: "C1", move_key: { dial: LIGHT, key: "peak", to_s: 0.5 } });
    R.twoOps = await call("set_cut_dials", { book, cut: "C1", remove: LIGHT, from_rack: true });
    // apply_unit C1: a stray row on the rack goes, named; the voice stays out (Corvin has no line in C1)
    R.open1 = await call("open_shot", { scene: c1.scene, shot: c1.shot });
    await call("add_dial", { dial: PSY, strength: 0.5 });
    R.apply1 = await call("apply_unit", { scene: c1.scene, shot: c1.shot });
    R.rackAfterApply = await rack();
    R.audio1 = (await call("describe_recipe", {}))?.references?.audio ?? [];
    // a take made from the cut (its graph carries the story pin), then a key moves: it reads stale
    await page.evaluate(async () => { const g = app.graph.serialize(); await window.__T.save({ id: "take-g17c1a", kind: "run", prompt_id: "g17c1a", created: Date.now(), seconds: 60, group: g.id, number: 9, status: "success", text: "g17", seed: 1, media: [{ kind: "video", filename: "w05.mp4", subfolder: "snaptest_g17", type: "output" }], verdict: "keep", notes: [], prompt: {}, graph: g, story: g.extra.snap.story, world: g.extra.snap.world ?? {} }); });
    R.staleBefore = (await call("story_stale", { book }))?.stale?.find((x) => x.take === "take-g17c1a") ?? null;
    R.moved = await call("set_cut_dials", { book, cut: "C1", move_key: { dial: LIGHT, key: "peak", to_s: 1.3 } });
    R.staleAfter = (await call("story_stale", { book }))?.stale?.find((x) => x.take === "take-g17c1a") ?? null;
    // a retake with today's world (a newer Corvin) brings no voice into C1
    await call("save_cast", { cast: corvin, name: "Corvin", details: "a calm examiner mage in a grey robe with dark trim, silver at the temples", refs: [{ file: "snap/g17/corvin_wide_crop.png", role: "identity: in the wide" }], voice: { file: "snap/g17/corvin_voice.wav", casting: "dry, unbothered" } });
    R.retake = await call("retake", { take: "take-g17c1a", world: "latest", open_only: true, dials: "take" });
    R.audioRetake = (await call("describe_recipe", {}))?.references?.audio ?? [];
    // ---- C2, the insert: its master frame, the lints ----
    R.master = await call("set_unit", { scene: c2.scene, shot: c2.shot, master: { cut: "C1", at_s: 1.92, crop: [0.5, 0, 0.5, 1] } });
    R.open2 = await call("open_shot", { scene: c2.scene, shot: c2.shot });
    R.plan2 = await call("set_cut_dials", { scene: c2.scene, shot: c2.shot, rows: [{ dial: SCRATCH, strength: 3 }, { dial: STORM, strength: 1.5, time: { points: [[0, 0], [2, 1]] } }, { dial: MOSS, strength: 4 }] });
    R.sheet2 = await call("compile_unit", { scene: c2.scene, shot: c2.shot });
    R.apply2 = await call("apply_unit", { scene: c2.scene, shot: c2.shot });
    R.refs2 = (await call("describe_recipe", {}))?.references;
    await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); if (!snap.visible?.()) snap.toggle?.(); });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, "g17_insert_continuity_rack.png") });
    // F-AC02: make_board sends Corvin's picture as a file: the board pins Corvin
    const queuedBefore = A.queued.length;
    R.board = await call("make_board", { scene: c2.scene, shot: c2.shot, count: 1, method: "ph3_view" });
    R.boardWorld = A.queued.slice(queuedBefore).map((q) => q.extra?.extra_pnginfo?.workflow?.extra?.snap?.world ?? null);
    // ---- the voice rule on a plain shot ----
    const plain = await call("create_scene", { name: "G17 plain" }), ps = await call("add_shot", { scene: plain.scene ?? plain.id, name: "plain" });
    await call("open_shot", { scene: plain.scene ?? plain.id, shot: ps.shot?.id ?? ps.shot });
    R.plainCast = await call("apply_cast", { cast: corvin });
    R.plainAudio = (await call("describe_recipe", {}))?.references?.audio ?? [];
    R.plainAsked = await call("apply_cast", { cast: corvin, voice: true });
    R.plainAudioAsked = (await call("describe_recipe", {}))?.references?.audio ?? [];
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  // the scratch dials leave the catalog (a folder starting with "_"), so test_dials' counts stay as they were (moved, never deleted;
  // the next run's copies replace these)
  fs.mkdirSync(path.join(dials, "_g17_scratch"), { recursive: true });
  for (const f of ["g17_scratch_light.safetensors", "g17_scratch_storm.safetensors"]) fs.renameSync(path.join(dials, f), path.join(dials, "_g17_scratch", f));
  // the compiled continuity frame against the bake-off's own frame-46 crop (same take, frame and crop)
  const mf = R.sheet2?.master?.file && path.join(base, "input", R.sheet2.master.file);
  if (mf && fs.existsSync(mf)) { const p = await sh("ffmpeg", ["-v", "info", "-i", mf, "-i", path.join(FX, "w05_f46_crop.png"), "-lavfi", "psnr", "-f", "null", "-"]); R.psnr = Number((p.err.match(/average:([\d.]+|inf)/) ?? [])[1]?.replace("inf", "99")); }
  const S = R, lint2 = S.sheet2?.lint ?? [], row = S.plan?.rows?.[0];
  const checks = {
    "add_dial takes a time curve: keys in seconds, every step of the setup (6) and audio protect, each default said": S.add?.row?.time?.unit === "seconds" && S.add.row.time.steps === 6 && S.add.row.time.audio === "protect" && JSON.stringify(S.add.row.time.points) === JSON.stringify(ENVELOPE) && S.add.defaulted?.some((w) => /^steps 6: a time row blends on every step/.test(w)) && S.add.defaulted.some((w) => /^audio protect/.test(w)),
    "keys out of order are refused in the rack's words": /key 3 at 0\.5 s comes after key 2 at 1\.6 s: times must increase/.test(S.badOrder?.error ?? ""),
    "a MOSS dial with a time curve is refused: MiniMax H3 only": /MOSS-Image dial: time curves support MiniMax H3 only/.test(S.moss?.error ?? ""),
    "set_dial {time: null} makes the row constant again": S.cleared?.dial === LIGHT && !("time" in (S.cleared ?? {})),
    "list_nodes lists the rack's hidden rack widget, marked hidden (R238)": S.rackWidget?.hidden === true && typeof S.rackWidget.value === "string",
    "set_dial_info writes kind and pipelines; the tensors' sha is unchanged (R232)": S.info?.tensors_sha256?.unchanged === true && /^[0-9a-f]{64}$/.test(S.info.tensors_sha256.before) && S.info.info?.kind === "light" && S.info.info.pipelines?.ref2v?.useful === 3 && S.info.info.pipelines.ref2v.steps === 6,
    "list_dials reads the info back, with this recipe's pipeline": S.listed?.kind === "light" && S.listed.pipelines?.ref2v?.overcook === 4.5 && S.listed.for_this_recipe?.pipeline === "t2v" && S.listed.for_this_recipe.measured === false,
    "a kind outside the list is refused, naming the list": /kind' must be one of look, light, weather, motion, camera, voice, other/.test(S.badKind?.error ?? ""),
    "make_dial refuses a folder that isn't one of the node's, before queueing": /folder "nowhere\/at\/all": this server's loras folders are/.test(S.badFolder?.error ?? "") && !S.makePosted?.folder?.startsWith?.("nowhere"),
    "make_dial puts nothing on the rack unless asked (R239, F-SQ17)": S.make?.dial === "dials/g17_made.safetensors" && S.make.on_rack === false && JSON.stringify(S.rackAfterMake) === JSON.stringify(S.rackBeforeMake) && /add_dial \{dial: "dials\/g17_made.safetensors"\} puts it on the rack/.test(S.make.next),
    "make_dial says where the file landed: this server's own folder, shared false (F-SQ33)": S.make?.shared === false && S.make.saved?.endsWith("/models/loras/dials/g17_made.safetensors") && /this server's own models folder/.test(S.make.where ?? "") && S.make.folder === S.make.folders?.[0] && S.makePosted?.nodes?.includes("MAIDialMake"),
    "set_cut_dials by {book, cut} fills the defaults and says them (R230, R231)": row?.time?.steps === 6 && row.time.audio === "protect" && row.time.unit === "seconds" && S.plan.defaulted?.some((w) => /steps 6/.test(w)) && S.plan.defaulted.some((w) => /audio protect/.test(w)) && S.plan.cut === "C1",
    "its effective table gives strength × level at each key": JSON.stringify(S.plan?.effective?.[0]?.keys?.map((k) => k.strength)) === JSON.stringify([0, 0.6, 3, 3]),
    "move_key refuses a crossing, naming the neighbour": /0\.5 s would pass the key before it at 0\.6 s \(key 2\)/.test(S.cross?.error ?? ""),
    "set_cut_dials takes one operation at a time": /give one of rows, set, remove, move_key or from_rack \(not remove and from_rack together\)/.test(S.twoOps?.error ?? ""),
    "apply_unit sets the rack exactly from the cut's rows": JSON.stringify(S.rackAfterApply) === JSON.stringify(S.plan?.rows),
    "apply_unit names the row it took off the rack": (S.apply1?.said ?? []).some((w) => /took off the rack: .* at \+0\.5 \(not in C1's plan; set_cut_dials \{from_rack: true\} adopts/.test(w)),
    "a Cast with a voice gets no <Audio n> on a cut where it has no line, and the answer says why (R237)": !S.audio1.length && (S.apply1?.said ?? []).some((w) => /no voice for Corvin: no line in C1/.test(w)) && !/<Audio \d+>/.test(S.apply1?.prompt ?? ""),
    "a take made from the cut reads stale \"dial rows changed\" after a key moves": !S.staleBefore && S.staleAfter?.reasons?.includes("dial rows changed") && S.moved?.moved?.from === 1.6 && S.moved.moved.to === 1.3 && S.moved.stale?.some((x) => x.take === "take-g17c1a"),
    "a retake with today's world brings no voice into the silent cut (F-AC11)": !S.retake?.error && S.audioRetake.length === 0 && /no voice for Corvin/.test(JSON.stringify(S.retake?.updated ?? [])),
    "the insert's master frame is in its package and References as continuity (R236)": S.sheet2?.master?.frame === 46 && S.sheet2.master.take === "take-g17w05" && S.sheet2.package?.some((p) => p.role === "continuity: C1 at 1.92 s") && (S.refs2?.pictures ?? []).some((p) => p.role === "continuity: C1 at 1.92 s"),
    "the continuity frame is the bake-off's own frame-46 crop (PSNR > 35 dB)": S.psnr > 35,
    "apply_unit's hint names the master frame": /is C1's frame at 1\.92 s, the shot this cuts in from: keep its light, colours and background/.test(S.apply2?.prompt ?? ""),
    "the board's nearest prior view is the master frame": (S.sheet2?.board?.pictures ?? []).some((p) => /^C1 at 1\.92 s, the shot this insert cuts in from/.test(p.label ?? "")),
    "lint: a dial row of another model family": lint2.some((w) => /is a MOSS-Image dial and this cut's recipe renders with MiniMax H3/.test(w)),
    "lint: a look row at a wide's strength on a close-up (F-SQ21)": lint2.some((w) => /dramatic light at 3 on a close-up/.test(w)),
    "lint: a weather row under protect (F-SQ22)": lint2.some((w) => /is a weather dial: protect is partial for weather/.test(w)),
    "lint: a speaker with no Cast voice reference": lint2.some((w) => /^Liora speaks here and has no Cast voice reference/.test(w)),
    "lint: a picture cited inside the action (F-SQ20)": lint2.some((w) => /the action cites a picture .*jump-cut/.test(w)),
    "make_board's Cast picture pins the Cast (F-AC02)": S.boardWorld?.length > 0 && S.boardWorld.every((w) => w && Object.keys(w).some((k) => k.startsWith("cast:"))),
    "apply_cast on a plain shot with no line leaves the voice out and says so; voice: true puts it in": !S.plainAudio.length && /no voice for Corvin: the prompt gives no line \(apply_cast \{voice: true\} puts it in\)/.test(S.plainCast?.done ?? "") && S.plainAudioAsked.some((a) => a.role === "cast: Corvin, voice"),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify(R, null, 1));
  console.log(`g17dials ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
