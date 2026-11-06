// A set plan drawn in Snap (U97, SNAP-R133; short04: the shrine's plan was drawn outside Snap): shapes and labels on a
// top view, kept on the location record beside the picture they render to (plan {file, shapes}), and the camera marks
// kept as the record's cameras. One painter draws both the saved picture and the editor, so what is saved is what was
// drawn. The saved picture holds shapes and labels only, black on white: camera marks drawn into a plan picture leak
// into renders that cite it (short04, LESSONS 04:28), so the Location sheet draws marks over it instead.
// Coordinates are fractions of the plan from its top left (the same as camera marks and plate poses, SNAP-R84).
// SNAP-R133 a set plan drawn in Snap · SNAP-R84 locations · SNAP-R60 versions · see docs/snap/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as L from "./library.js";
import * as W from "./world.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
export const KINDS = ["rect", "ellipse", "line", "poly", "label"];
const fov = (lens) => (2 * Math.atan(18 / (lens || 35)) * 180) / Math.PI;

export function checkShapes(shapes) {
  return (shapes ?? []).map((s, i) => {
    if (!KINDS.includes(s?.kind)) throw new Error(`shapes[${i}]: kind is one of ${KINDS.join(", ")}; not ${JSON.stringify(s?.kind)}`);
    const need = { rect: ["x", "y", "w", "h"], ellipse: ["x", "y", "w", "h"], line: ["x", "y", "x2", "y2"], label: ["x", "y"], poly: [] }[s.kind];
    const missing = need.filter((k) => typeof s[k] !== "number");
    if (missing.length) throw new Error(`shapes[${i}] (${s.kind}) needs ${missing.join(", ")} as numbers (fractions of the plan from its top left)`);
    if (s.kind === "poly" && !(Array.isArray(s.points) && s.points.length >= 2 && s.points.every((p) => p.length === 2 && p.every((v) => typeof v === "number")))) throw new Error(`shapes[${i}] (poly) needs points [[x, y], …], at least two`);
    if (s.kind === "label" && !s.label?.trim()) throw new Error(`shapes[${i}] (label) needs label: the words`);
    return Object.fromEntries(Object.entries(s).filter(([, v]) => v != null));
  });
}

