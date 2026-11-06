// Batch F commit 2 (SNAP-R65): the Work card's model reads every job back from the server. Four slow CPU runs are queued
// by an agent on page A; A reloads while they wait, and after the reload its list still holds all four (by agent) and
// every run has its take (the ones that finished during the reload too); page B in another browser context (another
// client id) lists the same rows while they run, with queued/running states, `ahead` and progress; wait_for returns a
// row once it is done; run_status with no run lists every run of the page (no "last three"). CPU prompts (fwork.js).
// usage: node test_f2_model.js [port 8195]     BEFORE=4be91cb node test_f2_model.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const A = await F.open(b, port, { slow: 8 }), B = await F.open(b, port);
  const ev = (p, fn, arg) => p.page.evaluate(fn, arg);
  await ev(A, () => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true));
  try {
    const t0 = await ev(A, async () => (await window.__T.load()).length);
    R.runs = await ev(A, async () => { const out = []; for (let i = 0; i < 4; i++) out.push((await window.__X.callTool("run", { question: `does run ${i + 1} land after a reload?` })).run); return out; });
    // page B (another client id) sees them while they run
    R.other = await ev(B, async (ids) => { for (let i = 0; i < 30; i++) { const l = await window.__X.callTool("list_activity", {}).catch((e) => ({ rows: [], err: e.message })); const mine = (l.rows ?? []).filter((r) => ids.includes(r.id));
      if (mine.length === ids.length && mine.some((r) => r.state === "queued")) return { rows: mine.map((r) => ({ state: r.state, by: r.by, title: r.title, ahead: r.ahead ?? null, progress: r.progress ?? null, zone: r.zone })), err: l.err };
      await new Promise((ok) => setTimeout(ok, 500)); } return { rows: [], err: "never saw them" }; }, R.runs);
    await A.page.reload(); await A.page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await A.page.waitForTimeout(2000); await F.loadMods(A.page);
    R.afterReload = await ev(A, async (ids) => { const l = await window.__X.callTool("list_activity", {}).catch((e) => ({ rows: [], err: e.message })); return { found: (l.rows ?? []).filter((r) => ids.includes(r.id)).map((r) => [r.by, r.kind, r.title]), err: l.err }; }, R.runs);
    R.waited = await ev(A, async (id) => { for (let i = 0; i < 12; i++) { const w = await window.__X.callTool("wait_for", { job: id, until: "done", wait_s: 25 }).catch((e) => ({ err: e.message })); if (w.reached || w.err) return { reached: w.reached, state: w.row?.state, take: w.row?.result?.take ?? null, zone: w.row?.zone, err: w.err }; } return { reached: false }; }, R.runs.at(-1));
    await F.idle(port);
    R.takes = await ev(A, async ([ids, n]) => { for (let i = 0; i < 20; i++) { const have = window.__T.all().filter((t) => ids.includes(t.prompt_id)).length; if (have === ids.length) break; await new Promise((ok) => setTimeout(ok, 500)); }
      return { have: window.__T.all().filter((t) => ids.includes(t.prompt_id)).length, total: window.__T.all().length - n }; }, [R.runs, t0]);
    // run_status lists the page's own runs since the reload (a reload starts its own list); queue two more and ask with no run
    R.status = await ev(A, async () => { for (let i = 0; i < 4; i++) await window.__X.callTool("run", {}); return (await window.__X.callTool("run_status", {})).runs.length; });
    await F.idle(port);
  } finally { await ev(A, () => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false)); }
  const checks = {
    "page B lists A's four runs while they wait, by agent, with their questions": R.other.rows.length === 4 && R.other.rows.every((r) => r.by === "agent" && /does run \d land/.test(r.title)),
    "queued rows say how many are ahead": R.other.rows.filter((r) => r.state === "queued").every((r) => Number.isInteger(r.ahead) && r.ahead >= 1),
    "after a reload A still lists all four": R.afterReload.found.length === 4 && R.afterReload.found.every(([by, kind]) => by === "agent" && kind === "run"),
    "wait_for returns the last run done, with its take": R.waited.reached === true && R.waited.state === "done" && R.waited.take === `take-${R.runs.at(-1)}` && R.waited.zone === "landed",
    "every run has its take, the ones that finished during the reload too": R.takes.have === 4,
    "run_status with no run lists every run, not three": R.status === 4,
    "no page errors": !A.errors.length && !B.errors.length,
  };
  console.log(JSON.stringify({ R, errors: [A.errors, B.errors] }, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`f2model  ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
