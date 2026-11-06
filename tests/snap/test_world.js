// U87 step 1, the world record store (web/snap/world.js), on the CPU test server (:8195):
// - a body saved twice is one version, a changed body two; the head moves; references parse (kind:id, kind:id@n);
// - migrate() on a COPY of the GPU instance's snap/cards (plus one saved set state and an old character card) keeps
//   the Library's card count and ids, makes the lamp-room lineage versions 1..k with the "-mine" copy as its draft and
//   its plates on the record, and parks every original in snap/_migrated/cards/ (nothing deleted); a second and third
//   page load change nothing;
// - two pages saving the same record at once end with versions numbered 1..head.
// BEFORE=1 serves the HEAD library.js and no world.js (the code before the store): the run must fail.
// usage: node test_world.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
// the GPU instance's own cards from before records; once its page migrated them they are parked in _migrated/cards
const GPU = ["cards", "_migrated/cards"].map((d) => CFG.fixture("gpubase", "user", "default", "snap", d)).find((d) => fs.existsSync(path.join(d, "set-lamp-room-end-s3-mine.json")));
const WT = CFG.pack;
async function open(b) {
  const page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  if (process.env.BEFORE) {
    const old = execSync(`git -C ${WT} show HEAD:web/snap/library.js`).toString();
    await page.route(/\/extensions\/ComfyUI-MAINodes\/snap\/library\.js(\?.*)?$/, (r) => r.fulfill({ status: 200, contentType: "text/javascript", body: old }));
    await page.route(/\/extensions\/ComfyUI-MAINodes\/snap\/world\.js(\?.*)?$/, (r) => r.fulfill({ status: 404, body: "" }));
  }
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  return page;
}
const put = (page, file, data) => page.evaluate(async ([file, data]) => (await fetch(`/api/userdata/${encodeURIComponent(file)}?overwrite=true`, { method: "POST", body: JSON.stringify(data) })).status, [file, data]);
const list = (page, dir) => page.evaluate(async (dir) => { const r = await fetch(`/api/userdata?dir=${encodeURIComponent(dir)}&recurse=true&split=false&full_info=true`); return r.ok ? (await r.json()).map((f) => f.path).sort() : []; }, dir);
const getJ = (page, file) => page.evaluate(async (file) => { const r = await fetch(`/api/userdata/${encodeURIComponent(file)}`); return r.ok ? r.json() : null; }, file);
const library = (page) => page.evaluate(async () => {
  const L = await import("/extensions/ComfyUI-MAINodes/snap/library.js"); await L.ready();
  const packIds = new Set((await (await fetch("/mainodes/snap/cards")).json()).cards.map((c) => c.id));
  const mine = L.search("").filter((c) => !packIds.has(c.id) && c.kind !== "dial" && c.kind !== "run");
  return { ids: mine.map((c) => c.id).sort(), lamp: L.lineage(L.get("set-lamp-room-end-s3")).map((c) => c.id), plates: Object.keys(L.get("set-lamp-room-end-s3-mine")?.plates ?? {}).sort() };
});
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  let page = await open(b);
  // ---- the copy of the GPU instance's cards, plus a saved set state and an old character card ----
  const real = fs.readdirSync(GPU).filter((f) => f.endsWith(".json")).map((f) => [f, JSON.parse(fs.readFileSync(path.join(GPU, f)))]);
  const mine = real.find(([f]) => f === "set-lamp-room-end-s3-mine.json")[1][0];
  const saved = { ...structuredClone(mine), id: "set-lamp-room-end-s3-mtest1", saved: mine.saved - 60000, title: "Set snapshot: Lamp room, end of shot 3 (saved 08:27:00)" };
  delete saved.plates;
  const fixtures = [...real, ["set-lamp-room-end-s3-mtest1.json", [saved]],
    ["char-test-old.json", [{ id: "char-test-old", kind: "character", title: "An old character card", text: "a test character", brick: { prompt_fragment: "a test character" } }]]];
  for (const [f, data] of fixtures) R[`put_${f}`] = await put(page, `snap/cards/${f}`, data);
  R.cardsBefore = await list(page, "snap/cards");
  await page.close();
  // ---- first load migrates ----
  page = await open(b);
  R.first = await library(page);
  R.cardsAfter = await list(page, "snap/cards");
  R.migrated = await list(page, "snap/_migrated/cards");
  R.lampRecord = await getJ(page, "snap/set_snapshot/set-lamp-room-end-s3.json");
  R.castCard = await getJ(page, "snap/card/char-test-old.json");
  R.errors1 = page.errs;
  await page.close();
  // ---- second and third loads change nothing ----
  page = await open(b);
  R.second = await library(page);
  await page.close();
  page = await open(b);
  R.third = await library(page);
  R.lampRecord3 = await getJ(page, "snap/set_snapshot/set-lamp-room-end-s3.json");
  R.migrated3 = await list(page, "snap/_migrated/cards");
  // ---- versions: same body once, changed body twice, refs ----
  R.versions = await page.evaluate(async () => {
    const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load();
    const id = `wtest-${Date.now().toString(36)}`;
    const a = await W.save("card", id, { id, kind: "principle", title: "t", text: "one", brick: { b: 1, a: 2 } });
    const a2 = await W.save("card", id, { kind: "principle", id, text: "one", title: "t", brick: { a: 2, b: 1 } }); // same body, other key order
    const c = await W.save("card", id, { id, kind: "principle", title: "t", text: "two", brick: { a: 2, b: 1 } });
    const parsed = [W.parse(`cast:cast-k7f2x9@2`), W.parse("set_snapshot:set-lamp-room-end-s3")];
    let bad = null; try { W.parse("kon v2"); } catch (e) { bad = e.message; }
    const r = W.record("card", id);
    return { id, made: [a.made, a2.made, c.made], refs: [a.ref, a2.ref, c.ref], head: r.head, ns: r.versions.map((v) => v.n), hashLen: r.versions[0].hash.length,
      atOne: W.get(`card:${id}@1`)?.version.body.text, atHead: W.get(`card:${id}`)?.version.body.text, parsed, bad };
  }).catch((e) => ({ error: e.message, made: [], ns: [], refs: [], parsed: [{}, {}] }));
  // ---- two pages save the same record at once ----
  const p2 = await open(b);
  const rid = `wrace-${Date.now().toString(36)}`;
  await Promise.all([page, p2].map((p, k) => p.evaluate(async ([rid, k]) => {
    const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load();
    await Promise.all([0, 1, 2].map((i) => W.save("card", rid, { id: rid, kind: "principle", title: "race", text: `page ${k} write ${i}` })));
  }, [rid, k]).catch((e) => e.message)));
  R.race = (await getJ(page, `snap/card/${rid}.json`))?.versions.map((v) => v.n);
  R.raceHead = (await getJ(page, `snap/card/${rid}.json`))?.head;
  R.errors3 = [...page.errs, ...p2.errs];
  await page.screenshot({ path: path.join(out, "_world_after.png") });

  const realIds = real.flatMap(([, d]) => d.map((c) => c.id));
  const lampVersions = R.lampRecord?.versions ?? [];
  const c = {
    "the copy's cards keep their ids in the Library after the migration": realIds.every((id) => R.first.ids.includes(id)) && R.first.ids.includes("set-lamp-room-end-s3-mtest1") && R.first.ids.includes("char-test-old"),
    "snap/cards is empty after the first load, every original parked in snap/_migrated/cards": R.cardsAfter.length === 0 && R.cardsBefore.every((f) => R.migrated.includes(f)),
    "the lamp-room lineage is one record: the saved state v1, the -mine copy its draft, its plates on the record": lampVersions.map((v) => v.n).join() === "1" && lampVersions[0].body.id === "set-lamp-room-end-s3-mtest1"
      && R.lampRecord.draft?.id === "set-lamp-room-end-s3-mine" && !R.lampRecord.draft.plates && Object.keys(R.lampRecord.plates ?? {}).length === 4 && R.first.plates.length === 4,
    "the Library's lineage reads root, saved state, working copy": R.first.lamp.join() === "set-lamp-room-end-s3,set-lamp-room-end-s3-mtest1,set-lamp-room-end-s3-mine",
    "an old character card is kept as a cast card": R.castCard?.versions?.[0]?.body.kind === "cast",
    "a second and third load change nothing": JSON.stringify(R.second) === JSON.stringify(R.first) && JSON.stringify(R.third) === JSON.stringify(R.first)
      && JSON.stringify(R.lampRecord3?.versions) === JSON.stringify(R.lampRecord?.versions) && R.migrated3.join() === R.migrated.join(),
    "a body saved twice (any key order) is one version, a changed one two": R.versions.made.join() === "true,false,true" && R.versions.ns.join() === "1,2" && R.versions.head === 2 && R.versions.hashLen === 64,
    "a version stays as it was; the head reads the newest": R.versions.atOne === "one" && R.versions.atHead === "two" && R.versions.refs[2].endsWith("@2"),
    "references parse; a wrong one is refused saying the form": R.versions.parsed[0].kind === "cast" && R.versions.parsed[0].n === 2 && R.versions.parsed[1].n === null && /kind:id@n/.test(R.versions.bad ?? ""),
    "two pages saving one record at once end with versions 1..head": R.race?.join() === "1,2,3,4,5,6" && R.raceHead === 6,
    "no page errors": !R.errors1.length && !R.errors3.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_world_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`world    ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
