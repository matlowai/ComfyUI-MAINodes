// U13 onboarding on a fresh, empty CPU server (:8196: empty models folder, no user data, only MAINodes installed).
// A: it opens by itself on the first visit (no profile) and never again after a close; then from the empty state: intents (video + stills), scan (everything missing, empty folders), metadata (yes),
// SFW only (yes), local tasks (all local), the kit (recommended + fast per intent, alternatives, missing downloads with
// exact targets and commands); closed and reopened it resumes on the kit; Open in new tabs opens one tab per intent with
// the missing files showing; profile saved; nothing downloaded (no request off this machine, models folder still empty,
// nothing queued); the agent tools say the same. B on the gate server (:8195, 83 real dials): SFW only hides a dial the
// person tagged nsfw from the picker, list_dials and the Library, and add_dial refuses it; API setups appear only when
// the person allows API for the task. U70 (SNAP-R28): the code-review question (default "only code Snap doesn't know",
// "always" picked) is saved in the profile and mirrored in ComfyUI's Settings row; propose_downloads gives a kit pack and
// any repo a review that follows the setting (always / unknown / never), and the Settings row changes the profile.
// The page starts on an empty tab, so the first setup uses it and the second gets a new one (SNAP-R5).
// usage: node test_onboarding.js [fresh port 8196] [gate port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"), R = { offsite: [], queued: 0 };
const FRESH = `http://127.0.0.1:${process.argv[2] || CFG.freshPort}`, GATE = `http://127.0.0.1:${process.argv[3] || CFG.port}`;
const userdata = async (host, p) => { const r = await fetch(`${host}/userdata/${encodeURIComponent(p)}`); return r.status === 200 ? r.json() : { status: r.status }; };
async function open(b, host, { escape = true } = {}) {
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => { R.offsite.push(r.request().url()); return r.abort(); });
  await page.route(/\/mainodes\/snap\/register$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"tools":0}' })); // never take the bridge
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { R.queued++; return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${host}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  if (escape) await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js");
    for (const [k, f] of Object.entries({ X: "tools", PF: "profile", D: "dials", L: "library", M: "models" })) window[`__${k}`] = await import(`/extensions/ComfyUI-MAINodes/snap/${f}.js`);
    app.graph.clear(); app.graph.extra = {};
    snap.toggle();
  });
  await page.waitForTimeout(1500);
  // the frontend's own checks at page load (update check, the default workflow's model links) are core's, not Snap's:
  // from here on nothing may leave the machine
  (R.offsiteAtLoad ??= []).push(...R.offsite.splice(0));
  const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  return { page, errs, call };
}
const shot = (page, name) => page.screenshot({ path: path.join(out, name) });
const step = (page) => page.$eval(".snap-onboard h2", (e) => e.textContent).catch(() => null);
const primary = (page) => page.click(".snap-onboard .snap-ob-foot .snap-primary");

