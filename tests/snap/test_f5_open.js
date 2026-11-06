// Batch F commit 5 (SNAP-R66): arrivals announce, only a press moves. Page A sits in a scene shot with take A (CPU
// prompts, fwork.js):
// - an edit decision on take A whose candidates wait for their identity notes, viewer closed: nothing is said while it
//   checks; when the notes arrive the toast says the candidates are ready, nothing opens by itself, and Open lands on
//   take A's viewer at that decision's candidates (batch E: notes arrived with no notice);
// - page B (another browser context) runs in its own tab: A says it started elsewhere and, when it lands, "take N is in";
// - A in the graph view: B's next run lands as a ComfyUI toast;
// - a refusal at queue is a failed Work row with the reason and Retry, not only a toast;
// - the Re-run sheet of a take in no scene says "Scene: none (this take isn't in a scene)".
// Screens 406 (arrival toast with Open), 407 (viewer at the candidates), 408 (graph-view toast).
// usage: node test_f5_open.js [port 8195]     BEFORE=a166e40 node test_f5_open.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui");
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const A = await F.open(b, port, { slow: 6 }), B = await F.open(b, port, { slow: 6 });
  const ev = (p, fn, arg) => p.page.evaluate(fn, arg);
  await A.page.waitForTimeout(2500);
  R.onLoad = await A.page.evaluate(() => { const t = document.querySelector(".snap-toast"); return t?.classList.contains("show") ? t.textContent : null; }); // earlier suites' history is on this server
  const toast = (p) => p.page.evaluate(() => { const t = document.querySelector(".snap-toast"); return t?.classList.contains("show") ? { text: t.querySelector("span")?.textContent ?? t.textContent, button: t.querySelector("button")?.textContent ?? null } : null; });
  await ev(A, async () => { const SC = window.__SC; await window.__T.load(); await SC.load(); const s = await SC.create({ name: "Arrivals" }); await SC.addShot(s.id, { name: "porch" }); await SC.openShot(s.id, SC.get(s.id).shots[0].id); });
  R.a = await ev(A, () => window.__J.queueRun({ kind: "run", title: "take A", about: window.__J.here() }, () => app.queuePrompt(0, 1)));
  await F.idle(port); await A.page.waitForFunction((id) => window.__T.get(`take-${id}`), R.a, { timeout: 30000 }).catch(() => {});
  const take = `take-${R.a}`;
  // an edit decision checking its candidates, then the notes arrive
  R.decision = await ev(A, async (take) => (await window.__C.create({ kind: "edit", target: take, title: "Change something (a lantern glow) of take A", take }, [{}, {}])).id, take);
  await A.page.waitForTimeout(1500);
  R.whileChecking = { state: await ev(A, (d) => window.__A.get(d)?.state, R.decision), toast: await toast(A) };
  await ev(A, async (d) => { const C = window.__C, x = C.get(d); for (const c of x.candidates) await C.note(x, c, "identity", { scores: [] }); }, R.decision);
  await A.page.waitForFunction(() => /ready to pick/.test(document.querySelector(".snap-toast.show span")?.textContent ?? ""), null, { timeout: 8000 }).catch(() => {});
  R.arrival = await toast(A);
  R.viewerBefore = await ev(A, () => !!document.querySelector(".snap-take-sheet"));
  await A.page.screenshot({ path: path.join(out, "406-f-arrival-toast.png") });
  await A.page.click(".snap-toast .snap-toast-act").catch((e) => { R.clickErr = e.message; });
  await A.page.waitForTimeout(1200);
  R.opened = await ev(A, ([take, d]) => ({ viewer: !!document.getElementById(`snap-viewer-${take}`), cands: !!document.getElementById(`snap-decision-${d}`) }), [take, R.decision]);
  await A.page.screenshot({ path: path.join(out, "407-f-open-candidates.png") });
  await A.page.keyboard.press("Escape");
  await ev(A, () => { window.__arrivals = []; window.__A.onArrive((w, r) => window.__arrivals.push([w, r.title ?? r.count, r.state, Date.now()])); });
  // page B runs in its own tab
  R.b = await ev(B, () => window.__J.queueRun({ kind: "run", title: "a run from another tab", about: window.__J.here() }, () => app.queuePrompt(0, 1)));
  R.started = await A.page.waitForFunction(() => { const t = document.querySelector(".snap-toast.show span")?.textContent ?? ""; return /elsewhere|agent queued/.test(t) && t; }, null, { timeout: 8000 }).then((x) => x.jsonValue(), () => null);
  R.landed = await A.page.waitForFunction(() => { const t = document.querySelector(".snap-toast.show span")?.textContent ?? ""; return /a run from another tab: take \d+ is in/.test(t) && t; }, null, { timeout: 30000 }).then((x) => x.jsonValue(), () => null);
  // A in the graph view, B runs again
  await A.page.click('.snap-seg button:has-text("Graph")').catch((e) => { R.graphErr = e.message; });
  await A.page.waitForTimeout(500);
  await ev(B, () => window.__J.queueRun({ kind: "run", title: "landing while you are in the graph", about: window.__J.here() }, () => app.queuePrompt(0, 1)));
  R.graphToast = await A.page.waitForFunction(() => [...document.querySelectorAll("ol > li")].map((x) => x.textContent).find((t) => /landing while you are in the graph/.test(t)), null, { timeout: 30000 }).then((x) => x.jsonValue(), () => null);
  await A.page.screenshot({ path: path.join(out, "408-f-graph-toast.png") });
  await A.page.click('button:has-text("Snap")').catch(() => {});
  R.arrivals = await ev(A, () => window.__arrivals);
  // a refusal at queue
  R.refused = await ev(A, async () => { try { await window.__K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 8, height: 8, batch_size: 1, color: 0 } } }, { job: { kind: "check", title: "a check the server refuses [refuse]", takes: false } }); return "queued"; } catch (e) { await new Promise((r) => setTimeout(r, 500)); const row = window.__A.all().find((r) => r.source === "refusal" && /\[refuse\]/.test(r.title)); return row ? { state: row.state, zone: row.zone, error: row.error, retry: typeof row.retry === "function" } : `no row: ${e.message}`; } });
  // the Re-run sheet of B's take (no scene)
  R.sceneLabel = await ev(A, async (id) => { const T = window.__T; await T.reload(); const t = T.get(`take-${id}`); if (!t) return "no take"; const { openRerunSheet } = await import("/extensions/ComfyUI-MAINodes/snap/rerunsheet.js");
    await openRerunSheet(document.querySelector(".snap-root"), { take: t, say: () => {} }); await new Promise((r) => setTimeout(r, 800)); return [...document.querySelectorAll(".snap-rerun-sheet .snap-world-row strong")].map((x) => x.textContent).find((x) => x.startsWith("Scene:")) ?? "no scene row"; }, R.b);
  const checks = {
    "a page that loads says nothing about the history it finds": !/is in|ready to pick|failed/.test(R.onLoad ?? ""),
    "nothing is said while the candidates are checked": R.whileChecking.state === "checking" && !/ready/.test(R.whileChecking.toast?.text ?? ""),
    "when the notes arrive the toast says ready, with Open": /2 candidates ready to pick/.test(R.arrival?.text ?? "") && R.arrival.button === "Open",
    "nothing opened by itself": R.viewerBefore === false,
    "Open lands on the take's viewer at the candidates": R.opened.viewer && R.opened.cands,
    "a run from another tab is said when it starts (its landing may replace the toast at once)": !!R.started || (R.arrivals ?? []).some(([w, t]) => w === "start" && t === "a run from another tab"),
    "and when it lands, with its take": !!R.landed,
    "in the graph view a ComfyUI toast says it": !!R.graphToast,
    "a refusal at queue is a failed Work row with the reason and Retry": R.refused?.state === "failed" && R.refused.zone === "in_flight" && /refused at queue/.test(R.refused.error) && R.refused.retry,
    "a take in no scene reads 'Scene: none'": /^Scene: none/.test(R.sceneLabel ?? ""),
    "no toast ends in a stray \"null\"": !/null$/.test(R.arrival?.text ?? "") && !/null/.test(R.onLoad ?? ""),
    "no page errors": !A.errors.length && !B.errors.length,
  };
  console.log(JSON.stringify({ R, errors: [A.errors, B.errors] }, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`f5open   ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  await b.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
