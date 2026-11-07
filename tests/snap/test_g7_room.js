// Batch G7, the Book's step 10 (CONCEPT_PRODUCTION §11.5): the Room, the person's front door over the Work card and the
// docket (SNAP-R70):
// - the leak test: with a landed take, a candidate decision, a proposal and a blind pair whose agent-written words carry
//   ids, file names, model names and state words, no banned word is anywhere in the Room as each question comes up;
// - role-true: none of the Work card's machinery is rendered in it (no Park, Stop, state lines, counts);
// - a verdict given in the Room is the take's verdict (by person, with the sentence), "actually, no" takes it back; a
//   "This one" applies the candidate; "No" rejects the proposal with the sentence as its because; A judges the blind pair;
// - /?room on a phone (390×844) and a tablet (820×1180) opens straight into the Room, without page errors or a
//   sideways scroll (the stub-DOM load check). Screens: ui/g7/room_desk.png, room_phone.png, room_tablet.png.
// usage: node test_g7_room.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g7");
const base = process.argv[3] || CFG.base;
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  ["takes", "candidates", "scenes", "proposals.json", "work.json", "critiques"].forEach(park); // moved, never deleted
  const blindFile = path.join(base, "user", "snap_blind.json");
  if (fs.existsSync(blindFile)) fs.renameSync(blindFile, path.join(base, "user", `snap_blind.parked-${Date.now()}.json`));
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const wait = async (run) => { for (let i = 0; i < 40; i++) { const s = await call("run_status", { run, wait_s: 5 }); const r = s.runs?.[0]; if (r && ["done", "failed"].includes(r.state)) return r; } return null; };
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const sc = await call("create_scene", { name: "Gate" }), sid = sc.scene?.id ?? sc.id ?? sc.scene;
    const shot = (await call("add_shot", { scene: sid, name: "C1" })).shot?.id;
    await call("open_shot", { scene: sid, shot }); await page.waitForTimeout(2500);
    const ids = [];
    for (const q of ["Does the H3 take hold the gate? (take-ab12cd34ef, snaptest/batchF_00001_.png)", "the lantern, second try (status: Pika render, id 7)"]) { const r = await call("run", { question: q }); await wait(r.run); ids.push(`take-${r.run}`); }
    await page.waitForTimeout(1500);
    R.ids = ids;
    R.decision = await page.evaluate(async (ids) => {
      window.__C.kind("g7room", { apply: async () => ({}), undo: async () => {} });
      const pic = (id) => ({ media: window.__T.get(id).media[0], label: "front" });
      const d = await window.__C.create({ kind: "g7room", target: ids[0], title: "Which lantern? a MOSS edit of take-ab12cd34ef for cast:mw3ukbglzle6 (priority)", by: "agent" }, [{ pictures: [pic(ids[0])] }, { pictures: [pic(ids[1])] }]);
      return d.id;
    }, ids);
    const prop = await call("set_setting", { brick: "render", name: "prompt", value: "a lantern by a gate at dusk", propose: true, reason: "p3: dusk light on the gate, as the Fizgig still shows (task 2, out_0004.mp4)" });
    R.prop = prop.proposed;
    R.pair = (await call("setup_ab", { take_a: ids[0], take_b: ids[1] })).pair;
    // a done take the person hasn't opened is in Landed: open the Room
    R.open = await call("open_view", { view: "room" });
    await page.waitForTimeout(2500);
    const roomText = () => page.locator(".snap-room").textContent();
    const texts = [];
    R.firstQ = await page.locator(".snap-room-q h2").textContent();
    texts.push(await roomText());
    await page.screenshot({ path: path.join(out, "room_desk.png") });
    // every question in turn (each "Then" line brings one up)
    const lines = await page.locator("button.snap-room-line").allTextContents();
    R.lines = lines;
    for (const line of lines) { await page.locator("button.snap-room-line", { hasText: line }).first().click(); await page.waitForTimeout(500); texts.push(await roomText()); }
    R.banned = await page.evaluate(async (texts) => { const RM = await import("/extensions/ComfyUI-MAINodes/snap/room.js"); return texts.flatMap((t) => RM.BANNED.filter((re) => re.test(t)).map((re) => `${re} in "${t.match(re)?.[0]}"`)); }, texts);
    R.texts = texts;
    R.machinery = await page.evaluate(() => { const r = document.querySelector(".snap-room"); return { workEls: r.querySelectorAll("[class*='snap-work']").length, buttons: [...r.querySelectorAll("button")].map((b) => b.textContent).filter((t) => /Park|Stop|Cancel|Retry|Accept all/.test(t)), digits: /\b\d+\s+(in flight|landed|waiting|due)\b/.test(r.textContent) }; });
    // verdicts: bring each kind up and answer it
    const bring = async (re) => { const n = await page.locator("button.snap-room-line").count(); for (let i = 0; i < n; i++) { const t = await page.locator("button.snap-room-line").nth(i).textContent(); if (re.test(t)) { await page.locator("button.snap-room-line").nth(i).click(); await page.waitForTimeout(500); return true; } } return re.test(await page.locator(".snap-room-q h2").textContent()); };
    R.broughtTake = await bring(/hold the gate/);
    await page.locator(".snap-room-why").fill("the gate holds through the turn");
    await page.locator(".snap-room-verdict button", { hasText: "Keep it" }).click(); await page.waitForTimeout(1200);
    R.takeAfter = await page.evaluate((id) => { const t = window.__T.get(id); return { verdict: t.verdict, by: t.verdict_by, because: t.verdict_note }; }, ids[0]);
    R.reply = await page.locator(".snap-room-reply").textContent();
    R.earlier = await page.locator(".snap-room-earlier").textContent().catch(() => null);
    await page.locator(".snap-room-earlier .snap-link", { hasText: "actually, no" }).first().click(); await page.waitForTimeout(800);
    R.takeBack = await page.evaluate((id) => { const t = window.__T.get(id); return { verdict: t.verdict ?? null, past: t.verdicts_past?.map((x) => x.retracted.reason) }; }, ids[0]);
    R.broughtProp = await bring(/^So:/);
    await page.locator(".snap-room-why").fill("not dusk, keep it noon");
    await page.locator(".snap-room-verdict button", { hasText: "No" }).click(); await page.waitForTimeout(1200);
    R.propAfter = await page.evaluate((id) => { const p = window.__P.get(id); return { status: p?.status, because: p?.because }; }, R.prop);
    R.broughtDecision = await bring(/Which lantern/);
    await page.locator(".snap-room-pics .snap-primary", { hasText: "This one" }).first().click(); await page.waitForTimeout(1200);
    R.decisionAfter = await page.evaluate((id) => ({ status: window.__C.get(id)?.status, applied: window.__C.get(id)?.applied?.by }), R.decision);
    R.broughtBlind = await bring(/Which is better/);
    await page.locator(".snap-room-verdict button", { hasText: /^A$/ }).click(); await page.waitForTimeout(1200);
    R.blindAfter = await page.evaluate(async () => (await window.__T.pending()).length);
    R.replyBlind = await page.locator(".snap-room-reply").textContent();
    R.finalBanned = await page.evaluate(async () => { const RM = await import("/extensions/ComfyUI-MAINodes/snap/room.js"), t = document.querySelector(".snap-room").textContent; return RM.BANNED.filter((re) => re.test(t)).map(String); });
    R.errors = A.errors;
    // the phone and the tablet: /?room straight in
    for (const [name, vp] of [["phone", { width: 390, height: 844 }], ["tablet", { width: 820, height: 1180 }]]) {
      const ctx = await b.newContext({ viewport: vp, isMobile: name === "phone", hasTouch: true, deviceScaleFactor: 2 });
      const p = await ctx.newPage(), errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      await p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
      await p.goto(`http://127.0.0.1:${port}/?room`);
      const shown = await p.waitForSelector(".snap-room", { timeout: 90000 }).then(() => true, () => false);
      await p.waitForTimeout(2500);
      R[name] = { shown, errors: errs, sideways: await p.evaluate(() => { const r = document.querySelector(".snap-room"); return r ? r.scrollWidth > r.clientWidth + 1 : null; }), text: shown ? await p.locator(".snap-room").textContent() : "" };
      await p.screenshot({ path: path.join(out, `room_${name}.png`) });
      await ctx.close();
    }
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
  }
  const S = R;
  const checks = {
    opens: /the Room is open/.test(S.open?.said ?? "") && !!S.firstQ,
    everyKindAsked: (S.lines?.length ?? 0) >= 3 && S.texts?.some((t) => /Which is better\?/.test(t)) && S.texts.some((t) => /^.*So: .*Shall I\?/.test(t)) && S.texts.some((t) => /Which lantern\?/.test(t)) && S.texts.some((t) => /hold the gate/.test(t)),
    leakTest: Array.isArray(S.banned) && S.banned.length === 0 && Array.isArray(S.finalBanned) && S.finalBanned.length === 0,
    noMachinery: S.machinery?.workEls === 0 && S.machinery.buttons.length === 0 && !S.machinery.digits,
    verdictIsTheTakes: S.broughtTake && S.takeAfter?.verdict === "keep" && S.takeAfter.by === "person" && S.takeAfter.because === "the gate holds through the turn" && /Kept/.test(S.reply ?? "") && /Earlier/.test(S.earlier ?? ""),
    actuallyNo: S.takeBack?.verdict === null && S.takeBack.past?.join() === "changed_mind",
    proposalNo: S.broughtProp && S.propAfter?.status === "rejected" && S.propAfter.because === "not dusk, keep it noon",
    candidatePicked: S.broughtDecision && S.decisionAfter?.status === "applied" && S.decisionAfter.applied === "person",
    blindJudged: S.broughtBlind && S.blindAfter === 0 && /^Noted: A was take \d+\.$/.test(S.replyBlind ?? ""),
    phone: S.phone?.shown && !S.phone.errors.length && S.phone.sideways === false,
    tablet: S.tablet?.shown && !S.tablet.errors.length && S.tablet.sideways === false,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g7_room_result.json"), JSON.stringify(R, null, 1));
  console.log(`g7room ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
