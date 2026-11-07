// Batch G10 (the studio-0784cab findings F-S01..F-S14) on the CPU test server:
// - SNAP-R185 (F-S07): a still in a Book cut's shot is a board, never the cut's active take: after an edit or a board lands
//   there the answer's next names set_board (in_a_cut says why); apply_candidate from an agent is refused naming the
//   set_board call, before it can wait as a proposal; the person's Apply puts the still in the cut's board slot (a key
//   candidate in the key slot) and leaves the cut's video take active; Undo puts the old board back;
// - SNAP-R186 (F-S02): a New view whose Picture 1 is a location's plate lands with that place (the shot of the take the
//   plate came from), not in the open shot of another production; a place no shot holds is refused naming land;
// - SNAP-R187 (F-S03): open_view {view: "room"} on a page showing the graph switches to Snap first and says what it shows;
// - SNAP-R188 (F-S12): a critic owner names a plate by its whole name before a label two plates share ("Pc square from
//   gate eye" is not "Pc square N row"); a shared label alone is ambiguous (unmapped); a unique label still works;
// - SNAP-R180 amended: a critic's "board" owner on a take drawn from another cut's board names that cut and its take,
//   and a take drawn from its own cut's board names its own cut;
// - SNAP-R189 (F-S05): a key board whose state takes a thing out of a hand says it is absent even where its context
//   pictures show it (and the Cast picture for a Cast line clause), lints it, pins the list on the board, and the board's
//   critic packet lists it under should_be_absent;
// - SNAP-R190 (F-S04): edit_from_context paste_back edits Picture 1's crop and pastes it back over the whole picture with a
//   feathered edge (run on CPU with the model swapped for an invert: outside the crop the picture is unchanged);
// - F-S01: set_board takes the start of a take id; make_board's context {take, keep} keeps what it is told; F-S14:
//   list_critiques {critique} reads one row back with its amend chain (and the scale pass is taken); F-S06/F-S13 hold;
//   F-S11: the Room's Then list asks each sentence once; F-S08: add_plate's dry run names a take by its id's start too.
// usage: node test_g10.js [port] [base]   prints "g10 n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const D = CFG.fixture("short04"), snap = path.join(base, "user", "default", "snap");
const park = (dir) => { const p = path.join(snap, dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${dir.replaceAll("/", "_")}-g10-${Date.now()}`)); } };
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "location", "candidates", "critiques", "proposals.json"]) park(d); // moved, never deleted
  const fx = path.join(base, "input", "snaptest_g10");
  fs.mkdirSync(fx, { recursive: true });
  for (const f of ["bible/hiyori_front_v1.png", "bible/tomoshi_front_v1.png", "settei_bg/MASTER_shrine_v1.png", "settei_bg/P1_torii_eyelevel.png"]) fs.copyFileSync(path.join(D, f), path.join(fx, path.basename(f)));
  // P-H3's weights as empty placeholders, as test_u101 does: New view queues, and fwork turns the prompt into a 64 px one
  const made = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"].map((x) => path.join(base, "models", x)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const mod = (file, fn, arg) => page.evaluate(async ([file, src, arg]) => { const M = await import(`/extensions/ComfyUI-MAINodes/snap/${file}`); return (new Function("M", "arg", `return (${src})(M, arg)`))(M, arg); }, [file, fn.toString(), arg]);
    const waitTake = (id) => page.evaluate(async (id) => { for (let i = 0; i < 240 && !window.__T.get(id); i++) await new Promise((r) => setTimeout(r, 500)); const t = window.__T.get(id); return t && { id: t.id, story: t.story ?? null, media: t.media.map((m) => m.kind) }; }, id);
    const waitReady = (d) => page.evaluate(async (d) => { for (let i = 0; i < 240; i++) { await window.__C.load(); const x = window.__C.get(d); if (x?.candidates.every((c) => c.state === "ready")) return true; await new Promise((r) => setTimeout(r, 500)); } return false; }, d);
    const mayRun = (on) => page.evaluate(async (on) => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", on); }, on);
    const unitOf = (c) => mod("book.js", (B, c) => B.unitOf(c.scene, c.shot).unit, c);
    const shotOf = (c) => mod("scenes.js", async (SC, c) => { await SC.load(); const s = SC.shotOf(SC.get(c.scene), c.shot); return { active: s.active ?? null, takes: s.takes.map((e) => e.take) }; }, c);
    const takeOf = (d) => (d?.candidates?.[0]?.prompt_id ? `take-${d.candidates[0].prompt_id}` : null);
    await mayRun(true);
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const mio = (await call("save_cast", { name: "Mio Hayase", details: "a 17-year-old girl ramen cook, a dark green apron, a steel ladle in her right hand", refs: [{ file: "snaptest_g10/hiyori_front_v1.png", role: "identity: front" }] })).cast;
    const kuroe = (await call("save_cast", { name: "Baron Kuroe", details: "a tall thin elderly gourmet critic, a round gold monocle on his right eye", refs: [{ file: "snaptest_g10/tomoshi_front_v1.png", role: "identity: front" }] })).cast;
    const place = (await call("save_location", { name: "Hayase Yatai", master: { file: "snaptest_g10/MASTER_shrine_v1.png" }, plates: [{ name: "P2 counter", file: "snaptest_g10/P1_torii_eyelevel.png" }] })).location;
    const book = (await call("create_book", { name: "One More Bowl", medium: "anime", cast: [mio, kuroe], locations: [place] })).book;
    await mod("book.js", async (B, { book, mio, kuroe }) => {
      const st = B.storyOf(B.bookOf(book).body);
      await B.saveStory(st.id, { title: "One More Bowl", props: [{ id: "ladle", name: "the ladle" }, { id: "bowl", name: "the bowl" }], beats: [
        { id: "b1", order: 1, told: 1, text: "Mio ladles broth into a bowl.", changes: [{ entity: mio, path: "carried.right_hand", op: "set", value: "prop:ladle" }, { entity: "prop:bowl", path: "holder", op: "set", value: mio }] },
        { id: "b2", order: 2, told: 2, text: "Mio sets the full bowl down on the counter in front of Kuroe with both hands and grins.", changes: [{ entity: mio, path: "carried.right_hand", op: "remove", value: "prop:ladle" }, { entity: "prop:bowl", path: "holder", op: "set", value: "on the counter in front of Kuroe" }] }] }, { note: "written by the person" });
    }, { book, mio, kuroe });
    const c1 = await call("add_cut", { book, scene_name: "Night", beats: ["b1"], cast: [mio, kuroe], props: ["prop:bowl"], location: place, plate: "P2 counter", seconds: 4 });
    const c2 = await call("add_cut", { book, scene: c1.scene, beats: ["b2"], cast: [mio, kuroe], props: ["prop:bowl"], location: place, plate: "P2 counter", seconds: 4 });
    R.cuts = [c1.cut, c2.cut];

    // C2's active take is a video (as the Cut's is)
    const video = "take-g10video";
    await mod("scenes.js", async (SC, { c2, video }) => {
      await SC.load(); const shot = SC.shotOf(SC.get(c2.scene), c2.shot); let g = shot.groups[0];
      if (!g) { g = crypto.randomUUID(); await SC.addGroup(c2.scene, c2.shot, g); }
      await window.__T.save({ id: video, kind: "run", prompt_id: video.slice(5), created: Date.now(), seconds: 4, group: g, number: 1, status: "success", text: "C2's video", seed: 1, media: [{ kind: "video", filename: "g10.mp4", subfolder: "", type: "output" }], prompt: {}, graph: {}, verdict: null, notes: [] });
      await SC.setActive(c2.scene, c2.shot, video, "person");
    }, { c2, video });

    // ---- C1's board (approved), so C2 can be drawn from it ----
    R.mb1 = await call("make_board", { scene: c1.scene, shot: c1.shot, count: 1, seeds: [9111], method: "ph3_view" });
    const t1 = takeOf(R.mb1); await waitTake(t1); await waitReady(R.mb1.decision);
    R.set1 = await call("set_board", { scene: c1.scene, shot: c1.shot, take: t1, approved: true });

    // ---- F-S05: C2's key board says the ladle is absent even where its context and Mio's Cast picture show it ----
    R.s2 = await call("compile_unit", { scene: c2.scene, shot: c2.shot });
    R.mbKey = await call("make_board", { scene: c2.scene, shot: c2.shot, count: 1, seeds: [9221], method: "ph3_view", context: [{ cut: "C1" }] });
    const tk = takeOf(R.mbKey); R.keyTake = await waitTake(tk); await waitReady(R.mbKey.decision);
    const crow = (await call("critique", { take: tk })).critique;
    R.pk = crow && await call("critique_packet", { critique: crow, part: "context" });
    // F-S14: one written critique read back by its id, with the row that amends it
    if (crow) { await page.evaluate(async (c) => { const CR = await import("/extensions/ComfyUI-MAINodes/snap/critiques.js"); await CR.load(); }, crow);
      await call("claim_critique", { critique: crow }); await call("write_critique", { critique: crow, verdict: "flaws", passes: { beat: "the ladle", scale: "no scale on record" }, notes: [{ severity: "high", pass: "beat", text: "the ladle is back in Mio's right hand", owner: "board" }] });
      R.amended = await call("write_critique", { critique: crow, amend: true, verdict: "flaws", passes: { beat: "the ladle" }, notes: [{ severity: "high", pass: "beat", text: "the ladle is back in Mio's right hand, from C1's board", owner: "board" }] });
      R.readBack = await call("list_critiques", { critique: crow }); }
    if (R.pk?.images) R.pk.images = R.pk.images.length; // the pictures' bytes stay out of the result file

    // ---- F-S07: an edit of the key board lands in C2's shot; apply_candidate refuses it; the person's pick is a board ----
    R.edit = await call("edit_from_context", { pictures: [{ take: tk }, { cast: kuroe }], prompt: "Change only the eyewear on <Picture 1>: a single round gold monocle.", purpose: "edit", count: 1, seeds: [9301] });
    const te = takeOf(R.edit); await waitTake(te); await waitReady(R.edit.decision);
    R.unitBefore = await unitOf(c2);
    await mayRun(false);
    const proposals = () => page.evaluate(async () => { await window.__P.load?.(); return (window.__P.all?.() ?? []).length; });
    R.propsBefore = await proposals();
    R.refusedAsk = await call("apply_candidate", { decision: R.edit.decision, candidate: "c1" });
    R.propsAfter = await proposals();
    await mayRun(true);
    R.refusedRun = await call("apply_candidate", { decision: R.edit.decision, candidate: "c1" });
    R.shotAfterRefusal = await shotOf(c2);
    R.personPick = await page.evaluate(async (d) => window.__C.apply(d, "c1", "person").catch((e) => ({ error: e.message })), R.edit.decision);
    R.unitPicked = await unitOf(c2); R.shotPicked = await shotOf(c2);
    R.personUndo = await page.evaluate(async (d) => window.__C.undo(d, "person").catch((e) => ({ error: e.message })), R.edit.decision);
    R.unitUndone = await unitOf(c2);
    R.keyPick = await page.evaluate(async (d) => window.__C.apply(d, "c1", "person").catch((e) => ({ error: e.message })), R.mbKey.decision);
    R.unitKey = await unitOf(c2);

    // ---- F-S01: set_board with the start of a take id ----
    R.setShort = await call("set_board", { scene: c2.scene, shot: c2.shot, take: te.slice(0, 13), role: "opening" });
    R.unitShort = await unitOf(c2);

    // ---- SNAP-R180 amended: the board a critic's "board" owner names ----
    R.ownC1 = await mod("critiques.js", async (CR, tk) => { await CR.load(); return CR.ownerOf({ subject: { kind: "take", take: tk } }, "board", "the ladle is back"); }, tk);
    await call("set_board", { scene: c2.scene, shot: c2.shot, take: te, approved: true });
    R.mbOwn = await call("make_board", { scene: c2.scene, shot: c2.shot, count: 1, seeds: [9222], method: "ph3_view", role: "opening", context: [{ take: te, keep: "keep its blocking: who stands or sits where" }] });
    R.mbOwnCut = await call("make_board", { scene: c2.scene, shot: c2.shot, count: 1, seeds: [9223], method: "ph3_view", role: "opening" });
    const to = takeOf(R.mbOwnCut); await waitTake(to);
    R.ownC2 = await mod("critiques.js", async (CR, to) => { await CR.load(); return CR.ownerOf({ subject: { kind: "take", take: to } }, "board", ""); }, to);

    // ---- F-S12: plate owners by whole name ----
    const v = await call("add_plate", { location: place, plates: [{ name: "Pc square N row", file: "snaptest_g10/P1_torii_eyelevel.png" }, { name: "Pc square from gate eye", file: "snaptest_g10/MASTER_shrine_v1.png" }, { name: "Pb gate inside", file: "snaptest_g10/P1_torii_eyelevel.png" }] });
    R.owners = await mod("critiques.js", async (CR, ref) => { await CR.load(); const r = { subject: { kind: "record", ref, part: "master" } };
      return ["plate Pc square from gate eye", "plate Pc square N row", "plate Pc", "plate Pb", "plate Pc square from gate eye and plate Pb gate inside"].map((w) => CR.ownerOf(r, w, "")); }, v.ref ?? `${place}@${v.version}`);

    // ---- F-S02: a New view of a plate lands with the place, not in the open shot of another production ----
    const walk = await call("create_scene", { name: "Hayase Yatai plates" }), wscene = walk.scene ?? walk.id;
    R.walk = await call("add_shot", { scene: wscene, name: "plates" });
    const wshot = R.walk.shot?.id ?? R.walk.shot;
    // the place's only takes are the cuts' boards: a plate view with no land is refused rather than put in a cut
    R.wvNoLand = await call("edit_from_context", { pictures: [{ location: place, plate: "P2 counter" }], prompt: "<Picture 1> from the same eye height, with the counter's lantern lit.", purpose: "plate", count: 1 });
    R.wv = await call("edit_from_context", { pictures: [{ location: place, plate: "P2 counter" }], prompt: "<Picture 1> from the same eye height, with the counter's lantern lit.", purpose: "plate", count: 1, seeds: [9401], land: { scene: wscene, shot: wshot } });
    const tw = takeOf(R.wv); await waitTake(tw); await waitReady(R.wv.decision);
    R.plateDry = await call("add_plate", { location: place, name: "Pd E row eye", take: tw, dry_run: true }); R.tw = tw;
    R.plate = await call("add_plate", { location: place, name: "Pd E row eye", take: tw });
    await call("open_shot", { scene: c1.scene, shot: c1.shot }); await page.waitForTimeout(1500);
    R.pd = await call("edit_from_context", { pictures: [{ location: place, plate: "Pd E row eye" }], prompt: "Change only the palisade on <Picture 1>: lower it.", purpose: "edit", count: 1, seeds: [9402] });
    const lonely = (await call("save_location", { name: "G10 lonely", master: { file: "snaptest_g10/MASTER_shrine_v1.png" } })).location;
    R.lonely = await call("edit_from_context", { pictures: [{ location: lonely }], prompt: "<Picture 1> at night.", purpose: "set", count: 1 });
    R.lonelyLand = await call("edit_from_context", { pictures: [{ location: lonely }], prompt: "<Picture 1> at night.", purpose: "set", count: 1, land: { scene: wscene, shot: wshot } });
    R.wscene = { scene: wscene, shot: wshot };

    // ---- F-S04: a region edit pastes its crop back over the whole picture (the graph run on CPU with P-H3 swapped for an
    // invert, so the core crop, scale, feather and composite nodes run for real) ----
    const sent = [];
    await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") sent.push(JSON.parse(r.request().postData())); return r.fallback(); });
    const crop = [0.3, 0.1, 0.4, 0.3];
    R.paste = await call("edit_from_context", { pictures: [{ file: "snaptest_g10/hiyori_front_v1.png", crop }], prompt: "Change only the eyes on <Picture 1>: closed.", purpose: "edit", method: "ph3_view", count: 1, seeds: [9501], paste_back: true, land: { scene: wscene, shot: wshot } });
    R.pasteNoCrop = await call("edit_from_context", { pictures: [{ file: "snaptest_g10/hiyori_front_v1.png" }], prompt: "x", method: "ph3_view", count: 1, paste_back: true, land: "tab" });
    R.pasteFizgig = await call("edit_from_context", { pictures: [{ file: "snaptest_g10/hiyori_front_v1.png", crop }], prompt: "x", method: "fizgig_still", count: 1, paste_back: true, land: "tab" });
    await page.waitForTimeout(1500);
    const g = sent.map((x) => x.prompt).find((x) => x?.rc);
    R.pasteNodes = g && Object.fromEntries(["r0s", "rb", "rm", "rf", "rc", "o"].map((k) => [k, g[k]]));
    if (g) {
      for (const k of ["1", "2", "3", "4", "p", "g", "r", "s", "m", "k"]) delete g[k];
      g.d = { class_type: "ImageInvert", inputs: { image: ["r0s", 0] } }; g.o.inputs.filename_prefix = "snaptest/g10paste";
      const id = (await (await fetch(`http://127.0.0.1:${port}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: g }) })).json()).prompt_id;
      let h = null; for (let i = 0; i < 120 && !h; i++) { await new Promise((r) => setTimeout(r, 500)); h = (await (await fetch(`http://127.0.0.1:${port}/history/${id}`)).json())[id]; }
      const img = h?.outputs?.o?.images?.[0];
      R.pasteOut = img ?? h?.status ?? null;
      if (img) R.pasteMeasure = JSON.parse(require("child_process").execFileSync("python3", ["-c", `
import json, sys
from PIL import Image, ImageChops
a = Image.open(sys.argv[1]).convert("RGB"); b = Image.open(sys.argv[2]).convert("RGB")
W, H = a.size; x, y, w, h = [round(v) for v in (${crop[0]} * W, ${crop[1]} * H, ${crop[2]} * W, ${crop[3]} * H)]
d = ImageChops.difference(a, b)
out = d.copy(); out.paste((0, 0, 0), (x, y, x + w, y + h))
inner = d.crop((x + w // 4, y + h // 4, x + 3 * w // 4, y + 3 * h // 4))
print(json.dumps({"same_size": a.size == b.size, "outside_max": max(c[1] for c in out.getextrema()), "inside_mean": sum(sum(i * n for i, n in enumerate(ch)) / max(1, sum(ch)) for ch in [inner.histogram()[k * 256:(k + 1) * 256] for k in range(3)]) / 3}))
`, path.join(base, "input", "snaptest_g10", "hiyori_front_v1.png"), path.join(base, "output", img.subfolder, img.filename)]).toString());
    }

    // ---- F-S03: open_view room from the graph ----
    await call("ui", { action: "graph" }); await page.waitForTimeout(800);
    R.before = await page.evaluate(() => window.__X.ui?.read?.() ?? null).catch(() => null);
    R.room = await call("open_view", { view: "room" }); await page.waitForTimeout(1200);
    R.roomShown = await page.locator(".snap-room").isVisible().catch(() => false);
    // F-S11: a question in the same words as one above waits behind it
    R.thenLines = await page.locator(".snap-room-next .snap-room-line").allTextContents().catch(() => []);
    R.topAsk = await page.locator(".snap-room-q h2").first().textContent().catch(() => null);
    R.picks = await page.evaluate(async () => { const A = await import("/extensions/ComfyUI-MAINodes/snap/activity.js"), RM = await import("/extensions/ComfyUI-MAINodes/snap/room.js"); await A.reconcile(); return A.all().filter((r) => r.source === "decision").map((r) => RM.ask(r).q); }).catch(() => []);
    fs.mkdirSync(path.join(CFG.out, "ui", "g10"), { recursive: true });
    await page.screenshot({ path: path.join(CFG.out, "ui", "g10", "room_from_graph.png") });
    await page.locator(".snap-room button", { hasText: "Back to Snap" }).click().catch(() => {});
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
  }
  const S = R, kp = S.s2?.board?.prompt ?? "", own = S.owners ?? [], refused = (x) => /set_board \{scene: "[^"]+", shot: "[^"]+", take: "take-[^"]+"\}/.test(x?.error ?? "") && /active take of C2, a cut of the Book whose active take is take 1 \(its video\)/.test(x?.error ?? "");
  const checks = {
    cutsNumbered: JSON.stringify(S.cuts) === '["C1","C2"]',
    // F-S06, F-S13 (G9, checked live-shaped): a two-Cast board keeps the character purpose; its packet names both
    keyPurposeCharacter: S.mbKey?.chosen?.purpose === "character",
    keyPacketCast: JSON.stringify([...(S.pk?.words?.who_should_be_here ?? [])].sort()) === '["Baron Kuroe","Mio Hayase"]',
    // F-S14
    readOneCritique: S.readBack?.rows?.[0]?.critique === S.readBack?.rows?.[1]?.supersedes && S.readBack?.count === 2 && !!S.readBack.rows[0].superseded_by && !S.amended?.error,
    // F-S07
    editHintsSetBoard: /set_board \{scene: "/.test(S.edit?.next ?? "") && !/apply_candidate/.test(S.edit?.next ?? "") && /a cut of the Book: a still there is a board candidate/.test(S.edit?.in_a_cut ?? ""),
    editLandsInCut: /C2/.test(S.edit?.lands ?? ""),
    refusedBeforeProposal: refused(S.refusedAsk) && !S.refusedAsk?.proposed && S.propsAfter === S.propsBefore,
    refusedWhenAgentsRun: refused(S.refusedRun),
    activeStaysVideo: S.shotAfterRefusal?.active === "take-g10video" && S.shotPicked?.active === "take-g10video",
    personPickIsBoard: !S.personPick?.error && S.unitPicked?.board?.from?.take === S.edit?.candidates?.[0]?.take && !S.unitPicked?.board?.approved && /is now C2's board \(not approved yet/.test(S.personPick?.said ?? "") && /active take stays take 1/.test(S.personPick?.said ?? ""),
    undoPutsBoardBack: !S.personUndo?.error && JSON.stringify(S.unitUndone?.board ?? null) === JSON.stringify(S.unitBefore?.board ?? null),
    keyPickIsKey: !S.keyPick?.error && S.unitKey?.key?.from?.take === S.keyTake?.id && /C2's key drawing/.test(S.keyPick?.said ?? ""),
    // F-S01
    setBoardIdStart: !S.setShort?.error && S.unitShort?.board?.from?.take === S.edit?.candidates?.[0]?.take,
    // F-S05
    keyPromptSaysAbsent: /Mio Hayase is without the ladle in this frame, even where <Picture \d+>( and <Picture \d+>)* shows? it\./.test(kp),
    keyPromptCitesContextAndCast: (() => { const m = kp.match(/Mio Hayase is without [^.]*even where ([^.]*) shows? it\./); const n = m ? [...m[1].matchAll(/<Picture (\d+)>/g)].map((x) => +x[1]) : []; const pics = S.s2?.board?.pictures ?? []; return n.some((k) => /board/.test(pics[k - 1]?.label ?? "")) && n.some((k) => /^cast: Mio Hayase/.test(pics[k - 1]?.label ?? "")) && !n.some((k) => /Kuroe/.test(pics[k - 1]?.label ?? "")); })(),
    absentLinted: (S.s2?.board?.lint ?? []).some((x) => /may show the ladle with Mio Hayase, which the state leaves out here \(b2, carried\.right_hand\)/.test(x)),
    makeBoardSaysAbsent: /Mio Hayase is without the ladle/.test(S.mbKey?.prompt ?? "") && (S.mbKey?.lint ?? []).length > 0,
    keyPinsAbsent: (S.keyTake?.story?.absent ?? []).some((a) => a.who === "Mio Hayase" && /ladle/.test(a.thing)),
    packetShouldBeAbsent: (S.pk?.words?.should_be_absent?.things ?? []).some((a) => a.who === "Mio Hayase" && /ladle/.test(a.thing)) && /mismatch with the state/.test(S.pk?.words?.should_be_absent?.said ?? ""),
    takeContextKeeps: /<Picture 2> is take \d+: keep its blocking: who stands or sits where\./.test(S.mbOwn?.prompt ?? ""),
    // SNAP-R180 amended
    boardOwnerOtherCut: S.ownC1?.what === "board" && S.ownC1?.cut === "C1" && S.ownC1?.label === "C1's approved board" && S.ownC1?.take === S.set1?.board?.from?.take,
    boardOwnerOwnCut: S.ownC2?.what === "board" && S.ownC2?.cut === "C2" && /^C2's approved board$/.test(S.ownC2?.label ?? ""),
    // F-S12
    wholeNameWins: own[0]?.part === "plate Pc square from gate eye" && !own[0]?.parts && own[1]?.part === "plate Pc square N row" && !own[1]?.parts,
    sharedLabelAmbiguous: own[2]?.part === null && /"Pc" starts several plates \(Pc square N row, Pc square from gate eye\)/.test(own[2]?.unmapped ?? ""),
    uniqueLabelWorks: own[3]?.part === "plate Pb gate inside" && JSON.stringify(own[4]?.parts) === '["plate Pc square from gate eye","plate Pb gate inside"]',
    // F-S02
    plateViewNotInACut: /no shot holds that record's work/.test(S.wvNoLand?.error ?? "") && /plates of Hayase Yatai plates/.test(S.wv?.lands ?? ""),
    plateEditLandsWithPlate: /Hayase Yatai plates/.test(S.pd?.lands ?? "") && /where Hayase Yatai, plate Pd E row eye's work is/.test(S.pd?.lands ?? "") && !/Night/.test(S.pd?.lands ?? ""),
    lonelyRefused: /no shot holds that record's work/.test(S.lonely?.error ?? "") && /give land \{scene, shot\}/.test(S.lonely?.error ?? "") && !S.lonelyLand?.error,
    // F-S04
    pasteGraph: S.pasteNodes?.r0s?.inputs?.megapixels === 1 && S.pasteNodes?.rc?.class_type === "ImageCompositeMasked" && JSON.stringify(S.pasteNodes?.o?.inputs?.images) === '["rc",0]' && S.pasteNodes?.rf?.inputs?.left > 0 && !S.paste?.error,
    pastedWholeKeepsOutside: S.pasteMeasure?.same_size === true && S.pasteMeasure.outside_max === 0 && S.pasteMeasure.inside_mean > 40,
    pasteNeedsCropAndPH3: /give Picture 1 a crop/.test(S.pasteNoCrop?.error ?? "") && /paste_back runs on P-H3-Image/.test(S.pasteFizgig?.error ?? ""),
    // F-S08
    dryRunNamesTakeId: JSON.stringify(S.plateDry ?? {}).includes(`saved into input/ by the real call; ${(S.tw ?? "?").slice(0, 13)})`),
    // F-S11
    roomFoldsSameQuestion: (S.picks ?? []).length > new Set(S.picks).size && S.thenLines.length > 0 && new Set([S.topAsk, ...S.thenLines]).size === S.thenLines.length + 1,
    // F-S03
    roomFromGraph: S.room?.showing?.view?.startsWith("snap") && S.room?.showing?.room === true && /^the Room is open/.test(S.room?.said ?? "") && S.roomShown === true,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g10_result.json"), JSON.stringify(R, null, 1));
  console.log(`g10 ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
