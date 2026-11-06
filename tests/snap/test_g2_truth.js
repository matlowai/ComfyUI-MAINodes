// G2 (UX walkthrough UI-09, B3, B10; dogfood F-A19/F-A30; SNAP-R122) on the CPU test server: the shot shows what made its
// ★ take, and browsing never writes.
// - a shot whose ★ take was made by its current recipe shows no line; open_shot says recipe_matches_active: true;
// - after a prompt edit the line says the recipe isn't what made ★ Take 1 (Render.prompt) and open_shot / run say so;
// - "Load ★ take's recipe" puts the take's recipe back and the line goes; "Keep editing" hides it;
// - opening shot A → B → A with no edits writes nothing (no POST to /api/userdata/), where an edit then a switch writes.
// Screen: ui/g2/shot_truth.png. usage: node test_g2_truth.js [port] [base]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {}, out = path.join(CFG.out, "ui", "g2");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const snap = path.join(base, "user", "default", "snap");
  for (const d of ["takes", "scenes"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d}-${Date.now()}`)); }
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const writes = [];
    await page.route(/\/api\/userdata\//, (r) => { if (r.request().method() === "POST") writes.push(decodeURIComponent(r.request().url().split("/userdata/")[1].split("?")[0])); r.fallback(); });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const line = () => page.evaluate(() => { const x = document.querySelector(".snap-shot-truth"); return x && !x.hidden ? x.textContent : null; });
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const sc = await call("create_scene", { name: "G2 truth" }), sid = sc.scene ?? sc.id;
    const a = (await call("add_shot", { scene: sid, name: "A" })).shot.id, bb = (await call("add_shot", { scene: sid, name: "B" })).shot.id;
    await call("open_shot", { scene: sid, shot: a }); await page.waitForTimeout(1500);
    await call("set_setting", { brick: "render", name: "prompt", value: "integrated_multimodal_description: [Shot 1] A lantern sways over the shrine path." });
    // Take 1 of shot A, made by this very recipe
    await page.evaluate(async (sid) => {
      const T = window.__T, SC = window.__SC, prompt = (await app.graphToPrompt()).output, h = await T.hashes(T.canonical(prompt));
      await T.save({ id: "take-g2-truth", kind: "run", prompt_id: "g2truth", created: Date.now(), seconds: 9, group: app.graph.id, number: 1, status: "success", text: "lantern", seed: 1,
        media: [{ kind: "image", filename: "Pd_houses.png", subfolder: "snap/location/village", type: "input" }], prompt, graph: app.graph.serialize(), world: {}, verdict: null, notes: [], ...h });
      await SC.saveOpen();
      await SC.setActive(sid, SC.current().shot.id, "take-g2-truth");
    }, sid);
    await page.waitForTimeout(1500);
    R.clean = { line: await line(), open: await call("open_shot", { scene: sid, shot: a }) };
    // browsing: A → B → A with no edits
    await call("open_shot", { scene: sid, shot: bb }); await page.waitForTimeout(1500);
    await call("open_shot", { scene: sid, shot: a }); await page.waitForTimeout(1500);
    R.diffA = await page.evaluate(async () => {
      const SC = window.__SC, here = SC.current(), saved = await (await fetch(`/api/userdata/${encodeURIComponent(here.shot.workflow)}`)).json(), now = app.graph.serialize();
      const strip = (g) => { g = JSON.parse(JSON.stringify(g)); delete g.extra?.snap_scene; for (const n of g.nodes) n.size = [0, 0]; return g; };
      const x0 = strip(saved), y0 = strip(now), out = [];
      const walk = (x, y, p) => { if (JSON.stringify(x) === JSON.stringify(y)) return; if (x && y && typeof x === "object" && typeof y === "object") { for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) walk(x[k], y[k], `${p}.${k}`); } else out.push(`${p}: ${JSON.stringify(x)?.slice(0, 80)} -> ${JSON.stringify(y)?.slice(0, 80)}`); };
      walk(x0, y0, ""); return { shot: here.shot.id, equal: app.extensionManager.workflow.activeWorkflow.changeTracker.constructor.graphEqual(x0, y0), groups: here.shot.groups, id: now.id, out: out.slice(0, 12) };
    });
    writes.length = 0;
    await call("open_shot", { scene: sid, shot: bb }); await page.waitForTimeout(1500);
    R.writesAfterB = [...writes];
    await call("open_shot", { scene: sid, shot: a }); await page.waitForTimeout(1500);
    R.browseWrites = [...writes];
    await call("set_setting", { brick: "render", name: "prompt", value: "integrated_multimodal_description: [Shot 1] A lantern falls." });
    await page.waitForTimeout(1500);
    R.edited = { line: await line(), open: await call("open_shot", { scene: sid, shot: a }) };
    await page.screenshot({ path: path.join(out, "shot_truth.png") });
    await page.evaluate(() => [...document.querySelectorAll(".snap-shot-truth button")].find((x) => x.textContent.startsWith("Load"))?.click());
    await page.waitForTimeout(3000);
    R.loaded = { line: await line(), prompt: await page.evaluate(() => window.__E.getValue("render", "render", "prompt")) };
    writes.length = 0;
    await call("set_setting", { brick: "render", name: "prompt", value: "integrated_multimodal_description: [Shot 1] A lantern glows." });
    await call("open_shot", { scene: sid, shot: bb }); await page.waitForTimeout(1500);
    R.editWrites = [...writes];
    // Keep editing hides the line for that shot
    await call("open_shot", { scene: sid, shot: a }); await page.waitForTimeout(1800);
    R.beforeKeep = await line();
    await page.evaluate(() => [...document.querySelectorAll(".snap-shot-truth button")].find((x) => x.textContent === "Keep editing")?.click());
    await call("set_setting", { brick: "render", name: "prompt", value: "integrated_multimodal_description: [Shot 1] A lantern glows brighter." }); await page.waitForTimeout(1500);
    R.afterKeep = await line();
    R.errors = [...A.errors];
  } finally { await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {}); await b.close(); } // LESSONS G1b: leave "Let agents run" off for the next suite
  const checks = {
    "a shot whose recipe made its ★ take shows no line and says so": R.clean?.line == null && R.clean.open?.recipe_matches_active === true,
    "after an edit the line names what differs, and open_shot says so": /This recipe isn't what made ★ Take 1: Render\.prompt differs/.test(R.edited?.line ?? "") && R.edited.open?.recipe_matches_active === false && /take-g2-truth/.test(R.edited.open?.recipe_differs ?? ""),
    "Load ★ take's recipe puts the take's prompt back and the line goes": /lantern sways/.test(R.loaded?.prompt ?? "") && R.loaded.line == null,
    "browsing A → B → A with no edits writes nothing": Array.isArray(R.browseWrites) && R.browseWrites.length === 0,
    "an edit then a switch saves the edited shot": R.editWrites?.some((f) => /^snap\/scenes\//.test(f)),
    "Keep editing hides the line for that shot": !!R.beforeKeep && R.afterKeep == null,
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g2truth ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
