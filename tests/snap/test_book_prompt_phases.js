// SNAP-R68/R165/R168/R250: native Book compile and board prompts, without a server, records or renders.
// CPU-only: node tests/snap/test_book_prompt_phases.js
const assert = require("node:assert/strict"), fs = require("node:fs"), vm = require("node:vm"), path = require("node:path"), crypto = require("node:crypto");
const pack = path.resolve(__dirname, "../.."), source = (file) => fs.readFileSync(path.join(pack, file), "utf8").replace(/^import .*;$/gm, "").replace(/^export /gm, "");
const plain = (x) => JSON.parse(JSON.stringify(x));
const action = "Mio gently lowers the one soup bowl with its double blue rim from her left hand onto the counter before Kuroe, then withdraws her hand while keeping her ladle in her right hand.";
const reaction = "Kuroe looks from the bowl to Mio and asks, For me? Mio answers with a small smile and one nod; the bowl stays on the counter.";
const opening = "Opening: exactly two people, one soup bowl with two blue rim stripes held in Mio left hand, one ladle in her right hand, and Kuroe with his one right-eye monocle and lapel chain. Mio lowers the bowl onto the counter before Kuroe, then withdraws only her left hand; the ladle stays in her right hand.";
function native({ blocking = opening, prior = [], text = action, after = reaction, lines = [{ who: "cast:kuroe", text: "For me?" }] } = {}) {
  const change = (entity, path, value, id) => ({ id, entity, path, value, op: "set", why: "Mio lowers the bowl onto the counter, then withdraws her hand." });
  const story = { props: [{ id: "bowl", name: "the soup bowl with two blue rim stripes" }, { id: "ladle", name: "the ladle" }], groups: [], beats: [
    ...prior,
    { id: "b1", order: 1, told: 1, text, lines: [], changes: [change("cast:mio", "carried.left_hand", null, "c1"), change("prop:bowl", "holder", "on the counter", "c2")] },
    { id: "b2", order: 2, told: 2, text: after, lines, changes: [] },
  ] };
  const units = [
    { cut: "C1", beats: ["b1"], cast: ["cast:mio", "cast:kuroe"], props: ["prop:bowl"], blocking, camera: "Fixed medium two-shot." },
    { cut: "C2", beats: ["b2"], cast: ["cast:mio", "cast:kuroe"], props: ["prop:bowl"], blocking: "Mio smiles and nods once without moving the bowl.", camera: "The same fixed medium two-shot." },
  ];
  const scene = { id: "scene", book: "book:film", shots: units.map((unit, i) => ({ id: `shot${i + 1}`, unit })) };
  const records = [
    ["book", "film", { name: "On the House", story: "story:story", style: "look:look", scenes: ["scene"] }],
    ["story", "story", story], ["look", "look", { name: "Warm dusk", paragraph: "Hand-drawn anime with restrained cel shading.", palette: "full" }],
    ["cast", "mio", { name: "Mio Hayase", details: "a cook, a steel ladle in her right hand", refs: [] }],
    ["cast", "kuroe", { name: "Baron Kuroe", details: "an elderly critic, a monocle on his right eye", refs: [], voice: { file: "voice.wav" } }],
  ].map(([kind, id, body]) => ({ kind, id, head: 1, versions: [{ n: 1, body }] }));
  const parse = (ref) => { const [, kind, id, n] = ref.match(/^([^:]+):([^@]+)(?:@(\d+))?$/); return { kind, id, n: n ? +n : null }; };
  const W = { load: async () => {}, parse, all: (kind) => records.filter((r) => r.kind === kind), headOf: (r) => r.versions[0], refOf: (kind, id, n) => `${kind}:${id}${n ? `@${n}` : ""}`,
    get: (ref) => { const { kind, id } = parse(ref), r = records.find((r) => r.kind === kind && r.id === id); return r ? { record: r, version: r.versions[0] } : null; },
    sha: async (x) => crypto.createHash("sha256").update(x).digest("hex"), short: (x) => x.slice(0, 12) };
  const craft = vm.runInNewContext(`${source("web/snap/craft.js")}\n;({timingLint,placeLint,soundLint,lookAlike})`);
  const context = vm.createContext({ W, api: { addEventListener() {} }, SC: { load: async () => {}, get: () => scene, shotOf: (s, id) => s.shots.find((x) => x.id === id) },
    T: { load: async () => {} }, L: { ready: async () => {}, castLine: (body) => body.details }, P: { all: () => [] }, C: craft, structuredClone });
  const B = vm.runInContext(`${source("web/snap/book.js")}\n;({compile,boardPackage})`, context);
  return { story, units, compile: (shot) => B.compile("scene", shot).then(plain), board: (sheet, role) => B.boardPackage(sheet, { role }).then(plain) };
}
(async () => {
  const n = native(), canon = JSON.stringify(n.story), c1 = await n.compile("shot1"), c2 = await n.compile("shot2");
  const contradictions = (sheet) => sheet.lint.filter((x) => /says .* while .*check they agree/.test(x));
  assert.deepEqual(contradictions(c1), [], "set-down action and explicit opening are not assertions of the end state");
  assert.equal(c1.board.role, "opening");
  assert.equal(c1.opens.after, null);
  assert.match(c1.opens.still_prompt, /bowl with two blue rim stripes held in Mio left hand/);
  assert.doesNotMatch(c1.opens.still_prompt, /left hand is empty|stripes is on the counter/);
  assert.equal(c1.entities[0].fields[0].opens.said, "not set before this beat (the Cast's own look)");
  assert.equal(c1.entities[0].fields[0].provenance, "story:story@1 b1 change c1");
  for (const prompt of [c2.still_prompt, c2.board.prompt, (await n.board(c2, "key")).prompt]) {
    assert.doesNotMatch(prompt, /For me\?|\{voice:|in the voice of|<Audio \d+>/i);
    assert.match(prompt, /looks from the bowl to Mio/);
    assert.match(prompt, /small smile and one nod/);
    assert.match(prompt, /bowl stays on the counter/);
    assert.match(prompt, /steel ladle in her right hand/);
    assert.match(prompt, /Fixed medium two-shot|same fixed medium two-shot/i);
  }
  assert.match(c2.prompt.description, /Baron Kuroe says "For me\?" in the voice of \{voice:cast:kuroe\}\./);
  assert.equal(c2.prompt.sentences.find((x) => x.from === "story b2 text").text, reaction);
  assert.equal(JSON.stringify(n.story), canon, "compile never rewrites accepted canon or why quotes");
  assert.deepEqual(c2.speakers, ["cast:kuroe"]);
  const staticHand = await native({ blocking: "Mio holds the bowl in her left hand." }).compile("shot1");
  assert.ok(contradictions(staticHand).some((x) => /left hand is empty/.test(x)), "static same-beat assertion still contradicts the end state");
  const endHand = await native({ blocking: "By the end, Mio holds the bowl in her left hand." }).compile("shot1");
  assert.ok(contradictions(endHand).some((x) => /left hand is empty/.test(x)), "explicit end assertion still contradicts the end state");
  const later = await native({ after: "Mio holds the bowl in her left hand." }).compile("shot2");
  assert.ok(contradictions(later).some((x) => /left hand is empty/.test(x)), "unchanged state still contradicts a later held bowl");
  const spatial = await native({ blocking: "Before Kuroe, Mio holds the bowl in her left hand." }).compile("shot1");
  assert.ok(contradictions(spatial).some((x) => /left hand is empty/.test(x)), "spatial before is not an opening phase");
  const whole = await native({ blocking: "Opening: Mio lowers the bowl from her left hand but holds the bowl in her left hand throughout the cut." }).compile("shot1");
  assert.ok(contradictions(whole).some((x) => /left hand is empty/.test(x)), "whole-cut assertions must also agree at the end");
  const unchangedProp = native({ after: "Kuroe raises the bowl to his lips." });
  assert.ok(contradictions(await unchangedProp.compile("shot2")).some((x) => /is on the counter/.test(x)), "a raise with no holder change still contradicts the counter ledger");
  const multi = native(); multi.units[0].beats = ["b1", "b2"];
  assert.deepEqual(contradictions(await multi.compile("shot1")), [], "each beat checks its own phase within a multi-beat cut");
  const known = native({ prior: [{ id: "b0", order: 0, told: 0, text: "Mio waits.", lines: [], changes: [
    { id: "c0", entity: "cast:mio", path: "carried.left_hand", op: "set", value: "prop:bowl" },
    { id: "c3", entity: "prop:bowl", path: "holder", op: "set", value: "cast:mio" },
  ] }] });
  const k1 = await known.compile("shot1");
  assert.deepEqual(contradictions(k1), []);
  assert.match(k1.opens.still_prompt, /Mio Hayase holds the soup bowl with two blue rim stripes in the left hand/);
  assert.match(k1.still_prompt, /Mio Hayase's left hand is empty/);
  const wrongOpening = native({ blocking: opening, prior: [{ id: "b0", order: 0, told: 0, text: "Mio waits.", lines: [], changes: [
    { id: "c0", entity: "cast:mio", path: "carried.left_hand", op: "set", value: "prop:ladle" },
  ] }] });
  assert.ok(contradictions(await wrongOpening.compile("shot1")).some((x) => /holds the ladle/.test(x)), "explicit opening checks a known prior hand");
  for (const after of ['Kuroe looks at Mio and asks, "For me?" Mio smiles.', 'The sign reads "For me?". Kuroe asks, "For me?" Mio nods.', 'The sign says "For me?". Kuroe asks, "For me?" Mio nods.']) {
    const sheet = await native({ after }).compile("shot2"), count = (sheet.still_prompt.match(/For me\?/g) ?? []).length;
    assert.equal(count, after.startsWith("The sign") ? 1 : 0, "written text remains while speech leaves the still");
    assert.match(sheet.still_prompt, /Mio (smiles|nods)/);
  }
  console.log("book_prompt_phases PASS (native compile, opening/end state, genuine contradictions, still speech, video dialogue, written text, provenance, unchanged canon)");
})().catch((e) => { console.error(e); process.exitCode = 1; });
