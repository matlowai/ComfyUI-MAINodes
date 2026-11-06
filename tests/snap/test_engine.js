// Snap engine check on a CPU ComfyUI whose MAINodes is the snap-scout worktree. Never queues anything.
// NODE_PATH=<playwright's node_modules> node test_engine.js [url] [example_api.json] [outdir]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), os = require("os"), path = require("path");

const url = process.argv[2] || `http://127.0.0.1:${CFG.port}/`;
const examplePath = process.argv[3] || path.join(CFG.pack, "examples", "dials", "dials_simple_pika_derope_api.json");
const out = process.argv[4] || CFG.out;

async function pageTest(example) {
  const E = await import("/extensions/ComfyUI-MAINodes/snap/engine.js");
  const { SIMPLE_RECIPE } = await import("/extensions/ComfyUI-MAINodes/snap/bricks.js");
  const app = window.app, r = { steps: [] };
  const tracker = () => app.extensionManager.workflow.activeWorkflow.changeTracker;
  app.canvas.emitBeforeChange(); app.graph.clear(); app.graph.extra = {}; app.canvas.emitAfterChange();

  const t0 = performance.now();
  for (const key of SIMPLE_RECIPE) {
    const res = await E.snap(key);
    r.steps.push({ key, bindings: res.bindings.map((b) => `${b.role}<-${b.from ?? "value"}:${b.rule}`) });
  }
  r.buildMs = Math.round(performance.now() - t0);
  r.undoDepthAfterBuild = tracker().undoQueue.length;

  // the prompt must match the shipped example node for node (by class_type multiset, inner and outer)
  const { output } = await app.graphToPrompt();
  const count = (o) => Object.values(o).reduce((m, v) => (m[v.class_type] = (m[v.class_type] || 0) + 1, m), {});
  const got = count(output), want = count(example);
  r.classDiff = [...new Set([...Object.keys(got), ...Object.keys(want)])].filter((k) => got[k] !== want[k]).map((k) => `${k}: got ${got[k] ?? 0} want ${want[k] ?? 0}`);
  // links: for each node input that is a link, compare (class_type, input) -> source class_type
  const edges = (o) => Object.values(o).flatMap((v) => Object.entries(v.inputs).filter(([, x]) => Array.isArray(x) && x.length === 2 && typeof x[0] === "string").map(([k, x]) => `${v.class_type}.${k}<-${o[x[0]]?.class_type}[${x[1]}]`)).sort();
  const ge = edges(output), we = edges(example);
  r.edgesOnlyOurs = ge.filter((e) => !we.includes(e));
  r.edgesOnlyExample = we.filter((e) => !ge.includes(e));
  // U20: the Render gives VIDEO; Upscale (RelayVSR) and Save are bricks after it, so the prompt's outer nodes chain them
  const of = (type) => Object.keys(output).find((k) => output[k].class_type === type);
  r.chain = { saveFrom: output[output[of("SaveVideo")]?.inputs.video?.[0]]?.class_type, upscaleFrom: String(output[of("RelayVSRUpscaleVideo")]?.inputs.video?.[0]).split(":").length, outerSave: !of("SaveVideo")?.includes(":") };
  r.describe = E.describe();

  // undo the last snap (Save), then redo
  await tracker().undo();
  r.afterUndoBricks = E.state().bricks.map((b) => b.key);
  await tracker().redo();
  r.afterRedoBricks = E.state().bricks.map((b) => b.key);

  // a "user" rewire: feed Render's model straight from the preset, skipping the rack -> one override
  const preset = E.nodeFor("preset", "preset"), render = E.nodeFor("render", "render");
  app.canvas.emitBeforeChange(); preset.connect(preset.findOutputSlot("MODEL"), render, render.findInputSlot("model")); app.canvas.emitAfterChange();
  r.overrides = E.overrides().map((o) => `${o.to}.${o.role}: ${o.change}`);
  await tracker().undo();
  r.overridesAfterUndo = E.overrides().length;

  // unsnap References then snap it again: binding comes back
  E.unsnap("refs");
  r.refsLinkedAfterUnsnap = E.nodeFor("render", "render").inputs.find((i) => i.name === "refs").link;
  await E.snap("refs");
  r.refsLinkedAfterResnap = E.nodeFor("render", "render").inputs.find((i) => i.name === "refs").link != null;
  r.extraSnap = JSON.parse(JSON.stringify(app.graph.serialize().extra.snap)).bindings.length;

  // review regressions (2026-11-03 04:00)
  const rv = (r.review = {});
  app.canvas.emitBeforeChange(); app.graph.clear(); app.graph.extra = {}; app.canvas.emitAfterChange();
  app.canvas.emitBeforeChange(); app.graph.add(LiteGraph.createNode("VAELoader")); app.canvas.emitAfterChange();
  await new Promise((done) => setTimeout(done, 300));
  rv.untouchedWorkflow = app.graph.extra?.snap === undefined && app.graph.serialize().extra?.snap === undefined;
  app.graph.clear(); app.graph.extra = {};
  await Promise.all([E.snap("render"), E.snap("render")]); // a double click
  rv.oneRender = E.state().bricks.filter((b) => b.key === "render").length === 1 && app.graph._nodes.filter((n) => n.isSubgraphNode?.()).length === 1;
  for (const k of ["models", "preset"]) await E.snap(k);
  const pre = E.nodeFor("preset", "preset"), ren = E.nodeFor("render", "render");
  app.canvas.emitBeforeChange(); pre.connect(pre.findOutputSlot("MODEL"), ren, ren.findInputSlot("model")); app.canvas.emitAfterChange();
  const vvae = E.nodeFor("models", "video_vae"), audio = E.nodeFor("models", "audio_vae");
  app.canvas.emitBeforeChange(); audio.connect(0, ren, ren.findInputSlot("vae")); app.canvas.emitAfterChange(); // rewire video_vae to the audio VAE
  await E.snap("rack");
  const vaeLink = app.graph.getLink(ren.inputs[ren.findInputSlot("vae")].link);
  rv.rewireKept = String(vaeLink?.origin_id) === String(audio.id);
  app.canvas.emitBeforeChange(); app.graph.remove(vvae); app.canvas.emitAfterChange(); // user deletes a provider node
  try { await E.snap("first_frame"); rv.deletedProviderOk = true; } catch (e) { rv.deletedProviderOk = e.message; }
  await E.snap("upscale"); await E.snap("save_video");
  const from = () => { const s = E.nodeFor("save_video", "save"); return app.graph.getNodeById(app.graph.getLink(s.inputs[s.findInputSlot("video")].link)?.origin_id)?.type; };
  rv.saveFromUpscale = from() === "RelayVSRUpscaleVideo";
  E.unsnap("upscale");
  rv.saveRebindsToRender = from() === E.nodeFor("render", "render").type;
  return r;
}

