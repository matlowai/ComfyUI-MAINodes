// Agents drive Snap with tool calls only, both ways: (A) the stdio MCP server (tools/snap_mcp.py, what Claude Code uses)
// and (B) in-page WebMCP (document.modelContext in Chrome 157 with --enable-features=WebMCP). Playwright only opens the
// page; every change below is a tool call. Runs and make_dial wait as proposals (agents may not run by default). Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
const MCP = path.join(CFG.pack, "tools", "snap_mcp.py");
function mcpClient() {
  const p = spawn("python3", ["-I", MCP, "--port", CFG.port]); let buf = "", id = 0; const waiting = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) { const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); } } });
  const send = (method, params) => new Promise((res) => { const m = { jsonrpc: "2.0", id: ++id, method, params }; waiting.set(m.id, res); p.stdin.write(JSON.stringify(m) + "\n"); });
  const call = async (name, args = {}) => { const r = (await send("tools/call", { name, arguments: args })).result; const text = r.content[0].text; let v; try { v = JSON.parse(text); } catch { v = text; } return { error: r.isError, value: v }; };
  return { send, call, close: () => p.kill() };
}
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true, args: ["--enable-features=WebMCP"] });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => r.request().method() === "POST" ? (q++, r.abort()) : r.continue());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
  await page.evaluate(() => { app.graph.clear(); app.graph.extra = {}; return app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); });
  const a = mcpClient();
  await a.send("initialize", {});
  const tools = (await a.send("tools/list", {})).result.tools.map((t) => t.name);
  R.mcpTools = { n: tools.length, has: ["run", "run_status", "list_dials", "add_dial", "set_dial", "make_dial", "list_nodes", "set_widget", "press_button", "read_ui", "ui", "judge_takes", "upload_file"].filter((t) => !tools.includes(t)) };
  for (const k of ["models", "preset", "rack", "first_frame", "refs", "render"]) await a.call("snap", { brick: k });
  R.ui0 = (await a.call("read_ui")).value;
  const nodes = (await a.call("list_nodes", { brick: "render" })).value;
  const render = nodes[0], seed = render.widgets.find((w) => w.name === "noise_seed"), cfg = render.widgets.find((w) => w.name === "cfg");
  R.listNodes = { renderWidgets: render.widgets.length, seed, cfgWired: cfg?.wired_from };
  R.setSeed = (await a.call("set_widget", { node: render.id, name: "noise_seed", value: 1234 })).value?.value;
  R.setWired = (await a.call("set_widget", { node: render.id, name: "cfg", value: 3 })).value;
  const preset = (await a.call("list_nodes", { brick: "preset" })).value[0];
  R.badChoice = (await a.call("set_widget", { node: preset.id, name: "sampler", value: "not-a-sampler" })).value;
  R.goodChoice = (await a.call("set_widget", { node: preset.id, name: "sampler", value: preset.widgets.find((w) => w.name === "sampler").choices[1] })).value?.value;
  const zoom = (await a.call("list_dials", { query: "zoomies", family: "MiniMax H3" })).value;
  R.dialsFound = zoom.map((d) => d.dial);
  R.addDial = (await a.call("add_dial", { dial: "dials/h3_motion_hook.safetensors" })).value;
  R.setDial = (await a.call("set_dial", { dial: "dials/h3_motion_hook.safetensors", strength: 1.5 })).value;
  R.uiSelect = (await a.call("ui", { action: "select", target: "rack" })).value;
  R.uiDials = (await a.call("ui", { action: "dials" })).value.sheet;
  await page.screenshot({ path: path.join(out, "57-agent-dials.png") });
  R.uiClose = (await a.call("ui", { action: "close" })).value.sheet;
  // a local picture uploaded by the MCP server, then set as the First frame
  const png = path.join(CFG.out, "ui", "54-dial-picker.png");
  const up = (await a.call("upload_file", { path: png, subfolder: "agent" })).value;
  const ff = (await a.call("list_nodes", { brick: "first_frame" })).value[0];
  R.upload = { name: up.name, set: (await a.call("set_widget", { node: ff.id, name: "image", value: up.name })).value };
  R.run = (await a.call("run")).value;
  R.makeDial = (await a.call("make_dial", { negative: "calm", positive: "stormy", pairs: [["{subject} on a calm sea.", "{subject} on a stormy sea."]] })).value;
  R.proposals = (await a.call("list_proposals")).value?.waiting?.map?.((p) => p.tool) ?? (await a.call("list_proposals")).value;
  // undo takes back the newest edit (the image set just above), redo puts it back
  const image = () => page.evaluate(() => window.app.graph.nodes.find((n) => n.type === "LoadImage" && n.title.includes("first")).widgets.find((w) => w.name === "image").value);
  R.undo = { before: await image() }; await a.call("ui", { action: "undo" }); await page.waitForTimeout(500); R.undo.after = await image();
  await a.call("ui", { action: "redo" }); await page.waitForTimeout(500); R.undo.redone = await image();
  a.close();
  // (B) the same tools through in-page WebMCP, as a browser agent would call them
  R.webmcp = await page.evaluate(async () => {
    const mc = document.modelContext, tools = await mc.getTools();
    const names = tools.map((t) => t.name), set = tools.find((t) => t.name === "snap_set_dial");
    const res = await mc.executeTool(set, { dial: "dials/h3_motion_hook.safetensors", strength: -0.75 });
    const rack = JSON.parse(window.app.graph.nodes.find((n) => n.type === "MAIDialRack").widgets.find((w) => w.name === "rack").value);
    return { count: names.filter((n) => n.startsWith("snap_")).length, sample: names.slice(0, 4), result: typeof res === "string" ? res.slice(0, 120) : res, strength: rack[0]?.strength,
      consequential: tools.find((t) => t.name === "snap_run")?.annotations ?? null };
  }).catch((e) => ({ error: e.message }));
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_agent_full_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
