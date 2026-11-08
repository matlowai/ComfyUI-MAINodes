// Synthetic fixtures. Native contract excerpts are manually transcribed from the pinned source;
// they are NOT a live server census and do not establish GPU/UI behavior.
import fs from "node:fs";
import { createRegistry } from "../../../web/snap/director/registry.mjs";
export const catalogue = JSON.parse(fs.readFileSync(new URL("../../../web/snap/director/strategies.json", import.meta.url), "utf8"));
export const entries = catalogue.strategies.map((definition) => ({ definition, ref: `pack:${definition.id}@${definition.version}`, origin: "pack" }));
export const registry = () => createRegistry(structuredClone(entries));
const s = { type: "string" }, n = { type: "number" }, i = { type: "integer" }, b = { type: "boolean" }, a = { type: "array", items: s }, o = { type: "object" };
const tool = (name, properties = {}, required = [], flags = {}) => ({ name, inputSchema: { type: "object", properties, required }, ...flags });
const ro = { annotations: { readOnlyHint: true } }, gpu = { consequential: true }, pick = { decides: true }, direct = { direct: true };
export const tools = [
  tool("describe_recipe", {}, [], ro), tool("list_activity", {}, [], ro), tool("create_book", { name: s, medium: s, cast: a, locations: a, production: s }, ["name"]),
  tool("import_fountain", { book: s, text: s, dry_run: b, proposal: s }, ["book", "text"], direct),
  tool("add_beat", { book: s, text: s, intent: s, dry_run: b }, ["book", "text"], direct), tool("story_stale", { book: s }, ["book"], ro),
  tool("make_character_sheet", { cast: s, method: s, ref: i, count: { type: "integer", minimum: 1 }, land: {}, pictures: { type: "array" } }, ["cast"], gpu),
  tool("add_cut", { book: s, scene: s, scene_name: s, name: s, beats: a, cast: a, props: a, location: s, plate: s, seconds: n, sound: s, camera: s, blocking: s }, ["book"]),
  tool("make_board", { scene: s, shot: s, method: s, count: { type: "integer", minimum: 1 }, seeds: { type: "array", items: i }, role: { type: "string", enum: ["opening", "key"] } }, ["scene", "shot"], gpu),
  tool("set_board", { scene: s, shot: s, take: s, file: s, approved: b, role: { type: "string", enum: ["opening", "key"] } }, ["scene", "shot"], pick),
  tool("animatic", { book: s }, ["book"], gpu), tool("open_shot", { scene: s, shot: s }, ["scene", "shot"]),
  tool("set_unit", { scene: s, shot: s, opens_on: { type: ["object", "null"] }, plate: s }, ["scene", "shot"]),
  tool("compile_unit", { scene: s, shot: s, beats: a }, ["scene", "shot"], ro), tool("apply_unit", { scene: s, shot: s, beats: a, land: o }, ["scene", "shot"]),
  tool("run", { question: s }, [], gpu), tool("new_seed", { brick: s, mode: { type: "string", enum: ["fixed", "random"] } }),
  tool("wait_for", { job: s, until: { type: "string", enum: ["done", "waiting", "failed", "settled"] } }, ["job"], ro),
  tool("set_active_take", { scene: s, shot: s, take: s }, ["scene", "shot", "take"], pick),
  tool("get_take", { take: s }, ["take"], ro), tool("list_critiques", { state: { type: "string", enum: ["due", "claimed", "done", "all"] } }, [], ro),
  tool("check_voice", { take: s }, ["take"], direct), tool("export_cut", { book: s }, ["book"], gpu),
  tool("edit_take", { take: s, method: s, change: s, example: s, who: s, becomes: s, frames: { type: "array", items: { type: "integer", minimum: 0 } }, count: { type: "integer", minimum: 1, maximum: 3 }, clips: i, lighter: b, antiburn: n, prompt: s }, ["take"], gpu),
  tool("candidate_frames", { decision: s, candidate: s, max_width: i }, ["decision"], ro),
  tool("apply_candidate", { decision: s, candidate: s, pin: b }, ["decision", "candidate"], pick),
  tool("upscale_take", { take: s, method: s, denoise: n, factor: n }, ["take"], gpu),
  tool("save_instruction", { id: s, scope: s, kind: s, text: s, source: o }, [], direct),
  tool("set_agent_permissions", { run: b, see: b }), tool("save_skill", { name: s, markdown: s }),
];
export const methods = [
  { id: "remake_edit", slot: "edit", kind: "take", wired: true, install_state: "ready" },
  { id: "relight", slot: "edit", kind: "take", wired: true, install_state: "ready" },
  { id: "remake_swap", slot: "recast", kind: "take", wired: true, install_state: "ready" },
  { id: "ph3_view", slot: "view", kind: "take", wired: true, install_state: "ready" },
  { id: "qwen21_view", slot: "view", kind: "take", wired: true, install_state: "ready" },
  { id: "stage2", slot: "upscale", kind: "take", wired: true, install_state: "ready" },
  { id: "ltx_spatial", slot: "upscale", kind: "media", unwired: "No compatible recipe" },
];
export function snapshot() {
  return {
    target: { book: "book:film", scene: null, shot: null, source_take: null },
    book: { ref: "book:film@1", name: "Synthetic lantern handoff", cast_refs: ["cast:a", "cast:b"], location_refs: ["location:room"], style_ref: "look:film@1", pending_proposals: [],
      story: { ref: "story:film@1", beats: [
        { id: "b1", order: 1, told: 1, text: "A offers the lantern to B.", changes: [], lines: [{ who: "cast:a", text: "Take this." }] },
        { id: "b2", order: 2, told: 2, text: "B takes the lantern.", changes: [], lines: [{ who: "cast:b", text: "Thank you." }] },
      ], groups: [{ id: "g1", kind: "scene", beats: ["b1", "b2"] }] } },
    units: [
      { scene: "s1", shot: "sh1", cut: "C1", beats: ["b1"], cast: ["cast:a", "cast:b"], location: "location:room", plate: "east", board: { file: "synthetic-board.png", approved: true }, timing: { seconds: 5 }, active: "take-original" },
      { scene: "s1", shot: "sh2", cut: "C2", beats: ["b2"], cast: ["cast:a", "cast:b"], location: "location:room", plate: "east", opens_on: { cut: "C1" }, timing: { seconds: 5 }, active: null },
    ],
    cast: [{ ref: "cast:a@1", name: "A", refs: [{ file: "synthetic-a.png" }], voice: { file: "synthetic-a.wav" } }, { ref: "cast:b@1", name: "B", refs: [{ file: "synthetic-b.png" }], voice: { file: "synthetic-b.wav" } }],
    locations: [{ ref: "location:room@1", name: "Room", master: { file: "synthetic-room.png" }, plan: { file: "synthetic-top.png" }, plates: [] }],
    source_take: null, provenance: { world: [{ ref: "book:film@1", hash: "fixture" }], scenes: [{ id: "s1", head: 1 }] }, errors: [], warnings: [],
  };
}
export const emptySnapshot = () => ({ target: {}, book: null, units: [], cast: [], locations: [], source_take: null, provenance: {}, errors: [], warnings: [] });
export function parameterNote(parameters, scope = "global", level = "person", reference = "instruction:test@1") {
  return { ref: reference, layer: "person", level, scope, kind: "note", text: "Synthetic scoped preferences, not permissions", source: { snap_director: { schema: "snap.strategy-parameters/v1", strategy: "*", parameters } } };
}
export const instructionStack = (...rows) => ({ stack: rows, refs: rows.map((r) => r.ref), off: [], conflicts: [], hash: "synthetic-instruction-hash" });
export function referenceRequest() {
  const image = (id, role, more = {}) => ({ id, media: "image", roles: [role], source: { ref: `location:test@1`, frame: 0 }, ...more });
  return { profile: { id: "fixture-h3", source: "Synthetic test descriptor, not live model certification", limits: { image: 4, video: 1, audio: 1 }, tags: { image: "<Picture {n}>", video: "<Video {n}>", audio: "<Audio {n}>" } },
    references: [image("top", "geometry_top", { scene: "room", textured: true }), image("side", "geometry_side", { scene: "room", viewpoint: "east", genuine_view: true }),
      image("camera", "camera_plate"), image("actor", "cast_identity"),
      { id: "voice", media: "audio", roles: ["voice_reference"], entity: "cast:a", source: { ref: "cast:a@1" } }],
    context: { scene: "room", geometry_required: true, speakers: ["cast:a"] }, prompt: "Keep the framing of {{ref:camera}} and the identity in {{ref:actor}}." };
}
export function freeze(value) { if (value && typeof value === "object") { Object.freeze(value); Object.values(value).forEach(freeze); } return value; }
