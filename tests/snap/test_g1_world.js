// short03 F-C29 and F-C27 on the CPU test server:
// - F-C29: a place kept as a Cast ("Village (set)": a master picture and a camera map) becomes a location record with
//   cast_to_location (master, plan, notes from its details; the Cast stays); asked again it names the one it made; a take
//   pinned to that Cast stops showing the red "its description wasn't in the prompt" line;
// - F-C27: remove_from_world takes a Cast out of the open recipe (its line in the prompt, its pictures, its pin), the
//   record stays; the pin chip's x does the same in the UI.
// usage: node test_g1_world.js [port 8195]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g1");
const base = CFG.base;
(async () => {
  const snap = path.join(base, "user", "default", "snap");
  for (const d of ["location", "takes", "cast"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d}-${Date.now()}`)); } // an earlier run's, moved
  execFileSync("python3", ["-I", path.join(__dirname, "import_village_location.py"), "--port", port]); // its pictures into input/
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    R.cast = await call("save_cast", { name: "Village (set) · The Gate Price", details: "a small walled village at dusk in snow", lora: null,
      refs: [{ file: "snap/location/village/MASTER.png", role: "the whole village from above (master)" }, { file: "snap/location/village/village_cameras.png", role: "map: camera positions and the walkthrough path" }] });
    // a take pinned to that Cast whose description wasn't in its prompt (as short03's walkthrough takes are)
    await page.evaluate(async (ref) => { const T = window.__T, id = ref.slice(5);
      await T.save({ id: "take-g1-walk", kind: "run", prompt_id: "g1-walk", created: Date.now(), seconds: 9, group: app.graph.id, number: 980, status: "success", text: "people-free walkthrough, gate yard", seed: 1,
        media: [{ kind: "image", filename: "g1_still.png", subfolder: "snaptest", type: "output" }], prompt: {}, graph: { extra: { snap: { world: {} } } },
        world: { [ref]: { n: 1, name: "Village (set) · The Gate Price", placed: { text: "a small walled village at dusk in snow", missing: ["its details line isn't in the prompt that ran"] } } }, verdict: null, notes: [] }); }, R.cast.cast);
    const red = async () => { await page.evaluate(() => document.querySelector(".snap-takes")?.scrollIntoView()); await page.waitForTimeout(800);
      return page.evaluate(() => [...document.querySelectorAll('.snap-take[data-take="take-g1-walk"] .snap-take-unplaced')].map((x) => x.textContent)); };
    R.redBefore = await red();
    R.made = await call("cast_to_location", { cast: R.cast.cast });
    R.again = await call("cast_to_location", { cast: R.cast.cast });
    R.loc = (await call("list_locations", {})).find((x) => x.location === R.made.location);
    R.castStays = (await call("list_cast", {})).some((x) => x.cast === R.cast.cast);
    await page.evaluate(() => window.__X.callTool("ui", { action: "close" }).catch(() => {})); await page.waitForTimeout(500);
    R.redAfter = await red();
    // F-C27: a Cast out of the recipe
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    R.apply = await call("apply_cast", { cast: R.cast.cast });
    R.before = await page.evaluate(() => ({ world: Object.keys(window.__E.state().world ?? {}), pics: window.__E.references().pictures.length, prompt: window.__E.getValue("render", "render", "prompt") }));
    R.removed = await call("remove_from_world", { ref: R.cast.cast });
    R.after = await page.evaluate(() => ({ world: Object.keys(window.__E.state().world ?? {}), pics: window.__E.references().pictures.length, prompt: window.__E.getValue("render", "render", "prompt") }));
    R.notThere = await call("remove_from_world", { ref: R.cast.cast });
    // the x on a pin chip (a location this time)
    await call("apply_location", { location: R.made.location });
    await page.waitForTimeout(800);
    R.chip = await page.evaluate(() => [...document.querySelectorAll(".snap-pin-wrap")].map((x) => x.textContent));
    await page.screenshot({ path: path.join(out, "pin_chip_x.png"), clip: { x: 0, y: 0, width: 1600, height: 700 } });
    await page.click(".snap-pin-wrap .snap-pin-x"); await page.waitForTimeout(800);
    R.chipAfter = await page.evaluate(() => ({ world: Object.keys(window.__E.state().world ?? {}), pics: window.__E.references().pictures.length }));
    // F-C30: an upload of a name already in input/ lands as "<name> (1)"; save_cast says so and keeps each file's hash
    const voiceName = `g1voice-${Date.now()}.wav`; // a new name each run: the second upload of it lands as "<name> (1)"
    const up = async (bytes) => { const f = new FormData(); f.append("image", new Blob([bytes], { type: "audio/wav" }), voiceName); f.append("subfolder", "snap"); return (await fetch(`http://127.0.0.1:${port}/upload/image`, { method: "POST", body: f })).json(); };
    R.up1 = await up(`old ${Date.now()}`); await new Promise((r) => setTimeout(r, 1100)); R.up2 = await up(`new ${Date.now()}`);
    R.voice = await call("save_cast", { name: "G1 voice", lora: null, refs: [], voice: { file: `snap/${R.up1.name}`, casting: "low, calm" } });
    R.voiceRec = (await call("list_cast", {})).find((x) => x.cast === R.voice.cast);
    R.errors = [...A.errors];
  } finally { await b.close(); }
  const checks = {
    "the take pinned to the set-Cast shows the red description line first": R.redBefore?.some((x) => /description wasn't in the prompt/.test(x)),
    "cast_to_location: master and plan from the Cast's pictures, notes from its details, from_cast kept": /^location:location-/.test(R.made?.location ?? "") && R.loc?.master?.file === "snap/location/village/MASTER.png" && R.loc.plan?.file === "snap/location/village/village_cameras.png" && /walled village/.test(R.loc.notes) && R.loc.from_cast === `${R.cast.cast}@1` && R.loc.name === "Village · The Gate Price",
    "asked again it names the location it made; the Cast stays": R.again?.made === false && R.again.location === R.made.location && R.castStays,
    "after it, the take has no red description line": R.redAfter && !R.redAfter.some((x) => /description wasn't in the prompt/.test(x)),
    "remove_from_world takes the Cast out: its line, its pictures, its pin": R.before?.world.includes(R.cast.cast) && R.before.pics === 2 && /walled village/.test(R.before.prompt) && !R.after.world.includes(R.cast.cast) && R.after.pics === 0 && !/walled village/.test(R.after.prompt) && /record stays/.test(R.removed?.said ?? ""),
    "removing what isn't there says what the world holds": /isn't in this recipe's world/.test(R.notThere?.error ?? ""),
    "the pin chip's x takes the location out": R.chip?.some((x) => /Village/.test(x)) && R.chipAfter?.pics === 0 && !R.chipAfter.world.some((x) => x.startsWith("location:")),
    "F-C30: save_cast names the newer same-named upload, and keeps the file's hash": R.up2?.name !== R.up1?.name && new RegExp(`is older than snap/${R.up2.name.replace(/[()]/g, "\\$&")}`).test(R.voice?.warning ?? "") && /^[0-9a-f]{16}$/.test(R.voiceRec?.voice?.sha ?? ""),
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g1world ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
