// U103 B3 (SNAP-R93) on a CPU test server: every queued run pins the stack it ran under, and a take says what moved.
// - a 64 px CPU run (fwork.js) from the open recipe: the take's get_take.instructions.ran.hash equals the hash
//   instructions {} gave just before the run, and same: true;
// - edit a note that applied (a new version) and add one: get_take says same: false, the edit under changed with both texts,
//   the new note under added; turning a pack note off lists it under turned_off;
// - the saved file's metadata (its workflow) holds extra.snap.instructions; with Save metadata off the file holds no workflow;
// - the take viewer shows "Agent instructions: ran under <hash> · now <hash> · n changes" and its Open goes to Applies
//   here for the take, with the was/now texts.
// usage: node test_instructions_pins.js [port 8290] [base]   prints "instrpins n/m" last; screen ui/u104/take_line.png
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port;
const base = process.argv[3] || CFG.base;
const out = path.join(CFG.out, "ui", "u104"), R = {};
const fileHas = (m, s) => { const f = path.join(base, m.type === "output" ? "output" : m.type, m.subfolder ?? "", m.filename); return fs.existsSync(f) ? fs.readFileSync(f).includes(Buffer.from(s)) : null; };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const snap = path.join(base, "user", "default", "snap");
  for (const d of ["instruction", "skill", "instructions.json", "_archived/instruction", "_archived/skill"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d.replace("/", "-")}-${Date.now()}`)); }
  await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.SaveMetadata`, { method: "POST", body: "true" }); // G3: an earlier suite in the gate can leave metadata off (park keeps settings), and the page reads it as it loads
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const { page, errors } = await F.open(b, port, { viewport: { width: 1280, height: 860 } });
    R.errors = errors; R.stacks = [];
    page.on("pageerror", (e) => R.stacks.push(e.stack?.split("\n").slice(0, 12).join(" | ")));
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { window.__I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); await window.__I.load(); await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    R.note = await page.evaluate(() => __I.save(null, { scope: "global", text: "Pins test: keep the camera low." }, { by: "person" }).then((o) => o.ref));
    R.before = await call("instructions", {});
    const takes0 = await page.evaluate(async () => (await window.__T.load()).length);
    R.run = await call("run", {});
    await F.idle(port); await page.waitForTimeout(2500);
    R.take = await page.evaluate((n) => window.__T.all().slice(n).at(-1)?.id, takes0);
    R.got1 = (await call("get_take", { take: R.take })).instructions;
    R.media1 = (await call("get_take", { take: R.take })).media?.[0];
    R.fileHasPin = R.media1 && fileHas(R.media1, '"instructions"') && fileHas(R.media1, R.note.split("@")[0].split(":")[1]);
    // move the stack: a new version of the note, a new note, a pack note off
    R.edited = await page.evaluate((ref) => __I.save(ref, { text: "Pins test: keep the camera low, 24 mm." }, { by: "person" }).then((o) => o.ref), R.note);
    R.added = await page.evaluate(() => __I.save(null, { scope: "global", text: "Pins test: a note added after the run." }, { by: "person" }).then((o) => o.ref));
    await page.evaluate(() => __I.setOff("pack:global/warn-never-block", true));
    R.got2 = (await call("get_take", { take: R.take })).instructions;
    // the take viewer's line and its Open
    await page.click(`.snap-take[data-take="${R.take}"]`).catch(() => {});
    await page.waitForSelector(".snap-al-takeline .snap-al-open", { timeout: 8000 }).catch(() => {});
    R.line = await page.locator(".snap-al-takeline").first().textContent().catch(() => null);
    await page.locator(".snap-al-takeline").first().scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, "take_line.png") });
    await page.locator(".snap-al-takeline .snap-al-open").first().click().catch(() => {});
    await page.waitForSelector(".snap-al-ran", { timeout: 8000 }).catch(() => {});
    R.ranBox = await page.locator(".snap-al-ran").first().textContent().catch(() => null);
    await page.waitForTimeout(600); // the sheet fades in over .18 s
    await page.screenshot({ path: path.join(out, "take_applies_here.png") });
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    // Save metadata off: the file holds no workflow
    await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.SaveMetadata", false));
    const takes1 = await page.evaluate(() => window.__T.all().length);
    await call("new_seed", {}).catch(() => {});
    R.run2 = await call("run", {});
    await F.idle(port); await page.waitForTimeout(2500);
    R.take2 = await page.evaluate((n) => window.__T.all().slice(n).at(-1)?.id, takes1);
    R.media2 = R.take2 && (await call("get_take", { take: R.take2 })).media?.[0];
    R.offFile = R.media2 && { workflow: fileHas(R.media2, '"workflow"'), instructions: fileHas(R.media2, '"instructions"') };
  } finally {
    const p = await b.contexts()[0]?.pages()[0];
    await p?.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.SaveMetadata", true); await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); }).catch(() => {});
    await b.close();
  }
  const key = (r) => r.split("@")[0];
  const checks = {
    "the run made a take": /^take-/.test(R.take ?? ""),
    "the take ran under the hash instructions {} gave before the run": R.got1?.ran?.hash === R.before.hash && R.got1.same === true && R.got1.ran.refs.includes(R.note),
    "the saved file's workflow holds extra.snap.instructions": R.fileHasPin === true,
    "a new version of a note is under changed, with both texts": R.got2?.same === false && R.got2.diff.changed.some((c) => c.ref === key(R.note) && c.was === "1" && c.now === "2" && /camera low\.$/.test(c.was_text) && /24 mm/.test(c.now_text)),
    "a note added since is under added": R.got2?.diff.added.includes(R.added),
    "a pack note turned off since is under turned_off": R.got2?.diff.turned_off.some((r) => key(r) === "pack:global/warn-never-block"),
    "the take viewer says what it ran under and what moved": /Agent instructions: ran under [0-9a-f]{12} · now [0-9a-f]{12} · \d+ changes?/.test(R.line ?? ""),
    "Open shows the take's ran/now with the was/now texts": /ran under/.test(R.ranBox ?? "") && /was: Pins test: keep the camera low\./.test(R.ranBox) && /now: Pins test: keep the camera low, 24 mm\./.test(R.ranBox),
    "Save metadata off: the file holds no workflow, so no pin": R.offFile?.workflow === false && R.offFile.instructions === false,
    "no page errors": !R.errors.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`instrpins ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
