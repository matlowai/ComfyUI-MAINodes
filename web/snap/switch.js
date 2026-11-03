// Snap ⇄ Graph (UX_SPEC section 5). The Snap view sits inside the graph canvas container, above the canvas and below
// ComfyUI's floating chrome (workflow tabs, side toolbar, action bar); while it shows, the canvas stops drawing
// (pause_rendering), so the graph keeps its state but costs nothing. Switching flies each
// brick card to the screen rect of its nodes (and back) on springs, so a second press mid-flight just reverses.
import { app } from "../../../scripts/app.js";
import { Spring, SPRINGS, animate, stop, reducedMotion } from "./spring.js";
import * as E from "./engine.js";

export function createSwitch(view) {
  const root = view.root;
  const container = () => document.querySelector("#graph-canvas-container");
  const flights = new Map(); // brick key -> Spring over [dx, dy, sx, sy]
  const veil = new Spring([0], SPRINGS.view, 0.002);
  let showing = false;

  // mount under the chrome and keep clear of it: the action bar row above, the side toolbar on the left
  function place() {
    const c = container();
    if (!c) return;
    if (root.parentElement !== c) c.append(root); // z-index 2: above the canvas, below the chrome layer (z 999)
    const box = c.getBoundingClientRect();
    const bar = document.querySelector(".actionbar-container")?.getBoundingClientRect();
    const tabs = document.querySelector(".workflow-tabs-container")?.getBoundingClientRect();
    const nav = document.querySelector(".side-tool-bar-container")?.getBoundingClientRect();
    root.style.paddingTop = `${Math.max(bar?.bottom ?? 0, tabs?.bottom ?? 0) - box.top + 8}px`;
    root.style.paddingLeft = `${Math.max(0, (nav?.right ?? 0) - box.left)}px`;
  }
  addEventListener("resize", place);

  function nodeRect(n) {
    const c = app.canvas, box = c.canvas.getBoundingClientRect(), th = LiteGraph.NODE_TITLE_HEIGHT;
    const [x, y] = c.ds.convertOffsetToCanvas([n.pos[0], n.pos[1] - th]);
    return { left: box.left + x, top: box.top + y, width: n.size[0] * c.ds.scale, height: (n.size[1] + th) * c.ds.scale };
  }

  function brickNodes(key) {
    const b = E.state().bricks.find((x) => x.key === key);
    return b ? Object.values(b.nodes).map((id) => app.graph.getNodeById(id)).filter(Boolean) : [];
  }

  function union(rects) {
    const l = Math.min(...rects.map((r) => r.left)), t = Math.min(...rects.map((r) => r.top));
    return { left: l, top: t, width: Math.max(...rects.map((r) => r.left + r.width)) - l, height: Math.max(...rects.map((r) => r.top + r.height)) - t };
  }

  // the transform that puts card `el` onto its nodes' screen rect (attachments fly to their host)
  function toNodes(el) {
    let nodes = brickNodes(el.dataset.brick);
    if (!nodes.length) nodes = brickNodes("render");
    if (!nodes.length) return [0, 0, 1, 1];
    const target = union(nodes.map(nodeRect)), card = el.getBoundingClientRect();
    return [target.left - card.left, target.top - card.top, target.width / card.width, target.height / card.height];
  }

  // cards fly on their own springs, but the switch ends when the veil does: then every card is reset and the flight
  // record cleared, even if a drag or a re-render took a card's animation over mid-flight
  function fly(to, done) {
    const cards = reducedMotion() ? [] : [...view.stack.querySelectorAll("[data-brick]")];
    for (const el of cards) {
      const key = el.dataset.brick;
      let sp = flights.get(key);
      if (!sp) { sp = new Spring(to === "graph" ? [0, 0, 1, 1] : toNodes(el), SPRINGS.view, [0.5, 0.5, 0.002, 0.002]); flights.set(key, sp); }
      sp.set(to === "graph" ? toNodes(el) : [0, 0, 1, 1]);
      el.style.transformOrigin = "0 0";
      el.style.willChange = "transform";
      animate(el, sp, ([x, y, sx, sy]) => { el.style.transform = `translate3d(${x}px,${y}px,0) scale(${sx},${sy})`; });
    }
    veil.set([to === "graph" ? 0 : 1], { params: reducedMotion() ? SPRINGS.fade : SPRINGS.view });
    animate(root, veil, ([v]) => root.style.setProperty("--veil", Math.max(0, Math.min(1, v))), () => {
      for (const el of view.stack.querySelectorAll("[data-brick]")) { stop(el); el.style.transform = ""; el.style.willChange = ""; }
      flights.clear();
      done();
    });
  }

  function toSnap() {
    showing = true;
    place();
    root.classList.add("open");
    root.style.display = "";
    container()?.classList.add("snap-open");
    if (!flights.size) view.render(null); // mid-flight: keep the cards so their springs just reverse
    fly("snap", () => {
      if (!showing) return;
      app.canvas.pause_rendering = true;
      root.focus({ preventScroll: true });
    });
  }

  function toGraph(focusKey) {
    showing = false;
    container()?.classList.remove("snap-open");
    app.canvas.pause_rendering = false;
    E.tidy();
    const focus = focusKey ? brickNodes(focusKey) : E.state().bricks.flatMap((b) => brickNodes(b.key));
    if (focus.length) {
      const r = union(focus.map((n) => ({ left: n.pos[0], top: n.pos[1] - LiteGraph.NODE_TITLE_HEIGHT, width: n.size[0], height: n.size[1] + LiteGraph.NODE_TITLE_HEIGHT })));
      app.canvas.ds.fitToBounds([r.left, r.top, r.width, r.height], { zoom: focusKey ? 0.6 : 0.85 });
      if (focusKey) app.canvas.selectNodes(focus);
    }
    app.canvas.setDirty(true, true);
    root.classList.remove("open");
    fly("graph", () => { if (!showing) root.style.display = "none"; });
  }

  root.style.display = "none";
  return {
    toggle: () => (showing ? toGraph() : toSnap()),
    toSnap, toGraph,
    get showing() { return showing; },
  };
}
