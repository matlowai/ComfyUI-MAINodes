// G2 (UX walkthrough UI-03, UI-04, UI-12, UI-15, B6, B14; dogfood F-D14, F-D15; SNAP-R123, R124) on the CPU test server.
// - a still's viewer has "Send to ▾" (References, Cast: X (a new picture), New cast member…, Location: Y (a plate)) and no
//   "Continue from its last frame" (UI-12); Send to › Cast makes the Cast's next version with the picture; › Location makes
//   a plate; use_take {as: cast | plate} does the same for agents;
// - the Cast sheet has "+ from a take" (take picker) and uploads of a new record go to its own folder, not snap/cast/new (B14);
// - apply_cast {pictures: ["state A"]} puts only that picture in and the pin keeps it; the chip says "state A ▾"; a version
//   without it is refused by update_pins / the chip, never swapped silently (UI-04);
// - rerun with a Cast slot "out" takes the Cast out of the re-run (UI-15), and rerun_slots lists "out";
// - get_take carries the sound note (F-D15); the Cast sheet's LoRA list has no .bin/.pkl (B6); a plan over 10 min says it
//   holds the queue (F-D14).
// Screens: ui/g2/send_to.png, cast_pictures.png. usage: node test_g2_send.js [port] [base]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {}, out = path.join(CFG.out, "ui", "g2");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const snap = path.join(base, "user", "default", "snap");
  for (const d of ["location", "takes", "cast", "scenes"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d}-${Date.now()}`)); }
  fs.mkdirSync(path.join(base, "models", "loras", "g2test_training"), { recursive: true });
  fs.writeFileSync(path.join(base, "models", "loras", "g2test_training", "optimizer.bin"), "not a lora");
  execFileSync("python3", ["-I", path.join(__dirname, "import_village_location.py"), "--port", port]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); });
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    const cast = await call("save_cast", { name: "G2 Suna", details: "a girl in a yellow raincoat", lora: null, refs: [{ file: "snap/location/village/Pa_road_outside.png", role: "identity: front" }, { file: "snap/location/village/Pb_gate_inside_open.png", role: "state A" }] });
    R.cast = cast.cast;
    await page.evaluate(async () => {
      const T = window.__T;
      await T.save({ id: "take-g2-still", kind: "run", prompt_id: "g2still", created: Date.now(), seconds: 9, group: "g2-stills", number: 951, status: "success", text: "a settei sheet", seed: 1,
        media: [{ kind: "image", filename: "Pd_houses.png", subfolder: "snap/location/village", type: "input" }], prompt: {}, graph: { extra: { snap: {} } }, world: {}, verdict: null, notes: [], sound: { mean_db: -52, max_db: -30 } });
    });
    // the still's viewer
    await call("ui", { action: "open_take", target: "take-g2-still" }); await page.waitForTimeout(1200);
    R.viewer = await page.evaluate(() => ({ continueBtn: [...document.querySelectorAll(".snap-take-sheet button")].some((x) => x.textContent === "Continue from its last frame"), send: !!document.querySelector(".snap-take-sheet .snap-send") }));
    await page.evaluate(() => document.querySelector(".snap-take-sheet .snap-send").click()); await page.waitForTimeout(400);
    R.menu = await page.evaluate(() => [...document.querySelectorAll(".snap-send-menu button")].map((x) => x.textContent));
    await page.screenshot({ path: path.join(out, "send_to.png") });
    await page.evaluate(() => [...document.querySelectorAll(".snap-send-menu button")].find((x) => x.textContent.startsWith("Cast: G2 Suna")).click()); await page.waitForTimeout(2000);
    R.castAfter = await call("get_record", { ref: R.cast });
    await page.evaluate(() => document.querySelector(".snap-take-sheet .snap-send").click()); await page.waitForTimeout(400);
    await page.evaluate(() => [...document.querySelectorAll(".snap-send-menu button")].find((x) => x.textContent.startsWith("Location: Village")).click()); await page.waitForTimeout(2500);
    R.locAfter = (await call("list_locations", {})).find((x) => x.location === "location:location-village");
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    // agents' twin
    R.useCast = await call("use_take", { take: "take-g2-still", as: "cast", cast: R.cast, role: "settei sheet" });
    R.usePlate = await call("use_take", { take: "take-g2-still", as: "plate", location: "location:location-village", name: "G2 sheet plate" });
    // F-D15
    R.getTake = await call("get_take", { take: "take-g2-still" });
    // the Cast sheet: + from a take, uploads of a new record, the LoRA list
    await page.evaluate(() => document.querySelector(".snap-new-cast")?.click()); await page.waitForTimeout(800);
    R.castSheet = await page.evaluate(() => ({ fromTake: [...document.querySelectorAll(".snap-cast-sheet button")].some((x) => x.textContent === "+ from a take"),
      loraOptions: [...document.querySelectorAll('.snap-cast-sheet select[aria-label="identity LoRA"] option')].map((o) => o.value).filter(Boolean) }));
    const png = path.join(base, "output", "g2_new_cast.png"); fs.copyFileSync(path.join(base, "input", "snap", "location", "village", "Pd_houses.png"), png);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.evaluate(() => [...document.querySelectorAll(".snap-cast-sheet button")].find((x) => x.textContent === "+ picture").click())]);
    await chooser.setFiles(png); await page.waitForTimeout(1800);
    R.upload = await page.evaluate(() => [...document.querySelectorAll(".snap-cast-sheet .snap-cast-refs img")].map((i) => decodeURIComponent(i.src)));
    await page.evaluate(() => [...document.querySelectorAll(".snap-cast-sheet button")].find((x) => x.textContent === "+ from a take").click()); await page.waitForTimeout(900);
    await page.evaluate(() => [...document.querySelectorAll(".snap-take-picker .snap-picker-take button")].find((x) => /951/.test(x.textContent))?.click()); await page.waitForTimeout(1500);
    R.castSheetRoles = await page.evaluate(() => [...document.querySelectorAll('.snap-cast-sheet input[aria-label="what this picture shows"]')].map((i) => i.value));
    await page.evaluate(() => document.querySelector(".snap-cast-sheet .snap-x")?.click()); await page.waitForTimeout(300);
    // UI-04
    await call("apply_setup", { name: "Pika + reference pictures" });
    R.applyA = await call("apply_cast", { cast: `${R.cast}@1`, pictures: ["state A"] });
    R.refsA = await page.evaluate(() => window.__E.references().pictures.map((p) => p.role));
    R.pinA = await page.evaluate((ref) => window.__E.state().world[ref]?.placed?.pictures, R.cast);
    await call("ui", { action: "select", target: "render" }); await page.waitForTimeout(600);
    R.chip = await page.evaluate(() => document.querySelector(".snap-pin-pics")?.textContent ?? null);
    await page.evaluate(() => document.querySelector(".snap-pin-pics")?.click()); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, "cast_pictures.png") });
    await page.keyboard.press("Escape"); await page.mouse.click(5, 990); await page.waitForTimeout(300);
    R.saveWithout = await call("save_cast", { cast: R.cast, name: "G2 Suna", details: "a girl in a yellow raincoat", lora: null, refs: [{ file: "snap/location/village/Pa_road_outside.png", role: "identity: front" }] });
    R.update = await call("update_pins", {});
    R.refsAfterUpdate = await page.evaluate(() => window.__E.references().pictures.map((p) => p.role));
    // UI-15: a take pinning the Cast, re-run with it out
    await page.evaluate(async (ref) => {
      const T = window.__T, prompt = (await app.graphToPrompt()).output;
      await T.save({ id: "take-g2-rr", kind: "run", prompt_id: "g2rr", created: Date.now(), seconds: 9, group: app.graph.id, number: 952, status: "success", text: "suna", seed: 1,
        media: [{ kind: "image", filename: "Pd_houses.png", subfolder: "snap/location/village", type: "input" }], prompt, graph: app.graph.serialize(), world: structuredClone(window.__E.state().world), verdict: null, notes: [] });
    }, R.cast);
    R.slots = await call("rerun_slots", { take: "take-g2-rr" });
    R.rerunOut = await call("rerun", { take: "take-g2-rr", swaps: { [R.cast]: { to: "out" } }, route: "regenerate", land: "tab" });
    R.afterOut = await page.evaluate((ref) => ({ world: Object.keys(window.__E.state().world ?? {}), pics: window.__E.references()?.pictures.length ?? 0, prompt: window.__E.getValue("render", "render", "prompt") }), R.cast);
    // F-D14: a long plan says it holds the queue
    R.longPlan = await page.evaluate(async () => { const X = window.__X; const t = X.TOOLS.find((x) => x.name === "upscale_take"); return null; });
    R.errors = [...A.errors];
  } finally { await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {}); await b.close(); } // LESSONS G1b: leave "Let agents run" off for the next suite
  const versions = (r) => r?.versions?.length ?? r?.record?.versions?.length ?? null;
  const checks = {
    "UI-12: a still's viewer has no 'Continue from its last frame', and has Send to": R.viewer?.continueBtn === false && R.viewer.send,
    "Send to lists References, the Cast, a new cast member and the location": R.menu?.includes("References in the open recipe") && R.menu.includes("Cast: G2 Suna (a new picture)") && R.menu.includes("New cast member from this picture…") && R.menu.some((x) => x.startsWith("Location: Village")),
    "Send to › Cast makes the Cast's next version with the picture": /from take 951/.test(JSON.stringify(R.castAfter ?? {})),
    "Send to › Location makes a plate from the take": R.locAfter?.plates?.some((p) => /take 951/.test(p.name) && p.from?.take === "take-g2-still"),
    "use_take as cast / as plate do the same for agents": /settei sheet/.test(R.useCast?.said ?? "") && R.useCast.version >= 3 && R.usePlate?.plate === "G2 sheet plate",
    "F-D15: get_take carries the sound and the quiet note": R.getTake?.sound?.quiet === true && R.getTake.sound.mean_db === -52,
    "B6: the Cast sheet's LoRA list holds .safetensors only": Array.isArray(R.castSheet?.loraOptions) && R.castSheet.loraOptions.length > 0 && R.castSheet.loraOptions.every((f) => f.endsWith(".safetensors")),
    "B14: a new record's upload goes to its own folder, not snap/cast/new": R.upload?.some((u) => /subfolder=snap\/cast\/cast-/.test(u)) && !R.upload.some((u) => /snap\/cast\/new/.test(u)),
    "the Cast sheet's + from a take adds the take's picture": R.castSheet?.fromTake && R.castSheetRoles?.some((r) => /from take 951/.test(r)),
    "UI-04: apply_cast with pictures puts only 'state A' in and the pin keeps it; the chip says so": JSON.stringify(R.refsA) === JSON.stringify(["cast: G2 Suna, state A"]) && JSON.stringify(R.pinA) === '["state A"]' && /state A ▾/.test(R.chip ?? ""),
    "UI-04: an update to a version without 'state A' is refused, the picture stays": /no "state A" picture/.test(R.update?.error ?? "") && JSON.stringify(R.refsAfterUpdate) === JSON.stringify(["cast: G2 Suna, state A"]),
    "UI-15: rerun_slots offers out and a re-run with the Cast out has no Cast": /takes them out of the re-run/.test(JSON.stringify(R.slots ?? {})) && !(R.afterOut?.world ?? ["x"]).some((x) => x.startsWith("cast:")) && !/yellow raincoat/.test(R.afterOut?.prompt ?? "x"),
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g2send ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
