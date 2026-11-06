// short03 F-C31 (the F-A17 / F-C27 family) on the CPU test server, as the repro: a scene chain C3 → C5 → C6.
// C3 holds Maren; C5 is added and opened from C3 (a copy of its recipe) and holds Liesl; C6 likewise holds Tam.
// - a shot copied from another starts without its Casts (no pin, no LoRA row, no line, no pictures) and says so;
// - setting the prompt brings back only a Cast still in use here, so the queued prompt names only this cut's Cast;
// - a take whose prompt has a Cast's line without its pictures shows "in the prompt without its pictures".
// usage: node test_g1_chain.js [port 8195]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
const base = CFG.base;
(async () => {
  const snap = path.join(base, "user", "default", "snap");
  for (const d of ["location", "takes", "cast", "scenes"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d}-${Date.now()}`)); } // an earlier run's, moved
  execFileSync("python3", ["-I", path.join(__dirname, "import_village_location.py"), "--port", port]); // pictures in input/
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const prompts = [];
    await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") prompts.push(JSON.parse(r.request().postData())); r.fallback(); });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const cast = async (name, file, details) => (await call("save_cast", { name, details, lora: null, refs: [{ file, role: "identity: front" }] })).cast;
    const maren = await cast("Maren", "snap/location/village/Pa_road_outside.png", "a tall swordswoman with a long braid");
    const liesl = await cast("Liesl", "snap/location/village/Pb_gate_inside_open.png", "a village girl in a red shawl");
    const tam = await cast("Tam", "snap/location/village/Pc_square_well.png", "a small boy with a wooden toy");
    const sc = await call("create_scene", { name: "G1 chain" }), sid = sc.scene ?? sc.id;
    const add = async (name) => { const s = await call("add_shot", { scene: sid, name }); return s.shot?.id ?? s.id; };
    const state = () => page.evaluate(() => ({ world: Object.keys(window.__E.state().world ?? {}), pics: window.__E.references()?.pictures.map((p) => p.role) ?? [], prompt: window.__E.getValue("render", "render", "prompt") }));
    const runOne = async (words) => { await call("set_setting", { brick: "render", name: "prompt", value: words }); const n = prompts.length; const r = await call("run", { question: words });
      for (let i = 0; i < 40 && prompts.length === n; i++) await page.waitForTimeout(100); const g = prompts[n]?.prompt ?? {};
      return { r, text: Object.values(g).flatMap((x) => Object.values(x.inputs ?? {})).filter((v) => typeof v === "string").join(" | ") }; };
    const c3 = await add("C3"); R.open3 = await call("open_shot", { scene: sid, shot: c3 }); await page.waitForTimeout(1500);
    await call("apply_cast", { cast: maren }); R.s3 = await state(); R.run3 = await runOne("[Shot 1] Maren at the gate");
    const c5 = await add("C5"); R.open5 = await call("open_shot", { scene: sid, shot: c5 }); await page.waitForTimeout(1500);
    R.s5copy = await state();
    await call("apply_cast", { cast: liesl }); R.run5 = await runOne("[Shot 1] Liesl at the well");
    const c6 = await add("C6"); R.open6 = await call("open_shot", { scene: sid, shot: c6 }); await page.waitForTimeout(1500);
    R.s6copy = await state();
    await call("apply_cast", { cast: tam }); R.run6 = await runOne("[Shot 1] Tam by the houses");
    // a Cast left in the prompt after its pictures went: the take says so
    await call("remove_ref", { picture: 1 }); R.pictureless = await runOne("[Shot 1] Tam by the houses, again");
    R.landed = await page.evaluate(async (id) => { for (let i = 0; i < 120; i++) { const t = window.__T.all().find((x) => x.prompt_id === id); if (t) return t.world; await new Promise((r) => setTimeout(r, 500)); } return null; }, R.pictureless.r?.run);
    R.errors = [...A.errors];
  } finally { await b.close(); }
  const only = (run, who, not) => run?.text?.includes(who) && not.every((x) => !run.text.includes(x));
  const checks = {
    "C3 runs with Maren": only(R.run3, "long braid", ["red shawl", "wooden toy"]),
    "C5, a copy of C3, starts without Maren (pin, line, picture) and says so": !R.s5copy.world.some((x) => x.startsWith("cast:")) && !R.s5copy.pics.some((p) => /Maren/.test(p)) && !/long braid/.test(R.s5copy.prompt ?? "") && /without Maren/.test(R.open5?.said ?? ""),
    "C5's prompt names only Liesl": only(R.run5, "red shawl", ["long braid", "wooden toy"]),
    "C6 starts without Liesl and runs with only Tam": !R.s6copy.world.some((x) => x.startsWith("cast:")) && only(R.run6, "wooden toy", ["long braid", "red shawl"]),
    "a Cast whose pictures left References doesn't come back into the prompt": !/wooden toy/.test(R.pictureless?.text ?? "x"),
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g1chain ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
