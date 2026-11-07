// The critic on the object (U93 B4, DESIGN_U93_U94 §4.3, §4.5): a take's critique where the take is. The take card says
// what the critic said ("critic: 2 high", "critic: clean", "critic reading…", "critique due"); the take viewer draws each
// note's region as a mask (a translucent fill, an outline and its label, coloured by severity) over the picture, lists the
// notes high to low with their pass, owner and fix, and offers two presses per note: Fix at source (the owner's picture
// with the mask drawn and a New view of it whose prompt is the fix line, so the fix lands as candidates beside the old
// one; a location or Cast owner also opens its sheet) and Add as fixture (the note becomes a critic fixture). A due
// critique nobody claimed says "no critic on duty" with "Critique it yourself": the same packet, as a sheet. The Location
// sheet shows the critic per picture, "Critique this location", and "Re-run dependents" with its plan; "Show masks" draws
// every note of every row that holds for this version on its picture at once (the master, the plan, each plate; "every
// view" notes on the picture they name), each mask a box with a small numbered badge and nothing written over the
// picture, and the notes listed below by number with their pass, owner and fix (F-E03..F-E06, F-E21).
// Candidate tiles carry the critic's chip beside the other notes. Nothing here is hidden, rejected or held by a note.
// SNAP-R103 notes as masks, they inform · SNAP-R105 fix at the source · SNAP-R106 re-run dependents · SNAP-R108 a miss
// is one press from a fixture · SNAP-R110 a stale critique says why · SNAP-R156 Fix at source opens the part the owner names · SNAP-R5 only a press moves · SNAP-R136 masks:
// all at once, numbered, never words over the picture · see docs/snap/SNAP_RULES.md
import * as CR from "./critiques.js";
import * as DP from "./dependents.js";
import * as T from "./takes.js";
import * as W from "./world.js";
import * as ED from "./edits.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const COLOR = { high: "#e5484d", medium: "#f0b445", low: "#6aa8ff" };
const ORDER = { high: 0, medium: 1, low: 2 };
const FPS = 24;
const STYLE_TEXT = `
.snap-critic-chip { font-size: 11px; padding: 1px 6px; border-radius: 6px; white-space: nowrap; background: #ffffff14; color: var(--s-dim); }
.snap-critic-chip.high { background: #e5484d33; color: var(--s-fg); } .snap-critic-chip.clean { background: #57c78526; color: var(--s-fg); } .snap-critic-chip.late { background: #f0b44526; color: var(--s-fg); }
.snap-critic-masks { grid-area: 1 / 1; width: 100%; height: 100%; pointer-events: none; position: relative; z-index: 1; }
.snap-critic { display: grid; gap: 6px; padding: 10px 12px; border-radius: 10px; border: 1px solid var(--s-line); background: #ffffff08; }
.snap-critic-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.snap-critic-notes { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.snap-critic-notes li { display: grid; gap: 2px; padding: 6px 8px; border-radius: 8px; border-left: 3px solid var(--sev); background: #ffffff0a; cursor: pointer; }
.snap-critic-notes li.on { background: #ffffff18; }
.snap-critic-sev { font-size: 11px; font-weight: 700; color: var(--sev); text-transform: uppercase; letter-spacing: .04em; }
.snap-critic-fix { color: var(--s-dim); } .snap-critic-stale { color: #f0b445; font-size: 12px; }
.snap-critic-foot.late, .snap-critic-late { color: #f0b445; }
.snap-critic-pic { position: relative; display: inline-block; max-width: 100%; }
.snap-critic-pic img { display: block; max-width: 100%; max-height: 52vh; border-radius: 8px; }
.snap-critic-box { position: absolute; border: 2px solid var(--sev); background: color-mix(in srgb, var(--sev) 22%, transparent); border-radius: 3px; pointer-events: none; }
.snap-critic-box b { position: absolute; left: -2px; top: -18px; font-size: 11px; padding: 0 4px; border-radius: 4px; background: var(--sev); color: #000; white-space: nowrap; }
.snap-critic-sheet .snap-critic-prompt { width: 100%; min-height: 70px; }
.snap-critic-packet { display: grid; gap: 10px; padding: 4px 16px 16px; overflow: auto; } .snap-critic-sheet select { color: var(--s-fg); } .snap-critic-packet figure { margin: 0; } .snap-critic-packet img { max-width: 100%; border-radius: 6px; }
.snap-critic-loc { display: grid; gap: 4px; }
.snap-critic-loc-head { display: flex; gap: 8px; align-items: baseline; flex-wrap: wrap; }
.snap-critic-loc-row { display: flex; gap: 6px; flex-wrap: wrap; font-size: 12px; }
.snap-loc-pic { position: relative; display: block; overflow: hidden; border-radius: 8px; line-height: 0; }
.snap-loc-pic > img { aspect-ratio: auto !important; height: auto !important; object-fit: fill !important; }
.snap-mask { position: absolute; border: 2px solid var(--sev); background: color-mix(in srgb, var(--sev) 18%, transparent); border-radius: 3px; pointer-events: none; box-sizing: border-box; }
.snap-mask.lit { border-width: 3px; background: color-mix(in srgb, var(--sev) 34%, transparent); box-shadow: 0 0 0 2px #0b1220; }
.snap-mask i { position: absolute; left: 1px; top: 1px; min-width: 15px; height: 15px; padding: 0 3px; box-sizing: border-box; border-radius: 8px; background: var(--sev); color: #0b1220; font: 700 10px/15px Inter, system-ui, sans-serif; font-style: normal; text-align: center; }
.snap-critic-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 340px; overflow: auto; }
.snap-critic-list li { display: grid; grid-template-columns: auto 1fr; gap: 1px 6px; padding: 4px 6px; border-radius: 6px; border-left: 3px solid var(--sev); background: #ffffff08; cursor: pointer; font-size: 12px; line-height: 1.35; }
.snap-critic-list li.on { background: #ffffff1c; }
.snap-critic-list li > b { grid-row: span 3; min-width: 18px; height: 18px; border-radius: 9px; background: var(--sev); color: #0b1220; font-size: 11px; text-align: center; line-height: 18px; }
.snap-critic-list li > span { overflow-wrap: anywhere; } .snap-critic-list .snap-quiet { font-size: 11px; }
`;
let styled = false;
const style = () => { if (styled) return; styled = true; document.head.append(h("style", { textContent: STYLE_TEXT })); };