// draw shapes (and, for the editor only, camera marks and a selection) onto a 2D context of size w × h
export function paint(ctx, shapes, w, h_, { cameras = [], selected = -1, marks = false } = {}) {
  const u = Math.min(w, h_), X = (v) => v * w, Y = (v) => v * h_;
  ctx.save();
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, w, h_);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  // a label in its shape: shrunk to fit the shape's width (never below 9 px), lines centred
  const text = (t, x, y, size, fit = Infinity) => {
    const lines = String(t).split("\n"), font = (px) => `600 ${Math.round(px)}px Inter, system-ui, sans-serif`;
    ctx.font = font(size);
    const wide = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (wide > fit) { size = Math.max(9, (size * fit) / wide); ctx.font = font(size); }
    ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = "#111";
    for (const [k, part] of lines.entries()) ctx.fillText(part, x, y + (k - (lines.length - 1) / 2) * size * 1.15);
  };
  shapes.forEach((s, i) => {
    ctx.save();
    ctx.strokeStyle = "#111"; ctx.fillStyle = "#e9e9e9"; ctx.lineWidth = Math.max(1.5, u * (s.width ?? 0.004));
    const cx = X(s.x ?? 0), cy = Y(s.y ?? 0);
    if (s.kind === "rect" || s.kind === "ellipse") {
      ctx.translate(cx, cy); ctx.rotate(((s.angle ?? 0) * Math.PI) / 180);
      ctx.beginPath();
      if (s.kind === "rect") ctx.rect(-X(s.w) / 2, -Y(s.h) / 2, X(s.w), Y(s.h)); else ctx.ellipse(0, 0, X(s.w) / 2, Y(s.h) / 2, 0, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (s.label) text(s.label, 0, 0, Math.max(10, u * 0.026), X(s.w) * 0.9);
    } else if (s.kind === "line") {
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(X(s.x2), Y(s.y2)); ctx.lineWidth = Math.max(1.5, u * (s.width ?? 0.006)); ctx.stroke();
      if (s.label) text(s.label, (cx + X(s.x2)) / 2, (cy + Y(s.y2)) / 2 - u * 0.025, Math.max(10, u * 0.022));
    } else if (s.kind === "poly") {
      ctx.beginPath(); s.points.forEach(([px, py], k) => (k ? ctx.lineTo(X(px), Y(py)) : ctx.moveTo(X(px), Y(py))));
      if (s.closed !== false && s.points.length > 2) { ctx.closePath(); ctx.fill(); }
      ctx.stroke();
      if (s.label) { const mx = s.points.reduce((a, p) => a + p[0], 0) / s.points.length, my = s.points.reduce((a, p) => a + p[1], 0) / s.points.length; text(s.label, X(mx), Y(my), Math.max(10, u * 0.024)); }
    } else if (s.kind === "label") text(s.label, cx, cy, Math.max(10, u * (s.size ?? 0.03)));
    if (i === selected) { ctx.restore(); ctx.save(); ctx.strokeStyle = "#2b7cff"; ctx.setLineDash([6, 4]); ctx.lineWidth = 2; const b = bounds(s); ctx.strokeRect(X(b.x0) - 4, Y(b.y0) - 4, X(b.x1 - b.x0) + 8, Y(b.y1 - b.y0) + 8); }
    ctx.restore();
  });
  if (marks) for (const c of cameras) {
    if (c.x == null || c.y == null) continue;
    const x = X(c.x), y = Y(c.y), len = u * 0.09, half = (fov(c.lens) / 2) * (Math.PI / 180), a = (((c.heading ?? 0) - 90) * Math.PI) / 180;
    ctx.save(); ctx.fillStyle = "#2b7cff33"; ctx.strokeStyle = "#2b7cff"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + len * Math.cos(a - half), y + len * Math.sin(a - half)); ctx.lineTo(x + len * Math.cos(a + half), y + len * Math.sin(a + half)); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#2b7cff"; ctx.beginPath(); ctx.arc(x, y, u * 0.009, 0, Math.PI * 2); ctx.fill();
    ctx.font = `700 ${Math.round(u * 0.024)}px Inter, system-ui, sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.fillText(c.name, x + u * 0.012, y - u * 0.008);
    ctx.restore();
  }
  ctx.restore();
}
export function bounds(s) {
  if (s.kind === "line") return { x0: Math.min(s.x, s.x2), y0: Math.min(s.y, s.y2), x1: Math.max(s.x, s.x2), y1: Math.max(s.y, s.y2) };
  if (s.kind === "poly") return { x0: Math.min(...s.points.map((p) => p[0])), y0: Math.min(...s.points.map((p) => p[1])), x1: Math.max(...s.points.map((p) => p[0])), y1: Math.max(...s.points.map((p) => p[1])) };
  if (s.kind === "label") return { x0: s.x - 0.05, y0: s.y - 0.02, x1: s.x + 0.05, y1: s.y + 0.02 };
  return { x0: s.x - s.w / 2, y0: s.y - s.h / 2, x1: s.x + s.w / 2, y1: s.y + s.h / 2 };
}
const size = (long, aspect) => (aspect >= 1 ? [long, Math.round(long / aspect)] : [Math.round(long * aspect), long]);
// the plan picture (shapes and labels only) as a PNG blob
export async function render(shapes, { size: long = 1024, aspect = 1.4 } = {}) {
  const [w, hh] = size(long, aspect), c = Object.assign(document.createElement("canvas"), { width: w, height: hh });
  paint(c.getContext("2d"), shapes, w, hh);
  return new Promise((ok) => c.toBlob(ok, "image/png"));
}
// draw and save: the picture into input/snap/location/<id>/ (named by what it shows), then a new location version with
// plan {file, shapes} and the camera marks (kept as they were when none are given)
export async function drawPlan(ref, { shapes, cameras, size: long = 1024, aspect = 1.4, by = "person", note } = {}) {
  await L.ready();
  const { id, body } = L.locationOf(W.refOf("location", W.parse(ref).id)), clean = checkShapes(shapes);
  const name = `plan-${W.short(await W.sha({ clean, long, aspect }))}.png`, form = new FormData();
  form.append("image", await render(clean, { size: long, aspect }), name);
  form.append("subfolder", `snap/location/${id}`);
  form.append("overwrite", "true"); // the name is the drawing's hash: the same drawing is the same file
  const up = await (await api.fetchApi("/upload/image", { method: "POST", body: form })).json(), file = `${up.subfolder}/${up.name}`;
  const out = await L.saveLocation(id, { ...body, plan: { file, shapes: clean }, cameras: cameras ?? body.cameras ?? [] }, { note: note ?? `plan drawn in Snap (${clean.length} shapes)`, by });
  return { location: `location:${id}`, ref: out.ref, version: out.n, made: out.made, plan: file, shapes: clean.length, cameras: (cameras ?? body.cameras ?? []).length };
}

// ---- the editor: a sheet over the Location sheet -------------------------------------------------------------------
// tools: select (click a shape, drag to move, Delete removes), rect / ellipse (drag a box), line (drag), label (click,
// then type), camera (click where it stands, drag where it looks). Save draws the picture and makes the version
export async function openPlanEditor(host, { id, say, onSaved } = {}) {
  host.querySelector(".snap-plan-sheet")?.remove();
  await L.ready();
  const { body } = L.locationOf(`location:${id}`);
  const shapes = structuredClone(body.plan?.shapes ?? []), cameras = structuredClone(body.cameras ?? []);
  const aspect = 1.4, W_ = 980, H_ = Math.round(W_ / aspect);
  let tool = "rect", sel = -1, drag = null;
  const canvas = h("canvas", { width: W_, height: H_, className: "snap-plan-canvas", ariaLabel: "set plan" });
  const status = h("div", { className: "snap-quiet", role: "status" });
  const labelIn = h("input", { placeholder: "label of the selected shape (Gate, Hall, Well…)", ariaLabel: "label", oninput: () => { if (sel >= 0) { shapes[sel].label = labelIn.value; redraw(); } } });
  const tools = h("div", { className: "snap-seg snap-plan-tools", role: "toolbar" });
  const drawTools = () => tools.replaceChildren(...[["select", "Select"], ["rect", "Box"], ["ellipse", "Round"], ["line", "Line / road"], ["label", "Label"], ["camera", "Camera mark"]].map(([k, t]) => h("button", { className: tool === k ? "on" : "", textContent: t, onclick: () => { tool = k; drawTools(); } })));
  const redraw = () => { paint(canvas.getContext("2d"), shapes, W_, H_, { cameras, selected: sel, marks: true }); count.textContent = `${shapes.length} shape${shapes.length === 1 ? "" : "s"} · ${cameras.length} camera mark${cameras.length === 1 ? "" : "s"}`; };
  const count = h("span", { className: "snap-quiet" });
  const at = (e) => { const r = canvas.getBoundingClientRect(); return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))]; };
  const hit = ([x, y]) => { for (let i = shapes.length - 1; i >= 0; i--) { const b = bounds(shapes[i]); if (x >= b.x0 - 0.01 && x <= b.x1 + 0.01 && y >= b.y0 - 0.01 && y <= b.y1 + 0.01) return i; } return -1; };
  const r3 = (v) => Math.round(v * 1000) / 1000;
  canvas.addEventListener("pointerdown", (e) => {
    const p = at(e);
    canvas.setPointerCapture(e.pointerId);
    if (tool === "select") { sel = hit(p); labelIn.value = sel >= 0 ? shapes[sel].label ?? "" : ""; drag = sel >= 0 ? { from: p, was: structuredClone(shapes[sel]) } : null; }
    else if (tool === "camera") { const name = `C${cameras.length + 1}`; cameras.push({ name, x: r3(p[0]), y: r3(p[1]), heading: 0, lens: 35, eye_height: 1.6 }); drag = { camera: cameras.length - 1 }; }
    else if (tool === "label") { shapes.push({ kind: "label", x: r3(p[0]), y: r3(p[1]), label: "Label" }); sel = shapes.length - 1; labelIn.value = "Label"; setTimeout(() => { labelIn.focus(); labelIn.select(); }); }
    else { shapes.push(tool === "line" ? { kind: "line", x: r3(p[0]), y: r3(p[1]), x2: r3(p[0]), y2: r3(p[1]) } : { kind: tool, x: r3(p[0]), y: r3(p[1]), w: 0, h: 0 }); sel = shapes.length - 1; drag = { make: p }; labelIn.value = ""; }
    redraw();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const p = at(e);
    if (drag.camera != null) { const c = cameras[drag.camera]; c.heading = Math.round(((Math.atan2(p[1] - c.y, p[0] - c.x) * 180) / Math.PI + 90 + 360) % 360); }
    else if (drag.make) { const s = shapes[sel], [x0, y0] = drag.make; if (s.kind === "line") { s.x2 = r3(p[0]); s.y2 = r3(p[1]); } else { s.x = r3((x0 + p[0]) / 2); s.y = r3((y0 + p[1]) / 2); s.w = r3(Math.abs(p[0] - x0)); s.h = r3(Math.abs(p[1] - y0)); } }
    else if (drag.from) { const dx = p[0] - drag.from[0], dy = p[1] - drag.from[1], s = shapes[sel], w = drag.was; s.x = r3(w.x + dx); s.y = r3(w.y + dy); if (s.kind === "line") { s.x2 = r3(w.x2 + dx); s.y2 = r3(w.y2 + dy); } if (s.kind === "poly") s.points = w.points.map(([a, b]) => [r3(a + dx), r3(b + dy)]); }
    redraw();
  });
  canvas.addEventListener("pointerup", () => { if (drag?.make) { const s = shapes[sel]; if (s.kind !== "line" && (s.w < 0.01 || s.h < 0.01)) { shapes.splice(sel, 1); sel = -1; } } drag = null; redraw(); });
  const close = () => { sheet.remove(); host.focus?.({ preventScroll: true }); };
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-plan-sheet", role: "dialog", ariaLabel: "Draw the set plan", tabIndex: -1 },
    h("header", {}, h("strong", { textContent: `Set plan: ${body.name}` }), count, h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc): nothing is saved", onclick: close })),
    h("div", { className: "snap-plan-body" }, tools, canvas,
      h("div", { className: "snap-plan-row" }, labelIn,
        h("button", { className: "snap-link", textContent: "Delete selected", onclick: () => { if (sel >= 0) { shapes.splice(sel, 1); sel = -1; labelIn.value = ""; redraw(); } } }),
        h("button", { className: "snap-link", textContent: "Remove last camera mark", onclick: () => { cameras.pop(); redraw(); } })),
      h("div", { className: "snap-quiet", textContent: "The saved picture keeps the shapes and labels only (black on white); camera marks stay on the record and the Location sheet draws them over it." }),
      h("div", { className: "snap-set-actions" }, h("button", { className: "snap-primary", textContent: "Save the plan", onclick: async () => {
        try { const out = await drawPlan(`location:${id}`, { shapes, cameras, by: "person" }); status.textContent = out.made ? `Saved: ${body.name} v${out.version}` : "Nothing changed"; say?.(status.textContent); onSaved?.(out); } catch (err) { status.textContent = err.message; say?.(err.message, true); }
      } })), status));
  sheet.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.stopPropagation(); close(); }
    if ((e.key === "Delete" || e.key === "Backspace") && sel >= 0 && document.activeElement !== labelIn) { shapes.splice(sel, 1); sel = -1; redraw(); }
  });
  drawTools(); redraw();
  host.append(sheet);
  sheet.focus({ preventScroll: true });
  return sheet;
}
export const PLAN_STYLE = `
.snap-sheet.snap-plan-sheet { z-index: 86; inset: 48px max(16px, calc(50% - 540px)) auto; max-height: calc(100% - 72px); display: flex; flex-direction: column; overflow: auto; }
.snap-plan-body { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px 16px; }
.snap-plan-canvas { width: 100%; height: auto; border-radius: 8px; border: 1px solid var(--s-line); cursor: crosshair; touch-action: none; background: #fff; }
.snap-plan-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; } .snap-plan-row input { flex: 1; min-width: 200px; }
`;
