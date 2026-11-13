// The Snap switch (web/snap/enabled.js, Settings › MAINodes › Snap): on by default; off takes Snap and Strategies out
// of the top bar and the sidebar, stops Alt+S, and runs none of Snap's setup. It WRITES a setting: throwaway server only.
//   NODE_PATH=<playwright's node_modules> node tests/web/test_snap_off.js <port>
const { chromium } = require("playwright");
const port = process.argv[2];
if (!port) { console.error("usage: node test_snap_off.js <port of a throwaway ComfyUI>"); process.exit(2); }
(async () => {
  const b = await chromium.launch({ executablePath: process.env.SNAP_TEST_CHROME || "/usr/bin/google-chrome", headless: true });
  const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } }), page = await ctx.newPage(), errors = [], R = {};
  let calls = []; page.on("request", (r) => { if (/\/mainodes\/snap\/(register|page)/.test(r.url())) calls.push(r.url()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const load = async () => { calls = []; await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500); await page.keyboard.press("Escape"); };
  const state = async () => ({ ...(await page.evaluate(() => { const txt = (sel) => [...document.querySelectorAll(sel)].map((x) => (x.textContent || x.getAttribute("aria-label") || "").trim());
    const buttons = txt("button"); return { snapBtn: buttons.some((t) => /^Snap$/.test(t)), strategies: buttons.some((t) => /^Strategies$/.test(t)),
      tab: !!document.querySelector('[class*="mainodes-snap"], [data-testid*="mainodes-snap"]') || [...document.querySelectorAll(".side-bar-button, .sidebar-item, [class*=side-bar] button")].some((x) => /Snap/.test(x.getAttribute("aria-label") ?? x.textContent ?? "")),
      root: !!document.querySelector(".snap-root"), setting: app.extensionManager.setting.get("MAINodes.Snap.Enabled"), local: localStorage.getItem("MAINodes.Snap.Enabled"),
      queueStock: !/snap_job|I\.pin|J\.sending/.test(String(window.comfyAPI?.api?.api?.queuePrompt ?? "")) && /native code|queuePrompt/.test(String(window.comfyAPI?.api?.api?.queuePrompt ?? "")) }; })), registered: calls.length });
  const altS = async () => { await page.keyboard.press("Alt+s"); await page.waitForTimeout(700); const shown = await page.evaluate(() => { const r = document.querySelector(".snap-root"); return !!r && r.style.display !== "none"; }); if (shown) { await page.keyboard.press("Alt+s"); await page.waitForTimeout(400); } return shown; };
  await load(); await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.Enabled", true)); await load();
  R.on = await state(); R.onAltS = await altS();
  await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.Enabled", false)); await page.waitForTimeout(500);
  R.toast = await page.evaluate(() => [...document.querySelectorAll(".p-toast-message, ol > li, [role=alert]")].map((x) => x.textContent).join(" | "));
  await load(); R.off = await state(); R.offAltS = await altS();
  await page.evaluate(() => app.extensionManager.command.execute("MAINodes.Snap.Toggle")); await page.waitForTimeout(500);
  R.offCommand = await page.evaluate(() => [...document.querySelectorAll(".p-toast-message, ol > li, [role=alert]")].map((x) => x.textContent).join(" | "));
  await page.evaluate(() => localStorage.removeItem("MAINodes.Snap.Enabled")); await load(); R.offNewBrowser = await state(); // another browser: only the server's setting says off
  await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.Enabled", true)); await load(); R.back = await state(); R.backAltS = await altS();
  const c = {
    "on (the default): Snap and Strategies are in the top bar, Snap's view exists, the page registers with the bridge": R.on.snapBtn && R.on.strategies && R.on.root && R.on.registered > 0,
    "on: Alt+S opens Snap": R.onAltS === true,
    "switching it off says a reload is needed": /Reload the page to turn Snap off/.test(R.toast),
    "off: no Snap button, no Strategies button, no sidebar tab": !R.off.snapBtn && !R.off.strategies && !R.off.tab,
    "off: none of Snap's setup ran (no view, no bridge registration)": !R.off.root && R.off.registered === 0,
    "off: Alt+S does nothing": R.offAltS === false,
    "off: the Toggle command says where to turn Snap on": /Snap is off/.test(R.offCommand),
    "off in a browser that never saw the switch: still no buttons, no view": !R.offNewBrowser.snapBtn && !R.offNewBrowser.strategies && !R.offNewBrowser.root && R.offNewBrowser.registered === 0,
    "on again after a reload: everything is back": R.back.snapBtn && R.back.strategies && R.back.root && R.backAltS === true,
    "no page errors": errors.length === 0,
  };
  let bad = 0; for (const [k, v] of Object.entries(c)) { console.log(`${v ? "PASS" : "FAIL"}   ${k}`); if (!v) bad++; }
  if (bad) console.log(JSON.stringify({ R, errors }, null, 1));
  console.log(`\n${Object.keys(c).length - bad}/${Object.keys(c).length} ${bad ? "FAIL" : "PASS"}`);
  await b.close(); process.exit(bad ? 1 : 0);
})();
