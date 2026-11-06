// G1 item 6 (2026-11-06): reloading a tab straight into Snap threw 'No slot "upscale"' (web/snap/view.js drew a slot
// brick's face before the method registry had loaded). The test opens the video recipe (it has the Upscale brick), then
// reloads ?snap with /mainodes/snap/methods held back 4 s, so the face draws first every time: no page error, and the
// Upscale face fills in once the registry arrives.
// usage: node test_g1_reload.js [port 8195]     BEFORE=b600297 node test_g1_reload.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    R.recipe = await page.evaluate(() => window.__X.callTool("start_recipe", {}).then((r) => Object.keys(r ?? {}), (e) => ({ error: e.message })));
    await page.waitForTimeout(2500);
    R.bricks = await page.evaluate(() => window.__E.state().bricks.map((x) => x.key));
    await page.route(/\/mainodes\/snap\/methods$/, async (r) => { await new Promise((ok) => setTimeout(ok, 4000)); r.fallback(); });
    A.errors.length = 0;
    await page.reload();
    await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 });
    await page.waitForTimeout(9000);
    R.errors = [...A.errors];
    R.face = await page.evaluate(() => document.querySelector('[data-brick="upscale"]')?.textContent ?? null);
    R.showing = await page.evaluate(() => !!document.querySelector(".snap-root, .snap-view"));
  } finally { await b.close(); }
  const checks = {
    "the recipe has the Upscale brick": R.bricks?.includes("upscale"),
    "reloading straight into Snap with the registry late: no page error": !R.errors.length,
    "the Upscale face draws once the registry arrives": !!R.face && !/No slot/.test(R.face),
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g1reload ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
