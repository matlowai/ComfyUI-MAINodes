// Brick tools: the same operations as the Inspector's make-a-brick actions (engine.js, library.js), joined into Snap's one
// tool table (tools.js spreads BRICK_TOOLS). A brick a person makes is a ComfyUI subgraph; these change only the open
// recipe (as snap and set_setting do: direct, no proposal) or the person's Library (keep_brick saves as "agent", as
// save_cast does, SNAP-R17).
// SNAP-R280 a made brick is a subgraph · SNAP-R281 an any-node brick's face and title · SNAP-R282 a kept brick carries its
// blueprint · SNAP-R283 any installed blueprint is a brick · SNAP-R284 grouping never touches pack bricks · SNAP-R19 the
// tool table is the API · SNAP-R30/R52 errors name what is accepted · SNAP-R58 nothing trimmed · see docs/snap/SNAP_RULES.md
import * as E from "./engine.js";
import * as L from "./library.js";
import { BRICKS } from "./bricks.js";

const keys = () => E.state().bricks.map((b) => b.key);
const anyNode = () => keys().filter((k) => k.startsWith("node:"));
// a brick as an agent names it: its key (node:<Type>#<n>) or the title it shows, as describe_recipe lists them
function which(brick) {
  const s = typeof brick === "string" ? brick.trim() : "";
  const hit = keys().includes(s) ? s : keys().find((k) => BRICKS[k]?.title?.toLowerCase() === s.toLowerCase());
  if (!hit) throw new Error(`No brick ${JSON.stringify(brick ?? "")} in this recipe: give its id or title (describe_recipe); its bricks made from any node or subgraph: ${anyNode().map((k) => `${k} (${BRICKS[k].title})`).join(", ") || "none"}`);
  return hit;
}
const brickArg = { type: "string", description: "a brick made from any node or subgraph: its id (node:<Type>#<n>) or the title it shows (describe_recipe)" };
const faceOut = (key) => BRICKS[key].face.map(([node, setting, label]) => ({ node, setting, label }));
async function named(name) {
  const all = await E.blueprints(), hit = all.find((b) => b.name === name) ?? all.find((b) => b.name.toLowerCase() === String(name ?? "").trim().toLowerCase());
  if (!hit) throw new Error(`No blueprint ${JSON.stringify(name ?? "")}; list_blueprints lists ${all.length}: ${all.map((b) => b.name).join(", ") || "none"}`);
  return hit;
}

