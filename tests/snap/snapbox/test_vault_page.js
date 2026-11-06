// U79 (SNAP-R96, R97) on the page, behind snap-gate on the gatetest install (gate :8297, privacy on), as the member:
// a private take saved through the take store (T.save, the page's own path) lands sealed on disk; after a reload it is
// listed with kept_encrypted and its card's lock says "🔒 kept encrypted"; take_frames' path (T.frames) decodes its video
// through /view (Range, decrypted); locked (vault/lock + T.reopen): the badge says "(locked)", the record is a stub (no
// prompt), frames refuse with a clear message, and a reload keeps it listed; the lock opens the vault sheet, the
// passphrase unlocks it, and the take opens again. Screenshots: <out>/snapbox/u79/page-*.png. Never queues.
// usage: NODE_PATH=... node test_vault_page.js [gate url]
const { chromium } = require("playwright"); const path = require("path"); const fs = require("fs");
const CFG = require("../snaptest_config.js");
const gate = process.argv[2] || `http://127.0.0.1:${CFG.gatePort}`;
const pw = JSON.parse(fs.readFileSync(CFG.fixture("gate_accounts.json"))).member;
const file = JSON.parse(fs.readFileSync(path.join(CFG.out, "snapbox", "test_vault_gate_result.json"))).R.file; // a private video the gate test made
const base = CFG.gatetestBase, shots = path.join(CFG.out, "snapbox", "u79");
fs.mkdirSync(shots, { recursive: true });
const MOD = "/extensions/ComfyUI-MAINodes/snap/";
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage(), out = {}, errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(gate + "/gate/login");
  await page.fill("input[name=username]", "member"); await page.fill("input[name=password]", pw);
  await Promise.all([page.waitForNavigation(), page.click("form button[type=submit]")]);
  await page.goto(gate + "/?snap"); await page.waitForFunction(() => window.app?.graph, null, { timeout: 60000 });
  await page.waitForTimeout(2500);
  const id = `take-u79page-${Date.now()}`;
  out.saved = await page.evaluate(async ({ MOD, id, file }) => {
    const T = await import(MOD + "takes.js");
    await T.load();
    await T.save({ id, kind: "run", created: Date.now(), finished: Date.now(), seconds: 1, group: T.groupOf(), workflow: "", number: 99, status: "success", text: "u79 page test recipe",
      media: [{ kind: "video", filename: file.filename, subfolder: file.subfolder, type: "output", node: "3" }], private: true, rating: "pg", verdict: null, prior: false, notes: [], graph: { nodes: [] }, prompt: { 3: { class_type: "SaveVideo", inputs: {} } } });
    return id;
  }, { MOD, id, file });
  const user = JSON.parse(fs.readFileSync(path.join(base, "user", "users.json"))), uid = Object.keys(user).find((k) => user[k] === "member");
  const disk = fs.readFileSync(path.join(base, "user", uid, "snap", "takes", `${id}.json`));
  out.diskSealed = disk.subarray(0, 8).toString() === "SNAPVLT1" && !disk.includes("u79 page test recipe");
  await page.reload(); await page.waitForFunction(() => window.app?.graph, null, { timeout: 60000 }); await page.waitForTimeout(2500);
  const look = (id) => page.evaluate(async ({ MOD, id }) => {
    const T = await import(MOD + "takes.js"), V = await import(MOD + "vault.js");
    await T.load(); await T.reopen();
    const t = T.get(id);
    let frames = null;
    try { frames = (await T.frames(t, { count: 3, maxWidth: 256 })).map((f) => [f.frame, f.width, f.data.length > 500]); } catch (e) { frames = `error: ${e.message}`; }
    return { kept: t.kept_encrypted ?? null, locked: t.locked ?? null, prompt: t.prompt ? "present" : null, text: t.text ?? null, badge: V.badgeText(t).text, frames, listed: T.all().some((x) => x.id === id) };
  }, { MOD, id });
  out.unlocked = await look(id);
  await page.waitForTimeout(800);
  out.cardBadge = await page.evaluate((id) => document.querySelector(`[data-take="${id}"] .snap-take-lock`)?.textContent ?? null, id);
  await page.screenshot({ path: path.join(shots, "page-1-unlocked.png") });
  await page.evaluate(() => fetch("/mainodes/snap/vault/lock", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }));
  out.locked = await look(id);
  await page.waitForTimeout(800);
  out.cardBadgeLocked = await page.evaluate((id) => document.querySelector(`[data-take="${id}"] .snap-take-lock`)?.textContent ?? null, id);
  await page.screenshot({ path: path.join(shots, "page-2-locked.png") });
  await page.reload(); await page.waitForFunction(() => window.app?.graph, null, { timeout: 60000 }); await page.waitForTimeout(2500);
  out.afterReload = await look(id);
  // the lock opens the vault sheet; the passphrase unlocks it
  await page.click(`[data-take="${id}"] .snap-take-lock`); // the card's own lock
  await page.waitForSelector(".snap-vault-sheet input[type=password]"); await page.waitForTimeout(500);
  out.sheetText = await page.$eval(".snap-vault-sheet", (e) => e.innerText);
  await page.screenshot({ path: path.join(shots, "page-3-vault-sheet.png") });
  await page.fill(".snap-vault-sheet input[type=password]", pw);
  await page.click(".snap-vault-sheet .snap-primary");
  await page.waitForSelector(".snap-vault-sheet", { state: "detached", timeout: 15000 });
  out.afterUnlock = await look(id);
  out.errors = errors;
  const checks = {
    "record saved through the page lands sealed": out.diskSealed,
    "unlocked: listed, kept_encrypted, recipe there": out.unlocked.kept && !out.unlocked.locked && out.unlocked.prompt === "present",
    "badge says kept encrypted": out.unlocked.badge === "🔒 kept encrypted",
    "frames decode through /view": Array.isArray(out.unlocked.frames) && out.unlocked.frames.length === 3 && out.unlocked.frames.every((f) => f[2]),
    "locked: stub without the recipe, badge (locked)": out.locked.locked && out.locked.prompt === null && out.locked.text == null && out.locked.badge === "🔒 kept encrypted (locked)",
    "the card's lock follows (kept encrypted / locked)": out.cardBadge === "🔒 kept encrypted" && out.cardBadgeLocked === "🔒 kept encrypted (locked)",
    "locked: frames refuse clearly": typeof out.locked.frames === "string" && out.locked.frames.includes("vault is locked"),
    "reload keeps it listed (locked)": out.afterReload.listed && out.afterReload.locked,
    "sheet asks for the passphrase and states the limits": /vault is locked/.test(out.sheetText) && /does not protect/.test(out.sheetText),
    "passphrase in the sheet unlocks it": out.afterUnlock.kept && !out.afterUnlock.locked && Array.isArray(out.afterUnlock.frames),
    "no page errors": !errors.length,
  };
  out.checks = checks;
  fs.writeFileSync(path.join(CFG.out, "snapbox", "test_vault_page_result.json"), JSON.stringify(out, null, 1));
  const bad = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
  console.log(`vaultpage  ${Object.keys(checks).length - bad.length}/${Object.keys(checks).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
