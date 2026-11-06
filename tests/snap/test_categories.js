// LoRAs by category on the CPU server (:8195, its 83 real dial files are its only LoRAs): the Library's category chips,
// the LoRA sheet (a chip filters, search works inside it), "move to…" on a row and a row dropped on a chip both file a
// LoRA in the person's snap/models.json, the change shows at once in the chips, the pickers and the agent tools, Undo
// puts it back, it survives a reload, the person wins over the pack (set_lora_category on a pack LoRA; the tool calls here
// act for the person, by: person, SNAP-R55), SFW only hides
// the nsfw category, and Library dial cards and dial picker tiles carry the same control. U67 (SNAP-R26) on a fake shelf:
// "turbo" inside a name, a method name alone (U84) and training step counts leave a LoRA unsorted, real turbos (step count, the
// graph's Krea turbo LoRA) stay core·turbo and in the Turbo slot, and a person's filing wins. U71 (SNAP-R27): a LoRA
// whose safetensors header is stamped private (written into the test server's own models/loras) wears a lock in the
// LoRA sheet, a stack row and the + LoRA picker, list_loras says private, and the row still adds; a take saved with no
// mark that loads it shows the lock (the server re-checks it), and so does a version (an edit) of it. Never queues.
// usage: node test_categories.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const { useShelf } = require("./shelf.js");
const out = path.join(CFG.out, "ui"), R = { queued: 0 };
const HOST = `http://127.0.0.1:${process.argv[2] || CFG.port}`;
const userdata = async (p) => { const r = await fetch(`${HOST}/userdata/${encodeURIComponent(p)}`); return r.status === 200 ? r.json() : null; };
async function open(b, shelf) {
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  if (shelf) await useShelf(page, shelf);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await page.route(/\/mainodes\/snap\/register$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"tools":0}' }));
  await page.route(/\/(api\/)?prompt$/, (r) => { if (r.request().method() === "POST") { R.queued++; return r.abort(); } return r.continue(); });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`${HOST}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => {
    const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js");
    window.__X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); window.__M = await import("/extensions/ComfyUI-MAINodes/snap/models.js");
    app.graph.clear(); app.graph.extra = {}; snap.toggle();
  });
  await page.waitForTimeout(2000);
  return { page, errs, call: (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]) };
}
const railChips = (page) => page.$$eval(".snap-lora-chips.rail .snap-lora-chip", (els) => els.map((e) => e.textContent));
const sheetChips = (page) => page.$$eval(".snap-lora-sheet .snap-lora-chip", (els) => els.map((e) => e.textContent));
const rows = (page) => page.$$eval(".snap-lora-sheet .snap-lora-row", (els) => els.map((e) => e.dataset.file));
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  let { page, errs, call } = await open(b);
  R.rail = await railChips(page);
  await page.screenshot({ path: path.join(out, "165-cat-rail-chips.png") });
  // the sheet from the rail's dial chip; search inside the category
  await page.click('.snap-lora-chips.rail .snap-lora-chip:has-text("dial")'); await page.waitForTimeout(600);
  R.sheet = { chips: await sheetChips(page), on: await page.$eval(".snap-lora-sheet .snap-lora-chip.on", (e) => e.textContent), rows: (await rows(page)).length };
  await page.fill(".snap-lora-sheet .snap-lib-q", "cam"); await page.waitForTimeout(300);
  const cam = await rows(page);
  R.search = { n: cam.length, allCam: cam.every((f) => f.toLowerCase().includes("cam")) };
  await page.screenshot({ path: path.join(out, "166-cat-sheet-search.png") });
  const [x, y] = cam;
  // "move to…" on a row: the person's snap/models.json, and every list follows
  await page.selectOption(`.snap-lora-sheet .snap-lora-row[data-file="${x}"] .snap-move`, "style"); await page.waitForTimeout(800);
  R.moved = { chips: await sheetChips(page), rail: await railChips(page), own: ((await userdata("snap/models.json")) ?? []).find((e) => x.endsWith(e.file)) ?? null,
    tool: (await call("list_loras", { category: "style" })).loras?.map((l) => l.name), picker: await page.evaluate((f) => __M.loraChoices().some(([n, e]) => n === f && e.role === "style"), x),
    toast: await page.$eval(".snap-toast", (e) => e.textContent) };
  await page.fill(".snap-lora-sheet .snap-lib-q", ""); await page.click('.snap-lora-sheet .snap-lora-chip:has-text("style")'); await page.waitForTimeout(400);
  R.styleRows = await rows(page);
  await page.screenshot({ path: path.join(out, "167-cat-moved-style.png") });
  // drop a row on a chip
  await page.click('.snap-lora-sheet .snap-lora-chip:has-text("dial")'); await page.fill(".snap-lora-sheet .snap-lib-q", "cam"); await page.waitForTimeout(300);
  await page.dragAndDrop(`.snap-lora-sheet .snap-lora-row[data-file="${y}"]`, '.snap-lora-sheet .snap-lora-chip[data-category="style"]'); await page.waitForTimeout(800);
  R.dropped = await page.evaluate((f) => __M.categoryOf(__M.entry(f)), y);
  await page.click(".snap-lora-sheet header .snap-link"); await page.waitForTimeout(800); // Undo move
  R.undone = { y: await page.evaluate((f) => __M.categoryOf(__M.entry(f)), y), x: await page.evaluate((f) => __M.categoryOf(__M.entry(f)), x), own: ((await userdata("snap/models.json")) ?? []).some((e) => y.endsWith(e.file)) };
  await page.click(".snap-lora-sheet header .snap-x");
  // Library dial cards and dial picker tiles carry the control
  R.cardMoves = await page.$$eval(".snap-card .snap-move", (els) => els.length);
  await call("start_recipe", {}); await page.waitForTimeout(2500);
  await call("ui", { action: "dials" }); await page.waitForTimeout(800);
  R.tileMoves = await page.$$eval(".snap-dial-tile .snap-move", (els) => els.length);
  await page.screenshot({ path: path.join(out, "168-cat-dial-picker-move.png") });
  await call("ui", { action: "close" });
  R.errors1 = errs;
  await page.context().close();
  // a reload keeps the move
  ({ page, errs, call } = await open(b));
  await page.evaluate(() => __M.load());
  R.reload = { x: await page.evaluate((f) => __M.categoryOf(__M.entry(f)), x), rail: await railChips(page) };
  // the person wins over the pack: a pack core LoRA filed as style, then put back
  const PIKA = "pika_h3_flex_fl2va_v1_bf16.safetensors";
  R.pack = (await (await fetch(`${HOST}/mainodes/snap/models`)).json()).models.find((e) => e.file === PIKA)?.role;
  const set = await call("set_lora_category", { file: PIKA, role: "style", by: "person" });
  R.person = { now: set.category, entry: await page.evaluate((f) => __M.entry(f).role, PIKA) };
  R.personBack = (await call("set_lora_category", { file: PIKA, undo: set.undo })).entry?.role;
  // SFW only hides the nsfw category
  await call("set_lora_category", { file: x, tags: ["nsfw"], by: "person" });
  R.nsfwShown = (await railChips(page)).some((c) => c.startsWith("nsfw"));
  await call("set_profile", { sfw_only: true }); await page.waitForTimeout(500);
  R.sfw = { rail: (await railChips(page)).some((c) => c.startsWith("nsfw")), tool: (await call("list_loras", { category: "nsfw" })).count };
  await call("ui", { action: "loras" }); await page.waitForTimeout(600);
  R.sfw.sheet = { chips: await sheetChips(page), x: (await rows(page)).includes(x), head: await page.$eval(".snap-lora-sheet header .snap-quiet", (e) => e.textContent) };
  await call("set_profile", { sfw_only: false });
  await call("set_lora_category", { file: x, role: "dial", tags: [], by: "person" });
  R.errors2 = errs;
  await page.context().close();
  // U67: names that aren't speed LoRAs, and real ones, on the fake shelf (sizes don't matter)
  const NOT = ["h3/cxy_kiss_lora_h3_v01_step1500.safetensors", "h3/h3_ref2va_facesit_5000steps.safetensors", "krea2/saggy-krea-turbo.safetensors",
    "krea2/person_turboeq_4000.safetensors", "style_v2_step_1500.safetensors", "krea2/hyperrealism_krea.safetensors", "some_flux_dmd2_lora.safetensors"]; // U84: a method name alone is no signal
  const FAST = ["krea2/krea2_turbo_lora_rank_64_bf16.safetensors", "h3/minimax_h3_pdmd_4step_lora_avg_rank_57_bf16.safetensors", "h3/MiniMax-H3-Ref2VA-Acc-8Step_comfy.safetensors",
    "h3/minimax_h3_fl2v_lightx2v_turbo_8step_v1.0_resized_avg_rank_24_bf16.safetensors", "lodestones_kromoss_8step_dmd2_lora.safetensors"];
  ({ page, errs, call } = await open(b, { extra: { loras: [...NOT, ...FAST.slice(0, -1)].map((f) => [f, 0.2]) } }));
  const cats = (list) => page.evaluate((l) => Object.fromEntries(l.map((f) => [f, __M.categoryOf(__M.entry(f))])), list);
  R.u67 = { not: await cats(NOT), fast: await cats(FAST), chip: (await railChips(page)).find((c) => c.startsWith("core · turbo")) ?? null };
  const turbosFor = async (setup) => { await call("apply_setup", { name: setup }); await page.waitForTimeout(1500); return (await call("list_methods", { slot: "turbo" })).methods?.map((t) => t.name); };
  await page.evaluate(async () => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); for (const k of ["models", "preset", "rack", "render"]) await snap.engine.snap(k); });
  R.u67.mossTurbos = await turbosFor("MOSS-Image Base (int8)");
  R.u67.kreaTurbos = await turbosFor("Krea 2 Raw (fp8)");
  // the person files one as a turbo: it wins over the inference, and Undo puts it back
  const filed = await call("set_lora_category", { file: NOT[2], role: "core·turbo", by: "person" });
  R.u67.person = { now: filed.category, slot: (await call("list_methods", { slot: "turbo" })).methods?.some((t) => t.file === NOT[2]) };
  R.u67.personBack = await call("set_lora_category", { file: NOT[2], undo: filed.undo }).then(() => page.evaluate((f) => __M.categoryOf(__M.entry(f)), NOT[2]));
  await call("ui", { action: "loras" }); await page.waitForTimeout(600);
  await page.click('.snap-lora-sheet .snap-lora-chip:has-text("core · turbo")'); await page.waitForTimeout(400);
  R.u67.sheet = await rows(page);
  await page.screenshot({ path: path.join(out, "172-u67-shelf-core-turbo.png") });
  R.errors3 = errs;
  await page.context().close();
  // U71: the stamped fixture, and a take saved before the rule (no mark) in a workflow of its own
  const argv = (await (await fetch(`${HOST}/system_stats`)).json()).system.argv, base = argv[argv.indexOf("--base-directory") + 1];
  const STAMPED = "snaptest_stamped_lora.safetensors", GROUP = require("crypto").randomUUID();
  const head = Buffer.from(JSON.stringify({ __metadata__: { name: "neutral", lorastery_recipe: JSON.stringify({ task: "character_lora", privacy: "full", dataset: { trigger: "nobody" } }) }, w: { dtype: "F32", shape: [1], data_offsets: [0, 4] } }));
  const len = Buffer.alloc(8); len.writeBigUInt64LE(BigInt(head.length));
  fs.writeFileSync(path.join(base, "models", "loras", STAMPED), Buffer.concat([len, head, Buffer.alloc(4)]));
  await fetch(`${HOST}/userdata/${encodeURIComponent("snap/takes/take-u71-lock.json")}?overwrite=true`, { method: "POST", body: JSON.stringify({ id: "take-u71-lock", group: GROUP, number: 1, created: Date.now(), status: "success",
    notes: [], media: [], text: "", verdict: null, prior: false, prompt: { 3: { class_type: "LoraLoaderModelOnly", inputs: { lora_name: STAMPED, strength_model: 1 } } }, graph: null }) });
  await fetch(`${HOST}/userdata/${encodeURIComponent("snap/takes/take-u71-version.json")}?overwrite=true`, { method: "POST", body: JSON.stringify({ id: "take-u71-version", group: GROUP, number: 2, created: Date.now() + 1, status: "success",
    notes: [], media: [], text: "", verdict: null, prior: false, parent: { take: "take-u71-lock", method: "edit/night" }, prompt: { 3: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 0 } } }, graph: null }) });
  ({ page, errs, call } = await open(b));
  // the take: Snap off, its workflow loaded, Snap on (Snap draws the strip for the workflow it opens on)
  await page.evaluate(async (id) => { const { snap } = await import("/extensions/ComfyUI-MAINodes/snap_view.js"); await snap.toggle();
    await app.loadGraphData({ id, revision: 0, last_node_id: 0, last_link_id: 0, nodes: [], links: [], groups: [], config: {}, extra: {}, version: 0.4 }); await snap.toggle(); }, GROUP);
  await page.waitForTimeout(2000);
  R.u71 = { take: await page.$$eval(".snap-take", (els) => els.map((e) => [e.dataset.take, !!e.querySelector(".snap-take-lock")])) };
  R.u71.saved = await page.evaluate(() => fetch("/api/userdata/snap%2Ftakes%2Ftake-u71-lock.json").then((r) => r.json()).then((t) => t.private ?? null));
  await page.locator(".snap-takes").screenshot({ path: path.join(out, "192-u71-take-lock.png") });
  await page.evaluate(() => __M.locks?.());
  const listed = (await call("list_loras", { filter: "snaptest" })).loras ?? [];
  Object.assign(R.u71, { tool: listed.filter((l) => l.private).map((l) => l.name).sort(), dialPrivate: ((await call("list_loras", { category: "dial" })).loras ?? []).filter((l) => l.private).length });
  await call("ui", { action: "loras" }); await page.waitForTimeout(600);
  await page.fill(".snap-lora-sheet .snap-lib-q", "snaptest"); await page.waitForTimeout(300);
  R.u71.sheet = await page.$$eval(".snap-lora-sheet .snap-lora-row", (els) => els.map((e) => [e.dataset.file, e.querySelector("strong").textContent.startsWith("🔒")]));
  await page.screenshot({ path: path.join(out, "190-u71-sheet-locks.png") });
  await page.click(".snap-lora-sheet header .snap-x");
  await call("start_recipe", {}); await page.waitForTimeout(2500);
  R.u71.added = await call("add_lora", { file: STAMPED, role: "style", person_asked: true }); await page.waitForTimeout(1200);
  R.u71.row = await page.$$eval(".snap-lora .snap-lora-name", (els) => els.map((e) => e.textContent));
  R.u71.option = await page.$$eval(".snap-lora-add option", (els) => els.map((e) => e.textContent).filter((t) => t.includes("snaptest_stamped")));
  await page.screenshot({ path: path.join(out, "191-u71-stack-row-lock.png") });
  R.errors4 = errs;
  await b.close();
  fs.writeFileSync(path.join(out, "test_categories_result.json"), JSON.stringify({ x, y, ...R }, null, 1));
})();
