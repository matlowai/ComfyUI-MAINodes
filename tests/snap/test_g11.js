// Batch G11 (the short05 C2 findings F-U01..F-U06 and the G10 builder's F-T02) on the CPU test server:
// - SNAP-R191 (F-T02): a region edit's candidates get a seam note: the graph's MAISnapSeam reads each edge of the crop
//   past the feather; a thin strip redrawn inside (the chain) breaks the top and bottom edges only, with crop_to_try
//   one and a half crops further on those sides (G12; half in G11); an edit that keeps the crop's pixels says "no break". The P-H3 model is swapped
//   for core nodes (a red strip composited over Picture 1's crop), so the crop, scale, feather, paste and seam nodes run;
//   the chip on the candidate tile says it;
// - SNAP-R192 (F-U03): a packet shows a cropped picture as the model got it (the crop's pixels, its px box), then the
//   whole it was cut from as context;
// - SNAP-R194 (F-U04): an edit's packet in a Book cut carries the cut's Cast: a Cast the take doesn't pin joins the pins
//   (not_pinned says where from), who_should_be_here names both, and its Cast picture is in the context;
// - SNAP-R193 (F-U05): zooms at 100 % (and 2x when small) come last: over a region edit's pasted crop, over where a
//   plain edit changed its Picture 1, and over a region asked for; asked zooms stay on the row (a later call keeps the
//   numbers); a note drawn on a zoom maps back into the subject; a zoom by name says what it found or why it couldn't;
// - SNAP-R195 (F-U06): compact critique rows carry the take id's start, the decision and a title without the prompt;
//   list_critiques filters by decision; the whole title stays on the row;
// - SNAP-R196 (F-U01): use_take {as: cast, replace} puts a fixed picture in place of a Cast's picture as a new version,
//   role kept, the old one in the version before; a bad number says what there is; with propose it waits for the person;
//   the New view tray offers "paste it back" for a marked region on P-H3-Image.
// usage: node test_g11.js [port] [base]   prints "g11 n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const D = CFG.fixture("short04"), snap = path.join(base, "user", "default", "snap");
const park = (dir) => { const p = path.join(snap, dir); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${dir.replaceAll("/", "_")}-g11-${Date.now()}`)); } };
const shots = path.join(CFG.out, "ui", "g11");
(async () => {
  for (const d of ["book", "story", "look", "scenes", "takes", "cast", "location", "candidates", "critiques", "proposals.json"]) park(d); // moved, never deleted
  const fx = path.join(base, "input", "snaptest_g11");
  fs.mkdirSync(fx, { recursive: true });
  for (const f of ["bible/hiyori_front_v1.png", "bible/tomoshi_front_v1.png", "settei_bg/MASTER_shrine_v1.png", "settei_bg/P1_torii_eyelevel.png"]) fs.copyFileSync(path.join(D, f), path.join(fx, path.basename(f)));
  // P-H3's weights as empty placeholders, as test_u101 does: New view queues, and the route below runs its graph on core nodes
  for (const f of ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"].map((x) => path.join(base, "models", x)).filter((f) => !fs.existsSync(f))) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  fs.mkdirSync(shots, { recursive: true });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const mod = (file, fn, arg) => page.evaluate(async ([file, src, arg]) => { const M = await import(`/extensions/ComfyUI-MAINodes/snap/${file}`); return (new Function("M", "arg", `return (${src})(M, arg)`))(M, arg); }, [file, fn.toString(), arg]);
    const waitReady = (d) => page.evaluate(async (d) => { for (let i = 0; i < 240; i++) { await window.__C.load(); const x = window.__C.get(d); if (x?.candidates.every((c) => c.state === "ready" || c.state === "failed")) return x.candidates.map((c) => c.state); await new Promise((r) => setTimeout(r, 500)); } return null; }, d);
    const waitTake = (id) => page.evaluate(async (id) => { for (let i = 0; i < 240 && !window.__T.get(id); i++) await new Promise((r) => setTimeout(r, 500)); return !!window.__T.get(id); }, id);
    const mayRun = (on) => page.evaluate(async (on) => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", on); }, on);
    // the New view graphs run on core nodes: P-H3's sampler is swapped for Picture 1 (or its 1 MP crop) with a red strip
    // drawn down it at seed 9511 / 9531, left as it is at 9512 (registered after fwork's route, so it runs first)
    const strip = (x, y) => ({ st: { class_type: "EmptyImage", inputs: { width: 8, height: 4096, batch_size: 1, color: 16711680 } }, d: { class_type: "ImageCompositeMasked", inputs: { destination: null, source: ["st", 0], x, y, resize_source: false } } });
    await page.route(/\/(api\/)?prompt$/, (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      const body = JSON.parse(r.request().postData()), g = body.prompt, seed = g?.r?.inputs?.noise_seed;
      if (g?.p?.class_type !== "PH3ImageConditioning" || ![9511, 9512, 9513, 9531].includes(seed)) return r.fallback();
      for (const k of ["1", "2", "3", "4", "p", "g", "r", "s", "m", "k"]) delete g[k];
      const from = g.r0s ? ["r0s", 0] : ["c0l", 0];
      if (seed === 9512) g.d = { class_type: "ImageInvert", inputs: { image: from } }; // the whole crop redrawn
      else if (seed === 9513) Object.assign(g, { d0: { class_type: "ImageInvert", inputs: { image: from } }, d: { class_type: "ImageInvert", inputs: { image: ["d0", 0] } } }); // nothing changed
      else { Object.assign(g, strip(seed === 9531 ? 300 : 400, seed === 9531 ? 500 : 0)); g.d.inputs.destination = from; if (seed === 9531) g.st.inputs.height = 160; }
      g.o.inputs.filename_prefix = "snaptest/g11";
      delete body.partial_execution_targets;
      return r.continue({ postData: JSON.stringify({ ...body, prompt: g }) });
    });
    await mayRun(true);
    await page.evaluate(async () => { const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    const mio = (await call("save_cast", { name: "Mio Hayase", details: "a 17-year-old girl ramen cook, a dark green apron", refs: [{ file: "snaptest_g11/hiyori_front_v1.png", role: "identity: front" }] })).cast;
    const kuroe = (await call("save_cast", { name: "Baron Kuroe", details: "a tall thin elderly gourmet critic, a round gold monocle on his right eye", refs: [{ file: "snaptest_g11/tomoshi_front_v1.png", role: "identity: front" }] })).cast;
    const place = (await call("save_location", { name: "Hayase Yatai", master: { file: "snaptest_g11/MASTER_shrine_v1.png" }, plates: [{ name: "P2 counter", file: "snaptest_g11/P1_torii_eyelevel.png" }] })).location;
    const book = (await call("create_book", { name: "One More Bowl", medium: "anime", cast: [mio, kuroe], locations: [place] })).book;
    await mod("book.js", async (B, { book }) => { const st = B.storyOf(B.bookOf(book).body); await B.saveStory(st.id, { title: "One More Bowl", props: [], beats: [{ id: "b1", order: 1, told: 1, text: "Mio sets the bowl down in front of Kuroe." }] }, { note: "written by the person" }); }, { book });
    const c2 = await call("add_cut", { book, scene_name: "Night", beats: ["b1"], cast: [mio, kuroe], location: place, plate: "P2 counter", seconds: 4 });
    const land = { scene: c2.scene, shot: c2.shot };

    // ---- F-T02: a region edit whose strip crosses the crop's top and bottom edges, and one that changes nothing there ----
    const crop = [0.3, 0.1, 0.4, 0.3], monocle = [0.2, 0.1, 0.3, 0.4];
    R.paste = await call("edit_from_context", { pictures: [{ file: "snaptest_g11/P1_torii_eyelevel.png", crop }, { cast: kuroe, ref: 0, crop: monocle, label: "Kuroe's monocle only" }], prompt: "Change only the eyewear on <Picture 1>: one gold monocle as in <Picture 2>.", purpose: "edit", method: "ph3_view", seeds: [9511, 9512, 9513], paste_back: true, land, question: "Does the monocle's chain meet the rest of it?" });
    R.pasteStates = R.paste?.decision && await waitReady(R.paste.decision);
    R.cands = R.paste?.decision && (await call("list_candidates", { decision: R.paste.decision }))?.[0];
    R.chips = R.paste?.decision && await page.evaluate(async (id) => { const CV = await import("/extensions/ComfyUI-MAINodes/snap/candidateview.js"); const d = window.__C.get(id); return d.candidates.map((c) => CV.noteChips(c).map((x) => x.textContent)); }, R.paste.decision);
    // the chips as the candidate strip draws them, for the person's look
    await page.evaluate(async (id) => { const CV = await import("/extensions/ComfyUI-MAINodes/snap/candidateview.js"), d = window.__C.get(id), box = document.createElement("div");
      box.id = "g11chips"; Object.assign(box.style, { position: "fixed", left: "20px", top: "20px", zIndex: 99999, background: "#16181d", padding: "12px", color: "#ddd", font: "13px sans-serif", maxWidth: "700px" });
      for (const c of d.candidates) { const row = document.createElement("div"); row.style.margin = "6px 0"; row.append(`${c.id} (seed ${c.seed}): `, ...CV.noteChips(c)); const why = document.createElement("div"); why.style.cssText = "opacity:.7;font-size:12px"; why.textContent = c.notes.seam?.said ?? ""; row.append(why); box.append(row); }
      document.body.append(box); }, R.paste.decision).catch((e) => { R.chipErr = e.message; });
    await page.locator("#g11chips").screenshot({ path: path.join(shots, "seam_chips.png") }).catch(() => {});
    await page.evaluate(() => document.getElementById("g11chips")?.remove());

    // ---- F-U03/F-U04/F-U05: the packet of the region edit's first candidate ----
    const tk = R.cands?.candidates?.[0]?.take;
    if (tk) {
      await waitTake(tk);
      const row = (await call("critique", { take: tk })).critique;
      R.row = row;
      R.pk = await call("critique_packet", { critique: row });
      R.pkAsk = await call("critique_packet", { critique: row, zoom: [{ region: [0.05, 0.05, 0.05, 0.05] }, { find: "eyes" }], part: "zoom" });
      R.pkAgain = await call("critique_packet", { critique: row, part: "zoom" });
      const zi = (R.pk?.pictures ?? []).find((p) => p.tile?.cell === "zoom")?.index;
      R.zi = zi;
      if (zi != null) { await call("claim_critique", { critique: row });
        R.written = await call("write_critique", { critique: row, verdict: "flaws", passes: { scan: "the chain breaks at the crop's bottom edge" }, notes: [{ severity: "medium", pass: "scan", text: "the chain breaks where the edit meets the picture", picture: zi, region: [0.4, 0.4, 0.2, 0.2], owner: "take" }] }); }
      // ---- F-U06: the compact docket ----
      R.compact = await call("list_critiques", { compact: true, take: tk.slice(0, 13) });
      R.byDecision = await call("list_critiques", { compact: true, decision: R.paste.decision.slice(0, 10) });
      R.full = await call("list_critiques", { take: tk });
    }

    // ---- F-U05: a plain edit (no paste) changes a small part of its Picture 1: the zoom finds where ----
    R.plain = await call("edit_from_context", { pictures: [{ file: "snaptest_g11/P1_torii_eyelevel.png" }], prompt: "Change only the lantern on <Picture 1>.", purpose: "edit", method: "ph3_view", seeds: [9531], land });
    R.plainStates = R.plain?.decision && await waitReady(R.plain.decision);
    const tp = R.plain?.candidates?.[0]?.take;
    if (tp && await waitTake(tp)) { const row = (await call("critique", { take: tp })).critique; R.pkPlain = await call("critique_packet", { critique: row, part: "zoom" }); }

    // ---- F-U01: the fixed picture in place of Kuroe's picture 0, a new Cast version ----
    if (tk) {
      R.castBefore = await call("get_cast", { cast: kuroe });
      R.replaceBad = await call("use_take", { take: tk, as: "cast", cast: kuroe, replace: 4 });
      R.replaceAsk = await call("use_take", { take: tk, as: "cast", cast: kuroe, replace: 0, propose: true, reason: "the fixed monocle in place of the Cast's front picture" });
      R.replace = await call("use_take", { take: tk, as: "cast", cast: kuroe, replace: 0 });
      R.castAfter = await call("get_cast", { cast: kuroe });
    }

    // ---- the person's way: the New view tray offers paste-back for a marked region on P-H3-Image ----
    R.tray = await page.evaluate(async (tk) => {
      const CX = await import("/extensions/ComfyUI-MAINodes/snap/contextview.js"), t = window.__T.get(tk), host = document.createElement("div");
      host.id = "g11tray"; Object.assign(host.style, { position: "fixed", right: "20px", top: "20px", zIndex: 99999, width: "380px", background: "#16181d", padding: "12px", color: "#ddd" });
      document.body.append(host);
      let box = [0.3, 0.1, 0.4, 0.3];
      host.append(...CX.contextPanel(t, { say: () => {}, frame: () => null, region: () => box }));
      host.querySelector("button.snap-link").click(); // Add this picture: the marked region
      await new Promise((r) => setTimeout(r, 1500));
      const model = host.querySelector('select[aria-label="model"]'); model.value = "ph3_view"; model.dispatchEvent(new Event("change"));
      const label = [...host.querySelectorAll("label")].find((l) => /paste it back/.test(l.textContent));
      const shown = label && !label.hidden;
      model.value = [...model.options].map((o) => o.value).find((v) => v !== "ph3_view") ?? "ph3_view"; model.dispatchEvent(new Event("change"));
      const hiddenOther = label?.hidden ?? null;
      model.value = "ph3_view"; model.dispatchEvent(new Event("change"));
      return { shown, hiddenOther, text: label?.textContent ?? null };
    }, tk).catch((e) => ({ error: e.message }));
    await page.locator("#g11tray").screenshot({ path: path.join(shots, "tray_paste_back.png") }).catch(() => {});
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
  }
  const S = R, c1 = S.cands?.candidates?.find((c) => c.seed === 9511), c2 = S.cands?.candidates?.find((c) => c.seed === 9512), c3 = S.cands?.candidates?.find((c) => c.seed === 9513);
  const ctx = (S.pk?.pictures ?? []).filter((p) => p.role === "context"), zooms = (S.pk?.pictures ?? []).filter((p) => p.zoom);
  const cropPic = ctx.find((p) => /made from: Picture 2 Kuroe's monocle only: the crop the model got/.test(p.what)), wholePic = ctx.find((p) => /made from: Picture 2 Kuroe's monocle only: the whole picture the crop was cut from/.test(p.what));
  const pin = (n) => (S.pk?.words?.pins ?? []).find((p) => p.name === n), note = S.full?.rows?.[0]?.notes?.[0];
  const box = S.pk?.pictures?.find((p) => p.zoom && p.tile?.cell === "zoom")?.tile?.box, sub = S.pk?.pictures?.[0];
  const compact = S.compact?.rows?.[0], prompt = "Change only the eyewear";
  const checks = {
    // SNAP-R191 (F-T02)
    seamGraph: S.pasteStates?.every((x) => x === "ready") && !S.paste?.error,
    seamBreaksTopBottom: JSON.stringify([...new Set((c1?.notes?.seam?.breaks ?? []).map((x) => x.side))].sort()) === '["bottom","top"]' && c1.notes.seam.checked.length === 4,
    seamCropToTry: (() => { const t = c1?.notes?.seam?.crop_to_try; return !!t && Math.abs(t[0] - 614 / 2048) < 0.001 && Math.abs(t[2] - 819 / 2048) < 0.001 && t[1] === 0 && Math.abs(t[3] - (461 + 519) / 1152) < 0.001; })(), // the 2048x1152 crop is 614,115,819,346: 1.5 crops up (to 0) and down (G12)
    seamSaysWhere: /^the edit breaks at the crop's top and bottom edges \(x \d+-\d+, x \d+-\d+ px\): something drawn inside doesn't meet the picture outside/.test(c1?.notes?.seam?.said ?? ""),
    seamWholeChangeBreaksAll: JSON.stringify([...new Set((c2?.notes?.seam?.breaks ?? []).map((x) => x.side))].sort()) === '["bottom","left","right","top"]',
    seamCleanSaysNoBreak: (c3?.notes?.seam?.breaks ?? [1]).length === 0 && /^no break along the crop's top, bottom, left and right edges$/.test(c3?.notes?.seam?.said ?? ""),
    seamChip: (S.chips ?? [])[0]?.some((x) => x === "seam breaks · top, bottom") && (S.chips ?? [])[2]?.some((x) => x === "seam ok"),
    // SNAP-R192 (F-U03)
    cropAsTheModelGotIt: !!cropPic && JSON.stringify(cropPic.crop?.box) === JSON.stringify([205, 102, 307, 410]) && cropPic.width === 307 && cropPic.height === 410 && /px 205,102,307,410 of 1024x1024/.test(cropPic.label),
    wholeAfterCrop: !!wholePic && ctx.indexOf(wholePic) > ctx.indexOf(cropPic) && wholePic.width === 1024 && wholePic.height === 1024,
    pictureOneCropToo: ctx.some((p) => /made from: Picture 1 .*: the crop the model got \(edited, then pasted back over the whole\)/.test(p.what)),
    // SNAP-R194 (F-U04)
    cutCastInPins: /not pinned by this take: C\d's Cast/.test(pin("Mio Hayase")?.not_pinned ?? "") && !pin("Baron Kuroe")?.not_pinned,
    whoShouldBeHere: JSON.stringify([...(S.pk?.words?.who_should_be_here ?? [])].sort()) === '["Baron Kuroe","Mio Hayase"]',
    cutCastPicture: ctx.some((p) => /^Mio Hayase \(Cast v1\): identity: front$/.test(p.what) && /hiyori_front_v1/.test(p.path ?? "")),
    // SNAP-R193 (F-U05)
    zoomOnPastedCrop: zooms.length >= 1 && /zoom: the region edit's crop, pasted back/.test(zooms[0].label) && zooms.every((z) => (S.pk?.pictures ?? []).indexOf(z) > (S.pk?.pictures ?? []).indexOf(ctx.at(-1))),
    zoomCoversCrop: !!box && box[0] <= 614 && box[1] <= 115 && box[0] + box[2] >= 1433 && box[1] + box[3] >= 461 && sub?.width === 2048,
    zoomAsked: (S.pkAsk?.pictures ?? []).some((p) => /zoom: the region asked for, \[0\.05, 0\.05, 0\.05, 0\.05\]/.test(p.label)) && (S.pkAsk?.pictures ?? []).some((p) => /zoom on "eyes"|"eyes"/.test(p.label)),
    zoomAskedKept: JSON.stringify((S.pkAgain?.pictures ?? []).map((p) => [p.index, p.label])) === JSON.stringify((S.pkAsk?.pictures ?? []).map((p) => [p.index, p.label])) && (S.pkAgain?.pictures ?? []).length >= 3,
    zoomTwiceWhenSmall: (S.pkAsk?.pictures ?? []).some((p) => /region asked for.*at 2x \(enlarged\)/.test(p.label) && p.width === p.tile.box[2] * 2),
    zoomNoteMaps: !S.written?.error && !!note && note.picture === 0 && !!box && Math.abs(note.region[0] - (box[0] + 0.4 * box[2]) / sub.width) < 0.002 && Math.abs(note.region[2] - (0.2 * box[2]) / sub.width) < 0.002,
    zoomWhereChanged: (S.pkPlain?.pictures ?? []).some((p) => /zoom: where it differs from Picture 1/.test(p.label) && p.tile.box[0] <= 300 && p.tile.box[0] + p.tile.box[2] >= 308 && p.tile.box[1] <= 500 && p.tile.box[1] + p.tile.box[3] >= 660),
    // SNAP-R195 (F-U06)
    compactTakeId: compact?.take === S.cands?.candidates?.[0]?.take.slice(0, 13) && compact?.decision === S.paste?.decision,
    compactTitleNoPrompt: !!compact && !compact.title.includes(prompt) && /› take \d+ \(seed 9511\) · New view · P-H3-Image ×3$/.test(compact.title) && compact.question === "Does the monocle's chain meet the rest of it?",
    byDecision: S.byDecision?.count === 3 && (S.byDecision?.rows ?? []).every((x) => x.decision === S.paste?.decision),
    fullTitleKeepsPrompt: (S.full?.rows?.[0]?.title ?? "").includes(prompt),
    // SNAP-R196 (F-U01)
    replaceNewVersion: !S.replace?.error && S.replace?.replaced?.picture === 0 && S.castAfter?.body?.refs?.length === S.castBefore?.body?.refs?.length && S.castAfter.body.refs[0].role === "identity: front" && S.castAfter.body.refs[0].file !== S.castBefore.body.refs[0].file && S.castAfter.head === 2 && /v1 keeps the old one/.test(S.replace?.said ?? ""),
    replaceBadSays: /has no picture 4; it has 1 \(0 to 0\)/.test(S.replaceBad?.error ?? ""),
    replaceProposes: !!S.replaceAsk?.proposed,
    trayPasteBack: S.tray?.shown === true && S.tray?.hiddenOther === true,
    noErrors: !S.crash && !(S.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.mkdirSync(path.join(CFG.out, "ui"), { recursive: true });
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g11_result.json"), JSON.stringify(R, (k, v) => (k === "images" ? `(${v.length} images)` : v), 1));
  console.log(`g11 ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
