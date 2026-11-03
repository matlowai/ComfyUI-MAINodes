// The Snap view DOM (UX_SPEC sections 1, 2, 6). Rendered idempotently from graph.extra.snap + the live graph, so undo,
// graph edits and agent edits all show up by re-rendering; nothing here keeps its own copy of brick state.
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import { BRICKS, SIMPLE_RECIPE, PACK_BRICKS, nodeTypes } from "./bricks.js";
import { attachDrag } from "./drag.js";
import { Spring, SPRINGS, animate } from "./spring.js";
import * as L from "./library.js";
import { openSetEditor } from "./seteditor.js";
import { openBoard } from "./board.js";
import * as P from "./proposals.js";
import * as crew from "./crew.js";
import * as rules from "./rules.js";

const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k);
  return el;
};

export function createView({ onSwitch, onMakeApp, run }) {
  const root = h("div", { className: "snap-root", tabIndex: -1 });
  const stack = h("div", { className: "snap-stack", ariaLabel: "recipe" });
  const notesStrip = h("div", { className: "snap-notes" }); // notes on the whole recipe, above the chain
  const lanes = document.createElementNS("http://www.w3.org/2000/svg", "svg"); // the bus: who feeds whom beyond the next brick
  lanes.classList.add("snap-lanes");
  const rail = h("aside", { className: "snap-rail" });
  const inspector = h("aside", { className: "snap-inspector" });
  const status = h("span", { className: "snap-status" });
  const proposalsPill = h("span", { className: "snap-proposals", hidden: true });
  const title = h("strong", { className: "snap-title" });
  const runLabel = h("span", { textContent: "Run" }), progress = h("div", { className: "snap-progress" });
  const runBtn = h("button", { className: "snap-run", title: "queue this recipe (Ctrl+Enter in the graph)", onclick: () => queue() }, h("span", { textContent: "▶" }), runLabel);
  const toast = h("div", { className: "snap-toast", role: "status" });
  const seg = h("div", { className: "snap-seg", role: "tablist" },
    h("button", { className: "on", textContent: "Snap", role: "tab" }),
    h("button", { textContent: "Graph", role: "tab", onclick: () => onSwitch() }));
  root.append(
    h("header", { className: "snap-top" }, h("span", { className: "snap-brand" }, h("i"), "Snap"), title, status, proposalsPill, h("span", { className: "snap-spacer" }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "Save recipe", title: "keep these bricks and their settings as a Library card you can rebuild anywhere", onclick: async () => {
        try { const c = await L.saveRecipe(app.extensionManager.workflow.activeWorkflow?.filename ?? "recipe"); say(`Saved "${c.title}" to your Library`); renderLibrary(); } catch (err) { say(err.message, true); }
      } }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "Note", title: "a director's note on the whole recipe; agents answer it", onclick: () => { noting = true; select(null); inspector.querySelector("textarea")?.focus(); } }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "Make app", title: "open this recipe in ComfyUI's App mode: the brick faces become a run-only app (reloads the graph)", onclick: () => onMakeApp() }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: `Add brick  ${/Mac|iP/.test(navigator.platform) ? "⌘K" : "Ctrl K"}`, title: "Ctrl/Cmd+K", onclick: () => openPalette() }), seg, runBtn, progress),
    h("div", { className: "snap-body" }, rail, h("main", { className: "snap-main" }, notesStrip, stack), inspector), toast);
  let selected = null;
  const built = new Map(); // brick key -> { el, sig }: a brick is rebuilt only when what it shows changed
  let inspectorSig = "";
  let overridden = []; // E.overrides() serializes the whole graph: computed once per render
  let crewLine = null; // the crew summary element, rebuilt after each logged decision
  const unfolded = new Set(); // node types whose folded run of bricks the person opened

  // the Library section is built once (typing survives re-renders); only its results follow the query and the selection
  const bricksRail = h("div", { className: "snap-rail-part" });
  const libQuery = h("input", { className: "snap-lib-q", placeholder: "Search the Library…", ariaLabel: "search the Library" });
  const libFor = h("button", { className: "snap-lib-for", hidden: true, title: "results fit the selected brick; click to search everything" });
  const libResults = h("div", { className: "snap-lib-results" });
  let libScoped = true;
  libQuery.addEventListener("input", renderLibrary);
  libFor.addEventListener("click", () => { libScoped = !libScoped; renderLibrary(); });
  rail.append(bricksRail, h("div", { className: "snap-rail-title", textContent: "Library" }), libQuery, libFor, libResults);
  L.ready().then(renderLibrary, () => libResults.replaceChildren(h("div", { className: "snap-quiet", textContent: "Library not available on this server" })));

  function renderLibrary() {
    const scope = libScoped && selected && Object.values(L.TARGET).includes(selected) ? selected : null;
    libFor.hidden = !selected || !Object.values(L.TARGET).includes(selected);
    libFor.textContent = scope ? `for: ${BRICKS[selected].title} ✕` : `for: everything · fit ${BRICKS[selected]?.title ?? ""}`;
    const found = L.search(libQuery.value, scope).slice(0, 40);
    libResults.replaceChildren(...(found.length ? found.map((c) => {
      const goes = L.TARGET[c.kind];
      const tile = h("div", { className: "snap-card", title: `${c.text}\n\n${goes ? `click or drag onto ${BRICKS[goes].title}` : "click to rebuild this recipe"}`, onclick: () => applyCard(c.id) },
        h("span", { className: "snap-kind", textContent: (L.KIND_LABEL[c.kind] ?? c.kind).replace(/s$/, "") }), h("span", { className: "snap-card-title", textContent: c.title }),
        c.kind === "set_snapshot" ? h("span", { className: "snap-card-tools" },
          h("button", { className: "snap-edit", textContent: "▦", title: "plan-board: every saved state of this set side by side", onclick: (e) => { e.stopPropagation(); openBoard(root, L.lineage(c), { onOpen: editSet }); } }),
          h("button", { className: "snap-edit", textContent: "✎", title: "open the set plan to block it", onclick: (e) => { e.stopPropagation(); editSet(c); } })) : null);
      tile.dataset.card = c.id;
      tile.style.setProperty("--hue", goes ? BRICKS[goes].hue : 45);
      return tile;
    }) : [h("div", { className: "snap-quiet", textContent: "nothing matches" })]));
  }

  // the set editor: Apply keeps the edit as the user's working copy of this set and refreshes its References pictures
  function editSet(card) {
    openSetEditor(root, card, {
      onApply: async (s) => {
        const before = rects(), mine = L.version(card, s, true);
        try { await L.save(mine); say(await L.applySet(mine, s)); } catch (err) { say(err.message, true); }
        render(before);
      },
      onSave: async (s) => {
        const saved = L.version(card, s, false);
        try { await L.save(saved); say(`Saved "${saved.title}" to your Library`); } catch (err) { say(err.message, true); }
        renderLibrary();
      },
    });
  }

  async function applyCard(id) {
    const card = L.get(id), before = rects();
    try { say(await L.apply(card)); if (L.TARGET[card.kind]) select(L.TARGET[card.kind], false); } catch (err) { say(err.message, true); }
    render(before);
  }

  attachDrag(root, {
    stack,
    cardTarget: (id) => L.TARGET[L.get(id)?.kind],
    onCard: (id) => applyCard(id),
    accepts: (key) => !E.state().bricks.some((b) => b.key === key) && (!BRICKS[key].attach || E.state().bricks.some((b) => b.key === BRICKS[key].attach.brick)),
    onMove: (key, index) => { const before = rects(); E.move(key, index); render(before); },
    onInsert: (key, index) => add(key, index),
  });

  // Ctrl/Cmd+K: type to find a brick, Enter adds it after the selected one (UX_SPEC 4: results in < 50 ms, no open animation)
  const palette = h("div", { className: "snap-palette", hidden: true });
  const query = h("input", { placeholder: "Add a brick…", ariaLabel: "add a brick" });
  const results = h("div", { className: "snap-results", role: "listbox" });
  palette.append(query, results);
  root.append(palette);
  let hits = [], hit = 0;
  function openPalette() { palette.hidden = false; query.value = ""; search(); query.focus(); }
  function closePalette() { palette.hidden = true; root.focus({ preventScroll: true }); }
  function search() {
    const q = query.value.trim().toLowerCase(), have = new Set(E.state().bricks.map((b) => b.key));
    hits = PACK_BRICKS.filter((k) => !have.has(k) && `${BRICKS[k].title} ${BRICKS[k].blurb}`.toLowerCase().includes(q));
    // any installed node, once there's something to search for (they are hundreds)
    if (q.length >= 2) hits.push(...nodeTypes().filter((n) => `${n.title} ${n.type} ${n.category}`.toLowerCase().includes(q)).slice(0, 12).map((n) => `node:${n.type}`));
    hit = 0;
    results.replaceChildren(...(hits.length ? hits.map((k, i) => h("div", { className: `snap-hit${i === hit ? " on" : ""}`, role: "option", onpointerdown: (e) => { e.preventDefault(); pick(k); } },
      h("span", { className: "snap-grip", textContent: BRICKS[k].icon }), h("span", { textContent: BRICKS[k].title }), h("span", { className: "snap-blurb", textContent: k.startsWith("node:") ? `node · ${BRICKS[k].blurb}` : BRICKS[k].blurb })))
      : [h("div", { className: "snap-quiet", textContent: q ? "no brick matches · the Library arrives in phase 2" : "every brick is already in the recipe" })]));
    for (const [i, el] of [...results.children].entries()) el.style.setProperty("--hue", BRICKS[hits[i]]?.hue ?? 210);
  }
  function pick(key) {
    closePalette();
    const keys = E.state().bricks.map((b) => b.key);
    let i = keys.indexOf(selected);
    if (i < 0) i = keys.length - 1;
    while (BRICKS[keys[i + 1]]?.attach?.brick === keys[i] || BRICKS[keys[i + 1]]?.attach?.brick === selected) i++; // keep attachments on their host
    add(key, i + 1);
  }
  query.addEventListener("input", search);
  query.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); closePalette(); }
    else if (e.key === "Enter" && hits[hit]) { e.preventDefault(); pick(hits[hit]); }
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      hit = (hit + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % Math.max(1, hits.length);
      [...results.children].forEach((el, i) => el.classList.toggle("on", i === hit));
    }
  });
  query.addEventListener("blur", () => setTimeout(() => { if (!palette.contains(document.activeElement)) palette.hidden = true; }, 0));

  stack.addEventListener("pointerdown", (e) => { if (e.target === stack || e.target === lanes) { noting = false; select(null); } });
  root.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopPropagation(); openPalette(); return; }
    if (e.target.closest("input,textarea,select")) return;
    if (e.key === "Escape" && (selected || noting) && palette.hidden && !root.querySelector(".snap-sheet")) { noting = false; select(null); return; }
    const keys = E.state().bricks.map((b) => b.key), i = keys.indexOf(selected);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const j = Math.max(0, Math.min(keys.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      if (e.altKey && i >= 0) { const before = rects(); E.nudge(selected, e.key === "ArrowDown" ? 1 : -1); render(before); } else select(keys[j]);
    }
  });

  async function add(key, index) {
    const before = rects();
    try {
      const res = await E.snap(key, { at: index });
      select(res.brick, false); // node:<Type> becomes node:<Type>#<n>
      render(before, res.brick);
      if (res.bindings.length) say(`${BRICKS[res.brick].title}: ${res.bindings.map((b) => (b.value != null ? `${b.role} = ${b.value}` : b.role)).join(", ")}`);
    } catch (err) { say(err.message, true); }
  }

  function adoptGraph() {
    const res = E.adopt();
    say(`${res.bricks.length} bricks and ${res.bindings} bindings from the open workflow`);
    render(null);
  }

  async function buildSimple(e) {
    e.currentTarget.disabled = true; // snap() already dedupes per brick; this keeps the button honest too
    if (app.graph.nodes.length) { // the recipe starts in its own tab; the open workflow is left alone
      const was = app.extensionManager.workflow.activeWorkflow;
      await app.extensionManager.command.execute("Comfy.NewBlankWorkflow");
      while (app.extensionManager.workflow.activeWorkflow === was || app.graph.nodes.length) await new Promise((r) => setTimeout(r, 30));
    }
    for (const key of SIMPLE_RECIPE) await E.snap(key);
    select("render", false);
    render(null);
  }

  function rects() {
    return new Map([...stack.querySelectorAll("[data-brick]")].map((el) => [el.dataset.brick, el.getBoundingClientRect()]));
  }

  // the inspector slides in for a selected brick (or a recipe note) and out again, giving the chain the room
  let noting = false;
  function select(key, rerender = true) {
    if (key !== selected) libScoped = true;
    selected = key;
    if (key) noting = false;
    root.classList.toggle("inspecting", !!key || noting);
    if (rerender) {
      for (const el of stack.querySelectorAll("[data-brick]")) el.classList.toggle("selected", el.dataset.brick === key);
      renderInspector();
      renderLibrary();
    }
  }

  // Run uses ComfyUI's own queue (seed control after generate, run errors); Snap covers ComfyUI's dialogs, so what they
  // would say is said here
  async function queue() {
    runBtn.disabled = true;
    try {
      await app.queuePrompt(0, 1);
      const errors = Object.entries(app.lastNodeErrors ?? {}).map(([id, e]) => `${app.graph.getNodeById(id)?.title ?? e.class_type}: ${e.errors?.[0]?.message ?? "error"}${e.errors?.[0]?.details ? ` (${e.errors[0].details})` : ""}`);
      if (errors.length) say(`Can't run yet · ${errors[0]}${errors.length > 1 ? ` · +${errors.length - 1} more` : ""}`, true);
    } catch (err) { say(`Couldn't queue: ${err.message}`, true); }
    runBtn.disabled = false;
  }
  api.addEventListener("promptQueued", ({ detail }) => { runLabel.textContent = "Queued"; say(`Queued${detail?.number != null ? ` #${detail.number}` : ""}`); });
  api.addEventListener("progress", ({ detail }) => { progress.style.setProperty("--p", detail.value / detail.max); progress.style.opacity = 1; runLabel.textContent = `Rendering ${Math.round((100 * detail.value) / detail.max)}%`; });
  const idle = () => { runLabel.textContent = "Run"; progress.style.opacity = 0; setTimeout(() => progress.style.setProperty("--p", 0), 300); };
  api.addEventListener("execution_success", () => { idle(); say("Render finished"); });
  api.addEventListener("execution_error", ({ detail }) => { idle(); say(`Render failed · ${detail?.node_type ?? ""}: ${detail?.exception_message ?? ""}`.trim(), true); });
  api.addEventListener("execution_interrupted", idle);

  let toastTimer = 0;
  function say(text, bad = false) {
    toast.textContent = text;
    toast.classList.toggle("bad", bad);
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), bad ? 6000 : 2500);
  }

  // any node's widget as a control, read from the widget itself (no per-node code): its own type, options and limits;
  // a button runs its own callback; a custom DOM panel is the node's own element, lent to the inspector; a widget fed by
  // a wire says so instead of offering an edit the graph would ignore
  function control(brick, [nodeKey, name, label]) {
    const n = E.nodeFor(brick, nodeKey), w = n?.widgets?.find((x) => x.name === name);
    if (!w || w.hidden || w.name.startsWith("$$")) return null;
    const title = label ?? (w.label ?? name).replaceAll("_", " ");
    const wired = n.inputs?.find((i) => i.widget?.name === name && i.link != null);
    if (wired) {
      const from = app.graph.getNodeById(app.graph.links[wired.link]?.origin_id);
      return h("div", { className: "snap-field" }, h("span", { textContent: title }), h("div", { className: "snap-wired", textContent: `wired from ${from?.title ?? "another node"}` }));
    }
    if (w.element) return lend(w, title);
    if (w.type === "button") return h("button", { className: "snap-link snap-widget-btn", textContent: w.label ?? name, onclick: (e) => w.callback?.(w, app.canvas, n, [0, 0], e) });
    const set = (v) => { E.setValue(brick, nodeKey, name, v); renderStatus(); };
    const values = typeof w.options?.values === "function" ? w.options.values(w, n) : w.options?.values;
    let input;
    if (Array.isArray(values)) {
      input = h("select", { onchange: () => set(input.value) }, values.map((v) => h("option", { value: v, textContent: v, selected: v === w.value })));
      if (!values.includes(w.value)) input.prepend(h("option", { value: w.value ?? "", textContent: w.value == null ? "nothing installed" : `${w.value} (missing)`, selected: true, disabled: true }));
    } else if (typeof w.value === "boolean") {
      input = h("input", { type: "checkbox", checked: w.value, onchange: () => set(input.checked) });
    } else if (typeof w.value === "number") {
      const o = w.options ?? {};
      input = h("input", { type: "number", value: w.value, step: o.step2 ?? (o.round || (Number.isInteger(w.value) ? 1 : 0.01)), onchange: () => set(Number(input.value)) });
      if (o.min != null) input.min = o.min;
      if (o.max != null) input.max = o.max;
    } else {
      input = h("textarea", { value: w.value ?? "", rows: String(w.value ?? "").length > 80 ? 4 : 1, onchange: () => set(input.value) });
    }
    const field = h("label", { className: `snap-field snap-${input.tagName.toLowerCase()}` }, h("span", { textContent: title }), input);
    if (input.type === "number") scrub(field.firstChild, input, set);
    return field;
  }

  // a node's own DOM widget (a pack's custom panel) shown in the inspector: the element itself moves here, keeping its
  // listeners and state, and goes back to the frontend's slot when the inspector closes. If that slot is gone (undo
  // reloads the graph), the stale element is dropped and the frontend mounts the new node's own
  const lent = new Map(); // element -> the frontend's parent for it
  function lend(w, title) {
    if (!lent.has(w.element)) lent.set(w.element, w.element.parentElement);
    const box = h("div", { className: "snap-dom" });
    box.append(w.element);
    return h("div", { className: "snap-field snap-dom-field" }, h("span", { textContent: title }), box);
  }
  function giveBack() {
    for (const [el, parent] of lent) { if (parent?.isConnected) parent.appendChild(el); else el.remove(); }
    lent.clear();
  }

  // what the node shows as pictures (a loaded image's preview, a run's output), read from the node
  const previews = (n) => (n.imgs ?? []).map((img) => img.src).filter(Boolean);

  // a brick shows its settings as values; they are edited in the inspector (select the brick)
  function fact(brick, [nodeKey, name, label]) {
    const w = E.nodeFor(brick, nodeKey)?.widgets?.find((x) => x.name === name);
    if (!w || w.type === "button" || w.hidden || (w.element && !(typeof w.value === "string" && w.value))) return null; // a panel without a value isn't a fact
    const v = w.value, values = w.options?.values;
    const missing = v == null || (Array.isArray(values) && !values.includes(v));
    const text = v == null ? "missing" : typeof v === "boolean" ? (v ? "on" : "off") : Array.isArray(values) ? String(v).split("/").pop().replace(/\.safetensors$/, "") : String(v);
    if (name === "prompt") return h("div", { className: "snap-fact snap-prompt", title: v ?? "" }, h("span", { textContent: label }), h("p", { textContent: text.replace(/^integrated_multimodal_description:\s*/, "") }));
    return h("div", { className: `snap-fact${missing ? " missing" : ""}`, title: missing ? `${text} (missing)` : text }, h("span", { textContent: label }), h("b", { textContent: text }));
  }

  // drag a number's label sideways to change it: 1 step per 4 px, Shift fine, Alt coarse
  function scrub(labelEl, input, set) {
    labelEl.classList.add("snap-scrub");
    labelEl.addEventListener("pointerdown", (e) => {
      const x0 = e.clientX, v0 = Number(input.value), step = Number(input.step) || 1;
      labelEl.setPointerCapture(e.pointerId);
      const move = (m) => {
        const k = m.shiftKey ? 0.1 : m.altKey ? 10 : 1;
        const v = v0 + Math.round((m.clientX - x0) / 4) * step * k;
        input.value = Number.isInteger(step) ? Math.round(v) : v.toFixed(2);
      };
      const up = () => {
        for (const [ev, fn] of [["pointermove", move], ["pointerup", up], ["pointercancel", up]]) labelEl.removeEventListener(ev, fn);
        set(Number(input.value));
      };
      labelEl.addEventListener("pointermove", move);
      labelEl.addEventListener("pointerup", up);
      labelEl.addEventListener("pointercancel", up);
    });
  }

  function rackSummary() {
    let rows = [];
    try { rows = JSON.parse(E.getValue("rack", "rack", "rack") || "[]"); } catch { rows = []; }
    const on = rows.filter((r) => r.on !== false && r.dial);
    if (!on.length) return h("div", { className: "snap-quiet", textContent: "No dials", title: "drop a dial card from the Library, or open the rack (select it)" });
    return h("div", { className: "snap-chips" }, on.map((r) => h("span", { className: "snap-chip", textContent: `${String(r.dial).split("/").pop().replace(/\.safetensors$/, "").replace(/^h3_/, "")} ${r.strength}` })));
  }

  // what References holds: each picture with its role, and the budget (H3 takes 9 pictures; identity refs come first)
  function picturesFace() {
    const pics = E.state().bricks.find((b) => b.key === "refs")?.pictures ?? [];
    const meter = h("div", { className: "snap-meter", title: "H3 References takes 9 pictures; put identity references first" },
      ...Array.from({ length: E.PICTURE_SLOTS }, (_, i) => h("span", { className: i < pics.length ? "on" : "" })), h("em", { textContent: `${pics.length} of ${E.PICTURE_SLOTS} pictures` }));
    if (!pics.length) return [meter, h("div", { className: "snap-quiet", textContent: "Drop pictures here", title: "a set snapshot or character card from the Library" })];
    return [meter, h("div", { className: "snap-pics" }, pics.map((p) => {
      const [sub, ...name] = p.file.split("/");
      const from = p.source && (L.get(p.card) ?? L.get(`${p.source}-mine`) ?? L.get(p.source)); // the exact version in References
      return h("figure", { title: `${p.reason}${from ? "\nclick to edit the set" : ""}`, className: from ? "editable" : "", onclick: from ? () => editSet(from) : null }, h("img", { src: api.apiURL(`/view?filename=${encodeURIComponent(name.join("/"))}&subfolder=${encodeURIComponent(sub)}&type=input`), alt: p.role, loading: "lazy" }), h("figcaption", { textContent: p.role }));
    }))];
  }

  // a pick is remembered for the same pair in any workflow
  function pickBinding(key, role, from, via) {
    const rule = E.choose(key, role, from, via);
    rules.remember(rule).then(() => { E.useRules(rules.all()); say("Picked; Snap will bind this pair the same way next time"); }, (err) => say(err.message, true));
  }

  function bindingsLine(key, info, brief) {
    // three or more wires from one brick read as one chip ("Render Preset ×5"); the inspector lists each
    const count = new Map();
    for (const b of info.bindings) if (b.rule !== "ask" && b.value == null) count.set(b.from, (count.get(b.from) ?? 0) + 1);
    const grouped = new Set();
    // on a brick in the full view only the chips that want attention show (the lanes carry the rest); narrow, all of them
    const more = (b) => brief && !["ask", "remembered", "chosen"].includes(b.rule) && b.value == null;
    const chips = info.bindings.flatMap((b) => {
      if (b.rule !== "ask" && b.value == null && count.get(b.from) >= 3) {
        if (grouped.has(b.from)) return [];
        grouped.add(b.from);
        const roles = info.bindings.filter((x) => x.from === b.from && x.rule !== "ask").map((x) => x.role);
        const chip = h("button", { className: `snap-bind group${more(b) ? " more" : ""}`, textContent: `${BRICKS[b.from]?.title ?? b.from} ×${roles.length}`, title: `${roles.join(", ")}\nclick to show in the graph`,
          onclick: (e) => { e.stopPropagation(); select(key); onSwitch(key); } });
        chip.style.setProperty("--from", BRICKS[b.from]?.hue ?? 215);
        return [chip];
      }
      if (b.rule === "ask") { // several candidates fit: the person picks, the pick is remembered
        return h("span", { className: "snap-bind ask", title: "more than one output fits; pick the one you mean" }, `${b.role} ← which one? `,
          b.candidates.map((c) => h("button", { className: "snap-choice", textContent: `${BRICKS[c.from]?.title ?? c.from} · ${c.via.replaceAll("_", " ")}`, onclick: (e) => { e.stopPropagation(); const before = rects(); pickBinding(key, b.role, c.from, c.via); render(before); } })));
      }
      const kind = b.rule.split(":")[0];
      const label = b.value != null ? `${b.role} = ${b.value}` : `${b.role} ← ${BRICKS[b.from]?.title ?? b.from}${b.rule === "chosen" || b.rule === "remembered" ? ` · ${b.via.replaceAll("_", " ")}` : ""}`;
      const chip = h("button", { className: `snap-bind ${kind}${more(b) ? " more" : ""}`, textContent: label, title: `rule: ${b.rule}\nclick to show in the graph`,
        onclick: (e) => { e.stopPropagation(); select(key); onSwitch(key); } });
      if (b.rule === "remembered") chip.title = `rule: your earlier pick for this pair\nclick to show in the graph`;
      chip.style.setProperty("--from", BRICKS[b.from]?.hue ?? 215);
      return [chip];
    });
    const over = overridden.filter((o) => o.to === key);
    for (const o of over) chips.push(h("span", { className: "snap-bind override", textContent: `${o.role}: ${o.change} in graph`, title: "you changed this in the graph; Snap keeps your wiring" }));
    return chips.length ? h("div", { className: "snap-binds" }, chips) : null;
  }

  // director's notes: sticky chips on their brick (or above the stack for the whole recipe); closed notes drop away
  function noteEl(n) {
    const asks = P.all().filter((p) => p.note === n.id && p.status === "waiting").length;
    const close = (status) => { E.updateNote(n.id, { status }); render(null); };
    return h("div", { className: `snap-note ${n.status}` },
      h("span", { className: "snap-note-tag", textContent: n.brick && !E.state().bricks.some((b) => b.key === n.brick) ? `note · ${BRICKS[n.brick]?.title ?? n.brick} (removed)` : "note" }), h("span", { className: "snap-note-text", textContent: n.text }),
      n.reply ? h("span", { className: "snap-note-reply" }, h("span", { className: "snap-agent", textContent: "agent" }), ` ${n.reply}`) : null,
      asks ? h("span", { className: "snap-quiet", textContent: `${asks} proposal${asks === 1 ? "" : "s"} waiting` }) : null,
      h("button", { className: "snap-accept", textContent: "Done", title: "the note is handled", onclick: () => close("resolved") }),
      h("button", { className: "snap-reject", textContent: "Dismiss", onclick: () => close("dismissed") }));
  }
  const isOpen = (n) => n.status === "open" || n.status === "answered";
  // notes on a brick that has since been removed stay visible (with the recipe's own) until someone closes them
  const openNotes = (brick) => E.notes().filter((n) => isOpen(n) && (n.brick === brick || (brick === null && n.brick && !E.state().bricks.some((b) => b.key === n.brick))));

  function brickEl(info) {
    const def = BRICKS[info.brick];
    const faces = def.face.map((f) => fact(info.brick, f)).filter(Boolean);
    const body = [];
    const pics = Object.values(info.nodes).flatMap((id) => { const n = app.graph.getNodeById(id); return n ? previews(n) : []; });
    if (pics.length && info.brick !== "refs") body.push(h("div", { className: "snap-thumbs" }, pics.slice(0, 2).map((src) => h("img", { src, alt: "", loading: "lazy" }))));
    if (info.brick === "rack") body.push(rackSummary());
    if (info.brick === "refs") body.push(...picturesFace());
    if (info.brick === "render") {
      const shot = E.state().bricks.find((x) => x.key === "render")?.shot;
      if (shot) body.push(h("div", { className: "snap-shot-line", title: `prompt compiled from ${L.get(shot.card)?.title ?? shot.card}` }, shot.parts.map((x) => h("i", { className: `snap-dot ${x.field}` })), h("span", { textContent: (L.get(shot.card)?.title ?? shot.card).replace(/:.*/, "") })));
    }
    const el = h("section", { className: `snap-brick${def.attach ? " attached" : ""}${info.brick === "render" ? " wide" : ""}${selected === info.brick ? " selected" : ""}`, tabIndex: 0 },
      h("header", { className: "snap-head" },
        h("span", { className: "snap-grip", textContent: def.icon, title: "drag to reorder" }),
        h("span", { className: "snap-name", textContent: def.title, title: def.blurb }),
        h("button", { className: "snap-x", textContent: "×", title: "remove from the recipe", onclick: (e) => { e.stopPropagation(); const before = rects(); E.unsnap(info.brick); if (selected === info.brick) selected = null; render(before); } })),
      faces.length ? h("div", { className: "snap-face" }, faces) : null, body, bindingsLine(info.brick, info, true), openNotes(info.brick).map(noteEl));
    el.dataset.brick = info.brick;
    if (def.attach) el.dataset.host = def.attach.brick;
    el.querySelector(".snap-head").dataset.grip = "";
    el.style.setProperty("--hue", def.hue);
    el.addEventListener("pointerdown", () => select(info.brick));
    el.addEventListener("focus", () => select(info.brick));
    return el;
  }

  function renderRail() {
    const have = new Set(E.state().bricks.map((b) => b.key));
    bricksRail.replaceChildren(
      h("div", { className: "snap-rail-title", textContent: "Bricks" }),
      ...PACK_BRICKS.map((key) => [key, BRICKS[key]]).map(([key, def]) => {
        const tile = h("div", { className: `snap-tile${have.has(key) ? " used" : ""}`, title: have.has(key) ? "already in the recipe" : "drag into the recipe" },
          h("span", { className: "snap-grip", textContent: def.icon }), h("span", { textContent: def.title }));
        tile.dataset.source = key;
        tile.style.setProperty("--hue", def.hue);
        return tile;
      }));
    renderLibrary();
  }

  // pin a note to the selected brick, or to the whole recipe when nothing is selected
  function noteComposer() {
    const text = h("textarea", { className: "snap-note-input", rows: 2, placeholder: selected ? `Note on ${BRICKS[selected].title}: what should change?` : "Note on the whole recipe…" });
    const pin = () => { if (!text.value.trim()) return; E.addNote(text.value.trim(), selected); text.value = ""; say("Note pinned; agents see it with get_notes"); render(null); };
    // Ctrl+Enter is ComfyUI's Queue Prompt: in the note box it pins the note and must go no further
    text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); pin(); } });
    return h("div", { className: "snap-note-compose" }, h("div", { className: "snap-rail-title", textContent: "Director's note" }), text,
      h("button", { className: "snap-link", textContent: "Pin note  Ctrl ↵", onclick: pin }));
  }

  function shotParts(shot) {
    return h("div", { className: "snap-shot-parts" }, h("span", { className: "snap-quiet", textContent: `prompt compiled from ${L.get(shot.card)?.title ?? shot.card}:` }),
      shot.parts.map((x) => h("span", { className: `snap-part ${x.field}`, textContent: x.field, title: `${x.text}\n\nfrom: ${L.get(x.from)?.title ?? x.from}` })));
  }

  function renderInspector() {
    const info = E.describe().find((b) => b.brick === selected);
    const sig = info ? `${selected}|${signature(info)}|${JSON.stringify(Object.values(info.nodes).map((id) => app.graph.getNodeById(id)?.widgets?.map((w) => w.value)))}` : "";
    if (sig && (sig === inspectorSig || (inspector.contains(document.activeElement) && inspectorSig.startsWith(`${selected}|`)))) return;
    inspectorSig = sig;
    if (!info) {
      if (inspector.contains(document.activeElement) && inspectorSig === "") return; // a whole-recipe note is being typed
      inspectorSig = "";
      giveBack();
      if (!crewLine) { // read once, and again only after a decision is logged (it reads every day on record)
        crewLine = h("div", { className: "snap-quiet" });
        crew.report().then(({ total: [a, n], kinds }) => {
          crewLine.textContent = n ? `Crew: ${a} of ${n} proposals accepted · ${Object.entries(kinds).map(([k, [x, y]]) => `${k} ${x}/${y}`).join(" · ")}` : "";
        }, () => {});
      }
      inspector.replaceChildren(h("div", { className: "snap-insp-title" }, "Recipe", h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: () => { noting = false; select(null); } })),
        h("div", { className: "snap-quiet", textContent: "Notes here are for the whole recipe; select a brick to note on it." }), noteComposer(), crewLine);
      return;
    }
    giveBack();
    const def = BRICKS[info.brick];
    const nodes = Object.entries(info.nodes).map(([k, id]) => [k, app.graph.getNodeById(id)]).filter(([, n]) => n);
    const faced = new Set(def.face.map(([k, name]) => `${k}.${name}`));
    inspector.replaceChildren(...h("div", {},
      h("div", { className: "snap-insp-title", style: `--hue:${def.hue}` }, h("span", { className: "snap-grip", textContent: def.icon }), def.title,
        h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: () => select(null) })),
      h("div", { className: "snap-quiet", textContent: info.brick === "render" ? `${def.blurb} · saves to output/video/dials_simple` : def.blurb }),
      info.brick === "render" && E.state().bricks.find((x) => x.key === "render")?.shot ? shotParts(E.state().bricks.find((x) => x.key === "render").shot) : null,
      def.face.length ? h("div", { className: "snap-insp-node snap-insp-main" }, def.face.map((f) => control(info.brick, f))) : null,
      ...nodes.map(([k, n]) => h("div", { className: "snap-insp-node" },
        h("div", { className: "snap-insp-type", textContent: `${n.title} · ${n.type.length > 30 ? "blueprint" : n.type} #${n.id}` }),
        previews(n).length ? h("div", { className: "snap-thumbs big" }, previews(n).map((src) => h("img", { src, alt: "" }))) : null,
        (n.widgets ?? []).filter((w) => w.name && !faced.has(`${k}.${w.name}`)).map((w) => control(info.brick, [k, w.name])))),
      info.bindings.length ? h("div", { className: "snap-insp-type", textContent: "Wired from" }) : null,
      info.bindings.length ? h("div", { className: "snap-binds" }, info.bindings.filter((b) => b.rule !== "ask").map((b) => {
        const chip = h("button", { className: `snap-bind ${b.rule.split(":")[0]}`, textContent: b.value != null ? `${b.role} = ${b.value}` : `${b.role} ← ${BRICKS[b.from]?.title ?? b.from}`, title: `rule: ${b.rule}`, onclick: () => onSwitch(info.brick) });
        chip.style.setProperty("--from", BRICKS[b.from]?.hue ?? 215);
        return chip;
      })) : null,
      h("button", { className: "snap-link", textContent: "Show in graph", onclick: () => onSwitch(info.brick) }), noteComposer()).childNodes); // h() drops the nulls
  }

  function renderStatus() {
    const missing = E.missing().map((m) => `${m.node} · ${m.setting}: ${m.value ?? "nothing installed"}`);
    status.className = `snap-status ${missing.length ? "warn" : "ok"}`;
    status.textContent = missing.length ? `${missing.length} missing` : "ready";
    status.title = missing.join("\n") || "every setting points at something installed";
  }

  // what a brick shows: its bindings, overrides and face values (a graph edit or undo changes one of these)
  function signature(info) {
    const values = BRICKS[info.brick].face.map(([k, name]) => E.getValue(info.brick, k, name));
    if (info.brick === "rack") values.push(E.getValue("rack", "rack", "rack"));
    if (info.brick === "refs") values.push(E.state().bricks.find((b) => b.key === "refs")?.pictures);
    if (info.brick === "render") values.push(E.state().bricks.find((b) => b.key === "render")?.shot);
    const notes = openNotes(info.brick).map((n) => [n.id, n.status, n.reply, P.all().filter((p) => p.note === n.id && p.status === "waiting").length]);
    return JSON.stringify([info.nodes, info.bindings, overridden.filter((o) => o.to === info.brick).map((o) => o.change), values, notes]);
  }

  function reuse(info) {
    const sig = signature(info), was = built.get(info.brick);
    // a brick being typed in keeps its element: its controls already show the new value, and rebuilding drops focus
    if (was?.sig === sig || was?.el.contains(document.activeElement)) { was.el.classList.toggle("selected", selected === info.brick); return was.el; }
    const el = brickEl(info);
    built.set(info.brick, { el, sig });
    return el;
  }

  const brickNode = (key) => [...stack.children].find((el) => el.dataset.brick === key); // keys can come from agents: no selector strings

  // agent proposals: ghost bricks for proposed snaps, dashed chips on the brick for everything else
  async function decide(id, accept) {
    const before = rects();
    const p = await P.decide(id, accept, run);
    if (p) crew.log(p, L.get(p.args.card)?.kind, E.notes().find((n) => n.id === p.note)?.text).then(() => { crewLine = null; renderInspector(); }, () => {});
    if (p) say(p.status === "accepted" ? `Accepted: ${p.tool.replaceAll("_", " ")}` : p.status === "rejected" ? "Rejected the proposal" : `Couldn't apply it: ${p.result}`, p.status === "failed");
    render(before, p?.status === "accepted" ? p.args.brick : undefined);
  }

  function proposalEl(p, ghost) {
    const label = p.tool === "snap" ? `Add ${BRICKS[p.args.brick]?.title ?? p.args.brick}` : p.tool === "set_setting" ? `${p.args.name} → ${JSON.stringify(p.args.value)}`
      : p.tool === "apply_card" ? `Apply ${L.get(p.args.card)?.title ?? p.args.card}` : `${p.tool.replaceAll("_", " ")} ${p.args.brick ?? ""}`;
    const el = h(ghost ? "section" : "div", { className: ghost ? "snap-brick snap-ghost-brick" : "snap-proposal", tabIndex: 0, title: "Enter accepts · Backspace rejects" },
      h("span", { className: "snap-agent", textContent: "agent" }), h("span", { className: "snap-proposal-what", textContent: label }),
      p.reason ? h("span", { className: "snap-blurb", textContent: p.reason }) : null,
      p.note ? h("span", { className: "snap-note-tag", textContent: "re: note", title: E.notes().find((n) => n.id === p.note)?.text ?? "" }) : null,
      h("button", { className: "snap-accept", textContent: "Accept", onclick: () => decide(p.id, true) }),
      h("button", { className: "snap-reject", textContent: "Reject", onclick: () => decide(p.id, false) }));
    el.addEventListener("keydown", (e) => {
      if (e.target !== el) return;
      if (e.key === "Enter") { e.preventDefault(); decide(p.id, true); }
      else if (e.key === "Backspace" || e.key === "Delete") { e.preventDefault(); decide(p.id, false); }
    });
    if (ghost) el.style.setProperty("--hue", BRICKS[p.args.brick]?.hue ?? 210);
    return el;
  }

  function renderProposals() {
    const waiting = P.pending();
    proposalsPill.hidden = !waiting.length;
    proposalsPill.replaceChildren(h("span", { textContent: `${waiting.length} proposal${waiting.length === 1 ? "" : "s"}` }),
      h("button", { textContent: "Accept all", onclick: async () => { for (const p of P.pending()) await decide(p.id, true); } }),
      h("button", { textContent: "Reject all", onclick: async () => { for (const p of P.pending()) await decide(p.id, false); } }));
    for (const el of stack.querySelectorAll(".snap-ghost-brick, .snap-proposal")) el.remove();
    for (const p of waiting) {
      if (p.tool === "snap") {
        const after = p.args.after && brickNode(p.args.after);
        stack.insertBefore(proposalEl(p, true), after ? after.nextSibling : null);
      } else {
        const target = p.args.brick ?? L.TARGET[L.get(p.args.card)?.kind];
        (brickNode(target) ?? stack).append(proposalEl(p, false));
      }
    }
  }
  P.onChange(renderProposals);

  // three or more same-type any-node bricks in a row (seven Load Images in an adopted graph) fold behind the first
  function fold() {
    const els = [...stack.querySelectorAll(":scope > [data-brick]")], type = (el) => el.dataset.brick.startsWith("node:") && el.dataset.brick.slice(5).split("#")[0];
    for (let i = 0; i < els.length;) {
      let j = i + 1;
      while (j < els.length && type(els[j]) && type(els[j]) === type(els[i])) j++;
      const run = els.slice(i, j), t = type(els[i]);
      for (const el of run) { el.classList.remove("snap-folded"); el.querySelector(".snap-fold")?.remove(); }
      if (t && run.length >= 3) {
        const open = unfolded.has(t);
        for (const el of run.slice(1)) el.classList.toggle("snap-folded", !open);
        run[0].querySelector(".snap-head").append(h("button", { className: "snap-fold", textContent: open ? "fold" : `+${run.length - 1} more`, title: `${run.length} ${BRICKS[els[i].dataset.brick].title} bricks in a row`,
          onclick: (e) => { e.stopPropagation(); open ? unfolded.delete(t) : unfolded.add(t); fold(); } }));
      }
      i = j;
    }
  }

  // a brick that takes the previous brick's output (or rides on it) is coupled to it: the two read as one piece
  function couple() {
    const els = [...stack.querySelectorAll(":scope > [data-brick]:not(.snap-folded)")], infos = new Map(E.describe().map((i) => [i.brick, i]));
    els.forEach((el, i) => {
      const next = els[i + 1], key = el.dataset.brick, info = next && infos.get(next.dataset.brick);
      const feeds = !!info && (BRICKS[info.brick].attach?.brick === key || info.bindings.some((b) => b.from === key && b.rule !== "ask"));
      el.classList.toggle("feeds", feeds);
      if (feeds) el.style.setProperty("--next", BRICKS[info.brick].hue);
    });
  }

  // the bus under the chain: one lane per brick whose outputs go further than its neighbour, dropping into each brick it feeds
  const SVG = "http://www.w3.org/2000/svg", LANE = 16;
  const svg = (tag, attrs) => { const el = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  function drawLanes() {
    const els = [...stack.querySelectorAll(":scope > [data-brick]:not(.snap-folded)")];
    const across = getComputedStyle(stack).display === "grid";
    lanes.replaceChildren();
    if (!across || els.length < 2) { lanes.remove(); stack.style.removeProperty("--lanes-h"); return; }
    const at = new Map(els.map((el, i) => [el.dataset.brick, { i, x: el.offsetLeft + el.offsetWidth / 2, bottom: el.offsetTop + el.offsetHeight }]));
    const feeds = new Map();
    for (const info of E.describe()) for (const b of info.bindings) {
      const p = at.get(b.from), c = at.get(info.brick);
      if (b.value != null || b.rule === "ask" || !p || !c || c.i === p.i + 1) continue; // neighbours are coupled, not bussed
      if (!feeds.has(b.from)) feeds.set(b.from, new Set());
      feeds.get(b.from).add(info.brick);
    }
    const rows = [...feeds.keys()].sort((a, b) => at.get(a).i - at.get(b).i);
    const y0 = Math.max(...[...at.values()].map((v) => v.bottom)) + 26;
    rows.forEach((from, k) => {
      const p = at.get(from), y = y0 + k * LANE, color = `hsl(${BRICKS[from]?.hue ?? 215} 65% 62%)`;
      const xs = [...feeds.get(from)].map((to) => at.get(to));
      const lo = Math.min(p.x, ...xs.map((c) => c.x)), hi = Math.max(p.x, ...xs.map((c) => c.x)), off = (k - rows.length / 2) * 6; // drops side by side
      lanes.append(svg("path", { d: `M${p.x + off} ${p.bottom} V${y} M${lo + off} ${y} H${hi + off}`, stroke: color, "stroke-width": 2, fill: "none", "stroke-linecap": "round", opacity: 0.85 }),
        svg("circle", { cx: p.x + off, cy: p.bottom + 1, r: 4, fill: color }));
      for (const c of xs) lanes.append(svg("path", { d: `M${c.x + off} ${y} V${c.bottom + 6}`, stroke: color, "stroke-width": 2, fill: "none", "stroke-linecap": "round", opacity: 0.85 }),
        svg("path", { d: `M${c.x + off - 4} ${c.bottom + 9} l4 -5 l4 5`, stroke: color, "stroke-width": 2, fill: "none", "stroke-linecap": "round", "stroke-linejoin": "round" }));
      const label = svg("text", { x: p.x + off + 8, y: y - 4, fill: color }); label.textContent = BRICKS[from]?.title ?? from;
      lanes.append(label);
    });
    stack.style.setProperty("--lanes-h", `${rows.length * LANE + 26}px`);
    Object.assign(lanes.style, { width: `${stack.scrollWidth}px`, height: `${y0 + rows.length * LANE + 12}px` });
    stack.append(lanes);
  }
  new ResizeObserver(() => drawLanes()).observe(stack);

  // FLIP: bricks that moved spring from their old place; new ones rise in
  function render(before, entered) {
    const infos = E.describe();
    overridden = infos.length ? E.overrides() : [];
    for (const key of built.keys()) if (!infos.some((i) => i.brick === key)) built.delete(key);
    notesStrip.replaceChildren(...openNotes(null).map(noteEl));
    stack.replaceChildren(...(infos.length ? infos.map(reuse) : [h("div", { className: "snap-empty" },
      h("div", { className: "snap-empty-art" }, [210, 265, 35, 330].flatMap((hue, i) => [i ? h("b", { style: `--hue:${hue}` }) : null, h("i", { style: `--hue:${hue}` })])),
      h("div", { className: "snap-empty-title", textContent: "Build a recipe" }),
      h("div", { className: "snap-quiet", textContent: "Drag bricks in from the left and they snap into a working graph. Or start from the recommended recipe." }),
      h("button", { className: "snap-primary", textContent: "Start from Dials + Pika Simple", onclick: buildSimple }),
      app.graph.nodes.length ? h("button", { className: "snap-link", textContent: `Snap this workflow (${app.graph.nodes.length} nodes)`, title: "show the open graph as bricks; nothing in it changes", onclick: adoptGraph }) : null)]));
    title.textContent = app.extensionManager.workflow.activeWorkflow?.filename ?? "Snap";
    fold();
    couple();
    renderRail(); renderInspector(); renderStatus(); renderProposals();
    drawLanes();
    if (!before) return;
    for (const el of stack.querySelectorAll("[data-brick]")) {
      const key = el.dataset.brick, was = before.get(key), now = el.getBoundingClientRect();
      const eps = [0.5, 0.5, 0.002];
      const sp = was ? new Spring([was.left - now.left, was.top - now.top, 1], SPRINGS.reflow, eps) : key === entered ? new Spring([0, 12, 0.97], SPRINGS.drop, eps) : null;
      if (!sp || (was && Math.abs(was.top - now.top) < 0.5 && Math.abs(was.left - now.left) < 0.5)) continue;
      sp.set([0, 0, 1]);
      el.style.willChange = "transform";
      animate(el, sp, ([x, y, s]) => { el.style.transform = `translate3d(${x}px,${y}px,0) scale(${s})`; }, () => { el.style.transform = ""; el.style.willChange = ""; });
    }
  }

  return { root, stack, render, say, select, release: giveBack, get selected() { return selected; } };
}
