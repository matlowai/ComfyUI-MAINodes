// U89 step 3 (SNAP-R63): Reuse the motion, on the CPU test server. Builds graphs only: POST /prompt for the MOSS paints
// and the Remake render is held and answered with a fake id (the real recast runs on :8193, the GPU check); Remake's node
// types are registered in the page and the model files are empty placeholders (as test_u73_methods.js does).
// A 107-frame take pins Kon v1 (details, picture), Bare v1 (a picture, no details line) and a setup card.
// - rerun reuse_motion Kon → Mara: one recast decision, who = Kon's details line, becomes = Mara's, the paint gets Mara's
//   picture as Picture 2 with the identity line; its title says "(Kon → Mara)";
// - the setup swap comes back not_possible (instead: regenerate) beside the recast; Bare → Mara with no who is refused
//   naming who and find_people, and runs with who;
// - applying a candidate queues Remake with the swap on its parent and Mara's pin (placed.recast) on the take, and the
//   navigator calls it "Recast · Kon → Mara (take N's motion)";
// - agents off: a proposal whose plan says recast for Kon, not_possible for the setup;
// - a 73-frame take (under Remake's 90) holds its last frame to 90 and the render is cut back to 73;
// - the sheet: picking Mara says the recast is painted from her details line and picture and enables Reuse the motion; a
//   setup pick alone leaves it off with the reason. Screen 375.
// usage: node test_rerun_motion.js [port 8195] [base dir]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const base = process.argv[3] || CFG.base;
const FILES = ["diffusion_models/moss_image_sft_int8_convrot.safetensors", "text_encoders/qwen3.5_9b_int8_convrot.safetensors", "vae/flux2-vae.safetensors",
  "loras/akhaliq_moss_edit_hq_armV5.safetensors", "loras/chinoll_moss_image_edit_adapter.safetensors", "diffusion_models/h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors",
  "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", "vae/minimax_h3_video_vae_fp16.safetensors", "vae/minimax_h3_audio_vae_fp32.safetensors",
  ...["edit", "edit_r128", "swap", "swap_r128"].map((x) => `loras/h3/viggle_remake/viggle_remake_${x}_comfyui.safetensors`)];