// ---- the card's chip -------------------------------------------------------------------------------------------------
function chipText(id) {
  const r = CR.latestOf(id);
  if (!r) return null;
  const st = CR.stateOf(r), stale = CR.staleOf(r), c = CR.counts(r);
  if (st === "due") return { text: Date.now() - r.created > 300000 ? "critique due · no critic on duty" : "critique due", cls: "late" };
  if (st === "claimed") return { text: "critic reading…", cls: "" };
  if (st === "skipped") return { text: "critic skipped", cls: "" };
  if (st === "stale") return { text: "critique not read · stale", cls: "", title: `stale: ${stale}` }; // SNAP-R136: never written, its subject moved on
  return { text: `critic: ${CR.countText(r)}${stale ? " · stale" : ""}`, cls: c.high ? "high" : r.verdict === "clean" ? "clean" : "", title: stale ? `stale: ${stale}` : r.notes.map((n) => `[${n.severity}] ${n.text ?? n.words}`).join("\n") };
}
export function paintChip(el) { const x = chipText(el.dataset.take); el.hidden = !x; if (x) { el.textContent = x.text; el.className = `snap-critic-chip ${x.cls}`; el.title = x.title ?? ""; } }
export function chip(t) { style(); const el = h("span", { className: "snap-critic-chip", hidden: true }); el.dataset.take = t.id; paintChip(el); return el; }
export const repaint = (root) => { for (const el of root.querySelectorAll(".snap-critic-chip[data-take]")) paintChip(el); };
export const watch = (root) => CR.onChange(() => repaint(root)); // one listener per strip, not per card
// a candidate tile's chip: its take's critique, or a painted candidate's own
export function candidateChips(c) {
  const id = c.take ?? (c.prompt_id ? `take-${c.prompt_id}` : null);
  if (id && T.get(id)) return [chip(T.get(id))];
  const n = c.notes?.critic;
  return n ? [h("span", { className: `snap-critic-chip ${n.high ? "high" : n.verdict === "clean" ? "clean" : ""}`, textContent: n.verdict === "clean" ? "critic: clean" : `critic: ${n.high} high · ${n.medium} medium` })] : [];
}

