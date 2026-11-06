// Set Snapshot editor: open from References, drag the camera across the actors' line (180-degree warning), rename
// the shot, Apply (pictures replaced in place, edit kept as "my edit"), reopen (state persisted), Save as version.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2000);
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "refs", "render"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(900);
  const pictures = () => page.evaluate(() => (window.__snap.engine.state().bricks.find((x) => x.key === "refs").pictures ?? []).map((p) => `${p.role}|${p.file}|${p.source}`));
  await page.click('.snap-brick[data-brick="refs"] .snap-name'); await page.waitForTimeout(150);
  await page.click('.snap-card:has-text("lamp room, end of shot 3")'); await page.waitForTimeout(1500);
  R.applied = await pictures();
  await page.click(".snap-pics figure.editable figcaption >> nth=0"); await page.waitForTimeout(400);
  R.editorOpen = await page.locator(".snap-sheet").count();
  R.blockBefore = await page.textContent(".snap-set-block");
  // world -> screen for the plan canvas
  const at = (xy) => page.evaluate(async ([x, y]) => {
    const { planFrame } = await import("/extensions/ComfyUI-MAINodes/snap/setsnap.js");
    const c = document.querySelector(".snap-set-plan"), r = c.getBoundingClientRect();
    const s = (await (await fetch("/mainodes/snap/cards")).json()).cards.find((k) => k.kind === "set_snapshot").brick.snapshot;
    const f = planFrame(s);
    return [r.left + (f.X(x) / c.width) * r.width, r.top + (f.Y(y) / c.height) * r.height];
  }, xy);
  const [cx, cy] = await at([-2.0, -2.0]), [tx, ty] = await at([2.0, -2.0]);
  await page.mouse.move(cx, cy); await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(cx + ((tx - cx) * i) / 20, cy + ((ty - cy) * i) / 20);
  await page.mouse.up(); await page.waitForTimeout(200);
  R.warn = await page.evaluate(() => [...document.querySelectorAll(".snap-set-notes li.break")].map((li) => li.textContent).join(" | "));
  R.notes = await page.evaluate(() => [...document.querySelectorAll(".snap-set-notes li")].map((li) => li.textContent));
  R.blockAfter = await page.textContent(".snap-set-block");
  R.trackNote = await page.textContent(".snap-track-note");
  await page.locator(".snap-scrub-range").fill("500"); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(out, "32-scrub-mid-shot.png") });
  R.trackSegments = await page.locator(".snap-side-track i").count();
  await page.locator(".snap-scrub-range").fill("1000"); await page.waitForTimeout(100);
  R.bridgeOffered = await page.isVisible(".snap-sheet >> text=Neutral shot");
  await page.click(".snap-sheet >> text=Neutral shot"); await page.waitForTimeout(700);
  R.bridgeSaved = await page.evaluate(async () => (await (await import("/extensions/ComfyUI-MAINodes/snap/library.js")).search("bridge")).map((c) => c.title));
  await page.fill(".snap-sheet .snap-field input", "shot 4");
  await page.screenshot({ path: path.join(out, "22-set-editor.png") });
  await page.click("text=Use in References"); await page.waitForTimeout(1800);
  R.afterApply = await pictures();
  R.setBlocksInPrompt = await page.evaluate(() => window.__snap.engine.getValue("render", "render", "prompt").split("Set: lamp room").length - 1);
  R.editorClosed = (await page.locator(".snap-sheet").count()) === 0;
  R.myEdit = await page.evaluate(async () => (await (await import("/extensions/ComfyUI-MAINodes/snap/library.js")).search("my edit")).map((c) => c.id));
  await page.click(".snap-pics figure.editable figcaption >> nth=0"); await page.waitForTimeout(400);
  R.reopenedShot = await page.inputValue(".snap-sheet .snap-field input");
  R.reopenedWarn = await page.evaluate(() => [...document.querySelectorAll(".snap-set-notes li.break")].map((li) => li.textContent).join(" | "));
  await page.click("text=Save as version"); await page.waitForTimeout(800);
  R.savedCards = await page.evaluate(async () => (await (await import("/extensions/ComfyUI-MAINodes/snap/library.js")).search("saved")).map((c) => c.title));
  // coverage: show the setups, take "single Ferro" as the camera; mark it a dialogue scene to check eyelines
  await page.click(".snap-sheet >> text=Coverage"); await page.waitForTimeout(200);
  const pick = await page.evaluate(async () => {
    const { coverage } = await import("/extensions/ComfyUI-MAINodes/snap/setsnap.js");
    const { get } = await import("/extensions/ComfyUI-MAINodes/snap/library.js");
    return coverage(get("set-lamp-room-end-s3-mine").brick.snapshot).find((c) => c.name === "single Ferro");
  });
  const [px, py] = await at(pick.at);
  await page.mouse.click(px, py); await page.waitForTimeout(250);
  R.coverageBlock = await page.textContent(".snap-set-block");
  R.coverageNotes = await page.evaluate(() => [...document.querySelectorAll(".snap-set-notes li")].map((li) => li.textContent));
  await page.screenshot({ path: path.join(out, "28-coverage.png") });
  await page.check(".snap-sheet .snap-check input"); await page.waitForTimeout(200);
  R.eyelineNotes = await page.evaluate(() => [...document.querySelectorAll(".snap-set-notes li")].map((li) => li.textContent).filter((t) => t.includes("eyeline")));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  R.escClosed = (await page.locator(".snap-sheet").count()) === 0;
  await page.screenshot({ path: path.join(out, "23-after-set-edit.png") });
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_seteditor_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
