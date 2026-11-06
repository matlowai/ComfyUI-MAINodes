// U72 F11 (newcomer run 2): the stills recipe's Render is the brick `image`, AGENT_START says `render`.
// - `render` (a brick's title) names the recipe's Render in every family (SNAP-R31)
// - a brick error lists the recipe's brick ids
// - run warns, without blocking, while the prompt is still the recipe's default text (checked on proposals: nothing queued)
// usage: node test_f11.js [port 8195]
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

  // video recipe: the default prompt warns on run (a proposal here), a written one doesn't
  await a.call("start_recipe");
  R.videoDefault = await a.call("run");
  await a.call("set_setting", { brick: "render", name: "prompt", value: "integrated_multimodal_description: [Shot 1] A fox trots across a meadow.\noverall_soundscape: paws on grass, a short bark.\nnon_diegetic_music: N/A" });
  R.videoWritten = await a.call("run");

  // stills recipe: `render` names the `image` brick
  const setups = (await a.call("list_setups")).value;
  R.stillSetup = setups.find((s) => s.output === "image")?.name ?? null;
  R.apply = await a.call("apply_setup", { name: R.stillSetup });
  R.stillBricks = (await a.call("describe_recipe")).value.bricks.map((x) => x.brick);
  R.stillDefault = await a.call("run");
  R.setRender = await a.call("set_setting", { brick: "render", name: "prompt", value: "A log cabin in snow at dusk, warm windows, photograph" });
  R.imagePrompt = await page.evaluate(() => { const b = app.graph.extra.snap.bricks.find((x) => x.key === "image"); return app.graph.getNodeById(b.nodes.image).widgets.find((w) => w.name === "prompt").value; });
  R.stillWritten = await a.call("run");
  R.seedRender = await a.call("new_seed", { brick: "render" });
  R.listRender = await a.call("list_nodes", { brick: "render" });
  // errors name the recipe's bricks
  R.badBrick = await a.call("set_setting", { brick: "renders", name: "prompt", value: "x" });
  R.badUnsnap = await a.call("unsnap", { brick: "first_frame" });

  a.close();
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_f11_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
