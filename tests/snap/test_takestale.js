// U31 stale flags + revision (UX_GEMS #1, §7) and the U22 lock badge, on the CPU server. This suite DOES run prompts: a
// tiny EmptyImage -> SaveImage graph (+ an unconnected RandomNoise for a seed and an unconnected LoRA loader whose name
// the model graph calls identity on the third take), as test_takes does. Each take keeps hash + seed_hash; an unchanged
// chain flags nothing; a width change flags the older take naming the brick and field; a new seed flags nothing;
// describe_recipe's revision guards a change (if_revision) and a stale one is refused naming what moved; list_takes
// carries stale; the private take shows a lock. Never re-renders on its own (queue count = the three runs).
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"); const R = {};
const IDENTITY = "snaptest_person_identity_lora.safetensors";
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; page.on("request", (r) => { if (r.method() === "POST" && /\/(api\/)?prompt$/.test(r.url())) q++; });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.evaluate(async (id) => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    window.__tools = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); window.__T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
    const { api } = await import("/scripts/api.js");
    await api.storeUserData("snap/models.json", [{ file: id, folder: "loras", kind: "lora", role: "identity" }]);
    app.graph.clear(); app.graph.extra = {};
    const add = (type, x) => { const n = LiteGraph.createNode(type); n.pos = [x, 0]; app.graph.add(n); return n; };
    const img = add("EmptyImage", 0), save = add("SaveImage", 400), noise = add("RandomNoise", 0), lora = add("LoraLoaderModelOnly", 0);
    noise.pos = [0, 300]; lora.pos = [0, 500];
    noise.widgets.find((w) => w.name === "control_after_generate").value = "fixed";
    lora.widgets.find((w) => w.name === "lora_name").value = "snaptest_plain_style_lora.safetensors";
    img.connect(0, save, 0);
    snap.engine.adopt(); snap.toggle();
  }, IDENTITY);
  await page.waitForTimeout(900);
  const set = (type, name, v) => page.evaluate(([t, n, v]) => { const w = app.graph.nodes.find((x) => x.type === t).widgets.find((x) => x.name === n); w.value = v; w.callback?.(v); app.canvas.setDirty(true, true); app.graph.change?.(); }, [type, name, v]);
  const run = async () => {
    const n = await page.$$eval(".snap-take", (e) => e.length);
    await page.click(".snap-run");
    await page.waitForFunction((n) => document.querySelectorAll(".snap-take").length > n, n, { timeout: 60000 });
    await page.waitForTimeout(800);
  };
  const chips = async () => { await page.waitForTimeout(900); return page.$$eval(".snap-take", (els) => els.map((e) => [e.querySelector("figcaption b").textContent, e.querySelector(".snap-take-stale")?.hidden === false ? e.querySelector(".snap-take-stale").textContent : null, !!e.querySelector(".snap-take-lock")])); };
  const call = (name, args) => page.evaluate(([n, a]) => window.__tools.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  await set("EmptyImage", "width", 256); await run();
  R.take1 = await page.evaluate(() => { const t = window.__T.inGroup().at(-1); return { hash: t.hash?.length, seed_hash: t.seed_hash?.length, private: !!t.private }; });
  R.unchanged = await chips();
  await set("EmptyImage", "width", 320); await run();
  R.afterWidth = await chips();
  await set("RandomNoise", "noise_seed", 777);
  R.afterSeed = await chips();
  // revision: describe_recipe gives one; a change carrying it goes through, a second change with the same one is refused
  const r1 = (await call("describe_recipe", {})).revision;
  const imgId = await page.evaluate(() => app.graph.nodes.find((x) => x.type === "EmptyImage").id);
  R.revision = { r1, first: await call("set_widget", { node: imgId, name: "height", value: 96, if_revision: r1 }), second: await call("set_widget", { node: imgId, name: "height", value: 128, if_revision: r1 }),
    without: await call("set_widget", { node: imgId, name: "height", value: 64 }), schemaHas: await page.evaluate(() => ["set_widget", "describe_recipe"].map((n) => !!window.__tools.schema().find((t) => t.name === n).inputSchema.properties.if_revision)) };
  R.listed = (await call("list_takes", {})).map((t) => [t.number, t.stale?.changed ?? null]);
  // the third take loads an identity LoRA (unconnected loader), run with the top bar's Save metadata switched off (U58):
  // the save gate saves it through the no-metadata twin and marks it private; the switch goes back on after
  await set("LoraLoaderModelOnly", "lora_name", IDENTITY);
  await page.click(".snap-meta"); await page.waitForTimeout(300);
  R.metaSwitch = await page.$eval(".snap-meta", (e) => [e.ariaChecked, e.textContent]);
  await run();
  R.take3 = await page.evaluate(() => { const t = window.__T.inGroup().at(-1); return { private: !!t.private, swapped: t.swapped ?? null, metadata: t.metadata ?? true }; });
  await page.click(".snap-meta"); await page.waitForTimeout(300);
  R.final = await chips();
  await page.screenshot({ path: path.join(out, "104-takes-stale-lock.png") });
  await page.locator(".snap-takes").screenshot({ path: path.join(out, "104b-takes-strip-stale-lock.png") });
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_takestale_result.json"), JSON.stringify(R, null, 1));
  await b.close();
})();
