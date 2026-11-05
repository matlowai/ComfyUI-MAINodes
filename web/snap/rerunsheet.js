// The Re-run sheet (U89, Dylan 22:44 + 22:45): one sheet for a take (the viewer's re-take row, a shot's ⋯ in the
// navigator) and for a saved picture or video opened or dropped in Snap (its recipe and the record versions it pinned).
// Each slot rerun.js finds is a row: the record and its version against today's, a pick (as it was, latest, a version,
// another record of its kind; the scene and the Setup say they are not records), and what the pick changes, field by
// field, with the look warning. Re-generate runs exactly what the rerun tool runs (the same function); the seed stays the
// take's unless the person picks a new one, and a pick that changes nothing the prompt holds says so before the press.
// Reuse the motion (a take only) says per swap what it becomes on the take's own video (a recast painted from the new
// Cast's details line and picture, a Change something) or why it can't (a Setup, a shot card: Re-generate does those).
// "Several at once" on a row ticks other records for that slot: one re-run each, as one decision's candidates (U89 batch).
// An opened file keeps Run as it was / Run with today's world / Edit then run (each pinned version opens in its editor).
// A changed reference picture reads "front picture changed" with both pictures and their file names; the tools keep the
// full refs line (SNAP-R58).
// SNAP-R63 re-run swaps any reference · SNAP-R61 as it was, today's world, edited · SNAP-R60 pins · SNAP-R5 nothing changes
// until a press · SNAP-R11 warn, never block · SNAP-R58 agents get every field whole · see docs/SNAP_RULES.md
import { view } from "./castview.js";
import * as R from "./retake.js";
import * as RR from "./rerun.js";
import * as SC from "./scenes.js";
import * as W from "./world.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const option = ([value, text, disabled]) => h("option", { value, textContent: text, disabled: !!disabled });

// what a pick or a newer version changes, as a person reads it: a line per field, except a picture change, which shows
// the two pictures ("front picture changed") in place of the refs line
const named = (f) => f.split("/").pop();
const thumb = (f) => (f ? h("img", { src: view(f), alt: named(f), title: f, loading: "lazy" }) : h("span", { className: "snap-quiet", textContent: "none" }));
function changes({ fields = [], pictures = [] }) {
  const lines = pictures.length ? fields.filter((f) => !f.startsWith("refs ")) : fields;
  if (!lines.length && !pictures.length) return null;
  return h("ul", { className: "snap-world-fields" }, lines.map((f) => h("li", { textContent: f })),
    pictures.map((p) => h("li", { className: "snap-world-pic" }, `${p.role.includes(": ") ? `${p.role.split(": ").pop()} picture` : p.role} ${p.was && p.now ? "changed" : p.now ? "added" : "taken out"}`,
      h("div", { className: "snap-world-pic-pair" }, thumb(p.was), "→", thumb(p.now)), h("div", { textContent: [p.was, p.now].filter(Boolean).map(named).join(" → ") }))));
}

// a slot's picks, as the person reads them
function picks(s) {
  if (s.kind === "scene") return [["pinned", s.name ? `stays in ${s.name}` : "no scene"], ...s.others.map((o) => [o.ref, `${o.name}'s set${o.set ? `: ${o.set}` : " (it has no set)"}`])];
  if (s.kind === "setup") return [["pinned", `${s.name} (as it ran)`], ...s.others.map((o) => [o.ref, o.name])];
  const n = s.n, head = s.head;
  return [["pinned", n ? `as it was (v${n})` : "as it was"], ["latest", head && head !== n ? `latest (v${head})` : "latest (the same version)", !head || head === n],
    ...s.versions.filter((v) => v.n !== n && v.n !== head).map((v) => [`@${v.n}`, `v${v.n}${v.note ? ` · ${v.note}` : ""}`]),
    ...s.others.map((o) => [o.ref, `${o.name} (another ${s.kind === "set_snapshot" ? "set" : s.kind})`])];
}

