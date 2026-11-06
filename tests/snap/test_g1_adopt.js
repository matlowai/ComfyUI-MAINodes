// G1 / short03 F-C25: a finished job whose queuing page closed while it ran still lands as a take. Page A queues a slow
// Snap job (a few seconds of resizes, stamped like any run) and closes before it finishes; once it has finished, pages B
// and C open: one of them writes the take (POST /mainodes/snap/adopt lets exactly one claim it), both list it once, and
// the Work card shows it landed with its take.
// usage: node test_g1_adopt.js [port 8194]     BEFORE=b600297 node test_g1_adopt.js 8194
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port, { slow: 12 }); // a few seconds on the CPU server: a longer job runs on into the next suites
    R.queued = await A.page.evaluate(async () => {
      const K = window.__K, E = window.__E;
      return K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 0 } }, s: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "snaptest/g1adopt" } } },
        { group: app.graph.id, job: { kind: "run", title: "G1 adopt check", about: {}, by: "agent" } });
    });
    await A.page.waitForTimeout(800);
    await A.ctx.close(); // the queuing page closes while the job runs
    await F.idle(port);
    R.history = (await F.history(port, R.queued))?.status?.status_str ?? null;
    const B = await F.open(b, port), C = await F.open(b, port);
    const count = (P) => P.page.evaluate(async (id) => { await window.__T.reload(); return window.__T.all().filter((t) => t.prompt_id === id).length; }, R.queued);
    for (let i = 0; i < 40; i++) { if ((await count(B)) >= 1 && (await count(C)) >= 1) break; await B.page.waitForTimeout(500); }
    R.takesB = await count(B); R.takesC = await count(C);
    R.files = await B.page.evaluate(async (id) => (await (await fetch(`/userdata?dir=snap/takes`)).json()).filter((f) => f.includes(id)).length, R.queued);
    R.work = await B.page.evaluate(async (id) => { const row = (await window.__X.callTool("list_activity", {})).rows.find((x) => x.id === id); return row && { state: row.state, result: row.result }; }, R.queued);
    R.errors = [...B.errors, ...C.errors];
  } finally { await b.close(); }
  const checks = {
    "the job finished after its page closed": R.history === "success",
    "the take landed once, seen by both open pages": R.takesB === 1 && R.takesC === 1 && R.files === 1,
    "the Work card shows it landed with its take": R.work?.state === "done" && R.work.result?.take === `take-${R.queued}`,
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g1adopt ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
