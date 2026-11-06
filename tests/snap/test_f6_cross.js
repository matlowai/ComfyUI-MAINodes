// Batch F commit 6 (SNAP-R65): an agent's own headless page queues a run (agents may run); the person's page, another
// client that got none of its events, lists it under Agents with the server's progress (the node working and its step)
// and stops it with "Stop the running render": the row then reads stopped, not done. CPU prompts (fwork.js). Screen 409.
// usage: node test_f6_cross.js [port 8195]     BEFORE=a166e40 node test_f6_cross.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui");
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const person = await F.open(b, port), agent = await F.open(b, port, { slow: 40 });
  await agent.page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true));
  try {
    R.run = (await agent.page.evaluate(() => window.__X.callTool("run", { question: "does the agent's long run show on the person's page?" }))).run;
    R.row = await person.page.waitForFunction((id) => { const r = window.__A?.get(id); return r?.state === "running" && r.progress?.nodes && JSON.parse(JSON.stringify(r)); }, R.run, { timeout: 30000 }).then((x) => x.jsonValue(), () => null);
    await person.page.click(".snap-work-btn"); await person.page.waitForTimeout(800);
    R.meta = await person.page.textContent(`.snap-work-row[data-job="${R.run}"] .snap-work-meta`).catch(() => null);
    R.group = await person.page.evaluate((id) => document.querySelector(`.snap-work-row[data-job="${id}"]`)?.closest(".snap-work-group")?.querySelector(".snap-work-owner")?.firstChild?.textContent ?? null, R.run);
    await person.page.screenshot({ path: path.join(out, "409-f-agent-row.png") });
    await person.page.click(`.snap-work-row[data-job="${R.run}"] button:has-text("Stop the running render")`).catch((e) => { R.stopErr = e.message; });
    R.after = await person.page.waitForFunction((id) => { const r = window.__A?.get(id); return r && r.state !== "running" && r.state !== "queued" && { state: r.state, error: r.error }; }, R.run, { timeout: 30000 }).then((x) => x.jsonValue(), () => null);
  } finally { await agent.page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false)); await F.idle(port); }
  const checks = {
    "the person's page lists the agent's run under Agents": R.row?.owner === "agents" && R.row.by === "agent" && R.group === "Agents",
    "with the server's progress though it got none of its events": R.row?.progress?.nodes > 0 && /nodes done/.test(R.meta ?? ""),
    "Stop the running render stops it, and the row says so": R.after?.state === "failed" && /stopped/.test(R.after.error ?? ""),
    "no page errors": !person.errors.length && !agent.errors.length,
  };
  console.log(JSON.stringify({ R, errors: [person.errors, agent.errors] }, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`f6cross  ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
