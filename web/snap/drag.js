// Drag for the Snap recipe chain (UX_SPEC sections 3-4): reorder bricks by their grip, or drag a palette tile in. The
// chain runs left to right in the full view and top to bottom when narrow or docked; slots follow whichever axis it has.
// The dragged element follows the pointer 1:1 (transform only, written once per frame); layout is read once at the
// start (FLIP First); neighbours and the drop settle on springs; a throw lands where its momentum projects.
import { Spring, SPRINGS, animate, stop, project, reducedMotion } from "./spring.js";

const ACQUIRE = 24, RELEASE = 36, BIAS = 8, EDGE = 48, SCROLL = 18; // px; px per frame at the very edge
const smooth = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
// along the chain (a) and across it (c), for a rect, a point, a scroller
const along = (g, r) => (g.across ? r.left : r.top), len = (g, r) => (g.across ? r.width : r.height), cross = (g, r) => (g.across ? r.top : r.left);
const pt = (g) => (g.across ? g.x : g.y), scrollOf = (g, el) => (g.across ? el.scrollLeft : el.scrollTop);

export function attachDrag(root, { stack, onMove, onInsert, accepts, onCard, cardTarget }) {
  let d = null; // the live gesture
  let settledAt = 0; // a drop springs into place and commits when it rests (~0.5 s); no new gesture before then

  root.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || d || e.timeStamp < settledAt || e.target.closest("button,input,select,textarea")) return;
    const grip = e.target.closest("[data-grip]"), tile = e.target.closest("[data-source], [data-card]");
    if (!grip && !tile) return;
    const item = grip?.closest("[data-brick]");
    if (item?.dataset.host) return; // an attachment moves with its host
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
  // a held brick at the edge keeps scrolling without pointer moves
  const hold = () => { if (d?.started && d.goes === undefined && d.acquired) { if (!d.raf) frame(); requestAnimationFrame(hold); } };

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
    const all = [...stack.querySelectorAll(":scope > [data-brick]")], items = all.filter((el) => !el.classList.contains("snap-folded"));
    const css = getComputedStyle(stack);
    d.across = css.display === "grid"; // the full view's chain is a grid row; narrow, it is a flex column
    d.all = all; // folded bricks are hidden, but the engine's index counts them
    d.scroll0 = scrollOf(d, stack); // rects are measured now; scrolling later shifts everything by (scroll - scroll0)
    d.rects = new Map(items.map((el) => [el, el.getBoundingClientRect()]));
    d.stackRect = stack.getBoundingClientRect();
    d.top0 = items.length ? Math.min(...items.map((el) => along(d, d.rects.get(el)))) : along(d, d.stackRect) + parseFloat(d.across ? css.paddingLeft : css.paddingTop);
    d.cross0 = items.length ? Math.min(...items.map((el) => cross(d, d.rects.get(el)))) : cross(d, d.stackRect) + parseFloat(d.across ? css.paddingTop : css.paddingLeft);
    d.gap = parseFloat(d.across ? css.columnGap : css.rowGap) || 12;
    // a host is lifted with the attachments under it; they ride the same transform
    d.group = [];
    if (d.item) {
      const at = items.indexOf(d.item);
      let end = at + 1;
      while (items[end]?.dataset.host === d.item.dataset.brick) end++;
      d.group = items.slice(at, end);
    }
    d.others = items.filter((el) => !d.group.includes(el));
    d.springs = new Map(d.others.map((el) => [el, new Spring([0], SPRINGS.reflow)]));
    if (d.item) {
      const r = d.rects.get(d.item);
      const last = d.rects.get(d.group.at(-1));
      d.ghost = d.item; d.home = r; d.size = along(d, last) + len(d, last) - along(d, r);
      d.index = items.indexOf(d.item); d.acquired = true;
    } else {
      const r = d.tile.getBoundingClientRect();
      d.ghost = d.tile.cloneNode(true);
      d.ghost.classList.add("snap-ghost");
      Object.assign(d.ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, margin: 0 });
      root.append(d.ghost);
      d.home = r; d.size = d.across ? 236 : 88; d.index = d.others.length; d.acquired = false;
    }
    for (const el of d.group.length ? d.group : [d.ghost]) el.classList.add("snap-lifted");
    for (const el of [d.ghost, ...d.group, ...d.others.slice(0, 6)]) el.style.willChange = "transform";
    requestAnimationFrame(hold);
  }

  // start of slot `index` along the chain without the dragged item (no gap opened)
  function slotTop(g, index) {
    let y = g.top0;
    for (let i = 0; i < index; i++) y += len(g, g.rects.get(g.others[i])) + g.gap;
    return y;
  }

  // slot under position y along the chain; `bias` px of hysteresis keeps the current candidate from flickering
  function indexAt(g, y, bias) {
    const mids = g.others.map((el) => { const r = g.rects.get(el); return along(g, r) + len(g, r) / 2; });
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

  // near either end of the chain the stack scrolls while the brick is held (faster closer to the edge)
  function autoscroll() {
    const s = d.stackRect, up = pt(d) - along(d, s), down = along(d, s) + len(d, s) - pt(d);
    const v = up < EDGE ? -SCROLL * (1 - up / EDGE) : down < EDGE ? SCROLL * (1 - down / EDGE) : 0;
    if (!v) return 0;
    if (d.across) stack.scrollLeft += v; else stack.scrollTop += v;
    return scrollOf(d, stack) - d.scroll0;
  }

  function frame() {
    d.raf = 0;
    if (d.goes !== undefined) return cardFrame();
    const scrolled = d.acquired ? autoscroll() || scrollOf(d, stack) - d.scroll0 : scrollOf(d, stack) - d.scroll0;
    if (scrolled !== d.scrolled) { d.scrolled = scrolled; d.acquiredWas = null; } // re-place neighbours after a scroll
    const carried = d.item ? scrolled : 0; // a brick in the stack scrolls with it
    const dx = d.x - d.x0 + (d.across ? carried : 0), dy = d.y - d.y0 + (d.across ? 0 : carried);
    const y = pt(d) + scrolled; // the pointer along the chain, in drag-start coordinates
    const s = d.stackRect;
    if (!d.item) {
      const dist = Math.hypot(Math.max(s.left - d.x, 0, d.x - s.right), Math.max(s.top - d.y, 0, d.y - s.bottom));
      const ok = accepts?.(d.tile.dataset.source) ?? true;
      d.acquired = ok && (d.acquired ? dist < RELEASE : dist < ACQUIRE);
      d.reason = ok ? "" : d.tile.dataset.reason || "already in the recipe";
    }
    const index = d.acquired ? indexAt(d, y, BIAS) : d.others.length;
    if (index !== d.index || d.acquiredWas !== d.acquired) {
      d.index = index; d.acquiredWas = d.acquired;
      d.others.forEach((el, i) => {
        const shift = d.acquired && i >= index ? d.size + d.gap : 0;
        const sp = d.springs.get(el);
        sp.set([slotTop(d, i) + shift - along(d, d.rects.get(el))]);
        animate(el, sp, ([y]) => { el.style.transform = y ? (d.across ? `translate3d(${y}px,0,0)` : `translate3d(0,${y}px,0)`) : ""; });
      });
      d.ghost.classList.toggle("snap-acquired", d.acquired);
      d.ghost.title = d.reason || "";
    }
    // magnet: lean across the chain toward its line, capped so the brick still follows the hand
    let lean = 0;
    if (!d.item && d.acquired && !reducedMotion()) {
      const target = d.cross0 - cross(d, d.home), off = d.across ? dy : dx;
      lean = (target - off) * Math.min(0.6, smooth(1 - Math.abs(target - off) / (ACQUIRE * 8)));
    }
    const t = `translate3d(${dx + (d.across ? 0 : lean)}px,${dy + (d.across ? lean : 0)}px,0) scale(1.02)`;
    for (const el of d.group.length ? d.group : [d.ghost]) el.style.transform = t;
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
    const scrolled = scrollOf(g, stack) - g.scroll0;
    let index = g.index, accepted = g.acquired && !cancelled;
    if (accepted && thrown) {
      const py = project(pt(g) + scrolled, g.across ? vx : vy);
      index = indexAt(g, Math.max(slotTop(g, 0), Math.min(slotTop(g, g.others.length) + g.size, py)), 0);
    }
    if (cancelled && g.item) { accepted = true; index = [...g.rects.keys()].indexOf(g.item); } // back to its slot
    const cur = new DOMMatrixReadOnly(getComputedStyle(g.ghost).transform);
    const from = [cur.m41, cur.m42];
    // a brick in the stack lands in content coordinates; a palette ghost is fixed on screen, so it lands where the slot is now
    const a = slotTop(g, index) - along(g, g.home) - (g.item ? 0 : scrolled), c = g.item ? 0 : g.cross0 - cross(g, g.home);
    const to = accepted ? (g.across ? [a, c] : [c, a]) : [0, 0];
    const sp = new Spring(from, thrown ? SPRINGS.throw : SPRINGS.drop);
    sp.set(to, { velocity: thrown ? [vx, vy] : undefined });
    // reflow neighbours to the final slot layout
    g.others.forEach((el, i) => {
      const shift = accepted && i >= index ? g.size + g.gap : 0;
      const spn = g.springs.get(el);
      spn.set([slotTop(g, i) + shift - along(g, g.rects.get(el))]);
      animate(el, spn, ([y]) => { el.style.transform = y ? (g.across ? `translate3d(${y}px,0,0)` : `translate3d(0,${y}px,0)`) : ""; });
    });
    stop(g.ghost);
    settledAt = performance.now() + 700;
    const moving = g.group.length ? g.group : [g.ghost];
    animate(g.ghost, sp, ([x, y]) => { for (const el of moving) el.style.transform = `translate3d(${x}px,${y}px,0)`; }, () => {
      settledAt = 0;
      for (const el of [...moving, ...g.others]) { stop(el); el.style.transform = ""; el.style.willChange = ""; }
      for (const el of moving) el.classList.remove("snap-lifted", "snap-acquired");
      if (!g.item) g.ghost.remove();
      if (!accepted) return;
      // the slot index counts visible bricks; the engine's counts every brick (folded ones too) without the moved group
      const rest = g.all.filter((el) => !g.group.includes(el));
      const real = index < g.others.length ? rest.indexOf(g.others[index]) : rest.length;
      if (g.item) onMove?.(g.item.dataset.brick, real);
      else onInsert?.(g.tile.dataset.source, real);
    });
  }
}
