// U97 the Book, §11.5 steps 3-6 + the production style (SNAP-R68, R69, R130) on the CPU test server:
// - compile_unit: C3 (at b3, before the hand-over) compiles "Kon holds the letter in the right hand" with provenance
//   story:<id>@n b2 change c1; C5 (at b5) "Ferro holds the letter in the right hand" and "The letter is in Ferro's
//   hand" from b4; a flashback beat (told before b4, happens first) folds by story order (Kon holds nothing yet);
// - the production style: its paragraph first in the description and the still prompt; palette monochrome notes the
//   colour words in Kon's Cast line (a note, the compile still runs);
// - settei per state: Kon's oilskin from b6 compiles "words only" until save_cast_state gives it a picture, then the
//   package cites it as "state: oilskin" and Kon's new Cast version names the take it came from;
// - stale on the story clock: apply_unit + run on C5; editing b4's intent flags nothing; editing b4's change (Ferro
//   holds the map) flags the take "Ferro.carried.right_hand changed at b4"; the reversal cost of that edit, asked
//   before it is saved, names the cut whose compile moves and "re-flags 1 take" (F-L03);
// - the script supervisor: a beat pasted with no changes gets two add_change proposals (the docket shows them), Accept
//   lands them with the proposal ids; keep_as_canon from a take proposes a change on that take's beat;
// - the Beat sheet's Kon lane shows the oilskin picture at b6, its cells under their beats.
// Screens: ui/u97/book_cut_bag.png (the compiled state sheet), book_settei.png, book_beat_lanes.png. usage: node test_book_compile.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = process.env.SHOTS || path.join(CFG.out, "ui", "u97");
const base = process.argv[3] || CFG.base;
const D = CFG.fixture("short04");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const d of ["book", "story", "look", "scenes", "takes", "_archived/book", "_archived/story", "_archived/look"]) park(d); // moved, never deleted
  const fx = path.join(base, "input", "snaptest_book");
  fs.mkdirSync(fx, { recursive: true });
  for (const f of ["bible/hiyori_front_v1.png", "bible/tomoshi_front_v1.png", "bible/hiyori_back_v1.png", "settei_bg/MASTER_shrine_v1.png"]) fs.copyFileSync(path.join(D, f), path.join(fx, path.basename(f)));
  // a 2 s voice line for Ferro's voice settei (a tone: the cite is what is checked, not the voice)
  if (!fs.existsSync(path.join(fx, "ferro_line.wav"))) require("child_process").execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=180:duration=2", path.join(fx, "ferro_line.wav")]);
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const accept = (id) => page.evaluate(async (id) => { const p = await window.__P.decide(id, true, (n, a) => window.__X.callTool(n, a, { confirmed: true })); return { status: p?.status, result: p?.result }; }, id);
    const B = (fn, arg) => page.evaluate(async ([src, arg]) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); return (new Function("B", "arg", `return (${src})(B, arg)`))(B, arg); }, [fn.toString(), arg]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const kon = (await call("save_cast", { name: "Kon", details: "a girl with a yellow scarf and amber eyes", refs: [{ file: "snaptest_book/hiyori_front_v1.png", role: "identity: front" }] })).cast;
    const ferro = (await call("save_cast", { name: "Ferro", details: "an old lighthouse keeper", refs: [{ file: "snaptest_book/tomoshi_front_v1.png", role: "identity: front" }], voice: { file: "snaptest_book/ferro_line.wav", casting: "old man, low gravelly baritone, slow" } })).cast;
    const book = (await call("create_book", { name: "The lamp room", medium: "anime", cast: [kon, ferro] })).book;
    // the person writes the story (the agent path is test_book_story's): b1-b7 and a flashback told fourth
    R.story = await B(async (B, { book, kon, ferro }) => {
      const b = B.bookOf(book), st = B.storyOf(b.body);
      const story = { title: "The lamp room", props: [{ id: "letter", name: "the letter" }, { id: "map", name: "the old map" }], beats: [
        { id: "fb", order: 0, told: 3.5, text: "Years ago, Ferro lights the north light for the first time." },
        { id: "b1", text: "Kon climbs the stairs at dusk." },
        { id: "b2", text: "Kon finds the sealed letter.", changes: [{ entity: kon, path: "carried.right_hand", op: "set", value: "prop:letter", why: "picks it up" }] },
        { id: "b3", text: "Kon waits at the door of the lamp room." },
        { id: "b4", text: "Kon hands Ferro the letter.", intent: "Ferro decides to trust her", changes: [{ entity: kon, path: "carried.right_hand", op: "set", value: null, why: "hands it over" }, { entity: ferro, path: "carried.right_hand", op: "set", value: "prop:letter" }, { entity: "prop:letter", path: "holder", op: "set", value: ferro }] },
        { id: "b5", text: "Ferro reads the letter by the lamp.", lines: [{ who: ferro, text: "So the north light closes tonight." }] },
        { id: "b6", text: "Kon pulls on the oilskin against the rain.", changes: [{ entity: kon, path: "wardrobe", op: "set", value: "the oilskin" }] },
        { id: "b7", text: "Kon steps out onto the gallery in the storm." } ].map((x, i) => ({ order: i, told: i, ...x })),
        groups: [{ id: "sc1", kind: "scene", name: "Lamp room, dusk", beats: ["b1", "b2", "b3", "b4", "b5"] }, { id: "sc2", kind: "scene", name: "The gallery, storm", beats: ["b6", "b7"] }] };
      const out = await B.saveStory(st.id, story, { note: "written by the person" });
      return { ref: out.ref, beats: B.storyOf(B.bookOf(book).body).body.beats.map((x) => [x.id, x.order, x.told]) };
    }, { book, kon, ferro });
    const c3 = await call("add_cut", { book, scene_name: "Lamp room, dusk", beats: ["b3"], cast: [kon], props: ["prop:letter"], seconds: 4 });
    const c5 = await call("add_cut", { book, scene: c3.scene, beats: ["b5"], cast: [kon, ferro], props: ["prop:letter"], seconds: 4, sound: "paper rustling, the lamp's clockwork ticking" });
    const cfb = await call("add_cut", { book, scene: c3.scene, beats: ["fb"], cast: [kon, ferro], seconds: 3 });
    const c7 = await call("add_cut", { book, scene_name: "The gallery, storm", beats: ["b7"], cast: [kon], seconds: 4 });
    R.cutsTelling = (await call("get_book", { book })).units?.map((u) => u.cut);
    R.s3 = await call("compile_unit", { scene: c3.scene, shot: c3.shot });
    R.s5 = await call("compile_unit", { scene: c5.scene, shot: c5.shot });
    R.sfb = await call("compile_unit", { scene: cfb.scene, shot: cfb.shot });
    R.s7words = await call("compile_unit", { scene: c7.scene, shot: c7.shot });
    const sent = (s) => (s?.prompt?.sentences ?? []).map((x) => [x.text, x.from]);
    R.sent3 = sent(R.s3); R.sent5 = sent(R.s5); R.sentfb = sent(R.sfb);
    R.oilskinWords = R.s7words.entities?.[0]?.fields?.find((f) => f.path === "wardrobe")?.backing;
    // the production style: paragraph first, palette monochrome, Kon's colour words noted
    R.style = await call("save_style", { book, name: "Ink", paragraph: "A black-and-white manga ink drawing with bold brush lines and screentone shading.", palette: "monochrome", voice: "Japanese TV anime seiyuu delivery", genre: "quiet drama: holds and negative space" });
    R.s3style = await call("compile_unit", { scene: c3.scene, shot: c3.shot });
    R.lint = R.s3style.lint; R.desc = R.s3style.prompt?.description; R.still = R.s3style.still_prompt;
    // settei per state: a picture for the oilskin, from a still take
    R.stillTake = await page.evaluate(async () => { const T = window.__T; await T.save({ id: "take-book-oilskin", kind: "run", prompt_id: "book-oilskin", created: Date.now(), seconds: 1, group: "book-test", number: 1, status: "success", text: "oilskin", seed: 1, media: [{ kind: "image", filename: "hiyori_back_v1.png", subfolder: "snaptest_book", type: "input" }], prompt: {}, graph: {}, verdict: null, notes: [] }); return "take-book-oilskin"; });
    R.state = await call("save_cast_state", { cast: kon, state: "oilskin", covers: { wardrobe: "the oilskin" }, pictures: [{ take: "take-book-oilskin", view: "back" }] });
    R.s7 = await call("compile_unit", { scene: c7.scene, shot: c7.shot });
    R.pkg7 = R.s7.package?.map((p) => p.role);
    R.oilskinPic = R.s7.entities?.[0]?.fields?.find((f) => f.path === "wardrobe")?.backing;
    R.konNote = await page.evaluate(async (kon) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); const r = W.record("cast", kon.split(":")[1]); return r.versions.at(-1).note; }, kon);
    // stale: a take of C5, then two edits of b4
    await call("open_shot", { scene: c5.scene, shot: c5.shot }); await page.waitForTimeout(1200);
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    R.apply5 = await call("apply_unit", { scene: c5.scene, shot: c5.shot });
    R.prompt5 = await page.evaluate(() => window.__E.getValue("render", "render", "prompt"));
    R.world5 = await page.evaluate(() => Object.keys(window.__E.state().world ?? {}));
    const run = await call("run", { question: "does Ferro hold the letter in C5?" });
    for (let i = 0; i < 40; i++) { const s = await call("run_status", { run: run.run, wait_s: 5 }); if (s.state === "done" || s.state === "failed") { R.run = s.state; break; } }
    R.take5 = `take-${run.run}`;
    R.atB3 = await call("compile_unit", { scene: c5.scene, shot: c5.shot, beats: ["b3"] }); // the Beat slot: the same cut, before the hand-over
    R.stale0 = await call("story_stale", { book });
    await B(async (B, book) => { const b = B.bookOf(book), st = B.storyOf(b.body); await B.saveStory(st.id, B.withEdit(st.body, "b4", { intent: "Ferro trusts her at last" }), { note: "intent reworded" }); }, book);
    R.staleIntent = await call("story_stale", { book });
    R.cost = await B(async (B, { book, ferro }) => { const st = B.storyOf(B.bookOf(book).body), next = structuredClone(st.body), c = next.beats.find((x) => x.id === "b4").changes.find((x) => x.entity === ferro); c.value = "prop:map"; return B.reversalCost(book, next); }, { book, ferro });
    await B(async (B, { book, ferro }) => { const st = B.storyOf(B.bookOf(book).body), next = structuredClone(st.body), c = next.beats.find((x) => x.id === "b4").changes.find((x) => x.entity === ferro); c.value = "prop:map"; await B.saveStory(st.id, next, { note: "Ferro takes the map instead" }); }, { book, ferro });
    R.staleChange = await call("story_stale", { book });
    // the script supervisor: a beat with no changes, two proposals, accepted
    const nb = await call("add_beat", { book, text: "Kon gives Ferro the lamp key.", after: "b5" });
    await accept(nb.proposed);
    const p1 = await call("add_change", { book, beat: "b8", entity: kon, path: "carried.left_hand", op: "set", value: null, why: "gives the key" });
    const p2 = await call("add_change", { book, beat: "b8", entity: ferro, path: "carried.left_hand", op: "set", value: "the lamp key" });
    R.supDocket = ((await call("list_docket", {})).rows ?? []).filter((r) => r.source === "proposal").map((r) => r.title);
    R.supAccept = [(await accept(p1.proposed)).status, (await accept(p2.proposed)).status];
    R.b8 = (await call("get_book", { book })).story?.beats.find((x) => x.id === "b8")?.changes.length;
    R.canon = await call("keep_as_canon", { take: R.take5, entity: ferro, path: "injuries", op: "add", value: "a cut on the left hand" });
    R.canonAccept = await accept(R.canon.proposed);
    R.b5after = (await call("get_book", { book })).story?.beats.find((x) => x.id === "b5")?.changes.map((c) => [c.path, c.why]);
    R.versionsByAgent = await B(async (B, book) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); const st = B.storyOf(B.bookOf(book).body); return W.record("story", st.id).versions.filter((v) => v.by === "agent" && v.body.beats.length && !/accepted proposal p\d+/.test(v.note)).length; }, book);
    // screens: the compiled state sheet (Cut bag) and Settei
    await call("open_view", { view: "book", book, lens: "cut_bag" }); await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(out, "book_cut_bag.png") });
    R.cutBagText = await page.evaluate(() => document.querySelector(".snap-book-sheet")?.textContent ?? "");
    await call("open_view", { view: "book", book, lens: "settei" }); await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, "book_settei.png") });
    R.setteiText = await page.evaluate(() => document.querySelector(".snap-book-sheet")?.textContent ?? "");
    await call("open_view", { view: "book", book, lens: "beat_sheet" }); await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, "book_beat_lanes.png") });
    R.laneThumbs = await page.evaluate(() => document.querySelectorAll(".snap-book-lane-thumb").length);
    R.aligned = await page.evaluate(() => { const c = document.querySelectorAll(".snap-book-beat")[0]?.getBoundingClientRect(), l = document.querySelectorAll(".snap-book-lane-cell")[0]?.getBoundingClientRect(); return c && l ? Math.abs(c.left - l.left) : null; });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {}); // G3: never leave Let agents run on for the next suite (LESSONS G1b)
    await b.close();
  }
  const S = R, fromOf = (list, re) => list?.find(([t]) => re.test(t))?.[1] ?? "";
  const checks = {
    flashbackToldFourth: JSON.stringify(S.cutsTelling) === JSON.stringify(["C1", "C3", "C2", "C4"]),
    c3HoldsLetter: S.sent3?.some(([t]) => t === "Kon holds the letter in the right hand.") && /^story:story-[\w]+@\d+ b2 change c1$/.test(fromOf(S.sent3, /^Kon holds/)),
    c5FerroHolds: S.sent5?.some(([t]) => t === "Ferro holds the letter in the right hand.") && S.sent5?.some(([t]) => t === "The letter is in Ferro's hand.") && / b4 change c2$/.test(fromOf(S.sent5, /^Ferro holds/)) && S.sent5?.some(([t]) => t === "Kon's right hand is empty."),
    flashbackFoldsByOrder: S.sentfb?.length === 1 && S.sfb?.at?.beat === "fb",
    wordsOnlyFirst: S.oilskinWords === "words only",
    styleFirst: S.desc?.startsWith("A black-and-white manga ink drawing") && S.still?.startsWith("A black-and-white manga ink drawing with bold brush lines and screentone shading.\n\nKon waits"),
    paletteLint: S.lint?.some((x) => /Kon's Cast line names colours \(yellow, amber\)/.test(x)),
    statePicture: S.oilskinPic === "picture: state oilskin" && S.pkg7?.[0] === "state: oilskin, back" && /take-book-oilskin/.test(S.konNote ?? ""),
    voiceCited: /Ferro says "So the north light closes tonight\." in the voice of <Audio 1>\./.test(S.prompt5 ?? "") && !/gravelly|baritone/.test(S.prompt5 ?? ""),
    applied: /^integrated_multimodal_description: \[Shot 3\] A black-and-white manga ink drawing.*Ferro holds the letter in the right hand\./.test(S.prompt5 ?? "") && /overall_soundscape: paper rustling/.test(S.prompt5 ?? "") && S.world5?.some((r) => r.startsWith("look:")),
    ran: !!S.staleChange?.stale?.[0]?.take && S.prompt5?.includes("Kon is <Picture") && S.prompt5?.includes("Ferro is <Picture"),
    beatSlot: R.atB3?.at?.beat === "b3" && R.atB3.prompt.sentences.some((x) => x.text === "Kon holds the letter in the right hand."),
    nothingStaleAtFirst: S.stale0?.stale?.length === 0,
    intentFlagsNothing: S.staleIntent?.stale?.length === 0,
    costBeforeSave: S.cost?.takes === 1 && /^changes the compile of C\d+ \(Ferro\.carried\.right_hand\); re-flags 1 take$/.test(S.cost?.said ?? ""), // F-L03: what moves, then what it flags
    changeFlagsTake: S.staleChange?.stale?.length === 1 && S.staleChange.stale[0].reasons.some((r) => r === "story: Ferro.carried.right_hand changed at b4") && S.staleChange.stale[0].take === S.take5,
    supervisorDocket: S.supDocket?.filter((t) => /^The lamp room: b8: /.test(t)).length === 2,
    supervisorAccepted: S.supAccept?.every((x) => x === "accepted") && S.b8 === 2,
    keepAsCanon: !!S.canon?.proposed && S.canonAccept?.status === "accepted" && S.b5after?.some(([p, w]) => p === "injuries" && /kept from take/.test(w)),
    noAgentVersionWithoutProposal: S.versionsByAgent === 0,
    sheetShowsProvenance: /b2 change c1|b4 change c2/.test(S.cutBagText ?? "") && /words only|state oilskin/.test(S.cutBagText ?? "") && !/\bnull\b/.test(S.cutBagText ?? ""),
    setteiShowsStyle: /Ink/.test(S.setteiText ?? "") && /oilskin/.test(S.setteiText ?? "") && !/\bnull\b/.test(S.setteiText ?? ""),
    laneShowsSettei: S.laneThumbs === 1 && S.aligned != null && S.aligned < 2,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_book_compile_result.json"), JSON.stringify(R, null, 1));
  console.log(`book_compile ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
