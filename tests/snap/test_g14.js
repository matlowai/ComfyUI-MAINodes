// Batch G14 (dogfood F-Z01..F-Z03) on the CPU test server, the page side (test_g14_nodes.py has the nodes on real pictures):
// - SNAP-R205 (F-Z03): a region edit's seam check reads the box as pasted (a crop of the composite), and a box pasted
//   darker than the picture around it gets box_shows on every edge, a "the box shows" line and a "box shows" chip; an
//   edit that changes nothing still says "no break" and "seam ok". The P-H3 sampler is swapped for core nodes (Picture 1's
//   1 MP crop blended a quarter toward black, or inverted twice), so the crop, scale, paste and seam nodes run;
// - SNAP-R206 (F-Z01): stage 2 of that region edit redraws the whole still, then MAISnapKeepEdit puts the edit's change
//   back: redraw = the decode, edit = the still, before = Picture 1's own loader (its crop gone), the edit's feather; the
//   answer and the plan say `keeps`. Run on core nodes with a "redraw" that is Picture 1 again (the flaw back
//   everywhere): the box comes back darker, the picture outside it stays the redraw, at 2x;
// - SNAP-R207 (F-Z02): keep_eye_colour's answer waits for the step and says what it did: skipped for a grey Cast iris
//   (and why), changed nothing when no iris is found, re-tinted otherwise; the node's whole report is on the new take
//   (get_take eye_colour) and in the answer, and the take viewer's line says it. SAM is swapped for two drawn iris
//   squares (core SolidMask / MaskComposite), so MAISnapEyeColour itself runs; a repeat ComfyUI serves from its cache
//   carries the report of the run it repeats when its history keeps no UI output (as on :8194; stripped here).
// usage: node test_g14.js [port] [base]   prints "g14 n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path"), { execFile } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, base = process.argv[3] || CFG.base, R = {};
const snap = path.join(base, "user", "default", "snap");
const park = (d) => { const p = path.join(snap, d); if (fs.existsSync(p)) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(p, path.join(snap, "_parked", `${d}-g14-${Date.now()}`)); } };
const FILES = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"];
const PH3 = ["1", "2", "3", "4", "p", "g", "r", "s", "m", "k"];
const shots = path.join(CFG.out, "ui", "g14");
// a face drawn for the eye step (skin, two iris discs side by side with pupils), and Cast fronts whose irises are grey or green
const DRAW = `
import sys
from PIL import Image, ImageDraw
def face(path, iris):
    im = Image.new("RGB", (400, 300), (236, 200, 170)); d = ImageDraw.Draw(im)
    for cx in (150, 250):
        d.ellipse((cx - 10, 140, cx + 10, 160), fill=iris); d.ellipse((cx - 3, 147, cx + 3, 153), fill=(20, 20, 20))
    im.save(path)
face(sys.argv[1], (120, 82, 60)); face(sys.argv[2], (100, 100, 100)); face(sys.argv[3], (60, 125, 75))
`;
(async () => {
  ["takes", "cast", "candidates"].forEach(park); // moved, never deleted
  const fx = path.join(base, "input", "snaptest_g14");
  for (const d of [fx, path.join(base, "output", "snaptest"), shots]) fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(CFG.fixture("short04", "bible", "hiyori_front_v1.png"), path.join(fx, "front.png")); // 832x1216
  await new Promise((ok, fail) => execFile(CFG.python, ["-I", "-c", DRAW, path.join(base, "output", "snaptest", "g14_face.png"), path.join(fx, "eyes_grey.png"), path.join(fx, "eyes_green.png")], (e) => (e ? fail(e) : ok())));
  fs.copyFileSync(path.join(fx, "eyes_green.png"), path.join(fx, "eyes_green_nomask.png"));
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.route(/\/api\/experiment\/models\/checkpoints$/, async (r) => { const res = await r.fetch(), list = await res.json(); r.fulfill({ response: res, json: [...list, { name: "sam3.1_multiplex_fp16.safetensors", pathIndex: 0, modified: 0, size: 1e9 }] }); }); // SAM listed as a GPU machine lists it
    const A = await F.open(b, port, { context: ctx }), page = A.page, prompts = [];
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const waitReady = (d) => page.evaluate(async (d) => { for (let i = 0; i < 240; i++) { await window.__C.load(); const x = window.__C.get(d); if (x?.candidates.every((c) => c.state === "ready" || c.state === "failed")) return x.candidates.map((c) => c.state); await new Promise((r) => setTimeout(r, 500)); } return null; }, d);
    const waitTake = (id) => page.evaluate(async (id) => { for (let i = 0; i < 240 && !window.__T.get(id); i++) await new Promise((r) => setTimeout(r, 500)); return !!window.__T.get(id); }, id);
    // registered after fwork's route, so it runs first: the graphs this suite reads run on core nodes, anything else falls back
    await page.route(/\/(api\/)?prompt$/, (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      const body = JSON.parse(r.request().postData()), g = body.prompt;
      prompts.push(structuredClone(body));
      if (g?.rk?.class_type === "MAISnapKeepEdit") { // the region edit's stage 2 (its seed too): its "redraw" is Picture 1 again
        for (const k of [...PH3, "u2s", "u2e", "u2sep", "u2l"]) delete g[k];
        g.d = { class_type: "ImageScale", inputs: { image: g.rk.inputs.before, upscale_method: "lanczos", width: g.u2up.inputs.width, height: g.u2up.inputs.height, crop: "disabled" } };
      } else if (g?.p?.class_type === "PH3ImageConditioning" && [9541, 9542].includes(g.r?.inputs.noise_seed)) { // the region edit
        const seed = g.r.inputs.noise_seed;
        for (const k of PH3) delete g[k];
        if (seed === 9541) Object.assign(g, { bk: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 0 } }, d: { class_type: "ImageBlend", inputs: { image1: ["r0s", 0], image2: ["bk", 0], blend_factor: 0.25, blend_mode: "normal" } } });
        else Object.assign(g, { d0: { class_type: "ImageInvert", inputs: { image: ["r0s", 0] } }, d: { class_type: "ImageInvert", inputs: { image: ["d0", 0] } } });
        g.o.inputs.filename_prefix = "snaptest/g14_edit";
      } else if (Object.values(g ?? {}).some((x) => x.class_type === "MAISnapEyeColour")) { // keep eye colour: drawn irises for SAM's
        const front = g.cf.inputs.image, irises = (k, empty) => ({ [`${k}0`]: { class_type: "SolidMask", inputs: { value: 0, width: 400, height: 300 } }, [`${k}q`]: { class_type: "SolidMask", inputs: { value: 1, width: 18, height: 18 } },
          [`${k}a`]: { class_type: "MaskComposite", inputs: { destination: [`${k}0`, 0], source: [`${k}q`, 0], x: 141, y: 141, operation: "add" } },
          [k]: empty ? { class_type: "SolidMask", inputs: { value: 0, width: 400, height: 300 } } : { class_type: "MaskComposite", inputs: { destination: [`${k}a`, 0], source: [`${k}q`, 0], x: 241, y: 141, operation: "add" } } });
        for (const k of Object.keys(g)) if (/^(sam|cfme?t?|cfmi?t?|fme?t?|fmi?t?)$/.test(k)) delete g[k];
        Object.assign(g, irises("cfm", false), irises("fm", /nomask/.test(front)));
      } else return r.fallback();
      delete body.partial_execution_targets;
      return r.continue({ postData: JSON.stringify({ ...body, prompt: g }) });
    });
    const posted = async (n, fn) => { for (let i = 0; i < 80 && !prompts.slice(n).find(fn); i++) await page.waitForTimeout(100); return prompts.slice(n).find(fn); };
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });

    // ---- F-Z03: a darker box, and an edit that changes nothing ----
    let n = prompts.length;
    R.edit = await call("edit_from_context", { pictures: [{ file: "snaptest_g14/front.png", crop: [0.3, 0.15, 0.4, 0.3] }], prompt: "make it darker", method: "ph3_view", paste_back: true, seeds: [9541, 9542], land: "tab" });
    const eg = (await posted(n, (x) => x.extra_data?.snap_parent?.method === "view/ph3_view"))?.prompt ?? {}, rs = Object.values(eg).find((x) => x.class_type === "MAISnapSeam"), rp = eg[rs?.inputs.edit[0]];
    R.seamReads = rp && [rp.class_type, eg[rp.inputs.image[0]]?.class_type, JSON.stringify(rp.inputs.crop_region)];
    R.states = R.edit?.decision && await waitReady(R.edit.decision);
    const cands = R.edit?.decision ? (await call("list_candidates", { decision: R.edit.decision }))?.[0]?.candidates ?? [] : [];
    R.dark = cands.find((c) => c.seed === 9541); R.same = cands.find((c) => c.seed === 9542);
    R.chips = R.edit?.decision && await page.evaluate(async (id) => { const CV = await import("/extensions/ComfyUI-MAINodes/snap/candidateview.js"); const d = window.__C.get(id); return d.candidates.map((c) => [c.seed, CV.noteChips(c).map((x) => x.textContent)]); }, R.edit.decision);
    await page.evaluate(async (id) => { const CV = await import("/extensions/ComfyUI-MAINodes/snap/candidateview.js"), d = window.__C.get(id), box = document.createElement("div");
      box.id = "g14chips"; Object.assign(box.style, { position: "fixed", left: "20px", top: "20px", zIndex: 99999, background: "#16181d", padding: "12px", color: "#ddd", font: "13px sans-serif", maxWidth: "760px" });
      for (const c of d.candidates) { const row = document.createElement("div"); row.style.margin = "6px 0"; row.append(`${c.id} (seed ${c.seed}): `, ...CV.noteChips(c)); const why = document.createElement("div"); why.style.cssText = "opacity:.7;font-size:12px"; why.textContent = c.notes.seam?.said ?? ""; row.append(why); box.append(row); }
      document.body.append(box); }, R.edit.decision).catch((e) => { R.chipErr = e.message; });
    await page.locator("#g14chips").screenshot({ path: path.join(shots, "box_shows_chips.png") }).catch(() => {});
    await page.evaluate(() => document.getElementById("g14chips")?.remove());

    // ---- F-Z01: stage 2 of the darker region edit ----
    // the candidate take holds the prompt as routed here (no sampler): a still take gets the region edit's real graph
    R.landed = R.dark?.take && await waitTake(R.dark.take);
    const real = prompts.find((x) => x.extra_data?.snap_parent?.method === "view/ph3_view" && x.prompt.r?.inputs.noise_seed === 9541), tk = "take-g14-edit-0002";
    R.feather = real?.extra_data.snap_parent.options.pasted.feather;
    await page.evaluate(async ([tk, from, real]) => { const T = window.__T, c = T.get(from);
      await T.save({ ...structuredClone(c), id: tk, prompt_id: tk.slice(5), number: 942, prompt: real.prompt, parent: real.extra_data.snap_parent }); }, [tk, R.dark?.take, real]);
    R.plan = tk && await page.evaluate(async (t) => window.__X.TOOLS.find((x) => x.name === "upscale_take").plan({ take: t, method: "stage2" }).catch((e) => ({ error: e.message })), tk);
    n = prompts.length;
    R.up = tk && await call("upscale_take", { take: tk, method: "stage2", factor: 2 });
    const ug = (await posted(n, (x) => x.extra_data?.snap_parent?.method === "upscale/stage2"))?.prompt ?? {}, rk = ug.rk;
    R.keepGraph = { rk: rk?.class_type, redraw: ug[rk?.inputs.redraw[0]]?.class_type, edit: ug[rk?.inputs.edit[0]]?.inputs.image, before: ug[rk?.inputs.before[0]]?.inputs.image, feather: rk?.inputs.feather,
      save: ug.o?.inputs.images?.[0], classes: Object.values(ug).map((x) => x.class_type), one: ug[ug.p?.inputs["images.image_1"]?.[0]]?.inputs.image };
    R.upLanded = R.up?.take && await waitTake(R.up.take);
    // the stage 2 still against Picture 1 at 2x: inside the box darker (the edit kept), outside it the "redraw"
    R.pixels = R.upLanded && await page.evaluate(async ([t, box]) => {
      const T = window.__T, px = async (src) => { const i = new Image(); i.src = src; await i.decode(); const c = document.createElement("canvas"); c.width = i.naturalWidth; c.height = i.naturalHeight; const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x; };
      const out = await px(T.url(T.get(t).media[0])), front = await px("/view?filename=front.png&subfolder=snaptest_g14&type=input");
      const mean = (ctx, x, y, w, h) => { const d = ctx.getImageData(x, y, w, h).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; return s / (d.length / 4); };
      const [bx, by, bw, bh] = box, inner = [bx + bw / 4, by + bh / 4, bw / 2, bh / 2].map(Math.round), far = [8, 8, 120, 120];
      return { size: [out.canvas.width, out.canvas.height], inOut: mean(out, ...inner.map((v) => v * 2)), inFront: mean(front, ...inner), farOut: mean(out, ...far.map((v) => v * 2)), farFront: mean(front, ...far) };
    }, [R.up.take, [250, 182, 333, 365]]);

    // ---- F-Z02: keep eye colour says what it did ----
    const grey = (await call("save_cast", { name: "G14 Grey", details: "grey eyes", refs: [{ file: "snaptest_g14/eyes_grey.png", role: "identity: front" }] })).cast;
    const green = (await call("save_cast", { name: "G14 Green", details: "green eyes", refs: [{ file: "snaptest_g14/eyes_green.png", role: "identity: front" }] })).cast;
    const blind = (await call("save_cast", { name: "G14 Unseen", details: "green eyes", refs: [{ file: "snaptest_g14/eyes_green_nomask.png", role: "identity: front" }] })).cast;
    await page.evaluate(async () => { const T = window.__T;
      await T.save({ id: "take-g14-face-0001", kind: "run", prompt_id: "g14-face-0001", created: Date.now(), finished: Date.now(), seconds: 1, group: app.graph.id, number: 941, status: "success", text: "g14", seed: 1,
        media: [{ kind: "image", filename: "g14_face.png", subfolder: "snaptest", type: "output" }], prompt: {}, graph: { extra: { snap: { world: {} } } }, world: {}, verdict: null, notes: [] }); });
    // a run served whole from the cache: :8194 kept no UI output for it in /history (this CPU server keeps one), as here
    let stripCached = false;
    await page.route(/\/history\/[\w-]+$/, async (r) => { const res = await r.fetch(), h = await res.json();
      if (stripCached) for (const x of Object.values(h)) if (x.status?.messages?.some((m) => m[0] === "execution_cached" && m[1]?.nodes?.includes("e")) && x.outputs?.e) delete x.outputs.e;
      r.fulfill({ response: res, json: h }); });
    for (const [k, cast] of [["grey", grey], ["again", grey], ["green", green], ["blind", blind]]) { // again: the same graph right after, served from ComfyUI's cache
      stripCached = k === "again";
      R[`eyes_${k}`] = await call("keep_eye_colour", { take: "take-g14-face-0001", cast });
      const id = R[`eyes_${k}`]?.take;
      R[`eyesTake_${k}`] = id && (await call("get_take", { take: id }))?.eye_colour;
      R[`eyesLine_${k}`] = id && await page.evaluate(async (id) => (await import("/extensions/ComfyUI-MAINodes/snap/eyes.js")).doneLine(window.__T.get(id)), id);
      if (k === "again") R.againCached = id && await page.evaluate((id) => window.__T.get(id)?.cached_from ?? null, id);
    }
    R.errors = A.errors;
  } finally { await fetch(`http://127.0.0.1:${port}/settings/MAINodes.Snap.AgentsMayRun`, { method: "POST", body: "false" }).catch(() => {}); await b.close(); }
  for (const f of made) { const to = path.join(base, "models", "_parked_g14", path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); } // placeholders moved, never deleted
  const S = R.dark?.notes?.seam, Q = R.same?.notes?.seam, G = R.keepGraph, X = R.pixels, chip = (seed) => (R.chips ?? []).find((c) => c[0] === seed)?.[1] ?? [];
  const checks = {
    "F-Z03: the seam check reads the box as pasted (a crop of the composite at the box)": JSON.stringify(R.seamReads?.slice(0, 2)) === '["ImageCropV2","ImageCompositeMasked"]',
    "F-Z03: a darker box shows on all four edges, darker": JSON.stringify([...new Set((S?.box_shows ?? []).map((t) => t.side))].sort()) === '["bottom","left","right","top"]' && S.box_shows.every((t) => t.delta <= -10),
    "F-Z03: its note says the box shows, by how much and where, and what to try": /the box shows: the edit is [\d.]+ grey levels darker than the picture along the top edge \(x \d+-\d+ px\)/.test(S?.said ?? "") && /A mask \(SNAP-R204\) keeps only the thing that changes/.test(S?.said ?? ""),
    "F-Z03: its chip says box shows (amber)": chip(9541).some((x) => /^box shows · /.test(x)),
    "F-Z03: an edit that changes nothing: no box, no break, seam ok": Q && Q.box_shows?.length === 0 && /^no break along the crop's top, bottom, left and right edges$/.test(Q.said) && chip(9542).includes("seam ok"),
    "F-Z01: stage 2 of the region edit ends in MAISnapKeepEdit: redraw = the decode, edit = the still, before = Picture 1's loader, the edit's feather": G.rk === "MAISnapKeepEdit" && G.redraw === "VAEDecode" && G.edit === G.one && /g14_edit/.test(G.edit ?? "") && G.before === "snaptest_g14/front.png" && G.feather === R.feather && G.save === "rk",
    "F-Z01: no crop, paste or seam check in stage 2": G.classes?.length && !G.classes.some((c) => ["ImageCropV2", "ImageCompositeMasked", "MAISnapSeam", "SolidMask", "FeatherMask"].includes(c)),
    "F-Z01: the answer and the plan say what stage 2 keeps of the edit": /is a region edit: the redraw is of its whole picture, then the edit's change .* goes back over the redraw/.test(R.up?.keeps ?? "") && R.plan?.keeps === R.up?.keeps,
    "F-Z01: run: 2x, the box darker than Picture 1 (the edit kept over a redraw that brought it back), outside it the redraw": X && X.size[0] === 1664 && X.inFront - X.inOut > 10 && Math.abs(X.farOut - X.farFront) < 2,
    "F-Z02: a grey Cast iris: the answer says it skipped and why, with the report": /Keep eye colour on take 941 \(.*\) skipped, so the new take is the picture as it was: the Cast's iris is grey \(chroma 0\.0 < 6\)/.test(R.eyes_grey?.said ?? "") && /moves hue only/.test(R.eyes_grey?.said ?? "") && /grey/.test(R.eyes_grey?.eye_colour?.report?.skipped ?? ""),
    "F-Z02: no iris found on the still: the answer says it changed nothing, and why": /changed nothing, so the new take is the picture as it was: no iris on the still \(no iris found\)/.test(R.eyes_blind?.said ?? "") && R.eyes_blind?.eye_colour?.report?.per_frame?.[0]?.why === "no iris found",
    "F-Z02: a green Cast: re-tinted, the per-frame report in the answer": /re-tinted the irises on the still toward the Cast's \(a -?[\d.]+, b -?[\d.]+; mean shift/.test(R.eyes_green?.said ?? "") && R.eyes_green?.eye_colour?.report?.per_frame?.[0]?.touched === true,
    "F-Z02: a repeat served whole from ComfyUI's cache carries the report of the run it repeats": R.againCached && R.eyes_again?.eye_colour?.said === R.eyes_grey?.eye_colour?.said && /skipped, so the new take is the picture as it was/.test(R.eyes_again?.said ?? ""),
    "F-Z02: the report is on the new take (get_take eye_colour) and the viewer's line says it": ["grey", "green", "blind"].every((k) => R[`eyesTake_${k}`]?.said && R[`eyesTake_${k}`].said === R[`eyes_${k}`]?.eye_colour?.said && R[`eyesLine_${k}`] === R[`eyesTake_${k}`].said),
    "no page errors": !R.errors?.length,
  };
  fs.writeFileSync(path.join(CFG.out, "ui", "test_g14_result.json"), JSON.stringify({ result: R, checks }, null, 1));
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [key, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${key}`); bad += !v; }
  console.log(`g14 ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
