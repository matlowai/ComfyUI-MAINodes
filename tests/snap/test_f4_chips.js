// Batch F commit 4 (SNAP-R65): jobs show on what they belong to. In a scene shot (CPU prompts, fwork.js): take A runs; a
// re-take of A shows as a ghost card nested under A while it runs and is replaced by the real version; the shot's tile
// counts its open jobs; a paint about A (viewer closed) puts "painting"/"edit queued" on A's card, and a decision with
// ready candidates puts "2 candidates to pick" there. Screen 404.
// usage: node test_f4_chips.js [port 8195]     BEFORE=50b2a66 node test_f4_chips.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui");
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const { page, errors } = await F.open(b, port, { slow: 14 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  R.setup = await ev(async () => { const SC = window.__SC, T = window.__T; await T.load(); await SC.load();
    const scene = await SC.create({ name: "Work card chips" }); await SC.addShot(scene.id, { name: "the lantern" }); const shot = SC.get(scene.id).shots[0].id; await SC.openShot(scene.id, shot);
    return { scene: scene.id, shot }; });
  R.a = await ev(async () => { const id = await window.__J.queueRun({ kind: "run", title: "take A", about: window.__J.here() }, () => app.queuePrompt(0, 1)); return id; });
  await F.idle(port);
  await page.waitForFunction((id) => window.__T.get(`take-${id}`), R.a, { timeout: 30000 }).catch(() => {});
  const take = `take-${R.a}`;
  // a re-take of A: a ghost under A while it runs
  R.retake = await ev(async (take) => (await window.__RT.retake(window.__T.get(take), { world: "pinned" })).run, take).catch((e) => `error: ${e.message}`);
  await page.waitForSelector(`.snap-take.ghost[data-job="${R.retake}"]`, { timeout: 15000 }).catch(() => {});
  R.ghost = await ev(([take, id]) => { const g = document.querySelector(`.snap-take.ghost[data-job="${id}"]`); return g && { underA: !!g.closest(".snap-take-family")?.querySelector(`:scope > .snap-take[data-take="${take}"]`), text: g.textContent, ring: !!g.querySelector(".snap-take-ring") }; }, [take, R.retake]);
  R.badge = await page.textContent(".snap-shot-tile.on .snap-shot-jobs").catch(() => null);
  await page.screenshot({ path: path.join(out, "404-f-ghost-chips.png") });
  // a paint about A with the viewer closed
  R.paint = await ev(async (take) => window.__K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 7 } } }, { job: { kind: "paint", title: "Change something: a test paint (take A, candidate 1 of 1)", about: { take }, takes: false } }), take);
  R.chipBoth = await page.waitForFunction((take) => { const t = document.querySelector(`.snap-take[data-take="${take}"]:not(.ghost) .snap-take-job:not([hidden])`)?.textContent; return /\+1$/.test(t ?? "") && t; }, take, { timeout: 10000 }).then((x) => x.jsonValue(), () => null);
  await page.waitForFunction((take) => /painting|edit queued/.test(document.querySelector(`.snap-take[data-take="${take}"]:not(.ghost) .snap-take-job:not([hidden])`)?.textContent ?? ""), take, { timeout: 30000 }).catch(() => {});
  R.chipWhilePainting = await ev((take) => document.querySelector(`.snap-take[data-take="${take}"]:not(.ghost) .snap-take-job:not([hidden])`)?.textContent ?? null, take);
  await F.idle(port); await page.waitForTimeout(2500);
  R.ghostGone = await ev((id) => !document.querySelector(`.snap-take.ghost[data-job="${id}"]`) && !!document.querySelector(`.snap-take[data-take="take-${id}"]:not(.ghost)`), R.retake);
  // a decision with two ready candidates about A
  await ev(async (take) => { await window.__C.create({ kind: "edit", target: take, title: "Change something (sparkle) of take A", take }, [{ notes: { identity: { scores: [] } } }, { notes: { identity: { scores: [] } } }]); }, take);
  await page.waitForTimeout(1500);
  await page.locator(".snap-takes").screenshot({ path: path.join(out, "405-f-chip-waiting.png") }).catch(() => {});
  R.chipWaiting = await ev((take) => document.querySelector(`.snap-take[data-take="${take}"]:not(.ghost) .snap-take-job:not([hidden])`)?.textContent ?? null, take);
  const checks = {
    "a re-take shows as a ghost card nested under its take, with a ring": R.ghost?.underA === true && R.ghost.ring && /Re-take take/.test(R.ghost.text),
    "the shot's tile counts its open jobs": Number(R.badge) >= 1,
    "two jobs about the take read as one chip and +1": /\+1$/.test(R.chipBoth ?? ""),
    "a paint about the take puts it on the take's card": /painting|edit queued/.test(R.chipWhilePainting ?? ""),
    "the real version replaces the ghost": R.ghostGone === true,
    "ready candidates read '2 candidates to pick' on the card": /2 candidates to pick/.test(R.chipWaiting ?? ""),
    "no page errors": !errors.length,
  };
  console.log(JSON.stringify({ R, errors }, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`f4chips  ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
