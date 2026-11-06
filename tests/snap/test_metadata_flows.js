// U81 (SNAP-R38), the page side: with Save metadata off, every prompt a Snap page queues carries the switch
// (workflow extra.snap_metadata false), and every saver in the default flows is one the server switches (Save Image,
// Preview Image, Save Video, MAI Video Out): the video recipe's Run, the stills recipe's Run, and Snap's own graphs
// (edits, plates, candidates, the louder version: checks.queue). With it on, the mark is gone. Prompts are captured at
// /api/prompt and answered with a fake id, so nothing runs; test_metadata_off.py checks the files the server writes.
// usage: node test_metadata_flows.js [port 8195]
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
  await page.evaluate(() => { app.graph.clear(); app.graph.extra = {}; return app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
  // every prompt the page posts is captured and answered with a fake id: nothing runs (the server side is test_metadata_off.py)
  const posted = [];
  await page.route(/\/api\/prompt$/, async (r) => { if (r.request().method() !== "POST") return r.continue(); posted.push(JSON.parse(r.request().postData())); await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prompt_id: `fake-${posted.length}`, number: posted.length, node_errors: {} }) }); });
  const info = await (await fetch(`http://127.0.0.1:${port}/object_info`)).json();
  const SWITCHED = ["SaveImage", "PreviewImage", "SaveVideo", "MAIVideoOut"];
  const look = (body) => { const outs = Object.values(body.prompt).map((n) => n.class_type).filter((t) => info[t]?.output_node);
    return { off: body.extra_data?.extra_pnginfo?.workflow?.extra?.snap_metadata === false, outputs: outs, unswitched: outs.filter((t) => !SWITCHED.includes(t)) }; };
  const setMeta = (v) => page.evaluate((v) => app.extensionManager.setting.set("MAINodes.Snap.SaveMetadata", v), v);
  const a = mcpClient();
  await a.send("initialize", {});

  // the default recipes' Run with Save metadata off: the workflow carries the switch, and every saver in it is one the server switches
  await setMeta(false);
  await a.call("start_recipe"); await a.call("run");
  R.video = look(posted.at(-1));
  await a.call("start_recipe", { intent: "stills" }); await a.call("run");
  R.stills = look(posted.at(-1));
  // Snap's own graphs (edits, plates, candidates, the louder version) go through checks.queue
  R.ownGraph = await page.evaluate(async () => { const K = await import("/extensions/ComfyUI-MAINodes/snap/checks.js"); return K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 8, height: 8, batch_size: 1, color: 0 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "x" } } }, { group: "g", job: { kind: "run", title: "a test fixture take" } }); });
  R.own = look(posted.at(-1));
  R.check = await page.evaluate(async () => { const K = await import("/extensions/ComfyUI-MAINodes/snap/checks.js"); return K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 8, height: 8, batch_size: 1, color: 0 } }, 2: { class_type: "PreviewImage", inputs: { images: ["1", 0] } } }, { job: { kind: "check", title: "a test check", takes: false } }); });
  R.checkQueue = look(posted.at(-1));
  // control: switch on, the mark is gone
  await setMeta(true); await a.call("run");
  R.on = look(posted.at(-1));
  await a.call("set_agent_permissions", { run: false });
  a.close();
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_metadata_flows_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
