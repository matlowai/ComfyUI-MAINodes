// The Location sheet (G1, U99 / F-C17): one place, kept once on its location record (snap/location/<id>.json): the
// master picture, the set plan with its camera marks drawn on it (a dot and a wedge per camera: where it stands, where it
// looks, how wide its lens sees), and the plates, each a tile with its name, its pose and the take and frame it came
// from. Every picture opens full size. Ticking plates and "Use in this shot" puts the master, the plan and those plates
// into References (L.applyLocation, pinned); saving is a new version (an unchanged body makes none), and opening an
// older version edits from it. Clicking the plan while a plate is picked places that plate there.
// SNAP-R84 locations by reference · SNAP-R60 versions · SNAP-R80 every picture full size · SNAP-R3 a missing file shows as
// missing · see docs/snap/SNAP_RULES.md
import * as L from "./library.js";
import * as W from "./world.js";
import { full } from "./lightbox.js";
import { view } from "./castview.js";
import * as CV from "./critiqueview.js"; // SNAP-R103/R106 the critic per picture, Re-run dependents
import { openPlanEditor } from "./planview.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const s = (tag, attrs = {}, ...kids) => { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); el.append(...kids); return el; };
const when = (at) => new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
// a pose in words: "38° · 24 mm · eye 1.6 m"
export const poseText = (p) => (p ? [p.heading != null && `${Math.round(p.heading)}°`, p.lens && `${p.lens} mm`, p.eye_height != null && `eye ${p.eye_height} m`].filter(Boolean).join(" · ") || "placed, no heading" : "no pose yet");
// how wide a lens sees across (a 36 mm frame), in degrees
const fov = (lens) => (2 * Math.atan(18 / lens) * 180) / Math.PI;

// the plan with every camera mark and plate pose drawn over it, in the picture's own pixels
function planView(b, { picked, onPlace, group }) {
  const img = h("img", { alt: "set plan", loading: "lazy" }), svg = s("svg", { class: "snap-loc-marks", preserveAspectRatio: "none" });
  const box = h("div", { className: `snap-loc-plan${picked ? " placing" : ""}` }, img, svg);
  const draw = () => {
    const W_ = img.naturalWidth || 1000, H = img.naturalHeight || 700, r = W_ * 0.01, len = W_ * 0.075;
    svg.setAttribute("viewBox", `0 0 ${W_} ${H}`);
    const marks = [...b.cameras.map((c) => ({ ...c, kind: "camera" })), ...b.plates.filter((p) => p.pose?.x != null).map((p) => ({ name: p.name, ...p.pose, kind: "plate" }))];
    // a plate is labelled by its name's first word (Pa, Pb…), its whole name and pose on hover and on its tile
    svg.replaceChildren(...marks.map((m) => {
      const x = m.x * W_, y = m.y * H, out = [s("title", {}, document.createTextNode(`${m.kind === "plate" ? "plate" : "camera"} ${m.name}: ${poseText(m)}`))];
      if (m.heading != null) {
        const half = fov(m.lens || 35) / 2, at = (d) => [x + len * Math.sin(((m.heading + d) * Math.PI) / 180), y - len * Math.cos(((m.heading + d) * Math.PI) / 180)];
        const [a, c] = [at(-half), at(half)];
        out.push(s("path", { d: `M${x},${y} L${a[0]},${a[1]} A${len},${len} 0 0 1 ${c[0]},${c[1]} Z`, class: `snap-loc-wedge ${m.kind}${m.name === picked ? " picked" : ""}` }));
      }
      out.push(s("circle", { cx: x, cy: y, r, class: `snap-loc-dot ${m.kind}${m.name === picked ? " picked" : ""}` }),
        s("text", { x: x + r * 1.4, y: y + (m.kind === "plate" ? -r : r * 2.6), class: `snap-loc-label ${m.kind}`, "font-size": W_ * 0.018 }, document.createTextNode(m.kind === "plate" ? m.name.split(/[\s,]/)[0] : m.name)));
      return s("g", { class: `snap-loc-mark ${m.kind}`, "data-name": m.name }, ...out);
    }));
  };
  img.onload = draw;
  img.onerror = () => box.replaceChildren(h("div", { className: "snap-cast-missing", textContent: `✕ ${b.plan.file} isn't in input/` }));
  img.src = view(b.plan.file);
  if (picked) box.addEventListener("click", (e) => { const r = img.getBoundingClientRect(); onPlace(+((e.clientX - r.left) / r.width).toFixed(3), +((e.clientY - r.top) / r.height).toFixed(3)); }, true);
  else full(box, { src: view(b.plan.file), name: `${b.name}, set plan`, source: `input/${b.plan.file}` }, group);
  draw();
  return box;
}

