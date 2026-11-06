// G2: short04's dogfood findings F-D02, F-D04, F-D05, F-D06, F-D08, F-D10 on the CPU test server.
// - F-D06: apply_location {plates: [P], camera: P} puts the camera plate first (<Picture 1>), the master and map after;
// - F-D10: a plate whose eye height is off its camera mark's by > 0.2 m is flagged in list_locations, add_plate and on
//   the Location sheet; add_plate {plates: [...]} saves several as one version;
// - F-D08: apply_cast on a prompt that opens with a bare "subject_definitions:" header puts the details on the line under
//   it; describe_lora lists the caption files beside a LoRA; add_lora takes role motion (on Style LoRAs);
// - F-D05: in a MOSS shot, apply_setup "Pika H3 Flex" never loads someone's "Last used: MiniMax H3" (its dial stays out),
//   says "still Shot n of <scene>", and names the tab after the shot; F-D02: start_recipe from a shot says the new tab
//   isn't in the scene and how to add it;
// - F-D04: a New view decision's title holds the whole prompt and the method.
// Screen: ui/g2/location_eye_gap.png. usage: node test_g2_fd.js [port] [base]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {}, out = path.join(CFG.out, "ui", "g2");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const snap = path.join(base, "user", "default", "snap");
  for (const d of ["location", "takes", "cast", "scenes", "cards"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d}-${Date.now()}`)); }
  const lora = path.join(base, "models", "loras", "g2test_orbit");
  fs.mkdirSync(path.join(lora, "prompts"), { recursive: true });
  // a neutral LoRA header (no trigger, no stamp): a copy of a test LoRA the privacy rules match would join their lock list
  const head = Buffer.from(JSON.stringify({ __metadata__: { name: "g2 orbit" }, w: { dtype: "F32", shape: [1], data_offsets: [0, 4] } })), len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(head.length));
  fs.writeFileSync(path.join(lora, "g2_orbit.safetensors"), Buffer.concat([len, head, Buffer.alloc(4)]));
  fs.writeFileSync(path.join(lora, "prompts", "orbit_caption.txt"), "subject_definitions:\n<Subject 1> is the character in <Picture 1>.\n\nsummary:\n[orbit] the camera circles the character once.");
  execFileSync("python3", ["-I", path.join(__dirname, "import_village_location.py"), "--port", port]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const refs = () => page.evaluate(() => window.__E.references().pictures.map((p) => [p.cite, p.role]));
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); });
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    await call("apply_setup", { name: "Pika + reference pictures" });
    // F-D06
    R.loc = await call("apply_location", { location: "location:location-village", plates: ["Pc square + well"], camera: "Pc square + well" });
    R.locRefs = await refs();
    // F-D10
    R.plate = await call("add_plate", { location: "location:location-village", plates: [
      { name: "Pa road outside", file: "snap/location/village/Pa_road_outside.png", pose: { x: 0.11, y: 0.78, heading: 38, eye_height: 1.0, lens: 24 }, camera: "P01/C1" },
      { name: "G2 extra", file: "snap/location/village/Pd_houses.png", pose: { x: 0.5, y: 0.5, heading: 90, eye_height: 1.6 } }] });
    R.list = (await call("list_locations", {})).find((x) => x.location === "location:location-village");
    await call("open_view", { view: "location", location: "location:location-village" }); await page.waitForTimeout(1200);
    R.sheetGap = await page.evaluate(() => [...document.querySelectorAll(".snap-loc-gap")].map((x) => x.textContent));
    await page.evaluate(() => document.querySelector(".snap-loc-gap")?.scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "location_eye_gap.png") });
    await page.keyboard.press("Escape"); await page.evaluate(() => document.querySelector(".snap-sheet .snap-x")?.click()); await page.waitForTimeout(300);
    // F-D08
    await call("set_setting", { brick: "render", name: "prompt", value: "subject_definitions:\n<Subject 1> is the character in <Picture 1>.\n\nsummary:\n[orbit] the camera circles the character once." });
    const cast = await call("save_cast", { name: "G2 Hiyori", details: "a shrine maiden in a red hakama", lora: null, refs: [{ file: "snap/location/village/Pa_road_outside.png", role: "identity: front" }] });
    await call("apply_cast", { cast: cast.cast });
    R.captionPrompt = await page.evaluate(() => window.__E.getValue("render", "render", "prompt"));
    R.describeLora = await call("describe_lora", { file: "g2test_orbit/g2_orbit.safetensors" });
    R.motion = await call("add_lora", { file: "g2test_orbit/g2_orbit.safetensors", role: "motion" });
    // F-D05 / F-D02: a Last used H3 card with a dial, then a MOSS shot switched to Pika H3 Flex by preset name
    const dials = await call("list_dials", {}); const dial = (dials.dials ?? dials ?? [])[0]; R.dialName = dial?.dial ?? dial?.file;
    await call("add_dial", { dial: R.dialName, strength: 1.2 });
    const setups = await call("list_setups", {}), moss = setups.find((x) => x.family === "MOSS-Image" && x.source === "recipe" && !/^Last used/.test(x.name));
    R.toMoss = await call("apply_setup", { name: moss.name, save_current: true }); await page.waitForTimeout(2000);
    R.lastUsed = (await call("list_setups", {})).map((x) => x.name).filter((x) => /^Last used/.test(x));
    const sc = await call("create_scene", { name: "G2 fd" }), sid = sc.scene ?? sc.id;
    R.adopt = await call("add_shot", { scene: sid, adopt: "open", name: "stills" }); await page.waitForTimeout(2000);
    R.switch = await call("apply_setup", { name: "Pika H3 Flex" }); await page.waitForTimeout(1500);
    R.afterSwitch = await page.evaluate(() => ({ family: window.__E.state().bricks.map((b) => b.key), dials: (() => { try { return JSON.parse(window.__E.getValue("rack", "rack", "rack") || "[]").length; } catch { return null; } })(), tab: app.extensionManager.workflow.activeWorkflow.filename }));
    R.start = await call("start_recipe", {}); await page.waitForTimeout(2000);
    // F-D04: a decision titled with the whole prompt
    const long = "2D cel-shaded Japanese TV anime background, the shrine path at dusk from a standing person's eye height, stone lanterns along the left";
    R.view = await call("edit_from_context", { pictures: [{ file: "snap/location/village/Pd_houses.png" }], prompt: long, method: "ph3_view", count: 1 }); // needs P-H3 weights (GPU unit)
    R.labels = await page.evaluate((p) => { const SC = window.__SC, t = { number: 3, parent: { method: "view/ph3_view", take: "x", options: { label: p } } }; return { whole: SC.label(t), short: SC.shortLabel(t) }; }, long);
    R.cands = await call("list_candidates", {});
    R.errors = [...A.errors];
  } finally { await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {}); await b.close(); } // LESSONS G1b: leave "Let agents run" off for the next suite
  const titles = JSON.stringify(R.cands ?? {});
  const checks = {
    "F-D06: the camera plate is <Picture 1>, the master and plan after it": /Pc square \+ well \(camera\)/.test(R.locRefs?.[0]?.[1] ?? "") && R.locRefs?.[0]?.[0] === "<Picture 1>" && /master/.test(R.locRefs?.[1]?.[1] ?? "") && R.loc?.cite?.plates?.["Pc square + well"] === "<Picture 1>",
    "F-D10: add_plate saves two plates as one version and answers the eye gap": R.plate?.made && Object.keys(R.plate?.eye_gaps ?? {}).length === 1 && /pose says eye 1 m, camera mark P01\/C1 says 1.6 m/.test(R.plate.eye_gaps["Pa road outside"] ?? ""), // G3 F-E18: typed numbers, said so
    "F-D10: list_locations and the Location sheet flag it": /0.6 m lower than planned by the typed numbers/.test(R.list?.eye_gaps?.["Pa road outside"] ?? "") && R.sheetGap?.length === 1 && /eye 1 m on the pose vs 1.6 m on mark P01\/C1 · typed/.test(R.sheetGap[0]),
    "F-D08: the Cast's details go on the line under a bare header": /^subject_definitions:\n<Subject 1> is the character in <Picture 1>\. a shrine maiden in a red hakama\.\n/.test(R.captionPrompt ?? ""),
    "F-D08: describe_lora lists the caption beside the LoRA, whole": R.describeLora?.beside?.some((x) => x.file === "prompts/orbit_caption.txt" && /\[orbit\] the camera circles the character once\./.test(x.text)),
    "F-D08: add_lora role motion goes on Style LoRAs": R.motion?.brick === "style",
    "F-D05: the MOSS shot switched by preset name keeps no 'Last used' dial and stays the shot": R.lastUsed?.includes("Last used: MiniMax H3") && R.afterSwitch?.dials === 0 && /still Shot 1 · stills of G2 fd/.test(R.switch?.shot ?? "") && !(R.switch?.carried ?? []).some((x) => /^dial/.test(x)) && /G2 fd · Shot 1 · stills/.test(R.afterSwitch?.tab ?? ""),
    "F-D02: start_recipe from a shot says the new tab isn't in the scene": R.start?.tab === "new" && /isn't part of G2 fd.*add_shot/.test(R.start?.not_in_scene ?? ""),
    "F-D04: agents read a take's label whole; the tile's short label ends in …": R.labels?.whole === `New view · ${"2D cel-shaded Japanese TV anime background, the shrine path at dusk from a standing person's eye height, stone lanterns along the left"}` && R.labels.short.length <= 60 && R.labels.short.endsWith("…")
      && (!R.view?.decision || titles.includes("stone lanterns along the left")),
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g2fd ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
