// G2: the Agent library after a tweak (dogfood F-D09), remove_lora by file (F-D12), run's cache_hit (F-D13).
// - save_instruction replaces pack:save_location/build-location-set-plan (as short04 did): the pack note's row in the
//   Instructions list reads "overridden by yours", and Applies here (this recipe) lists the tool notes apart, saying one is
//   replaced by yours; open_view {view: library} opens it for the person;
// - turning the tweak off gives back the stack hash from before the tweak (an off note that replaces nothing isn't hashed);
// - remove_lora {file} takes the row off whichever stack holds it;
// - run with the same recipe and seed as an earlier take answers cache_hit naming that take.
// Screens: ui/g2/library_replaced.png, library_tools.png. usage: node test_g2_misc.js [port] [base]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {}, out = path.join(CFG.out, "ui", "g2");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const snap = path.join(base, "user", "default", "snap");
  for (const d of ["instruction", "instructions.json", "_archived/instruction", "takes"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d.replace("/", "_")}-${Date.now()}`)); }
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port, { viewport: { width: 1280, height: 900 } }), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    R.hashBefore = (await call("instructions", { scope: "tool:save_location" })).hash;
    R.saved = await call("save_instruction", { scope: "tool:save_location", mode: "replace", supersedes: ["pack:save_location/build-location-set-plan"], text: "Start the walkthrough from an eye-level first frame; words never set the height." });
    R.hashOn = (await call("instructions", { scope: "tool:save_location" })).hash;
    R.open = await call("open_view", { view: "library", tab: "notes" }); await page.waitForTimeout(800);
    R.packRow = await page.evaluate(() => [...document.querySelectorAll(".snap-al-note.struck")].map((x) => ({ layer: x.querySelector(".snap-al-chip")?.textContent, why: x.querySelector(".snap-al-why")?.textContent ?? null }))[0] ?? null);
    await page.evaluate(() => document.querySelector(".snap-al-note.struck")?.scrollIntoView({ block: "center" })); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "library_replaced.png") });
    R.openHere = await call("open_view", { view: "library" }); await page.waitForTimeout(1200);
    R.toolsSummary = await page.evaluate(() => document.querySelector(".snap-al-tools summary")?.textContent ?? null);
    await page.evaluate(() => { const d = document.querySelector(".snap-al-tools"); if (d) { d.open = true; d.querySelector(".snap-al-note.struck")?.scrollIntoView({ block: "center" }); } }); await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, "library_tools.png") });
    R.off = await page.evaluate(async (ref) => { const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); await I.setOff(ref, true, "person"); return ref; }, R.saved.ref); // the person's one click off
    R.hashOff = (await call("instructions", { scope: "tool:save_location" })).hash;
    // remove_lora by file
    R.addLora = await call("add_lora", { file: "snaptest_trigger_lora.safetensors", role: "style" });
    R.removeLora = await call("remove_lora", { file: "snaptest_trigger_lora.safetensors" });
    // run's cache_hit
    R.twin = await page.evaluate(async () => { const T = window.__T, h = await T.hashes(await T.live());
      await T.save({ id: "take-g2-twin", kind: "run", prompt_id: "g2twin", created: Date.now(), seconds: 9, group: app.graph.id, number: 7, status: "success", text: "twin", seed: 1, media: [], prompt: {}, graph: { extra: { snap: {} } }, world: {}, verdict: null, notes: [], ...h }); return h; });
    R.run = await call("run", { question: "the same again" });
    R.errors = [...A.errors];
  } finally { await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {}); await b.close(); } // LESSONS G1b: leave "Let agents run" off for the next suite
  const checks = {
    "the tweak applies and changes the stack hash": !!R.hashBefore && R.hashOn !== R.hashBefore,
    "Instructions: the replaced pack note reads 'overridden by yours'": /pack/i.test(R.packRow?.layer ?? "") && /overridden by yours: “Start the walkthrough/.test(R.packRow.why ?? ""),
    "Applies here lists the tool notes apart and counts the one replaced by yours": /When an agent calls a tool · \d+ notes · 1 replaced by yours/.test(R.toolsSummary ?? ""),
    "open_view library answers what it opened": /Agent library is open/.test(R.open?.said ?? "") && /Applies here/.test(R.openHere?.said ?? ""),
    "turning the tweak off gives back the hash from before it": R.hashOff === R.hashBefore,
    "remove_lora {file} takes the row off": R.addLora?.brick === "style" && R.removeLora?.brick === "style" && !(R.removeLora?.rows ?? []).some((r) => /snaptest_trigger_lora/.test(r.file)),
    "run answers cache_hit naming the earlier take": /take 7 \(take-g2-twin\)/.test(R.run?.cache_hit ?? ""),
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g2misc ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
