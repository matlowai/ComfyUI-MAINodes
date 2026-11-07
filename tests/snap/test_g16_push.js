// Batch G16 S2, tools/astrid_push.py against a real Astrid Runtime (SNAP_TEST_ASTRID_LAUNCHER, SNAP_TEST_ASTRID_ROOT: the
// lab's clean launcher and the builder's own data root; skipped, said, without them), driven as an agent from a shell
// (SNAP-R217, R221, R224, R225): a production with a 3-cut Book (C1 silent, C2 Maren's line with words, C3 private),
// Maren with a front picture and a voice, a place with a master picture:
// - push: the project is made with metadata.snap.production; the Cut is imported once as the Book's timeline (clips C1,
//   C2, C2-dialogue; C3 a gap); the lab's own probe_editable.py passes on the same archive; `timelines words` lists
//   Maren's words; the receipt maps each cut to its clip and media; references: Maren (character, the voice as an
//   association with metadata.snap.role voice) and the place; the Book's documents and snap.production;
// - a second context makes no new reference and no new document version;
// - a re-take of C2 (same length) swapped by `swap --cut C2` in place: C2 and C2-dialogue keep their ids, Astrid's clip
//   plays the new file, says generation.snap.take = the new take and carries its words; a slip of C1 at the same length
//   is swapped too; the swapped clip still trims; the receipt maps C2 and get_book says swapped;
// - `cut` again with nothing changed swaps nothing; a cut added is refused (shape changed) until --new-timeline, which
//   imports "… · Cut 2" and keeps the first timeline;
// - a SNAP_BASE that isn't this machine is refused before anything runs; proposal-note writes snap.proposals.
// usage: node test_g16_push.js [port] [base]   prints "g16push n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const D = CFG.fixture("short04"), LAUNCHER = process.env.SNAP_TEST_ASTRID_LAUNCHER, ROOT = process.env.SNAP_TEST_ASTRID_ROOT;
const PUSH = path.join(CFG.pack, "tools", "astrid_push.py"), LAB_PROBE = LAUNCHER && path.join(path.dirname(path.dirname(LAUNCHER)), "scripts", "probe_editable.py");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g16push-${Date.now()}`)); } };
// a child run without blocking Node (the page's bridge answers go through this process's routes)
const run = (cmd, args, env = {}) => new Promise((done) => { const p = spawn(cmd, args, { env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env } }); let out = "", err = ""; p.stdout.on("data", (d) => { out += d; }); p.stderr.on("data", (d) => { err += d; }); p.on("close", (code) => done({ code, out, err })); });
const astrid = (...args) => run(LAUNCHER, ["astrid", ...args], { ASTRID_RUNTIME_DATA_ROOT: ROOT });
const json = (r) => { try { const t = r.out.slice(r.out.indexOf("{")); return JSON.parse(t); } catch { return { unparsed: r.out + r.err }; } };
(async () => {
  if (!(LAUNCHER && ROOT)) { console.log("SKIP SNAP_TEST_ASTRID_LAUNCHER / SNAP_TEST_ASTRID_ROOT unset: no Astrid to push into"); console.log("g16push 0/0 (skipped)"); return; }
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "location", "production", "proposals.json", "astrid.json"]) park(d); // moved, never deleted
  const fout = path.join(base, "output", "snaptest_g16push"), fin = path.join(base, "input", "snap", "g16push");
  fs.mkdirSync(fout, { recursive: true }); fs.mkdirSync(fin, { recursive: true });
  for (const f of ["C1_pick.mp4", "C2_pick.mp4"]) fs.copyFileSync(path.join(D, "cuts", f), path.join(fout, f));
  await run("ffmpeg", ["-v", "error", "-y", "-i", path.join(fout, "C2_pick.mp4"), "-vf", "hue=h=120", "-c:a", "copy", path.join(fout, "C2_retake.mp4")]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x176:rate=24:duration=2", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(fout, "C3_private.mp4")]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x8a5a3a:s=256x384", "-frames:v", "1", path.join(fin, "maren_front.png")]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "color=c=0x3a5a8a:s=512x288", "-frames:v", "1", path.join(fin, "gate_master.png")]);
  await run("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=210:duration=3", "-ar", "48000", path.join(fin, "maren_voice.wav")]);
  const slug = R.slug = `g16-push-${Date.now().toString(36)}`;
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const client = await page.evaluate(async () => (await import("/scripts/api.js")).api.clientId);
    await page.evaluate(async ([l, r]) => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); await app.extensionManager.setting.set("MAINodes.Snap.AstridLauncher", l); await app.extensionManager.setting.set("MAINodes.Snap.AstridDataRoot", r); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); }, [LAUNCHER, ROOT]);
    const push = (cmd, ...args) => run("python3", ["-I", PUSH, cmd, "--page", client, ...args], { SNAP_BASE: `http://127.0.0.1:${port}`, SNAP_AGENT: "astrid-g16" }).then(json);
    const cast = (await call("save_cast", { name: "Maren", details: "a tall swordswoman", refs: [{ file: "snap/g16push/maren_front.png", role: "identity: front" }], voice: { file: "snap/g16push/maren_voice.wav", casting: "low, hushed" } })).cast;
    const place = (await call("save_location", { name: "The Gate", notes: "a village gate", master: { file: "snap/g16push/gate_master.png" } })).location;
    const series = R.series = (await call("create_production", { name: "G16 Push", astrid_project: slug, cast: [cast], locations: [place] })).production;
    const book = (await call("create_book", { name: "G16 Push", production: series, cast: [cast] })).book;
    await page.evaluate(async ({ book, cast }) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { beats: [{ id: "b1", text: "Maren comes to the gate." }, { id: "b2", text: "She sees him.", lines: [{ who: cast, text: "It's you." }] }, { id: "b3", text: "The gate shuts." }], groups: [{ id: "g1", name: "At the gate", beats: ["b1", "b2", "b3"] }] }, { note: "g16 push story" }); }, { book, cast });
    const cuts = [];
    for (const [i, beat] of ["b1", "b2", "b3"].entries()) cuts.push(await call("add_cut", { book, ...(cuts[0] ? { scene: cuts[0].scene } : { scene_name: "G16 push" }), beats: [beat], cast: [cast], location: place, seconds: 3 }));
    R.words = [[1.2, 1.4, "It's"], [1.4, 1.8, "you."]];
    await page.evaluate(async ({ cuts, cast, place, words }) => {
      const T = window.__T, SC = window.__SC;
      const mk = (id, file, group, extra = {}) => T.save({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 60, group, number: 1, status: "success", text: id, seed: 1, media: [{ kind: "video", filename: file, subfolder: "snaptest_g16push", type: "output" }], verdict: "keep", notes: [], prompt: {}, graph: {}, world: { [cast]: { n: 1, name: "Maren" }, [place]: { n: 1, name: "The Gate" } }, ...extra });
      await mk("take-g16p1", "C1_pick.mp4", "g16p-1"); await mk("take-g16p2", "C2_pick.mp4", "g16p-2", { voice: { status: "ok", words } }); await mk("take-g16p3", "C3_private.mp4", "g16p-3", { private: true });
      for (const [i, c] of cuts.entries()) { await SC.addGroup(c.scene, c.shot, `g16p-${i + 1}`); await SC.setActive(c.scene, c.shot, `take-g16p${i + 1}`, "person"); }
    }, { cuts, cast, place, words: R.words });
    await call("set_unit", { scene: cuts[0].scene, shot: cuts[0].shot, trim: { in_s: 0, out_s: 4.0 } });
    R.push = await push("push", "--book", book);
    R.receipt1 = (await (await fetch(`http://127.0.0.1:${port}/mainodes/snap/astrid`)).json()).productions[series];
    const entry = R.receipt1?.books?.[book];
    if (entry) {
      R.labProbe = json(await run(LAUNCHER, ["python", "-I", LAB_PROBE, entry.archive, "--project", "snap-probe"], { ASTRID_RUNTIME_DATA_ROOT: ROOT }));
      R.show1 = json(await astrid("timelines", "show", entry.timeline.timeline_id, "--project", slug, "--limit", "100", "--json"));
      R.words1 = await astrid("timelines", "words", entry.timeline.timeline_id, "--project", slug, "--published"); // F-AE03: without --published it leaves a working copy that blocks trims
    }
    R.project = json(await astrid("projects", "show", slug, "--json"));
    R.refs = json(await astrid("media", "references", "list", "--project", slug, "--json"));
    R.docs = json(await astrid("documents", "list", "--project", slug, "--json"));
    R.context2 = await push("context", "--book", book);
    R.refs2 = json(await astrid("media", "references", "list", "--project", slug, "--json"));
    R.docs2 = json(await astrid("documents", "list", "--project", slug, "--json"));
    // a re-take of C2, the same length; the person makes it active
    await page.evaluate(async () => { await window.__T.save({ id: "take-g16p2b", kind: "run", prompt_id: "g16p2b", created: Date.now(), seconds: 60, group: "g16p-2", number: 2, status: "success", text: "retake", seed: 2, media: [{ kind: "video", filename: "C2_retake.mp4", subfolder: "snaptest_g16push", type: "output" }], verdict: "keep", notes: [], prompt: {}, graph: {}, voice: { status: "ok", words: [[1.0, 1.3, "It's"], [1.3, 1.7, "you."]] } }); });
    await call("set_active_take", { scene: cuts[1].scene, shot: cuts[1].shot, take: "take-g16p2b" });
    R.swap = await push("swap", "--book", book, "--cut", "C2");
    // C1 slipped by 0.3 s at the same length: a push swaps its trim in place
    await call("set_unit", { scene: cuts[0].scene, shot: cuts[0].shot, trim: { in_s: 0.3, out_s: 4.3 } });
    R.slip = await push("cut", "--book", book);
    if (entry) R.trimAfter = json(await astrid("timelines", "edit", entry.timeline.timeline_id, "--project", slug, "--clip", "parent/clip:C2", "--trim-in", "0.100000", "--idempotency-key", `g16-trim-${Date.now()}`, "--json"));
    R.receipt2 = (await (await fetch(`http://127.0.0.1:${port}/mainodes/snap/astrid`)).json()).productions[series]?.books?.[book];
    if (entry) R.show2 = json(await astrid("timelines", "show", entry.timeline.timeline_id, "--project", slug, "--limit", "100", "--json"));
    R.book2 = await call("get_book", { book });
    R.again = await push("cut", "--book", book);
    const c4 = await call("add_cut", { book, scene: cuts[0].scene, seconds: 2 });
    await page.evaluate(async (c4) => { await window.__T.save({ id: "take-g16p4", kind: "run", prompt_id: "g16p4", created: Date.now(), seconds: 60, group: "g16p-4", number: 1, status: "success", text: "c4", seed: 1, media: [{ kind: "video", filename: "C1_pick.mp4", subfolder: "snaptest_g16push", type: "output" }], verdict: "keep", notes: [], prompt: {}, graph: {} }); await window.__SC.addGroup(c4.scene, c4.shot, "g16p-4"); await window.__SC.setActive(c4.scene, c4.shot, "take-g16p4", "person"); }, c4);
    R.shape = await push("cut", "--book", book);
    R.fresh = await push("cut", "--book", book, "--new-timeline");
    R.remote = json(await run("python3", ["-I", PUSH, "cut", "--book", book], { SNAP_BASE: "http://192.0.2.7:8188", SNAP_AGENT: "astrid-g16" }));
    R.note = await push("proposal-note", "--book", book);
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, entry = S.receipt1?.books ? Object.values(S.receipt1.books)[0] : null, clips1 = (S.show1?.data?.clips ?? []).map((c) => c.clip_id).sort(), clips2 = S.show2?.data?.clips ?? [];
  const refs = S.refs?.data?.[0] ?? [], refs2 = S.refs2?.data?.[0] ?? [], docs = S.docs?.data ?? [], docs2 = S.docs2?.data ?? [];
  const maren = refs.find((r) => r.name === "Maren");
  const checks = {
    "push imports the Cut once as the Book's timeline in the production's project": S.push?.ok === true && S.push.did === "imported" && S.push.project?.slug && S.push.timeline?.name === "G16 Push" && S.push.context?.ok === true,
    "the project carries metadata.snap.production": /^production:/.test(S.project?.data?.metadata?.snap?.production ?? "") && S.project.data.metadata.snap.production === S.series,
    "Astrid holds C1, C2 and C2-dialogue; C3 (private) is a gap the receipt names": JSON.stringify(clips1) === JSON.stringify(["C1", "C2", "C2-dialogue"]) && entry?.left_out?.[0]?.cut === "C3",
    "the lab's own probe_editable.py passes on the pushed archive": S.labProbe?.ok === true,
    "timelines words lists Maren's words from the dialogue clip": /It's/.test(S.words1?.out ?? "") && /you/.test(S.words1?.out ?? ""),
    "the receipt maps each cut to its clip, media and take": entry?.clips?.C1?.clip === "C1" && entry.clips.C2.clip === "C2" && entry.clips.C2.dialogue === "C2-dialogue" && /^sha256:/.test(entry.clips.C2.media) && entry.clips.C2.take === "take-g16p2" && /^authoring-parent-revision-/.test(entry.head ?? ""),
    "references: Maren (character, her voice as metadata.snap.role voice) and the place (from the takes' own pins)": maren?.kind === "character" && maren.metadata?.snap?.record && (maren.media_references ?? []).some((m) => m.metadata?.snap?.role === "voice") && refs.some((r) => r.name === "The Gate" && r.kind === "place"),
    "the Book's documents and snap.production are in the project": ["snap.story.", "snap.beat-sheet.", "snap.style.", "snap.voices."].every((p) => docs.some((d) => d.document_id.startsWith(p))) && docs.some((d) => d.document_id === `snap.production.${S.slug}`),
    "a second context makes no new reference and no new document version": S.context2?.ok === true && refs2.length === refs.length && JSON.stringify(docs2.map((d) => [d.document_id, d.version]).sort()) === JSON.stringify(docs.map((d) => [d.document_id, d.version]).sort()),
    "swap --cut C2 swaps in place: the clips keep their ids C2 and C2-dialogue": S.swap?.ok === true && S.swap.did === "swapped" && JSON.stringify(Object.keys(S.swap.swapped?.C2 ?? {})) === JSON.stringify(["C2", "C2-dialogue"]) && JSON.stringify(clips2.map((c) => c.clip_id).sort()) === JSON.stringify(["C1", "C2", "C2-dialogue"]),
    "Astrid's C2 plays the new take's file, says generation.snap.take = the new take and carries its words, in the old slot": (() => { const p = clips2.find((c) => c.clip_id === "C2"), d = clips2.find((c) => c.clip_id === "C2-dialogue"), was = S.show1?.data?.clips?.find((c) => c.clip_id === "C2");
      return p?.authored_fields?.generation?.snap?.take === "take-g16p2b" && p.source_object_id !== was?.source_object_id && p.authored_timing.at === was?.authored_timing?.at && d?.authored_fields?.generation?.snap?.take === "take-g16p2b" && d.authored_fields.app?.astrid?.words?.[0]?.[0] === 1.0 && /take 2/.test(p.authored_fields.label); })(),
    "the receipt maps C2 to its clip and the new take, and get_book says swapped": S.receipt2?.clips?.C2?.clip === "C2" && S.receipt2.clips.C2.take === "take-g16p2b" && /^swapped /.test(S.book2?.units?.find((u) => u.cut === "C2")?.astrid?.state ?? ""),
    "a slip at the same length is pushed as a swap of C1's trim": S.slip?.ok === true && S.slip.did === "swapped" && JSON.stringify((S.slip.swapped?.C1?.C1?.fields ?? []).filter((k) => k === "from" || k === "to")) === JSON.stringify(["from", "to"]),
    "the swapped clip still trims in Astrid": S.trimAfter?.ok === true && S.trimAfter.data?.status === "accepted",
    "cut again with nothing changed swaps nothing": S.again?.ok === true && S.again.did === "nothing",
    "a cut added is refused as a changed shape, naming --new-timeline": S.shape?.ok === false && S.shape.error === "shape_changed" && /added C4/.test(S.shape.message) && /--new-timeline/.test(S.shape.message),
    "--new-timeline imports '… · Cut 2' and keeps the first": S.fresh?.ok === true && S.fresh.did === "imported" && S.fresh.timeline?.name === "G16 Push · Cut 2" && S.fresh.kept?.[0]?.timeline_id === entry?.timeline?.timeline_id,
    "a SNAP_BASE that isn't this machine is refused before anything runs": S.remote?.ok === false && S.remote.error === "not_loopback",
    "proposal-note writes snap.proposals with the Room's link": S.note?.ok === true && S.note.document === `snap.proposals.${S.slug}` && /\?room/.test(S.note.said),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify({ ...R, show1: clips1, show2: clips2.map((c) => [c.clip_id, c.authored_fields?.generation]), refs: refs.map((r) => [r.name, r.kind, r.metadata, r.media_references?.length]), docs: docs.map((d) => [d.document_id, d.version]), docs2: docs2.map((d) => [d.document_id, d.version]) }, null, 1));
  console.log(`g16push ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
