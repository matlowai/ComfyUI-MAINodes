// U103/U104 B1 (SNAP-R93/R94/R95) on a CPU test server: instruction and skill records, the pack's notes and the skills routes.
// - a note saves as instruction:<id>@1; the same body makes no version; a second body by agent:test makes @2 by agent:test;
//   archiving keeps @1 and @2 resolvable and drops the note from the stack;
// - /mainodes/snap/pack_notes returns every note in snap_cards/pack_notes.json; /mainodes/snap/skills lists the nine skills
//   with bytes equal to the files and serves each whole (same bytes, same hash); a path outside a skill's folder is refused;
// - /mainodes/snap/info names the docs and the skills (no page needed);
// - every pack note's tool: scope is a tool in the registered table (bridge tools included), except G1's save_location
//   until G1 merges (risk 9: the instructions tool says so in warnings, never drops the note);
// - an exported note imported back lands off (snap/instructions.json), and is listed off.
// usage: node test_instructions_store.js [port 8290] [base]   prints "instrstore n/m" last
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port;
const base = process.argv[3] || CFG.base;
const pack = fs.realpathSync(path.join(base, "custom_nodes", "ComfyUI-MAINodes"));
const R = {};
const G1_PENDING = ["save_location"]; // G1's location tools: present after the merge, then this list can go
(async () => {
  const snap = path.join(base, "user", "default", "snap"); // earlier runs' notes are parked (moved, never deleted)
  for (const d of ["instruction", "skill", "instructions.json", "_archived/instruction", "_archived/skill"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d.replace("/", "-")}-${Date.now()}`)); }
  const get = async (route) => (await fetch(`http://127.0.0.1:${port}${route}`)).json();
  R.notes = await get("/mainodes/snap/pack_notes");
  R.fileNotes = JSON.parse(fs.readFileSync(path.join(pack, "snap_cards", "pack_notes.json"), "utf-8")).notes;
  R.skills = await get("/mainodes/snap/skills");
  R.skillFiles = fs.readdirSync(path.join(pack, ".claude", "skills")).sort().map((n) => { const b = fs.readFileSync(path.join(pack, ".claude", "skills", n, "SKILL.md")); return { name: n, bytes: b.length, hash: crypto.createHash("sha256").update(b).digest("hex"), text: b.toString("utf-8") }; });
  R.read = await Promise.all(R.skillFiles.map((s) => get(`/mainodes/snap/skills?name=${s.name}`)));
  R.escape = await get("/mainodes/snap/skills?name=snap-voice&file=..%2Fsnap-core%2FSKILL.md");
  R.info = await get("/mainodes/snap/info");
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const { page, errors } = await F.open(b, port);
    R.errors = errors;
    await page.evaluate(async () => { window.__I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); window.__W = await import("/extensions/ComfyUI-MAINodes/snap/world.js"); await window.__I.load(); });
    R.v1 = await page.evaluate(async () => { const o = await __I.save(null, { scope: "global", text: "Store test: always say which model you used." }, { by: "person" }); return { ref: o.ref, made: o.made, n: o.n }; });
    const id = R.v1.ref.split(":")[1].split("@")[0];
    R.same = await page.evaluate(async (id) => { const o = await __I.save(`instruction:${id}`, { text: "Store test: always say which model you used." }, { by: "person" }); return { made: o.made, n: o.n }; }, id);
    R.v2 = await page.evaluate(async (id) => { const o = await __I.save(`instruction:${id}`, { text: "Store test: say which model you used, and why." }, { by: "agent:test" }); return { ref: o.ref, made: o.made, n: o.n, by: o.record.versions.at(-1).by, versions: o.record.versions.length }; }, id);
    R.inStack = await page.evaluate((id) => __I.resolve(__I.here()).refs.includes(`instruction:${id}@2`), id);
    R.archived = await page.evaluate(async (id) => { await __W.archive("instruction", id); return { stack: __I.resolve(__I.here()).refs.some((r) => r.startsWith(`instruction:${id}`)), v1: !!__W.get(`instruction:${id}@1`), v2: !!__W.get(`instruction:${id}@2`), listed: __I.rows({ archived: true }).find((r) => r.id === id)?.archived != null }; }, id);
    await page.evaluate(async (id) => { await __W.restore("instruction", id); }, id);
    // registered tool names vs the pack's tool: scopes
    R.toolNames = (await get("/mainodes/snap/tools")).tools.map((t) => t.name);
    R.unknown = [...new Set(R.fileNotes.filter((n) => n.scope.startsWith("tool:")).map((n) => n.scope.slice(5)).filter((t) => !R.toolNames.includes(t)))];
    R.warnings = await page.evaluate(async () => (await window.__X.callTool("instructions", { scope: "tool:save_location" })).warnings ?? []);
    // export, take the file away (parked), import: it lands off
    R.exported = await page.evaluate(async (id) => (await __W.exportRecords([`instruction:${id}`])).file, id);
    const f = path.join(snap, "instruction", `${id}.json`);
    fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(f, path.join(snap, "_parked", `import-src-${Date.now()}.json`));
    R.imported = await page.evaluate(async (file) => { const o = await __W.importExport({ file, subfolder: "snap_exports", type: "output" }); await __I.load(); return o.records; }, R.exported);
    R.marks = JSON.parse(fs.readFileSync(path.join(snap, "instructions.json"), "utf-8"));
    R.offAfterImport = await page.evaluate(async (id) => { location.reload(); return null; }, id).catch(() => null);
    await page.waitForFunction(() => window.app?.extensionManager?.workflow?.activeWorkflow, null, { timeout: 90000 });
    await page.waitForTimeout(2000);
    R.listedOff = await page.evaluate(async (id) => { const I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); await I.load(); const X = await import("/extensions/ComfyUI-MAINodes/snap/tools.js"); const l = await X.callTool("list_instructions", { layer: "person" }); return l.notes.find((n) => n.ref.startsWith(`instruction:${id}`))?.status; }, id);
  } finally { await b.close(); }
  const checks = {
    "a note saves as @1": R.v1.made && R.v1.n === 1 && /^instruction:note-/.test(R.v1.ref),
    "the same body makes no version": R.same.made === false && R.same.n === 1,
    "a second body by agent:test makes @2 by agent:test": R.v2.made && R.v2.n === 2 && R.v2.by === "agent:test" && R.v2.versions === 2,
    "the head is in the stack": R.inStack,
    "archived: out of the stack, both versions still resolve, listed archived": !R.archived.stack && R.archived.v1 && R.archived.v2 && R.archived.listed,
    "pack_notes returns every note in the file": R.notes.notes.length === R.fileNotes.length && R.fileNotes.length >= 60 && JSON.stringify(R.notes.notes) === JSON.stringify(R.fileNotes),
    "skills: nine, bytes and hashes equal the files": R.skills.skills.length === 9 && R.skills.skills.every((s, i) => s.name === R.skillFiles[i].name && s.bytes === R.skillFiles[i].bytes && s.hash === R.skillFiles[i].hash && s.description.length > 100 && s.scope.length > 0),
    "each skill served whole": R.read.every((x, i) => x.text === R.skillFiles[i].text && x.bytes === R.skillFiles[i].bytes),
    "a file outside the skill's folder is refused": /has no file/.test(R.escape.error ?? ""),
    "/info names the docs and the skills": /AGENT_START\.md$/.test(R.info.docs?.agent_start ?? "") && /SNAP_RULES\.md$/.test(R.info.docs.rules) && R.info.skills?.length === 9 && R.info.skills_url === "/mainodes/snap/skills",
    "every pack tool: scope is a registered tool (G1's pending ones aside)": R.toolNames.length > 100 && R.unknown.every((t) => G1_PENDING.includes(t)),
    "an unknown tool scope is said in warnings, not dropped": R.unknown.length === 0 || R.warnings.some((w) => /no tool save_location/.test(w)),
    "an imported note lands off": R.imported.length === 1 && Object.values(R.marks.off ?? {}).some((m) => m.by === "import") && R.listedOff === "off",
    "no page errors": !R.errors.length,
  };
  const { skillFiles, read, notes, fileNotes, ...shown } = R;
  console.log(JSON.stringify(shown, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`instrstore ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
