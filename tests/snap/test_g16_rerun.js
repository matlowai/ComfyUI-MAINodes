// Batch G16 S13, F-AD05 (SNAP-R214 extended): a re-run whose swap can't go into the take's own recipe is refused before
// the take's graph opens, on the CPU test server: a take whose record names Maren (take.world) while its saved recipe pins
// nobody, re-run swapping Maren for Liesl:
// - the answer refuses, naming the pin the recipe lacks, and says nothing was opened or saved;
// - the shot's files and the open tab stay exactly as they were (before G16 the take's graph was opened and saved over
//   the shot, then the swap threw).
// usage: node test_g16_rerun.js [port] [base]   prints "g16rerun n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g16rerun-${Date.now()}`)); } };
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
(async () => {
  for (const d of ["scenes", "takes", "cast", "proposals.json"]) park(d); // moved, never deleted
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const maren = (await call("save_cast", { name: "Maren", details: "a tall swordswoman" })).cast, liesl = (await call("save_cast", { name: "Liesl", details: "a girl in a red scarf" })).cast;
    const sc = await call("create_scene", { name: "G16 rerun" }), scene = sc.scene?.id ?? sc.id ?? sc.scene;
    const shot = (await call("add_shot", { scene, name: "The gate" })).shot?.id;
    await call("open_shot", { scene, shot });
    await page.waitForTimeout(1500);
    R.take = await page.evaluate(async ({ scene, shot, maren }) => {
      const graph = structuredClone(app.graph.serialize()); graph.extra = { ...(graph.extra ?? {}), snap: { world: {} } }; graph.nodes = graph.nodes.length ? graph.nodes : [{ id: 1, type: "EmptyImage", pos: [0, 0], size: [200, 100], flags: {}, order: 0, mode: 0, inputs: [], outputs: [], properties: {}, widgets_values: [64, 64, 1, 0] }];
      await window.__T.save({ id: "take-g16rr", kind: "run", prompt_id: "g16rr", created: Date.now(), seconds: 20, group: graph.id ?? "g16rr", number: 1, status: "success", text: "g16 rerun", seed: 1, media: [{ kind: "image", filename: "x.png", subfolder: "snaptest_g16rerun", type: "output" }], notes: [], prompt: {}, graph, world: { [maren]: { n: 1, name: "Maren" } } });
      await window.__SC.addGroup(scene, shot, graph.id ?? "g16rr");
      return { nodes: app.graph.nodes.length };
    }, { scene, shot, maren });
    const dir = path.join(base, "user", "default", "snap", "scenes", scene), files = () => (fs.existsSync(dir) ? fs.readdirSync(dir).sort().map((f) => [f, sha(path.join(dir, f))]) : []);
    const before = JSON.stringify(files()), graphBefore = await page.evaluate(() => JSON.stringify(app.graph.serialize().nodes.map((n) => [n.id, n.type, n.widgets_values])));
    R.rerun = await call("rerun", { take: "take-g16rr", swaps: { [maren]: { to: liesl } } });
    await page.waitForTimeout(1500);
    R.same = JSON.stringify(files()) === before && before !== "[]";
    R.graphSame = (await page.evaluate(() => JSON.stringify(app.graph.serialize().nodes.map((n) => [n.id, n.type, n.widgets_values])))) === graphBefore;
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R;
  const checks = {
    "the re-run is refused, naming the pin the take's recipe lacks, and nothing was opened or saved": /isn't pinned in the take's own recipe \(its pins: none\)\. Nothing was opened or saved/.test(S.rerun?.error ?? ""),
    "the shot's files stay as they were": S.same === true,
    "the open tab stays as it was": S.graphSame === true,
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify(R, null, 1));
  console.log(`g16rerun ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
