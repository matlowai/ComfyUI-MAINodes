// G3 (SNAP-R135, F-E23, F-E24) on a CPU test server: an agent's hold on a page ends with its job.
// - use_page binds agent A; list_pages says driven_by A and driver_idle_s; the page's chip says "Driven by: A";
// - a call with no agent name on A's page is refused, saying it carries no agent name (F-E23);
// - agent B is refused with A's name and when A last called;
// - snap_mcp.py (agent M) binds the page with use_page and closes its connection: the page is free and its chip gone (F-E24).
// usage: node test_g3_pages.js [port]   prints "g3pages n/m" last
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
const call = async (tool, args, agent) => { const r = await fetch(`http://127.0.0.1:${port}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json", ...(agent ? { "X-Snap-Agent": agent } : {}) }, body: JSON.stringify({ tool, args }) }); return { status: r.status, ...(await r.json()) }; };
// one MCP session: initialize, use_page, then stdin closes (the agent's session ends)
const mcp = (page) => new Promise((done) => {
  const p = spawn("python3", ["-I", path.join(CFG.pack, "tools", "snap_mcp.py"), "--port", String(port)], { env: { ...process.env, SNAP_AGENT: "g3-mcp" } });
  let out = ""; p.stdout.on("data", (d) => { out += d; });
  p.on("close", () => done(out.trim().split("\n").map((l) => { try { return JSON.parse(l); } catch { return l; } })));
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }) + "\n");
  p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "use_page", arguments: { page } } }) + "\n");
  setTimeout(() => p.stdin.end(), 1500);
});
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    await page.evaluate(() => document.querySelector(".snap-root") || null);
    const id = await page.evaluate(async () => (await import("/scripts/api.js")).api.clientId);
    // this test page must be the one calls can reach: it registers with sees off, so bind by id
    R.bind = await call("use_page", { page: id }, "g3-a");
    await page.waitForTimeout(500);
    R.chipA = await page.evaluate(() => document.querySelector(".snap-driver:not([hidden])")?.textContent ?? null);
    R.list = (await call("list_pages", {}, "g3-a")).result?.pages?.find((p) => p.id === id);
    R.unnamed = await call("read_ui", {});
    R.other = await call("read_ui", {}, "g3-b");
    R.mine = await call("read_ui", {}, "g3-a");
    R.release = await call("use_page", { page: null }, "g3-a");
    R.mcp = await mcp(id);
    await page.waitForTimeout(800);
    R.after = (await call("list_pages", {}, "g3-a")).result?.pages?.find((p) => p.id === id);
    R.chipAfter = await page.evaluate(() => document.querySelector(".snap-driver:not([hidden])")?.textContent ?? null);
    R.errors = A.errors;
  } finally { await b.close(); }
  const mcpBound = R.mcp?.find?.((x) => x?.id === 2)?.result?.content?.[0]?.text ?? "";
  const checks = {
    "use_page binds the page and the chip says who drives it": R.bind?.result?.page?.id && /Driven by: g3-a/.test(R.chipA ?? "") && /use_page \{page: null\} lets it go/.test(R.bind.result.said),
    "list_pages says driven_by and driver_idle_s": R.list?.driven_by === "g3-a" && typeof R.list.driver_idle_s === "number",
    "F-E23: an unnamed call on a driven page says it carries no agent name": R.unnamed?.status === 409 && /carries no agent name \(set SNAP_AGENT/.test(R.unnamed.error ?? ""),
    "another agent is refused with the driver's name and its last call": R.other?.status === 409 && /driven by g3-a \(last call \d+ min ago; a hold lapses after 10 idle min\)/.test(R.other.error ?? "") && !/no agent name/.test(R.other.error),
    "the driver's own calls go through": R.mine?.status === 200 && R.mine.result?.view != null,
    "F-E24: an MCP session that bound the page lets go when it closes": /g3-mcp now drives/.test(mcpBound) && R.after?.driven_by == null && R.chipAfter == null,
    "no page errors": !R.errors?.length,
  };
  R.checks = checks;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g3_pages_result.json"), JSON.stringify(R, null, 1));
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  console.log(`g3pages ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
