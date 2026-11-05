// The opened-file sheet (Dylan 22:44): a saved picture or video opened or dropped in Snap carries its recipe (core's
// prompt + workflow) and the record versions it pinned (extra.snap.world). The sheet lists each pin against today's
// version with what differs, and offers Run as it was / Run with today's world / Edit then run (each pinned version
// opens in its editor; saving there makes a new version, and the recipe takes it when the person uses it).
// SNAP-R61 re-run as it was, with today's world, or edited · SNAP-R60 pins · SNAP-R5 nothing changes until a press ·
// see docs/SNAP_RULES.md
import * as E from "./engine.js";
import * as R from "./retake.js";
import * as T from "./takes.js";
import * as W from "./world.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };

// `edit(ref, n)` opens a pinned version in its editor (the view knows the Cast sheet and the set editor)
export async function openWorldSheet(host, { name, say, edit }) {
  for (const s of host.querySelectorAll(".snap-opened-sheet, .snap-world-sheet")) s.remove(); // one of the two at a time: they sit in the same place
  await W.load();
  const world = E.state().world ?? {}, moved = new Map((await R.differs(world)).map((m) => [m.ref, m]));
  const pins = Object.entries(world);
  const status = h("div", { className: "snap-quiet", role: "status" });
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const run = (worldMode) => async () => {
    try { const r = await R.runOpen({ world: worldMode }); say?.(`Running ${R.worldShown(worldMode)}${r.updated.length ? `: ${r.updated.join(" · ")}` : ""}`); close(); } catch (err) { status.textContent = err.message; }
  };
  const editable = (ref) => ref.startsWith("cast:") || ref.startsWith("set_snapshot:");
  let editing = false;
  const rows = h("div", { className: "snap-world-rows" });
  const draw = () => rows.replaceChildren(...pins.map(([ref, p]) => {
    const m = moved.get(ref), r = p.n ? W.record(...Object.values(W.parse(ref)).slice(0, 2)) : null;
    const state = !p.n ? "a pack card" : m?.missing ? "not in your records (the file still holds what it put in)" : m ? `today: v${m.now}${m.archived ? " (archived)" : ""}` : "today: the same version";
    return h("div", { className: `snap-world-row${m ? (m.missing ? " missing" : " moved") : ""}` },
      h("strong", { textContent: `${m?.name ?? p.name ?? ref}${p.n ? ` v${p.n}` : ""}` }), h("span", { className: "snap-quiet", textContent: state }),
      m?.fields?.length ? h("ul", { className: "snap-world-fields" }, m.fields.map((f) => h("li", { textContent: f }))) : null,
      m?.warning ? h("div", { className: "snap-world-warn", textContent: m.warning }) : null,
      editing && editable(ref) && r ? h("button", { className: "snap-link", textContent: `Edit v${p.n}`, title: "open this version: saving makes a new version, and Save and use puts it into this recipe", onclick: () => edit(ref, p.n) }) : null);
  }));
  const anyMoved = [...moved.values()].some((m) => !m.missing);
  const anyMissing = [...moved.values()].some((m) => m.missing);
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-opened-sheet", role: "dialog", ariaLabel: "Opened file" },
    h("header", {}, h("strong", { textContent: `${name}: made with ${pins.length} record${pins.length === 1 ? "" : "s"}` }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc): the workflow stays open as it is", onclick: close })),
    h("div", { className: "snap-opened-body" },
      h("p", { className: "snap-quiet", textContent: anyMoved ? "Some of what this file used has newer versions. Run it exactly as it was, with today's versions, or open the old ones to change first." : anyMissing ? "Some of what this file used isn't in your records any more; it still runs as the file holds it." : "Everything this file used is still at the same version: it runs as it was." }),
      rows,
      h("div", { className: "snap-set-actions" },
        h("button", { className: "snap-primary", textContent: "Run as it was", title: "the workflow as the file holds it, seed included", onclick: run("pinned") }),
        h("button", { className: "snap-link", textContent: "Run with today's world", disabled: !anyMoved, title: anyMoved ? "each record with a newer version is updated in the recipe first" : "nothing has a newer version", onclick: run("latest") }),
        h("button", { className: "snap-link", textContent: "Edit then run", title: "open the versions this file used, change them, then run", onclick: () => { editing = !editing; draw(); } })),
      status));
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  draw();
  host.append(sheet);
  sheet.querySelector(".snap-primary")?.focus();
  return sheet;
}
