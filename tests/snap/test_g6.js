// Batch G6 on the CPU test server (short03's F-K findings, short05's F-L01, the Work card's critique flood):
// - SNAP-R155 scale anchors: save_location {scale} is kept by a later save that leaves it out, listed by list_locations,
//   refused when malformed, shown on the Location sheet, and sent in a packet with a scale_rule ("measured against" /
//   "no scale on record");
// - F-K05: remove_plate takes a plate out and the others keep their `from`; a plate given by file alone keeps it too;
// - F-K09 (SNAP-R156): a critic's owner words map to the part they name (a plate by its label, several plates, the camera
//   marks, the notes) and words that name no part are listed as unmapped, never read as the master; Fix at source on
//   the Location sheet opens a words sheet for marks;
// - F-K10 (SNAP-R157): the author amends its written row as a new row that supersedes it; another agent can't;
// - SNAP-R159: a retried bridge call with the same Idempotency-Key answers the first call's answer (replayed) and makes
//   no second version; the same key with other args is refused; a read-only call's answer is not kept;
// - F-K01 get_cast; F-K02 save_cast keeps left-out fields (kept); F-K03 diff_record lists a stamped sha apart;
// - F-K04 add_shot drops a "Shot n ·" prefix; F-K06 a video pinning only a place reads as a walk; F-K11 a location's
//   every-view packet says why it has no tiles and carries measuring copies;
// - F-L01: a proposal's Work card row has real Accept / Reject buttons; F-M01 (SNAP-R158): critiques due fold into one
//   row ("n critiques due") and the pill counts them apart; proposals come first.
// usage: node test_g6.js [port] [base]   prints "g6 n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-g6-${Date.now()}`)); } };
const http = async (route, body, headers = {}) => { const r = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, ...(await r.json()) }; };
const bridge = (tool, args, agent, key) => http("/mainodes/snap/call", { tool, args }, { ...(agent ? { "X-Snap-Agent": agent } : {}), ...(key ? { "Idempotency-Key": key } : {}) });
(async () => {
  ["takes", "candidates", "cast", "location", "dependents", "critiques", "scenes", "proposals.json"].forEach(park); // moved, never deleted
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  const fx = path.join(base, "input", "snaptest_g6");
  fs.mkdirSync(fx, { recursive: true });
  const D = CFG.fixture("short04");
  for (const [f, to] of [["settei_bg/MASTER_shrine_v1.png", "master.png"], ["settei_bg/P1_torii_eyelevel.png", "pa.png"], ["settei_bg/P1_torii_eyelevel.png", "pb.png"], ["bible/hiyori_front_v1.png", "pab.png"], ["bible/hiyori_back_v1.png", "plan.png"]]) fs.copyFileSync(path.join(D, f), path.join(fx, to));
  const shots = path.join(CFG.out, "ui", "g6"); fs.mkdirSync(shots, { recursive: true });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port, { slow: 40 }), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const take = (id, file, extra) => page.evaluate(async ([id, file, extra]) => { await window.__T.save({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 5, group: extra.group ?? "g6", number: +id.replace(/\D/g, "") || 1, status: "success", text: id, seed: 1, media: [{ kind: extra.video ? "video" : "image", filename: file, subfolder: "snaptest_g6", type: "input" }], prompt: {}, graph: {}, verdict: null, notes: [], ...extra }); }, [id, file, extra]);
    const id = await page.evaluate(async () => (await import("/scripts/api.js")).api.clientId);

    // ---- SNAP-R155 scale anchors, F-K05 provenance ----
    await take("take-g6w1", "pa.png", {});
    const v1 = await call("save_location", { name: "G6 village", notes: "a palisade rings the village", master: { file: "snaptest_g6/master.png" }, plan: { file: "snaptest_g6/plan.png" },
      plates: [{ name: "Pa", take: "take-g6w1" }, { name: "Pab", file: "snaptest_g6/pab.png" }, { name: "Pb gate from inside", file: "snaptest_g6/pb.png", pose: { eye_height: 2.5 } }], scale: [{ name: "house door", height_m: 2.0 }, { name: "gate door", height_m: 3.7, note: "the double gate" }] });
    const loc = v1.location;
    R.v1 = v1;
    R.list = (await call("list_locations", {})).find?.((x) => x.location === loc);
    R.keepScale = await call("save_location", { location: loc, notes: "a palisade rings the village; one gate in the west wall" });
    R.badScale = await call("save_location", { location: loc, scale: [{ name: "house door", height_m: "2 m" }] });
    R.byFile = await call("save_location", { location: loc, plates: [{ name: "Pa", file: R.list?.plates?.find((p) => p.name === "Pa")?.file }, { name: "Pab", file: "snaptest_g6/pab.png" }, { name: "Pb gate from inside", file: "snaptest_g6/pb.png", pose: { eye_height: 2.5 } }] });
    R.afterFile = (await call("get_record", { ref: R.byFile.ref })).body;
    R.remove = await call("remove_plate", { location: loc, name: "Pab" });
    R.afterRemove = (await call("get_record", { ref: R.remove.ref })).body;
    R.removeBad = await call("remove_plate", { location: loc, name: "Nope" });
    const noScale = await call("save_location", { name: "G6 bare place", master: { file: "snaptest_g6/master.png" } });

    // packets: the scale words, measuring copies and the tiles line on every view (F-K11)
    const views = await call("critique", { location: R.remove.ref, part: "views", again: true });
    R.views = views;
    const vp = await call("critique_packet", { critique: views.critique, part: "whole" });
    const vpAll = await call("critique_packet", { critique: views.critique, part: "tiles" });
    R.viewWords = vp.words; R.viewTiles = (vpAll.pictures ?? []).filter((p) => p.role === "tile").map((p) => ({ cell: p.tile?.cell, label: p.label }));
    const bare = await call("critique", { location: noScale.location, part: "master", again: true });
    R.bareWords = (await call("critique_packet", { critique: bare.critique, part: "whole" })).words;

    // ---- F-K09 owners; F-K10 amend ----
    const head = R.remove.ref, row = views.critique;
    R.claim = await bridge("claim_critique", { critique: row }, "g6-critic");
    R.write = await bridge("write_critique", { critique: row, verdict: "flaws", passes: { cross_view: "eye heights read" }, notes: [
      { severity: "medium", pass: "cross_view", text: "Pb sits at ~2.7 m, measured against the record's scale (house door 2.0 m)", owner: "plate Pb", picture: 0, region: [0.1, 0.1, 0.2, 0.2] },
      { severity: "low", pass: "cross_view", text: "Pa and Pb read the gate the same", owner: "plate Pa / plate Pb", picture: 0 },
      { severity: "medium", pass: "map", text: "typed eye heights disagree with the pictures", owner: "location record (plate poses and camera marks)" },
      { severity: "low", pass: "map", text: "something about the place", owner: "the location" }] }, "g6-critic");
    R.rowAfter = (await call("list_critiques", { ref: head })).rows?.find((r) => r.critique === row);
    R.amendOther = await bridge("write_critique", { critique: row, amend: true, verdict: "flaws", notes: [] }, "g6-other");
    R.amend = await bridge("write_critique", { critique: row, amend: true, verdict: "flaws", passes: { cross_view: "corrected" }, notes: [{ severity: "medium", pass: "cross_view", text: "Pb sits at ~2.6 m (corrected)", owner: "plate Pb", picture: 0, region: [0.1, 0.1, 0.2, 0.2] }] }, "g6-critic");
    R.amendAgain = await bridge("write_critique", { critique: row, amend: true, verdict: "clean", notes: [] }, "g6-critic");
    R.oldRow = (await call("list_critiques", { ref: head })).rows?.find((r) => r.critique === row);
    R.holding = await page.evaluate(async ([ref]) => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); await CR.load(); return CR.holding(ref).map((r) => r.id); }, [head]);
    // the marks note (before the amendment) on the Location sheet: Fix at source opens the words sheet
    await call("open_view", { view: "location", location: head, masks: true });
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(shots, "g6_location_scale.png") });
    R.sheetScale = await page.evaluate(() => [...document.querySelectorAll(".snap-loc-scale-row input")].map((i) => i.value));
    R.fixButtons = await page.evaluate(() => [...document.querySelectorAll(".snap-critic-loc .snap-critic-list button")].filter((x) => x.textContent === "Fix at source").length);
    // the superseded row's marks note: Fix at source opens the words sheet (no picture to redraw), naming the fix tool
    R.marksSheet = await page.evaluate(async ([row]) => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"), CV = await import("/extensions/ComfyUI-MAINodes/snap/critiqueview.js"); const n = CR.get(row).notes.find((x) => x.owner?.part === "marks"); const sh = CV.fixSheet(document.querySelector(".snap-loc-sheet")?.parentElement ?? document.body, null, n, {}); const out = { text: sh.textContent, img: !!sh.querySelector("img") }; return out; }, [row]);
    await page.waitForTimeout(800); // the sheet fades in
    await page.screenshot({ path: path.join(shots, "g6_fix_at_source_marks.png") });
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.evaluate(() => { for (const s of document.querySelectorAll(".snap-loc-sheet, .snap-critic-sheet")) s.remove(); });

    // ---- SNAP-R159 Idempotency-Key ----
    R.bind = await bridge("use_page", { page: id }, "g6-idem");
    const before = (await call("get_record", { ref: loc })).head, K = `g6-${Date.now().toString(36)}`; // keys live an hour on the server: one per run
    R.idem1 = await bridge("save_location", { location: loc, notes: "idempotent note" }, "g6-idem", `${K}-1`);
    R.idem2 = await bridge("save_location", { location: loc, notes: "idempotent note" }, "g6-idem", `${K}-1`);
    R.idemHead = (await call("get_record", { ref: loc })).head; R.idemBefore = before;
    R.idemOther = await bridge("save_location", { location: loc, notes: "another note" }, "g6-idem", `${K}-1`);
    R.idemRead1 = await bridge("list_locations", {}, "g6-idem", `${K}-2`);
    R.idemRead2 = await bridge("list_locations", {}, "g6-idem", `${K}-2`);
    R.idemBad = await bridge("list_locations", {}, "g6-idem", "x".repeat(201));
    await bridge("use_page", { page: null }, "g6-idem");

    // ---- F-K01..F-K04, F-K06 ----
    const c1 = await call("save_cast", { name: "G6 Maren", details: "pale, white-silver braid", refs: [{ file: "snaptest_g6/pab.png", role: "identity: front" }] });
    R.getCast = await call("get_cast", { cast: c1.cast });
    R.castKeep = await call("save_cast", { cast: c1.cast, details: "pale, white-silver braid over her right shoulder" });
    R.castBody = (await call("get_cast", { cast: c1.cast })).body;
    R.noName = await call("save_cast", { details: "no name" });
    // an older version without the file hash (as saved before F-C30), then a save that stamps it
    await page.evaluate(async ([cid]) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); const id = W.parse(cid).id, b = W.headOf(W.record("cast", id)).body; await W.save("cast", id, { ...b, refs: b.refs.map(({ sha, ...r }) => r) }, { note: "an old record without hashes", by: "agent" }); }, [c1.cast]);
    const unsha = (await call("get_cast", { cast: c1.cast })).head;
    const stamped = await call("save_cast", { cast: c1.cast, lore: "keeps the gate" });
    R.diff = await call("diff_record", { a: `${c1.cast}@${unsha}`, b: stamped.ref });
    const sc = await call("create_scene", { name: "G6 shots" }), sid = sc.scene?.id ?? sc.id ?? sc.scene;
    R.shot = await call("add_shot", { scene: sid, name: "Shot 5 · Parch re-walk" });
    R.sceneTitles = await page.evaluate(async ([sid]) => { const SC = await import("/extensions/ComfyUI-MAINodes/snap/scenes.js"); await SC.load(); const s = SC.get(sid); return s.shots.map((x) => SC.shotTitle(s, x)); }, [sid]);
    await take("take-g6walk", "pa.png", { video: true, world: { [loc]: { n: 1, name: "G6 village" } } });
    await take("take-g6cut", "pa.png", { video: true, world: { [loc]: { n: 1, name: "G6 village" }, [c1.cast]: { n: 1, name: "G6 Maren" } } });
    R.checklists = await page.evaluate(async () => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); return [await CR.checklistOf(window.__T.get("take-g6walk")), await CR.checklistOf(window.__T.get("take-g6cut"))].map((x) => x.checklist); });

    // ---- F-L01 + F-M01: the Work card ----
    for (const k of [1, 2, 3]) await http("/mainodes/snap/critique/due", { key: `g6:due:${k}`, subject: { kind: "take", take: "take-g6w1" }, title: `Critic: g6 due ${k}`, checklist: "still", by: "fixtures" });
    await page.evaluate(async () => { const P = await import("/extensions/ComfyUI-MAINodes/snap/proposals.js"); await P.add("save_location", { notes: "x" }, "move the well to the square's centre"); });
    await page.waitForTimeout(2500);
    await page.evaluate(async () => { const A = await import("/extensions/ComfyUI-MAINodes/snap/activity.js"); await A.reconcile(); });
    await page.waitForTimeout(1500);
    R.pill = await page.evaluate(() => document.querySelector(".snap-work-btn")?.textContent ?? null);
    await page.click(".snap-work-btn");
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(shots, "g6_work_card.png") });
    R.work = await page.evaluate(() => { const sheet = document.querySelector(".snap-work-sheet"); const rows = [...sheet.querySelectorAll(".snap-work-row")]; return {
      text: sheet.textContent.includes("[object"), due: rows.filter((r) => r.classList.contains("snap-work-due")).map((r) => r.querySelector(".snap-work-title")?.textContent),
      proposal: rows.filter((r) => /move the well/.test(r.textContent)).map((r) => [...r.querySelectorAll("button")].map((x) => x.textContent)), dueRows: rows.filter((r) => /g6 due/.test(r.textContent)).length,
      firstAgents: [...sheet.querySelectorAll(".snap-work-group")].map((g) => g.querySelector(".snap-work-row .snap-work-title")?.textContent) }; });
    await page.click(".snap-work-due button");
    await page.waitForTimeout(800);
    R.workShown = await page.evaluate(() => [...document.querySelectorAll(".snap-work-sheet .snap-work-row")].filter((r) => /^Critic: /.test(r.querySelector(".snap-work-title")?.textContent ?? "")).length);
    await page.screenshot({ path: path.join(shots, "g6_work_card_shown.png") });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, own = (i) => S.rowAfter?.notes?.[i]?.owner ?? {};
  const checks = {
    "R155 save_location keeps a scale and lists it": JSON.stringify(S.list?.scale) === JSON.stringify([{ name: "house door", height_m: 2 }, { name: "gate door", height_m: 3.7, note: "the double gate" }]),
    "R155 a later save that leaves scale out keeps it, and says so": (S.keepScale?.kept ?? []).some((k) => /^scale \(house door 2 m, gate door 3.7 m\)$/.test(k)),
    "R155 a malformed anchor is refused with what it takes": /height_m is its real height in metres/.test(S.badScale?.error ?? ""),
    "R155 the packet sends the scale and says to measure against it": S.viewWords?.record?.scale?.length === 2 && /measured against the record's scale/.test(S.viewWords?.scale_rule ?? ""),
    "R155 no scale: the packet says so": (S.bareWords?.record?.scale ?? null)?.length === 0 && /no scale on record/.test(S.bareWords?.scale_rule ?? ""),
    "R155 the Location sheet shows the anchors": JSON.stringify(S.sheetScale) === JSON.stringify(["house door", "2", "gate door", "3.7"]),
    "F-K05 a plate given by file alone keeps its from": S.afterFile?.plates?.find((p) => p.name === "Pa")?.from?.take === "take-g6w1",
    "F-K05 remove_plate takes one out; the others keep their from": S.remove?.removed?.[0] === "Pab" && !(S.afterRemove?.plates ?? []).some((p) => p.name === "Pab") && S.afterRemove?.plates?.find((p) => p.name === "Pa")?.from?.take === "take-g6w1" && S.afterRemove?.scale?.length === 2,
    "F-K05 remove_plate names the plates there when one is missing": /has no plate "Nope"; its plates are Pa, Pb gate from inside/.test(S.removeBad?.error ?? ""),
    "F-K11 every view: measuring copies; no 'no tiles' line when there are tiles": (S.viewTiles ?? []).filter((p) => p.cell === "measure").length >= 3 && (S.viewTiles ?? []).some((p) => /^r\dc\d$/.test(p.cell)) && S.viewWords?.tiles === undefined,
    "F-K09 'plate Pb' maps to the plate by its label": own(0).part === "plate Pb gate from inside",
    "F-K09 two plates: the first is the part, parts lists both": own(1).part === "plate Pa" && JSON.stringify(own(1).parts) === JSON.stringify(["plate Pa", "plate Pb gate from inside"]),
    "F-K09 poses and camera marks map to the marks": own(2).part === "marks",
    "F-K09 words naming no part are unmapped, not the master": own(3).part === null && /names no part of the place/.test(own(3).unmapped ?? "") && (S.write?.result?.owners_unmapped ?? []).length === 1,
    "F-K09 the Location sheet offers Fix at source per located note": S.fixButtons === 1,
    "F-K09 Fix at source on a marks note opens the record's words, no picture": /camera marks and plate poses/.test(S.marksSheet?.text ?? "") && /Fix the typed numbers/.test(S.marksSheet?.text ?? "") && S.marksSheet?.img === false,
    "F-K10 another agent can't amend the row": /only its author amends it/.test(S.amendOther?.error ?? ""),
    "F-K10 the author's amendment is a new row that supersedes it": S.amend?.result?.supersedes === row0(S) && S.oldRow?.superseded_by === S.amend?.result?.critique && S.holding?.includes(S.amend?.result?.critique) && !S.holding?.includes(row0(S)),
    "F-K10 an amended row is not amended twice": /already amended by/.test(S.amendAgain?.error ?? ""),
    "R159 the same key replays the first answer, no second version": S.idem2?.replayed === true && S.idem2?.result?.ref === S.idem1?.result?.ref && S.idemHead === S.idemBefore + 1 && /^g6-.*-1$/.test(S.idem1?.idempotency_key ?? ""),
    "R159 the same key with other args is refused": S.idemOther?.status === 409 && /a key names one call/.test(S.idemOther?.error ?? ""),
    "R159 a read-only call is not kept": !S.idemRead2?.replayed && Array.isArray(S.idemRead2?.result),
    "R159 a malformed key is refused": S.idemBad?.status === 400,
    "F-K01 get_cast reads one Cast": S.getCast?.body?.name === "G6 Maren" && /^cast:/.test(S.getCast?.ref ?? ""),
    "F-K02 save_cast keeps what it leaves out": S.castBody?.name === "G6 Maren" && S.castBody?.refs?.length === 1 && (S.castKeep?.kept ?? []).includes("refs (1)") && /new Cast record needs a name/.test(S.noName?.error ?? ""),
    "F-K03 diff_record: a stamped sha is not a refs change": !(S.diff?.changes ?? []).some((c) => /^refs/.test(c)) && (S.diff?.sha_recorded ?? []).includes("refs[0]") && (S.diff?.changes ?? []).some((c) => /^lore/.test(c)),
    "F-K04 add_shot drops a doubled Shot n prefix": (S.sceneTitles ?? []).includes("Shot 1 · Parch re-walk"),
    "F-K06 a video pinning only a place reads as a walk; with a Cast as a cut": JSON.stringify(S.checklists) === JSON.stringify(["walk", "cut"]),
    "F-L01 the proposal row has real Accept / Reject buttons": S.work?.text === false && (S.work?.proposal?.[0] ?? []).includes("Accept") && (S.work?.proposal?.[0] ?? []).includes("Reject"),
    "F-M01 critiques due fold into one row; the pill counts them apart": (S.work?.due ?? []).some((t) => /^\d+ critiques due$/.test(t)) && S.work?.dueRows === 0 && /critiques? due/.test(S.pill ?? "") && S.workShown >= 10,
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  function row0(S) { return S.views?.critique; }
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g6_result.json"), JSON.stringify(R, null, 1));
  console.log(`g6 ${R.pass}/${R.total}`, Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k).join(" | "));
})();
