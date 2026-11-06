// U97 the Book, §11.5 steps 1-2 (SNAP-R67) on the CPU test server:
// - create_book makes a Book with an empty story and the first anime's dial; Casts Kon and Ferro (short04's pictures);
// - six beats come in as agent proposals and land as story versions only on the person's Accept (each version's note
//   names its proposal); b2 plants the letter (window 3) and gives Kon the letter, b4's two add_change proposals sit in
//   the docket (list_docket) before Accept; b5 pays the plant off;
// - move_beat b6 to telling position 1 (a cold open) is one version and diff_record names b6's told; a body equal to the
//   head makes no version; a story save by an agent without a proposal is refused;
// - the dial: set_autonomy is a proposal too; with boards automatic an agent's make_board runs, with boards assist it
//   waits (and list_docket shows it);
// - step 2: add_cut plans C1-C3 with beats; apply_unit + run on C2: the take carries story {ref, beat: b3, unit} and the
//   Work card row names about.beat/unit; a unit with no beat compiles as any shot.
// Screens: ui/u97/book_beat_sheet.png, book_docket.png. usage: node test_book_story.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = process.env.SHOTS || path.join(CFG.out, "ui", "u97");
const base = process.argv[3] || CFG.base;
const D = CFG.fixture("short04");
// P-H3-Image's files as empty placeholders (test_g1_location's way: a board's New view queues, fwork makes it a 64 px picture)
const FILES = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"];
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const d of ["book", "story", "look", "scenes", "takes", "_archived/book", "_archived/story", "_archived/look"]) park(d); // an earlier run's records are parked (moved, never deleted)
  const fx = path.join(base, "input", "snaptest_book");
  fs.mkdirSync(fx, { recursive: true });
  for (const f of ["bible/hiyori_front_v1.png", "bible/tomoshi_front_v1.png"]) fs.copyFileSync(path.join(D, f), path.join(fx, path.basename(f)));
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    // the person's Accept on a proposal, as the Book sheet's docket button does it
    const accept = (id) => page.evaluate(async (id) => { const p = await window.__P.decide(id, true, (n, a) => window.__X.callTool(n, a, { confirmed: true })); return { status: p?.status, result: p?.result }; }, id);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    R.kon = await call("save_cast", { name: "Kon", details: "a young lighthouse keeper's apprentice", refs: [{ file: "snaptest_book/hiyori_front_v1.png", role: "identity: front" }] });
    R.ferro = await call("save_cast", { name: "Ferro", details: "an old lighthouse keeper", refs: [{ file: "snaptest_book/tomoshi_front_v1.png", role: "identity: front" }] });
    const kon = R.kon.cast, ferro = R.ferro.cast;
    R.casts = [kon, ferro];
    R.book = await call("create_book", { name: "The lamp room", medium: "anime", logline: "Kon hands old Ferro the letter that closes the north light.", cast: [kon, ferro] });
    const book = R.book.book;
    // six beats, each an agent proposal the person accepts
    const beats = [
      { text: "Kon climbs the lighthouse stairs at dusk." },
      { text: "Kon finds the sealed letter on the chart table.", changes: [{ entity: kon, path: "carried.right_hand", op: "set", value: "prop:letter", why: "picks it up" }], plants: [{ what: "the letter", window: 3 }] },
      { text: "Ferro watches the sea through his spyglass." },
      { text: "Kon hands Ferro the letter; he lowers the spyglass.", intent: "Ferro decides to trust her" },
      { text: "Ferro reads the letter by the lamp.", pays_off: ["b2p1"] },
      { text: "The north light goes dark over the bay." },
    ];
    R.proposed = [];
    for (const x of beats) { const p = await call("add_beat", { book, ...x }); R.proposed.push(p.proposed ?? p.error); }
    R.beforeAccept = await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); return W.all("story").map((r) => r.head); });
    const pend = await page.evaluate(() => window.__P.pending().map((p) => p.id));
    R.accepted = [];
    for (const id of pend) R.accepted.push((await accept(id)).status);
    // b4's changes: two proposals waiting in the docket, then accepted
    R.ch1 = await call("add_change", { book, beat: "b4", entity: kon, path: "carried.right_hand", op: "set", value: null, why: "hands over the letter" });
    R.ch2 = await call("add_change", { book, beat: "b4", entity: ferro, path: "carried.right_hand", op: "set", value: "prop:letter", why: "takes the letter" });
    R.ch3 = await call("add_change", { book, beat: "b4", entity: "prop:letter", path: "holder", op: "set", value: ferro });
    R.docket = await call("list_docket", {});
    R.docketBook = (R.docket.rows ?? []).filter((r) => r.source === "proposal").map((r) => r.title);
    await call("open_view", { view: "book", book });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, "book_docket.png") });
    for (const id of await page.evaluate(() => window.__P.pending().map((p) => p.id))) R.accepted.push((await accept(id)).status);
    R.get = await call("get_book", { book });
    R.story = { beats: R.get.story?.beats.map((x) => [x.id, x.order, x.told, x.changes.length]), plants: R.get.story?.beats.flatMap((x) => x.plants.map((p) => p.id)) };
    R.notes = await page.evaluate(async (ref) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); const r = W.record("story", ref.replace(/^story:/, "").replace(/@\d+$/, "")); return r.versions.map((v) => ({ n: v.n, by: v.by, note: v.note, beats: v.body.beats.length })); }, R.get.story.ref);
    R.agentWithoutProposal = R.notes.filter((v) => v.by === "agent" && v.beats && !/accepted proposal p\d+/.test(v.note)).length;
    // a cold open: b6 told first; one version; diff_record names b6 told
    const before = R.notes.length;
    const mv = await call("move_beat", { book, beat: "b6", told: 1 });
    R.mvAccept = (await accept(mv.proposed)).status;
    const after = await call("get_book", { book });
    R.versionsAfterMove = (await page.evaluate(async (ref) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); return W.record("story", ref.split(":")[1].split("@")[0]).versions.length; }, after.story.ref)) - before;
    const [sid, n] = after.story.ref.replace(/^story:/, "").split("@");
    R.diff = await call("diff_record", { a: `story:${sid}@${+n - 1}`, b: `story:${sid}@${n}` });
    R.toldB6 = after.story.beats.find((x) => x.id === "b6")?.told;
    // a body equal to the head makes no version
    const same = await call("save_story", { book, beats: after.story.beats, groups: after.story.groups, title: after.story.title });
    R.same = await accept(same.proposed);
    R.agentDirect = await page.evaluate(async (ref) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); try { await B.saveStory(ref.split(":")[1].split("@")[0], { beats: [{ text: "x" }] }, { by: "agent" }); return "saved"; } catch (e) { return e.message; } }, after.story.ref);
    // step 2: three cuts with beats
    R.c1 = await call("add_cut", { book, scene_name: "Lamp room, dusk", beats: ["b1"], cast: [kon], seconds: 4 });
    R.c2 = await call("add_cut", { book, scene: R.c1.scene, beats: ["b3"], cast: [ferro], seconds: 4, transition: "eyeline match to Kon" });
    R.c3 = await call("add_cut", { book, scene: R.c1.scene, beats: ["b5"], cast: [kon, ferro], seconds: 5 });
    R.c4 = await call("add_cut", { book, scene: R.c1.scene, name: "insert, no beat", cast: [kon] });
    R.cuts = [R.c1, R.c2, R.c3, R.c4].map((c) => c.cut);
    R.noBeat = await call("compile_unit", { scene: R.c4.scene, shot: R.c4.shot });
    // the dial: set_autonomy is a proposal; boards automatic lets make_board run, boards assist makes it wait
    const dial = await call("set_autonomy", { book, stages: { boards: "automatic" } });
    R.dialProposed = !!dial.proposed;
    R.dialAccept = (await accept(dial.proposed)).status;
    await call("open_shot", { scene: R.c2.scene, shot: R.c2.shot });
    await page.waitForTimeout(1200);
    R.start = await call("start_recipe", {});
    await page.waitForTimeout(2500);
    R.apply = await call("apply_unit", { scene: R.c2.scene, shot: R.c2.shot });
    R.prompt = await page.evaluate(() => window.__E.getValue("render", "render", "prompt"));
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); }); // the cut_bag stage is collaborate: as Let agents run
    R.run = await call("run", { question: "does C2 hold Ferro at the spyglass?" });
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); });
    for (let i = 0; i < 40 && !R.runDone; i++) { const s = await call("run_status", { run: R.run.run, wait_s: 5 }); if (s.state === "done" || s.state === "failed") R.runDone = s; }
    R.take = await page.evaluate((id) => { const t = window.__T.get(`take-${id}`); return t && { story: t.story, world: Object.keys(t.world ?? {}) }; }, R.run.run);
    R.activity = await call("list_activity", { about: R.run.run });
    R.boardAuto = await call("make_board", { scene: R.c2.scene, shot: R.c2.shot, count: 1, method: "ph3_view" });
    await page.evaluate(async (book) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const b = B.bookOf(book); await B.saveBook(b.id, { ...b.body, autonomy: { ...b.body.autonomy, stages: { ...b.body.autonomy.stages, boards: "assist" } } }, { note: "test: boards assist" }); }, book);
    R.boardAssist = await call("make_board", { scene: R.c2.scene, shot: R.c2.shot, count: 1, method: "ph3_view" });
    R.docket2 = await call("list_docket", {});
    await call("open_view", { view: "book", book, lens: "beat_sheet" });
    await page.waitForTimeout(600);
    await page.click(".snap-book-beat >> text=b4").catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, "book_beat_sheet.png") });
    R.nullText = await page.evaluate(() => document.querySelector(".snap-book-sheet")?.textContent.includes("null"));
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await b.close();
    for (const f of made) { const to = path.join(base, "_parked_placeholders", `${path.basename(f)}-${Date.now()}`); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); } // moved, never deleted
  }
  const S = R;
  const checks = {
    created: !!S.book?.book && S.book.autonomy?.stages?.the_cut === "assist",
    beatsWereProposals: S.proposed?.length === 6 && S.beforeAccept?.every((h) => h === 1),
    allAccepted: S.accepted?.length === 9 && S.accepted.every((x) => x === "accepted"),
    sixBeats: S.story?.beats?.length === 6 && S.story.beats.find((x) => x[0] === "b4")?.[3] === 3 && S.story.plants?.includes("b2p1"),
    docketShowsChanges: Array.isArray(S.docketBook) && S.docketBook.filter((t) => /b4:/.test(t)).length === 3,
    agentVersionsNameProposal: S.agentWithoutProposal === 0 && S.notes?.filter((v) => /accepted proposal p\d+/.test(v.note)).length >= 9,
    moveIsOneVersion: S.mvAccept === "accepted" && S.versionsAfterMove === 1 && S.toldB6 === 1,
    diffNamesB6: S.diff?.changes?.some((c) => c.startsWith("b6 told 6 → 1")),
    sameMakesNone: S.same?.status === "accepted" && S.same?.result?.made === false,
    agentRefused: /always a proposal/.test(S.agentDirect ?? ""),
    cutsNumbered: JSON.stringify(S.cuts) === JSON.stringify(["C1", "C2", "C3", "C4"]),
    noBeatCompiles: S.noBeat?.at === null && /no beat/.test(S.noBeat?.note ?? ""),
    dialIsProposal: S.dialProposed && S.dialAccept === "accepted",
    promptCompiled: /^integrated_multimodal_description: \[Shot 2\] Ferro watches the sea/.test(S.prompt ?? ""),
    takeCarriesBeat: S.take?.story?.beat === "b3" && /^story:story-/.test(S.take?.story?.ref ?? "") && S.take?.story?.unit?.cut === "C2" && !!S.take?.story?.from?.["b3.text"],
    rowNamesBeat: JSON.stringify(S.activity ?? "").includes('"beat":"b3"') && JSON.stringify(S.activity ?? "").includes('"unit":"C2"'),
    boardsAutomaticRuns: !S.boardAuto?.proposed && !!S.boardAuto?.decision,
    boardsAssistWaits: !!S.boardAssist?.proposed,
    docketShowsBoard: JSON.stringify(S.docket2 ?? "").includes("make board"),
    noNull: S.nullText === false,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_book_story_result.json"), JSON.stringify(R, null, 1));
  console.log(`book_story ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
