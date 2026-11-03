// Drag for the Snap recipe stack (UX_SPEC sections 3-4): reorder bricks by their grip, or drag a palette tile in.
// The dragged element follows the pointer 1:1 (transform only, written once per frame); layout is read once at the
// start (FLIP First); neighbours and the drop settle on springs; a throw lands where its momentum projects.
import { Spring, SPRINGS, animate, stop, project, reducedMotion } from "./spring.js";

const ACQUIRE = 24, RELEASE = 36, BIAS = 8;
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function attachDrag(root, { stack, onMove, onInsert, accepts, onCard, cardTarget }) {
  let d = null; // the live gesture
  let settledAt = 0; // a drop springs into place and commits when it rests (~0.5 s); no new gesture before then

  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || d || e.timeStamp < settledAt || e.target.closest("button,input,select,textarea")) return;
    const grip = e.target.closest("[data-grip]"), tile = e.target.closest("[data-source], [data-card]");
    if (!grip && !tile) return;
    const item = grip?.closest("[data-brick]");
    d = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, item, tile, started: false,
      slop: e.pointerType === "mouse" && !tile ? 4 : 10, samples: [], el: grip ?? tile };
    d.el.setPointerCapture(e.pointerId);
    (item ?? tile).classList.add("snap-pressed");
  });

  // move/up/cancel are heard on window: a re-render can detach the captured element mid-gesture
  addEventListener("pointermove", (e) => {
    if (!d || e.pointerId !== d.id) return;
    for (const c of e.getCoalescedEvents?.() ?? [e]) d.samples.push([c.timeStamp, c.clientX, c.clientY]);
    if (d.samples.length > 24) d.samples.splice(0, d.samples.length - 24);
    d.x = e.clientX; d.y = e.clientY;
    if (!d.started && Math.hypot(d.x - d.x0, d.y - d.y0) > d.slop) begin();
    if (d.started && !d.raf) d.raf = requestAnimationFrame(frame);
  });

  const end = (e, cancelled) => {
    if (!d || e.pointerId !== d.id) return;
    (d.item ?? d.tile).classList.remove("snap-pressed");
    if (d.started) {
      // the release still produces a click on the captured element; a drag is not a click
      const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
      root.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => root.removeEventListener("click", swallow, { capture: true }), 0);
      drop(cancelled, e.timeStamp);
    } else d = null;
  };
  addEventListener("pointerup", (e) => end(e, false));
  addEventListener("pointercancel", (e) => end(e, true));
  root.addEventListener("lostpointercapture", (e) => end(e, true));
  root.addEventListener("keydown", (e) => { if (e.key === "Escape" && d?.started) { e.stopPropagation(); drop(true, e.timeStamp); } });

  function begin() {
    d.started = true;
    if (d.tile?.dataset.card) return beginCard();
    const items = [...stack.querySelectorAll(":scope > [data-brick]")];
    d.rects = new Map(items.map((el) => [el, el.getBoundingClientRect()]));
    d.stackRect = stack.getBoundingClientRect();
    d.top0 = items.length ? Math.min(...items.map((el) => d.rects.get(el).top)) : d.stackRect.top + 12;
    d.gap = parseFloat(getComputedStyle(stack).rowGap) || 12;
    d.others = items.filter((el) => el !== d.item);
    d.springs = new Map(d.others.map((el) => [el, new Spring([0], SPRINGS.reflow)]));
    if (d.item) {
      const r = d.rects.get(d.item);
      d.ghost = d.item; d.home = r; d.size = r.height;
      d.index = items.indexOf(d.item); d.acquired = true;
    } else {
      const r = d.tile.getBoundingClientRect();
      d.ghost = d.tile.cloneNode(true);
      d.ghost.classList.add("snap-ghost");
      Object.assign(d.ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, margin: 0 });
      root.append(d.ghost);
      d.home = r; d.size = 88; d.index = d.others.length; d.acquired = false;
    }
    d.ghost.classList.add("snap-lifted");
    for (const el of [d.ghost, ...d.others.slice(0, 6)]) el.style.willChange = "transform";
  }

  // top of slot `index` in the list without the dragged item (no gap opened)
  function slotTop(g, index) {
    let y = g.top0;
    for (let i = 0; i < index; i++) y += g.rects.get(g.others[i]).height + g.gap;
    return y;
  }

  // slot under y; `bias` px of hysteresis keeps the current candidate from flickering
  function indexAt(g, y, bias) {
    const mids = g.others.map((el) => { const r = g.rects.get(el); return r.top + r.height / 2; });
    let i = 0;
    while (i < mids.length && y > mids[i] + (i >= g.index ? bias : -bias)) i++;
    return i;
  }

  // a Library card: no gap opens; the brick it belongs to lights up, and the one under the pointer takes it
  function beginCard() {
    const r = d.tile.getBoundingClientRect();
    d.ghost = d.tile.cloneNode(true);
    d.ghost.classList.add("snap-ghost", "snap-lifted");
    Object.assign(d.ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, margin: 0, willChange: "transform" });
    root.append(d.ghost);
    d.home = r;
    d.goes = cardTarget(d.tile.dataset.card);
    stack.querySelector(`[data-brick="${d.goes}"]`)?.classList.add("snap-accepts");
  }

  function cardFrame() {
    const under = document.elementFromPoint(d.x, d.y)?.closest?.("[data-brick]");
    const target = under?.dataset.brick === d.goes ? under : null;
    if (target !== d.target) { d.target?.classList.remove("snap-target"); target?.classList.add("snap-target"); d.target = target; }
    d.ghost.style.transform = `translate3d(${d.x - d.x0}px,${d.y - d.y0}px,0) scale(${target ? 0.92 : 1.02})`;
  }

  function dropCard(g, cancelled) {
    stack.querySelector(".snap-accepts")?.classList.remove("snap-accepts");
    g.target?.classList.remove("snap-target");
    const into = !cancelled && g.target;
    const cur = new DOMMatrixReadOnly(getComputedStyle(g.ghost).transform);
    let to = [0, 0, 1];
    if (into) { const t = g.target.getBoundingClientRect(); to = [t.left + t.width / 2 - g.home.left - g.home.width / 2, t.top + 24 - g.home.top, 0.4]; }
    const sp = new Spring([cur.m41, cur.m42, cur.a], SPRINGS.drop, [0.5, 0.5, 0.002]);
    sp.set(to);
    settledAt = performance.now() + 700;
    animate(g.ghost, sp, ([x, y, k]) => { g.ghost.style.transform = `translate3d(${x}px,${y}px,0) scale(${k})`; g.ghost.style.opacity = into ? Math.min(1, k * 1.6) : 1; }, () => {
      settledAt = 0;
      g.ghost.remove();
      if (into) onCard?.(g.tile.dataset.card, g.target.dataset.brick);
    });
  }

  function frame() {
    d.raf = 0;
    if (d.goes !== undefined) return cardFrame();
    const dx = d.x - d.x0, dy = d.y - d.y0;
    const s = d.stackRect;
    if (!d.item) {
      const dist = d.x < s.left ? s.left - d.x : d.x > s.right ? d.x - s.right : 0;
      const ok = accepts?.(d.tile.dataset.source) ?? true;
      d.acquired = ok && (d.acquired ? dist < RELEASE : dist < ACQUIRE);
      d.reason = ok ? "" : d.tile.dataset.reason || "already in the recipe";
    }
    const index = d.acquired ? indexAt(d, d.y, BIAS) : d.others.length;
    if (index !== d.index || d.acquiredWas !== d.acquired) {
      d.index = index; d.acquiredWas = d.acquired;
      d.others.forEach((el, i) => {
        const shift = d.acquired && i >= index ? d.size + d.gap : 0;
        const sp = d.springs.get(el);
        sp.set([slotTop(d, i) + shift - d.rects.get(el).top]);
        animate(el, sp, ([y]) => { el.style.transform = y ? `translate3d(0,${y}px,0)` : ""; });
      });
      d.ghost.classList.toggle("snap-acquired", d.acquired);
      d.ghost.title = d.reason || "";
    }
    // magnet: lean toward the stack column, capped so the brick still follows the hand
    let lean = 0;
    if (!d.item && d.acquired && !reducedMotion()) {
      const target = s.left + 12 - d.home.left;
      lean = (target - dx) * Math.min(0.6, smooth(1 - Math.abs(target - dx) / (ACQUIRE * 8)));
    }
    d.ghost.style.transform = `translate3d(${dx + lean}px,${dy}px,0) scale(1.02)`;
  }

  // px/s over the 80 ms before release; a hand that stopped and held has no velocity
  function velocity(now) {
    const recent = d.samples.filter(([t]) => now - t <= 80);
    if (recent.length < 2) return [0, 0];
    const [t0, x0, y0] = recent[0], [t1, x1, y1] = recent.at(-1);
    const dt = (t1 - t0) / 1000 || 1;
    return [(x1 - x0) / dt, (y1 - y0) / dt];
  }

  function drop(cancelled, now) {
    cancelAnimationFrame(d.raf);
    const [vx, vy] = velocity(now), g = d;
    d = null;
    if (g.goes !== undefined) return dropCard(g, cancelled);
    const thrown = Math.hypot(vx, vy) > 300;
    let index = g.index, accepted = g.acquired && !cancelled;
    if (accepted && thrown) {
      const py = project(g.y, vy);
      index = indexAt(g, Math.max(slotTop(g, 0), Math.min(slotTop(g, g.others.length) + g.size, py)), 0);
    }
    if (cancelled && g.item) { accepted = true; index = [...g.rects.keys()].indexOf(g.item); } // back to its slot
    const cur = new DOMMatrixReadOnly(getComputedStyle(g.ghost).transform);
    const from = [cur.m41, cur.m42];
    const to = accepted ? [g.item ? 0 : g.stackRect.left + 12 - g.home.left, slotTop(g, index) - g.home.top] : [0, 0];
    const sp = new Spring(from, thrown ? SPRINGS.throw : SPRINGS.drop);
    sp.set(to, { velocity: thrown ? [vx, vy] : undefined });
    // reflow neighbours to the final slot layout
    g.others.forEach((el, i) => {
      const shift = accepted && i >= index ? g.size + g.gap : 0;
      const spn = g.springs.get(el);
      spn.set([slotTop(g, i) + shift - g.rects.get(el).top]);
      animate(el, spn, ([y]) => { el.style.transform = y ? `translate3d(0,${y}px,0)` : ""; });
    });
    stop(g.ghost);
    settledAt = performance.now() + 700;
    animate(g.ghost, sp, ([x, y]) => { g.ghost.style.transform = `translate3d(${x}px,${y}px,0)`; }, () => {
      settledAt = 0;
      for (const el of [g.ghost, ...g.others]) { stop(el); el.style.transform = ""; el.style.willChange = ""; }
      g.ghost.classList.remove("snap-lifted", "snap-acquired");
      if (!g.item) g.ghost.remove();
      if (!accepted) return;
      if (g.item) onMove?.(g.item.dataset.brick, index);
      else onInsert?.(g.tile.dataset.source, index);
    });
  }
}
