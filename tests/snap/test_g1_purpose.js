// G1 items 3 and 4 (SNAP-R85, R86) on the CPU test server: a picture's purpose, the New view model by job, and
// references redrawn when made bigger.
// - list_methods {slot: view} names the purposes, each with its model and whether it is a reference;
// - edit_from_context with no method: a location plate alone → ph3_view (a set view); a Cast picture among the pictures
//   → fizgig_still (a character shot); purpose turnaround → fizgig_still; purpose edit → ph3_view; method given → that
//   one; the answer's chosen says which and why; the stills keep their purpose (their take's parent options);
// - get_take.purpose: from what made it, from a location plate's take, from set_purpose;
// - upscale_take stage2 on a P-H3 still and on a Fizgig still (their own recorded graphs): the still's own graph at 2x
//   (sizes, its LoadImage → Lanczos → VAEEncode as the video half of the AV latent, H3DeropeSigmas at 0.3, SaveImage to
//   snap_upscale/), and for a reference the answer's why says it is redrawn; tessera on a still is refused;
// - the tray shows "what it is for" and follows it (a Cast picture → Fizgig); the still's take viewer offers "Redraw to".
// Model files are empty placeholders (parked afterwards); the Fizgig pack's node types are registered in the page only.
// Screens: ui/g1/purpose_tray.png, purpose_redraw.png. usage: node test_g1_purpose.js [port 8195]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g1");
const base = CFG.base;
const SETTEI = CFG.fixture("short03", "settei_bg");
const FILES = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors",
  "diffusion_models/h3/minimax_h3_fl2va_pruned_int8_convrot.safetensors", "loras/h3/minimax_h3_turbo_v4_step600_ema.safetensors", "vae/h3/minimax_h3_video_vae_fp16.safetensors", "text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"];
