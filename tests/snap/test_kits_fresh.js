// U72 F5: a kit's "ready" means its own recipe runs as opened. On the fresh empty CPU server (:8196), per kit: put only
// that kit's recommended files in place (empty placeholders at the exact targets list_kits names), open its recipe as
// onboarding's "Open in new tabs" does, and post the prompt Run would queue to core's /prompt: it must validate (it then
// fails at once at its first loader, the files being empty: CPU, under a second), nothing may be missing, and every brick
// that is on passes its own check (RelayVSR weights). Optional extras (RelayVSR) are listed apart, with sizes. The
// placeholders are parked afterwards (moved, never deleted).
// usage: node test_kits_fresh.js [fresh port 8196]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path");
const CFG = require("./snaptest_config.js");
const FRESH = `http://127.0.0.1:${process.argv[2] || CFG.freshPort}`, out = path.join(CFG.out, "ui"), R = { kits: {} };
const INTENTS = ["video", "stills", "anime", "characters"]; // edit and long run methods on takes, not a recipe opened here

async function page(b) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  await p.route(/\/mainodes\/snap\/register$/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: '{"tools":0}' }));
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(`${FRESH}/`); await p.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await p.waitForTimeout(2500);
  await p.keyboard.press("Escape");
  await p.evaluate(async () => {
    window.__X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js");
    window.__OB = await import("/extensions/ComfyUI-MAINodes/snap/onboarding.js");
    app.graph.clear(); app.graph.extra = {};
  });
  return { p, errs };
}

(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const argv = (await (await fetch(`${FRESH}/system_stats`)).json()).system.argv, base = argv[argv.indexOf("--base-directory") + 1];
  const parked = path.join(base, "_parked_placeholders", String(Date.now()));
  for (const intent of INTENTS) {
    const r = R.kits[intent] = {};
    let { p, errs } = await page(b);
    const kit = await p.evaluate((i) => window.__X.callTool("list_kits", { intent: i }), intent);
    const files = kit.recommended.files;
    r.setup = kit.recommended.id;
    r.noTarget = files.filter((f) => !f.target).map((f) => f.file);
    const made = [];
    for (const f of files.filter((x) => x.target && !x.installed)) { const to = path.join(f.target, f.file); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, ""); made.push(to); }
    await p.context().close();
    ({ p, errs } = await page(b)); // a page that reads the folders with the kit's files in them
    r.scan = await p.evaluate((i) => window.__X.callTool("list_kits", { intent: i }).then((k) => k.recommended.state), intent);
    r.opened = await p.evaluate((i) => window.__OB.open([i]).catch((e) => ({ error: e.message })), intent);
    await p.waitForTimeout(1500);
    r.check = await p.evaluate(async () => {
      const d = await window.__X.callTool("describe_recipe", {});
      return { prompt: (await app.graphToPrompt()).output, missing: d.missing, off: d.bricks.filter((x) => x.on === false).map((x) => x.brick),
        checks: d.models.checks.filter((c) => d.bricks.find((x) => x.brick === c.brick)?.on !== false && c.ready === false).map((c) => `${c.brick}: ${c.problems?.join(", ")}`) };
    });
    // core's own validation: a valid prompt is queued and then fails at its first loader (the files are empty); an invalid
    // one is refused with node errors
    const q = await fetch(`${FRESH}/prompt`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: r.check.prompt }) });
    const answer = await q.json();
    r.check.validation = q.status === 200 ? "valid" : Object.values(answer.node_errors ?? {}).flatMap((e) => e.errors.map((x) => `${e.class_type}: ${x.message} ${x.details}`)).concat(answer.node_errors && Object.keys(answer.node_errors).length ? [] : [answer.error?.message ?? q.status]);
    delete r.check.prompt;
    if (q.status === 200) for (let i = 0; i < 120; i++) {
      const h = (await (await fetch(`${FRESH}/history/${answer.prompt_id}`)).json())[answer.prompt_id];
      if (h?.status?.completed !== undefined && h.status.status_str) { r.check.ran = h.status.status_str; r.check.failedAt = h.status.messages.find((m) => m[0] === "execution_error")?.[1]?.node_type ?? null; break; }
      await new Promise((res) => setTimeout(res, 500));
    }
    r.errors = errs;
    if (intent === "video") r.extras = await p.evaluate(() => window.__X.callTool("propose_downloads", { intents: ["video"] }).then((x) => x.optional ?? null));
    await p.context().close();
    for (const to of made) { const dst = path.join(parked, path.relative(base, to)); fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.renameSync(to, dst); }
    r.placeholders = made.length;
  }
  fs.writeFileSync(path.join(out, "test_kits_fresh_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
