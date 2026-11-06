// Batch F (the operator 2026-11-05: "Agents can see" on a person's tab means agents DRIVE that tab): which page agent calls
// go to. A person's tab (a normal browser, not headless) and an agent's own headless page are open:
// - the person's tab with the control off is never driven, and (G1, SNAP-R83: the person's main tab is the default) an
//   unbound call doesn't go to the agent's headless page instead: it is refused, saying how to get a page;
// - once the person presses "Let agents see", calls go to their tab (the newest such tab), and every answer names it;
// - an explicit target (header X-Snap-Page = a page id from /mainodes/snap/tools) keeps an agent on its own page;
// - with the agent's page closed and the control off again, a call says how to get a page instead of driving the tab;
// - /mainodes/snap/tools lists each page's id, whether its person lets agents see, and where calls go.
// usage: node test_f8_route.js [port 8195]     BEFORE=f70e778 node test_f8_route.js (page code only; the bridge is the server's)
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, base = `http://127.0.0.1:${port}`, R = {};
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const call = async (tool, args = {}, page) => { const r = await fetch(`${base}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json", ...(page ? { "X-Snap-Page": page } : {}) }, body: JSON.stringify({ tool, args }) }); return { status: r.status, ...(await r.json()) }; };
const tools = async () => (await (await fetch(`${base}/mainodes/snap/tools`)).json()).pages;
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true, args: ["--enable-features=WebMCP", "--auto-accept-this-tab-capture", "--use-fake-ui-for-media-stream"] });
  const open = async (ua) => { const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, ...(ua ? { userAgent: ua } : {}) })).newPage(); await p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    await p.goto(`${base}/?snap`); await p.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await p.waitForTimeout(3000); await p.keyboard.press("Escape");
    return { p, id: await p.evaluate(() => sessionStorage.getItem("clientId")) }; };
  const agent = await open(), person = await open(UA);
  R.offCall = await call("read_ui");
  await person.p.click(".snap-see"); await person.p.waitForTimeout(1500);
  R.sees = await person.p.textContent(".snap-see");
  R.onCall = await call("read_ui");
  R.targeted = await call("read_ui", {}, agent.id);
  R.listing = (await tools()).map((x) => ({ me: x.id === person.id ? "person" : x.id === agent.id ? "agent" : "other", sees: x.sees, headless: x.headless, to: x.calls_go_here }));
  await person.p.click(".snap-see"); await person.p.waitForTimeout(800);
  await agent.p.context().close(); await person.p.waitForTimeout(1500);
  R.noneCall = await call("read_ui");
  const checks = {
    "with the control off, an unbound call drives neither the tab nor the headless page": R.offCall.status === 503 && !R.offCall.page && /Let agents see/.test(R.offCall.error ?? ""),
    "once the person lets agents see, calls go to their tab and say so": /Agents can see/.test(R.sees ?? "") && R.onCall.page?.id === person.id && R.onCall.page.sees === true,
    "an explicit target keeps the agent on its own page": R.targeted.page?.id === agent.id,
    "the listing names each page's id, its control and where calls go": R.listing.some((x) => x.me === "person" && x.sees === true && x.to === true) && R.listing.some((x) => x.me === "agent" && x.headless === true && x.to === false),
    "with no page to drive, a call says how to get one and never drives the tab": R.noneCall.status === 503 && /Let agents see/.test(R.noneCall.error ?? "") && /snap_agent_page\.sh/.test(R.noneCall.error ?? ""),
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`f8route  ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
