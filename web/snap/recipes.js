// Snap recipes: a recipe is one card record with a stable id (recipe-<slug of its name>); saving it again adds a version,
// never a new card. A version keeps the exact workflow (`graph`, app.graph.serialize()) and the portable brick list
// (`brick.bricks`, E.recipe(): what E.restore rebuilds in any graph); the Library lists it without the graph. The open
// graph names the recipe and version it was saved as or opened from (extra.snap.recipe = {id, n}); "edited" is never
// stored: it is the brick list now compared with that version's. Old cards (recipe-<timestamp>, no family) list as
// one-version recipes; a family's recipe card is a setup (models.js) and is never one of these.
// SNAP-R274 one versioned record · SNAP-R275 the exact graph and the brick list, listed without the graph · SNAP-R276 the
// graph names its recipe and version, edited computed · SNAP-R277 privacy on keeps no graph and no identity rows, said ·
// SNAP-R12/R37 identity rows · SNAP-R17 by · SNAP-R5 another recipe opens in a new tab · SNAP-R60 world records ·
// SNAP-R58 nothing trimmed · SNAP-R281 a brick's face and title in the changes · SNAP-R282 blueprints listed as present only ·
// see docs/snap/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import * as E from "./engine.js";
import * as W from "./world.js";
import * as T from "./takes.js";
import * as M from "./models.js";
import { BRICKS } from "./bricks.js";

