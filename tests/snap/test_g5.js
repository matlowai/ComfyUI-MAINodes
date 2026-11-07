// Batch G5 on the CPU test server (the village v11 dogfood findings F-G01..F-G11):
// - F-G05 (SNAP-R146): an agent that holds a page and claimed a critique, or has a run of its own on the queue, is busy:
//   list_pages says driver_busy for its page (its hold then outlasts the 10 idle minutes); the run's job stamp names it;
// - F-G01 (SNAP-R147): a location made from a Cast (cast_to_location): dependents lists the takes that pinned the Cast
//   (via) and the take a plate came from, after the master changed; rerun_slots offers the location for the Cast slot;
//   rerun_dependents' plan re-runs the Cast-pinned take with the Cast swapped for the location and names the other by_hand;
// - F-G03 (SNAP-R148): add_plate with a pose only keeps the plate's picture, camera, use and note; a camera mark object
//   adds a mark, and the same name again moves it;
// - F-G02: set_active_take takes a unique start of the take's id; F-G08: apply_candidate names the take it replaced;
// - F-G11: list_critiques {ref} lists one record's rows; F-G10: a note two rows wrote on the same region counts once;
// - F-G07: a plate's packet has a measuring copy (a 10 % grid, mapped like a tile over the whole), its still context is
//   PNG, and the drawn plan names the file it was drawn over instead of claiming its path;
// - F-G04 (SNAP-R154): draw_set_plan {preview: true} answers the picture and the labels that run off the plan or over
//   another, and makes no version;
// - F-G06: a due row of an older version whose picture a later written row read is answered there (stale, "read on
//   vN"); a notes-only version gets its own "every view" row;
// - G2 item 11 (UI-13): list_setups' presets say what they read (Ref2V: references and audio; FL2V: the First frame)
//   and what they are, the no-turbo ones as opt-in and not a quality step up (SNAP-R149); G2 item 24 (UI-17):
//   list_tabs lists the open tabs, the scene shot's tab named with its scene and shot.
// usage: node test_g5.js [port] [base]   prints "g5 n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-g5-${Date.now()}`)); } };
const http = async (route, body, agent) => { const r = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...(agent ? { "X-Snap-Agent": agent } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, ...(await r.json()) }; };
const bridge = (tool, args, agent) => http("/mainodes/snap/call", { tool, args }, agent);
(async () => {
  ["takes", "candidates", "cast", "location", "dependents", "critiques", "scenes", "proposals.json"].forEach(park); // moved, never deleted
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  const fx = path.join(base, "input", "snaptest_g5");
  fs.mkdirSync(fx, { recursive: true });
  const D = CFG.fixture("short04");
  for (const [f, to] of [["settei_bg/MASTER_shrine_v1.png", "village_master.png"], ["settei_bg/P1_torii_eyelevel.png", "village_gate.png"], ["settei_bg/MASTER_shrine_v1.png", "master_v2.png"], ["bible/hiyori_front_v1.png", "a.png"], ["bible/hiyori_back_v1.png", "b.png"]]) fs.copyFileSync(path.join(D, f), path.join(fx, to));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port, { slow: 40 }), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const take = (id, file, extra) => page.evaluate(async ([id, file, extra]) => { await window.__T.save({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 5, group: extra.group ?? "g5", number: +id.replace(/\D/g, "") || 1, status: "success", text: id, seed: 1, media: [{ kind: extra.video ? "video" : "image", filename: file, subfolder: "snaptest_g5", type: "input" }], prompt: {}, graph: {}, verdict: null, notes: [], ...extra }); }, [id, file, extra]);

    // ---- F-G05: busy holds ----
    const id = await page.evaluate(async () => (await import("/scripts/api.js")).api.clientId);
    R.bind = await bridge("use_page", { page: id }, "g5-critic");
    const loc0 = (await call("save_location", { name: "Hold test", master: { file: "snaptest_g5/village_master.png" } })).location;
    R.ask = await bridge("critique", { location: loc0, part: "master" }, "g5-critic");
    R.claim = await bridge("claim_critique", { critique: R.ask.result?.critique ?? R.ask.result?.id }, "g5-critic");
    R.listClaim = (await bridge("list_pages", {}, "g5-critic")).result?.pages?.find((p) => p.id === id);
    await bridge("claim_critique", { critique: R.claim.result?.critique, release: true }, "g5-critic");
    await bridge("use_page", { page: null }, "g5-critic");
    R.bindJ = await bridge("use_page", { page: id }, "g5-runner");
    R.stamp = await page.evaluate(async () => {
      const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"), J = window.__J, { api } = await import("/scripts/api.js");
      I.setCaller("g5-runner"); const job = J.job({ kind: "check", title: "a slow check for the hold test", takes: false }); I.setCaller(null);
      const send = () => api.fetchApi("/prompt", { method: "POST", body: JSON.stringify({ client_id: api.clientId, prompt: {}, extra_data: { snap_job: job } }) }).then((r) => r.json());
      const ids = []; for (let i = 0; i < 3; i++) ids.push((await send()).prompt_id); // three, so one is still on the queue when list_pages reads it
      return { job, queued: ids[0] ?? null, after: J.job({ kind: "check", title: "no caller" }).agent ?? null };
    });
    R.listRun = (await bridge("list_pages", {}, "g5-runner")).result?.pages?.find((p) => p.id === id);
    await bridge("use_page", { page: null }, "g5-runner");
    await F.idle(port);

    // ---- F-G01: a location made from a Cast ----
    const cast = await call("save_cast", { name: "Village (set)", details: "a snowy village inside a palisade", refs: [{ file: "snaptest_g5/village_master.png", role: "master" }, { file: "snaptest_g5/village_gate.png", role: "gate" }] });
    const castId = cast.cast ?? cast.id ?? cast.ref?.replace(/@\d+$/, "");
    R.castRef = castId;
    const made = await call("cast_to_location", { cast: castId });
    const loc = made.location;
    R.made = made;
    const castKey = castId.startsWith("cast:") ? castId : `cast:${castId}`;
    await take("take-g5w1", "village_gate.png", { video: true, world: { [castKey]: { n: 1, name: "Village", placed: { roles: ["cast: Village (set), master", "cast: Village (set), gate"] } } } }); // a walkthrough on the Cast
    await take("take-g5w2", "b.png", {}); // a still the gate plate came from, pinning nothing
    R.plate = await call("add_plate", { location: loc, name: "gate", file: "snaptest_g5/village_gate.png", camera: { name: "G1", x: 0.5, y: 0.9, heading: 0, eye_height: 1.6 }, use: "C1", note: "the gate from the road" });
    // the plate's picture came from take g5w2 (as a walkthrough frame would): written into the record the way add_plate {take} keeps it
    R.v3 = await page.evaluate(async ([loc]) => { const L = await import("/extensions/ComfyUI-MAINodes/snap/library.js"), W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); const { id, body } = L.locationOf(loc); return L.saveLocation(id, { ...body, plates: body.plates.map((p) => (p.name === "gate" ? { ...p, from: { take: "take-g5w2", frame: 0 } } : p)) }, { note: "gate plate source", by: "agent" }); }, [loc]);
    R.v4 = await call("save_location", { location: loc, master: { file: "snaptest_g5/master_v2.png" }, plan: { file: "snaptest_g5/a.png" }, note: "master fixed at the source, a plan" });
    R.deps = await call("dependents", { ref: loc });
    R.slots = await call("rerun_slots", { take: "take-g5w1" });
    R.plan = await call("rerun_dependents", { ref: loc });

    // ---- F-G03: one plate's pose, a camera mark ----
    R.pose = await call("add_plate", { location: loc, name: "gate", pose: { x: 0.5, y: 0.85, heading: 10, eye_height: 1.5 } });
    R.afterPose = await call("get_record", { ref: R.pose.ref });
    R.mark = await call("add_plate", { location: loc, name: "gate", camera: { name: "G2", x: 0.4, y: 0.8, heading: 20, eye_height: 1.6 } });
    R.move = await call("add_plate", { location: loc, name: "gate", camera: { name: "G2", x: 0.45 } });
    R.afterMove = await call("get_record", { ref: R.move.ref });

    // ---- F-G04: a plan preview ----
    const before = (await call("get_record", { ref: loc })).head;
    const pv = await call("draw_set_plan", { location: loc, preview: true, shapes: [{ kind: "rect", x: 0.5, y: 0.5, w: 0.3, h: 0.2, label: "Square" }, { kind: "label", x: 0.97, y: 0.3, label: "THE EAST WALL RUNS THE WHOLE WAY" }, { kind: "label", x: 0.5, y: 0.8, label: "Well" }, { kind: "label", x: 0.52, y: 0.8, label: "Gate" }] });
    R.preview = { ...pv, images: (pv.images ?? []).map((i) => ({ mimeType: i.mimeType, bytes: Math.round((i.data?.length ?? 0) * 0.75) })) };
    R.afterPreview = (await call("get_record", { ref: loc })).head;
    R.previewSame = before === R.afterPreview;

    // ---- F-G11 + F-G10: one record's rows; a note two rows wrote once ----
    const head = R.move.ref, by = "agent:g5-notes";
    const row = async (part, packet) => { const r = (await http("/mainodes/snap/critique/due", { key: `record:${head}:${part}:g5`, subject: { kind: "record", ref: head, part }, title: `Critic: g5 ${part}`, checklist: part === "views" ? "location" : "plate", by: "fixtures" })).critique; await http("/mainodes/snap/critique/claim", { id: r.id, by }); await http("/mainodes/snap/critique/update", { id: r.id, set: { packet } }); await http("/mainodes/snap/critique/write", { id: r.id, by, verdict: "flaws", passes: {}, notes: [{ id: "n1", severity: "medium", pass: "map", text: "the gate's wall is too low", region: [0.2, 0.3, 0.2, 0.2], picture: 0, owner: "plate gate" }] }); return r.id; };
    R.rows = [await row("views", { pictures: [{ what: "Village v6, plate gate" }], at: Date.now() }), await row("plate gate", { pictures: [{ what: "Village v6, plate gate" }], at: Date.now() })];
    await page.waitForTimeout(1500);
    const pr = await call("critique", { location: loc, part: "plate gate", again: true });
    const pk = await call("critique_packet", { critique: pr.critique });
    R.packet = (pk.pictures ?? []).map((p) => ({ role: p.role, cell: p.tile?.cell ?? null, path: p.path, drawn_over: p.drawn_over ?? null, format: p.format, label: p.label }));
    R.byRef = await call("list_critiques", { ref: loc, compact: true });
    R.oldPlate = (await call("list_critiques", { ref: loc })).rows?.filter((r) => /, plate gate$/.test(r.title) && r.title !== "Critic: g5 plate gate").map((r) => ({ title: r.title, state: r.state, stale: r.stale }));
    R.notesOnly = await call("save_location", { location: loc, notes: "the gate faces the road; the well is mid-square" });
    await page.waitForTimeout(2500);
    R.notesRows = (await call("list_critiques", { ref: R.notesOnly.ref, compact: true })).rows;
    R.notes = await page.evaluate(async ([ref]) => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"), CV = await import("/extensions/ComfyUI-MAINodes/snap/critiqueview.js"); await CR.load(); return CV.locationNotes(ref).map((x) => ({ k: x.k, part: x.part, also: x.also ?? [] })); }, [head]);

    // ---- F-G02 + F-G08: a short take id; the replaced active take ----
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const sc = await call("create_scene", { name: "G5 shots" }), sid = sc.scene?.id ?? sc.id ?? sc.scene;
    const shot = await call("add_shot", { scene: sid, name: "S1" });
    await call("open_shot", { scene: sid, shot: shot.shot?.id }); await page.waitForTimeout(2500);
    const group = await page.evaluate(() => app.graph.id);
    R.tabs = await call("list_tabs", {});
    R.setups = (await call("list_setups", {})).filter?.((s) => s.source === "preset").map((s) => ({ name: s.name, reads: s.reads, about: s.about }));
    await take("take-g5s1aa", "a.png", { group }); await take("take-g5s2bb", "b.png", { group });
    R.short = await call("set_active_take", { scene: sid, shot: shot.shot?.id, take: "g5s2b" });
    await page.evaluate(async ([g]) => { await window.__C.save({ id: "dec-g5", kind: "view", target: "take-g5s2bb", title: "g5 new view", by: "agent", status: "open", created: Date.now(), candidates: [{ id: "c1", prompt_id: "g5s1aa", take: "take-g5s1aa", state: "ready", label: "c1", pictures: [] }] }); }, [group]);
    R.apply = await call("apply_candidate", { decision: "dec-g5", candidate: "c1" });
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, ids = (list) => (list ?? []).map((x) => x.take).sort();
  const v = (rec) => rec?.version?.body ?? rec?.body ?? rec;
  const plate = (rec) => (v(rec)?.plates ?? []).find((p) => p.name === "gate");
  const checks = {
    "F-G05 a claimed critique keeps the hold (driver_busy names it)": /holds the critique crit-/.test(S.listClaim?.driver_busy ?? "") && S.listClaim?.driven_by === "g5-critic",
    "F-G05 a run of its own keeps the hold (driver_busy names it)": /its run \S+ \(a slow check for the hold test\) is (running|queued)/.test(S.listRun?.driver_busy ?? ""),
    "F-G05 the job stamp names the calling agent, and only during its call": S.stamp?.job?.agent === "g5-runner" && S.stamp?.after === null && !!S.stamp?.queued,
    "F-G01 a location from a Cast": /^location:/.test(S.made?.location ?? ""),
    "F-G01 dependents lists the Cast-pinned walk (via the Cast) and the plate's source take": JSON.stringify(ids(S.deps?.stale)) === JSON.stringify(["take-g5w1", "take-g5w2"]) && /pinned the Cast/.test(S.deps.stale.find((x) => x.take === "take-g5w1")?.via ?? "") && S.deps.stale.find((x) => x.take === "take-g5w2")?.rerun === null,
    "F-G01 the Cast slot offers the location": (S.slots?.slots ?? S.slots ?? []).some?.((x) => x.slot === S.castRef?.replace?.(/^(?!cast:)/, "cast:") && x.location === S.made?.location),
    "F-G01 the plan re-runs the walk with the Cast swapped for the location; the source is by hand": (() => { const p = S.plan?.plan ?? S.plan, t = p?.stages?.flatMap((s) => s.takes) ?? []; return t.length === 1 && t[0].take === "take-g5w1" && Object.values(t[0].swap ?? {})[0]?.to === S.made?.location && p.by_hand?.[0]?.take === "take-g5w2"; })(),
    "F-G03 a pose alone keeps the plate's picture, mark, use and note": (() => { const p = plate(S.afterPose); return p?.file === "snaptest_g5/village_gate.png" && p.camera === "G1" && p.use === "C1" && p.note === "the gate from the road" && p.pose?.eye_height === 1.5 && (S.pose?.kept?.gate ?? []).includes("file"); })(),
    "F-G03 a camera mark object adds a mark, then moves it": (() => { const b = v(S.afterMove), g2 = (b?.cameras ?? []).find((c) => c.name === "G2"); return plate(S.afterMove)?.camera === "G2" && g2?.x === 0.45 && g2?.heading === 20 && (b.cameras ?? []).some((c) => c.name === "G1"); })(),
    "F-G11 list_critiques {ref} lists the record's rows only": S.byRef?.count >= 2 && (S.byRef?.rows ?? []).every((r) => /g5|Hold test|Village/.test(r.title ?? "")) && S.rows?.every((r) => S.byRef.rows.some((x) => x.critique === r)),
    "F-G07 a plate's packet: a measuring copy, PNG still context, the drawn plan's file named apart": (S.packet ?? []).some((p) => p.cell === "measure" && p.format === "png" && /measure: a 10 % grid/.test(p.label)) && (S.packet ?? []).filter((p) => p.role === "context" && !p.drawn_over).every((p) => p.format === "png") && (S.packet ?? []).some((p) => p.drawn_over && p.path === null),
    "F-G04 a plan preview: the picture, the labels in trouble, no version": S.preview?.preview === true && S.preview.images?.[0]?.mimeType === "image/png" && S.preview.images[0].bytes > 1000 && S.previewSame
      && (S.preview.labels ?? []).some((l) => l.shape === 1 && l.off_edge?.includes("right")) && (S.preview.labels ?? []).some((l) => l.shape === 2 && l.overlaps?.some((o) => /Gate/.test(o))) && !(S.preview.labels ?? []).some((l) => l.shape === 0),
    "F-G06 an older due plate row is answered by the later written one": (S.oldPlate ?? []).some((r) => r.state === "stale" && /read on v\d+ \(crit-[^)]+\): the same plate gate/.test(r.stale ?? "")),
    "F-G06 a notes-only version gets its own views row": (S.notesRows ?? []).some((r) => /every view side by side/.test(r.title) && r.state === "due"),
    "UI-13 presets say what they read and what they are": (() => { const by = (n) => (S.setups ?? []).find((s) => s.name === n); return /reference pictures/.test(by("Pika + reference pictures")?.reads?.join() ?? "") && /First frame/.test(by("Pika H3 Flex")?.reads?.join() ?? "") && /6 steps with/.test(by("Pika H3 Flex")?.about ?? "") && /opt-in.*not a quality step up/.test(by("Reference pictures, no turbo (20 steps)")?.about ?? ""); })(),
    "UI-17 list_tabs names the open tabs and the shot's scene": (S.tabs?.tabs ?? []).some((t) => t.active && t.scene && t.scene_name === "G5 shots" && t.shot_title) && S.tabs?.count === S.tabs?.tabs?.length,
    "F-G10 the repeated note is one note": (S.notes ?? []).filter((x) => x.part === "plate gate").length === 1 && (S.notes ?? []).find((x) => x.part === "plate gate")?.also?.length === 1,
    "F-G02 set_active_take takes a unique start of the id": S.short?.active === "take-g5s2bb",
    "F-G08 apply_candidate names the take it replaced": S.apply?.replaced === "take-g5s2bb" && /in place of take \d+ \(take-g5s2bb\)/.test(S.apply?.said ?? ""),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g5_result.json"), JSON.stringify(R, null, 1));
  console.log(`g5 ${R.pass}/${R.total}`, Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k).join(" | "));
})();
