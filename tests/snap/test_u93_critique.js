// U93 B1 (SNAP-R101, R103) on a CPU test server: the critic's docket.
// - a still take that lands makes one due critique row (on the server, once, even with two pages open);
// - the Work card lists it (list_activity {kind: critique}), state queued, "critique due · waiting for a critic";
// - claim_critique from page A holds it; page B's claim is refused naming A's agent;
// - write_critique with three notes: get_take's notes carry them (severity, pass, region, owner, fix, by agent, critique id),
//   the row's result counts them, the Work card row is done with "1 high note", and the arrival is said once;
// - a reload of page A reads the same row and the same notes back; skip_critique on a second row leaves it skipped with why.
// usage: node test_u93_critique.js <port> <base>   prints "u93critique n/m" last; result in ui/u93/test_u93_critique_result.json
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, out = path.join(CFG.out, "ui", "u93"), R = {};
const SETTEI = CFG.fixture("short03", "settei_bg");
const park = (d) => { const p = path.join(base, "user", "default", "snap", d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${d}-u93-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  ["critiques", "takes", "candidates"].forEach(park);
  fs.mkdirSync(path.join(base, "output", "snaptest"), { recursive: true });
  fs.copyFileSync(path.join(SETTEI, "plates", "Pd_houses.png"), path.join(base, "output", "snaptest", "u93_board.png"));
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) }); // an earlier run's finished jobs would be adopted as takes (F-C25)
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), B = await F.open(b, port), page = A.page;
    const call = (p, agent, name, args) => p.evaluate(async ([a, n, x]) => { const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); I.setCaller(a); return window.__X.callTool(n, x).catch((e) => ({ error: e.message })); }, [agent, name, args]);
    const arrivals = [];
    await page.exposeFunction("__arrive", (w, t, s) => arrivals.push([w, t, s]));
    await page.evaluate(() => window.__A.onArrive((what, r) => { if (r.source === "critique") window.__arrive(what, r.title, r.state); }));
    // a still lands (its record is what a finished run writes)
    R.fix = await page.evaluate(async () => {
      const T = window.__T, mk = (id, number) => ({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), finished: Date.now(), seconds: 9, group: app.graph.id, number, status: "success", text: "Maren stands at the gate; she does not take the pouch", seed: 1,
        media: [{ kind: "image", filename: "u93_board.png", subfolder: "snaptest", type: "output" }], prompt: {}, graph: {}, verdict: null, notes: [] });
      await T.save(mk("take-u93-still", 931)); await T.save(mk("take-u93-second", 932));
      return true;
    });
    const rowOf = (p, take) => p.evaluate(async (t) => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); for (let i = 0; i < 40; i++) { await CR.reload(); const r = CR.all().find((x) => x.subject.take === t); if (r) return r; await new Promise((ok) => setTimeout(ok, 250)); } return null; }, take);
    R.row = await rowOf(page, "take-u93-still");
    await B.page.evaluate(async () => { await window.__T.reload(); });
    await B.page.waitForTimeout(1500);
    R.rowsOnServer = (await (await fetch(`http://127.0.0.1:${port}/mainodes/snap/critiques`)).json()).rows.filter((r) => r.subject.take === "take-u93-still").length;
    R.activity = await call(page, "critic-a", "list_activity", { kind: "critique" });
    R.list = await call(page, "critic-a", "list_critiques", { state: "due" });
    // claims: A holds it, B is refused
    R.claimA = await call(page, "critic-a", "claim_critique", { critique: R.row.id });
    R.claimB = await call(B.page, "critic-b", "claim_critique", { critique: R.row.id });
    R.activityClaimed = (await call(page, "critic-a", "list_activity", { kind: "critique" })).rows?.find((r) => r.critiques?.includes(R.row.id));
    R.packet = await call(page, "critic-a", "critique_packet", { critique: R.row.id });
    R.packetShape = R.packet.images && { n: R.packet.images.length, first: [R.packet.pictures[0].width, R.packet.pictures[0].height, R.packet.pictures[0].role], labels: R.packet.images.map((i) => i.label) };
    delete R.packet.images;
    R.writeB = await call(B.page, "critic-b", "write_critique", { critique: R.row.id, verdict: "flaws", notes: [] });
    R.write = await call(page, "critic-a", "write_critique", { critique: R.row.id, verdict: "flaws", passes: { scan: "3x3: houses, well, snow; nobody", map: "palisade runs along the back only", support: "nothing carried" },
      notes: [{ severity: "high", pass: "map", text: "the palisade stops at the right edge: the village is open on the east", picture: 0, region: [0.7, 0.2, 0.3, 0.4], owner: "location master", fix: "close the ring on the master, then re-make the plates" },
        { severity: "medium", pass: "support", text: "a lantern hangs from nothing above the door", region: [0.4, 0.1, 0.1, 0.15], owner: "take", fix: "re-roll with the lantern on a bracket" },
        { severity: "low", pass: "scan", text: "a stray ember near the well", owner: "take" }] });
    await page.waitForTimeout(800);
    R.take = await call(page, "critic-a", "get_take", { take: "take-u93-still" });
    R.notes = R.take.notes?.map((n) => [n.severity, n.pass, n.by, n.agent, !!n.critique, n.owner?.what ?? n.owner?.ref ?? null, n.region ?? null, n.tags]);
    R.done = (await call(page, "critic-a", "list_activity", { kind: "critique" })).rows?.find((r) => r.critiques?.includes(R.row.id));
    // skip a second row
    R.second = await rowOf(page, "take-u93-second");
    R.claim2 = await call(page, "critic-a", "claim_critique", {});
    R.skip = await call(page, "critic-a", "skip_critique", { critique: R.claim2.critique, why: "a test pattern, nothing to read" });
    await page.waitForTimeout(800);
    // reload: the same row and notes back from the server
    await page.reload(); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500); await F.loadMods(page);
    R.afterReload = await call(page, "critic-a", "list_critiques", { take: "take-u93-still" });
    R.afterNotes = (await call(page, "critic-a", "get_take", { take: "take-u93-still" })).notes?.filter((n) => n.critique).length;
    R.arrivals = arrivals;
    R.errors = [...A.errors, ...B.errors];
  } finally { await b.close(); }
  const c = (x) => !!x;
  const checks = [
    c(R.row && R.row.checklist === "still" && R.row.trigger === "landed"),
    R.rowsOnServer === 1,
    c(R.activity.rows?.some((r) => r.critiques?.includes(R.row.id) && r.state === "queued" && r.said === "critique due · waiting for a critic")),
    R.list.rows?.some((r) => r.critique === R.row.id && r.state === "due"),
    R.claimA.state === "claimed" && R.claimA.claimed.by === "agent:critic-a",
    /claimed by agent:critic-a/.test(R.claimB.error ?? ""),
    R.activityClaimed?.state === "running" && /critic-a is reading it/.test(R.activityClaimed.said),
    c(R.packetShape && R.packetShape.first[0] === 1280 && R.packetShape.first[1] === 704 && R.packetShape.first[2] === "subject"),
    /only the claimer/.test(R.writeB.error ?? ""),
    R.write.verdict === "flaws" && R.write.counts?.high === 1 && R.write.counts.medium === 1 && R.write.counts.low === 1,
    R.notes?.length === 3 && R.notes[0][0] === "high" && R.notes[0][2] === "agent" && R.notes[0][3] === "agent:critic-a" && R.notes[0][4] && R.notes[0][7].includes("set logic"),
    JSON.stringify(R.notes?.[0][6]) === JSON.stringify([0.7, 0.2, 0.3, 0.4]),
    R.done?.state === "done" && R.done.result?.high === 1 && /1 high note/.test(R.done.result.said),
    R.arrivals.filter(([w]) => w === "landed").length === 1,
    R.skip.state === "skipped" && /test pattern/.test(R.skip.skipped?.why ?? ""),
    R.afterReload.rows?.[0]?.notes.length === 3 && R.afterReload.rows[0].state === "done" && R.afterNotes === 3,
    !R.errors.length,
  ];
  R.checks = checks;
  fs.writeFileSync(path.join(out, "test_u93_critique_result.json"), JSON.stringify(R, null, 1));
  console.log(`u93critique ${checks.filter(Boolean).length}/${checks.length} ${checks.every(Boolean) ? "PASS" : "FAIL " + JSON.stringify(checks.map((x, i) => (x ? null : i)).filter((x) => x != null))}`);
})();
