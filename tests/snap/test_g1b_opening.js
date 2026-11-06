// G1b item 5 (short03 F-C32, SNAP-R115) on the CPU test server: a first frame combines with references.
// The repro: on the Pika H3 Flex (FL2V) recipe, use_take {as: first_frame}, then apply_cast with a picture: the preset
// switches to Pika + reference pictures (Ref2V), which reads no first frame, and the frame used to drop out. Now:
// - the First frame goes into References as <Picture 1> (role "first frame: the shot opens on it"), ahead of the Cast's
//   picture (<Picture 2>), wired into H3 References' first slot; apply_cast's answer says so;
// - back on FL2V (apply_setup) the copy goes and the Cast's picture is <Picture 1> again; Ref2V again brings it back;
// - a new First frame under Ref2V replaces the opening picture (use_take answers `opening`);
// - apply_location under it names the opening frame first in its prompt_hint;
// - the queued prompt's H3 References takes the frame as its first picture.
// Screen: ui/g1b/opening_references.png. usage: node test_g1b_opening.js [port 8195] [base dir]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g1b");
const base = process.argv[3] || CFG.base;
const SETTEI = CFG.fixture("short03", "settei_bg");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const snap = path.join(base, "user", "default", "snap");
  for (const d of ["location", "takes", "candidates"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d}-${Date.now()}`)); }
  fs.mkdirSync(path.join(base, "output", "snaptest"), { recursive: true });
  fs.copyFileSync(path.join(SETTEI, "plates", "Pd_houses.png"), path.join(base, "output", "snaptest", "g1b_eye_level.png"));
  fs.copyFileSync(path.join(SETTEI, "plates", "Pb_gate_inside_open.png"), path.join(base, "output", "snaptest", "g1b_eye_level_2.png"));
  execFileSync("python3", ["-I", path.join(__dirname, "import_village_location.py"), "--port", port]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); const L = await import("/extensions/ComfyUI-MAINodes/snap/library.js"); await W.load(); await L.ready(); });
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    await page.evaluate(async () => {
      const T = window.__T, group = app.graph.id, mk = (id, number, file) => ({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 9, group, number, status: "success", text: "eye level", seed: 1,
        media: [{ kind: "image", filename: file, subfolder: "snaptest", type: "output" }], prompt: {}, graph: { extra: { snap: { world: {} } } }, world: {}, verdict: null, notes: [] });
      await T.save(mk("take-g1b-eye", 971, "g1b_eye_level.png")); await T.save(mk("take-g1b-eye2", 972, "g1b_eye_level_2.png"));
    });
    const cond = () => page.evaluate(() => String(window.__E.getValue("preset", "preset", "conditioning") ?? ""));
    const refs = () => page.evaluate(() => window.__E.references().pictures.map((p) => [p.cite, p.role, p.file]));
    const slot0 = () => page.evaluate(() => { const b = window.__E.state().bricks.find((x) => x.key === "refs"), n = app.graph.getNodeById(b.nodes.refs), i = n.inputs.find((x) => x.name.startsWith("ref_images.")); const l = i?.link != null && app.graph.getLink(i.link); return l ? app.graph.getNodeById(l.origin_id).widgets.find((w) => w.name === "image").value : null; });
    R.before = await cond();
    R.cast = await call("save_cast", { name: "G1b Maren", lora: null, refs: [{ file: "snap/location/village/Pb_gate_inside_open.png", role: "identity: front" }] });
    R.first = await call("use_take", { take: "take-g1b-eye", as: "first_frame" });
    R.firstFile = await page.evaluate(() => window.__E.getValue("first_frame", "image", "image"));
    R.applied = await call("apply_cast", { cast: R.cast.cast });
    R.afterCast = { cond: await cond(), refs: await refs(), slot0: await slot0() };
    R.prompt = await page.evaluate(async () => { const o = (await app.graphToPrompt()).output, h = Object.values(o).find((n) => n.class_type === "H3References"), k = h && Object.keys(h.inputs).filter((x) => x.startsWith("ref_images.")).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0], src = k && o[h.inputs[k][0]];
      return { first: src?.inputs?.image ?? null, keys: h && Object.keys(h.inputs) }; });
    // back to FL2V, then Ref2V again
    const setups = await call("list_setups", {}), names = (setups?.setups ?? setups ?? []).map((s) => s.name);
    R.fl2v = await call("apply_setup", { name: "Pika H3 Flex" });
    R.afterFl2v = { cond: await cond(), refs: await refs() };
    R.ref2v = await call("apply_setup", { name: "Pika + reference pictures" });
    R.afterRef2v = { cond: await cond(), refs: await refs(), slot0: await slot0() };
    // a new first frame under Ref2V
    R.second = await call("use_take", { take: "take-g1b-eye2", as: "first_frame" });
    R.afterSecond = { refs: await refs(), slot0: await slot0() };
    R.loc = await call("apply_location", { location: "location:location-village", plates: ["Pc square + well"] });
    R.afterLoc = await refs();
    await call("ui", { action: "select", target: "refs" }); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, "opening_references.png") });
    const opening = (r) => r?.[0]?.[0] === "<Picture 1>" && r[0][1] === "first frame: the shot opens on it";
    const checks = {
      "the recipe starts on FL2V": /^FL2V/.test(R.before),
      "apply_cast switches to Ref2V and the First frame opens the shot as <Picture 1>, the Cast's picture <Picture 2>": /^Ref2V/.test(R.afterCast.cond) && opening(R.afterCast.refs) && R.afterCast.refs[0][2] === R.firstFile && R.afterCast.refs[1]?.[0] === "<Picture 2>" && /cast: G1b Maren/.test(R.afterCast.refs[1][1]) && R.afterCast.slot0 === R.firstFile,
      "apply_cast's answer says the First frame is <Picture 1> too": /Render Preset now Pika \+ reference pictures/.test(R.applied?.done ?? "") && /the First frame is <Picture 1> too, the opening frame/.test(R.applied?.done ?? ""),
      "the queued prompt's H3 References takes the frame first": R.prompt?.first === R.firstFile,
      "back on FL2V the copy goes; Ref2V brings it back first": /^FL2V/.test(R.afterFl2v.cond) && R.afterFl2v.refs.length === 1 && /cast: G1b Maren/.test(R.afterFl2v.refs[0][1]) && /^Ref2V/.test(R.afterRef2v.cond) && opening(R.afterRef2v.refs) && R.afterRef2v.slot0 === R.firstFile && R.afterRef2v.refs.length === 2,
      "a new First frame under Ref2V replaces the opening picture and says so": R.second?.opening === "<Picture 1>" && /opening frame/.test(R.second.said ?? "") && opening(R.afterSecond.refs) && R.afterSecond.refs[0][2] !== R.firstFile && R.afterSecond.refs.length === 2 && R.afterSecond.slot0 === R.afterSecond.refs[0][2],
      "apply_location names the opening frame first in its hint": R.loc?.opening === "<Picture 1>" && /^<Picture 1> is this shot's opening frame/.test(R.loc.prompt_hint ?? "") && opening(R.afterLoc),
      "the setups the test switches between exist": names.includes("Pika H3 Flex") && names.includes("Pika + reference pictures"),
      "no page errors": !A.errors.length,
    };
    console.log(JSON.stringify(R, null, 1));
    let bad = 0;
    for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
    console.log(`g1bopening ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
