// U89 step 2 (SNAP-R63): the Re-run sheet, on the CPU test server (:8195), queued prompts rewritten as test_retake.js does.
// Take A (scene shot) pins Kon v1 (LoRA, details, picture) and Ana v1 (words only); Mara is saved; Kon v2 and Ana v2 too.
// - the take viewer's re-take row has "Re-run with swaps…", which opens the sheet: a row per pin with its pick (as it was,
//   latest (v2), Mara as another cast), then Scene and Setup rows that say they are not records; with nothing picked and
//   the same seed it says ComfyUI would serve the take's own file;
// - picking Mara shows "Kon → Mara" and the field changes, the cache note goes; Re-generate queues the workflow marked
//   extra.snap.rerun with the same swap the rerun tool writes, and Ana stays pinned;
// - the navigator's shot ⋯ offers "Re-run … with swaps…" and opens the same sheet;
// - an opened file pinning Kon v1 and Ana v1 opens it as the opened-file sheet: both rows moved, Run as it was / Run with
//   today's world / Edit then run, plus the picks; at 390 px the sheet fits with no sideways scroll.
// Screens 372 (take, Mara picked), 373 (opened file, two moved pins), 374 (390 px).
// usage: node test_rerun_sheet.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const KON = "snaptest_cast_kon_identity.safetensors", MARA = "snaptest_cast_mara_identity.safetensors";
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const open = async (viewport) => {
    const page = await (await b.newContext({ viewport })).newPage();
    await useShelf(page, { extra: { loras: [[KON, 0.1], [MARA, 0.1]] } });
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    page.queued = []; page.errs = [];
    await page.route(/\/(api\/)?prompt$/, (r) => {
      if (r.request().method() !== "POST") return r.continue();
      const body = JSON.parse(r.request().postData());
      page.queued.push({ workflow: body.extra_data?.extra_pnginfo?.workflow ?? null, prompt: body.prompt });
      body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/u89sheet" } } };
      delete body.partial_execution_targets;
      return r.continue({ postData: JSON.stringify(body) });
    });
    page.on("pageerror", (e) => page.errs.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
    await page.keyboard.press("Escape");
    await page.evaluate(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["E", "engine"], ["M", "models"], ["W", "world"], ["T", "takes"], ["SC", "scenes"], ["RR", "rerun"]]) window[`__${k}`] = await at(m); });
    return page;
  };
  const page = await open({ width: 1600, height: 1000 }), ev = (fn, arg) => page.evaluate(fn, arg);
  const waitTake = (n) => ev(async (n) => { const T = window.__T; for (let i = 0; i < 160 && T.all().length < n; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, 300)); return T.all().at(-1)?.id ?? null; }, n);
  R.a = await ev(async ([kon, mara]) => {
    const L = window.__L, T = window.__T, SC = window.__SC;
    await T.load(); await SC.load(); await window.__M.load();
    const scene = await SC.create({ name: "Rerun sheet test" });
    await SC.addShot(scene.id, { name: "Kon and Ana" });
    const shot = SC.get(scene.id).shots[0].id;
    await SC.openShot(scene.id, shot);
    const pic = async (id, colour) => { const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }); c.getContext("2d").fillStyle = colour; c.getContext("2d").fillRect(0, 0, 64, 64);
      return L.uploadCastPicture(new File([await new Promise((r) => c.toBlob(r, "image/png"))], "front.png", { type: "image/png" }), id); };
    const stamp = Date.now().toString(36), k = `cast-konrs${stamp}`, a = `cast-anars${stamp}`, m = `cast-marars${stamp}`;
    await L.saveCast(k, { name: "Kon", trigger: "kon_fennec", details: "a fennec-eared courier girl", lora: { file: kon, strength: 0.8 }, refs: [{ file: await pic(k, "#3a6"), role: "identity: front" }] });
    await L.saveCast(a, { name: "Ana", trigger: "", details: "a woman in a red scarf", lora: null, refs: [] });
    await L.applyCast(`cast:${k}`); await L.applyCast(`cast:${a}`);
    await L.saveCast(m, { name: "Mara", trigger: "", details: "a young woman with long dark wavy hair and a mustard coat", lora: { file: mara, strength: 0.7 }, refs: [{ file: await pic(m, "#c93"), role: "identity: front" }] });
    return { scene: scene.id, shot, kon: k, ana: a, mara: m, takes: T.all().length, workflow: structuredClone(app.graph.serialize()) };
  }, [KON, MARA]);
  const kon = `cast:${R.a.kon}`, ana = `cast:${R.a.ana}`, mara = `cast:${R.a.mara}`;
  await ev(() => app.queuePrompt(0, 1));
  R.a.take = await waitTake(R.a.takes + 1);
  await ev(async ([id, prompt]) => { const T = window.__T, t = T.get(id); t.hash = (await T.hashes(T.canonical(prompt))).hash; }, [R.a.take, page.queued[0].prompt]); // as a real capture hashes it
  // ---- the take's sheet, from the viewer (no newer versions yet: the cache note) ----
  await page.waitForTimeout(600);
  await page.click(`.snap-take[data-take="${R.a.take}"]`); await page.waitForTimeout(800);
  R.viewerButtons = await ev(() => [...document.querySelectorAll(".snap-take-sheet .snap-retake button")].map((x) => x.textContent));
  await page.click("text=Re-run with swaps…"); await page.waitForSelector(".snap-rerun-sheet", { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(600);
  const sheet = () => ev(() => { const s = document.querySelector(".snap-rerun-sheet"); return s && { title: s.querySelector("header strong")?.textContent, rows: [...s.querySelectorAll(".snap-world-row")].map((r) => ({ head: r.querySelector("strong")?.textContent, text: r.textContent, options: [...(r.querySelector(".snap-rerun-pick")?.options ?? [])].map((o) => [o.value, o.textContent, o.disabled]) })),
    route: s.querySelector(".snap-rerun-route")?.textContent, cache: s.querySelector(".snap-world-warn:not([hidden])") ? [...s.querySelectorAll(":scope .snap-opened-body > .snap-world-warn")].map((x) => (x.hidden ? null : x.textContent)).filter(Boolean) : [], buttons: [...s.querySelectorAll("button")].map((x) => x.textContent) }; });
  R.fresh = await sheet();
  // newer versions, then the sheet again so its rows know them
  await ev(async ([k, a, lora]) => { const L = window.__L, W = window.__W; await L.saveCast(k, { ...W.headOf(W.record("cast", k)).body, lora: { file: lora, strength: 0.6 } }, { note: "lower strength" }); await L.saveCast(a, { ...W.headOf(W.record("cast", a)).body, details: "a woman in a green scarf" }, { note: "scarf" }); }, [R.a.kon, R.a.ana, KON]);
  await page.keyboard.press("Escape");
  await page.click(`.snap-take[data-take="${R.a.take}"]`); await page.waitForTimeout(800);
  await page.click("text=Re-run with swaps…"); await page.waitForTimeout(800);
  await page.selectOption(`.snap-rerun-sheet .snap-rerun-pick[aria-label^="Kon"]`, mara); await page.waitForTimeout(700);
  R.picked = await sheet();
  R.what = await ev(() => document.querySelector(`.snap-rerun-sheet .snap-rerun-pick[aria-label^="Kon"]`)?.closest(".snap-world-row")?.querySelector(".snap-rerun-what")?.textContent ?? null);
  await page.locator(".snap-rerun-sheet").screenshot({ path: path.join(out, "372-u89-rerun-sheet-take.png") });
  const n1 = page.queued.length, t1 = await ev(() => window.__T.all().length);
  await page.click(".snap-rerun-actions button.snap-primary");
  R.regenTake = await waitTake(t1 + 1);
  R.regenClosed = await ev(() => !document.querySelector(".snap-rerun-sheet"));
  R.regenStatus = await ev(() => document.querySelector(".snap-rerun-sheet [role=status]")?.textContent ?? null);
  R.regenQueued = page.queued.slice(n1).map((q) => q.workflow?.extra?.snap?.rerun ?? null);
  R.regenWorld = page.queued.at(-1)?.workflow?.extra?.snap?.world ? Object.keys(page.queued.at(-1).workflow.extra.snap.world) : [];
  // ---- the navigator's shot ⋯ ----
  await page.waitForTimeout(500);
  await page.click(".snap-shot-more").catch((e) => { R.moreErr = e.message; }); await page.waitForTimeout(400);
  R.menu = await ev(() => [...document.querySelectorAll(".snap-scene-menu button")].map((x) => x.textContent));
  await page.locator(".snap-scene-menu button", { hasText: "with swaps" }).click().catch((e) => { R.menuErr = e.message; }); await page.waitForTimeout(800);
  R.fromShot = (await sheet())?.title ?? null;
  await page.keyboard.press("Escape");
  // ---- an opened file pinning Kon v1 and Ana v1 ----
  const wf = path.join(CFG.out, "_debug", "u89_kon_ana_v1_workflow.json");
  fs.mkdirSync(path.dirname(wf), { recursive: true }); fs.writeFileSync(wf, JSON.stringify(R.a.workflow));
  await page.locator(".snap-root input[type=file][hidden]").setInputFiles(wf);
  await page.waitForSelector(".snap-opened-sheet", { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(800);
  R.file = await ev(() => { const s = document.querySelector(".snap-opened-sheet.snap-rerun-sheet"); return s && { title: s.querySelector("header strong")?.textContent, moved: s.querySelectorAll(".snap-world-row.moved").length, picks: s.querySelectorAll(".snap-rerun-pick").length,
    actions: [...s.querySelectorAll(".snap-set-actions button")].map((x) => [x.textContent, x.disabled]), swapsBtn: [...s.querySelectorAll(".snap-rerun-actions button")].map((x) => [x.textContent, x.disabled]) }; });
  await page.locator(".snap-opened-sheet").screenshot({ path: path.join(out, "373-u89-rerun-sheet-file.png") });
  const n2 = page.queued.length;
  await page.click(".snap-opened-sheet >> text=Run with today's world"); await page.waitForTimeout(1200);
  R.fileToday = page.queued.slice(n2).map((q) => ({ world: Object.fromEntries(Object.entries(q.workflow?.extra?.snap?.world ?? {}).map(([r, p]) => [r, p.n])), rerun: q.workflow?.extra?.snap?.rerun ?? null }));
  R.errors = page.errs;
  // ---- 390 px ----
  const phone = await open({ width: 390, height: 844 });
  await phone.evaluate(async (take) => { const { openRerunSheet } = await import("/extensions/ComfyUI-MAINodes/snap/rerunsheet.js"); await window.__T.load(); await openRerunSheet(document.querySelector(".snap-root"), { take: window.__T.get(take), say() {}, edit() {} }); }, R.a.take);
  await phone.waitForTimeout(800);
  R.phone = await phone.evaluate(() => { const r = document.querySelector(".snap-rerun-sheet")?.getBoundingClientRect(); return r && { left: r.left, right: r.right, width: innerWidth, scrollW: document.documentElement.scrollWidth, picks: [...document.querySelectorAll(".snap-rerun-pick")].every((p) => p.getBoundingClientRect().right <= r.right + 1) }; });
  await phone.screenshot({ path: path.join(out, "374-u89-rerun-sheet-phone.png") });
  R.phoneErrors = phone.errs;

  const konRow = R.picked?.rows.find((r) => r.head?.startsWith("Kon")), scene = R.fresh?.rows.find((r) => r.head?.startsWith("Scene")), setup = R.fresh?.rows.find((r) => r.head?.startsWith("Setup"));
  const c = {
    "the viewer's re-take row offers Re-run with swaps…": R.viewerButtons.includes("Re-run with swaps…"),
    "the sheet opens from the viewer with a row per pin, then Scene and Setup saying they are not records": R.fresh?.title === `Re-run take 1 with swaps` && R.fresh.rows.length === 4 && /not a record/.test(scene?.text ?? "") && /not a record/.test(setup?.text ?? ""),
    "nothing picked, same seed: it says ComfyUI would serve the take's own file": R.fresh?.cache.some((x) => /serve take 1's own file/.test(x)),
    "Kon's pick lists as it was, latest (v2), and Mara as another cast": konRow?.options[0]?.[1] === "as it was (v1)" && konRow.options.some((o) => o[0] === "latest" && o[1] === "latest (v2)" && !o[2]) && konRow.options.some((o) => o[0] === mara && o[1] === "Mara (another cast)"),
    "picking Mara shows Kon → Mara and the field changes; the cache note goes; the route line names it": /Kon → Mara/.test(R.what ?? "") && /details/.test(R.what) && !R.picked.cache.length && /with Kon → Mara/.test(R.picked.route),
    "Re-generate queues the rerun mark with the swap (as the tool writes it), Ana stays pinned, the sheet closes": R.regenClosed && R.regenQueued.length === 1 && R.regenQueued[0]?.route === "regenerate" && R.regenQueued[0].swaps?.[kon]?.text === "Kon → Mara" && R.regenWorld.includes(mara) && R.regenWorld.includes(ana) && !R.regenWorld.includes(kon),
    "the shot's ⋯ offers re-run and opens the same sheet": R.menu.some((x) => /^Re-run .* with swaps…$/.test(x)) && /^Re-run take \d+ with swaps$/.test(R.fromShot ?? ""),
    "an opened file shows both moved pins, the three run buttons and the picks": R.file?.moved === 2 && R.file.actions.map((x) => x[0]).join("|") === "Run as it was|Run with today's world|Edit then run" && !R.file.actions[1][1] && R.file.picks === 3 && R.file.swapsBtn[0]?.[0] === "Run with these swaps" && R.file.swapsBtn[0][1] === true,
    "Run with today's world runs the file with both at v2, unmarked": R.fileToday.length === 1 && R.fileToday[0].world[kon] === 2 && R.fileToday[0].world[ana] === 2 && !R.fileToday[0].rerun,
    "390 px: the sheet and its picks fit, no sideways scroll": R.phone && R.phone.left >= 0 && R.phone.right <= R.phone.width && R.phone.scrollW <= R.phone.width && R.phone.picks,
    "no page errors": !R.errors.length && !R.phoneErrors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_rerun_sheet_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`rrsheet  ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
