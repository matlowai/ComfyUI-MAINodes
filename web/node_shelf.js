// Node Shelf (2026-11-12): choose which nodes ComfyUI offers, by pack and by node. A hidden node leaves the search box
// (double click), the node library, the right-click Add Node menu and Snap's palette; it stays installed, so a workflow
// that uses it still loads and runs. Nothing here touches the server.
//
// How: ComfyUI's interface keeps a list of node filters (it hides deprecated and experimental nodes with it, since
// about mid 2025) and builds search and the library from what passes. This registers one more filter. The store is
// reached through app.extensionManager (the workspace store), which is not a documented door: when it or the filter
// list is missing the dialog says so and nothing is hidden.
//
// This one file is the whole feature. It ships in ComfyUI-MAINodes and by itself as matlowai/comfyui-node-shelf: keep
// the two copies identical. Whichever loads first registers; a second copy finds globalThis.NodeShelf and does nothing,
// so there is one filter, one command and one setting however many copies are installed.
//
// What is kept (ComfyUI setting NodeShelf.Hidden, with the person's other settings): per pack {hidden, except}.
// `hidden` is the pack's rule, `except` the node names that go against it. A node a pack adds later follows the rule:
// hide a whole pack and its new nodes are hidden too; hide three nodes of a pack and its new nodes show.
import { app } from "../../scripts/app.js";

const SETTING = "NodeShelf.Hidden", FILTER = "nodeshelf.hidden", COMMAND = "NodeShelf.Open", MAX_ROWS = 300;
const BUILT_IN = { core: "ComfyUI built-in nodes", api: "ComfyUI API nodes (paid services)", blueprint: "Blueprints", frontend: "ComfyUI interface nodes (notes, reroutes…)" };

// ---- the rule ---------------------------------------------------------------------------------------------------
export function packOf(def) {
  const m = def.python_module ?? "";
  if (m.startsWith("custom_nodes.")) return m.split(".")[1];
  if (m === "nodes" || m.startsWith("comfy_extras")) return "core";
  if (m.startsWith("comfy_api_nodes")) return "api";
  if (m === "blueprint") return "blueprint";
  return m === "frontend_only" || !m ? "frontend" : m.split(".")[0];
}
export const packTitle = (id) => BUILT_IN[id] ?? id;
// rules: {pack: {hidden: bool, except: [names]}}
export const hiddenBy = (rules, pack, name) => { const r = rules[pack]; return r ? !!r.hidden !== r.except.includes(name) : false; };
// the same rules after one node is flipped; a rule every node goes against is turned over, an empty one dropped
export function flipNode(rules, pack, name, names) {
  const r = rules[pack] ?? { hidden: false, except: [] };
  let except = r.except.includes(name) ? r.except.filter((x) => x !== name) : [...r.except, name], hidden = !!r.hidden;
  except = except.filter((x) => names.includes(x)); // a name the pack no longer has is forgotten
  if (names.length && names.every((x) => except.includes(x))) { hidden = !hidden; except = []; }
  return setPack(rules, pack, hidden, except);
}
export function setPack(rules, pack, hidden, except = []) {
  const next = { ...rules };
  if (!hidden && !except.length) delete next[pack]; else next[pack] = { hidden, except };
  return next;
}

