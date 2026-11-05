// New view from these pictures (U101): the context tray in the take viewer. "Add this picture" (a still), "Add this
// frame" (a video take at the playhead) or the marked region as a crop puts a picture in the tray; a Cast's picture comes
// from the picker. The tray is ordered, and what Picture 1 is comes from the picked model (P-H3-Image: the picture
// edited; the Fizgig H3 still: the first reference; the words move the camera), so each row moves up or down and goes with ✕; the
// tray stays while the person opens other takes (page state only, never saved). The words are the person's, and Make
// runs the same ED.fromContext as the edit_from_context tool.
// SNAP-R71 a new view is an edit from context, in the person's words · SNAP-R72 what Picture 1 is, per model; the order is
// the person's · SNAP-R75 the model is the person's pick (P-H3-Image, the Fizgig H3 still) · SNAP-R19 the tool table is the
// API · SNAP-R23 candidates · see docs/SNAP_RULES.md
import * as ED from "./edits.js";
import * as S from "./slots.js";
import * as T from "./takes.js";
import * as W from "./world.js";
import { url } from "./checks.js";
import { full } from "./lightbox.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const tray = [], listeners = new Set();
const changed = () => { for (const fn of listeners) fn(); };
export const pictures = () => tray;
const pct = (x) => `${Math.round(x * 1000) / 10}%`;
const inputUrl = (file) => { const cut = file.lastIndexOf("/"); return url({ filename: file.slice(cut + 1), subfolder: file.slice(0, Math.max(cut, 0)), type: "input" }); };

