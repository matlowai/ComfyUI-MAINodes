// Batch G9, the Book (short05 follow-ups F-Q09, F-Q12, F-Q13, F-Q14) on the CPU test server:
// - SNAP-R181 (F-Q09): a cut whose own beat changes what a hand holds (b2 puts the ladle down to set the bowl "with both
//   hands") compiles opens.held and board_role key with a lint line naming it, its default board is the key (the state after
//   the beat with the beat's action), make_board draws the key and says why, set_board picks a key candidate as the key; a
//   cut whose beat takes something up from nothing keeps the opening; role: "opening" is still there when asked;
// - SNAP-R182 (F-Q13, F-Q14): design_state's prompt starts with the settei framing (the full body alone on a plain light
//   grey background), leaves the style's background sentence out (style_left_out), says the thing the state takes off is
//   absent though the Cast's picture shows it, writes the state's words as a sentence, and with `from` puts that picture
//   first (no if_kept); without it, if_kept says how to make one;
// - SNAP-R183 (F-Q12): exporting a Book alone carries its story and look (manifest carried), offers its Cast and places, says
//   how the zip reaches another install; after the Book, story and look are parked, importing the zip brings them back and
//   get_book opens;
// - SNAP-R184 (F-Q26): a board's packet names who should be in it (its cut's Cast), labels every picture it was made from
//   by its Picture number (the plate the place adds says "made from: Picture 1 C2's camera (= … plate P2 counter)"), and
//   carries a measuring copy (a 5 % grid with a 1 % ruler);
// - F-Q10: make_board and design_state with a method keep the purpose from what is in frame (character);
// - F-Q04: a stacked proposal's "with pN waiting: …" clause leaves its Work card row once pN is answered; F-Q02: a
//   remove_change proposal says what it takes back;
// - F-Q07: draw_set_plan names a label under another shape's line (its thickness counted); F-Q08: a redraw with no size or
//   aspect keeps the current plan picture's size (size_from); F-Q15: the Settei lens names a place this install lacks.
// usage: node test_g9_book.js [port] [base]   prints "g9book n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const D = CFG.fixture("short04"), snap = path.join(base, "user", "default", "snap");
const park = (dir) => { const p = path.join(snap, dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${dir.replaceAll("/", "_")}-g9-${Date.now()}`)); } };
const STYLE = "2D cel-shaded Japanese TV anime, crisp clean black lineart, flat colours with two-tone hard shading. Soft painted night backgrounds in deep blues, warm orange lantern light on faces and wood, light film grain.";
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "location", "candidates", "proposals.json"]) park(d); // moved, never deleted
  const fx = path.join(base, "input", "snaptest_book");
  fs.mkdirSync(fx, { recursive: true });
  for (const f of ["bible/hiyori_front_v1.png", "bible/tomoshi_front_v1.png", "settei_bg/MASTER_shrine_v1.png", "settei_bg/P1_torii_eyelevel.png"]) fs.copyFileSync(path.join(D, f), path.join(fx, path.basename(f)));
  // P-H3's weights as empty placeholders, as test_u101 does: New view queues, and fwork turns the prompt into a 64 px one
  const made = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"].map((x) => path.join(base, "models", x)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const B = (fn, arg) => page.evaluate(async ([src, arg]) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); return (new Function("B", "arg", `return (${src})(B, arg)`))(B, arg); }, [fn.toString(), arg]);
    const waitTake = (id) => page.evaluate(async (id) => { for (let i = 0; i < 240 && !window.__T.get(id); i++) await new Promise((r) => setTimeout(r, 500)); const t = window.__T.get(id); return t && { id: t.id, story: t.story ?? null }; }, id);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const mio = (await call("save_cast", { name: "Mio Hayase", details: "a 17-year-old girl ramen cook, a dark green apron, a steel ladle in her right hand", refs: [{ file: "snaptest_book/hiyori_front_v1.png", role: "identity: front" }] })).cast;
    const kuroe = (await call("save_cast", { name: "Baron Kuroe", details: "a tall thin elderly gourmet critic, a round gold monocle on his right eye on a thin gold chain, a black three-piece suit", refs: [{ file: "snaptest_book/tomoshi_front_v1.png", role: "identity: front" }] })).cast;
    const place = (await call("save_location", { name: "Hayase Yatai", master: { file: "snaptest_book/MASTER_shrine_v1.png" }, plates: [{ name: "P2 counter", file: "snaptest_book/P1_torii_eyelevel.png" }] })).location;
    const book = (await call("create_book", { name: "One More Bowl", medium: "anime", cast: [mio, kuroe], locations: [place] })).book;
    R.style = await call("save_style", { book, name: "TV anime", paragraph: STYLE });
    await B(async (B, { book, mio, kuroe }) => {
      const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { title: "One More Bowl", props: [{ id: "ladle", name: "the ladle" }, { id: "bowl", name: "the bowl" }, { id: "monocle", name: "the monocle" }], beats: [
        { id: "b1", order: 1, told: 1, text: "Mio ladles broth into a bowl.", changes: [{ entity: mio, path: "carried.right_hand", op: "set", value: "prop:ladle" }, { entity: "prop:bowl", path: "holder", op: "set", value: mio }, { entity: kuroe, path: "carried.worn", op: "add", value: "prop:monocle" }] },
        { id: "b2", order: 2, told: 2, text: "Mio sets the full bowl down on the counter in front of Kuroe with both hands and grins.", changes: [{ entity: mio, path: "carried.right_hand", op: "remove", value: "prop:ladle" }, { entity: "prop:bowl", path: "holder", op: "set", value: "on the counter in front of Kuroe" }] },
        { id: "b3", order: 3, told: 3, text: "Kuroe sips; the monocle pops off his eye.", changes: [{ entity: kuroe, path: "carried.worn", op: "remove", value: "prop:monocle" }] }] }, { note: "written by the person" });
    }, { book, mio, kuroe });
    const c1 = await call("add_cut", { book, scene_name: "Night", beats: ["b1"], cast: [mio, kuroe], props: ["prop:bowl"], location: place, plate: "P2 counter", seconds: 4 });
    const c2 = await call("add_cut", { book, scene: c1.scene, beats: ["b2"], cast: [mio, kuroe], props: ["prop:bowl"], location: place, plate: "P2 counter", seconds: 4, blocking: "Mio behind the counter, setting the bowl down in front of him with both hands, grinning" });

    // ---- F-Q09 ----
    R.s1 = await call("compile_unit", { scene: c1.scene, shot: c1.shot });
    R.s2 = await call("compile_unit", { scene: c2.scene, shot: c2.shot });
    R.mbKey = await call("make_board", { scene: c2.scene, shot: c2.shot, count: 1, seeds: [9221], method: "ph3_view" });
    R.mbOpen = await call("make_board", { scene: c2.scene, shot: c2.shot, count: 1, seeds: [9211], method: "ph3_view", role: "opening" });
    const keyTake = R.mbKey.candidates?.[0]?.prompt_id ? `take-${R.mbKey.candidates[0].prompt_id}` : null;
    R.keyTake = keyTake && await waitTake(keyTake);
    R.setKey = keyTake && await call("set_board", { scene: c2.scene, shot: c2.shot, take: keyTake });
    R.unit2 = await B((B, { scene, shot }) => B.unitOf(scene, shot).unit, { scene: c2.scene, shot: c2.shot });
    // F-Q26: the key board's packet
    const crow = keyTake && (await call("critique", { take: keyTake })).critique;
    R.pkContext = crow && await call("critique_packet", { critique: crow, part: "context" });
    R.pkTiles = crow && await call("critique_packet", { critique: crow, part: "tiles" });
    for (const k of ["pkContext", "pkTiles"]) if (R[k]?.images) R[k].images = R[k].images.length; // the pictures' bytes stay out of the result file

    // ---- F-Q13, F-Q14 ----
    R.design = await call("design_state", { book, cast: kuroe, state: "monocle off", covers: { "carried.worn": [] }, words: "both eyes bare, the monocle hangs on its chain", count: 1, seeds: [9401], method: "ph3_view" });
    R.designFrom = await call("design_state", { book, cast: kuroe, state: "monocle off", covers: { "carried.worn": [] }, words: "both eyes bare", count: 1, seeds: [9402], method: "ph3_view", from: { file: "snaptest_book/tomoshi_front_v1.png" } });

    // ---- F-Q04: a stacked proposal's "with pN waiting" clause goes once pN is answered; F-Q02: a removal says what it takes back
    const accept = (id) => page.evaluate(async (id) => (await window.__P.decide(id, true, (n, a) => window.__X.callTool(n, a, { confirmed: true })))?.status ?? null, id);
    R.pA = await call("add_change", { book, beat: "b1", entity: mio, path: "mood", op: "set", value: "calm and focused" });
    R.pB = await call("add_change", { book, beat: "b1", entity: kuroe, path: "mood", op: "set", value: "stern, arms crossed" });
    R.reasonBefore = await page.evaluate((id) => window.__P.reasonNow(window.__P.get(id)), R.pB.proposed);
    R.accA = await accept(R.pA.proposed);
    R.reasonAfter = await page.evaluate((id) => window.__P.reasonNow(window.__P.get(id)), R.pB.proposed);
    R.rowTitle = await page.evaluate(async (id) => { const A = await import("/extensions/ComfyUI-MAINodes/snap/activity.js"); await A.reconcile(); return A.all().find((r) => r.proposal === id)?.title ?? null; }, R.pB.proposed);
    const changeId = (await call("get_book", { book })).story?.beats?.find((x) => x.id === "b1")?.changes?.find((c) => c.path === "mood")?.id;
    R.pC = await call("remove_change", { book, beat: "b1", change: changeId });
    R.reasonC = await page.evaluate((id) => window.__P.get(id)?.reason ?? null, R.pC.proposed);

    // ---- F-Q07, F-Q08: a plan's labels under a line; a redraw keeps the plan's size ----
    const shapes = [{ kind: "line", x: 0.05, y: 0.5, x2: 0.46, y2: 0.5, width: 0.03, label: "road" }, { kind: "label", x: 0.47, y: 0.5, label: "GATE" }, { kind: "rect", x: 0.75, y: 0.5, w: 0.3, h: 0.4, label: "square" }];
    R.plan = await call("draw_set_plan", { location: place, shapes, size: 1400, aspect: 1.4 });
    R.replan = await call("draw_set_plan", { location: place, shapes, preview: true });
    if (R.replan?.images) R.replan.images = R.replan.images.length;

    // ---- F-Q12 ----
    R.exp = await call("export_records", { refs: [book] });
    for (const d of ["book", "story", "look"]) park(d);
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); });
    R.gone = await call("get_book", { book });
    R.imp = R.exp?.file ? await call("import_records", { file: R.exp.file, subfolder: R.exp.subfolder, type: R.exp.type }) : null;
    R.back = await call("get_book", { book });
    // F-Q15: a place the Book names that isn't on this install is named (from a take's pin) with how to bring it
    park("location");
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); });
    await call("open_view", { view: "book", book, lens: "settei" }); await page.waitForTimeout(1500);
    R.missing = await page.locator(".snap-cast-missing").allTextContents();
    await page.keyboard.press("Escape");
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
  }
  const S = R, lint2 = (S.s2?.lint ?? []).join("\n"), p = S.design?.prompt ?? "", pf = S.designFrom?.prompt ?? "", carried = (S.exp?.manifest?.carried ?? []).map((x) => x.ref.split(":")[0]).sort();
  const checks = {
    heldOnTheCut: S.s2?.opens?.board_role === "key" && (S.s2.opens.held ?? []).some((x) => x.who === "Mio Hayase" && x.path === "carried.right_hand") && (S.s2.opens.held ?? []).some((x) => x.path === "holder"),
    heldLint: /C2's own beat b2 changes what is held \(Mio Hayase holds the ladle in the right hand\..*→ .*Mio Hayase's right hand is empty\..*with both hands.*make_board draws the key/s.test(lint2),
    defaultBoardIsKey: S.s2?.board?.role === "key" && /This frame is the beat at its peak\./.test(S.s2.board.prompt ?? "") && !/holds the ladle/.test(S.s2.board.prompt ?? "") && /right hand is empty/.test(S.s2.board.prompt ?? ""),
    takeUpKeepsOpening: !S.s1?.opens?.held && S.s1?.board?.role === "opening",
    purposeWithMethod: S.mbKey?.chosen?.purpose === "character" && S.design?.chosen?.purpose === "character",
    makeBoardKey: S.mbKey?.role === "key" && /changes what is held/.test(S.mbKey?.role_why ?? "") && S.keyTake?.story?.role === "key",
    openingStillAsked: S.mbOpen?.role === "opening" && !S.mbOpen?.role_why && /moment the cut starts/.test(S.mbOpen?.prompt ?? ""),
    setBoardPicksKey: S.setKey?.role === "key" && !!S.unit2?.key?.file && !S.unit2?.board,
    setteiFramingFirst: p.startsWith("2D cel-shaded Japanese TV anime, crisp clean black lineart, flat colours with two-tone hard shading.\n\nA settei (model sheet) of Baron Kuroe in this state: front view, the full body from head to feet, standing alone on a plain light grey background"),
    styleBackgroundOut: !/night backgrounds/.test(p) && (S.design?.style_left_out ?? []).some((x) => /Soft painted night backgrounds/.test(x.sentence)),
    itemAbsent: /Baron Kuroe is without a round gold monocle on his right eye on a thin gold chain here, though <Picture 1> shows it\./.test(p) && !/<Picture 1> is Baron Kuroe, [^.]*monocle/.test(p),
    wordsSentence: /Both eyes bare, the monocle hangs on its chain\./.test(p),
    ifKept: /edit_from_context/.test(S.design?.if_kept ?? "") && /from: \{take\}/.test(S.design?.if_kept ?? ""),
    fromFirst: /<Picture 1> is Baron Kuroe in this state already\. <Picture 2> is Baron Kuroe/.test(pf) && /though <Picture 2> shows it/.test(pf) && !S.designFrom?.if_kept && !S.designFrom?.error,
    exportCarries: JSON.stringify(carried) === JSON.stringify(["look", "story"]) && (S.exp?.manifest?.records ?? []).length === 3,
    exportOffers: (S.exp?.offered ?? []).length === 3 && /upload\/image/.test(S.exp?.to_another_install ?? ""),
    goneThenBack: !!S.gone?.error && !S.back?.error && (S.imp?.records ?? []).length === 3 && !!S.back?.story,
    boardPacketCast: JSON.stringify([...(S.pkContext?.words?.who_should_be_here ?? [])].sort()) === JSON.stringify(["Baron Kuroe", "Mio Hayase"]),
    boardPacketNumbered: (S.pkContext?.pictures ?? []).some((x) => /^context · made from: Picture 1 C2's camera \(= Hayase Yatai v\d+, plate P2 counter\)/.test(x.label)) && [2, 3].every((n) => (S.pkContext?.pictures ?? []).some((x) => x.label.includes(`made from: Picture ${n} `))),
    boardMeasure: (S.pkTiles?.pictures ?? []).some((x) => x.tile?.cell === "measure" && /measure: a 5 % grid with its pixel positions and a 1 % ruler/.test(x.label)) && S.pkContext?.words?.checklist === "board",
    planLabelUnderLine: (S.plan?.labels ?? []).some((l) => l.label === "GATE" && (l.under_lines ?? []).some((x) => /^shape 0 \(line "road"\)$/.test(x))) && !(S.plan?.labels ?? []).some((l) => l.label === "road" || l.label === "square"),
    redrawKeepsSize: S.replan?.size_from === "the current plan, 1400x1000" && JSON.stringify(S.replan?.size) === "[1400,1000]" && /under a line/.test(S.replan?.said ?? ""),
    missingPlaceNamed: (S.missing ?? []).some((x) => /^Hayase Yatai isn't on this install \(location:[\w-]+\): import it/.test(x)),
    stackClauseGoes: /with p\d+ waiting/.test(S.reasonBefore ?? "") && S.accA === "accepted" && !!S.reasonAfter && !/waiting/.test(S.reasonAfter) && S.rowTitle === S.reasonAfter,
    removalSaysWhat: /^One More Bowl: b1: take back Mio Hayase's mood → calm and focused/.test(S.reasonC ?? ""),
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g9_book_result.json"), JSON.stringify(R, null, 1));
  console.log(`g9book ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
