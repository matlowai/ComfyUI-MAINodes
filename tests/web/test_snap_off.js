// Snap is off until a person turns it on (web/snap/enabled.js, the switch at the end of web/snap_view.js):
// - a new person sees nothing of Snap but one Extensions-menu command, and nothing of Snap runs;
// - that command turns Snap on at once, with no reload, and it stays on;
// - Turn Snap off closes it and after a reload nothing of Snap is left;
// - a person with Snap work on the server stays on with no choice made; /?snap is a choice to turn it on.
// It WRITES settings and a userdata file: throwaway server only.
//   NODE_PATH=<playwright's node_modules> node tests/web/test_snap_off.js <port>
const { chromium } = require("playwright");
const port = process.argv[2];
if (!port) { console.error("usage: node test_snap_off.js <port of a throwaway ComfyUI>"); process.exit(2); }
(async () => {
  const b = await chromium.launch({ executablePath: process.env.SNAP_TEST_CHROME || "/usr/bin/google-chrome", headless: true });
  const page = await (await b.newContext({ viewport: { width: 1700, height: 900 } })).newPage(), errors = [], R = {};
  let calls = []; page.on("request", (r) => { if (/\/mainodes\/snap\/(register|page)/.test(r.url())) calls.push(r.url()); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const load = async (q = "") => { calls = []; await page.goto(`http://127.0.0.1:${port}/${q}`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500); };
  const state = async () => ({ ...(await page.evaluate(() => { const buttons = [...document.querySelectorAll("button")].map((x) => (x.textContent || "").trim()), root = document.querySelector(".snap-root");
    return { snapBtn: buttons.some((t) => /^Snap$/.test(t)), strategies: buttons.some((t) => /^Strategies$/.test(t)), root: !!root, showing: !!root && root.style.display !== "none",
      setting: app.extensionManager.setting.get("MAINodes.Snap.Enabled"), exts: app.extensions.filter((e) => /^MAINodes\.Snap/.test(e.name)).map((e) => e.name).sort().join(","),
      snapSettings: !!app.extensionManager.setting.get("MAINodes.Snap.OpenIn"), tab: [...document.querySelectorAll("[class*=side-bar] button, .side-bar-button")].some((x) => /Snap/.test(`${x.getAttribute("aria-label") ?? ""} ${x.textContent ?? ""}`)) }; })), registered: calls.length });
  const run = (id) => page.evaluate((id) => app.extensionManager.command.execute(id).then(() => "ok", (e) => `ERR ${e.message}`), id);
  const set = (v) => page.evaluate((v) => app.extensionManager.setting.set("MAINodes.Snap.Enabled", v), v);
  const toasts = () => page.evaluate(() => [...document.querySelectorAll(".p-toast-message, ol > li, [role=alert]")].map((x) => x.textContent).join(" | "));
  const altS = async () => { await page.keyboard.press("Escape"); const was = (await state()).showing; await page.keyboard.press("Alt+s"); await page.waitForTimeout(800); const now = (await state()).showing; if (now !== was) { await page.keyboard.press("Alt+s"); await page.waitForTimeout(500); } return now !== was; };
  const closeSheets = async () => { await page.evaluate(() => document.querySelector(".snap-onboard")?.remove()); };
  // a new person: no choice, and nothing in their snap/ folder but the file older versions wrote on every load
  const wipe = () => page.evaluate(async () => { const list = await app.api.fetchApi("/userdata?dir=snap&recurse=true&split=false").then((r) => (r.ok ? r.json() : []));
    for (const f of list) await app.api.fetchApi(`/userdata/${encodeURIComponent(`snap/${f}`)}`, { method: "DELETE" });
    await app.api.fetchApi("/userdata/snap%2Fcritiques%2F_since.json?overwrite=true", { method: "POST", body: "{}" }); });
  await load(); await set(null); await wipe();
  await load(); R.fresh = await state(); R.freshAltS = await altS();
  R.hasTurnOn = await page.evaluate(() => app.extensions.find((e) => e.name === "MAINodes.Snap.Switch")?.menuCommands?.[0]?.commands?.[0] ?? null);
  R.turnOn = await run("MAINodes.Snap.TurnOn"); await page.waitForTimeout(2500); await closeSheets();
  R.live = await state(); R.liveShot = null;
  await load(); await page.keyboard.press("Escape"); R.afterReload = await state(); R.reloadAltS = await altS();
  await run("MAINodes.Snap.Toggle"); await page.waitForTimeout(1200); await closeSheets();
  const off = page.locator(".snap-top button", { hasText: "Turn Snap off" }); R.offButton = await off.count();
  if (R.offButton) await off.first().click(); else await run("MAINodes.Snap.TurnOff");
  await page.waitForTimeout(1500); R.turnedOff = await state(); R.offToast = await toasts();
  // the Snap button is still in the top bar until the reload: a press on it turns Snap back on
  await page.locator('button[aria-label="Snap view (Alt+S)"]').first().click(); await page.waitForTimeout(1500); await closeSheets(); R.backOn = await state();
  await page.locator(".snap-top button", { hasText: "Turn Snap off" }).first().click(); await page.waitForTimeout(1500);
  await load(); R.offReload = await state(); R.offAltS = await altS(); R.offToggle = await run("MAINodes.Snap.Toggle");
  await wipe(); await set(null); await page.evaluate(() => app.api.fetchApi("/userdata/snap%2Fprofile.json?overwrite=true", { method: "POST", body: "{}" }));
  await load(); await page.keyboard.press("Escape"); R.usedBefore = await state();
  await wipe(); await set(false);
  await load("?snap"); await page.waitForTimeout(1500); await closeSheets(); R.byUrl = await state();
  await set(null);
  const none = (s) => !s.snapBtn && !s.strategies && !s.root && !s.tab && s.registered === 0;
  const c = {
    "a new person: no Snap or Strategies button, no sidebar tab, no view, nothing sent to the agent bridge": none(R.fresh),
    "a new person: only the switch is registered, and Snap's settings are not there": R.fresh.exts === "MAINodes.Snap.Switch" && R.fresh.snapSettings === false,
    "a new person: the choice is written down as off, so it is decided once": R.fresh.setting === false,
    "a new person: Alt+S does nothing": R.freshAltS === false,
    "the Extensions menu carries the turn-on command": R.hasTurnOn === "MAINodes.Snap.TurnOn",
    "turn on, no reload: both buttons appear, Snap opens, the page registers with the bridge": R.turnOn === "ok" && R.live.snapBtn && R.live.strategies && R.live.showing && R.live.registered > 0,
    "turn on is remembered": R.live.setting === true && R.afterReload.setting === true,
    "after a reload Snap is on the ordinary way: buttons, sidebar tab, settings, Alt+S": R.afterReload.snapBtn && R.afterReload.strategies && R.afterReload.root && R.afterReload.snapSettings && R.reloadAltS === true,
    "Snap's top bar has Turn Snap off": R.offButton === 1,
    "turn off: the view closes, the sidebar tab goes, the choice is saved, and the note says a reload finishes it": R.turnedOff.showing === false && R.turnedOff.tab === false && R.turnedOff.setting === false && /Snap is off\. Reload the page/.test(R.offToast),
    "before the reload, a press on the Snap button that is still there turns Snap back on": R.backOn.showing === true && R.backOn.setting === true && R.backOn.tab === true,
    "after that reload nothing of Snap is left": none(R.offReload) && R.offReload.exts === "MAINodes.Snap.Switch" && R.offAltS === false && /^ERR/.test(R.offToggle),
    "no choice made, but this person opened Snap before (a profile on the server): Snap stays on": R.usedBefore.snapBtn && R.usedBefore.root && R.usedBefore.setting === true,
    "/?snap turns it on and opens it, even when it was off": R.byUrl.snapBtn && R.byUrl.showing && R.byUrl.setting === true,
    "no page errors": errors.length === 0,
  };
  let bad = 0; for (const [k, v] of Object.entries(c)) { console.log(`${v ? "PASS" : "FAIL"}   ${k}`); if (!v) bad++; }
  if (bad) console.log(JSON.stringify({ R, errors }, null, 1));
  console.log(`\n${Object.keys(c).length - bad}/${Object.keys(c).length} ${bad ? "FAIL" : "PASS"}`);
  await b.close(); process.exit(bad ? 1 : 0);
})();
