// Batch G16 S8, the production record (SNAP-R223), on the CPU test server:
// - create_book without a production gives the Book one of its own name (production:of-<book>), and get_book names it;
// - an old Book saved with no production (R15) gets one of its own name at its first read, never a refusal;
// - create_production {books} takes a Book out of the production it was in (that one's version says where it went);
//   create_book {production} joins it after its other Books; list_productions / get_production (by a Book too) list
//   the Books in order with the Astrid project slug;
// - export_records of the production carries both Books and their stories (the parts of parts), and offers the Cast;
// - the Book sheet names the production ("Book 2 of 2").
// usage: node test_g16_production.js [port] [base]   prints "g16prod n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g16prod-${Date.now()}`)); } };
(async () => {
  for (const d of ["book", "story", "look", "scenes", "cast", "production", "proposals.json"]) park(d); // moved, never deleted
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const cast = (await call("save_cast", { name: "Maren", details: "a tall swordswoman" })).cast;
    R.one = await call("create_book", { name: "Episode One", cast: [cast] });
    R.oneGet = await call("get_book", { book: R.one.book });
    // an old Book: saved the way G15 did, with no production anywhere
    R.old = await page.evaluate(async () => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const out = await B.saveBook(null, { name: "Old Short" }, { note: "made before productions" }); return `book:${out.id}`; });
    R.oldGet = await call("get_book", { book: R.old });
    R.series = await call("create_production", { name: "G16 Series", books: [R.one.book], cast: [cast] });
    R.two = await call("create_book", { name: "Episode Two", production: R.series.production });
    R.bad = await call("create_book", { name: "Nowhere", production: "production:nosuch" });
    R.list = await call("list_productions", {});
    R.byBook = await call("get_production", { production: R.two.book });
    R.ownAfter = await call("get_production", { production: R.oneGet.production?.ref });
    R.books = await call("list_books", {});
    R.export = await call("export_records", { refs: [R.series.production] });
    if (R.export?.file || R.export?.zip) {
      const zip = path.join(base, "output", "snap_exports", path.basename(R.export.file ?? R.export.zip));
      R.zip = JSON.parse(execFileSync("python3", ["-I", "-c", "import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({'names':z.namelist(),'manifest':json.loads(z.read('manifest.json'))}))", zip]).toString());
    }
    await call("open_view", { view: "book", book: R.two.book });
    await page.waitForTimeout(1200);
    R.chip = await page.evaluate(() => [...document.querySelectorAll(".snap-book-top .snap-al-chip")].map((x) => x.textContent));
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, own = (x) => x?.production?.ref;
  const checks = {
    "a Book made alone gets a production of its own name, and get_book names it": /^production:of-book-/.test(own(S.oneGet) ?? "") && S.oneGet.production.name === "Episode One" && S.one?.production === own(S.oneGet),
    "R15 an old Book with no production gets one of its own name at its first read": /^production:of-/.test(own(S.oldGet) ?? "") && S.oldGet.production.name === "Old Short" && !S.oldGet.error,
    "create_production takes the Book out of its own production, which says where it went": S.ownAfter?.books?.length === 0 && /moved to G16 Series/.test(S.ownAfter?.versions?.at(-1)?.note ?? ""),
    "create_book {production} joins it after its other Books": S.two?.production === S.series?.production && JSON.stringify(S.byBook?.books?.map((x) => x.name)) === JSON.stringify(["Episode One", "Episode Two"]),
    "get_production of a Book answers its production, with the Astrid project slug": S.byBook?.production === S.series?.production && S.byBook?.astrid?.project === "g16-series" && JSON.stringify(S.byBook?.cast) === JSON.stringify([S.oneGet?.cast?.[0]]),
    "a production that doesn't exist is refused before anything is written": /No production production:nosuch/.test(S.bad?.error ?? "") && !(S.books ?? []).some((x) => x.name === "Nowhere"),
    "list_productions lists every production with its Books in order": Array.isArray(S.list) && S.list.some((p) => p.name === "G16 Series" && p.books.map((x) => x.name).join() === "Episode One,Episode Two"),
    "export_records of the production carries both Books and their stories, and offers the Cast": !!S.zip && ["book", "story"].every((k) => S.zip.names.filter((n) => n.startsWith(`records/${k}/`)).length === 2) && S.zip.names.some((n) => n.startsWith("records/production/")) && (S.zip.manifest.offered ?? S.export.offered ?? []).some((o) => o.ref === S.oneGet?.cast?.[0]),
    "the Book sheet names the production: Book 2 of 2": (S.chip ?? []).some((t) => t === "production: G16 Series · Book 2 of 2"),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify({ ...R, zip: R.zip && { names: R.zip.names, offered: R.zip.manifest.offered } }, null, 1));
  console.log(`g16prod ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
