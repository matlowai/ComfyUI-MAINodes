// G1b item 3 (SNAP-R113) on the CPU test server: stage 2's speed choice on the H3 Ref2VA orbit take (the real executed
// prompt of orbit 3502, fixtures/u102b_orbit_prompt.json, as test_u102b.js uses it).
// - list_methods {slot: upscale}: stage2's options.speed names quality (default, the take's own cfg) and fast (cfg 1),
//   each with its label and why;
// - upscale_take with no speed: both guiders keep their link to the Render Preset's cfg, the options carry no speed;
//   speed fast: both guiders at cfg 1 (as the A/B set the preset), options {speed: fast, cfg: 1}, the job title says
//   "fast (cfg 1)", the plan's estimate is the quality one divided by 1.73; a bad speed and a speed on tessera are refused
//   with the choices named;
// - the take viewer's Make it bigger has a Speed row (quality picked), choosing fast shortens the button's minutes, the
//   row hides for tessera; no stray null. Screens: ui/g1b/fast_speed_row.png, fast_speed_open.png.
// Model files are empty placeholders (parked afterwards). usage: node test_g1b_fast.js [port 8195] [base dir]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g1b");
const base = process.argv[3] || CFG.base;
const FILES = ["diffusion_models/h3/minimax_h3_ref2va_pruned_int8_convrot.safetensors", "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "vae/minimax_h3_video_vae_fp16.safetensors", "vae/minimax_h3_audio_vae_fp32.safetensors",
  "loras/h3/pika_h3_flex_ref2va_comfy_bf16.safetensors", "loras/h3/minimax_h3_lms_v1.0_r64.safetensors", "checkpoints/sam3.1_multiplex_fp16.safetensors"];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const orbit = JSON.parse(fs.readFileSync(CFG.fixture("u102b_orbit_prompt.json"), "utf8"));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const prompts = [];
    await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") prompts.push(JSON.parse(r.request().postData())); r.fallback(); });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    await page.evaluate(async (prompt) => {
      const T = window.__T, group = app.graph.id;
      await T.save({ id: "take-g1b-orbit", kind: "run", prompt_id: "g1b-orbit", created: Date.now(), seconds: 349, group, number: 911, status: "success", text: "orbit", seed: 3502,
        media: [{ kind: "video", filename: "orb3502.mp4", subfolder: "snaptest", type: "output" }], prompt, graph: { extra: { snap: { world: {} } } }, world: {}, verdict: null, notes: [] });
    }, orbit);
    R.speed = (await call("list_methods", { slot: "upscale" }))?.methods?.find((m) => m.id === "stage2")?.options?.speed;
    const graphOf = async (args) => {
      const n = prompts.length, r = await call("upscale_take", args);
      for (let i = 0; i < 40 && !prompts.slice(n).some((x) => x.extra_data?.snap_parent?.method === `upscale/${args.method}`); i++) await page.waitForTimeout(50);
      const mine = prompts.slice(n).find((x) => x.extra_data?.snap_parent?.method === `upscale/${args.method}`);
      return { r, cfg: mine && ["191:112", "191:131"].map((k) => mine.prompt[k]?.inputs?.cfg), options: mine?.extra_data?.snap_parent?.options, title: mine?.extra_data?.snap_job?.title };
    };
    R.quality = await graphOf({ take: "take-g1b-orbit", method: "stage2", factor: 2, denoise: 0.3 });
    R.fast = await graphOf({ take: "take-g1b-orbit", method: "stage2", factor: 2, denoise: 0.3, speed: "fast" });
    R.plan = await page.evaluate(async () => { const t = window.__X.TOOLS.find((x) => x.name === "upscale_take"); return [await t.plan({ take: "take-g1b-orbit", method: "stage2" }), await t.plan({ take: "take-g1b-orbit", method: "stage2", speed: "fast" })]; });
    R.bad = await call("upscale_take", { take: "take-g1b-orbit", method: "stage2", speed: "turbo" });
    R.tessera = await call("upscale_take", { take: "take-g1b-orbit", method: "tessera", speed: "fast" });
    // the take viewer
    await page.evaluate(() => document.querySelector(".snap-takes")?.scrollIntoView());
    await page.click(`.snap-take[data-take="take-g1b-orbit"]`); await page.waitForTimeout(1500);
    const row = () => page.evaluate(() => {
      const sel = document.querySelector('.snap-take-sheet select[aria-label="speed"]'), btn = [...document.querySelectorAll(".snap-take-sheet button.snap-primary")].find((x) => /^(Upscale|Redraw) to /.test(x.textContent));
      return sel && { value: sel.value, options: [...sel.options].map((o) => [o.value, o.textContent]), hidden: sel.closest("label").hidden, title: sel.closest("label").title, btn: btn?.textContent, text: sel.closest(".snap-take-sheet").textContent };
    });
    R.rowBefore = await row();
    await page.evaluate(() => document.querySelector('.snap-take-sheet select[aria-label="speed"]')?.closest("label").scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, "fast_speed_row.png") });
    await page.selectOption('.snap-take-sheet select[aria-label="speed"]', "fast"); await page.waitForTimeout(300);
    R.rowFast = await row();
    await page.screenshot({ path: path.join(out, "fast_speed_open.png") });
    await page.selectOption('.snap-take-sheet select[aria-label="how to make it bigger"]', "tessera"); await page.waitForTimeout(300);
    R.rowTessera = await row();
    const min = (t) => Number(/about (\d+) min/.exec(t ?? "")?.[1]);
    const checks = {
      "stage2 lists quality (default) and fast (cfg 1), each with a label and why": R.speed?.default === "quality" && R.speed.choices?.quality?.cfg === null && R.speed.choices?.fast?.cfg === 1 && /1\.7x faster/.test(R.speed.choices.fast.label) && /softer/.test(R.speed.choices.fast.label) && !!R.speed.choices.fast.why,
      "no speed: both guiders keep the Render Preset's cfg, no speed in the options": JSON.stringify(R.quality?.cfg) === JSON.stringify([["4", 5], ["4", 5]]) && !("speed" in (R.quality?.options ?? {})) && !/fast/.test(R.quality?.title ?? "fast"),
      "fast: both guiders at cfg 1, options and job title say so": JSON.stringify(R.fast?.cfg) === JSON.stringify([1, 1]) && R.fast.options?.speed === "fast" && R.fast.options.cfg === 1 && /fast \(cfg 1\)/.test(R.fast.title ?? ""),
      "fast's estimate is quality's divided by 1.73, the plan says fast": R.plan?.[0]?.eta_s > 0 && Math.abs(R.plan[1].eta_s - R.plan[0].eta_s / 1.73) <= 1 && /fast \(cfg 1\)/.test(R.plan[1].runs) && !/fast/.test(R.plan[0].runs),
      "a bad speed names the choices; a speed on tessera is refused": /speed is one of "quality", "fast"/.test(R.bad?.error ?? "") && /no speed choice/.test(R.tessera?.error ?? ""),
      "the take viewer's Speed row starts on quality with both choices": R.rowBefore?.value === "quality" && JSON.stringify(R.rowBefore.options.map(([k]) => k)) === JSON.stringify(["quality", "fast"]) && !R.rowBefore.hidden,
      "choosing fast shortens the button's minutes and says why": min(R.rowFast?.btn) > 0 && min(R.rowFast.btn) < min(R.rowBefore?.btn) && /10\.4 min/.test(R.rowFast.title),
      "the row hides for tessera": R.rowTessera?.hidden === true,
      "no stray null": !/\bnull\b|undefined|\[object/.test(R.rowFast?.text ?? "null"),
      "no page errors": !A.errors.length,
    };
    console.log(JSON.stringify(R, (k, v) => (k === "text" ? undefined : v), 1));
    let bad = 0;
    for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
    console.log(`g1bfast ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  } finally {
    await b.close();
    const park = path.join(base, "_parked_placeholders", `g1b_fast_${Date.now()}`);
    for (const f of made) { fs.mkdirSync(path.join(park, path.dirname(path.relative(path.join(base, "models"), f))), { recursive: true }); fs.renameSync(f, path.join(park, path.relative(path.join(base, "models"), f))); }
  }
})().catch((e) => { console.error(e); process.exit(1); });
