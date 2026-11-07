// G1 item 1 (U99 / short03 F-C17, F-C19, F-C22; SNAP-R84) on the CPU test server: location records.
// - short03's village imported (import_village_location.py --port): list_locations gives its master, plan, 4 camera
//   marks and 6 plates with poses and the takes/frames they came from; get_record reads it at a version;
// - apply_location puts the master, the plan and the named plates into References as <Picture n> (cite says which),
//   pins location:location-village@1 and switches the preset to Ref2V; applying it again with other plates replaces them;
// - add_plate from a still take with a pose makes v2; save_location takes a take's frame as its master;
// - a New view (edit_from_context) cites a plate by name: Load Image of the plate's file, the location pinned;
// - dependents (F-C22): takes pinned to v1 are listed as stale with the rerun that re-makes them on the newest;
// - check_identity on any take against a Cast (F-C19): the identity graph scores the Cast's picture against the take's
//   frames (first, middle, last by default), one to one;
// - the Library's location card opens the Location sheet: master, plan with camera marks, plate tiles; every picture
//   opens full size; ticking plates + "Use in this shot" applies them; open_view {view: location} opens it for the person.
// Screens: ui/g1/location_sheet.png, location_full.png, location_library.png. usage: node test_g1_location.js [port 8195]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g1");
const base = CFG.base;
const SETTEI = CFG.fixture("short03", "settei_bg");
// P-H3-Image's files as empty placeholders (parked afterwards, moved, never deleted); SAM 3.1 listed as a GPU machine
// lists it and the identity graphs answered with fixed faces (test_u101_faces.js's way): nothing runs
const FILES = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"];
const unit = (i) => Array.from({ length: 8 }, (_, k) => (k === i ? 1 : 0));
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const snap = path.join(base, "user", "default", "snap"); // an earlier run's locations are parked (moved, never deleted)
  if (fs.existsSync(path.join(snap, "location"))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, "location"), path.join(snap, "_parked", `location-${Date.now()}`)); }
  fs.mkdirSync(path.join(base, "output", "snaptest"), { recursive: true });
  fs.copyFileSync(path.join(SETTEI, "plates", "Pd_houses.png"), path.join(base, "output", "snaptest", "g1_still.png"));
  R.import = JSON.parse(execFileSync("python3", ["-I", path.join(__dirname, "import_village_location.py"), "--port", port]).toString());
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.route(/\/api\/experiment\/models\/checkpoints$/, async (r) => { const res = await r.fetch(), list = await res.json(); r.fulfill({ response: res, json: [...list, { name: "sam3.1_multiplex_fp16.safetensors", pathIndex: 0, modified: 0, size: 1e9 }] }); });
    const A = await F.open(b, port, { context: ctx }), page = A.page;
    const prompts = [];
    let fakes = 0;
    await page.route(/\/(api\/)?prompt$/, (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      const body = JSON.parse(r.request().postData()), g = body.prompt;
      prompts.push(body);
      if (!Object.values(g).some((x) => x.class_type === "MAISnapIdentity")) return r.fallback();
      const id = `fake-faces-${++fakes}`, outputs = {};
      for (const [k, x] of Object.entries(g)) if (x.class_type === "MAISnapIdentity") outputs[k] = { faces: [[unit(0)]], characters: [[unit(0)]], boxes: [[[0.3, 0.2, 0.1, 0.15]]], hair_l90: [50], images: [{ filename: `${k}_face.png`, subfolder: "snaptest", type: "input" }] };
      page.__fake = { ...(page.__fake ?? {}), [id]: { status: { status_str: "success", completed: true, messages: [] }, outputs } };
      return r.fulfill({ json: { prompt_id: id, number: 1, node_errors: {} } });
    });
    await page.route(/\/(api\/)?history\/fake-faces-\d+$/, (r) => { const id = r.request().url().split("/").pop(); return r.fulfill({ json: page.__fake?.[id] ? { [id]: page.__fake[id] } : {} }); });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); const L = await import("/extensions/ComfyUI-MAINodes/snap/library.js"); await W.load(); await L.ready(); });
    R.list = await call("list_locations", {});
    const v = R.list?.[0];
    R.listed = v && { name: v.name, plates: v.plates.map((p) => [p.name, p.pose?.heading, p.from?.take?.slice(0, 13), p.from?.frame]), cameras: v.cameras.map((c) => c.name), master: v.master?.file, plan: v.plan?.file };
    R.get = await call("get_record", { ref: "location:location-village@1" });
    // fixtures: a still and a video take of this tab, a Cast with a picture
    R.fix = await page.evaluate(async () => {
      const T = window.__T, group = app.graph.id;
      const mk = (id, number, media, prompt, world) => ({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 9, group, number, status: "success", text: "g1", seed: 1, media, prompt, graph: { extra: { snap: { world } } }, world, verdict: null, notes: [] });
      await T.save(mk("take-g1-still", 951, [{ kind: "image", filename: "g1_still.png", subfolder: "snaptest", type: "output" }], {}, { "location:location-village": { n: 1, name: "Village" } }));
      await T.save(mk("take-g1-video", 952, [{ kind: "video", filename: "u73_00027_.mp4", subfolder: "snaptest", type: "output" }], { 1: { class_type: "X", inputs: { width: 64, height: 64, length: 107 } } }, { "location:location-village": { n: 1, name: "Village" } }));
      return group;
    });
    R.cast = await call("save_cast", { name: "G1 Maren", refs: [{ file: "snap/location/village/Pb_gate_inside_open.png", role: "identity: front" }] });
    // apply_location on the video recipe
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    R.apply = await call("apply_location", { location: "location:location-village", plates: ["Pb gate inside, open", "Pc square + well"] });
    R.refs1 = await page.evaluate(() => window.__E.references().pictures.map((p) => [p.cite, p.role]));
    R.pin1 = await page.evaluate(() => window.__E.state().world?.["location:location-village"]);
    R.preset = await page.evaluate(() => String(window.__E.getValue("preset", "preset", "conditioning") ?? ""));
    R.apply2 = await call("apply_location", { location: "location:location-village@1", plates: ["Pd houses"], plan: false });
    R.refs2 = await page.evaluate(() => window.__E.references().pictures.map((p) => [p.cite, p.role]));
    R.badPlate = await call("apply_location", { location: "location:location-village", plates: ["Pz nowhere"] });
    // F-C28: the shot's camera vs the place
    R.cam = await call("apply_location", { location: "location:location-village", plates: ["Pb gate inside, open", "Pc square + well"], camera: "Pb gate inside, open" });
    R.camRoles = await page.evaluate(() => window.__E.references().pictures.map((p) => p.role));
    R.badCam = await call("apply_location", { location: "location:location-village", plates: ["Pc square + well"], camera: "Pd houses" });
    // add_plate from a still, save_location with a take's frame as master
    R.add = await call("add_plate", { location: "location:location-village", name: "Pe well close", take: "take-g1-still", pose: { x: 0.5, y: 0.4, heading: 45, eye_height: 1.6, lens: 35 }, use: "C5 insert" });
    R.v2 = (await call("list_locations", {}))?.[0];
    R.frameMaster = await call("save_location", { name: "G1 frame test", master: { take: "take-g1-video", frame: 30 }, plates: [{ name: "a", take: "take-g1-video", frame: 60 }] });
    R.frameRec = (await call("list_locations", {}))?.find((x) => x.name === "G1 frame test");
    R.badPose = await call("save_location", { name: "bad", plates: [{ name: "x", file: "snap/location/village/Pd_houses.png", pose: { x: 2 } }] });
    // a New view cites a plate by name
    const n0 = prompts.length;
    R.view = await call("edit_from_context", { pictures: [{ location: "location:location-village", plate: "Pb gate inside, open" }, { location: "location:location-village" }], prompt: "the gate from the square, <Picture 1>", seeds: [7], method: "ph3_view", land: "tab" });
    for (let i = 0; i < 40 && prompts.length === n0; i++) await page.waitForTimeout(100);
    const vg = prompts[n0];
    R.viewGraph = vg && { loads: Object.values(vg.prompt).filter((x) => x.class_type === "LoadImage").map((x) => x.inputs.image), world: vg.extra_data?.extra_pnginfo?.workflow?.extra?.snap?.world?.["location:location-village"]?.n ?? vg.extra_data?.snap_parent?.options?.context?.[0]?.location };
    // dependents (F-C22)
    R.deps = await call("dependents", { ref: "location:location-village" });
    // check_identity on any take against a Cast (F-C19)
    const n1 = prompts.length;
    R.idVideo = await call("check_identity", { take: "take-g1-video", cast: R.cast.cast });
    const ig = prompts.slice(n1).find((x) => Object.values(x.prompt).some((y) => y.class_type === "MAISnapIdentity"));
    R.idGraph = ig && { identity: Object.values(ig.prompt).filter((y) => y.class_type === "MAISnapIdentity").length, frames: Object.values(ig.prompt).filter((y) => y.class_type === "ImageFromBatch").map((y) => y.inputs.batch_index).sort((a, c) => a - c),
      cast: Object.values(ig.prompt).filter((y) => y.class_type === "LoadImage").map((y) => y.inputs.image) };
    R.idStill = await call("check_identity", { take: "take-g1-still", cast: [R.cast.cast] });
    R.idBad = await call("check_identity", { take: "take-g1-video" });
    // the Library card and the Location sheet
    await page.evaluate(() => window.__X.callTool("ui", { action: "close" }).catch(() => {}));
    await page.fill(".snap-rail input[type=search], .snap-rail input", "Village").catch(() => {});
    await page.waitForTimeout(1200);
    R.card = await page.evaluate(() => [...document.querySelectorAll(".snap-card")].map((c) => c.textContent).find((t) => /Location/.test(t)) ?? null);
    await page.screenshot({ path: path.join(out, "location_library.png"), clip: { x: 0, y: 0, width: 560, height: 1000 } });
    R.open = await call("open_view", { view: "location", location: "location:location-village" });
    await page.waitForTimeout(2500);
    R.sheet = await page.evaluate(() => { const s = document.querySelector(".snap-loc-sheet"); return s && { title: s.querySelector("header strong")?.textContent, plates: s.querySelectorAll(".snap-loc-plate").length, marks: s.querySelectorAll(".snap-loc-dot").length, wedges: s.querySelectorAll(".snap-loc-wedge").length, full: s.querySelectorAll(".snap-full").length, text: s.textContent }; });
    await page.screenshot({ path: path.join(out, "location_sheet.png") });
    await page.click(".snap-loc-sheet .snap-loc-plate img"); await page.waitForTimeout(800);
    R.lightbox = await page.evaluate(() => document.querySelector(".snap-lb-what")?.textContent ?? null);
    await page.screenshot({ path: path.join(out, "location_full.png") });
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    // tick two plates and Use in this shot
    const boxes = await page.$$(".snap-loc-sheet .snap-loc-pick input[type=checkbox]");
    await boxes[0].check(); await boxes[4].check();
    await page.click(".snap-loc-sheet button.snap-primary:has-text('Use in this shot')"); await page.waitForTimeout(1500); // the critic block's Re-run dependents is a primary press too
    R.used = await page.evaluate(() => window.__E.references().pictures.map((p) => p.role));
    R.status = await page.evaluate(() => document.querySelector(".snap-loc-sheet [role=status]")?.textContent ?? null);
    R.errors = [...A.errors];
  } finally {
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `g1loc-${Date.now()}`);
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
  const ids = (x) => JSON.stringify(x);
  const checks = {
    "the village imports as location:location-village@1": R.import.ref === "location:location-village@1" && R.import.made,
    "list_locations: master, plan, 4 camera marks, 6 plates with poses and their takes/frames": R.listed?.cameras.length === 4 && R.listed.plates.length === 6 && R.listed.plates.every(([, h, t]) => h != null && /^take-/.test(t)) && R.listed.plates[1][3] === 60 && /MASTER/.test(R.listed.master) && /village_cameras/.test(R.listed.plan),
    "get_record reads it at a version": R.get?.ref === "location:location-village@1" && R.get.body?.plates?.length === 6,
    "apply_location: master, plan, two plates as <Picture 1-4>, cite says which": ids(R.refs1?.map((x) => x[0])) === ids(["<Picture 1>", "<Picture 2>", "<Picture 3>", "<Picture 4>"]) && R.apply?.cite?.master === "<Picture 1>" && R.apply.cite.plan === "<Picture 2>" && R.apply.cite.plates?.["Pc square + well"] === "<Picture 4>",
    "it pins the version and the preset reads pictures": R.pin1?.n === 1 && ids(R.pin1.placed?.plates) === ids(["Pb gate inside, open", "Pc square + well"]) && /^Ref2V/.test(R.preset),
    "applying again replaces its pictures (plan left out, other plate)": R.refs2?.length === 2 && /master/.test(R.refs2[0][1]) && /plate Pd houses/.test(R.refs2[1][1]),
    "a plate it hasn't is refused, naming its plates": /no plate "Pz nowhere"/.test(R.badPlate?.error ?? "") && /Pa road outside/.test(R.badPlate.error),
    "F-C28: camera names the framing kept, the rest show the place, and prompt_hint words it": R.cam?.use?.["plate Pb gate inside, open"] === "camera" && R.cam.use["plate Pc square + well"] === "place" && R.cam.use.master === "place"
      && R.camRoles?.some((r) => /plate Pb gate inside, open \(camera\)$/.test(r)) && /<Picture 1> is this shot's camera: keep its framing\. <Picture 2>, <Picture 4> show the place/.test(R.cam.prompt_hint ?? "") && /set plan from above/.test(R.cam.prompt_hint) && /camera names the picture/.test(R.badCam?.error ?? ""),
    "add_plate from a still with a pose makes v2": R.add?.version === 2 && R.v2?.head === 2 && R.v2.plates.length === 7 && R.v2.plates.find((p) => p.name === "Pe well close")?.from?.take === "take-g1-still" && R.v2.plates.find((p) => p.name === "Pe well close").pose.heading === 45,
    "save_location saves a take's frame as the master, with where it came from": R.frameRec?.master?.from?.frame === 30 && /take-g1-video_f30\.png$/.test(R.frameRec.master.file) && R.frameRec.plates[0].from.frame === 60,
    "a pose off the plan is refused saying the units": /fraction of the plan/.test(R.badPose?.error ?? ""),
    "a New view cites a plate by name and pins the location": !R.view?.error && R.viewGraph?.loads?.[0] === "snap/location/village/Pb_gate_inside_open.png" && R.viewGraph.loads[1] === "snap/location/village/MASTER.png",
    // G4 (SNAP-R140): the still became v2's own plate, so it is named in left_out, not stale
    "dependents lists the takes on v1 as stale, with the rerun to the newest": R.deps?.head === 2 && R.deps.stale.some((s) => s.take === "take-g1-video") && R.deps.stale.every((s) => s.n === 1 && s.rerun?.swaps?.["location:location-village"]?.to === "latest") && R.deps.versions.find((x) => x.n === 1)?.takes.some((t) => t.take === "take-g1-still" && t.kind === "still") && R.deps.left_out?.some((x) => x.take === "take-g1-still"),
    "check_identity on a video take vs a Cast: first, middle, last frame, one to one": R.idGraph?.identity === 6 && R.idVideo?.casts?.[0]?.lowest === 1 && ids(R.idGraph.frames) === ids([0, 53, 106]) && R.idGraph.cast.includes("snap/location/village/Pb_gate_inside_open.png") && R.idVideo?.frames?.length === 3 && R.idVideo.casts?.[0]?.name === "G1 Maren",
    "check_identity on a still; without a cast it says what it takes": R.idStill?.frames?.length === 1 && /take and cast/.test(R.idBad?.error ?? ""),
    "the Library shows the location card": /Location: Village/.test(R.card ?? ""),
    "the Location sheet: master, plan with camera marks, 7 plate tiles, all full-size": !!R.sheet && /Location: Village · The Gate Price · v2/.test(R.sheet.title) && R.sheet.plates === 7 && R.sheet.marks === 11 && R.sheet.wedges === 11 && R.sheet.full >= 9 && !/\bnull\b|undefined|\[object/.test(R.sheet.text),
    "a plate opens full size with its source": /plate Pa road outside/.test(R.lightbox ?? "") && /take-922daba6/.test(R.lightbox ?? ""),
    "ticking plates + Use in this shot applies them": R.used?.some((r) => /plate Pa road outside/.test(r)) && R.used.some((r) => /plate Pc square/.test(r)) && /in References/.test(R.status ?? ""),
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g1loc ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
