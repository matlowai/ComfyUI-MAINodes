// Start from Dials + Pika Simple on a graph that already has nodes opens the recipe in a new tab; the open workflow is untouched. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => r.request().method() === "POST" ? (q++, r.abort()) : r.continue());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  const tabs = () => page.evaluate(() => app.extensionManager.workflow.openWorkflows.map((w) => w.filename + ":" + (w.activeState?.nodes?.length ?? "?")));
  const first = await page.evaluate(() => app.graph.nodes.map((n) => n.type).sort().join(","));
  await page.keyboard.press("Alt+s"); await page.waitForTimeout(1200);
  await page.click("text=Start from Dials + Pika Simple"); await page.waitForTimeout(4000);
  const now = await page.evaluate(() => ({ types: app.graph.nodes.map((n) => n.type), snapOpen: !!document.querySelector(".snap-brick[data-brick=render]") }));
  const t = await tabs();
  await page.screenshot({ path: path.join(CFG.out, "ui", "37-start-new-tab.png") });
  // the first tab still holds the original graph
  const back = await page.evaluate(() => app.extensionManager.workflow.openWorkflows[0].activeState.nodes.map((n) => n.type).sort().join(","));
  const R = { tabs: t, newTabTypes: now.types, snapOpen: now.snapOpen, originalUntouched: back === first, queueAttempts: q, errors: errs };
  fs.writeFileSync(path.join(CFG.out, "ui", "test_newtab_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})();