const PACKS = ["FizgigH3StillLatent", "FizgigH3StillDecode"];
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const snap = path.join(base, "user", "default", "snap");
  for (const d of ["location", "takes", "candidates"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d}-${Date.now()}`)); } // an earlier run's, moved
  fs.mkdirSync(path.join(base, "output", "snaptest"), { recursive: true });
  fs.copyFileSync(path.join(SETTEI, "plates", "Pd_houses.png"), path.join(base, "output", "snaptest", "g1_still.png"));
  execFileSync("python3", ["-I", path.join(__dirname, "import_village_location.py"), "--port", port]);
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    await page.evaluate((packs) => { for (const t of packs) LiteGraph.registered_node_types[t] ??= function () {}; }, PACKS);
    const prompts = [];
    await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") prompts.push(JSON.parse(r.request().postData())); r.fallback(); });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); const W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await W.load(); });
    R.listed = (await call("list_methods", { slot: "view" }))?.purposes;
    R.cast = await call("save_cast", { name: "G1 Maren", refs: [{ file: "snap/location/village/Pb_gate_inside_open.png", role: "identity: front" }] });
    const loc = { location: "location:location-village", plate: "Pb gate inside, open" };
    const view = async (args) => { const n = prompts.length, r = await call("edit_from_context", { prompt: "the gate, <Picture 1>", seeds: [5], land: "tab", ...args });
      const mine = () => prompts.slice(n).find((x) => x.extra_data?.snap_parent?.method?.startsWith("view/")); // a landed view's checks queue too
      for (let i = 0; i < 40 && !mine(); i++) await page.waitForTimeout(100); return { r, g: mine() }; };
    const kindOf = (g) => (Object.values(g?.prompt ?? {}).some((x) => x.class_type === "PH3ImageConditioning") ? "ph3" : Object.values(g?.prompt ?? {}).some((x) => x.class_type === "FizgigH3StillLatent") ? "fizgig" : null);
    const set = await view({ pictures: [loc] }), chr = await view({ pictures: [loc, { cast: R.cast.cast }] }), turn = await view({ pictures: [{ cast: R.cast.cast }], purpose: "turnaround" });
    const edit = await view({ pictures: [{ cast: R.cast.cast }], purpose: "edit" }), asked = await view({ pictures: [loc], method: "fizgig_still" });
    R.views = { set: [set.r.chosen, kindOf(set.g), set.g?.extra_data?.snap_parent?.options?.purpose], chr: [chr.r.chosen, kindOf(chr.g)], turn: [turn.r.chosen?.method, kindOf(turn.g)], edit: [edit.r.chosen?.method, kindOf(edit.g)], asked: [asked.r.chosen, kindOf(asked.g)] };
    R.badPurpose = await call("edit_from_context", { pictures: [loc], prompt: "x", purpose: "nonsense" });
    // the recorded P-H3 and Fizgig graphs become still takes; a plate's take; purposes from what made them, records, set_purpose
    R.fix = await page.evaluate(async ([ph3, fiz, parent]) => {
      const T = window.__T, group = app.graph.id;
      const mk = (id, number, prompt, par) => ({ id, kind: "run", prompt_id: id.slice(5), created: Date.now(), seconds: 8, group, number, status: "success", text: "g1", seed: 5, media: [{ kind: "image", filename: "g1_still.png", subfolder: "snaptest", type: "output" }], prompt, graph: { extra: { snap: { world: {} } } }, world: {}, ...(par ? { parent: par } : {}), verdict: null, notes: [] });
      await T.save(mk("take-g1-ph3", 961, ph3, parent)); await T.save(mk("take-g1-fiz", 962, fiz, null)); await T.save(mk("take-g1-plain", 963, ph3, null));
      return group;
    }, [set.g.prompt, chr.g.prompt, set.g.extra_data.snap_parent]);
    R.add = await call("add_plate", { location: "location:location-village", name: "Pf from fizgig", take: "take-g1-fiz", pose: { x: 0.5, y: 0.5, heading: 90 } });
    R.purposes = { ph3: (await call("get_take", { take: "take-g1-ph3" }))?.purpose, fiz: (await call("get_take", { take: "take-g1-fiz" }))?.purpose, plain: (await call("get_take", { take: "take-g1-plain" }))?.purpose };
    R.setPurpose = await call("set_purpose", { take: "take-g1-plain", purpose: "settei" });
    R.badSet = await call("set_purpose", { take: "take-g1-plain", purpose: "nope" });
    const up = async (take, extra = {}) => { const n = prompts.length, r = await call("upscale_take", { take, method: "stage2", factor: 2, ...extra });
      const mine = () => prompts.slice(n).find((x) => x.extra_data?.snap_parent?.take === take && x.extra_data.snap_parent.method === "upscale/stage2");
      for (let i = 0; i < 40 && !mine(); i++) await page.waitForTimeout(100); return { r, g: mine()?.prompt }; };
    const node = (g, l) => g?.[l?.[0]];
    const shape = ({ r, g }) => { const k = Object.values(g ?? {}).find((x) => x.class_type === "SamplerCustomAdvanced"), lat = node(g, k?.inputs?.latent_image), enc = node(g, lat?.inputs?.video_latent), sc = node(g, enc?.inputs?.pixels);
      return { r, latent: lat?.class_type, sep: node(g, lat?.inputs?.audio_latent)?.class_type, enc: enc?.class_type, scale: sc && [sc.class_type, sc.inputs.upscale_method, sc.inputs.width, sc.inputs.height], src: node(g, sc?.inputs?.image)?.inputs?.image,
        sig: node(g, k?.inputs?.sigmas)?.class_type, inject: node(g, k?.inputs?.sigmas)?.inputs?.inject, save: Object.values(g ?? {}).find((x) => x.class_type === "SaveImage")?.inputs?.filename_prefix,
        sizes: Object.values(g ?? {}).filter((x) => "width" in (x.inputs ?? {}) && x.class_type !== "ImageScale").map((x) => [x.class_type, x.inputs.width, x.inputs.height]) }; };
    R.upPh3 = shape(await up("take-g1-ph3")); R.upFiz = shape(await up("take-g1-fiz")); R.upPlain = (await up("take-g1-plain")).r;
    R.tessera = await call("upscale_take", { take: "take-g1-ph3", method: "tessera" });
    R.plan = await page.evaluate(async () => { const X = window.__X; return X.TOOLS.find((t) => t.name === "upscale_take").plan({ take: "take-g1-fiz", method: "stage2" }); });
    // the tray and the still's Make it bigger
    await page.evaluate(() => document.querySelector(".snap-takes")?.scrollIntoView());
    await page.click(`.snap-take[data-take="take-g1-fiz"]`); await page.waitForTimeout(1800);
    R.redraw = await page.evaluate(() => { const t = [...document.querySelectorAll(".snap-take-sheet .snap-rail-title")].find((x) => x.textContent === "Make it bigger"); const btn = [...document.querySelectorAll(".snap-take-sheet button.snap-primary")].find((x) => /^Redraw to /.test(x.textContent)); return t && btn ? { btn: btn.textContent, why: t.nextElementSibling?.nextElementSibling?.textContent } : null; });
    await page.evaluate(() => [...document.querySelectorAll(".snap-take-sheet .snap-rail-title")].find((x) => x.textContent === "Make it bigger")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, "purpose_redraw.png") });
    await page.click('.snap-take-sheet button:has-text("Add this picture")'); await page.waitForTimeout(300);
    R.trayBefore = await page.evaluate(() => [document.querySelector('.snap-take-sheet select[aria-label="what it is for"]')?.value, document.querySelector('.snap-take-sheet select[aria-label="model"]')?.value]);
    await page.selectOption('.snap-take-sheet select[aria-label="add a Cast picture"]', { index: 1 }); await page.waitForTimeout(300);
    R.trayCast = await page.evaluate(() => [document.querySelector('.snap-take-sheet select[aria-label="what it is for"]')?.value, document.querySelector('.snap-take-sheet select[aria-label="model"]')?.value, [...document.querySelectorAll(".snap-take-sheet .snap-quiet")].map((x) => x.textContent).find((x) => /: the model for /.test(x))]);
    await page.evaluate(() => document.querySelector('.snap-take-sheet select[aria-label="what it is for"]')?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(300); await page.screenshot({ path: path.join(out, "purpose_tray.png") });
    R.errors = [...A.errors];
  } finally {
    await b.close();
    const parked = path.join(base, "_parked_placeholders", `g1purpose-${Date.now()}`);
    for (const f of made) { const to = path.join(parked, path.relative(path.join(base, "models"), f)); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.renameSync(f, to); }
  }
  const ids = (x) => JSON.stringify(x);
  const checks = {
    "list_methods view names the purposes, their models and references": R.listed?.character?.method === "fizgig_still" && R.listed.plate?.method === "ph3_view" && R.listed.plate.reference === true && R.listed.set.reference === false,
    "a plate alone, no method: ph3_view for a set view, said why, kept on the still": R.views.set[0]?.method === "ph3_view" && R.views.set[0].purpose === "set" && /no Cast picture/.test(R.views.set[0].why) && R.views.set[1] === "ph3" && R.views.set[2] === "set",
    "a Cast picture among them: fizgig_still for a character shot": R.views.chr[0]?.method === "fizgig_still" && R.views.chr[0].purpose === "character" && R.views.chr[1] === "fizgig",
    "purpose turnaround → Fizgig, edit → P-H3, a method asked for wins": ids(R.views.turn) === ids(["fizgig_still", "fizgig"]) && ids(R.views.edit) === ids(["ph3_view", "ph3"]) && R.views.asked[0]?.method === "fizgig_still" && /asked for/.test(R.views.asked[0].why) && R.views.asked[1] === "fizgig",
    "an unknown purpose is refused naming them": /purpose is one of character, turnaround/.test(R.badPurpose?.error ?? ""),
    "get_take.purpose: from what made it, from a location plate, none": R.purposes.ph3?.purpose === "set" && /what it was made for/.test(R.purposes.ph3.from) && R.purposes.fiz?.purpose === "plate" && R.purposes.fiz.reference && /plate Pf from fizgig/.test(R.purposes.fiz.from) && R.purposes.plain === null,
    "set_purpose sets it; a wrong one is refused": R.setPurpose?.purpose?.purpose === "settei" && /purpose is one of/.test(R.badSet?.error ?? ""),
    "stage 2 of a P-H3 still: its own graph at 2x from the still, AV latent, denoise 0.3": R.upPh3.latent === "LTXVConcatAVLatent" && R.upPh3.sep === "LTXVSeparateAVLatent" && R.upPh3.enc === "VAEEncode" && R.upPh3.scale?.[0] === "ImageScale" && R.upPh3.scale[1] === "lanczos" && R.upPh3.src === "snaptest/g1_still.png [output]"
      && R.upPh3.sig === "H3DeropeSigmas" && R.upPh3.inject === 0.3 && /^snap_upscale\/take-g1-ph3/.test(R.upPh3.save ?? "") && R.upPh3.sizes.length && R.upPh3.sizes.every(([, w, h]) => w === R.upPh3.scale[2] && h === R.upPh3.scale[3]) && R.upPh3.r?.still === true,
    "stage 2 of a Fizgig still: the latent and the conditioning at the new size": R.upFiz.latent === "LTXVConcatAVLatent" && R.upFiz.sizes.some(([c]) => c === "FizgigH3StillLatent") && R.upFiz.sizes.every(([, w]) => w === R.upFiz.scale?.[2]),
    "a reference says why it is redrawn; a plain still doesn't": /is a reference \(a location plate: plate Pf from fizgig/.test(R.upFiz.r?.why ?? "") && /redrawn at the new size/.test(R.upFiz.r.why) && !R.upPh3.r?.why && /settei/.test(R.upPlain?.why ?? "") && /is a reference/.test(R.plan?.why ?? ""),
    "tessera on a still is refused": /is a still: .* runs on video takes; stage2 redraws a still/.test(R.tessera?.error ?? ""),
    "the still's take viewer offers Redraw, saying why": /^Redraw to \d+×\d+/.test(R.redraw?.btn ?? "") && /is a reference/.test(R.redraw?.why ?? ""),
    "the tray says what it is for and follows a Cast picture to Fizgig": ids(R.trayBefore) === ids(["set", "ph3_view"]) && R.trayCast?.[0] === "character" && R.trayCast[1] === "fizgig_still" && /a Cast picture is in the tray/.test(R.trayCast[2] ?? ""),
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g1purpose ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
