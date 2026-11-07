// Every picture is one click from full size (the operator, 2026-11-05: "click on a picture and it brings it up full size"): a
// thumbnail marked with full() opens this in-page viewer over Snap. Fit or 100 %, wheel zoom about the pointer, drag to
// pan, ← → through the pictures of the same row or tray (its group), Esc closes; it names the picture, its source and
// size, and "Open in a new tab" leaves this tab as it is. Viewing never changes anything; a thumbnail whose click did
// something else (the References row opened its Cast or set) keeps that as a button in the viewer.
// The agent twin is open_view {view: "picture"} (tools.js), which opens it on the person's tab. An item may carry the
// critic's masks ({k, region, severity, text}): drawn over the picture at any zoom, a box and its number each, with the
// notes listed in the bar's title (F-E21: the viewer showed none of the critic's regions).
// Under the bar each picture says what it is (nearby.js: a still or a frame of a video, its kind, its cut, what made it),
// and Nearby (m) opens what is around it in the data model, over the viewer.
// SNAP-R5 never navigate away from the work · SNAP-R80 every picture one click from full size · SNAP-R136 masks numbered,
// never words over the picture · SNAP-R197 what this is · SNAP-R198 Nearby · see docs/snap/SNAP_RULES.md

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const actions = new WeakMap(); // a thumbnail's own action, offered in the viewer

// mark a thumbnail: `item` {src, name, source, kind: "image" | "video"} (src the full file), `group` the row or tray it
// steps through with the arrows, `action` {label, run} what its click did before
export function full(el, item, group, action) {
  el.classList.add("snap-full");
  Object.assign(el.dataset, { fullSrc: item.src, fullName: item.name ?? "", fullSource: item.source ?? "", fullKind: item.kind ?? "image", fullGroup: group ?? "", fullRef: item.ref ?? "" });
  if (action) actions.set(el, action);
  return el;
}
const SEV = { high: "#e5484d", medium: "#f0b445", low: "#6aa8ff" };
const itemOf = (el) => ({ src: el.dataset.fullSrc, name: el.dataset.fullName, source: el.dataset.fullSource, kind: el.dataset.fullKind, ref: el.dataset.fullRef || null, action: actions.get(el) ?? null });

