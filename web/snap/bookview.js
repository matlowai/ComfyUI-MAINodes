// The Book sheet (U97, CONCEPT_PRODUCTION §11): layer 3 of Snap, one sheet with the Book's lenses as rows of one model.
// Beat sheet: the spine (beats in telling order, groups as bands above, story order shown only where it differs), an
// entity lane per Cast with a mark at each beat that changes it, and the picked beat's text, changes, lines, plants and
// payoffs, saved on blur as a story version. Settei: the production style (paragraph first, palette, reference still),
// each Cast's base pictures, states and voice, each location's master and plan (drawn here, planview.js). Boards: one
// frame per cut in telling order with its timing and transition, approve, make a board, play the animatic. Cut bag:
// each cut's compiled state sheet with provenance and its render bar. The Cut: the active takes in telling order with
// trims and sound levels, export one mp4 and an OTIO. Agents' story proposals wait on top (the Book's docket), their beats
// as ghost cards on the spine, and the answered ones stay listed (SNAP-R139, F-F10/F-F19).
// SNAP-R67 the Book and the story clock · SNAP-R68 compile with provenance · SNAP-R69 settei per state · SNAP-R175 the colour script · SNAP-R176 settei design it · SNAP-R130 the
// production style · SNAP-R131 boards and the animatic · SNAP-R132 the Cut · SNAP-R133 the plan drawn here · SNAP-R80
// every picture full size · SNAP-R58 nothing trimmed · SNAP-R8 judged from screenshots · SNAP-R165 Cast lines folded · SNAP-R209 an out-of-date story proposal offers a re-make ·
// SNAP-R168 a cut opens before its beat · SNAP-R183 a record this install lacks is named, with how to bring it · SNAP-R223 the Book names its production · SNAP-R225 the Cut lens says where the Cut went in Astrid · see docs/snap/SNAP_RULES.md
import * as B from "./book.js";
import * as W from "./world.js";
import * as SC from "./scenes.js";
import * as T from "./takes.js";
import * as K from "./checks.js";
import * as P from "./proposals.js";
import * as L from "./library.js";
import { full } from "./lightbox.js";
import { view as inputUrl } from "./castview.js";
import { openPlanEditor } from "./planview.js";

// F-Q15: a Cast or place the Book names that this install doesn't have, by the name a take pinned it with
const absent = (ref) => { const k = W.parse(ref), name = T.all().map((t) => t.world?.[W.refOf(k.kind, k.id)]?.name).find(Boolean); return `${name ?? (k.kind === "cast" ? "A Cast" : "A place")} isn't on this install (${ref}): import it (import_records), or export it with the Book where it lives`; };
const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; };
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false)); // never "null" (LESSONS)
const hostOf = (el) => el?.closest(".snap-root") ?? document.querySelector(".snap-root");
const LENSES = [["beat_sheet", "Beat sheet"], ["pages", "Pages"], ["settei", "Settei"], ["boards", "Boards"], ["cut_bag", "Cut bag"], ["the_cut", "the Cut"]];
const BOOK_TOOLS = new Set(["set_board", "make_board"]); // the Book's GPU and pick proposals (graph-bound); canon ones carry `book`
const pic = (file, name, source, group, cls = "") => full(h("img", { className: cls, src: inputUrl(file), alt: name, loading: "lazy", onerror: (e) => e.target.replaceWith(h("div", { className: "snap-cast-missing", textContent: `✕ ${file} isn't in input/` })) }), { src: inputUrl(file), name, source: `input/${file}${source ? ` · ${source}` : ""}` }, group);
// a state value as a person reads it: a Cast by name, a prop by its name, an empty value as "none"
const shown = (v) => (v == null || v === "" ? "none" : Array.isArray(v) ? v.map(shown).join(", ") : typeof v === "string" ? (v.startsWith("cast:") ? W.get(v)?.version.body.name ?? v : v.replace(/^prop:/, "").replaceAll("-", " ")) : JSON.stringify(v));
const takeUrl = (t) => { const m = t?.media.find((x) => x.kind === "video") ?? t?.media[0]; return m ? K.url(m) : null; };

