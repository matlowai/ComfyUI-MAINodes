// U62 on the CPU server: scenes polish. A card shot whose camera has no plate (the lamp room's OTS on Ferro, the set
// given a wide plate) offers that camera's plate candidates when it is opened, as a proposal with its plan (never a
// render, one per set and camera however often it opens); a shot is renamed and taken out of its scene from its ⋯ menu
// (its workflow file stays, the scene file keeps it under removed); an agent's remove waits as a proposal; a scene is
// renamed in the Scenes sheet and deleted there: its document is parked in snap/scenes/_parked/, its shot workflows
// stay, and the toast says so; the setups sheet in a scene tab says another family opens a scratch tab. Never queues.
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"), R = {};
const HOST = `http://127.0.0.1:${CFG.port}`;
async function upload(file, name) {
  const form = new FormData();
  form.append("image", new Blob([fs.readFileSync(file)]), name);
  form.append("subfolder", "snaptest"); form.append("overwrite", "true");
  const r = await (await fetch(`${HOST}/upload/image`, { method: "POST", body: form })).json();
  return `${r.subfolder}/${r.name}`;
}
const userdata = async (p) => { const r = await fetch(`${HOST}/userdata/${encodeURIComponent(p)}`); return r.status === 200 ? { status: 200, json: await r.json() } : { status: r.status }; };
(async () => {
  const plate = await upload(CFG.fixture("u21/plate.png"), "u21_plate.png");
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { q++; return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${HOST}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    for (const [k, f] of Object.entries({ X: "tools", SC: "scenes", P: "proposals", T: "takes" })) window[`__${k}`] = await import(`/extensions/ComfyUI-MAINodes/snap/${f}.js`);
    app.graph.clear(); app.graph.extra = {};
    snap.toggle();
  });
  await page.waitForTimeout(1200);
  const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  const settle = (ms = 900) => page.waitForTimeout(ms);
  const toast = () => page.$eval(".snap-toast", (e) => e.textContent);
  const SET = "set-lamp-room-end-s3", stamp = Date.now().toString(36);
  R.wide = (await call("set_set_plate", { set: SET, camera: "wide", image: plate })).plate?.by;
  const scene = (await call("create_scene", { name: `Lamp room ${stamp}`, set: SET })).id;
  const letter = (await call("add_shot", { scene, card: "shot-letter" })).shot.id;
  const spare = (await call("add_shot", { scene, name: "Spare" })).shot.id;

  // 1. opening the card shot: its camera has no plate, so its candidates are offered as a proposal with the plan
  R.offer = await call("open_shot", { scene, shot: letter }); await settle();
  R.pending = await page.evaluate(() => __P.pending().map((p) => ({ tool: p.tool, args: p.args, renders: p.plan?.renders, reason: p.reason })));
  R.pill = await page.$eval(".snap-proposals", (e) => e.textContent).catch(() => null);
  await page.screenshot({ path: path.join(out, "136-u62-plate-offer.png") });
  // the person opens the spare shot, then the card shot again from its tile: the same proposal, and the toast says so
  await page.click(`.snap-shot-tile[data-shot="${spare}"]`); await settle(1500);
  await page.click(`.snap-shot-tile[data-shot="${letter}"]`); await settle(600);
  R.toast = await toast();
  await settle(900);
  R.pendingAgain = await page.evaluate(() => __P.pending().filter((p) => p.tool === "make_set_plates").length);
  R.queued = q;

  // 2. rename the open shot from its ⋯ menu
  await page.hover(`.snap-shot-tile[data-shot="${letter}"]`);
  await page.click(`.snap-shot-tile[data-shot="${letter}"] .snap-shot-more`); await settle(300);
  await page.fill('.snap-scene-menu input[aria-label="shot name"]', "The letter, over Ferro");
  await page.screenshot({ path: path.join(out, "137-u62-shot-menu.png") });
  await page.click('.snap-scene-menu .snap-primary'); await settle();
  R.renamed = await page.evaluate(([s, x]) => ({ name: __SC.get(s).shots.find((y) => y.id === x).name, tile: document.querySelector(`.snap-shot-tile[data-shot="${x}"] figcaption strong`)?.textContent, tab: app.extensionManager.workflow.activeWorkflow.filename }), [scene, letter]);
  R.toastRename = await toast();

  // 3. take the spare shot out of the scene: confirm once, nothing deleted
  await page.hover(`.snap-shot-tile[data-shot="${spare}"]`);
  await page.click(`.snap-shot-tile[data-shot="${spare}"] .snap-shot-more`); await settle(300);
  await page.click('.snap-scene-menu button:has-text("Remove from the scene")'); await settle(200);
  await page.screenshot({ path: path.join(out, "138-u62-remove-shot.png") });
  const spareFile = await page.evaluate(([s, x]) => __SC.get(s).shots.find((y) => y.id === x).workflow, [scene, spare]);
  await page.click(".snap-scene-menu .snap-danger"); await settle();
  R.removedToast = await toast();
  const doc = await userdata(`snap/scenes/${scene}.json`);
  R.afterRemove = { shots: doc.json.shots.map((x) => x.id), removed: (doc.json.removed ?? []).map((x) => [x.id, x.name, x.removed.by]), tiles: await page.$$eval(".snap-shot-tile", (t) => t.length),
    workflowKept: spareFile ? (await userdata(spareFile)).status : "no workflow" };
  // an agent's remove waits for the person
  R.agentRemove = await call("remove_shot", { scene, shot: letter, reason: "test" });

  // 4. the setups sheet in a scene tab says where another family goes
  await call("ui", { action: "setups" }); await settle(800);
  R.setupNote = await page.$eval(".snap-setup-scene", (e) => e.textContent).catch(() => null);
  R.setupTabs = await page.$$eval(".snap-setup-card em.tab", (x) => [...new Set(x.map((e) => e.textContent))]);
  await page.screenshot({ path: path.join(out, "139-u62-setups-in-scene.png") });
  await page.keyboard.press("Escape"); await settle(300);

  // 5. rename the scene in the Scenes sheet, then delete it there
  await page.click('.snap-scene-top button:has-text("Scenes")'); await settle(500);
  const row = `.snap-scene-row[data-scene="${scene}"]`;
  await page.click(`${row} button:has-text("Rename")`); await settle(200);
  await page.fill(`${row} input[aria-label="scene name"]`, `Lamp room, night ${stamp}`); await page.keyboard.press("Enter"); await settle();
  R.sceneRenamed = { file: (await userdata(`snap/scenes/${scene}.json`)).json.name, row: await page.$eval(`${row} .snap-scene-name strong`, (e) => e.textContent), crumb: await page.$eval(".snap-scene .snap-crumb", (e) => e.textContent) };
  await page.click(`${row} button:has-text("Delete")`); await settle(200);
  R.confirm = await page.$eval(`${row} .snap-scene-acts`, (e) => e.textContent);
  await page.screenshot({ path: path.join(out, "140-u62-delete-scene.png") });
  const shotFile = await page.evaluate(([s, x]) => __SC.get(s).shots.find((y) => y.id === x).workflow, [scene, letter]);
  await page.click(`${row} .snap-danger`); await settle(1200);
  R.deletedToast = await toast();
  const parked = await userdata(`snap/scenes/_parked/${scene}.json`);
  R.deleted = { original: (await userdata(`snap/scenes/${scene}.json`)).status, parked: parked.status, parkedBy: parked.json?.parked?.by, parkedShots: parked.json?.shots.length, shotFile: (await userdata(shotFile)).status,
    listed: await page.evaluate((s) => __SC.all().some((x) => x.id === s), scene), row: await page.$(row).then((x) => !!x), bar: await page.evaluate(() => document.querySelector(".snap-scene")?.className) };
  // the agent's remove_shot proposal about the deleted scene is withdrawn, not left to fail when accepted
  R.withdrawn = await page.evaluate(() => ({ all: __P.all().filter((p) => p.tool === "remove_shot").map((p) => [p.status, p.result]), shown: [...document.querySelectorAll(".snap-proposal .snap-proposal-what")].map((e) => e.textContent) }));
  await page.screenshot({ path: path.join(out, "141-u62-scene-deleted.png") });
  await page.keyboard.press("Escape"); await settle(300);

  // 6. agents rename directly
  const other = (await call("create_scene", { name: `Spare scene ${stamp}` })).id;
  R.agentRename = await call("rename_scene", { scene: other, name: `Renamed by agent ${stamp}` });
  R.blankName = await call("rename_scene", { scene: other, name: "  " });
  R.queue = (await (await fetch(`${HOST}/queue`)).json()).queue_pending.length;
  R.queued = q;
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_u62_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
