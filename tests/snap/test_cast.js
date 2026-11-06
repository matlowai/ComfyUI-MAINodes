// U86 step 2, Cast by reference, on the CPU test server (:8195; nothing is queued):
// - a Cast record (name, trigger, details, an identity LoRA from the test shelf, two reference pictures) applied to the
//   video recipe gives one Cast row with the record's file and strength, the trigger + details sentence in the prompt's
//   first line, two References pictures with source "cast:<id>", and extra.snap.world["cast:<id>"].n === 1;
// - after a hand edit of the row's strength, applying again replaces in place: one row at the record's strength, two
//   pictures, the sentence once;
// - v2 (new strength, new details, one picture dropped) applied by cast:<id>@2: the row at v2's strength, the new
//   sentence and not the old one, one picture, the pin n 2; v1 still reads as it was;
// - the Library shows the record as a cast card that apply_card puts in; the tools list_cast / save_cast / apply_cast;
// - the Cast sheet (from "+ New cast member" and from a card's ✎), screenshots 320-323 (desktop and 390 px phone).
// BEFORE=<git rev> serves that rev's library.js/view.js/tools.js (and no castview.js): the run must fail.
// usage: node test_cast.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const WT = CFG.pack, LORA = "snaptest_cast_kon_identity.safetensors";
const MODS = /\/extensions\/ComfyUI-MAINodes\/snap\/(library|view|tools|castview)\.js(\?.*)?$/;
async function open(b, viewport = { width: 1600, height: 1000 }) {
  const page = await (await b.newContext({ viewport })).newPage();
  await useShelf(page, { extra: { loras: [[LORA, 0.1]] } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  page.q = 0; await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { page.q++; return r.abort(); } return r.continue(); });
  if (process.env.BEFORE) await page.route(MODS, (r) => { const m = r.request().url().match(MODS)[1]; let body = ""; try { body = execSync(`git -C ${WT} show ${process.env.BEFORE}:web/snap/${m}.js`, { stdio: ["ignore", "pipe", "ignore"] }).toString(); } catch {} return body ? r.fulfill({ status: 200, contentType: "text/javascript", body }) : r.fulfill({ status: 404, body: "" }); });
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); window.__X = await at("tools"); window.__L = await at("library"); window.__E = await at("engine"); window.__M = await at("models"); window.__W = await at("world"); });
  return page;
}
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await open(b);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { app.graph.clear(); app.graph.extra = {}; await window.__X.callTool("start_recipe", {}); await window.__M.load(); });
  // two reference pictures, uploaded as a person's would be
  R.files = await ev(async () => {
    const pic = async (hue, name) => { const c = Object.assign(document.createElement("canvas"), { width: 96, height: 96 }), g = c.getContext("2d"); g.fillStyle = `hsl(${hue} 70% 55%)`; g.fillRect(0, 0, 96, 96); g.fillStyle = "#fff"; g.font = "28px sans-serif"; g.fillText(name[0].toUpperCase(), 34, 58);
      return new File([await new Promise((r) => c.toBlob(r, "image/png"))], `${name}.png`, { type: "image/png" }); };
    return [await window.__L.uploadCastPicture(await pic(40, "front"), "test-kon"), await window.__L.uploadCastPicture(await pic(200, "side"), "test-kon")];
  });
  const state = () => ev(() => {
    const E = window.__E, M = window.__M, first = (E.getValue("render", "render", "prompt") ?? "").split("\n")[0];
    return { rows: E.state().bricks.some((x) => x.key === "cast") ? M.rows("cast").map(({ file, strength, on }) => ({ file, strength, on })) : [], first,
      pics: (E.state().bricks.find((x) => x.key === "refs")?.pictures ?? []).map(({ file, role, source, card }) => ({ file, role, source, card })), world: E.state().world ?? null };
  });
  R.v1 = await ev(async ([lora, files]) => window.__L.saveCast(null, { name: "Kon", alias: "kon", trigger: "kon_fennec", details: "a fennec-eared courier girl with long blonde wavy hair, blue eyes, teal hoodie",
    lora: { file: lora, strength: 0.8 }, refs: [{ file: files[0], role: "identity: front" }, { file: files[1], role: "identity: side" }], lore: "delivers wires in Graph City", rating: null }), [LORA, R.files]);
  const ref = `cast:${R.v1.id}`;
  R.apply1 = await ev((ref) => window.__L.applyCast(ref), ref);
  R.after1 = await state();
  await ev(() => window.__M.setRow("cast", 0, { strength: 0.3 })); // a hand edit on the brick
  R.edited = await state();
  R.apply1b = await ev((ref) => window.__L.applyCast(ref), ref);
  R.after1b = await state();
  R.v2 = await ev(async ([id, lora, files]) => window.__L.saveCast(id, { name: "Kon", alias: "kon", trigger: "kon_fennec", details: "a fennec-eared courier girl, yellow raincoat",
    lora: { file: lora, strength: 0.6 }, refs: [{ file: files[0], role: "identity: front" }], lore: "delivers wires in Graph City", rating: null }, { note: "raincoat, lower strength" }), [R.v1.id, LORA, R.files]);
  R.v2same = await ev(async ([id, lora, files]) => window.__L.saveCast(id, { name: "Kon", alias: "kon", trigger: "kon_fennec", details: "a fennec-eared courier girl, yellow raincoat",
    lora: { file: lora, strength: 0.6 }, refs: [{ file: files[0], role: "identity: front" }], lore: "delivers wires in Graph City", rating: null }), [R.v1.id, LORA, R.files]);
  R.apply2 = await ev((ref) => window.__L.applyCast(`${ref}@2`), ref);

  R.after2 = await state();
  R.v1still = await ev((ref) => window.__W.get(`${ref}@1`)?.version.body.lora.strength, ref);
  // the Library card and the tools
  R.card = await ev((id) => { const c = window.__L.get(id); return c && { kind: c.kind, title: c.title, cast: c.brick.cast }; }, R.v1.id);
  R.tools = await ev(async ([ref, lora]) => {
    const X = window.__X, list = await X.callTool("list_cast", {});
    const made = await X.callTool("save_cast", { name: "Ferro", trigger: "", details: "an elderly lighthouse keeper with a white beard, yellow oilskin", lora: null, refs: [] });
    const applied = await X.callTool("apply_cast", { cast: made.cast });
    let bad = null; try { await X.callTool("save_cast", { name: "Nobody", lora: { file: "not_here.safetensors" } }); } catch (e) { bad = e.message; }
    const viaCard = await X.callTool("apply_card", { card: made.cast.split(":")[1] });
    const added = await X.callTool("add_lora", { file: lora, role: "identity" }).catch((e) => ({ error: e.message }));
    return { list: list.map((x) => ({ cast: x.cast, head: x.head, versions: x.versions.length })), made, applied: applied.done, worldKeys: Object.keys(applied.world), bad, viaCard: viaCard.done, addedHint: added.cast ?? added.error };
  }, [ref, LORA]);
  R.prompt = (await state()).first;
  // ---- the sheet, as a person meets it ----
  await page.click(".snap-new-cast"); await page.waitForTimeout(400);
  R.sheetNew = await ev(() => ({ open: !!document.querySelector(".snap-cast-sheet"), title: document.querySelector(".snap-cast-sheet header strong")?.textContent, versions: document.querySelector(".snap-cast-versions")?.textContent }));
  await page.keyboard.press("Escape");
  await ev((id) => { const q = document.querySelector(".snap-lib-q"); q.value = "Kon"; q.dispatchEvent(new Event("input")); }, R.v1.id); await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, "320-u86-cast-card-and-refs.png") });
  await page.click(`.snap-card[data-card="${R.v1.id}"] .snap-edit`).catch((e) => { R.clickErr = e.message; }); await page.waitForTimeout(600);
  R.sheetEdit = await ev(() => ({ title: document.querySelector(".snap-cast-sheet header strong")?.textContent, versions: [...document.querySelectorAll(".snap-cast-version strong")].map((x) => x.textContent),
    pics: document.querySelectorAll(".snap-cast-refs img").length, lora: document.querySelector(".snap-cast-lora select")?.value }));
  await page.screenshot({ path: path.join(out, "321-u86-cast-sheet.png") });
  await page.click(".snap-cast-version:last-child").catch(() => {}); await page.waitForTimeout(500); // v1, the oldest
  R.sheetOld = await ev(() => ({ title: document.querySelector(".snap-cast-sheet header strong")?.textContent, note: [...document.querySelectorAll(".snap-cast-sheet aside .snap-quiet")].map((x) => x.textContent).join(" | ") }));
  await page.screenshot({ path: path.join(out, "322-u86-cast-sheet-older-version.png") });
  // words that change the look while the pictures stay the same: one line says the pictures usually win (never refused)
  R.look = await ev(async ([id, lora, files]) => { const L = window.__L, b = { name: "Kon", alias: "kon", trigger: "kon_fennec", details: "a fennec-eared courier girl, green raincoat", lora: { file: lora, strength: 0.6 }, refs: [{ file: files[0], role: "identity: front" }], lore: "delivers wires in Graph City", rating: null };
    const v3 = await L.saveCast(id, b, { note: "green" }), v4 = await L.saveCast(id, { ...b, lora: { file: lora, strength: 0.5 } });
    return { v3: v3.warning ?? null, v3n: v3.n, v4: v4.warning ?? null }; }, [R.v1.id, LORA, R.files]);
  // ... and the Cast sheet says it where the person saves (screen 337)
  await ev(async (id) => { const { openCast } = await import("/extensions/ComfyUI-MAINodes/snap/castview.js"); await openCast(document.querySelector(".snap-root"), { id }); }, R.v1.id); await page.waitForTimeout(500);
  await page.fill('.snap-cast-sheet textarea[aria-label="details"]', "a fennec-eared courier girl, purple raincoat");
  await page.click('.snap-cast-sheet button:text-is("Save")'); await page.waitForTimeout(700);
  R.sheetWarn = await ev(() => [document.querySelector(".snap-cast-sheet header strong")?.textContent, document.querySelector(".snap-cast-sheet [role=status]")?.textContent, document.querySelector(".snap-cast-sheet .snap-world-warn")?.textContent].join(" | "));
  await page.locator(".snap-cast-sheet").screenshot({ path: path.join(out, "337-u86-cast-look-warning.png") });
  await page.keyboard.press("Escape");
  R.errors = page.errs; R.queue = page.q;
  // phone width
  const phone = await open(b, { width: 390, height: 844 });
  await phone.evaluate(async (id) => { const { openCast } = await import("/extensions/ComfyUI-MAINodes/snap/castview.js"); await openCast(document.querySelector(".snap-root") ?? document.body, { id }); }, R.v1.id).catch((e) => { R.phoneErr = e.message; });
  await phone.waitForTimeout(600);
  R.phone = await phone.evaluate(() => { const s = document.querySelector(".snap-cast-sheet"), r = s?.getBoundingClientRect(); return r && { left: r.left, right: r.right, width: innerWidth, scrollW: document.documentElement.scrollWidth }; });
  await phone.screenshot({ path: path.join(out, "323-u86-cast-sheet-phone.png") });
  R.phoneErrors = phone.errs;

  const sentence1 = "kon_fennec, a fennec-eared courier girl with long blonde wavy hair, blue eyes, teal hoodie", sentence2 = "kon_fennec, a fennec-eared courier girl, yellow raincoat";
  const count = (s, x) => s.split(x).length - 1;
  const c = {
    "applied: one Cast row with the record's file and strength": JSON.stringify(R.after1.rows) === JSON.stringify([{ file: LORA, strength: 0.8, on: true }]),
    "applied: the trigger + details sentence in the prompt's first line": count(R.after1.first, sentence1) === 1,
    "applied: two References pictures from the record, source cast:<id>, card cast:<id>@1": R.after1.pics.filter((p) => p.source === ref).length === 2 && R.after1.pics.every((p) => p.source !== ref || p.card === `${ref}@1`),
    "applied: the recipe pins cast:<id> at v1": R.after1.world?.[ref]?.n === 1 && R.after1.world[ref].hash?.length === 12,
    "a hand edit, then apply again: replaced in place (one row at the record's strength, two pictures, the sentence once)": R.edited.rows[0]?.strength === 0.3 && JSON.stringify(R.after1b.rows) === JSON.stringify(R.after1.rows)
      && R.after1b.pics.length === R.after1.pics.length && count(R.after1b.first, sentence1) === 1,
    "a save that changes nothing makes no version": R.v2.made && R.v2.n === 2 && !R.v2same.made && R.v2same.n === 2,
    "v2 applied: its strength, its sentence (the old one gone), its one picture, the pin at 2": R.after2.rows.length === 1 && R.after2.rows[0].strength === 0.6 && count(R.after2.first, sentence2) === 1 && !R.after2.first.includes("teal hoodie")
      && R.after2.pics.filter((p) => p.source === ref).length === 1 && R.after2.world[ref].n === 2 && !R.after2.first.includes(".."),
    "v1 stays as it was": R.v1still === 0.8,
    "new words with the same pictures say the pictures usually win; a strength-only change says nothing": /pictures still show the old look/.test(R.look.v3 ?? "") && R.look.v3n === 3 && R.look.v4 === null && /^Cast: Kon · v5 \| Saved Kon v5 \| Kon's pictures still show the old look/.test(R.sheetWarn ?? ""),
    "the Library shows the record as a cast card": R.card?.kind === "cast" && R.card.title === "Cast: Kon" && R.card.cast === ref,
    "tools: list_cast, save_cast (a missing LoRA file refused by name), apply_cast, apply_card on a cast card": R.tools.list.some((x) => x.cast === ref && x.head === 2 && x.versions === 2) && R.tools.made.version === 1
      && /not_here\.safetensors/.test(R.tools.bad ?? "") && R.tools.worldKeys.includes(R.tools.made.cast) && /Ferro v1/.test(R.tools.viaCard ?? ""),
    "add_lora with an identity LoRA points at save_cast": /save_cast/.test(R.tools.addedHint ?? ""),
    "a refs-only character adds words and no row": count(R.prompt, "an elderly lighthouse keeper") === 1 && /words|prompt/.test(R.tools.applied ?? ""),
    "+ New cast member opens an empty sheet": R.sheetNew.open && R.sheetNew.title === "New cast member" && /Save makes version 1/.test(R.sheetNew.versions ?? ""),
    "a card's ✎ opens the record at its newest version with both versions listed": /Cast: Kon · v2/.test(R.sheetEdit.title ?? "") && R.sheetEdit.versions.join() === "v2 · newest,v1" && R.sheetEdit.pics === 1 && R.sheetEdit.lora === LORA,
    "an older version opens with a note that saving makes the next one": /v1 \(newest is v2\)/.test(R.sheetOld.title ?? "") && /Saving makes v3/.test(R.sheetOld.note),
    "the sheet fits a 390 px phone": !!R.phone && R.phone.left >= 0 && R.phone.right <= R.phone.width && R.phone.scrollW <= R.phone.width,
    "nothing queued, no page errors": R.queue === 0 && !R.errors.length && !R.phoneErrors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_cast_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`cast     ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