export const BRICK_TOOLS = [
  {
    name: "set_brick_face",
    description: "Choose what a brick made from any node or subgraph shows on its face (SNAP-R281): show is the whole face in order, each a setting name of the brick's node or [node, setting] / [node, setting, label]; reset: true gives back its default (a plain node's first three settings, a subgraph's promoted widgets). One undo step; the face is kept on the recipe, so a saved recipe or a kept brick carries it. Pack bricks keep their curated faces and are refused.",
    inputSchema: { type: "object", properties: { brick: brickArg, show: { type: "array", items: { type: ["string", "array"], items: { type: "string" } } }, reset: { type: "boolean" } }, required: ["brick"] },
    run: ({ brick, show, reset = false }) => {
      const key = which(brick);
      if (!reset && !Array.isArray(show)) throw new Error("set_brick_face takes brick and show (a list of settings: a name or [node, setting, label?]) or reset: true");
      E.setFace(key, reset ? null : show);
      return { brick: key, title: BRICKS[key].title, face: faceOut(key), own: !!BRICKS[key].faced };
    },
  },
  {
    name: "rename_brick",
    description: "Give a brick made from any node or subgraph its own title (SNAP-R281), as Snap shows it and as tools name it; an empty or null title gives back the node's own (a subgraph's name). One undo step, kept on the recipe. Pack bricks are refused.",
    inputSchema: { type: "object", properties: { brick: brickArg, title: { type: ["string", "null"] } }, required: ["brick", "title"] },
    run: ({ brick, title }) => { const key = which(brick); return { brick: key, title: E.setTitle(key, title) }; },
  },
  {
    name: "keep_brick",
    description: "Keep a brick made from any node or subgraph in the person's Library as a card (SNAP-R282): brick-<its title>, with its settings, face, title and, for a subgraph, its blueprint, so it can be added to any recipe later (the Library's Bricks, the palette's My bricks). Keeping one with the same title again saves a new version of that card. title names the card (default: the brick's title); note is the version's line.",
    inputSchema: { type: "object", properties: { brick: brickArg, title: { type: "string" }, note: { type: "string" } }, required: ["brick"] },
    run: async ({ brick, title, note = "" }) => {
      const out = await L.keepBrick(which(brick), { title, note, by: "agent" });
      return { ...out, said: `${out.title} kept in the Library as ${out.ref}${out.blueprint ? " with its blueprint" : ""}` };
    },
  },
  {
    name: "list_blueprints",
    description: "The blueprints a recipe can take as a brick with add_blueprint: the person's own first (source \"yours\": published with ComfyUI's Publish subgraph, kept in their userdata subgraphs/), then the installed ones (ComfyUI's /global_subgraphs: subgraphs custom node packs and ComfyUI ship); name, source, pack, and what each needs (link inputs), gives (outputs) and shows (its promoted widgets, with their labels). A name in both lists twice; add_blueprint by that name takes the person's. The two the Render bricks are made of are left out (they are those bricks).",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    run: async () => {
      const all = await E.blueprints();
      const blueprints = await Promise.all(all.map(async (b) => { try { const f = E.blueprintFace(await E.fetchBlueprintNamed(b.name, { source: b.source === "yours" ? "yours" : "installed" })); return { ...b, needs: f.needs, gives: f.gives, shows: f.shows }; } catch (err) { return { ...b, error: err.message }; } }));
      return { count: blueprints.length, blueprints };
    },
  },
  {
    name: "add_blueprint",
    description: "Add a blueprint to the recipe as a brick (SNAP-R283), by its name (list_blueprints; the person's own wins over an installed one of that name): ComfyUI inserts it as a subgraph node, Snap records it as a brick and wires its inputs by type from the bricks before it, as with any node. One undo step. Returns its id (node:<subgraph id>#<n>) and the bindings made.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, after: { type: "string", description: "a brick id: the new brick goes after it (default: the end)" } }, required: ["name"] },
    run: async ({ name, after }) => {
      const hit = await named(name), at = after && keys().includes(after) ? keys().indexOf(after) + 1 : undefined;
      if (after && at === undefined) throw new Error(`No brick "${after}" in this recipe for after; its bricks: ${keys().join(", ") || "none"}`);
      const res = await E.snapBlueprint(await E.fetchBlueprintNamed(hit.name, { source: hit.source === "yours" ? "yours" : "installed" }), { at });
      return { brick: res.brick, title: BRICKS[res.brick].title, face: faceOut(res.brick), bindings: res.bindings.map(({ role, from, output, rule }) => ({ role, from, output, rule })) };
    },
  },
  {
    name: "make_brick",
    description: "Group two or more bricks made from any node or subgraph into one subgraph brick (SNAP-R284), through ComfyUI's own Convert to Subgraph, as one undo step: the new brick takes the first one's place, title names it, wires into and out of the group stay and Snap's record of them follows. Pack bricks are refused, by name. Its face starts with the settings the grouped bricks showed, in brick order under their labels, promoted onto it in the same step; set_brick_face or promoting in ComfyUI changes that.",
    inputSchema: { type: "object", properties: { bricks: { type: "array", items: { type: "string" }, minItems: 2 }, title: { type: "string" } }, required: ["bricks"] },
    run: ({ bricks, title }) => {
      if (!Array.isArray(bricks)) throw new Error("make_brick takes bricks (a list of two or more brick ids or titles) and title");
      const keysOf = bricks.map((b) => { try { return which(b); } catch { return b; } }); // a pack brick's id is refused by group with its name
      return E.group(keysOf, { title });
    },
  },
];
