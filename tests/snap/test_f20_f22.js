// U72 run 6 findings F20-F22, on the CPU test server (:8195):
// F20 a page that loaded older Snap code (simulated: its register call carries no code and lacks the newest tools) is
//     named in /mainodes/snap/tools (code_current false, a warning saying how to start your own page); a call routed to it
//     says so (page_warning; an unknown tool's error says the page is older); a current page opens beside it (since G1,
//     SNAP-R83, the launcher opens no headless page: a test page stands in); calls then go to the current page even after
//     the stale one re-registers. Since the operator's
//     2026-11-05 rule ("Agents can see" means agents drive that tab; batch F test_f8_route.js) the stale page is an agent's
//     headless page, and a visible tab whose person let agents see wins over the agent's own page, also after it stops.
//     Every answer names its page under `page`.
// F21 save_cast with a picture that isn't in this server's input folder says which folder and how to upload.
// F22 /mainodes/snap/info names this server's pack (snap_agent_page.sh is in it), input, output and code.
// usage: node test_f20_f22.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, BASE = `http://127.0.0.1:${port}`, out = path.join(CFG.out, "ui"), R = {};
const SNAPBASE = CFG.base;
const NEWEST = ["save_cast", "apply_cast", "list_cast", "retake", "get_record", "diff_record", "update_pins", "list_world", "archive_record", "restore_record", "export_records", "import_records", "delete_record"];
const j = async (p, body) => (await fetch(`${BASE}${p}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {})).json();
async function open(b, { old = false, visible = false } = {}) {
  const page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/mainodes\/snap\/register$/, (r) => {
    const q = JSON.parse(r.request().postData());
    if (old) { delete q.code; q.tools = q.tools.filter((t) => !NEWEST.includes(t.name)); } // an agent page opened before tonight's code
    if (visible) { q.headless = false; q.sees = true; } // a person's tab with "Let agents see" on
    return r.continue({ postData: JSON.stringify(q) });
  });
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  await page.goto(`${BASE}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  return page;
}
(async () => {
  R.info = await j("/mainodes/snap/info");
  R.infoMissing = await j("/mainodes/snap/info?input=snap/no_such_picture.png");
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const oldPage = await open(b, { old: true });
  R.listOld = await j("/mainodes/snap/tools");
  R.callOld = await j("/mainodes/snap/call", { tool: "list_takes", args: {} });
  R.unknownOld = await j("/mainodes/snap/call", { tool: "save_cast", args: { name: "x" } });
  // a current agent page opens beside the stale one
  const current = await open(b);
  R.started = "registered";
  R.listBoth = await j("/mainodes/snap/tools");
  await oldPage.evaluate(() => dispatchEvent(new Event("focus"))); await oldPage.waitForTimeout(1200); // the stale tab re-registers: newest, still not chosen
  R.callAfterRefocus = await j("/mainodes/snap/call", { tool: "list_cast", args: {} });
  // a visible tab whose person lets agents see: it gets the calls
  const vis = await open(b, { visible: true });
  R.callWithVisible = await j("/mainodes/snap/call", { tool: "list_cast", args: {} });
  await current.context().close();
  await vis.waitForTimeout(1500);
  R.callVisibleOnly = await j("/mainodes/snap/call", { tool: "list_cast", args: {} });
  // F21
  R.missingPic = await j("/mainodes/snap/call", { tool: "save_cast", args: { name: "Ana", lora: null, refs: [{ file: "snap/no_such_picture.png", role: "identity: front" }] } });
  R.errors = [...oldPage.errs, ...vis.errs, ...current.errs];
  await b.close();

  const c = {
    "F22 info names this server's pack (snap_agent_page.sh in it), input, output and code": fs.existsSync(path.join(R.info.pack, "tools", "snap_agent_page.sh")) && R.info.input === path.join(SNAPBASE, "input") && !!R.info.output && /^[0-9a-f]{12}$/.test(R.info.code) && R.infoMissing.input_exists === false,
    "F20 /tools names a stale page and says how to start your own": R.listOld.pages.length === 1 && R.listOld.pages[0].code_current === false && /older Snap code/.test(R.listOld.warning ?? "") && /snap_agent_page\.sh/.test(R.listOld.warning ?? "") && /never headless/.test(R.listOld.warning ?? ""),
    "F20 the stale note says when the tab connected, not 'loaded' (batch C)": /connected to this server since \d\d:\d\d/.test(R.listOld.warning ?? "") && !/loaded \d\d:\d\d/.test(R.listOld.warning ?? ""),
    "F20 a call routed to the stale page says so in its answer and names the page": /older Snap code/.test(R.callOld.result?.page_warning ?? R.callOld.warning ?? "") && R.callOld.page?.code_current === false,
    "F20 a tool the stale page lacks: the error says the page is older": /Unknown Snap tool 'save_cast'/.test(R.unknownOld.error ?? "") && /older Snap code/.test(R.unknownOld.error ?? ""),
    "F20 a current page beside the stale one": /registered/.test(R.started) && R.listBoth.pages.filter((p) => p.code_current).length === 1,
    "F20 calls go to the current page after the stale one re-registers": R.callAfterRefocus.page?.code_current === true && Array.isArray(R.callAfterRefocus.result) && !R.callAfterRefocus.result?.page_warning,
    "F20 a visible tab whose person lets agents see wins over the agent's own page": R.callWithVisible.page?.headless === false && R.callWithVisible.page.sees === true,
    "F20 without the agent page, the opted-in visible tab wins over the stale page": R.callVisibleOnly.page?.headless === false && R.callVisibleOnly.page.code_current === true,
    "F21 a picture not in this server's input says which folder and how to upload": /isn't in this server's input folder/.test(R.missingPic.error ?? "") && (R.missingPic.error ?? "").includes(R.info.input) && /upload\/image/.test(R.missingPic.error ?? ""),
    "no page errors": !R.errors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_f20_f22_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`f20f22   ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
