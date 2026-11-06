// Batch E task 4 (SNAP-R23 notes, never a gate): a recast candidate painted from a Cast's picture shows how its painted
// face compares with that picture (the identity check's character score, "probably not <name>" below 0.45; G1b).
// The detection itself needs the GPU server (proto: _debug/batchE/gpu_recast_check.js on :8193); here, on the CPU test
// server, a recast decision whose notes hold such a check shows them: c1 "character vs Kon's picture 0.62" (quiet, a
// number; ArcFace only in the title), c2 "probably not Kon" (amber) with the scores in its title, the crops (Kon's picture | the painted head) on the tile, and a recast
// without a picture still says "new person". list_candidates gives the note whole. Screen 388 (the two tiles).
// usage: node test_e_recast_note.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  R.made = await page.evaluate(async () => {
    const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`), K = await at("checks"), T = await at("takes"), C = await at("candidates"), ED = await at("edits"), X = await at("tools");
    window.__X = X;
    const id = await K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/batchE_recast" } } }, { job: { kind: "run", title: "a test fixture take (SNAP-R65: every queued prompt carries its question)" }, group: app.graph.id });
    for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((r) => setTimeout(r, 500));
    const t = T.get(`take-${id}`), pic = t.media[0], crop = { filename: pic.filename, subfolder: pic.subfolder, type: pic.type };
    await C.load();
    const cast = (character) => ({ name: "Kon", picture: "snap/kon_front.png", character_low: character, face_low: 0.3, different: character < 0.45, different_below: 0.45, scores: [{ character, face: 0.3, crops: [crop, crop] }] });
    const d = await C.create({ kind: "edit", target: t.id, title: "Recast · Viggle Remake (Mara → Kon) of take 1", take: t.id, method: "remake_swap",
      options: { who: "the woman", becomes: "a young woman with a short platinum-blond bob", label: "Mara → Kon", picture: "snap/kon_front.png" }, clip: { video: "snaptest/batchE_recast.mp4 [output]", frames: 73, mid: 36, width: 64, height: 64 } },
      [{ seed: 1, take: t.id, frame: [53], pictures: [{ label: "frame 53", frame: 53, media: crop }], notes: { identity: { new_person: "recast", cast: cast(0.62) } } },
       { seed: 2, take: t.id, frame: [53], pictures: [{ label: "frame 53", frame: 53, media: crop }], notes: { identity: { new_person: "recast", cast: cast(0.12) } } },
       { seed: 3, take: t.id, frame: [53], pictures: [{ label: "frame 53", frame: 53, media: crop }], notes: { identity: { new_person: "recast" } } }]);
    for (const c of d.candidates) c.state = "ready";
    await C.save(d);
    return { take: t.id, decision: d.id };
  });
  await page.evaluate((id) => window.__X.callTool("ui", { action: "open_take", target: id }), R.made.take); await page.waitForTimeout(1200);
  R.tiles = await page.evaluate((d) => [...document.querySelectorAll(`[data-decision="${d}"] .snap-cand`)].map((el) => ({ notes: [...el.querySelectorAll(".snap-cand-note")].map((n) => [n.textContent, n.classList.contains("warn"), n.title]), crops: el.querySelectorAll(".snap-cand-crops img").length })), R.made.decision);
  await page.evaluate((d) => document.querySelector(`[data-decision="${d}"]`)?.scrollIntoView({ block: "center" }), R.made.decision); await page.waitForTimeout(300);
  await page.locator(`[data-decision="${R.made.decision}"]`).screenshot({ path: path.join(out, "388-e-recast-face-notes.png") }).catch((e) => { R.shotErr = e.message; });
  R.listed = await page.evaluate(async (d) => (await window.__X.callTool("list_candidates", { decision: d })), R.made.decision);
  R.errors = errs;
  const [a, z, none] = R.tiles, cand = (R.listed.decisions ?? R.listed)?.[0]?.candidates ?? [];
  const c = {
    "three recast tiles": R.tiles.length === 3,
    "c1: 'character vs Kon's picture 0.62', quiet, scores and ArcFace in its title": a?.notes.some(([t, w, title]) => t === "character vs Kon's picture 0.62" && !w && /0\.62/.test(title) && /Kon's picture/.test(title) && /ArcFace 0\.3/.test(title)),
    "c2: 'probably not Kon', amber, scores and threshold in its title": z?.notes.some(([t, w, title]) => t === "probably not Kon" && w && /0\.12/.test(title) && /0\.45/.test(title)),
    "c1/c2: the head crops (Kon's picture | the painted head) on the tile": a?.crops === 2 && z?.crops === 2,
    "no picture: still 'new person', no face chip": none?.notes.some(([t]) => t === "new person") && !none.notes.some(([t]) => /Kon/.test(t)),
    "list_candidates gives the cast note whole": JSON.stringify(cand[1]?.notes?.identity?.cast?.scores?.[0]?.character) === "0.12" && cand[1].notes.identity.cast.different === true,
    "no page errors": !R.errors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_e_recast_note_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`e_recast ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
