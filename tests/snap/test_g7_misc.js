// Batch G7, small ones on the CPU test server:
// - SNAP-R177 dry_run on the Book's writes: add_change, add_beat, save_style and save_cast_state answer the would-be
//   diff (and a story edit its reversal cost) and write nothing: no proposal, no version, the world rev unchanged;
// - F-L13 chrome {action: reload, page} resolves a page id start or name as use_page does, and says "No Snap page
//   matched" for one that matches nothing (never `reloaded: []` after reloading nothing);
// - F-L18 list_critiques {take} finds a take's rows by a unique start of its id.
// usage: node test_g7_misc.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
const base = process.argv[3] || CFG.base;
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
const bridge = async (tool, args, page) => { const r = await fetch(`http://127.0.0.1:${port}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snap-Agent": "g7-misc" }, body: JSON.stringify({ tool, args, ...(page ? { page } : {}) }) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "critiques", "proposals.json"]) park(d); // moved, never deleted
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const rev = async () => (await (await fetch(`http://127.0.0.1:${port}/mainodes/snap/world/rev`)).json());
    const proposals = async () => (await (await fetch(`http://127.0.0.1:${port}/mainodes/snap/proposals`)).json()).rows.length;
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const aya = (await call("save_cast", { name: "Aya", details: "young woman, green apron" })).cast;
    const book = (await call("create_book", { name: "Dry", medium: "anime", cast: [aya] })).book;
    await page.evaluate(async ([book]) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body); await B.saveStory(st.id, { title: "Dry", beats: [{ id: "b1", text: "Aya stirs the pot." }] }, { note: "by the person" }); }, [book]);
    await call("save_style", { book, name: "Ink", paragraph: "Flat ink, two tones." }); // the first style goes in directly
    await page.waitForTimeout(500);
    const before = { rev: await rev(), proposals: await proposals() };
    R.dryChange = await call("add_change", { book, beat: "b1", entity: aya, path: "carried.right_hand", op: "set", value: "prop:ladle", dry_run: true });
    R.dryBeat = await call("add_beat", { book, text: "Aya sets the bowl down.", dry_run: true });
    R.dryStyle = await call("save_style", { book, name: "Ink", paragraph: "Thick ink, three tones.", dry_run: true });
    R.dryState = await call("save_cast_state", { cast: aya, state: "apron off", covers: { wardrobe: "no apron" }, dry_run: true });
    R.after = { rev: await rev(), proposals: await proposals() };
    R.before = before;
    R.real = await call("add_change", { book, beat: "b1", entity: aya, path: "carried.right_hand", op: "set", value: "prop:ladle" });
    // F-L13: chrome reload with a page that matches nothing, and with this page's id start
    const pid = await page.evaluate(async () => (await import("/scripts/api.js")).api.clientId);
    R.noMatch = await bridge("chrome", { action: "reload", page: "zzzz-no-such-page" });
    R.idStart = await bridge("chrome", { action: "reload", page: pid.slice(0, 8) });
    // F-L18: a take lands, its critique row is due; list it by a start of its id
    await call("start_recipe", {}); await page.waitForTimeout(2000);
    const run = await call("run", { question: "a take for the critic" });
    for (let i = 0; i < 40; i++) { const s = await call("run_status", { run: run.run, wait_s: 5 }); if (["done", "failed"].includes(s.runs?.[0]?.state)) break; }
    await page.waitForTimeout(3000);
    const take = `take-${run.run}`;
    R.byFull = await call("list_critiques", { take });
    R.byStart = await call("list_critiques", { take: take.slice(0, 13) });
    R.take = take;
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
  }
  const S = R;
  const checks = {
    dryChange: S.dryChange?.dry_run === true && S.dryChange.diff?.some((x) => /^b1 change \+ c1 .*carried\.right_hand set "prop:ladle"/.test(x)) && !!S.dryChange.reversal_cost && !S.dryChange.proposed,
    dryBeat: S.dryBeat?.dry_run === true && S.dryBeat.diff?.some((x) => /^b2 added: "Aya sets the bowl down\."/.test(x)) && /add beat "Aya sets the bowl down\."/.test(S.dryBeat.title ?? ""),
    dryStyle: S.dryStyle?.dry_run === true && S.dryStyle.canon === true && JSON.stringify(S.dryStyle.diff ?? []).includes("Thick ink, three tones."),
    dryState: S.dryState?.dry_run === true && S.dryState.would?.covers?.wardrobe === "no apron" && /saves Aya v2/.test(S.dryState.said ?? ""),
    wroteNothing: JSON.stringify(S.before?.rev) === JSON.stringify(S.after?.rev) && S.before?.proposals === S.after?.proposals,
    realStillProposes: !!S.real?.proposed,
    chromeNoMatch: S.noMatch?.status === 404 && /No Snap page matched 'zzzz-no-such-page'.*nothing was reloaded/.test(JSON.stringify(S.noMatch.body)),
    chromeIdStart: !/No Snap page matched/.test(JSON.stringify(S.idStart?.body ?? {})),
    critiqueByStart: (S.byFull?.rows?.length ?? 0) >= 1 && S.byStart?.rows?.length === S.byFull.rows.length && S.byStart.rows[0].critique === S.byFull.rows[0].critique,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g7_misc_result.json"), JSON.stringify(R, null, 1));
  console.log(`g7misc ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
