// Batch G16 S6, F-SQ02 (SNAP-R165 as amended): the Cast-line fold keeps Maren's braid and never splits inside brackets,
// on the CPU test server, with seq01's own words: Maren's details line and her carried.worn changes at b1 (the greatsword
// in its scabbard on her back, on the harness), b8 (the empty scabbard) and b11 (the greatsword, no harness words):
// - at b1 and b11 her line keeps "long white-silver hair in one low braid over her right shoulder" (before the fix, the
//   b11 value's place words "right shoulder" folded her hair away) and the sword clause whole, brackets and all;
// - at b8 the sword clause goes (the scabbard is empty) and is said in left_out, while the hair and harness clauses stay;
// - no clause anywhere is a broken bracket ("tip by her left calf)" without its "(hilt").
// usage: node test_g16_braid.js [port] [base]   prints "g16braid n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g16braid-${Date.now()}`)); } };
const DETAILS = "young woman warrior, very pale, long white-silver hair in one low braid over her right shoulder, pale grey eyes, expressionless, dark charcoal high-collared long coat over dark leather armour with steel pauldrons and gauntlets, red cord sash, dark boots; her huge greatsword sheathed in a long dark leather scabbard carried diagonally flat against her back (hilt above her right shoulder, tip by her left calf), held by a dark leather harness: a diagonal chest strap from her left shoulder to her right hip with a steel buckle, and a waist strap";
const BRAID = "long white-silver hair in one low braid over her right shoulder", SWORD = "her huge greatsword sheathed in a long dark leather scabbard carried diagonally flat against her back (hilt above her right shoulder, tip by her left calf)";
(async () => {
  for (const d of ["book", "story", "look", "scenes", "cast", "production", "proposals.json"]) park(d); // moved, never deleted
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const cast = (await call("save_cast", { name: "Maren", details: DETAILS })).cast;
    const book = (await call("create_book", { name: "G16 Braid", cast: [cast] })).book;
    await page.evaluate(async ({ book, cast }) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body);
      const beats = Array.from({ length: 11 }, (_, i) => ({ id: `b${i + 1}`, text: `beat ${i + 1}`, changes: [] }));
      beats[0].changes.push({ entity: cast, path: "carried.worn", op: "set", value: "the greatsword in its long scabbard on her back, hilt above her right shoulder, on the harness" });
      beats[7].changes.push({ entity: cast, path: "carried.worn", op: "set", value: "the empty scabbard on her back on the harness" });
      beats[10].changes.push({ entity: cast, path: "carried.worn", op: "set", value: "the greatsword in its scabbard on her back, hilt above her right shoulder" });
      await B.saveStory(st.id, { beats }, { note: "seq01's carried.worn changes" }); }, { book, cast });
    const cuts = {};
    for (const beat of ["b1", "b8", "b11"]) { const c = await call("add_cut", { book, ...(cuts.b1 ? { scene: cuts.b1.scene } : { scene_name: "G16 braid" }), beats: [beat], cast: [cast], seconds: 3 }); cuts[beat] = c; }
    for (const [beat, c] of Object.entries(cuts)) { const sheet = await call("compile_unit", { scene: c.scene, shot: c.shot }); R[beat] = sheet.entities?.find((e) => e.ref === cast)?.cast_line ?? sheet; }
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, has = (beat, x) => (S[beat]?.line ?? "").includes(x), broken = (beat) => (S[beat]?.line ?? "").includes("tip by her left calf)") && !(S[beat]?.line ?? "").includes("(hilt above her right shoulder, tip by her left calf)");
  const checks = {
    "b1: the braid and the sword clause stay, brackets and all": has("b1", BRAID) && has("b1", SWORD),
    "b11: the braid stays (the value's 'right shoulder' is a place, not the item)": has("b11", BRAID) && has("b11", SWORD),
    "b11: the harness clause stays (the value names no harness)": has("b11", "held by a dark leather harness"),
    "b8: the sword clause goes (the scabbard is empty) and left_out says why": !has("b8", "her huge greatsword") && (S.b8?.left_out ?? []).some((x) => x.clause === SWORD && x.path === "carried.worn"),
    "b8: the braid and the harness stay": has("b8", BRAID) && has("b8", "held by a dark leather harness"),
    "no clause is a broken bracket": !["b1", "b8", "b11"].some(broken) && !["b1", "b8", "b11"].some((b) => (S[b]?.left_out ?? []).some((x) => /^tip by/.test(x.clause))),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify(R, null, 1));
  console.log(`g16braid ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
