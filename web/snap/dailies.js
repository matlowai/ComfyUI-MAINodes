// Dailies: the takes strip under the chain, the take viewer (play, scrub, keep / reject, rank, notes pinned to a moment
// and optionally a region: "where it went wrong / right"), and blind A/B compare. What people do here is the data a
// judge model learns from (takes.js keeps it; tools/snap_dataset.py exports it). A take the chain no longer makes shows
// "stale: Render.steps changed" (U31); checked after graph edits, written into the cards in place. A take that re-rendered
// its own reference picture's view says "copied its reference view" once its copy check has run (U48: DINOv3's room
// score can't tell a copy of the reference's view from a new view of the same room).
// SNAP-R7 pointer-down lists · SNAP-R17 blind pairs from agents are judged by the person · SNAP-R20 the lock on private
// takes · SNAP-R21 copies flagged · see docs/SNAP_RULES.md
import * as T from "./takes.js";
import * as PL from "./plates.js";

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

export function createDailies({ host, say, onRestore, onContinue }) {
  const picked = new Set(); // takes ticked for compare
  const strip = h("div", { className: "snap-takes-strip" });
  const count = h("span", { className: "snap-quiet" });
  const compareBtn = h("button", { className: "snap-link snap-quiet-btn", textContent: "Compare", disabled: true, onclick: () => compare([...picked]) });
  // blind pairs an agent set up for the person (setup_ab): one click opens the next, blind
  const waiting = h("button", { className: "snap-link snap-ab-waiting", hidden: true, onclick: async () => { const p = (await waitingHere())[0]; if (p) compare([p.a, p.b], { forced: true }); } });
  const el = h("section", { className: "snap-takes" },
    h("header", {}, h("strong", { textContent: "Takes" }), count, waiting, h("span", { className: "snap-spacer" }),
      h("span", { className: "snap-quiet snap-takes-hint", textContent: "drag to rank · tick two to compare" }), compareBtn),
    strip);
  T.onChange(() => render());
  T.load().then(render, () => {});
  // the blind pairs waiting in this workflow (a pair set up in another workflow waits there)
  const waitingHere = async () => (await T.pending()).filter((p) => T.get(p.a)?.group === T.groupOf() && T.get(p.b)?.group === T.groupOf());

  async function render() {
    const group = T.inGroup(), order = await T.ranking();
    const ranked = order.map(T.get).filter((t) => t && t.group === T.groupOf());
    const rest = group.filter((t) => !order.includes(t.id)).sort((a, b) => b.created - a.created);
    count.textContent = group.length ? `${group.length} · ${ranked.length} ranked · ${group.filter((t) => t.verdict === "keep").length} kept` : "";
    for (const id of picked) if (!T.get(id)) picked.delete(id);
    compareBtn.disabled = picked.size !== 2;
    const ab = await waitingHere();
    waiting.hidden = !ab.length;
    waiting.textContent = `${ab.length} blind pair${ab.length === 1 ? "" : "s"} waiting`;
    el.classList.toggle("empty", !group.length);
    refresh();
    strip.replaceChildren(...(group.length ? [...ranked, ...rest].map((t) => card(t, ranked.indexOf(t))) : [h("div", { className: "snap-quiet", textContent: "Each run lands here as a take: rank it, keep or reject it, and note where it went wrong or right." })]));
  }

  // stale chips: one live prompt per check, compared with every take in the strip; a newer check wins
  let checking = 0, timer = null;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(markStale, 250); };
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

  function card(t, r) {
    const m = t.media[0];
    const tick = h("input", { type: "checkbox", className: "snap-take-pick", checked: picked.has(t.id), title: "tick two to compare",
      onclick: (e) => { e.stopPropagation(); e.target.checked ? picked.add(t.id) : picked.delete(t.id); if (picked.size > 2) picked.delete([...picked][0]); render(); } });
    const c = h("figure", { className: `snap-take ${t.status}${t.verdict ? ` ${t.verdict}` : ""}`, draggable: true, tabIndex: 0, title: t.text.slice(0, 300), onclick: () => view(t) },
      h("div", { className: "snap-take-media" }, mediaEl(m), tick,
        h("span", { className: "snap-take-rank", textContent: r >= 0 ? `#${r + 1}` : "" }),
        t.verdict ? h("span", { className: "snap-take-verdict", textContent: t.verdict === "keep" ? "✓" : "✗" }) : null,
        t.prior ? h("span", { className: "snap-take-prior", textContent: "prior", title: "in the Library as a prior" }) : null),
      h("figcaption", {}, h("b", { textContent: `Take ${t.number}` }), t.seed != null ? ` · seed ${t.seed}` : "", t.status !== "success" ? h("em", { textContent: ` · ${t.status}` }) : "",
        h("span", { className: "snap-take-stale", hidden: true }),
        t.copy?.copied ? h("span", { className: "snap-take-copy", textContent: `copied its reference view ${Math.max(...t.copy.against.map((a) => a.last)).toFixed(2)}`,
          title: `This take ends on the view of its reference picture (last frame's copy score at or above ${t.copy.threshold}): right when that picture is this camera's own plate, wrong when it shows another camera's view.\n${t.copy.against.map((a) => `${a.image}: ${a.frames.join(" → ")}`).join("\n")}` }) : null,
        t.private ? h("span", { className: "snap-take-lock", textContent: "🔒 private", title: "Private take (identity or Cast LoRA): its files were saved without the recipe inside, and exports leave it out" }) : null,
        h("span", { className: "snap-quiet", textContent: `${t.notes.length ? `✎ ${t.notes.length} · ` : ""}${ago(t.created)}` })));
    c.dataset.take = t.id;
    const v = c.querySelector("video");
    if (v) { c.addEventListener("pointerenter", () => v.play().catch(() => {})); c.addEventListener("pointerleave", () => { v.pause(); v.currentTime = 0; }); }
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
    const stage = h("div", { className: "snap-take-stage" }, player, overlay);
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
    const keys = (e) => {
      if (e.target.closest("input,textarea,select")) return;
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      else if (isVideo && (e.key === "," || e.key === ".")) { e.preventDefault(); player.pause(); player.currentTime = Math.max(0, player.currentTime + (e.key === "," ? -1 : 1) / FPS); }
      else if (isVideo && e.key === " ") { e.preventDefault(); player.paused ? player.play() : player.pause(); }
    };
    document.addEventListener("keydown", keys, true);

    const sheet = h("div", { className: "snap-sheet snap-take-sheet", role: "dialog", ariaLabel: `Take ${t.number}` },
      h("header", {}, h("strong", { textContent: `Take ${t.number}` }), h("span", { className: "snap-quiet", textContent: `${t.seed != null ? `seed ${t.seed} · ` : ""}${t.seconds} s · ${new Date(t.created).toLocaleString()}${t.status !== "success" ? ` · ${t.status}: ${t.error ?? ""}` : ""}` }),
        h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
      h("div", { className: "snap-take-body" },
        h("div", { className: "snap-take-left" }, stage, markers, isVideo ? h("div", { className: "snap-quiet", textContent: "Space plays · , and . step one frame" }) : null),
        h("aside", {},
          verdicts, rankLine,
          h("div", { className: "snap-rail-title", textContent: "Note a moment" }), sentimentSeg, tagBox, words,
          h("div", { className: "snap-take-noteline" }, at, markBtn, regionText, h("span", { className: "snap-spacer" }), h("button", { className: "snap-primary", textContent: "Add note", onclick: add })),
          list,
          h("div", { className: "snap-rail-title", textContent: prev ? `Changed since take ${prev.number}` : "First take of this workflow" }),
          changes.length ? h("ul", { className: "snap-take-delta" }, changes.slice(0, 10).map((c) => h("li", {}, h("b", { textContent: `${c.node} · ${c.input}` }), ` ${String(c.from).slice(0, 40)} → ${String(c.to).slice(0, 60)}`))) : prev ? h("div", { className: "snap-quiet", textContent: "same settings" }) : null,
          copyLine,
          t.text ? h("details", {}, h("summary", { textContent: "Prompt" }), h("p", { className: "snap-take-text", textContent: t.text })) : null,
          h("div", { className: "snap-set-actions" },
            priorBtn,
            h("button", { className: "snap-link", textContent: "Use these settings", title: "put this take's settings back on the open workflow (one undo step)", onclick: () => { try { say(`${T.restore(t)} settings restored from take ${t.number}`); onRestore?.(); } catch (err) { say(err.message, true); } } }),
            h("button", { className: "snap-link", textContent: "Open as a new tab", onclick: () => T.openAsTab(t) }),
            onContinue ? h("button", { className: "snap-link", textContent: "Continue from its last frame", title: "the take's last frame becomes the First frame", onclick: async () => { try { say(await onContinue(await T.lastFrame(t))); } catch (err) { say(err.message, true); } } }) : null))));
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
