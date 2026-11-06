// Batch C, batch B's two unbuilt pin items (SNAP-R60), on the CPU test server:
// (a) applying a family recipe card (a setup) pins it in the recipe's world (`setup: true`, a pack card = version 0 with
//     its hash). Another family opens a new tab: the pin lands on that tab, the tab it left keeps its own pins and gets
//     none; a second setup of the same family in place replaces the setup pin and keeps the other pins.
// (b) a pin on a pack card (version 0) reads as moved when a pack update changes the card ("<name> (the pack updated this
//     card)", a chip with one-press update on the brick, describe_recipe moved: true) and as missing when the pack drops
//     it; update puts today's card in and the chip goes. The pack update is simulated by serving a changed
//     /mainodes/snap/cards to a second page.
// Screens ui/356 (the pack-updated chip, desktop), 357 (390 px).
// usage: node test_c_pins.js [port 8195]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.port, out = path.join(CFG.out, "ui"), R = {};
async function open(b, { viewport = { width: 1600, height: 1000 }, pack } = {}) {
  const page = await (await b.newContext({ viewport })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  if (pack) await page.route(/\/mainodes\/snap\/cards$/, async (r) => { const res = await r.fetch(), body = await res.json(); r.fulfill({ response: res, body: JSON.stringify(pack(body)) }); });
  page.errs = []; page.on("pageerror", (e) => page.errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/?snap`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3000);
  await page.keyboard.press("Escape");
  await page.evaluate(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["E", "engine"], ["M", "models"], ["W", "world"], ["T", "takes"]]) window[`__${k}`] = await at(m); await window.__L.ready(); });
  return page;
}
const changed = (body) => ({ ...body, cards: body.cards.filter((c) => c.id !== "p-staging").map((c) => (c.id === "p-squash" ? { ...c, text: c.text.replace("Prompt cue: ", "Prompt cue: pack v2 cue, ") } : c)) });
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    // ---- (a) setup pins ----
    const page = await open(b), ev = (fn, arg) => page.evaluate(fn, arg);
    R.a = await ev(async () => {
      const { X, L, E, M } = { X: window.__X, L: window.__L, E: window.__E, M: window.__M }, keys = () => Object.keys(E.state().world ?? {}).sort();
      app.graph.clear(); app.graph.extra = {}; await X.callTool("start_recipe", {}); await M.load();
      await L.apply(L.get("p-squash"));
      const r = { h3: { family: M.family(), world: keys() } };
      const old = app.extensionManager.workflow.activeWorkflow;
      r.newTab = await M.useSetup({ source: "recipe", card: "setup-moss-base" }, { keep: false });
      r.moss = { family: M.family(), world: structuredClone(E.state().world), differentTab: app.extensionManager.workflow.activeWorkflow !== old };
      E.tag("world", { ...E.state().world, "card:p-anticipation": { follow: true, n: 0, hash: "000000000000", name: "Anticipation" } }); // another pin (an image recipe has no Render brick for word cards)
      r.inPlace = await M.useSetup({ source: "recipe", card: "setup-moss-sft-deband" }, { keep: false });
      r.moss2 = { world: structuredClone(E.state().world) };
      r.described = (await X.callTool("describe_recipe", {})).world;
      const kept = (old.changeTracker?.activeState ?? old.activeState)?.extra?.snap; // the tab it left, as that tab holds it
      r.oldTab = { family: kept?.family ?? null, world: Object.keys(kept?.world ?? {}).sort(), open: app.extensionManager.workflow.openWorkflows.includes(old) };
      return r;
    });
    R.squashPin = await ev(() => { const old = app.extensionManager.workflow.openWorkflows.find((w) => (w.changeTracker?.activeState ?? w.activeState)?.extra?.snap?.world?.["card:p-squash"]); return (old.changeTracker?.activeState ?? old.activeState).extra.snap.world["card:p-squash"]; });
    // ---- (b) the pack updates p-squash and drops p-staging ----
    const pinned = { "card:p-squash": R.squashPin, "card:p-staging": { follow: true, n: 0, hash: await ev(async () => window.__W.short(await window.__W.sha(window.__L.get("p-staging")))), name: "Staging" } };
    R.before = await ev((w) => window.__T.moves(w), pinned);
    const shot = async (viewport, file) => {
      const p2 = await open(b, { viewport, pack: changed });
      const r = await p2.evaluate(async (w) => {
        const { X, E, T, W } = { X: window.__X, E: window.__E, T: window.__T, W: window.__W };
        app.graph.clear(); app.graph.extra = {}; await X.callTool("start_recipe", {});
        E.tag("world", w);
        const moves = T.moves(w);
        return { moves, texts: moves.map(T.moveText), packKnown: W.packKnown(), described: (await X.callTool("describe_recipe", {})).world };
      }, pinned);
      await p2.evaluate(async () => (await import("/extensions/ComfyUI-MAINodes/snap/tools.js")).callTool("ui", { action: "select", target: "render" })).catch(() => null);
      await p2.waitForTimeout(800);
      r.chip = await p2.evaluate(() => [...document.querySelectorAll(".snap-pin")].map((x) => [x.className, x.textContent]));
      await p2.evaluate(() => document.querySelector(".snap-pin.moved")?.scrollIntoView({ block: "center" }));
      await p2.screenshot({ path: path.join(out, file) });
      return { p2, r };
    };
    const desk = await shot({ width: 1600, height: 1000 }, "356-c-pack-card-updated.png");
    R.b = desk.r;
    await desk.p2.locator(".snap-pin.moved").first().click(); await desk.p2.waitForTimeout(800);
    R.afterUpdate = await desk.p2.evaluate(async () => ({ pin: window.__E.state().world["card:p-squash"], today: window.__W.packCard("card:p-squash")?.hash, moves: window.__T.moves(window.__E.state().world).map((m) => m.ref),
      prompt: window.__E.getValue("render", "render", "prompt"), chips: [...document.querySelectorAll(".snap-pin")].map((x) => x.textContent) }));
    R.phone = (await shot({ width: 390, height: 844 }, "357-c-pack-card-updated-phone.png")).r;
    R.errors = [...page.errs, ...desk.p2.errs];
  } finally { await b.close(); }
  const a = R.a, setupPin = (w, id) => w[`card:${id}`]?.setup === true && w[`card:${id}`].n === 0 && /^[0-9a-f]{12}$/.test(w[`card:${id}`].hash ?? "");
  const c = {
    "(a) another family opens a new tab, and the setup is pinned there (version 0, its hash)": a.moss.differentTab && a.moss.family === "MOSS-Image" && setupPin(a.moss.world, "setup-moss-base"),
    "(a) the new tab carries none of the old tab's pins": JSON.stringify(Object.keys(a.moss.world)) === '["card:setup-moss-base"]',
    "(a) the tab it left keeps its own pins and gets no setup pin": JSON.stringify(a.oldTab.world) === '["card:p-squash"]',
    "(a) a setup of the same family in place replaces the setup pin and keeps the others": JSON.stringify(Object.keys(a.moss2.world).sort()) === '["card:p-anticipation","card:setup-moss-sft-deband"]' && setupPin(a.moss2.world, "setup-moss-sft-deband") && !/new tab/.test(a.inPlace),
    "(a) describe_recipe lists the setup pin": a.described.some((x) => x.ref === "card:setup-moss-sft-deband" && x.n === 0),
    "(b) with today's pack nothing reads as moved": R.before.length === 0,
    "(b) the pack changed a card: it reads as moved, named": R.b.moves.some((m) => m.ref === "card:p-squash" && m.pack && !m.missing) && R.b.texts.includes("Squash and stretch (the pack updated this card)"),
    "(b) the pack dropped a card: it reads as missing": R.b.moves.some((m) => m.ref === "card:p-staging" && m.pack && m.missing) && R.b.texts.includes("Staging (no longer in the pack)"),
    "(b) describe_recipe says moved and missing": R.b.described.some((x) => x.ref === "card:p-squash" && x.moved === true) && R.b.described.some((x) => x.ref === "card:p-staging" && x.missing === true),
    "(b) the brick shows a one-press update chip": R.b.chip.some(([cls, t]) => /moved/.test(cls) && t === "Squash and stretch · the pack updated it · update"),
    "(b) update puts today's card in: the pin takes today's hash, the chip goes": R.afterUpdate.pin?.hash === R.afterUpdate.today && R.afterUpdate.pin.hash !== R.squashPin.hash && !R.afterUpdate.moves.includes("card:p-squash") && /pack v2 cue/.test(R.afterUpdate.prompt ?? ""),
    "390 px: the chip is there too": R.phone.chip.some(([cls]) => /moved/.test(cls)),
    "no page errors": !R.errors.length };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_c_pins_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`cpins    ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
