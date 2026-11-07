// Batch F (the operator 2026-11-05: "you should be able to easily select which web ui instance you want to interact with and
// not collide"). Agent pages A and B (headless) and a person's tab P (control off) are open on the CPU server:
// - list_pages names every page (whose, the id's start, the tab it shows) with its id;
// - agent alpha binds to A with use_page (an id's first six characters): its calls go to A, and A's top bar says
//   "Driven by: alpha";
// - agent beta can't take A (use_page or X-Snap-Page): the error names alpha; with P open and its control off, beta's
//   unbound calls are refused (G1, SNAP-R83: never a headless page instead of the person's tab);
// - the person presses Release on A: alpha's next call says so (never a silent switch), the one after is refused too;
// - snapcall: SNAP_AGENT=gamma --page <B> binds, a later call without --page stays on B; `pages` lists the pages;
// - snap_agent_page.sh never opens a page by itself: `new` without the person's yes (--asked) is refused.
// Screen 420 (Driven by + Release). usage: node test_f9_pages.js [port 8195]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const path = require("path"), { execFileSync, execFile } = require("child_process");
const port = process.argv[2] || CFG.port, base = `http://127.0.0.1:${port}`, R = {}, out = path.join(CFG.out, "ui");
const PACK = path.join(CFG.pack, "tools");
const UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const call = async (agent, tool, args = {}, page) => { const r = await fetch(`${base}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snap-Agent": agent, ...(page ? { "X-Snap-Page": page } : {}) }, body: JSON.stringify({ tool, args }) }); return { status: r.status, ...(await r.json()) }; };
// async: Playwright's route handlers answer the pages' requests from this process, so a blocking call would stall them
const snapcall = (env, ...args) => new Promise((done) => execFile("python3", [`${PACK}/snapcall.py`, port, ...args], { env: { ...process.env, ...env }, timeout: 90000 }, (e, out, err) => done(e ? `exit ${e.code}: ${out}${err}` : out)));
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const open = async (ua) => { const p = await (await b.newContext({ viewport: { width: 1400, height: 900 }, ...(ua ? { userAgent: ua } : {}) })).newPage(); await p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    await p.goto(`${base}/?snap`); await p.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await p.waitForTimeout(3000); await p.keyboard.press("Escape");
    return { p, id: await p.evaluate(() => sessionStorage.getItem("clientId")) }; };
  const P = await open(UA), A = await open(), B = await open();
  const listed = await call("alpha", "list_pages");
  R.list = (listed.result?.pages ?? []).map((x) => ({ me: x.id === A.id ? "A" : x.id === B.id ? "B" : x.id === P.id ? "P" : "?", name: x.name, headless: x.headless }));
  R.bind = await call("alpha", "use_page", { page: A.id.slice(0, 6) });
  R.alphaGoes = (await call("alpha", "read_ui")).page?.id === A.id;
  await A.p.waitForTimeout(600);
  R.chip = await A.p.textContent(".snap-driver").catch(() => null);
  await A.p.screenshot({ path: path.join(out, "420-f-driven-by.png"), clip: { x: 0, y: 0, width: 1400, height: 60 } });
  R.betaTakes = await call("beta", "use_page", { page: A.id });
  R.betaTargets = await call("beta", "new_seed", {}, A.id); // a write: reads answer on a driven page for anyone (SNAP-R219)
  R.betaDefault = (await call("beta", "read_ui")).status === 503;
  await A.p.click(".snap-driver button"); await A.p.waitForTimeout(800);
  R.chipAfter = await A.p.evaluate(() => document.querySelector(".snap-driver")?.hidden);
  R.afterRelease = await call("alpha", "read_ui");
  R.afterThat = (await call("alpha", "read_ui")).page?.id ?? null;
  R.gammaBind = await snapcall({ SNAP_AGENT: "gamma" }, "--page", B.id, "read_ui");
  R.gammaStays = await snapcall({ SNAP_AGENT: "gamma" }, "read_ui");
  R.pagesCli = await snapcall({}, "pages");
  await A.p.context().close(); await B.p.context().close(); await P.p.waitForTimeout(1500);
  R.launch = (() => { try { return execFileSync("bash", [`${PACK}/snap_agent_page.sh`, port, "new"], { timeout: 120000 }).toString(); } catch (e) { return `exit ${e.status}: ${e.stdout}${e.stderr}`; } })();
  await b.close();
  const checks = {
    "list_pages names each page with whose it is, the id's start and its tab": R.list.filter((x) => x.me !== "?").length === 3 && R.list.every((x) => x.me === "?" || (x.name.includes(x.me === "P" ? P.id.slice(0, 6) : x.me === "A" ? A.id.slice(0, 6) : B.id.slice(0, 6)) && / · /.test(x.name))),
    "use_page binds alpha to A and its calls go there": !R.bind.error && R.alphaGoes,
    "A's top bar says who drives it, with Release": /Driven by: alpha/.test(R.chip ?? "") && /Release/.test(R.chip ?? ""),
    "beta can't take A: the error names alpha": R.betaTakes.status === 409 && /driven by alpha/.test(R.betaTakes.error ?? "") && R.betaTargets.status === 409 && /driven by alpha/.test(R.betaTargets.error ?? ""),
    "with the person's tab open (control off), beta's unbound calls are refused": R.betaDefault,
    "after Release, alpha hears it once, then is refused like any unbound call": R.chipAfter === true && R.afterRelease.status === 409 && /Release/.test(R.afterRelease.error ?? "") && R.afterThat === null,
    "snapcall --page binds, and the binding sticks without --page": R.gammaBind.includes(B.id) && R.gammaStays.includes(B.id),
    "snapcall pages lists the pages": /"pages"/.test(R.pagesCli) && /"name"/.test(R.pagesCli),
    "snap_agent_page.sh opens no other tab without the person's yes": /^exit 1: /.test(R.launch) && /--asked/.test(R.launch),
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`f9pages  ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