// one capture-phase listener: a marked thumbnail's click opens the viewer and stops there (the row's own click doesn't run)
document.addEventListener("click", (e) => {
  const el = e.target.closest?.(".snap-full");
  if (!el || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation();
  const row = el.dataset.fullGroup ? [...document.querySelectorAll(".snap-full")].filter((x) => x.dataset.fullGroup === el.dataset.fullGroup) : [el];
  show(row.map(itemOf), row.indexOf(el));
}, true);

let open = null;
export const showing = () => open && { index: open.at, count: open.items.length, ...open.items[open.at], action: open.items[open.at].action?.label ?? null };

// the viewer on `items` at `at`
export function show(items, at = 0) {
  close();
  let fit = true, scale = 1, x = 0, y = 0, drag = null;
  const media = h("div", { className: "snap-lb-stage" }), head = h("div", { className: "snap-lb-what" }), masks = h("div", { className: "snap-lb-masks" });
  const fitBtn = h("button", { onclick: () => { fit = !fit; scale = 1; x = y = 0; place(); } });
  // the scale fit shows it at: the whole picture in the stage, small ones enlarged too
  const fitScale = () => { const n = natural(), r = media.getBoundingClientRect(); return n.w && n.h ? Math.min(r.width / n.w, r.height / n.h) : 1; };
  const zoom = (k) => { if (fit) { scale = fitScale(); fit = false; x = y = 0; } scale = Math.min(16, Math.max(0.05, scale * k)); place(); };
  const tab = h("a", { className: "snap-lb-btn", target: "_blank", rel: "noopener", textContent: "Open in a new tab ↗" }), act = h("button", { hidden: true }), whatLine = h("div", { className: "snap-lb-whatline" });
  // the picture's ref for nearby.js: the one it was marked with, else its own /view address (a take's file, a record's picture)
  const refOf = (it) => it.ref || it.src;
  const near = () => import("./nearby.js").then((N) => N.openNearby(refOf(open.items[open.at])));
  const root = h("div", { className: "snap-lb", role: "dialog", ariaModal: "true", ariaLabel: "picture at full size", tabIndex: -1 },
    h("div", { className: "snap-lb-bar" }, head, h("span", { className: "snap-spacer" }), act, h("button", { textContent: "Nearby (m)", title: "what is near it in the data model (changes nothing)", onclick: () => near() }), fitBtn,
      h("button", { textContent: "−", title: "zoom out", onclick: () => zoom(1 / 1.25) }), h("button", { textContent: "+", title: "zoom in", onclick: () => zoom(1.25) }), tab,
      h("button", { textContent: "✕", title: "close (Esc)", onclick: () => close() })),
    whatLine, media, masks,
    h("button", { className: "snap-lb-prev", textContent: "‹", title: "previous (←)", onclick: () => step(-1) }), h("button", { className: "snap-lb-next", textContent: "›", title: "next (→)", onclick: () => step(1) }));
  const current = () => media.firstElementChild;
  const natural = () => { const m = current(); return m ? { w: m.naturalWidth ?? m.videoWidth ?? 0, h: m.naturalHeight ?? m.videoHeight ?? 0 } : { w: 0, h: 0 }; };
  function place() {
    const m = current();
    if (!m) return;
    m.classList.toggle("fit", fit);
    m.style.transform = fit ? "" : `translate(${x}px, ${y}px) scale(${scale})`;
    fitBtn.textContent = fit ? "100 %" : "Fit";
    fitBtn.title = fit ? "show it at its own size (pixel for pixel)" : "fit it to the window";
    paintMasks();
  }
  // the picture's own rectangle on screen (fit letterboxes it inside the element), then each mask inside it
  function paintMasks() {
    const it = open?.items[open.at], m = current(), n = natural();
    masks.replaceChildren();
    if (!it?.masks?.length || !m || !n.w) return;
    const r = m.getBoundingClientRect(), k = fit ? Math.min(r.width / n.w, r.height / n.h) : r.width / n.w, w = n.w * k, hh = n.h * k, left = r.left + (r.width - w) / 2, top = r.top + (r.height - hh) / 2;
    for (const x of it.masks) {
      const box = h("div", { className: "snap-lb-mask", title: `${x.k} · ${x.severity} · ${x.text ?? ""}` }, h("i", { textContent: String(x.k) }));
      Object.assign(box.style, { left: `${left + x.region[0] * w}px`, top: `${top + x.region[1] * hh}px`, width: `${x.region[2] * w}px`, height: `${x.region[3] * hh}px` });
      box.style.setProperty("--sev", SEV[x.severity] ?? SEV.low);
      masks.append(box);
    }
  }
  function load() {
    const it = open.items[open.at];
    fit = true; scale = 1; x = y = 0;
    const m = it.kind === "video" ? h("video", { src: it.src, controls: true, autoplay: true, loop: true, playsInline: true }) : h("img", { src: it.src, alt: it.name || "picture", draggable: false });
    const what = () => { const n = natural(); head.replaceChildren(...[h("b", { textContent: it.name || "picture" }), it.source ? h("span", { textContent: ` · ${it.source}` }) : null,
      it.masks?.length ? h("span", { className: "snap-quiet", title: it.masks.map((x) => `${x.k} · ${x.severity} · ${x.text ?? ""}`).join("\n"), textContent: ` · ${it.masks.length} critic mask${it.masks.length === 1 ? "" : "s"}` }) : null,
      n.w ? h("span", { textContent: ` · ${n.w}×${n.h}` }) : null, open.items.length > 1 ? h("span", { className: "snap-quiet", textContent: ` · ${open.at + 1} of ${open.items.length}` }) : null].filter(Boolean)); };
    m.addEventListener(it.kind === "video" ? "loadedmetadata" : "load", () => { what(); place(); });
    media.replaceChildren(m); what(); place();
    whatLine.replaceChildren();
    import("./nearby.js").then(async (N) => { await N.load(); const w = N.what(refOf(it)); if (open?.items[open.at] === it) whatLine.replaceChildren(w.line, w.more ? h("span", { textContent: w.more }) : ""); }).catch(() => whatLine.replaceChildren()); // a picture Snap holds nothing about says nothing
    tab.href = it.src;
    act.hidden = !it.action;
    if (it.action) { act.textContent = it.action.label; act.onclick = () => { close(); it.action.run(); }; }
    root.querySelector(".snap-lb-prev").disabled = root.querySelector(".snap-lb-next").disabled = open.items.length < 2;
  }
  function step(k) { open.at = (open.at + k + open.items.length) % open.items.length; load(); }
  media.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = media.getBoundingClientRect(), px = e.clientX - r.left - r.width / 2, py = e.clientY - r.top - r.height / 2;
    if (fit) { scale = fitScale(); fit = false; x = y = 0; }
    const k = e.deltaY < 0 ? 1.15 : 1 / 1.15, next = Math.min(16, Math.max(0.05, scale * k));
    x = px - (px - x) * (next / scale); y = py - (py - y) * (next / scale); scale = next; place(); // about the pointer
  }, { passive: false });
  let moved = false;
  media.addEventListener("pointerdown", (e) => { moved = false; if (fit || e.button !== 0) return; drag = { sx: e.clientX - x, sy: e.clientY - y }; media.setPointerCapture(e.pointerId); });
  media.addEventListener("pointermove", (e) => { if (!drag) return; moved = true; x = e.clientX - drag.sx; y = e.clientY - drag.sy; place(); });
  media.addEventListener("pointerup", () => { drag = null; });
  // a click on the picture switches fit and 100 % (not after a drag); on the dark around it, closes
  root.addEventListener("click", (e) => { if (e.target === root || e.target === media) close(); else if (e.target === current() && current().tagName === "IMG" && !moved) { fit = !fit; scale = 1; x = y = 0; place(); } });
  const keys = (e) => {
    if (document.querySelector(".snap-near")) return; // the Nearby modal over the viewer takes the keys first
    if (e.key === "Escape") close(); else if (e.key === "ArrowRight") step(1); else if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "0" || e.key === "f") { fit = !fit; scale = 1; x = y = 0; place(); } else if (e.key === "m") near(); else return;
    e.preventDefault(); e.stopImmediatePropagation(); // the take viewer under it keeps its own Esc and arrows
  };
  open = { items, at: Math.min(Math.max(0, at), items.length - 1), root, keys, resize: () => paintMasks() };
  window.addEventListener("keydown", keys, true); // before the document's capture listeners (the take viewer's)
  window.addEventListener("resize", open.resize);
  document.body.append(root);
  load();
  root.focus();
  return showing();
}
export function close() {
  if (!open) return;
  window.removeEventListener("keydown", open.keys, true);
  window.removeEventListener("resize", open.resize);
  open.root.remove();
  open = null;
}
