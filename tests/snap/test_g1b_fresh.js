// G1b, dogfood F-D01 (SNAP-R116) on the CPU test server: a page loaded before another writer saved records sees them
// without a reload.
// - a person note written through /mainodes/snap/world/save by a script while the page is open: `instructions` on that
//   page right after (no reload) lists it, count one more; the page says "<note> updated by <writer>" (the server's
//   snap_world event);
// - a Cast saved by another writer is in the page's records (list_cast) without a tool having to ask first;
// - a record file changed by hand (no route, no event): the next tool call reads it (the /world/rev fingerprint);
// - the page's own save raises no "updated by" toast.
// usage: node test_g1b_fresh.js [port 8195] [base dir]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
const base = process.argv[3] || CFG.base;
const save = async (q) => (await fetch(`http://127.0.0.1:${port}/mainodes/snap/world/save`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(q) })).json();
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const toasts = () => page.evaluate(() => [...document.querySelectorAll(".snap-toast, .snap-say, [role=status]")].map((x) => x.textContent).filter((t) => /updated by/.test(t)));
    R.before = await call("instructions", {});
    const id = `g1b-fresh-${Date.now()}`;
    R.saved = await save({ kind: "instruction", id, body: { scope: "global", kind: "note", text: "G1b fresh: a note a script wrote while the page was open." }, by: "script:seed", note: "F-D01 test" });
    R.after = await call("instructions", {});
    R.hasNote = (R.after?.stack ?? []).some((r) => r.ref?.startsWith(`instruction:${id}`));
    await page.waitForTimeout(800);
    R.toasts = await toasts();
    // a Cast from another writer: in the page's records by the event alone
    const cast = `cast-g1b-fresh-${Date.now()}`;
    await save({ kind: "cast", id: cast, body: { name: "G1b Fresh", refs: [], lora: null }, by: "agent:other-page" });
    await page.waitForTimeout(1500);
    R.castInPage = await page.evaluate((c) => window.__W?.record("cast", c) != null || null, cast);
    if (R.castInPage === null) R.castInPage = await page.evaluate(async (c) => (await import("/extensions/ComfyUI-MAINodes/snap/world.js")).record("cast", c) != null, cast);
    // a hand edit: no route, no event; the next tool call reads it
    const file = path.join(base, "user", "default", "snap", "cast", `${cast}.json`), rec = JSON.parse(fs.readFileSync(file, "utf8"));
    rec.versions[0].body.name = "G1b Fresh, edited by hand"; fs.writeFileSync(file, JSON.stringify(rec));
    R.listed = (await call("list_cast", {}));
    R.handEdit = JSON.stringify(R.listed).includes("G1b Fresh, edited by hand");
    // the page's own save: no "updated by"
    await page.waitForTimeout(2800); // the earlier toast goes
    await call("save_instruction", { text: "G1b fresh: the page's own note.", scope: "global" });
    await page.waitForTimeout(800);
    R.ownToasts = (await toasts()).length;
    const checks = {
      "a note a script saved while the page was open is in `instructions` without a reload": R.hasNote && R.after?.count === (R.before?.count ?? 0) + 1,
      "the page says who wrote it": R.toasts?.some((t) => /^Note "G1b fresh: a note a script wrote while the page was open\." updated by script:seed$/.test(t)),
      "another writer's Cast is in the page's records without a tool asking": R.castInPage === true,
      "a hand edit of a record file is read at the next tool call": R.handEdit,
      "the page's own save raises no 'updated by'": R.ownToasts === 0,
      "no page errors": !A.errors.length,
    };
    console.log(JSON.stringify(R, null, 1));
    let bad = 0;
    for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
    console.log(`g1bfresh ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
