// Agent path end to end: a page with the Snap view open (plus a stand-in document.modelContext to check the WebMCP
// adapter), driven by tools/snap_mcp.py over stdio exactly as Claude Code would. Never queues.
// NODE_PATH=<playwright's node_modules> node test_agent.js [port] [outdir]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const { spawn } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const port = process.argv[2] || CFG.port;
const out = process.argv[3] || path.join(CFG.out, "ui");
const MCP = path.join(CFG.pack, "tools", "snap_mcp.py");

function mcp() {
  const p = spawn("python3", ["-I", MCP, "--port", port]);
  let buf = "", waiters = [];
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); waiters.shift()?.(JSON.parse(line)); } });
  let id = 0;
  return {
    send: (method, params) => new Promise((r) => { waiters.push(r); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n"); }),
    notify: (method) => p.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n"),
    close: () => p.stdin.end(),
  };
}

(async () => {
  const R = {};
  const browser = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => {
    window.__webmcp = {};
    document.modelContext = { registerTool: (t) => { window.__webmcp[t.name] = t; } };
  });
  const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js");
    window.__snap = snap;
    app.canvas.emitBeforeChange(); app.graph.clear(); app.graph.extra = {}; app.canvas.emitAfterChange();
    snap.toggle();
  });
  await page.waitForTimeout(800);
  R.webmcpTools = await page.evaluate(() => Object.keys(window.__webmcp));
  R.webmcpCall = await page.evaluate(async () => (await window.__webmcp.snap_list_bricks.execute({})).length);

  const m = mcp();
  R.initialize = (await m.send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } })).result?.serverInfo;
  m.notify("notifications/initialized");
  R.mcpTools = (await m.send("tools/list")).result.tools.map((t) => t.name);
  const call = async (name, args = {}) => { const t0 = Date.now(); const r = (await m.send("tools/call", { name, arguments: args })).result; return { ms: Date.now() - t0, isError: r.isError, text: r.content[0].text }; };
  R.calls = [];
  for (const [name, args] of [
    ["snap", { brick: "render" }], ["snap", { brick: "models" }], ["snap", { brick: "preset" }], ["snap", { brick: "rack", after: "preset" }],
    ["snap", { brick: "upscale" }], ["set_setting", { brick: "render", name: "length", value: 97 }],
    ["set_setting", { brick: "render", name: "choice", value: "bogus" }], ["explain_binding", { brick: "render", role: "model" }],
    ["search_library", { query: "fennec" }], ["search_library", { query: "", brick: "rack" }], ["apply_card", { card: "dial-motion" }], ["apply_card", { card: "char-kon" }],
    ["check_continuity", { from: "set-lamp-room-end-s3", to: "set-lamp-room-end-s3" }], ["check_continuity", { card: "set-lamp-room-end-s3" }],
  ]) {
    const r = await call(name, args);
    R.calls.push({ name, args, ms: r.ms, isError: r.isError, text: r.text.slice(0, 240) });
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: path.join(out, "15-agent-edits.png") });
  const described = JSON.parse((await call("describe_recipe")).text);
  R.recipe = described.bricks.map((b) => `${b.brick}: ${b.bindings.map((x) => `${x.role}<-${x.from ?? "="}`).join(" ")}`);
  R.lengthInGraph = await page.evaluate(() => window.__snap.engine.getValue("render", "render", "length"));
  R.unknownTool = await call("drop_tables");
  m.close();
  R.errors = errors;
  fs.writeFileSync(path.join(out, "test_agent_result.json"), JSON.stringify(R, null, 1));
  console.log(JSON.stringify(R, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
