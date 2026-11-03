// The Snap view DOM (UX_SPEC sections 1, 2, 6). Rendered idempotently from graph.extra.snap + the live graph, so undo,
// graph edits and agent edits all show up by re-rendering; nothing here keeps its own copy of brick state.
import { app } from "../../../scripts/app.js";
import * as E from "./engine.js";
import { BRICKS, SIMPLE_RECIPE } from "./bricks.js";
import { attachDrag } from "./drag.js";
import { Spring, SPRINGS, animate } from "./spring.js";
import * as L from "./library.js";

const h = (tag, props = {}, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k);
  return el;
};

export function createView({ onSwitch, onMakeApp }) {
  const root = h("div", { className: "snap-root", tabIndex: -1 });
  const stack = h("main", { className: "snap-stack", ariaLabel: "recipe" });
  const rail = h("aside", { className: "snap-rail" });
  const inspector = h("aside", { className: "snap-inspector" });
  const status = h("span", { className: "snap-status" });
  const toast = h("div", { className: "snap-toast", role: "status" });
  const seg = h("div", { className: "snap-seg", role: "tablist" },
    h("button", { className: "on", textContent: "Snap", role: "tab" }),
    h("button", { textContent: "Graph", role: "tab", onclick: () => onSwitch() }));
  root.append(
    h("header", { className: "snap-top" }, h("strong", { className: "snap-title", textContent: "Dials Simple" }), status, h("span", { className: "snap-spacer" }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "Make app", title: "open this recipe in ComfyUI's App mode: the brick faces become a run-only app (reloads the graph)", onclick: () => onMakeApp() }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: `Add brick  ${/Mac|iP/.test(navigator.platform) ? "⌘K" : "Ctrl K"}`, title: "Ctrl/Cmd+K", onclick: () => openPalette() }), seg),
    h("div", { className: "snap-body" }, rail, stack, inspector), toast);
  let selected = null;
  const built = new Map(); // brick key -> { el, sig }: a brick is rebuilt only when what it shows changed
  let inspectorSig = "";
  let overridden = []; // E.overrides() serializes the whole graph: computed once per render

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
      const tile = h("div", { className: "snap-card", title: `${c.text}\n\nclick or drag onto ${BRICKS[L.TARGET[c.kind]].title}`, onclick: () => applyCard(c.id) },
        h("span", { className: "snap-kind", textContent: (L.KIND_LABEL[c.kind] ?? c.kind).replace(/s$/, "") }), h("span", { className: "snap-card-title", textContent: c.title }));
      tile.dataset.card = c.id;
      tile.style.setProperty("--hue", BRICKS[L.TARGET[c.kind]].hue);
      return tile;
    }) : [h("div", { className: "snap-quiet", textContent: "nothing matches" })]));
  }

  function applyCard(id) {
    const card = L.get(id), before = rects();
    try { say(L.apply(card)); select(L.TARGET[card.kind], false); } catch (err) { say(err.message, true); }
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
    hits = Object.entries(BRICKS).filter(([k, d]) => !have.has(k) && `${d.title} ${d.blurb}`.toLowerCase().includes(q)).map(([k]) => k);
    hit = 0;
    results.replaceChildren(...(hits.length ? hits.map((k, i) => h("div", { className: `snap-hit${i === hit ? " on" : ""}`, role: "option", onpointerdown: (e) => { e.preventDefault(); pick(k); } },
      h("span", { className: "snap-grip", textContent: BRICKS[k].icon }), h("span", { textContent: BRICKS[k].title }), h("span", { className: "snap-blurb", textContent: BRICKS[k].blurb })))
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

  root.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); e.stopPropagation(); openPalette(); return; }
    if (e.target.closest("input,textarea,select")) return;
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
      select(key, false);
      render(before, key);
      if (res.bindings.length) say(`${BRICKS[key].title}: ${res.bindings.map((b) => (b.value != null ? `${b.role} = ${b.value}` : b.role)).join(", ")}`);
    } catch (err) { say(err.message, true); }
  }

  async function buildSimple() {
    for (const key of SIMPLE_RECIPE) await E.snap(key);
    select("render", false);
    render(null);
  }

  function rects() {
    return new Map([...stack.querySelectorAll("[data-brick]")].map((el) => [el.dataset.brick, el.getBoundingClientRect()]));
  }

  function select(key, rerender = true) {
    if (key !== selected) libScoped = true;
    selected = key;
    if (rerender) {
      for (const el of stack.querySelectorAll("[data-brick]")) el.classList.toggle("selected", el.dataset.brick === key);
      renderInspector();
      renderLibrary();
    }
  }

  let toastTimer = 0;
  function say(text, bad = false) {
    toast.textContent = text;
    toast.classList.toggle("bad", bad);
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2500);
  }

  function control(brick, [nodeKey, name, label]) {
    const n = E.nodeFor(brick, nodeKey), w = n?.widgets?.find((x) => x.name === name);
    if (!w) return null;
    const set = (v) => { E.setValue(brick, nodeKey, name, v); renderStatus(); };
    const values = w.options?.values;
    let input;
    if (Array.isArray(values)) {
      input = h("select", { onchange: () => set(input.value) }, values.map((v) => h("option", { value: v, textContent: v, selected: v === w.value })));
      if (!values.includes(w.value)) input.prepend(h("option", { value: w.value ?? "", textContent: w.value == null ? "nothing installed" : `${w.value} (missing)`, selected: true, disabled: true }));
    } else if (typeof w.value === "boolean") {
      input = h("input", { type: "checkbox", checked: w.value, onchange: () => set(input.checked) });
    } else if (typeof w.value === "number") {
      input = h("input", { type: "number", value: w.value, step: w.options?.step2 ?? (Number.isInteger(w.value) ? 1 : 0.01), onchange: () => set(Number(input.value)) });
    } else {
      input = h("textarea", { value: w.value ?? "", rows: name === "prompt" ? 3 : 1, onchange: () => set(input.value) });
    }
    const field = h("label", { className: `snap-field snap-${input.tagName.toLowerCase()}` }, h("span", { textContent: label }), input);
    if (input.type === "number") scrub(field.firstChild, input, set);
    return field;
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
      const up = () => { labelEl.removeEventListener("pointermove", move); set(Number(input.value)); };
      labelEl.addEventListener("pointermove", move);
      labelEl.addEventListener("pointerup", up, { once: true });
      labelEl.addEventListener("pointercancel", up, { once: true });
    });
  }

  function rackSummary() {
    let rows = [];
    try { rows = JSON.parse(E.getValue("rack", "rack", "rack") || "[]"); } catch { rows = []; }
    const on = rows.filter((r) => r.on !== false && r.dial);
    if (!on.length) return h("div", { className: "snap-quiet", textContent: "no dials yet · drop a dial card from the Library" });
    return h("div", { className: "snap-chips" }, on.map((r) => h("span", { className: "snap-chip", textContent: `${String(r.dial).split("/").pop().replace(/\.safetensors$/, "").replace(/^h3_/, "")} ${r.strength}` })));
  }

  function bindingsLine(key, info) {
    const chips = info.bindings.map((b) => {
      const kind = b.rule.split(":")[0];
      const label = b.value != null ? `${b.role} = ${b.value}` : `${b.role} ← ${BRICKS[b.from]?.title ?? b.from}`;
      return h("button", { className: `snap-bind ${kind}`, textContent: label, title: `rule: ${b.rule}\nclick to show in the graph`,
        onclick: (e) => { e.stopPropagation(); select(key); onSwitch(key); } });
    });
    const over = overridden.filter((o) => o.to === key);
    for (const o of over) chips.push(h("span", { className: "snap-bind override", textContent: `${o.role}: ${o.change} in graph`, title: "you changed this in the graph; Snap keeps your wiring" }));
    return chips.length ? h("div", { className: "snap-binds" }, chips) : null;
  }

  function brickEl(info) {
    const def = BRICKS[info.brick];
    const faces = def.face.map((f) => control(info.brick, f)).filter(Boolean);
    const body = [];
    if (info.brick === "rack") body.push(rackSummary());
    if (info.brick === "refs") body.push(h("div", { className: "snap-quiet", textContent: "pictures, clips and sound · motion guide cards land here" }));
    if (info.brick === "render") body.push(h("div", { className: "snap-quiet", textContent: "saves to output/video/dials_simple" }));
    const el = h("section", { className: `snap-brick${def.attach ? " attached" : ""}${selected === info.brick ? " selected" : ""}`, tabIndex: 0 },
      h("header", { className: "snap-head" },
        h("span", { className: "snap-grip", textContent: def.icon, title: "drag to reorder" }),
        h("span", { className: "snap-name", textContent: def.title }),
        h("span", { className: "snap-blurb", textContent: def.blurb }),
        h("button", { className: "snap-x", textContent: "×", title: "remove from the recipe", onclick: (e) => { e.stopPropagation(); const before = rects(); E.unsnap(info.brick); if (selected === info.brick) selected = null; render(before); } })),
      faces.length ? h("div", { className: "snap-face" }, faces) : null, body, bindingsLine(info.brick, info));
    el.dataset.brick = info.brick;
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
      ...Object.entries(BRICKS).map(([key, def]) => {
        const tile = h("div", { className: `snap-tile${have.has(key) ? " used" : ""}`, title: have.has(key) ? "already in the recipe" : "drag into the recipe" },
          h("span", { className: "snap-grip", textContent: def.icon }), h("span", { textContent: def.title }));
        tile.dataset.source = key;
        tile.style.setProperty("--hue", def.hue);
        return tile;
      }));
    renderLibrary();
  }

  function renderInspector() {
    const info = E.describe().find((b) => b.brick === selected);
    const sig = info ? `${selected}|${signature(info)}|${JSON.stringify(Object.values(info.nodes).map((id) => app.graph.getNodeById(id)?.widgets?.map((w) => w.value)))}` : "";
    if (sig && sig === inspectorSig) return;
    inspectorSig = sig;
    if (!info) { inspector.replaceChildren(h("div", { className: "snap-quiet", textContent: "select a brick" })); return; }
    const def = BRICKS[info.brick];
    const nodes = Object.entries(info.nodes).map(([k, id]) => [k, app.graph.getNodeById(id)]).filter(([, n]) => n);
    inspector.replaceChildren(
      h("div", { className: "snap-insp-title", textContent: def.title }),
      ...nodes.map(([k, n]) => h("div", { className: "snap-insp-node" },
        h("div", { className: "snap-insp-type", textContent: `${n.title} · ${n.type.length > 30 ? "blueprint" : n.type} #${n.id}` }),
        (n.widgets ?? []).filter((w) => w.name && !w.name.startsWith("$$") && w.type !== "button").slice(0, 16).map((w) => control(info.brick, [k, w.name, w.label ?? w.name])))),
      h("button", { className: "snap-link", textContent: "Show in graph", onclick: () => onSwitch(info.brick) }));
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
    return JSON.stringify([info.nodes, info.bindings, overridden.filter((o) => o.to === info.brick).map((o) => o.change), values]);
  }

  function reuse(info) {
    const sig = signature(info), was = built.get(info.brick);
    if (was?.sig === sig) { was.el.classList.toggle("selected", selected === info.brick); return was.el; }
    const el = brickEl(info);
    built.set(info.brick, { el, sig });
    return el;
  }

  // FLIP: bricks that moved spring from their old place; new ones rise in
  function render(before, entered) {
    const infos = E.describe();
    overridden = infos.length ? E.overrides() : [];
    for (const key of built.keys()) if (!infos.some((i) => i.brick === key)) built.delete(key);
    stack.replaceChildren(...(infos.length ? infos.map(reuse) : [h("div", { className: "snap-empty" },
      h("div", { className: "snap-empty-title", textContent: "Build a recipe" }),
      h("div", { className: "snap-quiet", textContent: "drag bricks in from the left, or start from the recommended one" }),
      h("button", { className: "snap-primary", textContent: "Start from Dials + Pika Simple", onclick: buildSimple }))]));
    renderRail(); renderInspector(); renderStatus();
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

  return { root, stack, render, say, select, get selected() { return selected; } };
}
