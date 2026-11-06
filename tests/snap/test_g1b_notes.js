// G1b items 1, 2 and 4 on the CPU test server: how the new notes read (SNAP-R111, R112, R114).
// - identity and copy chips on candidate tiles (notes as identityCheck / contextCopies write them): an edit flagged by the
//   character score ("probably a different person", ArcFace in the title only), one that keeps the character ("same
//   character 0.71 · hair +2"), a note from before the character score ("identity: older check"); a new view whose Casts
//   are scored by character ("Maren 0.83", "probably not Brann") with "copied Picture 1 0.84 · same composition" and
//   another with "copied Picture 2 0.93 · same framing";
// - the voice note: Casts Maren, Liesl and Brann with voice references; a take that cites Maren's voice as <Audio 1> lands
//   from a real CPU run (a 64 px video with her line as its sound) and gets its voice check by itself; the check's graph
//   (the voice model, the take's soundtrack, one Load Audio per Cast voice) is answered here with fixed embeddings:
//   ok ("voice matches Maren 0.98, next closest Liesl 0.86 (+0.12), F0 186 Hz vs ref 184 Hz"); a take closer to Liesl
//   says check and why; a silent one says no voice; check_voice runs it again; get_take gives `voice`; the take viewer's
//   Voice line and the card chip show it, amber for check. Screens: ui/g1b/notes_identity_copy.png, voice_viewer.png,
//   voice_cards.png. usage: node test_g1b_notes.js [port 8195] [base dir]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g1b");
const VOICES = CFG.fixture("short03", "voices");
const unit = (k, n) => Array.from({ length: n }, (_, i) => (i === k ? 1 : 0));
const mix = (a, b, x, y) => { const v = a.map((n, i) => x * n + y * b[i]), l = Math.hypot(...v); return v.map((n) => n / l); };
const MAREN = unit(0, 512), LIESL = mix(MAREN, unit(1, 512), 0.88, 0.475), BRANN = unit(2, 512);
const TAKE = { ok: mix(MAREN, unit(3, 512), 0.98, 0.199), check: mix(LIESL, MAREN, 0.6, 0.4), silent: unit(4, 512) };
const F0 = { maren: 184, liesl: 228, brann: 160, ok: 186, check: 229, silent: null };
const upload = async (file, name) => { const form = new FormData(); form.append("image", new Blob([fs.readFileSync(file)]), name); form.append("subfolder", "snap"); form.append("overwrite", "true");
  const r = await (await fetch(`http://127.0.0.1:${port}/upload/image`, { method: "POST", body: form })).json(); return `${r.subfolder}/${r.name}`; };
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const files = { maren: await upload(path.join(VOICES, "maren_voice_ref.wav"), "g1b_maren_voice.wav"), liesl: await upload(path.join(VOICES, "liesl_voice_ref.wav"), "g1b_liesl_voice.wav"),
    brann: await upload(path.join(VOICES, "brann_voice_ref.wav"), "g1b_brann_voice.wav"), face: await upload(CFG.fixture("id_copy", "images", "bible_maren_front.png"), "g1b_maren_front.png") };
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    // WavLM-SV as a machine with the voice model lists it (G3: the gate's CPU base has none; the graphs are answered below)
    const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
    await ctx.route(/\/api\/experiment\/models\/audio_encoders$/, async (r) => { const res = await r.fetch(), list = await res.json(); r.fulfill({ response: res, json: list.some((x) => x.name === "wavlm_base_plus_sv.safetensors") ? list : [...list, { name: "wavlm_base_plus_sv.safetensors", pathIndex: 0, modified: 0, size: 4e8 }] }); });
    const A = await F.open(b, port, { context: ctx }), page = A.page;
    const voiceGraphs = [];
    let n = 0;
    // the voice checks are answered with fixed embeddings: which take (its video's name) and which reference (its file)
    await page.route(/\/(api\/)?prompt$/, (r) => {
      if (r.request().method() !== "POST") return r.fallback();
      const body = JSON.parse(r.request().postData()), g = body.prompt;
      if (/\[voicetake\]/.test(body.extra_data?.snap_job?.title ?? "")) { // a real 64 px video whose sound is Maren's line, citing her voice as <Audio 1>
        body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 24, color: 3355443 } }, a: { class_type: "LoadAudio", inputs: { audio: files.maren } },
          v: { class_type: "CreateVideo", inputs: { images: ["1", 0], audio: ["a", 0], fps: 24 } }, s: { class_type: "SaveVideo", inputs: { video: ["v", 0], filename_prefix: "snaptest/g1b_voice_ok", format: "auto", codec: "auto" } },
          refs: { class_type: "H3References", inputs: { "ref_audios.0": ["a", 0] } } };
        return r.continue({ postData: JSON.stringify(body) });
      }
      if (!Object.values(g).some((x) => x.class_type === "MAISnapVoice")) return r.fallback();
      voiceGraphs.push(g);
      const id = `fake-voice-${++n}`, outputs = {}, tv = g.tv?.inputs?.file ?? "", kind = /check/.test(tv) ? "check" : /silent/.test(tv) ? "silent" : "ok";
      for (const [k, x] of Object.entries(g)) if (x.class_type === "MAISnapVoice") {
        const src = g[x.inputs.audio[0]], file = src.class_type === "LoadAudio" ? src.inputs.audio : null, who = file ? Object.keys(files).find((w) => files[w] === file) : kind;
        outputs[k] = { voices: [{ maren: MAREN, liesl: LIESL, brann: BRANN }[who] ?? TAKE[who]], f0: [F0[who]], seconds: [4.2] };
      }
      page.__fake = { ...(page.__fake ?? {}), [id]: { status: { status_str: "success", completed: true, messages: [] }, outputs } };
      return r.fulfill({ json: { prompt_id: id, number: 1, node_errors: {} } });
    });
    await page.route(/\/(api\/)?history\/fake-voice-\d+$/, (r) => { const id = r.request().url().split("/").pop(); return r.fulfill({ json: page.__fake?.[id] ? { [id]: page.__fake[id] } : {} }); });
    const call = (name, args) => page.evaluate(([nm, a]) => window.__X.callTool(nm, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { window.__W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await window.__W.load(); });
    for (const [who, name] of [["maren", "G1b Maren"], ["liesl", "G1b Liesl"], ["brann", "G1b Brann"]])
      R[`cast_${who}`] = await call("save_cast", { name, lora: null, refs: [{ file: files.face, role: "identity: front" }], voice: { file: files[who], casting: `${who}'s casting words` } });
    await page.evaluate(() => window.__W.reload());

    // ---- the voice note: a real CPU take that cites Maren's voice lands and is checked by itself ----
    R.landed = await page.evaluate(async () => {
      const K = window.__K, T = window.__T;
      const id = await K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 0 } } }, { job: { kind: "run", title: "G1b: Maren says her line [voicetake]" }, group: app.graph.id });
      for (let i = 0; i < 240; i++) { const t = T.get(`take-${id}`); if (t?.voice && !t.voice.pending) return { id: t.id, voice: t.voice, media: t.media.map((m) => m.filename) }; await new Promise((r) => setTimeout(r, 250)); }
      return { id: `take-${id}`, voice: T.get(`take-${id}`)?.voice ?? null, timeout: true };
    });
    const g0 = voiceGraphs[0];
    R.graph = g0 && { loader: g0.vm?.class_type + ":" + g0.vm?.inputs?.model_name, take: [g0.tv?.class_type, g0.tc?.class_type, JSON.stringify(g0.t?.inputs?.audio)], audios: Object.values(g0).filter((x) => x.class_type === "LoadAudio").map((x) => x.inputs.audio).sort() };
    // two fixture takes (the same recipe, other sound): one closer to Liesl, one silent
    R.more = await page.evaluate(async (landed) => {
      const T = window.__T, t = T.get(landed), mk = (id, number, file) => ({ ...structuredClone(t), id, prompt_id: id.slice(5), number, voice: undefined, media: [{ kind: "video", filename: file, subfolder: "snaptest", type: "output" }] });
      await T.save(mk("take-g1b-check", t.number + 1, "g1b_voice_check.mp4")); await T.save(mk("take-g1b-silent", t.number + 2, "g1b_voice_silent.mp4"));
      return true;
    }, R.landed.id);
    R.checkCall = await call("check_voice", { take: "take-g1b-check" });
    R.silentCall = await call("check_voice", { take: "take-g1b-silent" });
    R.noVoice = await call("check_voice", { take: R.landed.id.replace(/./, "x") });
    const settled = (id) => page.evaluate(async (tid) => { for (let i = 0; i < 120; i++) { const t = window.__T.get(tid); if (t?.voice && !t.voice.pending) return t.voice; await new Promise((r) => setTimeout(r, 250)); } return null; }, id);
    R.check = await settled("take-g1b-check"); R.silent = await settled("take-g1b-silent");
    R.got = await call("get_take", { take: R.landed.id });
    // the viewer and the cards
    await page.evaluate(() => document.querySelector(".snap-takes")?.scrollIntoView());
    await page.waitForTimeout(600);
    R.cards = await page.evaluate(() => [...document.querySelectorAll(".snap-take")].map((c) => { const s = [...c.querySelectorAll("figcaption span")].find((x) => /^(voice|no voice)/.test(x.textContent)); return [c.dataset.take, s?.textContent ?? null, s?.className ?? null]; }).filter(([, v]) => v));
    await page.locator(".snap-takes").screenshot({ path: path.join(out, "voice_cards.png") }).catch((e) => { R.shotErr = e.message; });
    await page.click(`.snap-take[data-take="take-g1b-check"]`); await page.waitForTimeout(1500);
    R.viewer = await page.evaluate(() => [...document.querySelectorAll(".snap-take-sheet .snap-take-copyline span")].filter((s) => /^Voice:/.test(s.textContent)).map((s) => [s.textContent, s.className, s.title]));
    await page.evaluate(() => [...document.querySelectorAll(".snap-take-sheet .snap-take-copyline span")].find((s) => /^Voice:/.test(s.textContent))?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(400); await page.screenshot({ path: path.join(out, "voice_viewer.png") });
    await page.keyboard.press("Escape"); await page.waitForTimeout(400);

    // ---- identity and copy chips on candidate tiles ----
    R.chips = await page.evaluate(async (crop) => {
      const C = window.__C, { candidatesEl } = await import("/extensions/ComfyUI-MAINodes/snap/candidateview.js");
      const pic = { label: "frame 0", frame: 0, media: crop }, ready = (d) => { for (const c of d.candidates) c.state = "ready"; return C.save(d).then(() => C.get(d.id)); };
      const ed = await C.create({ kind: "edit", target: "g1b", title: "Change something: her jacket", take: null, method: "remake_edit", options: {}, clip: { video: "x.mp4", frames: 73, mid: 36, width: 64, height: 64 } },
        [{ seed: 1, frame: [0], pictures: [pic], notes: { identity: { scores: [{ character: 0.31, face: 0.52, crops: [crop, crop], hair: 1.2 }], character_low: 0.31, face_low: 0.52, hair_up: 1.2, hair_base: 40, different_below: 0.45, same_from: 0.55, hair_lighter: 10, different: true, lighter: false } } },
         { seed: 2, frame: [0], pictures: [pic], notes: { identity: { scores: [{ character: 0.71, face: 0.08, crops: [crop, crop], hair: 2 }], character_low: 0.71, face_low: 0.08, hair_up: 2, hair_base: 40, different_below: 0.45, same_from: 0.55, hair_lighter: 10, different: false, lighter: false } } },
         { seed: 3, frame: [0], pictures: [pic], notes: { identity: { scores: [{ face: 0.2, crops: [crop, crop], hair: 0 }], face_low: 0.2, hair_up: 0, different_person: 0.35, hair_lighter: 10, different: true, lighter: false } } }]);
      const nv = await C.create({ kind: "view", target: "g1b", title: "New view: the gate with Maren and Brann", take: null, method: "ph3_view", options: { prompt: "x", context: [] } },
        [{ label: "new view", pictures: [pic], notes: { identity: { different_below: 0.45, casts: [{ name: "Maren", character: 0.83, face: 0.12, different: false, crops: [crop, crop] }, { name: "Brann", character: 0.29, face: 0.4, different: true, crops: [crop, crop] }] },
           copied: { threshold: 0.72, soft_threshold: 0.82, against: [{ n: 1, label: "village master", score: 0.53, soft: 0.84 }, { n: 2, label: "road plate", score: 0.45, soft: 0.71 }], copied: [1], framing: [] } } },
         { label: "new view", pictures: [pic], notes: { copied: { threshold: 0.72, soft_threshold: 0.82, against: [{ n: 1, label: "village master", score: 0.5, soft: 0.74 }, { n: 2, label: "road plate", score: 0.93, soft: 0.95 }], copied: [2], framing: [2] } } },
         { label: "new view", pictures: [pic], notes: { copied: { threshold: 0.72, soft_threshold: 0.82, against: [{ n: 1, label: "village master", score: 0.5, soft: 0.74 }], copied: [], framing: [] } } }]);
      const box = Object.assign(document.createElement("div"), { id: "g1b-chips" });
      box.style.cssText = "position:fixed;left:20px;top:20px;width:1100px;z-index:99999;background:#18191d;padding:14px;";
      box.append(candidatesEl(await ready(ed), { crops: true }), candidatesEl(await ready(nv), { crops: true }));
      document.body.append(box);
      return [...box.querySelectorAll(".snap-cand")].map((t) => [...t.querySelectorAll(".snap-cand-note")].map((x) => [x.textContent, x.classList.contains("warn"), x.title]));
    }, { filename: "g1b_maren_front.png", subfolder: "snap", type: "input" });
    await page.waitForTimeout(500);
    await page.locator("#g1b-chips").screenshot({ path: path.join(out, "notes_identity_copy.png") });
    const text = (i) => (R.chips?.[i] ?? []).map(([t]) => t);
    const ok = R.landed?.voice, v0 = ok?.voices?.[0];
    const checks = {
      "a take citing a Cast voice lands and gets its voice note by itself: ok": ok?.status === "ok" && v0?.name === "G1b Maren" && v0.cite === "<Audio 1>" && v0.own === 0.98 && v0.others?.[0]?.name === "G1b Liesl",
      "the line: 'voice matches Maren 0.98, next closest Liesl 0.86 (+0.12), F0 186 Hz vs ref 184 Hz'": v0?.said === "voice matches G1b Maren 0.98, next closest G1b Liesl 0.86 (+0.12), F0 186 Hz vs ref 184 Hz",
      "its graph: the voice model, the take's soundtrack, one Load Audio per Cast voice": R.graph?.loader === "MAISnapVoiceModelLoader:wavlm_base_plus_sv.safetensors" && R.graph.take.join() === 'LoadVideo,GetVideoComponents,["tc",1]' && R.graph.audios.length === 3,
      "closer to Liesl: check, and why": R.check?.status === "check" && /closer to G1b Liesl/.test(R.check.voices?.[0]?.said ?? "") && R.check.voices[0].why?.some((w) => /G1b Liesl is within 0.05/.test(w)),
      "a silent take: no voice": R.silent?.status === "no voice" && /no voice found/.test(R.silent.voices?.[0]?.said ?? ""),
      "check_voice answers at once; a take that isn't there is named": R.checkCall?.queued === true && JSON.stringify(R.checkCall.voices) === '["G1b Maren (<Audio 1>)"]' && /No take/.test(R.noVoice?.error ?? ""),
      "get_take gives the voice note": R.got?.voice?.status === "ok" && R.got.voice.voices?.[0]?.said === v0?.said,
      "the cards: 'voice ok · G1b Maren 0.98' quiet, check and 'no voice found' amber": R.cards?.some(([id, t, c]) => id === R.landed.id && t === "voice ok · G1b Maren 0.98" && !/snap-take-copy/.test(c)) && R.cards.some(([id, t, c]) => id === "take-g1b-check" && /^voice check · /.test(t) && /snap-take-copy/.test(c)) && R.cards.some(([id, t]) => id === "take-g1b-silent" && t === "no voice found"),
      "the viewer's Voice line says check, why, and the numbers in its title": R.viewer?.length === 1 && /^Voice: check · voice vs G1b Maren/.test(R.viewer[0][0]) && /within 0.05/.test(R.viewer[0][0]) && /snap-take-copy/.test(R.viewer[0][1]) && /WavLM-SV/.test(R.viewer[0][2]),
      "identity: 'probably a different person' from the character score, ArcFace in the title": text(0).includes("probably a different person") && R.chips[0].find(([t]) => t === "probably a different person")?.[1] === true && /ArcFace 0.52/.test(R.chips[0].find(([t]) => t === "probably a different person")[2]) && /Below 0.45/.test(R.chips[0].find(([t]) => t === "probably a different person")[2]),
      "identity: 'same character 0.71 · hair +2', quiet": JSON.stringify(text(1)) === JSON.stringify(["same character 0.71 · hair +2"]) && R.chips[1][0][1] === false,
      "identity: a note from before says 'identity: older check'": JSON.stringify(text(2)) === JSON.stringify(["identity: older check"]),
      "a new view: per Cast by character, 'copied Picture 1 0.84 · same composition'": text(3).includes("Maren 0.83") && text(3).includes("probably not Brann") && text(3).includes("copied Picture 1 0.84 · same composition"),
      "copied with the framing kept: 'copied Picture 2 0.95 · same framing'; none: the nearest quietly": text(4).includes("copied Picture 2 0.95 · same framing") && JSON.stringify(text(5)) === JSON.stringify(["no copy · nearest Picture 1 0.74"]),
      "no stray null": !(R.chips ?? []).flat().some(([t]) => /\bnull\b|undefined|NaN|\[object/.test(t)) && !(R.viewer ?? []).some(([t]) => /\bnull\b|undefined|NaN/.test(t)),
      "no page errors": !A.errors.length,
    };
    console.log(JSON.stringify(R, (k, v) => (Array.isArray(v) && v.length === 512 ? "[512-d]" : v), 1));
    let bad = 0;
    for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
    console.log(`g1bnotes ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  } finally { await b.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
