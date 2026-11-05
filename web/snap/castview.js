// The Cast sheet (U86): one character's details, kept once on its Cast record (snap/cast/<id>.json): name, alias,
// trigger words, the details line, an identity LoRA and its strength (by file name), reference pictures, lore and a
// rating. Saving is a new version (an unchanged body makes none); the version list shows every one, and opening an
// older version edits from it (saving it makes the next version, the old one stays). "Save and use" puts this version
// into the open recipe (L.applyCast): the Cast row, the details sentence in the prompt, the pictures in References.
// SNAP-R59 Cast by reference · SNAP-R60 versions · SNAP-R3 a file that isn't here shows as missing · SNAP-R11 warn,
// never block · see docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import * as L from "./library.js";
import * as M from "./models.js";
import * as W from "./world.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const short = (f) => String(f).split("/").pop().replace(/\.safetensors$/, "");
const when = (at) => new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const view = (file) => { const cut = file.lastIndexOf("/"); return api.apiURL(`/view?filename=${encodeURIComponent(file.slice(cut + 1))}&subfolder=${encodeURIComponent(file.slice(0, Math.max(cut, 0)))}&type=input`); };

// open the sheet on a record (id), a version of it (n), or a new one (id null; `lora` starts it from that LoRA file)
export async function openCast(host, { id = null, n = null, lora = null, say, onApplied }) {
  host.querySelector(".snap-cast-sheet")?.remove();
  await Promise.all([L.ready(), M.load()]);
  const rec = id && W.record("cast", id), from = rec && (n ? rec.versions.find((v) => v.n === n) : W.headOf(rec));
  const b = structuredClone(from?.body ?? { name: lora ? short(lora).replace(/[_-]+/g, " ") : "", alias: "", trigger: "", details: "", lora: lora ? { file: lora, strength: M.entry(lora)?.recommended?.strength ?? 1 } : null, refs: [], lore: "", rating: null });
  let recId = id;
  const field = (label, el) => h("label", { className: "snap-field" }, h("span", { textContent: label }), el);
  const text = (k, ph, rows) => { const el = h(rows ? "textarea" : "input", { value: b[k] ?? "", placeholder: ph, ariaLabel: k, ...(rows ? { rows } : {}) }); el.addEventListener("input", () => { b[k] = el.value; }); return el; };
  // the LoRA: identity files first, then the rest; a name that isn't installed stays shown as missing (SNAP-R3)
  const files = M.loraChoices().map(([f, e]) => [f, e]).sort((x, y) => (y[1]?.role === "identity") - (x[1]?.role === "identity") || x[0].localeCompare(y[0]));
  const loraSel = h("select", { ariaLabel: "identity LoRA", onchange: () => { b.lora = loraSel.value ? { file: loraSel.value, strength: +strength.value || 1 } : null; } },
    h("option", { value: "", textContent: "no LoRA (pictures and words only)" }),
    ...(b.lora && !files.some(([f]) => f === b.lora.file) ? [h("option", { value: b.lora.file, textContent: `✕ ${short(b.lora.file)} (not installed here)` })] : []),
    ...files.map(([f, e]) => h("option", { value: f, textContent: `${short(f)}${e?.role === "identity" ? "" : ` · ${e?.role ?? "unsorted"}`}` })));
  loraSel.value = b.lora?.file ?? "";
  const strength = h("input", { type: "number", step: "0.05", min: "0", max: "2", value: b.lora?.strength ?? 1, ariaLabel: "strength", oninput: () => { if (b.lora) b.lora.strength = +strength.value; } });
  const rating = h("select", { ariaLabel: "rating", onchange: () => { b.rating = rating.value || null; } }, h("option", { value: "", textContent: "rated from how it was made" }), ...M.RATINGS.map((r) => h("option", { value: r, textContent: `rated ${M.RATING_SHOWN[r]}` })));
  rating.value = b.rating ?? "";
  // reference pictures: each an input/ file with what it shows; from References (pictures already there) or an upload
  const refsBox = h("div", { className: "snap-cast-refs" });
  const drawRefs = () => refsBox.replaceChildren(...b.refs.map((r, i) => h("figure", {},
    h("img", { src: view(r.file), alt: r.role, loading: "lazy", onerror: (e) => { e.target.replaceWith(h("div", { className: "snap-cast-missing", textContent: `✕ ${short(r.file)} isn't in input/` })); } }),
    h("input", { value: r.role, ariaLabel: "what this picture shows", oninput: (e) => { r.role = e.target.value; } }),
    h("button", { className: "snap-x", textContent: "×", title: "take this picture out of the record (the file stays)", onclick: () => { b.refs.splice(i, 1); drawRefs(); } }))),
  h("div", { className: "snap-set-actions" },
    h("button", { className: "snap-link", textContent: "+ picture", onclick: () => upload.click() }),
    h("button", { className: "snap-link", textContent: "+ from References", title: "the pictures References holds now", onclick: () => {
      for (const p of E.state().bricks.find((x) => x.key === "refs")?.pictures ?? []) if (!b.refs.some((r) => r.file === p.file)) b.refs.push({ file: p.file, role: p.role.replace(/^cast: [^,]*, /, "") });
      drawRefs();
    } })));
  const upload = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", multiple: true, onchange: async () => {
    for (const f of upload.files) b.refs.push({ file: await L.uploadCastPicture(f, recId ?? "new"), role: `identity: ${b.refs.length ? "picture " + (b.refs.length + 1) : "front"}` });
    upload.value = ""; drawRefs();
  } });
  const note = h("input", { placeholder: "what changed (optional, shown in the version list)", ariaLabel: "version note" });
  const status = h("div", { className: "snap-quiet", role: "status" });
  const versions = h("div", { className: "snap-cast-versions" });
  const drawVersions = () => {
    const r = recId && W.record("cast", recId);
    versions.replaceChildren(...(r ? [h("div", { className: "snap-rail-title", textContent: `Versions (${r.versions.length})` }), ...[...r.versions].reverse().map((v) => h("button", {
      className: `snap-cast-version${v.n === (from?.n ?? r.head) ? " on" : ""}`, title: `${v.note || "no note"} · ${v.by} · ${v.hash.slice(0, 12)}`, onclick: () => openCast(host, { id: recId, n: v.n, say, onApplied }) },
      h("strong", { textContent: `v${v.n}${v.n === r.head ? " · newest" : ""}` }), h("span", { className: "snap-quiet", textContent: `${when(v.at)}${v.note ? ` · ${v.note}` : ""}` })))] : [h("div", { className: "snap-quiet", textContent: "Not saved yet: Save makes version 1" })]));
  };
  const saveIt = async () => {
    if (!b.name.trim()) throw new Error("A cast member needs a name");
    const out = await L.saveCast(recId, b, { note: note.value.trim(), by: "person" });
    recId = out.id;
    status.textContent = out.made ? `Saved ${b.name} v${out.n}` : `Nothing changed: ${b.name} stays v${out.n}`;
    drawVersions();
    return out;
  };
  const act = (fn) => async () => { try { await fn(); } catch (err) { status.textContent = err.message; say?.(err.message, true); } };
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const older = from && rec && from.n !== rec.head;
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-cast-sheet", role: "dialog", ariaLabel: "Cast" },
    h("header", {}, h("strong", { textContent: rec ? `Cast: ${b.name} · v${from.n}${older ? ` (newest is v${rec.head})` : ""}` : "New cast member" }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
    h("div", { className: "snap-cast-body" },
      h("div", { className: "snap-cast-fields" },
        field("name", text("name", "Kon")), field("alias", text("alias", "kon (the short handle)")),
        field("trigger words", text("trigger", "the LoRA's trigger, as it must appear in the prompt")),
        field("details", text("details", "one line that describes them: build, hair, eyes, clothes", 3)),
        field("identity LoRA", h("div", { className: "snap-cast-lora" }, loraSel, strength)),
        h("div", { className: "snap-rail-title", textContent: "Reference pictures" }), refsBox,
        field("lore (searched, never sent to a model)", text("lore", "who they are", 2)), field("rating", rating)),
      h("aside", {}, versions,
        older ? h("div", { className: "snap-quiet", textContent: `You are editing from v${from.n}. Saving makes v${rec.head + 1}; v${from.n} and every other version stay.` }) : null,
        note, h("div", { className: "snap-set-actions" },
          h("button", { className: "snap-primary", textContent: "Save and use", title: "save a version and put it into the open recipe: the Cast row, the details in the prompt, the pictures in References", onclick: act(async () => {
            const out = await saveIt(), said = await L.applyCast(out.ref);
            status.textContent = said; say?.(said); onApplied?.(); close();
          }) }),
          h("button", { className: "snap-link", textContent: "Save", onclick: act(saveIt) })),
        status)));
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  drawRefs(); drawVersions();
  host.append(sheet);
  sheet.querySelector("input")?.focus();
  return sheet;
}
