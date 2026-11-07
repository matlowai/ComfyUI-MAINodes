// Batch G7, the Book's step 7 (CONCEPT_PRODUCTION §11.5): judge with one key and record why (SNAP-R173, SNAP-R174):
// - p / x / n on a focused take card and in the take viewer write the same record the viewer's buttons write
//   (verdict, verdict_by person, verdict_at), "neither" is a value;
// - the viewer's why and "worth another look if…" go with the verdict (verdict_note, revive_if): the option cemetery;
// - a verdict replaced is kept as superseded, "actually, no" takes one back with its reason (a misfire), struck through;
// - a rejected candidate, a rejected proposal and a parked Work card row keep their because; the cemetery tool lists them;
// - an accepted story proposal's version says who pressed Accept (accepted_by, F-L17); a reject answers who too;
// - a blind pair names no take in the page until it is judged: the pair list, the Work card row and the open sheet
//   carry no take id or number; the server says which was A after the verdict and writes the judgment.
// Screens: ui/g7/verdict_viewer.png, ui/g7/blind_pair.png. usage: node test_g7_verdicts.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g7");
const base = process.argv[3] || CFG.base;
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  ["takes", "candidates", "scenes", "proposals.json", "book", "story", "work.json"].forEach(park); // moved, never deleted
  const blindFile = path.join(base, "user", "snap_blind.json");
  if (fs.existsSync(blindFile)) fs.renameSync(blindFile, path.join(base, "user", `snap_blind.parked-${Date.now()}.json`));
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const wait = async (run) => { for (let i = 0; i < 40; i++) { const s = await call("run_status", { run, wait_s: 5 }); const r = s.runs?.[0]; if (r && ["done", "failed"].includes(r.state)) return r; } return null; };
    const take = (id) => page.evaluate((id) => { const t = window.__T.get(id); return t && JSON.parse(JSON.stringify({ verdict: t.verdict, verdict_by: t.verdict_by, verdict_at: t.verdict_at, verdict_note: t.verdict_note, revive_if: t.revive_if, verdicts_past: t.verdicts_past })); }, id);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const sc = await call("create_scene", { name: "Verdicts" }), sid = sc.scene?.id ?? sc.id ?? sc.scene;
    const shot = (await call("add_shot", { scene: sid, name: "One" })).shot?.id;
    await call("open_shot", { scene: sid, shot }); await page.waitForTimeout(2500);
    await call("set_setting", { brick: "render", name: "prompt", value: "integrated_multimodal_description: [Shot 1] a lantern by a gate" });
    const ids = [];
    for (let i = 0; i < 3; i++) { const r = await call("run", { question: `take ${i + 1} for the verdicts` }); await wait(r.run); ids.push(`take-${r.run}`); }
    await page.waitForTimeout(2000);
    R.ids = ids;
    // n on a focused card: neither
    await page.locator(`.snap-take[data-take="${ids[0]}"]`).focus();
    await page.keyboard.press("n"); await page.waitForTimeout(600);
    R.cardN = await take(ids[0]);
    // the viewer: why + revive, then x
    await page.locator(`.snap-take[data-take="${ids[1]}"]`).click(); await page.waitForTimeout(1200);
    await page.locator(".snap-verdict-why").fill("the gate melts into the wall at 1 s");
    await page.locator(".snap-verdict-revive").fill("the plate gets its gate back");
    await page.locator(".snap-take-sheet").focus().catch(() => {});
    await page.mouse.click(5, 5).catch(() => {});
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press("x"); await page.waitForTimeout(700);
    R.viewerX = await take(ids[1]);
    R.viewerText = await page.locator(".snap-verdicts").textContent();
    await page.screenshot({ path: path.join(out, "verdict_viewer.png") });
    // superseded: keep by the button, then "actually, no" → a misfire
    await page.locator(".snap-verdict.keep").click(); await page.waitForTimeout(600);
    R.superseded = await take(ids[1]);
    await page.locator(".snap-verdict-retract summary").click(); await page.waitForTimeout(200);
    await page.locator(".snap-verdict-retract button", { hasText: "misfire" }).click(); await page.waitForTimeout(700);
    R.retracted = await take(ids[1]);
    R.struck = await page.locator(".snap-verdict-past s").allTextContents();
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    // the button the viewer has writes the same keys as a key press (on take 3, button Reject)
    await page.locator(`.snap-take[data-take="${ids[2]}"]`).click(); await page.waitForTimeout(1000);
    await page.locator(".snap-verdict.reject").click(); await page.waitForTimeout(600);
    R.button = await take(ids[2]);
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);
    // a candidate, a proposal and a parked row with because
    R.cand = await page.evaluate(async (target) => { const d = await window.__C.create({ kind: "g7test", target, title: "two looks" }, [{}, {}]); await window.__C.reject(d.id, "c1", "person", { because: "the lamp floats", revive_if: "a pole is in the plate" }); return window.__C.get(d.id).candidates[0].rejected; }, ids[0]);
    const prop = await call("set_setting", { brick: "render", name: "prompt", value: "a different prompt", propose: true, reason: "try another prompt" });
    R.propReject = await page.evaluate(async (id) => { const out = await window.__P.decide(id, false, async () => {}, { because: "the prompt was right", revive_if: "the plate changes" }); return out; }, prop.proposed);
    R.parkRow = await page.evaluate(async () => { await window.__A.reconcile(); const r = window.__A.all().find((x) => x.zone === "landed" || x.state === "done"); if (!r) return null; await window.__A.park(r.id, true, { because: "seen it" }); return window.__A.get(r.id)?.parked ?? null; });
    // an accepted story proposal says who pressed Accept
    const book = (await call("create_book", { name: "Who", medium: "anime" })).book;
    const beat = await call("add_beat", { book, text: "A lantern goes out by the gate." });
    R.accepted = await page.evaluate(async (id) => (await window.__P.decide(id, true, (n, a) => window.__X.callTool(n, a, { confirmed: true })))?.status ?? null, beat.proposed);
    R.version = await page.evaluate(async (book) => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"), B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); await W.reload(); const st = W.get(B.bookOf(book).body.story); return { note: st.version.note, story: B.bookOf(book).body.story }; }, book);
    const sf = path.join(base, "user", "default", "snap", "story", `${String(R.version.story).replace(/^story:/, "").split("@")[0]}.json`);
    R.version.accepted_by = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf, "utf8")).versions.at(-1).accepted_by ?? null : null;
    R.cemetery = await call("cemetery", {});
    // a blind pair: nothing in the page names its takes until the verdict
    R.setup = await call("setup_ab", { take_a: ids[0], take_b: ids[2] });
    R.pending = await page.evaluate(async () => JSON.stringify(await window.__T.pending()));
    await page.evaluate(() => window.__A.reconcile()); await page.waitForTimeout(800);
    R.row = await page.evaluate(() => { const r = window.__A.all().find((x) => x.source === "blind_pair"); return r ? JSON.stringify(r) : null; });
    await page.locator(".snap-ab-waiting").click(); await page.waitForTimeout(1500);
    R.sheetHtml = await page.locator(".snap-take-sheet[aria-label='A blind pair']").innerHTML();
    R.mediaOk = await page.evaluate(async (pair) => (await fetch(`/mainodes/snap/blind/media?pair=${pair}&side=A`)).status, R.setup.pair);
    await page.screenshot({ path: path.join(out, "blind_pair.png") });
    await page.locator(".snap-take-sheet[aria-label='A blind pair'] .snap-lib-q").fill("A reads the gate better");
    await page.locator(".snap-take-sheet[aria-label='A blind pair'] button", { hasText: "A is better" }).click(); await page.waitForTimeout(1200);
    R.afterPending = await page.evaluate(async () => (await window.__T.pending()).length);
    const day = new Date().toISOString().slice(0, 10), jf = path.join(base, "user", "default", "snap", "judgments", `${day}.json`);
    R.judged = fs.existsSync(jf) ? JSON.parse(fs.readFileSync(jf, "utf8")).filter((x) => x.pair === R.setup.pair) : [];
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
  }
  const S = R, ids = S.ids ?? [], named = (txt) => ids.some((id) => (txt ?? "").includes(id) || (txt ?? "").includes(id.replace(/^take-/, "")));
  const checks = {
    cardKeyNeither: S.cardN?.verdict === "neither" && S.cardN.verdict_by === "person" && !!S.cardN.verdict_at,
    viewerKeyWithWhy: S.viewerX?.verdict === "reject" && S.viewerX.verdict_note === "the gate melts into the wall at 1 s" && S.viewerX.revive_if === "the plate gets its gate back",
    keySameAsButton: JSON.stringify(Object.keys(S.button ?? {}).filter((k) => S.button[k] != null).sort()) === JSON.stringify(["verdict", "verdict_at", "verdict_by"]) && S.button.verdict === "reject" && S.cardN?.verdict_by === S.button.verdict_by,
    supersededKept: S.superseded?.verdict === "keep" && S.superseded.verdicts_past?.[0]?.verdict === "reject" && S.superseded.verdicts_past[0].retracted?.reason === "superseded" && S.superseded.verdicts_past[0].because === "the gate melts into the wall at 1 s",
    retractMisfire: S.retracted?.verdict == null && S.retracted.verdicts_past?.length === 2 && S.retracted.verdicts_past[1].retracted?.reason === "misfire",
    struckThrough: S.struck?.length === 2 && S.struck.some((x) => /^reject: the gate melts/.test(x)),
    candidateBecause: S.cand?.because === "the lamp floats" && S.cand.revive_if === "a pole is in the plate",
    proposalBecause: S.propReject?.status === "rejected" && S.propReject.because === "the prompt was right" && S.propReject.answered_by?.by === "person",
    parkBecause: S.parkRow?.because === "seen it" && !!S.parkRow.at,
    acceptedBy: S.accepted === "accepted" && / by the person on a person's tab$/.test(S.version?.note ?? "") && S.version?.accepted_by?.by === "person",
    cemeteryLists: S.cemetery?.takes?.some((x) => x.take === ids[0] && x.verdict === "neither") && S.cemetery.takes.some((x) => x.take === ids[1] && x.retracted?.length === 2) && S.cemetery.candidates?.some((x) => x.because === "the lamp floats") && S.cemetery.proposals?.some((x) => x.because === "the prompt was right") && S.cemetery.parked?.some((x) => x.because === "seen it"),
    blindNoIds: !!S.setup?.pair && !named(S.pending) && !named(S.row) && !/take \d/.test(JSON.parse(S.row ?? "{}").title ?? "x"),
    blindSheetNoIds: !!S.sheetHtml && !named(S.sheetHtml) && /blind\/media\?pair=/.test(S.sheetHtml) && S.mediaOk === 200,
    blindJudged: S.afterPending === 0 && S.judged?.length === 1 && [ids[0], ids[2]].includes(S.judged[0].winner) && S.judged[0].why === "A reads the gate better" && S.judged[0].blind === true,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g7_verdicts_result.json"), JSON.stringify(R, null, 1));
  console.log(`g7verdicts ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