// the panel for take `t`: `frame()` is the playhead's frame (null on a still), `region()` the marked box or null
export function contextPanel(t, { say, frame, region }) {
  const rows = h("ol", { className: "snap-ctx" }), note = h("div", { className: "snap-quiet", role: "status" });
  const words = h("textarea", { className: "snap-note-input", rows: 3, ariaLabel: "what the new still shows",
    placeholder: "what the new still shows, e.g. the same gatehouse from inside the square at eye height; the woman in Picture 3 on the left" });
  const model = h("select", { ariaLabel: "model" }), count = h("input", { type: "number", min: 1, step: 1, value: 2, ariaLabel: "candidates", className: "snap-take-clips" });
  const cast = h("select", { ariaLabel: "add a Cast picture" }), intro = h("div", { className: "snap-quiet" });
  let methods = [];
  const one = () => methods.find((x) => x.id === model.value)?.picture_one ?? null; // what Picture 1 is for the picked model
  const thumb = (p) => { const still = p.take && p.frame == null && T.get(p.take)?.media.find((m) => m.kind === "image"); return still ? url(still) : p.file ? inputUrl(p.file) : null; };
  function paint() {
    rows.replaceChildren(...tray.map((p, i) => h("li", { className: "snap-ctx-row" },
      thumb(p) ? full(h("img", { src: thumb(p), alt: "", loading: "lazy", ...(p.crop ? { style: `object-view-box: inset(${pct(p.crop[1])} ${pct(1 - p.crop[0] - p.crop[2])} ${pct(1 - p.crop[1] - p.crop[3])} ${pct(p.crop[0])})` } : {}) }), { src: thumb(p), name: `Picture ${i + 1} · ${p.label}`, source: p.file ? `input/${p.file}` : p.take ? `take ${T.get(p.take)?.number ?? p.take}` : p.cast ?? "" }, "tray") // the crop as the edit reads it
        : h("span", { className: "snap-ctx-none", textContent: "▣" }),
      h("span", { className: "snap-ctx-what" }, h("b", { textContent: `Picture ${i + 1}` }), i === 0 && one() ? h("em", { textContent: ` ${one().label}`, title: one().tip }) : null, h("span", { className: "snap-quiet", textContent: ` · ${p.label}` })),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "↑", title: `earlier${one() ? ` (Picture 1 ${one().label})` : ""}`, disabled: i === 0, onclick: () => { tray.splice(i - 1, 0, ...tray.splice(i, 1)); changed(); } }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "↓", title: "later", disabled: i === tray.length - 1, onclick: () => { tray.splice(i + 1, 0, ...tray.splice(i, 1)); changed(); } }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "✕", title: "take it out of the pictures", onclick: () => { tray.splice(i, 1); changed(); } }))));
    if (!tray.length) rows.append(h("li", { className: "snap-quiet", textContent: `No pictures yet: add this one, a marked region of it, or a Cast's picture.${one() ? ` Picture 1 ${one().label}.` : ""}` }));
    intro.textContent = `A new still from the pictures below, in your words: the same place from another camera, a person put in.${one() ? ` ${one().tip}.` : ""}`;
    make.disabled = !tray.length;
    make.textContent = `Make ${Math.max(1, Number(count.value) || 1)} candidate${Number(count.value) === 1 ? "" : "s"}`;
  }
  const add = () => {
    const box = region(), at = frame(), what = at == null ? `take ${t.number}` : `take ${t.number}, frame ${at}`;
    tray.push({ take: t.id, ...(at != null ? { frame: at } : {}), ...(box ? { crop: box.map((x) => Math.round(x * 1000) / 1000) } : {}), label: box ? `${what} (marked region)` : what });
    changed();
  };
  const addBtn = h("button", { className: "snap-link", textContent: "＋ Add this picture", title: "this still, the frame at the playhead, or the region you marked, as the next picture", onclick: add });
  const make = h("button", { className: "snap-primary", onclick: async () => {
    make.disabled = true;
    try {
      const r = await ED.fromContext(tray.map(({ label, ...p }) => ({ ...p, label })), words.value, { method: model.value || undefined, count: Math.max(1, Number(count.value) || 1) });
      note.textContent = `Painting ${r.candidates.length} candidate${r.candidates.length > 1 ? "s" : ""} into ${r.lands}${r.seconds_each ? ` (about ${r.seconds_each} s each)` : ""}: ${r.pictures.join(" · ")}. They show under ${tray[0].take ? "Picture 1's take" : "the Work card"}; Apply one to make it the shot's take`;
    } catch (err) { note.textContent = err.message; say?.(err.message, true); }
    paint();
  } });
  count.oninput = paint;
  cast.onchange = () => { const [ref, i] = cast.value.split("#"); if (!ref) return; const b = W.get(ref)?.version.body, r = b?.refs[Number(i)];
    if (r) { tray.push({ cast: ref, ref: Number(i), file: r.file, label: `${b.name}, ${r.role}` }); changed(); } cast.value = ""; };
  Promise.all([S.load(), W.load()]).then(() => {
    const list = methods = S.list("view");
    model.replaceChildren(...list.map((x) => h("option", { value: x.id, textContent: `${x.title.replace(/^New view · /, "")}${x.install_state === "ready" ? "" : ` (${x.install_state})`}` })));
    const picked = () => { // what the picked model is good at, in the tooltip
      const m = list.find((x) => x.id === model.value);
      make.title = model.title = [m?.install_state === "ready" ? m.guidance?.line : m?.install_state, ...(m?.constraints ?? []), m?.credit && `Powered by ${m.credit}`].filter(Boolean).join("\n");
    };
    model.onchange = () => { picked(); paint(); }; picked(); paint();
    cast.replaceChildren(h("option", { value: "", textContent: "＋ a Cast's picture…" }), ...W.all("cast").flatMap((r) => { const b = W.headOf(r).body; return b.refs.map((x, i) => h("option", { value: `cast:${r.id}#${i}`, textContent: `${b.name}, ${x.role}` })); }));
  }, (err) => { note.textContent = `New view unavailable: ${err.message}`; });
  const redraw = () => { if (rows.isConnected) paint(); };
  listeners.add(redraw);
  paint();
  return [h("div", { className: "snap-rail-title", textContent: "New view from these pictures" }),
    intro,
    rows, h("div", { className: "snap-set-actions" }, addBtn, cast), words, h("div", { className: "snap-set-actions" }, model, h("label", { className: "snap-quiet" }, count, " candidates"), make), note];
}