// `take` (a take record) or `name` (the opened file's name); `edit(ref, n)` opens a pinned version in its editor
export async function openRerunSheet(host, { take, name, say, edit }) {
  for (const s of host.querySelectorAll(".snap-opened-sheet, .snap-world-sheet, .snap-rerun-sheet")) s.remove(); // one sheet at a time: they sit in the same place
  await W.load();
  const subject = take ?? RR.opened(name), file = !take, slots = await RR.slots(subject);
  const moved = new Map((await R.differs(subject.world)).map((m) => [m.ref, m])), chosen = {};
  const status = h("div", { className: "snap-quiet", role: "status" }), route = h("p", { className: "snap-quiet snap-rerun-route" }), motion = h("p", { className: "snap-quiet snap-rerun-route", hidden: file }), cache = h("div", { className: "snap-world-warn", hidden: true });
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const seed = h("select", { className: "snap-rerun-seed", ariaLabel: "seed" }, option(["same", "same seed (closest motion)"]), option(["new", "new seed"]));
  const home = take && R.shotOf(take);
  const land = take ? h("select", { className: "snap-rerun-land", ariaLabel: "where the new take lands" }, [["", home ? `lands in ${SC.shotTitle(home.scene, home.shot)} of ${home.scene.name}` : "lands in a new tab"], ["tab", "lands in a new scratch tab"],
    ...SC.all().flatMap((sc) => sc.shots.filter((x) => x !== home?.shot).map((x) => [JSON.stringify({ scene: sc.id, shot: x.id }), `lands in ${SC.shotTitle(sc, x)} of ${sc.name}`]))].map(option)) : null;
  let editing = false, regen = null, reuse = null;
  const rows = h("div", { className: "snap-world-rows" });
  async function update() {
    const all = RR.combos(chosen), each = await Promise.all(all.map((m) => RR.resolve(subject, m))).catch((err) => { status.textContent = err.message; return [[]]; });
    const asked = each[0], go = asked.filter((s) => !s.keep), many = all.length > 1, texts = (list) => list.filter((s) => !s.keep).map((s) => s.text).join(", ") || "as it was";
    route.textContent = many ? `Re-generate × ${all.length}, one after another, back as candidates to pick from: ${each.map(texts).join(" · ")}. Similar motion, not the same.`
      : `Re-generate: the same recipe${seed.value === "same" ? " and seed" : " with a new seed"}${go.length ? `, with ${go.map((s) => s.text).join(", ")}` : ", as it was"}. Similar motion, not the same.`;
    regen.textContent = file ? "Run with these swaps" : many ? `Re-generate × ${all.length}` : "Re-generate";
    if (reuse) reuse.textContent = many ? `Reuse the motion × ${all.length}` : "Reuse the motion";
    cache.textContent = !file && !many && seed.value === "same" && !asked.some((s) => s.into_run) ? `Nothing the prompt holds changes: ComfyUI would serve take ${take.number}'s own file from its cache. Pick a new seed for a fresh render.` : "";
    const above = !file && RR.ratingFor(take, each.flat()).above_cap; // a signed-in install's cap: said before the press, the server enforces it
    if (above) cache.textContent = [cache.textContent, above].filter(Boolean).join(" ");
    cache.hidden = !cache.textContent;
    if (file) { regen.disabled = !go.length; return; }
    const ways = await Promise.all(go.map((s) => RR.motionOf(take, s).catch((err) => ({ text: s.text, not_possible: err.message })))), first = ways.find((w) => !w.not_possible);
    const named = (w) => (w.method === "remake_swap" ? `${w.text}: a recast (Viggle Remake), painted from the new Cast's details line${w.picture ? " and picture" : " (it has no picture)"}; its LoRA doesn't reach Remake` : `${w.text}: Change something (Viggle Remake edit)`);
    motion.textContent = !go.length ? "Reuse the motion: pick a swap first; the take's own video stays the motion." : `Reuse the motion: take ${take.number}'s own video, ${[...ways.filter((w) => !w.not_possible).map(named), ...ways.filter((w) => w.not_possible).map((w) => `${w.text}: not on its own motion (${w.not_possible})`)].join("; ")}.${first ? " 2 painted candidates to pick from, then about 3 min." : ""}`;
    reuse.disabled = !first;
    reuse.title = first ? "paint the swap into the take's frames as candidates; the render waits for your pick" : "none of these swaps can use the take's own motion: Re-generate does them";
  }
  const row = (s) => {
    const others = s.others.length > 0 && !file ? h("details", { className: "snap-rerun-many" }, h("summary", { textContent: "Several at once…" }),
      s.others.map((o) => h("label", {}, h("input", { type: "checkbox", value: o.ref, onchange: () => {
        const ticked = [...others.querySelectorAll("input:checked")].map((x) => x.value);
        if (ticked.length) chosen[s.slot] = ticked; else delete chosen[s.slot];
        pick.disabled = ticked.length > 0; what.replaceChildren(...(ticked.length ? [h("strong", { textContent: `one re-run each: ${ticked.map((r) => s.others.find((o) => o.ref === r).name).join(", ")}` })] : []));
        update();
      } }), ` ${o.name}`))) : null;
    const m = moved.get(s.slot), pick = h("select", { className: "snap-rerun-pick", ariaLabel: `${s.name ?? s.slot}: re-run with` }, picks(s).map(option)), what = h("div", { className: "snap-rerun-what" });
    pick.value = chosen[s.slot] ?? "pinned";
    pick.onchange = async () => {
      if (pick.value === "pinned") delete chosen[s.slot]; else chosen[s.slot] = pick.value;
      const [r] = pick.value === "pinned" ? [] : await RR.resolve(subject, { [s.slot]: pick.value }).catch((err) => [{ text: err.message }]);
      what.replaceChildren(...(r ? [h("strong", { textContent: r.text }), changes(r), r.warning ? h("div", { className: "snap-world-warn", textContent: r.warning }) : null].filter(Boolean) : []));
      update();
    };
    const state = s.not_a_record ? `not a record: ${s.not_a_record}` : !s.n ? "a pack card" : m?.missing ? "not in your records (the recipe still holds what it put in)" : m ? `today: v${m.now}${m.archived ? " (archived)" : ""}` : "today: the same version";
    const editable = (s.kind === "cast" || s.kind === "set_snapshot") && s.n && !s.missing;
    return h("div", { className: `snap-world-row${m ? (m.missing ? " missing" : " moved") : ""}` },
      h("strong", { textContent: `${s.kind === "scene" ? "Scene: " : s.kind === "setup" ? "Setup: " : ""}${m?.name ?? s.name ?? (s.kind === "scene" ? "none (this take isn't in a scene)" : s.slot)}${s.n ? ` v${s.n}` : ""}` }), h("span", { className: "snap-quiet", textContent: state }),
      m ? changes(m) : null,
      m?.warning ? h("div", { className: "snap-world-warn", textContent: m.warning }) : null,
      pick, others, what,
      editing && editable ? h("button", { className: "snap-link", textContent: `Edit v${s.n}`, title: "open this version: saving makes a new version, and Save and use puts it into this recipe", onclick: () => edit(s.slot, s.n) }) : null);
  };
  const draw = () => rows.replaceChildren(...slots.filter((s) => !file || s.kind !== "scene").map(row)); // an opened file belongs to no scene
  const go = (opts) => async () => {
    try { const r = await RR.rerun(subject, { swaps: chosen, seed: seed.value, ...(land?.value ? { land: land.value === "tab" ? "tab" : JSON.parse(land.value) } : {}), ...opts }); say?.([r.said, r.cache_hit].filter(Boolean).join(" · ")); close(); } catch (err) { status.textContent = err.message; }
  };
  const today = Object.fromEntries([...moved.values()].filter((m) => !m.missing).map((m) => [m.ref, "latest"]));
  const runFile = (swaps) => async () => { try { const r = await RR.rerun(subject, { swaps }); say?.(r.said); close(); } catch (err) { status.textContent = err.message; } };
  const anyMoved = Object.keys(today).length > 0, anyMissing = [...moved.values()].some((m) => m.missing), pins = Object.keys(subject.world ?? {}).length;
  reuse = take ? h("button", { className: "snap-link", textContent: "Reuse the motion", disabled: true, onclick: async () => { try { const r = await RR.rerun(take, { swaps: chosen, route: "reuse_motion" }); say?.(r.said); close(); } catch (err) { status.textContent = err.message; } } }) : null;
  regen = h("button", { className: file ? "snap-link" : "snap-primary", textContent: file ? "Run with these swaps" : "Re-generate", title: "the recipe again with the picks above (the rerun tool does the same)", onclick: go({}) });
  const sheet = h("div", { className: `snap-sheet snap-setup-sheet snap-rerun-sheet${file ? " snap-opened-sheet" : ""}`, role: "dialog", ariaLabel: file ? "Opened file" : `Re-run take ${take.number}` },
    h("header", {}, h("strong", { textContent: file ? `${name}: made with ${pins} record${pins === 1 ? "" : "s"}` : `Re-run take ${take.number} with swaps` }), h("span", { className: "snap-spacer" }),
      h("button", { className: "snap-x", textContent: "×", title: file ? "close (Esc): the workflow stays open as it is" : "close (Esc): nothing runs", onclick: close })),
    h("div", { className: "snap-opened-body" },
      h("p", { className: "snap-quiet", textContent: file ? (anyMoved ? "Some of what this file used has newer versions. Run it exactly as it was, with today's versions, or open the old ones to change first." : anyMissing ? "Some of what this file used isn't in your records any more; it still runs as the file holds it." : "Everything this file used is still at the same version: it runs as it was.")
        : "Swap any of what this take used: another version, another character or set, another scene's set, another setup. Re-generate rebuilds the recipe with your picks." }),
      rows, route, cache, motion,
      file ? h("div", { className: "snap-set-actions" },
        h("button", { className: "snap-primary", textContent: "Run as it was", title: "the workflow as the file holds it, seed included", onclick: runFile({}) }),
        h("button", { className: "snap-link", textContent: "Run with today's world", disabled: !anyMoved, title: anyMoved ? "each record with a newer version is updated in the recipe first" : "nothing has a newer version", onclick: runFile(today) }),
        h("button", { className: "snap-link", textContent: "Edit then run", title: "open the versions this file used, change them, then run", onclick: () => { editing = !editing; draw(); } })) : null,
      h("div", { className: "snap-rerun-actions" }, land, seed, regen, reuse,
        h("button", { className: "snap-link", textContent: "Preview the recipe", title: "open the recipe with the picks applied; nothing is queued", onclick: go({ queue: false }) })),
      status));
  seed.onchange = update;
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  draw(); update();
  host.append(sheet);
  sheet.querySelector(".snap-primary")?.focus();
  return sheet;
}
