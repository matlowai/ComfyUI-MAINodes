// U87 step 4, re-take, on the CPU test server (:8195). The H3 recipe can't render on a CPU, so every queued prompt is
// rewritten on its way to the server into a 64 px EmptyImage -> SaveImage prompt, keeping its extra_data (the workflow
// with its pins and the retake mark): the takes are captured from /history as real ones are. Checks:
// - take A runs with Kon v1 in a scene shot; Kon v2 is saved (new strength);
// - re-take as it was: the chain's revision equals A's (recipe hash and seed), the pin stays v1, the new take's parent is
//   {take: A, method: "retake", options.world: "pinned"} and get_scene nests it under A as "Retake · as it was";
// - re-take with today's world: the pin is v2, the only change from A's recipe is the Cast row's strength, the take nests
//   as "Retake · today's world";
// - the take viewer offers both buttons, naming "Kon v1 → v2"; the retake tool plans the update and is a proposal
//   unless agents may run; seed "new" draws another seed. Screen 326 (the viewer's re-take row).
// usage: node test_retake.js [port 8195]
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
  const queued = [];
  await page.route(/\/(api\/)?prompt$/, (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const body = JSON.parse(r.request().postData());
    queued.push({ workflow: body.extra_data?.extra_pnginfo?.workflow ?? null, prompt: body.prompt });
    body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/u87retake" } } };
    delete body.partial_execution_targets;
    return r.continue({ postData: JSON.stringify(body) });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["E", "engine"], ["M", "models"], ["W", "world"], ["T", "takes"], ["SC", "scenes"], ["RT", "retake"]]) window[`__${k}`] = await at(m); });
  const waitTake = (n) => ev(async (n) => { const T = window.__T; for (let i = 0; i < 160 && T.all().length < n; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, 300)); return T.all().at(-1)?.id ?? null; }, n);
  // ---- take A in a scene shot, with Kon v1 ----
  R.a = await ev(async (lora) => {
    const X = window.__X, L = window.__L, T = window.__T, SC = window.__SC;
    await T.load(); await SC.load();
    const scene = await SC.create({ name: "Retake test" });
    await SC.addShot(scene.id, { name: "Kon walks" });
    const shot = SC.get(scene.id).shots[0].id;
    await SC.openShot(scene.id, shot);
    await window.__M.load();
    const c = await L.saveCast(null, { name: "Kon", trigger: "kon_fennec", details: "a fennec-eared courier girl", lora: { file: lora, strength: 0.8 }, refs: [] });
    await L.applyCast(`cast:${c.id}`);
    return { scene: scene.id, shot, cast: c.id, revision: (await X.callTool("describe_recipe", {})).revision, takes: T.all().length };
  }, LORA);
  const ref = `cast:${R.a.cast}`;
  await ev(() => app.queuePrompt(0, 1));
  R.a.take = await waitTake(R.a.takes + 1);
  R.v2 = await ev(async ([id, lora]) => window.__L.saveCast(id, { name: "Kon", trigger: "kon_fennec", details: "a fennec-eared courier girl", lora: { file: lora, strength: 0.6 }, refs: [] }, { note: "lower strength" }), [R.a.cast, LORA]);
  // ---- the viewer's buttons ----
  await page.waitForTimeout(800);
  await page.click(`.snap-take[data-take="${R.a.take}"]`).catch((e) => { R.viewErr = e.message; });
  await page.waitForTimeout(800);
  R.viewer = await ev(() => [...document.querySelectorAll(".snap-take-sheet .snap-retake button")].map((x) => [x.textContent, x.disabled]));
  await page.locator(".snap-take-sheet").screenshot({ path: path.join(out, "326-u87-retake-buttons.png") }).catch((e) => { R.shotErr = e.message; });
  await page.keyboard.press("Escape");
  // ---- the tool, as an agent (a proposal while agents may not run) ----
  R.proposal = await ev(async (take) => window.__X.callTool("retake", { take, world: "latest" }), R.a.take);
  // ---- as it was ----
  const n1 = await ev(() => window.__T.all().length);
  R.pinned = await ev(async (take) => { const RT = window.__RT, T = window.__T; const r = await RT.retake(T.get(take), { world: "pinned" }); return { ...r, revision: (await window.__X.callTool("describe_recipe", {})).revision, pin: window.__E.state().world }; }, R.a.take);
  R.pinned.take = await waitTake(n1 + 1);
  R.pinnedQueued = queued.at(-1)?.workflow?.extra?.snap?.retake ?? null;
  // ---- today's world ----
  const n2 = await ev(() => window.__T.all().length);
  R.latest = await ev(async ([take, ref]) => { const r = await window.__RT.retake(window.__T.get(take), { world: "latest" }); return { ...r, pin: window.__E.state().world[ref].n }; }, [R.a.take, ref]);
  R.latest.take = await waitTake(n2 + 1);
  // what differs between A's queued recipe and the today's-world one (seeds aside)
  R.diff = await ev(([a, c]) => window.__T.changes(window.__T.canonical(a), window.__T.canonical(c)), [queued[0].prompt, queued.at(-1).prompt]);
  R.diffPinned = await ev(([a, c]) => window.__T.changes(window.__T.canonical(a), window.__T.canonical(c)), [queued[0].prompt, queued.at(-2).prompt]);
  R.parents = await ev(([p, l]) => [p, l].map((id) => window.__T.get(id)?.parent ?? null), [R.pinned.take, R.latest.take]);
  R.cached = await ev((id) => window.__T.get(id)?.cached_from ?? null, R.pinned.take);
  await page.waitForTimeout(600);
  R.cachedChip = await ev((id) => document.querySelector(`.snap-take[data-take="${id}"] .snap-take-cached`)?.textContent ?? null, R.pinned.take);
  R.scene = await ev(async ([scene]) => window.__X.callTool("get_scene", { scene }), [R.a.scene]);
  // seed new
  R.newSeed = await ev(async (take) => { const r = await window.__RT.retake(window.__T.get(take), { world: "pinned", seed: "new", queue: false }); return r.new_seed ?? null; }, R.a.take);
  R.queuedCount = queued.length; R.errors = errs;

  const tree = R.scene.shots?.[0]?.takes ?? [], root = tree.find((x) => x.take === R.a.take);
  const c = {
    "take A pins Kon v1": queued[0]?.workflow?.extra?.snap?.world?.[ref]?.n === 1 && !!R.a.take,
    "the viewer offers both re-takes, naming Kon v1 → v2 (and Re-run with swaps…, U89)": R.viewer.length === 3 && R.viewer[2][0] === "Re-run with swaps…" && R.viewer[0][0] === "Re-take as it was" && /Kon v1 → v2/.test(R.viewer[1][0]) && !R.viewer[1][1],
    "the retake tool waits as a proposal and plans the update": !!R.proposal.proposed && R.proposal.plan?.updates?.[0]?.text === "Kon v1 → v2" && R.proposal.plan.updates[0].fields.includes("lora.strength 0.8 → 0.6"),
    "as it was: the same revision (recipe and seed), the pin stays v1": R.pinned.revision === R.a.revision && R.pinned.pin?.[ref]?.n === 1 && R.diffPinned.length === 0,
    "as it was: the queued workflow carries the retake mark": R.pinnedQueued?.take === R.a.take && R.pinnedQueued.world === "pinned",
    "today's world: the pin is v2 and only the Cast row's strength differs": R.latest.pin === 2 && R.diff.length === 1 && /Cast LoRAs\.loras\.0\.strength/.test(R.diff[0]),
    "both new takes are versions of A (parent retake, world pinned / latest)": R.parents[0]?.take === R.a.take && R.parents[0].method === "retake" && R.parents[0].options.world === "pinned" && R.parents[1]?.options?.world === "latest",
    "get_scene nests them under A as 'Retake · as it was' and 'Retake · today's world'": !!root && root.versions.map((v) => v.label).sort().join("|") === "Retake · as it was|Retake · today's world",
    "seed new draws another seed": R.newSeed != null,
    "an identical recipe served from core's cache is marked as the same result as take A": R.cached === R.a.take && /same result as take/.test(R.cachedChip ?? ""),
    "three runs queued, no page errors": R.queuedCount === 3 && !R.errors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_retake_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`retake   ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
