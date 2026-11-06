// short03 findings F-C12, F-C14, F-C15, F-C16 (SNAP-R78, R79) on the CPU test server.
// - F-C12: a tab whose loaded Snap code is older than the served code (its /mainodes/snap/info answer is faked here, so
//   it registers with an old hash) shows "Snap was updated: reload to get the new tools"; request_reload (the bridge
//   tool, over HTTP as an agent) shows it with the agent's name and never reloads the tab; on a current tab it says
//   there is nothing to reload; ✕ hides it; no stray null.
// - F-C14: a New view candidate gets a copy note against each context picture: the check's graph scores the candidate
//   still against each picture (MAISnapCopyScore, DINOv3 from the model graph); its scores are answered here (P01's
//   aerial copies scored on the GPU are in ui/u101/fc14_copy_scores.json): the soft score at or above its threshold says
//   "copied Picture n" (G1b, SNAP-R112), with "same framing" when the same-cell score also reaches its threshold and
//   "same composition" when only the soft one does; below it "no copy".
// - F-C15: an answer that lands away from a context board's shot gives land_hint naming that shot; none otherwise.
// - F-C16: AGENT_START's New view tips carry the slit-pupil pattern.
// usage: node test_u101_fc.js [port 8195] [base dir]     BEFORE=234ee8d node test_u101_fc.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFile, execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui", "u101"), R = {};
const base = process.argv[3] || CFG.base;
const WT = CFG.pack;
const FILES = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"];
const sh = (cmd, args) => new Promise((done, fail) => execFile(cmd, args, (e) => (e ? fail(e) : done())));
const bridge = async (tool, args, agent) => (await fetch(`http://127.0.0.1:${port}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snap-Agent": agent }, body: JSON.stringify({ tool, args }) })).json();
(async () => {
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  fs.mkdirSync(path.join(base, "input", "snap"), { recursive: true });
  for (const [n, c] of [["master", "0x405070"], ["road", "0x705040"]]) await sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${c}:s=128x72`, "-frames:v", "1", path.join(base, "input", "snap", `snaptest_fc_${n}.png`)]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    // ---- F-C12 ----
    const stale = await b.newContext({ viewport: { width: 1400, height: 900 } });
    await stale.route(/\/mainodes\/snap\/info$/, async (r) => { const res = await r.fetch(), j = await res.json(); r.fulfill({ response: res, json: { ...j, code: "0ldc0de00000" } }); });
    const B = await F.open(b, port, { context: stale }), old = B.page;
    await old.evaluate(() => { window.__notReloaded = true; });
    await old.waitForSelector(".snap-stale:not([hidden])", { timeout: 15000 }).catch(() => {});
    const bar = (p) => p.$eval(".snap-stale", (el) => ({ shown: !el.hidden, text: el.textContent, buttons: [...el.querySelectorAll("button")].map((x) => x.textContent) })).catch(() => null);
    R.staleBar = await bar(old);
    R.currentBar = await bar(page);
    const ids = { old: await old.evaluate(async () => (await import("/scripts/api.js")).api.clientId), now: await page.evaluate(async () => (await import("/scripts/api.js")).api.clientId) };
    R.pages = (await bridge("list_pages", {}, "short03-studio"))?.result?.pages?.map((x) => [x.id === ids.old ? "old" : x.id === ids.now ? "now" : "other", x.code_current]);
    await old.evaluate(() => document.querySelector(".snap-stale button:last-child")?.click());
    R.hidden = (await bar(old))?.shown === false;
    R.ask = await bridge("request_reload", { page: ids.old }, "short03-studio");
    await old.waitForFunction(() => /short03-studio asked/.test(document.querySelector(".snap-stale")?.textContent ?? ""), null, { timeout: 8000 }).catch(() => {});
    R.askedBar = await bar(old);
    R.notReloaded = await old.evaluate(() => window.__notReloaded === true);
    R.askCurrent = await bridge("request_reload", { page: ids.now }, "short03-studio");
    await old.locator(".snap-stale").screenshot({ path: path.join(out, "fc12_stale_bar.png") }).catch(() => {});
    await old.screenshot({ path: path.join(out, "fc12_stale_tab.png") });
    await B.ctx.close();
    // ---- F-C14: the copy check's graphs are answered here; the take is a real 64 px CPU still ----
    const checks = [];
    let n = 0;
    await page.route(/\/(api\/)?prompt$/, (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      const body = JSON.parse(r.request().postData()), g = body.prompt;
      if (!Object.values(g).some((x) => x.class_type === "MAISnapCopyScore")) return r.fallback();
      checks.push(g);
      const id = `fake-copy-${++n}`, outputs = {};
      for (const [k, x] of Object.entries(g)) if (x.class_type === "MAISnapCopyScore") {
        const ref = g[x.inputs.reference[0]], file = ref.class_type === "LoadImage" ? ref.inputs.image : g[ref.inputs.image[0]]?.inputs?.image ?? "";
        outputs[k] = { copy_scores: [/master/.test(file) ? 0.53 : 0.55], soft_scores: [/master/.test(file) ? 0.84 : 0.71] }; // the master: an aerial re-drawn from another viewpoint
      }
      page.__fake = { ...(page.__fake ?? {}), [id]: { status: { status_str: "success", completed: true, messages: [] }, outputs } };
      return r.fulfill({ json: { prompt_id: id, number: 1, node_errors: {} } });
    });
    await page.route(/\/(api\/)?history\/fake-copy-\d+$/, (r) => { const id = r.request().url().split("/").pop(); return r.fulfill({ json: page.__fake?.[id] ? { [id]: page.__fake[id] } : {} }); });
    R.fix = await page.evaluate(async () => {
      const SC = window.__SC, T = window.__T, J = window.__J; await T.load(); await SC.load();
      const s = await SC.create({ name: "F-C14 village" }); await SC.addShot(s.id, { name: "C2" }); await SC.addShot(s.id, { name: "design" });
      const [c2, design] = SC.get(s.id).shots; await SC.openShot(s.id, c2.id);
      const id = await J.queueRun({ kind: "run", title: "the C2 board", about: J.here() }, () => app.queuePrompt(0, 1));
      for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((r) => setTimeout(r, 250));
      return { scene: s.id, c2: c2.id, design: design.id, board: T.get(`take-${id}`)?.id };
    });
    R.copyView = await call("edit_from_context", { method: "ph3_view", pictures: [{ file: "snap/snaptest_fc_master.png", label: "village master" }, { file: "snap/snaptest_fc_road.png", crop: [0, 0, 0.5, 1], label: "road plate" }], prompt: "Edit <Picture 1>. From the square at eye height.", seeds: [1], land: { scene: R.fix.scene, shot: R.fix.c2 } });
    R.cleanView = await call("edit_from_context", { method: "ph3_view", pictures: [{ file: "snap/snaptest_fc_road.png", label: "road plate" }], prompt: "Edit <Picture 1>. The gate up close.", seeds: [2], land: { scene: R.fix.scene, shot: R.fix.c2 } });
    await F.idle(port);
    const noted = (d) => page.evaluate(async (id) => { const C = window.__C; for (let i = 0; i < 120; i++) { await C.settle(); const c = C.get(id)?.candidates[0]; if (c?.notes?.copied) return c.notes.copied; await new Promise((r) => setTimeout(r, 250)); } return C.get(id)?.candidates[0]?.notes ?? null; }, d);
    R.copied = R.copyView?.decision ? await noted(R.copyView.decision) : null;
    R.clean = R.cleanView?.decision ? await noted(R.cleanView.decision) : null;
    const g = checks[0];
    R.graph = g && { scores: Object.values(g).filter((x) => x.class_type === "MAISnapCopyScore").map((x) => [g[x.inputs.reference[0]].class_type, g[x.inputs.images[0]].class_type, g[x.inputs.images[0]].inputs.image]),
      encoder: Object.values(g).find((x) => x.class_type === "CLIPVisionLoader")?.inputs.clip_name, crop: Object.values(g).find((x) => x.class_type === "ImageCropV2")?.inputs.crop_region };
    R.chips = await page.evaluate(async (ds) => {
      const { candidatesEl } = await import("/extensions/ComfyUI-MAINodes/snap/candidateview.js"), C = window.__C;
      return ds.map((d) => { if (!C.get(d)) return null; const el = candidatesEl(C.get(d)); document.body.append(el); return { chips: [...el.querySelectorAll(".snap-cand-note")].map((x) => [x.textContent, x.classList.contains("warn")]), text: el.textContent }; });
    }, [R.copyView?.decision, R.cleanView?.decision]);
    // ---- F-C15 ----
    R.away = await call("edit_from_context", { method: "ph3_view", pictures: [{ take: R.fix.board, label: "C2 board" }], prompt: "Edit <Picture 1>. Night.", seeds: [3], land: { scene: R.fix.scene, shot: R.fix.design } });
    R.home = await call("edit_from_context", { method: "ph3_view", pictures: [{ take: R.fix.board, label: "C2 board" }], prompt: "Edit <Picture 1>. Dawn.", seeds: [4] });
    // ---- F-C16 ----
    const doc = F.BEFORE ? execFileSync("git", ["-C", WT, "show", `${F.BEFORE}:docs/snap/AGENT_START.md`]).toString() : fs.readFileSync(path.join(WT, "docs", "snap", "AGENT_START.md"), "utf8");
    const newView = doc.slice(doc.indexOf("### A new view of a place"), doc.indexOf("###", doc.indexOf("### A new view of a place") + 5));
    await F.idle(port);
    const nul = (t) => !/\bnull\b|undefined|\[object/.test(t ?? "null");
    const checks2 = {
      "F-C12 a stale tab shows the reload bar, with Reload and ✕": R.staleBar?.shown === true && R.staleBar.text.startsWith("Snap was updated: reload to get the new tools") && JSON.stringify(R.staleBar.buttons) === JSON.stringify(["Reload", "✕"]),
      "F-C12 a current tab shows none": R.currentBar?.shown === false,
      "F-C12 list_pages says which page is stale": JSON.stringify(R.pages?.filter(([w]) => w !== "other").sort()) === JSON.stringify([["now", true], ["old", false]]),
      "F-C12 ✕ hides it": R.hidden === true,
      "F-C12 request_reload shows it with the agent's name and never reloads": R.ask?.result?.shown === true && /short03-studio asked/.test(R.askedBar?.text ?? "") && R.askedBar.shown && R.notReloaded === true && /nothing reloads by itself/.test(R.ask.result.said ?? ""),
      "F-C12 request_reload on a current tab: nothing to reload": R.askCurrent?.result?.shown === false && /nothing to reload/.test(R.askCurrent.result.said ?? ""),
      "F-C12 no stray null on the bar": nul(R.staleBar?.text) && nul(R.askedBar?.text),
      "F-C14 the copy check scores the candidate still against each context picture (the crop too), DINOv3 from the model graph": JSON.stringify(R.graph?.scores?.map((x) => x.slice(0, 2))) === JSON.stringify([["LoadImage", "LoadImage"], ["ImageCropV2", "LoadImage"]]) && /\[output\]$/.test(R.graph.scores[0][2]) && /dino/i.test(R.graph.encoder ?? "") && R.graph.crop?.width === 64,
      "F-C14 at or above the soft threshold the note names the picture copied, its framing not kept": R.copied?.threshold === 0.72 && R.copied.soft_threshold === 0.82 && JSON.stringify(R.copied.copied) === "[1]" && JSON.stringify(R.copied.framing) === "[]" && R.copied.against?.map((a) => `${a.score}/${a.soft}`).join() === "0.53/0.84,0.55/0.71" && R.copied.against[0].label === "village master",
      "F-C14 the tile says 'copied Picture 1 0.84 · same composition' (amber), and 'no copy · nearest Picture n' when none reaches it": JSON.stringify(R.chips?.[0]?.chips?.filter(([t]) => /cop/.test(t))) === JSON.stringify([["copied Picture 1 0.84 · same composition", true]]) && JSON.stringify(R.chips?.[1]?.chips?.filter(([t]) => /cop/.test(t))) === JSON.stringify([["no copy · nearest Picture 1 0.71", false]]) && JSON.stringify(R.clean?.copied) === "[]",
      "F-C14 no stray null on the tiles": nul(R.chips?.[0]?.text) && nul(R.chips?.[1]?.text),
      "F-C15 landing away from the board's shot names it (land_hint); landing home says nothing": new RegExp(`is in Shot 1 · C2 of F-C14 village: .*shot: "${R.fix.c2}"`).test(R.away?.land_hint ?? "") && !R.home?.land_hint && /Shot 1 · C2/.test(R.home?.lands ?? ""),
      "F-C16 the New view tips carry the slit-pupil pattern": /Change only her eyes/.test(newView) && /single thin black vertical slit/.test(newView) && /no round pupil/.test(newView),
      "no page errors": !A.errors.length && !B.errors.length,
    };
    console.log(JSON.stringify(R, null, 1));
    let bad = 0;
    for (const [k, v] of Object.entries(checks2)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
    console.log(`u101fc   ${Object.keys(checks2).length - bad}/${Object.keys(checks2).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
    process.exitCode = bad ? 1 : 0;
  } finally {
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `u101fc-${Date.now()}`);
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
})().catch((e) => { console.error(e); process.exit(2); });
