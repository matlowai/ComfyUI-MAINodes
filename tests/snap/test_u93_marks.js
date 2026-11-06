// U93 B4 (SNAP-R103, R105, R106, R108) on a CPU test server: the critic on the object, judged from screenshots.
// - a board in a scene's shot, pinned to the village v1, with a written critique (2 high, 1 medium, regions): its card
//   says "critic: 2 high · 1 medium"; the take viewer draws the masks (a canvas over the picture) and lists the notes high
//   to low with pass, owner and fix; pressing a note highlights its mask;
// - Fix at source on the note owned by the location master opens the master (v1) with a New view prefilled with the fix
//   line and purpose master, and a press to open the Location sheet; on the board-owned note the take itself with its mask;
// - Add as fixture on a note copies the picture into the fixtures folder and stamps the note;
// - the Location sheet: a critic line per picture of v1 (master: 1 high, show masks draws them), "Critique this location",
//   and once v2 exists "Re-run dependents (1 boards · about 1 min)"; pressing it lands the re-made board as a candidate
//   whose tile carries the critic's chip;
// - the Work card: a due critique past its time says "critique due · no critic on duty", and the sheet's foot says so.
// Screens in ui/u93/. usage: node test_u93_marks.js <port> <base>   prints "u93marks n/m" last
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, out = path.join(CFG.out, "ui", "u93"), R = {};
const SETTEI = CFG.fixture("short03", "settei_bg");
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-u93m-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  ["critiques", "takes", "candidates", "scenes", "location", "dependents", "critic_fixtures", "instruction", "_archived/instruction"].forEach(park);
  fs.copyFileSync(path.join(SETTEI, "plates", "Pc_square_well.png"), path.join(base, "output", "snaptest", "u93_board3.png"));
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.route(/\/mainodes\/snap\/critic$/, async (r) => { const res = await r.fetch(), j = await res.json(); r.fulfill({ response: res, json: { ...j, due_after_s: 2 } }); }); // "no critic on duty" after 2 s instead of 5 min
    const A = await F.open(b, port, { context: ctx }), page = A.page;
    await page.evaluate(async () => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); await CR.reload(); window.__CR = CR; });
    R.import = JSON.parse(execFileSync("python3", ["-I", path.join(__dirname, "import_village_location.py"), "--port", port]).toString());
    const call = (name, args) => page.evaluate(async ([n, x]) => { const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); I.setCaller("critic-m"); return window.__X.callTool(n, x).catch((e) => ({ error: e.message })); }, [name, args]);
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); });
    // a real board take (a 64 px CPU run) so it can be re-run; its media is the plate picture
    await call("start_recipe", {}); await page.waitForTimeout(2000);
    await call("apply_location", { location: "location:location-village@1", plates: ["Pc square + well"] });
    const n0 = await page.evaluate(() => window.__T.all().length);
    await page.evaluate(() => app.queuePrompt(0, 1));
    const take = await page.evaluate(async (n) => { const T = window.__T; for (let i = 0; i < 240 && T.all().length < n + 1; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, 500)); return T.all().at(-1).id; }, n0);
    R.take = take;
    await page.evaluate(async (id) => { const T = window.__T, SC = window.__SC, t = T.get(id); t.media = [{ kind: "image", filename: "u93_board3.png", subfolder: "snaptest", type: "output" }]; t.seconds = 40; t.text = "Maren waits by the well; she does not take the pouch"; await T.save(t);
      const s = await SC.create({ name: "U93 marks" }), shot = (await SC.addShot(s.id, { name: "by the well" })).shot; await SC.addGroup(s.id, shot.id, t.group); await SC.setActive(s.id, shot.id, t.id); }, take);
    const row = await page.evaluate(async (id) => { for (let i = 0; i < 40; i++) { await window.__CR.reload(); const r = window.__CR.all().find((x) => x.subject.take === id); if (r) return r.id; await new Promise((ok) => setTimeout(ok, 250)); } return null; }, take);
    await call("claim_critique", { critique: row });
    R.pk = (await call("critique_packet", { critique: row })).pictures?.length;
    R.write = await call("write_critique", { critique: row, verdict: "flaws", passes: { scan: "3x3: houses, the well, snow, nobody but Maren", map: "the palisade ends at the right edge; houses back onto the forest", support: "nothing carried" },
      notes: [{ severity: "high", pass: "map", text: "the palisade stops at the right edge: the village is open on the east side", picture: 0, region: [0.72, 0.12, 0.27, 0.42], owner: "location master", fix: "close the palisade ring on the master behind the east houses" },
        { severity: "high", pass: "map", text: "a second well stands behind the first, by the far houses", picture: 0, region: [0.36, 0.38, 0.14, 0.2], owner: "board", fix: "re-make the board with one well, from the plate" },
        { severity: "medium", pass: "support", text: "a lantern hangs from nothing above the left door", picture: 0, region: [0.08, 0.1, 0.1, 0.16], owner: "take", fix: "a bracket on the wall for the lantern" }] });
    await page.waitForTimeout(800);
    // the card's chip and the viewer
    R.chip = await page.evaluate((id) => document.querySelector(`.snap-take[data-take="${id}"] .snap-critic-chip`)?.textContent ?? null, take);
    await page.click(`.snap-take[data-take="${take}"]`); await page.waitForTimeout(1500);
    R.viewer = await page.evaluate(() => { const s = document.querySelector(".snap-take-sheet"), c = s?.querySelector(".snap-critic-masks"), g = c?.getContext("2d");
      let lit = 0; if (c && c.width) { const d = g.getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 400) if (d[i]) lit++; }
      return s && { notes: [...s.querySelectorAll(".snap-critic-notes li")].map((li) => li.querySelector(".snap-critic-sev")?.textContent), head: s.querySelector(".snap-critic-head")?.textContent, lit, text: s.querySelector(".snap-critic")?.textContent }; });
    await page.locator(".snap-take-sheet .snap-critic-notes li").first().click(); await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(out, "u93_critique_on_take.png") });
    await page.locator(".snap-take-sheet .snap-critic").screenshot({ path: path.join(out, "u93_critique_notes.png") }).catch((e) => { R.shotErr = e.message; });
    // Add as fixture on the medium note
    await page.locator(".snap-take-sheet .snap-critic-notes li").nth(2).locator("button", { hasText: "Add as fixture" }).click(); await page.waitForTimeout(1200);
    R.fixture = await page.evaluate((id) => window.__T.get(id).notes.find((n) => n.severity === "medium")?.fixture ?? null, take);
    R.fixtureFile = fs.existsSync(path.join(snap, "critic_fixtures", "fixtures.local.json")) ? JSON.parse(fs.readFileSync(path.join(snap, "critic_fixtures", "fixtures.local.json"))).fixtures.map((f) => [f.id, f.polarity, f.expected[0]?.severity, f.picture]) : null;
    // Fix at source: the master-owned note
    await page.locator(".snap-take-sheet .snap-critic-notes li").first().locator("button", { hasText: "Fix at source" }).click(); await page.waitForTimeout(1200);
    R.fix = await page.evaluate(() => { const s = document.querySelector(".snap-critic-sheet"); return s && { title: s.querySelector("header strong")?.textContent, prompt: s.querySelector("textarea")?.value, purpose: s.querySelector("select")?.value, open: !![...s.querySelectorAll("button")].find((x) => /Location sheet/.test(x.textContent)) }; });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, "u93_fix_at_source.png") });
    await page.keyboard.press("Escape");
    await page.locator(".snap-take-sheet .snap-critic-notes li").nth(1).locator("button", { hasText: "Fix at source" }).click(); await page.waitForTimeout(800);
    R.fixBoard = await page.evaluate(() => { const s = document.querySelector(".snap-critic-sheet"); return s && { title: s.querySelector("header strong")?.textContent, box: !!s.querySelector(".snap-critic-box"), purpose: s.querySelector("select")?.value }; });
    await page.keyboard.press("Escape"); await page.waitForTimeout(200); R.viewerStays = !!(await page.$(".snap-take-sheet")); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    // a v2 makes the board stale; the Location sheet shows the critic and Re-run dependents
    R.v2 = await call("add_plate", { location: "location:location-village", name: "Pe east wall", file: "snap/location/village/Pd_houses.png" });
    await page.evaluate(async () => { const { ui } = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); await ui.act("location", "location:location-village@1"); }); await page.waitForTimeout(1500);
    R.loc = await page.evaluate(() => { const s = document.querySelector(".snap-loc-sheet"), b = s?.querySelector(".snap-critic-loc"); return b && { text: b.textContent, rerun: [...b.querySelectorAll("button")].map((x) => x.textContent) }; });
    R.locMasks = await page.evaluate(() => document.querySelectorAll(".snap-loc-sheet .snap-mask").length);
    // the location's own master row: write it so its line and masks show too
    const mrow = await page.evaluate(() => window.__CR.all().find((r) => r.subject.kind === "record" && r.subject.part === "master" && r.subject.ref.endsWith("@1"))?.id);
    await call("claim_critique", { critique: mrow });
    await call("write_critique", { critique: mrow, verdict: "flaws", passes: { map: "the palisade crosses the front only" }, notes: [{ severity: "high", pass: "map", text: "the palisade runs across the front only; no wall behind the far rows", picture: 0, region: [0.05, 0.05, 0.9, 0.35], owner: "location master", fix: "ring the village" }] });
    await page.waitForTimeout(800);
    await page.evaluate(() => [...document.querySelectorAll(".snap-loc-sheet .snap-critic-loc button")].find((x) => /^Show masks/.test(x.textContent))?.click()); await page.waitForTimeout(400); // G3: one switch for every picture
    R.locMasks2 = await page.evaluate(() => document.querySelectorAll(".snap-loc-sheet .snap-loc-master .snap-mask").length);
    await page.screenshot({ path: path.join(out, "u93_location_sheet.png") });
    await page.evaluate(async () => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true));
    const n1 = await page.evaluate(() => window.__T.all().length);
    await page.evaluate(() => [...document.querySelectorAll(".snap-loc-sheet .snap-critic-loc button")].find((x) => x.textContent.startsWith("Re-run dependents"))?.click());
    await page.evaluate(async (n) => { const T = window.__T; for (let i = 0; i < 240 && T.all().length < n + 1; i++) await new Promise((r) => setTimeout(r, 500)); }, n1);
    R.batch = (await call("list_dependents", {}))[0];
    const dec = R.batch?.stages.find((s) => s.name === "boards")?.decisions[0];
    await page.evaluate(async (d) => { const C = window.__C; for (let i = 0; i < 60; i++) { await C.settle(); if (C.get(d)?.candidates[0]?.state === "ready") return; await new Promise((ok) => setTimeout(ok, 500)); } }, dec);
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    for (const s of await page.$$(".snap-loc-sheet")) await s.evaluate((x) => x.remove());
    await page.click(`.snap-take[data-take="${take}"]`).catch(() => {}); await page.waitForTimeout(1500);
    if (!(await page.$(".snap-take-sheet"))) await page.evaluate(async (id) => { const v = document.querySelector(".snap-root"); const { createDailies } = await import("/extensions/ComfyUI-MAINodes/snap/dailies.js"); }, take);
    R.cands = await page.evaluate((d) => { const el = document.querySelector(`.snap-take-sheet .snap-cands[data-decision="${d}"]`) ?? document.querySelector(".snap-take-sheet .snap-cands"); return el && { tiles: el.querySelectorAll(".snap-cand").length, chips: [...el.querySelectorAll(".snap-critic-chip")].map((x) => x.textContent), title: el.closest(".snap-set-candrow")?.querySelector(".snap-rail-title")?.textContent }; }, dec);
    await page.evaluate((d) => (document.querySelector(`.snap-take-sheet .snap-cands[data-decision="${d}"]`) ?? document.querySelector(".snap-take-sheet .snap-set-candrow"))?.scrollIntoView({ block: "center" }), dec);
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out, "u93_rerun_candidates.png") });
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    // the Work card: due rows past their time
    await page.waitForTimeout(2500);
    R.work = await call("list_activity", { kind: "critique" });
    await page.evaluate(async () => { const { openWork } = await import("/extensions/ComfyUI-MAINodes/snap/workview.js"); openWork(document.querySelector(".snap-root"), { say() {}, open() {}, decide() {} }); }); await page.waitForTimeout(900);
    R.workSheet = await page.evaluate(() => { const s = document.querySelector(".snap-work-sheet"); return s && { foot: s.querySelector(".snap-critic-foot")?.textContent, late: [...s.querySelectorAll(".snap-work-row")].filter((x) => /no critic on duty/.test(x.textContent)).length, text: s.textContent.slice(0, 2000) }; });
    await page.screenshot({ path: path.join(out, "u93_work_card.png") });
    R.errors = A.errors;
  } finally { await b.close(); }
  const checks = [
    R.chip === "critic: 2 high · 1 medium",
    JSON.stringify(R.viewer?.notes) === JSON.stringify(["high · map", "high · map", "medium · support"]) && /Critic: 2 high · 1 medium/.test(R.viewer.head) && R.viewer.lit > 50,
    /owner: location:location-village@1, master/.test(R.viewer?.text ?? "") && /fix: close the palisade ring/.test(R.viewer.text),
    R.fixture?.id === "L01" && JSON.stringify(R.fixtureFile?.[0]?.slice(0, 3)) === JSON.stringify(["L01", "positive", "medium"]),
    /Fix at source: .* v1, master/.test(R.fix?.title ?? "") && /close the palisade ring/.test(R.fix.prompt) && R.fix.purpose === "master" && R.fix.open,
    /Fix at source: take \d+/.test(R.fixBoard?.title ?? "") && R.fixBoard.box,
    /master: 1 high/.test(R.loc?.text ?? "") || /master: critique due/.test(R.loc?.text ?? ""),
    R.loc?.rerun?.some((x) => /^Re-run dependents \(1 board · about 1 min\)$/.test(x)) && R.loc.rerun.includes("Critique this location"),
    R.locMasks2 === 1,
    R.batch?.stages.find((s) => s.name === "boards")?.decisions.length === 1 && R.cands?.tiles === 1 && R.cands.chips.length === 1,
    R.work.rows?.some((r) => r.no_critic && /no critic on duty/.test(r.said)) && /critique.* due · no critic on duty/.test(R.workSheet?.foot ?? "") && R.workSheet.late >= 1,
    !R.errors.length,
  ];
  R.checks = checks;
  fs.writeFileSync(path.join(out, "test_u93_marks_result.json"), JSON.stringify(R, null, 1));
  console.log(`u93marks ${checks.filter(Boolean).length}/${checks.length} ${checks.every(Boolean) ? "PASS" : "FAIL " + JSON.stringify(checks.map((x, i) => (x ? null : i)).filter((x) => x != null))}`);
})();
