// U89 step 4 (SNAP-R63): batch re-runs ("this shot with each of these 3 characters") on the CPU test server, queued
// prompts rewritten as test_retake.js does. Take A (scene shot) pins Kon v1; Mara, Ana and Lio are saved.
// - agents off: rerun with to: [Mara, Ana, Lio] waits as a proposal whose plan says 3 candidates, eta 3 × A's seconds, a
//   line per candidate;
// - run: one decision (kind rerun) with 3 candidates, 3 queued workflows each marked with its own swap, 3 takes nested
//   under A as "Re-run · Kon → Mara / Ana / Lio"; once rendered each candidate's picture is its take's file;
// - the take viewer shows the decision as a strip of 3 tiles named by the swap; Apply makes c2's take the shot's active
//   take, Undo puts back none; Reject on c3 marks its take rejected by the person;
// - the sheet's "Several at once…" turns the button into "Re-generate × 2". Screen 378.
// usage: node test_rerun_batch.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const KON = "snaptest_cast_kon_identity.safetensors";
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await useShelf(page, { extra: { loras: [[KON, 0.1]] } });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const queued = [];
  await page.route(/\/(api\/)?prompt$/, (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const body = JSON.parse(r.request().postData());
    queued.push({ workflow: body.extra_data?.extra_pnginfo?.workflow ?? null });
    body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 + queued.length } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/u89batch" } } };
    delete body.partial_execution_targets;
    return r.continue({ postData: JSON.stringify(body) });
  });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["E", "engine"], ["M", "models"], ["W", "world"], ["T", "takes"], ["SC", "scenes"], ["RR", "rerun"], ["C", "candidates"]]) window[`__${k}`] = await at(m); });
  const waitTakes = (n) => ev(async (n) => { const T = window.__T; for (let i = 0; i < 200 && T.all().length < n; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, 400)); return T.all().length; }, n);
  R.a = await ev(async (kon) => {
    const L = window.__L, T = window.__T, SC = window.__SC;
    await T.load(); await SC.load(); await window.__M.load();
    const scene = await SC.create({ name: "Rerun batch test" });
    await SC.addShot(scene.id, { name: "Kon walks" });
    const shot = SC.get(scene.id).shots[0].id;
    await SC.openShot(scene.id, shot);
    const s = Date.now().toString(36), ids = {};
    for (const [name, details] of [["Kon", "a fennec-eared courier girl"], ["Mara", "a woman in a mustard coat"], ["Ana", "a woman in a red scarf"], ["Lio", "a tall man in a grey suit"]]) {
      ids[name] = `cast-${name.toLowerCase()}rb${s}`;
      await L.saveCast(ids[name], { name, details, lora: name === "Kon" ? { file: kon, strength: 0.8 } : null, refs: [] });
    }
    await L.applyCast(`cast:${ids.Kon}`);
    return { scene: scene.id, shot, ids, takes: T.all().length };
  }, KON);
  const kon = `cast:${R.a.ids.Kon}`, three = ["Mara", "Ana", "Lio"].map((n) => `cast:${R.a.ids[n]}`);
  await ev(() => app.queuePrompt(0, 1));
  await waitTakes(R.a.takes + 1);
  R.a.take = await ev(() => window.__T.all().at(-1).id);
  R.a.seconds = await ev((id) => window.__T.get(id).seconds, R.a.take);
  R.proposal = await ev(async ([take, kon, three]) => window.__X.callTool("rerun", { take, swaps: { [kon]: { to: three } } }), [R.a.take, kon, three]);
  const n0 = queued.length, t0 = await ev(() => window.__T.all().length);
  R.run = await ev(async ([take, kon, three]) => window.__RR.rerun(window.__T.get(take), { swaps: { [kon]: { to: three } } }), [R.a.take, kon, three]);
  await waitTakes(t0 + 3);
  R.marks = queued.slice(n0).map((q) => q.workflow?.extra?.snap?.rerun?.swaps?.[kon]?.text ?? null);
  // candidates settle from /history
  R.settled = await ev(async (id) => { const C = window.__C; for (let i = 0; i < 60; i++) { await C.settle(); if (!C.rendering(C.get(id))) break; await new Promise((r) => setTimeout(r, 1000)); } const d = C.get(id); return { kind: d.kind, title: d.title, candidates: d.candidates.map((c) => ({ state: c.state, label: c.label, take: c.take, pic: c.pictures[0]?.media?.filename ?? null })) }; }, R.run.decision);
  R.scene = await ev(async (scene) => window.__X.callTool("get_scene", { scene }), R.a.scene);
  // the strip in the take viewer
  await page.waitForTimeout(600);
  await page.click(`.snap-take[data-take="${R.a.take}"]`); await page.waitForTimeout(1200);
  R.strip = await ev((id) => { const el = document.querySelector(`.snap-take-sheet .snap-cands[data-decision="${id}"]`); return el && { tiles: el.querySelectorAll(".snap-cand").length, title: el.closest(".snap-set-candrow")?.querySelector(".snap-rail-title")?.textContent }; }, R.run.decision);
  await page.locator(".snap-take-sheet .snap-set-candrow").first().screenshot({ path: path.join(out, "378-u89-rerun-batch-strip.png") }).catch((e) => { R.shotErr = e.message; });
  await page.keyboard.press("Escape");
  // apply / undo / reject
  R.apply = await ev(async ([id, scene, shot]) => { const C = window.__C, SC = window.__SC; await C.apply(id, "c2", "person"); const a = SC.get(scene).shots.find((x) => x.id === shot).active; await C.undo(id, "person"); const u = SC.get(scene).shots.find((x) => x.id === shot).active ?? null; await C.reject(id, "c3", "person"); const t = window.__T.get(C.get(id).candidates[2].take); return { active: a, c2take: C.get(id).candidates[1].take, afterUndo: u, verdict: t?.verdict, by: t?.verdict_by }; }, [R.run.decision, R.a.scene, R.a.shot]);
  // the sheet's several-at-once
  R.sheet = await ev(async ([take, n]) => { const { openRerunSheet } = await import("/extensions/ComfyUI-MAINodes/snap/rerunsheet.js"); const s = await openRerunSheet(document.querySelector(".snap-root"), { take: window.__T.get(take), say() {}, edit() {} });
    const boxes = [...s.querySelector(".snap-rerun-many")?.querySelectorAll("input") ?? []].slice(0, 2); for (const x of boxes) { x.checked = true; x.dispatchEvent(new Event("change")); await new Promise((r) => setTimeout(r, 400)); }
    return { button: s.querySelector(".snap-rerun-actions button.snap-primary")?.textContent, route: s.querySelector(".snap-rerun-route")?.textContent }; }, [R.a.take]);
  R.errors = errs;
  const tree = R.scene.shots?.[0]?.takes ?? [], root = tree.find((x) => x.take === R.a.take), labels = (root?.versions ?? []).map((v) => v.label).sort();
  const c = {
    "agents off: a proposal; plan says 3 candidates, eta 3 × A's seconds, a line per candidate": !!R.proposal.proposed && R.proposal.plan?.candidates === 3 && Math.abs(R.proposal.plan.eta_s - 3 * R.a.seconds) < 1e-6 && R.proposal.plan.per_candidate?.length === 3 && R.proposal.plan.per_candidate[1].swaps[0].text === "Kon → Ana",
    "one rerun decision with 3 candidates, each a queued run": R.settled.kind === "rerun" && R.settled.candidates.length === 3 && R.run.runs?.length === 3,
    "3 queued workflows, each marked with its own swap": R.marks.join("|") === "Kon → Mara|Kon → Ana|Kon → Lio",
    "3 takes nested under A as Re-run · Kon → Mara / Ana / Lio": labels.join("|") === "Re-run · Kon → Ana|Re-run · Kon → Lio|Re-run · Kon → Mara",
    "rendered candidates carry their take's file and a name": R.settled.candidates.every((x) => x.state === "ready" && x.pic && x.take) && R.settled.candidates.map((x) => x.label).join("|") === "Kon → Mara|Kon → Ana|Kon → Lio",
    "the take viewer shows the decision as 3 tiles": R.strip?.tiles === 3 && /with Kon → Mara · Kon → Ana · Kon → Lio/.test(R.strip.title ?? ""),
    "Apply makes c2's take the shot's active take; Undo puts back none": R.apply.active === R.apply.c2take && R.apply.afterUndo === null,
    "Reject on c3 marks its take rejected by the person": R.apply.verdict === "reject" && R.apply.by === "person",
    "the sheet's Several at once makes it Re-generate × 2": R.sheet.button === "Re-generate × 2" && /^Re-generate × 2/.test(R.sheet.route ?? ""),
    "no page errors": !R.errors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_rerun_batch_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`rrbatch  ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
