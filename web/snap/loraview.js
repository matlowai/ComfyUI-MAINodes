// LoRAs by what they do (SNAP-R12, SNAP-R25): one chip per category the model graph gives this machine's LoRA files (core
// with its sub-kind, style, identity, dial, unsorted, and tags such as nsfw), search inside one, and "move to…" on every
// row, or a row dropped on a chip, to file it. A move goes to the person's snap/models.json through models.js (the same
// function set_lora_category calls, SNAP-R19), so the Library, the pickers, the Setup's stacks and the agent tools all see
// it at once; Undo puts back what was there. SFW only leaves the nsfw files out, and so their chip.
// SNAP-R12 LoRA roles · SNAP-R19 one function · SNAP-R25 SFW only · SNAP-R27 a lock on private ones, the row still works ·
// SNAP-R35 a rating from move to… · see docs/SNAP_RULES.md
import * as M from "./models.js";
import * as PF from "./profile.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
export const label = (id) => (id.startsWith("rating:") ? (id === "rating:" ? "unrated" : `rated ${M.RATING_SHOWN[id.slice(7)]}`) : id.replace("·", " · "));
const short = (f) => String(f).split("/").pop().replace(/\.safetensors$/, "");
const SHOWN = 150; // rows drawn at once; search narrows the rest

// a small "move to…" control for one LoRA file: its roles, and each tag switched on or off
export function moveControl(file, onMoved) {
  const r = M.loraFiles().find((x) => x.file === file) ?? { category: M.categoryOf(M.entry(file)), tags: M.entry(file).tags ?? [] }, rating = M.entry(file).rating ?? null;
  const sel = h("select", { className: "snap-move", title: `move ${short(file)} to another category (kept in your snap/models.json)`, ariaLabel: "move to",
    onchange: async (e) => { const id = e.target.value; e.target.value = ""; try { onMoved(await M.moveTo(file, id), id); } catch (err) { onMoved(null, id, err); } } },
    h("option", { value: "", textContent: "move to…", selected: true, disabled: true }),
    M.ROLES.filter((id) => id !== r.category).map((id) => h("option", { value: id, textContent: label(id) })),
    M.TAGS.filter((t) => !(PF.sfwOnly() && t === "nsfw")).map((t) => h("option", { value: t, textContent: r.tags.includes(t) ? `not ${t}` : t })),
    M.mayRate() ? [...M.RATINGS.filter((x) => x !== rating).map((x) => h("option", { value: `rating:${x}`, textContent: `rated ${M.RATING_SHOWN[x]}` })),
      rating ? h("option", { value: "rating:", textContent: "unrated" }) : null] : []);
  for (const ev of ["pointerdown", "click"]) sel.addEventListener(ev, (e) => e.stopPropagation()); // a card under it must not apply
  return sel;
}

export async function openLoras(host, { say, onChange, start = null, onAdd = null, undo = [] }) {
  host.querySelector(".snap-lora-sheet")?.remove();
  await Promise.all([M.load(), M.locks()]);
  let shown = start, sig = "";
  const q = h("input", { className: "snap-lib-q", placeholder: "Search LoRAs (any part of the name)…", ariaLabel: "search LoRAs" });
  const chips = h("div", { className: "snap-lora-chips" }), list = h("div", { className: "snap-lora-list" });
  const undoBtn = h("button", { className: "snap-link snap-quiet-btn", hidden: true, textContent: "Undo move", onclick: async () => {
    const u = undo.pop(); if (!u) return;
    await M.restore(u); say(`${short(u.file)} is back where it was`); changed();
  } });
  const count = h("span", { className: "snap-quiet" });
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-lora-sheet", role: "dialog", ariaLabel: "LoRAs" },
    h("header", {}, h("strong", { textContent: "LoRAs" }), count, h("span", { className: "snap-spacer" }), undoBtn, h("button", { className: "snap-x", textContent: "×", onclick: close })),
    h("div", { className: "snap-lora-pick" }, chips, q, list));
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });

  async function move(file, id) {
    try { undo.push(await M.moveTo(file, id)); say(`${short(file)} → ${label(id)} (Undo move puts it back)`); } catch (err) { say(err.message, true); }
    changed();
  }
  function changed() { sig = ""; draw(); onChange(); }
  const chip = (id, n) => {
    const b = h("button", { className: `snap-lora-chip${shown === id ? " on" : ""}`, onclick: () => { shown = id; draw(); } }, id ? label(id) : "All", h("i", { textContent: String(n) }));
    b.dataset.category = id ?? "";
    if (id) { // drop a row on a chip to move it there
      b.addEventListener("dragover", (e) => { e.preventDefault(); b.classList.add("drop"); });
      b.addEventListener("dragleave", () => b.classList.remove("drop"));
      b.addEventListener("drop", (e) => { e.preventDefault(); b.classList.remove("drop"); const f = e.dataTransfer.getData("text/x-snap-lora"); if (f) move(f, id); });
    }
    return b;
  };
  function draw() {
    const all = M.loraFiles(), cats = M.categories(), words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    if (shown && !cats.some((c) => c.id === shown)) shown = null;
    const found = all.filter((r) => (!shown || M.inCategory(r, shown)) && words.every((w) => r.file.toLowerCase().includes(w)));
    const now = JSON.stringify([shown, q.value, cats, found.slice(0, SHOWN).map((r) => [r.file, r.category, r.tags])]);
    if (now === sig) return; // the sheet isn't rebuilt by graph changes, only by its own edits (SNAP-R7 holds)
    sig = now;
    count.textContent = [`${all.length} here`, PF.sfwOnly() && "SFW only · nsfw hidden"].filter(Boolean).join(" · ");
    undoBtn.hidden = !undo.length;
    chips.replaceChildren(chip(null, all.length), ...cats.map((c) => chip(c.id, c.count)));
    list.replaceChildren(...[...(found.length ? found.slice(0, SHOWN).map((r) => {
      const row = h("div", { className: "snap-lora-row", draggable: true },
        h("strong", { textContent: `${M.isLocked(r.file) ? "🔒 " : ""}${short(r.file).replaceAll("_", "_​")}`, title: M.isLocked(r.file) ? `${r.file}\nprivate: your private rules match it, so takes that load it are locked and left out of exports` : r.file }),
        h("span", { className: "snap-quiet", textContent: [r.entry.family, r.file.includes("/") && r.file.split("/").slice(0, -1).join("/")].filter(Boolean).join(" · ") }),
        h("span", { className: "snap-lora-cats" }, h("i", { className: `snap-lora-kind ${r.entry.role ?? "unsorted"}`, textContent: label(r.category) }), r.tags.map((t) => h("i", { className: "snap-lora-kind tag", textContent: t }))),
        moveControl(r.file, (u, id, err) => { if (err) { say(err.message, true); return; } undo.push(u); say(`${short(r.file)} → ${label(id)} (Undo move puts it back)`); changed(); }),
        onAdd && r.category !== "dial" ? h("button", { className: "snap-link snap-quiet-btn", textContent: "+ add", title: "add it to this stack", onclick: () => { onAdd(r.file); close(); } }) : null);
      row.dataset.file = r.file;
      row.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/x-snap-lora", r.file); e.dataTransfer.effectAllowed = "move"; });
      return row;
    }) : [h("div", { className: "snap-quiet", textContent: "No LoRA here matches." })]),
    found.length > SHOWN ? h("div", { className: "snap-quiet", textContent: `${found.length - SHOWN} more: type to narrow` }) : null].filter(Boolean)); // a null would print "null"
  }
  q.addEventListener("input", draw);
  host.append(sheet);
  draw();
  q.focus();
  return sheet;
}
