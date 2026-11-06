// U89 step 5 (SNAP-R63 + R39/R38): ratings, saved files without a recipe, rerun {file}; CPU test server, queued prompts
// rewritten as test_retake.js does. Take A (scene shot) pins Kon v1; Vex is a Cast record the person rated Adult.
// - the rerun plan for Kon → Vex says the run would be Adult and why ("Adult: Vex's rating");
// - the re-run take is rated Adult at capture, "Vex is rated Adult" among its reasons;
// - a picture named like take A's file but holding no recipe (metadata off), opened in Snap, opens take A's Re-run
//   sheet and says it carries no recipe; a picture that isn't a take says so;
// - rerun {file: "output/<subfolder>/<name>"} plans on take A; an unknown file is refused saying how files are matched.
// usage: node test_rerun_rating.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const KON = "snaptest_cast_kon_identity.safetensors";
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await useShelf(page, { extra: { loras: [[KON, 0.1]] } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/(api\/)?prompt$/, (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const body = JSON.parse(r.request().postData());
    body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/u89rating" } } };
    delete body.partial_execution_targets;
    return r.continue({ postData: JSON.stringify(body) });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["M", "models"], ["T", "takes"], ["SC", "scenes"], ["RR", "rerun"]]) window[`__${k}`] = await at(m); });
  const waitTake = (n) => ev(async (n) => { const T = window.__T; for (let i = 0; i < 160 && T.all().length < n; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, 400)); return T.all().at(-1)?.id ?? null; }, n);
  R.a = await ev(async (kon) => {
    const L = window.__L, T = window.__T, SC = window.__SC;
    await T.load(); await SC.load(); await window.__M.load();
    const scene = await SC.create({ name: "Rerun rating test" }); await SC.addShot(scene.id, { name: "Kon walks" });
    await SC.openShot(scene.id, SC.get(scene.id).shots[0].id);
    const s = Date.now().toString(36), k = `cast-konrr8${s}`, v = `cast-vexrr8${s}`;
    await L.saveCast(k, { name: "Kon", details: "a fennec-eared courier girl", lora: { file: kon, strength: 0.8 }, refs: [] });
    await L.saveCast(v, { name: "Vex", details: "a woman in a long black coat", lora: null, refs: [], rating: "adult" });
    await L.applyCast(`cast:${k}`);
    return { kon: k, vex: v, takes: T.all().length };
  }, KON);
  const kon = `cast:${R.a.kon}`, vex = `cast:${R.a.vex}`;
  await ev(() => app.queuePrompt(0, 1));
  R.a.take = await waitTake(R.a.takes + 1);
  R.a.media = await ev((id) => window.__T.get(id).media[0], R.a.take);
  R.plan = (await ev(async ([take, kon, vex]) => window.__X.callTool("rerun", { take, swaps: { [kon]: { to: vex } } }), [R.a.take, kon, vex])).plan?.rating ?? null;
  const n = await ev(() => window.__T.all().length);
  await ev(async ([take, kon, vex]) => window.__RR.rerun(window.__T.get(take), { swaps: { [kon]: { to: vex } } }), [R.a.take, kon, vex]);
  R.b = await waitTake(n + 1);
  R.bRating = await ev((id) => { const t = window.__T.get(id); return { rating: window.__T.ratingOf(t), why: t.rating_why }; }, R.b);
  // a picture with no recipe, named like take A's file
  await page.keyboard.press("Escape");
  const blank = (name) => { const f = path.join(CFG.out, "_debug", name); require("child_process").execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x335577:s=64x64", "-frames:v", "1", f]); return f; };
  const said = () => ev(() => document.querySelector(".snap-toast")?.textContent ?? "");
  fs.mkdirSync(path.join(CFG.out, "_debug", "u89file"), { recursive: true });
  await page.locator(".snap-root input[type=file][hidden]").setInputFiles(blank(path.join("u89file", R.a.media.filename)));
  await page.waitForTimeout(3500);
  R.noRecipe = { sheet: await ev(() => document.querySelector(".snap-rerun-sheet header strong")?.textContent ?? null), said: await said() };
  await page.keyboard.press("Escape");
  await page.locator(".snap-root input[type=file][hidden]").setInputFiles(blank("u89file/not_a_take_123.png"));
  await page.waitForTimeout(3500);
  R.notTake = await said();
  R.fileTool = await ev(async ([sub, name]) => window.__X.callTool("rerun", { file: `output/${sub}/${name}` }).catch((e) => ({ error: e.message })), [R.a.media.subfolder, R.a.media.filename]);
  R.badFile = await ev(async () => window.__X.callTool("rerun", { file: "output/nowhere/x.png" }).catch((e) => ({ error: e.message })));
  R.errors = errs;
  const c = {
    "the plan says Adult because of Vex's rating": R.plan?.would_be === "adult" && R.plan.why.includes("Adult: Vex's rating"),
    "the re-run take is rated Adult at capture, naming Vex": R.bRating.rating === "adult" && (R.bRating.why ?? []).some((w) => /Vex is rated Adult/.test(w)),
    "a recipe-less file named like take A's opens take A's Re-run sheet and says so": R.noRecipe.sheet === "Re-run take 1 with swaps" && /carries no recipe .*it is take 1 here/.test(R.noRecipe.said),
    "a recipe-less file that isn't a take says so": /isn't a take here/.test(R.notTake),
    "rerun {file} plans on take A": !!R.fileTool.proposed && /take 1's recipe again/.test(R.fileTool.plan?.runs ?? ""),
    "an unknown file is refused saying how files are matched": /isn't a take's file here \(takes are matched by output\/<subfolder>\/<name>\)/.test(R.badFile.error ?? ""),
    "no page errors": !R.errors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_rerun_rating_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`rrrating ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
