// The Room (CONCEPT_PRODUCTION §11.2, step 10): the person's front door over the Work card and the docket. The newest
// question on top with its pictures full width, one verdict and a sentence ("neither, same problem" among them), the
// reply saying what that verdict moved, the next questions under it, and "earlier" with "actually, no". It is a second
// renderer of the Work card's rows (activity.js), never its own data: a verdict here is the take's verdict (by:
// person), a pick is apply_candidate, a yes is the proposal's Accept. Machinery is not rendered here (not hidden):
// no ids, file names, model names, state words, counts or progress; every text an agent wrote passes plain().
// On the person's own install the Room is the page at /?room (localhost); a phone door belongs to snap-gate.
// SNAP-R70 the Room never restricts, renders no machinery, and its verdicts are the record's · SNAP-R173 one verdict
// and why · SNAP-R174 blind pairs from the server · SNAP-R65 the Work card's rows · SNAP-R7 rebuilt only when its
// content changes, never under a pointer · see docs/snap/SNAP_RULES.md
import * as A from "./activity.js";
import * as T from "./takes.js";
import * as C from "./candidates.js";
import * as P from "./proposals.js";
import * as W from "./world.js";
import { url } from "./checks.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; };

// the leak test's words (box1:64): what the Room never shows. The model names are the families Snap's cards and kits use
export const MODELS = ["MiniMax", "P-H3", "H3", "Pika", "MOSS", "Fizgig", "Krea", "FLUX", "Klein", "Wan", "LTX", "SDXL", "Tessera", "RelayVSR", "SeedVR2", "SeedVR", "ESRGAN", "Qwen", "EmbeddingGemma", "Gemma", "Whisper", "WavLM", "ArcFace", "AdaFace", "DINOv3", "SAM", "Viggle"];
const FILE = /[\w./-]*?[\w.-]+\.(png|jpe?g|webp|gif|mp4|webm|mov|mkv|wav|flac|mp3|safetensors|json|otio|fountain)\b/gi;
const ID = /\b(?:take|cand|cast|story|book|look|location|scene|shot|critique|prop|card|set)[-:][\w-]{3,}(?:@\d+)?/gi;
const MODEL = (m) => new RegExp(`(^|[^\\w-])(an?\\s+)?${m.replace(/[-]/g, "\\-")}(?![\\w-])`, "gi");
export const BANNED = [/\btask/i, /\bpriorit/i, /\bstatus/i, /\bids?\b/i, /\bfile ?names?\b/i, new RegExp(FILE.source, "i"), new RegExp(ID.source, "i"), /\bp\d+\b/, ...MODELS.map((m) => new RegExp(MODEL(m).source, "i"))];

