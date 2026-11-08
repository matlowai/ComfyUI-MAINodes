// Batch G17b, the critic's counts, a take's destination and the boom (SNAP-R244-R247, R249; F-SQ41, F-SQ46) on the CPU
// test server with real footage (fixtures seq02_m6: the M6 clash takes with and without the key picture and their four
// reference pictures; short05_v3: C1 preset C, C3's boom and its softer pick):
// - check_copies scores every half second: the M6 key take turns into Picture 4 (the key drawing) from 1.5-2.5 s at 0.85
//   or more, named with its role and said to leave out; the no-key take turns into nothing (R246);
// - the loudness route's onset: C3's boom is a sub-bass hit, the softer pick is not (R249, F-SQ46);
// - make_louder on C1 (a click at frame 0): faded first, it reaches about -23 LUFS and the take says so (F-SQ41);
// - a Book cut take's packet: a frame every half second and the last, count_these with the story's bowl and its
//   holders, the sound onset said; a count note showing a duplicate written low is stored high with `raised` (R244,
//   R245, R247).
// usage: node test_g17b_critic.js [port] [base]   prints "g17bcritic n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const M6 = CFG.fixture("seq02_m6"), FX = CFG.fixture("short05_v3");
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-g17bcritic-${Date.now()}`)); } };
const sh = (cmd, args) => new Promise((done) => execFile(cmd, args, { maxBuffer: 1 << 26 }, (e, o, err) => done({ code: e ? e.code ?? 1 : 0, out: String(o), err: String(err) })));
const REFS = [["take-b71e146d-85c2-4426-b84d-360faf21fd78_f0.png", "board: the clash opening, the cut opens on it"], ["take-9873668c-826b-49aa-9005-083465fe9564_f0.png", "Liora settei"], ["take-dd21dc6d-e66d-445e-9a5f-7dc3ea619850_f0.png", "Corvin settei"], ["take-92e5c048-f235-431e-9563-3be2e6690116_f0.png", "key: the beat peak"]];
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "production", "proposals.json", "critiques"]) park(d); // moved, never deleted
  const fin = path.join(base, "input", "snap", "g17bm6"), fout = path.join(base, "output", "snaptest_g17bcritic");
  fs.mkdirSync(fin, { recursive: true }); fs.mkdirSync(fout, { recursive: true });
  for (const [f] of REFS) fs.copyFileSync(path.join(M6, f), path.join(fin, f));
  // the first 3 s of each M6 take (the key is reached by 2.5 s): DINOv3 runs at 1024 px on every scored frame, slow on a CPU
  for (const [from, to] of [["m6_c_key_s4242_take-ec21712e.mp4", "m6_key.mp4"], ["m6_a_nokey_s4242_take-05ac2594.mp4", "m6_nokey.mp4"]])
    await sh("ffmpeg", ["-v", "error", "-y", "-i", path.join(M6, from), "-t", "3", "-c:v", "libx264", "-crf", "12", "-c:a", "aac", path.join(fout, to)]);
  for (const [from, to] of [["c1_take-00767c8d.mp4", "c1.mp4"], ["c3_take-6f3e2b88_boom.mp4", "c3_boom.mp4"], ["c3_take-b02bee92_softer.mp4", "c3_softer.mp4"]]) fs.copyFileSync(path.join(FX, from), path.join(fout, to));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    await page.unroute(/\/(api\/)?prompt$/); // the copy check and make_louder run for real on the CPU server
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const loud = async (file) => (await fetch(`http://127.0.0.1:${port}/mainodes/snap/loudness?filename=${file}&subfolder=snaptest_g17bcritic&type=output`)).json();
    R.boom = await loud("c3_boom.mp4"); R.softer = await loud("c3_softer.mp4"); R.c1sound = await loud("c1.mp4");
    const seed = (id, file, extra = {}) => page.evaluate(async ([id, file, extra]) => { await window.__T.save({ id, kind: "run", prompt_id: id, created: Date.now(), seconds: 60, group: `${id}-g`, number: 1, status: "success", text: "g17b critic", seed: 4242, verdict: null, notes: [],
      media: [{ kind: "video", filename: file, subfolder: "snaptest_g17bcritic", type: "output" }], graph: {}, world: {}, prompt: {}, ...extra }); }, [id, file, extra]);
    const refsOf = (list) => ({ prompt: Object.fromEntries([...list.map(([f], i) => [String(10 + i), { class_type: "LoadImage", inputs: { image: `snap/g17bm6/${f}` } }]), ["7", { class_type: "H3References", inputs: Object.fromEntries(list.map((_, i) => [`ref_images.ref_image_${i}`, [String(10 + i), 0]])) }]]),
      graph: { extra: { snap: { bricks: [{ key: "refs", pictures: list.map(([f, role]) => ({ file: `snap/g17bm6/${f}`, role })) }] } } } });
    // the opening board and the key (the two settei are left out of the check: DINOv3 at full size is slow on a CPU)
    await seed("take-g17bm6-key", "m6_key.mp4", refsOf([REFS[0], REFS[3]]));
    await seed("take-g17bm6-nokey", "m6_nokey.mp4", refsOf([REFS[0]]));
    const until = async (take, k) => { for (let i = 0; i < 900; i++) { const t = await page.evaluate((id) => window.__T.get(id), take); if (t?.[k] && !t[k].pending) return t[k]; await page.waitForTimeout(1000); } return null; };
    // one after the other: a check waits up to 10 minutes for its own prompt, and DINOv3 at 1024 px is slow on a CPU
    // a busy CPU can take longer than a check waits (10 minutes): then the run is read from history once the queue is idle,
    // as a page reloaded meanwhile would (plates.resume)
    const copyOf = async (take) => {
      await call("check_copies", { take }); const pending = await page.evaluate((id) => window.__T.get(id).copy, take);
      let got = await until(take, "copy");
      if (/didn't finish/.test(got?.error ?? "")) { await F.idle(port); got = await page.evaluate(async ([id, p]) => { const T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js"), PL = await import("/extensions/ComfyUI-MAINodes/snap/plates.js"); const t = T.get(id); t.copy = p; await T.save(t); await PL.resume(); return null; }, [take, pending]) ?? await until(take, "copy"); }
      return got; };
    R.keyCopy = await copyOf("take-g17bm6-key"); R.noCopy = await copyOf("take-g17bm6-nokey");
    // make_louder on C1 preset C, which opens on a click
    await seed("take-g17bc1", "c1.mp4", { sound: { mean_db: R.c1sound.mean_db, max_db: R.c1sound.max_db, onset: R.c1sound.onset } });
    R.louder = await call("make_louder", { take: "take-g17bc1" });
    for (let i = 0; i < 300 && !R.loudTake; i++) { R.loudTake = await page.evaluate((id) => window.__T.get(id) ?? null, R.louder.take); if (!R.loudTake) await page.waitForTimeout(1000); }
    R.loudGet = R.louder.take && await call("get_take", { take: R.louder.take });
    // a Book cut whose story puts one white bowl in Mio's right hand; its take's packet
    const mio = (await call("save_cast", { name: "Mio g17bk", details: "a young cook in a white headscarf" })).cast;
    const book = (await call("create_book", { name: "G17b Critic", cast: [mio] })).book;
    await page.evaluate(async ({ book, mio }) => { const B = await import("/extensions/ComfyUI-MAINodes/snap/book.js"); const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { props: [{ id: "bowl", name: "white bowl" }], beats: [{ id: "b1", text: "Mio ladles broth into the bowl, then lifts it.", changes: [{ entity: mio, path: "carried.right_hand", value: "prop:bowl" }] }] }, { note: "g17b critic" }); }, { book, mio });
    const c1 = await call("add_cut", { book, scene_name: "G17b critic", beats: ["b1"], cast: [mio], seconds: 3.8 });
    await seed("take-g17bk-c3", "c3_boom.mp4", { sound: { mean_db: R.boom.mean_db, max_db: R.boom.max_db, onset: R.boom.onset }, story: { book, beat: "b1", unit: { scene: c1.scene, shot: c1.shot, cut: "C1" } } });
    await page.evaluate(async ([scene, shot]) => { await window.__SC.addGroup(scene, shot, "take-g17bk-c3-g"); }, [c1.scene, c1.shot]);
    R.row = await page.evaluate(async () => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); await CR.forTake(window.__T.get("take-g17bk-c3"), { trigger: "test" }).catch(() => null); await CR.load(); return CR.all().find((r) => r.subject?.take === "take-g17bk-c3")?.id ?? null; });
    R.packet = await call("critique_packet", { critique: R.row, part: "whole" });
    R.claim = await call("claim_critique", { critique: R.row });
    R.write = await call("write_critique", { critique: R.row, verdict: "flaws", passes: { count: "white bowl ×1 expected; f0-f48 ×2 (counter + her hand)", sound: "a sub-bass boom at 0.91 s" }, notes: [{ severity: "low", pass: "count", text: "a second white bowl stands on the counter", count: { thing: "white bowl", expected: 1, seen: 2, frames: "f0-f48" }, owner: "board" }] });
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  const S = R, reach = S.keyCopy?.reaches?.[0], subj = (S.packet?.pictures ?? []).filter((p) => p.role === "subject").map((p) => p.frame), bowl = S.packet?.words?.count_these?.props?.find((p) => p.thing === "white bowl"), note = S.write?.notes?.[0];
  const checks = {
    "the M6 key take turns into the key drawing (its Picture 2 here) from 1.5-2.5 s (R246)": reach?.picture === "<Picture 2>" && /^key: /.test(reach.role ?? "") && reach.from_s >= 1.5 && reach.from_s <= 2.5 && reach.score >= S.keyCopy.threshold && /leave that picture out of References \(SNAP-R242\)/.test(S.keyCopy.said ?? ""),
    "the copy check scored every half second and the last": (S.keyCopy?.frames_scored ?? []).join() === "0,12,24,36,48,60,71" && S.keyCopy.against?.[0]?.frames?.length === S.keyCopy.frames_scored.length,
    "the M6 take without the key turns into no cited picture": S.noCopy?.against?.length === 1 && !S.noCopy.reaches,
    "C3's boom is a sub-bass hit; the softer pick is not (R249, F-SQ46)": S.boom?.onset?.hit === true && S.boom.onset.low_share >= 0.5 && S.boom.onset.at_s > 0.7 && S.boom.onset.at_s < 1.1 && S.softer?.onset?.hit === false,
    "make_louder fades C1's frame-0 click and reaches about -23 LUFS, said on the take (F-SQ41)": S.loudTake?.loudness?.declicked === true && S.loudTake.loudness.lufs > -24.5 && /^reached -2[34]\.\d LUFS .* after a short fade-in took a click off its first frame/.test(S.loudTake.loudness.said ?? "") && !!S.loudGet?.loudness,
    "the cut packet reads a frame every half second and the last (R245)": subj.length >= 8 && subj.slice(0, -1).every((f, i) => f === i * 12) && subj.at(-1) > subj.at(-2),
    "count_these lists the story's white bowl with its holder (R245, R247)": bowl?.expected === 1 && /Mio g17bk, right hand/.test(bowl.at_end ?? "") && /SNAP-R244, R245/.test(S.packet?.words?.count_these?.rule ?? ""),
    "the packet's sound says the boom (R249)": S.packet?.words?.sound?.onset?.hit === true && /a sub-bass hit at 0\.\d+ s/.test(S.packet.words.sound.onset.said ?? ""),
    "a duplicated story prop written low is stored high, raised said (R244)": note?.severity === "high" && /written low, raised to high: 2 white bowl where the story has 1/.test(note.raised ?? "") && S.write?.counts?.high === 1,
    "the count and sound passes are accepted": S.write?.passes?.count && S.write.passes.sound,
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify({ ...R, packet: { words: S.packet?.words, pictures: S.packet?.pictures?.map((p) => [p.role, p.frame, p.label]), error: S.packet?.error } }, null, 1));
  console.log(`g17bcritic ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