// ---- masks on a picture: [x, y, w, h] fractions inside the picture's box on the stage --------------------------------
export function drawMasks(canvas, fit, notes, { on } = {}) {
  const f = fit();
  canvas.width = f.r.width; canvas.height = f.r.height;
  const g = canvas.getContext("2d");
  g.clearRect(0, 0, canvas.width, canvas.height);
  for (const n of notes) {
    if (!n.region) continue;
    const [x, y, w, hh] = [f.x + n.region[0] * f.w, f.y + n.region[1] * f.h, n.region[2] * f.w, n.region[3] * f.h], col = COLOR[n.severity] ?? COLOR.low;
    g.globalAlpha = on && on !== n.id ? 0.35 : 1;
    g.fillStyle = `${col}38`; g.fillRect(x, y, w, hh);
    g.strokeStyle = col; g.lineWidth = on === n.id ? 3 : 2; g.setLineDash([]); g.strokeRect(x, y, w, hh);
    // the label is a solid chip, never dimmed with its mask: a severity bar, then the note's words in white on near-black,
    // as wide as fits in the picture (the whole note is in the list beside it)
    g.globalAlpha = 1;
    g.font = "600 12px Inter, system-ui, sans-serif";
    const room = Math.max(60, canvas.width - 16), words = `${n.severity} · ${n.text ?? n.words ?? ""}`;
    let label = words;
    while (label.length > 8 && g.measureText(label).width + 18 > room) label = `${label.slice(0, -2).trimEnd()}…`;
    const tw = g.measureText(label).width + 18, ly = y > 22 ? y - 21 : y + hh + 3, lx = Math.max(0, Math.min(x, canvas.width - tw)); // the label stays inside the picture
    g.fillStyle = on && on !== n.id ? "#0b1220c0" : "#0b1220ee"; g.fillRect(lx, ly, tw, 19);
    g.fillStyle = col; g.fillRect(lx, ly, 4, 19);
    g.fillStyle = on && on !== n.id ? "#ffffffb0" : "#fff"; g.fillText(label, lx + 10, ly + 14);
  }
  g.globalAlpha = 1;
}

