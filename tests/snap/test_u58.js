// U58 (the operator's 10:45 answers) plus the empty-input fix and the new method entries:
// - Save metadata: a ComfyUI user setting, on by default, a switch right before Run; off, every prompt the page queues
//   (Run, an agent's, the checks' own) carries extra.snap_metadata false; remembered across a reload; the ui tool
//   switches it. (The files themselves: test_private_files.py.)
// - MOSS Base: "✨ Enhance prompt (LLM)" off by default, with its one-line explanation on the Render face.
// - Setup brick: Models + Render Preset (and image_models + Core LoRAs) are one card with family · model · turbo and
//   Models / Sampling sections; the engine keeps both bricks; select, Alt+arrow, × and undo move both; setups and the
//   Turbo chip still work.
// - Empty input folder (object_info lists no pictures): a fresh Simple recipe sends no LoadImage and validation has no
//   LoadImage error; First frame turned on without a picture shows the original error; a picture turns it on.
// - Method entries: extend (chain, geiru) and region (crop_inpaint), not wired, readiness from installed node types.
// Never queues a render: /prompt POSTs are answered here (validation is called directly, and fails on the CPU server's
// missing H3 models before anything runs).
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const out = path.join(CFG.out, "ui"); const R = {};
const PORT = process.argv[2] ?? CFG.port, BASE = `http://127.0.0.1:${PORT}`;
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const bodies = [];
  await page.route(/\/(api\/)?prompt$/, (r) => {
    if (r.request().method() !== "POST") return r.continue();
    bodies.push(r.request().postDataJSON());
    return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prompt_id: `00000000-0000-4000-8000-${String(bodies.length).padStart(12, "0")}`, number: bodies.length, node_errors: {} }) });
  });
  await useShelf(page, { noPictures: true }); // an empty input folder, as the frontend sees it: LoadImage lists no pictures
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const open = async () => {
    await page.goto(`${BASE}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
    await page.keyboard.press("Escape");
    await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap; window.__tools = await import("/extensions/ComfyUI-MAINodes/snap/tools.js");
      window.__MD = await import("/extensions/ComfyUI-MAINodes/snap/metadata.js"); window.__K = await import("/extensions/ComfyUI-MAINodes/snap/checks.js"); });
  };
  await open();
  const call = (name, args) => page.evaluate(([n, a]) => window.__tools.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  const flag = (x) => x.extra_data?.extra_pnginfo?.workflow?.extra?.snap_metadata ?? "absent";

  // ---- the empty input folder: a fresh Simple recipe ----
  await page.evaluate(() => { app.graph.clear(); app.graph.extra = {}; window.__snap.toggle(); });
  await call("start_recipe", {}); await page.waitForTimeout(1500);
  const validate = async () => {
    const p = await page.evaluate(async () => (await app.graphToPrompt()).output);
    const res = await fetch(`${BASE}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: p, client_id: "test-u58" }) });
    const body = await res.json();
    if (res.status === 200) throw new Error("the CPU server accepted an H3 prompt: nothing should run here");
    return { loadImage: Object.values(p).filter((n) => n.class_type === "LoadImage").length, errors: Object.values(body.node_errors ?? {}).map((e) => e.class_type).sort() };
  };
  R.fresh = { mode: await page.evaluate(() => window.__snap.engine.nodeFor("first_frame", "image").mode), value: await page.evaluate(() => window.__snap.engine.getValue("first_frame", "image", "image") ?? null),
    missing: await page.evaluate(() => window.__snap.engine.missing().filter((m) => m.brick === "first_frame").length), ...await validate(),
    face: await page.$eval('.snap-brick[data-brick="first_frame"]', (e) => [e.classList.contains("off"), e.querySelector(".snap-toggle .on")?.textContent, e.querySelector(".snap-toggle em")?.textContent]) };
  await page.screenshot({ path: path.join(out, "120-u58-fresh-first-frame-off.png") });
  await page.click('.snap-brick[data-brick="first_frame"] .snap-toggle button:has-text("this picture")'); await page.waitForTimeout(400);
  R.onEmpty = await validate();
  await page.click('.snap-brick[data-brick="first_frame"] .snap-toggle button:has-text("the prompt")'); await page.waitForTimeout(400);
  await page.evaluate(() => window.__snap.engine.nodeFor("first_frame", "image").widgets.find((w) => w.name === "image").options.values.push("drop_test.png")); // as a drop uploads it
  R.pictureTurnsOn = await call("set_setting", { brick: "first_frame", name: "image", value: "drop_test.png" });
  R.afterPicture = await page.evaluate(() => window.__snap.engine.nodeFor("first_frame", "image").mode);

  // ---- the Setup brick (H3 kit) ----
  const cardsNow = () => page.$$eval(".snap-stack > .snap-brick", (els) => els.map((e) => e.dataset.brick));
  const engine = () => page.evaluate(() => window.__snap.engine.state().bricks.map((x) => x.key));
  R.setup = { cards: await cardsNow(), engine: await engine(), title: await page.textContent('.snap-brick[data-brick="models"] .snap-name'),
    face: await page.$$eval('.snap-brick[data-brick="models"] .snap-face > *', (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim())) };
  await call("ui", { action: "select", target: "preset" }); await page.waitForTimeout(700);
  R.setup.selected = (await call("read_ui", {})).selected;
  R.setup.sections = await page.$$eval(".snap-inspector .snap-insp-type", (els) => els.map((e) => e.textContent));
  R.setup.samplingHas = await page.$$eval(".snap-inspector .snap-field span", (els) => els.map((e) => e.textContent)).then((l) => ["encoder", "model", "LoRA", "steps", "cfg", "video VAE", "audio VAE"].map((x) => l.includes(x)));
  await page.screenshot({ path: path.join(out, "121-u58-setup-brick-h3.png") });
  // Alt+Right moves the card past the Dial Rack: both engine bricks go, in order; one undo puts them back
  await page.focus('.snap-brick[data-brick="models"]'); await page.keyboard.press("Alt+ArrowRight"); await page.waitForTimeout(500);
  R.setup.moved = (await engine()).slice(0, 3);
  await page.evaluate(() => app.extensionManager.workflow.activeWorkflow.changeTracker.undo()); await page.waitForTimeout(700);
  R.setup.undone = (await engine()).slice(0, 3);
  // a setup applies as before (the Setup card follows); × removes both bricks in one step
  const other = (await call("list_setups", {})).find((x) => !x.current && x.family === "MiniMax H3");
  R.setup.applied = [other?.name, (await call("apply_setup", { name: other?.name })).error ?? null];
  await page.waitForTimeout(600);
  R.setup.chipAfter = await page.textContent('.snap-brick[data-brick="models"] .snap-preset');
  await page.click('.snap-brick[data-brick="models"] .snap-x'); await page.waitForTimeout(500);
  R.setup.afterX = (await engine()).filter((k) => ["models", "preset"].includes(k));
  await page.evaluate(() => app.extensionManager.workflow.activeWorkflow.changeTracker.undo()); await page.waitForTimeout(700);
  R.setup.afterXUndo = (await engine()).filter((k) => ["models", "preset"].includes(k));
  R.setup.lanes = await page.$$eval(".snap-lanes text", (els) => els.map((e) => e.textContent));

  // ---- MOSS Base: the expander is off and says what it does; the image Setup holds the Turbo chip ----
  await page.evaluate(async () => { const M = await import("/extensions/ComfyUI-MAINodes/snap/models.js"), L = await import("/extensions/ComfyUI-MAINodes/snap/library.js"); await M.load(); await L.ready();
    app.graph.clear(); app.graph.extra = {}; await M.applyCard(L.get("setup-moss-base"), { fresh: true }); window.__snap.view.render(null); });
  await page.waitForTimeout(1500);
  R.moss = { expand: await page.evaluate(() => window.__snap.engine.getValue("image", "image", "switch")),
    toggle: await page.$eval('.snap-brick[data-brick="image"] .snap-toggle', (e) => [e.querySelector("span").textContent, e.querySelector(".on")?.textContent, e.querySelector("em")?.textContent]),
    cards: await cardsNow(), turboOnSetup: await page.$$eval('.snap-brick[data-brick="image_models"] .snap-turbo', (e) => e.length), turboOnRender: await page.$$eval('.snap-brick[data-brick="image"] .snap-turbo', (e) => e.length) };
  await page.click('.snap-brick[data-brick="image_models"] .snap-name'); await page.waitForTimeout(700);
  R.moss.sections = await page.$$eval(".snap-inspector .snap-insp-type", (els) => els.map((e) => e.textContent));
  await page.screenshot({ path: path.join(out, "122-u58-moss-base-expander-off.png") });
  await page.click(".snap-turbo"); await page.waitForTimeout(400);
  await page.click('.snap-turbo-sheet .snap-setup-card:has-text("kromoss_8step_dmd2")'); await page.waitForTimeout(600);
  R.moss.turbo = await page.evaluate(() => ({ steps: window.__snap.engine.getValue("image", "image", "steps"), chip: document.querySelector('.snap-brick[data-brick="image_models"] .snap-turbo')?.textContent }));

  // ---- Save metadata: default on, right before Run; off marks every queue; remembered; the ui tool ----
  R.meta = { setting: await page.evaluate(() => app.extensionManager.setting.get("MAINodes.Snap.SaveMetadata")),
    beforeRun: await page.$eval(".snap-meta", (e) => e.nextElementSibling?.classList.contains("snap-run")), label: await page.textContent(".snap-meta"), checked: await page.getAttribute(".snap-meta", "aria-checked") };
  const n0 = bodies.length;
  await page.click(".snap-run"); await page.waitForTimeout(800);
  await page.click(".snap-meta"); await page.waitForTimeout(300);
  R.meta.off = { setting: await page.evaluate(() => app.extensionManager.setting.get("MAINodes.Snap.SaveMetadata")), checked: await page.getAttribute(".snap-meta", "aria-checked"), read: (await call("read_ui", {})).metadata };
  await page.screenshot({ path: path.join(out, "123-u58-metadata-off.png") });
  await page.click(".snap-run"); await page.waitForTimeout(800);
  await page.evaluate(() => window.__K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 8, height: 8, batch_size: 1, color: 0 } } }, { job: { kind: "check", title: "a test check", takes: false } }));
  await open(); // a reload keeps it off (the person's ComfyUI setting)
  R.meta.reloaded = { on: await page.evaluate(() => window.__MD.on()), checked: await page.getAttribute(".snap-meta", "aria-checked") };
  R.meta.tool = await call("ui", { action: "metadata", target: "on" });
  R.meta.bad = await call("ui", { action: "metadata", target: "maybe" });
  await page.evaluate(() => window.__snap.view.render(null));
  await page.evaluate(() => app.queuePrompt(0, 1)); await page.waitForTimeout(800);
  R.meta.flags = bodies.slice(n0).map(flag);
  R.meta.final = await page.evaluate(() => window.__MD.on());
  await page.screenshot({ path: path.join(out, "124-u58-metadata-on.png") });

  // ---- method entries: extend and region, readiness from installed node types ----
  R.methods = { enum: await page.evaluate(() => window.__tools.schema().find((t) => t.name === "list_methods").inputSchema.properties.slot.enum) };
  for (const slot of ["extend", "region"]) R.methods[slot] = (await call("list_methods", { slot })).methods?.map((m) => [m.id, m.wired, m.install_state]);
  // with the packs' node types registered (as on :8193), readiness moves on to the weights
  R.methods.installed = await page.evaluate(async () => {
    const fake = ["H3ClownContextExperimental", "H3ClownKeyframe", "H3ClownLateLock", "H3ClownContextNoise", "H3ClownProtectionLora", "H3ClownChain", "MVEx_MaskCleanup", "MVEx_SubjectCrop", "MVEx_MaskToLatentSpace", "MVEx_SubjectUncrop"].filter((t) => !LiteGraph.registered_node_types[t]);
    for (const t of fake) LiteGraph.registered_node_types[t] = class {};
    const S = await import("/extensions/ComfyUI-MAINodes/snap/slots.js"), r = ["extend", "region"].flatMap((s) => S.list(s).map((m) => [m.id, m.install_state]));
    for (const t of fake) delete LiteGraph.registered_node_types[t];
    return r;
  });
  await call("ui", { action: "snap" }); await page.waitForTimeout(800); // the reload opened on the graph
  await call("ui", { action: "methods", target: "extend" }); await page.waitForTimeout(500);
  R.methods.sheet = await page.$$eval(".snap-extend-sheet .snap-setup-card", (els) => els.map((e) => [e.querySelector("strong").textContent, e.disabled]));
  await page.screenshot({ path: path.join(out, "125-u58-extend-methods.png") });
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_u58_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e.message.split("\n")[0]); process.exit(1); });
