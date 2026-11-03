// Set Snapshot editor (UX_SPEC 7): the 2D blocking plan is the authority. Drag props, actor marks and the camera;
// drag an arrow tip to turn an actor or aim the camera. The set block and the 180-degree check update live; Apply
// refreshes the set pictures in References, Save keeps the edited state as a new card in the user's Library.
import { drawPlan, planFrame, setBlock, blocking, coverage } from "./setsnap.js";
import { diff, eyelines } from "./continuity.js";

const GRID = 0.05;
const REACH = 0.6; // actor arrow length in metres; the camera's aim handle sits 1.4x further out
const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null)); return el; };
const snapTo = (v) => Math.round(v / GRID) * GRID;
const bearing = (from, to) => ((Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI + 360) % 360;
const tip = (o, len) => [o.at[0] + Math.sin((o.facing * Math.PI) / 180) * len, o.at[1] + Math.cos((o.facing * Math.PI) / 180) * len];
const near = (a, b, r) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= r;

export function openSetEditor(host, card, { onApply, onSave }) {
  const s = structuredClone(card.brick.snapshot);
  // the end of the shot this one continues from: continuity (and the 180-degree line) is judged against it
  if (!s.previous) { const { previous, ...end } = structuredClone(s); s.previous = end; }
  let dirty = true;
  const plan = h("canvas", { className: "snap-set-plan", tabIndex: 0, ariaLabel: "set plan: drag to block the scene" });
  const blockText = h("p", { className: "snap-set-block" }), blockingText = h("p", { className: "snap-set-block" });
  const notes = h("ul", { className: "snap-set-notes", role: "status" });
  const dialogue = h("input", { type: "checkbox", checked: !!s.dialogue, onchange: () => { s.dialogue = dialogue.checked; dirty = true; } });
  let showCoverage = false;
  const shot = h("input", { value: s.shot, oninput: () => { s.shot = shot.value; dirty = true; } });
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const sheet = h("div", { className: "snap-sheet", role: "dialog", ariaLabel: `edit ${card.title}` },
    h("header", {}, h("strong", { textContent: card.title }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
    h("div", { className: "snap-set-body" }, plan,
      h("aside", {}, h("label", { className: "snap-field" }, h("span", { textContent: "this state is the end of" }), shot),
        h("div", { className: "snap-rail-title", textContent: "Set block" }), blockText, h("div", { className: "snap-rail-title", textContent: "Blocking" }), blockingText,
        h("div", { className: "snap-rail-title", textContent: "Changes since the last shot" }), notes,
        h("div", { className: "snap-set-actions" },
          h("label", { className: "snap-check" }, dialogue, " dialogue scene (check eyelines)"),
          h("button", { className: "snap-link", textContent: "Coverage", title: "show the standard setups for these two actors on this side of the line; click one to use it", onclick: () => { showCoverage = !showCoverage; dirty = true; } })),
        h("div", { className: "snap-set-actions" },
          h("button", { className: "snap-primary", textContent: "Use in References", onclick: () => { onApply(s); close(); } }),
          h("button", { className: "snap-link", textContent: "Save as new card", onclick: () => onSave(s) })),
        h("div", { className: "snap-quiet", textContent: "drag things on the plan · drag an arrow tip to turn · arrows nudge 5 cm · Esc closes" }))));
  host.append(sheet);

  let selected = null, drag = null;
  function hit(world) {
    if (showCoverage) for (const c of coverage(s)) if (near(world, c.at, 0.3)) return { setup: c };
    if (near(world, tip(s.camera, REACH * 1.4), 0.2)) return { o: s.camera, turn: true };
    for (const a of s.actors) if (near(world, tip(a, REACH), 0.2)) return { o: a, turn: true };
    if (near(world, s.camera.at, 0.3)) return { o: s.camera };
    for (const a of s.actors) if (near(world, a.at, 0.3)) return { o: a };
    for (const p of [...s.props].reverse()) if (Math.abs(world[0] - p.at[0]) <= p.size[0] / 2 && Math.abs(world[1] - p.at[1]) <= p.size[1] / 2) return { o: p };
    return null;
  }
  const toWorld = (e) => { const r = plan.getBoundingClientRect(); return planFrame(s).world(((e.clientX - r.left) / r.width) * plan.width, ((e.clientY - r.top) / r.height) * plan.height); };
  const inside = (v, i) => Math.max(-s.room.size[i] / 2, Math.min(s.room.size[i] / 2, v));

  plan.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    const target = hit(toWorld(e));
    if (target?.setup) { // take a coverage setup as the camera
      const { name, ...cam } = target.setup;
      Object.assign(s.camera, cam);
      selected = s.camera; showCoverage = false; dirty = true;
      return;
    }
    selected = target?.o ?? null;
    dirty = true;
    if (!target) return;
    const w = toWorld(e);
    drag = { ...target, id: e.pointerId, offset: [target.o.at[0] - w[0], target.o.at[1] - w[1]] };
    plan.setPointerCapture(e.pointerId);
  });
  plan.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const w = toWorld(e);
    if (drag.turn) drag.o.facing = Math.round(bearing(drag.o.at, w));
    else drag.o.at = [snapTo(inside(w[0] + drag.offset[0], 0)), snapTo(inside(w[1] + drag.offset[1], 1))];
    dirty = true;
  });
  for (const ev of ["pointerup", "pointercancel"]) plan.addEventListener(ev, () => { drag = null; });
  sheet.addEventListener("keydown", (e) => {
    e.stopPropagation(); // keys in the sheet belong to the sheet, not the bricks behind it
    if (e.key === "Escape") { close(); return; }
    const step = { ArrowLeft: [-GRID, 0], ArrowRight: [GRID, 0], ArrowUp: [0, GRID], ArrowDown: [0, -GRID] }[e.key];
    if (!step || !selected || e.target.closest("button,input,textarea")) return;
    e.preventDefault();
    selected.at = [snapTo(inside(selected.at[0] + step[0], 0)), snapTo(inside(selected.at[1] + step[1], 1))];
    dirty = true;
  });

  // one redraw per frame while open, only when something changed
  (function frame() {
    if (!sheet.isConnected) return;
    if (dirty) {
      dirty = false;
      drawPlan(s, { into: plan, selected, handles: true, ghosts: showCoverage ? coverage(s) : [] });
      blockText.textContent = setBlock(s);
      blockingText.textContent = blocking(s);
      const found = [...diff(s.previous, s), ...eyelines(s)];
      notes.replaceChildren(...(found.length ? found.map((f) => h("li", { className: f.severity }, h("b", { textContent: f.severity }), ` ${f.what}`)) : [h("li", { className: "none", textContent: "nothing changed" })]));
    }
    requestAnimationFrame(frame);
  })();
  plan.focus({ preventScroll: true });
  return sheet;
}
