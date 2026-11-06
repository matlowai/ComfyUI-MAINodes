// U59 on the CPU server: scenes as nested, navigable documents. A U19-style take group (day -1.5 / 0 / +1.5 and a
// night version of the 0 take) is adopted into a scene in one tool call; the navigator opens it in a scene tab and
// shows the shot's takes as a tree (the night version under take 2), the active take and the breadcrumb; a lamp-room
// shot from its Library card opens in the same tab; edits survive shot switches (the open shot is saved first); a
// scratch tab and a saved workflow file are never swapped (Start, Open and Add this workflow open new tabs); a run that
// starts on a take's last frame lands as a "continued" version; the agent tools (list/get/create/add/open/set active/
// move) are the same functions. Fixture videos are the U19 takes. Never queues a render.
const { chromium } = require("playwright"); const { spawn } = require("child_process"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"), R = {}, FIX = CFG.fixture("u59");
const HOST = `http://127.0.0.1:${CFG.port}`, MCP = path.join(CFG.pack, "tools", "snap_mcp.py");
const OUTPUT = path.join(CFG.base, "output");
function mcp() {
  const p = spawn("python3", ["-I", MCP, "--port", CFG.port]);
  let buf = "", waiters = [], id = 0;
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); waiters.shift()?.(JSON.parse(line)); } });
  return { send: (method, params) => new Promise((r) => { waiters.push((m) => r(m.result)); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) + "\n"); }), close: () => p.stdin.end() };
}
(async () => {
  fs.mkdirSync(path.join(OUTPUT, "video/snaptest_scene"), { recursive: true });
  for (const f of ["day_minus", "day_zero", "day_plus", "night"]) fs.copyFileSync(path.join(FIX, `${f}.mp4`), path.join(OUTPUT, `video/snaptest_scene/${f}.mp4`));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { q++; return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${HOST}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  const stamp = Date.now().toString(36);
  // the U19-style workflow: a Simple recipe in its own tab, with five takes in its group (day -1.5 / 0 / +1.5, the night
  // version of take 2, and an image take with no media) and take 2 kept
  R.fixture = await page.evaluate(async (stamp) => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    for (const [k, f] of Object.entries({ T: "takes", X: "tools", SC: "scenes", L: "library" })) window[`__${k}`] = await import(`/extensions/ComfyUI-MAINodes/snap/${f}.js`);
    window.__api = (await import("/scripts/api.js")).api;
    app.graph.clear(); app.graph.extra = {};
    await snap.engine.simple();
    snap.engine.setValues("render", "render", { length: 97, noise_seed: 20261104, prompt: "An adult woman in a red coat walks along an empty train platform, steam drifting past" });
    await __T.load(); await __SC.load();
    const live = await __T.live(), group = __T.groupOf(), graph = app.graph.serialize();
    const vid = (f) => [{ kind: "video", filename: `${f}.mp4`, subfolder: "video/snaptest_scene", type: "output", node: "191" }];
    const base = { kind: "run", group, workflow: "Unsaved Workflow (2)", status: "success", seed: 20261104, verdict: null, prior: false, notes: [], prompt: live.recipe, graph, ...await __T.hashes(live) };
    const ids = ["minus", "zero", "plus", "night"].map((x) => `take-u59${x}-${stamp}`), t0 = Date.now() - 600000;
    await __T.save({ ...base, id: ids[0], prompt_id: `u59a-${stamp}`, number: 1, created: t0, seconds: 66, text: "dial -1.5", media: vid("day_minus") });
    await __T.save({ ...base, id: ids[1], prompt_id: `u59b-${stamp}`, number: 2, created: t0 + 60000, seconds: 66, text: "dial 0", media: vid("day_zero"), verdict: "keep" });
    await __T.save({ ...base, id: ids[2], prompt_id: `u59c-${stamp}`, number: 3, created: t0 + 120000, seconds: 66, text: "dial +1.5", media: vid("day_plus") });
    await __T.save({ ...base, id: ids[3], prompt_id: `u59d-${stamp}`, number: 4, created: t0 + 300000, seconds: 125, text: "Edit propagation", seed: 2085285840, media: vid("night"),
      parent: { take: ids[1], method: "edit/relight", options: { time: "night" }, decision: "cand-x", candidate: "c1" } });
    snap.toggle();
    return { group, ids, nodes: app.graph.nodes.length, tabs: app.extensionManager.workflow.openWorkflows.length };
  }, stamp);
  await page.waitForTimeout(1500);
  const { group, ids } = R.fixture, [tMinus, tZero, tPlus, tNight] = ids;
  const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  const state = () => page.evaluate(() => { const h = __SC.current(), w = app.extensionManager.workflow; return { scene: h?.scene.id ?? null, shot: h?.shot.id ?? null, graph: app.graph.id, tabs: w.openWorkflows.length, tab: w.activeWorkflow.filename, temporary: w.activeWorkflow.isTemporary,
    prompt: __snap.engine.getValue("render", "render", "prompt"), bar: document.querySelector(".snap-scene")?.className, crumbs: [...document.querySelectorAll(".snap-scene .snap-crumbs > :not(i)")].map((x) => x.textContent),
    tiles: [...document.querySelectorAll(".snap-shot-tile")].map((x) => [x.dataset.shot, x.classList.contains("on"), x.querySelector("figcaption").textContent]) }; });
  const strip = () => page.evaluate(() => [...document.querySelectorAll(".snap-takes-strip > *")].map(function walk(el) {
    if (el.classList.contains("snap-take")) return { take: el.dataset.take, title: el.querySelector("figcaption b").textContent, active: el.classList.contains("active"), star: el.querySelector(".snap-take-star")?.textContent ?? null, of: el.querySelector(".snap-take-of")?.textContent ?? null };
    return { family: [walk(el.firstElementChild), ...[...el.querySelector(".snap-take-versions").children].map(walk)] }; }));
  const settle = (ms = 900) => page.waitForTimeout(ms);

  // 1. the agent tools: on the bridge too (MCP tools/list), then the lifecycle
  const m = mcp(); await m.send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } });
  R.onBridge = ((await m.send("tools/list", {}))?.tools ?? []).map((t) => t.name).filter((n) => ["list_scenes", "get_scene", "create_scene", "add_shot", "open_shot", "set_active_take", "move_shot"].includes(n));
  m.close();
  R.listBefore = await call("list_scenes", {});
  R.noName = await call("create_scene", { name: " " });
  R.created = await call("create_scene", { name: `Platform at dusk ${stamp}` });
  const scene = R.created.id;
  // 2. migration: the U19-style group adopted in one call; the open tab (scratch) is left alone
  R.adopted = await call("add_shot", { scene, adopt: group });
  const shot1 = R.adopted.shot.id;
  R.afterAdopt = await state();
  R.got = await call("get_scene", { scene });
  R.groupStill = await page.evaluate((g) => __T.inGroup(g).length, group);
  R.file = await page.evaluate(async (id) => (await __api.getUserData(`snap/scenes/${id}.json`)).json(), scene);
  R.workflowFile = await page.evaluate(async (p) => (await __api.getUserData(p)).status, R.file.shots[0].workflow);
  // 3. the person opens the scene from the scratch tab: a new scene tab (the scratch one keeps its graph)
  await page.click(".snap-scene.scratch button"); await settle(500);
  R.sheet = await page.evaluate(() => [...document.querySelectorAll(".snap-scenes-sheet .snap-scene-row")].map((r) => [r.querySelector("strong").textContent, r.querySelector(".snap-quiet").textContent]));
  await page.screenshot({ path: path.join(out, "126-u59-scenes-sheet.png") });
  await page.click(`.snap-scenes-sheet .snap-scene-row:last-child .snap-primary`); await settle(2500);
  R.opened = await state();
  R.scratchKept = await page.evaluate((g) => { const w = app.extensionManager.workflow.openWorkflows.find((x) => x.activeState?.id === g && !x.activeState?.extra?.snap_scene); return w ? w.activeState.nodes.length : null; }, group);
  R.tree = await strip();
  R.heading = await page.evaluate(() => document.querySelector(".snap-takes > header strong").textContent);
  await page.screenshot({ path: path.join(out, "127-u59-navigator-shot1.png") });
  // 4. ☆ on the night version makes it the active take; the breadcrumb follows; the viewer's title is its place
  await page.click(`.snap-take[data-take="${tNight}"] .snap-take-star`); await settle();
  R.nightActive = { state: await state(), tree: await strip(), file: await page.evaluate(async (id) => (await (await __api.getUserData(`snap/scenes/${id}.json`)).json()).shots[0].active, scene) };
  await page.screenshot({ path: path.join(out, "128-u59-night-active.png") });
  await page.click(`.snap-take[data-take="${tNight}"]`); await settle(700);
  R.viewer = await page.evaluate(() => ({ crumbs: [...document.querySelectorAll(".snap-take-sheet > header .snap-crumbs > :not(i)")].map((x) => x.textContent), active: [...document.querySelectorAll(".snap-take-sheet button")].find((x) => x.textContent.includes("active take"))?.textContent ?? null }));
  await page.screenshot({ path: path.join(out, "129-u59-viewer-crumbs.png") });
  await page.keyboard.press("Escape"); await settle(300);
  // an agent's pick waits for the person (SNAP-R16/R23)
  R.agentPick = await call("set_active_take", { scene, shot: shot1, take: tPlus, reason: "brightest platform" });
  R.notTaken = await page.evaluate(([s, x]) => __SC.setActive(s, x, "take-nope").catch((e) => ({ error: e.message })), [scene, shot1]);
  // 5. + Shot from the lamp-room shot card: it opens in the same scene tab, from Shot 1's recipe, with its card compiled
  const graph1 = (await state()).graph;
  await page.evaluate(() => [...document.querySelectorAll(".snap-scene button")].find((x) => x.textContent === "+ Shot").click()); await settle(400);
  R.menu = await page.evaluate(() => [...document.querySelectorAll(".snap-scene-menu button")].map((x) => x.textContent));
  await page.screenshot({ path: path.join(out, "130-u59-add-shot-menu.png") });
  await page.evaluate(() => [...document.querySelectorAll(".snap-scene-menu button")].find((x) => x.textContent.startsWith("Shot 4")).click()); await settle(3000);
  R.shot2 = await state();
  const shot2 = R.shot2.shot;
  R.shot1Saved = await page.evaluate(async ([id]) => { const s = await (await __api.getUserData(`snap/scenes/${id}.json`)).json(); return (await (await __api.getUserData(s.shots[0].workflow)).json()).id; }, [scene]);
  await page.screenshot({ path: path.join(out, "131-u59-lamp-room-shot.png") });
  // 6. no work lost: an edit on shot 2, over to shot 1 and back
  await page.evaluate(() => { const p = __snap.engine.getValue("render", "render", "prompt"); __snap.engine.setValue("render", "render", "prompt", `${p}\nEDITED ON SHOT 2`); });
  await page.click(`.snap-shot-tile[data-shot="${shot1}"]`); await settle(2500);
  R.backTo1 = await state();
  await page.click(`.snap-shot-tile[data-shot="${shot2}"]`); await settle(2500);
  R.backTo2 = await state();
  // 7. Start never touches open work: it opens a new scratch tab; the scene tab keeps shot 2
  await call("start_recipe", {}); await settle(1500);
  R.started = await state();
  // the navigator from a scratch tab: the scene's own tab is gone to (this one is scratch work, left as it is)
  await call("open_shot", { scene, shot: shot1 }); await settle(800);
  R.openFromScratch = await state();
  // 8. agent tools on the scene tab: open_shot swaps in place; move_shot reorders; get_scene reads it all
  R.openTool = await call("open_shot", { scene, shot: shot2 }); await settle(800);
  R.inPlace = await state();
  // the chain follows a same-tab load from the tool table with no mouse event after it (no graphChanged fires)
  R.chainFollows = await page.evaluate(() => document.querySelector('.snap-brick[data-brick="render"]')?.textContent.includes("[shot 4]") ?? false);
  R.moved = await call("move_shot", { scene, shot: shot2, to: 0 }); await settle(500);
  R.afterMove = await state();
  await call("move_shot", { scene, shot: shot2, to: 1 }); await settle(300);
  // 9. a run that starts on a take's last frame is a "continued" version of it (captured as a run of this page)
  await call("open_shot", { scene, shot: shot1 }); await settle(800);
  R.cont = await page.evaluate(async ([parent]) => {
    const E = __snap.engine, ff = E.state().bricks.find((x) => x.key === "first_frame"), w = E.nodeFor("first_frame", "image").widgets.find((x) => x.name === "image");
    if (!w.options.values.includes("snap/fixture_f106.png")) w.options.values.push("snap/fixture_f106.png");
    E.setValue("first_frame", "image", "image", "snap/fixture_f106.png");
    E.remember("first_frame", "from", { take: parent, number: 2, frame: 106, file: "snap/fixture_f106.png", by: "person" });
    app.graph.getNodeById(ff.nodes.image).mode = 0; // on, so the frame is in the prompt
    const p = await app.graphToPrompt(), id = `u59cont-${Date.now().toString(36)}`;
    window.__fakeHistory = { [id]: { prompt: [0, id, p.output, { extra_pnginfo: { workflow: p.workflow } }], outputs: {}, status: { status_str: "success", completed: true, messages: [] } } };
    return id;
  }, [tZero]);
  await page.route(new RegExp(`/history/${R.cont}$`), (r) => page.evaluate(() => window.__fakeHistory).then((j) => r.fulfill({ json: j })));
  await page.evaluate((id) => { __api.dispatchEvent(new CustomEvent("execution_start", { detail: { prompt_id: id } })); __api.dispatchEvent(new CustomEvent("execution_success", { detail: { prompt_id: id } })); }, R.cont);
  await settle(1800);
  R.contTake = await page.evaluate(async (id) => { const t = __T.get(`take-${id}`); return t && { parent: t.parent, stale: await __T.stale(t), label: __SC.label(t), group: t.group }; }, R.cont);
  R.contTree = await strip();
  await page.screenshot({ path: path.join(out, "132-u59-continued-version.png") });
  // 10. a saved workflow file is never swapped: Add this workflow (from its tab) copies it into the scene in a new tab
  await call("start_recipe", {}); await settle(1200);
  R.saved = await call("save_workflow", { name: `snap scene test ${stamp}` });
  const before = await page.evaluate(async (n) => (await __api.getUserData(`workflows/snap scene test ${n}.json`)).text(), stamp);
  await page.click(".snap-scene.scratch button:last-child"); await settle(500);
  R.adoptSheet = await page.evaluate(() => [...document.querySelectorAll(".snap-scenes-sheet button")].map((x) => x.textContent));
  await page.evaluate(() => [...document.querySelectorAll(".snap-scenes-sheet .snap-scene-row:last-child button")].find((x) => x.textContent === "Add this workflow").click()); await settle(2500);
  R.adoptFile = await state();
  R.fileUnchanged = before === await page.evaluate(async (n) => (await __api.getUserData(`workflows/snap scene test ${n}.json`)).text(), stamp);
  R.savedTabKept = await page.evaluate((n) => { const w = app.extensionManager.workflow.getWorkflowByPath(`workflows/snap scene test ${n}.json`); return !!w && !w.activeState?.extra?.snap_scene && !w.isModified; }, stamp);
  R.final = await call("get_scene", { scene });
  R.list = await call("list_scenes", {});
  await page.screenshot({ path: path.join(out, "133-u59-three-shots.png") });
  // phone width: the bar stays inside the page
  await page.setViewportSize({ width: 390, height: 844 }); await settle(600);
  R.phone = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth <= innerWidth, bar: document.querySelector(".snap-scene").getBoundingClientRect().width <= innerWidth }));
  await page.screenshot({ path: path.join(out, "134-u59-phone.png") });
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_scenes_result.json"), JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(e); fs.writeFileSync(path.join(out, "test_scenes_result.json"), JSON.stringify(R, null, 1)); process.exit(1); });
