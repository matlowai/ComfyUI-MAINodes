// Batch F (the Work card) test helpers: a Snap page on the CPU test server whose queued prompts are rewritten to 64 px CPU
// prompts (extra_data kept, so the job stamps reach /queue and /history), the Snap modules on window.__<name>, and
// BEFORE=1 to serve the snap-scout worktree's HEAD~N copies of the page code (the before-measure without touching the
// worktree, LESSONS batch C). usage: const F = require("./fwork.js"); const { page } = await F.open(browser, port)
const CFG = require("./snaptest_config.js");
const { execFileSync } = require("child_process");
const WT = CFG.pack;
const BEFORE = process.env.BEFORE; // a git rev, e.g. bde016d, or unset
const MODS = [["X", "tools"], ["E", "engine"], ["T", "takes"], ["C", "candidates"], ["K", "checks"], ["ED", "edits"], ["P", "proposals"], ["SC", "scenes"], ["RT", "retake"], ["PL", "plates"], ["J", "jobs"], ["A", "activity"], ["WV", "workview"]];

async function open(browser, port, { viewport = { width: 1600, height: 1000 }, slow = 0, context } = {}) {
  const ctx = context ?? await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  if (BEFORE) await page.route(/\/extensions\/ComfyUI-MAINodes\/(snap\/[\w]+\.js|snap_view\.js)/, (r) => {
    const rel = r.request().url().match(/ComfyUI-MAINodes\/([^?]+)/)[1];
    try { r.fulfill({ contentType: "text/javascript", body: execFileSync("git", ["-C", WT, "show", `${BEFORE}:web/${rel}`], { maxBuffer: 1 << 26 }) }); } catch { r.fulfill({ status: 404, body: "" }); }
  });
  const queued = [];
  await page.route(/\/(api\/)?prompt$/, (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const body = JSON.parse(r.request().postData());
    queued.push({ extra: body.extra_data, client: body.client_id });
    const n = queued.length;
    // `slow`: steps of a 64 px KSampler-free chain are too fast to watch, so a slow prompt repeats a resize
    body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 + n } } };
    let last = "1";
    for (let i = 0; i < slow; i++) { body.prompt[`r${i}`] = { class_type: "ImageScale", inputs: { image: [last, 0], upscale_method: "lanczos", width: 2048, height: 2048, crop: "disabled" } }; last = `r${i}`; }
    body.prompt.s = { class_type: "SaveImage", inputs: { images: [last, 0], filename_prefix: "snaptest/batchF" } };
    // a job whose question says [fail] fails while it runs: a blur wider than its 4 px picture can pad
    if (/\[fail\]/.test(body.extra_data?.snap_job?.title ?? "")) body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 4, height: 4, batch_size: 1, color: 0 } }, 2: { class_type: "ImageBlur", inputs: { image: ["1", 0], blur_radius: 31, sigma: 1 } }, s: { class_type: "SaveImage", inputs: { images: ["2", 0], filename_prefix: "snaptest/batchF" } } };
    if (/\[refuse\]/.test(body.extra_data?.snap_job?.title ?? "")) body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 0 } }, s: { class_type: "SaveImage", inputs: { images: ["x", 0], filename_prefix: "snaptest/batchF" } }, x: { class_type: "LoadImage", inputs: { image: "snaptest/no_such_picture_here.png" } } };
    delete body.partial_execution_targets;
    return r.continue({ postData: JSON.stringify(body) });
  });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`);
  await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 });
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await loadMods(page);
  return { ctx, page, queued, errors };
}
const loadMods = (page) => page.evaluate(async (mods) => { for (const [k, m] of mods) { try { window[`__${k}`] = await import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); } catch { /* not at this rev */ } } }, MODS);
const history = async (port, id) => (await (await fetch(`http://127.0.0.1:${port}/history/${id}`)).json())[id] ?? null;
const idle = async (port) => { for (let i = 0; i < 240; i++) { const q = await (await fetch(`http://127.0.0.1:${port}/queue`)).json(); if (!q.queue_running.length && !q.queue_pending.length) return; await new Promise((r) => setTimeout(r, 500)); } };
module.exports = { open, loadMods, history, idle, BEFORE };
