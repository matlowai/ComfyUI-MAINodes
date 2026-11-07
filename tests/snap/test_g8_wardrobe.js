// Batch G8, F-N01: a wardrobe state folds the Cast line (SNAP-R178, beside SNAP-R165) on the CPU test server:
// - the fold drops only the clauses that are an item a wardrobe change names ("green apron" under "no apron, sleeves
//   rolled up"; "long sleeves" too), keeps a clause the wardrobe says the same way ("oilskin coat" under "the oilskin") and
//   every other clause, and names each left-out clause with its beat and change;
// - what it keeps but the wardrobe words otherwise is a lint line: a clause that mentions the item ("white blouse with long
//   sleeves") or a garment of the same kind ("green coat" under "the oilskin"); a colour is never an item ("red coat")
// - the compile: a cut before the change keeps "green apron"; the cut on the change opens with it and ends without it; a
//   later cut leaves it out of the still prompt, the board prompt and the video prompt; its beat's "wipes her hands on
//   her apron" is a lint line, while the beat that takes the apron off is not.
// usage: node test_g8_wardrobe.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
const base = process.argv[3] || CFG.base;
const D = CFG.fixture("short04");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
(async () => {
  for (const d of ["book", "story", "look", "scenes", "cast", "location", "proposals.json"]) park(d); // moved, never deleted
  const fx = path.join(base, "input", "snaptest_book");
  fs.mkdirSync(fx, { recursive: true });
  for (const f of ["bible/hiyori_front_v1.png", "settei_bg/MASTER_shrine_v1.png", "settei_bg/P1_torii_eyelevel.png"]) fs.copyFileSync(path.join(D, f), path.join(fx, path.basename(f)));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const B = (fn, arg) => page.evaluate(async ([src, arg]) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); return (new Function("B", "arg", `return (${src})(B, arg)`))(B, arg); }, [fn.toString(), arg]);
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    // the fold alone
    R.fold = await B((B) => {
      const line = "young woman, orange-red ponytail, green apron, white blouse with long sleeves, a steel ladle in her right hand";
      const story = { beats: [{ id: "b2", order: 2, told: 2, changes: [{ id: "c1", entity: "cast:aya", path: "wardrobe", op: "set", value: "no apron, sleeves rolled up" }] }], props: [] };
      const at = (value, beat = "b2", change = "c1") => ({ wardrobe: { value, beat, change } }), none = { beats: [], props: [] };
      return {
        apron: B.foldCastLine(story, "cast:aya", line, at("no apron, sleeves rolled up")),
        sleeves: B.foldCastLine(story, "cast:aya", "young woman, long sleeves", at("no apron, sleeves rolled up")),
        before: B.foldCastLine(story, "cast:aya", line, {}),
        same: B.foldCastLine(none, "cast:kon", "young man, oilskin coat, boots", at("the oilskin", "b7", "c3")),
        clash: B.foldCastLine(none, "cast:kon", "young man, green coat, boots", at("the oilskin", "b7", "c3")),
        blue: B.foldCastLine(none, "cast:aya", "young woman, green apron", at("a blue apron")),
        heads: B.wardrobeItems(none, "a red coat with a hood, no hat, sleeves rolled up").map((x) => [x.head, x.off]),
      };
    });
    // the compile at three cuts
    const aya = (await call("save_cast", { name: "Aya", details: "young woman, orange-red ponytail, green apron, a steel ladle in her right hand", refs: [{ file: "snaptest_book/hiyori_front_v1.png", role: "identity: front" }] })).cast;
    const place = (await call("save_location", { name: "Cart", master: { file: "snaptest_book/MASTER_shrine_v1.png" }, plates: [{ name: "counter", file: "snaptest_book/P1_torii_eyelevel.png" }] })).location;
    const book = (await call("create_book", { name: "Apron", medium: "anime", cast: [aya], locations: [place] })).book;
    await B(async (B, { book, aya }) => {
      const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { title: "Apron", beats: [
        { id: "b1", order: 1, told: 1, text: "Aya stirs the pot.", changes: [] },
        { id: "b2", order: 2, told: 2, text: "Aya takes off her apron and rolls up her sleeves.", changes: [{ entity: aya, path: "wardrobe", op: "set", value: "no apron, sleeves rolled up" }] },
        { id: "b3", order: 3, told: 3, text: "Aya wipes her hands on her apron.", changes: [] }] }, { note: "written by the person" });
    }, { book, aya });
    const cuts = [];
    for (const beat of ["b1", "b2", "b3"]) cuts.push(await call("add_cut", { book, ...(cuts[0] ? { scene: cuts[0].scene } : { scene_name: "Night" }), beats: [beat], cast: [aya], location: place, plate: "counter", seconds: 3 }));
    R.cuts = cuts.map((c) => c.error ?? c.cut);
    for (const [i, c] of cuts.entries()) R[`s${i + 1}`] = await call("compile_unit", { scene: c.scene, shot: c.shot });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, f = S.fold ?? {}, aya = (s) => s?.entities?.find((e) => e.name === "Aya");
  const lintOf = (s) => (s?.lint ?? []).join("\n");
  const checks = {
    foldDropsTheItem: f.apron?.line === "young woman, orange-red ponytail, white blouse with long sleeves, a steel ladle in her right hand" && f.apron.left_out?.length === 1 && f.apron.left_out[0].clause === "green apron" && f.apron.left_out[0].path === "wardrobe" && /left out: b2 c1 \(wardrobe is no apron, sleeves rolled up\)/.test(f.apron.left_out[0].said),
    foldMentionIsLint: f.apron?.lint?.length === 1 && /Cast line says 'white blouse with long sleeves' while the wardrobe is sleeves rolled up \(b2 c1\)/.test(f.apron.lint[0]),
    foldSleeves: f.sleeves?.line === "young woman" && f.sleeves.left_out?.[0]?.clause === "long sleeves",
    foldBeforeKeeps: f.before?.line?.includes("green apron") && !f.before.left_out?.length,
    foldAgreeKeeps: f.same?.line === "young man, oilskin coat, boots" && !f.same.left_out?.length && !f.same.lint?.length,
    foldClashIsLint: f.clash?.line === "young man, green coat, boots" && f.clash.lint?.length === 1 && /Cast line says 'green coat' while the wardrobe is the oilskin \(b7 c3\): check they agree/.test(f.clash.lint[0]),
    foldOtherWordsDrop: f.blue?.line === "young woman" && f.blue.left_out?.[0]?.clause === "green apron",
    headsNotColours: JSON.stringify(f.heads) === JSON.stringify([["coat", false], ["hat", true], ["sleeve", false]]),
    cutBeforeKeeps: /green apron/.test(S.s1?.still_prompt ?? "") && !aya(S.s1)?.cast_line?.left_out,
    cutOnChangeOpensWith: aya(S.s2)?.cast_line?.left_out?.[0]?.clause === "green apron" && /green apron/.test(aya(S.s2).cast_line.opens ?? "") && !/green apron/.test(S.s2.still_prompt ?? "") && !/takes off her apron/.test(lintOf(S.s2)),
    cutAfterLeavesOut: aya(S.s3)?.cast_line?.left_out?.[0]?.beat === "b2" && !/green apron/.test(S.s3?.still_prompt ?? "") && !/green apron/.test(S.s3?.board?.prompt ?? "") && !/green apron/.test(S.s3?.prompt?.description ?? "") && /Aya wears no apron, sleeves rolled up\./.test(S.s3?.still_prompt ?? ""),
    beatTextIsLint: /b3's text says "Aya wipes her hands on her apron\." while Aya wears no apron, sleeves rolled up\. \(b2 c\d+\): check they agree/.test(lintOf(S.s3)),
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g8_wardrobe_result.json"), JSON.stringify(R, null, 1));
  console.log(`g8wardrobe ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
