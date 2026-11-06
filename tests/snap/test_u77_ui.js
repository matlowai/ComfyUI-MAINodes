// U77 (4) and (6), the page's side of snap-gate (SNAP-R34, SNAP-R35):
// - no gate (:8195): /gate/me is a 404, the top bar shows no account, get_profile has none; anyone rates a LoRA from
//   "move to…" / set_lora_category (rating written to their snap/models.json, then undone)
// - gate on (:8297 in front of :8199) as kid: the top bar shows "kid · PG" with Sign out; onboarding has no SFW question;
//   move to… offers no rating and set_lora_category's rating is refused; get_profile names the account and cap
// - as admin: "admin · Adult", the SFW question is there, ratings are offered (rated, then undone)
// - the idle lock: with the gate's idle limit at 3 s, the page's next request answers 401 locked and a "Locked: sign in
//   again" card shows over the page; the graph is untouched; signing in from the card's window takes the card away
// Sets the gate's idle limit to 0.05 min for a few seconds and back to 30 (every gatetest session locks meanwhile).
// Screenshots: ui/250-u77-account-chip.png (kid's top bar), ui/251-u77-locked.png (the lock card over the page).
// usage: node test_u77_ui.js [plain port 8195] [gate url] [kid password] [admin password]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const ACCOUNTS = JSON.parse(fs.readFileSync(CFG.fixture("gate_accounts.json"), "utf8"));
const [port = CFG.port, gate = `http://127.0.0.1:${CFG.gatePort}`, kidPw = ACCOUNTS.kid, adminPw = ACCOUNTS.admin] = process.argv.slice(2);
const out = path.join(CFG.out, "ui"), R = {};
const GATE_PY = path.join(CFG.pack, "snap_gate", "gate.py"), STATE = path.join(CFG.gatetestBase, "gate_state");
const idle = (min) => execFileSync(CFG.python, ["-I", GATE_PY, "settings", "--idle-minutes", String(min), "--state", STATE]).toString();
// core's first-run Templates dialog closes with Escape, as a person would close it (a new gate user gets it)
const ready = (page) => page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow && document.querySelector(".snap-root"), null, { timeout: 120000 })
  .then(() => page.waitForTimeout(3500)).then(() => page.evaluate(() => { for (const d of document.querySelectorAll("[role=dialog]:not(.snap-sheet)")) d.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); }));
// what the page shows and offers: the chip, move to…'s rating options for a LoRA, the onboarding steps, get_profile's account
const look = (page, lora) => page.evaluate(async (lora) => {
  const V = await import("/extensions/ComfyUI-MAINodes/snap/loraview.js"), M = await import("/extensions/ComfyUI-MAINodes/snap/models.js"), Tl = await import("/extensions/ComfyUI-MAINodes/snap/tools.js");
  await M.load();
  const chip = document.querySelector(".snap-account");
  const ratings = [...V.moveControl(lora, () => {}).options].map((o) => o.textContent).filter((t) => /^rated|unrated/.test(t));
  await Tl.callTool("ui", { action: "onboarding" });
  for (let i = 0; i < 20 && !document.querySelector(".snap-ob-dots i"); i++) await new Promise((r) => setTimeout(r, 250));
  const steps = [...document.querySelectorAll(".snap-ob-dots i")].map((i) => i.title);
  document.querySelector(".snap-onboard .snap-x")?.click();
  const profile = await Tl.callTool("get_profile", {});
  let rate;
  try { const r = await Tl.callTool("set_lora_category", { file: lora, rating: "pg" }); rate = { rating: r.rating }; await Tl.callTool("set_lora_category", { file: lora, undo: r.undo }); rate.after = M.entry(lora).rating ?? null; } catch (e) { rate = { error: e.message }; }
  return { chip: chip && !chip.hidden ? chip.textContent : null, chipLink: chip?.querySelector("a")?.getAttribute("href") ?? null, ratings, steps, account: profile.account ?? null, rate };
}, lora);
async function signIn(page, name, pw, next = "/?snap") {
  await page.goto(`${gate}/gate/login?next=${encodeURIComponent(next)}`);
  await page.fill("input[name=username]", name); await page.fill("input[name=password]", pw);
  await Promise.all([page.waitForNavigation(), page.click("form button[type=submit]")]);
}
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const errs = [];
  const fresh = async () => { const p = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage(); await p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort()); p.on("pageerror", (e) => errs.push(e.message)); return p; };

  const plain = await fresh();
  await plain.goto(`http://127.0.0.1:${port}/?snap`); await ready(plain);
  R.plainMe = await plain.evaluate(async () => (await fetch("/gate/me")).status);
  R.plain = await look(plain, "snaptest_u77_unrated.safetensors");

  const kid = await fresh();
  await signIn(kid, "kid", kidPw); await ready(kid);
  R.kid = await look(kid, "test/greyscale-pg.safetensors");
  await kid.screenshot({ path: path.join(out, "250-u77-account-chip.png"), clip: { x: 0, y: 0, width: 1600, height: 120 } });

  const admin = await fresh();
  await signIn(admin, "admin", adminPw); await ready(admin);
  R.admin = await look(admin, "test/greyscale-pg.safetensors");

  // the idle lock, on the kid's page
  R.nodesBefore = await kid.evaluate(() => app.graph.nodes.length);
  try {
    idle(0.05);
    await kid.waitForTimeout(4500);
    R.lockAnswer = await kid.evaluate(async () => { const { api } = await import("/scripts/api.js"); return (await api.fetchApi("/queue")).status; });
    await kid.waitForSelector(".snap-locked", { timeout: 5000 }).catch(() => {});
    R.lockCard = await kid.evaluate(() => document.querySelector(".snap-locked")?.textContent ?? null);
    await kid.screenshot({ path: path.join(out, "251-u77-locked.png") });
  } finally {
    idle(30);
  }
  const [popup] = await Promise.all([kid.waitForEvent("popup"), kid.click(".snap-locked button")]);
  await popup.waitForLoadState();
  R.popupUrl = popup.url().replace(gate, "");
  await popup.fill("input[name=password]", kidPw);
  await Promise.all([popup.waitForNavigation(), popup.click("form button[type=submit]")]);
  await kid.waitForFunction(() => !document.querySelector(".snap-locked"), null, { timeout: 15000 }).catch(() => {});
  R.afterSignIn = { card: await kid.evaluate(() => !!document.querySelector(".snap-locked")), popupClosed: popup.isClosed(), nodes: await kid.evaluate(() => app.graph.nodes.length),
    queue: await kid.evaluate(async () => { const { api } = await import("/scripts/api.js"); return (await api.fetchApi("/queue")).status; }) };
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_u77_ui_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { try { idle(30); } catch {} console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
