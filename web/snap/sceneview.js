// The scene navigator (U59), above the chain: where the open tab sits in its scene, as a breadcrumb (Scene › Shot ›
// Take › version, ending on the shot's active take), and the scene's shots in order, each with its active take's
// picture (or, with none active, its newest take's and "☆ make active"). A click opens a shot in the scene tab (the open shot is saved first; a card shot with no camera plate offers
// its plate candidates as a proposal), a drag reorders the shots, + adds one (empty, or from a Library shot card) and
// opens it, a shot's ⋯ renames it, re-runs its take with swaps or takes it out of the scene. A scratch tab shows one quiet line instead: open a
// scene, or add this workflow and its takes to one. The Scenes sheet lists the scenes, makes new ones, renames and
// deletes them (a deleted scene is parked, never lost). Every action here is the function an agent tool calls too.
// SNAP-R7 lists hold while a pointer is down · SNAP-R19 one function per action · SNAP-R24 scenes own the work, tabs are
// scratch · SNAP-R65 a shot's open jobs on its tile · SNAP-R93 Agent instructions on a scene and a shot · see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import * as SC from "./scenes.js";
import * as T from "./takes.js";
import * as L from "./library.js";
import * as A from "./activity.js";
import * as AL from "./agentlibrary.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const shown = (t) => t?.media.find((x) => x.kind === "video") ?? t?.media[0];
function thumb(t, empty) {
  const m = shown(t);
  if (!m) return h("div", { className: "snap-take-none", textContent: empty });
  return m.kind === "video" ? h("video", { src: T.url(m), muted: true, loop: true, playsInline: true, preload: "metadata" }) : h("img", { src: T.url(m), alt: "", loading: "lazy" });
}

