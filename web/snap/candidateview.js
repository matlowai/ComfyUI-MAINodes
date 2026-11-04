// The candidates strip (U32): one tile per candidate of a decision with its pictures, provenance and pre-screen notes,
// Apply / Reject while it is ready, Undo once applied, and the agent's recommendation when one waits (its proposal).
// Hovering or pressing a tile previews it in place (C.preview: the plate slot or the take viewer shows it, nothing is
// edited). The buttons call the same functions as the apply_candidate / reject_candidate / undo_candidate tools.
// SNAP-R7 lists keep their elements while a pointer is down · SNAP-R17 by · SNAP-R23 candidates · see docs/SNAP_RULES.md
import * as C from "./candidates.js";
import * as P from "./proposals.js";
import { url } from "./checks.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const TOOL = { apply_candidate: "recommends this one", reject_candidate: "suggests rejecting it" };

// the notes as short chips: amber when a check found something to look at
export function noteChips(c) {
  const n = c.notes, out = [];
  if (n.copy) out.push(h("span", { className: `snap-cand-note${n.copy.likely_copy ? " warn" : ""}`, textContent: `${n.copy.likely_copy ? "likely copy" : "copy"} ${n.copy.score.toFixed(2)}`,
    title: `last frame against the wide plate: ${n.copy.score} (a copy of its view at or above ${n.copy.threshold}); push-ins score like new views, so look` }));
  if (n.layout) out.push(n.layout.error ? h("span", { className: "snap-cand-note", textContent: "layout: not checked", title: n.layout.error })
    : h("span", { className: `snap-cand-note${n.layout.as_planned < n.layout.checked ? " warn" : ""}`, textContent: `layout ${n.layout.as_planned}/${n.layout.checked}${n.layout.order ? ` · order ${n.layout.order}` : ""}`,
      title: `where ${n.layout.detector} finds each thing against the plan:\n${n.layout.rows.map((r) => `${r.ok === false ? "✗" : r.ok ? "✓" : "·"} ${r.name}: plan ${r.plan}, found ${r.found}`).join("\n")}` }));
  // identity (U61): a chip per flag, else the two numbers quietly; the head crops on the tile decide
  const id = n.identity, sign = (x) => `${x > 0 ? "+" : ""}${x}`;
  if (id?.error) out.push(h("span", { className: "snap-cand-note", textContent: "identity: not checked", title: id.error }));
  else if (id && !("face_low" in id)) out.push(h("span", { className: "snap-cand-note", textContent: "identity: older check", title: "a note from the DINOv3 head-crop check, which couldn't tell grey hair from kept hair; check again for the face and hair notes" }));
  else if (id) {
    const faces = `ArcFace on the face, the take's frame against the edit: ${id.scores.map((s) => s.face ?? "no face").join(", ")}`, hair = `lit hair (L* p90) against the take's frames (median ${id.hair_base ?? "?"}): ${id.scores.map((s) => (s.hair == null ? "not read" : sign(s.hair))).join(", ")}`;
    const missed = `${id.scores.some((s) => s.no_head) ? "; no head found in one of the crops" : ""}${id.unread ? `; not read: ${id.unread.faces} face(s), ${id.unread.hair} hair` : ""}`;
    if (id.different) out.push(h("span", { className: "snap-cand-note warn", textContent: "probably a different person", title: `${faces}; below ${id.different_person} it is likely someone else, but dark frames and profiles score low too: compare the head crops${missed}` }));
    if (id.lighter) out.push(h("span", { className: "snap-cand-note warn", textContent: "hair lighter than original", title: `${hair}; above ${sign(id.hair_lighter)} the edit lightened her hair (it catches grey and silver, not blonder): compare the head crops${missed}` }));
    if (!id.different && !id.lighter) out.push(h("span", { className: "snap-cand-note", textContent: `face ${id.face_low?.toFixed(2) ?? "–"} · hair ${id.hair_up == null ? "–" : sign(id.hair_up)}`,
      title: `no identity flag. ${faces}; ${hair}. These miss blonder hair and drift on profiles: the head crops decide${missed}` }));
  }
  if (!out.length && c.state === "ready") out.push(h("span", { className: "snap-cand-note", textContent: "checking…" }));
  return out;
}

