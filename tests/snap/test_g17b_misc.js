// Batch G17b, the voice reference's words and the small findings, on the CPU test server with real footage (fixtures
// short05_v3, short03 voices):
// - SNAP-R241: use_take {as: "voice"} on short05 C4 (whose Voice QA words are seeded on the take, as Nemotron heard them:
//   "one more bowl" at 2.39-3.69 s) keeps the words the stretch says; a speaker whose reference says a line of the
//   script is a compile lint (F-SQ12);
// - F-SQ01: add_change refuses a value that names a record with words after it; a story that already holds one still
//   compiles and remove_change takes it back;
// - F-SQ04: a Cast picture number past its refs says refs count from 0;
// - F-SQ07: make_board's default context is the nearest earlier board on the cut's plate, not another place's board;
// - F-SQ10: add_plate {camera: "same"} moves the plate's own camera mark with its pose;
// - F-SQ45: a region edit with a mask on a big crop asks ImageBlur for sigma 10 at most;
// - F-AC01: nearby on a re-run's take answers; F-AC05: a New view still re-runs with a Cast swap (its own
//   edit_from_context call with the new version's picture); F-AC09: apply_unit says a cut off Pika's 6 steps;
// - F-SQ06: a cut's opening still prompt leaves its own beat's action words out.
// usage: node test_g17b_misc.js [port] [base]   prints "g17bmisc n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const FX = CFG.fixture("short05_v3"), VOICES = CFG.fixture("short03", "voices");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g17bmisc-${Date.now()}`)); } };
const sh = (cmd, args) => new Promise((done) => execFile(cmd, args, { maxBuffer: 1 << 26 }, (e, o, err) => done({ code: e ? e.code ?? 1 : 0, out: String(o), err: String(err) })));
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "location", "production", "proposals.json", "candidates"]) park(d); // moved, never deleted
  const fin = path.join(base, "input", "snap", "g17bm"), fout = path.join(base, "output", "snaptest_g17bm");
  fs.mkdirSync(fin, { recursive: true }); fs.mkdirSync(fout, { recursive: true });
  fs.copyFileSync(path.join(FX, "c4_take-b80dc620_one_more_bowl.mp4"), path.join(fout, "c4.mp4"));
  fs.copyFileSync(path.join(VOICES, "brann_voice_ref.wav"), path.join(fin, "kuroe_old.wav"));
  for (const [clip, frame, name] of [["c1_take-00767c8d.mp4", 0, "p1"], ["c4_take-b80dc620_one_more_bowl.mp4", 0, "p3"], ["c1_take-00767c8d.mp4", 0, "b1"], ["c4_take-b80dc620_one_more_bowl.mp4", 40, "b3"], ["c4_take-b80dc620_one_more_bowl.mp4", 10, "kuroe1"], ["c4_take-b80dc620_one_more_bowl.mp4", 80, "kuroe2"]])
    await sh("ffmpeg", ["-v", "error", "-y", "-i", path.join(FX, clip), "-vf", `select=eq(n\\,${frame})`, "-frames:v", "1", path.join(fin, `${name}.png`)]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    // the mask needs SAM 3.1 in the model graph: listed here (as test_g13 does), its prompts never reach a loader (fwork's rewrite)
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.route(/\/api\/experiment\/models\/checkpoints$/, async (r) => { const res = await r.fetch(), list = await res.json(); r.fulfill({ response: res, json: [...list, { name: "sam3.1_multiplex_fp16.safetensors", pathIndex: 0, modified: 0, size: 1e9 }] }); });
    const A = await F.open(b, port, { context: ctx }), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const kuroe = R.kuroe = (await call("save_cast", { name: "Kuroe g17bm", details: "a gaunt baron in a dark coat", refs: [{ file: "snap/g17bm/kuroe1.png", role: "front" }], voice: { file: "snap/g17bm/kuroe_old.wav", casting: "" } })).cast;
    // ---- SNAP-R241: the reference's words from the take's Voice QA words ----
    await page.evaluate(async () => { await window.__T.save({ id: "take-g17bm-c4", kind: "run", prompt_id: "g17bm-c4", created: Date.now(), seconds: 60, group: "g17bm-c4", number: 7, status: "success", text: "", seed: 7401, verdict: "keep", notes: [],
      media: [{ kind: "video", filename: "c4.mp4", subfolder: "snaptest_g17bm", type: "output" }], graph: {}, world: {}, prompt: {}, voice: { status: "ok", voices: [], words: [[2.394, 2.739, "one"], [2.739, 3.138, "more"], [3.138, 3.694, "bowl"]], text: "one more bowl" } }); });
    R.voice = await call("use_take", { take: "take-g17bm-c4", as: "voice", cast: kuroe, at: 2.2, length: 1.6 });
    const book = (await call("create_book", { name: "G17b Misc", cast: [kuroe] })).book;
    const loc = await call("save_location", { name: "Yatai g17bm", cameras: [{ name: "street", x: 0.5, y: 0.8, heading: 0, eye_height: 1.5, lens: 35 }], plates: [{ name: "P1", file: "snap/g17bm/p1.png", role: "camera", camera: "street", pose: { x: 0.5, y: 0.8, heading: 0, eye_height: 1.5, lens: 35 } }, { name: "P3 reverse", file: "snap/g17bm/p3.png", role: "camera" }] });
    const locRef = loc.ref ?? `location:${loc.id}`;
    await page.evaluate(async ({ book, kuroe }) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { props: [{ id: "gate", name: "the gate" }], beats: [{ id: "b1", text: "Kuroe sits at the counter.", changes: [{ entity: "prop:gate", path: "position", value: "closed and barred" }] }, { id: "b2", text: "Kuroe tastes the broth." }, { id: "b3", text: "Kuroe pushes the bowl back.", lines: [{ who: kuroe, text: "One more bowl." }] },
        { id: "b4", text: "The gate leaves swing inward.", changes: [{ entity: "prop:gate", path: "position", value: "open" }] }] }, { note: "g17b misc" }); }, { book, kuroe });
    const c1 = await call("add_cut", { book, scene_name: "G17b misc", beats: ["b1"], cast: [kuroe], location: locRef, plate: "P1", seconds: 3 });
    const c2 = await call("add_cut", { book, scene: c1.scene, beats: ["b2"], cast: [kuroe], location: locRef, plate: "P3 reverse", seconds: 3 });
    const c3 = await call("add_cut", { book, scene: c1.scene, beats: ["b3"], cast: [kuroe], location: locRef, plate: "P1", seconds: 3 });
    const c4 = await call("add_cut", { book, scene: c1.scene, beats: ["b4"], props: ["prop:gate"], location: locRef, plate: "P1", seconds: 3 });
    R.sheet3 = await call("compile_unit", { scene: c3.scene, shot: c3.shot });
    R.sheet4 = await call("compile_unit", { scene: c4.scene, shot: c4.shot });
    // ---- F-SQ07: C3's default board context ----
    await call("set_board", { scene: c1.scene, shot: c1.shot, file: "snap/g17bm/b1.png", approved: true });
    await call("set_board", { scene: c2.scene, shot: c2.shot, file: "snap/g17bm/b3.png", approved: true });
    R.board3 = (await call("compile_unit", { scene: c3.scene, shot: c3.shot }))?.board;
    // ---- F-SQ01 ----
    R.badChange = await call("add_change", { book, beat: "b1", entity: kuroe, path: "carried.right_hand", value: `${kuroe} (right hand)` });
    R.oldBad = await page.evaluate(async ({ book, kuroe }) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body), body = structuredClone(st.body);
      body.beats[0].changes.push({ id: "c9", entity: "prop:gate", path: "holder", op: "set", value: `${kuroe} (both hands under it)` }); const out = await B.saveStory(st.id, body, { note: "an old bad row" }); return out.ref; }, { book, kuroe });
    R.compileOld = await call("compile_unit", { scene: c1.scene, shot: c1.shot });
    R.remove = await call("remove_change", { book, beat: "b1", change: "c9" });
    // ---- F-SQ04 ----
    R.refNum = await call("edit_from_context", { pictures: [{ cast: kuroe, ref: 1 }], prompt: "Kuroe, closer", method: "ph3_view", land: "tab" });
    // ---- F-SQ10 ----
    R.same = await call("add_plate", { location: locRef, name: "P1", pose: { eye_height: 1.7 }, camera: "same" });
    R.marks = await page.evaluate(async (ref) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); return W.headOf(W.record("location", W.parse(ref).id)).body.cameras; }, locRef);
    // ---- F-SQ45: a big crop with a mask ----
    await page.evaluate(async () => { await window.__T.save({ id: "take-g17bm-still", kind: "run", prompt_id: "g17bm-still", created: Date.now(), seconds: 9, group: "g17bm-still", number: 1, status: "success", text: "board", seed: 1, verdict: null, notes: [], media: [{ kind: "image", filename: "b1.png", subfolder: "snap/g17bm", type: "input" }], graph: {}, world: {}, prompt: {} }); });
    const blurs = [], grab = (r) => { if (r.request().method() === "POST") for (const n of Object.values(JSON.parse(r.request().postData()).prompt ?? {})) if (n.class_type === "ImageBlur") blurs.push(n.inputs.sigma); return r.fallback(); };
    await page.route(/\/(api\/)?prompt$/, grab); // read what is posted, then fwork's CPU rewrite as always
    R.region = await call("edit_from_context", { pictures: [{ take: "take-g17bm-still", crop: [0.16, 0.3, 0.68, 0.7] }], prompt: "Recolour only the jacket in Picture 1 to navy", paste_back: true, mask: "the suit jacket:1", seeds: [1], land: "tab" });
    await page.unroute(/\/(api\/)?prompt$/, grab);
    R.blurs = blurs;
    // ---- F-AC05: a New view still (Kuroe's picture as its context) re-run with Kuroe swapped to his newest version ----
    await page.evaluate(async (kuroe) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); const id = W.parse(kuroe).id;
      await window.__T.save({ id: "take-g17bm-view", kind: "run", prompt_id: "g17bm-view", created: Date.now(), seconds: 9, group: "g17bm-view", number: 1, status: "success", text: "Kuroe at the counter", seed: 9811, verdict: null, notes: [], media: [{ kind: "image", filename: "kuroe1.png", subfolder: "snap/g17bm", type: "input" }],
        parent: { take: null, method: "view/ph3_view", options: { label: "Kuroe at the counter", prompt: "<Picture 1> Kuroe at the counter, same light.", context: [{ n: 1, cast: `cast:${id}@1`, file: "snap/g17bm/kuroe1.png", label: "Kuroe g17bm, front" }], purpose: "character" } },
        graph: { extra: { snap: { world: { [`cast:${id}`]: { n: 1, name: "Kuroe g17bm" } } } } }, world: { [`cast:${id}`]: { n: 1, name: "Kuroe g17bm" } }, prompt: {} }); }, kuroe);
    await call("save_cast", { cast: kuroe, refs: [{ file: "snap/g17bm/kuroe2.png", role: "front" }] });
    const beforeAC05 = A.queued.length;
    R.rerunView = await call("rerun", { take: "take-g17bm-view", swaps: { [kuroe.replace(/@\d+$/, "")]: { to: "latest" } } });
    await page.waitForTimeout(1500);
    R.rerunQueued = A.queued.slice(beforeAC05).map((q) => q.extra?.snap_parent?.options?.context ?? null);
    // ---- F-AC01: nearby on a take whose parent method names no slot ----
    await page.evaluate(async () => { await window.__T.save({ id: "take-g17bm-rerun", kind: "run", prompt_id: "g17bm-rerun", created: Date.now(), seconds: 9, group: "g17bm-view", number: 2, status: "success", text: "re-run", seed: 1, verdict: null, notes: [], media: [{ kind: "image", filename: "kuroe2.png", subfolder: "snap/g17bm", type: "input" }], parent: { take: "take-g17bm-view", method: "rerun/regenerate" }, graph: {}, world: {}, prompt: {} }); });
    R.nearby = await call("nearby", { ref: "take-g17bm-rerun" });
    // ---- F-AC09: C1's recipe at 20 steps without the turbo ----
    R.open1 = await call("open_shot", { scene: c1.scene, shot: c1.shot });
    R.setups = await call("list_setups", {});
    const noTurbo = (R.setups?.setups ?? R.setups ?? []).find?.((s) => /^Reference pictures, no turbo/.test(s.name ?? ""));
    if (noTurbo) R.applySetup = await call("apply_setup", { name: noTurbo.name });
    R.apply1 = await call("apply_unit", { scene: c1.scene, shot: c1.shot });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, lint3 = S.sheet3?.lint ?? [], ctx3 = (S.board3?.pictures ?? []).map((p) => p.label), mark = (S.marks ?? []).find((m) => m.name === "street");
  const checks = {
    "use_take as voice keeps the words the stretch says, from the take's Voice QA words (R241)": S.voice?.words === "one more bowl" && /it says "one more bowl"/.test(S.voice.said ?? ""),
    "a speaker whose reference says a line of the script is a compile lint (R241, F-SQ12)": lint3.some((w) => /^Kuroe g17bm's voice reference says "one more bowl", which is their own line at b3 \("One more bowl\."\): H3 copies a reference's words/.test(w)),
    "add_change refuses a record reference with words after it (F-SQ01)": /the value "cast:[^"]+ \(right hand\)" names a record and has more after it: give the reference alone/.test(S.badChange?.error ?? ""),
    "a story already holding such a row compiles, and remove_change takes it back (F-SQ01)": !S.compileOld?.error && !S.remove?.error,
    "a Cast picture number past its refs says refs count from 0 (F-SQ04)": /has no picture ref 1: refs count from 0, so its 1 picture is ref 0/.test(S.refNum?.error ?? ""),
    "make_board's default context is the nearest earlier board on the cut's plate (F-SQ07)": ctx3.some((l) => /^C1's board, the nearest earlier one on this plate$/.test(l)) && !ctx3.some((l) => /previous cut's board/.test(l)),
    "add_plate camera \"same\" moves the plate's mark with its pose (F-SQ10)": !S.same?.error && mark?.eye_height === 1.7 && mark.x === 0.5,
    "a masked region edit on a big crop keeps ImageBlur's sigma at 10 or less (F-SQ45)": !S.region?.error && S.blurs?.length > 0 && S.blurs.every((x) => x <= 10),
    "a New view still re-runs with a Cast swap: its own call with the new version's picture (F-AC05)": !S.rerunView?.error && !!S.rerunView?.decision && (S.rerunQueued ?? []).some((c) => c?.[0]?.cast && !/@1$/.test(c[0].cast) && c[0].file === "snap/g17bm/kuroe2.png"),
    "nearby on a re-run's take answers (F-AC01)": !S.nearby?.error && !!S.nearby,
    "apply_unit says a cut off Pika's 6 steps (F-AC09)": !S.applySetup || (S.apply1?.said ?? []).some((w) => /the quality standard is Pika at 6 steps \(SNAP-R149\)/.test(w)),
    "a cut's opening still prompt leaves its beat's action words out (F-SQ06)": !!S.sheet4?.opens?.still_prompt && !/The gate leaves swing inward/.test(S.sheet4.opens.still_prompt) && /The gate leaves swing inward/.test(S.sheet4.still_prompt ?? ""),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify(R, null, 1));
  console.log(`g17bmisc ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
