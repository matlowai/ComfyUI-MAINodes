// Scenes (U59, the operator's answer to Q2): a scene is a document that owns its related work, nested and navigable: the
// scene → its shots in order → each shot's takes, with versions (a night version, a take continued from another's last
// frame) as children of the take they came from, and one active take per shot. Takes keep their own store (takes.js);
// a shot lists them by id and names the workflows whose takes are its own (graph ids, as takes record them), so a run in
// the shot's workflow, or an edit of one of its takes, joins the shot by itself. Each shot's workflow is kept beside its
// scene, in snap/scenes/<scene>/<shot>.json.
// Tabs are scratch: opening a shot saves the open shot first and shows the next one in the same scene tab; a scratch
// tab, or a tab of a saved workflow file, is never swapped (its next save would write another shot into that file): the
// shot opens in a new tab. Adopting a workflow's takes copies its graph with its id, so its take group keeps working
// and gathers in the shot, and leaves a saved workflow file as it was.
// Renaming and removing delete nothing: a removed shot stays in its scene's file under `removed`, with its takes listed
// and its workflow file kept, and a deleted scene's document is parked in snap/scenes/_parked/ (U62).
// Plain data with stable ids, so a sequence editor can sit on it later: shots in order now, lanes and in/out on shots
// and takes later (scout/editor_layer §5.6-5.7).
// SNAP-R5 open work is never lost · SNAP-R60 authored fields versioned · SNAP-R17 by · SNAP-R18 local only · SNAP-R19 the tools call these · SNAP-R145 a take loaded here gets this shot's graph id · SNAP-R24 scenes
// own the work, tabs are scratch · SNAP-R120 a new shot keeps the setup, not the content · SNAP-R122 browsing never writes · SNAP-R213 a take of another shot can stand for this one, saying where it came from · see docs/snap/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import * as L from "./library.js";
import * as M from "./models.js";
import * as D from "./dials.js";
import * as S from "./slots.js";
import * as P from "./proposals.js";
import * as T from "./takes.js";
import * as W from "./world.js";

const DIR = "snap/scenes";
let scenes = [], loading = null;
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) fn(); };

const stamp = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const fileOf = (id) => `${DIR}/${id}.json`;
const workflowFile = (scene, shot) => `${DIR}/${scene}/${shot}.json`;
const parkedFile = (id) => `${DIR}/_parked/${id}.json`;

async function read(path) {
  const r = await api.getUserData(path);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error(`${path} unreadable (${r.status})`);
  return r.json();
}

