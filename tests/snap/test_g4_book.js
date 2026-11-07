// Batch G4, the Book's agent loop from short05 (SNAP-R139, R67, R68, R131, R137) on the CPU test server:
// - F-F02 story proposals stack: add_beat proposes b1; add_change on b1 and add_beat after b1 are proposed on the draft
//   and name p1 in needs; accepting the change accepts p1 first; rejecting a beat withdraws the change built on it;
// - F-F19 proposals outlive the page: after a reload list_proposals still holds every row with its answer, and a
//   second page sees a proposal the first one made;
// - F-F10 the person sees them: get_book.proposals, list_docket rows about the Book, the Beat sheet's ghost card with
//   Accept, the docket's needs chip and the Answered list;
// - F-F03 compile_unit lints a beat waiting in a proposal by its id and gives board: the prompt make_board sends;
// - F-F09 apply_unit: every cite from References as they finally stand (board <1>, the plate as the camera, each Cast
//   by its pictures), the unit's blocking and camera in the prompt, a voice only for the Cast with a line, the length
//   rounded up and said;
// - F-F16 make_board context {cut} and role key; set_board role key is cited as the beat's peak;
// - F-F01 a Book's first style is set directly and says so.
// Screens: ui/g4/book_ghost_beat.png, book_docket_after_reload.png. usage: node test_g4_book.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g4");
const base = process.argv[3] || CFG.base;
const D = CFG.fixture("short04");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const d of ["book", "story", "look", "scenes", "takes", "location", "proposals.json"]) park(d); // moved, never deleted
  const fx = path.join(base, "input", "snaptest_book");
  fs.mkdirSync(fx, { recursive: true });
  for (const f of ["bible/hiyori_front_v1.png", "bible/tomoshi_front_v1.png", "bible/hiyori_back_v1.png", "settei_bg/MASTER_shrine_v1.png", "settei_bg/P1_torii_eyelevel.png"]) fs.copyFileSync(path.join(D, f), path.join(fx, path.basename(f)));
  // a board and a key drawing of their own (References keeps one slot per file)
  fs.copyFileSync(path.join(D, "bible/hiyori_back_v1.png"), path.join(fx, "g4_board_c2.png")); fs.copyFileSync(path.join(D, "bible/tomoshi_front_v1.png"), path.join(fx, "g4_key_c2.png"));
  if (!fs.existsSync(path.join(fx, "ferro_line.wav"))) require("child_process").execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=180:duration=2", path.join(fx, "ferro_line.wav")]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    let A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const decide = (id, yes) => page.evaluate(async ([id, yes]) => { const p = await window.__P.decide(id, yes, (n, a) => window.__X.callTool(n, a, { confirmed: true })); return p && { status: p.status, result: p.result }; }, [id, yes]);
    const list = async () => Object.fromEntries((await call("list_proposals", {})).map((p) => [p.id, p.status]));
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const kon = (await call("save_cast", { name: "Kon", details: "a girl in a grey coat", refs: [{ file: "snaptest_book/hiyori_front_v1.png", role: "identity: front" }] })).cast;
    const ferro = (await call("save_cast", { name: "Ferro", details: "an old lighthouse keeper", refs: [{ file: "snaptest_book/tomoshi_front_v1.png", role: "identity: front" }], voice: { file: "snaptest_book/ferro_line.wav", casting: "old man, low voice" } })).cast;
    const place = (await call("save_location", { name: "Lamp room", master: { file: "snaptest_book/MASTER_shrine_v1.png" }, plates: [{ name: "door", file: "snaptest_book/P1_torii_eyelevel.png" }] })).location;
    const book = (await call("create_book", { name: "Lamp", medium: "anime", cast: [kon, ferro], locations: [place] })).book;
    // F-F01: the first style is set directly and says so
    R.style = await call("save_style", { book, name: "Ink", paragraph: "A clean anime cel drawing with soft shading." });
    // F-F02: beats then changes on them, all proposals, the person away
    R.p1 = await call("add_beat", { book, text: "Kon climbs the stairs." });
    R.p2 = await call("add_change", { book, beat: R.p1.would?.beat, entity: kon, path: "mood", op: "set", value: "nervous" });
    R.p3 = await call("add_beat", { book, text: "Ferro speaks at the lamp.", after: R.p1.would?.beat, lines: [{ who: ferro, text: "You came." }] });
    R.p4 = await call("add_beat", { book, text: "A beat the person will refuse." });
    R.p5 = await call("add_change", { book, beat: R.p4.would?.beat, entity: kon, path: "mood", op: "set", value: "angry" });
    R.ids = [R.p1, R.p2, R.p3, R.p4, R.p5].map((p) => [p.proposed, p.would?.beat ?? null, p.needs ?? []]);
    // F-F03: a cut on a beat that only waits in a proposal
    const c1 = await call("add_cut", { book, scene_name: "Stairs", beats: [R.p1.would?.beat], cast: [kon], location: place, plate: "door", seconds: 4, camera: "low angle up the stairs", blocking: "Kon climbs toward the camera" });
    R.compileWaiting = await call("compile_unit", { scene: c1.scene, shot: c1.shot });
    // F-F10: where the person sees them
    R.getBook = (await call("get_book", { book })).proposals?.map((p) => [p.id, p.status]);
    R.docket = ((await call("list_docket", {})).rows ?? []).filter((r) => r.source === "proposal" && r.about?.book === book).map((r) => r.id);
    await call("open_view", { view: "book", book, lens: "beat_sheet" }); await page.waitForTimeout(1500);
    R.ghostCards = await page.locator(".snap-book-ghost").count();
    R.needsChip = await page.locator(".snap-book-prop .snap-al-chip", { hasText: "needs" }).count();
    await page.screenshot({ path: path.join(out, "book_ghost_beat.png") });
    // F-F19: a second page sees the first one's proposals, and a reload keeps them
    const A2 = await F.open(b, port);
    R.secondPage = await A2.page.evaluate(async () => { await window.__P.load(); return window.__P.all().filter((p) => p.status === "waiting").length; });
    await A2.page.close();
    await page.reload(); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
    await F.loadMods(page);
    R.afterReload = await list();
    // F-F02: accept the change on the proposed beat: the beat comes first; reject p4: p5 is withdrawn
    R.acceptChange = await decide(R.p2.proposed, true);
    R.rejectBeat = await decide(R.p4.proposed, false);
    R.answers = await list();
    R.story = (await call("get_book", { book })).story?.beats.map((x) => [x.id, x.text, x.changes.map((c) => `${c.path}=${c.value}`)]);
    R.versionNotes = await page.evaluate(async (book) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"), W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); const st = B.storyOf(B.bookOf(book).body); return W.record("story", st.id).versions.map((v) => v.note); }, book);
    await call("open_view", { view: "book", book, lens: "beat_sheet" }); await page.waitForTimeout(1500);
    R.answeredText = await page.evaluate(() => document.querySelector(".snap-book-answered")?.textContent ?? "");
    await page.locator(".snap-book-answered summary").click().catch(() => {});
    await page.screenshot({ path: path.join(out, "book_docket_after_reload.png") });
    R.acceptP3 = await decide(R.p3.proposed, true);
    // F-F09: apply_unit on a cut where only Ferro speaks, with an approved board and a key drawing
    const c2 = await call("add_cut", { book, scene: c1.scene, beats: [R.p3.would?.beat], cast: [kon, ferro], location: place, plate: "door", seconds: 4, blocking: "Ferro turns from the lamp" });
    R.board = await call("set_board", { scene: c2.scene, shot: c2.shot, file: "snaptest_book/g4_board_c2.png", approved: true });
    R.key = await call("set_board", { scene: c2.scene, shot: c2.shot, file: "snaptest_book/g4_key_c2.png", role: "key" });
    R.compile2 = await call("compile_unit", { scene: c2.scene, shot: c2.shot });
    await call("open_shot", { scene: c2.scene, shot: c2.shot }); await page.waitForTimeout(1200);
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    R.apply = await call("apply_unit", { scene: c2.scene, shot: c2.shot });
    R.refs = await page.evaluate(() => { const r = window.__E.references(); return { pictures: r.pictures.map((p) => [p.cite, p.role]), audio: r.audio.map((a) => [a.cite, a.role]) }; });
    R.prompt = await page.evaluate(() => window.__E.getValue("render", "render", "prompt"));
    // F-F16: a chosen context (the board of C2 for C1) and a key board
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); });
    R.makeBoard = await call("make_board", { scene: c1.scene, shot: c1.shot, context: [{ cut: "C2" }], role: "key" });
    R.makeBoardBad = await call("make_board", { scene: c1.scene, shot: c1.shot, context: [{ cut: "C9" }] });
    R.boardProposal = (await call("list_proposals", {})).find((p) => p.id === R.makeBoard.proposed)?.args;
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
  }
  const S = R, [b1] = S.ids?.[0] ? [S.ids[0][1]] : [], refOf = (re) => S.refs?.pictures?.find(([, r]) => re.test(r ?? ""))?.[0];
  const checks = {
    firstStyleDirect: /had no production style: set directly/.test(S.style?.said ?? "") && !S.style?.proposed,
    beatsProposed: S.ids?.every(([p]) => /^p\d+$/.test(p)) && b1 === "b1" && S.ids[2][1] === "b2" && S.ids[3][1] === "b3",
    changeOnProposedBeat: !S.p2?.error && JSON.stringify(S.ids?.[1]?.[2]) === JSON.stringify([S.p1?.proposed]) && JSON.stringify(S.ids?.[2]?.[2]) === JSON.stringify([S.p1?.proposed]),
    lintNamesProposal: S.compileWaiting?.lint?.some((x) => x === `beat b1 is waiting in proposal ${S.p1?.proposed} (not accepted yet): the unit compiles without it until the person accepts`) && /waits in/.test(S.compileWaiting?.note ?? ""),
    compileShowsBoardPrompt: /Kon climbs toward the camera\./.test(S.compileWaiting?.board?.prompt ?? "") && /Camera: low angle up the stairs\./.test(S.compileWaiting?.board?.prompt ?? "") && /<Picture 1> is this cut's camera/.test(S.compileWaiting?.board?.prompt ?? "") && S.compileWaiting?.board?.pictures?.length >= 2,
    getBookLists: S.getBook?.length === 5 && S.getBook.every(([, st]) => st === "waiting"),
    docketAboutBook: S.docket?.length === 5,
    ghostCards: S.ghostCards === 3 && S.needsChip >= 2,
    secondPageSees: S.secondPage === 5,
    keptOverReload: Object.keys(S.afterReload ?? {}).length === 5 && Object.values(S.afterReload).every((v) => v === "waiting"),
    acceptPullsNeeds: S.acceptChange?.status === "accepted" && S.answers?.[S.p1?.proposed] === "accepted" && S.answers?.[S.p2?.proposed] === "accepted",
    rejectWithdraws: S.rejectBeat?.status === "rejected" && S.answers?.[S.p5?.proposed] === "withdrawn",
    storyHasBoth: S.story?.length === 1 && S.story[0][0] === "b1" && S.story[0][2].includes("mood=nervous"),
    versionsNameProposals: S.versionNotes?.some((n) => n.includes(`accepted proposal ${S.p1?.proposed}`)) && S.versionNotes?.some((n) => n.includes(`accepted proposal ${S.p2?.proposed}`)),
    answeredListed: new RegExp(`${S.p4?.proposed} rejected`).test(S.answeredText ?? "") && new RegExp(`${S.p5?.proposed} withdrawn`).test(S.answeredText ?? ""),
    afterBeatKeepsId: S.acceptP3?.status === "accepted",
    citesFinal: refOf(/^board: C2/) === "<Picture 1>" && S.prompt?.includes(`The cut opens on <Picture 1>`) && S.prompt?.includes(`${refOf(/\(camera\)$/)} is this cut's camera on the place.`) && S.prompt?.includes(`${refOf(/\(place\)$/)} shows the place`),
    castCites: S.prompt?.includes(`Kon is ${refOf(/^cast: Kon,/)}.`) && S.prompt?.includes(`Ferro is ${refOf(/^cast: Ferro,/)}.`),
    keyCited: S.prompt?.includes(`${refOf(/^key: C2/)} is the beat's peak (a key drawing)`),
    actionInPrompt: /Ferro speaks at the lamp\. Ferro turns from the lamp\./.test(S.prompt ?? ""),
    voiceOnlySpeaker: S.refs?.audio?.length === 1 && /cast: Ferro, voice/.test(S.refs.audio[0][1]) && /Ferro says "You came\." in the voice of <Audio 1>\./.test(S.prompt ?? "") && !/\{voice:/.test(S.prompt ?? ""),
    plainCites: !/<Picture [^\d>]/.test(S.prompt ?? ""),
    lengthSaid: S.apply?.said?.some((x) => /^length 4(\.\d+)? s/.test(x) && !/^length 3\./.test(x)),
    makeBoardContext: S.makeBoard?.proposed && S.boardProposal?.role === "key" && S.boardProposal?.context?.[0]?.cut === "C2",
    makeBoardBadCut: /no cut C9/.test(S.makeBoardBad?.error ?? S.makeBoardBad?.result ?? "") || !!S.makeBoardBad?.proposed,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g4_book_result.json"), JSON.stringify(R, null, 1));
  console.log(`g4book ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
