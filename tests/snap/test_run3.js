// U72 run 3 findings (u72/FINDINGS.md "Run 3"), through the stdio MCP server like a newcomer agent:
// F12 start_recipe {intent: "stills"} opens the stills kit's recommended setup (a new tab); {family: ...} is refused naming
//     intent; an unknown intent names the kits
// F14 set_profile {done: true} answers every onboarding question (answered was [] after done)
// (F13, snap_agent_page.sh --stop, is in test_agent_page.py)
// usage: node test_run3.js [port 8195]
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

  // F12: start_recipe takes a kit's intent; a guess at another argument names the accepted ones
  R.family = await a.call("start_recipe", { family: "image" });
  R.stills = await a.call("start_recipe", { intent: "stills" });
  R.stillBricks = (await a.call("describe_recipe")).value.bricks?.map((x) => x.brick) ?? null;
  R.badIntent = await a.call("start_recipe", { intent: "pictures" });
  // F14: done answers every question
  R.profileWas = await page.evaluate(async () => (await import("/extensions/ComfyUI-MAINodes/snap/profile.js")).get());
  R.done = (await a.call("set_profile", { intents: ["stills"], done: true })).value?.profile ?? null;
  R.read = (await a.call("get_profile")).value?.profile ?? null;
  a.close();
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_run3_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
