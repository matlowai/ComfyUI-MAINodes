// SNAP-R80 on the CPU test server: every picture is one click from full size.
// Per path: References' <Picture n> rows (a Cast picture: its "Edit the Cast record" becomes a button in the viewer),
// an audio reference row (a click plays it), the New view tray, the Cast sheet, a camera plate, a candidate tile, a take
// card's ⤢ and the take viewer's ⤢ (a sheet take steps through all its pictures). The viewer: name, source and size,
// fit / 100 % and zoom, ← → through the row, Esc closes, the page never navigates and nothing changes; no stray null.
// The agent twin open_view {view: picture} by take, cast, decision and path, and its refusals. Screens fullview_*.png.
// usage: node test_u101_full.js [port 8195] [base dir]     BEFORE=234ee8d node test_u101_full.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui", "u101"), R = {};
const base = process.argv[3] || CFG.base;
const FILES = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"];
const sh = (cmd, args) => new Promise((done, fail) => execFile(cmd, args, (e) => (e ? fail(e) : done())));
(async () => {
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  fs.mkdirSync(path.join(base, "input", "snap"), { recursive: true });
  await sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=s=1600x900", "-frames:v", "1", path.join(base, "input", "snap", "snaptest_full_front.png")]);
  await sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x804060:s=300x500", "-frames:v", "1", path.join(base, "input", "snap", "snaptest_full_back.png")]);
  await sh("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=2", path.join(base, "input", "snap", "snaptest_full_voice.wav")]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const url0 = page.url().split("#")[0];
    await page.evaluate(() => { window.__stay = true; });
    // what the viewer shows now
    const lb = () => page.evaluate(() => { const el = document.querySelector(".snap-lb"); if (!el) return null; const m = el.querySelector(".snap-lb-stage > *");
      return { what: el.querySelector(".snap-lb-what").textContent, fit: m?.classList.contains("fit"), transform: m?.style.transform ?? "", src: m?.getAttribute("src"), buttons: [...el.querySelectorAll(".snap-lb-bar button:not([hidden]), .snap-lb-bar a")].map((x) => x.textContent), text: el.textContent }; });
    const settle = () => page.waitForTimeout(500);
    const esc = async () => { await page.keyboard.press("Escape"); await settle(); return !(await page.$(".snap-lb")); };
    R.cast = await call("save_cast", { name: "Maren", details: "a tall swordswoman", lora: null, refs: [{ file: "snap/snaptest_full_front.png", role: "identity: front" }, { file: "snap/snaptest_full_back.png", role: "back" }],
      voice: { file: "snap/snaptest_full_voice.wav", casting: "low cool alto" } });
    await call("start_recipe", {});
    await call("apply_cast", { cast: R.cast.cast });
    await page.evaluate(async () => { const m = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); m.snap.view?.render?.(); }); await settle();
    // 1. References: the first Cast picture
    const refImg = page.locator(".snap-pics figure img").first();
    R.refsMarked = await refImg.evaluate((x) => x.classList.contains("snap-full")).catch(() => false);
    await refImg.click().catch(() => {}); await page.waitForTimeout(800);
    R.refs = await lb();
    await page.screenshot({ path: path.join(out, "fullview_refs.png") });
    R.castSheetOpened = await page.$$eval(".snap-sheet, .snap-cast-sheet", (xs) => xs.some((x) => /Cast: Maren/.test(x.textContent))).catch(() => false);
    await page.keyboard.press("ArrowRight"); await settle(); R.refsNext = await lb();
    await page.click(".snap-lb-bar button:has-text('100 %')").catch(() => {}); await settle(); R.actual = await lb();
    await page.click(".snap-lb-bar button:has-text('+')").catch(() => {}); await settle(); R.zoomed = await lb();
    await page.click(".snap-lb-bar button:has-text('Fit')").catch(() => {}); await settle(); R.fitAgain = await lb();
    await page.keyboard.press("ArrowLeft"); await settle(); R.refsBack = await lb();
    R.refsEsc = await esc();
    // the action the row's click had is a button in the viewer: Edit the Cast record
    await refImg.click().catch(() => {}); await settle();
    await page.click(".snap-lb-bar button:has-text('Edit the Cast record')").catch(() => {}); await page.waitForTimeout(900);
    R.castFromViewer = { closed: !(await page.$(".snap-lb")), sheet: await page.$$eval(".snap-sheet", (xs) => xs.map((x) => x.textContent.slice(0, 60))).catch(() => []) };
    // 2. the Cast sheet's pictures
    const castImg = page.locator(".snap-cast-refs img").nth(1);
    await castImg.click().catch(() => {}); await settle(); R.castPic = await lb();
    await page.screenshot({ path: path.join(out, "fullview_cast.png") });
    R.castEsc = await esc();
    await page.keyboard.press("Escape"); await settle(); // the Cast sheet
    for (const s of await page.$$(".snap-sheet")) await s.evaluate((x) => x.remove());
    // 3. an audio reference row plays on a click
    await page.evaluate(() => { for (const a of document.querySelectorAll(".snap-ref-audio audio")) { a.muted = true; } });
    await page.click(".snap-ref-audio b").catch(() => {}); await page.waitForTimeout(600);
    R.audio = await page.$eval(".snap-ref-audio audio", (a) => ({ paused: a.paused, time: a.currentTime })).catch(() => null);
    // 4. a candidate tile (a New view on the CPU: fwork turns it into a real 64 px take) and its take
    R.fix = await page.evaluate(async () => {
      const SC = window.__SC; await SC.load();
      const s = await SC.create({ name: "Full size" }); await SC.addShot(s.id, { name: "C1" }); await SC.openShot(s.id, SC.get(s.id).shots[0].id);
      return { scene: s.id, shot: SC.get(s.id).shots[0].id };
    });
    R.view = await call("edit_from_context", { method: "ph3_view", pictures: [{ cast: R.cast.cast }, { file: "snap/snaptest_full_back.png", label: "back" }], prompt: "Edit <Picture 1>.", seeds: [1, 2], land: { scene: R.fix.scene, shot: R.fix.shot } });
    await F.idle(port);
    await page.evaluate(async (d) => { const C = window.__C, T = window.__T; for (let i = 0; i < 80; i++) { await C.settle(); await T.reload(); if (C.get(d)?.candidates.every((c) => c.state === "ready" && T.get(c.take ?? ""))) break; await new Promise((r) => setTimeout(r, 250)); } }, R.view?.decision);
    R.take = R.view?.candidates?.[0]?.take;
    // the tray, in the take viewer of that take
    await page.evaluate(async (id) => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); snap.view.render(null); }, R.take);
    await settle();
    const card = page.locator(`.snap-take[data-take="${R.take}"]`);
    R.cardFull = await card.locator(".snap-take-full").count();
    await card.locator(".snap-take-full").click().catch(() => {}); await settle();
    R.cardLb = await lb(); R.cardNoViewer = !(await page.$(".snap-take-sheet"));
    R.cardEsc = await esc();
    await card.click().catch(() => {}); await page.waitForSelector(".snap-take-sheet", { timeout: 8000 }).catch(() => {});
    await page.click(".snap-take-sheet .snap-take-stage .snap-take-full").catch(() => {}); await settle();
    R.viewerLb = await lb(); R.viewerEsc = await esc(); R.viewerStays = !!(await page.$(".snap-take-sheet"));
    await page.click(`.snap-take-sheet button:has-text("＋ Add this picture")`).catch(() => {});
    await page.selectOption(`.snap-take-sheet select[aria-label="add a Cast picture"]`, { index: 2 }).catch(() => {});
    await settle();
    await page.locator(".snap-take-sheet .snap-ctx-row img").nth(1).click().catch(() => {}); await settle();
    R.tray = await lb();
    await page.keyboard.press("ArrowLeft"); await settle(); R.trayPrev = await lb();
    await page.screenshot({ path: path.join(out, "fullview_tray.png") });
    R.trayEsc = await esc();
    R.trayKept = await page.$$eval(".snap-take-sheet .snap-ctx-row", (xs) => xs.length);
    // the candidates in the viewer's rail
    await page.evaluate(async (d) => { const { candidatesEl } = await import("/extensions/ComfyUI-MAINodes/snap/candidateview.js"); const el = candidatesEl(window.__C.get(d)); el.id = "u101-full-tiles"; el.style.cssText = "position: fixed; top: 0; left: 0; z-index: 2500; background: #111; max-width: 900px"; document.body.append(el); }, R.view?.decision);
    await page.locator("#u101-full-tiles .snap-cand-pics img").first().click().catch(() => {}); await settle();
    R.cand = await lb();
    await page.keyboard.press("ArrowRight"); await settle(); R.candNext = await lb();
    R.candEsc = await esc(); await page.evaluate(() => document.getElementById("u101-full-tiles")?.remove());
    await page.keyboard.press("Escape"); await settle();
    for (const s of await page.$$(".snap-take-sheet")) await s.evaluate((x) => x.remove());
    // 5. a camera plate in the set editor
    R.plate = (await call("set_set_plate", { set: "set-lamp-room-end-s3", camera: "wide", image: "snap/snaptest_full_front.png" }))?.error ?? "set";
    await page.click('.snap-brick[data-brick="refs"] .snap-name').catch(() => {}); await page.waitForTimeout(200);
    await page.click('.snap-card:has-text("lamp room") .snap-edit[title^="open the set plan"] >> nth=0').catch(() => {}); await page.waitForTimeout(1200);
    await page.locator(".snap-set-plate img:not([hidden])").first().click().catch(() => {}); await settle();
    R.plateLb = await lb();
    R.plateEsc = await esc();
    for (const s of await page.$$(".snap-sheet")) await s.evaluate((x) => x.remove());
    // 6. the agent twin
    R.ovTake = await call("open_view", { view: "picture", take: R.take }); R.ovTakeLb = await lb(); await esc();
    R.ovCast = await call("open_view", { view: "picture", cast: R.cast.cast, ref: 1 }); R.ovCastLb = await lb(); await esc();
    R.ovDecision = await call("open_view", { view: "picture", decision: R.view?.decision, candidate: "c2" }); R.ovDecisionLb = await lb();
    await page.screenshot({ path: path.join(out, "fullview_open_view.png") }); await esc();
    R.ovPath = await call("open_view", { view: "picture", path: "input/snap/snaptest_full_back.png" }); R.ovPathLb = await lb(); await esc();
    R.ovBad = { none: await call("open_view", { view: "picture" }), take: await call("open_view", { view: "picture", take: "take-nope" }), path: await call("open_view", { view: "picture", path: "elsewhere/x.png" }) };
    R.url = page.url().split("#")[0]; R.stayed = await page.evaluate(() => window.__stay === true);
    const nul = (t) => t != null && !/\bnull\b|undefined|\[object|NaN/.test(t);
    const checks = {
      "References: a click opens the picture full size (name, source, size), not the Cast sheet": R.refsMarked && /^<Picture 1> cast: Maren, identity: front · Cast cast:.* · 1600×900/.test(R.refs?.what ?? "") && R.refs.fit === true && !R.castSheetOpened,
      "the viewer: → and ← step through the row": /^<Picture 2>.*300×500/.test(R.refsNext?.what ?? "") && /^<Picture 1>/.test(R.refsBack?.what ?? ""),
      "the viewer: 100 % shows it pixel for pixel, + zooms, Fit fits again": R.actual?.fit === false && /scale\(1\)/.test(R.actual.transform) && /scale\(1\.25\)/.test(R.zoomed?.transform ?? "") && R.fitAgain?.fit === true,
      "the viewer: Esc closes it": R.refsEsc && R.castEsc && R.cardEsc && R.viewerEsc && R.trayEsc && R.candEsc && R.plateEsc,
      "References: the row's own click (Edit the Cast record) is a button in the viewer": R.castFromViewer.closed && R.castFromViewer.sheet.some((t) => /Maren/.test(t)),
      "Cast sheet: its pictures open full size": /^Maren, back · input\/snap\/snaptest_full_back.png · 300×500/.test(R.castPic?.what ?? ""),
      "an audio reference row plays on a click": R.audio?.paused === false,
      "a take card's ⤢ opens it full size without opening the take": R.cardFull === 1 && /^Take \d+ · output\/.* · 64×64/.test(R.cardLb?.what ?? "") && R.cardNoViewer,
      "the take viewer's ⤢ opens it full size; Esc leaves the viewer open": /^Take \d+/.test(R.viewerLb?.what ?? "") && R.viewerStays,
      "the New view tray: a row's picture opens, ← steps through the tray, the tray stays": /^Picture 2 · Maren, .* · input\/snap\//.test(R.tray?.what ?? "") && /^Picture 1 · take \d+ · output\//.test(R.trayPrev?.what ?? "") && R.trayKept === 2,
      "a candidate tile's picture opens, → steps to the next candidate": /^c1 · new view · output\//.test(R.cand?.what ?? "") && /^c2 · new view/.test(R.candNext?.what ?? ""),
      "a camera plate opens full size": R.plate === "set" && /^wide plate plate · input\//.test(R.plateLb?.what ?? ""),
      "open_view picture: by take, Cast (+ref), decision (+candidate) and path": /^Take \d+/.test(R.ovTakeLb?.what ?? "") && R.ovTake?.showing?.index === 0
        && /^Maren, back · Cast cast:.* v1/.test(R.ovCastLb?.what ?? "") && /^c2 · new view/.test(R.ovDecisionLb?.what ?? "") && R.ovDecision?.showing?.count === 2 && /^snaptest_full_back.png · input\/snap/.test(R.ovPathLb?.what ?? ""),
      "open_view says what to give": /give take, cast, (location, )?decision, file or path/.test(R.ovBad.none.error ?? "") && /No take take-nope/.test(R.ovBad.take.error ?? "") && /path is output\/… or input\//.test(R.ovBad.path.error ?? ""),
      "viewing never navigates (same page, never reloaded)": new URL(R.url).origin === new URL(url0).origin && R.stayed,
      "no stray null in the viewer": [R.cand, R.refs, R.refsNext, R.castPic, R.cardLb, R.viewerLb, R.tray, R.cand, R.plateLb, R.ovTakeLb, R.ovCastLb, R.ovDecisionLb, R.ovPathLb].every((x) => nul(x?.text)),
      "no page errors": !A.errors.length,
    };
    console.log(JSON.stringify(R, null, 1));
    let bad = 0;
    for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
    console.log(`u101full ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
    process.exitCode = bad ? 1 : 0;
  } finally {
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `u101full-${Date.now()}`);
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
})().catch((e) => { console.error(e); process.exit(2); });
