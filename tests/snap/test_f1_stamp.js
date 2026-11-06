// Batch F commit 1 (SNAP-R65): every prompt Snap queues carries extra_data.snap_job, paints and checks run under the page's
// own client id (so the page gets their events) and never become takes, and `run` always returns its id (anime F-A13:
// three runs asked at once each come back with their own id). CPU prompts (fwork.js). Exit 1 on any failed check.
// usage: node test_f1_stamp.js [port 8195]     BEFORE=bde016d node test_f1_stamp.js   (the code before)
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const { page, queued, errors } = await F.open(b, port);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { window.__events = []; const { api } = await import("/scripts/api.js"); for (const e of ["execution_start", "execution_success"]) api.addEventListener(e, ({ detail }) => window.__events.push([e, detail.prompt_id])); });
  await ev(() => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true));
  try {
    const takes0 = await ev(async () => (await window.__T.load()).length);
    // three agent runs at once (F-A13)
    R.runs = await ev(async () => Promise.all([0, 1, 2].map(() => window.__X.callTool("run", {}).then((r) => r.run, (e) => `error: ${e.message}`))));
    // a paint and a check, as edits.js and checks.js queue them
    const paint = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 1 } } };
    R.paint = await ev(async (g) => { try { return await window.__K.queue(g, { job: { kind: "paint", title: "Change something: test paint (take 1, candidate 1 of 1)", about: { take: "take-x" }, takes: false } }); } catch (e) { return `error: ${e.message}`; } }, paint);
    R.check = await ev(async (g) => { try { const h = await window.__K.screen(g, { title: "Find the people in this frame" }); return Object.keys(h.outputs ?? {}).length >= 0 ? "done" : "?"; } catch (e) { return `error: ${e.message}`; } }, paint);
    R.noTitle = await ev(async (g) => { try { await window.__K.queue(g, { job: { kind: "paint", title: " " } }); return "queued"; } catch (e) { return e.message; } }, paint);
    await F.idle(port); await page.waitForTimeout(1500);
    const hist = async (id) => { const h = id && !String(id).startsWith("error") ? await F.history(port, id) : null; return h ? { job: h.prompt[3].snap_job ?? null, client: h.prompt[3].client_id, status: h.status?.status_str } : null; };
    R.runJobs = await Promise.all(R.runs.map(hist));
    R.paintJob = await hist(R.paint);
    R.pageClient = await ev(async () => (await import("/scripts/api.js")).api.clientId);
    R.paintEvents = await ev((id) => window.__events.filter(([, p]) => p === id).map(([e]) => e), R.paint);
    R.takesAdded = await ev(async (n) => { await new Promise((r) => setTimeout(r, 1500)); return window.__T.all().slice(n).map((t) => t.prompt_id); }, takes0);
    R.checkClients = queued.filter((q) => q.extra?.snap_job?.kind === "check").map((q) => q.client === R.pageClient);
  } finally { await ev(() => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false)); }
  const ids = R.runs.filter((x) => typeof x === "string" && !x.startsWith("error"));
  const checks = {
    "three runs at once each return their own id": ids.length === 3 && new Set(ids).size === 3,
    "each run is stamped kind run by agent": R.runJobs.every((j) => j?.job?.kind === "run" && j.job.by === "agent" && j.job.title),
    "the paint is stamped takes:false under the page's id": R.paintJob?.job?.kind === "paint" && R.paintJob.job.takes === false && R.paintJob.client === R.pageClient,
    "the page got the paint's events": R.paintEvents.includes("execution_success"),
    "the paint made no take; the runs made one each": !R.takesAdded.includes(R.paint) && ids.every((id) => R.takesAdded.includes(id)),
    "the check ran under the page's id": R.check === "done" && R.checkClients.length >= 1 && R.checkClients.every(Boolean),
    "an empty question is refused with the reason": /no question/.test(R.noTitle),
    "no page errors": !errors.length,
  };
  console.log(JSON.stringify({ R, errors }, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`f1stamp  ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