// open the sheet on a location (id), a version of it (n); `say` reports, `onApplied` after Use in this shot
export async function openLocation(host, { id, n = null, say, onApplied }) {
  host.querySelector(".snap-loc-sheet")?.remove();
  await Promise.all([L.ready(), W.load()]);
  const rec = W.record("location", id);
  if (!rec) throw new Error(`No location ${id}`);
  const from = n ? rec.versions.find((v) => v.n === n) : W.headOf(rec);
  const b = structuredClone(from.body), chosen = new Set(), group = `location-${id}`;
  let shown = from.n, picked = null;
  const status = h("div", { className: "snap-quiet", role: "status" });
  const title = h("strong");
  const head = () => { const r = W.record("location", id); title.textContent = `Location: ${b.name} · v${shown}${shown !== r.head ? ` (newest is v${r.head})` : ""}`; };
  const pictureFig = (pic, label, cls) => (pic ? h("figure", { className: cls },
    full(h("img", { src: view(pic.file), alt: label, loading: "lazy", onerror: (e) => { e.target.replaceWith(h("div", { className: "snap-cast-missing", textContent: `✕ ${pic.file} isn't in input/` })); } }), { src: view(pic.file), name: `${b.name}, ${label}`, source: `input/${pic.file}${pic.from ? ` · take ${pic.from.take}${pic.from.frame != null ? `, frame ${pic.from.frame}` : ""}` : ""}` }, group),
    h("figcaption", {}, h("strong", { textContent: label }), pic.from ? h("span", { className: "snap-quiet", textContent: ` from ${pic.from.take.replace(/^take-/, "").slice(0, 8)}${pic.from.frame != null ? ` f${pic.from.frame}` : ""}` }) : null))
    : h("figure", { className: `${cls} empty` }, h("div", { className: "snap-cast-missing", textContent: `no ${label} yet` })));
  const top = h("div", { className: "snap-loc-top" }), plates = h("div", { className: "snap-loc-plates" }), cams = h("div", { className: "snap-quiet snap-loc-cams" });
  const draw = () => {
    top.replaceChildren(pictureFig(b.master, "master", "snap-loc-master"),
      b.plan ? h("figure", { className: "snap-loc-planfig" }, planView(b, { picked, group, onPlace: (x, y) => { const p = b.plates.find((q) => q.name === picked); p.pose = { ...(p.pose ?? {}), x, y }; status.textContent = `${picked} placed at ${x}, ${y}: Save keeps it`; picked = null; draw(); } }),
        h("figcaption", {}, h("strong", { textContent: "set plan" }), h("span", { className: "snap-quiet", textContent: picked ? ` · click where ${picked} stands` : " · dots and wedges: where each camera stands and looks" })))
        : pictureFig(null, "set plan", "snap-loc-planfig"));
    cams.textContent = b.cameras.length ? `Camera marks: ${b.cameras.map((c) => `${c.name} (${poseText(c)})`).join("; ")}` : "No camera marks yet";
    const lit = (name, on) => top.querySelector(`.snap-loc-mark.plate[data-name="${CSS.escape(name)}"]`)?.classList.toggle("lit", on);
    plates.replaceChildren(...b.plates.map((p, i) => h("figure", { className: `snap-loc-plate${chosen.has(p.name) ? " on" : ""}`, onmouseenter: () => lit(p.name, true), onmouseleave: () => lit(p.name, false) },
      full(h("img", { src: view(p.file), alt: p.name, loading: "lazy", onerror: (e) => { e.target.replaceWith(h("div", { className: "snap-cast-missing", textContent: `✕ ${p.file} isn't in input/` })); } }),
        { src: view(p.file), name: `${b.name}, plate ${p.name}`, source: `input/${p.file}${p.from ? ` · take ${p.from.take}${p.from.frame != null ? `, frame ${p.from.frame}` : ""}` : ""}` }, group),
      h("label", { className: "snap-loc-pick", title: "put this plate into References with Use in this shot" }, h("input", { type: "checkbox", checked: chosen.has(p.name), onchange: (e) => { e.target.checked ? chosen.add(p.name) : chosen.delete(p.name); e.target.closest("figure").classList.toggle("on", e.target.checked); } }),
        h("input", { value: p.name, ariaLabel: "plate name", onchange: (e) => { const was = p.name; p.name = e.target.value.trim() || was; if (chosen.delete(was)) chosen.add(p.name); draw(); } })),
      h("div", { className: "snap-quiet", textContent: poseText(p.pose) }),
      L.eyeGaps(b)[p.name] ? h("div", { className: "snap-warn snap-loc-gap", textContent: `⚠ ${L.eyeGaps(b)[p.name]}` }) : null, // F-D10
      p.from ? h("div", { className: "snap-quiet", textContent: `take ${p.from.take.replace(/^take-/, "").slice(0, 8)}${p.from.frame != null ? `, frame ${p.from.frame}` : ""}` }) : null,
      h("input", { value: p.use ?? "", placeholder: "use for (which cuts)", ariaLabel: "use for", oninput: (e) => { p.use = e.target.value; } }),
      h("div", { className: "snap-set-actions" },
        h("button", { className: "snap-link", textContent: picked === p.name ? "click the plan…" : "place on plan", disabled: !b.plan, onclick: () => { picked = picked === p.name ? null : p.name; draw(); } }),
        h("button", { className: "snap-x", textContent: "×", title: "take this plate out of the location (the file stays; Save makes it a version)", onclick: () => { b.plates.splice(i, 1); chosen.delete(p.name); draw(); } })))));
    if (!b.plates.length) plates.append(h("div", { className: "snap-quiet", textContent: "No plates yet: add_plate saves a take's frame with its pose" }));
    head();
  };
  const versions = h("div", { className: "snap-cast-versions" });
  const drawVersions = () => { const r = W.record("location", id);
    versions.replaceChildren(h("div", { className: "snap-rail-title", textContent: `Versions (${r.versions.length})` }), ...[...r.versions].reverse().map((v) => h("button", {
      className: `snap-cast-version${v.n === shown ? " on" : ""}`, title: `${v.note || "no note"} · ${v.by} · ${v.hash.slice(0, 12)}`, onclick: () => openLocation(host, { id, n: v.n, say, onApplied }) },
      h("strong", { textContent: `v${v.n}${v.n === r.head ? " · newest" : ""}` }), h("span", { className: "snap-quiet", textContent: `${when(v.at)}${v.note ? ` · ${v.note}` : ""}` })))); };
  const notes = h("textarea", { rows: 4, value: b.notes ?? "", placeholder: "what this place is: its layout, what holds in every view", ariaLabel: "notes", oninput: () => { b.notes = notes.value; } });
  const note = h("input", { placeholder: "what changed (optional, shown in the version list)", ariaLabel: "version note" });
  const act = (fn) => async () => { try { await fn(); } catch (err) { status.textContent = err.message; say?.(err.message, true); } };
  const saveIt = async () => { const out = await L.saveLocation(id, b, { note: note.value.trim(), by: "person" }); shown = out.n; status.textContent = out.made ? `Saved ${b.name} v${out.n}` : `Nothing changed: ${b.name} stays v${out.n}`; drawVersions(); head(); return out; };
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-cast-sheet snap-loc-sheet", role: "dialog", ariaLabel: "Location" },
    h("header", {}, title, h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
    h("div", { className: "snap-cast-body" },
      h("div", { className: "snap-cast-fields" }, top, cams, h("div", { className: "snap-rail-title", textContent: `Plates (${b.plates.length}): tick the ones this shot cites` }), plates),
      h("aside", {}, versions, CV.locationBlock({ id, n: shown, say }), h("label", { className: "snap-field" }, h("span", { textContent: "name" }), h("input", { value: b.name, ariaLabel: "name", oninput: (e) => { b.name = e.target.value; } })),
        h("div", { className: "snap-rail-title", textContent: "Notes" }), notes, note,
        h("div", { className: "snap-set-actions" },
          h("button", { className: "snap-primary", textContent: "Use in this shot", title: "the master, the plan and the ticked plates into References, each as a <Picture n>; the shot pins this version", onclick: act(async () => {
            const ref = W.refOf("location", id, JSON.stringify(b) !== JSON.stringify(from.body) ? (await saveIt()).n : shown); // edits are saved first: a take pins a version
            const out = await L.applyLocation(ref, { plates: b.plates.filter((p) => chosen.has(p.name)).map((p) => p.name) });
            status.textContent = out.said; say?.(out.said); onApplied?.();
          }) }),
          h("button", { className: "snap-link", textContent: "Save", onclick: act(saveIt) }),
          h("button", { className: "snap-link", textContent: b.plan?.shapes ? "Edit the plan" : "Draw the plan", title: "shapes, labels and camera marks on a top view, saved as this place's plan (SNAP-R133)", onclick: act(() => openPlanEditor(host, { id, say, onSaved: () => openLocation(host, { id, say, onApplied }) })) })),
        status)));
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  draw(); drawVersions();
  host.append(sheet);
  return sheet;
}
