// Batch G15 write safety (Astrid interop map §6 step 3) on the CPU test server:
// - SNAP-R208 (F-AD01): a run whose page answer is held 45 s answers 504 at 30 s; the same Idempotency-Key retried
//   while the page still works answers `in_flight` (202, not run again), and once the page answers, `replayed` with the
//   first call's run: one prompt queued; the answer is kept in the user's snap/idempotency.json;
// - SNAP-R209 records (F-AB03): two waiting save_cast proposals on one Cast at one version are either/or; accepting one
//   leaves the other out of date ("v1 → v2", by the first), its Accept refuses, the Work card offers "Re-make against
//   v2", and the re-make waits as a new proposal on v2 (the old one withdrawn naming it), which accepts to v3;
// - SNAP-R209 story: an edit drafted over a waiting edit stays current when that one is accepted; a waiting edit stays
//   current after an edit of another beat and goes out of date when the person edits its own beat; the Book docket shows
//   it with Re-make;
// - SNAP-R210: with the person's expiry setting on, a proposal past expires_at is parked on the Work card, not deleted.
// Screenshots (proto/ui/g15 via SNAP_TEST_OUT/ui/g15): the Room's either/or pair, the Room and Work card out of date.
// usage: node test_g15_safety.js [port] [base]   prints "g15safety n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-g15-${Date.now()}`)); } };
const http = async (route, body, headers = {}) => { try { return await fetchJson(route, body, headers); } catch (e) { return { status: 0, error: `${e.message}: ${e.cause?.code ?? e.cause?.message ?? e.cause}` }; } };
const fetchJson = async (route, body, headers = {}) => { const r = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, ...(await r.json()) }; };
const bridge = (tool, args, agent, key) => http("/mainodes/snap/call", { tool, args }, { "X-Snap-Agent": agent, ...(key ? { "Idempotency-Key": key } : {}) });
(async () => {
  ["takes", "cast", "book", "story", "look", "scenes", "proposals.json", "work.json"].forEach(park); // moved, never deleted
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  const fx = path.join(base, "input", "snaptest_g15");
  fs.mkdirSync(fx, { recursive: true });
  const D = CFG.fixture("short04");
  for (const [f, to] of [["bible/hiyori_front_v1.png", "front.png"], ["bible/hiyori_back_v1.png", "alt_a.png"], ["bible/tomoshi_front_v1.png", "alt_b.png"]]) fs.copyFileSync(path.join(D, f), path.join(fx, to));
  const shots = path.join(CFG.out, "ui", "g15"); fs.mkdirSync(shots, { recursive: true });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port, { viewport: { width: 1400, height: 1000 } }), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const accept = (id) => page.evaluate(async (id) => { try { const p = await window.__P.decide(id, true, (n, a) => window.__X.callTool(n, a, { confirmed: true })); return { status: p?.status, result: p?.result }; } catch (e) { return { error: e.message }; } }, id);
    const props = () => call("list_proposals", {});
    const id = await page.evaluate(async () => (await import("/scripts/api.js")).api.clientId);

    // ---- SNAP-R208: a run held past the bridge's timeout, retried with its key ----
    let held = 0;
    await page.route(/mainodes\/snap\/result/, async (r) => { if (!held++) await new Promise((ok) => setTimeout(ok, 45000)); r.continue(); }); // under the page's own fetch timeout
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    await bridge("use_page", { page: id }, "g15-idem");
    held = 0;
    const K = `g15-${Date.now().toString(36)}`, n0 = A.queued.length, t0 = Date.now();
    // the first call (answered 504 at 30 s) and a retry 1 s later (it waits 30 s more: in_flight at 31 s), then one more
    // retry that the page's answer at 45 s reaches (replayed)
    const first = bridge("run", { question: "g15 idempotent run" }, "g15-idem", K).then((x) => { R.firstS = Math.round((Date.now() - t0) / 1000); return x; });
    await new Promise((ok) => setTimeout(ok, 1000));
    R.second = await bridge("run", { question: "g15 idempotent run" }, "g15-idem", K);
    R.first = await first;
    R.third = await bridge("run", { question: "g15 idempotent run" }, "g15-idem", K);
    await page.waitForTimeout(1500);
    R.queued = A.queued.slice(n0).filter((q) => /g15 idempotent run/.test(q.extra?.snap_job?.title ?? "")).length;
    const kept = path.join(snap, "idempotency.json");
    R.kept = fs.existsSync(kept) ? JSON.parse(fs.readFileSync(kept, "utf8")).find((x) => x.key === K) ?? null : null;
    await page.unroute(/mainodes\/snap\/result/);
    await bridge("use_page", { page: null }, "g15-idem");
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); });
    await F.idle(port);
    await page.evaluate(async (run) => { const A = await import("/extensions/ComfyUI-MAINodes/snap/activity.js"); await A.reconcile(); if (run) await A.park(run, true); }, R.third?.result?.run); // out of the Room's way

    // ---- SNAP-R209 records: either/or, out of date, re-make (F-AB03) ----
    const cast = (await call("save_cast", { name: "Hiyori", details: "a shrine maiden with a red ribbon", refs: [{ file: "snaptest_g15/front.png", role: "identity: front" }] })).cast;
    R.cast = cast;
    const pa = await call("save_cast", { cast, refs: [{ file: "snaptest_g15/alt_a.png", role: "identity: front" }], propose: true, reason: "a cleaner front for Hiyori (option A)" });
    const pb = await call("save_cast", { cast, refs: [{ file: "snaptest_g15/alt_b.png", role: "identity: front" }], propose: true, reason: "a cleaner front for Hiyori (option B)" });
    R.pa = pa.proposed; R.pb = pb.proposed;
    R.listBefore = (await props()).filter((p) => [R.pa, R.pb].includes(p.id)).map(({ id, base, either_or, stale }) => ({ id, base, either_or, stale }));
    await page.evaluate(async () => { const A = await import("/extensions/ComfyUI-MAINodes/snap/activity.js"); await A.reconcile(); const RM = await import("/extensions/ComfyUI-MAINodes/snap/room.js"); RM.openRoom(); });
    await page.waitForTimeout(1500);
    R.roomPair = await page.evaluate(() => [...document.querySelectorAll(".snap-room-q .snap-room-stakes")].map((x) => x.textContent));
    await page.screenshot({ path: path.join(shots, "g15_room_either_or.png"), fullPage: true });
    await page.evaluate(() => { for (const s of document.querySelectorAll(".snap-room")) s.remove(); });
    R.acceptA = await accept(R.pa);
    R.head = await page.evaluate(async (c) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); return W.get(c)?.version.n; }, cast);
    R.listAfter = (await props()).find((p) => p.id === R.pb);
    R.acceptB = await accept(R.pb);
    R.headAfterB = await page.evaluate(async (c) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); return W.get(c)?.version.n; }, cast);
    await page.evaluate(async () => { const A = await import("/extensions/ComfyUI-MAINodes/snap/activity.js"); await A.reconcile(); const RM = await import("/extensions/ComfyUI-MAINodes/snap/room.js"); RM.openRoom(); });
    await page.waitForTimeout(1500);
    R.roomStale = await page.evaluate(() => ({ stakes: [...document.querySelectorAll(".snap-room-q .snap-room-stakes")].map((x) => x.textContent), buttons: [...document.querySelectorAll(".snap-room-q .snap-room-verdict button")].map((x) => x.textContent) }));
    await page.screenshot({ path: path.join(shots, "g15_room_out_of_date.png"), fullPage: true });
    await page.evaluate(() => { for (const s of document.querySelectorAll(".snap-room")) s.remove(); });
    R.workRow = await page.evaluate(async (pid) => { const WV = await import("/extensions/ComfyUI-MAINodes/snap/workview.js"); const A = await import("/extensions/ComfyUI-MAINodes/snap/activity.js"); await A.reconcile(); const r = A.all().find((x) => x.proposal === pid); return r ? { meta: WV.stateText(r), stale: r.stale ?? null } : null; }, R.pb);
    await page.waitForTimeout(2500); await page.click(".snap-work-btn"); await page.waitForTimeout(1200);
    R.workButtons = await page.evaluate(() => [...document.querySelectorAll(".snap-work-sheet .snap-work-row button")].map((x) => x.textContent));
    await page.screenshot({ path: path.join(shots, "g15_work_out_of_date.png") });
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    R.remake = await page.evaluate(async (pid) => { try { return await window.__P.remake(pid); } catch (e) { return { error: e.message }; } }, R.pb);
    const all = await props();
    R.oldRow = all.find((p) => p.id === R.pb); R.newRow = all.find((p) => p.id === R.remake?.remade);
    R.acceptNew = await accept(R.remake?.remade);
    R.headFinal = await page.evaluate(async (c) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.reload(); return { n: W.get(c)?.version.n, file: W.get(c)?.version.body.refs?.[0]?.file }; }, cast);

    // ---- SNAP-R209 story: drafted-over edits and edits of other beats leave it current; the person's edit of its beat doesn't ----
    const book = (await call("create_book", { name: "G15 lamp", medium: "anime", logline: "a lamp goes dark", cast: [cast] })).book;
    const b1 = await call("add_beat", { book, text: "Hiyori climbs the stairs." });
    const b2 = await call("add_beat", { book, text: "The lamp goes dark." });
    R.b2base = (await props()).find((p) => p.id === b2.proposed)?.base ?? null;
    R.acceptB1 = await accept(b1.proposed);
    R.b2AfterB1 = (await props()).find((p) => p.id === b2.proposed)?.stale ?? null;
    R.acceptB2 = await accept(b2.proposed);
    const mv = await call("move_beat", { book, beat: "b2", told: 1 });
    R.mv = mv.proposed;
    R.otherSave = await page.evaluate(async (bk) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(bk); const next = structuredClone(st.body); next.beats.find((x) => x.id === "b1").text = "Hiyori climbs the long stairs."; return (await B.saveStory(st.id, next, { note: "the person's edit of another beat" })).n; }, book);
    R.mvAfterOther = (await props()).find((p) => p.id === R.mv)?.stale ?? null;
    R.personSave = await page.evaluate(async (bk) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(bk); const next = structuredClone(st.body); next.beats.find((x) => x.id === "b2").text = "The lamp gutters and goes dark."; const out = await B.saveStory(st.id, next, { note: "the person's own edit" }); return out.n; }, book);
    R.mvRow = (await props()).find((p) => p.id === R.mv);
    R.mvAccept = await accept(R.mv);
    await call("open_view", { view: "book", book }); await page.waitForTimeout(1500);
    R.docket = await page.evaluate(() => [...document.querySelectorAll(".snap-book-prop")].map((x) => x.textContent));
    await page.screenshot({ path: path.join(shots, "g15_book_docket_out_of_date.png") });

    // ---- SNAP-R210: expiry parks ----
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.ProposalExpiry", 0.0001); }); // about 0.4 s
    const ex = await call("save_cast", { cast, details: "a shrine maiden with a long red ribbon", propose: true, reason: "a longer ribbon" });
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.ProposalExpiry", 0); });
    await page.waitForTimeout(1200);
    R.exRow = (await props()).find((p) => p.id === ex.proposed);
    R.exWork = await page.evaluate(async (pid) => { const A = await import("/extensions/ComfyUI-MAINodes/snap/activity.js"); await A.reconcile(); const r = A.all().find((x) => x.proposal === pid); return r ? { zone: r.zone, parked: r.parked } : null; }, ex.proposed);
    R.noExpiry = (await props()).find((p) => p.id === R.mv)?.expires_at ?? null;
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R;
  const checks = {
    "R208 the held call answers 504 after the bridge's 30 s": S.first?.status === 504 && S.firstS >= 29,
    "R208 a retry while the page works answers in_flight (202), not run again": S.second?.status === 202 && S.second?.in_flight === true && S.second?.idempotency_key?.startsWith("g15-"),
    "R208 the next retry replays the first call's run": S.third?.replayed === true && !!S.third?.result?.run,
    "R208 one prompt queued for the three calls": S.queued === 1,
    "R208 the answer is kept in the user's idempotency.json": S.kept?.tool === "run" && !!S.kept?.answer?.result?.run && S.kept?.answer?.result?.run === S.third?.result?.run,
    "R209 both proposals keep base {cast, v1}": S.listBefore?.length === 2 && S.listBefore.every((p) => p.base?.ref === S.cast && p.base?.version === 1),
    "R209 F-AB03 they are either/or": S.listBefore?.find((p) => p.id === S.pa)?.either_or?.[0] === S.pb && S.listBefore?.find((p) => p.id === S.pb)?.either_or?.[0] === S.pa,
    "R209 the Room says either/or on the pair (one question since SNAP-R229)": (S.roomPair ?? []).some((t) => /^Either one or the other: they change the same thing from the same version\.$/.test(t)),
    "R209 accepting A makes v2": S.acceptA?.status === "accepted" && S.head === 2,
    "R209 B is out of date: v1 → v2 by A": S.listAfter?.stale?.from === 1 && S.listAfter?.stale?.to === 2 && S.listAfter?.stale?.by?.[0] === S.pa && !S.listAfter?.either_or,
    "R209 accepting B refuses and makes no v3": /out of date: Hiyori v1 → v2/.test(S.acceptB?.error ?? "") && S.headAfterB === 2,
    "R209 the Room offers 'Make it again on v2', not Yes": S.roomStale?.buttons?.includes("Make it again on v2") && !S.roomStale?.buttons?.includes("Yes") && S.roomStale?.stakes?.some((t) => /has changed since this was asked \(v1 → v2\)/.test(t)),
    "R209 the Work card row says out of date and offers Re-make": /^out of date: Hiyori v1 → v2/.test(S.workRow?.meta ?? "") && S.workButtons?.includes("Re-make against v2"),
    "R209 re-make waits as a new proposal on v2; the old one withdrawn naming it": S.newRow?.status === "waiting" && S.newRow?.base?.version === 2 && S.oldRow?.status === "withdrawn" && S.oldRow?.result?.includes(`re-made as ${S.remake?.remade} against v2`),
    "R209 the re-made one accepts to v3 with B's picture": S.acceptNew?.status === "accepted" && S.headFinal?.n === 3 && /alt_b/.test(S.headFinal?.file ?? ""),
    "R209 a story edit's base is the story head plus what it was drafted over": S.b2base?.ref?.startsWith("story:") && S.b2base?.on?.length === 1,
    "R209 accepting the edit it was drafted over leaves it current": S.acceptB1?.status === "accepted" && S.b2AfterB1 === null && S.acceptB2?.status === "accepted",
    "R209 an edit of another beat leaves a story edit current": typeof S.otherSave === "number" && S.mvAfterOther === null,
    "R209 the person's own edit of its beat makes a waiting edit out of date": S.mvRow?.stale?.ref?.startsWith("story:") && S.mvRow?.stale?.to === S.personSave && !S.mvRow?.stale?.by && /out of date/.test(S.mvAccept?.error ?? ""),
    "R209 the Book docket shows it out of date with Re-make": (S.docket ?? []).some((t) => /out of date: the story v\d+ → v\d+/.test(t) && /Re-make against v\d+/.test(t)),
    "R210 an expired proposal is parked, kept waiting (not deleted)": S.exRow?.status === "waiting" && S.exRow?.expired === true && S.exWork?.zone === "parked" && /expired/.test(S.exWork?.parked?.because ?? ""),
    "R210 off by default: no expires_at": S.noExpiry === null,
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify(R, null, 1));
  console.log(`g15safety ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
