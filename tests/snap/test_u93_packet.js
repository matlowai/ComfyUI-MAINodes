// U93 B2 (SNAP-R102, R104) on a CPU test server: critique_packet.
// - a board pinned to the village location (two plates cited) and a Cast: the packet's first picture is the board whole at
//   its own size, then the context: the location's master, plan and the two cited plates (not the others), the Cast's
//   pictures; the words carry the prompt, the pins with the Cast's details and the location's notes, who_should_be_here;
// - a 4K still (3328x4096) gives 9 tiles of 1536 px with overlap covering the whole frame, each with its cell and box;
//   part/offset/limit page the images with `next`; packet bytes are measured (A9);
// - a note drawn on a tile is stored in the subject's own fractions; a video take's packet has its frames every half second and its last whole (G17b) and
//   tiles only of its first and last;
// - the location's own rows (master, plan, plates, every view side by side) were made when the record was saved; the
//   views packet has every picture of the version as a subject.
// usage: node test_u93_packet.js <port> <base>   prints "u93packet n/m" last
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, out = path.join(CFG.out, "ui", "u93"), R = {};
const SETTEI = CFG.fixture("short03", "settei_bg");
const X09 = CFG.critic("blind", "X09.png");
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d}-u93p-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  ["critiques", "takes", "candidates", "location", "cast"].forEach(park);
  fs.mkdirSync(path.join(base, "output", "snaptest"), { recursive: true });
  fs.copyFileSync(path.join(SETTEI, "plates", "Pc_square_well.png"), path.join(base, "output", "snaptest", "u93_board2.png"));
  fs.copyFileSync(X09, path.join(base, "output", "snaptest", "u93_4k.png"));
  fs.copyFileSync(CFG.critic("blind", "ctx", "maren_v1_cast_front.png"), path.join(base, "input", "u93_cast_front.png"));
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) }); // an earlier run's finished jobs would be adopted as takes (F-C25)
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    await page.evaluate(async () => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); await CR.reload(); }); // the critic starts now (since)
    R.import = JSON.parse(execFileSync("python3", ["-I", path.join(__dirname, "import_village_location.py"), "--port", port]).toString());
    const call = (name, args) => page.evaluate(async ([n, x]) => { const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); I.setCaller("critic-p"); return window.__X.callTool(n, x).catch((e) => ({ error: e.message })); }, [name, args]);
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); });
    R.cast = await call("save_cast", { name: "U93 Maren", details: "a tall swordswoman in a long grey coat, a greatsword in a scabbard on her back", refs: [{ file: "u93_cast_front.png", role: "identity: front" }] });
    const castRef = R.cast.cast ?? R.cast.ref?.replace(/@\d+$/, "");
    R.fix = await page.evaluate(async (cast) => {
      const T = window.__T, mk = (id, number, media, world) => ({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), finished: Date.now(), seconds: 9, group: app.graph.id, number, status: "success", text: "Maren waits by the well; she does not take the pouch", seed: 1, media, prompt: {}, graph: {}, world, verdict: null, notes: [] });
      const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"), c = W.parse(cast), head = W.record("cast", c.id).head;
      await T.save(mk("take-u93-board", 941, [{ kind: "image", filename: "u93_board2.png", subfolder: "snaptest", type: "output" }], { "location:location-village": { n: 1, name: "Village", placed: { plates: ["Pb gate inside, open", "Pc square + well"], master: true, plan: true } }, [W.refOf("cast", c.id)]: { n: head, name: "U93 Maren" } }));
      await T.save(mk("take-u93-4k", 942, [{ kind: "image", filename: "u93_4k.png", subfolder: "snaptest", type: "output" }], {}));
      await T.save(mk("take-u93-video", 943, [{ kind: "video", filename: "identity_video_00001_.mp4", subfolder: "snaptest", type: "output" }], {}));
      return head;
    }, castRef);
    const rowOf = (take) => page.evaluate(async (t) => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); for (let i = 0; i < 60; i++) { await CR.reload(); const r = CR.all().find((x) => x.subject.take === t); if (r) return r; await new Promise((ok) => setTimeout(ok, 250)); } return null; }, take);
    const board = await rowOf("take-u93-board"), big = await rowOf("take-u93-4k"), vid = await rowOf("take-u93-video");
    R.checklists = [board?.checklist, big?.checklist, vid?.checklist];
    const p1 = await call("critique_packet", { critique: board.id });
    R.board = { pictures: p1.pictures?.map((p) => [p.role, p.what, p.width, p.height]), words: p1.words, images: p1.images?.length, labels: p1.images?.map((i) => i.label) };
    const t0 = Date.now(), p2 = await call("critique_packet", { critique: big.id });
    R.bigMs = Date.now() - t0;
    R.big = { pictures: p2.pictures?.map((p) => [p.role, p.tile?.cell ?? null, p.tile?.box ?? null, p.width, p.height]), bytes: p2.images?.reduce((n, i) => n + i.data.length * 0.75, 0), wholeBytes: p2.images?.[0]?.data.length * 0.75 };
    const tiles = p2.pictures?.filter((p) => p.role === "tile") ?? [];
    const cover = new Uint8Array(3328 * 4096 / 64); for (const t of tiles) for (let y = t.tile.box[1]; y < t.tile.box[1] + t.tile.box[3]; y += 8) for (let x = t.tile.box[0]; x < t.tile.box[0] + t.tile.box[2]; x += 8) cover[(y >> 3) * 416 + (x >> 3)] = 1;
    R.covered = cover.every(Boolean);
    R.page1 = await call("critique_packet", { critique: big.id, part: "tiles", offset: 0, limit: 4 });
    R.page = { n: R.page1.images?.length, next: R.page1.next, labels: R.page1.images?.map((i) => i.label) };
    delete R.page1;
    // a note on tile r2c2 lands in the frame's own fractions
    const r2c2 = p2.pictures.find((p) => p.tile?.cell === "r2c2");
    await call("claim_critique", { critique: big.id });
    R.write = await call("write_critique", { critique: big.id, verdict: "flaws", notes: [{ severity: "high", pass: "scan", text: "a ghost figure in the backdrop", picture: r2c2.index, region: [0, 0, 0.5, 0.5], owner: "take", fix: "skip flat tiles" }] });
    R.mapped = R.write.notes?.[0]?.region; R.expect = [r2c2.tile.box[0] / 3328, r2c2.tile.box[1] / 4096, (0.5 * r2c2.tile.box[2]) / 3328, (0.5 * r2c2.tile.box[3]) / 4096].map((x) => +x.toFixed(4));
    const p3 = await call("critique_packet", { critique: vid.id });
    R.video = { pictures: p3.pictures?.map((p) => [p.role, p.frame ?? null, p.width, p.height]), error: p3.error };
    // the location's own rows, made when it was saved
    R.locRows = await page.evaluate(async () => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); await CR.reload(); return CR.all().filter((r) => r.subject.kind === "record").map((r) => [r.subject.part, r.checklist]); });
    const views = await page.evaluate(async () => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); return CR.all().find((r) => r.subject.part === "views")?.id; });
    const p4 = await call("critique_packet", { critique: views });
    R.views = { subjects: p4.pictures?.filter((p) => p.role === "subject").map((p) => p.what), context: p4.pictures?.filter((p) => p.role === "context").length, record: p4.words?.record?.plates?.length };
    R.errors = A.errors;
  } finally { await b.close(); }
  const ctx = (R.board.pictures ?? []).filter((p) => p[0] === "context").map((p) => p[1]);
  const checks = [
    JSON.stringify(R.checklists) === JSON.stringify(["still", "still", "cut"]),
    R.board.pictures?.[0]?.[0] === "subject" && R.board.pictures[0][2] === 1280 && R.board.pictures[0][3] === 704,
    ctx.some((w) => /master$/.test(w)) && ctx.some((w) => /plan$/.test(w)) && ctx.some((w) => /plate Pb gate inside, open$/.test(w)) && ctx.some((w) => /plate Pc square \+ well$/.test(w)) && !ctx.some((w) => /plate Pd houses/.test(w)),
    ctx.some((w) => /U93 Maren \(Cast v\d+\)/.test(w)),
    /does not take the pouch/.test(R.board.words?.prompt ?? "") && R.board.words.who_should_be_here?.includes("U93 Maren") && R.board.words.pins?.some((p) => /greatsword/.test(p.details ?? "")) && R.board.words.pins?.some((p) => p.ref.startsWith("location:") && p.notes),
    R.board.images === R.board.pictures?.length,
    R.big.pictures?.[0]?.[3] === 3328 && R.big.pictures[0][4] === 4096 && R.big.pictures.filter((p) => p[0] === "tile").length === 9,
    R.covered,
    R.big.pictures.filter((p) => p[0] === "tile").every((p) => p[3] === 1536 && p[4] === 1536),
    R.page.n === 4 && R.page.next?.offset === 4 && R.page.labels?.every((l) => /tile r\dc\d/.test(l)),
    JSON.stringify(R.mapped) === JSON.stringify(R.expect),
    ((f) => f.length >= 3 && f.slice(0, -1).every((x, i) => x === i * 12) && f.at(-1) > f.at(-2))(R.video.pictures?.filter((p) => p[0] === "subject").map((p) => p[1]) ?? []) && R.video.pictures.filter((p) => p[0] === "tile").length === 0, // G17b SNAP-R245: every half second and the last; a 64 px video needs no tiles
    R.locRows?.filter(([, c]) => c === "plate").length === 6 && R.locRows.some(([p, c]) => p === "master" && c === "master") && R.locRows.some(([p, c]) => p === "views" && c === "location"),
    R.views.subjects?.length === 8 && R.views.context === 1 && R.views.record === 6, // G3 F-E17: the plan with its marks drawn is the one context picture
    !R.errors.length,
  ];
  R.checks = checks;
  fs.writeFileSync(path.join(out, "test_u93_packet_result.json"), JSON.stringify(R, null, 1));
  console.log(`u93packet ${checks.filter(Boolean).length}/${checks.length} ${checks.every(Boolean) ? "PASS" : "FAIL " + JSON.stringify(checks.map((x, i) => (x ? null : i)).filter((x) => x != null))} · 4K packet ${(R.big.bytes / 1e6).toFixed(1)} MB in ${R.bigMs} ms`);
})();
