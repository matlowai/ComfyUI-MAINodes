// Dailies: the takes strip under the chain, the take viewer (play, scrub, keep / reject, rank, notes pinned to a moment
// and optionally a region: "where it went wrong / right"), and blind A/B compare. What people do here is the data a
// judge model learns from (takes.js keeps it; tools/snap_dataset.py exports it). A take the chain no longer makes shows
// "stale: Render.steps changed" (U31); checked after graph edits, written into the cards in place. A take that re-rendered
// its own reference picture's view says "copied its reference view" once its copy check has run (U48: DINOv3's room
// score can't tell a copy of the reference's view from a new view of the same room). In the viewer, "Use as input" puts
// the frame at the playhead on the First frame or References brick (U32), and "Edit this take" runs a method of the edit
// slot (U54: night version): its candidates show in the viewer, previewed over the take, and an applied one renders as a
// new take whose card names its parent.
// In a scene tab the strip is the open shot's takes as a tree (U59): versions (a night version, a continued take) sit
// in a bracket after the take they came from, the shot's active take wears a star, and ☆ makes another take the
// active one; the viewer's title is where the take sits in the scene (Platform › Shot 1 › Take 2 › Night version).
// SNAP-R7 pointer-down lists · SNAP-R17 blind pairs from agents are judged by the person · SNAP-R20 the lock on private
// takes (SNAP-R27: by the current rules) · SNAP-R21 copies flagged · SNAP-R23 candidates · SNAP-R24 scenes own the work ·
// SNAP-R36 quiet sound: a note and two actions, never applied by itself · see docs/SNAP_RULES.md
import * as T from "./takes.js";
import * as PL from "./plates.js";
import * as C from "./candidates.js";
import * as ED from "./edits.js";
import * as S from "./slots.js";
import * as P from "./proposals.js";
import * as SC from "./scenes.js";
import { candidatesEl } from "./candidateview.js";
import { url as mediaUrl } from "./checks.js";

// SNAP-R39: a take's rating, from how it was made (its prompt's text, the files and takes it used); the person's pick wins
function ratingRow(t) {
  const why = t.rating_set ? "You rated it." : t.rating_why?.length ? `From how it was made: ${t.rating_why.join("; ")}.` : t.rating ? "From how it was made: nothing in its prompt or files rates it higher." : "Made before takes were rated.";
  const pick = h("select", { ariaLabel: "rating", title: "Change it: your rating wins over the one it was made with",
    onchange: async (e) => { await T.setRating(t, e.target.value); note.textContent = "You rated it."; } },
    T.ratingOf(t) ? null : h("option", { value: "", textContent: "unrated", selected: true, disabled: true }),
    T.RATINGS.map((r) => h("option", { value: r, textContent: T.RATING_SHOWN[r], selected: T.ratingOf(t) === r })));
  const note = h("span", { className: "snap-quiet", textContent: why });
  return h("div", { className: "snap-take-ratingrow" }, h("label", {}, h("span", { textContent: "Rated " }), pick), note);
}

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const clock = (t) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, "0")}`;
const ago = (ms) => { const s = (Date.now() - ms) / 1000; return s < 90 ? "just now" : s < 5400 ? `${Math.round(s / 60)} min ago` : s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} d ago`; };
const FPS = 24;

function mediaEl(m, { big, muted = true } = {}) {
  if (!m) return h("div", { className: "snap-take-none", textContent: "no picture" });
  if (m.kind === "video") return h("video", { src: T.url(m), muted, loop: !big, playsInline: true, preload: big ? "auto" : "metadata", controls: !!big });
  if (m.kind === "image") return h("img", { src: T.url(m), alt: "", loading: "lazy" });
  return h("audio", { src: T.url(m), controls: true });
}

