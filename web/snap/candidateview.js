// The candidates strip (U32): one tile per candidate of a decision with its pictures, provenance and pre-screen notes,
// Apply / Reject while it is ready, Undo once applied, and the agent's recommendation when one waits (its proposal).
// Hovering or pressing a tile previews it in place (C.preview: the plate slot or the take viewer shows it, nothing is
// edited). The buttons call the same functions as the apply_candidate / reject_candidate / undo_candidate tools.
// SNAP-R7 lists keep their elements while a pointer is down · SNAP-R17 by · SNAP-R23 candidates · SNAP-R76 a score per
// person, with that person's crops · SNAP-R79 copied Picture n · see docs/SNAP_RULES.md
import * as C from "./candidates.js";
import * as P from "./proposals.js";
import * as ED from "./edits.js";
import { url } from "./checks.js";
import { full } from "./lightbox.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const TOOL = { apply_candidate: "recommends this one", reject_candidate: "suggests rejecting it" };

// the notes as short chips: amber when a check found something to look at
export function noteChips(c) {
  const n = c.notes, out = [];
  if (n.copy) out.push(h("span", { className: `snap-cand-note${n.copy.likely_copy ? " warn" : ""}`, textContent: `${n.copy.likely_copy ? "likely copy" : "copy"} ${n.copy.score.toFixed(2)}`,
    title: `last frame against the wide plate: ${n.copy.score} (a copy of its view at or above ${n.copy.threshold}); push-ins score like new views, so look` }));
  // a new view (F-C14): "copied Picture n" when its copy score against a context picture reaches the threshold
  if (n.copied) out.push(...(n.copied.error ? [h("span", { className: "snap-cand-note", textContent: "copy: not checked", title: n.copied.error })]
    : n.copied.copied.length ? n.copied.against.filter((a) => n.copied.copied.includes(a.n)).map((a) => h("span", { className: "snap-cand-note warn", textContent: `copied Picture ${a.n} ${a.score.toFixed(2)}`,
      title: `copy score against Picture ${a.n} (${a.label}): ${a.score}, at or above ${n.copied.threshold}: it likely re-renders that picture's view; look before you apply it` }))
    : (() => { const top = n.copied.against.filter((a) => a.score != null).sort((a, b) => b.score - a.score)[0]; // the nearest picture, said quietly: a re-drawn
      // view of a picture (P01's turned aerials of the master, 0.52-0.54) scores under the threshold, above new views (0.42-0.45)
      return [h("span", { className: "snap-cand-note", textContent: top ? `no copy · nearest Picture ${top.n} ${top.score.toFixed(2)}` : "copy: not read",
        title: `copy score against each picture, below ${n.copied.threshold} for all: ${n.copied.against.map((a) => `Picture ${a.n} ${a.score ?? "not read"}`).join(", ")}. It catches a re-render of a picture's framing; a view re-drawn from the same viewpoint but turned scores lower (short03 P01's aerials 0.52-0.54 against the master, new views 0.42-0.45), so look` })]; })()));
  if (n.layout) out.push(n.layout.error ? h("span", { className: "snap-cand-note", textContent: "layout: not checked", title: n.layout.error })
    : h("span", { className: `snap-cand-note${n.layout.as_planned < n.layout.checked ? " warn" : ""}`, textContent: `layout ${n.layout.as_planned}/${n.layout.checked}${n.layout.order ? ` · order ${n.layout.order}` : ""}`,
      title: `where ${n.layout.detector} finds each thing against the plan:\n${n.layout.rows.map((r) => `${r.ok === false ? "✗" : r.ok ? "✓" : "·"} ${r.name}: plan ${r.plan}, found ${r.found}`).join("\n")}` }));
  // identity (U61): a chip per flag, else the two numbers quietly; the head crops on the tile decide
  const id = n.identity, sign = (x) => `${x > 0 ? "+" : ""}${x}`;
  // a new view (U101): one chip per Cast picture it was made from, its face matched to that Cast's (SNAP-R76)
  for (const x of id?.casts ?? []) out.push(x.face == null ? h("span", { className: "snap-cand-note", textContent: `${x.name}: no face matched`, title: "no face in the new still was matched to this Cast's picture (out of frame, from behind, or too small)" })
    : h("span", { className: `snap-cand-note${x.different ? " warn" : ""}`, textContent: x.different ? `probably not ${x.name}` : `${x.name} ${x.face.toFixed(2)}`,
      title: `ArcFace, ${x.name}'s Cast picture against the face matched to it (each face to one Cast, best total): ${x.face}; below ${id.different_person} it reads "probably not". Above that it doesn't rank likeness well: compare the head crops` }));
  const cast = id?.cast, faces = cast?.scores?.map((s) => s.face ?? "no face").join(", "), each = (s) => (s.people ? s.people.map((x) => x.face ?? "no face").join(" / ") : s.face ?? "no face");
  if (id?.new_person && cast && !cast.error && cast.face_low != null) out.push(cast.different
    ? h("span", { className: "snap-cand-note warn", textContent: `probably not ${cast.name}`, title: `ArcFace, ${cast.name}'s picture against the painted face: ${faces}; below ${cast.different_person} it is likely someone else (a profile or a small face scores low too): compare the head crops` })
    : h("span", { className: "snap-cand-note", textContent: `face vs ${cast.name}'s picture ${cast.face_low.toFixed(2)}`, title: `ArcFace, ${cast.name}'s picture against the painted face: ${faces} (below ${cast.different_person} it reads "probably not ${cast.name}"). Above that it doesn't rank likeness well: a painted face that looks like someone else can score higher than one that looks like ${cast.name}, so compare the head crops` }));
  else if (id?.new_person) out.push(h("span", { className: "snap-cand-note", textContent: "new person", title: cast?.error ? `A recast puts someone else in on purpose; the face against the Cast's picture wasn't checked: ${cast.error}` : "A recast puts someone else in on purpose, so there is no face or hair check: look at the painted frame" }));
  else if (id?.error) out.push(h("span", { className: "snap-cand-note", textContent: "identity: not checked", title: id.error }));
  else if (id && !id.casts && !("face_low" in id)) out.push(h("span", { className: "snap-cand-note", textContent: "identity: older check", title: "a note from the DINOv3 head-crop check, which couldn't tell grey hair from kept hair; check again for the face and hair notes" }));
  else if (id && !id.casts) {
    const faces = `ArcFace on the faces, the take's frame against the edit (each person matched to their own face): ${id.scores.map(each).join(", ")}`, hair = `lit hair (L* p90) against the take's frames (median ${id.hair_base ?? "?"}): ${id.scores.map((s) => (s.hair == null ? "not read" : sign(s.hair))).join(", ")}`;
    const missed = `${id.scores.some((s) => s.no_head) ? "; no head found in one of the crops" : ""}${id.unread ? `; not read: ${id.unread.faces} face(s), ${id.unread.hair} hair` : ""}`;
    if (id.face_unreliable) out.push(h("span", { className: "snap-cand-note", textContent: "face check unreliable under relighting", title: `${faces}; under a ${id.face_unreliable} the same person scores as low as another (U56: 0.34-0.60 at night), so no face flag here: the head crops and the hair note decide${missed}` }));
    if (id.different) out.push(h("span", { className: "snap-cand-note warn", textContent: "probably a different person", title: `${faces}; below ${id.different_person} it is likely someone else, but dark frames and profiles score low too: compare the head crops${missed}` }));
    if (id.lighter) out.push(h("span", { className: "snap-cand-note warn", textContent: "hair lighter than original", title: `${hair}; above ${sign(id.hair_lighter)} the edit lightened her hair (it catches grey and silver, not blonder): compare the head crops${missed}` }));
    if (!id.different && !id.lighter) out.push(h("span", { className: "snap-cand-note", textContent: `${id.face_unreliable ? "" : `face ${id.face_low?.toFixed(2) ?? "–"} · `}hair ${id.hair_up == null ? "–" : sign(id.hair_up)}`,
      title: `no identity flag. ${faces}; ${hair}. These miss blonder hair and drift on profiles: the head crops decide${missed}` }));
  }
  if (!out.length && c.state === "ready" && !c.label) out.push(h("span", { className: "snap-cand-note", textContent: "checking…" })); // a re-run's candidate (a labelled take) has no checks to wait for
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
    const pics = c.pictures.length ? c.pictures.map((p) => (/\.(mp4|webm|mov)$/i.test(p.media?.filename ?? "") ? h("video", { src: url(p.media), title: p.label, muted: true, loop: true, playsInline: true, preload: "metadata", onpointerenter: (e) => e.target.play(), onpointerleave: (e) => e.target.pause() }) // a re-run's candidate is a take's video
      : full(h("img", { src: url(p.media), alt: p.label, title: p.label, loading: "lazy" }), { src: url(p.media), name: `${c.id} · ${p.label}`, source: C.path(p.media) }, `cand:${d.id}`))) : [h("div", { className: "snap-cand-none" })];
    const id = crops && (c.notes.identity?.scores ?? c.notes.identity?.cast?.scores ?? c.notes.identity?.casts), versus = c.notes.identity?.casts ? "each Cast's picture" : c.notes.identity?.cast ? `${c.notes.identity.cast.name}'s picture` : "the take's frame";
    const tile = h("figure", { className: `snap-cand ${c.state}${rec ? " recommended" : ""}`, tabIndex: 0 },
      h("div", { className: "snap-cand-pics" }, pics),
      id ? h("div", { className: "snap-cand-crops", title: `head crops: ${versus} | the edit` }, id.flatMap((s) => (s.people ?? [s]).flatMap((x) => x.crops ?? []).filter(Boolean).map((m) => full(h("img", { src: url(m), alt: "head crop", loading: "lazy" }), { src: url(m), name: `${c.id} · head crop`, source: C.path(m) }, `crops:${d.id}:${c.id}`)))) : null,
      h("figcaption", {},
        h("div", { className: "snap-cand-line" }, h("b", { textContent: c.label ? `${c.id} · ${c.label}` : c.id }), h("span", { className: "snap-quiet", textContent: [c.seed != null ? `seed ${c.seed}` : null, (c.made?.lora ?? c.made?.model) ? (c.made.lora ?? c.made.model).replace(/\.safetensors$/, "").replace(/_/g, " ").slice(0, 28) : null, c.by !== "person" ? `by ${c.by}` : null].filter(Boolean).join(" · ") })),
        h("div", { className: "snap-cand-notes" }, noteChips(c)),
        // SNAP-R51: a pinning method's painted frames sit at the frames they came from until the person unpins them
        "pin" in c && c.state === "ready" ? h("label", { className: "snap-cand-pin", title: "on: the take passes through these painted frames at those moments; off: they only set the look (fine on one shot, worse at cuts)" },
          h("input", { type: "checkbox", checked: c.pin, onchange: (e) => act(() => ED.pin(d, c, e.target.checked)) }), ` 📌 pin at frame${c.frame.length > 1 ? "s" : ""} ${c.frame.join(", ")}`) : null,
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