// ---- ComfyUI's side ---------------------------------------------------------------------------------------------
let rules = {};
const store = () => { try { return (app.extensionManager?._p ?? document.querySelector("#vue-app")?.__vue_app__?.config?.globalProperties?.$pinia)?._s?.get("nodeDef") ?? null; } catch { return null; } };
export const supported = () => typeof store()?.registerNodeDefFilter === "function" && typeof store()?.unregisterNodeDefFilter === "function";
// by node type, for the right-click menu and Snap's palette (they know only the type)
const isHiddenType = (type) => { const d = globalThis.LiteGraph?.registered_node_types?.[type]?.nodeData; return d && Object.keys(rules).length ? hiddenBy(rules, packOf(d), type) : false; };
function apply() {
  const s = store();
  if (!supported()) return false;
  s.unregisterNodeDefFilter(FILTER); // the list is replaced, so search and the library are rebuilt
  if (Object.keys(rules).length) s.registerNodeDefFilter({ id: FILTER, name: "Node Shelf", description: "Nodes and packs put on the Node Shelf", predicate: (d) => !hiddenBy(rules, packOf(d), d.name) });
  return true;
}
const read = () => { const v = app.extensionManager?.setting?.get(SETTING); return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, r]) => r && Array.isArray(r.except)).map(([k, r]) => [k, { hidden: !!r.hidden, except: r.except.map(String) }])) : {}; };
async function commit(next) { rules = next; apply(); await app.extensionManager.setting.set(SETTING, rules); }
// the old right-click Add Node menu reads LiteGraph's own lists: the same rule, wrapped once
function wrapLiteGraph() {
  const LG = globalThis.LiteGraph;
  if (!LG || LG.__nodeShelf || typeof LG.getNodeTypesInCategory !== "function") return;
  const inCat = LG.getNodeTypesInCategory, cats = LG.getNodeTypesCategories;
  LG.getNodeTypesInCategory = function (...a) { return inCat.apply(this, a).filter((t) => !isHiddenType(t.type)); };
  if (typeof cats === "function") LG.getNodeTypesCategories = function (...a) {
    const all = cats.apply(this, a);
    if (!Object.keys(rules).length) return all;
    const live = new Set(Object.values(this.registered_node_types).filter((t) => !isHiddenType(t.type)).map((t) => t.category ?? ""));
    return all.filter((c) => c === "" || [...live].some((x) => x === c || x.startsWith(`${c}/`)));
  };
  LG.__nodeShelf = true;
}

// ---- the dialog -------------------------------------------------------------------------------------------------
const CSS = `
dialog.mns{width:min(880px,calc(100vw - 32px));height:min(760px,calc(100vh - 32px));padding:0;border:1px solid var(--border-color,#4e4e4e);border-radius:10px;background:var(--comfy-menu-bg,#171718);color:var(--fg-color,#fff);font:14px/1.45 system-ui,sans-serif;display:none;flex-direction:column}
dialog.mns[open]{display:flex}dialog.mns::backdrop{background:rgba(0,0,0,.55)}
.mns header{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 10px}.mns h2{margin:0;font-size:18px;font-weight:600}.mns header p{margin:4px 0 0;color:var(--descrip-text,#a0a0a0)}
.mns .mns-x{margin-left:auto;min-width:36px;min-height:36px;font-size:20px;line-height:1}
.mns button,.mns select,.mns input[type=search]{font:inherit;color:inherit;background:var(--comfy-input-bg,#222);border:1px solid var(--border-color,#4e4e4e);border-radius:6px;padding:6px 10px;min-height:32px}
.mns button{cursor:pointer}.mns button:hover:not(:disabled){filter:brightness(1.25)}.mns button:disabled{opacity:.5;cursor:default}
.mns :focus-visible{outline:2px solid #6ea8fe;outline-offset:2px}
.mns .mns-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:4px 18px 10px}.mns .mns-tools input[type=search]{flex:1 1 240px}
.mns fieldset{border:0;margin:0;padding:0;display:flex;align-items:center;gap:4px}.mns legend{float:left;margin-right:6px;color:var(--descrip-text,#a0a0a0)}
.mns .mns-seg label{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border:1px solid var(--border-color,#4e4e4e);border-radius:6px;cursor:pointer}.mns .mns-seg label:has(input:focus-visible){outline:2px solid #6ea8fe;outline-offset:2px}.mns .mns-seg label:has(input:checked){background:var(--comfy-input-bg,#222);border-color:var(--fg-color,#fff)}
.mns .mns-sum{display:flex;align-items:center;gap:12px;padding:8px 18px;border-block:1px solid var(--border-color,#4e4e4e)}.mns .mns-sum p{margin:0;flex:1}
.mns .mns-body{flex:1;overflow:auto;padding:4px 10px 14px}.mns h3{margin:14px 8px 4px;font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;color:var(--descrip-text,#a0a0a0)}
.mns ul{list-style:none;margin:0;padding:0}.mns .mns-pack>div{display:flex;align-items:center;gap:8px;padding:3px 8px;border-radius:6px}.mns .mns-pack>div:hover,.mns .mns-node:hover{background:rgba(127,127,127,.14)}
.mns .mns-tw{min-width:32px;padding:4px;border-color:transparent;background:none}.mns .mns-tw span{display:inline-block;transition:transform .12s}.mns .mns-tw[aria-expanded=true] span{transform:rotate(90deg)}
.mns label.mns-name{display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer;padding:4px 0}.mns input[type=checkbox],.mns input[type=radio]{width:18px;height:18px;margin:0;flex:none;accent-color:#6ea8fe}
.mns .mns-name b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mns .mns-count{color:var(--descrip-text,#a0a0a0);white-space:nowrap}.mns .mns-off b,.mns .mns-off .mns-title{color:var(--descrip-text,#a0a0a0);font-weight:400}
.mns .mns-nodes{margin:0 0 6px 48px}.mns .mns-node{display:flex;align-items:center;gap:8px;padding:2px 8px;border-radius:6px}.mns .mns-node label{display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer;padding:3px 0}
.mns .mns-title{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.mns .mns-sub{color:var(--descrip-text,#a0a0a0);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.mns .mns-tag{font-size:11px;border:1px solid var(--border-color,#4e4e4e);border-radius:999px;padding:1px 8px;white-space:nowrap}.mns .mns-note{margin:2px 8px 6px;color:var(--descrip-text,#a0a0a0);font-size:12px}.mns .mns-empty{padding:28px 18px;color:var(--descrip-text,#a0a0a0)}
.mns .mns-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media (prefers-reduced-motion:reduce){.mns .mns-tw span{transition:none}}`;
const h = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); for (const [k, v] of Object.entries(props.attrs ?? {})) e.setAttribute(k, v); e.append(...kids.flat().filter((k) => k != null)); return e; };
const n = (x) => x.toLocaleString();
const plural = (c, word) => `${n(c)} ${word}${c === 1 ? "" : "s"}`;

