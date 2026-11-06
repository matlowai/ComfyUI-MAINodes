// U97 the Book end to end, §11.5 steps 8-9 + the set plan (SNAP-R131, R132, R133) on the CPU test server, driven as an
// agent through the tools: a 2-cut production of short04's "Leaf Day" with its real pictures (Hiyori, Tomoshi, the
// shrine's master and P1 plate, the picked boards and cuts; original characters only):
// - Casts, a location, draw_set_plan (shapes + labels + camera marks: the picture holds shapes and labels only, the
//   record keeps the shapes and the marks), the Book, a production style with its still, two beats as accepted
//   proposals, two cuts with timing and transition;
// - make_board queues a New view per cut from its context (64 px on CPU) and its candidate lands in the cut's shot;
//   set_board picks the real board, approved;
// - the animatic: boards held for their seconds (4.5 + 3.75 s) in one video landed as a take of the Book; a kept take
//   replaces its board in the next animatic;
// - the Cut: active takes in telling order, C1 trimmed in 0.5 s and +6 dB, one mp4 (1280x704, sound 48 kHz) as a take,
//   and an OTIO file (video + audio tracks, two clips with take ids, markers C1 and C2);
// - the plan editor: a box drawn and labelled with the mouse is saved as a new location version.
// Screens: ui/u97/book_boards.png, book_the_cut.png, plan_editor.png, location_drawn_plan.png. usage: node test_book_cut.js [port] [base]
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = process.env.SHOTS || path.join(CFG.out, "ui", "u97");
const base = process.argv[3] || CFG.base;
const D = CFG.fixture("short04");
const FILES = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"];
const park = (dir) => { const p = path.join(base, "user", "default", "snap", dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(base, "user", "default", "snap", "_parked"), { recursive: true }); fs.renameSync(p, path.join(base, "user", "default", "snap", "_parked", `${dir.replaceAll("/", "_")}-${Date.now()}`)); } };
const probe = (f) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration:stream=codec_type,width,height,sample_rate", "-of", "json", f]).toString());
(async () => {
  fs.mkdirSync(out, { recursive: true });
  for (const d of ["book", "story", "look", "scenes", "takes", "location", "_archived/book", "_archived/story", "_archived/look", "_archived/location"]) park(d); // moved, never deleted
  const fin = path.join(base, "input", "snaptest_book"), fout = path.join(base, "output", "snaptest_book");
  for (const d of [fin, fout]) fs.mkdirSync(d, { recursive: true });
  for (const f of ["bible/hiyori_front_v1.png", "bible/tomoshi_front_v1.png", "settei_bg/MASTER_shrine_v1.png", "settei_bg/P1_torii_eyelevel.png", "boards/v1/7b0b164a_00001_.png", "boards/v1/30086b30_00001_.png"]) fs.copyFileSync(path.join(D, f), path.join(fin, path.basename(f)));
  for (const f of ["cuts/C1_pick.mp4", "cuts/C2_pick.mp4"]) fs.copyFileSync(path.join(D, f), path.join(fout, path.basename(f)));
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clear: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    // the Book's own assembly prompts run as they are (fwork turns every other prompt into a 64 px picture)
    await page.route(/\/(api\/)?prompt$/, (r) => (r.request().method() === "POST" && /MAISnapCut/.test(r.request().postData() ?? "") ? r.continue() : r.fallback()));
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const accept = (id) => page.evaluate(async (id) => { const p = await window.__P.decide(id, true, (n, a) => window.__X.callTool(n, a, { confirmed: true })); return { status: p?.status, result: p?.result }; }, id);
    // an assembly is a prompt of the Book's own group: read it back from the server's history
    const done = async (run) => { for (let i = 0; i < 240; i++) { const h = await F.history(port, run); if (h?.status?.completed || h?.status?.status_str === "error") { const v = Object.values(h.outputs ?? {}).flatMap((o) => o.images ?? []).find((m) => /\.mp4$/.test(m.filename) && /snap_book/.test(m.subfolder)); return { state: h.status.status_str === "success" ? "done" : "failed", file: v && `${v.subfolder}/${v.filename}`, messages: h.status.messages.filter((m) => m[0] === "execution_error") }; } await new Promise((r) => setTimeout(r, 500)); } return null; };
    const t0 = Date.now();
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    // the bible: two Casts and the shrine
    const hiyori = (await call("save_cast", { name: "Hiyori", details: "a fifteen-year-old shrine keeper in a white haori over red hakama, a short dark-teal bob with a brass bell clip on her left temple", refs: [{ file: "snaptest_book/hiyori_front_v1.png", role: "identity: front" }] })).cast;
    const tomoshi = (await call("save_cast", { name: "Tomoshi", details: "a small floating paper-lantern spirit with red lacquered rims and dot eyes", refs: [{ file: "snaptest_book/tomoshi_front_v1.png", role: "identity: front" }] })).cast;
    const loc = await call("save_location", { name: "Kogarashi Shrine", notes: "a gravel clearing in a cedar wood: red torii south, stone path north to the worship hall on three steps, two stone lanterns halfway", master: { file: "snaptest_book/MASTER_shrine_v1.png" },
      plates: [{ name: "P1 torii", file: "snaptest_book/P1_torii_eyelevel.png", role: "camera", pose: { x: 0.5, y: 0.86, heading: 0, eye_height: 1.2, lens: 35 } }] });
    const shrine = loc.location;
    R.plan = await call("draw_set_plan", { location: shrine, shapes: [
      { kind: "rect", x: 0.5, y: 0.9, w: 0.18, h: 0.04, label: "Torii" }, { kind: "line", x: 0.5, y: 0.86, x2: 0.5, y2: 0.2, width: 0.03, label: "stone path" },
      { kind: "rect", x: 0.5, y: 0.12, w: 0.3, h: 0.14, label: "Worship hall" }, { kind: "ellipse", x: 0.4, y: 0.5, w: 0.05, h: 0.05, label: "lantern" }, { kind: "ellipse", x: 0.6, y: 0.5, w: 0.05, h: 0.05, label: "lantern" },
      { kind: "rect", x: 0.18, y: 0.45, w: 0.12, h: 0.1, label: "Basin" }, { kind: "ellipse", x: 0.84, y: 0.42, w: 0.16, h: 0.16, label: "Camphor" }, { kind: "label", x: 0.5, y: 0.98, label: "south" }],
      cameras: [{ name: "C1", x: 0.5, y: 0.86, heading: 0, eye_height: 1.2, lens: 35 }, { name: "C2", x: 0.5, y: 0.6, heading: 0, eye_height: 1.2, lens: 50 }] });
    R.loc = await call("get_record", { ref: R.plan.ref });
    R.planFile = R.loc?.body?.plan?.file ?? R.loc?.plan?.file;
    // the Book, its style and two beats (proposals the person accepts)
    const book = (await call("create_book", { name: "Leaf Day", medium: "anime", logline: "A shrine keeper sweeps; a lantern spirit hides in the pile and makes amends.", cast: [hiyori, tomoshi], locations: [shrine] })).book;
    R.style = await call("save_style", { book, name: "Autumn painterly", paragraph: "A hand-painted 1990s TV anime frame with soft cel shading, warm dusk light, painterly cedar backgrounds and fine film grain.", palette: "full", still: { file: "snaptest_book/MASTER_shrine_v1.png" }, voice: "Japanese TV anime seiyuu delivery, dry and tired", genre: "iyashikei slice of life: gentle holds, small surprises" });
    for (const x of [{ text: "Hiyori sweeps orange leaves into a pile on the stone path between the lanterns.", changes: [{ entity: hiyori, path: "position", value: "on the path between the two stone lanterns" }, { entity: hiyori, path: "facing", value: "north, her back three-quarters to camera" }] },
      { text: "The leaf pile bursts and Tomoshi pops out; Hiyori jumps back, broom up.", changes: [{ entity: tomoshi, path: "position", value: "bursting out of the leaf pile" }, { entity: hiyori, path: "mood", value: "startled" }] }]) {
      const p = await call("add_beat", { book, ...x });
      R.beatAccept = [...(R.beatAccept ?? []), (await accept(p.proposed)).status];
    }
    const c1 = await call("add_cut", { book, scene_name: "Leaf Day", beats: ["b1"], cast: [hiyori], location: shrine, plate: "P1 torii", seconds: 4.5, transition: "cut in closer on the pile (match on action)", sound: "bamboo broom scratching on stone, leaves rustling, a crow cawing twice" });
    const c2 = await call("add_cut", { book, scene: c1.scene, beats: ["b2"], cast: [hiyori, tomoshi], location: shrine, plate: "P1 torii", seconds: 3.75, sound: "a leafy whoosh, a tiny squeak" });
    R.sheet1 = await call("compile_unit", { scene: c1.scene, shot: c1.shot });
    // boards: a New view per cut from its context (64 px here), then the real boards picked and approved
    R.mb1 = await call("make_board", { scene: c1.scene, shot: c1.shot, count: 1, method: "ph3_view" });
    R.mb2 = await call("make_board", { scene: c2.scene, shot: c2.shot, count: 1, method: "ph3_view" });
    R.mbPictures = R.mb1.pictures ?? R.mb1.context ?? null;
    let cand = null;
    for (let i = 0; i < 40 && !cand; i++) { await page.waitForTimeout(1500); cand = await page.evaluate((shot) => { const sc = window.__SC.all().flatMap((s) => s.shots).find((x) => x.id === shot); return sc ? window.__SC.takesOf(sc).map((e) => e.take).find((id) => window.__T.get(id)?.status === "success") ?? null : null; }, c1.shot); }
    R.candTake = cand;
    R.pickFromTake = cand ? await call("set_board", { scene: c1.scene, shot: c1.shot, take: cand }) : { error: "no candidate landed" };
    R.sb1 = await call("set_board", { scene: c1.scene, shot: c1.shot, file: "snaptest_book/7b0b164a_00001_.png", approved: true });
    R.sb2 = await call("set_board", { scene: c2.scene, shot: c2.shot, file: "snaptest_book/30086b30_00001_.png", approved: true });
    const ta = Date.now();
    R.anim = await call("animatic", { book });
    R.animDone = await done(R.anim.run);
    R.animSeconds = (Date.now() - ta) / 1000;
    const fileOf = (s) => s?.file ?? null;
    R.animFile = fileOf(R.animDone);
    R.animProbe = R.animFile && probe(path.join(base, "output", R.animFile));
    // kept takes for both cuts (the picked short04 renders), C1 active and kept: it replaces its board in the animatic
    R.kept = await page.evaluate(async ({ c1, c2 }) => {
      const T = window.__T, SC = window.__SC;
      const mk = async (c, file, n) => { const id = `take-book-${c.cut}`; await T.save({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 80, group: `book-test-${c.cut}`, number: n, status: "success", text: c.cut, seed: 1, media: [{ kind: "video", filename: file, subfolder: "snaptest_book", type: "output" }], prompt: {}, graph: {}, verdict: "keep", notes: [] });
        await SC.addGroup(c.scene, c.shot, `book-test-${c.cut}`); await SC.setActive(c.scene, c.shot, id, "person"); return id; };
      return [await mk(c1, "C1_pick.mp4", 1), await mk(c2, "C2_pick.mp4", 1)];
    }, { c1, c2 });
    await page.evaluate(async (id) => { const t = window.__T.get(id); t.verdict = null; await window.__T.save(t); }, R.kept[1]); // C2's take is active but not kept: its board stays
    R.anim2 = await call("animatic", { book });
    R.anim2Done = await done(R.anim2.run);
    // the Cut: C1 trimmed in 0.5 s and +6 dB, OTIO beside it
    R.trim = await call("set_unit", { scene: c1.scene, shot: c1.shot, trim: { in_s: 0.5, gain_db: 6 } });
    const tc = Date.now();
    R.cut = await call("export_cut", { book });
    R.cutDone = await done(R.cut.run);
    R.cutSeconds = (Date.now() - tc) / 1000;
    R.cutFile = fileOf(R.cutDone);
    R.cutProbe = R.cutFile && probe(path.join(base, "output", R.cutFile));
    R.otioPath = R.cut.otio?.file && path.join(base, "output", R.cut.otio.file.replace(/ \[output\]$/, ""));
    R.otio = R.otioPath && fs.existsSync(R.otioPath) ? JSON.parse(fs.readFileSync(R.otioPath, "utf8")) : null;
    for (let i = 0; i < 40 && !R.cutTake; i++) { R.cutTake = await page.evaluate((id) => { const t = window.__T.get(`take-${id}`); return t && { group: t.group, parent: t.parent }; }, R.cut.run); if (!R.cutTake) await page.waitForTimeout(500); } // the page writes the take once the run is done
    // screens: Boards with the animatic, the Cut, the plan editor (draw a box with the mouse, label it, save)
    await call("open_view", { view: "book", book, lens: "boards" }); await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, "book_boards.png") });
    await call("open_view", { view: "book", book, lens: "the_cut" }); await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, "book_the_cut.png") });
    R.cutText = await page.evaluate(() => document.querySelector(".snap-book-sheet")?.textContent ?? "");
    await call("open_view", { view: "book", book, lens: "settei" }); await page.waitForTimeout(1000);
    await page.click("button:has-text('Edit the plan')");
    await page.waitForSelector(".snap-plan-sheet canvas"); await page.waitForTimeout(500);
    await page.click(".snap-plan-tools button:has-text('Box')");
    const box = await page.locator(".snap-plan-canvas").boundingBox();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.7); await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.8, { steps: 5 }); await page.mouse.up();
    await page.fill(".snap-plan-row input", "Storehouse");
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(out, "plan_editor.png") });
    await page.click(".snap-plan-sheet button:has-text('Save the plan')"); await page.waitForTimeout(1500);
    R.afterDraw = await call("list_locations", {});
    R.drawn = R.afterDraw?.find?.((l) => l.location === shrine);
    await page.keyboard.press("Escape");
    await call("open_view", { view: "location", location: shrine }); await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(out, "location_drawn_plan.png") });
    R.wall = (Date.now() - t0) / 1000;
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {}); // G3: never leave Let agents run on for the next suite (LESSONS G1b)
    await b.close();
    for (const f of made) { const to = path.join(base, "_parked_placeholders", `${path.basename(f)}-${Date.now()}`); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); } // moved, never deleted
  }
  const S = R, dur = (p) => +(p?.format?.duration ?? 0), has = (p, k) => p?.streams?.some((s) => s.codec_type === k);
  const otioClips = S.otio?.tracks?.children?.[0]?.children ?? [];
  const checks = {
    planDrawn: S.plan?.made && S.plan.shapes === 8 && S.plan.cameras === 2 && /^snap\/location\/location-[\w]+\/plan-[0-9a-f]{12}\.png$/.test(S.plan.plan ?? ""),
    planKeptShapes: (S.loc?.body?.plan?.shapes ?? S.loc?.plan?.shapes ?? []).length === 8,
    beatsAccepted: S.beatAccept?.join() === "accepted,accepted",
    compiled: S.sheet1?.prompt?.sentences?.some((x) => /Hiyori is on the path between the two stone lanterns/.test(x.text)) && S.sheet1?.place?.plate === "P1 torii" && S.sheet1?.still_prompt?.startsWith("A hand-painted 1990s TV anime frame"),
    boardsQueued: !!S.mb1?.decision && !!S.mb2?.decision && !S.mb1?.proposed && /<Picture 1> is this cut's camera on the place: keep its framing\. Hiyori is <Picture 2>\./.test(S.mb1?.prompt ?? "") && /Tomoshi is <Picture \d>/.test(S.mb2?.prompt ?? "") && /Tomoshi is a small floating paper-lantern spirit/.test(S.mb2?.prompt ?? ""),
    candidateLanded: !!S.candTake && /snaptest|png/.test(JSON.stringify(S.pickFromTake?.board ?? "")),
    boardsApproved: S.sb1?.board?.approved === true && S.sb2?.board?.file === "snaptest_book/30086b30_00001_.png",
    animatic: S.animDone?.state === "done" && Math.abs(dur(S.animProbe) - 8.25) < 0.15 && S.animProbe?.streams?.find((s) => s.codec_type === "video")?.width === 1280,
    keptReplacesBoard: JSON.stringify(S.anim2?.clips?.map((c) => [c.cut, c.from])) === JSON.stringify([["C1", "take"], ["C2", "board"]]) && S.anim2Done?.state === "done",
    cutAssembled: S.cutDone?.state === "done" && Math.abs(dur(S.cutProbe) - (4.4583 - 0.5 + 3.75)) < 0.15 && has(S.cutProbe, "audio") && S.cutProbe.streams.find((s) => s.codec_type === "audio")?.sample_rate === "48000",
    cutIsBookTake: /^book-book-/.test(S.cutTake?.group ?? "") && S.cutTake?.parent?.method === "book/cut",
    otio: S.otio?.OTIO_SCHEMA === "Timeline.1" && otioClips.length === 2 && otioClips[0].metadata?.snap?.take === "take-book-C1" && S.otio.tracks.markers?.map((m) => m.name).join() === "C1,C2" && otioClips[0].source_range.start_time.value === 12,
    editorSaved: S.drawn?.plan?.shapes?.length === 9 && S.drawn.plan.shapes.some((s) => s.label === "Storehouse"),
    cutLensShowsTrim: /C1/.test(S.cutText ?? "") && !/\bnull\b/.test(S.cutText ?? ""),
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_book_cut_result.json"), JSON.stringify(R, null, 1));
  console.log(`book_cut ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