// ---- pure parts (no graph, records or server: tests/snap/test_recipes.mjs calls them as they are)
const canonical = (x) => JSON.stringify(x, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((y) => [y, v[y]])) : v));
export const same = (a, b) => canonical(a ?? null) === canonical(b ?? null);
export const slug = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
// two names with one slug ("Night walk", "night-walk") are one recipe: saving under either adds a version
export const idFor = (name, now = Date.now()) => `recipe-${slug(name) || now.toString(36)}`;
// SNAP-R12/R37: with privacy on an identity brick keeps its place and none of its rows
export const strip = (bricks, privacy, defs = BRICKS) => bricks.map((b) => (privacy && defs[b.key]?.stack?.role === "identity" ? { key: b.key, values: {} } : b));
export const summary = (bricks, titleOf = (k) => k) => `${bricks.length} bricks: ${bricks.map((b) => titleOf(b.key)).join(", ")}`;
// what the Library lists for a card body: a recipe's graph (60-70 KB) stays on the record, `workflow: true` says it is there;
// a subgraph brick's blueprint (a recipe's bricks, a kept brick's entry) stays there too, `blueprint: true` says so (SNAP-R282)
const lightEntry = (e) => (e?.blueprint && typeof e.blueprint === "object" ? { ...e, blueprint: true } : e);
export const lightBricks = (bricks) => (Array.isArray(bricks) ? bricks.map(lightEntry) : bricks);
// A family's recipe card (a setup, "Last used") keeps its blueprints: models.js applies it from the Library's copy
export function listed(body) {
  if (!body || typeof body !== "object") return body;
  if (body.family && !body.graph) return body;
  const heavy = !!body.graph || (body.brick?.bricks ?? []).some((e) => e?.blueprint && typeof e.blueprint === "object") || (body.brick?.entry?.blueprint && typeof body.brick.entry.blueprint === "object");
  if (!heavy) return body;
  const { graph, ...rest } = body, brick = rest.brick && { ...rest.brick, ...(rest.brick.bricks ? { bricks: lightBricks(rest.brick.bricks) } : {}), ...(rest.brick.entry ? { entry: lightEntry(rest.brick.entry) } : {}) };
  return { ...rest, ...(brick ? { brick } : {}), ...(graph ? { workflow: true } : {}) };
}
// a listed copy: saving it as a version would drop what it leaves out (L.save refuses it)
export const light = (body) => (body?.kind === "recipe" && body.workflow === true && !body.graph) || (body?.brick?.bricks ?? []).some((e) => e?.blueprint === true) || body?.brick?.entry?.blueprint === true;
// the stored workflow: the graph less what names this tab rather than the work: its id (a reopened tab gets a new one),
// the canvas view (extra.ds: panning is not an edit), the shot the tab is bound to (extra.snap_scene; the tab opener
// drops it anyway) and the recipe marker. The marker is stripped, not written ahead: the version number is known only
// after the server compares bodies, and a graph naming n + 1 would differ from its head on every save, so "the same
// work makes no new version" could never hold. open() puts {id, n} back on the copy it opens (marked)
export function stored(graph) {
  const g = JSON.parse(JSON.stringify(graph)), { snap_scene, ds, ...extra } = g.extra ?? {};
  delete g.id;
  if (extra.snap) { const { recipe, ...snap } = extra.snap; extra.snap = snap; }
  g.extra = extra;
  return g;
}
export const marked = (graph, id, n) => ({ ...graph, extra: { ...graph.extra, snap: { version: 1, bricks: [], bindings: [], ...graph.extra?.snap, recipe: { id, n } } } });
// two serialized graphs hold the same nodes with the same widget values (a take's graph is the open one)
const nodesOf = (g) => (g?.nodes ?? []).map(({ id, type, widgets_values }) => [id, type, widgets_values ?? null]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
export const sameNodes = (a, b) => same(nodesOf(a), nodesOf(b));
// what changed between two brick lists, one line per setting, each naming its brick ("Render (render): render.length 97 → 121");
// never the graph. diff is world.js's (W.diff), injectable for the tests
// SNAP-R281/R282: a brick's own face and title get one short line each; a blueprint is never printed
const keyed = (bricks) => { const seen = {}; return new Map((bricks ?? []).map((b) => { const k = (seen[b.key] = (seen[b.key] ?? 0) + 1); return [k > 1 ? `${b.key}#${k}` : b.key, b]; })); };
const faceText = (f) => (f ? f.map(([, name, label]) => label || name).join(", ") || "nothing" : "its default");
export function changeLines(a, b, diff, titleOf = (k) => k) {
  const was = keyed(a), now = keyed(b), out = [];
  const name = (k) => { const t = now.get(k)?.title ?? was.get(k)?.title ?? titleOf(k.split("#")[0]); return t && t !== k.split("#")[0] ? `${t} (${k})` : k; };
  for (const k of new Set([...was.keys(), ...now.keys()])) {
    if (!was.has(k)) out.push(`${name(k)}: added ${JSON.stringify(now.get(k).values ?? {})}`);
    else if (!now.has(k)) out.push(`${name(k)}: taken out (was ${JSON.stringify(was.get(k).values ?? {})})`);
    else {
      const x = was.get(k), y = now.get(k);
      out.push(...diff({ v: x.values ?? {} }, { v: y.values ?? {} }).map((l) => `${name(k)}: ${l.replace(/^v\.?/, "").trim()}`)); // wrapped so diff's top-level skips (id, saved) never hide a node named so
      if ((x.title ?? null) !== (y.title ?? null)) out.push(`${name(k)}: title ${x.title ? JSON.stringify(x.title) : "its own"} → ${y.title ? JSON.stringify(y.title) : "its own"}`);
      if (!same(x.face, y.face)) out.push(`${name(k)}: face ${faceText(x.face)} → ${faceText(y.face)}`);
    }
  }
  const order = (m, o) => [...m.keys()].filter((k) => o.has(k));
  if (order(was, now).join(" ") !== order(now, was).join(" ")) out.push(`order ${order(was, now).join(", ")} → ${order(now, was).join(", ")}`);
  return out;
}
// dates people read carry the day, not only a time
export const when = (at) => new Date(at).toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export function ago(at, now = Date.now()) {
  const s = Math.max(0, (now - at) / 1000);
  const rel = s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
  return `${rel} · ${new Date(at).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })}`;
}

// ---- the records and the open graph
const titleOf = (k) => BRICKS[k]?.title ?? k;
const PRIVATE = "privacy is on, so this version keeps no workflow and no identity LoRA rows (SNAP-R277): opening it rebuilds it from its bricks";
export const shareable = async () => strip(E.recipe(), await T.privacyOn());
// a recipe record: a card whose newest body is a recipe without a family (a family's is a setup)
const plain = (r) => { const b = W.headOf(r)?.body; return b?.kind === "recipe" && !b.family; };
const recordOf = (id) => { const r = W.record("card", id); return r && plain(r) ? r : null; };
function versionOf(id, n) {
  const r = recordOf(id);
  if (!r) throw new Error(`No recipe ${id}; list_recipes lists them`);
  const v = n == null ? W.headOf(r) : r.versions.find((x) => x.n === +n);
  if (!v) throw new Error(`${W.headOf(r).body.title} has no version ${n}; it has v${r.versions.map((x) => x.n).join(", v")}`);
  return { r, v };
}
const mark = (id, n) => { if (!same(E.state().recipe, { id, n })) E.tag("recipe", { id, n }); };

// the open graph's recipe: null when it names none (or names one no longer kept); edited compares the brick list now,
// stripped as a save would strip it, with that version's
export async function current() {
  const m = E.state().recipe;
  if (!m?.id) return null;
  await W.load();
  const r = recordOf(m.id);
  if (!r) return null;
  const v = r.versions.find((x) => x.n === m.n);
  // a blueprint is compared as present or not: every insert gives a subgraph new ids, so its JSON differs after a rebuild
  return { id: m.id, n: m.n, name: W.headOf(r).body.title, head: r.head, edited: !v || !same(lightBricks(await shareable()), lightBricks(v.body.brick?.bricks)) };
}

// which record a save goes to: the graph's own recipe, or (a name given, or none yet) that name's; asNew never an
// existing record (-2, -3… on the id). An id held by something other than a plain recipe is skipped the same way
function target({ name, asNew, cur }) {
  const n = name?.trim();
  if (!asNew && cur && !n) return { id: cur.id, title: cur.name };
  if (!n) throw new Error(asNew ? "A new recipe needs a name (save_recipe {name, as_new: true})" : "This graph has no recipe yet: give it a name (save_recipe {name})");
  const free = (id) => !W.record("card", id) || (!asNew && recordOf(id)), base = idFor(n);
  let id = base;
  for (let i = 2; !free(id); i++) id = `${base}-${i}`;
  return { id, title: n };
}
async function write(id, { title, bricks, graph, from, note, by }) {
  const head = W.headOf(W.record("card", id))?.body;
  const body = { id, kind: "recipe", title, text: summary(bricks, titleOf), brick: { bricks }, ...(graph ? { graph } : {}), ...(from ? { from } : {}) };
  // the same work keeps its head's stamp, so the server sees an equal body and makes no version (SNAP-R274)
  body.saved = head && same({ ...head, saved: 0 }, { ...body, saved: 0 }) ? head.saved : Date.now();
  const out = await W.save("card", id, body, { note, by });
  mark(id, out.n);
  return { ref: out.ref, id, n: out.n, made: out.made, name: title, graph: !!graph, ...(graph ? {} : { why: PRIVATE }) };
}

// save the open graph: a version of its recipe (no name), a first save (name), or a new recipe (asNew, name)
export async function save({ name, note = "", by = "person", asNew = false } = {}) {
  await W.load();
  const cur = await current(), { id, title } = target({ name, asNew, cur }), priv = await T.privacyOn();
  return write(id, { title, bricks: strip(E.recipe(), priv), graph: priv ? null : stored(app.graph.serialize()), note, by });
}

// a take's workflow as a version. The brick list is read from the open graph's widgets (E.recipe): a saved graph keeps
// widget values by position only, so they can't be named without its nodes. So the take's workflow must be the open one
export async function saveFromTake(takeId, { name, note = "", by = "person" } = {}) {
  await Promise.all([W.load(), T.load()]);
  const t = T.find(takeId);
  if (!t) throw new Error(`No take ${takeId}; list_takes lists them`);
  if (!t.graph?.nodes?.length) throw new Error(`take ${t.number} kept no workflow to keep as a recipe version`);
  if (!sameNodes(t.graph, app.graph.serialize())) throw new Error(`take ${t.number}'s workflow isn't the one open here: open it first (the take's "as it was", or retake {open_only: true}), then keep it as a recipe version`);
  const cur = await current(), { id, title } = target({ name, asNew: false, cur }), priv = await T.privacyOn();
  return write(id, { title, bricks: strip(E.recipe(), priv), graph: priv ? null : stored(t.graph), from: { take: t.id }, note: note || `from take ${t.number}`, by });
}

// every recipe, newest saved first (records must be loaded: W.load / L.ready)
export const list = () => W.all("card").filter(plain).map((r) => {
  const v = W.headOf(r);
  return { id: r.id, ref: W.refOf("card", r.id), name: v.body.title, versions: r.versions.length, head: r.head, saved: v.at ?? v.body.saved, by: v.by, note: v.note, workflow: !!v.body.graph };
}).sort((a, b) => b.saved - a.saved);
export const versions = (id) => [...versionOf(id).r.versions].sort((a, b) => b.n - a.n).map(({ n, at, by, note, body }) => ({ n, at, by, note, workflow: !!body.graph }));
export const changes = (id, a, b) => changeLines(versionOf(id, a).v.body.brick?.bricks, versionOf(id, b).v.body.brick?.bricks, W.diff, titleOf);
export const workflow = (id, n) => versionOf(id, n).v.body.graph ?? null;
// one version as {n, at, by, note, body} with the body as the Library lists it (no graph)
export const version = (id, n) => { const { v } = versionOf(id, n); return { n: v.n, at: v.at, by: v.by, note: v.note, body: listed(v.body) }; };

// open a version: "tab" = its exact workflow in a new tab (the take opener, SNAP-R5), or rebuilt from its bricks in a new
// tab when it kept none; "here" = its bricks rebuilt in the open graph (one undo step), as the Library card does
export async function open(id, n, { how = "tab" } = {}) {
  await W.load();
  const { r, v } = versionOf(id, n), name = W.headOf(r).body.title, bricks = v.body.brick?.bricks ?? [];
  if (how === "here") {
    const keys = await E.restore(bricks);
    mark(id, v.n);
    return { how, id, n: v.n, said: `${name} v${v.n}: ${keys.length} bricks with their settings, rebuilt in this graph` };
  }
  if (how !== "tab") throw new Error(`how is "tab" (the exact workflow in a new tab) or "here" (its bricks rebuilt in this graph); not ${JSON.stringify(how)}`);
  if (v.body.graph) {
    await T.openAsTab({ graph: marked(v.body.graph, id, v.n), workflow: name, number: `v${v.n}` });
    return { how, id, n: v.n, workflow: true, said: `${name} v${v.n} is open in a new tab, as it was saved` };
  }
  await M.freshTab();
  await E.restore(bricks);
  mark(id, v.n);
  return { how, id, n: v.n, workflow: false, said: `${name} v${v.n} kept no workflow (saved with privacy on, or before recipes kept one): rebuilt from its ${bricks.length} bricks in a new tab` };
}
