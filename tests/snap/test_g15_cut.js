// Batch G15, the Book's Cut opens in Astrid (SNAP-R212) and a cut reuses a take from another scene (SNAP-R213), on the
// CPU test server: a 3-cut Book whose C2 takes an earlier scene's take (set_active_take: brought_from, the take kept as
// it was, its Nearby line says where from), C3's take is private and C1's ran with metadata off:
// - export_cut writes <name>.astrid beside the .otio: every entry stored; exactly manifest.json, timeline.json and
//   media/<sha256>; the manifest's media sha256 and size match the take files; parent.clips == parent.config.clips;
//   registry.assets keys are take ids naming exactly the manifest's media; every clip names a registered asset;
// - the private take's bytes and clip are not in it (left_out says so, with its gap), and C2 sits after C1's trimmed time;
// - generation.snap: C1 ids only (metadata off), C2 its take, cut, Book, world pins and recipe_digest (= the digest of
//   its kept prompt); new runs store recipe_digest;
// - with SNAP_TEST_ASTRID_PY (a Python with Astrid installed) and SNAP_TEST_ASTRID_VALIDATE (the lab's archive
//   validator script), Astrid's own import preflight accepts the archive; without them that check is skipped (said).
// - SNAP-R214 (F-AC08): a refused rerun or retake of a take whose workflow has no nodes (a region edit) opens and
//   writes nothing; the shot's files and the open recipe stay as they were.
// usage: node test_g15_cut.js [port] [base]   prints "g15cut n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), crypto = require("crypto"), { execFileSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const D = CFG.fixture("short04");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g15cut-${Date.now()}`)); } };
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
// the archive read with Python's zipfile (each entry's name, compression and the sha256 of its bytes)
const ZIP = "import json,sys,zipfile,hashlib\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({'entries':[{'name':i.filename,'stored':i.compress_type==zipfile.ZIP_STORED,'sha':hashlib.sha256(z.read(i)).hexdigest(),'size':i.file_size} for i in z.infolist()],'manifest':json.loads(z.read('manifest.json')),'timeline':json.loads(z.read('timeline.json'))}))";
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "location", "proposals.json"]) park(d); // moved, never deleted
  const fout = path.join(base, "output", "snaptest_g15cut");
  fs.mkdirSync(fout, { recursive: true });
  for (const f of ["C1_pick.mp4", "C2_pick.mp4"]) fs.copyFileSync(path.join(D, "cuts", f), path.join(fout, f));
  // the private take's file: bytes of its own, so its absence from the archive is checkable
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x176:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(fout, "C3_private.mp4")]);
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    await page.route(/\/(api\/)?prompt$/, (r) => (r.request().method() === "POST" && /MAISnapCut/.test(r.request().postData() ?? "") ? r.continue() : r.fallback()));
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const done = async (run) => { for (let i = 0; i < 240; i++) { const h = await F.history(port, run); if (h?.status?.completed || h?.status?.status_str === "error") return h.status.status_str; await page.waitForTimeout(500); } return "timeout"; };
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const cast = (await call("save_cast", { name: "Maren", details: "a tall swordswoman with a long white braid" })).cast;
    const book = (await call("create_book", { name: "G15 gate", medium: "anime", logline: "Maren comes to the gate.", cast: [cast] })).book;
    const c1 = await call("add_cut", { book, scene_name: "G15 gate", cast: [cast], seconds: 3 });
    const c2 = await call("add_cut", { book, scene: c1.scene, cast: [cast], seconds: 3 });
    const c3 = await call("add_cut", { book, scene: c1.scene, cast: [cast], seconds: 2 });
    // an earlier scene's take (as seq01 reuses short03's), and the Book's own takes
    const old = await call("create_scene", { name: "G15 earlier short" }), oldScene = old.scene?.id ?? old.id ?? old.scene;
    const oldShot = (await call("add_shot", { scene: oldScene, name: "At the gate" })).shot?.id;
    R.takes = await page.evaluate(async ({ c1, c3, oldScene, oldShot, cast }) => {
      const T = window.__T, SC = window.__SC;
      const mk = async (id, file, group, extra = {}) => { await T.save({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 60, group, number: 1, status: "success", text: id, seed: 1, media: [{ kind: "video", filename: file, subfolder: "snaptest_g15cut", type: "output" }], verdict: "keep", notes: [], ...extra }); return id; };
      await mk("take-g15c1", "C1_pick.mp4", "g15-c1", { metadata: false, prompt: { 1: { class_type: "EmptyImage", inputs: { width: 64 } } }, graph: {} });
      await mk("take-g15old", "C2_pick.mp4", "g15-old", { prompt: { 1: { class_type: "EmptyImage", inputs: { width: 64, seed: 7 } } }, graph: {}, world: { [cast]: { n: 1, name: "Maren" } } });
      await mk("take-g15c3", "C3_private.mp4", "g15-c3", { private: true, prompt: {}, graph: {} });
      await SC.addGroup(oldScene, oldShot, "g15-old"); await SC.setActive(oldScene, oldShot, "take-g15old", "person");
      await SC.addGroup(c1.scene, c1.shot, "g15-c1"); await SC.setActive(c1.scene, c1.shot, "take-g15c1", "person");
      await SC.addGroup(c3.scene, c3.shot, "g15-c3"); await SC.setActive(c3.scene, c3.shot, "take-g15c3", "person");
      return { digest: await T.digestOf(T.get("take-g15old")) };
    }, { c1, c3, oldScene, oldShot, cast });
    // SNAP-R213: C2 takes the earlier scene's take
    R.reuse = await call("set_active_take", { scene: c2.scene, shot: c2.shot, take: "take-g15old" });
    R.reuseTake = await page.evaluate(() => { const t = window.__T.get("take-g15old"); return { group: t.group, world: t.world }; });
    R.oldStill = await page.evaluate(({ s, x }) => window.__SC.get(s).shots.find((y) => y.id === x).active, { s: oldScene, x: oldShot });
    R.nearLine = await page.evaluate(async () => { const N = await import("/extensions/ComfyUI-MAINodes/snap/nearby.js"); await N.load(); return N.what("take-g15old").line; });
    R.badTake = await call("set_active_take", { scene: c2.scene, shot: c2.shot, take: "take-nosuch" });
    await call("set_unit", { scene: c1.scene, shot: c1.shot, trim: { in_s: 0.5 } });
    R.cut = await call("export_cut", { book });
    R.cutDone = await done(R.cut.run);
    const ax = R.cut.otio?.astrid;
    R.ax = ax;
    R.zip = ax?.archive && fs.existsSync(ax.archive) ? JSON.parse(execFileSync("python3", ["-I", "-c", ZIP, ax.archive]).toString()) : null;
    R.beside = ax ? [ax.timeline, ax.assets].every((f) => fs.existsSync(f)) : false;
    // SNAP-R214 (F-AC08): a region edit's take keeps a workflow with no nodes; a refused rerun or retake of it opens and
    // writes nothing, and the open recipe still reads
    const sceneDir = path.join(base, "user", "default", "snap", "scenes", c1.scene), files = () => (fs.existsSync(sceneDir) ? fs.readdirSync(sceneDir).sort().map((f) => [f, sha(path.join(sceneDir, f))]) : []);
    await page.evaluate(async ({ c1 }) => { await window.__T.save({ id: "take-g15paint", kind: "run", prompt_id: "g15paint", created: Date.now(), seconds: 20, group: "g15-c1", number: 2, status: "success", text: "paint", seed: 1, media: [{ kind: "image", filename: "C1_pick.mp4", subfolder: "snaptest_g15cut", type: "output" }], parent: { method: "view/ph3_view", take: "take-g15c1" }, prompt: { 1: { class_type: "EmptyImage", inputs: {} } }, graph: { id: "g15-c1", nodes: [], links: [], extra: {} }, verdict: null, notes: [] }); }, { c1 });
    await call("open_shot", { scene: c1.scene, shot: c1.shot }); await page.waitForTimeout(1500);
    const before = JSON.stringify(files()), nodesBefore = await page.evaluate(() => app.graph.nodes.length);
    R.paintRerun = await call("rerun", { take: "take-g15paint", swaps: {} });
    R.paintRetake = await call("retake", { take: "take-g15paint" });
    await page.waitForTimeout(1500);
    R.paintSame = JSON.stringify(files()) === before && before !== "[]";
    R.paintNodes = [nodesBefore, await page.evaluate(() => app.graph.nodes.length)];
    R.paintDescribe = await call("describe_recipe", {});
    // a new run stores its recipe_digest
    const run = await call("run", { question: "g15 digest" });
    for (let i = 0; i < 40 && !R.newDigest; i++) { R.newDigest = await page.evaluate((id) => window.__T.get(`take-${id}`)?.recipe_digest ?? null, run.run); if (!R.newDigest) await page.waitForTimeout(500); }
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  // Astrid's own preflight (the lab's validator), when this machine has it
  const apy = process.env.SNAP_TEST_ASTRID_PY, aval = process.env.SNAP_TEST_ASTRID_VALIDATE;
  if (apy && aval && R.ax?.archive) { try { R.astrid = JSON.parse(execFileSync(apy, ["-I", aval, R.ax.archive], { cwd: path.dirname(aval) }).toString()); } catch (e) { R.astrid = { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` }; } }
  const S = R, zip = S.zip, m = zip?.manifest, tl = zip?.timeline?.parent, files = { c1: sha(path.join(base, "output", "snaptest_g15cut", "C1_pick.mp4")), c2: sha(path.join(base, "output", "snaptest_g15cut", "C2_pick.mp4")), c3: sha(path.join(base, "output", "snaptest_g15cut", "C3_private.mp4")) };
  const clip = (take) => tl?.clips?.find((c) => c.asset === take);
  const checks = {
    "R213 a take of another scene becomes C2's active take, saying where from": S.reuse?.active === "take-g15old" && /^G15 earlier short › /.test(S.reuse?.brought_from ?? ""),
    "R213 the take itself is unchanged and its own shot keeps it": S.reuseTake?.group === "g15-old" && S.reuseTake?.world && S.oldStill === "take-g15old",
    "R213 its Nearby line says it stands for C2, brought from the earlier scene": /active take of .*brought from G15 earlier short › /i.test(S.nearLine ?? ""),
    "R213 a take that doesn't exist is refused": /take-nosuch isn't a take of .* or anywhere here/.test(S.badTake?.error ?? ""),
    "R212 the Cut assembles and the answer names the archive and the import command (into its production's project, SNAP-R223)": S.cutDone === "success" && /\.astrid$/.test(S.ax?.archive ?? "") && /^astrid timelines import .*\.astrid --project g15-gate --name /.test(S.ax?.import ?? "") && S.beside,
    "R212 every entry stored; exactly manifest, timeline and the media": !!zip && zip.entries.every((e) => e.stored) && JSON.stringify(zip.entries.map((e) => e.name).sort()) === JSON.stringify(["manifest.json", "timeline.json", ...m.media.map((x) => `media/${x.sha256}`)].sort()),
    "R212 manifest format and media match the files (sha256, size)": m?.format === "astrid.timeline/1" && m.media.length === 2 && m.media.every((x) => [files.c1, files.c2].includes(x.sha256) && zip.entries.find((e) => e.name === `media/${x.sha256}`)?.sha === x.sha256 && zip.entries.find((e) => e.name === `media/${x.sha256}`)?.size === x.size),
    "R212 parent.clips mirror config.clips; assets are take ids naming exactly the media": tl && JSON.stringify(tl.clips) === JSON.stringify(tl.config.clips) && JSON.stringify(Object.keys(tl.registry.assets).sort()) === JSON.stringify(["take-g15c1", "take-g15old"]) && JSON.stringify(Object.values(tl.registry.assets).map((a) => a.media_id.replace("sha256:", "")).sort()) === JSON.stringify(m.media.map((x) => x.sha256).sort()) && tl.clips.every((c) => c.asset in tl.registry.assets),
    "R212 the private take's bytes and clip are not in it; left_out says so": !!zip && !zip.entries.some((e) => e.sha === files.c3) && !clip("take-g15c3") && S.ax?.left_out?.length === 1 && S.ax.left_out[0].take === "take-g15c3" && /private/.test(S.ax.left_out[0].why),
    "R212 clips in Cut order: C2 starts where C1's trimmed time ends": clip("take-g15c1")?.at === 0 && clip("take-g15c1")?.from === 0.5 && Math.abs(clip("take-g15old")?.at - (clip("take-g15c1")?.to - clip("take-g15c1")?.from)) < 0.002 && tl.clips.every((c) => c.clipType === "media" && c.track === "V1" && c.speed === 1),
    "R212 metadata off: C1's generation.snap is ids only": JSON.stringify(Object.keys(clip("take-g15c1")?.generation?.snap ?? {}).sort()) === JSON.stringify(["book", "cut", "metadata", "take"]),
    "R212 C2's generation.snap: take, cut, Book, world pins, recipe_digest": (() => { const g = clip("take-g15old")?.generation?.snap; return g?.take === "take-g15old" && /^book:/.test(g.book) && !!g.cut && Object.values(g.world ?? {})[0] === 1 && g.recipe_digest === S.takes?.digest && /^sha256:[0-9a-f]{64}$/.test(g.recipe_digest); })(),
    "R212 a new run stores recipe_digest": /^sha256:[0-9a-f]{64}$/.test(S.newDigest ?? ""),
    [`R212 Astrid's own import preflight accepts it${apy && aval ? "" : " (skipped: SNAP_TEST_ASTRID_PY / SNAP_TEST_ASTRID_VALIDATE unset)"}`]: !(apy && aval) || (S.astrid?.ok === true && S.astrid.clips === 2 && S.astrid.media === 2),
    "R214 F-AC08 a refused rerun / retake of a take with no workflow nodes opens and writes nothing": /no recipe to open .*Nothing was opened or saved/.test(S.paintRerun?.error ?? "") && /no recipe to open/.test(S.paintRetake?.error ?? "") && S.paintSame === true && S.paintNodes?.[0] > 0 && S.paintNodes[1] === S.paintNodes[0] && typeof S.paintDescribe?.revision === "string",
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify({ ...R, zip: R.zip && { entries: R.zip.entries, manifest: R.zip.manifest, clips: R.zip.timeline?.parent?.clips } }, null, 1));
  console.log(`g15cut ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
