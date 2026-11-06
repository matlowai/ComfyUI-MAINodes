// G2 (UX walkthrough UI-01, B1, B12, B2/UI-08, UI-13; SNAP-R118, R119) on the CPU test server: References you can edit.
// - a PNG dropped on References is a NEW picture (B1: it used to replace the Cast's first picture) and its toast stays
//   (B12: the "carries no recipe" toast no longer overwrites it);
// - each picture shows P<n>, a picture the prompt names nowhere says so; ✕ takes one out and the prompt's <Picture n>
//   follow (a cite of the one taken out reads <Picture ?>); ‹ moves one earlier, cites follow; the caption renames its role;
// - move_ref / remove_ref answer the same; describe_recipe.references carries `named`;
// - "+ Add ▾ › A take from any scene…" opens the take picker; Use puts the take's frame in;
// - B2: after a reload a picture in an input subfolder is not "missing", a file that is gone is;
// - UI-13: under Pika H3 Flex (FL2V) the References brick says it doesn't read them, and its button switches to Ref2V.
// Screens: ui/g2/refs_editor.png, refs_phone.png, refs_picker.png, refs_unread.png. usage: node test_g2_refs.js [port]
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {}, out = path.join(CFG.out, "ui", "g2");
(async () => {
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const refs = () => page.evaluate(() => window.__E.references().pictures.map((p) => [p.cite, p.role, p.file, p.named]));
    const prompt = () => page.evaluate(() => window.__E.getValue("render", "render", "prompt"));
    const face = () => page.evaluate(() => [...document.querySelectorAll('.snap-brick[data-brick="refs"] .snap-pics figure')].map((f) => ({ n: f.querySelector(".snap-ref-n")?.textContent, cap: f.querySelector("figcaption")?.textContent, unnamed: !!f.querySelector(".snap-ref-unnamed") })));
    const toast = () => page.evaluate(() => document.querySelector(".snap-toast")?.textContent ?? "");
    await call("start_recipe", {}); await page.waitForTimeout(2500);
    await call("apply_setup", { name: "Pika + reference pictures" });
    const cast = await call("save_cast", { name: "G2 Suna", lora: null, refs: [{ file: "snap/location/village/Pa_road_outside.png", role: "identity: front" }, { file: "snap/location/village/Pb_gate_inside_open.png", role: "state A" }] });
    R.cast = cast; await call("apply_cast", { cast: cast.cast });
    await call("set_setting", { brick: "render", name: "prompt", value: "integrated_multimodal_description: [Shot 1] Suna as in <Picture 1> walks; her hood as in <Picture 2>." });
    R.castFiles = (await refs()).map((x) => x[2]);
    // B1 + B12: drop a PNG on References
    R.drop = await page.evaluate(async () => {
      const c = Object.assign(document.createElement("canvas"), { width: 64, height: 64 }); const g = c.getContext("2d"); g.fillStyle = "#3a6"; g.fillRect(0, 0, 64, 64);
      const blob = await new Promise((r) => c.toBlob(r, "image/png")), dt = new DataTransfer(); dt.items.add(new File([blob], "g2_plate.png", { type: "image/png" }));
      const el = document.querySelector('.snap-brick[data-brick="refs"]');
      for (const t of ["dragenter", "dragover", "drop"]) el.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 1200)); return document.querySelector(".snap-toast")?.textContent ?? "";
    });
    await page.waitForTimeout(3000); R.toastLater = await toast();
    R.afterDrop = await refs(); R.faceAfterDrop = await face();
    await call("ui", { action: "select", target: "refs" }); await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(out, "refs_editor.png") });
    // ✕ on P1 (a Cast picture): out, the prompt's cites follow
    await page.evaluate(() => [...document.querySelectorAll('.snap-brick[data-brick="refs"] .snap-pics figure')][0].querySelector(".snap-ref-tool:last-child").click());
    await page.waitForTimeout(500);
    R.afterX = await refs(); R.promptAfterX = await prompt(); R.toastX = await toast();
    // ‹ on the dropped picture (now P2): it becomes P1, "<Picture 1>" (her hood) becomes <Picture 2>
    await page.evaluate(() => [...document.querySelectorAll('.snap-brick[data-brick="refs"] .snap-pics figure')][1].querySelector(".snap-ref-tool").click());
    await page.waitForTimeout(500);
    R.afterMove = await refs(); R.promptAfterMove = await prompt();
    // the caption renames the role
    await page.evaluate(() => [...document.querySelectorAll('.snap-brick[data-brick="refs"] .snap-pics figure')][0].querySelector("figcaption").click());
    await page.keyboard.press("Control+A"); await page.keyboard.type("plate: the road"); await page.keyboard.press("Enter"); await page.waitForTimeout(400);
    R.afterRole = await refs();
    R.title = await page.evaluate(() => { const p = window.__E.references().pictures[0]; return app.graph.getNodeById(p.node).title; });
    // the tools
    R.moveTool = await call("move_ref", { picture: 1, to: 2 }); R.promptAfterTool = await prompt();
    R.removeTool = await call("remove_ref", { picture: 1 }); R.promptAfterRemove = await prompt();
    R.describe = (await call("describe_recipe", {})).references?.pictures?.map((p) => [p.cite, p.named]);
    // + Add › a take
    await page.evaluate(async () => {
      const T = window.__T, mk = { id: "take-g2-pick", kind: "run", prompt_id: "g2pick", created: Date.now(), seconds: 9, group: "g2-elsewhere", number: 931, status: "success", text: "a still elsewhere", seed: 1,
        media: [{ kind: "image", filename: "Pd_houses.png", subfolder: "snap/location/village", type: "input" }], prompt: {}, graph: { extra: { snap: { world: {} } } }, world: {}, verdict: null, notes: [] };
      await T.save(mk);
    });
    await page.evaluate(() => document.querySelector('.snap-brick[data-brick="refs"] .snap-refs-add').click()); await page.waitForTimeout(300);
    R.menu = await page.evaluate(() => [...document.querySelectorAll(".snap-refs-menu button")].map((x) => x.textContent));
    await page.evaluate(() => [...document.querySelectorAll(".snap-refs-menu button")].find((x) => x.textContent.startsWith("A take")).click()); await page.waitForTimeout(900);
    R.picker = await page.evaluate(() => [...document.querySelectorAll(".snap-take-picker .snap-picker-take button")].map((x) => x.textContent));
    await page.screenshot({ path: path.join(out, "refs_picker.png") });
    await page.evaluate(() => [...document.querySelectorAll(".snap-take-picker .snap-picker-take button")].find((x) => /931/.test(x.textContent)).click()); await page.waitForTimeout(1500);
    R.afterPick = await refs();
    // B2: a subfolder picture and a gone one, across a reload
    await call("add_ref", { file: "snap/location/village/Pd_houses.png", role: "houses" });
    await page.evaluate(() => { const n = LiteGraph.createNode("LoadImage"); app.graph.add(n); const w = n.widgets.find((x) => x.name === "image"); w.value = "snap/g2_gone_picture.png"; n.title = "gone"; });
    await page.waitForTimeout(800);
    await page.evaluate(() => app.extensionManager.workflow.activeWorkflow.changeTracker?.checkState?.());
    await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500); await F.loadMods(page);
    R.snapShowing = await page.evaluate(() => !!document.querySelector('.snap-brick[data-brick="refs"]'));
    R.missingAfterReload = await page.evaluate(() => window.__E.missing().map((m) => m.value));
    R.status = await page.evaluate(() => document.querySelector(".snap-status")?.textContent);
    R.describeMissing = (await call("describe_recipe", {})).missing?.map((m) => m.value);
    // UI-13: FL2V ignores References
    await page.evaluate(() => { const n = app.graph.nodes.find((x) => x.title === "gone"); if (n) app.graph.remove(n); });
    await call("apply_setup", { name: "Pika H3 Flex" }); await call("ui", { action: "select", target: "refs" }); await page.waitForTimeout(700);
    R.unreadFn = await page.evaluate(async () => { const L = await import("/extensions/ComfyUI-MAINodes/snap/library.js"); return [L.picturesUnread(), String(window.__E.getValue("preset", "preset", "conditioning")), window.__E.state().bricks.map((b) => b.key)]; });
    R.unread = await page.evaluate(() => document.querySelector('.snap-brick[data-brick="refs"] .snap-refs-unread')?.textContent ?? null);
    await page.screenshot({ path: path.join(out, "refs_unread.png") });
    await page.evaluate(() => document.querySelector('.snap-brick[data-brick="refs"] .snap-refs-unread button')?.click()); await page.waitForTimeout(600);
    R.condAfterSwitch = await page.evaluate(() => String(window.__E.getValue("preset", "preset", "conditioning")));
    await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(out, "refs_phone.png"), fullPage: false });
    R.hscroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    R.errors = [...A.errors];
  } finally { await b.close(); }
  const checks = {
    "B1: a dropped PNG is a third picture; the Cast's two files are unchanged": R.afterDrop?.length === 3 && R.afterDrop[0][2] === R.castFiles[0] && R.afterDrop[1][2] === R.castFiles[1] && R.afterDrop[2][1] === "picture",
    "B12: the drop's toast names its <Picture 3> and stays (no 'carries no recipe')": /→ References as <Picture 3>/.test(R.drop) && !/carries no recipe/.test(R.toastLater),
    "the face numbers P1-P3 and marks the picture the prompt names nowhere": JSON.stringify(R.faceAfterDrop?.map((f) => [f.n, f.unnamed])) === JSON.stringify([["P1", false], ["P2", false], ["P3", true]]),
    "✕ on P1 takes it out; the prompt's cites follow and the removed cite reads <Picture ?>": R.afterX?.length === 2 && R.afterX[0][2] === R.castFiles[1] && /Suna as in <Picture \?> walks; her hood as in <Picture 1>\./.test(R.promptAfterX ?? "") && /<Picture \?>/.test(R.toastX),
    "‹ moves the dropped picture to P1 and the hood cite follows to <Picture 2>": R.afterMove?.[0]?.[1] === "picture" && /her hood as in <Picture 2>\./.test(R.promptAfterMove ?? ""),
    "the caption renames the role (and the Load Image's title)": R.afterRole?.[0]?.[1] === "plate: the road" && R.title === "plate: the road",
    "move_ref answers the new cite and the prompt follows": R.moveTool?.cite === "<Picture 2>" && /her hood as in <Picture 1>\./.test(R.promptAfterTool ?? ""),
    "remove_ref says the prompt's cite was orphaned": /Picture \?/.test(R.removeTool?.orphaned ?? "") && R.removeTool?.references?.pictures?.length === 1,
    "describe_recipe.references says which pictures the prompt names": Array.isArray(R.describe) && R.describe.every((x) => typeof x[1] === "boolean"),
    "+ Add offers a take, a file, the Cast": R.menu?.[0]?.startsWith("A take") && R.menu.includes("A picture file…") && R.menu.some((x) => x === "Cast: G2 Suna"),
    "the take picker lists the take and Use puts it in": R.picker?.some((x) => /931/.test(x)) && R.afterPick?.some((x) => /take 931, frame 0/.test(x[1])),
    "B2: after a reload the subfolder picture is there and the gone one is missing": Array.isArray(R.missingAfterReload) && !R.missingAfterReload.includes("snap/location/village/Pd_houses.png") && R.missingAfterReload.includes("snap/g2_gone_picture.png") && R.describeMissing?.includes("snap/g2_gone_picture.png") && !R.describeMissing.includes("snap/location/village/Pd_houses.png"),
    "UI-13: under FL2V the brick says References aren't read, and the button switches to Ref2V": /doesn't read References/.test(R.unread ?? "") && /^Ref2V/.test(R.condAfterSwitch ?? ""),
    "no horizontal scroll at 390 px": R.hscroll <= 0,
    "no page errors": !R.errors?.length,
  };
  console.log(JSON.stringify(R, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`g2refs ${Object.keys(checks).length - bad}/${Object.keys(checks).length}${F.BEFORE ? ` (BEFORE=${F.BEFORE})` : ""}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
