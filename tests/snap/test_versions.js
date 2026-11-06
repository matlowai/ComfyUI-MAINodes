// U87 step 5, set and scene versions in use, on the CPU test server (:8195; nothing is queued):
// - a scene: create + five document actions (two shots added, scene renamed, a shot renamed, shots reordered) make six
//   authored versions; bookkeeping (a take joining a shot by sync, the active take) makes none; diff_record names the
//   change between two scene versions;
// - the set editor's "Save as version" with a note keeps a listed version with that note (the Library lists it);
//   get_record returns the body, the versions and pinned_by; diff_record between two set versions names the field.
// Screen 329 (the set editor's version row).
// usage: node test_versions.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { q++; return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["W", "world"], ["T", "takes"], ["SC", "scenes"]]) window[`__${k}`] = await at(m); });
  R.scene = await ev(async () => {
    const SC = window.__SC, T = window.__T, X = window.__X;
    await SC.load(); await T.load();
    const s = await SC.create({ name: "Versions test" });
    await SC.addShot(s.id, { name: "one" }); await SC.addShot(s.id, { name: "two" });
    await SC.renameScene(s.id, "Versions test, renamed");
    const shots = SC.get(s.id).shots.map((x) => x.id);
    await SC.renameShot(s.id, shots[0], "the first");
    await SC.moveShot(s.id, shots[1], 0);
    const after = SC.get(s.id).versions.length;
    // bookkeeping: a shot adopting a take group, then a second take of that group joining it by sync (no version)
    const take = (id, n) => T.save({ id, kind: "run", prompt_id: id, created: Date.now(), group: "u87v-g1", workflow: "", number: n, status: "success", text: "", seed: null, media: [], verdict: null, prior: false, notes: [] });
    await take("take-u87v-1", 1);
    await SC.addShot(s.id, { name: "adopted", adopt: "u87v-g1" });
    const withThree = SC.get(s.id).versions.length;
    await take("take-u87v-3", 2);
    for (let i = 0; i < 20 && SC.get(s.id).shots.at(-1).takes.length < 2; i++) await new Promise((r) => setTimeout(r, 250));
    const synced = SC.get(s.id).shots.at(-1).takes.length;
    const d = await X.callTool("diff_record", { a: `scene:${s.id}@1`, b: `scene:${s.id}@${after}` });
    return { id: s.id, after, withThree, synced, versionsNow: SC.get(s.id).versions.length, notes: SC.get(s.id).versions.map((v) => v.note), diff: d.changes };
  });
  // the active take is bookkeeping: no version
  R.active = await ev(async (id) => {
    const SC = window.__SC, shot = SC.get(id).shots.at(-1), before = SC.get(id).versions.length;
    const r = await SC.setActive(id, shot.id, "take-u87v-3").catch((e) => ({ error: e.message }));
    return { before, after: SC.get(id).versions.length, r };
  }, R.scene.id);
  // ---- the set editor's Save as version ----
  await ev(() => { const q = document.querySelector(".snap-lib-q"); q.value = "lamp room"; q.dispatchEvent(new Event("input")); }); await page.waitForTimeout(600);
  await page.click('.snap-card[data-card="set-lamp-room-end-s3"] .snap-card-tools .snap-edit:last-child'); await page.waitForTimeout(800);
  await page.fill(".snap-set-note", "props moved for the reverse");
  await page.locator(".snap-set-note").evaluate((e) => e.closest(".snap-set-actions").scrollIntoView({ block: "center" }));
  await page.screenshot({ path: path.join(out, "329-u87-set-save-as-version.png") });
  await page.click("text=Save as version"); await page.waitForTimeout(900);
  R.set = await ev(async () => {
    const W = window.__W, L = window.__L, X = window.__X, r = W.record("set_snapshot", "set-lamp-room-end-s3");
    const g = await X.callTool("get_record", { ref: "set_snapshot:set-lamp-room-end-s3" });
    // a second state, so diff_record has two versions to compare
    const root = L.get("set-lamp-room-end-s3"), s = structuredClone(root.brick.snapshot); s.camera.lens = 85;
    await L.save(L.version(root, s, false), { note: "85 mm" });
    const d = await X.callTool("diff_record", { a: "set_snapshot:set-lamp-room-end-s3@1", b: "set_snapshot:set-lamp-room-end-s3" });
    return { versions: r.versions.map((v) => [v.n, v.note, v.listed ?? null]), lineage: L.lineage(root).map((c) => c.id).length, get: { ref: g.ref, head: g.head, versions: g.versions.length, pinned_by: g.pinned_by, hasBody: !!g.body?.brick?.snapshot }, diff: d.changes };
  });
  R.queue = q; R.errors = errs;
  const c = {
    "create + five document actions make six scene versions": R.scene.after === 6 && R.scene.notes.slice(0, 6).join("|") === "created|added one|added two|renamed|shot renamed|shots reordered",
    "a take joining a shot by sync makes no version": R.scene.synced === 2 && R.scene.versionsNow === R.scene.withThree,
    "the active take makes no version": R.active.after === R.active.before,
    "diff_record names what changed between two scene versions": R.scene.diff.some((x) => /^name /.test(x)) && R.scene.diff.some((x) => /^shots \[\] → \[\{/.test(x)),
    "Save as version keeps a listed version with its note": R.set.versions[0]?.[1] === "props moved for the reverse" && R.set.versions[0][2] === true,
    "get_record gives the body, the versions and pinned_by": R.set.get.ref === "set_snapshot:set-lamp-room-end-s3@1" && R.set.get.hasBody && Array.isArray(R.set.get.pinned_by),
    "diff_record between two set versions names the field": R.set.diff.includes("brick.snapshot.camera.lens 50 → 85") || R.set.diff.some((x) => /camera\.lens .* → 85/.test(x)),
    "nothing queued, no page errors": R.queue === 0 && !R.errors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_versions_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`versions ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
