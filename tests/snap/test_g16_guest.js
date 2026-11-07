// Batch G16 S5 + S11, on the CPU test server, through the bridge as two named agents on one page:
// - SNAP-R219: "studio" drives the page (use_page); "astrid-x" (not bound) reads there all the same (list_proposals,
//   describe_recipe, get_book answer); a write from it is refused, naming the driver and saying reads and proposals
//   work; a proposal from it (propose: true) is made and records by agent:astrid-x and driven_by studio apart, while
//   studio's own records by agent:studio and no driven_by; the guest's calls don't count as the driver's;
// - SNAP-R228: astrid-x withdraws its own waiting proposal with its words (status withdrawn, by it, list_proposals shows
//   it, the Room drops it); it can't withdraw studio's; nobody withdraws an answered one; because is required.
// usage: node test_g16_guest.js [port] [base]   prints "g16guest n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g16guest-${Date.now()}`)); } };
// one bridge call as a named agent (async fetch: the page answers through this process's routes)
const bridge = async (agent, tool, args = {}, page = null) => { const r = await fetch(`http://127.0.0.1:${port}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snap-Agent": agent, ...(page ? { "X-Snap-Page": page } : {}) }, body: JSON.stringify({ tool, args }) }); return { status: r.status, ...(await r.json()) }; };
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "production", "proposals.json"]) park(d); // moved, never deleted
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const client = await page.evaluate(async () => (await import("/scripts/api.js")).api.clientId);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const book = (await page.evaluate(() => window.__X.callTool("create_book", { name: "G16 Guest" }))).book;
    R.bind = await bridge("studio", "use_page", { page: client });
    const idleBefore = (await bridge("studio", "list_pages")).result.pages.find((p) => p.id === client)?.driver_idle_s;
    R.read1 = await bridge("astrid-x", "list_proposals", {}, client);
    R.read2 = await bridge("astrid-x", "describe_recipe", {}, client);
    R.read3 = await bridge("astrid-x", "get_book", { book }, client);
    R.write = await bridge("astrid-x", "save_cast", { name: "Guest Cast" }, client);
    R.proposeGuest = await bridge("astrid-x", "save_cast", { name: "Guest Cast", propose: true, reason: "a Cast for the re-take" }, client);
    R.proposeOwn = await bridge("studio", "save_cast", { name: "Studio Cast", propose: true, reason: "studio's own" });
    R.list = (await bridge("astrid-x", "list_proposals", {}, client)).result;
    const mine = R.proposeGuest.result?.proposed, theirs = R.proposeOwn.result?.proposed;
    R.notMine = await bridge("astrid-x", "withdraw_proposal", { id: theirs, because: "tidy" }, client);
    R.noWhy = await bridge("astrid-x", "withdraw_proposal", { id: mine, because: " " }, client);
    R.withdraw = await bridge("astrid-x", "withdraw_proposal", { id: mine, because: "out of date: the re-take was made another way" }, client);
    R.again = await bridge("astrid-x", "withdraw_proposal", { id: mine, because: "again" }, client);
    R.after = (await bridge("studio", "list_proposals")).result;
    await page.evaluate(async () => { const R = await import("/extensions/ComfyUI-MAINodes/snap/room.js"); await R.openRoom({ say: () => {} }); });
    await page.waitForTimeout(1200);
    R.room = await page.evaluate(() => document.querySelector(".snap-room")?.textContent ?? "");
    R.idleAfter = (await bridge("studio", "list_pages")).result.pages.find((p) => p.id === client);
    R.idleBefore = idleBefore;
    R.release = await bridge("studio", "use_page", { page: null });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, row = (id) => (S.list ?? []).find((p) => p.id === id), after = (id) => (S.after ?? []).find((p) => p.id === id);
  const g = S.proposeGuest?.result?.proposed, o = S.proposeOwn?.result?.proposed;
  const checks = {
    "studio drives the page": S.bind?.status === 200 && /studio now drives/.test(S.bind.result?.said ?? ""),
    "R219 another agent's reads answer on the driven page": [S.read1, S.read2, S.read3].every((r) => r?.status === 200 && r.result && !r.error) && S.read3.result.name === "G16 Guest",
    "R219 a write from it is refused, naming the driver and saying reads and proposals work": S.write?.status === 409 && /driven by studio/.test(S.write.error) && /reads \(tools marked read-only\) and proposals \(propose: true\) work here/.test(S.write.error),
    "R219 its proposal is made and records by and driven_by apart": S.proposeGuest?.status === 200 && !!g && row(g)?.by === "agent:astrid-x" && row(g)?.driven_by === "studio",
    "the driver's own proposal records by agent:studio and no driven_by": !!o && row(o)?.by === "agent:studio" && !row(o)?.driven_by,
    "the guest's calls don't count as the driver's (its page stays driven by studio)": S.idleAfter?.driven_by === "studio",
    "R228 an agent can't withdraw another agent's proposal": !!S.notMine?.error && /made by agent:studio, not agent:astrid-x/.test(S.notMine.error) && after(o)?.status === "waiting",
    "R228 withdrawing says why": /says why in because/.test(S.noWhy?.error ?? ""),
    "R228 its own waiting proposal is withdrawn, by it, with its words, and list_proposals shows it": S.withdraw?.result?.status === "withdrawn" && after(g)?.status === "withdrawn" && /withdrawn by agent:astrid-x: out of date/.test(after(g)?.result ?? ""),
    "R228 an answered one can't be withdrawn again": /is withdrawn already/.test(S.again?.error ?? ""),
    "the Room drops the withdrawn one and keeps the waiting one": /studio's own/.test(S.room ?? "") && !/a Cast for the re-take/.test(S.room ?? ""),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify(R, null, 1));
  console.log(`g16guest ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