// `onOpened()`: a shot was opened (the view re-renders); `openTake(take)`: show a take in the take viewer; `run(tool,
// args)`: the tool table, as the person calls it
export function createSceneBar({ host, say, onOpened, openTake, run, rerun }) {
  const el = h("section", { className: "snap-scene" });
  let sig = "", pressed = false, busy = false;
  el.addEventListener("pointerdown", () => { pressed = true; });
  for (const ev of ["pointerup", "pointercancel", "dragend"]) addEventListener(ev, () => { if (pressed) { pressed = false; setTimeout(render, 0); } });
  SC.onChange(() => render());
  A.onChange(() => render()); // SNAP-R65: a shot's open jobs as a count on its tile (render's signature skips the rest)
  T.onChange(() => render());
  SC.load().then(() => render(), () => {});

  async function act(fn) {
    if (busy) return;
    busy = true; el.classList.add("busy");
    try { const said = await fn(); if (said) say(said); onOpened(); } catch (err) { say(err.message, true); }
    busy = false; el.classList.remove("busy");
  }
  // open_shot, as agents call it: a card shot whose camera has no plate yet comes back with that offer (U55, U62)
  async function opened(scene, shot) {
    const r = await run("open_shot", { scene, shot }), p = r.plates;
    return `${r.said}${p?.proposed ? ` · ${p.camera} has no camera plate yet: making its candidates waits for your yes above the chain (${p.plan.renders} renders, about ${p.plan.eta_s} s)`
      : p?.rendering ? ` · ${p.camera}'s plate candidates are rendering` : p?.waiting ? ` · ${p.camera}'s plate candidates wait for your pick in the set editor` : ""}`;
  }
  const open = (scene, shot) => act(() => opened(scene, shot));

  function render() {
    if (pressed) return;
    const here = SC.current();
    // a shot with takes and none active shows its newest take (the operator, 2026-11-05: tiles said "no takes yet" over 78 takes)
    const newest = (x) => SC.takesOf(x).map((e) => T.get(e.take)).filter(Boolean).sort((a, b) => a.created - b.created).at(-1) ?? null;
    const shots = here ? here.scene.shots.map((x) => ({ x, active: T.get(x.active), latest: x.active ? null : newest(x), n: SC.takesOf(x).length, jobs: jobsOf(x) })) : [];
    const trail = here?.shot.active ? SC.path(here.shot, here.shot.active).map(T.get) : [];
    const now = JSON.stringify(here ? [here.scene.id, here.scene.name, here.scene.set, here.shot.id, shots.map(({ x, active, latest, n, jobs }) => [x.id, x.name, x.card, n, active?.id, shown(active ?? latest)?.filename, jobs]), trail.map((t) => t?.id)]
      : ["scratch", app.graph.nodes.length > 0, SC.all().length]);
    if (now === sig) return;
    sig = now;
    el.classList.toggle("scratch", !here);
    if (!here) {
      el.replaceChildren(...[h("span", { className: "snap-quiet", textContent: "Scratch tab · not part of a scene" }),
        h("button", { className: "snap-link snap-quiet-btn", textContent: SC.all().length ? `Scenes (${SC.all().length})` : "Scenes", title: "open a scene, or start one", onclick: () => openScenes() }),
        app.graph.nodes.length ? h("button", { className: "snap-link snap-quiet-btn", textContent: "Add this workflow to a scene", title: "this workflow and its takes become a shot of a scene; this tab is left as it is", onclick: () => openScenes({ adopt: true }) }) : null].filter(Boolean)); // replaceChildren(null) would print "null"
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
      h("div", { className: "snap-shots", role: "list" }, shots.map(({ x, active, latest, n, jobs }, i) => tile(scene, x, active, latest, n, i, x.id === shot.id, jobs))));
  }

  // the shot's open jobs (in flight, or waiting for a pick): how many, and the most pressing state
  function jobsOf(shot) {
    const mine = new Set(SC.takesOf(shot).map((e) => e.take)), rows = A.all().filter((r) => (r.zone === "in_flight" || r.state === "waiting") && r.source !== "proposal"
      && (r.about.shot === shot.id || mine.has(r.about.take) || shot.groups.includes(r.about.group)));
    return rows.length ? { n: rows.length, state: rows.some((r) => r.state === "failed") ? "failed" : rows.some((r) => r.state === "waiting") ? "waiting" : "live", titles: rows.map((r) => r.title) } : null;
  }
  function tile(scene, shot, active, latest, n, i, on, jobs) {
    const card = shot.card && L.get(shot.card);
    const t = h("figure", { className: `snap-shot-tile${on ? " on" : ""}`, role: "listitem", tabIndex: 0, draggable: true,
      title: on ? "the open shot" : `open ${SC.shotTitle(scene, shot)} here (this shot is saved first)`, onclick: () => on || open(scene.id, shot.id) },
      h("div", { className: "snap-shot-media" }, thumb(active ?? latest, card ? "shot card, not rendered yet" : "no takes yet"), h("b", { textContent: String(i + 1) }),
        latest ? h("button", { className: "snap-shot-star", textContent: "☆ make active", title: `make the newest take (${SC.label(latest)}) this shot's active take; the takes strip's ☆ picks another`,
          onclick: (e) => { e.stopPropagation(); act(async () => (await run("set_active_take", { scene: scene.id, shot: shot.id, take: latest.id }), `${SC.label(latest)} is now ${SC.shotTitle(scene, shot)}'s take`)); } }) : null,
        jobs ? h("span", { className: `snap-shot-jobs ${jobs.state}`, textContent: String(jobs.n), title: `${jobs.n} open job${jobs.n === 1 ? "" : "s"} (the Work card has them):\n${jobs.titles.join("\n")}` }) : null),
      h("button", { className: "snap-shot-more", textContent: "⋯", title: "rename, re-run its take with swaps, or take it out of the scene", ariaLabel: `${SC.shotTitle(scene, shot)}: more`,
        onclick: (e) => { e.stopPropagation(); shotMenu(e.currentTarget, scene, shot); } }),
      h("figcaption", {}, h("strong", { textContent: shot.name || `Shot ${i + 1}` }),
        h("span", { className: "snap-quiet", textContent: n ? (active ? `${n} take${n === 1 ? "" : "s"} · ★ ${SC.label(active)}` : `no active take · ${n} take${n === 1 ? "" : "s"}`) : card ? "from its shot card" : "empty" })));
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
    const add = (card) => () => { close(); act(async () => opened(scene.id, (await SC.addShot(scene.id, { card })).shot.id)); };
    const menu = h("div", { className: "snap-scene-menu", role: "menu" },
      h("button", { textContent: "Empty shot", title: "starts from the open shot's recipe", onclick: add(null) }),
      L.search("shot").filter((c) => c.kind === "shot").map((c) => h("button", { textContent: c.title, title: c.text, onclick: add(c.id) })));
    const r = anchor.getBoundingClientRect(), box = host.getBoundingClientRect();
    Object.assign(menu.style, { top: `${r.bottom - box.top + 4}px`, right: `${box.right - r.right}px` });
    host.append(menu);
    addEventListener("pointerdown", outside, true);
  }

  // a shot's ⋯: rename it, re-run its take with swaps (SNAP-R63), or take it out of the scene (its takes and workflow are kept; see scenes.js removeShot)
  function shotMenu(anchor, scene, shot) {
    host.querySelector(".snap-scene-menu")?.remove();
    const close = () => { menu.remove(); removeEventListener("pointerdown", outside, true); };
    const outside = (e) => { if (!menu.contains(e.target)) close(); };
    const name = h("input", { className: "snap-lib-q", value: shot.name ?? "", placeholder: SC.shotTitle(scene, shot), ariaLabel: "shot name" });
    const rename = () => { close(); act(async () => `Renamed: ${(await SC.renameShot(scene.id, shot.id, name.value)).title}`); };
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); rename(); } if (e.key === "Escape") { e.stopPropagation(); close(); } });
    const n = SC.takesOf(shot).length, take = T.get(shot.active) ?? T.get(SC.takesOf(shot).at(-1)?.take); // the shot's active take, else its newest
    const confirm = h("div", { className: "snap-scene-confirm", hidden: true },
      h("span", { className: "snap-quiet", textContent: `${n ? `Its ${n} take${n === 1 ? "" : "s"} and its workflow stay` : "Its workflow stays"}; the scene's file lists it under removed.` }),
      h("button", { className: "snap-danger", textContent: `Remove ${SC.shotTitle(scene, shot)}`, onclick: () => { close(); act(async () => (await SC.removeShot(scene.id, shot.id)).said); } }));
    const menu = h("div", { className: "snap-scene-menu", role: "menu" },
      h("div", { className: "snap-scene-rename" }, name, h("button", { className: "snap-primary", textContent: "Rename", onclick: rename })),
      take?.graph ? h("button", { textContent: `Re-run take ${take.number} with swaps…`, title: `${SC.label(take)}, the shot's ${shot.active === take.id ? "active" : "newest"} take, with another version, character, set, scene or setup (SNAP-R63)`, onclick: () => { close(); rerun?.(take); } }) : null,
      AL.button(`shot:${scene.id}/${shot.id}`, { say, then: close }), // SNAP-R93 what agents get for this shot
      h("button", { textContent: "Remove from the scene…", onclick: (e) => { e.currentTarget.hidden = true; confirm.hidden = false; } }), confirm);
    const r = anchor.getBoundingClientRect(), box = host.getBoundingClientRect();
    Object.assign(menu.style, { top: `${r.bottom - box.top + 4}px`, left: `${Math.max(8, r.left - box.left - 200)}px` });
    host.append(menu);
    addEventListener("pointerdown", outside, true);
    name.focus({ preventScroll: true }); name.select();
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
      return opened(s.id, (await SC.addShot(s.id)).shot.id);
    });
    name.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); create(); } });
    const row = (s) => {
      const info = SC.summary(s), setCard = s.set && L.get(s.set);
      const title = h("strong", { textContent: s.name }), line = h("span", { className: "snap-quiet", textContent: `${info.shots} shot${info.shots === 1 ? "" : "s"} · ${info.takes} take${info.takes === 1 ? "" : "s"}${setCard ? ` · ${setCard.title.replace(/^Set snapshot:\s*/, "")}` : ""}${info.open ? " · open here" : ""}` });
      const nameBox = h("div", { className: "snap-scene-name" }, title, line);
      // Rename turns the name into a field (Enter keeps it, Esc leaves it); Delete asks once, saying what is kept
      const rename = () => {
        const field = h("input", { className: "snap-lib-q", value: s.name, ariaLabel: "scene name" });
        const done = (keep) => { if (!field.isConnected) return; if (!keep || field.value.trim() === s.name) { field.replaceWith(title); return; } SC.renameScene(s.id, field.value).then(() => sheet.isConnected && rows.replaceChildren(...SC.all().map(row)), (err) => say(err.message, true)); };
        field.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); done(true); } if (e.key === "Escape") { e.stopPropagation(); done(false); } });
        field.addEventListener("blur", () => done(true));
        title.replaceWith(field); field.focus(); field.select();
      };
      const acts = h("div", { className: "snap-scene-acts" },
        AL.button(`scene:${s.id}`, { say }),
        h("button", { className: "snap-link snap-quiet-btn", textContent: "Rename", onclick: rename }),
        h("button", { className: "snap-link snap-quiet-btn", textContent: "Delete", onclick: () => acts.replaceChildren(
          h("span", { className: "snap-quiet", textContent: `Delete ${s.name}? Its document is parked in snap/scenes/_parked/; its takes and shot workflows are kept.` }),
          h("button", { className: "snap-danger", textContent: "Delete scene", onclick: () => SC.removeScene(s.id).then((r) => { say(r.said); onOpened(); if (sheet.isConnected) rows.replaceChildren(...(SC.all().length ? SC.all().map(row) : [h("div", { className: "snap-quiet", textContent: "No scenes yet." })])); }, (err) => say(err.message, true)) }),
          h("button", { className: "snap-link snap-quiet-btn", textContent: "Keep", onclick: () => sheet.isConnected && rows.replaceChildren(...SC.all().map(row)) })) }),
        canAdopt ? h("button", { className: "snap-link", textContent: "Add this workflow", title: `this workflow and its ${n} take${n === 1 ? "" : "s"} become a shot of ${s.name} (this tab stays as it is)`, onclick: () => go(async () => (await SC.addShot(s.id, { adopt: "open" })).opened) }) : null,
        h("button", { className: "snap-primary", textContent: "Open", onclick: () => go(async () => opened(s.id, (here?.scene.id === s.id ? here.shot : s.shots[0])?.id ?? (await SC.addShot(s.id)).shot.id)) }));
      const el = h("div", { className: `snap-scene-row${info.open ? " on" : ""}` }, nameBox,
        h("div", { className: "snap-scene-thumbs" }, s.shots.map((x, i) => h("div", { className: "snap-shot-media", title: SC.shotTitle(s, x) }, thumb(T.get(x.active), ""), h("b", { textContent: String(i + 1) })))), acts);
      el.dataset.scene = s.id;
      return el;
    };
    const rows = h("div", { className: "snap-scene-list" }, SC.all().length ? SC.all().map(row) : h("div", { className: "snap-quiet", textContent: "No scenes yet." }));
    const sheet = h("div", { className: "snap-sheet snap-scenes-sheet", role: "dialog", ariaLabel: "Scenes" },
      h("header", {}, h("strong", { textContent: "Scenes" }), h("span", { className: "snap-quiet", textContent: "a scene owns its shots, their takes and versions · tabs are scratch" }), h("span", { className: "snap-spacer" }),
        h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
      rows,
      h("footer", { className: "snap-scene-new" }, name, set, withThis ? h("label", { className: "snap-check" }, withThis, `with this workflow and its ${n} take${n === 1 ? "" : "s"} as Shot 1`) : null,
        h("button", { className: "snap-primary", textContent: "New scene", onclick: create })));
    sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
    host.append(sheet);
    (adopt ? name : sheet.querySelector(".snap-primary"))?.focus({ preventScroll: true });
  }

  return { el, render, openScenes };
}
