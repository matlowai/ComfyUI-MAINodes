// U87 step 6, the World sheet and clean-up, plus the opened-file sheet (the operator 22:44), on the CPU test server (:8195).
// - /mainodes/snap/sizes: a Cast record's bytes and its picture's bytes match os stat; the take that pins it is named;
// - Archive (the sheet's button) takes it out of the Library while cast:<id>@1 still resolves; Restore brings it back;
// - export_records with takes writes a zip holding manifest.json, the record, its picture and the take;
// - Delete… says how many takes pin it and offers Export first; Delete removes the record file; importing the zip brings
//   it back with the same id and hashes; delete_record from an agent waits as a proposal;
// - a saved workflow that pins Kon v1, opened with Snap's Open file after Kon v2, shows the opened-file sheet (today: v2,
//   the field change); "Run with today's world" queues once with the pin at v2.
// Screens 330-333 (World sheet, delete confirm, opened-file sheet, World sheet at 390 px).
// usage: node test_world_cleanup.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const BASE = CFG.base;
const LORA = "snaptest_cast_kon_identity.safetensors";
async function open(b, viewport = { width: 1600, height: 1000 }) {
  const page = await (await b.newContext({ viewport })).newPage();
  await useShelf(page, { extra: { loras: [[LORA, 0.1]] } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  page.q = 0; await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { page.q++; page.lastWorkflow = JSON.parse(r.request().postData()).extra_data?.extra_pnginfo?.workflow; return r.abort(); } return r.continue(); });
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["E", "engine"], ["M", "models"], ["W", "world"], ["T", "takes"]]) window[`__${k}`] = await at(m); });
  return page;
}
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await open(b);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { app.graph.clear(); app.graph.extra = {}; await window.__X.callTool("start_recipe", {}); await window.__M.load(); await window.__T.load(); });
  R.made = await ev(async (lora) => {
    const L = window.__L, T = window.__T, E = window.__E;
    const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }); c.getContext("2d").fillStyle = "#c84"; c.getContext("2d").fillRect(0, 0, 64, 64);
    const id = `cast-cleanup${Date.now().toString(36)}`, pic = await L.uploadCastPicture(new File([await new Promise((r) => c.toBlob(r, "image/png"))], "front.png", { type: "image/png" }), id);
    const k = await L.saveCast(id, { name: "Kon", trigger: "kon_fennec", details: "a fennec-eared courier girl", lora: { file: lora, strength: 0.8 }, refs: [{ file: pic, role: "identity: front" }] });
    await L.applyCast(k.ref);
    await T.save({ id: "take-cleanup-1", kind: "run", prompt_id: "cleanup-1", created: Date.now(), group: app.graph.id, workflow: "", number: 1, status: "success", text: "", seed: null, media: [], verdict: null, prior: false, notes: [], world: structuredClone(E.state().world) });
    return { id, pic, saved: app.graph.serialize() };
  }, LORA);
  const ref = `cast:${R.made.id}`, recFile = path.join(BASE, "user/default/snap/cast", `${R.made.id}.json`);
  R.sizes = await ev(async (ref) => (await window.__W.sizes()).records.find((r) => r.ref === ref), ref);
  R.stat = { record: fs.statSync(recFile).size, pic: fs.statSync(path.join(BASE, "input", R.made.pic)).size };
  // ---- the sheet: archive and restore ----
  await page.click("text=World: versions and sizes"); await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(out, "330-u87-world-sheet.png") });
  const row = () => page.locator(".snap-world-item", { hasText: "Kon" }).first();
  await row().locator("text=Archive").click(); await page.waitForTimeout(800);
  R.archived = await ev((ref) => ({ inLibrary: !!window.__L.get(ref.split(":")[1]), resolves: !!window.__W.get(`${ref}@1`), file: null, status: document.querySelector(".snap-world-sheet [role=status]")?.textContent }), ref);
  R.archivedFile = fs.existsSync(path.join(BASE, "user/default/snap/_archived/cast", `${R.made.id}.json`)) && !fs.existsSync(recFile);
  await row().locator("text=Restore").click(); await page.waitForTimeout(800);
  R.restored = await ev((ref) => !!window.__L.get(ref.split(":")[1]), ref);
  // ---- export ----
  R.exported = await ev(async (ref) => window.__X.callTool("export_records", { refs: [ref], with_takes: true }), ref);
  const zip = path.join(BASE, "output", R.exported.subfolder, R.exported.file);
  R.zipNames = JSON.parse(execSync(`python3 -I -c "import zipfile,sys,json;print(json.dumps(zipfile.ZipFile(sys.argv[1]).namelist()))" ${JSON.stringify(zip)}`).toString());
  // ---- delete, with its confirmation ----
  await row().locator(".snap-world-line .snap-world-del").click(); await page.waitForTimeout(400);
  R.confirm = await ev(() => document.querySelector(".snap-world-confirm")?.textContent ?? null);
  await page.screenshot({ path: path.join(out, "331-u87-world-delete-confirm.png") });
  await page.locator(".snap-world-confirm .snap-danger").click(); await page.waitForTimeout(800);
  R.deleted = { file: fs.existsSync(recFile), inLibrary: await ev((id) => !!window.__L.get(id), R.made.id) };
  // ---- import brings it back ----
  R.imported = await ev(async (x) => window.__X.callTool("import_records", { file: x.file, subfolder: x.subfolder, type: x.type }), R.exported);
  R.back = await ev((ref) => { const r = window.__W.record("cast", ref.split(":")[1]); return r && { id: r.id, hashes: r.versions.map((v) => v.hash.slice(0, 12)), inLibrary: !!window.__L.get(r.id) }; }, ref);
  R.manifestHashes = R.exported.manifest.records[0].versions.map((v) => v.hash.slice(0, 12));
  // ---- an agent's delete waits ----
  R.proposal = await ev(async (ref) => window.__X.callTool("delete_record", { ref, reason: "test" }), ref);
  await page.keyboard.press("Escape");
  // ---- the opened-file sheet: the saved workflow pins Kon v1; Kon v2 is saved, then the file is opened ----
  await ev(async ([id, lora, pic]) => window.__L.saveCast(id, { name: "Kon", trigger: "kon_fennec", details: "a fennec-eared courier girl", lora: { file: lora, strength: 0.6 }, refs: [{ file: pic, role: "identity: front" }] }, { note: "lower strength" }), [R.made.id, LORA, R.made.pic]);
  const wf = path.join(CFG.out, "_debug", "u87_kon_v1_workflow.json");
  fs.mkdirSync(path.dirname(wf), { recursive: true }); fs.writeFileSync(wf, JSON.stringify(R.made.saved));
  await page.locator('.snap-root input[type=file][hidden]').setInputFiles(wf);
  await page.waitForSelector(".snap-opened-sheet", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(500);
  R.opened = await ev(() => ({ open: !!document.querySelector(".snap-opened-sheet"), title: document.querySelector(".snap-opened-sheet header strong")?.textContent, rows: [...document.querySelectorAll(".snap-opened-sheet .snap-world-row")].map((r) => r.textContent),
    buttons: [...document.querySelectorAll(".snap-opened-sheet .snap-set-actions button")].map((x) => [x.textContent, x.disabled]) }));
  await page.screenshot({ path: path.join(out, "332-u87-opened-file-sheet.png") });
  const q0 = page.q;
  await page.click("text=Run with today's world").catch((e) => { R.runErr = e.message; }); await page.waitForTimeout(1200);
  R.ranToday = { queued: page.q - q0, pin: page.lastWorkflow?.extra?.snap?.world?.[ref]?.n ?? null };
  R.errors = page.errs;
  // ---- phone ----
  const phone = await open(b, { width: 390, height: 844 });
  await phone.evaluate(async () => { const { openWorld } = await import("/extensions/ComfyUI-MAINodes/snap/worldview.js"); await openWorld(document.querySelector(".snap-root") ?? document.body, {}); });
  await phone.waitForTimeout(700);
  R.phone = await phone.evaluate(() => { const r = document.querySelector(".snap-world-sheet")?.getBoundingClientRect(); return r && { left: r.left, right: r.right, width: innerWidth, scrollW: document.documentElement.scrollWidth }; });
  await phone.screenshot({ path: path.join(out, "333-u87-world-sheet-phone.png") });
  R.phoneErrors = phone.errs;

  const c = {
    "sizes: the record's bytes and its picture's bytes match os stat; the pinning take is named": R.sizes?.bytes === R.stat.record && R.sizes.media_bytes === R.stat.pic && R.sizes.pinned_by.includes("take-cleanup-1"),
    "Archive takes it out of the Library, the file moves to _archived, cast:<id>@1 still resolves": !R.archived.inLibrary && R.archived.resolves && R.archivedFile,
    "Restore brings it back": R.restored,
    "the export zip holds the manifest, the record, its picture and the take": ["manifest.json", `records/cast/${R.made.id}.json`, `media/input/${R.made.pic}`, "takes/take-cleanup-1.json"].every((n) => R.zipNames.includes(n)),
    "Delete… names the pinning take and offers Export first": /1 take pinned it/.test(R.confirm ?? "") && /still run as they were/.test(R.confirm ?? "") && /Export first/.test(R.confirm ?? ""),
    "Delete removes the record file and the card": !R.deleted.file && !R.deleted.inLibrary,
    "import brings it back with the same id and hashes": R.imported.records?.includes(ref) && R.back?.id === R.made.id && R.back.hashes.join() === R.manifestHashes.join() && R.back.inLibrary,
    "an agent's delete_record waits as a proposal naming what pins it": !!R.proposal.proposed && R.proposal.plan?.pinned_by?.includes("take-cleanup-1"),
    "an opened file that pins Kon v1 shows the sheet: today v2 and the field change": R.opened.open && R.opened.rows.some((t) => /Kon v1/.test(t) && /today: v2/.test(t) && /lora\.strength 0\.8 → 0\.6/.test(t)),
    "the sheet offers Run as it was / Run with today's world / Edit then run": R.opened.buttons.map((x) => x[0]).join("|") === "Run as it was|Run with today's world|Edit then run" && !R.opened.buttons[1][1],
    "Run with today's world queues once with the pin at v2": R.ranToday.queued === 1 && R.ranToday.pin === 2,
    "the World sheet fits a 390 px phone": !!R.phone && R.phone.left >= 0 && R.phone.right <= R.phone.width && R.phone.scrollW <= R.phone.width,
    "no page errors": !R.errors.length && !R.phoneErrors.length,
  };
  R.checks = c;
  delete R.made.saved;
  fs.writeFileSync(path.join(out, "test_world_cleanup_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`cleanup  ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
