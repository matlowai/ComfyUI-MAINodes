// U72 run 5 findings (u72/FINDINGS.md "Run 5"), through the stdio MCP server like a newcomer agent, on the empty :8196:
// F16 a value outside an argument's enum is refused naming the accepted ones (set_profile intents "video_with_sound" was
//     saved silently), and nothing is saved; arrays (intents, answered) and plain strings (code_review, list_kits intent)
// F17 propose_downloads never lists a required file it can't fetch: every row in `files` has a download link and a
//     command; a file with no link (SFT DeBand is a local build) is under `optional`, "no public download: bring your
//     own file"; and every kit file the model graph knows has a link or is one of those
// usage: node test_f16_f17.js [fresh port 8196]
const { chromium } = require("playwright"); const fs = require("fs"), path = require("path"), { spawn } = require("child_process");
const CFG = require("./snaptest_config.js");
const port = process.argv[2] || CFG.freshPort, out = path.join(CFG.out, "ui"), R = {};
const MCP = path.join(CFG.pack, "tools", "snap_mcp.py");
function mcpClient() {
  const p = spawn("python3", ["-I", MCP, "--port", port]); let buf = "", id = 0; const waiting = new Map();
  p.stdout.on("data", (d) => { buf += d; let i; while ((i = buf.indexOf("\n")) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); if (line.trim()) { const m = JSON.parse(line); waiting.get(m.id)?.(m); waiting.delete(m.id); } } });
  const send = (method, params) => new Promise((res) => { const m = { jsonrpc: "2.0", id: ++id, method, params }; waiting.set(m.id, res); p.stdin.write(JSON.stringify(m) + "\n"); });
  const call = async (name, args = {}) => { const r = (await send("tools/call", { name, arguments: args })).result; const text = r.content.find((c) => c.type === "text")?.text; let v; try { v = JSON.parse(text); } catch { v = text; } return { error: !!r.isError, value: v }; };
  return { send, call, close: () => p.kill() };
}
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  const page = await (await b.newContext({ viewport: { width: 1600, height: 1000 } })).newPage();
  await page.route(/^https?:\/\/(?!127\.0\.0\.1|localhost)/, (r) => r.abort());
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 }); await page.waitForTimeout(3500);
  await page.keyboard.press("Escape");
  const a = mcpClient();
  await a.send("initialize", {});

  // F16
  R.profileBefore = (await a.call("get_profile")).value?.profile ?? null;
  R.badIntent = await a.call("set_profile", { intents: ["video_with_sound"] });
  R.badMixed = await a.call("set_profile", { intents: ["video", "pictures"] });
  R.badAnswered = await a.call("set_profile", { answered: ["intents"] });
  R.badReview = await a.call("set_profile", { code_review: "sometimes" });
  R.profileAfterBad = (await a.call("get_profile")).value?.profile ?? null;
  R.badKit = await a.call("list_kits", { intent: "pictures" });
  R.good = await a.call("set_profile", { intents: R.profileBefore?.intents ?? [] });

  // F17
  R.all = (await a.call("propose_downloads", { intents: ["video", "stills", "anime", "edit", "long", "characters"] })).value;
  R.deband = (await a.call("propose_downloads", { setup: "stills-sft-deband" })).value;
  const kits = (await a.call("list_kits")).value?.kits ?? [];
  R.kitFiles = [...new Map(kits.flatMap((k) => [k.recommended, k.fast, ...(k.also ?? [])].filter(Boolean).flatMap((s) => s.files.map((f) => [f.file, { file: f.file, download: !!f.download, setup: s.id }])))).values()];
  a.close();
  R.errors = errs;
  fs.writeFileSync(path.join(out, "test_f16_f17_result.json"), JSON.stringify(R, null, 1)); console.log(JSON.stringify(R, null, 1));
  await b.close();
})().catch((e) => { console.error(JSON.stringify(R, null, 1)); console.error(e); process.exit(1); });
