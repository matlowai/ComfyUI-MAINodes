// Batch G8, the Room's wording (SNAP-R179, beside SNAP-R70): every question, at the top and on each "Then" line, is one
// plain sentence that names its thing, whoever wrote the row:
// - an agent's own question keeps only the question ("Which lantern? a MOSS edit of take-… for cast:…" asks "Which
//   lantern?"; "Does the H3 take hold the gate? (take-…, x.png)" asks "Does the take hold the gate?");
// - an agent's words with no question become one ("the lantern, second try (status: Pika render, id 7)" asks "Do you
//   keep the lantern, second try?"); a run titled by Snap ("Run <workflow>") asks about its take by number;
// - a proposal asks "Shall I …?" without its "p3:" label or the asides plain() empties ("(the clip)"); a Book story
//   change says the state in words ("From b1 on, Aya holds the ladle in the right hand: shall I add that to the
//   story?"), a new beat quotes it; a New view pick Snap titled asks "Which new view do you keep for <scene>, <shot>?"
// - none of it carries a "(…)" left empty, "it" in place of a name, or a banned word (the leak test); the line under a
//   question names a place (a scene and shot, a Book), never the Work card's "a scratch tab".
// Screens: ui/g8/room_desk.png, room_story_change.png, room_phone.png. usage: node test_g8_room.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g8");
const base = process.argv[3] || CFG.base;
const D = CFG.fixture("short04");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  ["takes", "candidates", "scenes", "proposals.json", "work.json", "critiques", "book", "story", "cast"].forEach(park); // moved, never deleted
  const blindFile = path.join(base, "user", "snap_blind.json");
  if (fs.existsSync(blindFile)) fs.renameSync(blindFile, path.join(base, "user", `snap_blind.parked-${Date.now()}.json`));
  const fx = path.join(base, "input", "snaptest_book");
  fs.mkdirSync(fx, { recursive: true });
  fs.copyFileSync(path.join(D, "bible/hiyori_front_v1.png"), path.join(fx, "hiyori_front_v1.png"));
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
    for (const q of ["Does the H3 take hold the gate? (take-ab12cd34ef, snaptest/batchF_00001_.png)", "the lantern, second try (status: Pika render, id 7)", null]) { const r = await call("run", q ? { question: q } : {}); await wait(r.run); ids.push(`take-${r.run}`); }
    await page.waitForTimeout(1500);
    // two picks: one the agent asked, one Snap titled (a New view landing in Gate › C1)
    await page.evaluate(async ([ids, sid, shot]) => {
      window.__C.kind("g8room", { apply: async () => ({}), undo: async () => {} });
      const pic = (id) => ({ media: window.__T.get(id).media[0], label: "front" });
      await window.__C.create({ kind: "g8room", target: ids[0], title: "Which lantern? a MOSS edit of take-ab12cd34ef for cast:mw3ukbglzle6 (priority)", by: "agent" }, [{ pictures: [pic(ids[0])] }, { pictures: [pic(ids[1])] }]);
      await window.__C.create({ kind: "view", target: ids[0], title: "New view · P-H3 ×2 (character) from Picture 1 front, Picture 2 plate", by: "agent", land: { scene: sid, shot } }, [{ pictures: [pic(ids[1])] }, { pictures: [pic(ids[2])] }]);
    }, [ids, sid, shot]);
    await call("set_setting", { brick: "render", name: "prompt", value: "a lantern by a gate at dusk", propose: true, reason: "p3: dusk light on the gate, as the Fizgig still shows (task 2, out_0004.mp4)" });
    await call("setup_ab", { take_a: ids[0], take_b: ids[1] });
    // a Book's story proposals: a change and a beat
    const aya = (await call("save_cast", { name: "Aya", details: "young woman, green apron", refs: [{ file: "snaptest_book/hiyori_front_v1.png", role: "identity: front" }] })).cast;
    const book = (await call("create_book", { name: "Bowl", medium: "anime", cast: [aya] })).book;
    await page.evaluate(async ([book]) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); await B.saveStory(B.storyOf(B.bookOf(book).body).id, { title: "Bowl", props: [{ id: "ladle", name: "the ladle" }], beats: [{ id: "b1", order: 1, told: 1, text: "Aya stirs the pot.", changes: [] }] }, { note: "written by the person" }); }, [book]);
    R.pChange = await call("add_change", { book, beat: "b1", entity: aya, path: "carried.right_hand", op: "set", value: "prop:ladle", why: "she stirs the pot" });
    R.pBeat = await call("add_beat", { book, text: "Aya sets the bowl down in front of Ode.", after: "b1" });
    R.open = await call("open_view", { view: "room" });
    await page.waitForTimeout(2500);
    R.firstQ = await page.locator(".snap-room-q h2").textContent();
    R.lines = await page.locator("button.snap-room-line").allTextContents();
    await page.screenshot({ path: path.join(out, "room_desk.png") });
    const texts = [await page.locator(".snap-room").textContent()], heads = [R.firstQ];
    for (const line of R.lines) { await page.locator("button.snap-room-line", { hasText: line }).first().click(); await page.waitForTimeout(500); heads.push(await page.locator(".snap-room-q h2").textContent()); texts.push(await page.locator(".snap-room").textContent()); }
    R.heads = heads; R.texts = texts;
    await page.locator("button.snap-room-line", { hasText: "From b1 on" }).first().click(); await page.waitForTimeout(500);
    R.changeShown = await page.locator(".snap-room-q").textContent();
    await page.screenshot({ path: path.join(out, "room_story_change.png") });
    R.banned = await page.evaluate(async (texts) => { const RM = await import("/extensions/ComfyUI-MAINodes/snap/room.js"); return texts.flatMap((t) => RM.BANNED.filter((re) => re.test(t)).map((re) => `${re} in "${t.match(re)?.[0]}"`)); }, texts);
    R.plain = await page.evaluate(async () => { const RM = await import("/extensions/ComfyUI-MAINodes/snap/room.js"); return RM.plain("an edit of take-zz99yy88xx for cast:nobody-here, then cast:nobody-here alone"); });
    R.errors = A.errors;
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }), p = await ctx.newPage();
    await p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    await p.goto(`http://127.0.0.1:${port}/?room`);
    R.phone = await p.waitForSelector(".snap-room", { timeout: 90000 }).then(() => true, () => false);
    await p.waitForTimeout(2500);
    R.phoneSideways = await p.evaluate(() => { const r = document.querySelector(".snap-room"); return r ? r.scrollWidth > r.clientWidth + 1 : null; });
    await p.screenshot({ path: path.join(out, "room_phone.png") });
    await ctx.close();
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
  }
  const S = R, all = [...new Set([...(S.heads ?? []), ...(S.lines ?? [])])];
  const want = ["Which lantern?", "Does the take hold the gate?", "Do you keep the lantern, second try?", /^Do you keep take \d+\?$/, "Which new view do you keep for Gate, Shot 1 · C1?", "Shall I go ahead with dusk light on the gate, as the still shows?", "Which is better, A or B?",
    "From b1 on, Aya holds the ladle in the right hand: shall I add that to the story?", "Shall I add a beat: Aya sets the bowl down in front of Ode?"];
  const found = (w) => all.some((x) => (typeof w === "string" ? x === w : w.test(x)));
  const checks = {
    proposalsMade: !!S.pChange?.proposed && !!S.pBeat?.proposed,
    everyQuestionWorded: want.every(found),
    oneSentenceEach: all.length >= want.length && all.every((x) => /^[A-Z][^?]*\?$/.test(x) && !/[()]/.test(x) && !/\bit\b/.test(x) && !/\b(?:an earlier suggestion|So:)/.test(x)),
    thenMatchesTop: (S.lines ?? []).every((l) => (S.heads ?? []).includes(l)),
    leakTest: Array.isArray(S.banned) && S.banned.length === 0,
    changeSaysWhy: /^From b1 on, Aya holds the ladle in the right hand: shall I add that to the story\?she stirs the pot/.test(S.changeShown ?? ""),
    placesOnly: (S.texts ?? []).length > 1 && S.texts.every((t) => !/scratch tab/.test(t)) && S.texts.some((t) => /Gate › Shot 1 · C1/.test(t)),
    plainDropsUnnamed: S.plain === "an edit, then it alone",
    phone: S.phone === true && S.phoneSideways === false,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.missing = want.filter((w) => !found(w)).map(String);
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g8_room_result.json"), JSON.stringify(R, null, 1));
  console.log(`g8room ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
