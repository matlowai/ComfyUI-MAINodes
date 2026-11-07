// Batch G4, F-F07 (SNAP-R140) on the CPU test server: a location whose master was fixed at the source twice.
// - v1 has a master file; two candidates made from it (one picked) give the v2 master; an edit of that pick is the v3
//   master. A board on v2, a rejected candidate on v2, an eye-level still edited from the board (it pins nothing) and a
//   walkthrough that opens on that still;
// - dependents lists only the board as stale; left_out names the masters' takes, the unpicked candidate and the rejected
//   one; follows names the still (via the board) and the walkthrough (via the still);
// - rerun_dependents' plan (a proposal with agents off) runs only the board and carries follows and left_out.
// usage: node test_g4_deps.js [port] [base]   prints "g4deps n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-g4deps-${Date.now()}`)); } };
(async () => {
  ["takes", "candidates", "location", "dependents", "proposals.json"].forEach(park); // moved, never deleted
  const fx = path.join(base, "input", "snaptest_g4deps");
  fs.mkdirSync(fx, { recursive: true });
  const D = CFG.fixture("short04");
  for (const [f, to] of [["settei_bg/MASTER_shrine_v1.png", "master_v1.png"], ["settei_bg/P1_torii_eyelevel.png", "cand_a.png"], ["settei_bg/P1_torii_eyelevel.png", "cand_b.png"], ["settei_bg/MASTER_shrine_v1.png", "fix.png"], ["bible/hiyori_front_v1.png", "board.png"], ["bible/hiyori_back_v1.png", "rej.png"], ["bible/tomoshi_front_v1.png", "eye.png"]]) fs.copyFileSync(path.join(D, f), path.join(fx, to));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const loc = (await call("save_location", { name: "Cart street", master: { file: "snaptest_g4deps/master_v1.png" } })).location;
    const take = (id, file, extra) => page.evaluate(async ([id, file, extra]) => { await window.__T.save({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 5, group: "g4deps", number: +id.replace(/\D/g, "") || 1, status: "success", text: id, seed: 1, media: [{ kind: extra.video ? "video" : "image", filename: file, subfolder: "snaptest_g4deps", type: "input" }], prompt: {}, graph: {}, verdict: null, notes: [], ...extra }); }, [id, file, extra]);
    const pin = (n) => ({ world: { [loc]: { n, name: "Cart street" } } });
    await take("take-g4d1", "cand_a.png", pin(1)); await take("take-g4d2", "cand_b.png", pin(1));
    await page.evaluate(async () => { await window.__C.save({ id: "dec-g4d-master", kind: "view", target: "g4", title: "master candidates", by: "agent", status: "applied", created: Date.now(), candidates: [{ id: "c1", take: "take-g4d1", state: "ready" }, { id: "c2", take: "take-g4d2", state: "ready" }], applied: { candidate: "c1", by: "person", at: new Date().toISOString() } }); });
    R.v2 = await call("save_location", { location: loc, name: "Cart street", master: { take: "take-g4d1" } });
    await take("take-g4d3", "fix.png", { ...pin(2), parent: { method: "edit", take: "take-g4d1" } });
    R.v3 = await call("save_location", { location: loc, name: "Cart street", master: { take: "take-g4d3" } });
    await take("take-g4d4", "board.png", pin(2));
    await take("take-g4d5", "rej.png", pin(2));
    await page.evaluate(async () => { await window.__C.save({ id: "dec-g4d-rej", kind: "view", target: "g4b", title: "a board's candidates", by: "agent", status: "open", created: Date.now(), candidates: [{ id: "c1", take: "take-g4d5", state: "rejected" }] }); });
    await take("take-g4d6", "eye.png", { parent: { method: "edit", take: "take-g4d4" } });
    await take("take-g4d7", "eye.png", { video: true, made_from: ["take-g4d6"] });
    R.deps = await call("dependents", { ref: loc });
    R.plan = await call("rerun_dependents", { ref: loc });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, ids = (list) => (list ?? []).map((x) => x.take).sort();
  const checks = {
    versions: S.v3?.version === 3 || S.v3?.n === 3 || /@3$/.test(S.v3?.ref ?? ""),
    staleOnlyBoard: JSON.stringify(ids(S.deps?.stale)) === JSON.stringify(["take-g4d4"]),
    leftOut: JSON.stringify(ids(S.deps?.left_out)) === JSON.stringify(["take-g4d1", "take-g4d2", "take-g4d3", "take-g4d5"]) && S.deps.left_out.find((x) => x.take === "take-g4d5")?.why === "a rejected candidate",
    follows: JSON.stringify(ids(S.deps?.follows)) === JSON.stringify(["take-g4d6", "take-g4d7"]) && S.deps.follows.find((x) => x.take === "take-g4d7")?.via?.take === "take-g4d6",
    planRunsBoardOnly: !!S.plan?.proposed && S.plan.plan?.stages?.flatMap((s) => s.takes.map((t) => t.take)).join() === "take-g4d4" && S.plan.plan?.follows?.length === 2 && S.plan.plan?.left_out?.length === 4,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g4_deps_result.json"), JSON.stringify(R, null, 1));
  console.log(`g4deps ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
