// Batch C polish (coordinator's batch B review, ui/330 + 332) on the CPU test server:
// (a) the World sheet and the opened-file sheet sit in the same place, so one replaces the other: opening a file while
//     the World sheet is open leaves only the opened-file sheet (no World rows bleeding through), and opening World
//     again replaces it;
// (b) Library cards of kind cast say "Cast", never "Character";
// (and) an opened file whose pinned record is gone says so in its first line (it said "still at the same version").
// (The stale-page wording is checked in test_f20_f22.js.) Screens ui/353 (desktop), 354 (390 px), 355 (Library labels).
// usage: node test_c_polish.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const WF = path.join(CFG.out, "_debug", "u87_kon_v1_workflow.json"); // a saved workflow pinning a Cast record (test_world_cleanup.js writes it)
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const shoot = async (viewport, shot) => {
    const page = await (await b.newContext({ viewport })).newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
    await page.keyboard.press("Escape");
    const sheets = () => page.evaluate(() => [...document.querySelectorAll(".snap-world-sheet, .snap-opened-sheet")].map((s) => s.ariaLabel));
    // the rail's button on a desktop; at 390 px the rail is folded away, so the same function the button calls
    const world = async () => { if (viewport.width > 700) await page.locator("text=World: versions and sizes").first().click({ force: true });
      else await page.evaluate(async () => (await import("/extensions/ComfyUI-MAINodes/snap/worldview.js")).openWorld(document.querySelector(".snap-root"), { say() {}, onChange() {} }));
      await page.waitForTimeout(800); };
    await world();
    const r = { world: await sheets() };
    await page.locator(".snap-root input[type=file][hidden]").setInputFiles(WF);
    await page.waitForSelector(".snap-opened-sheet", { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(500);
    r.afterOpen = await sheets();
    r.intro = await page.evaluate(() => document.querySelector(".snap-opened-sheet .snap-opened-body > p")?.textContent ?? null);
    await page.screenshot({ path: path.join(out, shot) });
    await page.locator(".snap-opened-sheet .snap-x").click(); await page.waitForTimeout(300);
    await page.locator(".snap-root input[type=file][hidden]").setInputFiles(WF);
    await page.waitForSelector(".snap-opened-sheet", { timeout: 15000 }).catch(() => {}); await page.waitForTimeout(500);
    await world();
    r.afterWorld = await sheets();
    r.errors = errs;
    return { page, r };
  };
  try {
    const desk = await shoot({ width: 1600, height: 1000 }, "353-c-opened-sheet-alone.png");
    R.desktop = desk.r;
    // (b) the Library's cast cards
    await desk.page.evaluate(async () => (await import("/extensions/ComfyUI-MAINodes/snap/tools.js")).callTool("ui", { action: "close" })); await desk.page.waitForTimeout(300);
    R.labels = await desk.page.evaluate(async () => {
      const L = await import("/extensions/ComfyUI-MAINodes/snap/library.js");
      const kinds = [...document.querySelectorAll(".snap-card")].map((c) => [c.querySelector(".snap-kind")?.textContent, c.querySelector(".snap-card-title")?.textContent]);
      return { kindLabel: L.KIND_LABEL.cast, kinds, castCards: (await L.ready(), L.search("")).filter((c) => c.kind === "cast").length };
    });
    await desk.page.evaluate(() => document.querySelector(".snap-card")?.scrollIntoView({ block: "center" }));
    await desk.page.screenshot({ path: path.join(out, "355-c-library-cast-labels.png") });
    R.phone = (await shoot({ width: 390, height: 844 }, "354-c-opened-sheet-phone.png")).r;
  } finally { await b.close(); }
  const one = (x) => x?.world?.length === 1 && x.world[0] === "World" && x.afterOpen?.length === 1 && x.afterOpen[0] === "Opened file" && x.afterWorld?.length === 1 && x.afterWorld[0] === "World";
  const c = {
    "desktop: opening a file over the World sheet leaves only the opened-file sheet; World replaces it again": one(R.desktop),
    "390 px: the same, one sheet at a time": one(R.phone),
    "a pinned record that is gone: the sheet's first line says so instead of 'still at the same version'": /isn't in your records any more/.test(R.desktop.intro ?? ""),
    "the cast kind is labelled Cast": R.labels?.kindLabel === "Cast",
    "Library cards: cast cards say Cast, none says Character": R.labels.kinds.some(([k]) => k === "Cast") && !R.labels.kinds.some(([k]) => /charact/i.test(k ?? "")),
    "no page errors": ![...R.desktop.errors, ...R.phone.errors].length };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_c_polish_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`cpolish  ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
