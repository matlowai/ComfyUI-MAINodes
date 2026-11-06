// G2 polish on the CPU test server (UX walkthrough UI-07 v0, UI-10, UI-18/B4, F-A33, F-A34; SNAP-R125):
// - the empty state has a second door, "Start a picture", that opens the stills kit;
// - the stills Render shows size chips; "16:9" sets 1536×864;
// - ▶ Play scene plays each shot's ★ take in order (a still held 2 s, then the next), its strip lights the current shot;
// - a video take's note box is at least 48 px tall at 1600 and 390 px (B4); no horizontal scroll at 390 px;
// - get_take gives prompts {positive, negative}; set_widget takes a brick's node key (picture_<n>).
// Screens: ui/g2/empty_two_doors.png, still_sizes.png, play_scene.png, viewer_note_1600.png, phone_scenes.png,
// phone_shot.png, phone_viewer.png. usage: node test_g2_polish.js [port] [base]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {}, out = path.join(CFG.out, "ui", "g2");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const snap = path.join(base, "user", "default", "snap");
  for (const d of ["takes", "scenes"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d}-${Date.now()}`)); }
  fs.mkdirSync(path.join(base, "output", "snaptest"), { recursive: true });
  const vid = CFG.fixture("e2e_refs3_00001_.mp4");
  if (fs.existsSync(vid) && !fs.existsSync(path.join(base, "output", "snaptest", "g2_clip.mp4"))) fs.copyFileSync(vid, path.join(base, "output", "snaptest", "g2_clip.mp4"));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    // empty state: two doors
    await page.evaluate(async () => { await app.extensionManager.command.execute("Comfy.NewBlankWorkflow"); }); await page.waitForTimeout(1500);
    R.doors = await page.evaluate(() => [...document.querySelectorAll(".snap-empty .snap-primary")].map((x) => x.textContent));
    await page.screenshot({ path: path.join(out, "empty_two_doors.png") });
    await page.evaluate(() => document.querySelector(".snap-start-still")?.click()); await page.waitForTimeout(3500);
    R.still = await page.evaluate(() => ({ bricks: window.__E.state().bricks.map((b) => b.key), chips: [...document.querySelectorAll(".snap-size-chips .snap-chip")].map((x) => x.textContent) }));
    await page.evaluate(() => [...document.querySelectorAll(".snap-size-chips .snap-chip")].find((x) => x.textContent === "16:9")?.click()); await page.waitForTimeout(400);
    R.size = await page.evaluate(() => [window.__E.getValue("image", "image", "width"), window.__E.getValue("image", "image", "height")]);
    await page.screenshot({ path: path.join(out, "still_sizes.png") });
    // a scene with two shots, a still and a video as their takes
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    const sc = await call("create_scene", { name: "G2 play" }), sid = sc.scene ?? sc.id;
    const s1 = (await call("add_shot", { scene: sid, name: "the well" })).shot.id, s2 = (await call("add_shot", { scene: sid, name: "the walk" })).shot.id;
    await call("open_shot", { scene: sid, shot: s1 }); await page.waitForTimeout(1500);
    const mk = (id, n, media) => page.evaluate(async ([id, n, media, sid]) => { const T = window.__T, SC = window.__SC, prompt = (await app.graphToPrompt()).output;
      await T.save({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 9, group: app.graph.id, number: n, status: "success", text: "x", seed: 1, media, prompt, graph: app.graph.serialize(), world: {}, verdict: null, notes: [] });
      await SC.saveOpen(); await SC.setActive(sid, SC.current().shot.id, id); }, [id, n, media, sid]);
    await mk("take-g2-p1", 1, [{ kind: "image", filename: "Pd_houses.png", subfolder: "snap/location/village", type: "input" }]);
    await call("open_shot", { scene: sid, shot: s2 }); await page.waitForTimeout(1500);
    await call("set_setting", { brick: "render", name: "prompt", value: "integrated_multimodal_description: [Shot 1] A woman in a red coat walks to the well." });
    await mk("take-g2-p2", 1, [{ kind: "video", filename: "g2_clip.mp4", subfolder: "snaptest", type: "output" }]);
    await page.waitForTimeout(1200);
    R.got = await call("get_take", { take: "take-g2-p2" });
    R.setw = await call("set_widget", { node: "render", name: "noise_seed", value: 77 });
    await call("ui", { action: "snap" }); await page.waitForTimeout(600);
    await page.evaluate(() => document.querySelector(".snap-play-scene")?.click()); await page.waitForTimeout(700);
    R.play1 = await page.evaluate(() => ({ img: !!document.querySelector(".snap-player-stage img"), on: document.querySelector(".snap-player-tile.on")?.textContent }));
    await page.screenshot({ path: path.join(out, "play_scene.png") });
    await page.waitForTimeout(2600);
    R.play2 = await page.evaluate(() => ({ video: !!document.querySelector(".snap-player-stage video"), on: document.querySelector(".snap-player-tile.on")?.textContent }));
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    // the video viewer's note box
    await call("ui", { action: "snap" }); await page.waitForTimeout(600);
    await call("ui", { action: "open_take", target: "take-g2-p2" }); await page.waitForTimeout(1500);
    R.note1600 = await page.evaluate(() => document.querySelector(".snap-take-sheet .snap-note-input")?.getBoundingClientRect().height ?? null);
    await page.screenshot({ path: path.join(out, "viewer_note_1600.png") });
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(800);
    R.note390 = await page.evaluate(() => document.querySelector(".snap-take-sheet .snap-note-input")?.getBoundingClientRect().height ?? null);
    await page.evaluate(() => document.querySelector(".snap-take-sheet .snap-note-input")?.scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "phone_viewer.png") });
    R.hscrollViewer = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, "phone_shot.png") });
    await call("ui", { action: "scenes" }); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(out, "phone_scenes.png") });
    R.hscroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    R.errors = [...A.errors];
  } finally { await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {}); await b.close(); } // LESSONS G1b: leave "Let agents run" off for the next suite
  const checks = {
    "UI-10: the empty state has 'Start a picture' beside the video start": R.doors?.includes("Start from Dials + Pika Simple") && R.doors.includes("Start a picture"),
    "UI-10: Start a picture opens the stills Render with size chips; 16:9 sets 1536×864": R.still?.bricks.includes("image") && R.still.chips.includes("16:9") && JSON.stringify(R.size) === "[1536,864]",
    "UI-07: Play scene starts on shot 1's still, then plays shot 2's video": R.play1?.img && /the well/.test(R.play1.on ?? "") && R.play2?.video && /the walk/.test(R.play2.on ?? ""),
    "B4: the video viewer's note box is at least 48 px at 1600 and 390": R.note1600 >= 48 && R.note390 >= 48,
    "F-A33: get_take gives prompts by role": typeof R.got?.prompts?.positive === "string" && /red coat/.test(R.got.prompts.positive) && R.got.prompts.negative !== R.got.prompts.positive,
    "F-A34: set_widget takes the brick's node key": !R.setw?.error,
    "no horizontal scroll at 390 px": R.hscroll <= 0 && R.hscrollViewer <= 0,
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g2polish ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
