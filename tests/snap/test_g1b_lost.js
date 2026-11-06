// G1b, dogfood F-D03 on the CPU test server: a candidate waiting its turn is never read as lost.
// - four New view candidates queued as slow CPU prompts (one after another), settle() polled every 300 ms while they
//   wait: none is ever failed, all end ready with their pictures;
// - the race: a candidate whose /history read comes back empty once (it finished between that read and the /queue read)
//   is read again and ends ready, not "no record";
// - a candidate already failed as lost whose render is in /history turns ready with its picture on the next settle.
// Model files are empty placeholders (parked afterwards). usage: node test_g1b_lost.js [port 8195] [base dir]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
const base = process.argv[3] || CFG.base;
const FILES = ["diffusion_models/h3/p-h3-image_int8_convrot.safetensors", "text_encoders/h3/p-h3-image_text_encoder_int8_convrot.safetensors", "vae/h3/p-h3-image_vae_int8_convrot.safetensors"];
const LOST = "the server has no record of this render (restarted?)";
(async () => {
  const made = FILES.map((f) => path.join(base, "models", f)).filter((f) => !fs.existsSync(f));
  for (const f of made) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, ""); }
  fs.mkdirSync(path.join(base, "input", "snap"), { recursive: true });
  fs.copyFileSync(CFG.fixture("id_copy", "images", "MASTER_village.png"), path.join(base, "input", "snap", "g1b_lost_master.png"));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port, { slow: 6 }), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    await page.evaluate(async () => { await app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", true); });
    // the race: the first /history read of the second candidate's prompt comes back empty
    let raced = null, emptied = 0;
    await page.route(/\/(api\/)?history\/[0-9a-f-]{36}$/, async (r) => { // once it has finished, its first read comes back empty
      const id = r.request().url().split("/").pop();
      if (id !== raced || emptied) return r.fallback();
      const res = await r.fetch(), body = await res.json();
      if (body[id]?.status?.completed) { emptied++; return r.fulfill({ json: {} }); }
      return r.fulfill({ response: res, json: body });
    });
    R.view = await call("edit_from_context", { method: "ph3_view", pictures: [{ file: "snap/g1b_lost_master.png", label: "master" }], prompt: "Edit <Picture 1>. The gate at eye height.", seeds: [1, 2, 3, 4], land: "tab" });
    const d = R.view?.decision;
    raced = R.view?.candidates?.[1]?.prompt_id ?? null;
    R.states = [];
    for (let i = 0; i < 400; i++) {
      const st = await page.evaluate(async (id) => { const C = window.__C; await C.settle(); return C.get(id)?.candidates.map((c) => c.state); }, d);
      R.states.push(st.join(","));
      if (st.every((x) => x !== "rendering")) break;
      await page.waitForTimeout(300);
    }
    R.final = await page.evaluate((id) => window.__C.get(id)?.candidates.map((c) => ({ state: c.state, error: c.error ?? null, pictures: c.pictures.length })), d);
    R.everFailed = R.states.some((s) => s.includes("failed"));
    // a candidate failed as lost whose render is in /history
    R.recovered = await page.evaluate(async ([id, lost]) => {
      const C = window.__C, src = C.get(id).candidates[0];
      const nd = await C.create({ kind: "view", target: "g1b-lost", title: "New view (a render read as lost)", take: null, method: "ph3_view", options: { prompt: "x", context: [] } }, [{ seed: 9, prompt_id: src.prompt_id, pictures: [], notes: {} }]);
      const c = C.get(nd.id).candidates[0]; c.state = "failed"; c.error = lost; await C.save(C.get(nd.id));
      await C.settle();
      for (let i = 0; i < 40 && C.get(nd.id).candidates[0].state !== "ready"; i++) { await new Promise((r) => setTimeout(r, 250)); await C.settle(); }
      const z = C.get(nd.id).candidates[0];
      return { state: z.state, error: z.error ?? null, pictures: z.pictures.length };
    }, [d, LOST]);
    const checks = {
      "four candidates queued one after another": R.view?.candidates?.length === 4,
      "polled every 300 ms while they waited: never failed": R.states.length > 3 && !R.everFailed,
      "all four end ready with their pictures": R.final?.length === 4 && R.final.every((c) => c.state === "ready" && c.pictures >= 1),
      "the raced candidate (empty /history once) was read again, not lost": emptied >= 1 && R.final?.[1]?.state === "ready",
      "a candidate failed as lost whose render landed turns ready with its picture": R.recovered?.state === "ready" && R.recovered.error === null && R.recovered.pictures >= 1,
      "no page errors": !A.errors.length,
    };
    console.log(JSON.stringify(R, null, 1));
    let bad = 0;
    for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
    console.log(`g1blost ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  } finally {
    await b.close();
    const park = path.join(base, "_parked_placeholders", `g1b_lost_${Date.now()}`);
    for (const f of made) { const rel = path.relative(path.join(base, "models"), f); fs.mkdirSync(path.join(park, path.dirname(rel)), { recursive: true }); fs.renameSync(f, path.join(park, rel)); }
  }
})().catch((e) => { console.error(e); process.exit(1); });