// an agent's words for the person: references become names ("take 3", a Cast's name, or "it"), files "the picture" /
// "the clip", ids, state words and model names go, and the punctuation they leave is tidied
export function plain(text) {
  let s = String(text ?? "");
  s = s.replace(ID, (ref) => { const t = T.get(ref); if (t) return `take ${t.number}`; try { return W.get(ref)?.version?.body?.name ?? "it"; } catch { return "it"; } });
  s = s.replace(FILE, (f) => (/\.(mp4|webm|mov|mkv)$/i.test(f) ? "the clip" : /\.(wav|flac|mp3)$/i.test(f) ? "the sound" : /\.(png|jpe?g|webp|gif)$/i.test(f) ? "the picture" : "a document"));
  s = s.replace(/\bp\d+\b/g, "an earlier suggestion").replace(/\b(?:task|id)s?\s*#?\d+\b/gi, "").replace(/\b(?:task|priority|status|ids?)\b\s*:?/gi, "");
  for (const m of MODELS) s = s.replace(MODEL(m), (all, lead, art) => `${lead}${art ?? ""}`);
  s = s.replace(/\b([Aa])\s+(?=[aeiou])/g, "$1n ").replace(/\b([Aa])n\s+(?=[^aeiou\s])/g, "$1 ");
  return s.replace(/\(\s*[,;:]\s*/g, "(").replace(/\s*[,;:]\s*\)/g, ")").replace(/\(\s*\)/g, "").replace(/\s+([,.;:!?)])/g, "$1").replace(/\(\s+/g, "(").replace(/\s{2,}/g, " ").trim();
}

// what waits for the person, newest first: the docket's rows the Room can ask about
const asks = () => A.all().filter((r) => r.zone === "landed" && ((r.source === "proposal") || (r.source === "decision" && r.state === "waiting") || r.source === "blind_pair" || (r.state === "done" && r.result?.take)));
const pictureOf = (m) => m && (m.kind === "video" ? h("video", { src: url(m), controls: true, loop: true, muted: true, playsInline: true, className: "snap-room-pic" }) : h("img", { src: url(m), className: "snap-room-pic", alt: "" }));

export function openRoom({ say } = {}) {
  for (const s of document.querySelectorAll(".snap-room")) s.remove();
  const earlier = []; // this visit's verdicts, newest first: [what was asked, what was said, undo or null]
  let reply = "", sig = "", top = null;
  const run = async (name, args) => (await import("./tools.js")).callTool(name, args, { confirmed: true });
  const body = h("main", { className: "snap-room-body" }), replyEl = h("p", { className: "snap-room-reply", role: "status" });
  const room = h("div", { className: "snap-room", role: "dialog", ariaLabel: "The Room", tabIndex: -1 },
    h("header", { className: "snap-room-head" }, h("strong", { textContent: "The Room" }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-link", textContent: "Back to Snap", onclick: () => close() })),
    replyEl, body);
  const close = () => { room.remove(); off = true; };
  let off = false;
  const answered = async (asked, said, undo = null) => { reply = said; earlier.unshift([asked, said, undo]); sig = ""; await A.reconcile(); draw(); };
  const act = (fn) => async () => { try { await fn(); } catch (e) { reply = plain(e.message); sig = ""; draw(); say?.(e.message, true); } };
  const sentence = () => h("input", { className: "snap-room-why", placeholder: "a sentence, if you like", ariaLabel: "your sentence" });

  // one question, whole
  function question(r) {
    const why = sentence(), asked = plain(r.title) || "This one";
    const where = r.where ? h("p", { className: "snap-room-where", textContent: plain(r.where) }) : null;
    if (r.source === "proposal") {
      const p = P.get(r.proposal);
      return h("section", { className: "snap-room-q" }, h("h2", { textContent: `So: ${asked}. Shall I?` }), where,
        p?.plan?.eta_s ? h("p", { className: "snap-room-stakes", textContent: `About ${Math.max(1, Math.round(p.plan.eta_s / 60))} minute${Math.round(p.plan.eta_s / 60) > 1 ? "s" : ""} on the GPU.` }) : null, why,
        h("div", { className: "snap-room-verdict" },
          h("button", { className: "snap-primary", textContent: "Yes", onclick: act(async () => { const out = await P.decide(r.proposal, true, run); await answered(asked, out?.status === "accepted" ? `Done: ${plain(typeof out.result === "object" ? out.result?.said ?? asked : asked)}.` : `It couldn't be done: ${plain(out?.result ?? "answered elsewhere")}.`); }) }),
          h("button", { className: "snap-link", textContent: "No", onclick: act(async () => { await P.decide(r.proposal, false, run, { because: why.value.trim() }); await answered(asked, `Left as it is${why.value.trim() ? `: ${why.value.trim()}` : ""}.`); }) })));
    }
    if (r.source === "blind_pair") {
      const side = (s) => { const v = h("video", { src: T.blindUrl(r.pair, s), controls: true, loop: true, muted: true, playsInline: true, className: "snap-room-pic" }); v.addEventListener("error", () => v.replaceWith(h("img", { src: T.blindUrl(r.pair, s), className: "snap-room-pic", alt: "" })), { once: true }); return h("figure", {}, v, h("figcaption", { textContent: s })); };
      const pick = (s) => act(async () => { const out = await T.judgeBlind(r.pair, s, why.value.trim()); await answered("Which is better?", s === "tie" ? "Noted: the same to you." : `Noted: ${s} was take ${T.get(out.labels[s])?.number ?? "?"}.`); });
      return h("section", { className: "snap-room-q" }, h("h2", { textContent: "Which is better?" }), h("div", { className: "snap-room-pics two" }, side("A"), side("B")), why,
        h("div", { className: "snap-room-verdict" }, h("button", { className: "snap-primary", textContent: "A", onclick: pick("A") }), h("button", { className: "snap-primary", textContent: "B", onclick: pick("B") }), h("button", { className: "snap-link", textContent: "The same", onclick: pick("tie") })));
    }
    if (r.source === "decision") {
      const d = C.get(r.decision), ready = d?.candidates.filter((c) => c.state === "ready") ?? [];
      return h("section", { className: "snap-room-q" }, h("h2", { textContent: asked }), where,
        h("div", { className: "snap-room-pics" }, ready.map((c) => h("figure", {}, pictureOf(c.pictures?.[0]?.media ?? T.get(c.take)?.media?.[0]),
          h("button", { className: "snap-primary", textContent: "This one", onclick: act(async () => { await C.apply(d.id, c.id, "person"); await answered(asked, `Picked: it's in ${plain(r.where) || "its place"} now.`); }) })))), why,
        h("div", { className: "snap-room-verdict" }, h("button", { className: "snap-link", textContent: "Neither, same problem", onclick: act(async () => { for (const c of ready) await C.reject(d.id, c.id, "person", { because: why.value.trim() || "neither: the same problem" }); await answered(asked, "None of them: they'll be made again with that in mind."); }) })));
    }
    const t = T.get(r.result.take);
    const judge = (v, said) => act(async () => { await T.setVerdict(t, v, { because: why.value.trim() }); await A.opened(t.id); await answered(asked, said, async () => { await T.setVerdict(t, null, { reason: "changed_mind" }); }); });
    return h("section", { className: "snap-room-q" }, h("h2", { textContent: asked }), where, h("div", { className: "snap-room-pics one" }, t ? pictureOf(t.media.find((m) => m.kind === "video") ?? t.media[0]) : null), why,
      h("div", { className: "snap-room-verdict" }, h("button", { className: "snap-primary", textContent: "Keep it", onclick: judge("keep", `Kept${r.where ? `: ${plain(r.where)} can use it` : ""}.`) }),
        h("button", { className: "snap-link", textContent: "Not this one", onclick: judge("reject", "Set aside, with your reason.") }),
        h("button", { className: "snap-link", textContent: "Neither, same problem", onclick: judge("neither", "Noted: the same problem as the others.") })));
  }

  function draw() {
    if (off) return;
    const list = asks();
    if (top && !list.some((r) => r.id === top)) top = null;
    const first = list.find((r) => r.id === top) ?? list[0], rest = list.filter((r) => r !== first);
    const now = JSON.stringify([reply, earlier.length, first?.id, first?.state, rest.map((r) => r.id)]);
    if (now === sig || room.matches(":hover") && room.querySelector(".snap-room-why:focus")) return; // SNAP-R7: never under a typing hand
    sig = now;
    replyEl.textContent = reply;
    body.replaceChildren(...[ // filtered: a null child prints "null"
      first ? question(first) : h("section", { className: "snap-room-q quiet" }, h("h2", { textContent: "Nothing waits for you." })),
      rest.length ? h("section", { className: "snap-room-next" }, h("h3", { textContent: "Then" }), rest.map((r) => h("button", { className: "snap-room-line", textContent: r.source === "proposal" ? `So: ${plain(r.title)}?` : r.source === "blind_pair" ? "Which is better?" : plain(r.title), onclick: () => { top = r.id; sig = ""; draw(); } }))) : null,
      earlier.length ? h("section", { className: "snap-room-earlier" }, h("h3", { textContent: "Earlier" }), earlier.map(([asked, said, undo], i) => h("div", { className: "snap-room-line" }, h("span", { textContent: `${asked}: ${said}` }),
        undo ? h("button", { className: "snap-link", textContent: "actually, no", onclick: act(async () => { await undo(); earlier[i][1] = `${said} (taken back)`; earlier[i][2] = null; reply = "Taken back."; sig = ""; draw(); }) }) : null))) : null].filter(Boolean));
  }
  A.onChange(draw);
  Promise.all([T.load(), C.load(), P.load(), W.load()]).then(() => A.reconcile()).then(draw, (e) => { reply = plain(e.message); draw(); });
  (document.querySelector(".snap-root") ?? document.body).append(room); // inside Snap's root: its colours, above its sheets
  room.focus({ preventScroll: true });
  draw();
  return room;
}
