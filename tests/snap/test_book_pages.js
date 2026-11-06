// U97 the Book, §11.5 step 12 (Pages as Fountain) on the CPU test server:
// - import_fountain (an agent's, so a proposal) turns a short script into scene groups, beats, lines (cue names match the
//   Book's Cast) and intents; export_fountain gives it back and importing the export changes nothing (no new version);
// - a changed dialogue line is one story version and every beat keeps its id; the scenes swapped in the script keep
//   their group ids and their beats' ids, and the beats' changes survive;
// - the Pages lens shows the script and saves an edit as a story version.
// Screen: ui/u97/book_pages.png. usage: node test_book_pages.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = process.env.SHOTS || path.join(CFG.out, "ui", "u97");
const base = process.argv[3] || CFG.base;
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
const SCRIPT = `Title: The lamp room

# Act one

INT. LIGHTHOUSE STAIRS - DUSK

Kon climbs the spiral stairs, a sealed letter in her hand.

= Kon arrives with a purpose

INT. LAMP ROOM - DUSK

Ferro watches the sea through his spyglass.

KON
You asked for this.

FERRO
(not turning)
Leave it on the table.

Kon hands Ferro the letter. He lowers the spyglass.

CUT TO:

EXT. GALLERY - NIGHT

The north light goes dark over the bay. [[the lamp stops turning]]
`;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const d of ["book", "story", "look", "scenes", "_archived/book", "_archived/story"]) park(d); // moved, never deleted
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const accept = (id) => page.evaluate(async (id) => { const p = await window.__P.decide(id, true, (n, a) => window.__X.callTool(n, a, { confirmed: true })); return { status: p?.status, result: p?.result }; }, id);
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const kon = (await call("save_cast", { name: "Kon", details: "a young apprentice" })).cast, ferro = (await call("save_cast", { name: "Ferro", details: "an old keeper" })).cast;
    const book = (await call("create_book", { name: "The lamp room", cast: [kon, ferro] })).book;
    R.imp = await call("import_fountain", { book, text: SCRIPT });
    R.impAccept = await accept(R.imp.proposed);
    const g1 = await call("get_book", { book });
    R.beats = g1.story.beats.map((x) => [x.id, x.text, x.intent ?? null, (x.lines ?? []).map((l) => [l.who, l.text])]);
    R.groups = g1.story.groups.map((g) => [g.id, g.kind, g.name, g.beats]);
    R.title = g1.story.title;
    // a change on b3 (Kon hands the letter) that a re-import must keep
    const ch = await call("add_change", { book, beat: "b3", entity: ferro, path: "carried.right_hand", value: "prop:letter" });
    await accept(ch.proposed);
    R.exp = await call("export_fountain", { book });
    const again = await call("import_fountain", { book, text: R.exp.text });
    R.again = await accept(again.proposed);
    // one changed line, then the lamp room and the gallery swapped
    const edited = R.exp.text.replace("Leave it on the table.", "Put it on the chart table.");
    R.edit = await accept((await call("import_fountain", { book, text: edited })).proposed);
    const g2 = await call("get_book", { book });
    R.beats2 = g2.story.beats.map((x) => [x.id, x.text]);
    R.line2 = g2.story.beats.flatMap((x) => (x.lines ?? []).map((l) => l.text));
    const parts = edited.split(/\n\n(?=(?:\.|INT|EXT))/), swapped = [parts[0], parts[1], parts[3], parts[2]].join("\n\n");
    R.swapParts = parts.length;
    R.swap = await accept((await call("import_fountain", { book, text: swapped })).proposed);
    const g3 = await call("get_book", { book });
    R.groups3 = g3.story.groups.map((g) => [g.id, g.name, g.beats]);
    R.b3changes = g3.story.beats.find((x) => x.id === "b3")?.changes.length;
    R.order3 = [...g3.story.beats].sort((x, y) => x.told - y.told).map((x) => x.id);
    await call("open_view", { view: "book", book, lens: "pages" }); await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(out, "book_pages.png") });
    R.area = await page.evaluate(() => document.querySelector(".snap-book-pages")?.value.slice(0, 80));
    await page.evaluate(() => { const a = document.querySelector(".snap-book-pages"); a.value = a.value.replace("Ferro watches the sea through his spyglass.", "Ferro watches the storm through his spyglass."); });
    await page.click("button:has-text('Save as a story version')"); await page.waitForTimeout(1000);
    R.afterUi = (await call("get_book", { book })).story.beats.find((x) => x.id === "b2")?.text;
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R;
  const checks = {
    imported: S.impAccept?.status === "accepted" && S.title === "The lamp room" && S.beats?.length === 4,
    groups: JSON.stringify(S.groups?.map((g) => [g[1], g[2]])) === JSON.stringify([["act", "Act one"], ["scene", "INT. LIGHTHOUSE STAIRS - DUSK"], ["scene", "INT. LAMP ROOM - DUSK"], ["scene", "EXT. GALLERY - NIGHT"]]),
    linesOnBeat: S.beats?.[1]?.[3]?.length === 2 && /^cast:/.test(S.beats[1][3][0][0]) && S.beats[1][3][1][1] === "Leave it on the table.",
    intent: S.beats?.[0]?.[2] === "Kon arrives with a purpose",
    noteLeftOut: !JSON.stringify(S.beats ?? "").includes("lamp stops turning") && !JSON.stringify(S.beats ?? "").includes("CUT TO"),
    roundTripNoVersion: S.again?.status === "accepted" && S.again.result?.made === false,
    lineIsOneVersion: S.edit?.result?.made === true && S.line2?.includes("Put it on the chart table.") && JSON.stringify(S.beats2?.map((x) => x[0])) === JSON.stringify(S.beats?.map((x) => x[0])),
    swapKeepsIds: S.swap?.result?.made === true && S.groups3?.find((g) => g[1] === "INT. LAMP ROOM - DUSK")?.[0] === S.groups?.find((g) => g[2] === "INT. LAMP ROOM - DUSK")?.[0] && S.b3changes === 1 && S.order3?.join() === "b1,b4,b2,b3",
    pagesLens: /^Title: The lamp room/.test(S.area ?? "") && S.afterUi === "Ferro watches the storm through his spyglass.",
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_book_pages_result.json"), JSON.stringify(R, null, 1));
  console.log(`book_pages ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
