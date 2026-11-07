// Batch G7, the Book (CONCEPT_PRODUCTION §11.5 steps 6 and 11 rest; short05 story-pass leftovers) on the CPU test server:
// - F-L08 the Beat sheet's lanes read a change by its op ("carried.right_hand − the ladle"), a lane per prop, a beat's
//   lines on its card, a payoff by the words of its plant;
// - F-L15 waiting changes show in the lanes as ghosts under their beat (an accepted beat and a proposed one, which is a
//   ghost column on the spine);
// - F-L06 a stacked proposal's reversal cost is its own (over the waiting ones it builds on), the stack's apart;
// - F-L11 a prop's holder and the people carrying it agree, or a lint line / a Beat sheet flag says where they don't;
//   state_at of a prop names who carries it;
// - F-L12 a long beat's proposal title is whole; an edit_beat names its line; F-L16 add_group and a prop's name on add_change;
// - the colour script (SNAP-R175): one frame per scene group, the strip offers the cuts' approved boards, the person's
//   Use makes a story version, an agent's set_colour_frame waits as a proposal;
// - Settei design it (SNAP-R176): design_state lands candidates pinned {role: settei} in "Settei · <Book>", the Settei
//   lens shows them, Use this saves the state's picture as a new Cast version by the person.
// Screens: ui/g7/beat_sheet.png, ui/g7/settei.png. usage: node test_g7_book.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g7");
const base = process.argv[3] || CFG.base;
const D = CFG.fixture("short04");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "location", "candidates", "proposals.json"]) park(d); // moved, never deleted
  const fx = path.join(base, "input", "snaptest_book");
  fs.mkdirSync(fx, { recursive: true });
  for (const f of ["bible/hiyori_front_v1.png", "bible/tomoshi_front_v1.png", "settei_bg/MASTER_shrine_v1.png", "settei_bg/P1_torii_eyelevel.png"]) fs.copyFileSync(path.join(D, f), path.join(fx, path.basename(f)));
  fs.copyFileSync(path.join(D, "bible/hiyori_back_v1.png"), path.join(fx, "g7_board_c1.png")); // a board of its own (References keeps one slot per file)
  // P-H3's weights as empty placeholders, as test_u101 does: New view queues, and fwork turns the prompt into a 64 px one
  const made = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"].map((x) => path.join(base, "models", x)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const person = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a, { confirmed: true }).catch((e) => ({ error: e.message })), [name, args]);
    const accept = (id) => page.evaluate(async (id) => (await window.__P.decide(id, true, (n, a) => window.__X.callTool(n, a, { confirmed: true })))?.status ?? null, id);
    const B = (fn, arg) => page.evaluate(async ([src, arg]) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); return (new Function("B", "arg", `return (${src})(B, arg)`))(B, arg); }, [fn.toString(), arg]);
    const waitTake = (id) => page.evaluate(async (id) => { for (let i = 0; i < 240 && !(window.__T.get(id)?.media?.length); i++) await new Promise((r) => setTimeout(r, 500)); const t = window.__T.get(id); return t && { id: t.id, story: t.story ?? null, group: t.group }; }, id);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const aya = (await call("save_cast", { name: "Aya", details: "young woman, orange-red ponytail, green apron, a steel ladle in her right hand", refs: [{ file: "snaptest_book/hiyori_front_v1.png", role: "identity: front" }] })).cast;
    const ode = (await call("save_cast", { name: "Ode", details: "elderly man, grey hair, a round gold monocle on his right eye, black suit", refs: [{ file: "snaptest_book/tomoshi_front_v1.png", role: "identity: front" }] })).cast;
    const place = (await call("save_location", { name: "Cart", master: { file: "snaptest_book/MASTER_shrine_v1.png" }, plates: [{ name: "counter", file: "snaptest_book/P1_torii_eyelevel.png" }] })).location;
    const book = (await call("create_book", { name: "Bowl", medium: "anime", cast: [aya, ode], locations: [place] })).book;
    await B(async (B, { book, aya, ode }) => {
      const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { title: "Bowl", props: [{ id: "ladle", name: "the ladle" }, { id: "monocle", name: "the monocle" }], beats: [
        { id: "b1", order: 1, told: 1, text: "Ode sits at the counter; Aya stirs the pot.", plants: [{ id: "p_mono", what: "the monocle he never takes off", window: 3 }], changes: [{ entity: aya, path: "carried.right_hand", op: "set", value: "prop:ladle" }, { entity: ode, path: "carried.worn", op: "add", value: "prop:monocle" }, { entity: "prop:monocle", path: "holder", op: "set", value: "on the counter" }] },
        { id: "b2", order: 2, told: 2, text: "Aya sets the bowl down in front of Ode.", changes: [{ entity: aya, path: "carried.right_hand", op: "remove", value: "prop:ladle" }] },
        { id: "b3", order: 3, told: 3, text: "Ode sips; the monocle drops into his hand.", lines: [{ who: ode, text: "...One more bowl." }], pays_off: ["p_mono"], changes: [{ entity: ode, path: "carried.worn", op: "remove", value: "prop:monocle" }, { entity: ode, path: "carried.left_hand", op: "set", value: "prop:monocle" }, { entity: "prop:monocle", path: "holder", op: "set", value: ode }] }] }, { note: "written by the person" });
    }, { book, aya, ode });
    const c1 = await call("add_cut", { book, scene_name: "Night", beats: ["b1"], cast: [aya, ode], props: ["prop:monocle"], location: place, plate: "counter", seconds: 3 });
    const c2 = await call("add_cut", { book, scene: c1.scene, beats: ["b2"], cast: [aya, ode], location: place, plate: "counter", seconds: 3 });
    // F-L11: b1 puts the monocle on his eye and "on the counter" at once
    R.s1 = await call("compile_unit", { scene: c1.scene, shot: c1.shot });
    R.monoAt1 = await call("state_at", { book, entity: "prop:monocle", beat: "b1" });
    // F-L12 + F-L06 + F-L15 + F-L16: stacked proposals from an agent
    const longText = "Aya wipes the counter in long slow strokes while Ode, monocle back on his eye, watches the steam rise from the empty bowl and says nothing at all for a while.";
    R.p4 = await call("add_beat", { book, text: longText, after: "b3" });
    R.p5 = await call("add_change", { book, beat: R.p4.would?.beat, entity: aya, path: "carried.right_hand", op: "set", value: "prop:rag", name: "the rag", why: "wipes the counter" });
    R.p6 = await call("add_change", { book, beat: "b2", entity: ode, path: "mood", op: "set", value: "wary" });
    R.p7 = await call("edit_beat", { book, beat: "b2", lines: [{ who: aya, text: "Eat it while it's hot." }] });
    R.p8 = await call("add_group", { book, name: "Night at the cart", beats: ["b1", "b2", "b3"], place });
    R.p9 = await call("add_change", { book, beat: "b1", entity: ode, path: "mood", op: "set", value: "stern" });
    R.reasons = await page.evaluate((ids) => ids.map((id) => window.__P.get(id)?.reason ?? null), [R.p4.proposed, R.p7.proposed, R.p5.proposed]);
    // the colour script: C1 gets an approved board; the strip offers it; the person uses it
    await person("set_board", { scene: c1.scene, shot: c1.shot, file: "snaptest_book/g7_board_c1.png", approved: true });
    await call("open_view", { view: "book", book, lens: "beat_sheet" }); await page.waitForTimeout(2000);
    R.ghostCols = await page.locator(".snap-book-spine .snap-book-ghost").count();
    R.ghostChanges = await page.locator(".snap-book-lane-ghost").allTextContents();
    R.laneNames = await page.locator(".snap-book-lane-name").allTextContents();
    R.laneText = await page.locator(".snap-book-lanes").textContent();
    R.cardLines = await page.locator(".snap-book-beat-line").allTextContents();
    R.payoff = await page.locator(".snap-book-spine").textContent();
    R.flags = await page.locator(".snap-book-flags").textContent().catch(() => "");
    R.colourBefore = await page.locator(".snap-book-colours").textContent();
    await page.screenshot({ path: path.join(out, "beat_sheet.png") });
    // accept the group (and nothing else yet), then the strip offers C1's board
    R.accGroup = await accept(R.p8.proposed);
    await page.waitForTimeout(1500);
    R.colourOffer = await page.locator(".snap-book-colours").textContent();
    await page.locator(".snap-book-colours button", { hasText: "Use C1's board" }).click(); await page.waitForTimeout(1500);
    R.groupAfter = await B((B, book) => B.storyOf(B.bookOf(book).body).body.groups, book);
    R.colourChosen = await page.locator(".snap-book-colour-cell.chosen").count();
    // an agent's set_colour_frame waits
    R.agentColour = await call("set_colour_frame", { book, group: R.groupAfter?.[0]?.id, file: "snaptest_book/P1_torii_eyelevel.png" });
    // F-L06: p9 (b1 Ode mood, on top of waiting p6 and others): its own cost vs the stack's
    R.cost9 = await page.evaluate((id) => window.__P.get(id)?.reason, R.p9.proposed);
    R.cost9raw = R.p9.reversal_cost;
    // accept the beat and its rag change: the prop gets its name
    R.accRag = await accept(R.p5.proposed);
    R.props = await B((B, book) => B.storyOf(B.bookOf(book).body).body.props, book);
    R.version = await B((B, book) => B.storyOf(B.bookOf(book).body).version?.note ?? null, book);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    // Settei design it: Aya's "apron off" state, words only
    await person("save_cast_state", { cast: aya, state: "apron off", covers: { wardrobe: "no apron, sleeves rolled up" } });
    R.design = await call("design_state", { book, cast: aya, state: "apron off", count: 1, seeds: [11], method: "ph3_view" });
    R.designTake = R.design?.candidates?.[0]?.take ? await waitTake(R.design.candidates[0].take) : null;
    await call("open_view", { view: "book", book, lens: "settei" }); await page.waitForTimeout(2500);
    R.useButtons = await page.locator(".snap-book-design-cands button").allTextContents();
    await page.locator(".snap-book-design").first().scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, "settei.png") });
    if (R.useButtons.length) { await page.locator(".snap-book-design-cands button").first().click(); await page.waitForTimeout(2500); }
    R.castAfter = await page.evaluate(async (aya) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); const g = W.get(aya); return { n: g.version.n, by: g.version.by, note: g.version.note, state: g.version.body.states?.find((s) => s.name === "apron off") ?? null }; }, aya);
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `g7book-${Date.now()}`); // the placeholders go back out (moved, never deleted), as test_u101 does
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
  const S = R;
  const checks = {
    removeReadsMinus: /carried\.right_hand − the ladle/.test(S.laneText ?? "") && !/carried\.right_hand → the ladle/.test((S.laneText ?? "").split("b2")[1] ?? ""),
    propLanes: (S.laneNames ?? []).includes("the monocle") && (S.laneNames ?? []).includes("the ladle"),
    linesOnCard: (S.cardLines ?? []).some((x) => /Ode: “\.\.\.One more bowl\.”/.test(x)),
    payoffWords: /pays off "the monocle he never takes off"/.test(S.payoff ?? "") && !/pays off p_mono/.test(S.payoff ?? ""),
    ghostColumn: S.ghostCols === 1,
    ghostChanges: (S.ghostChanges ?? []).some((x) => new RegExp(`carried\\.right_hand → the rag \\(${S.p5?.proposed}\\)`).test(x)) && (S.ghostChanges ?? []).some((x) => new RegExp(`mood → wary \\(${S.p6?.proposed}\\)`).test(x)),
    titleWhole: (S.reasons?.[0] ?? "").includes(longText(S)) && /lines Aya: "Eat it while it's hot\."|lines .*Eat it while it's hot/.test(S.reasons?.[1] ?? ""),
    ownCost: !!S.cost9raw && Array.isArray(S.cost9raw.with_waiting?.built_on) && S.cost9raw.with_waiting.built_on.length >= 1 && S.cost9raw.cuts?.map((c) => c.cut).join() === "C1" && /changes the compile of C1 \(Ode\.mood\)/.test(S.cost9raw.said) && !/C2/.test(S.cost9raw.said),
    stackApart: /with p\d+.* waiting: /.test(S.cost9 ?? "") && /C2/.test(S.cost9raw?.with_waiting?.said ?? ""),
    propLint: S.s1?.lint?.some((x) => /^the monocle's holder is on the counter \(b1 c3\) while Ode's carried\.worn names it \(b1 c2\): check they agree/.test(x)),
    propFlag: /b1: the monocle's holder is on the counter/.test(S.flags ?? "") && !/b3: the monocle/.test(S.flags ?? ""),
    carriedBy: S.monoAt1?.carried_by?.[0]?.who === S.s1?.entities?.find((e) => e.name === "Ode")?.ref && S.monoAt1.disagree?.length === 1,
    groupAdded: S.accGroup === "accepted" && S.groupAfter?.[0]?.name === "Night at the cart" && S.groupAfter[0].beats.join() === "b1,b2,b3",
    colourOffered: /colour script/.test(S.colourBefore ?? "") && /group the beats into scenes first/.test(S.colourBefore ?? "") && /not chosen: C1's board\?/.test(S.colourOffer ?? ""),
    colourChosen: S.groupAfter?.[0]?.colour?.file === "snaptest_book/g7_board_c1.png" && S.colourChosen === 1,
    agentColourWaits: !!S.agentColour?.proposed && /waiting/.test(S.agentColour.status ?? ""),
    propNamed: S.accRag === "accepted" && S.props?.some((p) => p.id === "rag" && p.name === "the rag"),
    designLands: !!S.design?.candidates?.length && S.designTake?.story?.role === "settei" && S.designTake.story.state === "apron off" && /Settei · Bowl › Aya/.test(S.design.landed?.where ?? "") && /Aya wears no apron, sleeves rolled up\./.test(S.design.prompt ?? ""), // the line's own outfit clause stays (F-N01)
    designUse: (S.useButtons ?? []).some((x) => /Use this \(front\)/.test(x)) && S.castAfter?.state?.pictures?.[0]?.from?.take === S.designTake?.id && S.castAfter.by === "person",
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  function longText() { return "Aya wipes the counter in long slow strokes while Ode, monocle back on his eye, watches the steam rise from the empty bowl and says nothing at all for a while."; }
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g7_book_result.json"), JSON.stringify(R, null, 1));
  console.log(`g7book ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
