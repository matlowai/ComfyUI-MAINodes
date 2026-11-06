// U101 follow-up (SNAP-R76) on the CPU test server: the identity check on a two-shot. The bake-off found that a board
// with Maren and Brann scored one face (the union crop) and showed the other's head (bakeoff_faces_U_twoshot_pairs.json:
// 0.961 vs Maren, 0.472 vs Brann, the crop Brann's). Now SAM 3.1 finds every face (individual masks), MAISnapIdentity
// gives each its embedding, box and head crop, and the pictures compared with one picture are matched to its faces one
// to one, best total (G1b: of both cosines, ArcFace and the character score; here both are the same fixed vectors). The page's identity graphs are answered here with fixed embeddings: in the board Brann is on the
// left (face 0) and Maren on the right (face 1), the reverse of the pairs' order, so a match by position would fail.
// Checks the graph (face masks one each, no head-region crop), each Cast's score and its own crops, an edit of a
// two-shot (each person against their own face; the pair's face is the lowest), and the new view's per-Cast chips.
// usage: node test_u101_faces.js [port 8195]     BEFORE=e3a974d node test_u101_faces.js
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const unit = (k) => Array.from({ length: 512 }, (_, i) => (i === k ? 1 : 0));
const mix = (a, b, x, y) => { const v = a.map((n, i) => x * n + y * b[i]), l = Math.hypot(...v); return v.map((n) => n / l); };
const MAREN = unit(0), BRANN = unit(1), BOARD = [mix(MAREN, BRANN, 0.2, 0.98), mix(MAREN, BRANN, 0.95, 0.31)]; // Brann left, Maren right
const inp = (name) => ({ filename: name, subfolder: "snaptest", type: "input" });
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    // SAM 3.1 as a GPU machine lists it (the CPU server has none; the checks' graphs are answered below, nothing runs)
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.route(/\/api\/experiment\/models\/checkpoints$/, async (r) => { const res = await r.fetch(), list = await res.json(); r.fulfill({ response: res, json: [...list, { name: "sam3.1_multiplex_fp16.safetensors", pathIndex: 0, modified: 0, size: 1e9 }] }); });
    const A = await F.open(b, port, { context: ctx }), page = A.page;
    const graphs = [];
    let n = 0;
    // identity graphs are answered with the fixed faces; the source of each x<k> decides which picture it is
    await page.route(/\/(api\/)?prompt$/, (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      const body = JSON.parse(r.request().postData()), g = body.prompt;
      if (!Object.values(g).some((x) => x.class_type === "MAISnapIdentity")) return r.fallback();
      graphs.push(g);
      const id = `fake-faces-${++n}`, outputs = {};
      for (const [k, x] of Object.entries(g)) if (x.class_type === "MAISnapIdentity") {
        const file = g[x.inputs.image[0]].inputs.image;
        const faces = /maren/.test(file) ? [MAREN] : /brann/.test(file) ? [BRANN] : /board/.test(file) ? BOARD : /edit/.test(file) ? [mix(MAREN, BRANN, 0.1, 0.99), mix(MAREN, BRANN, 0.5, 0.0)] : [];
        outputs[k] = { faces: [faces], characters: [faces], boxes: [faces.map((_, i) => [0.2 + 0.4 * i, 0.2, 0.1, 0.15])], hair_l90: [50], images: faces.map((_, i) => inp(`${file.split("/").pop().replace(/\.png.*/, "")}_face${i}.png`)) };
      }
      page.__fake = { ...(page.__fake ?? {}), [id]: { status: { status_str: "success", completed: true, messages: [] }, outputs } };
      return r.fulfill({ json: { prompt_id: id, number: 1, node_errors: {} } });
    });
    await page.route(/\/(api\/)?history\/fake-faces-\d+$/, (r) => { const id = r.request().url().split("/").pop(); return r.fulfill({ json: page.__fake?.[id] ? { [id]: page.__fake[id] } : {} }); });
    const check = (pairs) => page.evaluate(async (p) => { const K = window.__K; return K.identityCheck(p).catch((e) => ({ error: e.message })); }, pairs);
    R.casts = await check([[{ image: "snap/maren.png" }, { image: "snap/board.png [output]" }], [{ image: "snap/brann.png" }, { image: "snap/board.png [output]" }]]);
    R.edit = await check([[{ image: "snap/board.png [output]" }, { image: "snap/edit.png [output]" }]]);
    R.graph = graphs[0] && { faceDetect: Object.values(graphs[0]).filter((x) => x.class_type === "SAM3_Detect" && graphs[0][x.inputs.conditioning[0]].inputs.text === "face:9").map((x) => x.inputs.individual_masks),
      cropNodes: Object.values(graphs[0]).filter((x) => x.class_type === "CropByBBoxes").length, faceInput: Object.values(graphs[0]).filter((x) => x.class_type === "MAISnapIdentity").map((x) => Object.keys(x.inputs).sort().join()) };
    // a new view's note per Cast, on its tile
    R.chips = await page.evaluate(async (casts) => {
      const C = window.__C, { candidatesEl } = await import("/extensions/ComfyUI-MAINodes/snap/candidateview.js");
      const d = await C.create({ kind: "view", target: "u101-faces", title: "New view (two-shot)", take: null, method: "ph3_view", options: { prompt: "x", context: [] } }, [{ label: "new view" }]);
      await C.note(d, d.candidates[0], "identity", { different_below: 0.45, casts: [{ name: "Maren", character: casts[0].character, face: casts[0].face, different: false, crops: casts[0].crops }, { name: "Brann", character: 0.21, face: 0.21, different: true, crops: casts[1].crops }, { name: "Liesl", character: null, face: null, crops: [] }] });
      const el = candidatesEl(C.get(d.id), { crops: true });
      document.body.append(el);
      return { chips: [...el.querySelectorAll(".snap-cand-note")].map((x) => [x.textContent, x.classList.contains("warn")]), crops: [...el.querySelectorAll(".snap-cand-crops img")].map((x) => decodeURIComponent(x.src).match(/filename=([^&]+)/)?.[1]), text: el.textContent };
    }, R.casts?.scores ?? [{}, {}]);
    const s = R.casts?.scores ?? [];
    const checks = {
      "the graph finds every face on its own (individual masks) and crops no head region": JSON.stringify(R.graph?.faceDetect) === JSON.stringify([true, true, true, true]) && R.graph.cropNodes === 0 && R.graph.faceInput.every((x) => x === "encoder,face_model,faces,hair,image"),
      "Maren is scored against her own face (the right one), with its crop": s[0]?.face === 0.951 && s[0].character === 0.951 && s[0].crops?.[1]?.filename === "board_face1.png" && s[0].crops?.[0]?.filename === "maren_face0.png",
      "Brann is scored too, against the other face, with his crop": s[1]?.face === 0.98 && s[1].crops?.[1]?.filename === "board_face0.png",
      "an edit of a two-shot scores each person against their own face; the pair's face is the lowest": R.edit?.scores?.[0]?.people?.length === 2 && R.edit.scores[0].character === Math.min(...R.edit.scores[0].people.map((x) => x.character)) && R.edit.scores[0].people.every((x) => x.crops[0] && x.crops[1]) && R.edit.different === false,
      "a new view's tile: a chip per Cast (Maren's score, 'probably not Brann', Liesl not matched), each person's crops": JSON.stringify(R.chips?.chips) === JSON.stringify([["Maren 0.95", false], ["probably not Brann", true], ["Liesl: no face matched", false]]) && JSON.stringify(R.chips.crops) === JSON.stringify(["maren_face0.png", "board_face1.png", "brann_face0.png", "board_face0.png"]),
      "no stray null on the tile": !/\bnull\b|undefined|\[object/.test(R.chips?.text ?? "null"),
      "no page errors": !A.errors.length,
    };
    console.log(JSON.stringify(R, (k, v) => (Array.isArray(v) && v.length === 512 ? "[512-d]" : v), 1));
    let bad = 0;
    for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
    console.log(`u101faces ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
    process.exitCode = bad ? 1 : 0;
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(2); });
