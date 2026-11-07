// Batch G16 S9, the push is the person's (SNAP-R224) and the style section their switch (SNAP-R226), end to end against a
// real Astrid Runtime (SNAP_TEST_ASTRID_LAUNCHER / _ROOT; skipped, said, without them), on the CPU test server:
// - the Book settings (under Dial) carry "Push the Cut to Astrid by itself" and "Share the production style with Astrid",
//   both off, each with its help text (the style's is the protocol's §5 text);
// - a production with two Books: Book 1 pushed by the Cut lens's Push button (a real click), Book 2 by its auto-push
//   setting (a real click, then nothing else), into ONE Astrid project as two timelines; the receipt says by: person
//   (button) / person (auto-push); snap.production lists both Books with their timelines;
// - while the push runs, the server's child (tools/astrid_push.py) holds exactly PATH, HOME, SNAP_BASE, SNAP_AGENT and
//   ASTRID_RUNTIME_DATA_ROOT, nothing key-named (its /proc environ); the Work card shows the push as a job;
// - Share the style on, then Push: the project preferences hold Snap's marked section with the style's words (no file
//   names); off, then Push: the section is gone and the person's own text stays;
// - once in sync the card offers Open in Astrid; screenshots of the settings and the card under SNAP_TEST_OUT/ui.
// usage: node test_g16_settings.js [port] [base]   prints "g16settings n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const D = CFG.fixture("short04"), LAUNCHER = process.env.SNAP_TEST_ASTRID_LAUNCHER, ROOT = process.env.SNAP_TEST_ASTRID_ROOT;
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g16settings-${Date.now()}`)); } };
const run = (cmd, args, env = {}) => new Promise((done) => { const p = spawn(cmd, args, { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } }); let out = "", err = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; }); p.on("close", (code) => done({ code, out, err })); });
const astrid = (...args) => run(LAUNCHER, ["astrid", ...args], { ASTRID_RUNTIME_DATA_ROOT: ROOT });
const json = (r) => { try { return JSON.parse(r.out.slice(r.out.indexOf("{"))); } catch { return { unparsed: r.out + r.err }; } };
const receipt = async () => (await fetch(`http://127.0.0.1:${port}/mainodes/snap/astrid`)).json();
// the child's environment while it runs: the first tools/astrid_push.py process seen, its variable names
async function childEnv(ms) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    for (const pid of fs.readdirSync("/proc").filter((x) => /^\d+$/.test(x))) {
      try { if (fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").some((a) => a.endsWith("tools/astrid_push.py"))) return fs.readFileSync(`/proc/${pid}/environ`, "utf8").split("\0").filter(Boolean).map((x) => x.split("=")[0]).sort(); } catch { /* gone meanwhile */ }
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
(async () => {
  if (!(LAUNCHER && ROOT)) { console.log("SKIP SNAP_TEST_ASTRID_LAUNCHER / SNAP_TEST_ASTRID_ROOT unset: no Astrid to push into"); console.log("g16settings 0/0 (skipped)"); return; }
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "location", "production", "proposals.json", "astrid.json"]) park(d); // moved, never deleted
  const fout = path.join(base, "output", "snaptest_g16settings");
  fs.mkdirSync(fout, { recursive: true });
  for (const f of ["C1_pick.mp4", "C2_pick.mp4"]) fs.copyFileSync(path.join(D, "cuts", f), path.join(fout, f));
  const slug = R.slug = `g16-duo-${Date.now().toString(36)}`, shots = path.join(CFG.out, "ui");
  fs.mkdirSync(shots, { recursive: true });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async ([l, r]) => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); await app.extensionManager.setting.set("MAINodes.Snap.AstridLauncher", l); await app.extensionManager.setting.set("MAINodes.Snap.AstridDataRoot", r); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); }, [LAUNCHER, ROOT]);
    const duo = (await call("create_production", { name: "G16 Duo", astrid_project: slug })).production;
    const books = [];
    for (const [i, name] of ["Episode One", "Episode Two"].entries()) {
      const book = (await call("create_book", { name, production: duo })).book, units = [];
      for (let k = 0; k < 2; k++) units.push(await call("add_cut", { book, ...(units[0] ? { scene: units[0].scene } : { scene_name: `${name} scene` }), seconds: 3 }));
      await page.evaluate(async ({ units, i }) => { for (const [k, u] of units.entries()) { const id = `take-g16s${i}${k}`; await window.__T.save({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 60, group: `g16s-${i}${k}`, number: 1, status: "success", text: id, seed: 1, media: [{ kind: "video", filename: k ? "C2_pick.mp4" : "C1_pick.mp4", subfolder: "snaptest_g16settings", type: "output" }], verdict: "keep", notes: [], prompt: {}, graph: {} }); await window.__SC.addGroup(u.scene, u.shot, `g16s-${i}${k}`); await window.__SC.setActive(u.scene, u.shot, id, "person"); } }, { units, i });
      books.push(book);
    }
    R.look = await page.evaluate(async (book) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const l = await B.saveLook(null, { name: "Ink wash", paragraph: "Ink-wash anime, soft line, grey shading.", palette: "limited", voice: "low and even", sound: "wind and wood", genre: "quiet drama", still: { file: "snap/style/ink_still.png" } }); const bk = B.bookOf(book); await B.saveBook(bk.id, { ...bk.body, style: l.ref }); return l.ref; }, books[0]);
    // the Book settings, under Dial, with their help texts
    await call("open_view", { view: "book", book: books[0], lens: "the_cut" });
    await page.waitForTimeout(1500);
    await page.click(".snap-book-top button.snap-quiet-btn");
    await page.waitForTimeout(400);
    R.sets = await page.evaluate(() => [...document.querySelectorAll(".snap-book-astrid-set")].map((x) => ({ label: x.querySelector("strong").textContent, on: x.querySelector("input").checked, help: x.querySelector(".snap-book-astrid-help").textContent })));
    await page.locator(".snap-book-sheet").screenshot({ path: path.join(shots, "g16_book_settings.png") });
    // Book 1 by the Push button
    const envSeen = childEnv(60000);
    let t0 = Date.now();
    await page.click(".snap-book-astrid-push");
    R.env = await envSeen;
    await page.waitForFunction(() => window.__A.all().some((r) => r.source === "astrid" && r.state === "running"), null, { timeout: 60000 }).catch(() => {});
    R.work = await page.evaluate(() => window.__A.all().filter((r) => r.source === "astrid").map((r) => ({ state: r.state, title: r.title, where: r.where })));
    await page.locator(".snap-book-sheet").screenshot({ path: path.join(shots, "g16_astrid_card_pushing.png") });
    // the push of `book` that started after `after` has ended: its job and the receipt's entry
    const linked = async (book, after, ms = 300000) => { for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(1500)) { const r = await receipt(); const j = r.jobs.find((x) => x.book === book && x.started >= after); if (j && j.state !== "running") return { entry: r.productions[duo]?.books?.[book], job: j }; } return null; };
    R.one = await linked(books[0], t0);
    await page.waitForTimeout(2500);
    R.card = await page.evaluate(() => ({ said: document.querySelector(".snap-book-astrid-said")?.textContent, open: document.querySelector("a.snap-book-astrid-go")?.href ?? null }));
    await page.click(".snap-book-top button.snap-quiet-btn"); // the settings folded, so the card shows as the person sees it
    await page.waitForTimeout(400);
    await page.locator(".snap-book-sheet").screenshot({ path: path.join(shots, "g16_astrid_card_open.png") });
    // Book 1: share the style, then Push (the card offers it again: the style section moved)
    await page.click(".snap-book-top button.snap-quiet-btn").catch(() => {});
    await page.waitForTimeout(300);
    if (!(await page.$(".snap-book-astrid-set"))) await page.click(".snap-book-top button.snap-quiet-btn");
    await page.locator(".snap-book-astrid-set").nth(1).locator("input").check();
    await page.waitForTimeout(1500);
    R.offered = await page.evaluate(() => document.querySelector(".snap-book-astrid-push")?.textContent ?? null);
    t0 = Date.now();
    await page.click(".snap-book-astrid-push");
    R.styled = await linked(books[0], t0);
    R.prefsOn = json(await astrid("preferences", "project", "--project", slug, "--json"));
    // the person's own line in the preferences, kept across Snap's removal
    const work = path.join(fout, "prefs.md"); for (const f of [work, `${work}.astrid.json`]) if (fs.existsSync(f)) fs.renameSync(f, `${f}.parked-${Date.now()}`);
    await astrid("preferences", "checkout", "--project", slug, "--scope", "project", "--file", work, "--json");
    fs.writeFileSync(work, `My own note: keep cuts short.\n${fs.readFileSync(work, "utf8")}`);
    await astrid("preferences", "checkin", work, "--json");
    await page.locator(".snap-book-astrid-set").nth(1).locator("input").uncheck();
    await page.waitForTimeout(1500);
    t0 = Date.now();
    await page.click(".snap-book-astrid-push");
    R.unstyled = await linked(books[0], t0);
    R.prefsOff = json(await astrid("preferences", "project", "--project", slug, "--json"));
    // Book 2 by its auto-push setting: one click, then the push comes by itself after the Cut is still for 20 s
    await call("open_view", { view: "book", book: books[1], lens: "the_cut" });
    await page.waitForTimeout(1500);
    if (!(await page.$(".snap-book-astrid-set"))) await page.click(".snap-book-top button.snap-quiet-btn");
    t0 = Date.now();
    await page.locator(".snap-book-astrid-set").nth(0).locator("input").check();
    R.two = await linked(books[1], t0);
    R.final = await receipt();
    R.timelines = json(await astrid("timelines", "list", "--project", slug, "--json"));
    R.prodDoc = json(await astrid("documents", "show", `snap.production.${slug}`, "--project", slug, "--json"));
    await page.evaluate(() => app.extensionManager.setting.set("MAINodes.Snap.AstridLauncher", "")); // later suites' exports don't probe
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, p = S.final?.productions?.[Object.keys(S.final?.productions ?? {})[0]], tl = (book) => p?.books?.[book]?.timeline?.timeline_id;
  const bookIds = Object.keys(p?.books ?? {}), on = S.prefsOn?.data?.content ?? "", off = S.prefsOff?.data?.content ?? "";
  const tls = (S.timelines?.data?.[0] ?? S.timelines?.data ?? []).map?.((t) => t.timeline_id ?? t.id) ?? [];
  const checks = {
    "the Book settings carry both Astrid settings, off, each with its help text": JSON.stringify(S.sets?.map((x) => [x.label, x.on])) === JSON.stringify([["Push the Cut to Astrid by itself", false], ["Share the production style with Astrid", false]]) && /still for 20 seconds/.test(S.sets?.[0]?.help ?? "") && /^When this is on, Snap copies this Book's production style into the Astrid project's preferences, as one marked section/.test(S.sets?.[1]?.help ?? "") && /never sends anything off this computer/.test(S.sets?.[1]?.help ?? ""),
    "the server's child holds exactly PATH, HOME, SNAP_BASE, SNAP_AGENT, ASTRID_RUNTIME_DATA_ROOT": JSON.stringify(S.env) === JSON.stringify(["ASTRID_RUNTIME_DATA_ROOT", "HOME", "PATH", "SNAP_AGENT", "SNAP_BASE"]),
    "the Work card shows the push as a job": (S.work ?? []).some((r) => r.state === "running" && /Pushing Episode One to Astrid/.test(r.title) && r.where === "the Book Episode One"),
    "the Push button pushed Book 1, by: person (button)": S.one?.job?.state === "done" && !!S.one.entry?.timeline && S.one.entry.by === "person (button)",
    "in sync the card says In Astrid and offers Open in Astrid": /^In Astrid: G16 Duo › Episode One/.test(S.card?.said ?? "") && /tools\/video-editor\?project=.+&timeline=/.test(S.card?.open ?? ""),
    "sharing the style makes the card offer Push again": S.offered === "Push to Astrid",
    "R226 with it on the project preferences hold Snap's marked section, words only": new RegExp(`<!-- snap:style book:${(S.styled?.entry && bookIds[0] || "x").replace("book:", "")} look:`).test(on) && /Ink-wash anime, soft line, grey shading/.test(on) && /low and even/.test(on) && !/ink_still|\.png/.test(on),
    "R226 off then Push: the section is gone and the person's own text stays": !/snap:style/.test(off) && /My own note: keep cuts short/.test(off),
    "auto-push pushed Book 2 by itself, by: person (auto-push)": S.two?.job?.state === "done" && S.two.job.by === "person (auto-push)" && !!S.two.entry?.timeline && S.two.entry.by === "person (auto-push)",
    "both Books are timelines of ONE project": bookIds.length === 2 && !!tl(bookIds[0]) && !!tl(bookIds[1]) && tl(bookIds[0]) !== tl(bookIds[1]) && p.project.slug === S.slug && [tl(bookIds[0]), tl(bookIds[1])].every((t) => tls.includes(t)),
    "snap.production lists both Books with their timelines": (() => { const c = S.prodDoc?.data?.content; const doc = typeof c === "string" ? JSON.parse(c) : c; return doc?.books?.length === 2 && doc.books.every((x) => x.timeline); })(),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify({ ...R, prefsOn: on, prefsOff: off, timelines: tls, final: p }, null, 1));
  console.log(`g16settings ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
