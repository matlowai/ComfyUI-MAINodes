// U82 (SNAP-R39) in the page: a take is rated as what made it. On the CPU test server: a take whose prompt text holds a
// term is Adult (the server's rating, with why), a plain one PG, and a version of the Adult take made from PG text is Adult
// too (raised to the take it came from). The person's pick in the viewer wins; the card shows Mature and Adult, never PG;
// list_takes and get_take carry the rating. On the fresh server (:8196): every file of every kit setup has a rating in the
// model graph, and propose_downloads gives each file's rating. Queues only 64 px EmptyImage -> SaveImage prompts.
// Screenshots: ui/260-u82-take-rating-viewer.png, ui/261-u82-take-rating-cards.png.
// usage: node test_u82_takes.js [port 8195] [fresh port 8196]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, fresh = process.argv[3] || CFG.freshPort, out = path.join(CFG.out, "ui"), R = {};
async function open(b, p) {
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  await page.goto(`http://127.0.0.1:${p}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
  return page;
}
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await open(b, port);
  await page.evaluate(async () => { app.graph.clear(); app.graph.extra = {}; window.__X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); await window.__X.callTool("start_recipe", {});
    await app.extensionManager.setting.set("MAINodes.Snap.RatePromptWords", true); }); // ungated: words rate only with this setting
  const take = (text, extra) => page.evaluate(async ([text, extra]) => {
    const K = await import("/extensions/ComfyUI-MAINodes/snap/checks.js"), T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
    const id = await K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/u82" } },
      3: { class_type: "PrimitiveStringMultiline", inputs: { value: text } } }, { job: { kind: "run", title: "a test fixture take (SNAP-R65: every queued prompt carries its question)" }, group: app.graph.id, ...(extra ? { extra } : {}) });
    for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((r) => setTimeout(r, 500));
    const t = T.get(`take-${id}`);
    return t && { id: t.id, number: t.number, rating: t.rating ?? null, why: t.rating_why ?? null };
  }, [text, extra]);
  R.plain = await take("a lighthouse keeper at dusk");
  R.adult = await take("a nude figure study at dusk");
  R.version = await take("the same at night", { snap_parent: { take: R.adult.id, method: "edit/test" } });
  await page.waitForTimeout(800);
  R.cards = await page.evaluate((ids) => ids.map((id) => document.querySelector(`.snap-take[data-take="${id}"] .snap-take-rating`)?.textContent ?? null), [R.plain.id, R.adult.id, R.version.id]);
  // the person rates the plain take Mature in its viewer
  await page.click(`.snap-take[data-take="${R.plain.id}"]`); await page.waitForTimeout(800);
  R.viewer = await page.evaluate(() => ({ value: document.querySelector(".snap-take-ratingrow select")?.value ?? null, note: document.querySelector(".snap-take-ratingrow .snap-quiet")?.textContent ?? null }));
  await page.selectOption(".snap-take-ratingrow select", "mature"); await page.waitForTimeout(600);
  R.afterPick = await page.evaluate(() => document.querySelector(".snap-take-ratingrow .snap-quiet")?.textContent ?? null);
  await page.screenshot({ path: path.join(out, "260-u82-take-rating-viewer.png") });
  await page.keyboard.press("Escape"); await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector(".snap-takes")?.scrollIntoView());
  R.cardsAfter = await page.evaluate((ids) => ids.map((id) => document.querySelector(`.snap-take[data-take="${id}"] .snap-take-rating`)?.textContent ?? null), [R.plain.id, R.adult.id, R.version.id]);
  await page.screenshot({ path: path.join(out, "261-u82-take-rating-cards.png") });
  R.saved = await page.evaluate(async (id) => (await (await fetch(`/api/userdata/${encodeURIComponent(`snap/takes/${id}.json`)}`)).json()).rating_set ?? null, R.plain.id);
  R.listed = await page.evaluate((ids) => window.__X.callTool("list_takes", {}).then((l) => l.filter((t) => ids.includes(t.id)).map((t) => [t.id, t.rating])), [R.plain.id, R.adult.id, R.version.id]);
  R.got = await page.evaluate((id) => window.__X.callTool("get_take", { take: id }).then((t) => [t.rating, t.rating_why]), R.version.id);
  R.errors = page.errs;
  R.wordsSetting = await page.evaluate(() => app.extensionManager.setting.get("MAINodes.Snap.RatePromptWords"));
  await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.RatePromptWords", false)); // a remembered setting: put it back
  // kits: every kit file arrives rated
  const f = await open(b, fresh);
  R.kits = await f.evaluate(async () => {
    const OB = await import("/extensions/ComfyUI-MAINodes/snap/onboarding.js"), X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js");
    await OB.load(); const files = {};
    for (const k of OB.kits()) { const r = await OB.kit(k.intent); for (const s of [r.recommended, r.fast, ...r.also].filter(Boolean)) for (const x of s.files) files[x.file] = x.rating; }
    const proposed = await X.callTool("propose_downloads", { intents: OB.kits().map((k) => k.intent) });
    return { files, unrated: Object.keys(files).filter((n) => !files[n]), proposedUnrated: proposed.files.filter((x) => !x.rating).map((x) => x.file), proposed: proposed.files.length };
  });
  R.freshErrors = f.errs;
  const c = {
    "plain take PG": R.plain.rating === "pg", "term take Adult with why": R.adult.rating === "adult" && R.adult.why.some((w) => w.includes("nude")),
    "version of an Adult take is Adult": R.version.rating === "adult" && R.version.why.some((w) => w.includes(`take ${R.adult.number}`)),
    "cards: Adult chips, none for PG": R.cards[0] === null && R.cards[1] === "Adult" && R.cards[2] === "Adult",
    "viewer shows the made-with rating": R.viewer.value === "pg" && /how it was made/.test(R.viewer.note),
    "the person's pick wins": R.afterPick === "You rated it." && R.cardsAfter[0] === "Mature" && R.saved === "mature",
    "list_takes and get_take carry it": JSON.stringify(R.listed.map((x) => x[1]).sort()) === JSON.stringify(["adult", "adult", "mature"]) && R.got[0] === "adult",
    "every kit file has a rating": Object.keys(R.kits.files).length > 20 && R.kits.unrated.length === 0,
    "propose_downloads gives each file's rating": R.kits.proposed > 0 && R.kits.proposedUnrated.length === 0,
    "no page errors": !R.errors.length && !R.freshErrors.length };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_u82_takes_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`u82takes ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
