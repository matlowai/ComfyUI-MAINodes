// U47 polish on a fake model shelf, at a 1280 px wide window: the proposal pill stays on one line; a slot's proposal
// (preview {slot}) sits on the brick that fills the slot and a recipe-wide one (run) above the chain, never as a chain
// item running off its right edge; the seed on Render's face: the dice draws a new seed (one undo step), fixed keeps it
// over a run, random draws one after each run, and new_seed does both for agents; the families block in the model graph
// names the family of a file no entry knows. Never queues (the run is a proposal; "a run" is a promptQueued event).
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const out = path.join(CFG.out, "ui"); const R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  let q = 0; await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { q++; return r.abort(); } return r.continue(); });
  await useShelf(page);
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${CFG.port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); window.__snap = snap;
    window.__tools = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); window.__M = await import("/extensions/ComfyUI-MAINodes/snap/models.js");
    snap.toggle();
  });
  const call = (name, args) => page.evaluate(([n, a]) => window.__tools.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
  await call("apply_setup", { name: "MOSS-Image Base (int8)" }); await page.waitForTimeout(1500);
  await call("set_method", { slot: "upscale", method: "esrgan", factor: 2 }); await page.waitForTimeout(600);
  R.previewProposal = await call("preview", { slot: "upscale" });
  R.runProposal = await call("run", {});
  await page.waitForTimeout(800);
  R.pill = await page.$eval(".snap-proposals", (el) => { const r = el.getBoundingClientRect(), tops = [...el.children].map((c) => Math.round(c.getBoundingClientRect().top)); return { text: el.textContent, height: Math.round(r.height), oneLine: [...el.children].every((c) => { const x = c.getBoundingClientRect(); return x.top >= r.top && x.bottom <= r.bottom; }) && r.height < 32 }; });
  R.header = await page.evaluate(() => { const top = document.querySelector(".snap-top").getBoundingClientRect(); return { title: Math.round(document.querySelector(".snap-title").getBoundingClientRect().width), runInside: document.querySelector(".snap-run").getBoundingClientRect().right <= top.right }; });
  R.placed = await page.evaluate(() => [...document.querySelectorAll(".snap-proposal")].map((el) => {
    const stack = document.querySelector(".snap-stack"), s = stack.getBoundingClientRect(), r = el.getBoundingClientRect();
    return { what: el.querySelector(".snap-proposal-what").textContent, brick: el.closest("[data-brick]")?.dataset.brick ?? null, inNotes: !!el.closest(".snap-notes"), chainItem: el.parentElement === stack, inside: r.right <= s.right + 1 && r.left >= s.left - 1 };
  }));
  await page.screenshot({ path: path.join(out, "106-proposals-placed.png") });
  await page.locator(".snap-notes").screenshot({ path: path.join(out, "106b-proposal-pill.png") });
  // the seed on the image Render's face
  const seed = () => page.evaluate(() => ({ seed: window.__snap.engine.getValue("image", "image", "noise_seed"), mode: window.__snap.engine.seedMode?.("image") ?? null, face: document.querySelector('[data-brick="image"] .snap-seed')?.textContent ?? null }));
  const ranAgain = () => page.evaluate(async () => { const { api } = await import("/scripts/api.js"); api.dispatchEvent(new CustomEvent("promptQueued", { detail: { number: 0, batchCount: 1 } })); });
  R.seedStart = await seed();
  const press = (sel) => page.locator(sel).click({ timeout: 2000 }).catch(() => null); // missing controls count as failures below
  await press('[data-brick="image"] .snap-dice'); await page.waitForTimeout(300);
  R.afterDice = await seed();
  R.diceUndo = await page.evaluate(async () => { await app.extensionManager.command.execute("Comfy.Undo"); await new Promise((r) => setTimeout(r, 400)); return window.__snap.engine.getValue("image", "image", "noise_seed"); });
  await ranAgain(); await page.waitForTimeout(300);
  R.fixedAfterRun = await seed();
  await press('[data-brick="image"] .snap-seed button:has-text("random")'); await page.waitForTimeout(300);
  R.randomMode = await seed();
  await ranAgain(); await page.waitForTimeout(300);
  R.randomAfterRun = await seed();
  await page.locator('[data-brick="image"]').screenshot({ path: path.join(out, "107-render-seed.png") });
  R.agentFixed = await call("new_seed", { brick: "image", mode: "fixed" });
  R.agentRoll = await call("new_seed", { brick: "image" });
  R.noSeed = await call("new_seed", { brick: "save_image" });
  // families from the model graph, for files no entry names
  R.families = await page.evaluate(async () => { await window.__M.load(); return [(await (await fetch("/mainodes/snap/models")).json()).families?.map((f) => f.name) ?? null,
    ...["my_kromoss_finetune_v2.safetensors", "krea_some_merge.safetensors", "pika_h3_thing.safetensors", "sdxl_base.safetensors"].map((f) => window.__M.entry(f).family)]; });
  // U51: the Queued toast clears the takes strip, and the Setup panel names settings as the bricks' faces do (image kit
  // here, the H3 Simple recipe next: video VAE / audio VAE, not "vae name" twice)
  await ranAgain(); await page.waitForTimeout(250);
  R.toast = await page.evaluate(() => { const t = document.querySelector(".snap-toast"), a = t.getBoundingClientRect(), s = document.querySelector(".snap-takes").getBoundingClientRect();
    return { text: t.textContent, shown: t.classList.contains("show"), clear: a.bottom <= s.top || a.top >= s.bottom, top: Math.round(a.top) }; });
  await page.screenshot({ path: path.join(out, "142-u51-toast-top-right.png") });
  const labels = () => page.$$eval(".snap-inspector .snap-insp-node .snap-field > span", (x) => x.map((e) => e.textContent));
  await call("ui", { action: "select", target: "image_models" }); await page.waitForTimeout(900);
  R.imageLabels = await labels();
  await call("start_recipe", {}); await page.waitForTimeout(2500);
  await call("ui", { action: "select", target: "models" }); await page.waitForTimeout(900);
  R.h3Labels = await labels();
  await page.screenshot({ path: path.join(out, "143-u51-setup-labels.png") });
  R.queue = q; R.errors = errs;
  fs.writeFileSync(path.join(out, "test_polish_result.json"), JSON.stringify(R, null, 1));
  await b.close();
})();
