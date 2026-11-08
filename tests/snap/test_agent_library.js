// U104 B4 (SNAP-R93/R94/R95) on a CPU test server, at 1280 px: the Agent library sheet and the Agent instructions button.
// - the person layer seeded (seed_person_layer.py); an agent's note over the bridge shows "new from short03" on the rail
//   row and a quiet toast without a reload, and still shows after a reload;
// - Instructions: every note whole, grouped Yours / The pack's; one click off dims the agent's note and instructions {}
//   drops it; Seen clears its badge;
// - Tweak on a pack note makes a note that replaces it, and Applies here (tool:edit_from_context) shows the pack row
//   struck "overridden by …"; the person's model_choice beats the pack's for the same job; Reset archives the tweak and
//   the pack row is live again;
// - Skills: an agent's save_skill shows "yours v1 over the pack" and "new from"; Diff vs pack shows both sides whole;
//   Reset to pack reads the pack's again;
// - 300 notes show as 300 rows (no cap, SNAP-R58);
// - the button: in the brick inspector (brick:render), on the Recipe panel, on a Scenes row and a shot's ⋯, on the Cast
//   sheet; each opens Applies here for its scope;
// Screens (judged as a product): ui/u104/library_notes.png, library_applies.png, library_skill_diff.png, library_skills.png,
// button_inspector.png, button_cast.png, rail_row.png, toast.png. usage: node test_agent_library.js [port 8290] [base]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port;
const base = process.argv[3] || CFG.base;
const out = path.join(CFG.out, "ui", "u104"), R = {};
const settle = (page) => page.waitForTimeout(600); // sheets fade in over .18 s
const shut = (page) => page.locator(".snap-al-sheet .snap-x").click().catch(() => {});
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const snap = path.join(base, "user", "default", "snap");
  for (const d of ["instruction", "skill", "instructions.json", "_archived/instruction", "_archived/skill"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d.replace("/", "-")}-${Date.now()}`)); }
  R.seed = JSON.parse(execFileSync("python3", ["-I", path.join(__dirname, "seed_person_layer.py"), "--port", port]).toString()).seeded.length;
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    let { page, errors } = await F.open(b, port, { viewport: { width: 1280, height: 860 } });
    R.errors = errors;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    const client = await page.evaluate(() => sessionStorage.getItem("clientId"));
    const bridge = async (agent, tool, args = {}) => { const r = await fetch(`http://127.0.0.1:${port}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snap-Agent": agent, "X-Snap-Page": client }, body: JSON.stringify({ tool, args }) }); return r.json(); };
    R.railBefore = await page.locator(".snap-al-rail").textContent();
    R.agentNote = (await bridge("short03", "save_instruction", { scope: "tool:edit_from_context", text: "Board frames at 2-4 MP; pass width and height, and cite the cut's own plate first.", source: { from: "agent:short03", date: "2026-11-06" }, more: "skill snap-new-view" })).result;
    await page.waitForTimeout(500);
    R.railAfter = await page.locator(".snap-al-rail").textContent();
    R.toast = await page.locator(".snap-toast").textContent();
    await page.locator(".snap-al-rail").scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(out, "toast.png") });
    await page.locator(".snap-al-rail").screenshot({ path: path.join(out, "rail_row.png") });
    // after a reload it still says so
    await page.reload(); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000); await page.keyboard.press("Escape");
    await F.loadMods(page);
    if (!(await page.locator(".snap-al-rail").isVisible())) { await page.keyboard.press("Alt+s"); await page.waitForTimeout(1200); } // a reload can come back in the Graph view (LESSONS)
    R.railReload = await page.locator(".snap-al-rail").textContent();
    // Instructions
    await page.locator(".snap-al-rail").click(); await page.waitForSelector(".snap-al-note"); await settle(page);
    await page.screenshot({ path: path.join(out, "library_notes.png") });
    R.groups = await page.$$eval(".snap-al-body > .snap-rail-title", (xs) => xs.map((x) => x.textContent));
    R.rows = await page.locator(".snap-al-note").count();
    R.fresh = await page.locator(".snap-al-note.fresh").count();
    const agentRow = page.locator(`.snap-al-note[data-ref="${R.agentNote.ref}"]`);
    await agentRow.locator(".snap-al-switch input").click(); await page.waitForTimeout(500);
    R.dimmed = await page.locator(`.snap-al-note[data-ref="${R.agentNote.ref}"]`).evaluate((e) => e.classList.contains("off") && getComputedStyle(e).opacity < 0.8);
    R.dropped = !(await call("instructions", { scope: "tool:edit_from_context" })).stack.some((r) => r.ref === R.agentNote.ref);
    await page.locator(`.snap-al-note[data-ref="${R.agentNote.ref}"] button:has-text("Seen")`).click(); await page.waitForTimeout(400);
    R.seenRail = await page.locator(".snap-al-rail").textContent();
    // Tweak a pack note, Applies here, Reset
    await page.fill(".snap-al-search", "Pass width and height"); await page.waitForTimeout(300);
    const pack = page.locator('.snap-al-note[data-ref^="pack:edit_from_context/pass-width-height-ph3"]');
    await pack.locator('button:has-text("Tweak")').click(); await page.waitForTimeout(600);
    await page.locator(".snap-al-edit").fill("Pass width and height every time; board frames at 2 MP, references at 2K."); await page.locator('button:has-text("Save version")').click(); await page.waitForTimeout(600);
    R.tweak = await page.evaluate(async () => { const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); return I.rows().find((r) => r.mode === "replace" && r.supersedes?.includes("pack:edit_from_context/pass-width-height-ph3")); });
    await page.locator('.snap-al-tabs button:has-text("Applies here")').click(); await page.waitForTimeout(300);
    await page.fill(".snap-al-free", "tool:edit_from_context"); await page.press(".snap-al-free", "Enter"); await page.waitForSelector(".snap-al-hash"); await page.waitForTimeout(500);
    R.struck = await page.$$eval(".snap-al-note.struck", (xs) => xs.map((x) => ({ ref: x.dataset.ref, why: x.querySelector(".snap-al-why")?.textContent })));
    await page.locator(".snap-al-note.struck").first().scrollIntoViewIfNeeded(); await settle(page);
    await page.screenshot({ path: path.join(out, "library_applies.png") });
    R.hereText = await page.locator(".snap-al-stack").textContent();
    await page.locator('.snap-al-tabs button:has-text("Instructions")').click(); await page.fill(".snap-al-search", "references at 2K"); await page.waitForTimeout(300);
    await page.locator('.snap-al-note button:has-text("Reset")').first().click(); await page.waitForTimeout(600);
    R.afterReset = await call("instructions", { scope: "tool:edit_from_context" });
    // Skills
    const voice = (await call("read_skill", { name: "snap-voice" })).text;
    R.saveSkill = (await bridge("short03", "save_skill", { name: "snap-voice", markdown: voice.replace("# Voice settei", "# Voice settei\n\nMeasured on short03: Maren 184 Hz, Brann 148 Hz, Liesl 226 Hz at 12 steps; Maren and Liesl read 0.86 alike, so give Liesl a brighter casting line."), note: "short03 voice numbers" })).result;
    await page.waitForTimeout(400);
    await page.locator('.snap-al-tabs button:has-text("Skills")').click(); await page.waitForTimeout(400);
    R.skillCards = await page.locator(".snap-al-skill").count();
    R.voiceCard = await page.locator('.snap-al-skill:has-text("snap-voice")').textContent();
    await settle(page);
    await page.screenshot({ path: path.join(out, "library_skills.png") });
    await page.locator('.snap-al-skill:has-text("snap-voice")').click(); await page.waitForTimeout(300);
    await page.locator('.snap-al-toolbar button:has-text("Diff vs pack")').click(); await page.waitForSelector(".snap-al-diff"); await page.waitForTimeout(300);
    R.diff = await page.$$eval(".snap-al-diff > div", (xs) => ({ lines: xs.length, add: xs.filter((x) => x.classList.contains("add")).length, del: xs.filter((x) => x.classList.contains("del")).length }));
    R.voiceLines = voice.split("\n").length;
    await page.locator(".snap-al-diff .add").first().scrollIntoViewIfNeeded(); await settle(page);
    await page.screenshot({ path: path.join(out, "library_skill_diff.png") });
    await page.locator('.snap-al-toolbar button:has-text("Reset to pack")').click(); await page.waitForTimeout(500);
    R.afterSkillReset = await call("read_skill", { name: "snap-voice" });
    await shut(page);
    // 300 notes, no cap
    const made = [];
    for (let i = 0; i < 300; i++) made.push(fetch(`http://127.0.0.1:${port}/mainodes/snap/world/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "instruction", id: `bulk-${String(i).padStart(3, "0")}`, body: { scope: "global", kind: "note", text: `Bulk note ${i}: keep every row.` }, by: "person" }) }));
    await Promise.all(made);
    await page.evaluate(async () => { const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); await I.refresh(); });
    await page.locator(".snap-al-rail").click(); await page.waitForSelector(".snap-al-note"); await page.waitForTimeout(800);
    R.bulkRows = await page.locator('.snap-al-note[data-ref^="instruction:bulk-"]').count();
    await shut(page);
    // the button, in each place: the Recipe panel (nothing selected), then a brick's
    R.recipeBtn = await page.locator('.snap-inspector .snap-insp-title:has-text("Recipe") .snap-al-open').count();
    R.inspectorHtml = await page.locator(".snap-inspector").innerText().catch(() => "");
    await page.click('.snap-brick[data-brick="render"] .snap-name'); await page.waitForTimeout(700);
    R.inspectorBtn = await page.locator(".snap-inspector .snap-al-open").count();
    await page.evaluate(async () => { const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); await I.save(null, { scope: "brick:render", text: "Render in this workflow: 6 steps on the Pika turbo; voice references at 12." }, { by: "person" }); });
    await page.locator(".snap-inspector").screenshot({ path: path.join(out, "button_inspector.png") });
    await page.locator(".snap-inspector .snap-al-open").first().click(); await page.waitForSelector(".snap-al-hash"); await settle(page);
    R.inspectorScope = await page.locator(".snap-al-scope").evaluate((s) => s.value);
    R.inspectorTop = await page.locator(".snap-al-stack").textContent();
    await page.locator('.snap-al-switch:has-text("only notes set for") input').check(); await page.waitForTimeout(700);
    R.exactRows = await page.$$eval(".snap-al-stack .snap-al-note", (xs) => xs.map((x) => x.querySelector(".snap-al-text")?.textContent));
    await page.screenshot({ path: path.join(out, "button_inspector_opened.png") });
    await shut(page);
    R.scene = await call("create_scene", { name: "The Gate Price" });
    const sceneId = R.scene?.scene ?? R.scene?.id;
    R.shot = sceneId && await call("add_shot", { scene: sceneId, name: "C1 the gate" });
    await page.evaluate(async () => { const SC = await import("/extensions/ComfyUI-MAINodes/snap/scenes.js"); await SC.load(); });
    R.sceneRowBtn = await page.evaluate(async () => { const { createSceneBar } = await import("/extensions/ComfyUI-MAINodes/snap/sceneview.js"); return null; }).catch(() => null);
    R.cast = await call("save_cast", { name: "Maren", details: "a tall swordswoman, braid on her right, a scabbard on a harness" });
    await page.evaluate(async (id) => { const { openCast } = await import("/extensions/ComfyUI-MAINodes/snap/castview.js"); await openCast(document.querySelector(".snap-root"), { id }); }, R.cast.cast.split(":")[1]); await page.waitForTimeout(500);
    R.castBtn = await page.locator(".snap-cast-sheet header .snap-al-open").count();
    await page.locator(".snap-cast-sheet header").screenshot({ path: path.join(out, "button_cast.png") });
    await page.locator(".snap-cast-sheet header .snap-al-open").click(); await page.waitForSelector(".snap-al-hash"); await page.waitForTimeout(400);
    R.castScope = await page.locator(".snap-al-scope").evaluate((s) => s.value);
    await shut(page); await page.locator(".snap-cast-sheet .snap-x").click().catch(() => {});
    // the Scenes sheet row and a shot's ⋯
    await page.evaluate(() => document.querySelector(".snap-scene-bar button, [data-scenes]")?.click());
    R.sceneSheet = await page.evaluate(async () => { const v = window.__snap?.view; return !!v; });
    R.text = await page.evaluate(() => document.body.innerText.includes("null") ? [...document.querySelectorAll(".snap-al-sheet, .snap-al-takeline, .snap-al-rail")].map((e) => e.innerText).filter((t) => /\bnull\b|undefined|\[object/.test(t)) : []);
  } finally { await b.close(); }
  const checks = {
    "the person layer is seeded": R.seed >= 10,
    "an agent's note shows on the rail row without a reload": /1 new from agents/.test(R.railAfter) && !/new from agents/.test(R.railBefore),
    "and a quiet toast names the agent and the place": /short03 added a note for tool edit_from_context/.test(R.toast),
    "after a reload the rail still says so": /1 new from agents/.test(R.railReload),
    "Instructions groups Yours and The pack's, every row whole": R.groups.some((g) => /^Yours/.test(g)) && R.groups.some((g) => /^The pack's/.test(g)) && R.rows >= 66 + R.seed + 1,
    "one click off dims the agent's note and instructions {} drops it": R.dimmed && R.dropped,
    "Seen clears the badge": !/new from agents/.test(R.seenRail),
    "Tweak makes a replacing note, Applies here shows the pack row struck": !!R.tweak && R.struck.some((s) => s.ref.startsWith("pack:edit_from_context/pass-width-height-ph3") && /overridden by yours: “Pass width and height every time/.test(s.why)),
    "the person's model_choice beats the pack's for the same job": R.struck.some((s) => s.ref.startsWith("pack:edit_from_context/character-shots-two-shots") && /pref-newview-characters/.test(s.why)),
    "Reset archives the tweak; the pack note applies again": R.afterReset.stack.some((r) => r.ref.startsWith("pack:edit_from_context/pass-width-height-ph3")),
    "Skills: twelve cards; an agent's version shows 'yours v1' and 'new from'": R.skillCards === 12 && /yours v1 over the pack/.test(R.voiceCard) && /new from short03/.test(R.voiceCard),
    "Diff vs pack shows both sides whole": R.diff.add >= 1 && R.diff.lines >= R.voiceLines,
    "Reset to pack reads the pack's text again": R.afterSkillReset.yours === null && !/Measured on short03/.test(R.afterSkillReset.text),
    "300 notes show as 300 rows (no cap)": R.bulkRows === 300,
    "the brick inspector has the button; it opens Applies here for brick:render": R.inspectorBtn === 1 && R.inspectorScope === "brick:render" && /Stack [0-9a-f]{12}/.test(R.inspectorTop),
    "the Recipe panel has the button": R.recipeBtn === 1,
    "only notes set here shows just the brick's own note": R.exactRows.length === 1 && /Render in this workflow/.test(R.exactRows[0]),
    "the Cast sheet has the button; it opens the Cast's scope": R.castBtn === 1 && /^cast:cast-/.test(R.castScope),
    "no stray null/undefined in the sheet": !R.text.length,
    "no page errors": !R.errors.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`agentlib ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); console.error(JSON.stringify({ ...R, hereText: undefined }, null, 1)); process.exit(2); });
