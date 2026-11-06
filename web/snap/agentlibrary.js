// The Agent library (U104, DESIGN_U103_U104 §4.8): one sheet, three views. Skills: every pack skill, the person's version
// over it (edit, diff against the pack, back to the pack, history). Instructions: every note of every layer, whole, with
// who wrote it and where it came from, on/off in one click, "new from <agent>" until opened, tweak a pack note (a note
// that replaces it), edit, history, archive, add. Applies here: the resolved stack for one scope (the open recipe, a
// brick, a scene, a shot, a take, a Cast), overridden rows struck, conflicts boxed, off rows dimmed, the hash on top.
// The "Agent instructions" button on bricks, the recipe, scenes, takes and Cast sheets opens it on Applies here; the
// rail row counts what agents added; an agent's note arriving says so in a quiet toast with one press to it.
// SNAP-R93 the stack shown per scope · SNAP-R94 skills with the person's version · SNAP-R95 new from <agent>, one click
// off · SNAP-R58 every row and text whole, no cap · SNAP-R11 nothing blocks · SNAP-R66 an arrival announces, a press
// moves · SNAP-R8 judged from screenshots · see docs/SNAP_RULES.md
import * as I from "./instructions.js";
import * as W from "./world.js";
import * as T from "./takes.js";
import * as SC from "./scenes.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
// replaceChildren prints "null" for a null child (LESSONS): every refill goes through this
const fill = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false));
const when = (at) => (at ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const LAYER = { pack: "Pack", install: "Install", person: "Yours" };
const who = (by) => (by === "pack" ? "the pack" : by === "person" ? "you" : String(by).replace(/^agent:?/, "") || "an agent");
const line = (r) => (r.kind === "model_choice" ? `${r.job} → ${r.choice}${r.why ? ` (${r.why})` : ""}` : r.text);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
// a scope as the person reads it
function scopeName(scope) {
  if (scope === "global") return "everywhere";
  const [kind, rest] = [scope.split(":")[0], scope.slice(scope.indexOf(":") + 1)];
  if (kind === "scene") return `scene ${SC.get(rest)?.name ?? rest}`;
  if (kind === "shot") { const [s, x] = rest.split("/"), sc = SC.get(s), sh = sc?.shots.find((y) => y.id === x); return sh ? `${sc.name} › ${SC.shotTitle(sc, sh)}` : `shot ${rest}`; }
  if (kind === "take") { const t = T.get(rest); return t ? `take ${t.number}` : `take ${rest}`; }
  if (kind === "cast") return `Cast ${W.headOf(W.record("cast", rest.replace(/^cast:/, "")))?.body.name ?? rest}`;
  return `${kind} ${rest}`;
}

let sheetOpen = null; // {draw} of the open sheet, for arrivals and focus re-reads
export async function openLibrary(host, { say, view = "here", scope = null, focus = null } = {}) {
  for (const s of host.querySelectorAll(".snap-world-sheet, .snap-opened-sheet, .snap-rerun-sheet, .snap-al-sheet")) s.remove(); // they share one place
  await I.ready();
  await Promise.all([T.load(), SC.load()]).catch(() => {});
  let tab = view, here = scope, exact = false, query = "", openSkill = null, skillMode = "read", editing = null, adding = false, history = new Set(), focused = focus;
  const status = h("div", { className: "snap-quiet", role: "status" }), body = h("div", { className: "snap-al-body" }), counts = h("span", { className: "snap-quiet" });
  const tabs = h("div", { className: "snap-seg snap-al-tabs", role: "tablist" });
  const close = () => { sheet.remove(); sheetOpen = null; host.focus({ preventScroll: true }); };
  const act = (fn) => async () => { try { const said = await fn(); if (said) { status.textContent = said; say?.(said); } } catch (err) { status.textContent = err.message; say?.(err.message, true); } draw(); };
  function drawTabs() {
    fill(tabs, ...[["skills", "Skills"], ["notes", "Instructions"], ["here", "Applies here"]].map(([k, label]) => h("button", { className: tab === k ? "on" : "", textContent: label, role: "tab", ariaSelected: String(tab === k), onclick: () => { tab = k; draw(); } })));
    const all = I.rows(), unseen = I.unseen();
    counts.textContent = `${plural(I.skillList().length, "skill")} · ${plural(all.length, "note")}${unseen.length ? ` · ${unseen.length} new from agents` : ""}`;
  }
  // one note as a row: what it says, whole; where it applies; who wrote it and from what; its switches
  function noteRow(r, { struck = null } = {}) {
    const off = I.isOff(r.ref), fresh = I.newFrom(r), mine = r.layer === "person", ob = I.offBy(r.ref);
    const versions = mine ? W.record("instruction", r.id)?.versions ?? [] : [];
    const editBox = editing === r.ref ? h("textarea", { className: "snap-note-input snap-al-edit", value: r.kind === "model_choice" ? r.choice : r.text, rows: 3, ariaLabel: r.kind === "model_choice" ? "choice" : "note text" }) : null;
    const el = h("div", { className: `snap-al-note${off ? " off" : ""}${struck ? " struck" : ""}${fresh ? " fresh" : ""}${focused === r.ref || focused === r.key ? " focused" : ""}` },
      h("div", { className: "snap-al-line" },
        h("span", { className: `snap-al-chip layer-${r.layer}`, textContent: r.layer === "install" ? `Install · ${r.from}` : LAYER[r.layer] }),
        h("span", { className: "snap-al-chip", textContent: scopeName(r.scope), title: r.scope }),
        r.kind === "model_choice" ? h("span", { className: "snap-al-chip choice", textContent: "model choice" }) : null,
        fresh ? h("span", { className: "snap-al-chip fresh", textContent: `new from ${fresh}` }) : null,
        r.planned ? h("span", { className: "snap-al-chip", textContent: `planned, ${r.planned}`, title: "its code is a later build" }) : null,
        h("span", { className: "snap-spacer" }),
        h("label", { className: "snap-al-switch", title: off ? `off${ob ? ` (by ${who(ob.by)}${ob.from ? `, imported from ${ob.from}` : ""})` : ""}: agents don't get it; one click brings it back` : "on: agents get it; one click turns it off" },
          h("input", { type: "checkbox", checked: !off, onchange: act(async () => { await I.setOff(r.ref, off === false); return `${off ? "On" : "Off"}: ${line(r).slice(0, 80)}`; }) }), off ? "off" : "on")),
      editBox ?? h("div", { className: "snap-al-text", textContent: line(r) }),
      struck ? h("div", { className: "snap-al-why", textContent: `overridden by ${struck}` }) : null,
      h("div", { className: "snap-al-meta" }, [
        `by ${who(r.by)}`, r.at ? when(r.at) : null, mine && versions.length > 1 ? `v${r.n} of ${versions.length}` : null,
        r.source?.quote ? `“${r.source.quote}”${r.source.date ? ` (${r.source.date})` : ""}` : r.source?.from && r.source.from !== r.by ? `from ${who(r.source.from)}` : null,
        r.rule ?? null, r.more ? `more: ${r.more}` : null, r.mode === "replace" ? `replaces ${r.supersedes.join(", ")}` : null, ob?.by === "import" ? `imported from ${ob.from}: review, then turn it on` : null,
      ].filter(Boolean).join(" · ")),
      h("div", { className: "snap-al-acts" },
        fresh ? h("button", { className: "snap-link snap-al-btn", textContent: "Seen", title: "you've looked at it: the badge goes", onclick: act(async () => { await I.seen([r.ref]); }) }) : null,
        editing === r.ref ? [h("button", { className: "snap-primary snap-al-btn", textContent: "Save version", onclick: act(async () => { const v = editBox.value.trim(); editing = null; const o = await I.save(r.ref, r.kind === "model_choice" ? { choice: v } : { text: v }, { by: "person", note: "edited in the Agent library" }); await I.seen([o.ref]); return o.made ? `Saved ${o.ref}` : "Nothing changed"; }) }),
          h("button", { className: "snap-link snap-al-btn", textContent: "Cancel", onclick: () => { editing = null; draw(); } })]
          : mine ? h("button", { className: "snap-link snap-al-btn", textContent: "Edit", onclick: () => { editing = r.ref; draw(); } }) : null,
        !mine ? h("button", { className: "snap-link snap-al-btn", textContent: "Tweak", title: "your own note that takes this one's place (the pack's stays; Reset brings it back)", onclick: act(async () => {
          const o = await I.save(null, { scope: r.scope, kind: r.kind, ...(r.kind === "model_choice" ? { job: r.job, choice: r.choice, why: r.why } : { text: r.text }), mode: "replace", supersedes: [r.key], rule: r.rule, more: r.more, source: { from: "person", date: new Date().toISOString().slice(0, 10) } }, { by: "person", note: `tweak of ${r.key}` });
          editing = o.ref; tab = "notes"; return `Your copy of it replaces ${r.key}: edit it below`; }) }) : null,
        mine && r.mode === "replace" ? h("button", { className: "snap-link snap-al-btn", textContent: "Reset", title: "archive your tweak: the note it replaced applies again (Restore in the World sheet brings yours back)", onclick: act(async () => { await W.archive("instruction", r.id); return `Reset: ${r.supersedes.join(", ")} applies again`; }) }) : null,
        mine && versions.length > 1 ? h("button", { className: `snap-link snap-al-btn${history.has(r.ref) ? " on" : ""}`, textContent: "History", onclick: () => { history.has(r.ref) ? history.delete(r.ref) : history.add(r.ref); draw(); } }) : null,
        mine && r.mode !== "replace" ? h("button", { className: "snap-link snap-al-btn", textContent: "Archive", title: "out of every stack; it still resolves for takes that ran under it; Restore in the World sheet", onclick: act(async () => { await W.archive("instruction", r.id); return `Archived ${r.ref}`; }) }) : null),
      history.has(r.ref) ? h("ol", { className: "snap-al-history" }, [...versions].reverse().map((v) => h("li", {}, h("strong", { textContent: `v${v.n}` }), ` ${when(v.at)} · by ${who(v.by)}${v.note ? ` · ${v.note}` : ""}: `, h("span", { textContent: line(v.body) })))) : null);
    el.dataset.ref = r.ref;
    if (fresh) el.addEventListener("click", (e) => { if (!e.target.closest("button, input, textarea, label")) act(async () => { await I.seen([r.ref]); })(); });
    return el;
  }
  function adder(defaultScope) {
    const scope = h("input", { className: "snap-note-input", value: defaultScope ?? "global", ariaLabel: "scope", title: "global, tool:<name>, brick:<key>, method:<id>, cast:<id>, location:<id>, scene:<id>, shot:<scene>/<shot>, take:<id>" });
    const text = h("textarea", { className: "snap-note-input", rows: 2, placeholder: "What agents should do here, in one line (e.g. 'Use Fizgig for character shots in this scene')", ariaLabel: "note text" });
    return h("div", { className: "snap-al-add" }, h("label", { className: "snap-quiet", textContent: "Scope" }), scope, text,
      h("div", { className: "snap-al-acts" }, h("button", { className: "snap-primary snap-al-btn", textContent: "Add note", onclick: act(async () => { const o = await I.save(null, { scope: scope.value.trim(), text: text.value.trim() }, { by: "person" }); adding = false; return `Added ${o.ref}: it applies now`; }) }),
        h("button", { className: "snap-link snap-al-btn", textContent: "Cancel", onclick: () => { adding = false; draw(); } })));
  }
  function drawNotes() {
    const q = query.toLowerCase(), all = I.rows().filter((r) => !q || [line(r), r.scope, scopeName(r.scope), r.by, r.rule, r.more, ...(r.tags ?? []), r.source?.quote].filter(Boolean).join(" ").toLowerCase().includes(q));
    const search = h("input", { className: "snap-note-input snap-al-search", type: "search", value: query, placeholder: "Search notes: words, scope, author, rule (SNAP-R86), tag", ariaLabel: "search notes", oninput: (e) => { query = e.target.value; const at = e.target.selectionStart; draw(); const s = body.querySelector(".snap-al-search"); s.focus(); s.setSelectionRange(at, at); } });
    const unseen = I.unseen();
    const groups = ["person", "install", "pack"].map((layer) => [layer, all.filter((r) => r.layer === layer)]).filter(([, l]) => l.length);
    return [h("div", { className: "snap-al-toolbar" }, search, h("span", { className: "snap-quiet", textContent: `${plural(all.length, "note")}${q ? " match" : ""}` }), h("span", { className: "snap-spacer" }),
      unseen.length ? h("button", { className: "snap-link snap-al-btn", textContent: `Mark ${unseen.length} seen`, onclick: act(async () => { await I.seen(unseen.map((r) => r.ref)); return "All seen"; }) }) : null,
      h("button", { className: "snap-link snap-al-btn", textContent: "+ Add a note", onclick: () => { adding = true; draw(); } })),
      adding ? adder(here ?? "global") : null,
      ...groups.flatMap(([layer, list]) => [h("div", { className: "snap-rail-title", textContent: `${layer === "person" ? "Yours (and what agents wrote for you)" : layer === "install" ? "Shared on this install" : "The pack's"} · ${list.length}` }), ...list.map((r) => noteRow(r))]),
      all.length ? null : h("div", { className: "snap-quiet", textContent: "No note matches." })];
  }
  function drawHere() {
    const options = [["", "This recipe (what describe_recipe gives)"], ["global", "Everywhere (global only)"]];
    const cur = SC.current();
    if (cur) options.push([`scene:${cur.scene.id}`, `Scene: ${cur.scene.name}`], [`shot:${cur.scene.id}/${cur.shot.id}`, `Shot: ${SC.shotTitle(cur.scene, cur.shot)}`]);
    if (here && !options.some(([v]) => v === here)) options.push([here, scopeName(here)]);
    const pick = h("select", { className: "snap-al-scope", ariaLabel: "what to show the instructions for", onchange: (e) => { here = e.target.value || null; draw(); } }, options.map(([v, label]) => h("option", { value: v, textContent: label, selected: (here ?? "") === v })));
    const free = h("input", { className: "snap-note-input snap-al-free", placeholder: "or a scope: tool:run, brick:render, cast:<id>…", ariaLabel: "scope", onkeydown: (e) => { if (e.key === "Enter") { here = e.target.value.trim() || null; draw(); } } });
    const box = h("div", { className: "snap-al-stack" }, h("div", { className: "snap-quiet", textContent: "Reading the stack…" }));
    (async () => {
      const c = await I.contextOf(here), a = await I.answer(c), r = I.resolve(c), rows = I.rows({ archived: true }), byRef = new Map(rows.map((x) => [x.ref, x]));
      const take = here?.startsWith("take:") ? T.get(here.slice(5)) : null, ran = take ? await I.ofTake(take) : null;
      const struck = new Map(r.overridden.map((o) => [o.ref, o.by])), inConflict = new Set(r.conflicts.flat());
      fill(box, 
        h("div", { className: "snap-al-hash" }, h("strong", { textContent: `Stack ${a.hash}` }), h("span", { className: "snap-quiet", textContent: ` · ${plural(a.count, "note")} apply${r.overridden.length ? ` · ${r.overridden.length} overridden` : ""}${r.off.length ? ` · ${r.off.length} off` : ""}${r.conflicts.length ? ` · ${plural(r.conflicts.length, "conflict")}` : ""} · outer to inner: pack, install, yours, scene, shot, take` })),
        ran ? h("div", { className: `snap-al-ran${ran.same ? "" : " moved"}` }, ran.ran ? [h("strong", { textContent: ran.same ? `Take ${take.number} ran under ${ran.ran.hash}: the same stack applies now` : `Take ${take.number} ran under ${ran.ran.hash} · now ${ran.now.hash}` }),
          ...(ran.same ? [] : [...ran.diff.changed.map((d) => h("div", { className: "snap-al-diffrow" }, h("b", { textContent: `${d.ref} v${d.was} → v${d.now}` }), h("div", { className: "snap-al-was", textContent: `was: ${d.was_text ?? "?"}` }), h("div", { className: "snap-al-now", textContent: `now: ${d.now_text ?? "?"}` }))),
            ...ran.diff.added.map((x) => h("div", { className: "snap-al-diffrow", textContent: `added since: ${line(byRef.get(x) ?? { text: x })}` })), ...ran.diff.removed.map((x) => h("div", { className: "snap-al-diffrow", textContent: `gone since: ${x}` })),
            ...ran.diff.turned_off.map((x) => h("div", { className: "snap-al-diffrow", textContent: `turned off since: ${line(byRef.get(x) ?? { text: x })}` })), ...ran.diff.turned_on.map((x) => h("div", { className: "snap-al-diffrow", textContent: `turned on since: ${line(byRef.get(x) ?? { text: x })}` }))])] : h("span", { className: "snap-quiet", textContent: `Take ${take.number}: ${ran.why}` })) : null,
        ...r.conflicts.map((pair) => h("div", { className: "snap-al-conflict", role: "note" }, h("strong", { textContent: "Conflict: two model choices for one job at the same level. Agents are told to ask you or take the newer; turn one off to settle it." }), ...pair.map((ref) => noteRow(byRef.get(ref))))),
        ...[...a.stack.map((s) => byRef.get(s.ref)).filter((x) => x && !inConflict.has(x.ref)), ...rows.filter((x) => struck.has(x.ref)), ...r.offRows.map((s) => byRef.get(s.ref)).filter(Boolean)]
          .filter((x) => !exact || x.scope === here)
          .map((x) => noteRow(x, { struck: struck.has(x.ref) ? struck.get(x.ref).split(", ").map((ref) => { const w = byRef.get(ref); return w ? `${w.layer === "person" ? "yours" : who(w.by)}: “${line(w)}” (${ref})` : ref; }).join("; ") : null })),
        a.skills.length ? h("div", { className: "snap-rail-title", textContent: "Skills for this" }) : null,
        ...a.skills.map((s) => h("button", { className: "snap-link snap-al-btn", textContent: `${s.name}${s.yours ? ` (yours v${s.yours})` : ""}`, title: s.description, onclick: () => { tab = "skills"; openSkill = s.name; skillMode = "read"; draw(); } })));
    })().catch((err) => fill(box, h("div", { className: "snap-world-warn", textContent: err.message })));
    const only = here && here !== "global" ? h("label", { className: "snap-al-switch", title: "hide what this inherits (the pack's and your notes for everywhere, the scene's…): only the notes set for exactly this" },
      h("input", { type: "checkbox", checked: exact, onchange: (e) => { exact = e.target.checked; draw(); } }), `only notes set for ${scopeName(here)}`) : null;
    return [h("div", { className: "snap-al-toolbar" }, h("span", { className: "snap-quiet", textContent: "Show what agents get for" }), pick, free, only), box];
  }
  function drawSkills() {
    const list = I.skillList();
    if (!openSkill) return [h("p", { className: "snap-quiet", textContent: "The pack's skills: how Snap links together (snap-core) and how to do each job well. Your version of one sits over the pack's: agents read yours, and Reset brings the pack's back." }),
      h("div", { className: "snap-al-skills" }, list.map((s) => { const y = I.yours(s.name), rec = W.record("skill", s.name), fresh = rec && String(W.headOf(rec).by).startsWith("agent") && I.unseen().some((u) => u.ref === W.refOf("skill", s.name, rec.head));
        return h("button", { className: "snap-al-skill", onclick: () => { openSkill = s.name; skillMode = "read"; draw(); } },
          h("strong", { textContent: s.name }), h("span", { className: "snap-quiet", textContent: s.description }),
          h("span", { className: "snap-al-line" }, h("span", { className: "snap-al-chip", textContent: `${(s.bytes / 1000).toFixed(1)} KB` }), y ? h("span", { className: "snap-al-chip layer-person", textContent: `yours v${y.n} over the pack` }) : null,
            y && y.body.base_hash !== s.hash ? h("span", { className: "snap-al-chip warn", textContent: "the pack updated this" }) : null, rec && !y && !rec.archived ? h("span", { className: "snap-al-chip", textContent: "yours is off" }) : null,
            fresh ? h("span", { className: "snap-al-chip fresh", textContent: `new from ${who(W.headOf(rec).by)}` }) : null)); }))];
    const s = list.find((x) => x.name === openSkill), rec = W.record("skill", s.name), y = I.yours(s.name);
    const view = h("div", { className: "snap-al-skilltext" }, h("div", { className: "snap-quiet", textContent: "Loading…" }));
    (async () => {
      const pack = await I.packSkill(s.name), mine = y?.body.markdown;
      if (skillMode === "edit") {
        const ta = h("textarea", { className: "snap-note-input snap-al-skilledit", value: mine ?? pack.text, rows: 30, ariaLabel: `${s.name} text` });
        fill(view, ta, h("div", { className: "snap-al-acts" }, h("button", { className: "snap-primary snap-al-btn", textContent: "Save as my version", onclick: act(async () => { const o = await I.saveSkill(s.name, ta.value, { by: "person", note: "edited in the Agent library" }); await I.seen([o.ref]); skillMode = "read"; return o.made ? `${s.name}: your v${o.n} is what agents read` : "Nothing changed"; }) }),
          h("button", { className: "snap-link snap-al-btn", textContent: "Cancel", onclick: () => { skillMode = "read"; draw(); } })));
      } else if (skillMode === "diff") {
        const rows = I.lineDiff(y?.body.base_markdown ?? pack.text, mine ?? pack.text), moved = y && y.body.base_hash !== s.hash ? I.lineDiff(y.body.base_markdown, pack.text) : null;
        fill(view, h("div", { className: "snap-quiet", textContent: y ? `The pack's text you started from (left, −) against yours (right, +); unchanged lines plain. ${rows.filter((x) => x.op !== " ").length} lines differ.` : "You have no version of this skill: it reads as the pack's." },),
          h("pre", { className: "snap-al-diff" }, rows.map((x) => h("div", { className: `d${x.op === " " ? "" : x.op === "-" ? " del" : " add"}`, textContent: `${x.op} ${x.line}` }))),
          moved ? [h("div", { className: "snap-rail-title", textContent: "What the pack changed since you began (pack then − / pack now +)" }), h("pre", { className: "snap-al-diff" }, moved.map((x) => h("div", { className: `d${x.op === " " ? "" : x.op === "-" ? " del" : " add"}`, textContent: `${x.op} ${x.line}` })))] : null);
      } else if (skillMode === "history") {
        fill(view, h("ol", { className: "snap-al-history" }, h("li", {}, h("strong", { textContent: "v0" }), ` the pack's file · ${pack.bytes} bytes · ${s.hash.slice(0, 12)}`), ...(rec?.versions ?? []).map((v) => h("li", {}, h("strong", { textContent: `v${v.n}` }), ` ${when(v.at)} · by ${who(v.by)}${v.note ? ` · ${v.note}` : ""} · ${v.body.markdown.length} characters`))));
      } else fill(view, h("pre", { className: "snap-al-md", textContent: mine ?? pack.text }));
    })().catch((err) => fill(view, h("div", { className: "snap-world-warn", textContent: err.message })));
    return [h("div", { className: "snap-al-toolbar" }, h("button", { className: "snap-link snap-al-btn", textContent: "‹ All skills", onclick: () => { openSkill = null; draw(); } }), h("strong", { textContent: s.name }),
      h("span", { className: "snap-quiet", textContent: y ? `yours, v${y.n} (by ${who(W.headOf(y.record).by)})` : rec && !rec.archived ? "the pack's (yours is off)" : "the pack's" }), h("span", { className: "snap-spacer" }),
      ...[["read", "Read"], ["edit", "Edit"], ["diff", "Diff vs pack"], ["history", "History"]].map(([k, label]) => h("button", { className: `snap-link snap-al-btn${skillMode === k ? " on" : ""}`, textContent: label, onclick: () => { skillMode = k; draw(); } })),
      rec && !rec.archived ? h("button", { className: "snap-link snap-al-btn", textContent: I.isOff(`skill:${s.name}`) ? "Turn mine on" : "Turn mine off", onclick: act(async () => { await I.setOff(`skill:${s.name}`, !I.isOff(`skill:${s.name}`)); }) }) : null,
      y ? h("button", { className: "snap-link snap-al-btn", textContent: "Reset to pack", title: "archive your version: agents read the pack's again (Restore in the World sheet brings yours back)", onclick: act(async () => { await W.archive("skill", s.name); return `${s.name}: the pack's text again`; }) }) : null), view];
  }
  function draw() {
    drawTabs();
    fill(body, ...(tab === "skills" ? drawSkills() : tab === "notes" ? drawNotes() : drawHere()).filter((x) => x != null && x !== false));
    if (focused) requestAnimationFrame(() => { body.querySelector(".snap-al-note.focused")?.scrollIntoView({ block: "center" }); focused = null; });
  }
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-al-sheet", role: "dialog", ariaLabel: "Agent library" },
    h("header", {}, h("strong", { textContent: "Agent library" }), counts, h("span", { className: "snap-spacer" }), tabs, h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
    body, h("footer", { className: "snap-al-foot" }, status));
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  host.append(sheet);
  sheetOpen = { draw };
  draw();
  return sheet;
}
// another tab or the server may have written notes meanwhile: an open sheet reads them again when the page regains focus
addEventListener("focus", () => { if (sheetOpen) I.refresh().then(() => sheetOpen?.draw(), () => {}); });
I.onChange(() => sheetOpen?.draw());

const hostOf = (el) => el?.closest(".snap-root") ?? document.querySelector(".snap-root");
// the one button every object carries (bricks, the recipe, scenes, shots, takes, Cast records): the stack for that scope
export const button = (scope, { say, label = "Agent instructions", then } = {}) => {
  const b = h("button", { className: "snap-link snap-al-open", textContent: label, title: `what agents are told for ${scope ? scopeName(scope) : "this recipe"}: every note, where it came from, on/off (the Agent library)` });
  b.addEventListener("click", () => { const host = hostOf(b); then?.(); openLibrary(host, { say, view: "here", scope }).catch((err) => say?.(err.message, true)); });
  return b;
};
// the take viewer's line: the stack the take ran under against now, one press to the rows
export function takeLine(t, { say } = {}) {
  const el = h("div", { className: "snap-al-takeline" }, h("span", { className: "snap-quiet", textContent: "Agent instructions: reading…" }));
  I.ofTake(t).then((r) => {
    const n = r.ran ? r.diff.added.length + r.diff.removed.length + r.diff.changed.length + r.diff.turned_off.length + r.diff.turned_on.length : 0;
    fill(el, h("span", { className: "snap-quiet", textContent: r.ran ? `Agent instructions: ran under ${r.ran.hash} · ${r.same ? "the same now" : `now ${r.now.hash} · ${plural(n, "change")}`}` : "Agent instructions: none pinned on this take" }), button(`take:${t.id}`, { say, label: r.ran && !r.same ? "What changed" : "Show" }));
  }, (err) => fill(el, h("span", { className: "snap-quiet", textContent: `Agent instructions: ${err.message}` })));
  return el;
}
// the Library rail's row: counts, and a quiet toast when an agent's note or skill version arrives (SNAP-R66)
export function railButton({ say }) {
  const b = h("button", { className: "snap-link snap-quiet-btn snap-new-cast snap-al-rail", textContent: "Agent library", title: "the skills and notes agents get, what applies here, and what agents added: see, switch off, tweak" });
  b.addEventListener("click", () => openLibrary(hostOf(b), { say, view: "notes" }).catch((err) => say?.(err.message, true)));
  let told = null;
  const update = () => {
    const unseen = I.unseen();
    b.replaceChildren("Agent library", h("small", { textContent: `${I.skillList().length} skills · ${I.rows().length} notes${unseen.length ? ` · ${unseen.length} new from agents` : ""}` }));
    b.classList.toggle("fresh", unseen.length > 0);
    if (told == null) { told = new Set(unseen.map((r) => r.ref)); return; } // what was already there when the page opened is counted, not toasted
    const arrived = unseen.filter((r) => !told.has(r.ref));
    for (const r of arrived) told.add(r.ref);
    if (arrived.length) { const r = arrived.at(-1); // said after the call's own "Agent: …" line, which this one names more exactly
      setTimeout(() => say?.(`${who(r.by)} ${r.scope.startsWith("skill:") ? `edited the ${r.scope.slice(6)} skill` : `added a note for ${scopeName(r.scope)}`}${arrived.length > 1 ? ` (+${arrived.length - 1} more)` : ""}`, false, 6000,
        { label: "View", run: () => openLibrary(hostOf(b), { say, view: r.scope.startsWith("skill:") ? "skills" : "notes", focus: r.ref }) }), 50); }
  };
  I.onChange(update);
  I.ready().then(update, () => {});
  return b;
}

export const STYLE = `
.snap-sheet.snap-al-sheet { z-index: 85; inset: 56px max(16px, calc(50% - 560px)) auto; max-height: calc(100% - 80px); display: flex; flex-direction: column; box-shadow: 0 30px 80px #000c; } /* over the sheet it was opened from (a take, a Cast), under toasts */
.snap-al-sheet > header { flex-wrap: wrap; }
.snap-al-tabs button { white-space: nowrap; }
.snap-al-body { min-height: 0; overflow: auto; padding: 10px 16px 14px; display: flex; flex-direction: column; gap: 8px; }
.snap-al-foot { padding: 4px 16px 10px; min-height: 18px; }
.snap-al-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.snap-al-search { flex: 1 1 260px; min-width: 0; }
.snap-al-scope { font: inherit; font-size: 12.5px; color: var(--s-fg); background: var(--s-card); border: 1px solid var(--s-line); border-radius: 8px; padding: 5px 8px; max-width: 100%; }
.snap-al-free { flex: 1 1 200px; min-width: 0; }
.snap-al-note { background: var(--s-card); border-radius: 10px; box-shadow: inset 0 0 0 1px var(--s-line); padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; }
.snap-al-note.off { opacity: .55; } .snap-al-note.off .snap-al-text { text-decoration: none; }
.snap-al-note.struck .snap-al-text { text-decoration: line-through; color: var(--s-dim); }
.snap-al-note.fresh { box-shadow: inset 0 0 0 1px #6aa8ffaa, 0 0 0 3px #6aa8ff22; }
.snap-al-note.focused { box-shadow: inset 0 0 0 2px var(--s-accent); }
.snap-al-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
.snap-al-chip { font-size: 10.5px; font-weight: 600; letter-spacing: .03em; padding: 2px 7px; border-radius: 999px; background: var(--s-bg); color: var(--s-dim); white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
.snap-al-chip.layer-person { color: #b9d4ff; } .snap-al-chip.layer-install { color: #f0c27a; } .snap-al-chip.choice { color: #b6e3b0; }
.snap-al-chip.fresh { background: #6aa8ff; color: #0b1220; } .snap-al-chip.warn { color: #f0b445; }
.snap-al-text { font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; }
.snap-al-why, .snap-al-meta { font-size: 11.5px; color: var(--s-dim); line-height: 1.4; overflow-wrap: anywhere; }
.snap-al-acts { display: flex; gap: 6px; flex-wrap: wrap; }
.snap-al-btn { margin: 0; padding: 3px 10px; font-size: 12px; border-radius: 8px; }
.snap-al-switch { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--s-dim); cursor: pointer; white-space: nowrap; }
.snap-al-edit, .snap-al-skilledit { width: 100%; box-sizing: border-box; font-size: 13px; }
.snap-al-skilledit { font-family: ui-monospace, monospace; font-size: 12px; min-height: 360px; }
.snap-al-history { margin: 2px 0 0; padding-left: 22px; font-size: 12px; color: var(--s-dim); display: flex; flex-direction: column; gap: 3px; overflow-wrap: anywhere; }
.snap-al-add { display: flex; flex-direction: column; gap: 6px; background: var(--s-card); border-radius: 10px; padding: 8px 10px; box-shadow: inset 0 0 0 1px var(--s-accent); }
.snap-al-stack { display: flex; flex-direction: column; gap: 6px; }
.snap-al-hash { font-size: 13px; }
.snap-al-ran { background: var(--s-card); border-radius: 10px; padding: 8px 10px; display: flex; flex-direction: column; gap: 4px; font-size: 12.5px; } .snap-al-ran.moved { box-shadow: inset 0 0 0 1px #f0b44566; }
.snap-al-diffrow { font-size: 12px; overflow-wrap: anywhere; } .snap-al-was { color: #f08a7a; } .snap-al-now { color: #8fd18a; }
.snap-al-conflict { border-radius: 10px; padding: 8px; display: flex; flex-direction: column; gap: 6px; box-shadow: inset 0 0 0 1px #f0b445aa; font-size: 12.5px; }
.snap-al-skills { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
.snap-al-skill { all: unset; cursor: pointer; display: flex; flex-direction: column; gap: 5px; background: var(--s-card); border-radius: 10px; padding: 10px 12px; box-shadow: inset 0 0 0 1px var(--s-line); }
.snap-al-skill:hover, .snap-al-skill:focus-visible { box-shadow: inset 0 0 0 1px var(--s-accent); }
.snap-al-skill .snap-quiet { line-height: 1.4; }
.snap-al-md, .snap-al-diff { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, monospace; font-size: 12px; line-height: 1.5; background: var(--s-card); border-radius: 10px; padding: 10px 12px; }
.snap-al-diff .del { color: #f08a7a; background: #f08a7a14; } .snap-al-diff .add { color: #8fd18a; background: #8fd18a14; }
.snap-al-takeline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 4px 0; }
.snap-al-open { margin: 0; padding: 3px 10px; font-size: 11.5px; border-radius: 8px; white-space: nowrap; }
.snap-al-rail { display: flex; flex-direction: column; gap: 1px; } .snap-al-rail small { font-size: 11px; color: var(--s-dim); font-weight: 400; }
.snap-al-rail.fresh { box-shadow: inset 0 0 0 1px var(--s-accent); } .snap-al-rail.fresh small { color: #b9d4ff; }
@container (max-width: 760px) { .snap-sheet.snap-al-sheet { inset: 48px 8px auto; } .snap-al-skills { grid-template-columns: 1fr; } }
`;