// ---- the take viewer's critic block -------------------------------------------------------------------------------------
// ctx: { stage, fit, player, isVideo, say, host }
export function panel(t, { stage, fit, player, isVideo, say, host }) {
  style();
  const canvas = h("canvas", { className: "snap-critic-masks" }), box = h("section", { className: "snap-critic", ariaLabel: "critic" });
  stage.insertBefore(canvas, stage.querySelector(".snap-take-overlay")); // under the marking overlay
  let on = null;
  const notes = () => t.notes.filter((n) => n.critique && CR.get(n.critique)).sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || a.t - b.t);
  const near = (n) => !isVideo || Math.abs((n.t ?? 0) - player.currentTime) <= 0.6;
  const paint = () => drawMasks(canvas, fit, notes().filter(near), { on });
  const draw = () => {
    const r = CR.latestOf(t.id), st = r && CR.stateOf(r), stale = r && CR.staleOf(r), list = notes();
    const head = !r ? h("span", { className: "snap-quiet", textContent: "No critique for this take (it landed before the critic started)" })
      : st === "due" ? [h("span", { className: Date.now() - r.created > 300000 ? "snap-critic-late" : "snap-quiet", textContent: Date.now() - r.created > 300000 ? "Critique due · no critic on duty" : "Critique due · waiting for a critic" }), h("button", { className: "snap-link", textContent: "Critique it yourself", title: "the packet a critic would read: every picture whole, then tiles, then the context", onclick: () => packetSheet(host, r, { say }) })]
      : st === "claimed" ? h("span", { className: "snap-quiet", textContent: `${r.claimed.by} is reading it…` })
      : st === "skipped" ? h("span", { className: "snap-quiet", textContent: `Skipped by ${r.skipped.by}: ${r.skipped.why}` })
      : st === "stale" ? h("span", { className: "snap-quiet", textContent: "Not read before its subject moved on (off the docket)" })
      : [h("strong", { textContent: `Critic: ${CR.countText(r)}` }), h("span", { className: "snap-quiet", textContent: `${r.done.by.replace(/^agent:?/, "") || "an agent"} · ${r.checklist}` }), r.verdict_set?.verdict ? h("span", { className: "snap-quiet", textContent: "✓ kept by the critic (approval: critic)" }) : null];
    box.replaceChildren(...[h("div", { className: "snap-rail-title", textContent: "Critic" }), h("div", { className: "snap-critic-head" }, head), stale ? h("div", { className: "snap-critic-stale", textContent: `stale: ${stale}` }) : null,
      list.length ? h("ol", { className: "snap-critic-notes" }, list.map((n) => {
        const li = h("li", { className: on === n.id ? "on" : "", style: `--sev:${COLOR[n.severity]}`, onclick: () => { on = on === n.id ? null : n.id; if (isVideo) { player.pause(); player.currentTime = n.t ?? 0; } draw(); } },
          h("div", {}, h("span", { className: "snap-critic-sev", textContent: `${n.severity} · ${n.pass}` }), n.region ? h("em", { className: "snap-quiet", textContent: " ▭ mask" }) : null),
          h("span", { textContent: n.text ?? "" }), n.fix ? h("span", { className: "snap-critic-fix", textContent: `fix: ${n.fix}` }) : null,
          h("span", { className: "snap-quiet", textContent: `owner: ${ownerText(n.owner)}` }),
          h("div", { className: "snap-set-actions" }, h("button", { className: "snap-link", textContent: "Fix at source", title: "the picture this flaw was born in, with the mask drawn, and a New view of it with the fix line", onclick: (e) => { e.stopPropagation(); fixSheet(host, t, n, { say }); } }),
            n.fixture ? h("span", { className: "snap-quiet", textContent: `fixture ${n.fixture.id}` }) : h("button", { className: "snap-link snap-quiet-btn", textContent: "Add as fixture", onclick: (e) => { e.stopPropagation(); addFixture(t, n, say).then(draw); } })));
        return li;
      })) : null,
      ...mine(t, say, draw)].filter(Boolean)); // a null child would print "null"
    paint();
  };
  CR.onChange(() => { if (box.isConnected) draw(); });
  T.onChange(() => { if (box.isConnected) draw(); });
  if (isVideo) player.addEventListener("timeupdate", () => { if (box.isConnected) paint(); });
  new ResizeObserver(() => paint()).observe(stage);
  draw();
  return box;
}
// the person's own "went wrong" notes, each one press from a fixture (the critic missed it)
function mine(t, say, draw) {
  const list = t.notes.filter((n) => n.by === "person" && n.sentiment === "wrong");
  if (!list.length) return [];
  return [h("div", { className: "snap-quiet", textContent: "Your notes: one press makes a note a fixture, so the critic is measured on it" }),
    h("ul", { className: "snap-critic-notes" }, list.map((n) => h("li", { style: "--sev:#9a9ca5" }, h("span", { textContent: n.text || n.tags.join(", ") }),
      n.fixture ? h("span", { className: "snap-quiet", textContent: `fixture ${n.fixture.id}` }) : h("button", { className: "snap-link snap-quiet-btn", textContent: "Add as fixture", onclick: () => addFixture(t, n, say).then(draw) }))))];
}
async function addFixture(t, n, say) { try { say?.((await CR.addFixture({ take: t.id, note: n.id, polarity: "positive" })).said); } catch (err) { say?.(err.message, true); } }
const ownerText = (o) => (!o ? "take" : typeof o === "string" ? o : o.ref ? `${o.ref}${o.parts ? `, ${o.parts.join(" / ")}` : o.part ? `, ${o.part}` : o.unmapped ? ` (“${o.words}”: no part named)` : ""}` : o.what ?? o.words ?? "take");

