// U103/U104 B2 (SNAP-R93/R94/R95) on a CPU test server: the stack, the tools and the description tails.
// - layer order on a fixture of pack + person + scene + shot + take notes; a replace note removes the pack note it names and
//   lists it under overridden; a person model_choice for a pack job overrides it; two at one level conflict;
// - the hash is the same for shuffled refs and changes when a note is turned off;
// - an agent's save over the bridge (X-Snap-Agent) applies at once, by agent:<name>, new_from <name>; set_instruction_status:
//   its own note off at once, a pack note off waits as a proposal;
// - describe_recipe.instructions and get_scene.instructions carry the stack; list_instructions pages explicitly;
// - the pack tail ends edit_from_context's description and not list_bricks'; the bridge's use_page has its tail;
// - skills: list_skills nine, read_skill whole, save_skill makes the person's version, off reads the pack's again;
// - nothing in any answer is shorter than the stored text (SNAP-R58).
// usage: node test_instructions_resolve.js [port 8290] [base]   prints "instrresolve n/m" last
const { chromium } = require("playwright");
const CFG = require("./snaptest_config.js");
const fs = require("fs"), path = require("path");
const F = require("./fwork.js");
const port = process.argv[2] || CFG.port;
const base = process.argv[3] || CFG.base;
const R = {};
(async () => {
  const snap = path.join(base, "user", "default", "snap");
  for (const d of ["instruction", "skill", "instructions.json", "_archived/instruction", "_archived/skill"]) if (fs.existsSync(path.join(snap, d))) { fs.mkdirSync(path.join(snap, "_parked"), { recursive: true }); fs.renameSync(path.join(snap, d), path.join(snap, "_parked", `${d.replace("/", "-")}-${Date.now()}`)); }
  const b = await chromium.launch({ executablePath: CFG.chrome, headless: true });
  try {
    const { page, errors } = await F.open(b, port);
    R.errors = errors;
    await page.evaluate(async () => { window.__I = await import("/extensions/ComfyUI-MAINodes/snap/instructions.js"); await window.__I.load(); });
    const call = (name, args) => page.evaluate(([n, a]) => window.__X.callTool(n, a).catch((e) => ({ error: e.message })), [name, args]);
    const client = await page.evaluate(() => sessionStorage.getItem("clientId"));
    const bridge = async (agent, tool, args = {}) => { const r = await fetch(`http://127.0.0.1:${port}/mainodes/snap/call`, { method: "POST", headers: { "Content-Type": "application/json", "X-Snap-Agent": agent, "X-Snap-Page": client }, body: JSON.stringify({ tool, args }) }); return r.json(); };
    // fixtures, written by the person
    const ctx = { tool: "edit_from_context", bricks: ["render"], methods: [], pins: ["cast:cast-fix"], scene: "scene-fix", shot: "shot-fix", take: "take-fix" };
    R.fix = await page.evaluate(async () => {
      const s = (f) => __I.save(null, f, { by: "person" }).then((o) => o.ref);
      return {
        take: await s({ scope: "take:take-fix", text: "Take note: this take's sword is on the left." }),
        shot: await s({ scope: "shot:scene-fix/shot-fix", text: "Shot note: low camera, 24 mm." }),
        scene: await s({ scope: "scene:scene-fix", text: "Scene note: dusk light, warm lanterns." }),
        global: await s({ scope: "global", text: "Person note: show options side by side." }),
        cast: await s({ scope: "cast:cast-fix", text: "Cast note: braid on her right." }),
        replace: await s({ scope: "tool:edit_from_context", text: "Person: pass width and height every time; 2 MP boards.", mode: "replace", supersedes: ["pack:edit_from_context/pass-width-height-ph3"] }),
        choice: await s({ scope: "tool:edit_from_context", kind: "model_choice", job: "Sets, wide shots  and targeted edits", choice: "fizgig_still", why: "the person's call for this workflow" }),
        clash1: await s({ scope: "brick:render", kind: "model_choice", job: "the render model", choice: "H3 turbo", why: "fast" }),
        clash2: await s({ scope: "brick:render", kind: "model_choice", job: "the render model", choice: "H3 full", why: "best" }),
      };
    });
    R.stack = await page.evaluate((c) => __I.resolve(c), ctx);
    const lv = R.stack.stack.map((r) => ["pack", "install", "person", "book", "scene", "shot", "take"].indexOf(r.level));
    R.levels = R.stack.stack.map((r) => `${r.level}:${r.scope}`);
    R.ordered = lv.every((x, i) => !i || x >= lv[i - 1]);
    R.hash1 = await page.evaluate(async (s) => [await __I.hashOf(s), await __I.hashOf({ refs: [...s.refs].reverse(), off: s.off })], { refs: R.stack.refs, off: R.stack.off });
    await page.evaluate((ref) => __I.setOff(ref, true), R.fix.global);
    R.afterOff = await page.evaluate(async (c) => { const r = __I.resolve(c); return { hash: await __I.hashOf(r), off: r.off, inStack: r.refs.length }; }, ctx);
    await page.evaluate((ref) => __I.setOff(ref, false), R.fix.global);
    // an agent over the bridge
    R.agentSave = await bridge("studio-a", "save_instruction", { scope: "tool:run", text: "Agent note: lead the soundscape with footsteps." });
    R.agentAnswer = await bridge("studio-a", "instructions", { scope: "tool:run" });
    R.agentRow = R.agentAnswer.result?.stack?.find((r) => r.ref === R.agentSave.result?.ref);
    R.ownOff = await bridge("studio-a", "set_instruction_status", { ref: R.agentSave.result?.ref, status: "off" });
    R.packOff = await bridge("studio-a", "set_instruction_status", { ref: "pack:run/never-cite-next-place", status: "off" });
    R.packStillOn = await page.evaluate(() => !__I.isOff("pack:run/never-cite-next-place"));
    R.personOff = await bridge("studio-a", "set_instruction_status", { ref: R.fix.global, status: "off" });
    // reads that carry the stack
    R.describe = (await call("describe_recipe", {})).instructions;
    R.sceneMade = await call("create_scene", { name: "Instr scene" });
    const sceneId = R.sceneMade?.scene ?? R.sceneMade?.id;
    if (sceneId) { await page.evaluate((id) => __I.save(null, { scope: `scene:${id}`, text: "Scene note via get_scene." }, { by: "person" }), sceneId); R.getScene = (await call("get_scene", { scene: sceneId })).instructions; }
    R.page1 = await call("list_instructions", { limit: 5 });
    R.all = await call("list_instructions", {});
    R.schema = await page.evaluate(() => Object.fromEntries(window.__X.schema().filter((t) => ["edit_from_context", "list_bricks", "instructions"].includes(t.name)).map((t) => [t.name, t.description])));
    R.listing = (await (await fetch(`http://127.0.0.1:${port}/mainodes/snap/tools`)).json()).tools.find((t) => t.name === "use_page")?.description;
    // skills
    R.listSkills = await call("list_skills", {});
    R.core = await call("read_skill", { name: "snap-core" });
    R.saveSkill = await bridge("studio-a", "save_skill", { name: "snap-voice", markdown: `${(await call("read_skill", { name: "snap-voice" })).text}\n\n## Learned in a test\n\n- Voices measured at 12 steps hold their F0.\n`, note: "test" });
    R.yours = await call("read_skill", { name: "snap-voice" });
    R.skillOffProposal = await bridge("studio-a", "set_instruction_status", { ref: "skill:snap-voice", status: "off" });
    R.packAgain = await call("read_skill", { name: "snap-voice" });
    R.unseen = await page.evaluate(() => __I.unseen().map((r) => r.ref));
    R.full = await call("instructions", { scope: "tool:edit_from_context" });
  } finally { await b.close(); }
  const file = (ref) => { const id = ref.split(":")[1].split("@")[0]; const r = JSON.parse(fs.readFileSync(path.join(snap, "instruction", `${id}.json`), "utf-8")); return r.versions.at(-1).body; };
  const refs = R.stack.refs, has = (r) => refs.includes(r);
  const checks = {
    "every fixture note that applies is in the stack, the clashing pair too": [R.fix.take, R.fix.shot, R.fix.scene, R.fix.global, R.fix.cast, R.fix.replace, R.fix.choice, R.fix.clash1, R.fix.clash2].every(has),
    "layer order: pack, person, scene, shot, take": R.ordered && R.levels[0].startsWith("pack") && R.levels.at(-1) === "take:take:take-fix" && R.levels.indexOf("scene:scene:scene-fix") < R.levels.indexOf("shot:shot:scene-fix/shot-fix"),
    "the replace note removes the pack note it names and lists it": !refs.some((r) => r.startsWith("pack:edit_from_context/pass-width-height-ph3")) && R.stack.overridden.some((o) => o.ref.startsWith("pack:edit_from_context/pass-width-height-ph3") && o.by === R.fix.replace),
    "a person model_choice overrides the pack's for the same job": !refs.some((r) => r.startsWith("pack:edit_from_context/sets-wide-shots-targeted")) && R.stack.overridden.some((o) => o.ref.startsWith("pack:edit_from_context/sets-wide-shots-targeted") && o.by === R.fix.choice),
    "two model_choices for one job at one level conflict": R.stack.conflicts.some((c) => c.includes(R.fix.clash1) && c.includes(R.fix.clash2)),
    "the hash is the same for shuffled refs": R.hash1[0] === R.hash1[1] && /^[0-9a-f]{12}$/.test(R.hash1[0]),
    "turning a note off changes the hash and moves it to off": R.afterOff.hash !== R.hash1[0] && R.afterOff.off.includes(R.fix.global),
    "an agent's note applies at once, by agent:studio-a, new from studio-a": !!R.agentRow && R.agentRow.by === "agent:studio-a" && R.agentRow.new_from === "studio-a" && R.agentSave.result.made,
    "its own note goes off at once": R.ownOff.result?.status === "off",
    "a pack note off waits as a proposal; the note stays on": !!R.packOff.result?.proposed && R.packStillOn,
    "a person's note off waits as a proposal": !!R.personOff.result?.proposed,
    "describe_recipe.instructions: hash, stack, skills": /^[0-9a-f]{12}$/.test(R.describe?.hash ?? "") && R.describe.stack.length > 0 && R.describe.stack.some((r) => r.scope === "global") && R.describe.skills.some((s) => s.name === "snap-core"),
    "get_scene.instructions has the scene's note": !!R.getScene?.stack?.some((r) => r.text === "Scene note via get_scene."),
    "list_instructions pages explicitly with the count": R.page1.notes.length === 5 && R.page1.count === R.all.count && R.page1.next_offset === 5 && R.all.notes.length === R.all.count && R.all.count >= 75,
    "the pack tail ends edit_from_context's description, not list_bricks'": /Pack notes \(SNAP-R93\): .*Pass width and height/.test(R.schema.edit_from_context) && !/Pack notes/.test(R.schema.list_bricks),
    "the bridge's use_page carries its pack notes": /Pack notes \(SNAP-R93\): Drive the person's main tab/.test(R.listing ?? ""),
    "list_skills: twelve; read_skill whole": R.listSkills.length === 12 && Buffer.byteLength(R.core.text) === R.core.bytes && /How instructions nest/.test(R.core.text) && R.core.yours === null,
    "save_skill makes the person's version, by the agent": R.saveSkill.result?.version === 1 && R.yours.yours === 1 && /Learned in a test/.test(R.yours.text) && R.yours.by === "agent:studio-a" && R.yours.pack_updated === false,
    "an agent's own skill version goes off at once; off reads the pack's again": R.skillOffProposal.result?.status === "off" && R.packAgain.yours === null && !/Learned in a test/.test(R.packAgain.text),
    "the agent's skill version shows as unseen": R.unseen.some((r) => r.startsWith("skill:snap-voice@1")),
    "nothing shorter than stored (SNAP-R58)": R.full.stack.every((r) => r.layer !== "person" || (r.text ?? r.why).length === (file(r.ref).text ?? file(r.ref).why).length) && R.full.stack.length === R.full.count,
    "no page errors": !R.errors.length,
  };
  console.log(JSON.stringify({ ...R, all: { count: R.all.count }, core: { bytes: R.core.bytes }, yours: { yours: R.yours.yours }, packAgain: { yours: R.packAgain.yours } }, null, 1));
  let bad = 0;
  for (const [k, v] of Object.entries(checks)) { console.log(`${v ? "PASS" : "FAIL"} ${k}`); bad += !v; }
  console.log(`instrresolve ${Object.keys(checks).length - bad}/${Object.keys(checks).length}`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
