// Batch E task 2: a reference picture change reads for people, in full for agents (SNAP-R58). On the CPU test server,
// queued prompts rewritten as test_retake.js does. Take A (scene shot) pins Kon v1 (a green front picture); Mara has an
// orange one; Kon v2 changes only the front picture (blue).
// - the take's Re-run sheet: Kon's row (v1 → today v2) and, after picking Mara, the swap's lines show "front picture
//   changed" with both pictures as thumbnails and their file names; no line holds raw JSON ({"file": …});
// - the opened-file sheet (a workflow pinning Kon v1, dropped in) shows Kon's change the same way;
// - agents: diff_record keeps the full field line (refs [{"file": …}] → […]) and adds pictures [{role, was, now}]; the
//   rerun tool's plan does the same per swap. Screens 381 (take sheet), 382 (390 px), 383 (opened file).
// usage: node test_e_diff.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const KON = "snaptest_cast_kon_identity.safetensors", MARA = "snaptest_cast_mara_identity.safetensors";
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } }), page = await ctx.newPage();
  await useShelf(page, { extra: { loras: [[KON, 0.1], [MARA, 0.1]] } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const body = JSON.parse(r.request().postData());
    body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/batchE_diff" } } };
    delete body.partial_execution_targets;
    return r.continue({ postData: JSON.stringify(body) });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["M", "models"], ["W", "world"], ["T", "takes"], ["SC", "scenes"]]) window[`__${k}`] = await at(m); });
  const waitTake = (n) => ev(async (n) => { const T = window.__T; for (let i = 0; i < 160 && T.all().length < n; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, 300)); return T.all().at(-1)?.id ?? null; }, n);
  R.a = await ev(async ([kon, mara]) => {
    const L = window.__L, T = window.__T, SC = window.__SC;
    await T.load(); await SC.load(); await window.__M.load();
    const scene = await SC.create({ name: "Diff test" });
    await SC.addShot(scene.id, { name: "Kon walks" });
    await SC.openShot(scene.id, SC.get(scene.id).shots[0].id);
    window.__pic = async (id, colour) => { const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }); c.getContext("2d").fillStyle = colour; c.getContext("2d").fillRect(0, 0, 64, 64);
      return L.uploadCastPicture(new File([await new Promise((r) => c.toBlob(r, "image/png"))], "front.png", { type: "image/png" }), id); };
    const stamp = Date.now().toString(36), k = `cast-kondf${stamp}`, m = `cast-maradf${stamp}`;
    await L.saveCast(k, { name: "Kon", trigger: "kon_fennec", details: "a fennec-eared courier girl", lora: { file: kon, strength: 0.8 }, refs: [{ file: await window.__pic(k, "#3a6"), role: "identity: front" }] });
    await L.applyCast(`cast:${k}`);
    await L.saveCast(m, { name: "Mara", trigger: "", details: "a young woman with long dark wavy hair and a mustard coat", lora: { file: mara, strength: 0.7 }, refs: [{ file: await window.__pic(m, "#c93"), role: "identity: front" }] });
    return { scene: scene.id, kon: k, mara: m, takes: T.all().length, workflow: structuredClone(app.graph.serialize()) };
  }, [KON, MARA]);
  const kon = `cast:${R.a.kon}`, mara = `cast:${R.a.mara}`;
  await ev(() => app.queuePrompt(0, 1));
  R.a.take = await waitTake(R.a.takes + 1);
  R.v2 = await ev(async (k) => { const L = window.__L, W = window.__W, b = W.headOf(W.record("cast", k)).body; const file = await window.__pic(k, "#36c"); await L.saveCast(k, { ...b, refs: [{ file, role: "identity: front" }] }, { note: "new front picture" }); return { was: b.refs[0].file, now: file }; }, R.a.kon);
  // what a sheet shows: every line of its field lists, the picture rows (text, thumbnails' sources, file names)
  const look = (sel) => ev((sel) => { const s = document.querySelector(sel); if (!s) return null;
    return { lines: [...s.querySelectorAll(".snap-world-fields li")].map((li) => li.textContent),
      pics: [...s.querySelectorAll(".snap-world-pic")].map((p) => ({ text: p.textContent, imgs: [...p.querySelectorAll("img")].map((i) => { const q = new URL(i.src).searchParams; return `${q.get("subfolder")}/${q.get("filename")}`; }), loaded: [...p.querySelectorAll("img")].every((i) => i.complete && i.naturalWidth > 0) })) }; }, sel);
  // ---- the take's sheet ----
  await page.waitForTimeout(600);
  await page.click(`.snap-take[data-take="${R.a.take}"]`); await page.waitForTimeout(800);
  await page.click("text=Re-run with swaps…"); await page.waitForSelector(".snap-rerun-sheet", { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(800);
  R.moved = await look(".snap-rerun-sheet");
  await page.selectOption(`.snap-rerun-sheet .snap-rerun-pick[aria-label^="Kon"]`, mara); await page.waitForTimeout(900);
  R.picked = await look(".snap-rerun-sheet");
  await page.locator(".snap-rerun-sheet").screenshot({ path: path.join(out, "381-e-diff-rerun-sheet.png") });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  R.phone = await ev(() => { const s = document.querySelector(".snap-rerun-sheet"); return { sheet: s.scrollWidth - s.clientWidth, page: document.documentElement.scrollWidth - 390 }; });
  await page.locator(".snap-rerun-sheet .snap-world-row").first().screenshot({ path: path.join(out, "382-e-diff-rerun-sheet-phone.png") });
  await page.setViewportSize({ width: 1600, height: 1000 }); await page.waitForTimeout(400);
  await page.keyboard.press("Escape");
  // ---- an opened file pinning Kon v1 ----
  const wf = path.join(CFG.out, "_debug", "batchE", "e_diff_kon_v1_workflow.json");
  fs.mkdirSync(path.dirname(wf), { recursive: true }); fs.writeFileSync(wf, JSON.stringify(R.a.workflow));
  await page.locator(".snap-root input[type=file][hidden]").setInputFiles(wf);
  await page.waitForSelector(".snap-opened-sheet", { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(900);
  R.file = await look(".snap-opened-sheet");
  await page.locator(".snap-opened-sheet").screenshot({ path: path.join(out, "383-e-diff-opened-file.png") }).catch((e) => { R.shotErr = e.message; });
  await page.keyboard.press("Escape");
  // ---- agents ----
  R.diffRecord = await ev(async (kon) => window.__X.callTool("diff_record", { a: `${kon}@1`, b: kon }), kon);
  R.plan = await ev(async ([take, kon, mara]) => window.__X.callTool("rerun", { take, swaps: { [kon]: { to: mara } } }), [R.a.take, kon, mara]);
  R.errors = errs;

  const raw = (list) => (list ?? []).some((l) => l.includes('{"file"'));
  const shows = (p, a, z) => !!p && /front picture changed/.test(p.text) && p.imgs.length === 2 && p.imgs[0].includes(a) && p.imgs[1].includes(z) && p.loaded && p.text.includes(path.basename(a)) && p.text.includes(path.basename(z));
  const swap = R.plan.plan?.swaps?.[0];
  const c = {
    "take sheet, Kon's row (v1 → today v2): no raw JSON line": !raw(R.moved?.lines) && R.moved?.lines.some((l) => /lora|strength|details/.test(l)) === false,
    "take sheet, Kon's row: 'front picture changed' with both thumbnails and file names": shows(R.moved?.pics?.[0], R.v2.was, R.v2.now),
    "take sheet, Kon → Mara: no raw JSON, the other fields still listed": !raw(R.picked?.lines) && R.picked.lines.some((l) => l.startsWith("details")),
    "take sheet, Kon → Mara: 'front picture changed' from Kon's to Mara's picture": R.picked?.pics?.some((p) => /front picture changed/.test(p.text) && p.loaded && p.imgs[0] === R.v2.was && p.imgs[1].startsWith(`snap/cast/${R.a.mara}/`) && p.text.includes(`${path.basename(R.v2.was)} → ${path.basename(p.imgs[1])}`)),
    "390 px: the sheet and the page don't scroll sideways": R.phone.sheet <= 0 && R.phone.page <= 0,
    "opened file: Kon's change reads the same, no raw JSON": !raw(R.file?.lines) && shows(R.file?.pics?.[0], R.v2.was, R.v2.now),
    "diff_record keeps the full refs line for agents": R.diffRecord.changes?.some((x) => x.startsWith("refs ") && x.includes(R.v2.was) && x.includes(R.v2.now) && x.includes('"role":"identity: front"')),
    "diff_record adds pictures [{role, was, now}]": JSON.stringify(R.diffRecord.pictures) === JSON.stringify([{ role: "identity: front", was: R.v2.was, now: R.v2.now }]),
    "the rerun plan keeps the full fields and adds pictures per swap": swap?.fields?.some((x) => x.startsWith("refs ") && x.includes(R.v2.was)) && swap.pictures?.[0]?.role === "identity: front" && swap.pictures[0].was === R.v2.was && swap.pictures[0].now.includes(`snap/cast/${R.a.mara}/`),
    "no page errors": !R.errors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_e_diff_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`e_diff   ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