// `say` reports results; `crops: true` also shows the identity check's head crops (original | edit) on the tile
export function candidatesEl(d, { say, crops } = {}) {
  const act = async (fn, done) => { try { await fn(); if (done) say?.(done); } catch (err) { say?.(err.message, true); } };
  const waiting = P.pending().filter((p) => TOOL[p.tool] && p.args.decision === d.id);
  const tiles = d.candidates.map((c) => {
    const rec = waiting.find((p) => p.args.candidate === c.id);
    // the person answers an agent's recommendation on the tile itself: Apply here is the pick, the proposal is settled with it
    const settle = (accept) => rec && P.decide(rec.id, accept, async () => ({ by: "person" }));
    const buttons = c.state === "ready" ? [
      h("button", { className: "snap-primary", textContent: "Apply", title: "use this one (Undo takes it back)", onclick: () => act(async () => { await C.apply(d.id, c.id, "person"); if (rec?.tool === "apply_candidate") await settle(true); else if (rec) await settle(false); }, `${d.title}: ${c.id} applied`) }),
      h("button", { className: "snap-link snap-quiet-btn", textContent: "Reject", onclick: () => act(async () => { await C.reject(d.id, c.id, "person"); if (rec) await settle(rec.tool === "reject_candidate"); }) })]
      : c.state === "applied" ? [h("span", { className: "snap-cand-on", textContent: `✓ applied by ${d.applied?.by ?? "person"}` }), h("button", { className: "snap-link snap-quiet-btn", textContent: "Undo", onclick: () => act(() => C.undo(d.id, "person"), `${d.title}: undone`) })]
      : [h("span", { className: "snap-quiet", textContent: c.state === "rendering" ? "rendering…" : c.state === "failed" ? `failed: ${c.error ?? ""}` : `rejected by ${c.rejected?.by ?? "person"}` })];
    const pics = c.pictures.length ? c.pictures.map((p) => h("img", { src: url(p.media), alt: p.label, title: p.label, loading: "lazy" })) : [h("div", { className: "snap-cand-none" })];
    const id = crops && c.notes.identity?.scores;
    const tile = h("figure", { className: `snap-cand ${c.state}${rec ? " recommended" : ""}`, tabIndex: 0 },
      h("div", { className: "snap-cand-pics" }, pics),
      id ? h("div", { className: "snap-cand-crops", title: "head crops: the take's frame | the edit" }, id.flatMap((s) => s.crops.filter(Boolean).map((m) => h("img", { src: url(m), alt: "head crop", loading: "lazy" })))) : null,
      h("figcaption", {},
        h("div", { className: "snap-cand-line" }, h("b", { textContent: c.id }), h("span", { className: "snap-quiet", textContent: [c.seed != null ? `seed ${c.seed}` : null, c.made?.lora ? c.made.lora.replace(/\.safetensors$/, "").replace(/_/g, " ").slice(0, 28) : null, c.by !== "person" ? `by ${c.by}` : null].filter(Boolean).join(" · ") })),
        h("div", { className: "snap-cand-notes" }, noteChips(c)),
        rec ? h("div", { className: "snap-cand-rec" }, h("span", { className: "snap-agent", textContent: "agent" }), ` ${TOOL[rec.tool]}: ${rec.reason}`) : null,
        h("div", { className: "snap-cand-actions" }, buttons)));
    tile.addEventListener("pointerenter", () => C.preview(d, c));
    tile.addEventListener("focus", () => C.preview(d, c));
    tile.addEventListener("pointerleave", () => C.preview(null));
    tile.addEventListener("blur", () => C.preview(null));
    tile.dataset.candidate = c.id;
    return tile;
  });
  const el = h("div", { className: "snap-cands", role: "group", ariaLabel: d.title }, tiles);
  el.dataset.decision = d.id;
  return el;
}
