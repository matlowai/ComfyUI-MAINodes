// G3 (SNAP-R136, the blind village critics' friction F-E01..F-E22) on a CPU test server, judged from screenshots:
// - F-E01: a location saved before the critic started gets one row set for its newest version (trigger existing);
// - F-E14..F-E16: a version made with add_plate {plates: [...]} gets rows for its new plate and every view only; the old
//   version's rows for unchanged parts hold (shown "read on v1, unchanged"); its views row goes stale, leaves the due
//   list and the Work card, and says "v1 → v2: a view changed" (F-E15); a replaced plate's row goes stale too;
// - F-E19: a note owned by "location notes" is the record's words (part notes), not the master;
// - F-E07/F-E17/F-E22: a still's packet is PNG and says so; the plan also comes with its marks drawn; each plate carries
//   its camera mark and eye gap; the record's notes are flagged as claims to check;
// - F-E10..F-E13, F-E18: add_plate's version_note is the version list's note; a camera map is its own picture; a take is
//   found by the start of its id (get_take, add_plate) and by file (find_take); add_plate answers each plate's size and
//   sha256 and the eye gaps of its own plates only; a plate with no mark is compared with the marks' shared height and
//   every gap says it is typed;
// - F-E02/F-E03..F-E06/F-E08/F-E21: open_view location {masks: true} from the Graph view switches to Snap, draws every
//   holding row's notes at once on master, plan and plates ("every view" notes on the picture they name), each a box
//   with a number and no words over the picture, and lists the notes with owner and fix; open_view picture of the
//   master draws its masks in the viewer.
// Screens in ui/g3/. usage: node test_g3_critic.js [port] [base]   prints "g3critic n/m" last
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, out = path.join(CFG.out, "ui", "g3"), R = {};
const SETTEI = CFG.fixture("short03", "settei_bg");
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-g3c-${Date.now()}`)); } };
const upload = async (file, name) => { const fd = new FormData(); fd.append("image", new Blob([fs.readFileSync(file)]), name); fd.append("subfolder", "snap/location/village"); fd.append("overwrite", "true"); return (await fetch(`http://127.0.0.1:${port}/upload/image`, { method: "POST", body: fd })).json(); };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  ["critiques", "takes", "candidates", "scenes", "location", "cast", "dependents"].forEach(park); // a Cast left by another suite would get its own "existing" rows
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  // F-E01: the village is saved before any page reads the docket (the critic's start is set on the first read)
  R.import = JSON.parse(execFileSync("python3", ["-I", path.join(__dirname, "import_village_location.py"), "--port", port]).toString());
  await upload(path.join(SETTEI, "village_cameras_v3.png"), "village_cameras_v3.png");
  await upload(path.join(SETTEI, "plates_v5", fs.readdirSync(path.join(SETTEI, "plates_v5")).find((f) => f.endsWith(".png"))), "g3_pd_v2.png");
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(async ([n, x]) => { const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); I.setCaller("critic-g3"); return window.__X.callTool(n, x).catch((e) => ({ error: e.message })); }, [name, args]);
    await page.evaluate(async () => { window.__CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); window.__W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await window.__W.reload(); await window.__CR.reload(); });
    const rows = () => page.evaluate(() => window.__CR.all().map((r) => ({ id: r.id, ref: r.subject.ref, part: r.subject.part, title: r.title, trigger: r.trigger, state: window.__CR.stateOf(r), stale: window.__CR.staleOf(r) })));
    const waitRows = async (n) => { for (let i = 0; i < 40; i++) { const x = await rows(); if (x.length >= n) return x; await page.waitForTimeout(250); } return rows(); };
    R.existing = await waitRows(9);
    // write the master and one plate row with regions, and a note owned by the location's notes (F-E19)
    const rowOf = (part, n = 1) => R.existing.find((r) => r.part === part && r.ref.endsWith(`@${n}`))?.id;
    const write = async (id, notes) => { await call("claim_critique", { critique: id }); await call("critique_packet", { critique: id }); return call("write_critique", { critique: id, verdict: "flaws", passes: { map: "read" }, notes }); };
    R.wMaster = await write(rowOf("master"), [
      { severity: "high", pass: "map", text: "the palisade runs across the front only: the village is open on the east side behind the far houses", picture: 0, region: [0.6, 0.08, 0.38, 0.4], owner: "location master", fix: "ring the village with the palisade on the master" },
      { severity: "medium", pass: "map", text: "the south row has 3 houses; the notes and the plan say 4", picture: 0, region: [0.05, 0.55, 0.45, 0.35], owner: "location master", fix: "draw the fourth house on the master" },
      { severity: "low", pass: "map", text: "the notes' 'known drift' line describes an older plate", owner: "location notes", fix: "move the drift line into the version note" }]);
    R.ownerNotes = R.wMaster.notes?.find((n) => n.severity === "low")?.owner;
    R.wPlate = await write(rowOf("plate Pb gate inside, open"), [{ severity: "medium", pass: "scan", text: "a house roof shows above the palisade, outside the west wall: a house outside the ring", picture: 0, region: [0.7, 0.05, 0.29, 0.3], owner: "plate Pb gate inside, open", fix: "re-make Pb with a plain wall top" }]);
    // "every view": a note on the picture it names (a plate in the packet)
    const views = rowOf("views");
    await call("claim_critique", { critique: views });
    const pk = await call("critique_packet", { critique: views, part: "whole" });
    const pa = pk.pictures?.find((p) => /plate Pa road outside$/.test(p.what))?.index;
    R.wViews = await call("write_critique", { critique: views, verdict: "flaws", passes: { cross_view: "gate vs master" }, notes: [{ severity: "medium", pass: "cross_view", text: "Pa's gate has one leaf; the master's has two", picture: pa, region: [0.4, 0.3, 0.2, 0.3], owner: "plate Pa road outside", fix: "re-make Pa from the master's gate" }] });
    // F-E07, F-E17, F-E22: the plan's packet
    const planPk = await call("critique_packet", { critique: rowOf("plan") });
    R.planPk = { labels: planPk.pictures?.map((p) => p.label), mimes: planPk.images?.map((i) => i.mimeType), notesAre: planPk.words?.notes_are ?? null, plates: planPk.words?.record?.plates?.map((p) => ({ name: p.name, mark: p.camera_mark?.name ?? null, gap: p.eye_gap ?? null })) };
    // F-E10, F-E11, F-E13, F-E18: a version with a new plate (eye 4 m, no mark) and the camera map, one version
    R.v2 = await call("add_plate", { location: "location:location-village", plates: [{ name: "Pe north row high", file: "snap/location/village/Pd_houses.png", pose: { x: 0.5, y: 0.35, heading: 0, eye_height: 4 } }], version_note: "plate Pe: the north row from the walk's high point" });
    R.v3 = await call("save_location", { location: "location:location-village", ...(await page.evaluate(() => structuredClone(window.__W.headOf(window.__W.record("location", "location-village")).body))), map: { file: "snap/location/village/village_cameras_v3.png" }, note: "the camera map v3" });
    R.v4 = await call("add_plate", { location: "location:location-village", name: "Pd houses", file: "snap/location/village/g3_pd_v2.png", pose: { x: 0.54, y: 0.43, heading: 90, eye_height: 1.6 } });
    R.list = (await call("list_locations", {})).find((l) => l.location === "location:location-village");
    // F-E14..F-E16: the docket after v2..v4
    await page.evaluate(async () => { await window.__W.reload(); await window.__CR.reload(); });
    await page.waitForTimeout(2500);
    R.after = await rows();
    R.due = (await call("list_critiques", { state: "due", compact: true })).rows?.map((r) => r.title);
    R.staleList = (await call("list_critiques", { state: "stale" })).rows?.map((r) => ({ title: r.title, stale: r.stale }));
    R.work = (await call("list_activity", { kind: "critique" })).rows?.map((r) => r.title);
    // F-E12: a take found by the start of its id and by its file
    const n0 = await page.evaluate(() => window.__T.all().length);
    await call("start_recipe", {}); await page.waitForTimeout(1500); await page.evaluate(() => app.queuePrompt(0, 1));
    const take = await page.evaluate(async (n) => { const T = window.__T; for (let i = 0; i < 240 && T.all().length < n + 1; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, 500)); return T.all().at(-1); }, n0);
    R.take = take?.id;
    R.getPrefix = await call("get_take", { take: take.id.slice(5, 13) });
    R.find = await call("find_take", { file: `output/${take.media[0].subfolder}/${take.media[0].filename}` });
    R.plateFromPrefix = await call("add_plate", { location: "location:location-village", name: "Pf from a take", take: take.id.slice(5, 13), version_note: "Pf from a run" });
    // the sheet from the Graph view, masks on (F-E02, F-E21)
    await call("ui", { action: "graph" }); await page.waitForTimeout(800);
    R.openLoc = await call("open_view", { view: "location", location: "location:location-village@1", masks: true }); // v1: every row of it holds, the views row included
    await page.waitForTimeout(1800);
    const readSheet = () => page.evaluate(() => { const s = document.querySelector(".snap-loc-sheet"); if (!s) return null;
      const masks = [...s.querySelectorAll(".snap-mask")].map((m) => { const r = m.getBoundingClientRect(), p = m.closest(".snap-loc-pic").getBoundingClientRect(); return { part: m.closest(".snap-loc-pic").dataset.part, k: m.textContent, inside: r.left >= p.left - 1 && r.top >= p.top - 1 && r.right <= p.right + 1 && r.bottom <= p.bottom + 1 }; });
      return { masks, list: [...s.querySelectorAll(".snap-critic-list li")].map((li) => li.textContent), block: s.querySelector(".snap-critic-loc")?.textContent, gaps: [...s.querySelectorAll(".snap-loc-gap")].map((x) => x.textContent), map: !!s.querySelector('.snap-loc-pic[data-part="map"] img'), versions: [...s.querySelectorAll(".snap-cast-version")].map((x) => x.textContent) }; });
    R.sheet1 = await readSheet();
    R.view = (await call("read_ui", {})).view;
    await page.screenshot({ path: path.join(out, "g3_location_v1_masks.png") });
    await page.evaluate(() => document.querySelector(".snap-loc-sheet .snap-loc-plates")?.scrollIntoView({ block: "start" })); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "g3_location_v1_plates.png") });
    await call("open_view", { view: "location", location: "location:location-village", masks: true }); // the newest: rows of v1 that still hold, the gaps, the map
    await page.waitForTimeout(1800);
    R.sheet = await readSheet();
    await page.screenshot({ path: path.join(out, "g3_location_masks.png") });
    await page.evaluate(() => document.querySelector(".snap-loc-sheet .snap-loc-plates")?.scrollIntoView({ block: "start" })); await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "g3_location_plates.png") });
    await page.evaluate(() => document.querySelector(".snap-loc-sheet .snap-critic-loc")?.scrollIntoView({ block: "start" })); await page.waitForTimeout(300);
    await page.locator(".snap-loc-sheet .snap-critic-loc").screenshot({ path: path.join(out, "g3_location_critic_list.png") }).catch((e) => { R.shotErr = e.message; });
    // the viewer: the master with its masks
    R.lb = await call("open_view", { view: "picture", location: "location:location-village", plate: "master" });
    await page.waitForTimeout(1200);
    R.lbMasks = await page.evaluate(() => [...document.querySelectorAll(".snap-lb .snap-lb-mask")].map((m) => m.textContent));
    await page.screenshot({ path: path.join(out, "g3_viewer_masks.png") });
    await page.keyboard.press("Escape");
    R.errors = A.errors;
  } finally { await b.close(); }
  const due = (part, n) => R.after?.find((r) => r.part === part && r.ref.endsWith(`@${n}`));
  const checks = {
    "F-E01: a location saved before the critic started gets rows for its newest version (master, plan, 6 plates, every view), trigger existing": R.existing?.length === 9 && R.existing.every((r) => r.trigger === "existing" && /saved before the critic started/.test(r.title)),
    "F-E19: a note owned by 'location notes' is the record's notes, not the master": R.ownerNotes?.part === "notes" && /^location:location-village@1$/.test(R.ownerNotes.ref),
    "F-E07: a still's packet pictures are PNG and the labels say so; a still's context too (F-G07)": R.planPk?.mimes?.[0] === "image/png" && /, png$/.test(R.planPk.labels[0]) && R.planPk.labels.some((l) => /^context .*png$/.test(l)) && !R.planPk.labels.some((l) => /^context .*jpeg/.test(l)),
    "F-E17: the plan also comes with its camera marks and plate poses drawn": R.planPk?.labels?.some((l) => /plan with camera marks \(blue\) and plate poses \(amber\) drawn/.test(l)),
    "F-E17: each plate in the words carries its camera mark": R.planPk?.plates?.find((p) => p.name === "Pa road outside")?.mark === "P01/C1",
    "F-E22: the record's notes are flagged as claims to check": /claims to check against the pictures, never evidence/.test(R.planPk?.notesAre ?? ""),
    "F-E10: add_plate's version_note is the version list's note": R.list?.versions?.find((v) => v.n === 2)?.note === "plate Pe: the north row from the walk's high point",
    "F-E11: the camera map is its own picture on the record": R.list?.map?.file === "snap/location/village/village_cameras_v3.png" && R.sheet?.map,
    "F-E13/F-E18: add_plate's eye gaps are its own plates', a plate with no mark is compared with the marks' height, and the line says typed": Object.keys(R.v2?.eye_gaps ?? {}).join() === "Pe north row high" && /no camera mark \(every mark of this place is at 1.6 m\)/.test(R.v2.eye_gaps["Pe north row high"]) && /Snap compares what was typed, not the picture/.test(R.v2.eye_gaps["Pe north row high"]) && !R.v4?.eye_gaps,
    "F-E12: add_plate answers each plate's size and sha256": /^\d+x\d+$/.test(R.v4?.pictures?.["Pd houses"]?.size ?? "") && /^[0-9a-f]{64}$/.test(R.v4.pictures["Pd houses"].sha256 ?? ""),
    "F-E12: get_take and add_plate take the start of an id; find_take finds a take by its file": R.getPrefix?.id === R.take && R.plateFromPrefix?.pictures?.["Pf from a take"]?.from?.take === R.take && R.find?.takes?.some((t) => t.id === R.take && t.matched.includes("media")),
    "F-E14: later versions get rows for their new or changed plates and every view only (no row per unchanged part)": (() => { const parts = new Set(R.after?.filter((r) => !r.ref.endsWith("@1")).map((r) => r.part)); return parts.has("plate Pe north row high") && parts.has("views") && [...parts].every((p) => ["plate Pe north row high", "views", "plate Pd houses"].includes(p)); })(),
    "F-E16: an unchanged part's row of v1 still holds (not stale) after v2..v5": R.after?.find((r) => r.part === "plate Pa road outside" && r.ref.endsWith("@1"))?.state === "due" && !R.after.find((r) => r.part === "master" && r.ref.endsWith("@1"))?.stale,
    "F-E14/F-E15: v1's every view row is stale, off the due list, and says v1 → vN": due("views", 1)?.state === "done" ? true : due("views", 1)?.state === "stale",
    "F-E14: a replaced plate's unwritten row is stale and says so (v1 → v4: its plate Pd houses changed)": /v1 → v\d+: its plate Pd houses changed/.test(due("plate Pd houses", 1)?.stale ?? "") && due("plate Pd houses", 1)?.state === "stale" && !R.due?.some((t) => /v1, plate Pd houses/.test(t)) && R.staleList?.some((r) => /plate Pd houses/.test(r.title)),
    "F-E15: the stale reason names the old version, then the newest, once": R.staleList?.every((r) => /Village · The Gate Price v\d+ → v\d+: /.test(r.stale ?? "") && !/v(\d+) → v\1\b/.test(r.stale)),
    "F-E14: stale rows are off the Work card": !R.work?.some((t) => /v1, plate Pd houses/.test(t)),
    "F-E02: open_view location from the Graph view switches the page to Snap and says so": R.view === "snap" && /\(snap\)/.test(R.openLoc?.said ?? ""),
    "F-E05/F-E21: masks show for every row at once: master, a plate, and an every-view note on the plate it names": ["master", "plate Pb gate inside, open", "plate Pa road outside"].every((p) => R.sheet1?.masks?.some((m) => m.part === p)),
    "F-E03/F-E04: each mask is a numbered box inside its picture, no words over the picture": R.sheet1?.masks?.length === 4 && R.sheet1.masks.every((m) => /^\d+$/.test(m.k) && m.inside),
    "F-E16: on the newest version the masks are the rows that still hold (master, Pb; not v1's every view)": R.sheet?.masks?.length === 3 && !R.sheet.masks.some((m) => m.part === "plate Pa road outside"),
    "F-E03: the sheet lists each note with owner and fix": R.sheet?.list?.some((t) => /owner: location:location-village@1, master/.test(t) && /fix: ring the village/.test(t)) && R.sheet.list.some((t) => /owner: location:location-village@1, notes · no mask/.test(t)),
    "F-E16: rows of v1 that still hold show as read on v1 on the newest version": /plate Pa road outside: critique due · read on v1/.test(R.sheet?.block ?? ""),
    "F-E18: the sheet's eye gap is one quiet line that says typed": R.sheet?.gaps?.length === 1 && /eye 4 m on the pose vs 1.6 m on the marks \(no mark\) · typed, check the horizon/.test(R.sheet.gaps[0]),
    "F-E21: open_view picture of the master draws its masks in the viewer": R.lbMasks?.length === 2 && R.lb?.masks?.length === 2,
    "no page errors": !R.errors?.length,
  };
  R.checks = checks;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g3_critic_result.json"), JSON.stringify(R, null, 1));
  const ok = Object.values(checks).filter(Boolean).length, all = Object.keys(checks).length;
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  console.log(`g3critic ${ok}/${all}`);
})();
