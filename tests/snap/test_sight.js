// Screenshot tool: without sharing it explains what to press; after "Let agents see" (tab capture, auto-accepted in this
// headless run) the MCP server returns an image content block of the live tab. Runs against the GPU server's page
// (:8194 by default) so it never takes the bridge from a person's open tab. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {}; const PORT = process.argv[2] || CFG.port;
const MCP = path.join(CFG.pack, "tools", "snap_mcp.py");
function mcp() {
  const p = spawn("python3", ["-I", MCP, "--port", PORT]); let buf = "", id = 0; const waiting = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) { const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); } } });
  return { call: (name, args = {}) => new Promise((res) => { const m = { jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }; waiting.set(m.id, (x) => res(x.result)); p.stdin.write(JSON.stringify(m) + "\n"); }), close: () => p.kill() };
}
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true, args: ["--enable-features=WebMCP", "--auto-accept-this-tab-capture", "--use-fake-ui-for-media-stream"] });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => r.request().method() === "POST" ? (q++, r.abort()) : r.continue());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
  const a = mcp();
  const before = await a.call("screenshot");
  R.before = { isError: before.isError, text: before.content[0].text };
  if (await page.locator('[data-slot="dialog-overlay"]').count()) { await page.keyboard.press("Escape"); await page.waitForTimeout(500); } // ComfyUI's first-visit dialog on a fresh user folder
  await page.click(".snap-see"); await page.waitForTimeout(1500);
  R.button = await page.textContent(".snap-see");
  const shot = await a.call("screenshot", { max_width: 1280 });
  R.after = { isError: shot.isError, types: shot.content.map((c) => c.type), mime: shot.content[0].mimeType, bytes: shot.content[0].data?.length, text: shot.content[1]?.text };
  if (shot.content[0].data) fs.writeFileSync(path.join(out, "58-agent-screenshot.jpg"), Buffer.from(shot.content[0].data, "base64"));
  await page.click(".snap-see"); await page.waitForTimeout(300);
  R.stopped = await page.textContent(".snap-see");
  a.close();
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_sight_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
