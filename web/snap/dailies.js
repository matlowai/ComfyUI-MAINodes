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
// A take is judged with one key (p keep, x reject, n neither) on its card or in the viewer, with a line why and when it
// is worth another look; a verdict taken back stays, struck through, with its reason (SNAP-R173). An agent's blind pair
// shows its two sides from the server, which says which take was A only after the verdict (SNAP-R174).
// SNAP-R7 pointer-down lists · SNAP-R17 blind pairs from agents are judged by the person · SNAP-R20 the lock on private
// takes (SNAP-R27: by the current rules) · SNAP-R21 copies flagged · SNAP-R23 candidates · SNAP-R24 scenes own the work ·
// SNAP-R36 quiet sound: a note and two actions, never applied by itself · SNAP-R54 takes above the account's cap are
// left out · SNAP-R65 a job shows on its take's card and as a ghost card · SNAP-R71/R72 New view from these pictures (its
// tray: contextview.js) · SNAP-R81/R82/R113 Make it bigger (upscale.js) · SNAP-R114 the voice note (voices.js) · SNAP-R93 the instructions a take ran under · SNAP-R123 Send to · SNAP-R196 a Cast picture in place of the one it fixes · see docs/snap/SNAP_RULES.md
import * as T from "./takes.js";
import * as V from "./vault.js";
import * as CV from "./critiqueview.js"; // SNAP-R103 the critic on the take: its chip, masks and notes
import * as LB from "./lightbox.js";
import * as N from "./nearby.js"; // SNAP-R197 what the take is · SNAP-R198 Nearby (m)
import * as RT from "./retake.js";
import * as PL from "./plates.js";
import * as C from "./candidates.js";
import * as ED from "./edits.js";
import * as EX from "./extend.js";
import * as UP from "./upscale.js";
import * as EY from "./eyes.js"; // SNAP-R134 the redraw's eye line and the optional Keep eye colour · SNAP-R207 what it did
import * as VO from "./voices.js";
import * as S from "./slots.js";
import * as W from "./world.js";
import * as P from "./proposals.js";
import * as SC from "./scenes.js";
import { candidatesEl } from "./candidateview.js";
import { contextPanel } from "./contextview.js";
import { url as mediaUrl } from "./checks.js";
import * as A from "./activity.js";
import * as WV from "./workview.js";
import * as AL from "./agentlibrary.js";
import * as L from "./library.js";
import { openCast } from "./castview.js";

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
const KEYS = WV.VERDICT_KEYS; // SNAP-R173 p keep · x reject · n neither, the same keys as the Work card

// the take's pictures and videos for the full-size viewer (SNAP-R80): a sheet take steps through the sheet and its views
const fullItems = (t) => t.media.filter((m) => m.kind !== "audio").map((m, i, all) => ({ src: T.url(m), name: `Take ${t.number}${all.length > 1 ? ` · ${i + 1} of ${all.length}` : ""}`, source: [m.type ?? "output", m.subfolder, m.filename].filter(Boolean).join("/"), kind: m.kind }));
const fullBtn = (t) => h("button", { className: "snap-take-full", textContent: "⤢", title: "full size", onclick: (e) => { e.stopPropagation(); LB.show(fullItems(t)); } });

// a changed setting as a person reads it (takes.js changes() names node.input, the tooltip keeps that): "Render.text"
// → "Render prompt changed"; an input it has no words for is spelled out ("shift_video" → "shift video")
const WORDS = { text: "prompt", prompt: "prompt", value: "setting", noise_seed: "seed", steps: "steps", cfg: "CFG", sampler_name: "sampler", scheduler: "schedule", lora_name: "LoRA",
  strength_model: "LoRA strength", unet_name: "model", ckpt_name: "model", clip_name: "text encoder", vae_name: "VAE", image: "picture", filename_prefix: "save name" };
