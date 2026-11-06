// Files dropped on Snap go to a brick that takes them (upload widget read from the node definition, or References) and
// never add stray nodes to the graph; arrows move along the chain's own axis. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => r.request().method() === "POST" ? (q++, r.abort()) : r.continue());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap; app.graph.clear(); app.graph.extra = {}; for (const k of ["models", "preset", "rack", "first_frame", "refs", "render"]) await snap.engine.snap(k); snap.toggle(); });
  await page.waitForTimeout(900);
  const drop = (brick, type, name) => page.evaluate(async ([brick, type, name]) => {
    const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }); const g = c.getContext("2d"); g.fillStyle = "#c33"; g.fillRect(0, 0, 40, 40);
    const blob = type.startsWith("image") ? await new Promise((r) => c.toBlob(r, type)) : new Blob(["x"], { type });
    const dt = new DataTransfer(); dt.items.add(new File([blob], name, { type }));
    const el = document.querySelector(`.snap-brick[data-brick="${brick}"]`);
    for (const t of ["dragenter", "dragover", "drop"]) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 1500));
    return { nodes: app.graph.nodes.map((n) => n.type).filter((t) => t.length < 30).sort(), toast: document.querySelector(".snap-toast").textContent };
  }, [brick, type, name]);
  const n0 = await page.evaluate(() => app.graph.nodes.length);
  R.firstFrame = await drop("first_frame", "image/png", `snapdrop_${Date.now()}.png`);
  R.firstFrame.value = await page.evaluate(() => window.__snap.engine.getValue("first_frame", "image", "image"));
  R.firstFrame.added = (await page.evaluate(() => app.graph.nodes.length)) - n0;
  R.refs = await drop("refs", "image/png", `snapdrop_ref_${Date.now()}.png`);
  R.refs.pictures = await page.evaluate(() => (window.__snap.engine.state().bricks.find((x) => x.key === "refs").pictures ?? []).length);
  const n1 = await page.evaluate(() => app.graph.nodes.length);
  R.models = await drop("models", "image/png", "nope.png");
  R.models.added = (await page.evaluate(() => app.graph.nodes.length)) - n1;
  R.audioOnFirstFrame = await drop("first_frame", "audio/wav", "nope.wav");
  await page.screenshot({ path: path.join(out, "48-drop.png") });
  // arrows along the chain
  await page.keyboard.press("Escape");
  await page.locator('.snap-brick[data-brick="models"]').focus();
  await page.evaluate(() => window.__snap.view.select("models"));
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150); R.right1 = await page.evaluate(() => window.__snap.view.selected);
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(150); R.right2 = await page.evaluate(() => window.__snap.view.selected);
  await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(150); R.left1 = await page.evaluate(() => window.__snap.view.selected);
  await page.keyboard.press("ArrowDown"); await page.waitForTimeout(150); R.downIgnored = await page.evaluate(() => window.__snap.view.selected);
  await page.keyboard.press("Alt+ArrowRight"); await page.waitForTimeout(600); R.altRightOrder = await page.evaluate(() => window.__snap.engine.state().bricks.map((x) => x.key).slice(0, 3));
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_drop_keys_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
