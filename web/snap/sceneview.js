// The scene navigator (U59), above the chain: where the open tab sits in its scene, as a breadcrumb (Scene › Shot ›
// Take › version, ending on the shot's active take), and the scene's shots in order, each with its active take's
// picture. A click opens a shot in the scene tab (the open shot is saved first), a drag reorders the shots, + adds one
// (empty, or from a Library shot card) and opens it. A scratch tab shows one quiet line instead: open a scene, or add
// this workflow and its takes to one. The Scenes sheet lists the scenes and makes new ones. Every action here is a
// scenes.js function that an agent tool calls too.
// SNAP-R7 lists hold while a pointer is down · SNAP-R19 one function per action · SNAP-R24 scenes own the work, tabs are
// scratch · see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import * as SC from "./scenes.js";
import * as T from "./takes.js";
import * as L from "./library.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const shown = (t) => t?.media.find((x) => x.kind === "video") ?? t?.media[0];
function thumb(t, empty) {
  const m = shown(t);
  if (!m) return h("div", { className: "snap-take-none", textContent: empty });
  return m.kind === "video" ? h("video", { src: T.url(m), muted: true, loop: true, playsInline: true, preload: "metadata" }) : h("img", { src: T.url(m), alt: "", loading: "lazy" });
}

// `onOpened()`: a shot was opened (the view re-renders); `openTake(take)`: show a take in the take viewer
export function createSceneBar({ host, say, onOpened, openTake }) {
  const el = h("section", { className: "snap-scene" });
  let sig = "", pressed = false, busy = false;
  el.addEventListener("pointerdown", () => { pressed = true; });
  for (const ev of ["pointerup", "pointercancel", "dragend"]) addEventListener(ev, () => { if (pressed) { pressed = false; setTimeout(render, 0); } });
  SC.onChange(() => render());
  T.onChange(() => render());
  SC.load().then(() => render(), () => {});

  async function act(fn) {
    if (busy) return;
    busy = true; el.classList.add("busy");
    try { const said = await fn(); if (said) say(said); onOpened(); } catch (err) { say(err.message, true); }
    busy = false; el.classList.remove("busy");
  }
  const open = (scene, shot) => act(async () => (await SC.openShot(scene, shot)).said);

  function render() {
    if (pressed) return;
    const here = SC.current();
    const shots = here ? here.scene.shots.map((x) => ({ x, active: T.get(x.active), n: SC.takesOf(x).length })) : [];
    const trail = here?.shot.active ? SC.path(here.shot, here.shot.active).map(T.get) : [];
    const now = JSON.stringify(here ? [here.scene.id, here.scene.name, here.scene.set, here.shot.id, shots.map(({ x, active, n }) => [x.id, x.name, x.card, n, active?.id, shown(active)?.filename]), trail.map((t) => t?.id)]
      : ["scratch", app.graph.nodes.length > 0, SC.all().length]);
    if (now === sig) return;
    sig = now;
    el.classList.toggle("scratch", !here);
    if (!here) {
      el.replaceChildren(h("span", { className: "snap-quiet", textContent: "Scratch tab · not part of a scene" }),
        h("button", { className: "snap-link snap-quiet-btn", textContent: SC.all().length ? `Scenes (${SC.all().length})` : "Scenes", title: "open a scene, or start one", onclick: () => openScenes() }),
        app.graph.nodes.length ? h("button", { className: "snap-link snap-quiet-btn", textContent: "Add this workflow to a scene", title: "this workflow and its takes become a shot of a scene; this tab is left as it is", onclick: () => openScenes({ adopt: true }) }) : null);
      return;
    }
    const { scene, shot } = here, set = scene.set && L.get(scene.set);
    const crumb = (text, onclick, title) => h("button", { className: "snap-crumb", textContent: text, title, onclick });
    const path = [crumb(`🎬 ${scene.name}`, () => openScenes(), "the scene: all scenes"), h("strong", { className: "snap-crumb-here", textContent: SC.shotTitle(scene, shot) })];
    trail.forEach((t, i) => path.push(t ? crumb(`${SC.label(t)}${i === trail.length - 1 ? " ★" : ""}`, () => openTake(t), i === trail.length - 1 ? "the shot's active take: open it" : "the take this version came from: open it") : h("span", { className: "snap-quiet", textContent: "a take that isn't here" })));
    if (!trail.length) path.push(h("span", { className: "snap-quiet", textContent: SC.takesOf(shot).length ? "no active take yet" : "no takes yet" }));
    el.replaceChildren(
      h("div", { className: "snap-scene-top" },
        h("nav", { className: "snap-crumbs", ariaLabel: "where you are" }, path.flatMap((x, i) => [i ? h("i", { textContent: "›" }) : null, x])),
        h("span", { className: "snap-spacer" }),
        set ? h("span", { className: "snap-scene-set", textContent: `set: ${set.title.replace(/^Set snapshot:\s*/, "")}` }) : null,
        h("button", { className: "snap-link snap-quiet-btn", textContent: "+ Shot", title: "add a shot to this scene and open it", onclick: (e) => addMenu(e.currentTarget, scene) }),
        h("button", { className: "snap-link snap-quiet-btn", textContent: "Scenes", onclick: () => openScenes() })),
      h("div", { className: "snap-shots", role: "list" }, shots.map(({ x, active, n }, i) => tile(scene, x, active, n, i, x.id === shot.id))));
  }

  function tile(scene, shot, active, n, i, on) {
    const card = shot.card && L.get(shot.card);
    const t = h("figure", { className: `snap-shot-tile${on ? " on" : ""}`, role: "listitem", tabIndex: 0, draggable: true,
      title: on ? "the open shot" : `open ${SC.shotTitle(scene, shot)} here (this shot is saved first)`, onclick: () => on || open(scene.id, shot.id) },
      h("div", { className: "snap-shot-media" }, thumb(active, card ? "shot card, not rendered yet" : "no takes yet"), h("b", { textContent: String(i + 1) })),
      h("figcaption", {}, h("strong", { textContent: shot.name || `Shot ${i + 1}` }),
        h("span", { className: "snap-quiet", textContent: n ? `${n} take${n === 1 ? "" : "s"}${active ? ` · ★ ${SC.label(active)}` : ""}` : card ? "from its shot card" : "empty" })));
    t.dataset.shot = shot.id;
    t.addEventListener("keydown", (e) => { if (e.key === "Enter" && !on) open(scene.id, shot.id); });
    const v = t.querySelector("video");
    t.addEventListener("pointerenter", () => v?.play().catch(() => {}));
    t.addEventListener("pointerleave", () => { if (v) { v.pause(); v.currentTime = 0; } });
    t.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/snap-shot", shot.id); e.dataTransfer.effectAllowed = "move"; t.classList.add("dragging"); });
    t.addEventListener("dragend", () => t.classList.remove("dragging"));
    t.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/snap-shot")) { e.preventDefault(); t.classList.add("drop-before"); } });
    t.addEventListener("dragleave", () => t.classList.remove("drop-before"));
    t.addEventListener("drop", (e) => {
      const id = e.dataTransfer.getData("text/snap-shot");
      t.classList.remove("drop-before");
      if (!id || id === shot.id) return;
      e.preventDefault();
      act(async () => { await SC.moveShot(scene.id, id, scene.shots.findIndex((x) => x.id === shot.id)); return "Shot moved"; });
    });
    return t;
  }

  // + Shot: an empty one (it starts from the open shot's recipe) or one from a Library shot card
  async function addMenu(anchor, scene) {
    host.querySelector(".snap-scene-menu")?.remove();
    await L.ready();
    const close = () => { menu.remove(); removeEventListener("pointerdown", outside, true); };
    const outside = (e) => { if (!menu.contains(e.target)) close(); };
    const add = (card) => () => { close(); act(async () => { const r = await SC.addShot(scene.id, { card }); return (await SC.openShot(scene.id, r.shot.id)).said; }); };
    const menu = h("div", { className: "snap-scene-menu", role: "menu" },
      h("button", { textContent: "Empty shot", title: "starts from the open shot's recipe", onclick: add(null) }),
      L.search("shot").filter((c) => c.kind === "shot").map((c) => h("button", { textContent: c.title, title: c.text, onclick: add(c.id) })));
    const r = anchor.getBoundingClientRect(), box = host.getBoundingClientRect();
    Object.assign(menu.style, { top: `${r.bottom - box.top + 4}px`, right: `${box.right - r.right}px` });
    host.append(menu);
    addEventListener("pointerdown", outside, true);
  }

  // the Scenes sheet: every scene with its shots' active takes, Open, and (in a scratch tab) Add this workflow; a new
  // scene starts empty or with this workflow and its takes as its first shot
  function openScenes({ adopt = false } = {}) {
    host.querySelector(".snap-scenes-sheet")?.remove();
    const here = SC.current(), canAdopt = !here && app.graph.nodes.length > 0, tab = app.extensionManager.workflow.activeWorkflow;
    const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
    const go = (fn) => { close(); act(fn); };
    const name = h("input", { className: "snap-lib-q", placeholder: "Name of the new scene", value: adopt && tab?.isPersisted ? tab.filename : "" });
    const sets = L.search("set snapshot").filter((c) => c.kind === "set_snapshot" && !c.lineage);
    const set = h("select", { ariaLabel: "set" }, h("option", { value: "", textContent: "no set" }), sets.map((c) => h("option", { value: c.id, textContent: c.title.replace(/^Set snapshot:\s*/, "") })));
    const n = T.inGroup().length, withThis = canAdopt ? h("input", { type: "checkbox", checked: adopt }) : null;
    const create = () => go(async () => {
      const s = await SC.create({ name: name.value, set: set.value || null });
      if (withThis?.checked) return `${s.name}: ${(await SC.addShot(s.id, { adopt: "open" })).opened}`;
      return (await SC.openShot(s.id, (await SC.addShot(s.id)).shot.id)).said;
    });
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); create(); } });
    const row = (s) => {
      const info = SC.summary(s), setCard = s.set && L.get(s.set);
      return h("div", { className: `snap-scene-row${info.open ? " on" : ""}` },
        h("div", { className: "snap-scene-name" }, h("strong", { textContent: s.name }), h("span", { className: "snap-quiet", textContent: `${info.shots} shot${info.shots === 1 ? "" : "s"} · ${info.takes} take${info.takes === 1 ? "" : "s"}${setCard ? ` · ${setCard.title.replace(/^Set snapshot:\s*/, "")}` : ""}${info.open ? " · open here" : ""}` })),
        h("div", { className: "snap-scene-thumbs" }, s.shots.map((x, i) => h("div", { className: "snap-shot-media", title: SC.shotTitle(s, x) }, thumb(T.get(x.active), ""), h("b", { textContent: String(i + 1) })))),
        canAdopt ? h("button", { className: "snap-link", textContent: "Add this workflow", title: `this workflow and its ${n} take${n === 1 ? "" : "s"} become a shot of ${s.name} (this tab stays as it is)`, onclick: () => go(async () => (await SC.addShot(s.id, { adopt: "open" })).opened) }) : null,
        h("button", { className: "snap-primary", textContent: "Open", onclick: () => go(async () => (await SC.openShot(s.id, (here?.scene.id === s.id ? here.shot : s.shots[0])?.id ?? (await SC.addShot(s.id)).shot.id)).said) }));
    };
    const sheet = h("div", { className: "snap-sheet snap-scenes-sheet", role: "dialog", ariaLabel: "Scenes" },
      h("header", {}, h("strong", { textContent: "Scenes" }), h("span", { className: "snap-quiet", textContent: "a scene owns its shots, their takes and versions · tabs are scratch" }), h("span", { className: "snap-spacer" }),
        h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
      h("div", { className: "snap-scene-list" }, SC.all().length ? SC.all().map(row) : h("div", { className: "snap-quiet", textContent: "No scenes yet." })),
      h("footer", { className: "snap-scene-new" }, name, set, withThis ? h("label", { className: "snap-check" }, withThis, `with this workflow and its ${n} take${n === 1 ? "" : "s"} as Shot 1`) : null,
        h("button", { className: "snap-primary", textContent: "New scene", onclick: create })));
    sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    host.append(sheet);
    (adopt ? name : sheet.querySelector(".snap-primary"))?.focus({ preventScroll: true });
  }

  return { el, render, openScenes };
}
