// Batch G17a, a shot has one tab (SNAP-R235, F-SQ18), on the CPU test server: the bake-off's sequence that overwrote
// Shot 5's Pika recipe with a stale MOSS tab, as an agent ran it:
// - shot A opens and switches to a MOSS recipe card; shot B opens from A's setup (MOSS); apply_setup "Pika H3 Flex" on B
//   moves B into a new tab, and the answer says the earlier tab is scratch now; list_tabs shows exactly one tab
//   claiming B, and the old one renamed "was …";
// - open_shot A, then B: the tab shown is B's Pika tab (its marker prompt), never the stale MOSS one;
// - open_shot A again: B's saved workflow still holds the Pika recipe and the marker, no MOSS node;
// - the old shape seeded by hand (the released MOSS tab marked as B again, older than B's real tab): open_shot B opens
//   the tab holding B's saved workflow and says two tabs claimed it; saving from the stale tab is refused, the tab
//   becomes scratch, and B's file is unchanged;
// - retake {open_only: true} restores a shot's recipe from one of its takes with nothing queued (SNAP-R234), and is
//   not a proposal even with "Let agents run" off.
// usage: node test_g17_shots.js [port] [base]   prints "g17shots n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const out = path.join(CFG.out, "ui", "g17a"); fs.mkdirSync(out, { recursive: true });
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g17shots-${Date.now()}`)); } };
const savedOf = (scene, shot) => { try { return JSON.parse(fs.readFileSync(path.join(base, "user", "default", "snap", "scenes", scene, `${shot}.json`), "utf8")); } catch { return null; } };
const mossIn = (g) => (g?.nodes ?? []).some((n) => /MOSS|Moss/.test(n.type ?? "")) || JSON.stringify(g?.extra?.snap?.family ?? "").includes("MOSS");
(async () => {
  for (const d of ["scenes", "takes", "proposals.json"]) park(d); // moved, never deleted
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const prompt = () => page.evaluate(() => window.__E.getValue("render", "render", "prompt") ?? window.__E.getValue("image", "image", "prompt"));
    const claims = (shot) => page.evaluate((s) => { const t = app.extensionManager.workflow; return t.openWorkflows.filter((w) => (w === t.activeWorkflow ? app.graph.extra : w.activeState?.extra)?.snap_scene?.shot === s).map((w) => w.path); }, shot);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const sc = await call("create_scene", { name: "G17 shots" }), scene = sc.scene ?? sc.id;
    const a = (await call("add_shot", { scene, name: "stills" })).shot, shotA = a.id ?? a;
    R.openA = await call("open_shot", { scene, shot: shotA });
    const moss = (await call("list_setups", {})).find((x) => x.family === "MOSS-Image" && x.source === "recipe" && !/^Last used/.test(x.name));
    R.toMoss = await call("apply_setup", { name: moss.name });
    await page.waitForTimeout(1200);
    const bb = (await call("add_shot", { scene, name: "clash" })).shot, shotB = bb.id ?? bb;
    R.openB = await call("open_shot", { scene, shot: shotB });
    R.bFamily = await page.evaluate(() => window.__E.state().family ?? null);
    R.toPika = await call("apply_setup", { name: "Pika H3 Flex" });
    await page.waitForTimeout(1500);
    await call("set_setting", { brick: "render", name: "prompt", value: "PIKA-B the beam meets the palm" });
    R.tabs = await call("list_tabs", {});
    R.claimsB = await claims(shotB);
    // browse away and back, as the bake-off agent did
    R.backA = await call("open_shot", { scene, shot: shotA });
    R.backB = await call("open_shot", { scene, shot: shotB });
    R.promptB = await prompt();
    await page.screenshot({ path: path.join(out, "g17_one_tab_per_shot.png") });
    R.againA = await call("open_shot", { scene, shot: shotA });
    R.savedB1 = savedOf(scene, shotB);
    // the old shape: B open in its tab, a scratch tab in front, and the released MOSS tab (older than B's) marked as B
    // again, as a page before this rule left it
    await call("open_shot", { scene, shot: shotB });
    R.scratch = await call("start_recipe", {});
    R.seeded = await page.evaluate((mark) => { const t = app.extensionManager.workflow, w = t.openWorkflows.find((x) => /^workflows\/was .*clash/.test(x.path)); if (!w) return null; w.changeTracker.activeState.extra = { ...w.changeTracker.activeState.extra, snap_scene: mark }; return { path: w.path, id: w.activeState.id, order: t.openWorkflows.indexOf(w) }; }, { scene, shot: shotB });
    R.twoB = await call("open_shot", { scene, shot: shotB });
    R.promptTwoB = await prompt();
    // the stale tab, made active by hand, never saves over B
    R.stale = await page.evaluate(async (p) => { const t = app.extensionManager.workflow, w = t.openWorkflows.find((x) => x.path === p);
      for (let i = 0; i < 12 && t.activeWorkflow !== w; i++) await app.extensionManager.command.execute("Workspace.NextOpenedWorkflow");
      if (t.activeWorkflow !== w) return { active: false };
      const SC = window.__SC, r = await SC.saveOpen(); return { active: true, refused: r?.refused ?? null, markAfter: app.graph.extra?.snap_scene ?? null }; }, R.seeded?.path);
    R.savedB2 = savedOf(scene, shotB);
    // restore a shot's recipe from its take, nothing queued, never a proposal
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); });
    await page.evaluate(async ({ scene, shot }) => { const SC = window.__SC; await SC.load(); const s = SC.get(scene).shots.find((x) => x.id === shot); const g = await (await fetch(`/api/userdata/${encodeURIComponent(s.workflow)}`)).json();
      await window.__T.save({ id: "take-g17s1", kind: "run", prompt_id: "g17s1", created: Date.now(), seconds: 30, group: g.id, number: 1, status: "success", text: "g17", seed: 1, media: [], verdict: "keep", notes: [], prompt: {}, graph: g }); }, { scene, shot: shotB });
    await call("open_shot", { scene, shot: shotA });
    const queued = A.queued.length;
    R.restore = await call("retake", { take: "take-g17s1", open_only: true });
    R.queuedByRestore = A.queued.length - queued;
    R.restoredPrompt = await prompt();
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, bTabs = (S.tabs?.tabs ?? []).filter((t) => t.shot === S.openB?.shot);
  const checks = {
    "shot B opens from A's MOSS setup (the sequence's start)": /setup/.test(S.openB?.built ?? "") && /MOSS/.test(String(S.bFamily)),
    "apply_setup on B says the earlier tab is scratch now": /this tab is that shot now; the earlier tab is scratch work \(renamed "was /.test(S.toPika?.shot ?? ""),
    "exactly one open tab claims B; the old one reads \"was …\"": S.claimsB?.length === 1 && bTabs.length === 1 && (S.tabs?.tabs ?? []).some((t) => /^was .*clash/.test(t.name ?? "") && !t.shot),
    "open_shot A then B shows B's Pika tab, never the stale MOSS one": /^PIKA-B/.test(S.promptB ?? "") && ["switched", "scene tab", "same"].includes(S.backB?.tab),
    "B's saved workflow keeps the Pika recipe and its marker after browsing away (F-SQ18)": !!S.savedB1 && JSON.stringify(S.savedB1).includes("PIKA-B") && !mossIn(S.savedB1),
    "with two tabs claiming B, open_shot opens the one holding its saved workflow and says so": !!S.seeded && /^PIKA-B/.test(S.promptTwoB ?? "") && /2 tabs claimed .*clash; opened the one holding its saved workflow/.test(S.twoB?.said ?? ""),
    "saving from the stale tab is refused and the tab becomes scratch": S.stale?.active === true && /not saved: another tab holds .*clash's recipe; this tab is scratch now/.test(S.stale.refused ?? "") && S.stale.markAfter === null,
    "B's file is unchanged by the stale tab": JSON.stringify(S.savedB2) === JSON.stringify(S.savedB1),
    "retake {open_only} restores the shot's recipe with nothing queued and no proposal (R234)": !S.restore?.proposed && !S.restore?.error && S.queuedByRestore === 0 && /nothing is queued/.test(S.restore?.said ?? "") && /^PIKA-B/.test(S.restoredPrompt ?? ""),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify(R, null, 1));
  console.log(`g17shots ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
