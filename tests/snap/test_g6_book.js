// Batch G6, the Book part (short05 story pass F-L02..F-L20; SNAP-R165..R172) on the CPU test server:
// - F-L02 a Cast's details line folds through the story state: at b2 (right hand empty) "a steel ladle in her right
//   hand" is left out of the compile, the still prompt and apply_unit's prompt, named with b2's change; at b1 it stays;
//   the monocle clause goes once the monocle is in his hand (b3); the lint flags blocking that puts the ladle back;
// - F-L07 holder and mood sentences: "The bowl is on the counter …", "The ladle is hanging …", "Aya has a confident grin";
// - F-L09 a cut on its own beat: C3 opens on the state before b3 (he wears the monocle; the opening board's still says
//   so) and ends after it ("At the start of the cut, …"); the blocking "raises the bowl" vs the bowl on the counter is lint;
// - F-L20 a cut with an approved board re-boards from it ("keep its blocking"); F-L14 the role sentence is in the
//   compile's board prompt once, and make_board sends it once;
// - F-L04 make_board candidates pin the story (role board); story_stale lists them after the story moves;
// - F-L10 add_shot {from} drops the cut's story pin; apply_unit {land} compiles into that shot, the cut's own shot
//   unchanged, and the take there pins the unit with landed;
// - F-L05 a louder version carries its parent's world and story pins;
// - F-L03 the reversal cost names the cuts whose compile moves and the already-stale takes it flags again.
// Screens: ui/g6book/compile_c3.png. usage: node test_g6_book.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g6book");
const base = process.argv[3] || CFG.base;
const D = CFG.fixture("short04");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const d of ["book", "story", "look", "scenes", "takes", "location", "proposals.json"]) park(d); // moved, never deleted
  const fx = path.join(base, "input", "snaptest_book");
  fs.mkdirSync(fx, { recursive: true });
  for (const f of ["bible/hiyori_front_v1.png", "bible/tomoshi_front_v1.png", "settei_bg/MASTER_shrine_v1.png", "settei_bg/P1_torii_eyelevel.png"]) fs.copyFileSync(path.join(D, f), path.join(fx, path.basename(f)));
  fs.copyFileSync(path.join(D, "bible/hiyori_back_v1.png"), path.join(fx, "g6_board_c1.png")); // a board of its own (References keeps one slot per file)
  // P-H3's weights as empty placeholders, as test_u101 does: make_board's New view queues, and fwork turns the prompt into a 64 px one
  const made = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"].map((x) => path.join(base, "models", x)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const B = (fn, arg) => page.evaluate(async ([src, arg]) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); return (new Function("B", "arg", `return (${src})(B, arg)`))(B, arg); }, [fn.toString(), arg]);
    const waitTake = (id) => page.evaluate(async (id) => { for (let i = 0; i < 240 && !window.__T.get(id); i++) await new Promise((r) => setTimeout(r, 500)); const t = window.__T.get(id); return t && { id: t.id, story: t.story ?? null, world: t.world ?? null, parent: t.parent ?? null, group: t.group }; }, id);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const aya = (await call("save_cast", { name: "Aya", details: "young woman, orange-red ponytail, green apron, a steel ladle in her right hand", refs: [{ file: "snaptest_book/hiyori_front_v1.png", role: "identity: front" }] })).cast;
    const ode = (await call("save_cast", { name: "Ode", details: "elderly man, grey hair, a round gold monocle on his right eye, black suit", refs: [{ file: "snaptest_book/tomoshi_front_v1.png", role: "identity: front" }] })).cast;
    const place = (await call("save_location", { name: "Cart", master: { file: "snaptest_book/MASTER_shrine_v1.png" }, plates: [{ name: "counter", file: "snaptest_book/P1_torii_eyelevel.png" }] })).location;
    const book = (await call("create_book", { name: "Bowl", medium: "anime", cast: [aya, ode], locations: [place] })).book;
    await B(async (B, { book, aya, ode }) => {
      const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { title: "Bowl", props: [{ id: "ladle", name: "the ladle" }, { id: "monocle", name: "the monocle" }, { id: "bowl", name: "the bowl" }], beats: [
        { id: "b1", order: 1, told: 1, text: "Ode sits at the counter; Aya stirs the pot.", changes: [{ entity: aya, path: "mood", op: "set", value: "confident grin" }, { entity: ode, path: "carried.worn", op: "add", value: "prop:monocle" }] },
        { id: "b2", order: 2, told: 2, text: "Aya sets the bowl down in front of Ode.", changes: [{ entity: aya, path: "carried.right_hand", op: "remove", value: "prop:ladle" }, { entity: "prop:bowl", path: "holder", op: "set", value: "the counter in front of Ode" }, { entity: "prop:ladle", path: "holder", op: "set", value: "hanging on the pot rail" }] },
        { id: "b3", order: 3, told: 3, text: "Ode sips; the monocle drops into his hand.", changes: [{ entity: ode, path: "carried.worn", op: "remove", value: "prop:monocle" }, { entity: ode, path: "carried.left_hand", op: "set", value: "prop:monocle" }] }] }, { note: "written by the person" });
    }, { book, aya, ode });
    const c1 = await call("add_cut", { book, scene_name: "Night", beats: ["b1"], cast: [aya, ode], location: place, plate: "counter", seconds: 3 });
    const c2 = await call("add_cut", { book, scene: c1.scene, beats: ["b2"], cast: [aya, ode], props: ["prop:bowl", "prop:ladle"], location: place, plate: "counter", seconds: 3, blocking: "Aya holds the ladle in her right hand over the pot" });
    const c3 = await call("add_cut", { book, scene: c1.scene, beats: ["b3"], cast: [ode], props: ["prop:bowl"], location: place, plate: "counter", seconds: 3, blocking: "Ode raises the bowl to his lips" });
    R.s1 = await call("compile_unit", { scene: c1.scene, shot: c1.shot });
    R.s2 = await call("compile_unit", { scene: c2.scene, shot: c2.shot });
    R.s3 = await call("compile_unit", { scene: c3.scene, shot: c3.shot });
    await call("open_view", { view: "book", book, lens: "cut_bag" }); await page.waitForTimeout(2000);
    R.sheetLeftOut = await page.locator(".snap-book-leftout").allTextContents();
    R.sheetOpens = await page.locator(".snap-book-unit").nth(2).textContent().catch((e) => e.message);
    await page.locator(".snap-book-unit").nth(2).scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, "compile_c3.png") });
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    // F-L02 through apply_unit: C2's prompt keeps no ladle-in-hand clause
    await call("open_shot", { scene: c2.scene, shot: c2.shot }); await page.waitForTimeout(1200);
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    R.apply2 = await call("apply_unit", { scene: c2.scene, shot: c2.shot });
    R.prompt2 = await page.evaluate(() => window.__E.getValue("render", "render", "prompt"));
    R.reapply2 = await call("apply_unit", { scene: c2.scene, shot: c2.shot });
    R.prompt2b = await page.evaluate(() => window.__E.getValue("render", "render", "prompt"));
    const run2 = await call("run", { question: "C2 at b2" });
    R.take2 = await waitTake(`take-${run2.run}`);
    // F-L20 + F-L14 + F-L04: C1's approved board is its re-board context; make_board sends the role line once and pins the story
    R.setBoard = await call("set_board", { scene: c1.scene, shot: c1.shot, file: "snaptest_book/g6_board_c1.png", approved: true });
    R.s1b = await call("compile_unit", { scene: c1.scene, shot: c1.shot });
    R.makeBoard = await call("make_board", { scene: c1.scene, shot: c1.shot, count: 1, seeds: [7], method: "ph3_view" });
    R.boardQueued = A.queued.map((q) => q.extra?.extra_pnginfo?.workflow?.extra?.snap?.story ?? null).filter((s) => s?.role === "board");
    R.boardTake = R.makeBoard?.candidates?.[0]?.take ? await waitTake(R.makeBoard.candidates[0].take) : null;
    // F-L10: a copy of C2's shot carries no story pin; apply_unit {land} compiles C2 there and leaves C2's shot alone
    await call("open_shot", { scene: c1.scene, shot: c1.shot }); await page.waitForTimeout(1500); // C2's tab is saved to its workflow file on leaving it
    const side = await call("add_shot", { scene: c1.scene, name: "C2 test", from: { scene: c2.scene, shot: c2.shot } });
    R.side = side;
    const wf = (scene, shot) => page.evaluate(async ([scene, shot]) => { await window.__SC.load(); const s = window.__SC.get(scene), x = s.shots.find((y) => y.id === shot); if (!x?.workflow) return null; const r = await window.__SC.read?.(x.workflow).catch(() => null); return r ?? (await (await fetch(`/api/userdata/${encodeURIComponent(x.workflow)}`)).json()); }, [scene, shot]);
    const shotId = side?.shot?.id ?? side?.shot;
    R.copyGraph = await wf(c1.scene, shotId);
    R.sourcePin = (await wf(c2.scene, c2.shot))?.extra?.snap?.story ?? null;
    R.c2Before = JSON.stringify(await wf(c2.scene, c2.shot));
    R.land = await call("apply_unit", { scene: c2.scene, shot: c2.shot, land: { scene: c1.scene, shot: shotId } });
    const runL = await call("run", { question: "C2 at b2, landed off the Cut" });
    R.takeLand = await waitTake(`take-${runL.run}`);
    R.c2After = JSON.stringify(await wf(c2.scene, c2.shot));
    R.landBad = await call("apply_unit", { scene: c2.scene, shot: c2.shot, land: { scene: c1.scene } });
    // F-L05: a louder version of C2's take carries its pins
    // (a CPU run makes a still: the parent here is C2's take as a video take, its pins as they are; fwork turns the louder prompt into a 64 px one)
    R.louder = await page.evaluate(async (id) => { const t = window.__T.get(id); if (!t) return null; const v = { ...structuredClone(t), id: "take-g6-video", prompt_id: "g6-video", number: 99, media: [{ kind: "video", filename: "g6_parent.mp4", subfolder: "snaptest", type: "output" }] }; await window.__T.save(v); return window.__ED.louder(window.__T.get("take-g6-video"), "agent"); }, R.take2?.id);
    R.louderParent = await waitTake("take-g6-video");
    R.louderTake = R.louder?.take ? await waitTake(R.louder.take) : null;
    // F-L03: Aya's mood at b1 changes (C1, C2 move; C2's take goes stale), then the cost of a second b1 edit names the
    // cuts and the takes already stale that it flags again
    await B(async (B, { book, aya }) => { const st = B.storyOf(B.bookOf(book).body), next = structuredClone(st.body); next.beats[0].changes.find((c) => c.entity === aya).value = "calm"; await B.saveStory(st.id, next, { note: "mood" }); }, { book, aya });
    R.stale = await call("story_stale", { book });
    R.cost = await B(async (B, { book, ode }) => { const st = B.storyOf(B.bookOf(book).body), next = structuredClone(st.body); next.beats[0].changes.push({ entity: ode, path: "mood", op: "set", value: "tired" }); return B.reversalCost(book, next); }, { book, ode });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `g6book-${Date.now()}`); // the placeholders go back out (moved, never deleted), as test_u101 does
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
  const S = R, ent = (s, name) => s?.entities?.find((e) => e.name === name), field = (s, name, p) => ent(s, name)?.fields?.find((f) => f.path === p);
  const desc2 = S.s2?.prompt?.description ?? "", still2 = S.s2?.still_prompt ?? "", sent3 = (S.s3?.prompt?.sentences ?? []).map((x) => x.text);
  const count = (s, re) => (String(s ?? "").match(re) ?? []).length;
  const checks = {
    ladleKeptAtB1: /a steel ladle in her right hand/.test(S.s1?.still_prompt ?? "") && !ent(S.s1, "Aya")?.cast_line?.left_out,
    ladleLeftOutAtB2: ent(S.s2, "Aya")?.cast_line?.left_out?.[0]?.clause === "a steel ladle in her right hand" && ent(S.s2, "Aya").cast_line.left_out[0].beat === "b2" && /left out: b2 c1/.test(ent(S.s2, "Aya").cast_line.left_out[0].said) && !/steel ladle/.test(still2) && /Aya is young woman, orange-red ponytail, green apron\./.test(still2) && /Aya's right hand is empty\./.test(still2),
    applyKeepsFold: !/steel ladle/.test(S.prompt2 ?? "") && /green apron/.test(S.prompt2 ?? "") && S.apply2?.said?.some((x) => /Aya: Cast line 'a steel ladle in her right hand' left out/.test(x)),
    reapplyNoDuplicate: count(S.prompt2b, /green apron/g) === 1,
    monocleFolds: ent(S.s3, "Ode")?.cast_line?.left_out?.[0]?.clause === "a round gold monocle on his right eye" && ent(S.s3, "Ode").cast_line.opens === "elderly man, grey hair, a round gold monocle on his right eye, black suit",
    lintBlockingHand: S.s2?.lint?.some((x) => /^the blocking says "Aya holds the ladle in her right hand over the pot" while Aya's right hand is empty\. \(b2 c1\)/.test(x)),
    holderSentences: /The bowl is on the counter in front of Ode\./.test(desc2) && /The ladle is hanging on the pot rail\./.test(desc2) && !/'s hand\./.test(desc2.replace(/is in Ode's hand/, "")),
    moodSentence: /Aya has a confident grin\./.test(S.s1?.still_prompt ?? ""),
    opensBeforeBeat: S.s3?.opens?.after === "b2" && /Ode wears the monocle\./.test(S.s3.opens.still_prompt) && /a round gold monocle on his right eye/.test(S.s3.opens.still_prompt) && !/Ode wears the monocle/.test(S.s3.still_prompt) && /Ode holds the monocle in the left hand\./.test(S.s3.still_prompt),
    videoStartEnd: sent3.includes("At the start of the cut, Ode wears the monocle."),
    openingBoardUsesOpening: /Ode wears the monocle\./.test(S.s3?.board?.prompt ?? "") && S.s3?.board?.role === "opening",
    lintRaisedBowl: S.s3?.lint?.some((x) => /^the blocking says "Ode raises the bowl to his lips" while the bowl is on the counter in front of Ode\./.test(x)),
    roleLineOnce: count(S.s1?.board?.prompt, /This frame is the moment the cut starts/g) === 1,
    reboardOwnBoard: S.s1b?.board?.pictures?.some((p) => p.label === "C1's approved board") && /is C1's approved board: keep its blocking/.test(S.s1b.board.prompt) && /re-boarding keeps its blocking/.test(S.s1b.board.context ?? ""),
    makeBoardOnce: count(S.makeBoard?.prompt, /This frame is the moment the cut starts/g) === 1 && /keep its blocking/.test(S.makeBoard?.prompt ?? ""),
    boardPinsStory: S.boardQueued?.length === 1 && S.boardQueued[0].unit?.shot === S.s1b?.shot && !!S.boardQueued[0].from && S.boardTake?.story?.role === "board",
    copyDropsPin: !!S.sourcePin && !!S.copyGraph && !S.copyGraph?.extra?.snap?.story,
    landLeavesCut: !!S.land?.landed && S.c2Before === S.c2After && S.land.said?.some((x) => /own shot and the Cut are unchanged/.test(x)),
    landPins: S.takeLand?.story?.unit?.shot === S.s2?.shot && S.takeLand.story.landed?.shot === (S.side?.shot?.id ?? S.side?.shot),
    landNeedsShot: /land is \{scene, shot\}/.test(S.landBad?.error ?? ""),
    louderPins: S.louderTake?.parent?.method === "louder" && JSON.stringify(S.louderTake.story) === JSON.stringify(S.louderParent?.story) && !!S.louderTake.story && JSON.stringify(S.louderTake.world) === JSON.stringify(S.louderParent?.world) && !!S.louderTake.world,
    staleBoardAndLanded: S.stale?.stale?.some((x) => x.board === "board") && S.stale.stale.some((x) => x.landed && x.take === S.takeLand?.id) && S.stale.stale.some((x) => x.take === S.take2?.id),
    costNamesCuts: S.cost?.cuts?.map((c) => c.cut).join() === "C1,C2,C3" && /^changes the compile of C1 \(Ode\.mood\), C2 \(Ode\.mood\), C3 \(Ode\.mood\)/.test(S.cost?.said ?? ""),
    costAlso: S.cost?.also >= 1 && /already stale (is|are) now also stale for Ode\.mood/.test(S.cost?.said ?? "") && S.cost.moves === true,
    sheetNamesFold: S.sheetLeftOut?.some((x) => /Aya: Cast line 'a steel ladle in her right hand' left out: b2 c1/.test(x)) && /Opens: the cut opens on the state after b2/.test(S.sheetOpens ?? ""),
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g6_book_result.json"), JSON.stringify(R, null, 1));
  console.log(`g6book ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