let sheetOpen = null, listening = false;
// one set of listeners for whichever Book sheet is open: records, scenes and takes redraw it, proposals its docket
function listen() {
  if (listening) return;
  listening = true;
  const live = () => sheetOpen?.sheet.isConnected;
  W.onChange(() => { if (live()) sheetOpen.redraw(); });
  B.onAstrid(() => { if (live() && sheetOpen.lens() === "the_cut") sheetOpen.redraw(); });
  SC.onChange(() => { if (live() && sheetOpen.lens() !== "cut_bag") sheetOpen.redraw(); });
  P.onChange(() => { if (!live()) return; sheetOpen.docket(); if (sheetOpen.lens() === "beat_sheet") sheetOpen.redraw(); });
}
export async function openBook(host, { book: ref = null, lens = "beat_sheet", say } = {}) {
  host.querySelector(".snap-book-sheet")?.remove();
  await Promise.all([W.load(), SC.load(), T.load(), L.ready(), P.load().catch(() => {})]);
  let bookRef = ref ?? B.books()[0]?.ref ?? null, tab = LENSES.some(([k]) => k === lens) ? lens : "beat_sheet", picked = null, dialOpen = false;
  const status = h("div", { className: "snap-quiet snap-book-status", role: "status" }), body = h("div", { className: "snap-book-body" }), top = h("div", { className: "snap-book-top" }), docket = h("div", { className: "snap-book-docket" });
  const tabs = h("div", { className: "snap-seg snap-book-tabs", role: "tablist" });
  const act = (fn) => async (e) => { try { const said = await fn(e); if (said) { status.textContent = said; say?.(said); } } catch (err) { status.textContent = err.message; say?.(err.message, true); } draw(); };
  const close = () => { sheet.remove(); sheetOpen = null; host.focus?.({ preventScroll: true }); };
  const callTool = async (name, args) => (await import("./tools.js")).callTool(name, args, { confirmed: true });

  function drawTop() {
    const all = B.books();
    if (!bookRef) return fill(top, h("div", { className: "snap-book-empty" }, h("strong", { textContent: "No Book yet" }), h("span", { className: "snap-quiet", textContent: " · a Book holds a production: its story as beats, its style, its Cast and places, its cuts" }),
      h("button", { className: "snap-primary", textContent: "+ New Book", onclick: act(async () => { const st = await B.saveStory(null, { title: "Untitled" }); const out = await B.saveBook(null, { name: "Untitled Book", story: `story:${st.id}` }, { note: "made in the Book sheet" }); bookRef = `book:${out.id}`; return "A new Book"; }) })));
    const b = B.bookOf(bookRef), st = b.body.story ? B.storyOf(b.body) : null, style = B.styleOf(b.body), a = b.body.autonomy;
    const pickBook = h("select", { ariaLabel: "Book", onchange: (e) => { bookRef = e.target.value; picked = null; draw(); } }, ...all.map((x) => h("option", { value: x.ref, textContent: x.body.name, selected: x.ref === `book:${b.id}` })));
    const pr = B.productions().find((p) => p.body.books.includes(`book:${b.id}`)), nth = pr ? pr.body.books.indexOf(`book:${b.id}`) + 1 : 1;
    fill(top, pickBook, h("span", { className: "snap-al-chip", title: "the production this Book is in (SNAP-R223): its Books share Cast, places and style, and in Astrid it is one project with a timeline per Book", textContent: `production: ${pr ? pr.body.name : `${b.body.name} (its own)`}${pr?.body.books.length > 1 ? ` · Book ${nth} of ${pr.body.books.length}` : ""}` }),
      h("span", { className: "snap-al-chip", textContent: b.body.medium }), st ? h("span", { className: "snap-quiet", textContent: `story v${st.n} · ${st.body.beats.length} beats · ${B.units(b).length} cuts` }) : null,
      style ? h("span", { className: "snap-al-chip choice", title: style.body.paragraph, textContent: `style: ${style.body.name} · ${style.body.palette}` }) : h("span", { className: "snap-al-chip", textContent: "no production style yet" }),
      h("span", { className: "snap-spacer" }),
      h("button", { className: `snap-link snap-quiet-btn${dialOpen ? " on" : ""}`, textContent: `Dial: ${a.default}${Object.keys(a.stages).length ? ` · ${Object.entries(a.stages).filter(([, v]) => v !== a.default).length} stage${Object.entries(a.stages).filter(([, v]) => v !== a.default).length === 1 ? "" : "s"} differ` : ""}`, title: "who may act without asking, per stage: assist (agents wait), collaborate (as Let agents run), automatic (that stage goes ahead); story and style stay proposals", onclick: () => { dialOpen = !dialOpen; draw(); } }),
      dialOpen ? h("div", { className: "snap-book-dial" }, ...[["default", "Default"], ...Object.entries(B.STAGES)].map(([k, label]) => h("label", { className: "snap-field" }, h("span", { textContent: label }),
        h("select", { ariaLabel: `dial ${label}`, onchange: act(async (e) => { const next = { default: a.default, stages: { ...a.stages } }; if (k === "default") next.default = e.target.value; else next.stages[k] = e.target.value; await B.saveBook(b.id, { ...b.body, autonomy: next }, { note: `dial: ${label} ${e.target.value}` }); return `Dial: ${label} → ${e.target.value}`; }) },
          ...B.DIAL.map((d) => h("option", { value: d, textContent: d, selected: (k === "default" ? a.default : a.stages[k] ?? a.default) === d }))))),
        h("div", { className: "snap-quiet", textContent: "Story and style edits from agents wait for you at every position." })) : null);
  }
  // the Book's docket: agents' proposals about it, waiting for the person, with what each would re-open
  const ofBook = (b) => (p) => p.book === `book:${b.id}` || (BOOK_TOOLS.has(p.tool) && W.parse(String(p.args.book ?? "book:x")).id === b.id);
  const accept = (p) => act(async () => { const out = await P.decide(p.id, true, callTool); return out?.status === "accepted" ? `Accepted ${p.id}: ${p.reason}` : out ? `Couldn't apply ${p.id}: ${out.result}` : `${p.id} was answered on another page`; });
  const reject = (p) => act(async () => { const out = await P.decide(p.id, false, callTool); return out ? `Rejected ${p.id}` : `${p.id} was answered on another page`; });
  function drawDocket() {
    const b = bookRef && B.bookOf(bookRef), mine = b ? P.pending().filter(ofBook(b)) : [], answered = b ? P.all().filter((p) => p.status !== "waiting" && p.status !== "running" && ofBook(b)(p)) : [];
    fill(docket, mine.length ? [h("div", { className: "snap-rail-title", textContent: `Waiting for you (${mine.length})` }), ...mine.map((p) => h("div", { className: "snap-book-prop" },
      h("span", { className: "snap-agent", textContent: "agent" }), h("strong", { textContent: p.id }), h("span", { className: "snap-book-prop-what", textContent: P.reasonNow(p) || p.tool.replaceAll("_", " ") }),
      (() => { const open = (p.needs ?? []).filter((n) => P.get(n)?.status === "waiting"); return open.length ? h("span", { className: "snap-al-chip", title: "accepting this accepts these first", textContent: `needs ${open.join(", ")}` }) : null; })(),
      (() => { const st = P.staleOf(p); return st ? [h("span", { className: "snap-al-chip", textContent: `out of date: ${st.said}` }), h("button", { className: "snap-accept", textContent: `Re-make against v${st.to}`, onclick: act(async () => { const out = await P.remake(p.id); return `Re-made ${p.id} as ${out.remade} against v${out.against}`; }) })]
        : h("button", { className: "snap-accept", textContent: "Accept", onclick: accept(p) }); })(), h("button", { className: "snap-reject", textContent: "Reject", onclick: reject(p) })))] : [],
      answered.length ? h("details", { className: "snap-book-answered" }, h("summary", { className: "snap-quiet", textContent: `Answered (${answered.length})` }),
        answered.map((p) => h("div", { className: "snap-quiet", textContent: `${p.id} ${p.status}: ${P.reasonNow(p) || p.tool.replaceAll("_", " ")}${p.status !== "accepted" && typeof p.result === "string" ? ` · ${p.result}` : ""}` }))) : null);
  }
  function drawTabs() { fill(tabs, ...LENSES.map(([k, label]) => h("button", { className: tab === k ? "on" : "", textContent: label, role: "tab", ariaSelected: String(tab === k), onclick: () => { tab = k; draw(); } }))); }

  // ---- Beat sheet -----------------------------------------------------------------------------------------------
  // the colour script (SNAP-R175): one chosen frame per scene group, a strip over the spine. A group with none shows what
  // its cuts offer (an approved board, else an active take) to choose from; choosing is a story version (an agent's
  // set_colour_frame waits as a proposal)
  function colourScript(b, story, byTold, cols) {
    const st = B.storyOf(b.body), units = B.units(b);
    if (!story.groups.length) return h("div", { className: "snap-book-colours empty", style: cols }, h("div", { className: "snap-quiet snap-book-lane-name", textContent: "colour script" }),
      h("div", { className: "snap-quiet", style: "grid-column: 2 / -1", textContent: "One frame per scene group: group the beats into scenes first (add_group, or + Scene group on a picked beat)." }));
    const offers = (g) => units.filter((u) => (u.unit.beats ?? []).some((id) => g.beats.includes(id))).flatMap((u) => { const t = u.shot.active ? T.get(u.shot.active) : null;
      return [u.unit.board?.file ? { file: u.unit.board.file, from: `${u.unit.cut}'s board` } : null, t?.media?.length ? { take: t.id, from: `${u.unit.cut}'s take ${t.number}` } : null].filter(Boolean); });
    const frame = (f, name) => (f.file ? pic(f.file, name, f.from ?? "", "book-colours", "snap-book-colour") : f.take && T.get(f.take) ? h("img", { className: "snap-book-colour", src: takeUrl(T.get(f.take)), alt: name }) : h("div", { className: "snap-cast-missing snap-book-colour", textContent: "✕ its picture is gone" }));
    const choose = (g, f) => act(async () => { const next = structuredClone(story); next.groups.find((x) => x.id === g.id).colour = { ...(f.file ? { file: f.file } : { take: f.take }), from: f.from }; const out = await B.saveStory(st.id, next, { note: `colour script: ${g.name || g.id} ← ${f.from}` }); return out.made ? `Story v${out.n}: ${g.name || g.id}'s colour frame is ${f.from}` : null; });
    return h("div", { className: "snap-book-colours", style: cols }, h("div", { className: "snap-quiet snap-book-lane-name", textContent: "colour script" }),
      ...story.groups.map((g) => { const idx = g.beats.map((id) => byTold.findIndex((x) => x.id === id)).filter((i) => i >= 0); if (!idx.length) return null;
        const offer = offers(g), place = `grid-column: ${Math.min(...idx) + 2} / ${Math.max(...idx) + 3}`;
        return h("div", { className: `snap-book-colour-cell${g.colour ? " chosen" : ""}`, style: place },
          g.colour ? [frame(g.colour, `${g.name || g.id}, colour frame`), h("span", { className: "snap-quiet", textContent: `${g.name || g.id} · ${g.colour.from ?? "chosen"}` })]
            : offer.length ? [frame(offer[0], `${g.name || g.id}, ${offer[0].from}`), h("span", { className: "snap-quiet", textContent: `${g.name || g.id} · not chosen: ${offer[0].from}?` }),
              h("div", { className: "snap-set-actions" }, offer.map((f) => h("button", { className: "snap-link snap-quiet-btn", textContent: `Use ${f.from}`, onclick: choose(g, f) })))]
            : h("span", { className: "snap-quiet", textContent: `${g.name || g.id}: no board or take to choose from yet` })); }));
  }
  function beatSheet(b) {
    const st = B.storyOf(b.body), story = st.body, castRefs = b.body.cast ?? [], byTold = [...story.beats].sort((x, y) => x.told - y.told);
    const save = (next, note) => act(async () => { const out = await B.saveStory(st.id, next, { note }); return out.made ? `Story v${out.n}: ${note}` : null; });
    // F-F10, F-L15: the beats agents proposed are ghost columns after the spine, and every waiting change shows in its lane
    // as a ghost under its beat (accepted or ghost), with its proposal
    const bookRef = `book:${b.id}`, ghosts = P.pending().filter((p) => p.book === bookRef && p.tool === "add_beat");
    const columns = [...byTold, ...ghosts.map((p) => ({ id: p.makes?.[0] ?? p.args.id ?? "new", text: p.args.text ?? "", lines: p.args.lines ?? [], plants: p.args.plants ?? [], pays_off: p.args.pays_off ?? [], changes: [], ghost: p }))];
    const waitingChanges = [...P.pending().filter((p) => p.book === bookRef && p.tool === "add_change").map((p) => ({ ...p.args, op: p.args.op ?? "set", proposal: p.id })),
      ...ghosts.flatMap((p) => (p.args.changes ?? []).map((c) => ({ ...c, op: c.op ?? "set", beat: p.makes?.[0], proposal: p.id })))];
    const cols = `grid-template-columns: 120px repeat(${Math.max(1, columns.length)}, minmax(150px, 1fr))`; // the lanes' name column, then one column per beat
    const groupBands = h("div", { className: "snap-book-bands", style: cols }, ...story.groups.map((g) => { const idx = g.beats.map((id) => byTold.findIndex((x) => x.id === id)).filter((i) => i >= 0); if (!idx.length) return null;
      return h("div", { className: `snap-book-band kind-${g.kind}`, style: `grid-column: ${Math.min(...idx) + 2} / ${Math.max(...idx) + 3}`, title: g.place ?? "", textContent: `${g.kind}: ${g.name || g.id}` }); }));
    const moved = B.outOfOrder(story);
    // F-L08: a payoff by the words of what it pays off, and the beat's lines on its card
    const plantWords = new Map(columns.flatMap((x) => x.plants.map((p) => [p.id, p.what]))), said = (id) => (plantWords.has(id) ? `"${plantWords.get(id)}"` : id);
    const cards = h("div", { className: "snap-book-spine", style: cols }, h("div", { className: "snap-quiet snap-book-lane-name", textContent: "beats" }), ...columns.map((x) => h(x.ghost ? "div" : "button", { className: `snap-book-beat${x.ghost ? " snap-book-ghost" : ""}${picked === x.id ? " on" : ""}`, ...(x.ghost ? {} : { onclick: () => { picked = x.id; draw(); } }) },
      h("div", { className: "snap-book-beat-id" }, h("strong", { textContent: x.id }), x.ghost ? h("span", { className: "snap-al-chip", textContent: `${x.ghost.id}${x.ghost.args.after ? ` · after ${x.ghost.args.after}` : ""}` }) : null, moved.has(x.id) ? h("span", { className: "snap-al-chip", title: "told out of story order (a flashback or a cold open): compile folds by story order", textContent: `happens #${x.order}` }) : null, x.intensity ? h("span", { className: "snap-al-chip", textContent: x.intensity }) : null),
      h("div", { className: "snap-book-beat-text", textContent: x.text || "(no text yet)" }),
      (x.lines ?? []).map((l) => h("div", { className: "snap-book-beat-line", textContent: `${shown(l.who)}: “${l.text}”` })),
      h("div", { className: "snap-book-beat-marks" }, x.changes.length ? h("span", { className: "snap-al-chip choice", textContent: `${x.changes.length} change${x.changes.length === 1 ? "" : "s"}` }) : null,
        x.plants.length ? h("span", { className: "snap-al-chip", textContent: `plants ${x.plants.map((p) => `"${p.what}"`).join(", ")}` }) : null, x.pays_off.length ? h("span", { className: "snap-al-chip", textContent: `pays off ${x.pays_off.map(said).join(", ")}` }) : null),
      x.ghost ? h("div", { className: "snap-book-beat-marks" }, h("button", { className: "snap-accept", textContent: "Accept", onclick: accept(x.ghost) }), h("button", { className: "snap-reject", textContent: "Reject", onclick: reject(x.ghost) })) : null)));
    // plants past their window with no payoff, payoffs with no plant, and props whose holder and carriers disagree (F-L11): flags on the spine, never blocking
    const plants = story.beats.flatMap((x) => x.plants.map((p) => ({ ...p, at: x }))), paid = new Set(story.beats.flatMap((x) => x.pays_off));
    const flags = [...plants.filter((p) => !paid.has(p.id) && p.window && story.beats.length - p.at.order >= p.window).map((p) => `"${p.what}" was planted at ${p.at.id} and nothing pays it off within ${p.window} beats`),
      ...story.beats.flatMap((x) => x.pays_off.filter((id) => !plants.some((p) => p.id === id)).map((id) => `${x.id} pays off ${id}, which nothing plants`)), ...B.propFlags(story)];
    // a lane per Cast and per prop the story names (F-L08); a change reads with its op's sign, a waiting one as a ghost
    const propRefs = [...new Set([...(story.props ?? []).map((p) => `prop:${p.id}`), ...B.entitiesOf(story).filter((e) => e.startsWith("prop:")), ...waitingChanges.map((c) => c.entity).filter((e) => e?.startsWith("prop:"))])];
    const val = (v) => (v == null || v === "" ? "none" : [v].flat().map((x) => (typeof x === "string" && /^(prop|cast|location):/.test(x) ? B.nameOf(story, x) : shown(x))).join(", "));
    const changeSpan = (c, ghost) => h("span", { className: ghost ? "snap-book-lane-ghost" : "", textContent: `${c.path} ${B.OP_SIGN[c.op] ?? c.op} ${val(c.value)}${ghost ? ` (${c.proposal})` : ""}`, title: `${c.why ?? ""}${ghost ? `${c.why ? "\n" : ""}waiting in ${c.proposal}: accept it on the Waiting rows` : ""}` });
    const lanes = h("div", { className: "snap-book-lanes" }, ...[...castRefs, ...propRefs].map((ref) => { const name = ref.startsWith("prop:") ? B.nameOf(story, ref) : W.get(ref)?.version.body.name ?? ref;
      return h("div", { className: `snap-book-lane${ref.startsWith("prop:") ? " prop" : ""}`, style: cols }, h("div", { className: "snap-book-lane-name", textContent: name }),
        ...columns.map((x) => { const cs = x.changes.filter((c) => c.entity === ref), ws = waitingChanges.filter((c) => c.entity === ref && c.beat === x.id);
          // the state this beat puts the character in, when it has settei: its picture in the lane (a gap shows as words)
          const st = cs.length && ref.startsWith("cast:") ? B.stateFor(W.get(ref)?.version.body, B.stateAt(story, ref, x.id)) : null, thumb = st && cs.some((c) => c.path in (st.covers ?? {})) ? st.pictures?.[0] : null;
          return h("div", { className: `snap-book-lane-cell${cs.length ? " mark" : ws.length ? " ghost" : ""}`, title: cs.map((c) => `${c.path} ${c.op} ${shown(c.value)}${c.why ? ` (${c.why})` : ""}`).join("\n") }, cs.map((c) => changeSpan(c, false)), ws.map((c) => changeSpan(c, true)), thumb ? pic(thumb.file, `${name}, ${st.name}`, `state ${st.name}`, `book-lane-${ref}`, "snap-book-lane-thumb") : null); })); }));
    const colours = colourScript(b, story, byTold, cols);
    const waiting = P.pending().filter(ofBook(b)).length;
    const sel = story.beats.find((x) => x.id === picked);
    const detail = sel ? beatDetail(b, st, sel, save) : h("div", { className: "snap-quiet", textContent: story.beats.length ? "Pick a beat to edit its text, changes, lines, plants and payoffs." : waiting ? `No beats yet: ${waiting} proposal${waiting === 1 ? "" : "s"} wait above, accept or reject them there.` : "No beats yet." });
    const add = h("button", { className: "snap-link snap-quiet-btn", textContent: "+ Beat", onclick: act(async () => { const out = B.withBeat(story, { text: "", after: picked ?? undefined }); const saved = await B.saveStory(st.id, out.story, { note: `beat ${out.beat} added` }); picked = out.beat; return `Story v${saved.n}: ${out.beat} added`; }) });
    const inGroup = new Set(story.groups.flatMap((g) => g.beats)), loose = byTold.filter((x) => !inGroup.has(x.id)).map((x) => x.id);
    const addGroup = h("button", { className: "snap-link snap-quiet-btn", textContent: "+ Scene group", title: picked ? `a scene group of ${picked}` : "a scene group of the beats in no group yet", disabled: !(picked ? !inGroup.has(picked) : loose.length),
      onclick: act(async () => { const next = structuredClone(story), id = `g${Math.max(0, ...story.groups.map((g) => +String(g.id).replace(/^g/, "") || 0)) + 1}`; next.groups.push({ id, kind: "scene", name: `Scene ${next.groups.length + 1}`, beats: picked ? [picked] : loose }); const out = await B.saveStory(st.id, next, { note: `scene group ${id}` }); return `Story v${out.n}: scene group ${id}`; }) });
    return [h("div", { className: "snap-book-row" }, h("div", { className: "snap-rail-title", textContent: "Spine (telling order)" }), h("span", { className: "snap-spacer" }), addGroup, add),
      h("div", { className: "snap-book-scroll" }, groupBands.childElementCount ? groupBands : null, colours, cards, lanes), flags.length ? h("div", { className: "snap-book-flags" }, flags.map((f) => h("div", { textContent: `⚑ ${f}` }))) : null, detail];
  }
  function beatDetail(b, st, x, save) {
    const story = st.body, edit = (k) => (e) => { const v = e.target.value; if ((x[k] ?? "") === v) return; save(B.withEdit(story, x.id, { [k]: v || null }), `${x.id} ${k}`)(); };
    const field = (k, label, rows) => h("label", { className: "snap-field" }, h("span", { textContent: label }), h(rows ? "textarea" : "input", { value: x[k] ?? "", rows, ariaLabel: `${x.id} ${label}`, onchange: edit(k) }));
    const entities = [...(b.body.cast ?? []), ...(story.props ?? []).map((p) => `prop:${p.id}`), ...B.entitiesOf(story)].filter((v, i, a) => a.indexOf(v) === i);
    const newChange = { entity: entities[0] ?? "", path: "", op: "set", value: "", why: "" };
    const row = (c) => h("tr", {}, h("td", { textContent: B.nameOf(story, c.entity) }), h("td", { textContent: c.path }), h("td", { textContent: c.op }), h("td", { textContent: shown(c.value) }), h("td", { className: "snap-quiet", textContent: c.why ?? "" }), h("td", { className: "snap-quiet", textContent: c.source ?? "" }),
      h("td", {}, h("button", { className: "snap-x", textContent: "×", title: `remove ${c.id}`, onclick: save(B.cleanStory({ ...story, beats: story.beats.map((y) => (y.id === x.id ? { ...y, changes: y.changes.filter((z) => z.id !== c.id) } : y)) }), `${x.id}: change ${c.id} removed`) })));
    const inputs = { entity: h("select", { ariaLabel: "entity" }, ...entities.map((e) => h("option", { value: e, textContent: B.nameOf(story, e) }))), path: h("input", { placeholder: "path (carried.right_hand, wardrobe, mood, position…)", ariaLabel: "path" }),
      op: h("select", { ariaLabel: "op" }, ...B.OPS.map((o) => h("option", { value: o, textContent: o }))), value: h("input", { placeholder: "value (prop:letter, cast:<id>, words; empty = none)", ariaLabel: "value" }), why: h("input", { placeholder: "why", ariaLabel: "why" }) };
    const addChange = h("button", { className: "snap-link", textContent: "+ Change", onclick: (e) => { const c = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value.trim()])); if (!c.entity || !c.path) { status.textContent = "A change needs an entity and a path"; return; } save(B.withChange(story, x.id, { ...newChange, ...c, value: c.value || null }).story, `${x.id}: ${c.entity}.${c.path}`)(e); } });
    return h("div", { className: "snap-book-detail" },
      h("div", { className: "snap-book-row" }, h("strong", { textContent: `${x.id} · story #${x.order} · told #${x.told}` }), h("span", { className: "snap-spacer" }),
        h("button", { className: "snap-link", textContent: "← earlier in the telling", disabled: x.told <= 1, onclick: save(B.withMove(story, x.id, { told: x.told - 1 }), `${x.id} told earlier`) }),
        h("button", { className: "snap-link", textContent: "later in the telling →", disabled: x.told >= story.beats.length, onclick: save(B.withMove(story, x.id, { told: x.told + 1 }), `${x.id} told later`) })),
      h("div", { className: "snap-book-grid2" }, field("text", "what happens", 3), h("div", {}, field("intent", "intent (the writers' room)"), field("intensity", "intensity (the director pass)"), field("time", "story time (a label)"))),
      h("div", { className: "snap-rail-title", textContent: `Changes on ${x.id}: the state from here on` }),
      h("table", { className: "snap-book-table" }, h("thead", {}, h("tr", {}, ...["entity", "path", "op", "value", "why", "source", ""].map((t) => h("th", { textContent: t })))), h("tbody", {}, ...x.changes.map(row))),
      h("div", { className: "snap-plan-row" }, inputs.entity, inputs.path, inputs.op, inputs.value, inputs.why, addChange),
      (x.lines ?? []).length ? [h("div", { className: "snap-rail-title", textContent: "Lines" }), ...(x.lines ?? []).map((l) => h("div", { className: "snap-quiet", textContent: `${W.get(l.who)?.version.body.name ?? l.who}: "${l.text}"` }))] : null);
  }

  // ---- Pages: the story as Fountain, edited as text and saved as a story version (beats keep their ids) ------------------
  function pages(b) {
    const st = B.storyOf(b.body), area = h("textarea", { className: "snap-book-pages", value: B.toFountain(st.body), rows: 28, spellcheck: true, ariaLabel: "the story as Fountain" });
    return [h("div", { className: "snap-book-row" }, h("div", { className: "snap-rail-title", textContent: `Pages (Fountain) · story v${st.n}` }), h("span", { className: "snap-spacer" }),
      h("span", { className: "snap-quiet", textContent: "scene headings are scenes, paragraphs are beats, a NAME over a line is dialogue, = is a beat's intent" }),
      h("button", { className: "snap-primary", textContent: "Save as a story version", onclick: act(async () => { const next = B.fromFountain(area.value, { story: st.body, cast: b.body.cast }), out = await B.saveStory(st.id, next, { note: "edited in Pages" }); return out.made ? `Story v${out.n}: ${next.beats.length} beats from the pages` : "Nothing changed"; }) })), area];
  }

  // ---- Settei ---------------------------------------------------------------------------------------------------
  // "design it" (SNAP-R176): a state's cell makes candidates from the Cast's own pictures, the style and the state's words
  // (design_state), and shows those that landed with Use this, which saves the state's picture as a new Cast version
  function designCell(b, ref, c, x) {
    const pin = (t) => t.story ?? t.graph?.extra?.snap?.story, made = T.all().filter((t) => t.status === "success" && t.media.length && pin(t)?.role === "settei" && pin(t).cast === ref && pin(t).state === x.name && !x.pictures.some((p) => p.from?.take === t.id));
    const views = ["front", "three-quarter", "side", "back"], had = new Set(x.pictures.map((p) => p.view)), view = views.find((v) => !had.has(v)) ?? "front";
    const use = (t) => act(async () => { const keep = x.pictures.filter((p) => p.view !== pin(t).view).map((p) => ({ file: p.file, ...(p.view ? { view: p.view } : {}) }));
      const out = await callTool("save_cast_state", { cast: ref, state: x.name, covers: x.covers ?? {}, ...(x.words && x.words !== true ? { words: x.words } : {}), pictures: [...keep, { take: t.id, view: pin(t).view }] });
      return `${c.name} v${out.version}: ${x.name} ${pin(t).view} from take ${t.number}`; });
    return h("div", { className: "snap-book-design" },
      h("button", { className: "snap-link snap-quiet-btn", textContent: x.pictures.length ? `Design the ${view} view` : "Design it", title: "candidates from the Cast's own pictures, the production style and this state's words (a New view; GPU)",
        onclick: act(async () => { const out = await callTool("design_state", { book: `book:${b.id}`, cast: ref, state: x.name, covers: x.covers ?? {}, view }); return out.proposed ? `Waiting for your yes: ${out.status}` : `${x.name}: ${out.candidates?.length ?? "the"} candidates on their way to ${out.landed?.where ?? "the settei scene"}`; }) }),
      made.length ? h("div", { className: "snap-book-design-cands" }, made.map((t) => h("figure", {}, h("img", { src: takeUrl(t), alt: `${c.name}, ${x.name}, take ${t.number}`, className: "snap-book-design-pic" }),
        h("button", { className: "snap-link snap-quiet-btn", textContent: `Use this (${pin(t).view})`, onclick: use(t) })))) : null);
  }
  function settei(b) {
    const style = B.styleOf(b.body), s = structuredClone(style?.body ?? { name: `${b.body.name} style`, paragraph: "", palette: "full", voice: "", sound: "", genre: "" });
    const area = (k, label, rows = 2) => h("label", { className: "snap-field" }, h("span", { textContent: label }), h("textarea", { rows, value: s[k] ?? "", ariaLabel: label, oninput: (e) => { s[k] = e.target.value; } }));
    const styleCard = h("section", { className: "snap-book-card snap-book-style" },
      h("div", { className: "snap-book-row" }, h("strong", { textContent: "Production style" }), style ? h("span", { className: "snap-quiet", textContent: ` v${style.n} · the paragraph goes first in every prompt` }) : h("span", { className: "snap-quiet", textContent: " · none yet" })),
      h("div", { className: "snap-book-grid2" },
        h("div", {}, h("label", { className: "snap-field" }, h("span", { textContent: "name" }), h("input", { value: s.name, ariaLabel: "style name", oninput: (e) => { s.name = e.target.value; } })), area("paragraph", "paragraph (medium, line, shading, texture, finish)", 4),
          h("label", { className: "snap-field" }, h("span", { textContent: "palette" }), h("select", { ariaLabel: "palette", onchange: (e) => { s.palette = e.target.value; } }, ...B.PALETTES.map((p) => h("option", { value: p, textContent: p, selected: s.palette === p })))),
          h("div", { className: "snap-quiet", textContent: "Monochrome or limited: Cast colour words are noted at compile (a colour word in a subject beats the style)." })),
        h("div", {}, s.still?.file ? pic(s.still.file, `${s.name}, reference still`, "the style's Picture 1 for video", "book-style", "snap-book-still") : h("div", { className: "snap-cast-missing", textContent: "no reference still yet: save_style {still: {take}} or a file" }),
          area("voice", "voice direction (the house acting style)"), area("sound", "sound palette"), area("genre", "genre playbook (staging, intensity)"))),
      h("div", { className: "snap-set-actions" }, h("button", { className: "snap-primary", textContent: style ? "Save the style" : "Make the style", onclick: act(async () => { const out = await B.saveLook(style?.id ?? null, s, { note: "edited in the Book" }); if (b.body.style !== `look:${out.id}`) await B.saveBook(b.id, { ...b.body, style: `look:${out.id}` }, { note: `style ${s.name}` }); return out.made ? `Style v${out.n} saved` : "Nothing changed"; }) })));
    const st = b.body.story ? B.storyOf(b.body).body : null;
    const casts = (b.body.cast ?? []).map((ref) => { const got = W.get(ref), c = got?.version.body; if (!c) return h("section", { className: "snap-book-card" }, h("div", { className: "snap-cast-missing", textContent: absent(ref) }));
      // the states this Book's story gives the character (wardrobe values set on beats), each with its pictures or "words only"
      const told = st ? [...new Set(st.beats.flatMap((x) => x.changes.filter((ch) => ch.entity === ref && ch.path === "wardrobe").map((ch) => ch.value)).filter(Boolean))] : [];
      const states = [...(c.states ?? []).map((x) => ({ name: x.name, pictures: x.pictures ?? [], covers: x.covers })), ...told.filter((v) => !(c.states ?? []).some((x) => x.covers?.wardrobe === v)).map((v) => ({ name: v, pictures: [], covers: { wardrobe: v }, words: true }))];
      return h("section", { className: "snap-book-card" }, h("div", { className: "snap-book-row" }, h("strong", { textContent: c.name }), h("span", { className: "snap-quiet", textContent: ` · Cast v${got.version.n}` })),
        h("div", { className: "snap-book-thumbs" }, ...(c.refs ?? []).map((r) => h("figure", {}, pic(r.file, `${c.name}, ${r.role}`, ref, `book-cast-${ref}`), h("figcaption", { textContent: `base · ${r.role}` })))),
        h("div", { className: "snap-rail-sub", textContent: "States" }),
        states.length ? h("div", { className: "snap-book-thumbs" }, ...states.map((x) => h("figure", { className: x.pictures.length ? "" : "words" }, x.pictures.length ? pic(x.pictures[0].file, `${c.name}, ${x.name}`, ref, `book-cast-${ref}`) : h("div", { className: "snap-cast-missing", textContent: "words only: no picture for this state yet" }),
          h("figcaption", { textContent: `${x.name}${x.pictures.length > 1 ? ` · ${x.pictures.length} views` : ""}` }), designCell(b, ref, c, x)))) : h("div", { className: "snap-quiet", textContent: "No states: the story changes nothing this character wears." }),
        h("div", { className: "snap-rail-sub", textContent: "Voice settei" }),
        c.voice?.file ? h("div", { className: "snap-quiet", textContent: `${c.voice.file}${c.voice.casting ? ` · cast as: ${c.voice.casting}` : ""} · cuts cite it as <Audio n>, no voice words` }) : h("div", { className: "snap-quiet", textContent: "no voice reference yet (skill snap-voice: a 3-6 s line at 12 steps)" })); });
    const places = (b.body.locations ?? []).map((ref) => { const got = W.get(ref), l = got?.version.body; if (!l) return h("section", { className: "snap-book-card" }, h("div", { className: "snap-cast-missing", textContent: absent(ref) }));
      return h("section", { className: "snap-book-card" }, h("div", { className: "snap-book-row" }, h("strong", { textContent: l.name }), h("span", { className: "snap-quiet", textContent: ` · location v${got.version.n} · ${l.plates?.length ?? 0} plates · ${l.cameras?.length ?? 0} camera marks` }), h("span", { className: "snap-spacer" }),
        h("button", { className: "snap-link", textContent: l.plan?.shapes ? "Edit the plan" : "Draw the plan", onclick: () => openPlanEditor(host, { id: W.parse(ref).id, say, onSaved: () => draw() }).catch((err) => say?.(err.message, true)) })),
        h("div", { className: "snap-book-thumbs" }, l.master ? h("figure", {}, pic(l.master.file, `${l.name}, master`, ref, `book-loc-${ref}`), h("figcaption", { textContent: "master" })) : h("figure", { className: "words" }, h("div", { className: "snap-cast-missing", textContent: "no master yet" })),
          l.plan ? h("figure", {}, pic(l.plan.file, `${l.name}, plan`, ref, `book-loc-${ref}`), h("figcaption", { textContent: l.plan.shapes ? `plan · drawn here (${l.plan.shapes.length} shapes)` : "plan" })) : h("figure", { className: "words" }, h("div", { className: "snap-cast-missing", textContent: "no plan yet" })),
          ...(l.plates ?? []).map((p) => h("figure", {}, pic(p.file, `${l.name}, plate ${p.name}`, ref, `book-loc-${ref}`), h("figcaption", { textContent: `plate ${p.name}` }))))); });
    return [styleCard, h("div", { className: "snap-rail-title", textContent: "Cast" }), casts.length ? casts : h("div", { className: "snap-quiet", textContent: "No Cast in this Book yet (set_book {cast})." }),
      h("div", { className: "snap-rail-title", textContent: "Places" }), places.length ? places : h("div", { className: "snap-quiet", textContent: "No locations in this Book yet (set_book {locations})." })];
  }

  // ---- Boards ---------------------------------------------------------------------------------------------------
  function boards(b) {
    const list = B.units(b), story = b.body.story ? B.storyOf(b.body).body : null, made = T.all().filter((t) => t.group === B.groupOf(b) && t.parent?.method === "book/animatic" && t.status === "success").sort((x, y) => y.created - x.created);
    const cards = list.map(({ scene, shot, unit }) => { const t = shot.active ? T.get(shot.active) : null, kept = t?.verdict === "keep" && t.media.some((m) => m.kind === "video"), beat = story?.beats.find((x) => x.id === unit.beats?.[0]);
      return h("section", { className: `snap-book-board${unit.board?.approved ? " approved" : ""}` },
        h("div", { className: "snap-book-row" }, h("strong", { textContent: unit.cut ?? shot.name }), h("span", { className: "snap-quiet", textContent: ` ${unit.timing?.seconds ?? 4} s` }), h("span", { className: "snap-spacer" }), kept ? h("span", { className: "snap-al-chip choice", textContent: "kept take" }) : null),
        unit.board?.file ? pic(unit.board.file, `${unit.cut} board`, unit.board.from ? `take ${unit.board.from.take}` : "", "book-boards", "snap-book-frame") : h("div", { className: "snap-cast-missing snap-book-frame", textContent: "no board yet" }),
        h("div", { className: "snap-book-beat-text", textContent: beat ? `${beat.id}: ${beat.text}` : "no beat" }),
        unit.transition ? h("div", { className: "snap-quiet", textContent: `→ ${unit.transition}` }) : null,
        h("div", { className: "snap-set-actions" },
          h("label", { className: "snap-al-switch", title: "only approved boards go to video by default; you can run anything" }, h("input", { type: "checkbox", checked: !!unit.board?.approved, disabled: !unit.board?.file, onchange: act(async (e) => { await B.setUnit(scene.id, shot.id, { board: { ...unit.board, approved: e.target.checked } }); return `${unit.cut} board ${e.target.checked ? "approved" : "not approved"}`; }) }), "approved"),
          h("button", { className: "snap-link", textContent: "Open the cut", onclick: act(async () => (await SC.openShot(scene.id, shot.id)).said) }))); });
    return [h("div", { className: "snap-book-row" }, h("div", { className: "snap-rail-title", textContent: `Boards (${list.length} cuts, telling order)` }), h("span", { className: "snap-spacer" }),
      h("button", { className: "snap-primary", textContent: "Play the animatic", title: "the boards timed in order, kept takes in place of their boards: one video (ffmpeg, no GPU)", disabled: !list.length, onclick: act(async () => { const out = await B.assemble(`book:${b.id}`, { mode: "animatic" }); return `Animatic queued: ${out.clips.length} cuts${out.gaps.length ? ` (missing: ${out.gaps.join("; ")})` : ""}`; }) })),
      h("div", { className: "snap-book-boards" }, cards.length ? cards : h("div", { className: "snap-quiet", textContent: "No cuts yet (add_cut plans one)." })),
      made[0] ? h("div", { className: "snap-book-export" }, h("div", { className: "snap-rail-sub", textContent: `Animatic · take ${made[0].number} · ${new Date(made[0].created).toLocaleTimeString()}` }), h("video", { src: takeUrl(made[0]), controls: true, preload: "metadata", className: "snap-book-video" })) : null];
  }

  // ---- Cut bag: each cut's compiled state sheet ---------------------------------------------------------------------
  function cutBag(b, sheets, stale) {
    return B.units(b).map(({ scene, shot, unit }) => {
      const s = sheets.get(shot.id), st = stale.filter((x) => x.shot === shot.id), t = shot.active ? T.get(shot.active) : null;
      const bar = !t ? "none" : st.some((x) => x.take === t.id) ? "stale" : t.verdict === "keep" ? "kept" : "take";
      return h("section", { className: `snap-book-card snap-book-unit bar-${bar}` },
        h("div", { className: "snap-book-row" }, h("strong", { textContent: `${unit.cut ?? shot.name}` }), h("span", { className: "snap-quiet", textContent: ` · ${scene.name} · ${s?.at ? `at ${s.at.beat}: ${s.at.text}` : "no beat"}` }), h("span", { className: "snap-spacer" }),
          h("span", { className: `snap-book-bar bar-${bar}`, textContent: { none: "no take yet", stale: "stale", kept: "kept take matches", take: "a take, not judged" }[bar] }),
          h("button", { className: "snap-link", textContent: "Put it in the recipe", title: "opens the cut and applies this sheet: prompt, Cast, state pictures, place, board", onclick: act(async () => (await B.apply(scene.id, shot.id, { by: "person" })).said.join("; ")) })),
        s ? [h("table", { className: "snap-book-table" }, h("thead", {}, h("tr", {}, ...["who", "field", "value", "set at", "backing", "provenance"].map((x) => h("th", { textContent: x })))),
          h("tbody", {}, ...s.entities.flatMap((e) => (e.fields.length ? e.fields : [{ path: "", value: e.ref.startsWith("cast:") ? "no change yet at this beat: its base, as the Cast sheet has it" : "no change yet at this beat", backing: "" }]).map((f) => h("tr", {}, h("td", { textContent: e.name }), h("td", { textContent: f.path }), h("td", { textContent: shown(f.value) }), h("td", { textContent: f.beat ?? "" }), h("td", { className: f.backing === "words only" ? "snap-book-words" : "", textContent: f.backing ?? "" }), h("td", { className: "snap-quiet", textContent: f.provenance ?? "" })))))),
          s.place ? h("div", { className: "snap-quiet", textContent: `Place: ${s.place.name} (${s.place.ref})${s.place.plate ? ` · plate ${s.place.plate} as the camera` : ""}` }) : null,
          h("div", { className: "snap-book-thumbs small" }, ...s.package.map((p) => h("figure", {}, pic(p.file, p.role, p.why, `book-pkg-${shot.id}`), h("figcaption", { textContent: p.role })))),
          h("div", { className: "snap-quiet", textContent: `References: ${s.budget.used} of ${s.budget.of}${s.budget.over ? ` · over the budget: ${s.budget.over.join(", ")}` : ""}` }),
          h("ol", { className: "snap-book-sentences" }, ...(s.style ? [h("li", {}, h("span", { textContent: "[style paragraph] " }), h("span", { className: "snap-quiet", textContent: s.style.ref }))] : []), ...s.prompt.sentences.map((x) => h("li", {}, h("span", { textContent: x.text }), h("span", { className: "snap-quiet", textContent: ` ← ${x.from}` })))),
          // F-L02, F-L09 (SNAP-R165, R168): what the state left out of each Cast line, and the state the cut opens on
          ...s.entities.filter((e) => e.cast_line?.left_out?.length).map((e) => h("div", { className: "snap-quiet snap-book-leftout" }, ...e.cast_line.left_out.map((x) => h("div", { textContent: `${e.name}: ${x.said}` })))),
          s.opens ? h("div", { className: "snap-quiet", textContent: `Opens: ${s.opens.said}` }) : null,
          s.lint.length ? h("div", { className: "snap-book-flags" }, s.lint.map((x) => h("div", { textContent: `⚑ ${x}` }))) : null,
          st.length ? h("div", { className: "snap-book-flags" }, st.map((x) => h("div", { textContent: `take ${x.number}: ${x.reasons.join("; ")}` }))) : null] : h("div", { className: "snap-quiet", textContent: "compiling…" }));
    });
  }

  // ---- the Cut ----------------------------------------------------------------------------------------------------
  // SNAP-R225: the Cut lens says where the Cut went in Astrid: the project and timeline, its head, what changed here since
  // the push, and one button whose label follows the state (Open when in sync)
  const headOf = (rev) => (rev ? `${String(rev).replace(/^authoring-parent-revision-/, "").slice(0, 7)}…` : "?");
  function astridCard(b, ax, diff) {
    if (ax.error) return h("div", { className: "snap-book-card snap-book-astrid" }, h("strong", { textContent: "Astrid" }), h("span", { className: "snap-quiet", textContent: ax.error }));
    const e = ax.entry, setup = ax.setup ?? {}, ready = !!setup.launcher, synced = e && !diff.changed.length && !diff.shape;
    const app = setup.app && e && ax.project?.project_id ? `${setup.app}/tools/video-editor?project=${encodeURIComponent(ax.project.project_id)}&timeline=${encodeURIComponent(e.timeline.timeline_id)}` : null;
    const where = e ? `In Astrid: ${ax.project?.name ?? ax.production.body.name} › ${e.timeline?.name ?? b.body.name} · head ${headOf(e.head)} · ${diff.said}` : ready ? `Not in Astrid yet: a push makes the project “${ax.production.body.astrid.project}” and this Book's timeline in it` : setup.said ?? "Astrid isn't set up on this machine";
    return h("div", { className: "snap-book-card snap-book-astrid" },
      h("div", { className: "snap-book-row" }, h("strong", { textContent: "Astrid" }), h("span", { className: `snap-quiet snap-book-astrid-said${synced ? " ok" : ""}`, role: "status", textContent: where }), h("span", { className: "snap-spacer" }),
        synced && app ? h("a", { className: "snap-primary snap-book-astrid-go", href: app, target: "_blank", rel: "noopener", textContent: "Open in Astrid" }) : null),
      e?.left_out?.length ? h("div", { className: "snap-quiet", textContent: `Gaps in Astrid: ${e.left_out.map((x) => `${x.cut} (${x.why ?? "left out"})`).join("; ")}` }) : null);
  }
  function theCut(b, ax) {
    const diff = ax && !ax.error ? B.astridDiff(b, ax.entry) : null;
    const list = B.units(b), exports = T.all().filter((t) => t.group === B.groupOf(b) && t.parent?.method === "book/cut" && t.status === "success").sort((x, y) => y.created - x.created);
    const rows = list.map(({ scene, shot, unit }) => { const t = shot.active ? T.get(shot.active) : null, video = t?.media.find((m) => m.kind === "video"), trim = { in_s: 0, gain_db: 0, ...(unit.trim ?? {}) };
      const num = (k, label, step) => h("label", { className: "snap-field snap-book-num" }, h("span", { textContent: label }), h("input", { type: "number", step, value: trim[k] ?? "", placeholder: k === "out_s" ? "end" : "0", ariaLabel: `${unit.cut} ${label}`, onchange: act(async (e) => { const v = e.target.value === "" ? null : +e.target.value; await B.setUnit(scene.id, shot.id, { trim: { ...trim, [k]: v } }); return `${unit.cut}: ${label} ${v ?? "end"}`; }) }));
      return h("div", { className: "snap-book-cutrow" }, h("strong", { textContent: unit.cut ?? shot.name }),
        video ? h("video", { src: K.url(video), preload: "metadata", muted: true, className: "snap-book-cutthumb" }) : h("div", { className: "snap-cast-missing snap-book-cutthumb", textContent: t ? "the active take is a still" : "no active take" }),
        h("span", { className: "snap-quiet", textContent: t ? `take ${t.number}${t.verdict ? ` · ${t.verdict}` : ""}${t.sound ? ` · ${Math.round(t.sound.mean_db)} dB` : ""}` : "" }),
        num("in_s", "in (s)", 0.05), num("out_s", "out (s)", 0.05), num("gain_db", "sound (dB)", 0.5),
        diff ? h("span", { className: `snap-quiet snap-book-astrid-cut${diff.cuts[unit.cut ?? shot.name]?.state === "in sync" ? " ok" : diff.cuts[unit.cut ?? shot.name]?.state === "changed here since the push" ? " moved" : ""}`, textContent: `Astrid: ${diff.cuts[unit.cut ?? shot.name]?.clip ?? unit.cut ?? shot.name} · ${diff.cuts[unit.cut ?? shot.name]?.state ?? "not in Astrid"}` }) : null); });
    return [h("div", { className: "snap-book-row" }, h("div", { className: "snap-rail-title", textContent: "The Cut (telling order)" }), h("span", { className: "snap-spacer" }),
      h("button", { className: "snap-primary", textContent: "Export mp4 + OTIO", disabled: !list.length, onclick: act(async () => { const out = await B.assemble(`book:${b.id}`, { mode: "cut" }), o = await B.otio(`book:${b.id}`).catch((e) => ({ error: e.message })); return `The Cut queued (${out.clips.length} cuts${out.gaps.length ? `; missing: ${out.gaps.join("; ")}` : ""})${o.file ? ` · OTIO ${o.file}` : o.error ? ` · OTIO: ${o.error}` : ""}`; }) })),
      ax ? astridCard(b, ax, diff) : null,
      h("div", { className: "snap-book-cut" }, rows.length ? rows : h("div", { className: "snap-quiet", textContent: "No cuts yet." })),
      exports.length ? h("div", { className: "snap-book-export" }, h("div", { className: "snap-rail-sub", textContent: `Latest export · take ${exports[0].number} · ${new Date(exports[0].created).toLocaleTimeString()}` }), h("video", { src: takeUrl(exports[0]), controls: true, preload: "metadata", className: "snap-book-video" })) : null];
  }

  let drawing = 0, axNow = null;
  async function draw() {
    const me = ++drawing;
    drawTop(); drawTabs(); drawDocket();
    if (!bookRef) return fill(body);
    const b = B.bookOf(bookRef);
    if (tab === "beat_sheet") return fill(body, b.body.story ? beatSheet(b) : h("div", { className: "snap-quiet", textContent: "This Book has no story yet." }));
    if (tab === "settei") return fill(body, settei(b));
    if (tab === "pages") return fill(body, b.body.story ? pages(b) : h("div", { className: "snap-quiet", textContent: "This Book has no story yet." }));
    if (tab === "boards") return fill(body, boards(b));
    if (tab === "the_cut") { // drawn at once with the link as last read (no flicker), then again with the receipt as it is now
      fill(body, theCut(b, axNow?.book === b.id ? axNow.ax : undefined));
      const ax = await B.astridOf(b).catch((e) => ({ error: e.message }));
      axNow = { book: b.id, ax };
      if (me === drawing && tab === "the_cut") fill(body, theCut(b, ax));
      return;
    }
    const sheets = new Map();
    fill(body, cutBag(b, sheets, []));
    for (const u of B.units(b)) sheets.set(u.shot.id, await B.compile(u.scene.id, u.shot.id).catch((e) => ({ error: e.message, entities: [], package: [], prompt: { sentences: [] }, lint: [e.message], budget: { used: 0, of: 9 } })));
    const stale = await B.bookStale(`book:${b.id}`).catch(() => []);
    if (me === drawing && tab === "cut_bag") fill(body, cutBag(b, sheets, stale));
  }
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-book-sheet", role: "dialog", ariaLabel: "Book", tabIndex: -1 },
    h("header", {}, h("strong", { textContent: "Book" }), tabs, h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
    top, docket, body, status);
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape" && !e.target.closest?.(".snap-plan-sheet")) { e.stopPropagation(); close(); } });
  host.append(sheet);
  sheetOpen = { sheet, redraw: draw, docket: drawDocket, lens: () => tab, set: (o) => { if (o.book) bookRef = o.book; if (o.lens) tab = o.lens; return draw(); } };
  listen();
  await draw();
  sheet.focus({ preventScroll: true });
  return sheet;
}
export function railButton({ say }) {
  const b = h("button", { className: "snap-link snap-quiet-btn snap-new-cast snap-book-rail", textContent: "Book", title: "the production: story beats, style, settei, boards, the Cut (layer 3)" });
  b.addEventListener("click", () => openBook(hostOf(b), { say }).catch((err) => say?.(err.message, true)));
  const update = () => { const n = B.books().length; b.replaceChildren("Book", h("small", { textContent: n ? `${n} Book${n === 1 ? "" : "s"}` : "a production: beats, boards, the Cut" })); };
  W.onChange(update); update();
  return b;
}
export const BOOK_STYLE = `
.snap-sheet.snap-book-sheet { inset: 48px max(12px, calc(50% - 760px)) 16px; display: flex; flex-direction: column; box-shadow: 0 30px 80px #000c; }
.snap-book-sheet > header { flex-wrap: wrap; gap: 10px; }
.snap-book-tabs button { padding: 4px 12px; }
.snap-book-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 16px; border-bottom: 1px solid var(--s-line); }
.snap-book-top select { max-width: 260px; }
.snap-book-dial { flex-basis: 100%; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px 12px; padding: 8px 0 2px; }
.snap-book-docket:not(:empty) { padding: 8px 16px; border-bottom: 1px solid var(--s-line); background: color-mix(in srgb, #f0b445 8%, transparent); }
.snap-book-prop { display: flex; align-items: center; gap: 8px; padding: 3px 0; } .snap-book-prop-what { flex: 1; }
.snap-book-answered summary { cursor: pointer; padding-top: 4px; }
.snap-book-ghosts { display: grid; gap: 6px; grid-template-columns: 120px repeat(auto-fill, minmax(150px, 220px)); }
.snap-book-ghost { cursor: default; border-style: dashed; border-color: #a78bfa88; opacity: .92; }
.snap-book-body { flex: 1; overflow: auto; padding: 12px 16px 16px; display: flex; flex-direction: column; gap: 12px; }
.snap-book-status { padding: 6px 16px 10px; }
.snap-book-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.snap-book-scroll { overflow-x: auto; padding-bottom: 6px; display: flex; flex-direction: column; gap: 6px; }
.snap-book-bands, .snap-book-spine { display: grid; gap: 6px; grid-auto-flow: column; }
.snap-book-band { font-size: 11px; padding: 2px 8px; border-radius: 6px; background: color-mix(in srgb, var(--s-accent) 18%, transparent); color: var(--s-fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.snap-book-beat { all: unset; box-sizing: border-box; cursor: pointer; display: flex; flex-direction: column; gap: 4px; padding: 8px; border-radius: 8px; background: var(--s-card); border: 1px solid var(--s-line); min-height: 92px; }
.snap-book-beat.on { border-color: var(--s-accent); box-shadow: 0 0 0 1px var(--s-accent) inset; }
.snap-book-beat-id { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.snap-book-beat-text { font-size: 12px; line-height: 1.35; }
.snap-book-beat-marks { display: flex; gap: 4px; flex-wrap: wrap; margin-top: auto; }
.snap-book-lanes { display: flex; flex-direction: column; gap: 4px; }
.snap-book-lane { display: grid; gap: 6px; align-items: stretch; }
.snap-book-lane-name { font-size: 12px; font-weight: 600; align-self: center; }
.snap-book-lane-cell { min-height: 22px; border-top: 2px solid var(--s-line); font-size: 11px; color: var(--s-dim); display: flex; flex-direction: column; gap: 2px; padding-top: 3px; }
.snap-book-lane-cell.mark { border-top-color: #f08fb8; color: var(--s-fg); }
.snap-book-lane-cell.ghost { border-top: 2px dashed var(--s-line); }
.snap-book-lane-ghost { opacity: .75; font-style: italic; }
.snap-book-lane.prop .snap-book-lane-name { font-weight: 500; color: var(--s-dim); }
.snap-book-beat-line { font-size: 11px; color: var(--s-dim); font-style: italic; }
.snap-book-colours { display: grid; gap: 6px; align-items: start; margin-bottom: 6px; }
.snap-book-colour-cell { display: flex; flex-direction: column; gap: 3px; padding: 4px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--s-line); }
.snap-book-colour-cell.chosen { box-shadow: inset 0 0 0 1px #f0b445; }
.snap-book-design { display: flex; flex-direction: column; gap: 4px; }
.snap-book-design-cands { display: flex; gap: 6px; flex-wrap: wrap; }
.snap-book-design-cands figure { margin: 0; display: flex; flex-direction: column; gap: 2px; }
.snap-book-design-pic { width: 72px; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 4px; }
.snap-book-colour { width: 100%; max-height: 90px; object-fit: cover; border-radius: 6px; }
.snap-book-lane-thumb { width: 64px; aspect-ratio: 3 / 4; object-fit: cover; border-radius: 4px; cursor: zoom-in; }
.snap-book-flags { font-size: 12px; color: #f0b445; display: flex; flex-direction: column; gap: 2px; }
.snap-book-detail { display: flex; flex-direction: column; gap: 8px; padding: 10px; border-radius: 10px; border: 1px solid var(--s-line); }
.snap-book-grid2 { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 12px; }
.snap-book-table { width: 100%; border-collapse: collapse; font-size: 12px; } .snap-book-table th, .snap-book-table td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--s-line); vertical-align: top; overflow-wrap: anywhere; }
.snap-book-table th { color: var(--s-dim); font-weight: 600; }
.snap-book-words { color: #f0b445; }
.snap-book-card { padding: 10px 12px; border-radius: 10px; border: 1px solid var(--s-line); background: color-mix(in srgb, var(--s-card) 60%, transparent); display: flex; flex-direction: column; gap: 8px; }
.snap-book-thumbs { display: flex; gap: 8px; flex-wrap: wrap; } .snap-book-thumbs figure { margin: 0; width: 132px; display: flex; flex-direction: column; gap: 3px; }
.snap-book-thumbs.small figure { width: 96px; }
.snap-book-thumbs img { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; border-radius: 6px; background: #0003; cursor: zoom-in; }
.snap-book-thumbs figcaption { font-size: 11px; color: var(--s-dim); overflow-wrap: anywhere; }
.snap-book-thumbs figure.words .snap-cast-missing { aspect-ratio: 16 / 10; display: flex; align-items: center; justify-content: center; text-align: center; font-size: 11px; border: 1px dashed #f0b44599; border-radius: 6px; color: #f0b445; padding: 4px; }
.snap-book-still { width: 100%; max-width: 360px; border-radius: 8px; cursor: zoom-in; }
.snap-book-boards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.snap-book-board { padding: 8px; border-radius: 10px; border: 1px solid var(--s-line); display: flex; flex-direction: column; gap: 6px; }
.snap-book-board.approved { border-color: #57c785; }
.snap-book-frame { width: 100%; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 6px; background: #0003; cursor: zoom-in; display: flex; align-items: center; justify-content: center; }
.snap-book-video { width: 100%; max-width: 720px; border-radius: 8px; background: #000; }
.snap-book-export { display: flex; flex-direction: column; gap: 6px; }
.snap-book-unit { border-left: 4px solid var(--s-line); } .snap-book-unit.bar-kept { border-left-color: #57c785; } .snap-book-unit.bar-stale { border-left-color: #f0b445; } .snap-book-unit.bar-none { border-left-color: #e5534b; }
.snap-book-bar { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--s-card); } .snap-book-bar.bar-kept { color: #57c785; } .snap-book-bar.bar-stale { color: #f0b445; } .snap-book-bar.bar-none { color: #e5534b; }
.snap-book-sentences { margin: 0; padding-left: 20px; font-size: 12px; display: flex; flex-direction: column; gap: 2px; }
.snap-book-cut { display: flex; flex-direction: column; gap: 6px; }
.snap-book-pages { width: 100%; box-sizing: border-box; font: 13px/1.5 "Courier Prime", "Courier New", ui-monospace, monospace; padding: 14px 18px; border-radius: 8px; resize: vertical; min-height: 420px; }
.snap-book-cutrow { display: grid; grid-template-columns: 48px 160px minmax(120px, 1fr) repeat(3, 96px) minmax(150px, 220px); gap: 10px; align-items: center; padding: 6px; border-radius: 8px; border: 1px solid var(--s-line); }
.snap-book-astrid .snap-book-astrid-said { flex: 1 1 320px; } .snap-book-astrid-said.ok, .snap-book-astrid-cut.ok { color: #57c785; } .snap-book-astrid-cut.moved { color: #f0b445; }
.snap-book-astrid-go { text-decoration: none; padding: 5px 12px; border-radius: 8px; }
.snap-book-astrid-help { font-size: 12px; line-height: 1.45; color: var(--s-dim); max-width: 760px; }
.snap-book-cutthumb { width: 160px; aspect-ratio: 16 / 9; object-fit: cover; border-radius: 6px; background: #000; display: flex; align-items: center; justify-content: center; font-size: 11px; }
.snap-book-num input { width: 100%; }
@container (max-width: 760px) {
  .snap-sheet.snap-book-sheet { inset: 48px 6px 8px; }
  .snap-book-grid2 { grid-template-columns: minmax(0, 1fr); }
  .snap-book-table { display: block; overflow-x: auto; } .snap-book-table td, .snap-book-table th { white-space: nowrap; overflow-wrap: normal; }
  .snap-book-cutrow { grid-template-columns: 40px 1fr; } .snap-book-cutrow > :nth-child(n+3) { grid-column: span 1; }
}
`;
export const bookSheet = () => sheetOpen;
