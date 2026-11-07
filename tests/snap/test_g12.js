// Batch G12 (U106, the operator 2026-11-07: "is that image a frame from a video or is it a seed image for making a video?")
// on the CPU test server, with a Book cut seeded as the live short05 C2 is: two video takes (one active, with a voice
// and the key drawing as its reference), the cut's approved board a frame of the first, a key drawing picked from a New
// view's two candidates (the other turned down), a bigger version of it, a settei, a plate kept from a still and a Cast
// picture kept from a video's frame, a story beat the key is pinned to (its pin made from an older story) and a critic's row:
// - SNAP-R197: what() says, from the records alone, a still vs a frame of a video (which take, which second), its kind
//   (key drawing / board / settei / plate / Cast picture / bigger version), its cut, active / approved / picked, the
//   model and its Picture n / Audio n; in the Room no model name (the leak test over the Room and its modal);
// - SNAP-R198: the Nearby modal shows each kind of neighbour, a tile re-centres it and Back walks back; on a phone it
//   stacks with no sideways scroll; the take viewer's m and the viewer's m open it; nothing changes (R5: every record
//   file hashed before and after, keys pressed inside it over the take viewer judge nothing);
// - SNAP-R199: the nearby tool's shape: every list, every tile with ref, path, name and line; part pages one list with
//   its total; a picture path, a /view address and a record ref resolve.
// Screens: ui/g12/room_what_desk.png, room_nearby_desk.png, room_nearby_phone.png, viewer_what.png, lightbox_what.png.
// usage: node test_g12.js [port] [base]   prints "g12 n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {}, out = path.join(CFG.out, "ui", "g12");
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d.replaceAll("/", "_")}-g12-${Date.now()}`)); } };
const http = async (route, body, headers = {}) => { const r = await fetch(`http://127.0.0.1:${port}${route}`, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, ...(await r.json()) }; };
const bridge = (tool, args, agent) => http("/mainodes/snap/call", { tool, args }, agent ? { "X-Snap-Agent": agent } : {});
// every record file under the user's snap folder, hashed (R5: opening the modal writes nothing)
const hashAll = () => { const h = {}; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== "_parked") walk(p); } else h[path.relative(snap, p)] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex"); } }; walk(snap); return h; };
const changed = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]);
(async () => {
  fs.mkdirSync(out, { recursive: true });
  ["takes", "candidates", "scenes", "proposals.json", "work.json", "critiques", "book", "story", "look", "cast", "location"].forEach(park); // moved, never deleted
  const fx = path.join(base, "input", "snaptest_g12"), D = CFG.fixture("short04"), V = CFG.fixture("voice_timbre");
  fs.mkdirSync(fx, { recursive: true }); fs.mkdirSync(path.join(base, "input", "snap"), { recursive: true });
  const copy = (from, to) => fs.copyFileSync(from, path.join(fx, to));
  copy(CFG.fixture("short05/board_c2_s9221.png"), "key.png"); copy(path.join(D, "settei_bg/P1_torii_eyelevel.png"), "key2.png");
  for (const [f, to] of [["bible/hiyori_front_v1.png", "mio.png"], ["bible/tomoshi_front_v1.png", "kuroe.png"], ["settei_bg/MASTER_shrine_v1.png", "master.png"], ["settei_bg/P1_torii_eyelevel.png", "plate.png"], ["bible/hiyori_back_v1.png", "settei.png"]]) copy(path.join(D, f), to);
  copy(path.join(V, "takes/a_maren_s62.mp4"), "v1.mp4"); copy(path.join(V, "takes/b_liesl_s82.mp4"), "v2.mp4"); copy(path.join(V, "refs_v2/liesl_voice_ref_v2.wav"), "voice.wav");
  await fetch(`http://127.0.0.1:${port}/history`, { method: "POST", body: JSON.stringify({ clear: true }) });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port, { viewport: { width: 1440, height: 900 } }), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const mod = (file, fn, arg) => page.evaluate(async ([file, src, arg]) => { const M = await import(`/extensions/ComfyUI-MAINodes/snap/${file}`); return (new Function("M", "arg", `return (${src})(M, arg)`))(M, arg); }, [file, fn.toString(), arg]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    const mio = (await call("save_cast", { name: "Mio Hayase", details: "a 17-year-old girl ramen cook, a dark green apron", refs: [{ file: "snaptest_g12/mio.png", role: "identity: front" }] })).cast;
    const kuroe = (await call("save_cast", { name: "Baron Kuroe", details: "a tall thin elderly gourmet critic, a round gold monocle", refs: [{ file: "snaptest_g12/kuroe.png", role: "identity: front" }] })).cast;
    const place = await call("save_location", { name: "Hayase Yatai", master: { file: "snaptest_g12/master.png" }, plates: [{ name: "P1 street", file: "snaptest_g12/master.png" }] });
    const loc = place.ref ?? place.location;
    const book = (await call("create_book", { name: "short05 · One More Bowl", medium: "anime", cast: [mio, kuroe], locations: [loc] })).book;
    await mod("book.js", async (B, { book }) => { const st = B.storyOf(B.bookOf(book).body); await B.saveStory(st.id, { title: "One More Bowl", props: [], beats: [{ id: "b1", order: 1, told: 1, text: "Mio sets the full bowl down in front of Kuroe with both hands." }] }, { note: "written by the person" }); }, { book });
    const cut = await call("add_cut", { book, scene_name: "short05 · One More Bowl cuts", name: "C2 the bowl lands", beats: ["b1"], cast: [mio, kuroe], location: loc, plate: "P1 street", seconds: 4 });
    R.cut = cut;
    await call("open_shot", { scene: cut.scene, shot: cut.shot }); await page.waitForTimeout(2000);
    // the takes, saved as capture saves them: in the shot's group, media in input/
    const S = await page.evaluate(async ([scene, shot, mio, kuroe, book, loc]) => {
      const SC = window.__SC, T = window.__T, W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"), B = await import("/extensions/ComfyUI-MAINodes/snap/book.js");
      await SC.load(); const group = SC.get(scene).shots.find((x) => x.id === shot).groups[0], now = Date.now();
      const m = (f, kind = "image") => ({ kind, filename: f, subfolder: "snaptest_g12", type: "input" });
      const world = { [mio]: { n: 1, name: "Mio Hayase" }, [kuroe]: { n: 1, name: "Baron Kuroe" } };
      const take = (id, n, media, extra = {}) => ({ id, kind: "run", prompt_id: id.slice(5), created: now + n, seconds: 3, group, number: n, status: "success", text: "", seed: 9200 + n, media, prompt: {}, graph: {}, verdict: null, notes: [], world, ...extra });
      const ctx = [{ n: 1, file: "snaptest_g12/plate.png", label: "C2's camera" }, { n: 2, cast: `${mio}@1`, file: "snaptest_g12/mio.png", label: "cast: Mio Hayase, identity: front" }];
      const pin = { book, ref: null, beat: "b1", unit: { scene, shot, cut: "C2" }, role: "key", from: { [`${mio}.carried.right_hand`]: "an older story's hash" } };
      const key = take("take-g12key", 3, [m("key.png")], { seed: 9221, parent: { take: null, method: "view/ph3_view", options: { context: ctx } }, story: pin });
      const key2 = take("take-g12key2", 4, [m("key2.png")], { seed: 9222, parent: { take: null, method: "view/ph3_view", options: { context: ctx } }, story: pin });
      const big = take("take-g12big", 5, [m("key.png")], { parent: { take: key.id, method: "upscale/stage2", options: { denoise: 0.3 } } });
      const keyFile = `snap/${key.id}_f0.png`;
      const v1 = take("take-g12v1", 1, [m("v1.mp4", "video")], { prompt: { 1: { class_type: "LoadImage", inputs: { image: keyFile } }, 2: { class_type: "LoadAudio", inputs: { audio: "snaptest_g12/voice.wav" } }, 3: { class_type: "MAIRenderPreset", inputs: { model: "h3/minimax_h3_ref2va_pruned_int8_convrot.safetensors", lora: "h3/pika_h3_flex_ref2va_comfy_bf16.safetensors" } }, 4: { class_type: "MAIH3Ref2V", inputs: { "ref_images.0": ["1", 0], "ref_audios.0": ["2", 0] } } } });
      const v2 = take("take-g12v2", 2, [m("v2.mp4", "video")], { parent: { take: v1.id, method: "retake", options: { world: "pinned" } } });
      const settei = take("take-g12settei", 6, [m("settei.png")], { parent: { take: null, method: "view/fizgig_still", options: { context: [{ n: 1, cast: `${kuroe}@1`, file: "snaptest_g12/kuroe.png", label: "Baron Kuroe, identity: front" }] } }, story: { book, role: "settei", cast: kuroe, state: "monocle off", view: "front" } });
      const still = take("take-g12plate", 7, [m("plate.png")], { parent: { take: null, method: "view/ph3_view", options: { context: [{ n: 1, file: "snaptest_g12/master.png", label: "the master" }] } } });
      for (const t of [v1, v2, key, key2, big, settei, still]) await T.save(t);
      await SC.setActive(scene, shot, v2.id);
      // the frames records keep (as set_board, use_take and add_plate write them)
      const up = async (from, name) => { const blob = await (await fetch(`/view?filename=${from}&subfolder=snaptest_g12&type=input`)).blob(), f = new FormData(); f.append("image", blob, name); f.append("subfolder", "snap"); f.append("overwrite", "true"); await fetch("/upload/image", { method: "POST", body: f }); return `snap/${name}`; };
      const boardFile = await up("plate.png", `${v1.id}_f30.png`), castFile = await up("mio.png", `${v2.id}_f12.png`), plateFile = await up("plate.png", `${still.id}_f0.png`);
      await up("key.png", `${key.id}_f0.png`);
      await B.setUnit(scene, shot, { board: { file: boardFile, from: { take: v1.id, frame: 30 }, approved: true }, key: { file: keyFile, from: { take: key.id, frame: 0 } } }, { by: "person" });
      const mb = W.headOf(W.record("cast", W.parse(mio).id)).body; await W.save("cast", W.parse(mio).id, { ...mb, refs: [...mb.refs, { file: castFile, role: "face, close", from: { take: v2.id, frame: 12 } }], voice: { file: "snaptest_g12/voice.wav", casting: "soft" } }, { note: "a frame of take 2", by: "person" });
      const lb = W.headOf(W.record("location", W.parse(loc).id)).body; await W.save("location", W.parse(loc).id, { ...lb, plates: [...lb.plates, { name: "P2 counter", file: plateFile, from: { take: still.id } }] }, { note: "plate P2", by: "person" });
      await W.reload();
      return { v1: v1.id, v2: v2.id, key: key.id, key2: key2.id, big: big.id, settei: settei.id, still: still.id, keyFile, boardFile, castFile, plateFile };
    }, [cut.scene, cut.shot, mio, kuroe, book, loc]);
    R.seeded = S;
    // the pick: key2 turned down, key picked (as make_board's candidates and set_board leave them)
    R.decision = await page.evaluate(async ([ids, scene, shot]) => {
      window.__C.kind("g12view", { apply: async () => ({}), undo: async () => {} });
      const pic = (id) => ({ media: window.__T.get(id).media[0], label: "key" });
      const d = await window.__C.create({ kind: "g12view", target: ids.key, title: "New view · P-H3-Image ×2 (the key drawing of C2)", by: "agent", land: { scene, shot } }, [{ take: ids.key, pictures: [pic(ids.key)], seed: 9221 }, { take: ids.key2, pictures: [pic(ids.key2)], seed: 9222 }]);
      for (const c of d.candidates) c.state = "ready";
      await window.__C.save(d);
      await window.__C.reject(d.id, d.candidates[1].id, "person", { because: "the stool moved" });
      await window.__C.apply(d.id, d.candidates[0].id, "person");
      return d.id;
    }, [S, cut.scene, cut.shot]);
    // the critic's row on the key drawing
    const row = (await call("critique", { take: S.key })).critique;
    await bridge("claim_critique", { critique: row }, "g12-critic");
    R.write = await bridge("write_critique", { critique: row, verdict: "flaws", passes: { cast: "read" }, notes: [
      { severity: "medium", pass: "cast", text: "Kuroe's eyewear is spectacles, not the Cast's monocle.", owner: "board", region: [0.31, 0.31, 0.06, 0.06], fix: "a region edit of the eye" },
      { severity: "high", pass: "beat", text: "Mio still holds the ladle in her right hand while setting the bowl down.", owner: "prompt" }] }, "g12-critic");
    await page.waitForTimeout(800);

    // ---- SNAP-R197: the lines ----
    R.what = await page.evaluate(async (S) => { const N = await import("/extensions/ComfyUI-MAINodes/snap/nearby.js"); await N.load();
      const w = (r, o) => { try { return N.what(r, o); } catch (e) { return { error: e.message }; } };
      const casts = (await import("/extensions/ComfyUI-MAINodes/snap/world.js")).all("cast");
      return { key: w(S.key), keyRoom: w(S.key, { room: true }), key2: w(S.key2), big: w(S.big), v1: w(S.v1), v1Room: w(S.v1, { room: true }), v2: w(S.v2), settei: w(S.settei), plate: w(S.still),
        board: w(`input/${S.boardFile}`), castPic: w(S.castFile), mioPic: w("input/snaptest_g12/mio.png"), record: w(`cast:${casts.find((r) => r.versions.at(-1).body.name === "Mio Hayase").id}`),
        viewUrl: w(`/view?filename=${encodeURIComponent(S.boardFile.split("/")[1])}&subfolder=snap&type=input`) }; }, S);

    // ---- SNAP-R199: the tool ----
    R.tool = await call("nearby", { ref: S.key.slice(5) }); // the id without "take-", as notes quote it
    R.toolPage = await call("nearby", { ref: S.key, part: "made_into", limit: 1 });
    R.toolBoard = await call("nearby", { ref: `input/${S.boardFile}` });
    R.toolV2 = await call("nearby", { ref: S.v2 });
    R.toolRecord = await call("nearby", { ref: mio });
    R.toolBad = await call("nearby", { ref: S.key, part: "everything" });
    R.toolMissing = await call("nearby", { ref: "take-nothere" });

    // ---- the Room (before the take viewer marks the take seen): the key drawing's critic row says what it is, Nearby opens in the Room's words ----
    await call("open_view", { view: "room" }); await page.waitForTimeout(2500);
    const lines = await page.locator("button.snap-room-line").allTextContents();
    if (!/keep it anyway\?$/.test(await page.locator(".snap-room-q h2").textContent())) { const l = lines.find((x) => /keep it anyway\?$/.test(x)); if (l) { await page.locator("button.snap-room-line", { hasText: l }).first().click(); await page.waitForTimeout(800); } }
    await page.waitForTimeout(800);
    R.room = await page.evaluate(() => { const q = document.querySelector(".snap-room-q"); return { h2: q.querySelector("h2").textContent, what: [...q.querySelectorAll(".snap-what")].map((x) => x.textContent), order: [...q.children].map((c) => c.className || c.tagName) }; });
    await page.screenshot({ path: path.join(out, "room_what_desk.png") });
    const texts = [await page.locator(".snap-room").textContent()];
    await page.locator(".snap-room-q .snap-near-open").first().click(); await page.waitForTimeout(1500);
    texts.push(await page.locator(".snap-near").textContent());
    R.roomModal = await page.evaluate(() => [...document.querySelectorAll(".snap-near-part h3")].map((x) => x.textContent));
    await page.screenshot({ path: path.join(out, "room_nearby_desk.png") });
    await page.locator(".snap-near-name").first().click(); await page.waitForTimeout(1000);
    texts.push(await page.locator(".snap-near").textContent());
    await page.keyboard.press("Escape");
    // every candidate the Room asks about, too
    for (const l of await page.locator("button.snap-room-line").allTextContents()) { await page.locator("button.snap-room-line", { hasText: l }).first().click().catch(() => {}); await page.waitForTimeout(500); texts.push(await page.locator(".snap-room").textContent()); }
    R.banned = await page.evaluate(async (texts) => { const RM = await import("/extensions/ComfyUI-MAINodes/snap/room.js"); return texts.flatMap((t) => RM.BANNED.filter((re) => re.test(t)).map((re) => `${re} in "${t.match(re)?.[0]}"`)); }, texts);
    R.roomTexts = texts.length;

    // ---- the phone: the Room's question, its line, and the modal stacked ----
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }), p = await ctx.newPage();
    await p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
    await p.goto(`http://127.0.0.1:${port}/?room`);
    R.phone = await p.waitForSelector(".snap-room", { timeout: 90000 }).then(() => true, () => false);
    await p.waitForTimeout(2500);
    const pl = (await p.locator("button.snap-room-line").allTextContents()).find((x) => /keep it anyway\?$/.test(x));
    if (pl && !/keep it anyway\?$/.test(await p.locator(".snap-room-q h2").textContent())) { await p.locator("button.snap-room-line", { hasText: pl }).first().click(); await p.waitForTimeout(800); }
    await p.waitForTimeout(800);
    await p.locator(".snap-room-q .snap-what-row").first().scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(out, "room_what_phone.png") });
    await p.locator(".snap-room-q .snap-near-open").first().click(); await p.waitForTimeout(1500);
    R.phoneModal = await p.evaluate(() => { const m = document.querySelector(".snap-near"), c = m.querySelector(".snap-near-centre"), parts = m.querySelector(".snap-near-parts"); return { sideways: m.scrollWidth > m.clientWidth + 1, stacked: !!c && !!parts && parts.getBoundingClientRect().top >= c.getBoundingClientRect().bottom - 1, cols: getComputedStyle(m.querySelector(".snap-near-grid") ?? m).gridTemplateColumns }; });
    await p.screenshot({ path: path.join(out, "room_nearby_phone.png") });
    await ctx.close();
    await page.locator(".snap-room-head button").click(); await page.waitForTimeout(400);
    // ---- SNAP-R198 + R5: the modal over the take viewer; keys inside it judge nothing ----
    await call("ui", { action: "open_take", target: S.key }); await page.waitForTimeout(1500);
    R.viewer = await page.evaluate(() => [...document.querySelectorAll(".snap-take-sheet .snap-what")].map((x) => x.textContent));
    R.viewerNull = await page.evaluate(() => [...document.querySelector(".snap-take-sheet .snap-verdicts")?.childNodes ?? []].some((n) => n.nodeType === 3 && n.textContent === "null")); // the verdict block printed "null" under a take with no verdict
    await page.screenshot({ path: path.join(out, "viewer_what.png") });
    const before = hashAll();
    await page.locator(".snap-take-sheet").focus().catch(() => {}); await page.keyboard.press("m"); // the viewer's key
    await page.waitForSelector(".snap-near .snap-near-part", { timeout: 20000 }).catch(() => {});
    R.modal = await page.evaluate(async (S) => { const m = document.querySelector(".snap-near");
      const parts = [...m.querySelectorAll(".snap-near-part h3")].map((x) => x.textContent), tiles = [...m.querySelectorAll(".snap-near-tile")].length, videos = [...m.querySelectorAll(".snap-near-tile video")].map((v) => ({ muted: v.muted, controls: v.controls }));
      return { parts, tiles, videos, line: m.querySelector(".snap-near-line1")?.textContent, more: m.querySelector(".snap-near-what .snap-near-line")?.textContent, centre: m.querySelector(".snap-near-big")?.tagName }; }, S);
    await page.screenshot({ path: path.join(out, "nearby_desk.png") });
    for (const k of ["p", "x", "n", "1"]) await page.keyboard.press(k);
    // a tile re-centres it; Back walks back
    await page.locator(".snap-near-name", { hasText: "board of C2" }).first().click(); await page.waitForTimeout(800);
    R.recentred = await page.evaluate(() => ({ line: document.querySelector(".snap-near-line1")?.textContent, back: !document.querySelector(".snap-near-bar .snap-near-btn").hidden }));
    await page.locator(".snap-near-bar .snap-near-btn", { hasText: "Back" }).click(); await page.waitForTimeout(800);
    R.backTo = await page.locator(".snap-near-line1").textContent();
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    R.closed = await page.evaluate(() => ({ near: !document.querySelector(".snap-near"), viewer: !!document.querySelector(".snap-take-sheet") })); // Esc closes the modal only
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    // the lightbox: its what line, and m opens the modal over it
    await page.evaluate(async (id) => { const LB = await import("/extensions/ComfyUI-MAINodes/snap/lightbox.js"), T = window.__T, t = T.get(id); LB.show([{ src: T.url(t.media[0]), name: `Take ${t.number}` }]); }, S.key);
    await page.waitForTimeout(1500);
    R.lightbox = await page.locator(".snap-lb-whatline").textContent();
    await page.screenshot({ path: path.join(out, "lightbox_what.png") });
    await page.keyboard.press("m"); await page.waitForTimeout(1500);
    R.lightboxNear = await page.evaluate(() => ({ near: !!document.querySelector(".snap-near"), lb: !!document.querySelector(".snap-lb") }));
    await page.keyboard.press("Escape"); await page.waitForTimeout(200);
    R.lightboxStays = await page.evaluate(() => ({ near: !!document.querySelector(".snap-near"), lb: !!document.querySelector(".snap-lb") }));
    await page.keyboard.press("Escape");
    const after = hashAll();
    R.r5changed = changed(before, after);
    R.keyVerdict = await page.evaluate((id) => window.__T.get(id).verdict, S.key);
    // the candidate tiles say what each is
    R.tiles = await page.evaluate(async (d) => { const CV = await import("/extensions/ComfyUI-MAINodes/snap/candidateview.js"), el = CV.candidatesEl(window.__C.get(d), {}); document.body.append(el); await new Promise((r) => setTimeout(r, 1200)); const t = [...el.querySelectorAll(".snap-what")].map((x) => x.textContent); el.remove(); return t; }, R.decision);

    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally {
    await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {});
    await b.close();
  }
  const W_ = R.what ?? {}, t = R.tool ?? {}, tiles = (x) => [...(x?.cut?.boards ?? []), ...(x?.cut?.takes ?? []), ...(x?.shot?.takes ?? []), ...(x?.candidates?.tiles ?? []), ...(x?.made_from ?? []), ...(x?.made_into ?? []), ...(x?.records ?? []).flatMap((r) => r.pictures)];
  const MODELS = /P-H3|H3|Pika|minimax|pika|Fizgig|MOSS/;
  const checks = {
    keyIsAStill: /^A still, not a frame of a video: take 3, the key drawing of C2 the bowl lands, the picture its video builds to\. It was picked\.$/.test(W_.key?.line ?? ""),
    keyMadeFrom: W_.key?.more === "Made by P-H3-Image from Picture 1 C2's camera and Picture 2 cast: Mio Hayase, identity: front.",
    roomLeavesModel: W_.keyRoom?.more === "Made from Picture 1 C2's camera and Picture 2 cast: Mio Hayase, identity: front." && !MODELS.test(W_.v1Room?.more ?? "x") && /^Made from/.test(W_.v1Room?.more ?? ""),
    turnedDown: /^A still, not a frame of a video: take 4, a key drawing candidate for C2 the bowl lands, a picture a video would build to\. It was turned down\.$/.test(W_.key2?.line ?? ""),
    bigger: /a bigger version of take 3/.test(W_.big?.line ?? "") && /^Made by Stage 2/.test(W_.big?.more ?? ""),
    videoFrameIsBoard: /^A video: take 1 of C2 the bowl lands\. Its frame 30 \(1\.25 s\) is the approved board of C2 the bowl lands\./.test(W_.v1?.line ?? ""),
    videoModelAndRefs: /^Made by minimax_h3_ref2va_pruned_int8_convrot with pika_h3_flex_ref2va_comfy_bf16/.test(W_.v1?.more ?? "") && /Picture 1 the key drawing of C2 the bowl lands/.test(W_.v1?.more ?? "") && /Audio 1 Mio Hayase's voice/.test(W_.v1?.more ?? ""),
    activeAndCastFrame: /It is the active take of C2 the bowl lands\./.test(W_.v2?.line ?? "") && /Its frame 12 \(0\.5 s\) is Mio Hayase's Cast picture 2 \(face, close\), version 2\./.test(W_.v2?.line ?? ""),
    settei: /a settei of Baron Kuroe \(monocle off, front view\)/.test(W_.settei?.line ?? ""),
    plateKept: /It is plate P2 counter of Hayase Yatai, version 2\./.test(W_.plate?.line ?? ""),
    boardIsAFrame: /^A frame of a video: take 1 at 1\.25 s \(frame 30\)\. It is the approved board of C2 the bowl lands\./.test(W_.board?.line ?? "") && W_.board?.form === "frame",
    castPicFrame: W_.castPic?.form === "frame" && /Mio Hayase's Cast picture 2/.test(W_.castPic?.line ?? ""),
    broughtIn: /^A picture brought in, not made here \(input\/snaptest_g12\/mio\.png\)\. It is Mio Hayase's Cast picture 1 \(identity: front\), version 2\./.test(W_.mioPic?.line ?? ""),
    record: /^A Cast record: Mio Hayase, version 2 \(the newest\)\./.test(W_.record?.line ?? ""),
    viewAddress: W_.viewUrl?.form === "frame",
    toolShape: ["what", "subject", "cut", "shot", "candidates", "made_from", "made_into", "records", "beat", "critiques", "counts"].every((k) => k in t) && t.subject?.take === R.seeded?.key,
    toolCut: t.cut?.boards?.length === 2 && t.cut.boards.some((x) => x.marks.includes("approved")) && t.cut.takes.map((x) => x.ref).sort().join() === [R.seeded?.v1, R.seeded?.v2].sort().join() && t.cut.takes.find((x) => x.ref === R.seeded?.v2)?.marks.includes("active"),
    toolSiblings: t.candidates?.tiles?.length === 1 && t.candidates.tiles[0].ref === R.seeded?.key2 && t.candidates.tiles[0].marks.includes("turned down") && (t.shot?.takes ?? []).some((x) => x.ref === R.seeded?.settei),
    toolProvenance: t.made_from?.map((x) => x.name).join("|") === "Picture 1 C2's camera|Picture 2 cast: Mio Hayase, identity: front" && [R.seeded?.big, R.seeded?.v1].every((id) => t.made_into?.some((x) => x.ref === id)) && t.made_into?.some((x) => x.ref === `input/${R.seeded?.keyFile}`),
    toolRecords: ["Mio Hayase", "Baron Kuroe", "Hayase Yatai"].every((n) => t.records?.some((r) => r.name === n)) && t.records.find((r) => r.name === "Mio Hayase")?.moved === true && t.records.find((r) => r.name === "Mio Hayase").pictures.length === 1,
    toolBeat: t.beat?.beats?.[0]?.text === "Mio sets the full bowl down in front of Kuroe with both hands." && t.beat.stale === true && t.beat.reasons?.length > 0,
    toolCritiques: t.critiques?.length === 1 && t.critiques[0].notes.map((n) => n.severity_words).join() === "Serious,Worth fixing" && t.critiques[0].notes[1].fix === "a region edit of the eye",
    toolWhole: tiles(t).length > 0 && tiles(t).every((x) => "ref" in x && x.path && x.name && x.what) && Object.entries(t.counts ?? {}).every(([k, n]) => n === (k === "cut" ? t.cut.boards.length + t.cut.takes.length : k === "shot" ? t.shot.takes.length : k === "candidates" ? t.candidates.tiles.length : t[k].length)),
    toolPages: R.toolPage?.part === "made_into" && R.toolPage.total === t.made_into?.length && R.toolPage.items?.length === 1 && R.toolPage.next?.offset === 1,
    toolOtherRefs: R.toolBoard?.subject?.kind === "picture" && R.toolBoard.made_from?.[0]?.ref === R.seeded?.v1 && R.toolBoard.cut?.boards?.length === 2 && R.toolV2?.made_into?.some((x) => x.ref === `input/${R.seeded?.castFile}`) && R.toolV2.made_from?.[0]?.ref === R.seeded?.v1
      && R.toolRecord?.subject?.kind === "record" && R.toolRecord.records[0].pictures.length === 2 && R.toolRecord.made_into?.length >= 7,
    toolErrors: /part is one of cut, shot/.test(R.toolBad?.error ?? "") && /No take take-nothere/.test(R.toolMissing?.error ?? ""),
    modalParts: ["The cut: C2 the bowl lands", "The other candidates of the same pick", "More takes of", "Made from", "Made from it", "What it cites", "The story", "What the critic said"].every((p) => R.modal?.parts?.some((x) => x.toUpperCase().startsWith(p.toUpperCase()))),
    modalVideosWithSound: (R.modal?.videos ?? []).length >= 2 && R.modal.videos.every((v) => v.controls && !v.muted),
    modalRecentres: /^A frame of a video: take 1/.test(R.recentred?.line ?? "") && R.recentred.back === true && /^A still, not a frame of a video: take 3/.test(R.backTo ?? "") && R.closed?.near === true && R.closed.viewer === true,
    lightboxSays: /^A still, not a frame of a video: take 3/.test(R.lightbox ?? "") && R.lightboxNear?.near === true && R.lightboxStays?.lb === true && R.lightboxStays.near === false,
    r5NothingChanged: Array.isArray(R.r5changed) && R.r5changed.length === 0 && R.keyVerdict == null,
    viewerSays: /^A still, not a frame of a video: take 3/.test(R.viewer?.[0] ?? "") && /^Made by P-H3-Image/.test(R.viewer?.[1] ?? "") && R.viewerNull === false,
    candidateTiles: (R.tiles ?? []).length === 2 && /the key drawing of C2 the bowl lands, the picture its video builds to\. It was picked\.$/.test(R.tiles[0]) && /It was turned down\./.test(R.tiles[1]),
    roomSaysWhat: /^A still, not a frame of a video: take 3, the key drawing of C2 the bowl lands, the picture its video builds to/.test(R.room?.what?.[0] ?? "") && /^Made from Picture 1/.test(R.room?.what?.[1] ?? ""),
    roomModal: (R.roomModal ?? []).length >= 5,
    leakTest: Array.isArray(R.banned) && R.banned.length === 0 && R.roomTexts >= 3,
    phone: R.phone === true && R.phoneModal?.sideways === false && R.phoneModal.stacked === true,
    noErrors: !R.crash && !(R.errors ?? []).length,
  };
  R.checks = checks; R.pass = Object.values(checks).filter(Boolean).length; R.total = Object.keys(checks).length;
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g12_result.json"), JSON.stringify(R, null, 1));
  console.log(`g12 ${R.pass}/${R.total}`, Object.entries(checks).filter(([, v]) => !v).map(([k]) => k).join(" "));
})();
