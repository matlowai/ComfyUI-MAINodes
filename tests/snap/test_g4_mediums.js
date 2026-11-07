// Batch G4 mediums from short05 (SNAP-R143, R144, R84) on the CPU test server:
// - F-F05 save_location keeps what a new version leaves out: v2 {master} keeps the plan with its shapes, the camera
//   marks and the plates, and says so in kept; null clears a field;
// - F-F08 apply_location puts the place's pictures in one order every time: after an apply with master: false, the
//   next apply has master, plan, plate in a row (not the plan before the master);
// - F-F06 use_take {as: "voice"} cuts a take's sound into input/snap/voice/ and makes it the Cast's voice (a new version
//   naming the take); a still is refused;
// - F-F13 cancel_run takes an agent's queued run out of the queue and interrupts its running one; a finished run says
//   there is nothing to cancel.
// usage: node test_g4_mediums.js [port] [base]   prints "g4med n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-g4med-${Date.now()}`)); } };
(async () => {
  ["takes", "location", "cast", "proposals.json"].forEach(park); // moved, never deleted
  const D = CFG.fixture("short04"), fx = path.join(base, "input", "snaptest_g4med"), vo = path.join(base, "output", "snaptest_g4med");
  for (const d of [fx, vo]) fs.mkdirSync(d, { recursive: true });
  for (const [f, to] of [["settei_bg/MASTER_shrine_v1.png", "master.png"], ["settei_bg/P1_torii_eyelevel.png", "plan.png"], ["bible/hiyori_back_v1.png", "p1.png"], ["bible/hiyori_front_v1.png", "kon.png"]]) fs.copyFileSync(path.join(D, f), path.join(fx, to));
  fs.copyFileSync(CFG.fixture("e2e_refs3_00001_.mp4"), path.join(vo, "voice_take.mp4"));
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port, { slow: 60 }), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    // F-F05
    const loc = (await call("save_location", { name: "Cart", master: { file: "snaptest_g4med/master.png" }, cameras: [{ name: "C1", x: 0.5, y: 0.8, heading: 0 }, { name: "C2", x: 0.2, y: 0.5, heading: 90 }], plates: [{ name: "P1", file: "snaptest_g4med/p1.png" }] })).location;
    R.plan = await call("draw_set_plan", { location: loc, shapes: [{ kind: "rect", x: 0.5, y: 0.5, w: 0.3, h: 0.2, label: "cart" }], cameras: [{ name: "C1", x: 0.5, y: 0.8, heading: 0 }, { name: "C2", x: 0.2, y: 0.5, heading: 90 }] });
    R.v3 = await call("save_location", { location: loc, master: { file: "snaptest_g4med/kon.png" } });
    R.rec3 = (await call("list_locations", {})).find?.((l) => l.location === loc || l.ref?.startsWith(loc)) ?? null;
    R.head3 = await page.evaluate(async (loc) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); const b = W.headOf(W.record("location", loc.split(":")[1])).body; return { master: b.master?.file, plan: b.plan?.file, shapes: b.plan?.shapes?.length ?? 0, cameras: b.cameras.length, plates: b.plates.length }; }, loc);
    R.v4 = await call("save_location", { location: loc, plates: [] });
    R.head4plates = await page.evaluate(async (loc) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); return W.headOf(W.record("location", loc.split(":")[1])).body.plates.length; }, loc);
    // F-F08
    await call("save_location", { location: loc, plates: [{ name: "P1", file: "snaptest_g4med/p1.png" }] });
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    R.applyB = await call("apply_location", { location: loc, plates: ["P1"], master: false });
    R.applyA = await call("apply_location", { location: loc, plates: ["P1"] });
    R.order = await page.evaluate(() => window.__E.references().pictures.map((p) => p.role));
    // F-F06
    const now = Date.now();
    await page.evaluate(async (now) => { const T = window.__T; await T.save({ id: "take-g4med-voice", kind: "run", prompt_id: "g4med-voice", created: now, seconds: 3, group: "g4med", number: 1, status: "success", text: "voice", seed: 1, media: [{ kind: "video", filename: "voice_take.mp4", subfolder: "snaptest_g4med", type: "output" }], prompt: {}, graph: {}, verdict: null, notes: [] });
      await T.save({ id: "take-g4med-still", kind: "run", prompt_id: "g4med-still", created: now, seconds: 1, group: "g4med", number: 2, status: "success", text: "still", seed: 1, media: [{ kind: "image", filename: "kon.png", subfolder: "snaptest_g4med", type: "input" }], prompt: {}, graph: {}, verdict: null, notes: [] }); }, now);
    const kon = (await call("save_cast", { name: "Kon", details: "a girl", refs: [{ file: "snaptest_g4med/kon.png", role: "front" }] })).cast;
    R.voice = await call("use_take", { take: "take-g4med-voice", as: "voice", cast: kon, at: 0.5, length: 1.5, casting: "young, bright" });
    R.voiceFile = R.voice?.voice && fs.existsSync(path.join(base, "input", R.voice.voice)) ? fs.statSync(path.join(base, "input", R.voice.voice)).size : 0;
    R.castVoice = await page.evaluate(async (kon) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); const r = W.record("cast", kon.split(":")[1]); return { voice: W.headOf(r).body.voice, note: r.versions.at(-1).note }; }, kon);
    R.voiceStill = await call("use_take", { take: "take-g4med-still", as: "voice", cast: kon });
    // F-F13
    R.run1 = await call("run", { question: "g4 cancel: the running one", new_seed: true });
    R.run2 = await call("run", { question: "g4 cancel: the queued one", new_seed: true });
    await page.waitForTimeout(1500);
    R.cancelQueued = await call("cancel_run", { run: R.run2.run });
    R.cancelRunning = await call("cancel_run", { run: R.run1.run });
    await page.waitForTimeout(3000);
    R.cancelDone = await call("cancel_run", { run: R.run1.run });
    R.cancelNone = await call("cancel_run", { run: "no-such-run" });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
  }
  const S = R, at = (re) => S.order?.findIndex((r) => re.test(r ?? ""));
  const checks = {
    keepsOmitted: S.head3?.master === "snaptest_g4med/kon.png" && S.head3.shapes === 1 && S.head3.cameras === 2 && S.head3.plates === 1 && !!S.head3.plan,
    saysKept: S.v3?.kept?.some((k) => /^cameras \(2\)$/.test(k)) && S.v3?.kept?.some((k) => /^plates \(1\)$/.test(k)) && S.v3?.kept?.includes("plan") && /kept from v2/.test(S.v3?.said ?? ""),
    emptyListClears: S.head4plates === 0,
    orderAfterReapply: at(/, master/) >= 0 && at(/, master/) + 1 === at(/, plan$/) && at(/, plan$/) + 1 === at(/, plate P1/),
    voiceSaved: /^snap\/voice\/Kon_voice_take1_0p5s\.wav$/.test(S.voice?.voice ?? "") && S.voiceFile > 100000 && S.castVoice?.voice?.file === S.voice?.voice && S.castVoice.voice.casting === "young, bright" && /voice from take 1, 0\.5 s for 1\.5 s/.test(S.castVoice.note ?? ""),
    voiceStillRefused: /is a still: it has no sound/.test(S.voiceStill?.error ?? ""),
    cancelQueued: S.cancelQueued?.was === "queued" && /taken out of the queue/.test(S.cancelQueued?.said ?? ""),
    cancelRunning: S.cancelRunning?.was === "running" && /interrupted/.test(S.cancelRunning?.said ?? ""),
    cancelDone: /already: nothing to cancel/.test(S.cancelDone?.said ?? "") && /No run no-such-run/.test(S.cancelNone?.error ?? ""),
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g4_mediums_result.json"), JSON.stringify(R, null, 1));
  console.log(`g4med ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