// `onHover(take | null)`: a take card is hovered (the chain previews it in its own output slot); `onRunFrom(take)`: Run
// from here (a new tab with the take's settings, ready to run)
export function createDailies({ host, say, onRestore, onHover, onRunFrom, onReprompt }) {
  const picked = new Set(); // takes ticked for compare
  const strip = h("div", { className: "snap-takes-strip" });
  const count = h("span", { className: "snap-quiet" }), heading = h("strong", { textContent: "Takes" });
  const compareBtn = h("button", { className: "snap-link snap-quiet-btn", textContent: "Compare", disabled: true, onclick: () => compare([...picked]) });
  // blind pairs an agent set up for the person (setup_ab): one click opens the next, blind
  const waiting = h("button", { className: "snap-link snap-ab-waiting", hidden: true, onclick: async () => { const p = (await waitingHere())[0]; if (p) compare([p.a, p.b], { forced: true }); } });
  const el = h("section", { className: "snap-takes" },
    h("header", {}, heading, count, waiting, h("span", { className: "snap-spacer" }),
      h("span", { className: "snap-quiet snap-takes-hint", textContent: "drag to rank · tick two to compare" }), compareBtn),
    strip);
  T.onChange(() => render());
  SC.onChange(() => render());
  T.load().then(render, () => {});
  // the blind pairs waiting in this workflow (a pair set up in another workflow waits there)
  const waitingHere = async () => (await T.pending()).filter((p) => T.get(p.a)?.group === T.groupOf() && T.get(p.b)?.group === T.groupOf());

  // where a take sits in the open shot's scene, or null outside one: [scene, shot, take, version...]
  const crumbs = (t) => { const here = SC.current(), p = here && SC.path(here.shot, t.id); return p?.length ? [here.scene.name, SC.shotTitle(here.scene, here.shot), ...p.map((id) => SC.label(T.get(id)))] : null; };
  // the strip follows the open workflow and the shot it is in: a tab or shot switch re-renders it (refresh runs on every
  // view render); a shot's copy of a workflow keeps the workflow's id, so the shot counts too
  const shownNow = () => `${T.groupOf()}|${SC.current()?.shot.id ?? ""}`;
  let shownGroup = null;
  async function render() {
    shownGroup = shownNow();
    const here = SC.current(), group = here ? SC.takesOf(here.shot).map((e) => T.get(e.take)).filter(Boolean) : T.inGroup(), order = await T.ranking();
    const ranked = order.map(T.get).filter((t) => t && group.includes(t));
    const rest = group.filter((t) => !order.includes(t.id)).sort((a, b) => b.created - a.created);
    count.textContent = group.length ? `${group.length} · ${ranked.length} ranked · ${group.filter((t) => t.verdict === "keep").length} kept` : "";
    for (const id of picked) if (!T.get(id)) picked.delete(id);
    compareBtn.disabled = picked.size !== 2;
    const ab = await waitingHere();
    waiting.hidden = !ab.length;
    waiting.textContent = `${ab.length} blind pair${ab.length === 1 ? "" : "s"} waiting`;
    el.classList.toggle("empty", !group.length);
    heading.textContent = here ? `${SC.shotTitle(here.scene, here.shot)} · takes` : "Takes";
    refresh();
    // in a scene the versions follow the take they came from, in a bracket (nested again for a version of a version)
    const tree = here ? SC.tree(here.shot) : [], kids = new Map(), walk = (list) => { for (const e of list) { kids.set(e.take, e.children); walk(e.children); } };
    walk(tree);
    const family = (t) => { const v = (kids.get(t.id) ?? []).map((e) => T.get(e.take)).filter(Boolean);
      return v.length ? h("div", { className: "snap-take-family" }, card(t, ranked.indexOf(t), here), h("div", { className: "snap-take-versions" }, v.map(family))) : card(t, ranked.indexOf(t), here); };
    const roots = [...ranked, ...rest].filter((t) => !here || tree.some((e) => e.take === t.id));
    strip.replaceChildren(...(group.length ? roots.map(family) : [h("div", { className: "snap-quiet", textContent: here ? `Each run of ${SC.shotTitle(here.scene, here.shot)} lands here as a take; versions of a take (a night version, a continue) nest under it.` : "Each run lands here as a take: rank it, keep or reject it, and note where it went wrong or right." })]));
  }

  // stale chips: one live prompt per check, compared with every take in the strip; a newer check wins
  let checking = 0, timer = null;
  const refresh = () => { if (shownGroup !== null && shownGroup !== shownNow()) return render(); clearTimeout(timer); timer = setTimeout(markStale, 250); };
  async function markStale() {
    const mine = ++checking, cards = [...strip.querySelectorAll(".snap-take")];
    if (!cards.length) return;
    const now = await T.live(), found = await Promise.all(cards.map((c) => T.stale(T.get(c.dataset.take), now)));
    if (mine !== checking) return;
    cards.forEach((c, i) => {
      const chip = c.querySelector(".snap-take-stale"), list = found[i]?.changed ?? [];
      chip.hidden = !list.length;
      chip.textContent = list.length ? `stale: ${list[0]}${list[0].endsWith(" rewired") || / (added|removed|swapped)$/.test(list[0]) ? "" : " changed"}${list.length > 1 ? ` +${list.length - 1}` : ""}` : "";
      chip.title = list.length ? `The chain no longer makes this take:\n${list.join("\n")}` : "";
    });
  }

  // `here` (the open shot in its scene): the card says what it is in the shot's tree, and ☆ makes it the active take
  function card(t, r, here) {
    const m = t.media[0], active = here?.shot.active === t.id, version = here && t.parent && SC.path(here.shot, t.id).length > 1;
    const star = here ? h("button", { className: `snap-take-star${active ? " on" : ""}`, textContent: active ? "★ active" : "☆", title: active ? `the take that stands for ${SC.shotTitle(here.scene, here.shot)}` : `make this ${SC.shotTitle(here.scene, here.shot)}'s active take`,
      onclick: async (e) => { e.stopPropagation(); if (active) return; try { await SC.setActive(here.scene.id, here.shot.id, t.id); say(`${crumbs(t).slice(2).join(" › ")} is now ${SC.shotTitle(here.scene, here.shot)}'s take`); } catch (err) { say(err.message, true); } } }) : null;
    const tick = h("input", { type: "checkbox", className: "snap-take-pick", checked: picked.has(t.id), title: "tick two to compare",
      onclick: (e) => { e.stopPropagation(); e.target.checked ? picked.add(t.id) : picked.delete(t.id); if (picked.size > 2) picked.delete([...picked][0]); render(); } });
    const c = h("figure", { className: `snap-take ${t.status}${t.verdict ? ` ${t.verdict}` : ""}${active ? " active" : ""}${version ? " version" : ""}`, draggable: true, tabIndex: 0, title: t.text.slice(0, 300), onclick: () => view(t) },
      h("div", { className: "snap-take-media" }, mediaEl(m), tick,
        h("span", { className: "snap-take-rank", textContent: r >= 0 ? `#${r + 1}` : "" }),
        t.verdict ? h("span", { className: "snap-take-verdict", textContent: t.verdict === "keep" ? "✓" : "✗" }) : null,
        t.prior ? h("span", { className: "snap-take-prior", textContent: "prior", title: "in the Library as a prior" }) : null),
      h("figcaption", {}, star, h("b", { textContent: version ? SC.label(t) : `Take ${t.number}` }), version ? h("span", { className: "snap-quiet snap-take-of", textContent: `⟵ take ${T.get(t.parent.take)?.number ?? "?"}` }) : t.seed != null ? ` · seed ${t.seed}` : "", t.status !== "success" ? h("em", { textContent: ` · ${t.status}` }) : "",
        h("span", { className: "snap-take-stale", hidden: true }),
        t.copy?.copied ? h("span", { className: "snap-take-copy", textContent: `copied its reference view ${Math.max(...t.copy.against.map((a) => a.last)).toFixed(2)}`,
          title: `This take ends on the view of its reference picture (last frame's copy score at or above ${t.copy.threshold}): right when that picture is this camera's own plate, wrong when it shows another camera's view.\n${t.copy.against.map((a) => `${a.image}: ${a.frames.join(" → ")}`).join("\n")}` }) : null,
        t.parent && !version ? h("span", { className: "snap-take-parent", textContent: `↳ ${t.parent.options?.time ?? t.parent.method.split("/").pop()} of take ${T.get(t.parent.take)?.number ?? "?"}`, title: `made from ${t.parent.take} by ${t.parent.method}` }) : null,
        t.metadata_kept ? h("span", { className: "snap-take-kept", textContent: "metadata kept", title: `Save metadata was off, but ${t.metadata_kept.join("; ")}: those files hold the prompt and workflow` }) : null,
        T.quiet(t) ? h("span", { className: "snap-take-quiet", textContent: "🔈 sound is quiet", title: `The sound averages ${t.sound.mean_db} dB (a take usually sits between -27 and -41 dB). Open the take to make it louder or re-prompt` }) : null,
        ["mature", "adult"].includes(T.ratingOf(t)) ? h("span", { className: "snap-take-rating", textContent: T.RATING_SHOWN[T.ratingOf(t)],
          title: t.rating_set ? "rated by you" : `rated from how it was made: ${(t.rating_why ?? []).join("; ")}` }) : null,
        T.locked(t) ? h("span", { className: "snap-take-lock", textContent: "🔒 private", title: `Private take (it loads a private file or has a Cast LoRA row on): exports leave it out${t.metadata === false ? "; its files were saved without the recipe inside" : ""}` }) : null,
        h("span", { className: "snap-quiet", textContent: `${t.notes.length ? `✎ ${t.notes.length} · ` : ""}${ago(t.created)}` })));
    c.dataset.take = t.id;
    const v = c.querySelector("video");
    c.addEventListener("pointerenter", () => { v?.play().catch(() => {}); onHover?.(t); });
    c.addEventListener("pointerleave", () => { if (v) { v.pause(); v.currentTime = 0; } onHover?.(null); });
    c.addEventListener("keydown", (e) => { if (e.key === "Enter") view(t); });
    // rank by dragging: dropped on a ranked take it goes just before it, on an unranked one to the end of the ranking
    c.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/snap-take", t.id); e.dataTransfer.effectAllowed = "move"; c.classList.add("dragging"); });
    c.addEventListener("dragend", () => c.classList.remove("dragging"));
    c.addEventListener("dragover", (e) => { if (e.dataTransfer.types.includes("text/snap-take")) { e.preventDefault(); e.stopPropagation(); c.classList.add("drop-before"); } });
    c.addEventListener("dragleave", () => c.classList.remove("drop-before"));
    c.addEventListener("drop", async (e) => {
      const id = e.dataTransfer.getData("text/snap-take");
      if (!id) return;
      e.preventDefault(); e.stopPropagation(); c.classList.remove("drop-before");
      if (id === t.id) return;
      const order = (await T.ranking()).filter((x) => x !== id);
      await T.rank(id, order.includes(t.id) ? order.indexOf(t.id) : order.length);
    });
    return c;
  }

  // ---- the take viewer -------------------------------------------------------------------------------------------
  function view(t) {
    const close = () => { sheet.remove(); document.removeEventListener("keydown", keys, true); host.focus({ preventScroll: true }); };
    const m = t.media.find((x) => x.kind === "video") ?? t.media[0];
    const player = mediaEl(m, { big: true, muted: false });
    const isVideo = player.tagName === "VIDEO";
    const overlay = h("canvas", { className: "snap-take-overlay" });
    // a candidate previewed in place: its picture over the take, at its own frame (nothing is edited)
    const previewImg = h("img", { className: "snap-take-preview", alt: "", hidden: true }), previewTag = h("span", { className: "snap-take-preview-tag", hidden: true });
    const stage = h("div", { className: "snap-take-stage" }, player, overlay, previewImg, previewTag);
    const markers = h("div", { className: "snap-take-markers" });
    const now = () => (isVideo ? player.currentTime : 0);

    // a region is drawn on the paused picture: drag a box (normalized to the frame, so it survives any display size)
    let region = null, drawing = null, marking = false;
    const fit = () => { // the picture's box inside the stage (object-fit: contain)
      const r = stage.getBoundingClientRect(), w = player.videoWidth || player.naturalWidth || r.width, hgt = player.videoHeight || player.naturalHeight || r.height;
      const k = Math.min(r.width / w, r.height / hgt);
      return { x: (r.width - w * k) / 2, y: (r.height - hgt * k) / 2, w: w * k, h: hgt * k, r };
    };
    const paint = (box, color = "#f0b445") => {
      const f = fit();
      overlay.width = f.r.width; overlay.height = f.r.height;
      const g = overlay.getContext("2d");
      g.clearRect(0, 0, overlay.width, overlay.height);
      if (!box) return;
      g.strokeStyle = color; g.lineWidth = 2; g.setLineDash([6, 4]);
      g.strokeRect(f.x + box[0] * f.w, f.y + box[1] * f.h, box[2] * f.w, box[3] * f.h);
    };
    overlay.addEventListener("pointerdown", (e) => {
      if (!marking) return;
      if (isVideo) player.pause();
      const f = fit(), at = (ev) => [Math.min(1, Math.max(0, (ev.clientX - f.r.left - f.x) / f.w)), Math.min(1, Math.max(0, (ev.clientY - f.r.top - f.y) / f.h))];
      drawing = at(e);
      overlay.setPointerCapture(e.pointerId);
      const move = (ev) => { const [x, y] = at(ev); region = [Math.min(x, drawing[0]), Math.min(y, drawing[1]), Math.abs(x - drawing[0]), Math.abs(y - drawing[1])]; paint(region); };
      overlay.onpointermove = move;
      overlay.onpointerup = () => { overlay.onpointermove = null; drawing = null; if (region && region[2] * region[3] < 0.0004) region = null; markBtn.classList.remove("on"); marking = false; overlay.classList.remove("marking"); regionLine(); };
    });

    // verdict, rank, prior
    const verdict = (v) => h("button", { className: `snap-verdict ${v}${t.verdict === v ? " on" : ""}`, textContent: v === "keep" ? "✓ Keep" : "✗ Reject",
      onclick: async () => { t.verdict = t.verdict === v ? null : v; await T.save(t); refresh(); } });
    const rankLine = h("div", { className: "snap-take-rankline" });
    async function rankRow() {
      const order = (await T.ranking()).filter((id) => T.get(id)?.group === t.group), i = order.indexOf(t.id);
      rankLine.replaceChildren(...h("div", {}, h("span", { textContent: i >= 0 ? `Rank ${i + 1} of ${order.length}` : "Not ranked" }),
        i >= 0 ? h("button", { className: "snap-link snap-quiet-btn", textContent: "↑", title: "rank higher", disabled: i === 0, onclick: async () => { await T.rank(t.id, i - 1); rankRow(); } }) : null,
        i >= 0 ? h("button", { className: "snap-link snap-quiet-btn", textContent: "↓", title: "rank lower", disabled: i === order.length - 1, onclick: async () => { await T.rank(t.id, i + 1); rankRow(); } }) : null,
        h("button", { className: "snap-link snap-quiet-btn", textContent: i >= 0 ? "Unrank" : "Rank it last", onclick: async () => { await T.rank(t.id, i >= 0 ? null : order.length); rankRow(); } })).childNodes); // h() drops the nulls
    }

    // notes: what went wrong or right, at this moment (and region), with tags and words
    let sentiment = "wrong";
    const chosen = new Set();
    const tagBox = h("div", { className: "snap-tags" });
    const sentimentSeg = h("div", { className: "snap-seg snap-sentiment" });
    const words = h("textarea", { className: "snap-note-input", rows: 2, placeholder: "What exactly? (e.g. her left hand melts into the rail as she turns)" });
    const at = h("span", { className: "snap-quiet" });
    const regionText = h("span", { className: "snap-quiet" });
    const markBtn = h("button", { className: "snap-link snap-quiet-btn", textContent: "▭ Mark region", title: "drag a box on the picture",
      onclick: () => { marking = !marking; markBtn.classList.toggle("on", marking); overlay.classList.toggle("marking", marking); if (isVideo && marking) player.pause(); } });
    const regionLine = () => regionText.replaceChildren(region ? "region marked · " : "", region ? h("button", { className: "snap-link snap-quiet-btn", textContent: "clear", onclick: () => { region = null; paint(null); regionLine(); } }) : "");
    function tags() {
      sentimentSeg.replaceChildren(...["wrong", "right"].map((s) => h("button", { className: `${sentiment === s ? "on" : ""} ${s}`, textContent: s === "wrong" ? "Went wrong" : "Went right", onclick: () => { sentiment = s; chosen.clear(); tags(); } })));
      tagBox.replaceChildren(...T.TAGS[sentiment].map((x) => h("button", { className: `snap-tag ${sentiment}${chosen.has(x) ? " on" : ""}`, textContent: x, onclick: () => { chosen.has(x) ? chosen.delete(x) : chosen.add(x); tags(); } })));
    }
    const add = async () => {
      if (!words.value.trim() && !chosen.size) return say("Add a tag or a few words first", true);
      await T.note(t, { t: Math.round(now() * 1000) / 1000, region, sentiment, tags: [...chosen], text: words.value.trim() });
      words.value = ""; chosen.clear(); region = null; paint(null); regionLine(); tags(); refresh();
    };
    words.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); e.stopPropagation(); add(); } });
    const list = h("ol", { className: "snap-take-notes" });

    function refresh() {
      list.replaceChildren(...t.notes.slice().sort((a, b) => a.t - b.t).map((n) => h("li", { className: n.sentiment },
        h("button", { className: "snap-link snap-quiet-btn", textContent: clock(n.t), title: "go to this moment", onclick: () => { if (isVideo) { player.pause(); player.currentTime = n.t; } paint(n.region, n.sentiment === "right" ? "#57c785" : "#f0b445"); } }),
        n.tags.map((x) => h("span", { className: `snap-tag ${n.sentiment} on`, textContent: x })), h("span", { textContent: ` ${n.text}` }), n.region ? h("em", { className: "snap-quiet", textContent: " ▭" }) : null,
        n.by !== "person" ? h("span", { className: "snap-agent", textContent: n.by }) : null)));
      markers.replaceChildren(...(isVideo && player.duration ? t.notes.map((n) => h("i", { className: n.sentiment, style: `left:${(100 * n.t) / player.duration}%`, title: `${clock(n.t)} ${n.tags.join(", ")} ${n.text}` })) : []));
      verdicts.replaceChildren(verdict("keep"), verdict("reject"));
      priorBtn.textContent = t.prior ? "★ In the Library as a prior" : "☆ Keep as a prior";
    }
    const verdicts = h("div", { className: "snap-verdicts" });
    const priorBtn = h("button", { className: "snap-link", onclick: async () => { t.prior = !t.prior; if (t.prior && !t.verdict) t.verdict = "keep"; await T.save(t); refresh(); say(t.prior ? "Kept as a prior: it's in the Library under Runs" : "Removed from the Library's priors"); } });
    if (isVideo) {
      player.addEventListener("timeupdate", () => { at.textContent = `at ${clock(player.currentTime)} · frame ${Math.round(player.currentTime * FPS)}`; });
      player.addEventListener("loadedmetadata", refresh);
    }
    at.textContent = isVideo ? "at 0:00.00" : "on the picture";

    const prev = T.inGroup(t.group).filter((x) => x.created < t.created).at(-1);
    const changes = prev ? T.delta(prev, t) : [];
    // the copy check (Ref2V takes): did the take re-render its reference picture's view? The person's click runs it
    const refs = PL.referencePictures(t.prompt), copyLine = h("div", { className: "snap-take-copyline" });
    const copyRow = () => {
      const c = t.copy, said = !c ? "not checked yet" : c.pending ? "checking…" : c.error ? `check failed: ${c.error}`
        : `${c.copied ? "copied its reference view" : "its own view"} (frames ${c.against.map((a) => a.frames.join(" → ")).join("; ")}; ${c.copied ? "≥" : "<"} ${c.threshold} at the end)`;
      copyLine.replaceChildren(...h("div", {}, h("span", { className: c?.copied ? "snap-take-copy" : "snap-quiet", textContent: `Copy check: ${said}` }),
        h("button", { className: "snap-link snap-quiet-btn", textContent: c && !c.pending ? "Check again" : "Check copies", disabled: !!c?.pending, title: "score every frame against the take's reference pictures (a few seconds on the GPU)",
          onclick: async () => { try { await PL.checkTake(t, "person"); copyRow(); } catch (err) { say(err.message, true); } } })).childNodes);
    };
    if (refs.length) { copyRow(); T.onChange(() => { if (copyLine.isConnected) copyRow(); }); }

    // SNAP-R36: a quiet take says so and offers two ways out; neither runs unless the person presses it
    const quietRow = T.quiet(t) ? h("div", { className: "snap-take-quietrow" },
      h("div", {}, h("strong", { textContent: "🔈 Sound is quiet" }), h("span", { className: "snap-quiet", textContent: ` ${t.sound.mean_db} dB on average (a take usually sits between -27 and -41 dB). A soundscape of only soft ambience renders near-silent.` })),
      h("div", { className: "snap-set-actions" },
        h("button", { className: "snap-link", textContent: "Make it louder", title: "a new version of this take with its sound normalised to -23 LUFS (EBU R128, true peak -2 dB); the picture is copied as it is",
          onclick: async (e) => { e.currentTarget.disabled = true; try { await ED.louder(t); say(`Making take ${t.number} louder: a new version lands in Takes`); } catch (err) { say(err.message, true); e.currentTarget.disabled = false; } } }),
        h("button", { className: "snap-link snap-quiet-btn", textContent: "Re-prompt with sound events", title: "open the Render's prompt and say how to name the sounds the action makes",
          onclick: () => { close(); onReprompt?.(t); } }))) : null;

    // Use as input (U32): the frame at the playhead goes on the First frame or into References (one undo step)
    const frameNow = () => (isVideo ? player.currentTime : "last");
    const use = (as) => async () => { try { say((await T.use(t, { as, t: frameNow() })).said); onRestore?.(); } catch (err) { say(err.message, true); } };
    const useRow = h("div", { className: "snap-set-actions" }, h("span", { className: "snap-quiet", textContent: "Use this frame as" }),
      h("button", { className: "snap-link", textContent: "First frame", title: "the frame at the playhead becomes FL2V's start picture", onclick: use("first_frame") }),
      h("button", { className: "snap-link", textContent: "Reference", title: "the frame at the playhead goes into References as a picture", onclick: use("reference") }));

    // Edit this take (U54): a method of the edit slot makes anchor candidates; the person applies one to render it
    const editBox = h("div", { className: "snap-take-edits" }), editNote = h("div", { className: "snap-quiet", role: "status" });
    const methodPick = h("select", { ariaLabel: "edit method" }), timePick = h("select", { ariaLabel: "time of day" });
    const editBtn = h("button", { className: "snap-primary", textContent: "Make 2 candidates", onclick: async () => {
      editBtn.disabled = true;
      try { const r = await ED.start(t, methodPick.value, { time: timePick.value }); editNote.textContent = `Editing frames 0 and ${ED.clip(t).mid}: ${r.candidates.length} candidates (about ${r.seconds_each} s each). Apply one to render it over the take`; } catch (err) { editNote.textContent = err.message; }
      editBtn.disabled = false;
    } });
    S.load().then(() => {
      const list = S.list("edit");
      methodPick.replaceChildren(...list.map((m) => h("option", { value: m.id, textContent: m.title })));
      const times = () => { const m = list.find((x) => x.id === methodPick.value); timePick.replaceChildren(...Object.keys(m?.options?.time ?? {}).map((k) => h("option", { value: k, textContent: k }))); timePick.hidden = !timePick.options.length;
        editBtn.disabled = m?.install_state !== "ready"; editBtn.title = m?.install_state === "ready" ? m.guidance?.line ?? "" : m?.install_state ?? ""; };
      methodPick.onchange = times; times();
    }, (err) => { editNote.textContent = `Edit methods unavailable: ${err.message}`; });
    let editSig = "", pressed = false;
    editBox.addEventListener("pointerdown", () => { pressed = true; });
    editBox.addEventListener("pointerup", () => { pressed = false; setTimeout(edits, 0); });
    function edits() {
      const mine = C.all().filter((d) => d.kind === "edit" && d.target === t.id && d.status !== "closed");
      const sig = JSON.stringify([mine.map((d) => [d.id, d.status, d.applied, d.candidates.map((c) => [c.state, c.notes])]), P.pending().map((p) => p.id), mine.map((d) => ED.result(d)?.id)]);
      if (sig === editSig || pressed || !editBox.isConnected && editSig) return;
      editSig = sig;
      editBox.replaceChildren(...mine.map((d) => {
        const made = ED.result(d);
        const older = d.candidates.some((c) => c.notes.identity && !c.notes.identity.error && !("face_low" in c.notes.identity));
        const again = older ? h("button", { className: "snap-link snap-quiet-btn", textContent: "Check identity again", title: "face and hair notes for these candidates: a few seconds of detection, nothing renders",
          onclick: (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = "checking…"; ED.recheck(d.id).then(() => say(`${d.title}: identity notes updated`), (err) => say(err.message, true)); } }) : null;
        return h("div", { className: "snap-set-candrow" }, h("div", { className: "snap-rail-title" }, d.title, again), candidatesEl(d, { say, crops: true }),
          d.applied ? h("div", { className: "snap-quiet" }, made ? h("button", { className: "snap-link", textContent: `→ Take ${made.number} (${made.status})`, onclick: () => { close(); view(made); } }) : "rendering the take with H3 Ripple…") : null);
      }));
    }
    // hovering a candidate shows it over the take at its frame; hovering one of its pictures shows that one
    let hoverPic = 0;
    editBox.addEventListener("pointerover", (e) => { const img = e.target.closest(".snap-cand-pics img"); if (img) { hoverPic = [...img.parentNode.children].indexOf(img); showPreview(C.previewed()); } });
    function showPreview(shown) {
      const d = shown && C.get(shown.decision), c = d?.target === t.id ? C.candidate(d, shown.candidate) : null, pic = c?.pictures[Math.min(hoverPic, c.pictures.length - 1)];
      previewImg.hidden = previewTag.hidden = !pic;
      if (!pic) return;
      previewImg.src = mediaUrl(pic.media);
      previewTag.textContent = `preview: ${c.id}, ${pic.label} edited (nothing applied)`;
      if (isVideo) { player.pause(); player.currentTime = pic.frame / FPS; }
    }
    C.onPreview((shown) => { if (stage.isConnected) { if (!shown) hoverPic = 0; showPreview(shown); } });
    C.onChange(() => { if (editBox.isConnected) edits(); });
    P.onChange(() => { if (editBox.isConnected) edits(); });
    T.onChange(() => { if (editBox.isConnected) edits(); });
    C.load().then(edits, () => {});
    const keys = (e) => {
      if (e.target.closest("input,textarea,select")) return;
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      else if (isVideo && (e.key === "," || e.key === ".")) { e.preventDefault(); player.pause(); player.currentTime = Math.max(0, player.currentTime + (e.key === "," ? -1 : 1) / FPS); }
      else if (isVideo && e.key === " ") { e.preventDefault(); player.paused ? player.play() : player.pause(); }
    };
    document.addEventListener("keydown", keys, true);

    const where = crumbs(t), here = where && SC.current();
    const activeBtn = here ? h("button", { className: "snap-link", textContent: here.shot.active === t.id ? `★ ${SC.shotTitle(here.scene, here.shot)}'s active take` : `☆ Make it ${SC.shotTitle(here.scene, here.shot)}'s take`, disabled: here.shot.active === t.id,
      onclick: async () => { try { await SC.setActive(here.scene.id, here.shot.id, t.id); activeBtn.textContent = `★ ${SC.shotTitle(here.scene, here.shot)}'s active take`; activeBtn.disabled = true; } catch (err) { say(err.message, true); } } }) : null;
    const sheet = h("div", { className: "snap-sheet snap-take-sheet", role: "dialog", ariaLabel: `Take ${t.number}` },
      h("header", {}, where ? h("nav", { className: "snap-crumbs", ariaLabel: "where this take is" }, where.flatMap((x, i) => [i ? h("i", { textContent: "›" }) : null, h(i === where.length - 1 ? "strong" : "span", { textContent: x })])) : h("strong", { textContent: `Take ${t.number}` }), h("span", { className: "snap-quiet", textContent: `${t.seed != null ? `seed ${t.seed} · ` : ""}${t.seconds} s · ${new Date(t.created).toLocaleString()}${t.status !== "success" ? ` · ${t.status}: ${t.error ?? ""}` : ""}` }),
        h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
      h("div", { className: "snap-take-body" },
        h("div", { className: "snap-take-left" }, stage, markers, isVideo ? h("div", { className: "snap-quiet", textContent: "Space plays · , and . step one frame" }) : null),
        h("aside", {},
          verdicts, rankLine, ratingRow(t), quietRow,
          t.metadata_kept ? h("p", { className: "snap-take-keptline", textContent: `Save metadata was off, but ${t.metadata_kept.join("; ")}: those files still hold the prompt and workflow. Save with Save Image or Save Video to leave them out.` }) : null,
          h("div", { className: "snap-rail-title", textContent: "Note a moment" }), sentimentSeg, tagBox, words,
          h("div", { className: "snap-take-noteline" }, at, markBtn, regionText, h("span", { className: "snap-spacer" }), h("button", { className: "snap-primary", textContent: "Add note", onclick: add })),
          list,
          h("div", { className: "snap-rail-title", textContent: prev ? `Changed since take ${prev.number}` : "First take of this workflow" }),
          changes.length ? h("ul", { className: "snap-take-delta" }, changes.slice(0, 10).map((c) => h("li", {}, h("b", { textContent: `${c.node} · ${c.input}` }), ` ${String(c.from).slice(0, 40)} → ${String(c.to).slice(0, 60)}`))) : prev ? h("div", { className: "snap-quiet", textContent: "same settings" }) : null,
          copyLine,
          t.text ? h("details", {}, h("summary", { textContent: "Prompt" }), h("p", { className: "snap-take-text", textContent: t.text })) : null,
          useRow,
          isVideo ? [h("div", { className: "snap-rail-title", textContent: "Edit this take" }), h("div", { className: "snap-set-actions" }, methodPick, timePick, editBtn), editNote,
          T.locked(t) ? h("p", { className: "snap-quiet", textContent: "🔒 Private take: its edits are private too (locked, left out of exports)." }) : null, editBox] : null,
          h("div", { className: "snap-set-actions" },
            activeBtn, priorBtn,
            h("button", { className: "snap-link", textContent: "Use these settings", title: "put this take's settings back on the open workflow (one undo step)", onclick: () => { try { say(`${T.restore(t)} settings restored from take ${t.number}`); onRestore?.(); } catch (err) { say(err.message, true); } } }),
            h("button", { className: "snap-link", textContent: "Run from here", title: "this take's workflow and settings, seed included, in a new tab, ready to run (nothing is queued)", onclick: () => { close(); onRunFrom?.(t); } }),
            h("button", { className: "snap-link", textContent: "Continue from its last frame", title: "the take's last frame becomes the First frame", onclick: async () => { try { say((await T.use(t, { as: "first_frame", t: "last" })).said); onRestore?.(); } catch (err) { say(err.message, true); } } })))));
    tags(); refresh(); rankRow(); regionLine();
    host.append(sheet);
    if (isVideo) player.focus({ preventScroll: true });
  }

  // ---- blind A/B ------------------------------------------------------------------------------------------------
  function compare([x, y], { forced } = {}) {
    const a0 = T.get(x), b0 = T.get(y);
    let blind = true, flipped = Math.random() < 0.5;
    const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
    const why = h("input", { className: "snap-lib-q", placeholder: "Why? one sentence (what made it better)" });
    const panes = h("div", { className: "snap-compare" });
    const blindBox = forced ? h("span", { className: "snap-quiet", textContent: "Blind pair set up by an agent: sides shuffled, settings hidden" })
      : h("label", { className: "snap-check" }, h("input", { type: "checkbox", checked: blind, onchange: (e) => { blind = e.target.checked; flipped = Math.random() < 0.5; draw(); } }), "Blind (sides shuffled, settings hidden)");
    const pair = () => (flipped ? [b0, a0] : [a0, b0]);
    function draw() {
      const [l, r] = pair();
      const vids = [];
      panes.replaceChildren(...[l, r].map((t, i) => {
        const m = t.media.find((z) => z.kind === "video") ?? t.media[0], v = mediaEl(m, { big: true, muted: i === 1 });
        if (v.tagName === "VIDEO") vids.push(v);
        return h("figure", {}, v, h("figcaption", { textContent: blind ? (i ? "B" : "A") : `Take ${t.number}${t.seed != null ? ` · seed ${t.seed}` : ""}` }));
      }));
      // one transport for both: play, pause and seek together
      for (const v of vids) for (const ev of ["play", "pause", "seeked"]) v.addEventListener(ev, () => { for (const o of vids) if (o !== v) { if (Math.abs(o.currentTime - v.currentTime) > 0.04) o.currentTime = v.currentTime; if (ev !== "seeked" && o.paused !== v.paused) (v.paused ? o.pause() : o.play().catch(() => {})); } });
    }
    const pick = async (side) => {
      const [l, r] = pair();
      await T.judge(l.id, r.id, side === "tie" ? "tie" : side === "a" ? l.id : r.id, { blind, why: why.value.trim() });
      if (forced) await T.settleAB(l.id, r.id); // a compare of the same two takes the person opened leaves the agent's blind pair waiting
      say(side === "tie" ? "Recorded: a tie" : `Recorded: ${blind ? "the" : `take ${(side === "a" ? l : r).number}`} ${side.toUpperCase()} side${blind ? ` was take ${(side === "a" ? l : r).number}` : ""}`);
      close();
    };
    const sheet = h("div", { className: "snap-sheet snap-take-sheet", role: "dialog", ariaLabel: "Compare takes" },
      h("header", {}, h("strong", { textContent: "Which is better?" }), blindBox, h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", onclick: close })),
      panes,
      h("div", { className: "snap-compare-pick" }, h("button", { className: "snap-primary", textContent: "A is better", onclick: () => pick("a") }), why,
        h("button", { className: "snap-link", textContent: "Tie", onclick: () => pick("tie") }), h("button", { className: "snap-primary", textContent: "B is better", onclick: () => pick("b") })));
    draw();
    host.append(sheet);
  }

  return { el, render, refresh, view, compare };
}
