// U72 newcomer stumbles (u72/FINDINGS.md), checked through the tools a moderate agent uses: the stdio MCP server
// (tools/snap_mcp.py) over the real bridge to one page on the CPU gate server. Only one tiny CPU prompt is queued (64 px
// EmptyImage -> SaveImage) to see a run end.
// F2  get_profile says whether agents may run / see; set_agent_permissions sets them live (no reload); see in a headless
//     page says plainly why not
// F5  describe_recipe says a brick that is off is off, and why (First frame: text to video)
// F6  run returns the run's id; run_status gives state queued | running | done | failed, the take and output paths, wait_s
// F7  describe_recipe and the Render face show seconds next to frames; set_setting takes "5s" and says what it rounded to
// F9  new_seed with no brick uses the recipe's Render; unknown arguments and tool errors name the accepted arguments
// F10 describe_recipe carries the H3 prompt sections (prompt_help)
// F19 every brick in describe_recipe has an id (what set_setting's brick takes): the stills Render's is image
// U75d screenshot in a headless page says to use take_frames
// usage: node test_newcomer.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const MCP = path.join(CFG.pack, "tools", "snap_mcp.py");
function mcpClient() {
  const p = spawn("python3", ["-I", MCP, "--port", port]); let buf = "", id = 0; const waiting = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) { const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); } } });
  const send = (method, params) => new Promise((res) => { const m = { jsonrpc: "2.0", id: ++id, method, params }; waiting.set(m.id, res); p.stdin.write(JSON.stringify(m) + "\n"); });
  const call = async (name, args = {}) => { const r = (await send("tools/call", { name, arguments: args })).result; const text = r.content.find((c) => c.type === "text")?.text; let v; try { v = JSON.parse(text); } catch { v = text; } return { error: r.isError, value: v }; };
  return { send, call, close: () => p.kill() };
}
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
  await page.evaluate(() => { app.graph.clear(); app.graph.extra = {}; return app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); });
  const a = mcpClient();
  await a.send("initialize", {});
  R.tools = (await a.send("tools/list", {})).result.tools.map((t) => t.name);

  // F2: the agents' two switches, read and set through tools, live in this page
  R.profile = (await a.call("get_profile")).value;
  R.allowRun = (await a.call("set_agent_permissions", { run: true }));
  R.afterRun = { profile: (await a.call("get_profile")).value?.agents ?? null, setting: await page.evaluate(() => app.extensionManager.setting.get("MAINodes.Snap.AgentsMayRun")) };
  R.allowSee = await a.call("set_agent_permissions", { see: true });
  // U75d: a headless page has no tab to share
  R.screenshot = await a.call("screenshot");

  // F5, F7, F9, F10 on the recommended video recipe
  R.start = await a.call("start_recipe");
  const recipe = (await a.call("describe_recipe")).value;
  const brick = (k) => recipe.bricks?.find((x) => x.brick === k);
  R.firstFrame = brick("first_frame");
  R.renderLength = brick("render")?.settings?.find((s) => s.name === "length");
  R.promptHelp = recipe.prompt_help ?? null;
  R.fiveSeconds = await a.call("set_setting", { brick: "render", name: "length", value: "5s" });
  R.face = await page.evaluate(() => [...document.querySelectorAll('[data-brick="render"] .snap-fact')].map((e) => e.textContent).find((t) => /frames/.test(t)) ?? null);
  await a.call("ui", { action: "close" }); await page.waitForTimeout(600); // the whole chain in view, as a person sees it
  await page.screenshot({ path: path.join(out, "221-newcomer-render-seconds.png") });
  R.seedDefault = await a.call("new_seed");
  R.unknownArg = await a.call("new_seed", { bricks: "render" });
  R.toolError = await a.call("unsnap", { brick: "image" });

  // F6: a tiny run end to end (agents may run now): run gives its id, run_status follows it to done
  await page.evaluate(() => { app.graph.clear(); app.graph.extra = {}; });
  await a.call("snap", { brick: "node:EmptyImage" });
  await a.call("snap", { brick: "node:SaveImage" });
  await page.evaluate(() => { const n = app.graph.nodes.find((x) => x.type === "EmptyImage"); for (const [k, v] of Object.entries({ width: 64, height: 64 })) n.widgets.find((w) => w.name === k).value = v; });
  R.run = await a.call("run");
  R.status = await a.call("run_status", { run: R.run.value?.run, wait_s: 20 });
  const done = R.status.value?.runs?.[0];
  R.outputExists = done?.outputs?.[0]?.path ? fs.existsSync(done.outputs[0].path) : false;
  R.waitCap = await a.call("run_status", { wait_s: 60 });

  await a.call("set_agent_permissions", { run: false });
  R.after = await page.evaluate(() => app.extensionManager.setting.get("MAINodes.Snap.AgentsMayRun"));
  // F19 (run 5): every brick in describe_recipe has an id, exactly what set_setting's brick takes (the stills Render is image)
  await a.call("start_recipe", { intent: "stills" });
  const stills = (await a.call("describe_recipe")).value;
  R.stillIds = stills.bricks?.map((x) => [x.id ?? null, x.title, x.brick]) ?? null;
  R.byId = await a.call("set_setting", { brick: stills.bricks?.find((x) => x.title === "Render")?.id ?? "missing", name: "prompt", value: "a red kite over green hills" });
  a.close();
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_newcomer_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
