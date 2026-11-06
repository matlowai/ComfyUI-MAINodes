// G2 (UX walkthrough UI-02/B7, dogfood F-D07, F-D12, F-D05 "Shot 0"; SNAP-R120) on the CPU test server: a new shot keeps
// the open shot's setup and none of its content; a copy is asked for.
// - Shot 1 holds a Cast, a hand-added picture (use_take), a first frame, a dial, a style LoRA row and a prompt;
// - "+ Shot ▾" offers "New shot: same setup, no characters or pictures" and "Copy Shot 1 as it is";
// - the new shot (the default) has the same Render Preset, and no pin, picture, first frame, dial, style row or prompt;
//   open_shot's `built` lists what it left out and names no "Shot 0";
// - a shot added with start: copy has all of it; add_shot refuses another start value naming the two.
// Screen: ui/g2/shot_menu.png. usage: node test_g2_shots.js [port] [base]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g2");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const state = () => page.evaluate(() => {
      const E = window.__E, has = (k) => E.state().bricks.some((b) => b.key === k);
      return { world: Object.keys(E.state().world ?? {}), pics: E.references()?.pictures.length ?? 0, prompt: E.getValue("render", "render", "prompt"),
        cond: String(E.getValue("preset", "preset", "conditioning") ?? ""), dials: has("rack") ? JSON.parse(E.getValue("rack", "rack", "rack") || "[]").length : 0,
        first: app.graph.getNodeById(E.state().bricks.find((b) => b.key === "first_frame")?.nodes.image)?.mode !== 4,
        style: (() => { const b = E.state().bricks.find((x) => x.key === "style"); return b ? Object.values(b.nodes).map((id) => app.graph.getNodeById(id)).flatMap((n) => n?.widgets ?? []).filter((w) => /\.lora$|lora_name|\.file$/.test(w.name) && w.value && w.value !== "None").length : 0; })() };
    });
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const sc = await call("create_scene", { name: "G2 shots" }), sid = sc.scene ?? sc.id;
    const s1 = (await call("add_shot", { scene: sid, name: "opening" })).shot.id;
    R.open1 = await call("open_shot", { scene: sid, shot: s1 }); await page.waitForTimeout(1500);
    await call("apply_setup", { name: "Pika + reference pictures" });
    const cast = await call("save_cast", { name: "G2 Hiyori", details: "a shrine maiden in red", lora: null, refs: [{ file: "snap/location/village/Pa_road_outside.png", role: "identity: front" }] });
    await call("apply_cast", { cast: cast.cast });
    await call("add_ref", { file: "snap/location/village/Pd_houses.png", role: "eye-level shrine still" });
    await page.evaluate(async () => {
      const T = window.__T, mk = { id: "take-g2-ff", kind: "run", prompt_id: "g2ff", created: Date.now(), seconds: 9, group: "g2-ff", number: 941, status: "success", text: "a frame", seed: 1,
        media: [{ kind: "image", filename: "Pc_square_well.png", subfolder: "snap/location/village", type: "input" }], prompt: {}, graph: { extra: { snap: { world: {} } } }, world: {}, verdict: null, notes: [] };
      await T.save(mk);
    });
    R.ff = await call("use_take", { take: "take-g2-ff", as: "first_frame" });
    const dials = await call("list_dials", {}); const dial = (dials.dials ?? dials ?? [])[0]?.dial ?? (dials.dials ?? dials ?? [])[0]?.file;
    R.dial = await call("add_dial", { dial, strength: 1.2 });
    const loras = await call("list_loras", { role: "style" }); const style = (loras.loras ?? loras ?? []).find((x) => x.name || x.file);
    R.style = style ? await call("add_lora", { file: style.file ?? style.name, role: "style" }) : { skipped: "no style LoRA on this server" };
    await call("set_setting", { brick: "render", name: "prompt", value: "integrated_multimodal_description: [Shot 1] Hiyori walks to the shrine in <Picture 2>." });
    R.s1 = await state();
    // the menu
    await page.evaluate(() => [...document.querySelectorAll(".snap-scene button")].find((x) => x.textContent === "+ Shot").click()); await page.waitForTimeout(500);
    R.menu = await page.evaluate(() => [...document.querySelectorAll(".snap-scene-menu button")].map((x) => x.textContent));
    await page.screenshot({ path: path.join(out, "shot_menu.png") });
    await page.evaluate(() => [...document.querySelectorAll(".snap-scene-menu button")].find((x) => x.textContent.startsWith("New shot")).click());
    await page.waitForTimeout(3500);
    R.s2 = await state();
    R.toast2 = await page.evaluate(() => document.querySelector(".snap-toast")?.textContent ?? "");
    // back to shot 1, then an agent's clean shot and a copy
    await call("open_shot", { scene: sid, shot: s1 }); await page.waitForTimeout(1500);
    const s3 = (await call("add_shot", { scene: sid, name: "clean by tool" })).shot.id;
    R.open3 = await call("open_shot", { scene: sid, shot: s3 }); await page.waitForTimeout(1500);
    R.s3 = await state();
    await call("open_shot", { scene: sid, shot: s1 }); await page.waitForTimeout(1500);
    const s4 = (await call("add_shot", { scene: sid, name: "copy", start: "copy" })).shot.id;
    R.open4 = await call("open_shot", { scene: sid, shot: s4 }); await page.waitForTimeout(1500);
    R.s4 = await state();
    R.bad = await call("add_shot", { scene: sid, start: "half" });
    R.errors = [...A.errors];
  } finally { await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {}); await b.close(); } // LESSONS G1b: leave "Let agents run" off for the next suite
  const clean = (s) => s && s.world.length === 0 && s.pics === 0 && !s.first && s.dials === 0 && s.style === 0 && !s.prompt;
  const checks = {
    "shot 1 holds a Cast, two pictures, a first frame, a dial and a prompt": R.s1?.world.some((x) => x.startsWith("cast:")) && R.s1.pics >= 2 && R.s1.first && R.s1.dials === 1 && /Hiyori/.test(R.s1.prompt ?? ""),
    "+ Shot offers a new shot with the setup and a copy of Shot 1": R.menu?.[0] === "New shot: same setup, no characters or pictures" && R.menu.includes("Copy Shot 1 · opening as it is"),
    "the menu's new shot keeps the Render Preset and nothing of the content": /^Ref2V/.test(R.s2?.cond ?? "") && clean(R.s2),
    "add_shot's default is clean too, and built says what it left out (no 'Shot 0')": clean(R.s3) && /Shot 1 · opening's setup, without G2 Hiyori/.test(R.open3?.built ?? "") && /left out: .*reference picture.*first frame/.test(R.open3?.built ?? "") && /dial/.test(R.open3.built) && /prompt/.test(R.open3.built) && !/Shot 0/.test(JSON.stringify([R.open3, R.open4])),
    "start: copy keeps everything": R.s4?.world.some((x) => x.startsWith("cast:")) && R.s4.pics === R.s1.pics && R.s4.first && R.s4.dials === 1 && R.s4.prompt === R.s1.prompt && /as it is/.test(R.open4?.built ?? ""),
    "another start value is refused naming the two": /"clean".*"copy"/.test(R.bad?.error ?? ""),
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g2shots ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