(async () => {
  const example = JSON.parse(fs.readFileSync(examplePath, "utf8"));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-snap-"));
  const ctx = await chromium.launchPersistentContext(dir, { executablePath: CFG.chrome, headless: true, viewport: { width: 1700, height: 1000 } });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { globalThis.__queued = (globalThis.__queued || 0) + 1; return r.abort(); } return r.continue(); }); // tests never queue
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|ERR_FAILED/.test(m.text())) console.log("[console.error]", m.text().slice(0, 300)); });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.app?.graph && window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(pageTest, example);
  fs.writeFileSync(path.join(out, "test_engine_result.json"), JSON.stringify(r, null, 1));
  console.log(JSON.stringify({ ...r, describe: undefined }, null, 1));
  await page.evaluate(() => { const c = window.app.canvas, ns = window.app.graph._nodes; let a = 1e9, b = 1e9, cc = -1e9, d = -1e9; for (const n of ns) { a = Math.min(a, n.pos[0]); b = Math.min(b, n.pos[1] - 40); cc = Math.max(cc, n.pos[0] + n.size[0]); d = Math.max(d, n.pos[1] + n.size[1]); } c.ds.fitToBounds([a, b, cc - a, d - b]); c.setDirty(true, true); });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, "engine_graph.png") });
  await ctx.close();
})().catch((e) => { console.error(e); process.exit(1); });