const REMAKE = ["RemakeConditioning", "RemakeKeyframeUntil", "RemakeNoise"];
(async () => {
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f)); // placeholders made here are parked at the end (moved, never deleted)
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const park = () => { const to0 = path.join(base, "_parked_placeholders", `rrmotion-${Date.now()}`); for (const f of made) { const to = path.join(to0, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); } };
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=5", path.join(base, "input", "snaptest_u89m.wav")]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  let page;
  try {
    page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
    await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    const held = [];
    await page.route(/\/api\/prompt$/, (r) => { const body = r.request().method() === "POST" && JSON.parse(r.request().postData());
      if (!body || !Object.values(body.prompt).some((n) => /TextEncodeMOSSImageEdit|RemakeConditioning/.test(n.class_type))) return r.continue();
      held.push(body); r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ prompt_id: `held-${held.length}`, number: 0, node_errors: {} }) }); });
    await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
    await page.keyboard.press("Escape");
    await page.evaluate(async (nodes) => { for (const t of nodes) LiteGraph.registered_node_types[t] ??= class {}; app.graph.clear(); app.graph.extra = {};
      const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["W", "world"], ["T", "takes"], ["SC", "scenes"], ["C", "candidates"], ["K", "checks"], ["M", "models"]]) window[`__${k}`] = await at(m);
      await window.__X.callTool("start_recipe", {}); await window.__M.load(); }, REMAKE);
    R.a = await page.evaluate(async () => {
      const L = window.__L, W = window.__W, T = window.__T, K = window.__K, M = window.__M;
      const pic = async (id, colour) => { const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }); c.getContext("2d").fillStyle = colour; c.getContext("2d").fillRect(0, 0, 64, 64);
        return L.uploadCastPicture(new File([await new Promise((r) => c.toBlob(r, "image/png"))], "front.png", { type: "image/png" }), id); };
      const stamp = Date.now().toString(36), k = `cast-konrm${stamp}`, m = `cast-mararm${stamp}`, z = `cast-barerm${stamp}`;
      await L.saveCast(k, { name: "Kon", details: "a fennec-eared courier girl in a blue jacket", lora: null, refs: [{ file: await pic(k, "#36a"), role: "identity: front" }] });
      const mp = await pic(m, "#c93");
      await L.saveCast(m, { name: "Mara", details: "a young woman with long dark wavy hair and a mustard coat", lora: null, refs: [{ file: mp, role: "identity: front" }] });
      await L.saveCast(z, { name: "Bare", details: "", lora: null, refs: [{ file: await pic(z, "#888"), role: "identity: front" }] });
      const v = (id) => { const r = W.record("cast", id), x = W.headOf(r); return { follow: true, n: x.n, hash: W.short(x.hash), name: x.body.name }; };
      const setup = M.setups().find((s) => s.source === "preset");
      const world = { [`cast:${k}`]: v(k), [`cast:${z}`]: v(z), "card:recipe-test-setup": { follow: true, n: 0, hash: "0", name: setup.name, setup: true } };
      const id = await K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 107, color: 3355443 } }, 2: { class_type: "LoadAudio", inputs: { audio: "snaptest_u89m.wav" } },
        3: { class_type: "CreateVideo", inputs: { images: ["1", 0], audio: ["2", 0], fps: 24 } }, 4: { class_type: "SaveVideo", inputs: { video: ["3", 0], filename_prefix: "snaptest/u89m", format: "auto", "format.codec": "auto", codec: "auto" } },
        5: { class_type: "MiniMaxH3ImageToVideo", inputs: { prompt: "Kon walks across a plaza", width: 64, height: 64, length: 107 } } }, { job: { kind: "run", title: "a test fixture take (SNAP-R65: every queued prompt carries its question)" }, group: app.graph.id, world });
      for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((r) => setTimeout(r, 500));
      const other = M.setups().find((s) => s.source === "preset" && s.name !== setup.name)?.name;
      return { take: `take-${id}`, number: T.get(`take-${id}`)?.number, kon: k, mara: m, bare: z, maraPic: mp, other, world: Object.keys(T.get(`take-${id}`)?.world ?? {}) };
    });
    const kon = `cast:${R.a.kon}`, mara = `cast:${R.a.mara}`, bare = `cast:${R.a.bare}`;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    // agents off: a proposal with the plan
    R.proposal = await call("rerun", { take: R.a.take, route: "reuse_motion", swaps: { [kon]: { to: mara }, setup: { to: R.a.other } } });
    await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true));
    let n = held.length;
    R.recast = await call("rerun", { take: R.a.take, route: "reuse_motion", swaps: { [kon]: { to: mara }, setup: { to: R.a.other } } });
    R.paint = held.slice(n).map((x) => Object.values(x.prompt).filter((v) => v.class_type === "TextEncodeMOSSImageEdit").map((v) => ({ prompt: v.inputs.prompt, image_1: v.inputs["images.image_1"] ?? null }))[0]);
    R.paintPic = held.slice(n).map((x) => x.prompt[8]?.inputs?.image ?? null);
    R.decision = await page.evaluate(async (id) => { await window.__C.load(); const d = window.__C.get(id); return d && { title: d.title, options: d.options, world: d.world }; }, R.recast.decisions?.[0]?.decision);
    R.bareNoWho = await call("rerun", { take: R.a.take, route: "reuse_motion", swaps: { [bare]: { to: mara } } });
    n = held.length;
    R.bareWho = await call("rerun", { take: R.a.take, route: "reuse_motion", swaps: { [bare]: { to: mara } }, who: "person 1", count: 1 });
    R.bareHeld = held.length - n;
    // apply the Kon → Mara candidate as if its paint finished
    n = held.length;
    R.applied = await page.evaluate(async (id) => { const C = window.__C, d = C.get(id), c = d.candidates[0];
      c.state = "ready"; c.pictures = c.frame.map((frame) => ({ label: `frame ${frame}`, frame, media: { filename: "front.png", subfolder: "snap", type: "input" } }));
      await C.save(d); return C.apply(id, c.id, "person").catch((e) => ({ error: e.message })); }, R.recast.decisions?.[0]?.decision);
    const rem = held.slice(n)[0];
    R.remake = rem && { parent: rem.extra_data?.snap_parent, world: rem.extra_data?.extra_pnginfo?.workflow?.extra?.snap?.world ?? null, prompt: Object.values(rem.prompt).find((v) => v.class_type === "RemakeConditioning")?.inputs?.prompt };
    R.label = await page.evaluate((parent) => window.__SC.label({ number: 9, parent }), R.remake?.parent ?? null);
    // a 3 s take (73 frames, under Remake's 90): the source's last frame is held to 90, the render cut back to 73
    n = held.length;
    R.shortApplied = await page.evaluate(async (id) => { const C = window.__C, d = C.get(id), c = d.candidates[0];
      d.clip = { ...d.clip, frames: 73, mid: 36 }; c.frame = [36]; c.state = "ready"; c.pictures = [{ label: "frame 36", frame: 36, media: { filename: "front.png", subfolder: "snap", type: "input" } }];
      await C.save(d); return C.apply(id, c.id, "person").catch((e) => ({ error: e.message })); }, R.bareWho.decisions?.[0]?.decision);
    const sh = held.slice(n)[0]?.prompt;
    R.short = sh && { frames: sh[11]?.inputs.frames, source: sh[11]?.inputs.source, amount: sh[22]?.inputs.amount, cut: sh[24]?.inputs.length, audio: sh[25]?.inputs.duration, video: sh[19]?.inputs.images };
    await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false));
    // the sheet
    R.sheet = await page.evaluate(async ([take, kon, mara, other]) => {
      const { openRerunSheet } = await import("/extensions/ComfyUI-MAINodes/snap/rerunsheet.js");
      const s = await openRerunSheet(document.querySelector(".snap-root"), { take: window.__T.get(take), say() {}, edit() {} });
      const pick = async (slot, v) => { const sel = [...s.querySelectorAll(".snap-rerun-pick")].find((x) => x.closest(".snap-world-row").querySelector("strong").textContent.startsWith(slot)); sel.value = v; sel.dispatchEvent(new Event("change")); await new Promise((r) => setTimeout(r, 600)); };
      const reuse = () => [...s.querySelectorAll(".snap-rerun-actions button")].find((x) => x.textContent === "Reuse the motion");
      const lines = () => [...s.querySelectorAll(".snap-rerun-route")].map((x) => x.textContent);
      await pick("Setup", other); const setupOnly = { lines: lines(), disabled: reuse().disabled, title: reuse().title };
      await pick("Kon", mara); return { setupOnly, withMara: { lines: lines(), disabled: reuse().disabled } };
    }, [R.a.take, kon, mara, R.a.other]);
    await page.locator(".snap-rerun-sheet").screenshot({ path: path.join(out, "375-u89-reuse-motion-sheet.png") });
    R.errors = errs;
    const d0 = R.recast.decisions?.[0];
    const c = {
      "the take pins Kon, Bare and the setup": R.a.world.length === 3,
      "agents off: a proposal; its plan says recast for Kon and not_possible for the setup": !!R.proposal.proposed && R.proposal.plan?.swaps?.some((s) => s.method === "remake_swap" && s.who === "a fennec-eared courier girl in a blue jacket") && R.proposal.plan.swaps.some((s) => s.slot === "setup" && s.not_possible && s.instead === "regenerate"),
    "reuse_motion Kon → Mara: one recast decision, who = Kon's details, becomes = Mara's": R.recast.decisions?.length === 1 && d0.method === "remake_swap" && d0.who === "a fennec-eared courier girl in a blue jacket" && d0.becomes === "a young woman with long dark wavy hair and a mustard coat",
      "the setup swap comes back not_possible with the regenerate hint": R.recast.not_possible?.[0]?.slot === "setup" && R.recast.not_possible[0].instead === "regenerate",
      "the paint gets Mara's picture as Picture 2 with the identity line": R.paint.length === 2 && R.paint.every((p) => p?.image_1 && /Picture 2 shows the new person/.test(p.prompt)) && R.paintPic.every((x) => x === R.a.maraPic),
      "the decision is titled (Kon → Mara) and keeps the swap": /^Recast · Viggle Remake \(Kon → Mara\) of take \d+$/.test(R.decision?.title ?? "") && R.decision.options.rerun?.text === "Kon → Mara" && !!R.decision.world?.[mara],
      "Bare (no details line) without who is refused naming who and find_people; with who it runs": /who: .*find_people/.test(R.bareNoWho.error ?? "") && R.bareWho.decisions?.length === 1 && R.bareHeld === 1,
      "applying queues Remake with the swap on its parent and Mara pinned (placed.recast)": R.remake?.parent?.method === "recast/remake_swap" && R.remake.parent.options.rerun?.text === "Kon → Mara" && R.remake.world?.[mara]?.placed?.recast === true && /mustard coat/.test(R.remake.prompt ?? ""),
      "the navigator calls it 'Recast · Kon → Mara (take N's motion)'": R.label === `Recast · Kon → Mara (take ${R.a.number}'s motion)`,
      "sheet: a setup pick alone leaves Reuse the motion off, saying why": R.sheet.setupOnly.disabled && /not on its own motion/.test(R.sheet.setupOnly.lines.join(" ")) && /Re-generate does them/.test(R.sheet.setupOnly.title),
      "sheet: picking Mara says recast from her details line and picture, and enables it": !R.sheet.withMara.disabled && /recast \(Viggle Remake\), painted from the new Cast's details line and picture/.test(R.sheet.withMara.lines.join(" ")),
      "a 73-frame take holds its last frame to Remake's 90 and is cut back to 73 (picture and sound)": R.short?.frames === 90 && R.short.source?.[0] === "23" && R.short.amount === 17 && R.short.cut === 73 && Math.abs(R.short.audio - 73 / 24) < 1e-9 && R.short.video?.[0] === "24",
      "no page errors": !errs.length,
    };
    R.checks = c;
    fs.writeFileSync(path.join(out, "test_rerun_motion_result.json"), JSON.stringify(R, null, 1));
    const bad = Object.keys(c).filter((k) => !c[k]);
    console.log(`rrmotion ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  } finally { await page?.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false)).catch(() => {}); await b.close(); park(); }
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
