// Batch E task 3 (SNAP-R33, SNAP-R39, U90-3): the re-run plan's cap line behind snap-gate. Needs the gatetest pair (gate
// :8297 in front of :8199, accounts in snapbox/test_accounts.json). As member (Mature cap), queued prompts rewritten into
// 64 px EmptyImage prompts that keep their extra_data (the workflow with its pins), as test_retake.js does:
// - take A runs with Kon (no rating); Vex is the member's own Cast, rated Adult on its record;
// - the take's Re-run sheet, Kon → Vex: the line "Adult is above your cap (Mature): the server will refuse this run"; the
//   rerun tool's plan says the same (rating.above_cap);
// - Re-generate: the server refuses it when it is queued (400), the reason naming Vex, its rating and the cap; the sheet
//   says that reason (not only "Custom validation failed"); no new take. Screens 385 (the line), 386 (the refusal), 387
//   (390 px).
// usage: node test_e_cap.js [gate url] [member password]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const [gate = `http://127.0.0.1:${CFG.gatePort}`, memberPw = JSON.parse(fs.readFileSync(CFG.fixture("gate_accounts.json"))).member] = process.argv.slice(2);
const out = path.join(CFG.out, "ui"), R = {};
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  const answers = [];
  page.on("response", async (res) => { if (/\/api\/prompt$/.test(res.url()) && res.request().method() === "POST") answers.push({ status: res.status(), body: await res.text().catch(() => "") }); });
  await page.route(/\/api\/prompt$/, (r) => {
    if (r.request().method() !== "POST") return r.continue();
    const body = JSON.parse(r.request().postData());
    (R.worlds ??= []).push(body.extra_data?.extra_pnginfo?.workflow?.extra?.snap?.world ?? null);
    body.prompt = { 1: { class_type: "EmptyImage", inputs: { width: 64, height: 64, batch_size: 1, color: 3355443 } }, 2: { class_type: "SaveImage", inputs: { images: ["1", 0], filename_prefix: "batchE_cap" } } };
    delete body.partial_execution_targets;
    return r.continue({ postData: JSON.stringify(body) });
  });
  await page.goto(`${gate}/gate/login?next=${encodeURIComponent("/?snap")}`);
  await page.fill("input[name=username]", "member"); await page.fill("input[name=password]", memberPw);
  await Promise.all([page.waitForNavigation(), page.click("form button[type=submit]")]);
  await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow && document.querySelector(".snap-root"), null, { timeout: 120000 }); await page.waitForTimeout(3500);
  await page.evaluate(() => { for (const d of document.querySelectorAll("[role=dialog]:not(.snap-sheet)")) d.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  await page.keyboard.press("Escape");
  const ev = (fn, arg) => page.evaluate(fn, arg);
  await ev(async () => { const at = (m) => import(`/extensions/ComfyUI-MAINodes/snap/${m}.js`); for (const [k, m] of [["X", "tools"], ["L", "library"], ["M", "models"], ["W", "world"], ["T", "takes"], ["ACC", "account"]]) window[`__${k}`] = await at(m); });
  const waitTake = (n) => ev(async (n) => { const T = window.__T; for (let i = 0; i < 160 && T.all().length < n; i++) await new Promise((r) => setTimeout(r, 500)); await new Promise((r) => setTimeout(r, 300)); return T.all().at(-1)?.id ?? null; }, n);
  R.a = await ev(async () => {
    const X = window.__X, L = window.__L, T = window.__T;
    await T.load(); await window.__M.load();
    await X.callTool("start_recipe", {});
    const stamp = Date.now().toString(36), k = `cast-koncap${stamp}`, v = `cast-vexcap${stamp}`;
    await L.saveCast(k, { name: "Kon", trigger: "", details: "a fennec-eared courier girl", lora: null, refs: [] });
    await L.applyCast(`cast:${k}`);
    await L.saveCast(v, { name: "Vex", trigger: "", details: "a tall woman in a long silver coat", lora: null, refs: [], rating: "adult" });
    return { kon: k, vex: v, takes: T.all().length, account: window.__ACC.account() };
  });
  const kon = `cast:${R.a.kon}`, vex = `cast:${R.a.vex}`;
  await ev(() => app.queuePrompt(0, 1));
  R.a.take = await waitTake(R.a.takes + 1);
  R.a.answer = answers.at(-1);
  // ---- the agent's plan ----
  R.plan = await ev(async ([take, kon, vex]) => window.__X.callTool("rerun", { take, swaps: { [kon]: { to: vex } } }), [R.a.take, kon, vex]);
  // ---- the take's Re-run sheet ----
  await page.waitForTimeout(800);
  await page.click(`.snap-take[data-take="${R.a.take}"]`); await page.waitForTimeout(800);
  await page.click("text=Re-run with swaps…"); await page.waitForSelector(".snap-rerun-sheet", { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(600);
  await page.selectOption(`.snap-rerun-sheet .snap-rerun-pick[aria-label^="Kon"]`, vex); await page.waitForTimeout(900);
  R.line = await ev(() => [...document.querySelectorAll(".snap-rerun-sheet .snap-opened-body > .snap-world-warn")].filter((x) => !x.hidden).map((x) => x.textContent));
  await page.locator(".snap-rerun-sheet").screenshot({ path: path.join(out, "385-e-cap-line.png") });
  const n = answers.length, t = await ev(() => window.__T.all().length);
  await page.click(".snap-rerun-actions button.snap-primary"); await page.waitForTimeout(2500);
  R.refusal = answers.slice(n);
  R.status = await ev(() => document.querySelector(".snap-rerun-sheet [role=status]")?.textContent ?? null);
  R.takesAfter = await ev(() => window.__T.all().length);
  R.takesBefore = t;
  await page.locator(".snap-rerun-sheet").screenshot({ path: path.join(out, "386-e-cap-refused.png") }).catch((e) => { R.shotErr = e.message; });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(600);
  R.phone = await ev(() => { const s = document.querySelector(".snap-rerun-sheet"); return s ? { sheet: s.scrollWidth - s.clientWidth, page: document.documentElement.scrollWidth - 390 } : null; });
  await page.locator(".snap-rerun-sheet").screenshot({ path: path.join(out, "387-e-cap-phone.png") }).catch((e) => { R.phoneErr = e.message; });
  R.errors = errs;

  const said = (R.refusal ?? []).map((a) => a.body).join(" ");
  const c = {
    "signed in as member, Mature cap": R.a.account?.max_rating === "mature",
    "take A ran (200) and is a take": R.a.answer?.status === 200 && !!R.a.take,
    "the rerun plan says Adult, above the cap": R.plan.plan?.rating?.would_be === "adult" && /above your cap \(Mature\): the server will refuse/.test(R.plan.plan?.rating?.above_cap ?? ""),
    "the sheet shows the above-cap line for Kon → Vex": R.line.some((x) => /Adult is above your cap \(Mature\): the server will refuse this run/.test(x)),
    "Re-generate is refused when it is queued (400)": R.refusal.length === 1 && R.refusal[0].status === 400,
    "the server's reason names Vex, Adult and the Mature cap": /Vex/.test(said) && /Adult/.test(said) && /Mature cap/.test(said),
    "the sheet says the reason, not only 'Custom validation failed'": /Vex/.test(R.status ?? "") && /Mature cap/.test(R.status ?? ""),
    "no new take": R.takesAfter === R.takesBefore,
    "390 px: no sideways scroll": !!R.phone && R.phone.sheet <= 0 && R.phone.page <= 0,
    "no page errors": !R.errors.length,
  };
  R.checks = c;
  fs.writeFileSync(path.join(out, "test_e_cap_result.json"), JSON.stringify(R, null, 1));
  const bad = Object.keys(c).filter((k) => !c[k]);
  console.log(`e_cap    ${Object.keys(c).length - bad.length}/${Object.keys(c).length} ${bad.length ? "FAIL " + JSON.stringify(bad) : "PASS"}`);
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
