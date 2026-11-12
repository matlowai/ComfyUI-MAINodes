// A take picker (UI-01 "+ Add › a take", UI-03 the Cast sheet's "+ from a take"): every scene › shot with its takes as
// thumbnails, stills and videos alike, then takes in no scene, newest first. A press hands the take back; a video gives
// its last frame unless the caller asks for another. Reading only: nothing is written here.
// SNAP-R118 references you can edit · SNAP-R80 every picture one click from full size · SNAP-R287 an example's take · see docs/snap/SNAP_RULES.md
import * as T from "./takes.js";
import * as SC from "./scenes.js";
import { full } from "./lightbox.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const shown = (t) => t.media.find((m) => m.kind === "image") ?? t.media.find((m) => m.kind === "video");

// opens over host; pick(take) is called with the chosen take and the sheet closes. `only` keeps the takes it accepts (an
// example offers this graph's takes, SNAP-R287). Returns the sheet
export async function pickTake(host, { title = "Pick a take", pick, only = () => true }) {
  host.querySelector(".snap-take-picker")?.remove();
  await Promise.all([T.load(), SC.load()]);
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const tile = (t, label) => {
    const m = shown(t);
    if (!m || t.locked || t.status === "error" || !only(t)) return null;
    const use = () => { close(); pick(t); }, src = T.url(m);
    const media = full(m.kind === "video" ? h("video", { src, muted: true, preload: "metadata" }) : h("img", { src, alt: label, loading: "lazy" }),
      { src, name: label, kind: m.kind, source: `output/${m.subfolder ? `${m.subfolder}/` : ""}${m.filename}` }, "picker", { label: "Use this take", run: use });
    return h("figure", { className: "snap-picker-take", title: `${label}${t.created ? ` · ${new Date(t.created).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}` : ""}${t.text ? ` · ${t.text}` : ""}` }, media,
      h("button", { className: "snap-link snap-quiet-btn", textContent: `Use ${label}`, onclick: use }));
  };
  const seen = new Set(), rows = [];
  for (const scene of SC.all()) for (const shot of scene.shots) {
    const tiles = SC.takesOf(shot).map((e) => T.get(e.take)).filter(Boolean).map((t) => (seen.add(t.id), tile(t, `${SC.label(t)}${t.media.some((m) => m.kind === "video") ? " · last frame" : ""}`))).filter(Boolean);
    if (tiles.length) rows.push(h("div", { className: "snap-picker-row" }, h("div", { className: "snap-rail-title", textContent: `${scene.name} › ${SC.shotTitle(scene, shot)}` }), h("div", { className: "snap-picker-tiles" }, tiles)));
  }
  const loose = [...T.all()].filter((t) => !seen.has(t.id)).sort((a, b) => b.created - a.created).map((t) => tile(t, `Take ${t.number}`)).filter(Boolean);
  if (loose.length) rows.push(h("div", { className: "snap-picker-row" }, h("div", { className: "snap-rail-title", textContent: "Takes in no scene" }), h("div", { className: "snap-picker-tiles" }, loose)));
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-take-picker", role: "dialog", ariaLabel: title },
    h("header", {}, h("strong", { textContent: title }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
    rows.length ? h("div", { className: "snap-picker-body" }, rows) : h("div", { className: "snap-quiet", textContent: "No takes here yet: run one, then pick it" }));
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  host.append(sheet);
  sheet.tabIndex = -1; sheet.focus();
  return sheet;
}