(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  // ---- A. fresh server -------------------------------------------------------------------------------------------
  // a fresh person: the last run's Snap user data on this server is parked (moved aside, never deleted)
  const argv = (await (await fetch(`${FRESH}/system_stats`)).json()).system.argv, snapDir = path.join(argv[argv.indexOf("--base-directory") + 1], "user", "default", "snap");
  if (fs.existsSync(snapDir)) { fs.mkdirSync(path.join(snapDir, "..", "_parked"), { recursive: true }); fs.renameSync(snapDir, path.join(snapDir, "..", "_parked", `snap-${Date.now()}`)); }
  // and a fresh ComfyUI user (U72 F3): core's first-run Templates dialog shows again
  const settingsFile = path.join(snapDir, "..", "comfy.settings.json");
  if (fs.existsSync(settingsFile)) fs.renameSync(settingsFile, path.join(snapDir, "..", "_parked", `comfy.settings-${Date.now()}.json`));
  const before = await (await fetch(`${FRESH}/experiment/models`)).json();
  R.foldersBefore = (await Promise.all(before.map(async (f) => (await (await fetch(`${FRESH}/experiment/models/${f.name}`)).json()).length))).reduce((a, n) => a + n, 0);
  R.profileBefore = (await userdata(FRESH, "snap/profile.json")).status ?? "exists";
  // the first Snap visit with no profile opens onboarding by itself, once: closing it is final
  // U72 F1: a page nobody touches (a headless agent page) never opens it and writes no profile; a person's first move
  // opens it (SNAP-R29), and core's Templates dialog closes so the two first-run screens never compete (F3)
  const first = await open(b, FRESH, { escape: false });
  await first.page.waitForTimeout(2500);
  const coreDialog = () => first.page.evaluate(() => [...document.querySelectorAll("[role=dialog]")].filter((d) => !d.closest(".snap-onboard") && /Templates/.test(d.textContent)).length);
  R.untouched = { opened: !!(await first.page.$(".snap-onboard")), profile: (await userdata(FRESH, "snap/profile.json")).status ?? "exists", templates: await coreDialog() };
  await first.page.mouse.move(720, 450); await first.page.mouse.move(740, 470);
  await first.page.waitForTimeout(2000);
  R.coreFirstRun = { templates: await coreDialog(), tutorial: await first.page.evaluate(() => app.extensionManager.setting.get("Comfy.TutorialCompleted")) };
  await shot(first.page, "220-first-visit-onboarding-no-templates.png");
  R.auto = { opened: !!(await first.page.$(".snap-onboard")), title: await step(first.page), profile: (await userdata(FRESH, "snap/profile.json")).answered ?? null };
  await shot(first.page, "150-ob-auto-open.png");
  await first.page.click(".snap-onboard header .snap-x"); await first.page.waitForTimeout(300);
  await first.page.context().close();
  const { page, errs, call } = await open(b, FRESH);
  await page.waitForTimeout(2000);
  R.auto.again = !!(await page.$(".snap-onboard"));
  R.tools = await page.evaluate(() => window.__X.schema().map((t) => t.name).filter((n) => ["get_profile", "set_profile", "scan_models", "list_kits", "propose_downloads"].includes(n)));
  R.emptyLink = await page.$eval(".snap-empty .snap-link", (e) => e.textContent).catch(() => null);
  await shot(page, "150b-ob-empty-state.png");
  await page.click(".snap-empty .snap-link"); await page.waitForTimeout(1200);

  R.intent = { title: await step(page), on: await page.$$eval(".snap-ob-choice.on strong", (els) => els.map((e) => e.textContent)), hw: await page.$eval(".snap-onboard header .snap-quiet", (e) => e.textContent) };
  await page.click('.snap-ob-choice:has-text("Stills")'); await page.waitForTimeout(300);
  await shot(page, "151-ob-intent.png");
  await primary(page); await page.waitForTimeout(600);
  R.scanAsk = { title: await step(page), button: await page.$eval(".snap-ob-foot .snap-primary", (e) => e.textContent) };
  await primary(page); await page.waitForTimeout(1500);
  R.scan = { rows: await page.$$eval(".snap-ob-scan .snap-ob-row", (rows) => rows.map((r) => [...r.children].map((c) => c.textContent))), line: await page.$eval(".snap-ob-body > p:last-child", (e) => e.textContent) };
  await shot(page, "152-ob-scan-empty.png");
  await primary(page); await page.waitForTimeout(600);
  R.metadata = { title: await step(page), on: await page.$eval(".snap-ob-choice.on strong", (e) => e.textContent) };
  await shot(page, "153-ob-metadata.png");
  await primary(page); await page.waitForTimeout(600);
  R.sfw = { title: await step(page), note: await page.$eval(".snap-ob-body > p:last-child", (e) => e.textContent) };
  await page.click('.snap-ob-choice:has-text("SFW only")'); await page.waitForTimeout(300);
  await shot(page, "154-ob-sfw.png");
  await primary(page); await page.waitForTimeout(600);
  R.local = { title: await step(page), rows: await page.$$eval(".snap-ob-tasks .snap-ob-row", (rows) => rows.map((r) => [r.querySelector("strong").textContent, r.querySelector(".snap-seg .on").textContent])) };
  await shot(page, "155-ob-local.png");
  await primary(page); await page.waitForTimeout(600);
  R.code = { title: await step(page), line: await page.$eval(".snap-onboard h2 + p", (e) => e.textContent), on: await page.$$eval(".snap-ob-choice.on strong", (els) => els.map((e) => e.textContent)),
    choices: await page.$$eval(".snap-ob-choice strong", (els) => els.map((e) => e.textContent)) };
  await page.click('.snap-ob-choice:has-text("Always read it first")'); await page.waitForTimeout(300);
  await shot(page, "155b-ob-code-review.png");
  await primary(page); await page.waitForTimeout(2500);
  const kitView = () => page.evaluate(() => ({ title: document.querySelector(".snap-onboard h2")?.textContent,
    kits: [...document.querySelectorAll(".snap-ob-kit")].map((k) => ({ title: k.querySelector(".snap-rail-title").textContent,
      cards: [...k.querySelectorAll(".snap-ob-card")].map((c) => ({ label: c.querySelector(".snap-ob-card-top i").textContent, state: c.querySelector(".snap-ob-state").textContent, title: c.querySelector("strong").textContent, lines: [...c.querySelectorAll("span")].map((s) => s.textContent) })),
      try: k.querySelector(".snap-ob-try")?.textContent })),
    downloads: document.querySelector(".snap-ob-downloads")?.textContent, open: document.querySelector(".snap-ob-foot .snap-primary")?.textContent }));
  R.kit = await kitView();
  await shot(page, "156-ob-kit-fresh.png");
  await page.click('.snap-ob-kit:nth-of-type(2) .snap-link:has-text("See alternatives")'); await page.click('.snap-ob-downloads .snap-link'); await page.waitForTimeout(500);
  R.expanded = { also: await page.$$eval(".snap-ob-kit:nth-of-type(2) .snap-ob-card strong", (els) => els.map((e) => e.textContent)),
    rows: await page.$$eval(".snap-ob-dl-row", (rows) => rows.map((r) => ({ file: r.querySelector("strong").textContent, line: r.querySelector(".snap-quiet")?.textContent, code: r.querySelector("code")?.textContent ?? null }))) };
  await page.$eval(".snap-ob-downloads", (e) => e.scrollIntoView());
  await shot(page, "157-ob-downloads.png");
  // close and reopen: it resumes on the kit; every answer so far is in snap/profile.json
  await page.click(".snap-onboard header .snap-x"); await page.waitForTimeout(300);
  R.saved = await userdata(FRESH, "snap/profile.json");
  R.metaSetting = await page.evaluate(() => app.extensionManager.setting.get("MAINodes.Snap.SaveMetadata"));
  await call("ui", { action: "onboarding" }); await page.waitForTimeout(2000);
  R.resumed = await step(page);
  const tabsBefore = await page.evaluate(() => app.extensionManager.workflow.openWorkflows.length);
  await primary(page); await page.waitForTimeout(6000);
  R.opened = { tabs: (await page.evaluate(() => app.extensionManager.workflow.openWorkflows.length)) - tabsBefore, tabsBefore,
    nodes: await page.evaluate(() => app.extensionManager.workflow.openWorkflows.map((w) => w.changeTracker?.activeState?.nodes?.length ?? null)), toast: await page.$eval(".snap-toast", (e) => e.textContent), sheet: !!(await page.$(".snap-onboard")),
    bricks: await page.evaluate(() => app.graph.extra?.snap?.bricks?.map((x) => x.key)), missing: await page.$$eval(".snap-setup-files .missing, .snap-chip.missing, .missing", (els) => els.length) };
  await shot(page, "158-ob-opened-tab.png");
  R.done = await userdata(FRESH, "snap/profile.json");
  // the agent tools say the same, and never download
  R.agent = { edit: await call("list_kits", { intent: "edit" }), profile: await call("get_profile", {}), scan: await call("scan_models", {}), stills: await call("list_kits", { intent: "stills" }), proposal: await call("propose_downloads", {}) };
  // U70: the review follows the person's setting, for a kit pack and for a repo Snap doesn't know
  const GEIRU = "https://github.com/roycho87/geiru_context_suite.git", NEW = "https://github.com/example/some-new-pack";
  const review = async (pack) => (await call("propose_downloads", { pack })).packs?.[0];
  R.review = { setting: await page.evaluate(() => app.extensionManager.setting.get("MAINodes.Snap.CodeReview")), profile: R.agent.profile.profile?.code_review, always: [await review(GEIRU), await review(NEW)] };
  await call("set_profile", { code_review: "unknown" });
  R.review.unknown = [(await review(GEIRU)).review, (await review(NEW)).review];
  R.review.settingAfterTool = await page.evaluate(() => app.extensionManager.setting.get("MAINodes.Snap.CodeReview"));
  await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.CodeReview", "never")); await page.waitForTimeout(500);
  R.review.profileAfterRow = (await userdata(FRESH, "snap/profile.json")).code_review;
  R.review.never = [(await review(GEIRU)).review, (await review(NEW)).review];
  const after = await Promise.all(before.map(async (f) => (await (await fetch(`${FRESH}/experiment/models/${f.name}`)).json()).length));
  R.foldersAfter = after.reduce((a, n) => a + n, 0);
  R.errorsA = errs;
  await page.context().close();

  // ---- B. the gate server: SFW only and API opt-in on real dials ---------------------------------------------------
  const g = await open(b, GATE);
  await g.page.waitForTimeout(1500);
  const dial = await g.page.evaluate(async () => { await __D.load(); return __D.all()[0]?.dial; });
  R.sfwB = { dial, before: await g.page.evaluate(() => __D.all().length) };
  await g.page.evaluate(async (d) => { await __M.load(); await __M.teach(d, { tags: ["nsfw"] }); }, dial);
  await g.call("set_profile", { sfw_only: true });
  await g.page.waitForTimeout(500);
  R.sfwB.after = await g.page.evaluate(() => __D.all().length);
  R.sfwB.listed = (await g.call("list_dials", {})).some?.((x) => x.dial === dial);
  R.sfwB.library = await g.page.evaluate((d) => __L.search("").some((c) => c.brick?.dial === d), dial);
  R.sfwB.libraryNote = await g.page.$eval(".snap-rail .snap-quiet:not([hidden])", (e) => e.textContent).catch(() => null);
  await g.call("start_recipe", {}); await g.page.waitForTimeout(2500);
  R.sfwB.add = await g.call("add_dial", { dial });
  await g.call("ui", { action: "dials" }); await g.page.waitForTimeout(800);
  R.sfwB.picker = await g.page.$eval(".snap-dial-sheet header .snap-quiet", (e) => e.textContent);
  R.sfwB.tile = await g.page.$$eval(".snap-dial-tile", (els, d) => els.some((t) => t.title === d), dial);
  await shot(g.page, "159-ob-sfw-dial-picker.png");
  await g.call("ui", { action: "close" });
  R.apiOff = (await g.call("list_kits", { intent: "video" })).also.map((s) => s.tier);
  await g.call("set_profile", { api_tasks: ["render"] });
  R.apiOn = (await g.call("list_kits", { intent: "video" })).also.filter((s) => s.tier === "api").map((s) => [s.title, s.local_or_api, s.cost]);
  await g.call("set_profile", { sfw_only: false, api_tasks: [] });
  R.sfwB.back = await g.page.evaluate(() => __D.all().length);
  R.errorsB = g.errs;
  await b.close();
  fs.writeFileSync(path.join(out, "test_onboarding_result.json"), JSON.stringify(R, null, 1));
})();
