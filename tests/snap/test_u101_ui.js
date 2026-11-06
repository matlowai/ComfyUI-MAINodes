// the operator's UI items of 2026-11-05 17:4x on the CPU test server:
// 1. a shot with takes and no active take shows its newest take on its tile, "no active take · N takes" and "☆ make
//    active" (one click makes the newest the shot's take); an empty shot still says "no takes yet";
// 2. a take whose pinned Cast didn't fully reach it says what in plain words ("Maren v2: its description wasn't in the
//    prompt"), with a hover listing each part; a reason it can't state shows no chip;
// 3. the bricks rail is wider by default (304 px), drag-resizable by its edge, remembered across a reload, and a
//    double-click resets it;
// 4. take thumbnails letterbox portrait stills (object-fit: contain) instead of cropping a torso slice.
// (The stale chip's words, "Empty Image width changed", are checked by run_all's takestale suite.) Screens ui_*.png.
// usage: node test_u101_ui.js [port 8195]     BEFORE=234ee8d node test_u101_ui.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui", "u101"), R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port, { viewport: { width: 1600, height: 1000 } }), page = A.page;
    await page.evaluate(() => { try { localStorage.removeItem("mainodes.snap.railWidth"); } catch { /* none */ } });
    R.fix = await page.evaluate(async () => {
      const SC = window.__SC, T = window.__T, J = window.__J; await T.load(); await SC.load();
      const s = await SC.create({ name: "UI items" }); await SC.addShot(s.id, { name: "boards" }); await SC.addShot(s.id, { name: "empty" });
      const [boards, empty] = SC.get(s.id).shots; await SC.openShot(s.id, boards.id);
      const ids = [];
      for (let k = 0; k < 2; k++) { const id = await J.queueRun({ kind: "run", title: `a board ${k}`, about: J.here() }, () => app.queuePrompt(0, 1)); for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((r) => setTimeout(r, 250)); ids.push(`take-${id}`); }
      await SC.setActive(s.id, boards.id, null, "person");
      // two takes pinning a Cast that didn't fully reach them: one stated reason, one it can't state
      const u = Date.now().toString(36), group = T.groupOf(), base = { kind: "run", status: "success", text: "", seed: 1, verdict: null, notes: [], group, media: T.get(ids[1]).media, prompt: T.get(ids[1]).prompt };
      await T.save({ ...base, id: `take-ui-unplaced-${u}`, prompt_id: `ui-unplaced-${u}`, created: Date.now() - 60000, number: 90,
        world: { "cast:cast-ui": { n: 2, name: "Maren", placed: { text: "Maren, a swordswoman", missing: ["its details line isn't in the prompt that ran", "its pictures weren't read: no Ref2V setup"] } } } });
      await T.save({ ...base, id: `take-ui-vague-${u}`, prompt_id: `ui-vague-${u}`, created: Date.now() - 60000, number: 91, world: { "cast:cast-ui2": { n: 1, name: "Brann v1", placed: { missing: ["something an older build wrote"] } } } });
      return { scene: s.id, boards: boards.id, empty: empty.id, takes: ids, unplaced: `take-ui-unplaced-${u}`, vague: `take-ui-vague-${u}` };
    });
    await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); snap.view.render(null); });
    await page.waitForTimeout(1200);
    const tiles = () => page.$$eval(".snap-shot-tile", (xs) => xs.map((t) => ({ media: t.querySelector(".snap-shot-media img, .snap-shot-media video") ? "picture" : t.querySelector(".snap-take-none")?.textContent, caption: t.querySelector("figcaption .snap-quiet")?.textContent, star: t.querySelector(".snap-shot-star")?.textContent ?? null, text: t.textContent })));
    R.tilesBefore = await tiles();
    await page.locator(".snap-scene").screenshot({ path: path.join(out, "ui_shot_tiles.png") }).catch(() => {});
    await page.click(".snap-shot-tile .snap-shot-star").catch(() => {}); await page.waitForTimeout(1200);
    R.active = await page.evaluate(([s, sh]) => window.__SC.get(s).shots.find((x) => x.id === sh).active, [R.fix.scene, R.fix.boards]);
    R.tilesAfter = await tiles();
    // 2. the unplaced chips
    R.chips = await page.$$eval(".snap-take", (xs) => xs.map((x) => ({ take: x.dataset.take, chip: x.querySelector(".snap-take-unplaced")?.textContent ?? null, title: x.querySelector(".snap-take-unplaced")?.title ?? null })));
    await page.locator(`.snap-take[data-take="${R.fix.unplaced}"]`).screenshot({ path: path.join(out, "ui_unplaced_chip.png") }).catch(() => {});
    // 4. letterboxed thumbnails
    R.fit = await page.$$eval(".snap-take-media img, .snap-shot-media img", (xs) => [...new Set(xs.map((x) => getComputedStyle(x).objectFit))]);
    // 3. the rail
    const railW = () => page.$eval(".snap-rail", (x) => Math.round(x.getBoundingClientRect().width));
    R.rail0 = await railW();
    R.names = await page.$$eval(".snap-rail .snap-rail-part > *", (xs) => xs.slice(0, 12).map((x) => [x.textContent.trim(), Math.round(x.getBoundingClientRect().height)]));
    const handle = await page.$(".snap-rail-handle");
    if (handle) { const bb = await handle.boundingBox(); await page.mouse.move(bb.x + bb.width / 2, bb.y + 300); await page.mouse.down(); await page.mouse.move(bb.x + 120, bb.y + 300, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(500); }
    R.rail1 = await railW();
    await page.screenshot({ path: path.join(out, "ui_rail_wide.png") });
    await page.reload(); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000); await page.keyboard.press("Escape");
    await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); if (!snap.switch?.showing) await snap.toggle(); }); await page.waitForTimeout(1000);
    R.rail2 = await railW();
    await page.dblclick(".snap-rail-handle").catch(() => {}); await page.waitForTimeout(500);
    R.rail3 = await railW();
    const bad = (t) => /\bnull\b|undefined|\[object|NaN/.test(t ?? "null");
    const empty = R.tilesBefore.find((t) => /empty/.test(t.text)), boards = R.tilesBefore.find((t) => /boards/.test(t.text));
    const checks = {
      "1 a shot with takes and none active shows its newest take, 'no active take · N takes' and ☆ make active": boards?.media === "picture" && /^no active take · \d+ takes$/.test(boards.caption ?? "") && boards.star === "☆ make active",
      "1 an empty shot still says 'no takes yet'": empty?.media === "no takes yet" && !empty.star,
      "1 ☆ make active makes the newest take the shot's take": R.active === R.fix.takes[1] && /★/.test(R.tilesAfter.find((t) => /boards/.test(t.text))?.caption ?? ""),
      "2 the unplaced chip says what in plain words, with every part on hover": R.chips.find((c) => c.take === R.fix.unplaced)?.chip === "Maren v2: its description wasn't in the prompt +1"
        && /its pictures weren't used \(no Ref2V setup\)/.test(R.chips.find((c) => c.take === R.fix.unplaced)?.title ?? ""),
      "2 a reason it can't state shows no chip": R.chips.find((c) => c.take === R.fix.vague)?.chip === null,
      "3 the rail is 304 px by default, drags wider, is remembered across a reload, double-click resets": R.rail0 === 304 && R.rail1 > 360 && Math.abs(R.rail2 - R.rail1) <= 2 && R.rail3 === 304,
      "3 brick names fit one line at the default width": R.names.length > 0 && R.names.every(([, hgt]) => hgt <= 48),
      "4 take and shot thumbnails letterbox (object-fit contain)": JSON.stringify(R.fit) === JSON.stringify(["contain"]),
      "no stray null on the tiles and chips": !R.tilesBefore.some((t) => bad(t.text)) && !R.chips.some((c) => c.chip && bad(c.chip)),
      // a reload that opens Snap straight away renders a slot brick before the method registry loads ("No slot
      // \"upscale\""): 234ee8d does the same (before-run), so it is not this batch's; reported to the coordinator
      "no page errors (but the reload's known registry race)": !A.errors.filter((e) => !/^No slot "upscale"; there are: $/.test(e)).length,
    };
    R.errors = A.errors;
    console.log(JSON.stringify(R, null, 1));
    let n = 0;
    for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); n += !v; }
    console.log(`u101ui   ${Object.keys(checks).length - n}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
    process.exitCode = n ? 1 : 0;
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
