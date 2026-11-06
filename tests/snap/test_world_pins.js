// U87 step 3, pins on takes, stale naming and the update chip, on the CPU test server (:8195). Queues one 64 px
// EmptyImage -> SaveImage prompt whose workflow is the open recipe's (so its take captures the recipe's world pins);
// the stale checks use a take holding the live chain's own prompt, as a take of this recipe would.
// - a take keeps the recipe's pins (world["cast:<id>"].n === 1);
// - Kon v2 saved: the take flags world [{name: "Kon", was: 1, now: 2}] and changed [];
// - the Cast brick shows "Kon v1 · v2 available · update"; pressing it puts v2 in (pin 2, row 0.6) and the take then
//   also lists the row change; a take from before pins flags no world;
// - list_takes / get_take / describe_recipe carry the pins; a set applied pins its version (the pack's root as v0, a
//   working copy saved first as a new, unlisted version, the same state reused);
// - the Takes strip's chip reads "stale: Kon v1 → v2". Screens 324-325.
// usage: node test_world_pins.js [port 8195]
// BEFORE=<git rev> serves that rev's takes/library/tools/view/dailies.js: the run must fail.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const MODS = /\/extensions\/ComfyUI-MAINodes\/snap\/(takes|library|tools|view|dailies)\.js(\?.*)?$/;
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const LORA = "snaptest_cast_kon_identity.safetensors";
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await useShelf(page, { extra: { loras: [[LORA, 0.1]] } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  if (process.env.BEFORE) await page.route(MODS, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: execSync(`git -C ${CFG.pack} show ${process.env.BEFORE}:web/snap/${r.request().url().match(MODS)[1]}.js`).toString() }));
  let q = 0; page.on("request", (r) => { if (r.method() === "POST" && /\/(api\/)?prompt$/.test(r.url())) q++; });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["E", "engine"], ["M", "models"], ["W", "world"], ["T", "takes"]]) window[`__${k}`] = await at(m); });
  await ev(async () => { app.graph.clear(); app.graph.extra = {}; await window.__X.callTool("start_recipe", {}); await window.__M.load(); await window.__T.load(); });
  R.v1 = await ev(async (lora) => { const L = window.__L, c = await L.saveCast(null, { name: "Kon", trigger: "kon_fennec", details: "a fennec-eared courier girl", lora: { file: lora, strength: 0.8 }, refs: [] }); await L.applyCast(`cast:${c.id}`); return c; }, LORA);
  const ref = `cast:${R.v1.id}`;
  // a take from a run (its workflow is the open recipe's)
  R.captured = await ev(async (ref) => {
    const T = window.__T, { api } = await import("/scripts/api.js");
    const prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/u87pins" } } };
    const r = await fetch("/api/prompt", { method: "POST", body: JSON.stringify({ client_id: api.clientId, prompt, extra_data: { extra_pnginfo: { workflow: app.graph.serialize() } } }) });
    const id = (await r.json()).prompt_id;
    for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((res) => setTimeout(res, 500));
    const t = T.get(`take-${id}`);
    return t && { id: t.id, pin: t.world?.[ref] ?? null, media: t.media };
  }, ref);
  // takes holding the live chain's own prompt: one with the pins, one from before pins
  R.made = await ev(async ([ref, media]) => {
    const T = window.__T, E = window.__E, live = (await app.graphToPrompt()).output, h = await T.hashes(T.canonical(live)), now = Date.now();
    const base = { kind: "run", status: "success", group: app.graph.id, workflow: "", text: "", seed: null, media, verdict: null, prior: false, notes: [], prompt: live, ...h };
    await T.save({ ...base, id: "take-u87pins-a", prompt_id: "u87pins-a", created: now, number: 90, world: structuredClone(E.state().world) });
    await T.save({ ...base, id: "take-u87pins-old", prompt_id: "u87pins-old", created: now + 1, number: 91 });
    return { a: await T.stale(T.get("take-u87pins-a")), old: await T.stale(T.get("take-u87pins-old")) };
  }, [ref, R.captured?.media ?? []]);
  R.v2 = await ev(async ([id, lora]) => window.__L.saveCast(id, { name: "Kon", trigger: "kon_fennec", details: "a fennec-eared courier girl", lora: { file: lora, strength: 0.6 }, refs: [] }, { note: "lower strength" }), [R.v1.id, LORA]);
  R.afterV2 = await ev(async () => ({ a: await window.__T.stale(window.__T.get("take-u87pins-a")), old: await window.__T.stale(window.__T.get("take-u87pins-old")) }));
  await page.waitForTimeout(800);
  R.chip = await ev(() => [...document.querySelectorAll('.snap-brick .snap-pin')].map((e) => [e.closest(".snap-brick")?.dataset.brick ?? null, e.className, e.textContent]));
  await ev(() => document.querySelector('.snap-brick[data-brick="cast"]')?.scrollIntoView({ inline: "center", block: "nearest" })); await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(out, "324-u87-pin-chip-update.png") });
  R.tools = await ev(async (ref) => {
    const X = window.__X, lt = (await X.callTool("list_takes", {})).find((t) => t.id === "take-u87pins-a"), gt = await X.callTool("get_take", { take: "take-u87pins-a" }), dr = await X.callTool("describe_recipe", {});
    return { listed: lt?.stale ?? null, take: gt.world.find((w) => w.ref === ref) ?? null, recipe: dr.world.find((w) => w.ref === ref) ?? null };
  }, ref);
  await page.click(".snap-pin.moved").catch((e) => { R.clickErr = e.message; });
  await page.waitForTimeout(700);
  R.afterUpdate = await ev(async (ref) => ({ pin: window.__E.state().world[ref].n, row: window.__M.rows("cast").map((r) => r.strength), stale: await window.__T.stale(window.__T.get("take-u87pins-a")),
    chip: [...document.querySelectorAll(".snap-brick .snap-pin")].map((e) => e.textContent) }), ref);
  // the Takes strip
  await page.waitForTimeout(800);
  R.strip = await ev(() => [...document.querySelectorAll(".snap-take")].map((e) => [e.querySelector("figcaption b")?.textContent, e.querySelector(".snap-take-stale")?.hidden === false ? e.querySelector(".snap-take-stale").textContent : null]));
  await page.locator(".snap-takes").screenshot({ path: path.join(out, "325-u87-take-stale-world.png") }).catch(() => {});
  // sets: the pack's root pins v0; a working copy is saved first as an unlisted version, the same state reused
  R.sets = await ev(async () => {
    const L = window.__L, E = window.__E, W = window.__W;
    if (!E.state().bricks.some((x) => x.key === "refs")) await E.snap("refs");
    const root = L.get("set-lamp-room-end-s3"), listed = () => L.lineage(root).length;
    const before = listed();
    await L.applySet(root);
    const p0 = structuredClone(E.state().world["set_snapshot:set-lamp-room-end-s3"]);
    const s = structuredClone(root.brick.snapshot); s.shot = "shot 3 (u87 test)";
    const mine = L.version(root, s, true); await L.save(mine);
    await L.applySet(L.get(mine.id));
    const p1 = structuredClone(E.state().world["set_snapshot:set-lamp-room-end-s3"]);
    await L.applySet(L.get(mine.id));
    const p2 = structuredClone(E.state().world["set_snapshot:set-lamp-room-end-s3"]), r = W.record("set_snapshot", "set-lamp-room-end-s3");
    return { p0, p1, p2, versions: r.versions.map((v) => [v.n, v.listed ?? null]), listedBefore: before, listedAfter: listed() };
  });
  R.queue = q; R.errors = errs;

  const c = {
    "a take keeps the recipe's pins": R.captured?.pin?.n === 1 && R.captured.pin.name === "Kon",
    "a take of the live chain flags nothing while nothing moved": R.made.a === null && R.made.old === null,
    "Kon v2 saved: the take flags world Kon 1 → 2 and changed []": JSON.stringify(R.afterV2.a?.changed) === "[]" && R.afterV2.a.world.length === 1 && R.afterV2.a.world[0].name === "Kon" && R.afterV2.a.world[0].was === 1 && R.afterV2.a.world[0].now === 2,
    "a take from before pins flags no world": R.afterV2.old === null,
    "the Cast brick shows 'Kon v1 · v2 available · update'": R.chip.some(([brick, cls, text]) => brick === "cast" && cls.includes("moved") && text === "Kon v1 · v2 available · update"),
    "list_takes, get_take and describe_recipe carry the pins": R.tools.listed?.world?.[0]?.now === 2 && R.tools.take?.n === 1 && R.tools.take.head === 2 && R.tools.take.moved && R.tools.recipe?.n === 1 && R.tools.recipe.moved && R.tools.recipe.placed?.row === 0,
    "update puts v2 in: pin 2, the row at 0.6, the chip reads Kon v2": R.afterUpdate.pin === 2 && JSON.stringify(R.afterUpdate.row) === "[0.6]" && R.afterUpdate.chip.includes("Kon v2"),
    "after the update the take also lists the row change": R.afterUpdate.stale?.world?.[0]?.was === 1 && R.afterUpdate.stale.changed.some((x) => /Cast LoRAs/.test(x)),
    "the Takes strip's chip reads 'stale: Kon v1 → v2'": R.strip.some(([, chip]) => (chip ?? "").startsWith("stale: Kon v1 → v2")),
    "a pack set pins v0; a working copy is saved as a new unlisted version and pinned; the same state is reused": R.sets.p0?.n === 0 && R.sets.p1?.n === 1 && R.sets.p2?.n === 1 && JSON.stringify(R.sets.versions) === "[[1,false]]" && R.sets.listedAfter === R.sets.listedBefore + 1,
    "one prompt queued, no page errors": R.queue === 1 && !R.errors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_world_pins_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`pins     ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
