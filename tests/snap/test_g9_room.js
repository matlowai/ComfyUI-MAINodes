// Batch G9, the Room with rows shaped like the live ones (F-Q19, F-Q20) and the critic's owners (F-Q24):
// - SNAP-R180: a critic's row asks its worst note's first sentence ("Mio still holds the ladle …: keep it anyway?"), a clean
//   one "The critic found nothing wrong here: keep it?"; every note is listed under the picture with its words, how much it
//   matters and where it was born in plain words ("It comes from C1's approved board."), and a note drawn on the picture
//   gets a numbered box on it; pixel asides ("(x~660-735, y~385-400)") and machinery stay out (the leak test);
// - F-Q19: rows titled like :8193's (a critic row "Critic: <scene> › <shot> › take n (seed …) · New view · H3 still ×1 (<a
//   long prompt with asides of its own>) from Picture 1 …", a New view pick with the same, a run named by an agent with a
//   nested aside) each ask one short sentence with no "(", and on a phone the picture comes before the notes;
// - F-Q24: a critic's owner "board" names the board the take opens on (the cut's approved board, as a take), "camera marks"
//   names the plate the note is about and its camera mark; Fix at source opens that board and says that mark.
// Screens: ui/g9/room_critic_desk.png, room_critic_phone.png, room_then.png, fix_board.png. usage: node test_g9_room.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {}, out = path.join(CFG.out, "ui", "g9");
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-g9-${Date.now()}`)); } };
const http = async (route, body, headers = {}) => { const r = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, ...(await r.json()) }; };
const bridge = (tool, args, agent) => http("/mainodes/snap/call", { tool, args }, agent ? { "X-Snap-Agent": agent } : {});
// a board prompt as long as the live ones (~1,900 characters), with asides inside its aside
const STYLE = "2D cel-shaded Japanese TV anime, crisp clean black lineart, flat colours with two-tone hard shading. Soft painted night backgrounds in deep blues, warm orange lantern light on faces and wood, light film grain.";
const SUBJECT = "Mio sets the full bowl down on the counter in front of Kuroe with both hands and grins. Kuroe on the middle stool at frame left, his back three-quarter to camera; Mio behind the counter frame centre-right (facing camera, looking frame left at him), setting the bowl down in front of him with both hands, grinning. Camera: medium, eye level 1.4 m, behind the stools looking north over Kuroe's right shoulder, 35 mm. Mio Hayase's right hand is empty. Mio Hayase is behind the counter, centre. Baron Kuroe is on the middle stool in front of the counter. Baron Kuroe wears the monocle. Baron Kuroe looks stern, arms crossed. The bowl is on the counter in front of Kuroe. Mio Hayase is a 17-year-old girl ramen cook with a high orange ponytail, a white twisted towel headband, amber eyes, a black t-shirt with rolled sleeves and a dark green apron. Baron Kuroe is a tall thin elderly gourmet critic with silver slicked-back hair, a thin white moustache, sharp grey eyes, a round gold monocle on his right eye on a thin gold chain clipped to his right lapel, a black three-piece suit (a settei (model sheet) look), white shirt and burgundy tie. <Picture 1> is this cut's camera on the place: keep its framing. <Picture 2> is C2's approved board: keep its blocking: who stands or sits where, facing which way. Mio Hayase is <Picture 3>. Baron Kuroe is <Picture 4> and <Picture 5>. This frame is the beat at its peak.";
const PROMPT = `${STYLE}\n\n${SUBJECT} ${SUBJECT.slice(0, 380)}`;
const VIEW_TITLE = `New view · H3 still (Fizgig) ×1 (${PROMPT}) from Picture 1 C2's camera, Picture 2 C2's approved board, Picture 3 cast: Mio Hayase, identity: front, Picture 4 cast: Baron Kuroe, identity: front, Picture 5 cast: Baron Kuroe, back view`;
(async () => {
  fs.mkdirSync(out, { recursive: true });
  ["takes", "candidates", "scenes", "proposals.json", "work.json", "critiques", "book", "story", "look", "cast", "location"].forEach(park); // moved, never deleted
  const blindFile = path.join(base, "user", "snap_blind.json");
  if (fs.existsSync(blindFile)) fs.renameSync(blindFile, path.join(base, "user", `snap_blind.parked-${Date.now()}.json`));
  const fx = path.join(base, "input", "snaptest_g9"), D = CFG.fixture("short04");
  fs.mkdirSync(fx, { recursive: true });
  fs.copyFileSync(CFG.fixture("short05/board_c2_s9221.png"), path.join(fx, "board_c2.png")); // the live C2 board the critic read (Kuroe in spectacles)
  for (const [f, to] of [["bible/hiyori_front_v1.png", "mio.png"], ["bible/hiyori_back_v1.png", "kuroe.png"], ["settei_bg/MASTER_shrine_v1.png", "master.png"], ["settei_bg/P1_torii_eyelevel.png", "pa.png"]]) fs.copyFileSync(path.join(D, f), path.join(fx, to));
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port, { slow: 40 }), page = A.page;
    await page.setViewportSize({ width: 1440, height: 900 });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const wait = async (run) => { for (let i = 0; i < 40; i++) { const s = await call("run_status", { run, wait_s: 5 }); const r = s.runs?.[0]; if (r && ["done", "failed"].includes(r.state)) return r; } return null; };
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const mio = (await call("save_cast", { name: "Mio Hayase", details: "a 17-year-old girl ramen cook, a dark green apron", refs: [{ file: "snaptest_g9/mio.png", role: "identity: front" }] })).cast;
    const kuroe = (await call("save_cast", { name: "Baron Kuroe", details: "a tall thin elderly gourmet critic, a round gold monocle on his right eye", refs: [{ file: "snaptest_g9/kuroe.png", role: "identity: front" }] })).cast;
    const book = (await call("create_book", { name: "short05 · One More Bowl", medium: "anime", cast: [mio, kuroe] })).book;
    const cut = await call("add_cut", { book, scene_name: "short05 · One More Bowl cuts", name: "C2 the bowl lands (medium)", cast: [mio, kuroe], seconds: 4 });
    R.cut = cut;
    await call("open_shot", { scene: cut.scene, shot: cut.shot }); await page.waitForTimeout(2500);
    const ids = [];
    for (const q of [null, null, `C2 retry, both hands on the bowl (${PROMPT.slice(0, 600)} (seed 9221))`]) { const r = await call("run", q ? { question: q } : {}); await wait(r.run); ids.push(`take-${r.run}`); }
    await page.waitForTimeout(1500);
    // take 2 is the live board picture, saved into the shot's group as a New view's candidate
    const viewTake = "take-g9view";
    await page.evaluate(async ([id, group]) => { await window.__T.save({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 1, group, number: 5, status: "success", text: "the C2 board", seed: 9221, media: [{ kind: "image", filename: "board_c2.png", subfolder: "snaptest_g9", type: "input" }], prompt: {}, graph: {}, verdict: null, notes: [] }); }, [viewTake, await page.evaluate((id) => window.__T.get(id).group, ids[1])]);
    ids[1] = viewTake;
    const [boardTake] = ids;
    // the cut's approved board is take 1's frame (as set_board writes it); take 2 is a New view candidate titled like :8193's
    R.board = await page.evaluate(async ([scene, shot, id]) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"), T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js"); const f = await T.frameAt(T.get(id), "last", { frame: 0 }); return (await B.setUnit(scene, shot, { board: { file: f.file, from: { take: id, frame: f.frame }, approved: true } }, { by: "person" })).board; }, [cut.scene, cut.shot, boardTake]);
    await page.evaluate(async ([ids, title, scene, shot]) => {
      window.__C.kind("g9room", { apply: async () => ({}), undo: async () => {} });
      const pic = (id) => ({ media: window.__T.get(id).media[0], label: "front" });
      await window.__C.create({ kind: "view", target: ids[0], title, by: "agent", land: { scene, shot } }, [{ take: ids[1], pictures: [pic(ids[1])] }, { pictures: [pic(ids[0])] }]);
    }, [ids, VIEW_TITLE, cut.scene, cut.shot]);
    await page.waitForTimeout(800);
    // the critic: a row on take 2 with three notes (a high from the prompt, a medium born in the board, a low on the take),
    // and a clean row on take 3
    const row = (await call("critique", { take: viewTake })).critique; // the row Snap made when it landed, else a new one
    R.rowTitle = (await call("list_critiques", { take: viewTake })).rows?.find((x) => x.critique === row)?.title;
    R.claim = await bridge("claim_critique", { critique: row }, "g9-critic");
    R.write = await bridge("write_critique", { critique: row, verdict: "flaws", passes: { cast: "read" }, notes: [
      { severity: "medium", pass: "cast", text: "Kuroe's eyewear is spectacles, not the Cast's monocle: a gold arm runs from the lens back over his right ear (x~660-735, y~385-400), with the chain hanging from the lens. The Cast's round gold monocle has no arm. C2's approved board and take 4 have the same spectacles.", owner: "board", region: [0.31, 0.31, 0.06, 0.06], fix: "Targeted edit on the face: remove the arm so a round gold monocle sits in the right eye, its chain running down to the right lapel" },
      { severity: "high", pass: "beat", text: "Mio still holds the ladle in her right hand while setting the bowl down; b2 state says her right hand is empty ('with both hands')", owner: "prompt", region: [0.45, 0.62, 0.12, 0.13], fix: "the compile must drop 'a steel ladle in her right hand' from Mio's Cast line when state empties that hand (Cast line vs state)" },
      { severity: "low", pass: "scan", text: "The middle stool's seat under Kuroe reads two-tone, magenta on the left and olive on the right (980-1060, 695-715).", owner: "take", region: [0.05, 0.93, 0.13, 0.07] }] }, "g9-critic");
    R.owners = R.write.result?.notes?.map((n) => n.owner);
    const clean = (await call("critique", { take: ids[2] })).critique;
    await bridge("claim_critique", { critique: clean }, "g9-critic");
    await bridge("write_critique", { critique: clean, verdict: "clean", passes: { scan: "nothing" }, notes: [] }, "g9-critic");

    // F-Q24 camera marks: a plate row's "camera marks" note names that plate and its mark
    const place = await call("save_location", { name: "G9 village", master: { file: "snaptest_g9/master.png" }, cameras: [{ name: "Pa road / C1", x: 0.1, y: 0.5, heading: 90, eye_height: 2.8 }, { name: "Pb gate inside", x: 0.4, y: 0.5, heading: 270, eye_height: 1.6 }],
      plates: [{ name: "Pa road eye", file: "snaptest_g9/pa.png", camera: "Pa road / C1", pose: { eye_height: 2.8 } }, { name: "Pb gate inside v2", file: "snaptest_g9/master.png", camera: "Pb gate inside", pose: { eye_height: 1.6 } }] });
    const prow = (await call("critique", { location: place.ref ?? place.location, part: "plate Pb gate inside v2", again: true })).critique;
    await bridge("claim_critique", { critique: prow }, "g9-critic");
    R.marks = (await bridge("write_critique", { critique: prow, verdict: "flaws", passes: { map: "read" }, notes: [
      { severity: "medium", pass: "map", text: "Pa's eye is ~1.9 m, typed 2.8 m (gap 0.9 m), measured against the record's scale (gate door 3.8 m).", owner: "camera marks" },
      { severity: "low", pass: "map", text: "This plate's typed eye height 1.6 m disagrees with the picture.", owner: "camera marks" },
      { severity: "low", pass: "map", text: "Retype the eye height.", owner: "plate Pa road eye (pose)" }] }, "g9-critic")).result?.notes?.map((n) => n.owner);

    // the Room, at the critic's row
    await call("open_view", { view: "room" });
    await page.waitForTimeout(2500);
    R.lines = await page.locator("button.snap-room-line").allTextContents();
    R.firstQ = await page.locator(".snap-room-q h2").textContent();
    const pick = async (re) => { const l = R.lines.find((x) => re.test(x)); if (l) { await page.locator("button.snap-room-line", { hasText: l }).first().click(); await page.waitForTimeout(600); } return l ?? null; };
    R.criticLine = /keep it anyway\?$/.test(R.firstQ) ? R.firstQ : await pick(/keep it anyway\?$/);
    R.criticShown = await page.evaluate(() => { const q = document.querySelector(".snap-room-q"); return { h2: q.querySelector("h2").textContent, notes: [...q.querySelectorAll(".snap-room-notes li")].map((li) => li.textContent), boxes: [...q.querySelectorAll(".snap-room-box")].map((x) => x.textContent), order: [...q.children].map((c) => c.className || c.tagName) }; });
    await page.screenshot({ path: path.join(out, "room_critic_desk.png") });
    const heads = [], texts = [];
    for (const line of R.lines) { if (await page.locator(".snap-room-q h2").textContent() !== line) await page.locator("button.snap-room-line", { hasText: line }).first().click(); await page.waitForTimeout(500); heads.push(await page.locator(".snap-room-q h2").textContent()); texts.push(await page.locator(".snap-room").textContent()); }
    R.heads = heads;
    await page.screenshot({ path: path.join(out, "room_then.png"), fullPage: false });
    R.banned = await page.evaluate(async (texts) => { const RM = await import("/extensions/ComfyUI-MAINodes/snap/room.js"); return texts.flatMap((t) => [...RM.BANNED, /\b[xy]~\d/].filter((re) => re.test(t)).map((re) => `${re} in "${t.match(re)?.[0]}"`)); }, texts);
    await page.locator(".snap-room-head button").click(); await page.waitForTimeout(400);

    // Fix at source on the board note opens the board's take; the marks note says the plate and its mark
    R.fix = await page.evaluate(async ([row, prow]) => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"), CV = await import("/extensions/ComfyUI-MAINodes/snap/critiqueview.js"), T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
      const r = CR.get(row), n = r.notes.find((x) => x.owner?.what === "board"), sh = CV.fixSheet(document.querySelector(".snap-root") ?? document.body, T.get(r.subject.take), n, {});
      const got = { head: sh.querySelector("header").textContent, src: sh.querySelector("img")?.getAttribute("src") ?? null, boardSrc: T.url(T.get(n.owner.take).media[0]) }; sh.remove();
      const m = CR.get(prow).notes[0], ms = CV.fixSheet(document.querySelector(".snap-root") ?? document.body, null, m, {}); got.marks = ms.textContent; ms.remove(); return got; }, [row, prow]);

    // the phone: the critic's question, then its picture, then the notes
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }), p = await ctx.newPage();
    await p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    await p.goto(`http://127.0.0.1:${port}/?room`);
    R.phone = await p.waitForSelector(".snap-room", { timeout: 90000 }).then(() => true, () => false);
    await p.waitForTimeout(2500);
    const line = (await p.locator("button.snap-room-line").allTextContents()).find((x) => /keep it anyway\?$/.test(x));
    if (line && !/keep it anyway\?$/.test(await p.locator(".snap-room-q h2").textContent())) { await p.locator("button.snap-room-line", { hasText: line }).first().click(); await p.waitForTimeout(600); }
    await p.locator(".snap-room").evaluate((el) => el.scrollTo(0, 0));
    R.phoneLayout = await p.evaluate(() => { const q = document.querySelector(".snap-room-q"), pic = q.querySelector(".snap-room-pic"), notes = q.querySelector(".snap-room-notes"), r = document.querySelector(".snap-room");
      return { h2: q.querySelector("h2").textContent, picTop: pic?.getBoundingClientRect().top ?? null, notesTop: notes?.getBoundingClientRect().top ?? null, sideways: r.scrollWidth > r.clientWidth + 1 }; });
    await p.screenshot({ path: path.join(out, "room_critic_phone.png") });
    await ctx.close();
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
  }
  const S = R, all = [...new Set([...(S.heads ?? []), ...(S.lines ?? []), S.firstQ].filter(Boolean))], own = (i) => S.owners?.[i] ?? {}, mk = (i) => S.marks?.[i] ?? {};
  const checks = {
    liveTitleShape: /^Critic: short05 · One More Bowl cuts › Shot 1 · C2 the bowl lands \(medium\) › take \d+.* · New view · H3 still \(Fizgig\) ×1 \(2D cel-shaded/.test(S.rowTitle ?? "") && (S.rowTitle ?? "").length > 1900,
    criticAsksItsWorstNote: S.criticLine === "Mio still holds the ladle in her right hand while setting the bowl down: keep it anyway?",
    cleanRowAsks: all.includes("The critic found nothing wrong here: keep it?"),
    pickAsksShort: all.includes("Which new view do you keep for short05 · One More Bowl cuts, Shot 1 · C2 the bowl lands (medium)?"),
    runWithNestedAside: all.includes("Do you keep C2 retry, both hands on the bowl?"),
    shortSentences: all.length >= 4 && all.every((x) => x.length <= 140 && /^[A-Z'][^?]*\?$/.test(x.replace(/\(medium\)/, "")) && !/[()]/.test(x.replace(/\(medium\)/, ""))),
    notesListed: (S.criticShown?.notes ?? []).length === 3 && /^Serious: Mio still holds the ladle/.test(S.criticShown.notes[0]) && /^Worth fixing: Kuroe's eyewear is spectacles/.test(S.criticShown.notes[1]) && /^Small: /.test(S.criticShown.notes[2]),
    ownersInWords: /It comes from the words it was made from\./.test(S.criticShown?.notes?.[0] ?? "") && /It comes from C1's approved board\. What would fix it: Targeted edit on the face/.test(S.criticShown?.notes?.[1] ?? "") && /It comes from this picture itself\./.test(S.criticShown?.notes?.[2] ?? ""),
    noPixelAsides: !(S.criticShown?.notes ?? []).some((x) => /[xy]~\d|\(980-1060/.test(x)),
    boxesOnPicture: JSON.stringify(S.criticShown?.boxes) === JSON.stringify(["1", "2", "3"]),
    pictureBeforeNotes: (() => { const o = S.criticShown?.order ?? []; return o.indexOf("snap-room-pics one") >= 0 && o.indexOf("snap-room-pics one") < o.indexOf("snap-room-notes"); })(),
    leakTest: Array.isArray(S.banned) && S.banned.length === 0,
    boardOwnerNamesTheBoard: own(0).what === "board" && own(0).take === (S.board?.from?.take) && own(0).role === "board" && own(0).label === "C1's approved board",
    marksNamePlate: mk(0).part === "marks" && mk(0).plate === "Pa road eye" && mk(0).mark === "Pa road / C1" && mk(1).plate === "Pb gate inside v2" && mk(1).mark === "Pb gate inside" && mk(2).part === "marks" && mk(2).plate === "Pa road eye",
    fixOpensBoard: /C1's approved board, take \d+/.test(S.fix?.head ?? "") && S.fix?.src === S.fix?.boardSrc,
    fixSaysMark: /plate Pa road eye's pose and mark Pa road \/ C1/.test(S.fix?.marks ?? "") && /name: "Pa road eye"/.test(S.fix?.marks ?? ""),
    phonePictureFirst: S.phone === true && S.phoneLayout?.sideways === false && /keep it anyway\?$/.test(S.phoneLayout?.h2 ?? "") && S.phoneLayout.picTop != null && S.phoneLayout.picTop < 844 && S.phoneLayout.notesTop > S.phoneLayout.picTop,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g9_room_result.json"), JSON.stringify(R, null, 1));
  console.log(`g9room ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
