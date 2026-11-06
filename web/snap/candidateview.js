// The candidates strip (U32): one tile per candidate of a decision with its pictures, provenance and pre-screen notes,
// Apply / Reject while it is ready, Undo once applied, and the agent's recommendation when one waits (its proposal).
// Hovering or pressing a tile previews it in place (C.preview: the plate slot or the take viewer shows it, nothing is
// edited). The buttons call the same functions as the apply_candidate / reject_candidate / undo_candidate tools.
// SNAP-R7 lists keep their elements while a pointer is down · SNAP-R17 by · SNAP-R23 candidates · SNAP-R76 a score per
// person, with that person's crops · SNAP-R79 copied Picture n · SNAP-R111 the character score flags, ArcFace is shown ·
// SNAP-R112 same composition · see docs/snap/SNAP_RULES.md
import * as C from "./candidates.js";
import * as CV from "./critiqueview.js";
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
  // a new view (F-C14, G1b): "copied Picture n" when its soft score against a context picture reaches the soft threshold,
  // with the same-cell score saying whether it kept that picture's framing or drew the same composition from elsewhere
  const both = (a) => `soft ${a.soft ?? "not read"}, same-cell ${a.score ?? "not read"}`;
  if (n.copied) out.push(...(n.copied.error ? [h("span", { className: "snap-cand-note", textContent: "copy: not checked", title: n.copied.error })]
    : n.copied.copied.length ? n.copied.against.filter((a) => n.copied.copied.includes(a.n)).map((a) => { const framing = n.copied.framing?.includes(a.n) ?? true;
      return h("span", { className: "snap-cand-note warn", textContent: `copied Picture ${a.n} ${(a.soft ?? a.score).toFixed(2)} · ${framing ? "same framing" : "same composition"}`,
        title: `copy scores against Picture ${a.n} (${a.label}): ${both(a)}. ${framing ? `Same-cell at or above ${n.copied.threshold}: it re-renders that picture's framing` : `The soft score is at or above ${n.copied.soft_threshold} with the parts in other places: the same composition drawn from another viewpoint (short03's aerials of the master 0.84, new views 0.69-0.81)`}; look before you apply it` }); })
    : (() => { const top = n.copied.against.filter((a) => (a.soft ?? a.score) != null).sort((a, b) => (b.soft ?? b.score) - (a.soft ?? a.score))[0]; // the nearest picture, said quietly
      return [h("span", { className: "snap-cand-note", textContent: top ? `no copy · nearest Picture ${top.n} ${(top.soft ?? top.score).toFixed(2)}` : "copy: not read",
        title: `copy scores against each picture, below ${n.copied.soft_threshold ?? n.copied.threshold} for all: ${n.copied.against.map((a) => `Picture ${a.n} ${both(a)}`).join("; ")}. The soft score catches a copy drawn again from another viewpoint (short03's aerials of the master 0.84) as well as a re-render (0.9+); new views of the same set scored 0.69-0.81` })]; })()));
  if (n.layout) out.push(n.layout.error ? h("span", { className: "snap-cand-note", textContent: "layout: not checked", title: n.layout.error })
    : h("span", { className: `snap-cand-note${n.layout.as_planned < n.layout.checked ? " warn" : ""}`, textContent: `layout ${n.layout.as_planned}/${n.layout.checked}${n.layout.order ? ` · order ${n.layout.order}` : ""}`,
      title: `where ${n.layout.detector} finds each thing against the plan:\n${n.layout.rows.map((r) => `${r.ok === false ? "✗" : r.ok ? "✓" : "·"} ${r.name}: plan ${r.plan}, found ${r.found}`).join("\n")}` }));
  // identity (U61, G1b): a chip per flag, else the numbers quietly; the head crops on the tile decide. The character score
  // (DINOv3 on a head crop) raises "probably a different person"; ArcFace is only a number in the title (SNAP-R111)
  const id = n.identity, sign = (x) => `${x > 0 ? "+" : ""}${x}`, two = (x) => (x == null ? "–" : x.toFixed(2));
  const arc = (x) => `ArcFace ${x ?? "no face"} (a number to look at: on anime faces it scores a profile or a bowed head of the same character near 0)`;
  const cast = id?.cast, each = (s) => (s.people ? s.people.map((x) => x.character ?? "no face").join(" / ") : s.character ?? "no face");
  const older = id && !id.error && (id.casts ? !id.casts.some((x) => "character" in x) : id.new_person ? id.cast && !id.cast.error && !("character_low" in id.cast) : !("character_low" in id));
  if (older) out.push(h("span", { className: "snap-cand-note", textContent: "identity: older check", title: "a note from before the character score (G1b): ArcFace alone, which flagged anime profiles and bowed heads as someone else; check again for the character, face and hair notes" }));
  // a new view (U101): one chip per Cast picture it was made from, its face matched to that Cast's (SNAP-R76)
  else if (id?.casts) out.push(...id.casts.map((x) => (x.character == null ? h("span", { className: "snap-cand-note", textContent: `${x.name}: no face matched`, title: "no face in the new still was matched to this Cast's picture (out of frame, from behind, or too small)" })
    : h("span", { className: `snap-cand-note${x.different ? " warn" : ""}`, textContent: x.different ? `probably not ${x.name}` : `${x.name} ${two(x.character)}`,
      title: `character score (DINOv3 on the head crop), ${x.name}'s Cast picture against the face matched to it (each face to one Cast, best total): ${x.character}; below ${id.different_below} it reads "probably not ${x.name}". ${arc(x.face)}. Compare the head crops` }))));
  else if (id?.new_person && cast && !cast.error && cast.character_low != null) {
    const scores = `character score (DINOv3 on the head crop), ${cast.name}'s picture against the painted face: ${cast.scores.map(each).join(", ")}; ${arc(cast.face_low)}`;
    out.push(cast.different ? h("span", { className: "snap-cand-note warn", textContent: `probably not ${cast.name}`, title: `${scores}. Below ${cast.different_below} it is likely someone else: compare the head crops` })
      : h("span", { className: "snap-cand-note", textContent: `character vs ${cast.name}'s picture ${two(cast.character_low)}`, title: `${scores}. Below ${cast.different_below} it would read "probably not ${cast.name}"; compare the head crops` }));
  } else if (id?.new_person) out.push(h("span", { className: "snap-cand-note", textContent: "new person", title: cast?.error ? `A recast puts someone else in on purpose; the face against the Cast's picture wasn't checked: ${cast.error}` : "A recast puts someone else in on purpose, so there is no face or hair check: look at the painted frame" }));
  else if (id?.error) out.push(h("span", { className: "snap-cand-note", textContent: "identity: not checked", title: id.error }));
  else if (id) {
    const scores = `character score (DINOv3 on the head crop), the take's frame against the edit (each person matched to their own face): ${id.scores.map(each).join(", ")}; ${arc(id.face_low)}`, hair = `lit hair (L* p90) against the take's frames (median ${id.hair_base ?? "?"}): ${id.scores.map((s) => (s.hair == null ? "not read" : sign(s.hair))).join(", ")}`;
    const missed = `${id.scores.some((s) => s.no_head) ? "; no head found in one of the crops" : ""}${id.unread ? `; not read: ${id.unread.faces} face(s), ${id.unread.hair} hair` : ""}`;
    if (id.face_unreliable) out.push(h("span", { className: "snap-cand-note", textContent: "identity unreliable under relighting", title: `${scores}; under a ${id.face_unreliable} the same person scores as low as another (U56: 0.34-0.60 at night), so no identity flag here: the head crops and the hair note decide${missed}` }));
    if (id.different) out.push(h("span", { className: "snap-cand-note warn", textContent: "probably a different person", title: `${scores}. Below ${id.different_below} it is likely someone else (0 false alarms on 21 same-character pairs, profiles included): compare the head crops${missed}` }));
    if (id.lighter) out.push(h("span", { className: "snap-cand-note warn", textContent: "hair lighter than original", title: `${hair}; above ${sign(id.hair_lighter)} the edit lightened her hair (it catches grey and silver, not blonder): compare the head crops${missed}` }));
    if (!id.different && !id.lighter) out.push(h("span", { className: "snap-cand-note", textContent: `${id.face_unreliable ? "" : `${id.character_low >= id.same_from ? "same character" : "character"} ${two(id.character_low)} · `}hair ${id.hair_up == null ? "–" : sign(id.hair_up)}`,
      title: `no identity flag. ${scores}; ${hair}. From ${id.same_from} the character score reads the same character; the hair note misses blonder hair: the head crops decide${missed}` }));
  }
  if (!out.length && c.state === "ready" && !c.label) out.push(h("span", { className: "snap-cand-note", textContent: "checking…" })); // a re-run's candidate (a labelled take) has no checks to wait for
  out.push(...CV.candidateChips(c)); // SNAP-R103 the critic beside the other notes
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
