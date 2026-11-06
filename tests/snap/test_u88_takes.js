// U88 (2), pack side (SNAP-R54): on a signed-in install, takes rated above the account's cap are left out of list_takes,
// get_take and Dailies, whose count says how many it left out; without a gate nothing is left out. On the CPU test server
// (no gate): two takes are made (a plain one, PG, and one whose text holds a term, Adult); then the page is told by a
// routed /gate/me that it is signed in as a Mature member and reloaded on the same workflow.
// Queues only 64 px EmptyImage -> SaveImage prompts. Screenshot: ui/280-u88-takes-above-cap.png.
// usage: node test_u88_takes.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
let gated = false;
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/gate\/me$/, (r) => (gated ? r.fulfill({ status: 200, contentType: "application/json", body: '{"account":"member","role":"member","max_rating":"mature"}' }) : r.fulfill({ status: 404, body: "" })));
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const ready = async () => { await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500); };
  await page.goto(`http://127.0.0.1:${port}/?snap`); await ready();
  await page.evaluate(async () => { app.graph.clear(); app.graph.extra = {}; window.__X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); await window.__X.callTool("start_recipe", {});
    await app.extensionManager.setting.set("MAINodes.Snap.RatePromptWords", true); });
  try {
    const take = (text) => page.evaluate(async (text) => {
      const K = await import("/extensions/ComfyUI-MAINodes/snap/checks.js"), T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
      const id = await K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/u88" } },
        3: { class_type: "PrimitiveStringMultiline", inputs: { value: text } } }, { job: { kind: "run", title: "a test fixture take (SNAP-R65: every queued prompt carries its question)" }, group: app.graph.id });
      for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((r) => setTimeout(r, 500));
      const t = T.get(`take-${id}`);
      return t && { id: t.id, rating: t.rating ?? null };
    }, text);
    R.plain = await take("a lighthouse keeper at dusk");
    R.adult = await take("a nude figure study at dusk");
    R.group = await page.evaluate(() => app.graph.id);
    R.ungated = await page.evaluate((ids) => window.__X.callTool("list_takes", {}).then((l) => l.filter((t) => ids.includes(t.id)).map((t) => t.id)), [R.plain.id, R.adult.id]);
    await page.waitForTimeout(1500); // the open workflow is kept for the reload
    gated = true;
    await page.reload(); await ready();
    R.groupAfter = await page.evaluate(() => app.graph.id);
    await page.evaluate(async () => { window.__X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); });
    R.gated = await page.evaluate((ids) => window.__X.callTool("list_takes", {}).then((l) => l.filter((t) => ids.includes(t.id)).map((t) => t.id)), [R.plain.id, R.adult.id]);
    R.getAdult = await page.evaluate((id) => window.__X.callTool("get_take", { take: id }).then(() => "found", (e) => e.message), R.adult.id);
    R.getPlain = await page.evaluate((id) => window.__X.callTool("get_take", { take: id }).then((t) => t.id, (e) => e.message), R.plain.id);
    await page.evaluate(() => document.querySelector(".snap-takes")?.scrollIntoView());
    await page.waitForTimeout(800);
    R.strip = await page.evaluate(() => [...document.querySelectorAll(".snap-take[data-take]")].map((e) => e.dataset.take));
    R.count = await page.evaluate(() => [...document.querySelectorAll(".snap-takes .snap-quiet")].map((e) => e.textContent).find((t) => /ranked|not shown/.test(t)) ?? null);
    await page.screenshot({ path: path.join(out, "280-u88-takes-above-cap.png") });
  } finally {
    await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.RatePromptWords", false)); // a remembered setting: put it back
  }
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_u88_takes_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