const settingWords = (x) => { const m = x.match(/^(.*)\.([^.\s]+)( rewired)?$/); return m ? `${m[1]} ${WORDS[m[2]] ?? m[2].replace(/_/g, " ")} ${m[3] ? "rewired" : "changed"}` : x; };
// what of a pinned Cast didn't reach a take (takes.js placedCheck), in plain words; a reason it can't state isn't shown
const UNPLACED = [[/^its details line isn't in the prompt that ran$/, () => "its description wasn't in the prompt"], [/^its pictures weren't read: (.+)$/, (x) => `its pictures weren't used (${x[1]})`],
  [/^its line is in the prompt but its pictures weren't in References$/, () => "in the prompt without its pictures"]];
// F-C29: a place kept as a Cast and since made a location has no description to put in a prompt: no red line for it
const unplaced = (p, ref) => (p.placed?.missing ?? []).filter((m) => !(/^its details line/.test(m) && ref?.startsWith("cast:") && W.all("location").some((r) => W.headOf(r)?.body.from_cast?.startsWith(`${ref}@`)))).map((m) => { const hit = UNPLACED.find(([re]) => re.test(m)); return hit && hit[1](m.match(hit[0])); }).filter(Boolean);

function mediaEl(m, { big, muted = true } = {}) {
  if (!m) return h("div", { className: "snap-take-none", textContent: "no picture" });
  if (m.kind === "video") return h("video", { src: T.url(m), muted, loop: !big, playsInline: true, preload: big ? "auto" : "metadata", controls: !!big });
  if (m.kind === "image") return h("img", { src: T.url(m), alt: "", loading: "lazy" });
  return h("audio", { src: T.url(m), controls: true });
}

// `onHover(take | null)`: a take card is hovered (the chain previews it in its own output slot); `onRunFrom(take)`: Run
// from here (a new tab with the take's settings, ready to run)
export function createDailies({ host, say, onRestore, onHover, onRunFrom, onRetake, onRerun, onReprompt }) {
  const picked = new Set(); // takes ticked for compare
  const strip = h("div", { className: "snap-takes-strip" });
  const count = h("span", { className: "snap-quiet" }), heading = h("strong", { textContent: "Takes" });
  const compareBtn = h("button", { className: "snap-link snap-quiet-btn", textContent: "Compare", disabled: true, onclick: () => compare([...picked]) });
  // blind pairs an agent set up for the person (setup_ab): one click opens the next, blind
  const waiting = h("button", { className: "snap-link snap-ab-waiting", hidden: true, onclick: async () => { const p = (await waitingHere())[0]; if (p) blind(p.id); } });
  const el = h("section", { className: "snap-takes" },
    h("header", {}, heading, count, waiting, h("span", { className: "snap-spacer" }),
      h("span", { className: "snap-quiet snap-takes-hint", textContent: "drag to rank · tick two to compare" }), compareBtn),
    strip);
  T.onChange(() => render());
  SC.onChange(() => render());
  W.onChange(() => render()); // a record's change reads on the cards (F-C29: a Cast made a location stops showing its miss)
  // SNAP-R65: jobs about a take show on its card, and a job that will become a take shows as a ghost card where the take
  // will land; the strip is rebuilt only when a ghost comes or goes, the chips and rings are written in place
  let ghostSig = "";
  A.onChange(() => { const g = JSON.stringify(ghosts().map((r) => r.id)); if (g !== ghostSig) render(); else paintJobs(); });
  CV.watch(strip);
  T.load().then(render, () => {});
  // the blind pairs waiting in this workflow (a pair set up in another workflow waits there)
  const waitingHere = async () => (await T.pending()).filter((p) => p.group === T.groupOf());

  // where a take sits in the open shot's scene, or null outside one: [scene, shot, take, version...]
  const crumbs = (t) => { const here = SC.current(), p = here && SC.path(here.shot, t.id); return p?.length ? [here.scene.name, SC.shotTitle(here.scene, here.shot), ...p.map((id) => SC.shortLabel(T.get(id)))] : null; };
  // the strip follows the open workflow and the shot it is in: a tab or shot switch re-renders it (refresh runs on every
  // view render); a shot's copy of a workflow keeps the workflow's id, so the shot counts too
  const shownNow = () => `${T.groupOf()}|${SC.current()?.shot.id ?? ""}`;
  let shownGroup = null;
  async function render() {
    shownGroup = shownNow();
    ghostSig = JSON.stringify(ghosts().map((r) => r.id));
    const here = SC.current(), all = here ? SC.takesOf(here.shot).map((e) => T.get(e.take)).filter(Boolean) : T.inGroup(), order = await T.ranking();
    const group = all.filter((t) => !T.aboveCap(t)), capped = all.length - group.length;
    const ranked = order.map(T.get).filter((t) => t && group.includes(t));
    const rest = group.filter((t) => !order.includes(t.id)).sort((a, b) => b.created - a.created);
    count.textContent = [group.length ? `${group.length} · ${ranked.length} ranked · ${group.filter((t) => t.verdict === "keep").length} kept` : "", capped ? `${capped} above your rating not shown` : ""].filter(Boolean).join(" · ");
    for (const id of picked) if (!T.get(id)) picked.delete(id);
    compareBtn.disabled = picked.size !== 2;
    const ab = await waitingHere();
    waiting.hidden = !ab.length;
    waiting.textContent = `${ab.length} blind pair${ab.length === 1 ? "" : "s"} waiting`;
    el.classList.toggle("empty", !group.length);
    heading.textContent = here ? `${SC.shotTitle(here.scene, here.shot)} · takes` : "Takes";
    refresh();
    queueMicrotask(paintJobs);
    // in a scene the versions follow the take they came from, in a bracket (nested again for a version of a version)
    const tree = here ? SC.tree(here.shot) : [], kids = new Map(), walk = (list) => { for (const e of list) { kids.set(e.take, e.children); walk(e.children); } };
    walk(tree);
    const coming = ghosts(), under = (id) => coming.filter((r) => r.about.take === id && group.some((t) => t.id === id)).map(ghost);
    const family = (t) => { const v = [...(kids.get(t.id) ?? []).map((e) => T.get(e.take)).filter(Boolean).map(family), ...under(t.id)];
      return v.length ? h("div", { className: "snap-take-family" }, card(t, ranked.indexOf(t), here), h("div", { className: "snap-take-versions" }, v)) : card(t, ranked.indexOf(t), here); };
    const roots = [...ranked, ...rest].filter((t) => !here || tree.some((e) => e.take === t.id)), loose = coming.filter((r) => !group.some((t) => t.id === r.about.take)).map(ghost);
    strip.replaceChildren(...(group.length || loose.length ? [...loose, ...roots.map(family)] : [h("div", { className: "snap-quiet", textContent: here ? `Each run of ${SC.shotTitle(here.scene, here.shot)} lands here as a take; versions of a take (a night version, a continue) nest under it.` : "Each run lands here as a take: rank it, keep or reject it, and note where it went wrong or right." })]));
  }

  // stale chips: one live prompt per check, compared with every take in the strip; a newer check wins
  let checking = 0, timer = null;
  const refresh = () => { if (shownGroup !== null && shownGroup !== shownNow()) return render(); clearTimeout(timer); timer = setTimeout(markStale, 250); };
  async function markStale() {
    const mine = ++checking, cards = [...strip.querySelectorAll(".snap-take:not(.ghost)")];
    if (!cards.length) return;
    const now = await T.live(), found = await Promise.all(cards.map((c) => T.stale(T.get(c.dataset.take), now)));
    if (mine !== checking) return;
    cards.forEach((c, i) => {
      // SNAP-R60: a pinned record that moved on reads first ("Kon v1 → v2"): it is the one a re-take can act on
      const chip = c.querySelector(".snap-take-stale"), world = (found[i]?.world ?? []).map(T.moveText), list = [...world, ...(found[i]?.changed ?? []).map(settingWords)];
      chip.hidden = !list.length;
      chip.textContent = list.length ? `stale: ${list[0]}${list.length > 1 ? ` +${list.length - 1}` : ""}` : "";
      chip.title = list.length ? [world.length ? `Newer versions of what this take used:\n${world.join("\n")}` : null, found[i]?.changed?.length ? `The chain no longer makes this take:\n${found[i].changed.join("\n")}` : null].filter(Boolean).join("\n\n") : "";
    });
  }

  // `here` (the open shot in its scene): the card says what it is in the shot's tree, and ☆ makes it the active take
  function card(t, r, here) {
    const m = t.media[0], active = here?.shot.active === t.id, version = here && t.parent && SC.path(here.shot, t.id).length > 1;
    const star = here ? h("button", { className: `snap-take-star${active ? " on" : ""}`, textContent: active ? "★ active" : "☆", title: active ? `the take that stands for ${SC.shotTitle(here.scene, here.shot)}` : `make this ${SC.shotTitle(here.scene, here.shot)}'s active take`,
      onclick: async (e) => { e.stopPropagation(); if (active) return; try { await SC.setActive(here.scene.id, here.shot.id, t.id); say(`${crumbs(t).slice(2).join(" › ")} is now ${SC.shotTitle(here.scene, here.shot)}'s take`); } catch (err) { say(err.message, true); } } }) : null;
    const tick = h("input", { type: "checkbox", className: "snap-take-pick", checked: picked.has(t.id), title: "tick two to compare",
      onclick: (e) => { e.stopPropagation(); e.target.checked ? picked.add(t.id) : picked.delete(t.id); if (picked.size > 2) picked.delete([...picked][0]); render(); } });
    const c = h("figure", { className: `snap-take ${t.status}${t.verdict ? ` ${t.verdict}` : ""}${active ? " active" : ""}${version ? " version" : ""}`, draggable: true, tabIndex: 0, title: (t.text ?? "").slice(0, 300), onclick: () => view(t) },
      h("div", { className: "snap-take-media" }, mediaEl(m), tick, m ? fullBtn(t) : null,
        h("span", { className: "snap-take-rank", textContent: r >= 0 ? `#${r + 1}` : "" }),
        t.verdict ? h("span", { className: "snap-take-verdict", textContent: { keep: "✓", reject: "✗", neither: "–" }[t.verdict] ?? t.verdict, title: [{ keep: "kept", reject: "rejected", neither: "neither (same problem)" }[t.verdict], t.verdict_note, t.revive_if ? `look again if ${t.revive_if}` : null].filter(Boolean).join(": ") }) : null,
        t.prior ? h("span", { className: "snap-take-prior", textContent: "prior", title: "in the Library as a prior" }) : null),
      h("figcaption", {}, star, h("b", { textContent: version ? SC.shortLabel(t) : `Take ${t.number}` }), version ? h("span", { className: "snap-quiet snap-take-of", textContent: `⟵ take ${T.get(t.parent.take)?.number ?? "?"}` }) : t.seed != null ? ` · seed ${t.seed}` : "", t.status !== "success" ? h("em", { textContent: ` · ${t.status}` }) : "",
        h("span", { className: "snap-take-stale", hidden: true }),
        t.copy?.copied ? h("span", { className: "snap-take-copy", textContent: `copied its reference view ${Math.max(...t.copy.against.map((a) => a.last)).toFixed(2)}`,
          title: `This take ends on the view of its reference picture (last frame's copy score at or above ${t.copy.threshold}): right when that picture is this camera's own plate, wrong when it shows another camera's view.\n${t.copy.against.map((a) => `${a.image}: ${a.frames.join(" → ")}`).join("\n")}` }) : null,
        t.voice?.status ? h("span", { className: t.voice.status === "ok" ? "snap-take-parent" : "snap-take-copy", textContent: t.voice.status === "no voice" ? "no voice found" : `voice ${t.voice.status}${t.voice.voices.length ? ` · ${t.voice.voices.map((x) => `${x.name} ${x.own.toFixed(2)}`).join(", ")}` : ""}${t.voice.qa?.unscripted?.length ? ` · ${t.voice.qa.unscripted.length} unscripted` : ""}`,
          title: [...t.voice.voices.map((x) => `${x.said}${x.why ? ` (${x.why.join("; ")})` : ""}`), ...(t.voice.qa?.why ?? []), ...(t.voice.qa?.listen ?? [])].join("\n") }) : null, // SNAP-R114, R240
        t.parent && !version ? h("span", { className: "snap-take-parent", textContent: `↳ ${T.versionOf(t.parent.options) ?? t.parent.method.split("/").pop()} of take ${T.get(t.parent.take)?.number ?? "?"}`, title: `made from ${t.parent.take} by ${t.parent.method}` }) : null,
        ...Object.entries(t.world ?? {}).map(([ref, p]) => [p, unplaced(p, ref)]).filter(([, m]) => m.length).map(([p, m]) => h("span", { className: "snap-take-unplaced", textContent: `${p.name} v${p.n}: ${m[0]}${m.length > 1 ? ` +${m.length - 1}` : ""}`,
          title: `Parts of ${p.name} v${p.n} (Cast) that didn't reach this take:\n${m.join("\n")}` })), // U72 F25, in plain words (the operator, 2026-11-05)
        t.cached_from ? h("span", { className: "snap-take-parent snap-take-cached", textContent: `= same result as take ${T.get(t.cached_from)?.number ?? "?"}`, title: "identical recipe, seed included: ComfyUI served the earlier result from its cache, so this take is that same file (an exact reproduction, not a new render)" }) : null,
        t.metadata_kept ? h("span", { className: "snap-take-kept", textContent: "metadata kept", title: `Save metadata was off, but ${t.metadata_kept.join("; ")}: those files hold the prompt and workflow` }) : null,
        T.quiet(t) ? h("span", { className: "snap-take-quiet", textContent: "🔈 sound is quiet", title: `The sound averages ${t.sound.mean_db} dB (a take usually sits between -27 and -41 dB). Open the take to make it louder or re-prompt` }) : null,
        ["mature", "adult"].includes(T.ratingOf(t)) ? h("span", { className: "snap-take-rating", textContent: T.RATING_SHOWN[T.ratingOf(t)],
          title: t.rating_set ? "rated by you" : `rated from how it was made: ${(t.rating_why ?? []).join("; ")}` }) : null,
        T.locked(t) ? V.badge(t) : null, // U79: "kept encrypted", "(locked)"; a click opens the vault
        CV.chip(t),
        h("span", { className: "snap-quiet", textContent: `${t.notes.length ? `✎ ${t.notes.length} · ` : ""}${ago(t.created)}` })));
    c.querySelector("figcaption").append(h("span", { className: "snap-take-job", hidden: true }));
    c.dataset.take = t.id;
    const v = c.querySelector("video");
    if (v && t.locked) v.poster = T.url(m); // U79: the server answers a picture with the lock tile while the vault is locked
    c.addEventListener("pointerenter", () => { v?.play().catch(() => {}); onHover?.(t); });
    c.addEventListener("pointerleave", () => { if (v) { v.pause(); v.currentTime = 0; } onHover?.(null); });
    c.addEventListener("keydown", async (e) => { if (e.key === "Enter") view(t); else if (KEYS[e.key] && e.target === c) { e.preventDefault(); await T.setVerdict(t, t.verdict === KEYS[e.key] ? null : KEYS[e.key]); say(`Take ${t.number}: ${t.verdict ?? "no verdict"}`); } });
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

  // the jobs that will land in this strip as takes and haven't yet: a run of this workflow or shot, or a version of one
  // of its takes (a re-take, a re-run, an extend, a louder version, an edit's render)
  function ghosts() {
    const here = SC.current(), mine = new Set(here ? SC.takesOf(here.shot).map((e) => e.take) : T.inGroup().map((t) => t.id));
    return A.all().filter((r) => r.source === "prompt" && r.takes && ["queued", "running"].includes(r.state) && !T.get(`take-${r.id}`)
      && (mine.has(r.about.take) || r.about.group === T.groupOf() || (here && r.about.shot === here.shot.id)));
  }
  function ghost(r) {
    const g = h("figure", { className: "snap-take ghost", tabIndex: 0, title: r.title },
      h("div", { className: "snap-take-media" }, h("div", { className: "snap-take-ring" })),
      h("figcaption", {}, h("b", { textContent: r.title }), h("span", { className: "snap-take-job" })));
    g.dataset.job = r.id;
    g.dataset.take = `take-${r.id}`; // the card that replaces it has the same key
    return paintGhost(g, r);
  }
  function paintGhost(g, r) {
    const p = r.progress, f = p?.max ? (p.finished + p.value / p.max) / Math.max(1, p.nodes) : p?.nodes ? p.finished / p.nodes : 0;
    g.style.setProperty("--run-p", r.state === "running" ? Math.min(1, f) : 0);
    g.querySelector(".snap-take-job").textContent = WV.stateText(r);
    return g;
  }
  // what is happening to a take, on its card: its edit painting or waiting for a pick, a version rendering, a failure
  const chipOf = (rows) => {
    const r = rows.find((x) => x.state === "failed") ?? rows.find((x) => x.state === "waiting") ?? rows.find((x) => x.state === "running" || x.state === "checking") ?? rows[0];
    if (!r) return null;
    const what = r.kind === "paint" ? "edit" : r.kind === "check" ? "check" : r.source === "decision" ? r.kind : "version";
    return { state: r.state, text: r.state === "failed" ? `${what} failed` : r.state === "waiting" ? `${r.candidates?.ready ?? ""} candidate${r.candidates?.ready === 1 ? "" : "s"} to pick` : r.state === "checking" ? "checking candidates"
      : r.state === "queued" ? `${what} queued` : `${what === "edit" ? "painting" : `${what} rendering`}${r.eta_s != null ? ` · ${r.eta}` : ""}`, more: rows.length - 1,
      title: rows.map((x) => [x.title, WV.stateText(x), x.error].filter(Boolean).join(" · ")).join("\n") };
  };
  function paintJobs() {
    const open = A.all().filter((r) => r.about?.take && (r.zone === "in_flight" || (r.zone === "landed" && r.state === "waiting")));
    for (const el of strip.querySelectorAll(".snap-take:not(.ghost) .snap-take-job")) {
      const c = chipOf(open.filter((r) => r.about.take === el.closest(".snap-take").dataset.take && !(r.result?.take === r.about.take)));
      el.hidden = !c;
      if (c) { el.textContent = `${c.text}${c.more ? ` +${c.more}` : ""}`; el.title = c.title; el.dataset.state = c.state; }
    }
    for (const g of strip.querySelectorAll(".snap-take.ghost")) { const r = A.get(g.dataset.job); if (r) paintGhost(g, r); }
  }

  // ---- the take viewer -------------------------------------------------------------------------------------------
  function view(t) {
    A.opened(t.id).catch(() => {}); // the Work card's landed row for this take is now seen (SNAP-R65)
    const close = () => { sheet.remove(); document.removeEventListener("keydown", keys, true); host.focus({ preventScroll: true }); };
    const m = t.media.find((x) => x.kind === "video") ?? t.media[0];
    const player = mediaEl(m, { big: true, muted: false });
    const isVideo = player.tagName === "VIDEO";
    const overlay = h("canvas", { className: "snap-take-overlay" });
    // a candidate previewed in place: its picture over the take, at its own frame (nothing is edited)
    const previewImg = h("img", { className: "snap-take-preview", alt: "", hidden: true }), previewTag = h("span", { className: "snap-take-preview-tag", hidden: true });
    const stage = h("div", { className: "snap-take-stage" }, player, overlay, previewImg, previewTag, m ? fullBtn(t) : null);
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
    const because = h("input", { className: "snap-lib-q snap-verdict-why", placeholder: "why, in a line (optional)", ariaLabel: "why this verdict" });
    const revive = h("input", { className: "snap-lib-q snap-verdict-revive", placeholder: "worth another look if… (optional)", ariaLabel: "revive if" });
    const judge = async (v) => { await T.setVerdict(t, t.verdict === v ? null : v, { because: because.value.trim(), revive_if: revive.value.trim() }); because.value = revive.value = ""; refresh(); };
    const verdict = (v) => h("button", { className: `snap-verdict ${v}${t.verdict === v ? " on" : ""}`, textContent: { keep: "✓ Keep (p)", reject: "✗ Reject (x)", neither: "Neither (n)" }[v], title: v === "neither" ? "neither: the same problem in every take so far" : "", onclick: () => judge(v) });
    // a verdict taken back: struck through, with the reason (a misfire blames the interface, not the person)
    const past = () => (t.verdicts_past ?? []).slice().reverse().map((x) => h("div", { className: "snap-quiet snap-verdict-past" }, h("s", { textContent: `${x.verdict}${x.because ? `: ${x.because}` : ""}` }), ` · taken back: ${T.RETRACT[x.retracted.reason] ?? x.retracted.reason}`));
    const retract = () => h("details", { className: "snap-verdict-retract" }, h("summary", { className: "snap-link snap-quiet-btn", textContent: "actually, no" }),
      ...Object.entries(T.RETRACT).filter(([k]) => k !== "superseded").map(([k, words]) => h("button", { className: "snap-link snap-quiet-btn", textContent: words, onclick: async () => { await T.setVerdict(t, null, { reason: k }); refresh(); } })));
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
      verdicts.replaceChildren(...[h("div", { className: "snap-verdict-row" }, verdict("keep"), verdict("reject"), verdict("neither")), because, revive, t.verdict ? h("div", { className: "snap-quiet" }, `${t.verdict_by === "agent" ? "an agent's" : "your"} verdict${t.verdict_note ? `: ${t.verdict_note}` : ""}${t.revive_if ? ` · look again if ${t.revive_if}` : ""} `, retract()) : null, ...past()].filter(Boolean)); // a null child prints "null"
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
    // SNAP-R134: a reference redrawn by stage 2 says to compare the eyes with the Cast picture (static, never a check),
    // with the optional re-tint one press away; the press is the person's go for the GPU step
    const eyes = EY.note(t), eyeLine = eyes ? h("div", { className: "snap-take-copyline" }, h("div", { className: "snap-quiet", textContent: eyes.said }), h("div", { className: "snap-set-actions" },
      ...eyes.casts.map((c) => h("button", { className: "snap-link snap-quiet-btn", textContent: `${c.name}'s picture`, title: "open it full size beside this take's frames", onclick: () => LB.show([{ src: mediaUrl({ filename: c.picture.split("/").pop(), subfolder: c.picture.split("/").slice(0, -1).join("/"), type: "input" }), name: `${c.name}, Cast picture`, source: `input/${c.picture}` }]) })),
      eyes.casts.length ? h("button", { className: "snap-link snap-quiet-btn", textContent: "Keep eye colour", title: "re-tint only the irises toward the Cast picture, found by SAM on every frame; a new take beside this one (GPU time)",
        onclick: async (e) => { const btn = e.currentTarget; btn.disabled = true; try { say((await EY.start(t, { cast: eyes.casts.length > 1 ? eyes.casts[0].cast : undefined, by: "person" })).said); } catch (err) { say(err.message, true); btn.disabled = false; } } }) : null)) : null;
    // F-Z02 (SNAP-R207): a take made by keep eye colour says what the step did, or why it is the picture as it was
    const eyeDone = EY.doneLine(t), eyeDoneLine = eyeDone ? h("div", { className: "snap-take-copyline" }, h("div", { className: "snap-quiet", textContent: `Keep eye colour ${eyeDone}` })) : null;
    // SNAP-R114: the voice note (a take that cites a Cast voice): one line per cited voice, amber when it says check
    const voiceLine = h("div", { className: "snap-take-copyline" });
    const voiceRow = () => {
      const v = t.voice, lines = !v ? [["not checked yet", false, ""]] : v.pending ? [["checking…", false, ""]] : v.error ? [[`not checked: ${v.error}`, false, ""]]
        : [...v.voices.map((x) => [`${x.status === "ok" ? "ok" : x.status === "check" ? "check" : "no voice"} · ${x.said}${x.why ? ` (${x.why.join("; ")})` : ""}`, x.status !== "ok",
          `${x.name}'s reference ${x.cite}: WavLM-SV ${x.own}; ${x.others.map((o) => `${o.name} ${o.score}`).join(", ") || "no other Cast voice"}; F0 ${x.f0 ?? "–"} Hz vs ${x.ref_f0 ?? "–"} Hz${x.semitones != null ? ` (${x.semitones} st)` : ""}. ok = at least ${v.thresholds.ok}, ahead of every other Cast by ${v.thresholds.margin}, F0 within ${v.thresholds.f0_semitones} semitones. Similar voices overlap (two young women 0.81-0.95): listen before you recast`]),
          // SNAP-R240: the Voice QA's lines and unscripted speech, amber on check and listen
          ...(v.qa ? [...v.qa.lines.map((l) => [`${l.verdict === "ok" ? "ok" : l.verdict === "unsure_voice" ? "listen" : l.verdict.replace("_", " ")} · "${l.text}" ${l.voice ? `${l.voice}${l.margin != null ? ` (margin ${l.margin})` : ""}` : l.expected}${l.start != null ? ` at ${l.start}-${l.end} s` : ""}`, l.verdict !== "ok" || l.wrong_time != null, `expected ${l.expected ?? "nobody named"}; heard "${l.heard ?? ""}"`]),
            ...v.qa.unscripted.map((u) => [`unscripted · "${u.text}" by ${u.voice} at ${u.start}-${u.end} s`, true, "speech nobody scripted: in a silent cut, often a voice reference's own words (F-SQ11)"]),
            ...(v.qa.lines.length || v.qa.unscripted.length ? [] : [["Voice QA: nobody speaks, as written", false, `Nemotron heard nothing ${v.qa.gpu ?? ""}`]])] : [])];
      voiceLine.replaceChildren(...h("div", {}, ...lines.map(([text, warn, title]) => h("span", { className: warn ? "snap-take-copy" : "snap-quiet", textContent: `Voice: ${text}`, title })),
        h("button", { className: "snap-link snap-quiet-btn", textContent: v && !v.pending ? "Check again" : "Check voice", disabled: !!v?.pending, title: "the take's voice against its Cast voice reference and every other Cast's voice (a few seconds on the queue)",
          onclick: async () => { try { await VO.check(t, "person"); voiceRow(); } catch (err) { say(err.message, true); } } })).childNodes);
    };
    if (isVideo && (VO.referenceAudios(t.prompt).length || t.voice)) { voiceRow(); T.onChange(() => { if (voiceLine.isConnected) voiceRow(); }); }

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
    // UI-03 (SNAP-R123): Send to: the frame (or the still) to a Cast as its next picture, a new cast member, a location's
    // plate, or References here; each a record version that says which take and frame it came from
    const sendMenu = (anchor) => {
      sheet.querySelector(".snap-send-menu")?.remove();
      const done = () => { menu.remove(); removeEventListener("pointerdown", outside, true); };
      const outside = (e) => { if (!menu.contains(e.target)) done(); };
      const go = (fn) => async (e) => { e.stopPropagation(); done(); try { const r = await fn(); if (r) say(r.said ?? r); onRestore?.(); } catch (err) { say(err.message, true); } };
      const frame = isVideo ? Math.round(player.currentTime * FPS) : undefined, at = frameNow();
      const menu = h("div", { className: "snap-scene-menu snap-send-menu", role: "menu" },
        h("button", { textContent: "References in the open recipe", onclick: go(() => T.use(t, { as: "reference", t: at })) }),
        ...W.all("cast").map((r) => h("button", { textContent: `Cast: ${W.headOf(r).body.name} (a new picture)`, title: "a new version of the Cast with this picture added; say what it shows in the Cast sheet", onclick: go(() => L.takeToCast(t, `cast:${r.id}`, { at, frame })) })),
        // F-U01 (SNAP-R196): a fixed Cast picture (a region edit of it) in place of the one it fixes, for each Cast the take pins
        ...W.all("cast").filter((r) => Object.keys(t.world ?? {}).some((k) => W.parse(k).id === r.id)).flatMap((r) => (W.headOf(r).body.refs ?? []).map((x, i) => h("button", { textContent: `Cast: ${W.headOf(r).body.name}, in place of picture ${i + 1} (${x.role})`, title: `a new version of the Cast whose picture ${i + 1} is this one, its role kept; the version before keeps the old picture`, onclick: go(() => L.takeToCast(t, `cast:${r.id}`, { at, frame, replace: i })) }))),
        h("button", { textContent: "New cast member from this picture…", onclick: go(async () => { const got = await T.frameAt(t, at, { frame }); await openCast(host, { refs: [{ file: got.file, role: "identity: front" }], say, onApplied: onRestore }); return null; }) }),
        ...W.all("location").map((r) => h("button", { textContent: `Location: ${W.headOf(r).body.name} (a plate)`, title: "a new version of the location with this frame as a plate; place it on the plan in the Location sheet", onclick: go(() => L.takeToPlate(t, `location:${r.id}`, { frame })) })));
      const at0 = anchor.getBoundingClientRect();
      Object.assign(menu.style, { position: "fixed", top: `${at0.bottom + 4}px`, left: `${Math.max(8, Math.min(at0.left, innerWidth - 300))}px` });
      sheet.append(menu);
      addEventListener("pointerdown", outside, true);
    };
    const useRow = h("div", { className: "snap-set-actions" }, h("span", { className: "snap-quiet", textContent: "Use this frame as" }),
      h("button", { className: "snap-link", textContent: "First frame", title: "the frame at the playhead becomes FL2V's start picture", onclick: use("first_frame") }),
      h("button", { className: "snap-link", textContent: "Reference", title: "the frame at the playhead goes into References as a picture", onclick: use("reference") }),
      h("button", { className: "snap-link snap-send", textContent: "Send to ▾", title: "a Cast's picture, a new cast member, a location's plate, or References", onclick: (e) => { e.stopPropagation(); sendMenu(e.currentTarget); } }));

    // Change something, or recast a person (U54, U73, SNAP-R51): a method of the edit or recast slot paints candidates; the
    // person applies one to carry it over the take. Examples (night, rain) fill the words; any change can be written. A
    // method's `credit` is the tooltip of its controls while it is picked
    const editBox = h("div", { className: "snap-take-edits" }), editNote = h("div", { className: "snap-quiet", role: "status" });
    const paintRow = (slot) => {
      const pick = h("select", { ariaLabel: `${slot} method` }), example = h("select", { ariaLabel: "example" }), lighter = h("label", { className: "snap-quiet" }, h("input", { type: "checkbox" }), " lighter LoRA");
      const words = slot === "recast" ? [h("input", { type: "text", placeholder: "who is in it now, e.g. the woman in the red coat", ariaLabel: "who" }), h("input", { type: "text", placeholder: "who they become, e.g. a bald man in his sixties, grey beard", ariaLabel: "becomes" })]
        : [h("input", { type: "text", placeholder: "what changes, e.g. the benches into a yellow phone booth", ariaLabel: "change" })];
      const frames = h("input", { type: "text", placeholder: "paint at frames (default: the middle one)", ariaLabel: "paint at frames", title: "a moving object: the frame where it enters and the one where it leaves, e.g. 20, 90" });
      const btn = h("button", { className: "snap-primary", textContent: "Make 2 candidates", onclick: async () => {
        btn.disabled = true;
        const at = frames.value.split(/[\s,]+/).filter(Boolean).map(Number);
        try {
          const r = await ED.start(t, pick.value, slot === "recast" ? { who: words[0].value, becomes: words[1].value, frames: at, lighter: lighter.firstChild.checked }
            : { change: words[0].value || undefined, example: words[0].value ? undefined : example.value || undefined, frames: at, lighter: lighter.firstChild.checked });
          editNote.textContent = `Painting frame${r.candidates[0].frames.length > 1 ? "s" : ""} ${r.candidates[0].frames.join(" and ")}: ${r.candidates.length} candidates (about ${r.seconds_each} s each). Apply one to carry it over the take`;
        } catch (err) { editNote.textContent = err.message; }
        btn.disabled = false;
      } });
      const controls = [pick, example, ...words, frames, lighter];
      S.load().then(() => {
        const list = S.list(slot);
        pick.replaceChildren(...list.map((m) => h("option", { value: m.id, textContent: m.title })));
        const shown = () => {
          const m = list.find((x) => x.id === pick.value), ex = Object.keys(m?.options?.examples ?? {});
          example.replaceChildren(h("option", { value: "", textContent: "your own words" }), ...ex.map((k) => h("option", { value: k, textContent: `e.g. ${k}` })));
          example.hidden = !ex.length; frames.hidden = !m?.anchors?.pin; lighter.hidden = !m?.options?.lighter; lighter.title = m?.options?.lighter?.line ?? "";
          btn.disabled = m?.install_state !== "ready";
          const credit = m?.credit ? `Powered by ${m.credit}` : "";
          btn.title = [m?.install_state === "ready" ? m.guidance?.line : m?.install_state, ...(m?.constraints ?? []), credit].filter(Boolean).join("\n");
          pick.title = credit;
        };
        example.onchange = () => { const m = list.find((x) => x.id === pick.value); if (example.value) words[0].value = ""; words[0].placeholder = example.value ? m.options.examples[example.value].change : "what changes, e.g. the benches into a yellow phone booth"; };
        pick.onchange = shown; shown();
      }).catch((err) => { editNote.textContent = `Methods unavailable: ${err.message}`; });
      return [h("div", { className: "snap-set-actions snap-take-paint" }, controls), h("div", { className: "snap-set-actions" }, btn)];
    };
    // Make it longer (U46c, SNAP-R50): the extend slot's methods; the button says the length it makes (SNAP-R4). The method
    // follows the length until the person picks one (Standard up to ~40 s, Long beyond, SNAP-R64), and says why
    const longPick = h("select", { ariaLabel: "how to make it longer" }), clipsIn = h("input", { type: "number", min: 1, step: 1, value: 1, ariaLabel: "clips to add", className: "snap-take-clips" });
    const burnIn = h("input", { type: "range", min: 0, max: 1, step: 0.05, value: 0, ariaLabel: "Anti-Burn" }), burnOut = h("span", { className: "snap-quiet" });
    const burnRow = h("label", { className: "snap-take-burn", title: "" }, h("span", { textContent: "Anti-Burn" }), burnIn, burnOut);
    const longNote = h("div", { className: "snap-quiet", role: "status" }), longWhy = h("div", { className: "snap-quiet snap-take-why" });
    let longChosen = false;
    const longBtn = h("button", { className: "snap-primary", onclick: async () => {
      longBtn.disabled = true;
      try { const r = await EX.start(t, longPick.value, { clips: Number(clipsIn.value), antiburn: Number(burnIn.value) }); longNote.textContent = `Making it ${r.seconds} s (about ${r.eta_s} s of GPU): the longer take lands in Takes as a version of take ${t.number}`; } catch (err) { longNote.textContent = err.message; }
      longBtn.disabled = false;
    } });
    S.load().then(() => {
      const list = S.list("extend");
      longPick.replaceChildren(...list.map((m) => h("option", { value: m.id, textContent: `${m.title} · ${m.face}` })));
      const face = () => {
        const n = Math.max(1, Math.floor(Number(clipsIn.value)) || 1), burn = Number(burnIn.value);
        let d = null;
        try { d = EX.pick(t, n); } catch (err) { longNote.textContent = err.message; }
        const dm = d && list.find((x) => x.id === d.method);
        if (dm && !longChosen) longPick.value = dm.id;
        const m = list.find((x) => x.id === longPick.value);
        longWhy.textContent = !dm ? "" : dm.id === m?.id ? `${dm.title} for ${d.seconds} s: ${d.why}` : `${m?.title}: your pick (for ${d.seconds} s Snap picks ${dm.title}: ${d.why})`;
        burnRow.hidden = !m?.options?.antiburn; burnRow.title = m?.options?.antiburn?.why ?? ""; burnOut.textContent = burn ? burn.toFixed(2) : "off";
        try { const l = EX.length(t, n); longBtn.textContent = `Make it ${l.seconds} s (+${l.added} s)`; } catch (err) { longBtn.textContent = "Make it longer"; longNote.textContent = err.message; }
        longBtn.disabled = m?.install_state !== "ready";
        longBtn.title = [m?.install_state === "ready" ? m.guidance?.line : m?.install_state, m?.credit && `Powered by ${m.credit}`].filter(Boolean).join("\n");
      };
      longPick.onchange = () => { longChosen = true; face(); };
      clipsIn.oninput = burnIn.oninput = face; face();
    }, (err) => { longNote.textContent = `Extend methods unavailable: ${err.message}`; });
    // Make it bigger (U102b, SNAP-R81/R82): the upscale slot's take methods; the button says the size it makes (SNAP-R4).
    // Stage 2 and the latent pass take a denoise (light by default), Tessera the words for its hero tile; the result is a
    // new take whose parent is this one
    const bigPick = h("select", { ariaLabel: "how to make it bigger" }), bigBy = h("select", { ariaLabel: "how much bigger" }, [2, 3, 4].map((f) => h("option", { value: f, textContent: `${f}×` })));
    const bigDen = h("input", { type: "range", min: 0.05, max: 1, step: 0.05, value: 0.3, ariaLabel: "denoise" }), bigDenOut = h("span", { className: "snap-quiet" });
    const bigDenRow = h("label", { className: "snap-take-burn" }, h("span", { textContent: "Denoise" }), bigDen, bigDenOut);
    const bigHero = h("input", { type: "text", placeholder: "e.g. face (empty: no hero tile)", ariaLabel: "hero tile" });
    const bigHeroRow = h("label", { className: "snap-take-burn", title: "words for SAM 3.1: what it finds gets its own first tile and more steps" }, h("span", { textContent: "Hero tile" }), bigHero);
    // SNAP-R113: stage 2's speed, time against softness; quality (the take's own cfg) stays the default
    const bigSpeed = h("select", { ariaLabel: "speed" }), bigSpeedRow = h("label", { className: "snap-take-burn" }, h("span", { textContent: "Speed" }), bigSpeed);
    const bigNote = h("div", { className: "snap-quiet", role: "status" }), bigWhy = h("div", { className: "snap-quiet snap-take-why" });
    let bigChosen = false;
    const bigBtn = h("button", { className: "snap-primary", textContent: "Make it bigger", onclick: async () => {
      bigBtn.disabled = true;
      const m = UP.methods().find((x) => x.id === bigPick.value);
      try { const r = await UP.start(t, m.id, { factor: Number(bigBy.value), ...(m.run.plate ? { denoise: Number(bigDen.value) } : { hero: bigHero.value.trim() }), ...(m.options.speed ? { speed: bigSpeed.value } : {}) }); bigNote.textContent = `Making it ${r.width}×${r.height} (${r.eta}): the bigger take lands in Takes, made from take ${t.number}`; } catch (err) { bigNote.textContent = err.message; }
      bigBtn.disabled = false;
    } });
    // SNAP-R85: a still is redrawn by stage 2 only; a reference (its purpose) says why it is redrawn, not sharpened
    Promise.all([S.load(), W.load(), UP.still(t) ? UP.dims(t) : null]).then(([, , from]) => {
      const list = UP.methods().filter((m) => !UP.still(t) || m.run.plate === "pixels"), why = UP.reason(t);
      bigPick.replaceChildren(...list.map((m) => h("option", { value: m.id, textContent: m.title })));
      const face = () => {
        const m = list.find((x) => x.id === bigPick.value);
        if (!bigChosen) bigBy.value = String(m.run.factor);
        bigDenRow.hidden = !m.run.plate; bigHeroRow.hidden = !!m.run.plate; bigSpeedRow.hidden = !m.options.speed;
        if (m.options.speed && bigSpeed.dataset.method !== m.id) { // the method's own choices, its default picked
          bigSpeed.replaceChildren(...Object.entries(m.options.speed.choices).map(([k, c]) => h("option", { value: k, textContent: c.label, title: c.why })));
          bigSpeed.value = m.options.speed.default; bigSpeed.dataset.method = m.id;
        }
        const pace = m.options.speed ? UP.speedOf(m, bigSpeed.value) : null;
        bigSpeedRow.title = pace ? m.options.speed.choices[pace.name].why : "";
        if (!m.run.plate && !bigHero.dataset.touched) bigHero.value = m.options.hero.default;
        bigDenOut.textContent = Number(bigDen.value).toFixed(2); bigDenRow.title = m.options.denoise?.why ?? "";
        bigWhy.textContent = why ? `${why[0].toUpperCase()}${why.slice(1)}.` : m.guidance?.line ?? ""; bigWhy.title = [why && m.guidance?.line, ...(m.constraints ?? [])].filter(Boolean).join("\n");
        try {
          const z = UP.size(t, m, { factor: Number(bigBy.value) }, from), per = !from && m.cost?.local_s_per_mp_frame;
          bigBtn.textContent = `${from ? "Redraw" : "Upscale"} to ${z.width}×${z.height}${per ? ` · about ${Math.round((per * z.width * z.height * ED.clip(t).frames) / 6e7 / (pace?.speedup ?? 1))} min` : ""}`;
        } catch (err) { bigBtn.textContent = "Make it bigger"; bigNote.textContent = err.message; }
        bigBtn.disabled = m.install_state !== "ready";
        bigBtn.title = [m.install_state === "ready" ? m.guidance?.line : m.install_state, m.credit && `Powered by ${m.credit}`].filter(Boolean).join("\n");
      };
      bigPick.onchange = () => { bigChosen = false; face(); };
      bigBy.onchange = () => { bigChosen = true; face(); };
      bigDen.oninput = face; bigSpeed.onchange = face; bigHero.oninput = () => { bigHero.dataset.touched = "1"; };
      face();
    }, (err) => { bigNote.textContent = `Upscale methods unavailable: ${err.message}`; });
    let editSig = "", pressed = false;
    editBox.addEventListener("pointerdown", () => { pressed = true; });
    editBox.addEventListener("pointerup", () => { pressed = false; setTimeout(edits, 0); });
    function edits() {
      const mine = C.all().filter((d) => ["edit", "rerun", "view"].includes(d.kind) && d.target === t.id && d.status !== "closed"); // its edits, its re-run batches (SNAP-R63) and new views with it as Picture 1 (U101)
      const sig = JSON.stringify([mine.map((d) => [d.id, d.status, d.applied, d.candidates.map((c) => [c.state, c.notes])]), P.pending().map((p) => p.id), mine.map((d) => ED.result(d)?.id)]);
      if (sig === editSig || pressed || !editBox.isConnected && editSig) return;
      editSig = sig;
      editBox.replaceChildren(...mine.map((d) => {
        const made = ED.result(d);
        const older = d.kind === "edit" && d.candidates.some((c) => c.notes.identity && !c.notes.identity.error && !c.notes.identity.new_person && !("character_low" in c.notes.identity));
        const again = older ? h("button", { className: "snap-link snap-quiet-btn", textContent: "Check identity again", title: "the character, face and hair notes for these candidates: a few seconds of detection, nothing renders",
          onclick: (e) => { e.currentTarget.disabled = true; e.currentTarget.textContent = "checking…"; ED.recheck(d.id).then(() => say(`${d.title}: identity notes updated`), (err) => say(err.message, true)); } }) : null;
        return Object.assign(h("div", { className: "snap-set-candrow" }, h("div", { className: "snap-rail-title" }, d.title, again), candidatesEl(d, { say, crops: true }),
          d.applied ? h("div", { className: "snap-quiet" }, made ? h("button", { className: "snap-link", textContent: `→ Take ${made.number} (${made.status})`, onclick: () => { close(); view(made); } }) : d.kind !== "edit" ? "" : "rendering the take with H3 Ripple…") : null), { id: `snap-decision-${d.id}` });
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
      else if (KEYS[e.key] && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); judge(KEYS[e.key]); }
      else if (e.key === "m" && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); N.openNearby(t.id, { say }); }
    };
    document.addEventListener("keydown", keys, true);

    const where = crumbs(t), here = where && SC.current();
    const activeBtn = here ? h("button", { className: "snap-link", textContent: here.shot.active === t.id ? `★ ${SC.shotTitle(here.scene, here.shot)}'s active take` : `☆ Make it ${SC.shotTitle(here.scene, here.shot)}'s take`, disabled: here.shot.active === t.id,
      onclick: async () => { try { await SC.setActive(here.scene.id, here.shot.id, t.id); activeBtn.textContent = `★ ${SC.shotTitle(here.scene, here.shot)}'s active take`; activeBtn.disabled = true; } catch (err) { say(err.message, true); } } }) : null;
    const sheet = h("div", { className: "snap-sheet snap-take-sheet", role: "dialog", ariaLabel: `Take ${t.number}`, id: `snap-viewer-${t.id}` },
      h("header", {}, where ? h("nav", { className: "snap-crumbs", ariaLabel: "where this take is" }, where.flatMap((x, i) => [i ? h("i", { textContent: "›" }) : null, h(i === where.length - 1 ? "strong" : "span", { textContent: x })])) : h("strong", { textContent: `Take ${t.number}` }), h("span", { className: "snap-quiet", textContent: `${t.seed != null ? `seed ${t.seed} · ` : ""}${t.seconds} s · ${new Date(t.created).toLocaleString()}${t.status !== "success" ? ` · ${t.status}: ${t.error ?? ""}` : ""}` }),
        h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
      h("div", { className: "snap-take-body" },
        h("div", { className: "snap-take-left" }, stage, markers, isVideo ? h("div", { className: "snap-quiet", textContent: "Space plays · , and . step one frame" }) : null),
        h("aside", {},
          N.whatEl(t.id, { say, key: "m" }), verdicts, rankLine, ratingRow(t), quietRow, AL.takeLine(t, { say }), CV.panel(t, { stage, fit, player, isVideo, say, host }),
          t.metadata_kept ? h("p", { className: "snap-take-keptline", textContent: `Save metadata was off, but ${t.metadata_kept.join("; ")}: those files still hold the prompt and workflow. Save with Save Image or Save Video to leave them out.` }) : null,
          h("div", { className: "snap-rail-title", textContent: "Note a moment" }), sentimentSeg, tagBox, words,
          h("div", { className: "snap-take-noteline" }, at, markBtn, regionText, h("span", { className: "snap-spacer" }), h("button", { className: "snap-primary", textContent: "Add note", onclick: add })),
          list,
          h("div", { className: "snap-rail-title", textContent: prev ? `Changed since take ${prev.number}` : "First take of this workflow" }),
          changes.length ? h("ul", { className: "snap-take-delta" }, changes.slice(0, 10).map((c) => h("li", {}, h("b", { textContent: `${c.node} · ${c.input}` }), ` ${String(c.from).slice(0, 40)} → ${String(c.to).slice(0, 60)}`))) : prev ? h("div", { className: "snap-quiet", textContent: "same settings" }) : null,
          copyLine, voiceLine, eyeLine, eyeDoneLine,
          t.text ? h("details", {}, h("summary", { textContent: "Prompt" }), h("p", { className: "snap-take-text", textContent: t.text })) : null,
          useRow,
          isVideo ? [h("div", { className: "snap-rail-title", textContent: "Change something" }), ...paintRow("edit"), h("div", { className: "snap-rail-title", textContent: "Recast a person" }), ...paintRow("recast"), editNote,
          T.locked(t) ? h("p", { className: "snap-quiet", textContent: "🔒 Private take: its edits are private too (locked, left out of exports)." }) : null, editBox,
          h("div", { className: "snap-rail-title", textContent: "Make it longer" }), h("div", { className: "snap-set-actions" }, longPick, h("label", { className: "snap-quiet" }, "+ ", clipsIn, " clips")), longWhy, burnRow,
          h("div", { className: "snap-set-actions" }, longBtn), longNote,
          h("div", { className: "snap-rail-title", textContent: "Make it bigger" }), h("div", { className: "snap-set-actions" }, bigPick, bigBy), bigWhy, bigDenRow, bigSpeedRow, bigHeroRow,
          h("div", { className: "snap-set-actions" }, bigBtn), bigNote] : null,
          isVideo ? null : editBox, // a picture's re-run batches (SNAP-R63) and new views (U101) show here too
          isVideo ? null : [h("div", { className: "snap-rail-title", textContent: "Make it bigger" }), h("div", { className: "snap-set-actions" }, bigPick, bigBy), bigWhy, bigDenRow, bigSpeedRow, // a still: stage 2 redraws it (SNAP-R85)
            h("div", { className: "snap-set-actions" }, bigBtn), bigNote],
          contextPanel(t, { say, frame: () => (isVideo ? Math.round(player.currentTime * FPS) : null), region: () => region }),
          h("div", { className: "snap-set-actions" },
            activeBtn, priorBtn,
            h("button", { className: "snap-link", textContent: "Use these settings", title: "put this take's settings back on the open workflow (one undo step)", onclick: () => { try { say(`${T.restore(t)} settings restored from take ${t.number}`); onRestore?.(); } catch (err) { say(err.message, true); } } }),
            h("button", { className: "snap-link", textContent: "Run from here", title: "this take's workflow and settings, seed included, in a new tab, ready to run (nothing is queued)", onclick: () => { close(); onRunFrom?.(t); } }),
            // SNAP-R61: a take re-runs as it was (the versions it pinned) or with today's world (each moved record updated first)
            t.world && Object.keys(t.world).length ? retakeRow(t) : null,
            !isVideo ? null : h("button", { className: "snap-link", textContent: "Continue from its last frame", title: "the take's last frame becomes the First frame", onclick: async () => { try { say((await T.use(t, { as: "first_frame", t: "last" })).said); onRestore?.(); } catch (err) { say(err.message, true); } } })))));
    tags(); refresh(); rankRow(); regionLine();
    host.append(sheet);
    if (isVideo) player.focus({ preventScroll: true });
  }

  // the two re-take buttons, with what today's world would change in their titles, and the Re-run sheet (SNAP-R63)
  function retakeRow(t) {
    const moved = T.moves(t.world), go = (world) => () => { document.querySelector(".snap-take-sheet")?.remove(); onRetake?.(t, world); };
    const warn = h("div", { className: "snap-world-warn", hidden: true });
    RT.differs(t.world).then((list) => { const w = list.map((m) => m.warning).filter(Boolean); warn.textContent = w.join(" "); warn.hidden = !w.length; });
    return h("div", { className: "snap-set-actions snap-retake" }, warn,
      h("button", { className: "snap-link", textContent: "Re-take as it was", title: `the versions this take used, seed included${moved.length ? ` (${moved.map(T.moveText).join(", ")} kept as they were)` : ""}`, onclick: go("pinned") }),
      h("button", { className: "snap-link", textContent: moved.length ? `Re-take with today's world (${moved.map(T.moveText).join(", ")})` : "Re-take with today's world", disabled: !moved.some((m) => !m.missing),
        title: moved.length ? `each record with a newer version is updated first: ${moved.map(T.moveText).join(", ")}` : "nothing this take used has a newer version", onclick: go("latest") }),
      h("button", { className: "snap-link", textContent: "Re-run with swaps…", title: "swap any of what this take used (another version, character, set, scene or setup), then Re-generate", onclick: () => { document.querySelector(".snap-take-sheet")?.remove(); onRerun?.(t); } }));
  }

  // ---- blind A/B ------------------------------------------------------------------------------------------------
  function compare([x, y]) {
    const a0 = T.get(x), b0 = T.get(y);
    let blind = true, flipped = Math.random() < 0.5;
    const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
    const why = h("input", { className: "snap-lib-q", placeholder: "Why? one sentence (what made it better)" });
    const panes = h("div", { className: "snap-compare" });
    const blindBox = h("label", { className: "snap-check" }, h("input", { type: "checkbox", checked: blind, onchange: (e) => { blind = e.target.checked; flipped = Math.random() < 0.5; draw(); } }), "Blind (sides shuffled, settings hidden)");
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

  // an agent's blind pair (SNAP-R174): the two sides come from the server by side, and the server says which take was A
  // only after the verdict is written
  function blind(pair) {
    const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
    const why = h("input", { className: "snap-lib-q", placeholder: "Why? one sentence (what made it better)" }), vids = [];
    const side = (s) => { const v = h("video", { src: T.blindUrl(pair, s), controls: true, loop: true, muted: s === "B", playsInline: true, className: "snap-compare-media" }); v.addEventListener("error", () => v.replaceWith(h("img", { src: T.blindUrl(pair, s), className: "snap-compare-media", alt: s })), { once: true }); vids.push(v); return h("figure", {}, v, h("figcaption", { textContent: s })); };
    const panes = h("div", { className: "snap-compare" }, side("A"), side("B"));
    for (const v of vids) for (const ev of ["play", "pause"]) v.addEventListener(ev, () => { for (const o of vids) if (o !== v && o.paused !== v.paused) (v.paused ? o.pause() : o.play().catch(() => {})); });
    const pick = async (s) => {
      try { const out = await T.judgeBlind(pair, s, why.value.trim()); say(s === "tie" ? `Recorded: a tie (A was take ${T.get(out.labels.A)?.number ?? "?"}, B take ${T.get(out.labels.B)?.number ?? "?"})` : `Recorded: ${s} was take ${T.get(out.labels[s])?.number ?? "?"}`); close(); render(); }
      catch (e) { say(e.message, true); }
    };
    const sheet = h("div", { className: "snap-sheet snap-take-sheet", role: "dialog", ariaLabel: "A blind pair" },
      h("header", {}, h("strong", { textContent: "Which is better?" }), h("span", { className: "snap-quiet", textContent: "Blind pair set up by an agent: which take is which is told after you judge" }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", onclick: close })),
      panes,
      h("div", { className: "snap-compare-pick" }, h("button", { className: "snap-primary", textContent: "A is better", onclick: () => pick("A") }), why,
        h("button", { className: "snap-link", textContent: "Tie", onclick: () => pick("tie") }), h("button", { className: "snap-primary", textContent: "B is better", onclick: () => pick("B") })));
    host.append(sheet);
    return sheet;
  }

  return { el, render, refresh, view, compare, blind };
}
