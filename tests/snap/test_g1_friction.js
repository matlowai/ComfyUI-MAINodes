// G1 item 5 (short03 friction) and F-C26 on the CPU test server:
// - add_lora finds a LoRA put in models/loras after the page loaded (the folders are read again before a refusal);
// - a core LoRA on an H3 recipe goes on Style LoRAs after the preset's, with a note (was: refused);
// - set_method {turbo: off} on the Ref2V preset puts on "Reference pictures, no turbo (20 steps)" (F-C11; was: refused; SNAP-R149 renamed it);
// - set_setting length takes "124" as 124;
// - apply_setup "Pika H3 Flex" in a MOSS shot switches family into a new tab that becomes the shot (F-C18);
// - F-C26: with Upscale on past the GPU's memory (a 32 GiB card reported), the Upscale brick warns before the run; a run
//   whose Upscale failed gets its render kept: the same prompt queued again without the upscale node (its consumer fed
//   by the upscale's own input), as a child of the failed take.
// Placeholders are parked afterwards (moved, never deleted). usage: node test_g1_friction.js [port 8195]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
const base = CFG.base;
const LATE = path.join(base, "models", "loras", "g1_late_task_lora.safetensors");
(async () => {
  const made = [];
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    // a 32 GiB CUDA card, as the GPU box reports it (the CPU server has none)
    await ctx.route(/\/(api\/)?system_stats$/, async (r) => { const res = await r.fetch(), x = await res.json(); x.devices = [{ name: "cuda:0", type: "cuda", index: 0, vram_total: 32 * 2 ** 30, vram_free: 30 * 2 ** 30 }, ...(x.devices ?? [])]; r.fulfill({ response: res, json: x }); });
    const A = await F.open(b, port, { context: ctx }), page = A.page;
    const prompts = [];
    await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") prompts.push(JSON.parse(r.request().postData())); r.fallback(); });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    // a LoRA that arrives after the page loaded
    if (!fs.existsSync(LATE)) { fs.writeFileSync(LATE, ""); made.push(LATE); }
    R.late = await call("add_lora", { file: "g1_late_task_lora.safetensors", role: "style" });
    await call("remove_lora", { brick: "style", row: 0 });
    // a core LoRA (a task LoRA such as ORB360) on H3
    R.core = await call("add_lora", { file: "g1_late_task_lora.safetensors", role: "core" });
    // F-C11: turbo off on the Ref2V preset
    R.ref2v = await call("apply_setup", { name: "Pika + reference pictures" });
    R.off = await call("set_method", { slot: "turbo", method: "off" });
    R.offValues = await page.evaluate(() => ["steps", "cfg", "sampler", "schedule", "lora_strength", "conditioning"].map((k) => window.__E.getValue("preset", "preset", k)));
    // length as text
    R.len = await call("set_setting", { brick: "render", name: "length", value: "124" });
    // F-C26: the Upscale brick past the card's memory
    await call("set_setting", { brick: "render", name: "width", value: 2048 }); await call("set_setting", { brick: "render", name: "height", value: 1024 });
    await page.evaluate(async () => { const S = await import("/extensions/ComfyUI-MAINodes/snap/slots.js"); await S.load(); const E = window.__E; if (E.state().bricks.some((b) => b.key === "upscale")) S.setOn("upscale", true); });
    await page.waitForTimeout(300);
    R.recipe = await call("describe_recipe", {});
    R.warn = (R.recipe?.models?.warnings ?? []).find((w) => /GiB/.test(w)) ?? JSON.stringify(R.recipe?.models?.warnings);
    // the rescue: a failed take whose failed node is the Upscale brick's
    R.rescue = await page.evaluate(async () => {
      const E = window.__E, T = window.__T, UP = await import("/extensions/ComfyUI-MAINodes/snap/upscale.js");
      const up = E.state().bricks.find((b) => b.key === "upscale"), prompt = (await app.graphToPrompt()).output, nid = String(Object.values(up.nodes).find((id) => prompt[String(id)]?.class_type === "RelayVSRUpscaleVideo"));
      const into = Object.entries(prompt).filter(([, n]) => Object.values(n.inputs ?? {}).some((v) => Array.isArray(v) && String(v[0]) === nid)).map(([k]) => k);
      const t = { id: "take-g1-failed", kind: "run", prompt_id: "g1-failed", created: Date.now(), group: app.graph.id, number: 970, status: "error", text: "g1 upscale failure", seed: 1, seconds: 60, error: "RelayVSRUpscaleVideo: CUDA out of memory", failed_node: nid, media: [], prompt, graph: app.graph.serialize(), world: {}, verdict: null, notes: [] };
      await T.save(t);
      const id = await UP.rescue(t);
      return { nid, into, source: prompt[nid].inputs.video, id };
    });
    for (let i = 0; i < 40 && !prompts.some((x) => x.extra_data?.snap_parent?.method === "rescue/upscale"); i++) await page.waitForTimeout(100);
    const rq = prompts.find((x) => x.extra_data?.snap_parent?.method === "rescue/upscale");
    R.rescueGraph = rq && { upscale: !!rq.prompt[R.rescue.nid], fed: R.rescue.into.map((k) => Object.values(rq.prompt[k]?.inputs ?? {}).filter((v) => Array.isArray(v)).map((v) => v.join(":"))), parent: rq.extra_data.snap_parent, title: rq.extra_data.snap_job?.title };
    R.landed = await page.evaluate(async (id) => { for (let i = 0; i < 120; i++) { const t = window.__T.all().find((x) => x.prompt_id === id); if (t) return { parent: t.parent, status: t.status }; await new Promise((r) => setTimeout(r, 500)); } return null; }, R.rescue.id);
    // F-C18: a MOSS shot switched to an H3 preset by name
    const sc = await call("create_scene", { name: "G1 family switch" }), sid = sc.scene ?? sc.id;
    const shot = await call("add_shot", { scene: sid, name: "walk" }), shid = shot.shot?.id ?? shot.id;
    await call("open_shot", { scene: sid, shot: shid }); await page.waitForTimeout(2000);
    const moss = (await call("list_setups", {})).find((x) => x.source === "recipe" && x.family !== "MiniMax H3");
    R.moss = moss && await call("apply_setup", { name: moss.name }); await page.waitForTimeout(1500);
    R.mossHere = await page.evaluate(() => app.graph.extra?.snap_scene);
    R.switch = await call("apply_setup", { name: "Pika H3 Flex" }); await page.waitForTimeout(1500);
    R.after = await page.evaluate(async () => { const M = await import("/extensions/ComfyUI-MAINodes/snap/models.js"); return { mark: app.graph.extra?.snap_scene, family: M.family(), current: M.setups().find((x) => x.current)?.name }; });
    R.ids = { sid, shid };
    R.errors = [...A.errors];
  } finally {
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `g1friction-${Date.now()}`);
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
  const checks = {
    "add_lora finds a LoRA put there after the page loaded": R.late?.brick === "style" && R.late.rows?.some((r) => /g1_late_task_lora/.test(r.file)),
    "a core LoRA on H3 goes on Style LoRAs, saying why": R.core?.brick === "style" && /core LoRA; this recipe's core LoRA rides on its Render Preset/.test(R.core.note ?? ""),
    "turbo off on Ref2V: the no-turbo preset, 20 steps cfg 5, LoRA at 0": !R.off?.error && R.off?.setup === "Reference pictures, no turbo (20 steps)" && JSON.stringify(R.offValues?.slice(0, 5)) === JSON.stringify([20, 5, "euler", "simple", 0]) && /^Ref2V/.test(R.offValues[5]),
    "set_setting length takes \"124\"": R.len?.value === 124,
    "the Upscale brick warns past the GPU's memory, before the run": /RelayVSR at 4096×2048 needs about \d+ GiB/.test(R.warn ?? "") && /this GPU has 32 GiB/.test(R.warn ?? ""),
    "a failed Upscale: the render is queued again without it, as the failed take's child": R.rescueGraph && !R.rescueGraph.upscale && R.rescueGraph.fed.flat().includes(R.rescue.source.join(":")) && R.rescueGraph.parent?.take === "take-g1-failed" && /Keep the render of take 970: the Upscale failed/.test(R.rescueGraph.title ?? ""),
    "the kept render lands as a take": R.landed?.parent?.method === "rescue/upscale" && R.landed.status === "success",
    "apply_setup Pika H3 Flex in a MOSS shot: H3 in a new tab that is the shot": !!R.moss && !R.moss.error && R.mossHere?.shot === R.ids.shid && !R.switch?.error && R.after?.family === "MiniMax H3" && R.after.current === "Pika H3 Flex" && R.after.mark?.shot === R.ids.shid && /this tab is that shot now/.test(R.switch?.shot ?? ""), // G2 F-D05 worded it "still Shot n of <scene>: this tab is that shot now"
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, (k, v) => (k === "recipe" ? undefined : v), 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g1friction ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
