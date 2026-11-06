// U72 run 6b findings F23-F25, on the CPU test server (:8195). Every queued prompt is rewritten into a 64 px EmptyImage ->
// SaveImage prompt keeping its extra_data, plus (case A) a PrimitiveString holding the original Render prompt text, so the
// take is captured from /history with or without the Cast sentence in what ran.
// F23 apply_cast with a picture on a recipe whose Render Preset conditions on FL2V switches it to a Ref2V setup and says so;
//     describe_recipe flags references_unused when the preset is switched back to FL2V while References holds pictures;
// F24 set_setting on the Render prompt after apply_cast keeps the Cast sentence (re-added, said in kept_cast);
// F25 a take whose queued prompt lacks a pin's sentence records placed.missing, and its card says so; a take whose
//     prompt has it records none.
// usage: node test_f23_f26.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const LORA = "snaptest_cast_kon_identity.safetensors";
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await useShelf(page, { extra: { loras: [[LORA, 0.1]] } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let keepText = true;
  await page.route(/\/(api\/)?prompt$/, (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const body = JSON.parse(r.request().postData()), text = Object.values(body.prompt).flatMap((n) => Object.entries(n.inputs ?? {})).filter(([k, v]) => k === "prompt" && typeof v === "string").map(([, v]) => v)[0] ?? "";
    body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/u72f25" } },
      ...(keepText ? { 3: { class_type: "PrimitiveString", inputs: { value: text } } } : {}) };
    delete body.partial_execution_targets;
    return r.continue({ postData: JSON.stringify(body) });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["E", "engine"], ["M", "models"], ["T", "takes"]]) window[`__${k}`] = await at(m); });
  await ev(async () => { app.graph.clear(); app.graph.extra = {}; await window.__X.callTool("start_recipe", {}); await window.__M.load(); await window.__T.load(); });
  R.f23 = await ev(async (lora) => {
    const L = window.__L, X = window.__X, E = window.__E, cond = () => String(E.getValue("preset", "preset", "conditioning"));
    const before = cond();
    const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }); c.getContext("2d").fillStyle = "#3a6"; c.getContext("2d").fillRect(0, 0, 64, 64);
    const id = `cast-f23${Date.now().toString(36)}`, pic = await L.uploadCastPicture(new File([await new Promise((r) => c.toBlob(r, "image/png"))], "front.png", { type: "image/png" }), id);
    await L.saveCast(id, { name: "Ana", trigger: "ana", details: "a young woman with a black beret", lora: null, refs: [{ file: pic, role: "identity: front" }] });
    const applied = await X.callTool("apply_cast", { cast: `cast:${id}` });
    const after = cond(), d1 = await X.callTool("describe_recipe", {});
    const back = (window.__M.setups().find((s) => s.source === "preset" && String(s.values.conditioning).startsWith("FL2V")) ?? {}).name;
    if (back) window.__M.apply(back);
    const d2 = await X.callTool("describe_recipe", {});
    return { id, before, after, said: applied.done, unusedAfterApply: d1.references_unused ?? null, back, unusedAfterBack: d2.references_unused ?? null };
  }, LORA);
  // F24: the agent sets the prompt after apply_cast (put the Ref2V setup back first, as apply_cast left it)
  R.f24 = await ev(async (id) => {
    const X = window.__X, E = window.__E;
    await X.callTool("apply_cast", { cast: `cast:${id}` });
    const r = await X.callTool("set_setting", { brick: "render", name: "prompt", value: "integrated_multimodal_description: [Shot 1] She stands at a fountain and smiles.\noverall_soundscape: Water splashing.\nnon_diegetic_music: N/A" });
    return { kept: r.kept_cast ?? null, first: (E.getValue("render", "render", "prompt") ?? "").split("\n")[0] };
  }, R.f23.id);
  // F25: one take whose queued prompt holds the sentence (A), one whose doesn't (B)
  const runTake = async () => { const n = await ev(() => window.__T.all().length); await ev(() => app.queuePrompt(0, 1)); return ev(async (n) => { const T = window.__T; for (let i = 0; i < 160 && T.all().length <= n; i++) await new Promise((r) => setTimeout(r, 500)); const t = T.all().at(-1); return { id: t.id, world: t.world }; }, n); };
  keepText = true; R.takeA = await runTake();
  keepText = false; R.takeB = await runTake();
  await page.waitForTimeout(900);
  R.chips = await ev(([a, b2]) => [a, b2].map((id) => document.querySelector(`.snap-take[data-take="${id}"] .snap-take-unplaced`)?.textContent ?? null), [R.takeA.id, R.takeB.id]);
  await page.locator(".snap-takes").screenshot({ path: path.join(out, "340-u72-f25-pin-missing.png") }).catch(() => {});
  R.errors = errs;
  const ref = `cast:${R.f23.id}`;
  const c = {
    "F23 apply_cast with a picture on an FL2V recipe switches to a Ref2V setup and says so": R.f23.before.startsWith("FL2V") && R.f23.after.startsWith("Ref2V") && /Render Preset now/.test(R.f23.said ?? ""),
    "F23 describe_recipe flags References that this render doesn't read": R.f23.unusedAfterApply === null && /doesn't read them/.test(R.f23.unusedAfterBack ?? ""),
    "F24 set_setting on the prompt after apply_cast keeps the Cast sentence and says so": (R.f24.kept ?? []).some((x) => /Ana/.test(x)) && R.f24.first.includes("ana, a young woman with a black beret") && R.f24.first.includes("She stands at a fountain"),
    "F25 a take whose prompt held the sentence records nothing missing": !R.takeA.world?.[ref]?.placed?.missing,
    "F25 a take whose prompt lacked it records placed.missing, and its card says so": (R.takeB.world?.[ref]?.placed?.missing ?? []).length > 0 && /Ana v\d/.test(R.chips[1] ?? "") && R.chips[0] === null,
    "no page errors": !R.errors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_f23_f26_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`f23f26   ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
