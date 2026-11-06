// U76 review leftovers in the page (REVIEW_AFTERNOON_2026-11-04.md), on the CPU test server (:8195, privacy on) and the
// fresh one (:8196):
// M2  a take made from a private take's frame (a reference picture's `source`) records made_from and is locked; a
//     hand-made loop of parent / made_from links doesn't overflow the lock check;
// M4  "move to… style" takes a name-inferred turbo out of turbo (the Turbo slot stops listing it);
// M5  four parallel set_lora_category calls all keep their change in snap/models.json;
// L4  a move asks the locks again, and a lock read that failed is asked again next time (the sheet isn't dead);
// L7  moving a LoRA out of identity says it may no longer be private (privacy on);
// L8  SFW only leaves nsfw-tagged turbos out of the Turbo slot and nsfw-tagged files out of list_models' folder counts;
// L10 a 5xx reading snap/models.json or snap/profile.json writes nothing over them;
// L9  onboarding's intent step holds Next until something is picked (:8196);
// L11 propose_downloads' curl commands make missing folders (--create-dirs) (:8196).
// Files every entry it adds to snap/models.json and puts each back (Undo); the profile is restored as it was. Queues two
// 64 px EmptyImage -> SaveImage prompts. BEFORE=<dir of HEAD copies of the changed modules> serves those instead (a
// before-run without touching the worktree other servers serve).
// usage: node test_u76_leftovers.js [port 8195] [fresh port 8196]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, fresh = process.argv[3] || CFG.freshPort, out = path.join(CFG.out, "ui"), R = {};
const TURBO = "snaptest_u76_moss_style_8steps.safetensors";
const MODS = /\/extensions\/ComfyUI-MAINodes\/snap\/(models|takes|tools|loraview|view|onboarding|onboardview|profile)\.js(\?.*)?$/;
async function open(b, p, shelf) {
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  if (shelf) await useShelf(page, { extra: { loras: [[TURBO, 0.1]] } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  if (process.env.BEFORE) await page.route(MODS, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: fs.readFileSync(path.join(process.env.BEFORE, r.request().url().match(MODS)[1] + ".js")) }));
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  page.lockReads = 0; page.on("request", (q) => { if (q.url().includes("/mainodes/snap/private_loras")) page.lockReads++; });
  await page.goto(`http://127.0.0.1:${p}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`);
    window.__X = await at("tools"); window.__M = await at("models"); window.__T = await at("takes"); window.__PF = await at("profile"); window.__K = await at("checks");
  });
  return page;
}
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await open(b, port, true);
  const ev = (fn, arg) => page.evaluate(fn, arg);
  const own = () => ev(async () => { const r = await fetch("/api/userdata/snap%2Fmodels.json"); return r.ok ? r.json() : []; });
  await ev(async () => { app.graph.clear(); app.graph.extra = {}; await window.__X.callTool("start_recipe", { intent: "stills" }); await window.__M.current(); });
  const profileBefore = await ev(async () => { const r = await fetch("/api/userdata/snap%2Fprofile.json"); return r.ok ? r.json() : null; });
  const ownBefore = await own(); // a before-run's old code can clobber the file (L10): it is written back as it was at the end
  const undo = [];
  try {
    // ---- M4 ----
    R.m4 = await ev(async (f) => {
      const M = window.__M, before = { cat: M.categoryOf(M.entry(f)), listed: M.turbos().some((t) => t.file === f) };
      const u = await M.moveTo(f, "style");
      const after = { cat: M.categoryOf(M.entry(f)), turbo: M.entry(f).turbo || null, listed: M.turbos().some((t) => t.file === f) };
      const u2 = await M.moveTo(f, "core·turbo");
      const back = { cat: M.categoryOf(M.entry(f)), steps: M.entry(f).turbo?.steps ?? null, listed: M.turbos().some((t) => t.file === f) };
      await M.restore(u2); await M.restore(u);
      return { before, after, back };
    }, TURBO);
    // ---- M5 + L10 (models.json) ----
    const four = ["mystery_style_v2.safetensors", "odd_thing_v3.safetensors", "comfy_moss_hires_lora_test_v0.7.safetensors", "darask0_moss_sft_4step_dmad_lora.safetensors"];
    R.m5 = await ev(async (files) => {
      const res = await Promise.all(files.map((file) => window.__X.callTool("set_lora_category", { file, tags: ["nsfw"], by: "person" })));
      return res.map((r) => r.undo ?? r);
    }, four);
    undo.push(...R.m5.flat());
    R.m5kept = (await own()).filter((e) => four.includes(e.file) && (e.tags ?? []).includes("nsfw")).map((e) => e.file);
    const entriesBefore = (await own()).length;
    let failNext = true;
    await page.route(/\/userdata\/snap%2Fmodels\.json$/, (r) => { if (r.request().method() === "GET" && failNext) { failNext = false; return r.fulfill({ status: 500, body: "boom" }); } return r.continue(); });
    R.l10 = await ev(async (f) => { try { await window.__M.moveTo(f, "style"); return { threw: null }; } catch (e) { return { threw: e.message }; } }, TURBO);
    await page.unroute(/\/userdata\/snap%2Fmodels\.json$/);
    R.l10.entriesBefore = entriesBefore; R.l10.entriesAfter = (await own()).length;
    // ---- L10 (profile) ----
    await page.route(/\/userdata\/snap%2Fprofile\.json$/, (r) => (r.request().method() === "GET" ? r.fulfill({ status: 500, body: "boom" }) : r.continue()));
    R.l10p = await ev(async () => { const PF = window.__PF; await PF.load(true); const saved = PF.saved(); let threw = null; try { await PF.set({}); } catch (e) { threw = e.message; } return { saved, threw }; });
    await page.unroute(/\/userdata\/snap%2Fprofile\.json$/);
    R.l10p.after = await ev(async () => { const r = await fetch("/api/userdata/snap%2Fprofile.json"); return r.ok ? r.json() : null; });
    // ---- L8 ----
    R.l8 = await ev(async () => {
      const M = window.__M, PF = window.__PF, X = window.__X, f = "lodestones_kromoss_8step_dmd2_lora.safetensors";
      const count = async () => (await X.callTool("list_models", {})).find((x) => x.folder === "loras")?.files ?? null;
      const before = { listed: M.turbos().some((t) => t.file === f), loras: await count() };
      const u = await M.moveTo(f, "nsfw");
      const tagged = M.loraFiles().filter((r) => r.tags.includes("nsfw")).length;
      await PF.set({ sfw_only: true });
      const on = { listed: M.turbos().some((t) => t.file === f), loras: await count(), tagged };
      await PF.set({ sfw_only: false });
      await M.restore(u);
      return { before, on };
    });
    // ---- L7 ----
    R.l7 = await ev(async () => {
      const M = window.__M, f = "odd_thing_v3.safetensors";
      const u1 = await M.moveTo(f, "identity"), u2 = await M.moveTo(f, "style");
      const tool = await window.__X.callTool("set_lora_category", { file: f, role: "identity", by: "person" });
      const tool2 = await window.__X.callTool("set_lora_category", { file: f, role: "unsorted", by: "person" });
      for (const u of [...tool2.undo, ...tool.undo]) await M.restore(u);
      await M.restore(u2); await M.restore(u1);
      return { note: u2.note ?? null, toolNote: tool2.note ?? null };
    });
    // ---- L4 ----
    let abort = true;
    await page.route(/\/mainodes\/snap\/private_loras/, (r) => (abort ? r.abort() : r.continue()));
    const reads0 = page.lockReads;
    const u4 = await ev(async (f) => window.__M.moveTo(f, "style"), "mystery_style_v2.safetensors");
    await page.waitForTimeout(500);
    abort = false;
    const reads1 = page.lockReads;
    R.l4 = await ev(async () => { try { await Promise.all([window.__M.load(), window.__M.locks()]); return { sheetOk: true }; } catch (e) { return { sheetOk: false, error: e.message }; } });
    await page.waitForTimeout(300);
    R.l4.askedAfterMove = reads1 > reads0; R.l4.askedAgain = page.lockReads > reads1;
    await page.unroute(/\/mainodes\/snap\/private_loras/);
    await ev(async (u) => window.__M.restore(u), u4);
    // ---- M2 ----
    const run = (extra, text) => ev(async ([extra, text]) => {
      const T = window.__T; await T.load();
      const prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/u76" } },
        3: { class_type: "PrimitiveString", inputs: { value: text } } };
      const r = await fetch("/api/prompt", { method: "POST", body: JSON.stringify({ client_id: window.__api_client ?? (await import("/scripts/api.js")).api.clientId, prompt,
        extra_data: { extra_pnginfo: { workflow: { id: app.graph.id, nodes: [], links: [], extra } } } }) });
      const id = (await r.json()).prompt_id;
      for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((res) => setTimeout(res, 500));
      const t = T.get(`take-${id}`);
      return t && { id: t.id, locked: T.locked(t), made_from: t.made_from ?? null, private: !!t.private };
    }, [extra, text]);
    R.m2 = { a: await run({}, "snaptest_stamped_lora.safetensors") };
    R.m2.b = await run({ snap: { bricks: [{ key: "refs", values: {}, pictures: [{ file: "x.png", source: R.m2.a?.id }] }] } }, "a plain prompt");
    R.m2.loop = await ev(() => {
      const T = window.__T, all = T.all(), a = { id: "take-u76-loop1", parent: { take: "take-u76-loop2" } }, b2 = { id: "take-u76-loop2", made_from: ["take-u76-loop1"] };
      all.push(a, b2);
      try { return { locked: T.locked(a), ok: true }; } catch (e) { return { ok: false, error: e.message }; } finally { all.splice(all.indexOf(a), 1); all.splice(all.indexOf(b2), 1); }
    });
  } finally {
    for (const u of [...undo].reverse()) await ev(async (u) => window.__M.restore(u), u);
    if (profileBefore) await ev(async (p) => fetch("/api/userdata/snap%2Fprofile.json?overwrite=true", { method: "POST", body: JSON.stringify(p) }), profileBefore);
  }
  const mineOf = (list) => JSON.stringify(list.filter((e) => [TURBO, "mystery_style_v2.safetensors", "odd_thing_v3.safetensors", "comfy_moss_hires_lora_test_v0.7.safetensors", "darask0_moss_sft_4step_dmad_lora.safetensors", "lodestones_kromoss_8step_dmd2_lora.safetensors"].includes(e.file)));
  R.leftEntries = mineOf(await own()); R.entriesBefore = mineOf(ownBefore);
  if (JSON.stringify(await own()) !== JSON.stringify(ownBefore)) { R.ownRestored = true; await ev(async (o) => fetch("/api/userdata/snap%2Fmodels.json?overwrite=true", { method: "POST", body: JSON.stringify(o) }), ownBefore); }
  R.errors = page.errs;

  // ---- L9 + L11 on the fresh server ----
  const f = await open(b, fresh, false);
  R.l11 = await f.evaluate(async () => (await window.__X.callTool("propose_downloads", { intents: ["video"] })).files.map((x) => x.command));
  await f.evaluate(() => { app.graph.clear(); });
  await f.waitForTimeout(800);
  await f.click(".snap-empty .snap-link").catch(() => {}); await f.waitForTimeout(1500);
  // each press re-draws the step, so press the first picked choice afresh each time
  for (let i = 0; i < 8 && await f.$(".snap-ob-choice.on"); i++) { await f.click(".snap-ob-choice.on"); await f.waitForTimeout(300); }
  R.l9 = await f.evaluate(() => ({ step: document.querySelector(".snap-onboard h2")?.textContent ?? null, picked: document.querySelectorAll(".snap-ob-choice.on").length,
    nextDisabled: document.querySelector(".snap-onboard .snap-ob-foot .snap-primary")?.disabled ?? null, hint: [...document.querySelectorAll(".snap-onboard .snap-ob-foot .snap-quiet")].map((e) => e.textContent) }));
  await f.screenshot({ path: path.join(out, "299b-u76-onboarding-pick-one.png") });
  R.freshErrors = f.errs;

  const c = {
    "M4 a name-inferred turbo moved to style is no turbo (not in the Turbo slot)": R.m4.before.cat === "core·turbo" && R.m4.before.listed && R.m4.after.cat === "style" && !R.m4.after.turbo && !R.m4.after.listed,
    "M4 ... and moved back it is a turbo again with its step count": R.m4.back.cat === "core·turbo" && R.m4.back.steps === 8 && R.m4.back.listed,
    "M5 four parallel set_lora_category calls all keep their change": R.m5kept.length === 4,
    "L10 a 5xx reading snap/models.json refuses the move and writes nothing": !!R.l10.threw && R.l10.entriesAfter === R.l10.entriesBefore,
    "L10 a 5xx reading snap/profile.json counts as a profile, and set() writes nothing over it": R.l10p.saved === true && !!R.l10p.threw && JSON.stringify(R.l10p.after) === JSON.stringify(profileBefore),
    "L8 SFW only leaves an nsfw-tagged turbo out of the Turbo slot": R.l8.before.listed && !R.l8.on.listed,
    "L8 ... and out of list_models' folder counts": R.l8.on.tagged >= 1 && R.l8.on.loras === R.l8.before.loras - R.l8.on.tagged,
    "L7 moving out of identity says it may no longer be private (move to… and the tool)": /private as an identity LoRA/.test(R.l7.note ?? "") && /private as an identity LoRA/.test(R.l7.toolNote ?? ""),
    "L4 a move asks the locks again": R.l4.askedAfterMove,
    "L4 a failed lock read is asked again, and the LoRA sheet's reads resolve": R.l4.askedAgain && R.l4.sheetOk,
    "M2 a take made from a private take's frame records made_from and is locked": R.m2.a?.locked && (R.m2.b?.made_from ?? []).includes(R.m2.a.id) && R.m2.b.locked,
    "M2 a parent / made_from loop doesn't overflow the lock": R.m2.loop.ok,
    "every entry the test filed is back as it was (Undo, not the backup)": R.leftEntries === R.entriesBefore,
    "L11 every curl command makes missing folders": R.l11.length > 0 && R.l11.every((x) => x.includes("--create-dirs")),
    "L9 no intent picked holds Next, saying why": R.l9.picked === 0 && R.l9.nextDisabled === true && R.l9.hint.includes("Pick at least one"),
    "no page errors": !R.errors.length && !R.freshErrors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_u76_leftovers_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`u76left  ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
