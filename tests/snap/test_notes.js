// Director's notes: pin a note in the UI; an agent (through the real bridge) reads it, answers with linked proposals and
// a reply; the person accepts and closes it. Recipe-level notes and undo. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
const call = async (tool, args = {}) => (await (await fetch(`http://127.0.0.1:${CFG.port}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool, args }) })).json());
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    app.graph.clear(); app.graph.extra = {};
    for (const k of ["models", "preset", "rack", "render"]) await snap.engine.snap(k);
    snap.toggle();
  });
  await page.waitForTimeout(900);
  await page.click('.snap-brick[data-brick="render"] .snap-name');
  await page.fill(".snap-note-input", "too static, the flash came late: more motion, shorter");
  await page.locator(".snap-note-input").press("Control+Enter"); await page.waitForTimeout(400);
  R.noteChip = await page.locator('.snap-brick[data-brick="render"] .snap-note').count();
  const notes = (await call("get_notes")).result;
  R.agentSees = notes.map((n) => `${n.brick}: ${n.text} (${n.settings?.length} settings, ${n.brick_now?.bindings?.length} bindings)`);
  const id = notes[0].id;
  R.p1 = (await call("apply_card", { card: "dial-motion", propose: true, for_note: id, reason: "motion dial at 0.5 for a livelier shot" })).result?.proposed;
  R.p2 = (await call("set_setting", { brick: "render", name: "length", value: 97, propose: true, for_note: id, reason: "97 frames tightens the beat" })).result?.proposed;
  R.answerRaw = await call("answer_note", { note: id, reply: "Proposed the motion dial and a shorter take; the flash timing needs a prompt beat I cannot set yet." }); R.answer = R.answerRaw.result?.status;
  await page.waitForTimeout(500);
  R.chip = await page.textContent('.snap-brick[data-brick="render"] .snap-note');
  R.reNote = await page.locator(".snap-proposal .snap-note-tag").count();
  await page.screenshot({ path: path.join(out, "26-note-answered.png") });
  await page.click("text=Accept all"); await page.waitForTimeout(800);
  R.afterAccept = { length: await page.evaluate(() => window.__snap.engine.getValue("render", "render", "length")), rack: await page.evaluate(() => JSON.parse(window.__snap.engine.getValue("rack", "rack", "rack")).map((r) => r.dial)) };
  R.waitingText = await page.locator('.snap-brick[data-brick="render"] .snap-note').textContent();
  await page.click('.snap-brick[data-brick="render"] .snap-note .snap-accept'); await page.waitForTimeout(400);
  R.closed = (await page.locator('.snap-brick[data-brick="render"] .snap-note').count()) === 0;
  R.openAfter = (await call("get_notes")).result.length;
  await page.evaluate(() => window.__snap.view.select(null)); await page.waitForTimeout(200);
  await page.click('.snap-top button:has-text("Note")'); await page.waitForTimeout(400);
  await page.fill(".snap-note-input", "keep the whole piece under 6 seconds");
  await page.click("text=Pin note"); await page.waitForTimeout(400);
  R.recipeNoteOnTop = await page.evaluate(() => document.querySelector(".snap-notes").firstElementChild?.classList.contains("snap-note"));
  await page.evaluate(() => app.extensionManager.workflow.activeWorkflow.changeTracker.undo()); await page.waitForTimeout(600);
  R.undoRemovedIt = (await call("get_notes")).result.length === 0;
  await page.screenshot({ path: path.join(out, "27-notes-done.png") });
  R.queueAttempts = globalThis.__queued || 0;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_notes_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
