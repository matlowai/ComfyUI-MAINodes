// Batch G16 S3, Snap remembers where a Cut went (SNAP-R225) and a pushed Book's diff (SNAP-R217), on the CPU test
// server, with no Astrid at all (the receipt is Snap's):
// - before a push: get_book says "not in Astrid yet" and names the project a push would make; each unit "not in Astrid";
// - link_astrid records the project, the timeline, the head and each cut's clip, take and trim: every unit is "in sync",
//   get_production carries the project, the Cut lens's Astrid card says "In Astrid: <project> › <timeline> · head …"
//   with Open in Astrid (the App link names the project and the timeline) and each cut's "Astrid: C1 · in sync";
// - a cut swapped in Astrid reads "swapped HH:MM"; a new active take or a trim moved here reads "changed here since the
//   push", the diff names them, export_cut answers astrid.diff, and the card offers no Open while it differs;
// - a cut added to the Cut is a changed shape: the diff says a push makes a new timeline and keeps the one in Astrid.
// usage: node test_g16_receipt.js [port] [base]   prints "g16receipt n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const D = CFG.fixture("short04");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g16receipt-${Date.now()}`)); } };
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "production", "proposals.json", "astrid.json"]) park(d); // moved, never deleted
  const fout = path.join(base, "output", "snaptest_g16receipt");
  fs.mkdirSync(fout, { recursive: true });
  for (const f of ["C1_pick.mp4", "C2_pick.mp4"]) fs.copyFileSync(path.join(D, "cuts", f), path.join(fout, f));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const book = (await call("create_book", { name: "G16 Receipt" })).book;
    const units = [];
    for (let i = 0; i < 3; i++) units.push(await call("add_cut", { book, ...(units[0] ? { scene: units[0].scene } : { scene_name: "G16 receipt" }), seconds: 3 }));
    await page.evaluate(async (units) => {
      const T = window.__T, SC = window.__SC;
      const mk = async (id, file, group) => T.save({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 60, group, number: 1, status: "success", text: id, seed: 1, media: [{ kind: "video", filename: file, subfolder: "snaptest_g16receipt", type: "output" }], verdict: "keep", notes: [], prompt: {}, graph: {} });
      for (const [i, u] of units.entries()) { await mk(`take-g16r${i + 1}`, i % 2 ? "C2_pick.mp4" : "C1_pick.mp4", `g16r-${i + 1}`); await SC.addGroup(u.scene, u.shot, `g16r-${i + 1}`); await SC.setActive(u.scene, u.shot, `take-g16r${i + 1}`, "person"); }
      await mk("take-g16r2b", "C1_pick.mp4", "g16r-2"); // a re-take of C2, not active yet
    }, units);
    R.before = await call("get_book", { book });
    const production = R.before.production.ref.replace(/@\d+$/, "");
    R.link = await call("link_astrid", { production, project: { project_id: "p-g16", slug: "g16-receipt", name: "G16 Receipt" }, book,
      set: { timeline: { timeline_id: "tl-g16", name: "G16 Receipt" }, head: "authoring-parent-revision-abc1234def", order: ["C1", "C2", "C3"], pushed_at: Date.now() },
      clips: { C1: { clip: "C1", media: "sha256:aa", take: "take-g16r1", trim: {} }, C2: { clip: "C2", media: "sha256:bb", take: "take-g16r2", trim: {} }, C3: { clip: "C3", media: "sha256:cc", take: "take-g16r3", trim: {} } } });
    R.synced = await call("get_book", { book });
    R.prod = await call("get_production", { production: book });
    await call("open_view", { view: "book", book, lens: "the_cut" });
    await page.waitForTimeout(1500);
    const card = () => page.evaluate(() => { const c = document.querySelector(".snap-book-astrid"); return c ? { said: c.querySelector(".snap-book-astrid-said")?.textContent, open: c.querySelector("a.snap-book-astrid-go")?.href ?? null, cuts: [...document.querySelectorAll(".snap-book-astrid-cut")].map((x) => x.textContent) } : null; });
    R.cardSynced = await card();
    fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
    await page.locator(".snap-book-sheet").screenshot({ path: path.join(CFG.out, "ui", "g16_astrid_card_synced.png") });
    // a swap recorded in Astrid; then a re-take and a trim here
    await call("link_astrid", { production, book, clips: { C1: { clip: "C1-r1a2b3c4d", swapped_at: Date.now() } } });
    await call("set_active_take", { scene: units[1].scene, shot: units[1].shot, take: "take-g16r2b" });
    await call("set_unit", { scene: units[2].scene, shot: units[2].shot, trim: { in_s: 0.4 } });
    R.moved = await call("get_book", { book });
    await page.waitForTimeout(2500);
    R.cardMoved = await card();
    await page.locator(".snap-book-sheet").screenshot({ path: path.join(CFG.out, "ui", "g16_astrid_card_changed.png") });
    R.export = await call("export_cut", { book });
    // a fourth cut: the Cut's shape changed
    const c4 = await call("add_cut", { book, scene: units[0].scene, seconds: 2 });
    await page.evaluate(async (c4) => { await window.__T.save({ id: "take-g16r4", kind: "run", prompt_id: "g16r4", created: Date.now(), seconds: 60, group: "g16r-4", number: 1, status: "success", text: "c4", seed: 1, media: [{ kind: "video", filename: "C1_pick.mp4", subfolder: "snaptest_g16receipt", type: "output" }], verdict: "keep", notes: [], prompt: {}, graph: {} }); await window.__SC.addGroup(c4.scene, c4.shot, "g16r-4"); await window.__SC.setActive(c4.scene, c4.shot, "take-g16r4", "person"); }, c4);
    R.shape = await call("get_book", { book });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, st = (x, cut) => x?.units?.find((u) => u.cut === cut)?.astrid?.state;
  const checks = {
    "before a push: not in Astrid yet, naming the project a push would make; each unit not in Astrid": S.before?.astrid?.said === "not in Astrid yet" && S.before.astrid.project?.slug === "g16-receipt" && S.before.astrid.project.made === false && st(S.before, "C1") === "not in Astrid",
    "link_astrid records the push: every unit is in sync with its clip and the head": ["C1", "C2", "C3"].every((c) => st(S.synced, c) === "in sync" && S.synced.units.find((u) => u.cut === c).astrid.clip === c && S.synced.units.find((u) => u.cut === c).astrid.head === "authoring-parent-revision-abc1234def") && S.synced.astrid.said === "in sync with Astrid",
    "get_production carries the Astrid project": S.prod?.astrid?.project?.project_id === "p-g16" && S.prod.astrid.project.slug === "g16-receipt",
    "the Cut lens's Astrid card: In Astrid: project › timeline · head, and Open in Astrid names both": /^In Astrid: G16 Receipt › G16 Receipt · head abc1234… · in sync with Astrid$/.test(S.cardSynced?.said ?? "") && /\/tools\/video-editor\?project=p-g16&timeline=tl-g16$/.test(S.cardSynced?.open ?? ""),
    "each cut row says Astrid: <clip> · in sync": JSON.stringify(S.cardSynced?.cuts) === JSON.stringify(["Astrid: C1 · in sync", "Astrid: C2 · in sync", "Astrid: C3 · in sync"]),
    "a cut swapped in Astrid reads swapped HH:MM under its new clip id": /^swapped \d\d:\d\d/.test(st(S.moved, "C1") ?? "") && S.moved.units.find((u) => u.cut === "C1").astrid.clip === "C1-r1a2b3c4d",
    "a new active take or a moved trim reads changed here since the push, and the diff names them": st(S.moved, "C2") === "changed here since the push" && st(S.moved, "C3") === "changed here since the push" && JSON.stringify(S.moved.astrid.changed) === JSON.stringify(["C2", "C3"]) && /2 cuts changed since the push \(C2, C3\)/.test(S.moved.astrid.said),
    "export_cut on the pushed Book answers astrid.diff": JSON.stringify(S.export?.otio?.astrid?.diff?.changed) === JSON.stringify(["C2", "C3"]) && S.export.otio.astrid.diff.shape === false,
    "while it differs the card offers no Open and says what changed": S.cardMoved?.open === null && /2 cuts changed since the push/.test(S.cardMoved?.said ?? "") && (S.cardMoved?.cuts ?? []).includes("Astrid: C2 · changed here since the push"),
    "a cut added is a changed shape: a push makes a new timeline and keeps the one in Astrid": JSON.stringify(S.shape?.astrid?.added) === JSON.stringify(["C4"]) && /shape changed \(added C4\): a push makes a new timeline and keeps the one in Astrid/.test(S.shape?.astrid?.said ?? ""),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify(R, null, 1));
  console.log(`g16receipt ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
