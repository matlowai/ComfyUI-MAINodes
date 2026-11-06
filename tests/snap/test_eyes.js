// U57 + U35/U23 on the CPU server: the chain's own preview slot (Save shows the newest take; hovering a take in the strip
// shows that one there, in place), Run from here (the take's settings in a new tab, ready, nothing queued), the orbit
// text naming each opening's side, agent eyes (take_frames as MCP image blocks and WebMCP data URLs; find_people with a
// numbered frame, SAM 3.1 answered here with two fixture masks) and plan-then-approve (a GPU tool's proposal carries its
// plan with seconds from measured takes). Never queues a render.
const { chromium } = require("playwright"); const { spawn } = require("child_process"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const out = path.join(CFG.out, "ui"), R = {};
const HOST = `http://127.0.0.1:${CFG.port}`, FIX = CFG.fixture("u32");
const OUTPUT = path.join(CFG.base, "output");
const MCP = path.join(CFG.pack, "tools", "snap_mcp.py");
function mcp() {
  const p = spawn("python3", ["-I", MCP, "--port", CFG.port]);
  let buf = "", waiters = [], id = 0;
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); waiters.shift()?.(JSON.parse(line)); } });
  return { call: (name, args) => new Promise((r) => { waiters.push((m) => r(m.result)); p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: { name, arguments: args } }) + "\n"); }), close: () => p.stdin.end() };
}
async function upload(file, name) {
  const form = new FormData();
  form.append("image", new Blob([fs.readFileSync(file)]), name); form.append("subfolder", "snaptest"); form.append("overwrite", "true");
  return (await fetch(`${HOST}/upload/image`, { method: "POST", body: form })).json();
}
(async () => {
  for (const f of ["mask_left", "mask_right"]) await upload(path.join(FIX, `${f}.png`), `${f}.png`);
  fs.mkdirSync(path.join(OUTPUT, "video"), { recursive: true });
  fs.copyFileSync(path.join(FIX, "day_take.mp4"), path.join(OUTPUT, "video/snaptest_eyes_00001_.mp4"));
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const ctx = await b.newContext({ viewport: { width: 1600, height: 1000 } });
  await ctx.addInitScript(() => { window.__webmcp = {}; document.modelContext = { registerTool: (t) => { window.__webmcp[t.name] = t; } }; });
  const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  // SAM 3.1 "person" with one mask each is answered with two fixture masks (right one first: numbering is left to right)
  let q = 0, sam = 0;
  const mask = (n) => ({ filename: `${n}.png`, subfolder: "snaptest", type: "input" });
  await page.route(/\/(api\/)?prompt$/, async (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const nodes = Object.values(JSON.parse(r.request().postData()).prompt);
    if (nodes.some((n) => n.class_type === "SAM3_Detect" && n.inputs.individual_masks)) { sam++; return r.fulfill({ json: { prompt_id: `fake-people-${sam}`, number: 1, node_errors: {} } }); }
    q++; return r.abort();
  });
  await page.route(/\/(api\/)?history\/fake-people-\d+$/, (r) => r.fulfill({ json: { [r.request().url().split("/").pop()]: { status: { status_str: "success", completed: true, messages: [] }, outputs: { p: { images: [mask("mask_right"), mask("mask_left")] } } } } }));
  await page.route(/\/api\/experiment\/models\/checkpoints$/, async (r) => { const res = await r.fetch(); r.fulfill({ response: res, json: [...await res.json(), { name: "sam3.1_multiplex_fp16.safetensors", pathIndex: 0, modified: 0, size: 1e9 }] }); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${HOST}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  const stamp = Date.now().toString(36);
  R.ids = await page.evaluate(async (stamp) => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    const { SIMPLE_RECIPE } = await import("/extensions/ComfyUI-MAINodes/snap/bricks.js"), T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js"); window.__T = T;
    app.graph.clear(); app.graph.extra = {};
    for (const k of SIMPLE_RECIPE) await snap.engine.snap(k);
    snap.engine.setValue("render", "render", "length", 97);
    await T.load();
    const live = await T.live(), media = [{ kind: "video", filename: "snaptest_eyes_00001_.mp4", subfolder: "video", type: "output", node: "1" }];
    const graph = app.graph.serialize(), older = structuredClone(graph);
    older.nodes.find((n) => String(n.id) === String(snap.engine.nodeFor("render", "render").id)).widgets_values[3] = 73; // take 1 ran 73 frames
    const base = { kind: "run", group: T.groupOf(), workflow: "eyes", status: "success", text: "a woman on a platform", seed: 7, media, verdict: null, prior: false, notes: [], prompt: live.recipe };
    await T.save({ ...base, id: `take-eyes1-${stamp}`, prompt_id: `eyes1-${stamp}`, number: 1, created: Date.now() - 60000, seconds: 66, hash: "older", graph: older });
    await T.save({ ...base, id: `take-eyes2-${stamp}`, prompt_id: `eyes2-${stamp}`, number: 2, created: Date.now(), seconds: 70, ...await T.hashes(live), graph });
    snap.toggle();
    return [`take-eyes1-${stamp}`, `take-eyes2-${stamp}`];
  }, stamp);
  await page.waitForTimeout(1500);
  const [t1, t2] = R.ids;
  // the server keeps a list value plain where the page sends {"__value__": [...]} (BranchNode): a take of the live chain is not stale
  R.listsNotStale = await page.evaluate(async () => { const out = structuredClone((await app.graphToPrompt()).output);
    for (const n of Object.values(out)) for (const [k, v] of Object.entries(n.inputs)) if (v?.__value__) n.inputs[k] = v.__value__;
    return (await __T.stale({ prompt: out })) === null; });
  await page.evaluate(() => document.querySelector('.snap-brick[data-brick="save_video"]').scrollIntoView({ inline: "end" })); await page.waitForTimeout(400);

  // 1. the chain's own preview slot: newest take, then the hovered one, back on leave
  const slot = () => page.evaluate(() => { const el = document.querySelector('.snap-brick[data-brick="save_video"] .snap-out'); return el && { tag: el.querySelector("figcaption").textContent, previewing: el.classList.contains("previewing"), src: el.querySelector("video").dataset.src ?? null, hidden: el.hidden }; });
  R.slotNewest = await slot();
  await page.hover(`.snap-take[data-take="${t1}"]`); await page.waitForTimeout(500);
  R.slotHover = await slot();
  R.saveBrickSame = await page.evaluate(() => !!document.querySelector('.snap-brick[data-brick="save_video"] .snap-out'));
  await page.screenshot({ path: path.join(out, "112-u57-hover-preview.png") });
  await page.mouse.move(800, 120); await page.waitForTimeout(400);
  R.slotLeave = await slot();

  // 2. the orbit text names each opening's side for the camera (U57)
  R.orbit = await page.evaluate(async () => {
    const PL = await import("/extensions/ComfyUI-MAINodes/snap/plates.js"), L = await import("/extensions/ComfyUI-MAINodes/snap/library.js"), ss = await import("/extensions/ComfyUI-MAINodes/snap/setsnap.js");
    await L.ready(); const s = L.get("set-lamp-room-end-s3").brick.snapshot, cam = ss.plateCameras(s).find((c) => c.name === "OTS on Kon");
    return PL.orbitText(s, cam);
  });

  // 3. agent eyes over MCP (image blocks) and WebMCP (data URLs)
  const m = mcp();
  const frames = await m.call("take_frames", { take: t2, count: 4 });
  R.frames = { types: frames.content.map((c) => c.type), mime: frames.content[0].mimeType, info: JSON.parse(frames.content.at(-1).text).frames };
  fs.writeFileSync(path.join(out, "113-u23-take-frame.jpg"), Buffer.from(frames.content[1].data, "base64"));
  const picked = await m.call("take_frames", { take: t2, frames: [0, 24] });
  R.picked = JSON.parse(picked.content.at(-1).text).frames.map((f) => f.frame);
  R.webmcp = await page.evaluate(async (t2) => { const r = await window.__webmcp.snap_take_frames.execute({ take: t2, count: 2 }); return { n: r.images.length, url: r.images[0].url.slice(0, 23), data: "data" in r.images[0] }; }, t2);
  const people = await m.call("find_people", { take: t2, frame: 24 });
  R.people = { types: people.content.map((c) => c.type), info: JSON.parse(people.content.at(-1).text) };
  fs.writeFileSync(path.join(out, "114-u35-numbered-people.jpg"), Buffer.from(people.content[0].data, "base64"));

  // 4. plan-then-approve: run waits as a proposal with its plan (seconds from the take of this same recipe)
  const run = await m.call("run", {});
  R.run = JSON.parse(run.content[0].text);
  await page.waitForTimeout(600);
  R.chip = await page.$eval(".snap-proposal .snap-plan", (e) => e.textContent).catch(() => null);
  await page.screenshot({ path: path.join(out, "115-u35-plan-proposal.png") });
  R.listed = (await m.call("list_proposals", {})).content[0].text.includes('"eta_s": 70');
  m.close();

  // 5. Run from here: the viewer's button opens take 1's settings in a new tab, ready, nothing queued
  R.tabsBefore = await page.evaluate(() => app.extensionManager.workflow.openWorkflows.length);
  await page.evaluate((t1) => window.__snap.view.uiAct("open_take", t1), t1); await page.waitForTimeout(800);
  await page.click('.snap-take-sheet button:has-text("Run from here")'); await page.waitForTimeout(2500);
  R.runFrom = await page.evaluate(() => ({ tabs: app.extensionManager.workflow.openWorkflows.length, length: window.__snap.engine.getValue("render", "render", "length"), selected: window.__snap.view.selected,
    showing: window.__snap.switch.showing, toast: document.querySelector(".snap-toast").textContent, sheet: !!document.querySelector(".snap-take-sheet") }));
  await page.screenshot({ path: path.join(out, "116-u57-run-from-here.png") });
  R.queue = q; R.sam = sam; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_eyes_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1)); await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
