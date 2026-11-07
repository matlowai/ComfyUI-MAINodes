// Batch G4, F-F11 (SNAP-R101, R136) on the CPU test server: the critic's docket from short05.
// - a take's row title says scene › shot › take n (seed) and the decision it came from, old rows included;
// - a candidate passed over (another one picked, or rejected) reads stale and leaves the docket;
// - two stills in a row in a scene that isn't a Book's get no cut pair row; two videos do;
// - a New view's packet carries the pictures it was made from as context; part: "context" lists only context pictures.
// usage: node test_g4_critic.js [port] [base]   prints "g4critic n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-g4critic-${Date.now()}`)); } };
(async () => {
  ["takes", "candidates", "critiques", "scenes", "proposals.json"].forEach(park); // moved, never deleted
  const D = CFG.fixture("short04"), fx = path.join(base, "input", "snaptest_g4critic"), vo = path.join(base, "output", "snaptest_g4critic");
  for (const d of [fx, vo]) fs.mkdirSync(d, { recursive: true });
  for (const [f, to] of [["bible/hiyori_front_v1.png", "a.png"], ["bible/hiyori_back_v1.png", "b.png"], ["bible/tomoshi_front_v1.png", "cast.png"]]) fs.copyFileSync(path.join(D, f), path.join(fx, to));
  fs.copyFileSync(CFG.fixture("e2e_refs3_00001_.mp4"), path.join(vo, "v.mp4"));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    R.out = await page.evaluate(async () => {
      const T = window.__T, C = window.__C, SC = window.__SC, CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js");
      await CR.load();
      const take = async (id, n, media, extra = {}) => { await T.save({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), finished: Date.now(), seconds: 2, group: "g4critic", number: n, status: "success", text: id, seed: 4200 + n, media, prompt: {}, graph: {}, verdict: null, notes: [], ...extra }); return T.get(id); };
      const img = (f) => [{ kind: "image", filename: f, subfolder: "snaptest_g4critic", type: "input" }], vid = [{ kind: "video", filename: "v.mp4", subfolder: "snaptest_g4critic", type: "output" }];
      const s = await SC.create({ name: "G4 critic scene", by: "agent" }), one = await SC.addShot(s.id, { name: "Sheets", by: "agent" }), two = await SC.addShot(s.id, { name: "Back", by: "agent" });
      const ctx = [{ n: 1, file: "snaptest_g4critic/cast.png", label: "cast: Kuroe, front" }];
      const t1 = await take("take-g4c1", 1, img("a.png"), { parent: { take: null, method: "view/ph3_view", options: { label: "two", prompt: "two", context: ctx, purpose: "character" } } });
      const t2 = await take("take-g4c2", 2, img("b.png"), { group: "g4critic2", parent: { take: null, method: "view/ph3_view", options: { label: "two", prompt: "two", context: ctx, purpose: "character" } } });
      await SC.addGroup(s.id, one.shot.id, "g4critic"); await SC.addGroup(s.id, two.shot.id, "g4critic2"); await SC.setActive(s.id, one.shot.id, t1.id); await SC.setActive(s.id, two.shot.id, t2.id);
      await C.save({ id: "dec-g4c", kind: "view", target: "g4critic", title: "New view · P-H3-Image ×2 (two)", by: "agent", status: "applied", created: Date.now(), candidates: [{ id: "c1", take: t1.id, state: "ready", seed: 4201 }, { id: "c2", take: t2.id, state: "ready", seed: 4202 }], applied: { candidate: "c1", by: "person", at: new Date().toISOString() } });
      for (const t of [t1, t2]) await CR.forTake(t); // the page's own scan may have made the row first
      return { scene: s.id };
    });
    await page.waitForTimeout(3000);
    const row = async (take) => (await call("list_critiques", { take })).rows?.find((r) => r.subject.kind === "take");
    const r1 = await row("take-g4c1"), r2 = await row("take-g4c2");
    Object.assign(R.out, { title1: r1?.title, rows: [r1?.critique, r2?.critique] });
    R.stale = (await call("list_critiques", { stale: true })).rows?.map((r) => [r.critique, r.stale]);
    R.due = (await call("list_critiques", { state: "due", compact: true })).rows?.map((r) => [r.critique, r.title]);
    R.pairs = (await call("list_critiques", { checklist: "cut_pair" })).rows?.length ?? 0;
    R.packet = await call("critique_packet", { critique: R.out.rows[0], part: "context" });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R;
  const checks = {
    titleSaysWhere: /^Critic: G4 critic scene › .*Sheets.* › take 1 \(seed 4201\) · New view · P-H3-Image ×2 \(two\)$/.test(S.out?.title1 ?? ""),
    unpickedStale: S.stale?.some(([id, why]) => id === S.out?.rows[1] && /another candidate \(c1\) was picked/.test(why ?? "")) && !S.due?.some(([id]) => id === S.out?.rows[1]),
    pickedStillDue: S.due?.some(([id, t]) => id === S.out?.rows[0] && /take 1 \(seed 4201\)/.test(t)),
    noStillPair: S.pairs === 0,
    contextOnly: S.packet?.pictures?.length > 0 && S.packet.pictures.every((p) => p.role === "context") && S.packet.pictures.some((p) => /made from: Picture 1 cast: Kuroe, front/.test(p.what ?? "")) && S.packet.of > S.packet.pictures.length,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g4_critic_result.json"), JSON.stringify(R, null, 1));
  console.log(`g4critic ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
