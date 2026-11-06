// U76 backstop from U78 (SNAP-R36): a video take keeps its sound's loudness from capture; below -45 dB it says
// "sound is quiet" on its card and in its viewer, with "Make it louder" (a new version: loudnorm I=-23 TP=-2, the picture
// stream copied) and "Re-prompt with sound events" (the Render's prompt opens with prompt_help). Nothing runs unasked.
// Queues two tiny CPU videos (24 frames of 64 px with a 440 Hz tone at -60 dB and at -20 dB) and the louder version.
// Screenshots: ui/252-u76-quiet-note.png (viewer), ui/253-u76-quiet-card.png (the card and the version).
// usage: node test_u76_sound.js [port 8195] [base dir]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { execFileSync, spawn } = require("child_process");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
const base = process.argv[3] || CFG.base;
const MCP = path.join(CFG.pack, "tools", "snap_mcp.py");
function mcpClient() {
  const p = spawn("python3", ["-I", MCP, "--port", port]); let buf = "", id = 0; const waiting = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) { const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); } } });
  const send = (method, params) => new Promise((res) => { const m = { jsonrpc: "2.0", id: ++id, method, params }; waiting.set(m.id, res); p.stdin.write(JSON.stringify(m) + "\n"); });
  const call = async (name, args = {}) => { const r = (await send("tools/call", { name, arguments: args })).result; const text = r.content.find((c) => c.type === "text")?.text; let v; try { v = JSON.parse(text); } catch { v = text; } return { error: r.isError, value: v }; };
  return { send, call, close: () => p.kill() };
}
const videoMd5 = (f) => execFileSync("ffmpeg", ["-v", "error", "-i", f, "-map", "0:v", "-c", "copy", "-f", "md5", "-"]).toString().trim();
(async () => {
  for (const [name, db] of [["snaptest_u76_quiet.wav", -60], ["snaptest_u76_loud.wav", -20]])
    execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-af", `volume=${db}dB`, path.join(base, "input", name)]);
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
  await page.evaluate(() => { app.graph.clear(); app.graph.extra = {}; return app.extensionManager.setting.set("MAINodes.Snap.AgentsMayRun", false); });
  const a = mcpClient();
  await a.send("initialize", {});
  await a.call("start_recipe");
  // a take of this workflow from a tiny video with a tone at `wav`'s level, queued as the page queues its own checks
  const take = (wav) => page.evaluate(async (wav) => {
    const K = await import("/extensions/ComfyUI-MAINodes/snap/checks.js"), T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
    const id = await K.queue({ 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 24, color: 3355443 } }, 2: { class_type: "LoadAudio", inputs: { audio: wav } },
      3: { class_type: "CreateVideo", inputs: { images: ["1", 0], audio: ["2", 0], fps: 12 } }, 4: { class_type: "SaveVideo", inputs: { video: ["3", 0], filename_prefix: "snaptest/u76", format: "auto", "format.codec": "auto", codec: "auto" } } }, { job: { kind: "run", title: "a test fixture take (SNAP-R65: every queued prompt carries its question)" }, group: app.graph.id });
    for (let i = 0; i < 120 && !T.get(`take-${id}`); i++) await new Promise((r) => setTimeout(r, 500));
    const t = T.get(`take-${id}`);
    return t && { id: t.id, sound: t.sound ?? null, quiet: T.quiet(t), media: t.media[0] };
  }, wav);
  R.quiet = await take("snaptest_u76_quiet.wav");
  R.loud = await take("snaptest_u76_loud.wav");
  await page.waitForTimeout(800);
  R.cards = await page.evaluate(() => [...document.querySelectorAll(".snap-take")].map((c) => ({ take: c.dataset.take, quiet: !!c.querySelector(".snap-take-quiet") })));

  // the viewer: the note and its two actions; nothing changed yet
  await page.click(`.snap-take[data-take="${R.quiet.id}"]`); await page.waitForTimeout(800);
  R.row = await page.evaluate(() => ({ text: document.querySelector(".snap-take-quietrow")?.textContent ?? null, buttons: [...document.querySelectorAll(".snap-take-quietrow button")].map((x) => x.textContent) }));
  R.takesBeforeClick = await page.evaluate(async () => (await import("/extensions/ComfyUI-MAINodes/snap/takes.js")).inGroup().length);
  await page.screenshot({ path: path.join(out, "252-u76-quiet-note.png") });
  // Make it louder: a version of the take, louder, the picture stream copied
  await page.click(".snap-take-quietrow button:has-text('Make it louder')");
  R.version = await page.evaluate(async (parent) => {
    const T = await import("/extensions/ComfyUI-MAINodes/snap/takes.js");
    for (let i = 0; i < 120; i++) { const v = T.all().find((t) => t.parent?.take === parent && t.parent.method === "louder"); if (v) return { id: v.id, sound: v.sound ?? null, quiet: T.quiet(v), media: v.media[0], group: v.group === T.groupOf() }; await new Promise((r) => setTimeout(r, 500)); }
    return null;
  }, R.quiet.id);
  const file = (m) => path.join(base, m.type, m.subfolder, m.filename);
  R.pictureCopied = R.version ? videoMd5(file(R.quiet.media)) === videoMd5(file(R.version.media)) : false;
  await page.keyboard.press("Escape"); await page.waitForTimeout(600);
  await page.evaluate(() => document.querySelector(".snap-takes")?.scrollIntoView());
  await page.screenshot({ path: path.join(out, "253-u76-quiet-card.png") });

  // Re-prompt with sound events: the Render opens and prompt_help is said
  await page.click(`.snap-take[data-take="${R.quiet.id}"]`); await page.waitForTimeout(800);
  await page.click(".snap-take-quietrow button:has-text('Re-prompt')"); await page.waitForTimeout(600);
  R.reprompt = await page.evaluate(() => ({ toast: document.querySelector(".snap-toast")?.textContent ?? "", selected: document.querySelector(".snap-brick.selected, .snap-brick.open")?.dataset.brick ?? null }));

  // agents: list_takes says quiet; make_louder makes a version
  R.listed = (await a.call("list_takes")).value.filter((t) => [R.quiet.id, R.loud.id].includes(t.id)).map((t) => ({ id: t.id, sound: t.sound }));
  R.tool = await a.call("make_louder", { take: R.loud.id });
  R.toolStatus = await a.call("run_status", { run: R.tool.value?.run, wait_s: 20 });
  a.close();
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_u76_sound_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
