// Batch G15, Astrid's agents drive Snap (SNAP-R211) on the CPU test server, through the pack's Astrid pack
// (integrations/astrid) exactly as Astrid runs an action: run.py with --out, SNAP_BASE / SNAP_AGENT:
// - snap.pages lists this page; snap.call use_page binds it (driven by the agent), describe_recipe answers there whole,
//   use_page null lets it go; an idempotency_key comes back as given; pictures land beside the answer (a stub bridge);
// - a SNAP_BASE that isn't this machine is refused with nothing sent; a copy of the pack (Astrid installs copies) finds
//   nothing beside it (SNAP-R220: self-contained, no SNAP_PACK);
// - snap_mcp.py serves the pack's skills as MCP prompts (prompts/list, prompts/get snap-core whole);
// - with SNAP_TEST_ASTRID_PY (a Python with Astrid installed), Astrid's own pack validator accepts the manifest.
// usage: node test_g15_astrid.js [port]   prints "g15astrid n/m" last
const { chromium } = require("playwright");
const fs = require("fs"), os = require("os"), path = require("path"), http = require("http"), { spawn, spawnSync } = require("child_process");
const CFG = require("./snaptest_config.js");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port, R = {};
const PACK = CFG.pack, ACTION = path.join(PACK, "integrations", "astrid", "actions", "call", "run.py");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "g15astrid-"));
let n = 0;
// one Astrid action run: {code, answer, out}
// (async: while Playwright routes requests, a blocked Node holds every request of the page, its answers too)
const act = (args, env = {}, action = ACTION) => new Promise((done) => {
  const out = path.join(tmp, `run${++n}`, "result.json"); fs.mkdirSync(path.dirname(out), { recursive: true });
  const p = spawn("python3", ["-I", action, ...args, "--out", out], { env: { PATH: process.env.PATH, SNAP_BASE: `http://127.0.0.1:${port}`, SNAP_AGENT: "astrid-g15", ...env } });
  let stderr = ""; p.stderr.on("data", (d) => { stderr += d; });
  p.on("close", (code) => done({ code, answer: fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, "utf8")) : null, out: path.dirname(out), stderr }));
});
(async () => {
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const A = await F.open(b, port), page = A.page;
    const id = await page.evaluate(async () => (await import("/scripts/api.js")).api.clientId);
    R.pages = await act(["--tool", "list_pages"]);
    R.bind = await act(["--tool", "use_page", "--args", JSON.stringify({ page: id })]);
    R.describe = await act(["--tool", "describe_recipe", "--idempotency-key", "g15-astrid-1"]);
    R.free = await act(["--tool", "use_page", "--args", JSON.stringify({ page: null })]);
    R.after = await act(["--tool", "list_pages"]);
    R.remote = await act(["--tool", "list_pages"], { SNAP_BASE: "http://10.0.0.5:8188" });
    R.named = await act(["--tool", "list_pages"], { SNAP_BASE: "http://snap.example.com:8188" });
    // Astrid installs a copy of the pack: run.py carries what it runs (SNAP-R220), nothing found beside it
    const copy = path.join(tmp, "installed", "snap"); fs.cpSync(path.join(PACK, "integrations", "astrid"), copy, { recursive: true });
    const copied = path.join(copy, "actions", "call", "run.py");
    R.copyNoPack = await act(["--tool", "list_pages"], {}, copied);
    R.copySource = fs.readFileSync(copied, "utf8");
    R.errors = A.errors;
  } catch (e) { R.crash = e.stack; } finally { await b.close(); }
  // pictures: a stub bridge on loopback answers one call with two pictures (a test page can't screenshot itself)
  const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const stub = http.createServer((q, a) => { q.resume(); q.on("end", () => { a.writeHead(200, { "Content-Type": "application/json" }); a.end(JSON.stringify({ result: { take: "t1", images: [{ mimeType: "image/png", data: PNG }, { mimeType: "image/png", data: PNG }] }, page: { headless: true } })); }); });
  await new Promise((ok) => stub.listen(0, "127.0.0.1", ok));
  R.shot = await act(["--tool", "take_frames", "--args", '{"take": "t1"}'], { SNAP_BASE: `http://127.0.0.1:${stub.address().port}` });
  stub.close();
  // snap_mcp.py: the pack's skills as MCP prompts
  const lines = [{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { jsonrpc: "2.0", id: 2, method: "prompts/list" }, { jsonrpc: "2.0", id: 3, method: "prompts/get", params: { name: "snap-core" } }, { jsonrpc: "2.0", id: 4, method: "prompts/get", params: { name: "no-such-skill" } }];
  const mcp = spawnSync("python3", ["-I", path.join(PACK, "tools", "snap_mcp.py"), "--port", String(port)], { input: lines.map((x) => JSON.stringify(x)).join("\n") + "\n", encoding: "utf8", timeout: 60000 });
  R.mcp = Object.fromEntries(mcp.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).map((x) => [x.id, x]));
  R.skillBytes = fs.statSync(path.join(PACK, ".claude", "skills", "snap-core", "SKILL.md")).size;
  const apy = process.env.SNAP_TEST_ASTRID_PY;
  if (apy) { const v = spawnSync(apy, ["-I", "-c", "import sys\nfrom astrid.core.pack.canonical import validate_canonical_pack\ne = validate_canonical_pack(sys.argv[1], expected_pack_id='snap')\nprint(type(e).__name__)", path.join(PACK, "integrations", "astrid")], { encoding: "utf8", cwd: tmp }); R.validator = { code: v.status, out: `${v.stdout}${v.stderr}`.trim() }; }
  const S = R, pages = S.pages?.answer?.result?.pages ?? [];
  const checks = {
    "R211 snap.pages lists the open page, exit 0": S.pages?.code === 0 && pages.length >= 1 && S.pages.answer.result.you === "astrid-g15",
    "R211 use_page binds it: driven by the agent": S.bind?.code === 0 && /^astrid-g15 now drives /.test(S.bind.answer?.result?.said ?? ""),
    "R211 describe_recipe answers there whole, with the key given back": S.describe?.code === 0 && typeof S.describe.answer?.result?.revision === "string" && S.describe.answer?.page?.driven_by === "astrid-g15" && S.describe.answer?.idempotency_key === "g15-astrid-1",
    "R211 pictures land beside the answer (a stub bridge)": S.shot?.code === 0 && (S.shot.answer?.result?.saved ?? []).length >= 1 && S.shot.answer.result.saved.every((f) => f.startsWith(S.shot.out) && fs.existsSync(f)),
    "R211 use_page null lets it go": S.free?.code === 0 && !(S.after?.answer?.result?.pages ?? []).some((p) => p.driven_by === "astrid-g15"),
    "R211 a SNAP_BASE off this machine is refused, nothing sent": S.remote?.code === 1 && /isn't this machine.*nothing was sent/.test(S.remote.answer?.error ?? "") && S.named?.code === 1,
    "R220 an installed copy works with no SNAP_PACK and nothing beside it": S.copyNoPack?.code === 0 && Array.isArray(S.copyNoPack.answer?.result?.pages) && !/snapcall|SNAP_PACK/.test(S.copySource ?? "snapcall"),
    "R211 snap_mcp lists the skills as prompts": (S.mcp?.[1]?.result?.capabilities?.prompts !== undefined) && (S.mcp?.[2]?.result?.prompts ?? []).some((p) => p.name === "snap-core" && p.description),
    "R211 prompts/get gives a skill whole; an unknown one is an error naming the skills": Buffer.byteLength(S.mcp?.[3]?.result?.messages?.[0]?.content?.text ?? "") === S.skillBytes && /snap-core/.test(S.mcp?.[4]?.error?.message ?? ""),
    [`R211 Astrid's own pack validator accepts the manifest${process.env.SNAP_TEST_ASTRID_PY ? "" : " (skipped: SNAP_TEST_ASTRID_PY unset)"}`]: !process.env.SNAP_TEST_ASTRID_PY || (S.validator?.code === 0 && S.validator.out === "CanonicalPackEntry"),
    "no page errors": !S.crash && !(S.errors ?? []).length,
  };
  for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
  if (Object.values(checks).some((v) => !v)) console.log(JSON.stringify(R, null, 1));
  console.log(`g15astrid ${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`);
})();
