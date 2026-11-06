// G3 (SNAP-R134, the operator's decision 5) on a CPU test server: the redraw's eye line and the optional Keep eye colour.
// - a stage 2 redraw that pins a Cast with a picture: get_take says to compare the eyes with that Cast's picture; the take
//   viewer shows the same line, a press that opens the Cast picture and a "Keep eye colour" press; a plain take has neither;
// - keep_eye_colour queues SAM 3.1 on the redraw and on the Cast front with the same words, the re-tint at the strength
//   asked, and saves a new take whose parent is the redraw (method eyecolour); the redraw stays;
// - on a take that isn't a stage 2 redraw it is refused, saying it runs after stage 2.
// SAM 3.1 is listed as a GPU machine lists it; the graphs run as 64 px CPU stand-ins (fwork.js). Screens in ui/g3/.
// usage: node test_g3_eyes.js [port] [base]   prints "g3eyes n/m" last
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, out = path.join(CFG.out, "ui", "g3"), R = {};
const SETTEI = CFG.fixture("short03", "settei_bg");
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d}-g3e-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  ["takes", "cast", "critiques"].forEach(park);
  for (const d of ["input", "output"]) fs.mkdirSync(path.join(base, d, "snaptest"), { recursive: true });
  fs.copyFileSync(path.join(SETTEI, "plates", "Pc_square_well.png"), path.join(base, "input", "snaptest", "g3_cast_front.png"));
  fs.copyFileSync(path.join(SETTEI, "plates", "Pd_houses.png"), path.join(base, "output", "snaptest", "g3_redraw.png"));
  fs.copyFileSync(path.join(SETTEI, "plates", "Pa_road_outside.png"), path.join(base, "output", "snaptest", "g3_plain.png"));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.route(/\/api\/experiment\/models\/checkpoints$/, async (r) => { const res = await r.fetch(), list = await res.json(); r.fulfill({ response: res, json: [...list, { name: "sam3.1_multiplex_fp16.safetensors", pathIndex: 0, modified: 0, size: 1e9 }] }); });
    const A = await F.open(b, port, { context: ctx }), page = A.page, graphs = [];
    await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { const body = JSON.parse(r.request().postData()); if (Object.values(body.prompt).some((x) => x.class_type === "MAISnapEyeColour")) graphs.push(body); } return r.fallback(); });
    const call = (name, args) => page.evaluate(async ([n, x]) => window.__X.callTool(n, x).catch((e) => ({ error: e.message })), [name, args]);
    R.cast = await (await fetch(`http://127.0.0.1:${port}/mainodes/snap/world/save`, { method: "POST", body: JSON.stringify({ kind: "cast", id: "g3eyes", body: { name: "G3 Hiyori", details: "calm brown eyes", refs: [{ file: "snaptest/g3_cast_front.png", role: "identity: front" }] }, by: "agent" }) })).json();
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); });
    await page.evaluate(async () => {
      const T = window.__T, mk = (id, number, file, extra) => ({ id, kind: "run", prompt_id: id.slice(5), created: Date.now() + number, finished: Date.now() + number, seconds: 9, group: app.graph.id, number, status: "success", text: "Hiyori sweeps the shrine steps",
        media: [{ kind: "image", filename: file, subfolder: "snaptest", type: "output" }], notes: [], prompt: {}, graph: { nodes: [], extra: {} }, world: { "cast:g3eyes": { n: 1, name: "G3 Hiyori" } }, ...extra });
      await T.save(mk("take-g3eyes-orbit", 1, "g3_plain.png", {}));
      await T.save(mk("take-g3eyes-redraw", 2, "g3_redraw.png", { parent: { take: "take-g3eyes-orbit", method: "upscale/stage2", options: { denoise: 0.3 } } }));
      await T.save(mk("take-g3eyes-plain", 3, "g3_plain.png", { world: {} }));
    });
    R.get = await call("get_take", { take: "take-g3eyes-redraw" });
    R.getPlain = await call("get_take", { take: "take-g3eyes-plain" });
    R.getOrbit = await call("get_take", { take: "take-g3eyes-orbit" });
    await call("ui", { action: "open_take", target: "take-g3eyes-redraw" }); await page.waitForTimeout(1500);
    R.viewer = await page.evaluate(() => { const s = document.querySelector(".snap-take-sheet"); const line = [...(s?.querySelectorAll(".snap-take-copyline") ?? [])].find((x) => /Eye colour/.test(x.textContent)); return line && { text: line.textContent, buttons: [...line.querySelectorAll("button")].map((x) => x.textContent) }; });
    await page.evaluate(() => [...document.querySelectorAll(".snap-take-copyline")].find((x) => /Eye colour/.test(x.textContent))?.scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "g3_eye_line.png") });
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    R.refused = await call("keep_eye_colour", { take: "take-g3eyes-plain" });
    await page.evaluate(async () => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true));
    const n0 = await page.evaluate(() => window.__T.all().length);
    R.run = await call("keep_eye_colour", { take: "take-g3eyes-redraw", strength: 0.6 });
    R.landed = await page.evaluate(async (n) => { const T = window.__T; for (let i = 0; i < 240 && T.all().length < n + 1; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, 500)); const t = T.all().at(-1); return t && { id: t.id, parent: t.parent, world: t.world }; }, n0);
    R.graph = graphs[0];
    R.errors = A.errors;
  } finally { await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {}); await b.close(); }
  const g = R.graph?.prompt ?? {}, nodes = Object.values(g), sams = nodes.filter((x) => x.class_type === "SAM3_Detect"), e = nodes.find((x) => x.class_type === "MAISnapEyeColour");
  const words = sams.map((s) => g[s.inputs.conditioning[0]].inputs.text).sort();
  const masked = (k) => g[k]?.class_type === "MaskComposite" && g[k].inputs.operation === "and" && ["eye:2", "pupil:2, iris of the eye:2"].every((t) => [g[k].inputs.destination[0], g[k].inputs.source[0]].some((s) => g[g[s].inputs.conditioning[0]].inputs.text === t));
  const checks = {
    "get_take on a stage 2 redraw that pins a Cast says to compare the eyes with its picture": /^Eye colour can shift in the redraw: compare the eyes with G3 Hiyori's Cast picture\. Keep eye colour \(optional\)/.test(R.get?.eyes?.said ?? "") && R.get.eyes.casts?.[0]?.picture === "snaptest/g3_cast_front.png",
    "the orbit it came from and a plain take carry no eye line": !R.getOrbit?.eyes && !R.getPlain?.eyes,
    "the take viewer shows the line, the Cast picture press and Keep eye colour": /compare the eyes with G3 Hiyori's Cast picture/.test(R.viewer?.text ?? "") && JSON.stringify(R.viewer.buttons) === JSON.stringify(["G3 Hiyori's picture", "Keep eye colour"]),
    "keep_eye_colour on a take that isn't a stage 2 redraw is refused, saying so": /isn't a stage 2 redraw: keep eye colour runs after stage 2/.test(R.refused?.error ?? ""),
    "SAM 3.1 runs on the redraw and on the Cast front with the same words (eye:2 AND the iris words)": sams.length === 4 && JSON.stringify(words) === JSON.stringify(["eye:2", "eye:2", "pupil:2, iris of the eye:2", "pupil:2, iris of the eye:2"]) && masked(e?.inputs.masks[0]) && masked(e?.inputs.reference_mask[0]) && nodes.some((x) => x.class_type === "LoadImage" && x.inputs.image === "snaptest/g3_cast_front.png") && nodes.some((x) => x.class_type === "CheckpointLoaderSimple" && /sam3/.test(x.inputs.ckpt_name)),
    "the re-tint gets the frames' masks, the Cast front and its mask, at the strength asked": e?.inputs.strength === 0.6 && g[e.inputs.masks[0]]?.class_type === "MaskComposite" && g[e.inputs.reference_mask[0]]?.class_type === "MaskComposite" && g[e.inputs.reference[0]]?.inputs.image === "snaptest/g3_cast_front.png",
    "it saves a new take whose parent is the redraw (eyecolour), with the redraw's pins": R.graph?.extra_data?.snap_parent?.method === "eyecolour" && R.landed?.parent?.take === "take-g3eyes-redraw" && R.landed.parent.method === "eyecolour" && /keep eye colour is running on take/i.test(R.run?.said ?? ""),
    "no page errors": !R.errors?.length,
  };
  R.checks = checks;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g3_eyes_result.json"), JSON.stringify(R, null, 1));
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  console.log(`g3eyes ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
