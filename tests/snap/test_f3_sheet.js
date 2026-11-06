// Batch F commit 3 (SNAP-R65): the Work pill above the chain and the Work sheet. Three slow runs and one that fails are
// queued (CPU prompts, fwork.js); the pill counts them in flight; the sheet lists them under In flight with their
// questions and state words ("queued · 2 ahead", the running step), Cancel takes a queued one off the server's queue, the
// failure shows the server's own text with Retry, Park moves it to Parked (no count), and a landed take takes a verdict
// with one key (p = keep) and leaves Landed. Screens 402 (1600 px) and 403 (390 px).
// usage: node test_f3_sheet.js [port 8195]     BEFORE=0007d74 node test_f3_sheet.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui");
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const { page, errors } = await F.open(b, port, { slow: 10 });
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const failedNow = () => ev(() => Number(document.querySelector(".snap-work-btn")?.textContent.match(/(\d+) failed/)?.[1] ?? 0));
  await page.waitForTimeout(1500);
  R.failedBefore = await failedNow(); // earlier runs' failures on this server count too
  const q = (title) => ev(async (title) => window.__J.queueRun({ kind: "run", title, about: window.__J.here() }, () => app.queuePrompt(0, 1)), title);
  R.ids = [await q("does the first run land?"), await q("does the second run land?"), await q("can this one be cancelled?"), await q("this one breaks [fail]")];
  await page.waitForFunction((ids) => window.__A?.all().filter((r) => ids.includes(r.id)).length === ids.length, R.ids, { timeout: 20000 }).catch(() => {});
  R.pill = await page.textContent(".snap-work-btn").catch(() => null);
  await page.click(".snap-work-btn").catch((e) => { R.clickErr = e.message; });
  await page.waitForTimeout(600);
  const rowsNow = () => ev((ids) => ids.map((id) => { const el = document.querySelector(`.snap-work-row[data-job="${id}"]`); return el ? { zone: el.closest(".snap-work-zone")?.className.split(" ")[1], title: el.querySelector(".snap-work-title").textContent, meta: el.querySelector(".snap-work-meta").textContent, buttons: [...el.querySelectorAll("button")].map((x) => x.textContent) } : null; }), R.ids);
  R.rows = await rowsNow();
  await page.screenshot({ path: path.join(out, "402-f-work-sheet.png") });
  // Cancel the queued third one
  await page.click(`.snap-work-row[data-job="${R.ids[2]}"] button:has-text("Cancel")`).catch((e) => { R.cancelErr = e.message; });
  await page.waitForTimeout(800);
  R.cancelled = !(await (await fetch(`http://127.0.0.1:${port}/queue`)).json()).queue_pending.some((x) => x[1] === R.ids[2]);
  await F.idle(port); await page.waitForTimeout(3000);
  R.after = await rowsNow();
  R.failed = await ev((id) => { const el = document.querySelector(`.snap-work-row[data-job="${id}"]`); return el && { error: el.querySelector(".snap-work-error")?.textContent ?? null, rest: !!el.querySelector(".snap-work-rest"), retry: [...el.querySelectorAll("button")].some((x) => x.textContent === "Retry") }; }, R.ids[3]);
  R.pillFailed = await page.textContent(".snap-work-btn");
  R.failedAfter = await failedNow();
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, "403-f-work-sheet-phone.png") });
  await page.setViewportSize({ width: 1600, height: 1000 }); await page.waitForTimeout(300);
  // Park the failure; one key on a landed take
  await page.click(`.snap-work-row[data-job="${R.ids[3]}"] button:has-text("Park")`).catch((e) => { R.parkErr = e.message; });
  await page.waitForTimeout(600);
  R.parked = await ev((id) => window.__A.get(id)?.zone, R.ids[3]);
  R.pillAfterPark = await page.textContent(".snap-work-btn");
  R.failedParked = await failedNow();
  await page.focus(`.snap-work-row[data-job="${R.ids[0]}"]`).catch((e) => { R.focusErr = e.message; });
  await page.keyboard.press("p"); await page.waitForTimeout(800);
  R.verdict = await ev((id) => ({ verdict: window.__T.get(`take-${id}`)?.verdict ?? null, zone: window.__A.get(id)?.zone }), R.ids[0]);
  const checks = {
    "the pill counts the runs in flight": /Work · \d+ in flight/.test(R.pill ?? "") && Number(R.pill.match(/(\d+) in flight/)[1]) >= 3,
    "the sheet lists all four with their questions, the waiting ones under In flight": R.rows.every((r) => r) && R.rows.slice(1).every((r) => r.zone === "in_flight") && R.rows[0].title === "does the first run land?",
    "a queued row says how many are ahead": R.rows.slice(1, 3).some((r) => /queued · \d+ ahead/.test(r.meta)),
    "a running row says it runs, with its estimate words": R.rows.some((r) => /running/.test(r.meta) && /(about \d+ s|no estimate yet|past its estimate)/.test(r.meta)),
    "Cancel takes the queued job off the server's queue": R.cancelled === true,
    "the failure shows the server's own text, whole, and Retry": /ImageBlur/.test(R.failed?.error ?? "") && /[Pp]adding/.test(R.failed.error) && R.failed.retry,
    "the pill names the failure": R.failedAfter === R.failedBefore + 1,
    "Park moves the failure to Parked and out of the count": R.parked === "parked" && R.failedParked === R.failedBefore,
    "p on a landed take keeps it and it leaves Landed": R.verdict.verdict === "keep" && R.verdict.zone === "closed",
    "no stray \"null\" in the pill (replaceChildren prints it)": !/null/.test(R.pill ?? "") && !/null/.test(R.pillFailed ?? ""),
    "no page errors": !errors.length,
  };
  console.log(JSON.stringify({ R, errors }, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`f3sheet  ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
