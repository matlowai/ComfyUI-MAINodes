// Real-take bugs found by the U19 run (2026-11-04): a fresh Simple recipe must queue on this core (every combo inside
// the blueprints is a valid choice, stale ones show as missing), the same seed holds across runs (RandomNoise fixed, and
// set_widget reaches inner nodes), rankings keep person and agent apart, an agent's blind pair waits for the person, and
// save_workflow saves. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { q++; return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const open = async () => {
    await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
    await page.keyboard.press("Escape");
    await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap; window.__tools = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); window.__T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js"); });
  };
  await open();
  const call = (name, args) => page.evaluate(([n, a]) => window.__tools.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  await page.evaluate(() => { app.graph.clear(); app.graph.extra = {}; window.__snap.toggle(); });
  await call("start_recipe", {}); await page.waitForTimeout(1500);
  // every combo inside every blueprint is a choice this core's /object_info offers
  R.invalid = await page.evaluate(async () => {
    const info = await (await fetch("/api/object_info")).json(), bad = [];
    const walk = (n, at) => { for (const x of n.subgraph?.nodes ?? []) {
      const spec = { ...info[x.type]?.input?.required, ...info[x.type]?.input?.optional };
      for (const w of x.widgets ?? []) { const s = spec[w.name]; const choices = Array.isArray(s?.[0]) ? s[0] : s?.[0] === "COMBO" ? s[1]?.options : null; if (choices?.length && !choices.includes(w.value) && !/(_name|image)$/.test(w.name)) bad.push(`${at}${x.id} ${x.type}.${w.name}=${w.value}`); }
      walk(x, `${at}${x.id}:`); } };
    for (const n of app.graph.nodes) walk(n, `${n.id}:`);
    return bad;
  });
  R.innerMissing = await page.evaluate(() => window.__snap.engine.missing().filter((m) => m.node.includes("›")).map((m) => `${m.node}.${m.setting}`));
  R.seedModes = await page.evaluate(() => { const r = window.__snap.engine.nodeFor("render", "render"); return r.subgraph.nodes.filter((n) => n.type === "RandomNoise").map((n) => [n.id, n.widgets.find((w) => w.name === "control_after_generate").value]); });
  const rid = await page.evaluate(() => window.__snap.engine.nodeFor("render", "render").id);
  R.setInner = await call("set_widget", { node: `${rid}:${R.seedModes[0][0]}`, name: "control_after_generate", value: "increment" });
  // takes: two in this workflow, ranked by an agent (its own file), a blind pair it sets up, judged by the person
  const group = await page.evaluate(() => window.__T.groupOf());
  await page.evaluate(async (group) => { const { api } = await import("/scripts/api.js");
    for (const [i, id] of ["fresh-a", "fresh-b"].entries()) await api.storeUserData(`snap/takes/take-${id}.json`, { id: `take-${id}`, kind: "run", prompt_id: id, created: Date.now() - 1000 * (2 - i), group, workflow: "t", number: i + 1, status: "success", text: "a test take", seed: 7, media: [], verdict: null, prior: false, notes: [] });
  }, group);
  await page.evaluate(async () => { const w = app.graph.serialize(); window.__keep = w; });
  // save_workflow is the frontend's Save As (L7): the unsaved tab becomes the workflow; saving it again is Save; from a
  // saved tab another name is a copy and the tab stays; a name another workflow has is refused without overwrite
  const tab = () => page.evaluate(() => { const w = app.extensionManager.workflow.activeWorkflow; return { path: w.path, temporary: w.isTemporary, modified: w.isModified }; });
  R.saved = await call("save_workflow", { name: "snap fresh test" });
  R.tabAfter = await tab();
  R.again = await call("save_workflow", { name: "snap fresh test" });
  R.copy = await call("save_workflow", { name: "snap fresh copy" });
  R.clash = await call("save_workflow", { name: "snap fresh copy" });
  R.tabAfterCopy = await tab();
  R.inWorkflows = await page.evaluate(() => ["snap fresh test", "snap fresh copy"].map((n) => !!app.extensionManager.workflow.getWorkflowByPath(`workflows/${n}.json`)?.isPersisted));
  R.badName = await call("save_workflow", { name: "../escape" });
  await page.reload(); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.evaluate(async (group) => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap; window.__tools = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); window.__T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
    app.graph.id = group; await window.__T.load(); snap.toggle(); }, group);
  await page.waitForTimeout(1200);
  R.rank = await call("rank_takes", { order: ["take-fresh-b", "take-fresh-a"] });
  R.personOrder = await page.evaluate(() => window.__T.ranking());
  R.agentFile = await page.evaluate(async (g) => (await (await (await import("/scripts/api.js")).api.getUserData(`snap/rankings/${g.replace(/[^a-z0-9._-]+/gi, "_")}.agent.json`)).json()), group);
  R.ab = await call("setup_ab", { take_a: "take-fresh-a", take_b: "take-fresh-b" });
  await page.evaluate(() => window.__T.onChange && null); await page.waitForTimeout(800);
  R.waiting = await page.$eval(".snap-ab-waiting", (e) => (e.hidden ? null : e.textContent)).catch(() => null);
  await page.screenshot({ path: path.join(out, "94-blind-pair-waiting.png") });
  await page.click(".snap-ab-waiting"); await page.waitForTimeout(600);
  R.blindNote = await page.$eval(".snap-take-sheet header", (e) => e.textContent).catch(() => null);
  await page.click('.snap-compare-pick button:has-text("A is better")'); await page.waitForTimeout(800);
  R.afterJudge = { pending: (await page.evaluate(() => window.__T.pending())).length, waiting: await page.$eval(".snap-ab-waiting", (e) => e.hidden) };
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_fresh_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e.message.split("\n")[0]); process.exit(1); });
