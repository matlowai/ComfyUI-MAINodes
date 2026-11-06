// U84 (SNAP-R26, SNAP-R55) on the CPU test server: a LoRA's kind comes from an agent reading the file, not its name.
// Three test LoRAs are written into the test server's own models/loras and parked after (snaptest_u84_*: a watercolor style LoRA with kohya ss_*
// metadata, a "dmd2" name with no step count, a "4step" name). describe_lora gives the file's own metadata (training
// fields, trained tags, trigger words, modelspec, the rank its tensors have); the dmd2 name stays unsorted, 4step is a
// turbo; set_lora_category {by: agent, reason} files it and keeps who and why; the LoRA sheet shows the agent's reason
// on the row; the person's move to… makes it theirs, and then an agent's filing is refused naming theirs; a proposal
// keeps the reason; an unknown role is refused naming the roles. The test files' own entries are cleared before and
// after. Never queues.
// Screenshot: ui/281-u84-agent-filed-lora.png. usage: node test_u84_loras.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const STYLE = "snaptest_u84_style.safetensors", DMD = "snaptest_u84_dmd2_lora.safetensors", STEP = "snaptest_u84_4step_lora.safetensors";
// a tiny kohya-style LoRA: one down / up pair (rank 16) in bf16 zeros, with the metadata given
function lora(file, metadata) {
  const header = { __metadata__: metadata, "lora_unet_down_blocks_0_attn.lora_down.weight": { dtype: "BF16", shape: [16, 64], data_offsets: [0, 2048] },
    "lora_unet_down_blocks_0_attn.lora_up.weight": { dtype: "BF16", shape: [64, 16], data_offsets: [2048, 4096] } };
  const json = Buffer.from(JSON.stringify(header)), n = Buffer.alloc(8);
  n.writeBigUInt64LE(BigInt(json.length));
  fs.writeFileSync(file, Buffer.concat([n, json, Buffer.alloc(4096)]));
}
(async () => {
  // the test server's own models/loras (not its dials folder, which links to a real library); parked again at the end
  const argv = (await (await fetch(`http://127.0.0.1:${port}/system_stats`)).json()).system.argv, base = argv[argv.indexOf("--base-directory") + 1], loras = path.join(base, "models", "loras");
  lora(path.join(loras, STYLE), { ss_base_model_version: "flux1", ss_network_dim: "16", ss_network_alpha: "8", ss_output_name: "wtrclr_style", ss_max_train_steps: "2400",
    ss_tag_frequency: JSON.stringify({ img: { watercolor: 40, painting: 22, "soft edges": 9 } }), "modelspec.title": "Watercolor style", "modelspec.trigger_phrase": "wtrclr" });
  lora(path.join(loras, DMD), { ss_output_name: "x" });
  lora(path.join(loras, STEP), {});
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
  await page.evaluate(async () => { app.graph.clear(); app.graph.extra = {}; window.__X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); window.__M = await import("/extensions/ComfyUI-MAINodes/snap/models.js");
    window.__P = await import("/extensions/ComfyUI-MAINodes/snap/proposals.js"); await window.__M.load(); await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); });
  const call = (name, args) => page.evaluate(([n, a]) => window.__X.checkArgs(n, a) ?? window.__X.callTool(n, a).then((v) => v, (e) => ({ error: e.message })), [name, args]).catch((e) => ({ error: e.message }));
  const clear = () => page.evaluate(async (l) => { for (const file of l) await __M.restore({ file, before: null }); }, [STYLE, DMD, STEP]); // no own entry for the test files
  await clear();
  try {
    R.described = await call("describe_lora", { file: STYLE });
    R.cats = await page.evaluate((l) => Object.fromEntries(l.map((f) => [f, __M.categoryOf(__M.entry(f))])), [DMD, STEP]);
    R.agentFiled = await call("set_lora_category", { file: STYLE, role: "style", by: "agent", reason: "trained on watercolor and painting tags, modelspec says Watercolor style" });
    R.again = await call("describe_lora", { file: STYLE });
    await call("ui", { action: "loras" }); await page.waitForTimeout(600);
    await page.fill(".snap-lora-sheet .snap-lib-q", "snaptest_u84"); await page.waitForTimeout(400);
    R.row = await page.evaluate((f) => document.querySelector(`.snap-lora-sheet .snap-lora-row[data-file="${f}"] .snap-lora-filed`)?.textContent ?? null, STYLE);
    await page.screenshot({ path: path.join(out, "281-u84-agent-filed-lora.png") });
    // the person re-files it from move to… in the sheet
    await page.selectOption(`.snap-lora-sheet .snap-lora-row[data-file="${STYLE}"] select.snap-move`, "core·fix"); await page.waitForTimeout(600);
    R.personFiled = await page.evaluate((f) => __M.entry(f).filed ?? null, STYLE);
    R.rowAfter = await page.evaluate((f) => document.querySelector(`.snap-lora-sheet .snap-lora-row[data-file="${f}"] .snap-lora-filed`)?.textContent ?? null, STYLE);
    R.agentOverPerson = await call("set_lora_category", { file: STYLE, role: "style", reason: "I think it's a style" });
    R.stillPerson = await page.evaluate((f) => __M.categoryOf(__M.entry(f)), STYLE);
    R.asPerson = await call("set_lora_category", { file: STYLE, role: "style", by: "person", reason: "the person said style" });
    R.proposed = await call("set_lora_category", { file: DMD, role: "core·turbo", reason: "ss_ fields name a dmd2 distillation", propose: true });
    R.proposal = await page.evaluate((id) => { const p = window.__P.all().find((x) => x.id === id); return p && { args: p.args, reason: p.reason }; }, R.proposed.proposed);
    if (R.proposed.proposed) await page.evaluate((id) => window.__P.decide(id, false), R.proposed.proposed).catch(() => {});
    R.badRole = await call("set_lora_category", { file: DMD, role: "styles" });
  } finally {
    await clear().catch(() => {});
    await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false));
  }
  R.restored = await page.evaluate((f) => __M.entry(f).filed ?? null, STYLE);
  R.errors = errs;
  const parked = path.join(base, "_parked_u84", String(Date.now()));
  fs.mkdirSync(parked, { recursive: true });
  for (const f of [STYLE, DMD, STEP]) fs.renameSync(path.join(loras, f), path.join(parked, f));
  fs.writeFileSync(path.join(out, "test_u84_loras_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
