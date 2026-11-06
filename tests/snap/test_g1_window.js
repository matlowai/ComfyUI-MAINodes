// SNAP-R83 (G1, the operator 2026-11-06), the bridge's side of the agents' window, on the fresh CPU server (:8196). A test
// browser stands in for the window (a DevTools port on 127.0.0.1 told to the server as the launcher does; no window on
// the desktop):
// - its tab registers as the agents' window: managed, sees, named so; unbound calls go to it; get_profile says agents see
//   it; screenshot comes from its Chrome;
// - the server restarts with newer Snap code: the tab is stale; the chrome tool reloads it (the server still knows the
//   port), it registers current again and answers a call (F-C24: the agent no longer waits on the person);
// - routing: with a person's tab open and "Let agents see" off, an unbound call is refused and never goes to an agent's
//   headless page instead; only with no person's tab at all does it fall back to the headless page (test servers).
// usage: node test_g1_window.js [port 8196]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const port = process.argv[2] || CFG.freshPort, base = `http://127.0.0.1:${port}`, R = {}, CDP = 9338;
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";
const WEB = path.join(CFG.pack, "web", "snap", "sight.js");
const post = async (route, body, agent = "g1") => { const r = await fetch(`${base}${route}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snap-Agent": agent }, body: JSON.stringify(body) }); return { status: r.status, ...(await r.json()) }; };
const call = (tool, args = {}, agent) => post("/mainodes/snap/call", { tool, args }, agent);
const pages = async () => (await (await fetch(`${base}/mainodes/snap/tools`)).json()).pages ?? [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, n = 120) => { for (let i = 0; i < n; i++) { const v = await fn().catch(() => null); if (v) return v; await sleep(500); } return null; };
async function open(browser, ua) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ...(ua ? { userAgent: ua } : {}) }), p = await ctx.newPage();
  await p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await p.goto(`${base}/?snap`); await p.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await p.waitForTimeout(3000);
  return { p, id: await p.evaluate(() => sessionStorage.getItem("clientId")) };
}
(async () => {
  const win = await chromium.launch({ executablePath: CFG.chrome, headless: true, args: [`--remote-debugging-port=${CDP}`] });
  const other = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    R.attach = await post("/mainodes/snap/chrome", { cdp: CDP });
    const W = await open(win, UA);
    R.listed = (await pages()).find((x) => x.id === W.id);
    R.seeBtn = await W.p.textContent(".snap-see").catch(() => null);
    R.profile = await call("get_profile");
    R.shot = await call("screenshot", { max_width: 640 });
    const img = R.shot.result?.image; if (img?.data) { fs.writeFileSync(path.join(CFG.out, "ui", "g1_window_shot.jpg"), Buffer.from(img.data, "base64")); img.data = `${img.data.length} chars`; }
    await W.p.screenshot({ path: path.join(CFG.out, "ui", "g1_window_topbar.png"), clip: { x: 0, y: 0, width: 1400, height: 60 } });
    // newer code on the server, then a restart: the tab comes back stale, the agent reloads it
    fs.utimesSync(WEB, new Date(), new Date());
    execFileSync("systemctl", ["--user", "restart", CFG.freshUnit]);
    await until(async () => (await fetch(`${base}/system_stats`)).ok);
    R.stale = await until(async () => (await pages()).find((x) => x.id === W.id && x.code_current === false));
    R.reload = await call("chrome", { action: "reload" });
    R.after = (await pages()).find((x) => x.id === W.id);
    R.callAfter = await call("read_ui");
    R.status = await call("chrome", {});
    await W.p.context().close();
    // routing without the window: a person's tab with the control off, and an agent's headless page
    const P = await open(other, UA), H = await open(other);
    R.offTab = await call("read_ui");
    await P.p.context().close();
    R.noPerson = await until(async () => { const r = await call("read_ui"); return r.page ? r : null; }, 20);
    R.H = H.id;
  } finally { await win.close(); await other.close(); }
  const checks = {
    "the window's tab is the agents' window: managed, sees, calls go there": R.attach.cdp === CDP && R.listed?.managed === true && R.listed.sees && R.listed.calls_go_here && !R.listed.headless && /^agents' window /.test(R.listed.name),
    "its top bar says so": /Agents' window/.test(R.seeBtn ?? ""),
    "get_profile through the bridge: agents see it": R.profile.status === 200 && R.profile.result?.agents?.see === true && /agents' window/.test(R.profile.result.agents.page ?? ""),
    "screenshot comes from its Chrome": R.shot.status === 200 && R.shot.result?.image?.mimeType === "image/jpeg" && R.shot.result.image.width === 640,
    "after a restart with newer code the tab is stale": !!R.stale,
    "the chrome tool reloads it: current again, and it answers": R.reload.status === 200 && R.reload.result?.reloaded?.length === 1 && R.after?.code_current === true && R.callAfter.status === 200 && R.callAfter.page?.id === R.after.id,
    "chrome status lists the tab with its page": R.status.result?.running === true && R.status.result.tabs.some((t) => t.page === R.after?.id && t.code_current === true),
    "a person's tab with the control off: refused, never a headless page instead": R.offTab.status === 503 && /never go to another page/.test(R.offTab.error ?? "") && /snap_agent_page\.sh/.test(R.offTab.error ?? ""),
    "no person's tab at all: the headless page (a test server)": R.noPerson?.page?.id === R.H,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g1window ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