let dialog = null;
function open() {
  if (dialog?.open) return dialog;
  if (!document.getElementById("mns-css")) document.head.append(h("style", { id: "mns-css", textContent: CSS }));
  dialog?.remove();
  const ok = supported(), s = store();
  // what ComfyUI would offer without this filter (its own deprecated/experimental filters still apply)
  const others = ok ? s.nodeDefFilters.filter((f) => f.id !== FILTER) : [];
  const defs = ok ? s.nodeDefs.filter((d) => others.every((f) => f.predicate(d))) : [];
  const packs = new Map();
  for (const d of defs) { const id = packOf(d); if (!packs.has(id)) packs.set(id, { id, title: packTitle(id), builtIn: id in BUILT_IN, nodes: [] }); packs.get(id).nodes.push({ name: d.name, title: d.display_name || d.name, category: d.category || "" }); }
  for (const p of packs.values()) p.nodes.sort((a, b) => a.title.localeCompare(b.title));
  const used = new Set((app.graph?.nodes ?? []).map((x) => x.type));
  const view = { q: "", show: "all", sort: "name", open: new Set() };
  const shownIn = (p) => p.nodes.filter((x) => !hiddenBy(rules, p.id, x.name)).length;

  const status = h("p", { attrs: { role: "status", "aria-live": "polite" } });
  const reset = h("button", { type: "button", textContent: "Show everything", onclick: () => change({}, "Every node is shown again.") });
  const body = h("div", { className: "mns-body", attrs: { tabindex: "-1" } });
  const search = h("input", { type: "search", placeholder: "Search packs and nodes", attrs: { "aria-label": "Search packs and nodes" }, oninput: () => { view.q = search.value.trim().toLowerCase(); draw(); } });
  const seg = (name, legend, opts) => h("fieldset", { className: "mns-seg" }, h("legend", { textContent: legend }), opts.map(([value, text]) => h("label", {}, h("input", { type: "radio", name, value, checked: view[name] === value, className: "mns-sr", onchange: () => { view[name] = value; draw(); } }), text)));
  const sort = h("select", { attrs: { "aria-label": "Sort packs by" }, onchange: () => { view.sort = sort.value; draw(); } }, h("option", { value: "name", textContent: "Sort: name" }), h("option", { value: "size", textContent: "Sort: most nodes" }), h("option", { value: "hidden", textContent: "Sort: most hidden" }));

  async function change(next, said, keepFocus) {
    await commit(next);
    draw(keepFocus);
    status.textContent = `${said} ${summary()}`;
  }
  const summary = () => { const total = defs.length, hid = defs.filter((d) => hiddenBy(rules, packOf(d), d.name)).length; return hid ? `${n(hid)} of ${plural(total, "node")} hidden, in ${plural([...packs.values()].filter((p) => shownIn(p) < p.nodes.length).length, "pack")}.` : `All ${plural(total, "node")} from ${plural(packs.size, "pack")} are shown.`; };

  function nodeRow(p, x) {
    const hid = hiddenBy(rules, p.id, x.name), id = `mns-n-${p.id}-${x.name}`.replace(/[^\w-]/g, "_");
    return h("li", { className: `mns-node${hid ? " mns-off" : ""}` },
      h("label", { attrs: { for: id } }, h("input", { type: "checkbox", id, checked: !hid, attrs: { "data-key": id }, onchange: () => change(flipNode(rules, p.id, x.name, p.nodes.map((y) => y.name)), `${x.title} is ${hid ? "shown" : "hidden"}.`, id) }),
        h("span", { className: "mns-title", textContent: x.title }), h("span", { className: "mns-sub", textContent: [x.title === x.name ? null : x.name, x.category].filter(Boolean).join(" · ") })),
      used.has(x.name) ? h("span", { className: "mns-tag", textContent: "in this workflow", title: "The open workflow uses this node. Hiding it only takes it out of the pickers." }) : null);
  }
  function packRow(p, matches, budget) {
    const shown = shownIn(p), total = p.nodes.length, r = rules[p.id], expanded = view.q ? matches.length > 0 : view.open.has(p.id);
    const key = `mns-p-${p.id}`.replace(/[^\w-]/g, "_"), listId = `${key}-list`;
    const box = h("input", { type: "checkbox", id: key, checked: shown === total, indeterminate: shown > 0 && shown < total, attrs: { "data-key": key, "aria-describedby": `${key}-count` },
      onchange: () => change(setPack(rules, p.id, shown === total), shown === total ? `${p.title} is hidden: ${plural(total, "node")}.` : `${p.title} is shown: ${plural(total, "node")}.`, key) });
    const rows = expanded ? (view.q ? matches : p.nodes).filter((x) => view.show === "all" || (view.show === "hidden") === hiddenBy(rules, p.id, x.name)) : [];
    const cut = view.q ? Math.max(0, rows.length - budget.left) : 0; budget.left -= rows.length - cut; // a pack the person opened lists all of its nodes; only a search across packs is capped
    const tw = h("button", { type: "button", className: "mns-tw", disabled: !!view.q, attrs: { "aria-expanded": String(expanded), "aria-controls": listId, "aria-label": `${expanded ? "Collapse" : "Expand"} ${p.title}`, "data-key": `${key}-tw` },
      onclick: () => { view.open.has(p.id) ? view.open.delete(p.id) : view.open.add(p.id); draw(`${key}-tw`); } }, h("span", { textContent: "▸", attrs: { "aria-hidden": "true" } }));
    return h("li", { className: `mns-pack${shown ? "" : " mns-off"}` },
      h("div", {}, tw, h("label", { className: "mns-name", attrs: { for: key } }, box, h("b", { textContent: p.title }), view.q && matches.length ? h("span", { className: "mns-count", textContent: `${n(matches.length)} match${matches.length === 1 ? "" : "es"}` }) : null),
        h("span", { className: "mns-count", id: `${key}-count`, textContent: shown === total ? `all ${n(total)} shown` : shown ? `${n(shown)} of ${n(total)} shown` : `all ${n(total)} hidden` })),
      expanded ? h("ul", { id: listId, className: "mns-nodes", attrs: { "aria-label": `Nodes of ${p.title}` } }, rows.slice(0, rows.length - cut).map((x) => nodeRow(p, x)),
        cut ? h("li", { className: "mns-note", textContent: `${plural(cut, "more node")} not listed: narrow the search.` }) : null,
        r && !view.q ? h("li", { className: "mns-note", textContent: r.hidden ? "Nodes this pack adds later will be hidden too." : "Nodes this pack adds later will be shown." }) : null) : null);
  }
  function draw(focusKey) {
    const q = view.q, budget = { left: MAX_ROWS };
    let list = [...packs.values()].map((p) => ({ p, hit: !q || p.title.toLowerCase().includes(q), matches: q ? p.nodes.filter((x) => `${x.title} ${x.name} ${x.category}`.toLowerCase().includes(q)) : [] }))
      .filter(({ p, hit, matches }) => (hit || matches.length) && (view.show === "all" || (view.show === "hidden" ? shownIn(p) < p.nodes.length : shownIn(p) > 0)));
    const by = { name: (a, b) => a.p.title.localeCompare(b.p.title), size: (a, b) => b.p.nodes.length - a.p.nodes.length, hidden: (a, b) => (b.p.nodes.length - shownIn(b.p)) - (a.p.nodes.length - shownIn(a.p)) }[view.sort];
    list.sort((a, b) => by(a, b) || a.p.title.localeCompare(b.p.title));
    const section = (title, items) => (items.length ? [h("h3", { textContent: `${title} (${items.length})` }), h("ul", { attrs: { "aria-label": title } }, items.map(({ p, matches }) => packRow(p, matches, budget)))] : []);
    body.replaceChildren(...(!ok ? [h("p", { className: "mns-empty", textContent: "This ComfyUI's interface has no node filter list (it arrived around mid 2025), so nothing can be hidden here. Update ComfyUI to use this." })]
      : list.length ? [...section("Node packs you installed", list.filter((x) => !x.p.builtIn)), ...section("ComfyUI itself", list.filter((x) => x.p.builtIn))]
      : [h("p", { className: "mns-empty", textContent: q ? `Nothing matches "${search.value.trim()}"${view.show === "all" ? "" : ` among ${view.show} nodes`}.` : view.show === "hidden" ? "Nothing is hidden." : "Everything is hidden." })]));
    reset.disabled = !Object.keys(rules).length;
    if (focusKey) body.querySelector(`[data-key="${focusKey}"]`)?.focus();
  }

  dialog = h("dialog", { className: "mns", attrs: { "aria-labelledby": "mns-title", "aria-describedby": "mns-about" } },
    h("header", {}, h("div", {}, h("h2", { id: "mns-title", textContent: "Node Shelf" }),
      h("p", { id: "mns-about", textContent: "Untick a pack or a node to take it out of node search, the node library, the Add Node menu and Snap. Hidden nodes stay installed: workflows that use them still load and run." })),
      h("button", { type: "button", className: "mns-x", textContent: "×", attrs: { "aria-label": "Close" }, onclick: () => dialog.close() })),
    h("div", { className: "mns-tools" }, search, seg("show", "Show", [["all", "All"], ["hidden", "Hidden"], ["shown", "Shown"]]), sort),
    h("div", { className: "mns-sum" }, status, reset), body);
  const opener = document.activeElement;
  dialog.addEventListener("close", () => { dialog.remove(); dialog = null; opener?.focus?.(); });
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // a click on the backdrop
  document.body.append(dialog);
  draw(); status.textContent = ok ? summary() : "";
  dialog.showModal(); search.focus();
  return dialog;
}

// one copy runs: the first to load. Other code (Snap's palette and top bar) reaches it here, with no import
if (!globalThis.NodeShelf) {
  globalThis.NodeShelf = { hidden: isHiddenType, open: () => open(), supported, version: 1 };
  app.registerExtension({
    name: "NodeShelf",
    settings: [{ id: SETTING, name: "Node Shelf: hidden packs and nodes", type: "hidden", defaultValue: {} }],
    commands: [{ id: COMMAND, label: "Node Shelf: hide packs or nodes you don't use", icon: "icon-[lucide--list-checks]", function: () => open() }],
    menuCommands: [{ path: ["Extensions"], commands: [COMMAND] }],
    async setup() { rules = read(); wrapLiteGraph(); apply(); },
  });
}
