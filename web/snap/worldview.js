// The World sheet (U87 §4.5): every record the person keeps (Cast, set snapshots, their own cards), biggest first, with
// its versions, its size (its file and the input/ pictures it names) and the takes that pin it. Nothing is pruned by
// itself: archive (out of pickers and search, still resolving, one press back), export (a zip in output/snap_exports
// with a manifest, optionally with the takes that pin it) and delete (a version or the record, saying first what it
// touches and offering to export) are the person's choice.
// SNAP-R62 clean-up is the person's choice · SNAP-R60 versions kept · SNAP-R58 every row shown · see docs/SNAP_RULES.md
import * as W from "./world.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const KIND = { cast: "Cast", card: "Card", set_snapshot: "Set" };
const mb = (b) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const when = (at) => (at ? new Date(at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "");

export async function openWorld(host, { say, onChange }) {
  host.querySelector(".snap-world-sheet")?.remove();
  const status = h("div", { className: "snap-quiet", role: "status" }), list = h("div", { className: "snap-world-list" }), totals = h("span", { className: "snap-quiet" });
  const exportsBox = h("div", { className: "snap-world-exports" });
  let data = null, open = new Set(), asking = null;
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const act = (fn) => async () => { try { const said = await fn(); if (said) { status.textContent = said; say?.(said); } await refresh(); onChange?.(); } catch (err) { status.textContent = err.message; } };
  const exportOne = (row, withTakes) => async () => { const r = await W.exportRecords([row.ref], { with_takes: withTakes }); return `Exported ${row.name} to output/${r.subfolder}/${r.file} (${mb(r.bytes)}, ${r.manifest.files.length} media file${r.manifest.files.length === 1 ? "" : "s"}${withTakes ? `, ${r.manifest.takes.length} take${r.manifest.takes.length === 1 ? "" : "s"}` : ""})`; };
  async function refresh() {
    data = await W.sizes();
    data.records.sort((a, b) => b.bytes + b.media_bytes - (a.bytes + a.media_bytes));
    totals.textContent = `${data.records.length} record${data.records.length === 1 ? "" : "s"} · ${mb(data.total_bytes)} with their pictures · takes ${data.takes.count}, ${mb(data.takes.bytes + data.takes.media_bytes)}`;
    draw();
  }
  function confirmRow(row, n) {
    const pinned = n == null ? row.pinned_by : row.versions.find((v) => v.n === n)?.pinned_by ?? [];
    return h("div", { className: "snap-world-confirm", role: "alert" },
      h("p", { textContent: `Delete ${n == null ? `${row.name} and all ${row.versions.length} version${row.versions.length === 1 ? "" : "s"}` : `${row.name} v${n}`}? ${pinned.length ? `${pinned.length} take${pinned.length === 1 ? "" : "s"} pinned ${n == null ? "it" : "this version"}: they still run as they were (they hold what it put in), but they can't be updated to today's version, and get_record can't show this one any more.` : "No take pins it."} Its pictures stay in input/. This can't be undone.` }),
      h("div", { className: "snap-set-actions" },
        h("button", { className: "snap-link", textContent: "Export first", onclick: act(exportOne(row, true)) }),
        h("button", { className: "snap-danger", textContent: "Delete", onclick: act(async () => { asking = null; await W.remove(row.kind, row.id, n); return n == null ? `${row.name} deleted` : `${row.name} v${n} deleted`; }) }),
        h("button", { className: "snap-link", textContent: "Cancel", onclick: () => { asking = null; draw(); } })));
  }
  function draw() {
    list.replaceChildren(...(data.records.length ? data.records.map((row) => {
      const key = row.ref, expanded = open.has(key);
      return h("div", { className: `snap-world-item${row.archived ? " archived" : ""}` },
        h("div", { className: "snap-world-line" },
          h("button", { className: "snap-world-toggle", textContent: expanded ? "▾" : "▸", ariaLabel: expanded ? "hide versions" : "show versions", onclick: () => { expanded ? open.delete(key) : open.add(key); draw(); } }),
          h("span", { className: "snap-world-kind", textContent: KIND[row.kind] ?? row.kind }),
          h("strong", { textContent: row.name, title: row.ref }),
          h("span", { className: "snap-quiet", textContent: `v${row.head} · ${row.versions.length} version${row.versions.length === 1 ? "" : "s"} · ${mb(row.bytes + row.media_bytes)} · pinned by ${row.pinned_by.length} take${row.pinned_by.length === 1 ? "" : "s"}${row.archived ? " · archived" : ""}` }),
          h("span", { className: "snap-spacer" }),
          row.archived ? h("button", { className: "snap-link", textContent: "Restore", onclick: act(async () => { await W.restore(row.kind, row.id); return `${row.name} is back in the Library`; }) })
            : h("button", { className: "snap-link", textContent: "Archive", title: "out of the Library and pickers; takes that pin it still resolve; Restore brings it back", onclick: act(async () => { await W.archive(row.kind, row.id); return `${row.name} archived (Restore brings it back)`; }) }),
          h("button", { className: "snap-link", textContent: "Export", title: "a zip in output/snap_exports: the record, its pictures and the takes that pin it", onclick: act(exportOne(row, true)) }),
          h("button", { className: "snap-link snap-world-del", textContent: "Delete…", onclick: () => { asking = { key }; draw(); } })),
        asking?.key === key && asking.n == null ? confirmRow(row, null) : null,
        expanded ? h("div", { className: "snap-world-versions" }, [...row.versions].reverse().map((v) => [h("div", { className: "snap-world-version" },
          h("strong", { textContent: `v${v.n}${v.n === row.head ? " · newest" : ""}` }), h("span", { className: "snap-quiet", textContent: `${when(v.at)} · ${v.by ?? "person"}${v.note ? ` · ${v.note}` : ""}${v.listed === false ? " · saved when used" : ""} · pinned by ${v.pinned_by.length}` }),
          h("span", { className: "snap-spacer" }), h("button", { className: "snap-link snap-world-del", textContent: "Delete…", onclick: () => { asking = { key, n: v.n }; draw(); } })),
          asking?.key === key && asking.n === v.n ? confirmRow(row, v.n) : null])) : null);
    }) : [h("div", { className: "snap-quiet", textContent: "No records yet: a Cast member, a saved set state or a card of your own lands here." })]));
    exportsBox.replaceChildren(...(data.exports.length ? [h("div", { className: "snap-rail-title", textContent: "Exports here (import brings one back)" }), ...data.exports.map((x) => h("div", { className: "snap-world-version" },
      h("span", { textContent: `${x.type}/${x.subfolder}/${x.file}` }), h("span", { className: "snap-quiet", textContent: mb(x.bytes) }), h("span", { className: "snap-spacer" }),
      h("button", { className: "snap-link", textContent: "Import", title: "records not here are added whole; versions they lack are added; pictures and takes only where nothing is", onclick: act(async () => {
        const r = await W.importExport(x); return `Imported ${x.file}: ${r.records.length} record${r.records.length === 1 ? "" : "s"} added, ${r.merged.length} version${r.merged.length === 1 ? "" : "s"} added, ${r.files.length} file${r.files.length === 1 ? "" : "s"}, ${r.takes.length} take${r.takes.length === 1 ? "" : "s"}${r.conflicts.length ? `; not added: ${r.conflicts.join("; ")}` : ""}`; }) })))] : []));
  }
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-world-sheet", role: "dialog", ariaLabel: "World" },
    h("header", {}, h("strong", { textContent: "World: records and versions" }), totals, h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
    h("div", { className: "snap-world-body" }, h("p", { className: "snap-quiet", textContent: "Every version is kept. Archive, export or delete only when you choose; nothing here is pruned by itself." }), list, exportsBox, status));
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  host.append(sheet);
  await refresh();
  return sheet;
}
