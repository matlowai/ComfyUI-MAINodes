// U89 step 1 (SNAP-R63): re-run with swaps, Re-generate, on the CPU test server (:8195). Every queued prompt is rewritten
// into a 64 px EmptyImage prompt keeping its extra_data (test_retake.js's pattern), so takes are captured from /history.
// - take A runs in a scene shot with Kon v1 (LoRA, details, one picture); Mara is saved (another LoRA, details, picture),
//   then Kon v2 (lore only);
// - rerun A with Kon → Mara: the chain holds Mara's row, sentence and picture and none of Kon's; the world pins Mara, not
//   Kon; the new take's parent is rerun/regenerate with the swap; get_scene nests it under A as "Re-run · Kon → Mara";
// - rerun A with Kon @2 pins v2 and says cache_hit (lore isn't in the prompt); swaps {} is A's revision exactly; seed
//   new draws a seed;
// - the tool: a proposal while agents may not run, its plan per swap (text, fields), cache_hit for the lore-only swap;
//   "v3" refused naming pinned / latest / @1 / @2 and the other casts; route "redo" refused naming regenerate; a slot A
//   didn't pin refused naming A's slots; rerun_slots lists every choice; get_take returns the parent.
// usage: node test_rerun.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const KON = "snaptest_cast_kon_identity.safetensors", MARA = "snaptest_cast_mara_identity.safetensors";
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await useShelf(page, { extra: { loras: [[KON, 0.1], [MARA, 0.1]] } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const queued = [];
  await page.route(/\/(api\/)?prompt$/, (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const body = JSON.parse(r.request().postData());
    queued.push({ workflow: body.extra_data?.extra_pnginfo?.workflow ?? null, prompt: body.prompt });
    body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/u89rerun" } } };
    delete body.partial_execution_targets;
    return r.continue({ postData: JSON.stringify(body) });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["E", "engine"], ["M", "models"], ["W", "world"], ["T", "takes"], ["SC", "scenes"], ["RR", "rerun"]]) window[`__${k}`] = await at(m); });
  const waitTake = (n) => ev(async (n) => { const T = window.__T; for (let i = 0; i < 160 && T.all().length < n; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, 300)); return T.all().at(-1)?.id ?? null; }, n);
  R.a = await ev(async ([kon, mara]) => {
    const X = window.__X, L = window.__L, T = window.__T, SC = window.__SC;
    await T.load(); await SC.load(); await window.__M.load();
    const scene = await SC.create({ name: "Rerun test" });
    await SC.addShot(scene.id, { name: "Kon walks" });
    const shot = SC.get(scene.id).shots[0].id;
    await SC.openShot(scene.id, shot);
    const pic = async (id, colour) => { const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }); c.getContext("2d").fillStyle = colour; c.getContext("2d").fillRect(0, 0, 64, 64);
      return L.uploadCastPicture(new File([await new Promise((r) => c.toBlob(r, "image/png"))], "front.png", { type: "image/png" }), id); };
    const k = `cast-konrr${Date.now().toString(36)}`, m = `cast-mararr${Date.now().toString(36)}`;
    await L.saveCast(k, { name: "Kon", trigger: "kon_fennec", details: "a fennec-eared courier girl", lora: { file: kon, strength: 0.8 }, refs: [{ file: await pic(k, "#3a6"), role: "identity: front" }] });
    await L.applyCast(`cast:${k}`);
    await L.saveCast(m, { name: "Mara", trigger: "", details: "a young woman with long dark wavy hair and a mustard coat", lora: { file: mara, strength: 0.7 }, refs: [{ file: await pic(m, "#c93"), role: "identity: front" }] });
    return { scene: scene.id, shot, kon: k, mara: m, revision: (await X.callTool("describe_recipe", {})).revision, takes: T.all().length };
  }, [KON, MARA]);
  const kon = `cast:${R.a.kon}`, mara = `cast:${R.a.mara}`;
  await ev(() => app.queuePrompt(0, 1));
  R.a.take = await waitTake(R.a.takes + 1);
  // a real capture hashes the prompt that ran; here that is the rewritten one, so give A the hash of what the page queued
  await ev(async ([id, prompt]) => { const T = window.__T, t = T.get(id); t.hash = (await T.hashes(T.canonical(prompt))).hash; }, [R.a.take, queued[0].prompt]);
  await ev(async ([id, lora]) => { const L = window.__L, W = window.__W, b = W.headOf(W.record("cast", id)).body; await L.saveCast(id, { ...b, lora: { file: lora, strength: 0.8 }, lore: "likes tea" }, { note: "lore" }); }, [R.a.kon, KON]);
  // ---- the tool, as an agent (agents may not run: proposals) ----
  R.proposal = await ev(async ([take, kon, mara]) => window.__X.callTool("rerun", { take, swaps: { [kon]: { to: mara } } }), [R.a.take, kon, mara]);
  R.lorePlan = await ev(async ([take, kon]) => window.__X.callTool("rerun", { take, swaps: { [kon]: { to: "latest" } } }), [R.a.take, kon]);
  const err = (fn, arg) => ev(async ([fn, arg]) => { try { await (0, eval)(fn)(arg); return null; } catch (e) { return e.message; } }, [fn.toString(), arg]);
  R.badTo = await err(async ([take, kon]) => window.__X.callTool("rerun", { take, swaps: { [kon]: { to: "v3" } } }), [R.a.take, kon]);
  R.badRoute = await err(async (take) => window.__X.checkArgs("rerun", { take, route: "redo" }), R.a.take);
  R.badSlot = await err(async (take) => window.__X.callTool("rerun", { take, swaps: { "cast:nobody": { to: "latest" } } }), R.a.take);
  R.slots = await ev(async (take) => window.__X.callTool("rerun_slots", { take }), R.a.take);
  // ---- Kon → Mara, as the sheet will call it ----
  const n1 = await ev(() => window.__T.all().length);
  R.swap = await ev(async ([take, kon, mara]) => {
    const r = await window.__RR.rerun(window.__T.get(take), { swaps: { [kon]: { to: mara } } }), E = window.__E;
    return { ...r, rows: window.__M.rows("cast").map((x) => x.file), first: (E.getValue("render", "render", "prompt") ?? "").split("\n")[0], sources: (E.state().bricks.find((x) => x.key === "refs")?.pictures ?? []).map((p) => p.source), world: Object.keys(E.state().world ?? {}) };
  }, [R.a.take, kon, mara]);
  R.swap.take = await waitTake(n1 + 1);
  R.swapQueued = queued.at(-1)?.workflow?.extra?.snap?.rerun ?? null;
  R.parent = await ev((id) => window.__T.get(id)?.parent ?? null, R.swap.take);
  R.getTake = await ev(async (id) => (await window.__X.callTool("get_take", { take: id })).parent, R.swap.take);
  R.scene = await ev(async (scene) => window.__X.callTool("get_scene", { scene }), R.a.scene);
  // ---- a version, lore only: pins v2, a cache hit; swaps {}: A's revision; seed new ----
  R.ver = await ev(async ([take, kon]) => { const r = await window.__RR.rerun(window.__T.get(take), { swaps: { [kon]: "@2" }, queue: false }); return { ...r, pin: window.__E.state().world[kon]?.n }; }, [R.a.take, kon]);
  R.none = await ev(async (take) => { const r = await window.__RR.rerun(window.__T.get(take), { swaps: {}, queue: false }); return { ...r, revision: (await window.__X.callTool("describe_recipe", {})).revision }; }, R.a.take);
  R.newSeed = await ev(async (take) => (await window.__RR.rerun(window.__T.get(take), { seed: "new", queue: false })).new_seed ?? null, R.a.take);
  R.queuedCount = queued.length; R.errors = errs;

  const tree = R.scene.shots?.[0]?.takes ?? [], root = tree.find((x) => x.take === R.a.take), konSlot = R.slots.slots?.find((s) => s.slot === kon);
  const c = {
    "take A pins Kon v1": queued[0]?.workflow?.extra?.snap?.world?.[kon]?.n === 1 && !!R.a.take,
    "the rerun tool waits as a proposal; its plan says Kon → Mara with the field changes": !!R.proposal.proposed && R.proposal.plan?.swaps?.[0]?.text === "Kon → Mara" && R.proposal.plan.swaps[0].fields.some((f) => f.startsWith("details")) && !R.proposal.plan.cache_hit,
    "a lore-only version swap plans a cache hit": /cache/.test(R.lorePlan.plan?.cache_hit ?? "") && R.lorePlan.plan.swaps[0].text === "Kon v1 → v2",
    "'v3' is refused naming pinned, latest, @1, @2 and Mara": /isn't one of pinned, latest, @1, @2 \(its versions\), or another cast: .*\(Mara\)/.test(R.badTo ?? ""),
    "route 'redo' is refused naming regenerate": /route "redo" isn't one of "regenerate"/.test(R.badRoute ?? ""),
    "a slot A didn't pin is refused naming A's slots": /has no slot "cast:nobody"; its slots are cast:.*scene, setup/.test(R.badSlot ?? ""),
    "rerun_slots lists Kon's versions, Mara among the others, then scene and setup": konSlot?.versions?.map((v) => v.n).join() === "1,2" && konSlot.others.some((o) => o.ref === mara && o.name === "Mara") && R.slots.slots.at(-2)?.slot === "scene" && R.slots.slots.at(-1)?.slot === "setup",
    "after Kon → Mara the chain holds Mara's row, sentence and picture, none of Kon's": R.swap.rows.join() === MARA && /mustard coat/.test(R.swap.first) && !/fennec/.test(R.swap.first) && R.swap.sources.join() === mara,
    "the world pins Mara, not Kon": R.swap.world.includes(mara) && !R.swap.world.includes(kon),
    "the queued workflow carries the rerun mark with the swap": R.swapQueued?.take === R.a.take && R.swapQueued.route === "regenerate" && R.swapQueued.swaps?.[kon]?.text === "Kon → Mara",
    "the new take's parent is rerun/regenerate with the swap; get_take returns it": R.parent?.take === R.a.take && R.parent.method === "rerun/regenerate" && R.parent.options.swaps[kon].to.startsWith(mara) && R.getTake?.method === "rerun/regenerate",
    "get_scene nests it under A as 'Re-run · Kon → Mara'": !!root && root.versions.some((v) => v.label === "Re-run · Kon → Mara"),
    "Kon @2 pins v2 and says it's a cache hit": R.ver.pin === 2 && /cache/.test(R.ver.cache_hit ?? ""),
    "swaps {} is A's revision exactly": R.none.revision === R.a.revision && /as it was/.test(R.none.said),
    "seed new draws another seed": R.newSeed != null,
    "two runs queued, no page errors": R.queuedCount === 2 && !R.errors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_rerun_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`rerun    ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
