// The Snap view DOM (UX_SPEC sections 1, 2, 6). Rendered idempotently from graph.extra.snap + the live graph, so undo,
// graph edits and agent edits all show up by re-rendering; nothing here keeps its own copy of brick state.
// SNAP-R1 generic pass-through · SNAP-R2 re-read widgets on outside changes · SNAP-R4 outcome faces · SNAP-R5 new
// tabs for new work · SNAP-R7 pointer-down lists · SNAP-R19 actions call their tools' functions · see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import { BRICKS, SIMPLE_RECIPE, PACK_BRICKS, nodeTypes, fits } from "./bricks.js";
import { attachDrag } from "./drag.js";
import { Spring, SPRINGS, animate, reducedMotion } from "./spring.js";
import * as L from "./library.js";
import { openSetEditor } from "./seteditor.js";
import { openBoard } from "./board.js";
import * as P from "./proposals.js";
import * as crew from "./crew.js";
import * as rules from "./rules.js";
import { createDailies } from "./dailies.js";
import * as T from "./takes.js";
import * as D from "./dials.js";
import * as sight from "./sight.js";
import * as M from "./models.js";
import * as S from "./slots.js";

const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k);
  return el;
};

export function createView({ onSwitch, onMakeApp, run, openIn, setOpenIn }) {
  const root = h("div", { className: "snap-root", tabIndex: -1 });
  const stack = h("div", { className: "snap-stack", ariaLabel: "recipe" });
  const notesStrip = h("div", { className: "snap-notes" }); // notes on the whole recipe, above the chain
  const lanes = document.createElementNS("http://www.w3.org/2000/svg", "svg"); // the bus: who feeds whom beyond the next brick
  lanes.classList.add("snap-lanes");
  const rail = h("aside", { className: "snap-rail" });
  const inspector = h("aside", { className: "snap-inspector" });
  // the inspector's width: drag its left edge (double-click resets); kept per browser, the page works without it
  const WIDTH_KEY = "mainodes.snap.inspectorWidth";
  const handle = h("div", { className: "snap-insp-handle", title: "drag to resize · double-click resets" });
  const setWidth = (px) => {
    if (px == null) root.style.removeProperty("--insp-w");
    else root.style.setProperty("--insp-w", `${Math.round(Math.max(320, Math.min(px, innerWidth * 0.7)))}px`);
  };
  try { setWidth(Number(localStorage.getItem(WIDTH_KEY)) || null); } catch { /* storage blocked: default width */ }
  handle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    root.classList.add("resizing");
    const move = (m) => setWidth(innerWidth - m.clientX);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      root.classList.remove("resizing");
      drawLanes();
      try { localStorage.setItem(WIDTH_KEY, String(inspector.getBoundingClientRect().width)); } catch { /* not kept */ }
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up, { once: true });
    handle.addEventListener("pointercancel", up, { once: true });
  });
  handle.addEventListener("dblclick", () => { setWidth(null); try { localStorage.removeItem(WIDTH_KEY); } catch { /* nothing kept */ } });
  const status = h("span", { className: "snap-status" });
  // what the recipe loads, at a glance: family, setup, size on disk; a click opens the setups
  const setupPill = h("button", { className: "snap-setup", hidden: true, onclick: () => openSetups() });
  const outsideBtn = h("button", { className: "snap-outside", hidden: true, title: "nodes in this workflow that no brick owns; Run leaves them out. Click to see them in the graph",
    onclick: () => onSwitch(E.outside()) });
  const proposalsPill = h("span", { className: "snap-proposals", hidden: true });
  const title = h("strong", { className: "snap-title" });
  const runLabel = h("span", { textContent: "Run" }), progress = h("div", { className: "snap-progress" });
  // one click lets agents see this tab (the screenshot tool); click again to stop sharing
  const seeBtn = h("button", { className: "snap-see", title: "let agents see this tab (screen share of this tab only; frames are taken only when a tool asks)",
    onclick: async () => { try { sight.sharing() ? sight.stop() : await sight.start(); } catch (err) { say(err.name === "NotAllowedError" ? "Sharing was declined" : err.message, true); } } });
  const seeLabel = () => { seeBtn.textContent = sight.sharing() ? "● Agents can see" : "👁 Let agents see"; seeBtn.classList.toggle("on", sight.sharing()); };
  sight.onChange(seeLabel); seeLabel();
  const runBtn = h("button", { className: "snap-run", title: "queue this recipe (Ctrl+Enter in the graph)", onclick: () => queue() }, h("span", { textContent: "▶" }), runLabel);
  const toast = h("div", { className: "snap-toast", role: "status" });
  const seg = h("div", { className: "snap-seg", role: "tablist" },
    h("button", { className: "on", textContent: "Snap", role: "tab" }),
    h("button", { textContent: "Graph", role: "tab", onclick: () => onSwitch() }));
  root.append(
    h("header", { className: "snap-top" }, h("span", { className: "snap-brand" }, h("i"), "Snap"), title, setupPill, status, outsideBtn, proposalsPill, h("span", { className: "snap-spacer" }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "Save recipe", title: "keep these bricks and their settings as a Library card you can rebuild anywhere", onclick: async () => {
        try { const c = await L.saveRecipe(app.extensionManager.workflow.activeWorkflow?.filename ?? "recipe"); say(`Saved "${c.title}" to your Library`); renderLibrary(); } catch (err) { say(err.message, true); }
      } }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "Note", title: "a director's note on the whole recipe; agents answer it", onclick: () => { noting = true; select(null); inspector.querySelector("textarea")?.focus(); } }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "Make app", title: "open this recipe in ComfyUI's App mode: the brick faces become a run-only app (reloads the graph)", onclick: () => onMakeApp() }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: `Add brick  ${/Mac|iP/.test(navigator.platform) ? "⌘K" : "Ctrl K"}`, title: "Ctrl/Cmd+K", onclick: () => openPalette() }), seeBtn, seg, runBtn, progress),
    h("div", { className: "snap-body" }, rail, h("main", { className: "snap-main" }, notesStrip, stack), inspector, handle), toast);
  // takes under the chain: "continue from its last frame" puts that frame on the First frame brick
  const dailies = createDailies({ host: root, say, onRestore: () => render(null), onContinue: (file) => {
    const w = E.nodeFor("first_frame", "image")?.widgets?.find((x) => x.name === "image");
    if (!w) throw new Error("Add the First frame brick to continue from a take");
    if (!w.options.values.includes(file)) w.options.values.push(file);
    E.setValue("first_frame", "image", "image", file);
    render(null);
    return "Its last frame is now the First frame";
  } });
  stack.after(dailies.el);
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
  let libScoped = true, libSig = "";
  libQuery.addEventListener("input", renderLibrary);
  libFor.addEventListener("click", () => { libScoped = !libScoped; renderLibrary(); });
  rail.append(bricksRail, h("div", { className: "snap-rail-title", textContent: "Library" }), libQuery, libFor, libResults);
  T.onChange(() => renderLibrary());
  D.load().then(() => { render(null); renderLibrary(); });
  M.load().then(() => { render(null); if (M.graphProblem()) say(M.graphProblem(), true); }, () => {}); // without the model lists, settings show as plain values
  M.onCheck(() => render(null));
  L.ready().then(renderLibrary, () => libResults.replaceChildren(h("div", { className: "snap-quiet", textContent: "Library not available on this server" })));

  function renderLibrary() {
    const scope = libScoped && selected && Object.values(L.TARGET).includes(selected) ? selected : null;
    libFor.hidden = !selected || !Object.values(L.TARGET).includes(selected);
    libFor.textContent = scope ? `for: ${BRICKS[selected].title} ✕` : `for: everything · fit ${BRICKS[selected]?.title ?? ""}`;
    // the last meaning ranking for this query and slot stays up through re-renders (a flip back to keyword order would
    // replace the card under a click); a fresh one replaces it when it arrives
    const q = libQuery.value, here = `${q}|${scope}`;
    showCards(meant?.key === here ? meant.ids.map(L.get).filter(Boolean) : L.search(q, scope).slice(0, 40), meant?.key === here);
    clearTimeout(meaningTimer);
    meaningTimer = setTimeout(() => L.meaning(q, scope).then((ranked) => {
      if (libQuery.value !== q) return;
      if (ranked === "warming") { meaningTimer = setTimeout(renderLibrary, 1500); return; }
      if (ranked) { meant = { key: here, ids: ranked.slice(0, 20).map((c) => c.id) }; showCards(ranked.slice(0, 20), true); }
    }, () => {}), 150);
  }

  // while a card is held (a press, a drag), the list waits: replacing it would drop the card from under the hand
  let meaningTimer = 0, held = false, waiting = null, meant = null;
  libResults.addEventListener("pointerdown", () => { held = true; });
  // released after the click has been delivered (ComfyUI's mouseup change check re-renders before it)
  addEventListener("pointerup", () => { if (held) setTimeout(() => { held = false; if (waiting) { const w = waiting; waiting = null; showCards(...w); } }, 0); });
  addEventListener("pointercancel", () => { held = false; });
  function showCards(found, byMeaning = false) {
    if (held) { waiting = [found, byMeaning]; return; }
    libResults.classList.toggle("by-meaning", byMeaning);
    // rebuilt only when the results change: a graph change can re-render mid-click, and a replaced card loses the click
    const sig = JSON.stringify(found.map((c) => [c.id, c.title, c.media?.[0]?.filename]));
    if (sig === libSig && libResults.childElementCount) return;
    libSig = sig;
    libResults.replaceChildren(...(found.length ? found.map((c) => {
      const goes = L.TARGET[c.kind];
      const tile = h("div", { className: "snap-card", title: `${c.text}\n\n${goes ? `click or drag onto ${BRICKS[goes].title}` : "click to rebuild this recipe"}`, onclick: () => applyCard(c.id) },
        c.media?.[0] ? h("div", { className: "snap-card-thumb" }, c.media[0].kind === "video" ? h("video", { src: T.url(c.media[0]), muted: true, preload: "metadata" }) : h("img", { src: T.url(c.media[0]), alt: "", loading: "lazy" })) : null,
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

  // files dropped on Snap are Snap's (ComfyUI would otherwise add a loader node behind it): a brick takes a file when one of
  // its nodes has an upload widget for that kind of file (read from the node definition), or it is References
  const KINDS = { image: "image_upload", video: "video_upload", audio: "audio_upload" };
  function taker(brickKey, type) {
    const flag = KINDS[type.split("/")[0]];
    const b = E.state().bricks.find((x) => x.key === brickKey);
    if (!b || !flag) return null;
    for (const [nodeKey, id] of Object.entries(b.nodes)) {
      const n = app.graph.getNodeById(id), def = n?.constructor.nodeData?.input ?? {};
      const w = n?.widgets?.find((x) => (def.required?.[x.name] ?? def.optional?.[x.name])?.[1]?.[flag]);
      if (w) return { nodeKey, w };
    }
    return brickKey === "refs" && flag === "image_upload" ? { refs: true } : null;
  }
  const fileType = (e) => e.dataTransfer?.items?.[0]?.type ?? "";
  root.addEventListener("dragover", (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.target.closest?.("[data-brick]"), ok = el && taker(el.dataset.brick, fileType(e));
    e.dataTransfer.dropEffect = ok ? "copy" : "none";
    for (const b of stack.querySelectorAll(".snap-target")) if (b !== el) b.classList.remove("snap-target");
    el?.classList.toggle("snap-target", !!ok);
  });
  root.addEventListener("dragleave", (e) => { if (!root.contains(e.relatedTarget)) for (const b of stack.querySelectorAll(".snap-target")) b.classList.remove("snap-target"); });
  root.addEventListener("drop", async (e) => {
    if (![...(e.dataTransfer?.types ?? [])].includes("Files")) return;
    e.preventDefault(); e.stopPropagation();
    for (const b of stack.querySelectorAll(".snap-target")) b.classList.remove("snap-target");
    const el = e.target.closest?.("[data-brick]"), file = e.dataTransfer.files[0];
    const t = el && file && taker(el.dataset.brick, file.type);
    if (!t) return say(el ? `${BRICKS[el.dataset.brick]?.title ?? "This brick"} doesn't take ${file?.type.split("/")[0] || "that"} files` : "Drop the file on a brick that takes it (First frame, References)", true);
    const before = rects();
    try {
      const form = new FormData();
      form.append("image", file, file.name); // ComfyUI's upload route takes images, videos and audio under this field
      const r = await (await api.fetchApi("/upload/image", { method: "POST", body: form })).json();
      const path = r.subfolder ? `${r.subfolder}/${r.name}` : r.name;
      if (t.refs) E.addPicture(path, { role: "picture", reason: file.name });
      else {
        if (Array.isArray(t.w.options?.values) && !t.w.options.values.includes(path)) t.w.options.values.push(path);
        E.setValue(el.dataset.brick, t.nodeKey, t.w.name, path);
      }
      say(`${file.name} → ${BRICKS[el.dataset.brick].title}`);
    } catch (err) { say(err.message, true); }
    render(before);
  });

  // the side panel stays open until its collapse button (or Esc); a press on the empty chain only closes a brick opened in
  // place. A press on the stack's own scrollbar has the stack as its target too, so presses outside its content box are skipped
  stack.addEventListener("pointerdown", (e) => {
    const onScrollbar = e.offsetX >= stack.clientWidth || e.offsetY >= stack.clientHeight;
    if ((e.target === stack && !onScrollbar) || e.target === lanes) setOpen(null);
  });
  // the panel header's collapse button: the selected brick's own icon with a chevron
  const collapse = (icon, onclick) => h("button", { className: "snap-collapse", title: "collapse the panel (Esc)", onclick }, h("span", { className: "snap-grip", textContent: icon }), h("i", { textContent: "›" }));
  root.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopPropagation(); openPalette(); return; }
    if (e.target.closest("input,textarea,select")) return;
    if (e.key === "Escape" && opened && palette.hidden && !root.querySelector(".snap-sheet")) { setOpen(null); return; }
    if (e.key === "Escape" && (selected || noting) && palette.hidden && !root.querySelector(".snap-sheet")) { noting = false; select(null); return; }
    const keys = E.state().bricks.map((b) => b.key), i = keys.indexOf(selected);
    // arrows move along the chain: left/right in the full view, up/down when it runs top to bottom (narrow, docked)
    const across = getComputedStyle(stack).display === "grid";
    const step = { ArrowRight: across ? 1 : 0, ArrowLeft: across ? -1 : 0, ArrowDown: across ? 0 : 1, ArrowUp: across ? 0 : -1 }[e.key];
    if (step) {
      e.preventDefault();
      const j = Math.max(0, Math.min(keys.length - 1, i + step));
      if (e.altKey && i >= 0) { const before = rects(); E.nudge(selected, step); render(before); } else { select(keys[j]); brickNode(keys[j])?.focus({ preventScroll: true }); brickNode(keys[j])?.scrollIntoView({ inline: "nearest", block: "nearest" }); }
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
    await startSimple();
  }

  async function startSimple() {
    await M.freshTab();
    for (const key of SIMPLE_RECIPE) await E.snap(key);
    select("render", false);
    render(null);
  }

  function rects() {
    return new Map([...stack.querySelectorAll("[data-brick]")].map((el) => [el.dataset.brick, el.getBoundingClientRect()]));
  }

  // "open in the brick": a click (not a drag) opens the brick in place with its details; the card grows from its compact
  // size while its neighbours slide aside. One open at a time; its header, Esc or the empty chain close it
  let opened = null;
  function setOpen(key) {
    if (key === opened) return;
    const before = rects(), from = key && before.get(key);
    giveBack();
    const was = opened;
    opened = key;
    if (key) select(key, false);
    render(before);
    brickNode(key ?? was)?.focus({ preventScroll: true }); // the rebuilt brick keeps the keyboard (Esc, arrows), not the canvas behind
    const el = key && brickNode(key);
    if (!el) return;
    const to = el.getBoundingClientRect();
    if (from && !reducedMotion()) el.animate([{ clipPath: `inset(0 ${Math.max(0, to.width - from.width)}px ${Math.max(0, to.height - from.height)}px 0 round 18px)` }, { clipPath: "inset(0 0 0 0 round 18px)" }],
      { duration: 300, easing: "cubic-bezier(.2, .8, .2, 1)" });
    setTimeout(() => el.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" }), 60);
  }
  // the setting changed (here or in ComfyUI's Settings): carry the current selection over to the other place
  function openInChanged() {
    if (openIn() === "brick") { root.classList.remove("inspecting"); renderInspector(); setOpen(selected); }
    else { setOpen(null); select(selected); }
  }

  // the inspector slides in for a selected brick (or a recipe note) and out again, giving the chain the room
  let noting = false;
  function select(key, rerender = true) {
    if (key !== selected) libScoped = true;
    selected = key;
    if (key) noting = false;
    root.classList.toggle("inspecting", (!!key && openIn() === "panel") || noting);
    // keep the selected brick in view beside the inspector once it has slid open
    if (key && openIn() === "panel") setTimeout(() => brickNode(key)?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" }), 320);
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
      await app.queuePrompt(0, 1, { queueNodeIds: E.targets() });
      const errors = Object.entries(app.lastNodeErrors ?? {}).map(([id, e]) => `${app.graph.getNodeById(id)?.title ?? e.class_type}: ${e.errors?.[0]?.message ?? "error"}${e.errors?.[0]?.details ? ` (${e.errors[0].details})` : ""}`);
      if (errors.length) say(`Can't run yet · ${errors[0]}${errors.length > 1 ? ` · +${errors.length - 1} more` : ""}`, true);
    } catch (err) { say(`Couldn't queue: ${err.message}`, true); }
    runBtn.disabled = false;
  }
  const brickOfNode = (id) => { const outer = String(id ?? "").split(":")[0]; return E.state().bricks.find((b) => Object.values(b.nodes).some((n) => String(n) === outer))?.key; };
  const mark = (cls, key) => { for (const el of stack.querySelectorAll(`.snap-brick.${cls}`)) if (el.dataset.brick !== key) el.classList.remove(cls); if (key) brickNode(key)?.classList.add(cls); };
  api.addEventListener("executing", ({ detail }) => { const key = detail == null || typeof detail === "object" && detail.node == null ? null : brickOfNode(detail?.node ?? detail); mark("running", key); if (key) brickNode(key)?.style.setProperty("--run-p", 0); });
  api.addEventListener("execution_start", () => { mark("failed", null); for (const el of stack.querySelectorAll(".snap-brick")) el.removeAttribute("data-error"); });
  api.addEventListener("progress", ({ detail }) => { const key = brickOfNode(detail.node); if (key) { mark("running", key); brickNode(key)?.style.setProperty("--run-p", detail.value / detail.max); } });
  api.addEventListener("execution_error", ({ detail }) => { mark("running", null); const key = brickOfNode(detail?.node_id); if (key) { mark("failed", key); brickNode(key).dataset.error = `${detail.node_type}: ${detail.exception_message}`.slice(0, 300); } });
  for (const ev of ["execution_success", "execution_interrupted"]) api.addEventListener(ev, () => mark("running", null));
  api.addEventListener("promptQueued", () => say("Queued"));
  // the label follows ComfyUI's own queue count (a fast run can finish before the "queued" event arrives)
  api.addEventListener("status", ({ detail }) => { const n = detail?.exec_info?.queue_remaining ?? 0; if (!n) idle(); else if (!/%/.test(runLabel.textContent)) runLabel.textContent = n > 1 ? `Queued · ${n}` : "Running"; });
  api.addEventListener("progress", ({ detail }) => { progress.style.setProperty("--p", detail.value / detail.max); progress.style.opacity = 1; runLabel.textContent = `Rendering ${Math.round((100 * detail.value) / detail.max)}%`; });
  const idle = () => { runLabel.textContent = "Run"; progress.style.opacity = 0; setTimeout(() => progress.style.setProperty("--p", 0), 300); };
  api.addEventListener("execution_success", () => say("Render finished · it's in Takes"));
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

  // a slot brick is on while it runs (Upscale Off keeps the brick and its settings); other bricks always are
  const attachedOn = (key) => !BRICKS[key]?.slot || S.on(key);
  // a widget an attachment drives (Upscale's switch on Render) belongs to that attachment, never to its host's face or panel
  const owned = (key, name) => PACK_BRICKS.some((k) => BRICKS[k].attach?.brick === key && BRICKS[k].attach.widget === name);

  // a small choice right on the face, for face entries a pack brick marks `inline` (its own options, or the widget's
  // choices / on-off): one press sets it, and it never selects or opens the brick
  function inline(brick, [nodeKey, name, label, { inline: opts }]) {
    const w = E.nodeFor(brick, nodeKey)?.widgets?.find((x) => x.name === name);
    if (!w) return null;
    const list = Array.isArray(opts) ? opts : (Array.isArray(w.options?.values) ? w.options.values : [true, false]).map((v) => ({ label: typeof v === "boolean" ? (v ? "on" : "off") : String(v), value: v }));
    const seg = h("div", { className: "snap-inline", role: "radiogroup", ariaLabel: label },
      list.map((o) => h("button", { className: o.value === w.value ? "on" : "", role: "radio", ariaChecked: String(o.value === w.value), textContent: o.label,
        onclick: (e) => { e.stopPropagation(); E.setValue(brick, nodeKey, name, o.value); render(null); } })));
    seg.addEventListener("pointerdown", (e) => e.stopPropagation()); // SNAP-R7: a press here must not select or open the brick
    return seg;
  }

  // a brick shows its settings as values; they are edited in the inspector (select the brick)
  function fact(brick, f) {
    const [nodeKey, name, label, opt] = f;
    if (opt?.inline) return inline(brick, f);
    const w = E.nodeFor(brick, nodeKey)?.widgets?.find((x) => x.name === name);
    if (!w || w.type === "button" || w.hidden || (w.element && !(typeof w.value === "string" && w.value))) return null; // a panel without a value isn't a fact
    const v = w.value, values = w.options?.values;
    const missing = v == null || (Array.isArray(values) && !values.includes(v));
    if (M.isModel(w)) return modelChip(w, label, missing, !missing && !M.readable(v));
    let text = v == null ? "missing" : typeof v === "boolean" ? (v ? "on" : "off") : Array.isArray(values) ? String(v).split("/").pop().replace(/\.safetensors$/, "") : String(v);
    if (opt?.short) text = text.split(/[:(]/)[0].trim(); // "faithful: back-projection + residual 0.85" reads "faithful"
    if (name === "prompt") return h("div", { className: "snap-fact snap-prompt", title: v ?? "" }, h("span", { textContent: label }), h("p", { textContent: text.replace(/^integrated_multimodal_description:\s*/, "") }));
    return h("div", { className: `snap-fact${missing ? " missing" : ""}${text.length > 14 ? " long" : ""}`, title: missing ? `${text} (missing)` : text }, h("span", { textContent: label }), h("b", { textContent: text }));
  }

  // a model file on a face: its whole name (wrapping at underscores), installed or missing, size on disk; the tooltip has
  // the full path
  function modelChip(w, label, missing, unreadable) {
    const f = M.file(w.value), name = String(w.value ?? "").split("/").pop().replace(/\.(safetensors|gguf|sft|ckpt)$/, "");
    return h("div", { className: `snap-fact snap-model${missing || unreadable ? " missing" : ""}`, title: missing ? `${w.value} is not installed` : unreadable ? `${w.value} is listed but the server can't read the file (moved or a broken link)` : f ? `${w.value}\n${f.folder} · ${M.gb(f.size)}` : String(w.value) },
      h("span", {}, label, h("em", { textContent: missing ? "✕ missing" : unreadable ? "✕ file not readable" : f ? `✓ ${M.gb(f.size)}` : "" })), h("b", { textContent: name.replaceAll("_", "_\u200b") }));
  }
  const presetNode = (key) => M.nodesOf(key).find(([, n]) => n.presets)?.[1];
  // a node that offers presets gets a chip on its brick: the preset it holds (and whether it was edited since); a click
  // opens the setups
  function presetChip(key) {
    const n = presetNode(key);
    if (!n) return null;
    const { name, edited } = n.presets.current();
    return h("button", { className: `snap-preset${edited ? " edited" : ""}`, title: edited ? `${name}, with settings changed since; click to pick a setup` : "click to pick a setup",
      onclick: (e) => { e.stopPropagation(); openSetups(); } }, name ?? "custom settings", edited ? " · edited" : "", " ▾");
  }
  // a LoRA stack brick's rows (SNAP-R12): on/off, the file, what the model graph says it is, strength, remove; an
  // unsorted LoRA asks once what it is and the answer is remembered; "+ LoRA" lists the files that fit this stack first
  const ROLES = [["core:turbo", "turbo"], ["core:fix", "fix"], ["core:task", "task"], ["core:hires", "hires"], ["core:edit", "edit"], ["core:control", "control"], ["style", "style"], ["identity", "identity / character"]];
  const badge = (e) => (e?.role === "core" ? e.core : e?.role === "identity" ? "identity" : e?.role ?? "?");
  function stackFace(key) {
    const role = BRICKS[key].stack.role, list = M.rows(key), fam = M.family(), changed = () => render(null);
    const rowEl = (r) => h("div", { className: `snap-lora${r.on ? "" : " off"}` },
      h("input", { type: "checkbox", checked: r.on, title: "on / off", onchange: (e) => { M.setRow(key, r.row, { on: e.target.checked }); changed(); } }),
      h("span", { className: "snap-lora-name", textContent: String(r.file).split("/").pop().replace(/\.safetensors$/, "").replaceAll("_", "_\u200b"), title: `${r.file}${r.entry?.notes ? `\n${r.entry.notes}` : ""}` }),
      r.entry?.role === "unsorted" ? h("select", { className: "snap-lora-ask", title: "what is this LoRA? (remembered for next time)", onchange: async (e) => {
        const [r0, core] = e.target.value.split(":");
        await M.teach(r.file, { role: r0, ...(core ? { core } : {}), ...(fam && !r.entry.family ? { family: fam } : {}) }); changed();
      } }, h("option", { textContent: "what is this?", value: "", disabled: true, selected: true }), ROLES.map(([v, t]) => h("option", { value: v, textContent: t })))
        : h("i", { className: `snap-lora-kind ${badge(r.entry)}`, textContent: badge(r.entry) }),
      h("input", { type: "number", className: "snap-lora-v", value: r.strength, step: 0.05, title: "strength", onchange: (e) => { M.setRow(key, r.row, { strength: Number(e.target.value) }); changed(); } }),
      h("button", { className: "snap-x", textContent: "×", title: "remove this row", onclick: (e) => { e.stopPropagation(); M.removeRow(key, r.row); changed(); } }));
    const fit = (e) => (role === "core" ? e.role === "core" : e.role === role || e.role === "unsorted") && (!fam || !e.family || e.family === fam);
    const choices = M.loraChoices().filter(([, e]) => e.role !== "dial").sort(([, a], [, b]) => fit(b) - fit(a));
    const pick = h("select", { className: "snap-lora-add", title: "add a LoRA row", onchange: (e) => { if (e.target.value) { M.addRow(key, e.target.value); changed(); } } },
      h("option", { value: "", textContent: "+ LoRA", selected: true }), choices.map(([name, e]) => h("option", { value: name, textContent: `${fit(e) ? "" : "· "}${name}` })));
    const box = h("div", { className: "snap-loras" }, list.length ? list.map(rowEl) : h("div", { className: "snap-quiet", textContent: role === "core" ? "No core LoRAs" : "No LoRAs" }), pick);
    box.addEventListener("pointerdown", (e) => e.stopPropagation()); // SNAP-R7: rows are controls; a press never selects or opens the brick
    return box;
  }

  // the Turbo chip (SNAP-R10, SNAP-R14): what speeds this recipe up now, and one click to the list of its family's turbos
  function turboChip(key) {
    if (!BRICKS[key].turbo || !M.turbos().length) return null;
    const t = M.turbo();
    const chip = h("button", { className: `snap-preset snap-turbo${t ? " on" : ""}`, title: "swap the turbo: a merge swaps the checkpoint, a LoRA adds a core row; off goes back to the quality settings",
      onclick: (e) => { e.stopPropagation(); openTurbo(); } }, `Turbo: ${t ? String(t.file).split("/").pop().replace(/\.safetensors$/, "") : "off"} ▾`);
    chip.addEventListener("pointerdown", (e) => e.stopPropagation());
    return chip;
  }
  function openTurbo() {
    root.querySelector(".snap-turbo-sheet")?.remove();
    const now = M.turbo(), close = () => { sheet.remove(); root.focus({ preventScroll: true }); };
    const pick = (file) => { try { const r = M.setTurbo(file); say(`Turbo ${r.turbo ? `on · ${r.sampling.steps} steps, cfg ${r.sampling.cfg}` : "off · quality settings back"}`); close(); } catch (err) { say(err.message, true); } render(null); };
    const item = (t) => h("button", { className: `snap-setup-card${now?.file === t.file ? " on" : ""}`, onclick: () => pick(t.file) },
      h("strong", {}, t.name.replaceAll("_", "_\u200b"), h("em", { textContent: t.how === "merged" ? "merged checkpoint" : "LoRA" })),
      h("span", { className: "snap-quiet", textContent: [t.steps && `${t.steps} steps`, t.cfg != null && `cfg ${t.cfg}`, t.sampler, t.scheduler, t.how === "lora" && `strength ${t.strength}`, !t.fits && "trained on the other lineage (often transfers)"].filter(Boolean).join(" · ") }));
    const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-turbo-sheet", role: "dialog", ariaLabel: "Turbo" },
      h("header", {}, h("strong", { textContent: `Turbo · ${M.family()}` }), h("span", { className: "snap-quiet", textContent: "one turbo at a time here; stack more as LoRA rows if you want · Ctrl+Z undoes it" }), h("span", { className: "snap-spacer" }),
        h("button", { className: "snap-x", textContent: "×", onclick: close })),
      h("div", { className: "snap-setup-body" }, h("div", { className: "snap-setup-grid" },
        h("button", { className: `snap-setup-card${now ? "" : " on"}`, onclick: () => pick("off") }, h("strong", {}, "Off", h("em", { textContent: "quality" })), h("span", { className: "snap-quiet", textContent: "the setup's own steps, cfg and sampler" })),
        M.turbos().map(item))));
    sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    root.append(sheet);
    sheet.querySelector(".snap-setup-card.on")?.focus();
  }
  // what the model graph finds odd about this brick's models, as warnings (SNAP-R11: never blocks)
  const warnLines = (key) => M.warnings().filter((w) => w.brick === key).map((w) => h("div", { className: "snap-dial-warn snap-warn", textContent: `⚠ ${w.text}` }));

  // a method slot's face (SNAP-R4, SNAP-R14): the method chip, the size it comes out as, one Off / 2× / 4× control
  // and what the method does to reach it; the same calls the list_methods / set_method tools make (SNAP-R19)
  function slotFace(key) {
    const slot = BRICKS[key]?.slot ?? (S.holder("upscale") === key ? "upscale" : null);
    if (!slot) return [];
    const m = S.list(slot).find((x) => x.current), f = BRICKS[key].slot ? S.factor(key) : null, isOn = S.on(key);
    const chip = h("button", { className: "snap-preset snap-method", title: "swap the method: every one takes and gives the same picture or clip", onclick: (e) => { e.stopPropagation(); openMethods(slot); } }, `${m?.title ?? "Custom"} ▾`);
    chip.addEventListener("pointerdown", (e) => e.stopPropagation());
    if (!BRICKS[key].slot) return [chip]; // hand-wired: its own widgets say the rest
    const pick = (o) => { try { if (o === "off") S.setOn(key, false); else S.setFactor(key, o); } catch (err) { say(err.message, true); } render(null); };
    const seg = h("div", { className: "snap-inline", role: "radiogroup", ariaLabel: slot },
      [["Off", "off"], ["2×", 2], ["4×", 4]].map(([label, o]) => { const act = o === "off" ? !isOn : isOn && Math.abs(f - o) < 1e-3;
        return h("button", { className: act ? "on" : "", role: "radio", ariaChecked: String(act), textContent: label, onclick: (e) => { e.stopPropagation(); pick(o); } }); }));
    seg.addEventListener("pointerdown", (e) => e.stopPropagation()); // SNAP-R7: a press here must not select or open the brick
    const q = S.quality(key);
    return [chip, h("div", { className: "snap-headline", textContent: S.headline(key) ?? "" }), seg, q ? h("div", { className: "snap-fact long" }, h("span", { textContent: "quality" }), h("b", { textContent: q })) : null];
  }
  function openMethods(slot) {
    root.querySelector(".snap-method-sheet")?.remove();
    const close = () => { sheet.remove(); root.focus({ preventScroll: true }); };
    const pick = async (id) => { try { const r = await S.set(slot, id); say(`${slot}: ${r.method}${r.headline ? ` · ${r.headline}` : ""}`); close(); } catch (err) { say(err.message, true); } render(null); };
    const item = (m) => h("button", { className: `snap-setup-card${m.current ? " on" : ""}${m.wired && m.fits ? "" : " unwired"}`, disabled: !(m.wired && m.fits) || m.current, onclick: () => pick(m.id) },
      h("strong", {}, m.title, h("em", { className: m.install_state === "ready" ? "" : "tab", textContent: `${m.install_state === "ready" ? "●" : "○"} ${m.install_state}` })),
      h("span", { className: "snap-quiet", textContent: [m.kind, m.media, m.scale].filter(Boolean).join(" · ") }),
      !m.fits ? h("span", { className: "snap-quiet", textContent: `for ${m.media} recipes` }) : m.unwired ? h("span", { className: "snap-quiet", textContent: m.unwired }) : null);
    const list = S.list(slot), holder = S.holder(slot);
    const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-method-sheet", role: "dialog", ariaLabel: `${slot} methods` },
      h("header", {}, h("strong", { textContent: `${slot[0].toUpperCase()}${slot.slice(1)} method` }), h("span", { className: "snap-quiet", textContent: "every method takes and gives the same picture or clip · ● weights here · Ctrl+Z undoes it" }), h("span", { className: "snap-spacer" }),
        h("button", { className: "snap-x", textContent: "×", onclick: close })),
      h("div", { className: "snap-setup-body" }, h("div", { className: "snap-setup-grid" },
        holder && BRICKS[holder].slot ? h("button", { className: `snap-setup-card${S.on(holder) ? "" : " on"}`, onclick: () => pick("off") }, h("strong", {}, "Off", h("em", { textContent: "kept, bypassed" })), h("span", { className: "snap-quiet", textContent: "the brick stays with its settings; nothing is upscaled" })) : null,
        list.filter((m) => m.fits).concat(list.filter((m) => !m.fits)).map(item))));
    sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    root.append(sheet);
  }

  // a brick's `check`: what the server says a run would fail on (a face says it only when something is wrong)
  function checkLine(key, quiet) {
    const res = M.check(key);
    if (!res || (quiet && res.ready)) return null;
    return h("div", { className: `snap-check${res.ready ? " ok" : ""}`, title: [res.lightx2v && `LightX2V: ${res.lightx2v}`, !res.ready && res.help].filter(Boolean).join("\n") }, res.ready ? "✓ ready to run" : `✕ ${res.problems.join(" · ")}`);
  }

  // a model setting's name as a person says it (loader widget names: unet_name, clip_name, loras.0.lora_name …)
  const settingLabel = (name) => (/lora/.test(name) ? "LoRA" : /clip/.test(name) ? "encoder" : /vae/.test(name) ? "VAE" : /unet|ckpt|^model$/.test(name) ? "model" : name.replaceAll("_", " "));
  // the setups: the recipe's own presets and every family's cards, grouped by family; a click applies one (one undo step)
  function openSetups() {
    root.querySelector(".snap-setup-sheet")?.remove();
    const list = M.setups(), close = () => { sheet.remove(); root.focus({ preventScroll: true }); }, fam = M.family();
    const families = [...new Set([fam, ...list.map((s) => s.family ?? "This recipe")].filter(Boolean))];
    const keep = h("input", { type: "checkbox", checked: true });
    const ready = (m) => (m.cant_load ? "✕ can't load in core" : !m.installed ? "✕ missing" : m.size ? M.gb(m.size) : "");
    const card = (s) => h("button", { className: `snap-setup-card${s.current ? " on" : ""}`, onclick: async () => {
      const before = rects();
      try { say(await M.useSetup(s, { keep: keep.checked })); select(null, false); close(); } catch (err) { say(err.message, true); }
      render(before);
    } },
      h("strong", {}, s.name, s.current ? h("em", { textContent: s.edited ? "current · edited" : "current" }) : s.family !== fam && E.state().bricks.length ? h("em", { className: "tab", textContent: "opens a new tab" }) : null),
      s.about ? h("span", { className: "snap-setup-about", textContent: s.about, title: s.about }) : null,
      h("div", { className: "snap-setup-files" }, s.models.map((m) => h("span", { className: m.installed && !m.cant_load ? "" : "missing", title: m.file },
        h("i", { textContent: settingLabel(m.setting) }), String(m.file).split("/").pop().replace(/\.safetensors$/, "").replaceAll("_", "_\u200b"), h("em", { textContent: ready(m) })))),
      h("span", { className: "snap-quiet", textContent: [s.output, s.values.sampler, s.values.schedule, s.values.steps && `${s.values.steps} steps`, s.values.cfg != null && `cfg ${s.values.cfg}`].filter(Boolean).join(" · ") }));
    const sheet = h("div", { className: "snap-sheet snap-setup-sheet", role: "dialog", ariaLabel: "Setups" },
      h("header", {}, h("strong", { textContent: "Setups" }), h("span", { className: "snap-quiet", textContent: "a click applies every setting of a setup together · Ctrl+Z undoes it · another family opens in a new tab" }), h("span", { className: "snap-spacer" }),
        fam && E.state().bricks.length ? h("label", { className: "snap-quiet snap-keep" }, keep, ` keep this ${fam} stack as "Last used" when switching family`) : null,
        h("button", { className: "snap-x", textContent: "×", onclick: close })),
      h("div", { className: "snap-setup-body" }, list.length ? families.map((f) => h("section", {},
        h("div", { className: "snap-rail-title", textContent: `${f}${D.all().some((d) => d.family === f) ? ` · ${D.all().filter((d) => d.family === f).length} dials` : ""}` }),
        h("div", { className: "snap-setup-grid" }, list.filter((s) => (s.family ?? "This recipe") === f).map(card))))
        : h("div", { className: "snap-quiet", textContent: "No setups: no brick here offers presets and the Library has no family cards." })));
    sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    root.append(sheet);
    sheet.querySelector(".snap-setup-card.on, .snap-setup-card")?.focus();
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

  const openMaker = () => D.openMaker(root, { say, onChange: () => render(null) });

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
    const faces = [presetChip(info.brick), turboChip(info.brick), ...slotFace(info.brick), ...def.face.map((f) => fact(info.brick, f))].filter(Boolean);
    const body = [];
    const pics = Object.values(info.nodes).flatMap((id) => { const n = app.graph.getNodeById(id); return n ? previews(n) : []; });
    if (pics.length && info.brick !== "refs") body.push(h("div", { className: "snap-thumbs" }, pics.slice(0, 2).map((src) => h("img", { src, alt: "", loading: "lazy" }))));
    if (info.brick === "rack") body.push(D.face({ onChange: () => render(null), onPick: () => D.openPicker(root, { say, onChange: () => render(null), onMake: openMaker }), onMake: openMaker }));
    if (info.brick === "refs") body.push(...picturesFace());
    if (def.stack) body.push(stackFace(info.brick));
    body.push(...warnLines(info.brick));
    if (def.check && attachedOn(info.brick)) body.push(checkLine(info.brick, true)); // Off runs nothing, so nothing can be wrong
    if (info.brick === "render") {
      const shot = E.state().bricks.find((x) => x.key === "render")?.shot;
      if (shot) body.push(h("div", { className: "snap-shot-line", title: `prompt compiled from ${L.get(shot.card)?.title ?? shot.card}` }, shot.parts.map((x) => h("i", { className: `snap-dot ${x.field}` })), h("span", { textContent: (L.get(shot.card)?.title ?? shot.card).replace(/:.*/, "") })));
    }
    const open = opened === info.brick;
    const el = h("section", { className: `snap-brick${def.attach ? " attached" : ""}${attachedOn(info.brick) ? "" : " off"}${["render", "image"].includes(info.brick) || (info.brick === "rack" && D.rows().length) || (def.stack && M.rows(info.brick).length) ? " wide" : ""}${selected === info.brick ? " selected" : ""}${open ? " open" : ""}`, tabIndex: 0 },
      h("header", { className: "snap-head" },
        h("span", { className: "snap-grip", textContent: def.icon, title: "drag to reorder" }),
        h("span", { className: "snap-name", textContent: def.title, title: def.blurb }),
        open ? h("button", { className: "snap-mode", textContent: "⇥", title: "open bricks in the side panel instead (remembered; also in Settings › MAINodes)", onclick: (e) => { e.stopPropagation(); setOpenIn("panel"); } }) : null,
        h("button", { className: "snap-x", textContent: "×", title: "remove from the recipe", onclick: (e) => { e.stopPropagation(); const before = rects(); E.unsnap(info.brick); if (selected === info.brick) selected = null; if (opened === info.brick) opened = null; render(before); } })),
      ...(open ? [details(info)] : [faces.length ? h("div", { className: "snap-face" }, faces) : null, ...body]),
      bindingsLine(info.brick, open ? { ...info, bindings: info.bindings.filter((b) => b.rule === "ask") } : info, true), openNotes(info.brick).map(noteEl)); // open, the details list the wiring; only questions stay as chips
    // in brick mode a press released in place opens it (a drag moves further); on an open brick, its header closes it. Done on
    // pointerup, before ComfyUI's mouseup change check can re-render the chain and drop the click
    let press = null;
    el.addEventListener("pointerdown", (e) => { press = e.button === 0 && !e.target.closest("button,input,select,textarea,label,.snap-dom,.snap-note,.snap-proposal") ? [e.clientX, e.clientY] : null; });
    el.addEventListener("pointerup", (e) => {
      const p = press; press = null;
      if (!p || openIn() !== "brick" || Math.hypot(e.clientX - p[0], e.clientY - p[1]) > 4) return;
      if (!open) setOpen(info.brick);
      else if (e.target.closest(".snap-head")) setOpen(null);
    });
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
      ...PACK_BRICKS.filter((key) => fits(key, [...have])).map((key) => [key, BRICKS[key]]).map(([key, def]) => {
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
    if (openIn() === "brick" && !noting) { if (inspectorSig) { giveBack(); inspector.replaceChildren(); inspectorSig = ""; } return; }
    const info = E.describe().find((b) => b.brick === selected);
    const sig = info ? `${selected}|${signature(info)}|${JSON.stringify(Object.values(info.nodes).map((id) => app.graph.getNodeById(id)?.widgets?.map((w) => w.value)))}` : "";
    // SNAP-R2: the panel follows its widgets like the face; it holds still only while a text field in it is typed in
    const typing = inspector.contains(document.activeElement) && document.activeElement.matches("textarea,input:not([type=checkbox]):not([type=range]),[contenteditable]");
    if (sig && (sig === inspectorSig || (typing && inspectorSig.startsWith(`${selected}|`)))) return;
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
      inspector.replaceChildren(h("div", { className: "snap-insp-title" }, collapse("✎", () => { noting = false; select(null); }), "Recipe"),
        h("div", { className: "snap-quiet", textContent: "Notes here are for the whole recipe; select a brick to note on it." }), noteComposer(), crewLine);
      return;
    }
    giveBack();
    const def = BRICKS[info.brick];
    inspector.replaceChildren(...h("div", {},
      h("div", { className: "snap-insp-title", style: `--hue:${def.hue}` }, collapse(def.icon, () => select(null)), def.title,
        h("button", { className: "snap-mode", textContent: "⤢", title: "open bricks in place instead (remembered; also in Settings › MAINodes)", onclick: () => setOpenIn("brick") })),
      details(info), noteComposer()).childNodes); // h() drops the nulls
  }

  // everything a brick's nodes offer, read generically (see control): the same in the side panel and in an open brick
  function details(info) {
    const def = BRICKS[info.brick];
    const nodes = M.nodesOf(info.brick);
    const faced = new Set(def.face.map(([k, name]) => `${k}.${name}`));
    const shot = info.brick === "render" && E.state().bricks.find((x) => x.key === "render")?.shot;
    return h("div", { className: "snap-details" },
      h("div", { className: "snap-quiet", textContent: info.brick === "render" ? `${def.blurb} · saves to output/video/dials_simple` : def.blurb }),
      shot ? shotParts(shot) : null,
      def.check ? checkLine(info.brick) : null,
      def.face.length ? h("div", { className: "snap-insp-node snap-insp-main" }, def.face.map((f) => (f[3]?.inline ? inline(info.brick, f) : control(info.brick, f)))) : null,
      ...nodes.map(([k, n]) => h("div", { className: "snap-insp-node" },
        h("div", { className: "snap-insp-type", textContent: `${n.title} · ${n.type.length > 30 ? "blueprint" : n.type} #${n.id}${n.graph !== app.graph ? ` · inside ${BRICKS[def.attach.brick].title}` : ""}` }),
        previews(n).length ? h("div", { className: "snap-thumbs big" }, previews(n).map((src) => h("img", { src, alt: "" }))) : null,
        (n.widgets ?? []).filter((w) => w.name && !faced.has(`${k}.${w.name}`) && !owned(info.brick, w.name)).flatMap((w) => [
          ...(def.explain?.[w.name] ? [h("div", { className: "snap-insp-type", textContent: def.explain[w.name][0] }), h("div", { className: "snap-quiet", textContent: def.explain[w.name][1] })] : []),
          control(info.brick, [k, w.name])]))),
      info.bindings.length ? h("div", { className: "snap-insp-type", textContent: "Wired from" }) : null,
      info.bindings.length ? h("div", { className: "snap-binds" }, info.bindings.filter((b) => b.rule !== "ask").map((b) => {
        const chip = h("button", { className: `snap-bind ${b.rule.split(":")[0]}`, textContent: b.value != null ? `${b.role} = ${b.value}` : `${b.role} ← ${BRICKS[b.from]?.title ?? b.from}`, title: `rule: ${b.rule}`, onclick: () => onSwitch(info.brick) });
        chip.style.setProperty("--from", BRICKS[b.from]?.hue ?? 215);
        return chip;
      })) : null,
      h("button", { className: "snap-link", textContent: "Show in graph", onclick: () => onSwitch(info.brick) }));
  }

  function renderStatus() {
    const missing = [...E.missing(), ...M.unreadable()].map((m) => `${m.brick ? "" : "outside the recipe: "}${m.node} · ${m.setting}: ${m.value ?? "nothing installed"}${m.unreadable ? " (file not readable)" : m.cant_load ? " (core ComfyUI can't load it)" : ""}`);
    for (const b of E.state().bricks) { const res = BRICKS[b.key].check && M.check(b.key); if (res && !res.ready) missing.push(...res.problems.map((p) => `${BRICKS[b.key].title}: ${p}`)); }
    status.className = `snap-status ${missing.length ? "warn" : "ok"}`;
    status.textContent = missing.length ? `${missing.length} missing` : "ready";
    status.title = missing.join("\n") || "every setting points at something installed";
    const out = E.outside();
    outsideBtn.hidden = !out.length;
    outsideBtn.textContent = `${out.length} node${out.length === 1 ? "" : "s"} outside the recipe ›`;
    const setups = M.setups(), now = setups.find((x) => x.current), fam = M.family(), size = M.total();
    setupPill.hidden = !setups.length && !fam;
    setupPill.textContent = [fam, now ? `${now.name}${now.edited ? " · edited" : ""}` : setups.length ? "custom settings" : null, size ? M.gb(size) : null].filter(Boolean).join(" · ") + (setups.length ? " ▾" : "");
    setupPill.title = `${M.settings().map((m) => `${m.setting}: ${m.file}${m.size ? ` (${M.gb(m.size)})` : m.installed ? "" : " (missing)"}`).join("\n")}${setups.length ? "\n\nclick to switch setups" : ""}`;
  }

  // what a brick shows: its bindings, overrides and face values (a graph edit or undo changes one of these)
  function signature(info) {
    const def = BRICKS[info.brick], values = def.face.map(([k, name]) => E.getValue(info.brick, k, name));
    if (def.slot) values.push(S.on(info.brick), S.headline(info.brick), S.quality(info.brick), S.list(def.slot).map((m) => m.install_state));
    if (def.stack) values.push(M.rows(info.brick).map((r) => [r.file, r.strength, r.on, r.entry?.role]));
    if (def.turbo) values.push(M.turbo()?.file, M.turbos().length);
    values.push(M.warnings().filter((w) => w.brick === info.brick).map((w) => w.text));
    if (info.brick === "rack") values.push(E.getValue("rack", "rack", "rack"), D.all().length, D.family()); // the face redraws once the catalog arrives
    values.push(presetNode(info.brick)?.presets.current(), BRICKS[info.brick].check && M.check(info.brick), M.known()); // chips get their sizes once the model lists arrive
    if (info.brick === "refs") values.push(E.state().bricks.find((b) => b.key === "refs")?.pictures);
    if (info.brick === "render") values.push(E.state().bricks.find((b) => b.key === "render")?.shot);
    const notes = openNotes(info.brick).map((n) => [n.id, n.status, n.reply, P.all().filter((p) => p.note === n.id && p.status === "waiting").length]);
    const open = opened === info.brick && Object.values(info.nodes).map((id) => app.graph.getNodeById(id)?.widgets?.map((w) => (typeof w.value === "object" ? null : w.value)));
    return JSON.stringify([info.nodes, info.bindings, overridden.filter((o) => o.to === info.brick).map((o) => o.change), values, notes, open]);
  }

  function reuse(info) {
    const sig = signature(info), was = built.get(info.brick);
    // a brick being typed in keeps its element: its controls already show the new value, and rebuilding drops focus
    const typing = was?.el.contains(document.activeElement) && document.activeElement.matches("input,textarea,select,[contenteditable]");
    if (was?.sig === sig || typing) { was.el.classList.toggle("selected", selected === info.brick); return was.el; }
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

  // what an agent reads and does through the `read_ui` / `ui` tools: the same moves a person makes
  function uiRead() {
    return { selected, open: opened, side_panel: root.classList.contains("inspecting"), sheet: root.querySelector(".snap-sheet")?.ariaLabel ?? null,
      workflow: app.extensionManager.workflow.activeWorkflow?.filename ?? null, bricks: E.state().bricks.map((b) => b.key) };
  }
  async function uiAct(action, target) {
    const tracker = app.extensionManager.workflow.activeWorkflow?.changeTracker;
    if (action === "select") {
      if (!E.state().bricks.some((b) => b.key === target)) throw new Error(`No brick ${target} in the recipe`);
      if (openIn() === "brick") setOpen(target); else select(target);
    } else if (action === "close") { for (const sh of root.querySelectorAll(".snap-sheet")) sh.remove(); setOpen(null); noting = false; select(null); }
    else if (action === "start") await startSimple();
    else if (action === "undo") tracker.undo();
    else if (action === "redo") tracker.redo();
    else if (action === "dials") await D.openPicker(root, { say, onChange: () => render(null), onMake: openMaker });
    else if (action === "make_dial") openMaker();
    else if (action === "open_take") { const t = T.get(target); if (!t) throw new Error(`No take ${target}`); dailies.view(t); }
    else if (action === "setups") openSetups();
    else if (action === "turbo") openTurbo();
    else if (action === "methods") openMethods(target || "upscale");
    else throw new Error(`Unknown ui action ${action}`);
    return uiRead();
  }

  return { root, stack, render, say, select, openInChanged, uiRead, uiAct, release: () => { giveBack(); if (opened) { opened = null; render(null); } }, get opened() { return opened; }, get selected() { return selected; } };
}
