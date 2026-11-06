// Batch D (b): at 390 px the Takes header ("Takes", the count, the hint "drag to rank · tick two to compare", Compare)
// wrapped the hint over four lines (proto/ui/357). The hint now keeps to one line on a row of its own under "Takes …
// Compare" when the column is narrow; on a desktop width it stays on the header's row. Screens 370 (390 px), 371 (desktop).
// usage: node test_d_takes_header.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    for (const [name, width, height, shot] of [["phone", 390, 844, "370-d-takes-header-phone.png"], ["desktop", 1600, 1000, "371-d-takes-header-desktop.png"]]) {
      const page = await (await b.newContext({ viewport: { width, height } })).newPage();
      await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
      const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
      await page.keyboard.press("Escape");
      await page.evaluate(async () => { const X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); app.graph.clear(); await X.callTool("start_recipe", {}); });
      await page.waitForTimeout(1200);
      R[name] = await page.evaluate(() => {
        const head = document.querySelector(".snap-takes > header"), hint = head.querySelector(".snap-takes-hint"), title = head.querySelector("strong"), cmp = [...head.querySelectorAll("button")].find((x) => x.textContent === "Compare");
        const r = (el) => el.getBoundingClientRect(), lh = parseFloat(getComputedStyle(hint).lineHeight) || parseFloat(getComputedStyle(hint).fontSize) * 1.3;
        return { hintLines: Math.round(r(hint).height / lh), hintRight: r(hint).right, headRight: r(head).right, compareTop: Math.round(r(cmp).top), titleTop: Math.round(r(title).top), hintTop: Math.round(r(hint).top), headHeight: Math.round(r(head).height), scrollX: document.documentElement.scrollWidth > innerWidth };
      });
      R[name].errors = errs;
      await page.locator(".snap-takes").screenshot({ path: path.join(out, shot) });
      await page.close();
    }
    const near = (a, b) => Math.abs(a - b) <= 8;
    const c = {
      "390 px: the hint is one line": R.phone.hintLines === 1,
      "390 px: Compare sits on the Takes row": near(R.phone.compareTop, R.phone.titleTop),
      "390 px: the hint fits inside the header": R.phone.hintRight <= R.phone.headRight + 1,
      "desktop: the hint stays on the header's row, one line": R.desktop.hintLines === 1 && near(R.desktop.hintTop, R.desktop.titleTop),
      "no page errors": !R.phone.errors.length && !R.desktop.errors.length,
    };
    R.checks = c;
    fs.writeFileSync(path.join(out, "test_d_takes_header_result.json"), JSON.stringify(R, null, 1));
    const bad = Object.keys(c).filter((k) => !c[k]);
    console.log(`dtakeshd ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  } finally { await b.close(); }
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