// ---- Fix at source (SNAP-R105) -------------------------------------------------------------------------------------
// the owner's picture: a location's master, plan or plate at the version the take pinned, a Cast's first picture, else
// the take itself (a board, a prompt); with the mask drawn when the flaw was marked on that same picture
function ownerPicture(t, n) {
  const o = n.owner ?? {};
  if (o.ref?.startsWith("location:")) {
    // F-K09 (SNAP-R156): the part the critic named; notes, camera marks or an unmapped owner have no picture to redraw
    const got = W.get(o.ref), b = got?.version.body, part = o.part ?? null;
    const p = part === "master" ? b?.master : part === "plan" ? b?.plan : part === "map" ? b?.map : b?.plates?.find((x) => `plate ${x.name}` === part);
    if (!p && b) return { record: o.ref, label: `${b.name} v${got.version.n}, ${part === "marks" ? "camera marks and plate poses" : part === "notes" ? "notes and scale" : "no part named"}`, words: true,
      how: part === "marks" ? "Fix the typed numbers on the Location sheet (or add_plate {location, name, pose} / {camera: {name, eye_height}}): no picture changes" : part === "notes" ? "Fix the record's notes or scale on the Location sheet (save_location {location, notes, scale}): no picture changes" : o.unmapped ?? "The note names no part of the place: open the Location sheet and fix it where it was born" };
    if (p) return { src: viewInput(p.file), label: `${b.name} v${got.version.n}, ${part}`, context: { location: W.refOf("location", W.parse(o.ref).id, got.version.n), plate: part === "master" || part === "plan" ? part : part.replace(/^plate /, "") }, purpose: part === "master" ? "master" : "plate", record: o.ref };
  }
  if (o.ref?.startsWith("cast:")) { const got = W.get(o.ref), r0 = got?.version.body.refs?.[0]; if (r0) return { src: viewInput(r0.file), label: `${got.version.body.name} v${got.version.n}`, context: { cast: o.ref, ref: 0 }, purpose: "cast_picture", record: o.ref }; }
  if (!t) return { record: o.ref ?? "", label: o.ref ?? "the record", words: true, how: `${o.ref ?? "Its record"} has no such version here any more: open the Location sheet` };
  const m = t.media.find((x) => x.kind === "image") ?? t.media[0], frame = n.t != null ? Math.round(n.t * FPS) : null;
  return { src: T.url(m), label: `take ${t.number}${m.kind === "video" ? `, frame ${frame ?? 0}` : ""}`, context: { take: t.id, ...(m.kind === "video" ? { frame: frame ?? 0 } : {}) }, purpose: ED.purposeOf(t)?.purpose ?? "edit", sameAsNote: true, video: m.kind === "video" };
}
const viewInput = (file) => { const cut = file.lastIndexOf("/"); return T.url({ filename: file.slice(cut + 1), subfolder: file.slice(0, Math.max(cut, 0)), type: "input" }); };
export function fixSheet(host, t, n, { say }) {
  style();
  host.querySelector(".snap-critic-sheet")?.remove();
  const own = ownerPicture(t, n), status = h("div", { className: "snap-quiet", role: "status" });
  if (own.words) return wordsSheet(host, n, own);
  const pic = own.video ? h("video", { src: own.src, muted: true, preload: "auto" }) : h("img", { src: own.src, alt: own.label });
  if (own.video) pic.addEventListener("loadedmetadata", () => { pic.currentTime = n.t ?? 0; });
  const fig = h("div", { className: "snap-critic-pic" }, pic, own.sameAsNote && n.region ? h("div", { className: "snap-critic-box", style: `--sev:${COLOR[n.severity]};left:${n.region[0] * 100}%;top:${n.region[1] * 100}%;width:${n.region[2] * 100}%;height:${n.region[3] * 100}%` }, h("b", { textContent: n.severity })) : null);
  const prompt = h("textarea", { className: "snap-note-input snap-critic-prompt", value: n.fix ? `${n.fix}. Keep everything else as it is.` : "", ariaLabel: "the fix, as the New view's words" });
  const purposes = Object.keys(ED.purposes()), purpose = h("select", { ariaLabel: "purpose" }, purposes.map((p) => h("option", { value: p, textContent: p, selected: p === own.purpose })));
  const crop = h("input", { type: "checkbox", checked: false, disabled: !(own.sameAsNote && n.region) }), close = () => { sheet.remove(); removeEventListener("keydown", esc, true); };
  const esc = (e) => { if (e.key === "Escape" && sheet.isConnected) { e.stopImmediatePropagation(); e.preventDefault(); close(); } }; // before the viewer's own Esc (it listens on document)
  addEventListener("keydown", esc, true);
  const run = async () => {
    try {
      const pics = [{ ...own.context, label: own.label }, ...(crop.checked ? [{ ...own.context, crop: n.region, label: `${own.label}, the marked region` }] : [])];
      const out = await ED.fromContext(pics, prompt.value.trim(), { purpose: purpose.value, count: 2, by: "person" });
      status.textContent = `${out.candidates?.length ?? 2} candidates are rendering: they land beside ${own.label} to pick from${own.record ? "; a pick of a plate or master is the record's next version (then Re-run dependents on the Location sheet)" : ""}`;
      say?.(status.textContent);
    } catch (err) { status.textContent = err.message; say?.(err.message, true); }
  };
  const openOwner = own.record?.startsWith("location:") ? h("button", { className: "snap-link", textContent: "Open the Location sheet", onclick: async () => { const { ui } = await import("./tools.js"); close(); await ui.act("location", own.record); } }) : null; // tools.js imports this view's store: loaded on the press
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-critic-sheet", role: "dialog", ariaLabel: "Fix at source" },
    h("header", {}, h("strong", { textContent: `Fix at source: ${own.label}` }), h("span", { className: "snap-quiet", textContent: ` · ${n.severity} · ${n.pass}` }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
    h("div", { className: "snap-critic-packet" },
      h("p", {}, h("strong", { textContent: n.text ?? "" }), own.record ? h("span", { className: "snap-quiet", textContent: ` · born in ${own.record}${n.owner.part ? `, ${n.owner.part}` : ""}` }) : null),
      fig,
      h("label", { className: "snap-field" }, h("span", { textContent: "New view of it, in these words" }), prompt),
      h("div", { className: "snap-set-actions" }, h("label", {}, "purpose ", purpose), h("label", { className: "snap-quiet", title: own.sameAsNote ? "the marked region as a second context picture" : "the mask was drawn on the take, not on this picture" }, crop, " also the marked region")),
      h("div", { className: "snap-set-actions" }, h("button", { className: "snap-primary", textContent: "Make 2 candidates", title: "a New view of this picture (GPU time); the old one stays until you pick", onclick: run }), openOwner),
      status));
  host.append(sheet);
  return sheet;
}

// F-K09: a flaw born in the record's words or typed numbers: the note, where it lives, and the Location sheet
function wordsSheet(host, n, own) {
  const close = () => { sheet.remove(); removeEventListener("keydown", esc, true); };
  const esc = (e) => { if (e.key === "Escape" && sheet.isConnected) { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  addEventListener("keydown", esc, true);
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-critic-sheet", role: "dialog", ariaLabel: "Fix at source" },
    h("header", {}, h("strong", { textContent: `Fix at source: ${own.label}` }), h("span", { className: "snap-quiet", textContent: ` · ${n.severity} · ${n.pass}` }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
    h("div", { className: "snap-critic-packet" },
      h("p", {}, h("strong", { textContent: n.text ?? "" }), h("span", { className: "snap-quiet", textContent: ` · born in ${own.record}${n.owner?.part ? `, ${n.owner.part}` : ""}` })),
      ...[n.fix ? h("p", { className: "snap-critic-fix", textContent: `fix: ${n.fix}` }) : null, h("p", { className: "snap-quiet", textContent: own.how })].filter(Boolean),
      h("div", { className: "snap-set-actions" }, h("button", { className: "snap-primary", textContent: "Open the Location sheet", onclick: async () => { const { ui } = await import("./tools.js"); close(); await ui.act("location", own.record); } }))));
  host.append(sheet);
  return sheet;
}

// ---- Critique it yourself: the packet as a sheet --------------------------------------------------------------------
export async function packetSheet(host, r, { say }) {
  style();
  host.querySelector(".snap-critic-sheet")?.remove();
  const body = h("div", { className: "snap-critic-packet" }, h("span", { className: "snap-quiet", textContent: "reading the packet…" }));
  const close = () => { sheet.remove(); removeEventListener("keydown", esc, true); };
  const esc = (e) => { if (e.key === "Escape" && sheet.isConnected) { e.stopImmediatePropagation(); e.preventDefault(); close(); } };
  addEventListener("keydown", esc, true);
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-critic-sheet", role: "dialog", ariaLabel: "Critique packet" },
    h("header", {}, h("strong", { textContent: r.title }), h("span", { className: "snap-quiet", textContent: ` · ${r.checklist}` }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", onclick: close })), body);
  host.append(sheet);
  try {
    const p = await CR.packet(r.id, {}), w = p.words;
    body.replaceChildren(h("p", { className: "snap-quiet", textContent: `${w.label}: ${w.passes.join(", ")}${w.prompt ? ` · beat: ${w.prompt}` : ""}${w.context ? ` · ${w.context}` : ""}` }),
      ...p.images.map((img) => h("figure", {}, h("img", { src: `data:${img.mimeType};base64,${img.data}`, alt: img.label }), h("figcaption", { className: "snap-quiet", textContent: img.label }))));
  } catch (err) { body.replaceChildren(h("p", { className: "snap-world-warn", textContent: err.message })); say?.(err.message, true); }
  return sheet;
}

// ---- the Location sheet's critic block (SNAP-R103, R106) --------------------------------------------------------------
// the picture of a location a note's mask lands on: the row's own part, or for "every view" the packet picture it named
export function notePart(r, x) {
  if (r.subject.part !== "views") return r.subject.part;
  const what = r.packet?.pictures?.[x.picture ?? 0]?.what ?? "";
  return what.match(/, (master|plan|map|plate .+)$/)?.[1] ?? null;
}
// every note of the rows that hold for location ref (SNAP-R136), numbered high first: [{k, row, note, part}]
// F-G10: the "every view" row and a plate's own row often write the same note on the same region: it is one note (also
// names the other row), numbered and drawn once
export function locationNotes(ref) {
  const order = (a, b) => ORDER[a.note.severity] - ORDER[b.note.severity], seen = new Map(), out = [];
  for (const x of CR.holding(ref).filter((r) => r.done).flatMap((r) => r.notes.map((n) => ({ row: r, note: n, part: notePart(r, n) }))).sort(order)) {
    const key = x.note.region && x.part ? `${x.part}|${x.note.severity}|${x.note.region.map((v) => v.toFixed(2)).join(",")}` : null, first = key && seen.get(key);
    if (first) { first.also = [...(first.also ?? []), x.row.id]; continue; }
    if (key) seen.set(key, x);
    out.push(x);
  }
  return out.map((x, i) => ({ ...x, k: i + 1 }));
}
// the masks on a sheet (or any root holding .snap-loc-pic[data-part] wrappers): all notes at once, a numbered badge each
export function paintMasks(root, list, { on = true, lit = null } = {}) {
  for (const x of root.querySelectorAll(".snap-mask")) x.remove();
  if (!on) return;
  for (const { k, note, part } of list) {
    const holder = note.region && part && root.querySelector(`.snap-loc-pic[data-part="${CSS.escape(part)}"]`);
    if (!holder) continue;
    const [x, y, w, hh] = note.region;
    const m = h("div", { className: `snap-mask${lit === k ? " lit" : ""}`, title: `${k} · ${note.severity} · ${note.text ?? note.words ?? ""}`, style: `--sev:${COLOR[note.severity] ?? COLOR.low};left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${hh * 100}%` }, h("i", { textContent: String(k) }));
    m.dataset.k = k;
    holder.append(m);
  }
}
const sheetMasks = new WeakMap(); // a sheet's mask switch survives the block redrawing
export function showMasks(sheet, on) { sheetMasks.set(sheet, on); sheet.dispatchEvent(new Event("snap-masks")); }
export const masksOn = (sheet) => sheetMasks.get(sheet) ?? false;
export function locationBlock({ id, n, say }) {
  style();
  const box = h("section", { className: "snap-critic-loc" }), ref = W.refOf("location", id, n);
  let lit = null;
  const sheetOf = () => box.closest(".snap-loc-sheet");
  const draw = () => {
    const rows = CR.holding(ref), list = locationNotes(ref), plan = (() => { try { return DP.plan(W.refOf("location", id)); } catch { return null; } })(), sheet = sheetOf(), on = sheet ? masksOn(sheet) : false;
    const line = (r) => { const st = CR.stateOf(r), was = W.parse(r.subject.ref).n;
      return h("div", { className: "snap-critic-loc-row" }, h("span", {}, `${r.subject.part === "views" ? "every view" : r.subject.part}: `,
        h("span", { className: CR.counts(r).high ? "snap-critic-late" : "snap-quiet", textContent: st === "done" ? CR.countText(r) : st === "due" ? "critique due" : st === "claimed" ? "critic reading…" : st }),
        was !== n ? h("span", { className: "snap-quiet", title: `this row was made for v${was}; its picture is the same in v${n}, so it still holds`, textContent: ` · read on v${was}` }) : null)); // F-E16
    };
    const masked = list.filter((x) => x.note.region && x.part).length;
    const stages = plan?.stages.filter((s) => s.takes.length) ?? [];
    box.replaceChildren(...[h("div", { className: "snap-critic-loc-head" }, h("div", { className: "snap-rail-title", textContent: `Critic (v${n})` }),
        masked ? h("button", { className: "snap-link", textContent: on ? `Hide masks` : `Show masks (${masked})`, title: "every note's region on its picture at once, numbered as in the list", onclick: () => { if (sheet) showMasks(sheet, !on); } }) : null),
      ...(rows.length ? rows.map(line) : [h("div", { className: "snap-quiet", textContent: "No critique for this version yet" })]),
      list.length ? h("ol", { className: "snap-critic-list" }, list.map((x) => h("li", { className: lit === x.k ? "on" : "", style: `--sev:${COLOR[x.note.severity]}`, onclick: () => { lit = lit === x.k ? null : x.k; if (sheet && lit && !masksOn(sheet)) showMasks(sheet, true); else draw(); sheet?.querySelector(`.snap-mask[data-k="${x.k}"]`)?.scrollIntoView({ block: "nearest" }); } },
        h("b", { textContent: String(x.k) }), h("span", {}, h("strong", { textContent: `${x.note.severity} · ${x.part ?? "the record"} · ` }), x.note.text ?? x.note.words ?? ""),
        h("span", { className: "snap-quiet", textContent: `owner: ${ownerText(x.note.owner)}${x.note.region && x.part ? "" : " · no mask"}` }), x.note.fix ? h("span", { className: "snap-critic-fix", textContent: `fix: ${x.note.fix}` }) : null,
        x.note.owner?.ref?.startsWith("location:") ? h("button", { className: "snap-link snap-quiet-btn", textContent: "Fix at source", title: "the part this flaw was born in (its owner), not the picture it was seen on (F-K09)", onclick: (e) => { e.stopPropagation(); const sheet = sheetOf(); fixSheet(sheet?.parentElement ?? document.body, null, x.note, { say }); } }) : null))) : null,
      h("div", { className: "snap-set-actions" }, h("button", { className: "snap-link", textContent: "Critique this location", title: "every view of this version side by side, as one critique row for a critic", onclick: async () => {
        try { const { TOOLS } = CR; const out = await TOOLS.find((x) => x.name === "critique").run({ location: ref, part: "views", again: true }); say?.(`${out.title}: on the docket`); } catch (err) { say?.(err.message, true); } } })),
      stages.length ? h("div", { className: "snap-set-actions" }, h("button", { className: "snap-primary", textContent: `Re-run dependents (${stages.map((s) => `${s.takes.length} ${s.takes.length === 1 ? s.stage.replace(/s$/, "") : s.stage}`).join(", ")}${plan.eta_s != null ? ` · about ${Math.max(1, Math.round(plan.eta_s / 60))} min` : ""})`,
        title: plan.stages.map((s) => `${s.stage}: ${s.takes.length} · ${s.runs}${s.eta_s != null ? ` · about ${s.eta_s} s` : ` · ${s.from}`}`).join("\n"),
        onclick: async () => { try { say?.((await DP.start(W.refOf("location", id), { by: "person" })).said); draw(); } catch (err) { say?.(err.message, true); } } })) : null].filter(Boolean));
  };
  // the masks live on the sheet's pictures, drawn after the block (the sheet is there once the block is in it)
  const paint = () => { const sheet = sheetOf(); if (sheet) paintMasks(sheet, locationNotes(ref), { on: masksOn(sheet), lit }); };
  const redraw = () => { if (!box.isConnected) return; const sheet = sheetOf(); if (sheet && !sheet.dataset.masksHooked) { sheet.dataset.masksHooked = "1"; sheet.addEventListener("snap-masks", redraw); } draw(); paint(); };
  CR.onChange(redraw);
  DP.onChange(redraw);
  CR.load().then(redraw, () => draw());
  draw();
  queueMicrotask(redraw);
  return box;
}
