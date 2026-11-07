// Batch G16 S12, either/or as one question (SNAP-R229), on the CPU test server: two agents' waiting save_cast proposals
// for Maren's front picture, made against the same version:
// - the Room asks them as ONE question ("Two suggestions for Maren: which one?") with the picture as it is now and each
//   suggestion's "after" picture side by side, one Yes per side; the Work card shows them as one row (Accept 1, Accept 2);
// - Yes to the cooler one accepts it (Maren v2 has its picture) and withdraws the other naming the one chosen.
// usage: node test_g16_either.js [port] [base]   prints "g16either n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g16either-${Date.now()}`)); } };
(async () => {
  for (const d of ["cast", "proposals.json"]) park(d); // moved, never deleted
  const fin = path.join(base, "input", "snap", "g16either");
  fs.mkdirSync(fin, { recursive: true });
  for (const [f, c] of [["now.png", "0x808080"], ["one.png", "0xc04040"], ["two.png", "0x4060c0"]]) execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${c}:s=384x512`, "-frames:v", "1", path.join(fin, f)]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const cast = (await call("save_cast", { name: "Maren", details: "a tall swordswoman", refs: [{ file: "snap/g16either/now.png", role: "identity: front" }] })).cast;
    R.p1 = await call("save_cast", { cast, refs: [{ file: "snap/g16either/one.png", role: "identity: front" }], propose: true, reason: "a warmer front" });
    R.p2 = await call("save_cast", { cast, refs: [{ file: "snap/g16either/two.png", role: "identity: front" }], propose: true, reason: "a cooler front" });
    await page.evaluate(() => window.__A.reconcile());
    await page.evaluate(async () => { const R = await import("/extensions/ComfyUI-MAINodes/snap/room.js"); await R.openRoom({ say: () => {} }); });
    await page.waitForTimeout(2000);
    R.room = await page.evaluate(() => { const q = document.querySelector(".snap-room-q"); return { h2: q?.querySelector("h2")?.textContent, options: [...(q?.querySelectorAll(".snap-room-option:not(.now)") ?? [])].map((o) => ({ title: o.querySelector("h3")?.textContent, after: [...o.querySelectorAll("img")].map((i) => i.getAttribute("src")), button: o.querySelector("button.snap-primary")?.textContent })), now: [...(q?.querySelectorAll(".snap-room-option.now img") ?? [])].map((i) => i.getAttribute("src")), then: [...document.querySelectorAll(".snap-room-next .snap-room-line")].map((x) => x.textContent) }; });
    fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
    await page.screenshot({ path: path.join(CFG.out, "ui", "g16_room_either_or.png"), fullPage: false });
    await page.evaluate(() => document.querySelector(".snap-room")?.remove());
    await page.evaluate(async () => { const WV = await import("/extensions/ComfyUI-MAINodes/snap/workview.js"); WV.openWork(document.querySelector(".snap-root") ?? document.body, { say: () => {}, open: () => {}, decide: () => {} }); });
    await page.waitForTimeout(1500);
    R.work = await page.evaluate(() => [...document.querySelectorAll(".snap-work-row")].filter((r) => /Either\/or/.test(r.textContent)).map((r) => ({ title: r.querySelector(".snap-work-title")?.textContent, buttons: [...r.querySelectorAll("button")].map((x) => x.textContent) })));
    await page.locator(".snap-work-sheet").screenshot({ path: path.join(CFG.out, "ui", "g16_work_either_or.png") });
    await page.evaluate(() => document.querySelector(".snap-work-sheet")?.remove());
    await page.evaluate(async () => { const R = await import("/extensions/ComfyUI-MAINodes/snap/room.js"); await R.openRoom({ say: () => {} }); });
    await page.waitForTimeout(1500);
    await page.locator(".snap-room-option", { has: page.locator('img[src*="two.png"]') }).locator("button.snap-primary").click();
    await page.waitForTimeout(2500);
    R.after = await call("list_proposals", {});
    R.cast = await call("get_cast", { cast });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, p1 = S.p1?.proposed, p2 = S.p2?.proposed, row = (id) => (S.after ?? []).find((p) => p.id === id);
  const checks = {
    "the two are either/or": !!p1 && !!p2,
    "the Room asks them as one question naming Maren": S.room?.h2 === "Two suggestions for Maren: which one?" && !(S.room?.then ?? []).some((t) => /cooler|warmer/.test(t)),
    "the picture as it is now, then each suggestion's after picture side by side, one Yes per side": (S.room?.now ?? []).some((x) => /now\.png/.test(x)) && S.room?.options?.length === 2 && JSON.stringify(S.room.options.map((o) => /one\.png/.test(o.after.join()) ? "one" : /two\.png/.test(o.after.join()) ? "two" : "?").sort()) === JSON.stringify(["one", "two"]) && S.room.options.map((o) => o.button).join() === "Yes to suggestion 1,Yes to suggestion 2",
    "the Work card shows the pair as one row with Accept 1 and Accept 2": S.work?.length === 1 && /^Either\/or: 1: .* \| 2: /.test(S.work[0].title) && /warmer/.test(S.work[0].title) && /cooler/.test(S.work[0].title) && ["Accept 1", "Accept 2", "Reject both"].every((x) => S.work[0].buttons.includes(x)),
    "Yes to the cooler one accepts it: Maren's front is its picture": row(p2)?.status === "accepted" && S.cast?.body?.refs?.[0]?.file === "snap/g16either/two.png",
    "the other is withdrawn, naming the one chosen": row(p1)?.status === "withdrawn" && new RegExp(`either/or: the person chose ${p2} instead`).test(row(p1)?.result ?? ""),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify(R, null, 1));
  console.log(`g16either ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