export function load() {
  loading ??= (async () => {
    const files = (await api.listUserDataFullInfo(DIR)).filter((f) => f.path.endsWith(".json") && !f.path.includes("/")); // shot workflows sit in a folder per scene
    scenes = (await Promise.all(files.map((f) => read(`${DIR}/${f.path}`)))).filter(Boolean).sort((a, b) => a.created - b.created);
    changed();
    return scenes;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}
export const all = () => scenes;
export const get = (id) => scenes.find((s) => s.id === id) ?? null;
function need(id) {
  const s = get(id);
  if (!s) throw new Error(`No scene ${id}; there are: ${scenes.map((x) => `${x.id} (${x.name})`).join(", ") || "none yet"}`);
  return s;
}
export function shotOf(scene, id) {
  const shot = scene.shots.find((x) => x.id === id);
  if (!shot) throw new Error(`${scene.name} has no shot ${id}; its shots: ${scene.shots.map((x) => x.id).join(", ") || "none yet"}`);
  return shot;
}
// how a shot reads: its place in the scene, then its name when it has one
// F-K04: a name given as the whole title ("Shot 5 · Parch re-walk") keeps only its own part: Snap numbers shots itself
const ownName = (name) => name?.trim().replace(/^shot\s*\d+\s*[·:\-–]\s*/i, "") ?? "";
export const shotTitle = (scene, shot) => `Shot ${scene.shots.findIndex((x) => x.id === shot.id) + 1}${shot.name ? ` · ${shot.name}` : ""}`; // by id: a scene read again holds new shot objects (F-D05 "Shot 0")

// a scene versions its authored fields only (SNAP-R60): its name, set, and shots in order with their names and cards. A
// write that changes them appends {n, hash, at, by, note, body}; bookkeeping (take lists, the active take, workflow
// files) makes none
const authored = (s) => ({ name: s.name, set: s.set ?? null, ...(s.book ? { book: s.book } : {}), shots: s.shots.map((x) => ({ id: x.id, name: x.name ?? "", card: x.card ?? null, ...(x.unit ? { unit: x.unit } : {}) })) }); // SNAP-R67: a Book scene and its units
async function versioned(s, by, note) {
  const body = authored(s), hash = await W.sha(body), head = s.versions?.find((v) => v.n === s.head);
  if (head?.hash === hash) return;
  s.versions = [...(s.versions ?? []), { n: (s.versions?.at(-1)?.n ?? 0) + 1, hash, at: Date.now(), by, note, body }];
  s.head = s.versions.at(-1).n;
}
// one write per scene at a time, each on the file as it is now (another tab may have changed it): fn edits it in place
const writes = new Map();
function update(id, fn, { by = "person", note = "" } = {}) {
  const next = (writes.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const s = await read(fileOf(id));
    if (!s) { scenes = scenes.filter((x) => x.id !== id); changed(); throw new Error(`The scene ${id} isn't there any more (deleted in another tab? It is parked in ${parkedFile(id)})`); }
    const out = fn(s);
    await versioned(s, by, note);
    s.updated = Date.now();
    await api.storeUserData(fileOf(id), s);
    scenes = [...scenes.filter((x) => x.id !== id), s].sort((a, b) => a.created - b.created);
    changed();
    return out;
  });
  writes.set(id, next);
  return next;
}

// ---- takes and versions --------------------------------------------------------------------------------------------
// a take as a shot lists it: its id and the take it is a version of, so the tree reads from the scene file alone
const entry = (t) => ({ take: t.id, parent: t.parent?.take ?? null });
// the shot's takes: the ones it lists, then the ones its workflows made since (a run, an edit of one of its takes)
export function takesOf(shot) {
  const listed = new Set(shot.takes.map((e) => e.take));
  return [...shot.takes, ...T.all().filter((t) => shot.groups.includes(t.group) && !listed.has(t.id)).map(entry)];
}
// versions nest under the take they came from; a take whose parent isn't in this shot is a root
export function tree(shot) {
  const list = takesOf(shot), here = new Set(list.map((e) => e.take));
  const node = (e) => ({ ...e, children: list.filter((x) => x.parent === e.take).map(node) });
  return list.filter((e) => !e.parent || !here.has(e.parent)).map(node);
}
// the takes from the shot's root down to this one (Take 2 › Night version)
export function path(shot, id) {
  const list = takesOf(shot), out = [];
  for (let e = list.find((x) => x.take === id); e && out.length < list.length; e = list.find((x) => x.take === e.parent)) out.unshift(e.take);
  return out;
}
const cap = (x) => x[0].toUpperCase() + x.slice(1);
// a take as the navigator names it: "Take 2", or what made the version ("Night version", "Continued from frame 106")
export function label(t) {
  if (!t) return "a take that isn't here";
  const p = t.parent;
  if (!p) return `Take ${t.number}`;
  if (p.method === "continue") return `Continued from frame ${p.frame}`;
  if (p.method === "retake") return `Retake · ${p.options?.world === "latest" ? "today's world" : "as it was"}`; // SNAP-R61
  if (p.options?.rerun) return `${p.method.startsWith("recast/") ? "Recast" : "Changed"} · ${p.options.rerun.text} (take ${T.get(p.take)?.number ?? "?"}'s motion)`; // SNAP-R63 Reuse the motion
  if (p.method.startsWith("view/")) return `New view · ${p.options?.label ?? "from context pictures"}`; // U101
  if (p.method.startsWith("rerun/")) { const s = Object.values(p.options?.swaps ?? {}).filter((x) => !x.kept).map((x) => x.text); return `Re-run · ${s.length ? s.join(", ") : "as it was"}`; } // SNAP-R63
  return `${cap(T.versionOf(p.options) ?? p.method.split("/").pop())} version`;
}

// the label as a narrow tile shows it; agents get label() whole (F-D04, SNAP-R58)
export const shortLabel = (t) => { const s = label(t); return s.length > 60 ? `${s.slice(0, 58).trimEnd()}…` : s; };

// ---- where the open tab is -----------------------------------------------------------------------------------------
// the scene and shot the open tab shows (the mark Snap puts in its workflow), or null for scratch work
export function current() {
  const m = app.graph?.extra?.snap_scene, s = m && get(m.scene), shot = s?.shots.find((x) => x.id === m.shot);
  return shot ? { scene: s, shot } : null;
}

// the open shot's graph into its scene: its workflow file, and its graph id among the shot's workflows
export async function saveOpen() {
  const here = current();
  if (!here) return null;
  const graph = app.graph.serialize(), file = here.shot.workflow ?? workflowFile(here.scene.id, here.shot.id);
  // UI-09 (B3, SNAP-R122): browsing never writes: a shot whose graph is its file's (nodes sized aside) and whose graph id
  // the scene lists is not written again, so opening another person's scene leaves its files as they were
  if (here.shot.workflow && here.shot.groups.includes(graph.id)) {
    const saved = await read(file);
    if (saved && app.extensionManager.workflow.activeWorkflow.changeTracker.constructor.graphEqual(comparable(saved), comparable(graph))) return file;
  }
  await api.storeUserData(file, graph);
  await update(here.scene.id, (s) => {
    const shot = s.shots.find((x) => x.id === here.shot.id);
    if (!shot) return;
    shot.workflow = file;
    if (!shot.groups.includes(graph.id)) shot.groups.push(graph.id);
  });
  return file;
}

async function newTab() {
  const tabs = app.extensionManager.workflow, was = tabs.activeWorkflow;
  await app.extensionManager.command.execute("Comfy.NewBlankWorkflow");
  while (tabs.activeWorkflow === was || app.graph.nodes.length) await new Promise((r) => setTimeout(r, 30));
}
// another open tab, stepped to the shorter way round as Ctrl+Tab does (the frontend's own switch loads each tab)
async function switchTo(w) {
  const tabs = app.extensionManager.workflow, n = tabs.openWorkflows.length, ahead = (tabs.openWorkflows.indexOf(w) - tabs.openWorkflows.indexOf(tabs.activeWorkflow) + n) % n;
  const step = ahead <= n - ahead ? "Workspace.NextOpenedWorkflow" : "Workspace.PreviousOpenedWorkflow";
  for (let i = Math.min(ahead, n - ahead); i > 0 && tabs.activeWorkflow !== w; i--) await app.extensionManager.command.execute(step);
}
// a scene tab reads "<scene> · <shot>"; a re-take's own tab of the shot reads "From take 2 · <scene> · <shot>" (the take
// first, so a narrow tab still tells the two apart; numbered when that is open already). Only a tab never saved as a
// file is renamed, which writes nothing
async function retitle(scene, shot, from = null) {
  const tabs = app.extensionManager.workflow, tab = tabs.activeWorkflow;
  const path = (i) => `workflows/${`${from ? `From ${from}${i > 1 ? ` (${i})` : ""} · ` : ""}${scene.name} · ${shotTitle(scene, shot)}`.replace(/[\\/:*?"<>|]+/g, "-")}.json`;
  let i = 1;
  while (from && tabs.getWorkflowByPath(path(i))) i++;
  const file = path(i);
  if (tab?.isTemporary && tab.path !== file && !tabs.getWorkflowByPath(file)) await tabs.renameWorkflow(tab, file);
}

// show a shot. The open shot is saved first. A tab that shows the shot already is gone to (its edits may be newer than
// the shot's file); from a scratch tab, so is this scene's tab. That tab, or the open one when it is a scene tab or an
// empty one never saved as a file, then shows the shot; else a new tab does. A shot with no workflow yet starts from
// the open shot's recipe when that shot is in the same scene (a copy with its own id, so its takes are its own), else
// from the recommended recipe; its shot card is compiled in, and it is saved at once
export async function openShot(sceneId, shotId) {
  await Promise.all([load(), T.load()]);
  const scene = need(sceneId), shot = shotOf(scene, shotId), tabs = app.extensionManager.workflow;
  const usable = () => !!tabs.activeWorkflow?.isTemporary && (!!current() || !app.graph.nodes.length);
  let switched = false;
  if (current()?.shot.id !== shot.id) {
    if (current()) await saveOpen();
    const others = tabs.openWorkflows.filter((w) => w !== tabs.activeWorkflow && w.activeState?.extra?.snap_scene?.scene === scene.id);
    const there = others.find((w) => w.activeState.extra.snap_scene.shot === shot.id) ?? (usable() ? null : others.find((w) => w.isTemporary));
    if (there) { await switchTo(there); switched = tabs.activeWorkflow === there; }
  }
  const here = current(), title = shotTitle(scene, shot);
  if (here?.scene.id === scene.id && here.shot.id === shot.id) return { scene: scene.id, shot: shot.id, tab: switched ? "switched" : "same", said: `${title} ${switched ? "is open in its own tab" : "is open"}` };
  const inPlace = usable();
  if (here && switched) await saveOpen();
  let graph = shot.workflow ? await read(shot.workflow) : null, built = "its saved workflow";
  if (shot.workflow && !graph) throw new Error(`${title}'s workflow ${shot.workflow} is gone`);
  const copy = shot.start === "copy";
  if (!graph && here?.scene.id === scene.id) {
    graph = app.graph.serialize();
    graph.id = crypto.randomUUID();
    delete graph.extra?.snap?.notes; // notes were about that shot
    built = copy ? `a copy of ${shotTitle(scene, here.shot)}'s recipe as it is` : `${shotTitle(scene, here.shot)}'s setup`;
  }
  if (!inPlace) await newTab();
  const mark = { scene: scene.id, shot: shot.id };
  await app.loadGraphData({ ...(graph ?? { id: crypto.randomUUID(), revision: 0, last_node_id: 0, last_link_id: 0, nodes: [], links: [], groups: [], config: {}, version: 0.4 }),
    extra: { ...graph?.extra, snap_scene: mark } }, true, true, tabs.activeWorkflow);
  let card = null;
  if (!shot.workflow) {
    if (!graph) { await E.simple(); built = "the recommended recipe"; }
    // F-C31, F-D12 (SNAP-R120): a new shot takes the open shot's setup and none of its content, unless it was added as
    // a copy ("Copy Shot n as it is", add_shot start: copy); before its shot card compiles in, so the card's words stay
    if (graph && !copy && built.endsWith("'s setup")) built += await cleanCopy();
    if (shot.card) {
      await L.ready();
      const c = L.get(shot.card);
      try { card = c ? await L.apply(c) : `its shot card ${shot.card} isn't in the Library`; } catch (e) { card = e.message; }
    }

    await saveOpen();
  }
  await retitle(get(scene.id), get(scene.id).shots.find((x) => x.id === shot.id));
  const where = inPlace ? (switched ? " in the scene's tab" : "") : " in a new tab (the open one is scratch work, left as it was)";
  // F-G09: a shot built now says when its recipe upscales every take (the recommended recipe has Upscale on), so a walk or
  // a draft that doesn't want it can switch it off before the first run
  const upscale = !shot.workflow && E.state().bricks.some((b) => b.key === "upscale") && S.on("upscale") ? 'Upscale is on: every take is upscaled after it renders (set_method {slot: "upscale", method: "off"} for a walkthrough, a plate or a draft)' : null;
  return { scene: scene.id, shot: shot.id, tab: inPlace ? (switched ? "scene tab" : "same") : "new", built, ...(card ? { card } : {}), ...(upscale ? { upscale } : {}),
    said: `${title} of ${scene.name}${where}${shot.workflow ? "" : `: ${built}`}${card ? ` · ${card}` : ""}${upscale ? ` · ${upscale}` : ""}` };
}

// F-D12 / UI-02 (SNAP-R120): what a new shot keeps of the open shot it was made from is the setup (models, Render Preset,
// core and turbo LoRAs, sampling, size, Upscale, Save); its Casts, locations and sets (pins and pieces), References,
// First frame, dials, style and Cast LoRA rows and the prompt go. Returns what was left out, for the answer and toast
async function cleanCopy() {
  const has = (key) => E.state().bricks.some((b) => b.key === key), names = [], gone = [];
  for (const [ref, p] of Object.entries(E.state().world ?? {})) if (/^(cast|location|set_snapshot):/.test(ref)) { await L.removePin(ref); names.push(p.name ?? ref); }
  const refs = E.state().bricks.find((b) => b.key === "refs"), pics = refs?.pictures?.length ?? 0, sounds = refs?.audios?.length ?? 0;
  E.batch(() => {
    for (const p of [...(refs?.pictures ?? [])]) E.removePicture(p.node);
    for (const a of [...(refs?.audios ?? [])]) E.removeAudio(a.node);
    for (const key of ["style", "cast"]) if (has(key)) for (let i = M.rows(key).length - 1; i >= 0; i--) { M.removeRow(key, i); gone.push(`${key === "cast" ? "Cast" : "style"} LoRA row`); }
    if (has("rack")) for (const r of D.rows()) { D.remove(r.dial); gone.push("dial"); }
    if (has("first_frame") && S.on("first_frame")) { S.setOn("first_frame", false); E.remember("first_frame", "from", null); gone.push("first frame"); }
    for (const [key, node] of [["render", "render"], ["image", "image"]]) if (has(key) && E.getValue(key, node, "prompt")) { E.setValue(key, node, "prompt", ""); gone.push("prompt"); }
  });
  if (pics) gone.unshift(`${pics} reference picture${pics === 1 ? "" : "s"}`);
  if (sounds) gone.unshift(`${sounds} audio reference${sounds === 1 ? "" : "s"}`);
  const counted = [...new Set(gone)].map((g) => { const n = gone.filter((x) => x === g).length; return n > 1 && !/^\d/.test(g) ? `${n} ${g}s` : g; });
  return `${names.length ? `, without ${names.join(", ")} (apply_cast / apply_location what this shot uses)` : ""}; left out: ${counted.length ? counted.join(", ") : "nothing else was there"} (the prompt starts empty; "Copy as it is" keeps everything)`;
}

// a shot's tab and its saved file are compared as JSON (as the file holds it), without the shot mark or node sizes:
// drawing the graph resizes nodes, which the frontend's own undo comparison also allows for
function comparable(graph) {
  const g = JSON.parse(JSON.stringify(graph));
  delete g.extra?.snap_scene;
  // a dynamic combo's sockets (Save Video's format / format.codec) come back in another order after a load: compared by name
  for (const n of [...g.nodes, ...(g.definitions?.subgraphs ?? []).flatMap((s) => s.nodes ?? [])]) { n.size = [0, 0]; if (Array.isArray(n.inputs)) n.inputs = [...n.inputs].sort((a, b) => String(a.name).localeCompare(String(b.name))); }
  return g;
}
// a graph (a take's, for a re-take or re-run) as the shot's workflow. It replaces the shot's tab only while that tab
// holds the shot's saved workflow (the load is an Undo step there); a tab with unsaved changes is left as it is and the
// graph opens in a new tab of the same shot (SNAP-R5), so runs from it still land under the shot. Saved either way
export async function loadIntoShot(sceneId, shotId, graph, from) {
  await openShot(sceneId, shotId);
  const tabs = app.extensionManager.workflow, here = current(), saved = await read(here.shot.workflow);
  const clean = !!saved && tabs.activeWorkflow.changeTracker.constructor.graphEqual(comparable(saved), comparable(app.graph.serialize()));
  if (!clean) await newTab();
  // F-F21: a take's graph carries its own shot's graph id, which is the group its takes land in: a graph from another
  // shot takes this shot's (its saved workflow's id, or a new one this shot lists), so a take re-made here lands here
  const id = here.shot.groups.includes(graph.id) ? graph.id : clean && saved.id ? saved.id : crypto.randomUUID();
  if (!here.shot.groups.includes(id)) await addGroup(sceneId, shotId, id);
  await app.loadGraphData({ ...structuredClone(graph), id, extra: { ...structuredClone(graph.extra ?? {}), snap_scene: { scene: sceneId, shot: shotId } } }, true, true, tabs.activeWorkflow);
  if (!clean) await retitle(here.scene, here.shot, from);
  await saveOpen();
  return `${shotTitle(here.scene, here.shot)} of ${here.scene.name}${clean ? "" : ` in a new tab (the shot's tab has unsaved changes, left as they are)`}`;
}

// ---- the document --------------------------------------------------------------------------------------------------
export async function create({ name, set = null, by = "person" }) {
  if (!name?.trim()) throw new Error("A scene needs a name");
  if (set) { await L.ready(); if (L.get(set)?.kind !== "set_snapshot") throw new Error(`No set snapshot card ${set}`); }
  await load();
  const s = { id: `scene-${stamp()}`, version: 1, name: name.trim(), set, by, created: Date.now(), updated: Date.now(), shots: [] };
  await versioned(s, by, "created");
  await api.storeUserData(fileOf(s.id), s);
  scenes = [...scenes, s];
  changed();
  return s;
}

// the take a shot starts on: the person's top-ranked, else the newest kept, else the newest that rendered (no version)
async function first(list, group) {
  const ok = list.filter((t) => t.status === "success");
  return (await T.ranking(group)).map(T.get).find((t) => t && list.includes(t)) ?? ok.findLast((t) => t.verdict === "keep") ?? ok.findLast((t) => !t.parent) ?? null;
}

// a new shot at `at` (the end by default): empty, from a shot card, or adopting a workflow and its takes. adopt "open"
// is the open workflow: it is copied and the copy opens as the shot in its own tab, the open tab left as it was (same
// graph id, so runs from either join the shot). adopt <group id> is a take group: its newest take's workflow is the
// copy. Either way the takes keep their store; the shot lists them (versions under the take they came from) and starts
// on first() above
export async function addShot(sceneId, { name, card = null, adopt = null, at, start = "clean", from = null, by = "person" } = {}) {
  if (!["clean", "copy"].includes(start)) throw new Error(`start is "clean" (the open shot's setup, nothing else; the default) or "copy" (the open shot's recipe as it is); not ${JSON.stringify(start)}`);
  await Promise.all([load(), T.load()]);
  const scene = need(sceneId), here = current();
  if (card) { await L.ready(); if (L.get(card)?.kind !== "shot") throw new Error(`No shot card ${card}`); }
  if (adopt === "open" && here) throw new Error(`This workflow is already ${shotTitle(here.scene, here.shot)} of ${here.scene.name}`);
  const shot = { id: `shot-${stamp()}`, name: ownName(name) || (card ? L.get(card).title.replace(/^Shot \d+:\s*/, "") : ""), card, workflow: null, groups: [], takes: [], active: null, by, created: Date.now(), ...(start === "copy" ? { start } : {}) };
  const tab = app.extensionManager.workflow.activeWorkflow;
  if (adopt) {
    const group = adopt === "open" ? app.graph.id : adopt, list = T.all().filter((t) => t.group === group).sort((a, b) => a.created - b.created);
    if (adopt !== "open" && !list.length) throw new Error(`No takes in the group ${adopt}`);
    const graph = adopt === "open" ? app.graph.serialize() : structuredClone(list.findLast((t) => t.graph)?.graph ?? null);
    Object.assign(shot, { groups: [group], takes: list.map(entry), active: (await first(list, group))?.id ?? null, active_by: by, adopted_from: adopt === "open" ? (tab?.isPersisted ? tab.path : tab?.filename ?? "the open workflow") : `take group ${group}` });
    if (!shot.name && adopt === "open" && tab?.isPersisted) shot.name = tab.filename;
    if (graph) {
      shot.workflow = workflowFile(scene.id, shot.id);
      delete graph.extra?.snap_scene;
      await api.storeUserData(shot.workflow, graph);
    }
  }
  // F-F22: a copy is made now, into any scene: of the open recipe (start: copy) or of a named shot's workflow (from),
  // with a graph id of its own, so its runs land in the new shot and the source shot stays as it was
  if (!adopt && (from || (start === "copy" && here?.scene.id !== scene.id))) {
    let graph = app.graph.serialize(), what = here ? shotTitle(here.scene, here.shot) : "the open workflow";
    if (from) { const s = need(from.scene), x = shotOf(s, from.shot); graph = x.workflow ? await read(x.workflow) : null; what = `${shotTitle(s, x)} of ${s.name}`; if (!graph) throw new Error(`${what} has no workflow yet (open_shot opens it once)`); }
    graph = structuredClone(graph); graph.id = crypto.randomUUID();
    delete graph.extra?.snap_scene; delete graph.extra?.snap?.notes; // notes were about that shot
    delete graph.extra?.snap?.story; // F-L10 (SNAP-R166): the story pin names the unit it was compiled for; a copy isn't that cut (apply_unit {land} pins one here)
    Object.assign(shot, { workflow: workflowFile(scene.id, shot.id), groups: [graph.id], copied_from: what });
    delete shot.start;
    await api.storeUserData(shot.workflow, graph);
  }
  await update(scene.id, (s) => s.shots.splice(at == null ? s.shots.length : Math.max(0, Math.min(at, s.shots.length)), 0, shot), { by, note: `added ${shot.name || "a shot"}` });
  const opened = adopt === "open" ? await openShot(scene.id, shot.id) : null;
  return { scene: scene.id, shot: describeShot(get(scene.id), get(scene.id).shots.find((x) => x.id === shot.id)), ...(opened ? { opened: opened.said } : {}) };
}

// ---- rename and remove: nothing a scene owns is deleted -------------------------------------------------------------
// the open tab's title follows ("<scene> · Shot n · name")
export async function retitleOpen(from = null) { const here = current(); if (here) await retitle(here.scene, here.shot, from); }
export async function renameScene(id, name) {
  await load();
  need(id);
  if (!name?.trim()) throw new Error("A scene needs a name");
  await update(id, (s) => { s.name = name.trim(); }, { note: "renamed" });
  await retitleOpen();
  return { scene: id, name: get(id).name };
}
export async function renameShot(sceneId, shotId, name) {
  await load();
  shotOf(need(sceneId), shotId);
  await update(sceneId, (s) => { s.shots.find((x) => x.id === shotId).name = ownName(name); }, { note: "shot renamed" });
  await retitleOpen();
  const scene = get(sceneId);
  return { scene: sceneId, shot: shotId, title: shotTitle(scene, scene.shots.find((x) => x.id === shotId)) };
}
// a shot leaves the scene's order; it stays in the scene file under `removed` with its takes listed, its workflow file
// and its takes stay where they are. A tab that shows it becomes scratch work
export async function removeShot(sceneId, shotId, by = "person") {
  await Promise.all([load(), T.load()]);
  const scene = need(sceneId), shot = shotOf(scene, shotId), title = shotTitle(scene, shot), n = takesOf(shot).length, open = current()?.shot.id === shotId;
  await update(sceneId, (s) => {
    const [x] = s.shots.splice(s.shots.findIndex((y) => y.id === shotId), 1);
    s.removed = [...(s.removed ?? []), { ...x, takes: takesOf(x), removed: { by, at: new Date().toISOString() } }];
  }, { by, note: `took out ${title}` });
  await retitleOpen();
  return { scene: sceneId, removed: shotId, said: `${title} left ${scene.name}: ${[n ? `its ${n} take${n === 1 ? "" : "s"}` : null, shot.workflow ? "its workflow" : null].filter(Boolean).join(" and ") || "the shot"} ${n > 1 || (n && shot.workflow) ? "are" : "is"} kept, listed under "removed" in the scene's file${open ? " · this tab is scratch work now" : ""}` };
}
// deleting a scene parks its document (snap/scenes/_parked/<id>.json, marked who parked it and when): its shots'
// workflows (snap/scenes/<id>/) and its takes stay where they are; moving the file back restores it. Tabs that show
// its shots become scratch work
export async function removeScene(id, by = "person") {
  await Promise.all([load(), T.load()]);
  const scene = need(id), takes = scene.shots.reduce((n, x) => n + takesOf(x).length, 0);
  await update(id, (s) => { s.parked = { by, at: new Date().toISOString() }; });
  const r = await api.moveUserData(fileOf(id), parkedFile(id), { overwrite: false });
  if (r.status !== 200) throw new Error(`${scene.name} couldn't be parked (${r.status} ${await r.text()})`);
  scenes = scenes.filter((x) => x.id !== id);
  changed();
  const withdrawn = await P.withdraw((p) => p.args?.scene === id, "scene deleted");
  return { scene: id, parked: parkedFile(id), withdrawn, said: `${scene.name} deleted: its document is parked in your user folder (${parkedFile(id)}); its ${scene.shots.length} shot workflow${scene.shots.length === 1 ? "" : "s"} and ${takes} take${takes === 1 ? "" : "s"} are kept${withdrawn ? ` · ${withdrawn} agent proposal${withdrawn === 1 ? "" : "s"} about it withdrawn` : ""}` };
}

export async function moveShot(sceneId, shotId, to) {
  await load();
  shotOf(need(sceneId), shotId);
  await update(sceneId, (s) => {
    const i = s.shots.findIndex((x) => x.id === shotId), [shot] = s.shots.splice(i, 1);
    s.shots.splice(Math.max(0, Math.min(to, s.shots.length)), 0, shot);
  }, { note: "shots reordered" });
  return { scene: sceneId, order: get(sceneId).shots.map((x) => x.id) };
}

// the take that stands for the shot (the one a cut would use); any take of the shot, a version too
export async function setActive(sceneId, shotId, takeId, by = "person") {
  await Promise.all([load(), T.load()]);
  if (takeId != null) takeId = T.find(takeId)?.id ?? takeId; // F-G02: a unique start of the id, as every take tool takes
  const shot = shotOf(need(sceneId), shotId);
  // SNAP-R213: a take of another shot (a Book cut reusing an earlier take) joins this one, saying where it came from;
  // the take itself (its group, provenance and pins) is unchanged. null: no active take (an Undo back to none)
  let from = null;
  if (takeId != null && !takesOf(shot).some((e) => e.take === takeId)) {
    const t = T.get(takeId);
    if (!t) throw new Error(`No take ${takeId} (list_takes lists them)`);
    const home = scenes.flatMap((s) => s.shots.map((x) => ({ s, x }))).find(({ s, x }) => !(s.id === sceneId && x.id === shotId) && takesOf(x).some((e) => e.take === takeId));
    from = home ? { scene: home.s.id, shot: home.x.id, name: `${home.s.name} › ${shotTitle(home.s, home.x)}` } : { name: "no shot (a take of its own)" };
  }
  await update(sceneId, (s) => { const x = s.shots.find((y) => y.id === shotId); x.takes = [...takesOf(x), ...(from ? [{ ...entry(T.get(takeId)), from }] : [])]; x.active = takeId; x.active_by = by; });
  const scene = get(sceneId), now = scene.shots.find((x) => x.id === shotId);
  return { scene: sceneId, shot: shotId, active: takeId, by, ...(from ? { brought_from: from.name } : {}), path: [scene.name, shotTitle(scene, now), ...(takeId ? path(now, takeId).map((id) => label(T.get(id))) : [])] };
}

// SNAP-R67: a scene of a Book, and a shot's unit (its cut number, beats, Cast, place, timing, board, trim: book.js)
export const setBook = (sceneId, book, by = "person") => update(sceneId, (s) => { s.book = book; }, { by, note: "joined a Book" });
export const setUnit = (sceneId, shotId, unit, by = "person", note = "unit changed") => update(sceneId, (s) => { const x = s.shots.find((y) => y.id === shotId); if (!x) throw new Error(`${s.name} has no shot ${shotId}`); x.unit = unit; }, { by, note });
// a take group joins a shot, so its takes are the shot's (U101: a new view lands in a shot whose workflow never ran)
export const addGroup = (sceneId, shotId, group) => update(sceneId, (s) => { const x = s.shots.find((y) => y.id === shotId); if (x && !x.groups.includes(group)) x.groups.push(group); });

// takes that joined a shot since its file was written are listed in it too (a run in its workflow, an edit of its take)
let syncing = 0;
T.onChange(() => { clearTimeout(syncing); syncing = setTimeout(sync, 400); });
async function sync() {
  for (const s of scenes) if (s.shots.some((x) => takesOf(x).length > x.takes.length)) await update(s.id, (d) => { for (const x of d.shots) x.takes = takesOf(x); }).catch(() => {});
}

// ---- what agents read ----------------------------------------------------------------------------------------------
function takeInfo(e, active) {
  const t = T.get(e.take);
  return { take: e.take, label: label(t), ...(t ? { number: t.number, status: t.status, verdict: t.verdict, media: t.media[0]?.filename ?? null } : { missing: true }),
    ...(t && T.locked(t) ? { private: true } : {}), ...(e.take === active ? { active: true } : {}), versions: e.children.map((c) => takeInfo(c, active)) };
}
export function describeShot(scene, shot) {
  return { id: shot.id, number: scene.shots.indexOf(shot) + 1, title: shotTitle(scene, shot), card: shot.card, workflow: shot.workflow, groups: shot.groups,
    active: shot.active, active_path: shot.active ? path(shot, shot.active).map((id) => label(T.get(id))) : [], ...(shot.adopted_from ? { adopted_from: shot.adopted_from } : {}),
    takes: tree(shot).map((e) => takeInfo(e, shot.active)) };
}
export function describe(scene) {
  const here = current();
  return { id: scene.id, name: scene.name, set: scene.set, ...(scene.set ? { set_title: L.get(scene.set)?.title ?? null } : {}), open: here?.scene.id === scene.id ? here.shot.id : null,
    shots: scene.shots.map((x) => describeShot(scene, x)) };
}
export const summary = (s) => ({ id: s.id, name: s.name, set: s.set, shots: s.shots.length, takes: s.shots.reduce((n, x) => n + takesOf(x).length, 0), open: current()?.scene.id === s.id });
