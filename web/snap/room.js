// The Room (CONCEPT_PRODUCTION §11.2, step 10): the person's front door over the Work card and the docket. The newest
// question on top with its pictures full width, one verdict and a sentence ("neither, same problem" among them), the
// reply saying what that verdict moved, the next questions under it, and "earlier" with "actually, no". It is a second
// renderer of the Work card's rows (activity.js), never its own data: a verdict here is the take's verdict (by:
// person), a pick is apply_candidate, a yes is the proposal's Accept. Machinery is not rendered here (not hidden):
// no ids, file names, model names, state words, counts or progress; every text an agent wrote passes plain().
// On the person's own install the Room is the page at /?room (localhost); a phone door belongs to snap-gate.
// SNAP-R70 the Room never restricts, renders no machinery, and its verdicts are the record's · SNAP-R179 each question one
// plain sentence naming the thing · SNAP-R180 a critic's row asks its finding, with each note's words and where it was born · SNAP-R173 one verdict and why · SNAP-R174 blind pairs from the server · SNAP-R65 the Work card's rows · SNAP-R7 rebuilt only when its
// content changes, never under a pointer · see docs/snap/SNAP_RULES.md
import * as A from "./activity.js";
import * as T from "./takes.js";
import * as C from "./candidates.js";
import * as P from "./proposals.js";
import * as W from "./world.js";
import * as B from "./book.js";
import * as CR from "./critiques.js";
import { url } from "./checks.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; };

// the leak test's words (box1:64): what the Room never shows. The model names are the families Snap's cards and kits use
export const MODELS = ["MiniMax", "P-H3", "H3", "Pika", "MOSS", "Fizgig", "Krea", "FLUX", "Klein", "Wan", "LTX", "SDXL", "Tessera", "RelayVSR", "SeedVR2", "SeedVR", "ESRGAN", "Qwen", "EmbeddingGemma", "Gemma", "Whisper", "WavLM", "ArcFace", "AdaFace", "DINOv3", "SAM", "Viggle"];
const FILE = /[\w./-]*?[\w.-]+\.(png|jpe?g|webp|gif|mp4|webm|mov|mkv|wav|flac|mp3|safetensors|json|otio|fountain)\b/gi;
const ID = /\b(?:take|cand|cast|story|book|look|location|scene|shot|critique|prop|card|set)[-:][\w-]{3,}(?:@\d+)?/gi;
const MODEL = (m) => new RegExp(`(^|[^\\w-])(an?\\s+)?${m.replace(/[-]/g, "\\-")}(?![\\w-])`, "gi");
export const BANNED = [/\btask/i, /\bpriorit/i, /\bstatus/i, /\bids?\b/i, /\bfile ?names?\b/i, new RegExp(FILE.source, "i"), new RegExp(ID.source, "i"), /\bp\d+\b/, ...MODELS.map((m) => new RegExp(MODEL(m).source, "i"))];

// an agent's words for the person: references become names ("take 3", a Cast's name, or "it"), files "the picture" /
// "the clip", ids, state words and model names go, and the punctuation they leave is tidied. A reference with no name
// goes with the word that led to it ("an edit of take-ab12 for cast:x" → "an edit", not "an edit of it for it")
export function plain(text) {
  let s = String(text ?? "");
  s = s.replace(ID, (ref) => { const t = T.get(ref); if (t) return `take ${t.number}`; try { return W.get(ref)?.version?.body?.name ?? "\u0000"; } catch { return "\u0000"; } });
  s = s.replace(/\s*\b(?:of|for|from|in|on|to|with|at|by|about)\s+\u0000/gi, "").replaceAll("\u0000", "it");
  s = s.replace(FILE, (f) => (/\.(mp4|webm|mov|mkv)$/i.test(f) ? "the clip" : /\.(wav|flac|mp3)$/i.test(f) ? "the sound" : /\.(png|jpe?g|webp|gif)$/i.test(f) ? "the picture" : "a document"));
  s = s.replace(/\bp\d+\b/g, "an earlier suggestion").replace(/\b(?:task|id)s?\s*#?\d+\b/gi, "").replace(/\b(?:task|priority|status|ids?)\b\s*:?/gi, "");
  for (const m of MODELS) s = s.replace(MODEL(m), (all, lead, art) => `${lead}${art ?? ""}`);
  s = s.replace(/\b([Aa])\s+(?=[aeiou])/g, "$1n ").replace(/\b([Aa])n\s+(?=[^aeiou\s])/g, "$1 ");
  return s.replace(/\(\s*[,;:]\s*/g, "(").replace(/\s*[,;:]\s*\)/g, ")").replace(/\(\s*\)/g, "").replace(/\s+([,.;:!?)])/g, "$1").replace(/\(\s+/g, "(").replace(/\s{2,}/g, " ").trim();
}

// SNAP-R179: what the Room asks is one plain sentence naming the thing: the agent's own question when its words hold one,
// else a question made from what the row is (a story change says the state in words; a pick names what it picks from),
// with the agent's other words beside it. Asides with nothing left in them after plain() ("(it, the picture)",
// "(render)"), a proposal's "pN:" label and its "(on pN)" stacking note go
const EMPTY = /^(?:\s|[,;:·-]|\bit\b|\bthe (?:picture|clip|sound)\b|\ba document\b|\btake \d+\b|\brender\b|\bedit\b|\ban earlier suggestion\b)*$/i;
const VERB = /^(add|edit|move|remove|set|use|keep|turn|cancel|make|change|save|apply|draw|re-?run|run|design|put|take|give|drop|swap|import|delete|replace|try|render|upscale|extend)\b/i;
const low = (x) => (VERB.test(x) || /^(?:The|A|An|This|That|These|Those|Some|Its|Her|His|Their)\b/.test(x) ? x[0].toLowerCase() + x.slice(1) : x);
const SNAP_TITLE = /^(?:Run|Re-take|Re-run|Make|Keep|Take|New view|Character sheet|Extend|Upscale)\b/; // a job title Snap wrote, not the agent's words
const cap = (x) => (x ? x[0].toUpperCase() + x.slice(1) : x);
const bare = (x) => x.replace(/[.!?]+(["”']?)\s*$/, "$1").trim();
function words(text, name) {
  let s = String(text ?? "").replace(/^\s*p\d+\s*:\s*/i, "").replace(/\(\s*on p\d+(?:\s*,\s*p\d+)*\s*\)/gi, "");
  if (name) s = s.replace(new RegExp(`^\\s*${name.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&")}\\s*:\\s*`), ""); // a Book's name before its edit: the place line says it
  return plain(s).replace(/\(([^()]*)\)/g, (all, inner) => (EMPTY.test(inner) ? "" : all)).replace(/\s{2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
}
const asides = (s) => [...s.matchAll(/\(([^()]*)\)/g)].map((m) => m[1].trim()).filter(Boolean);
const noAsides = (s) => { let was; do { was = s; s = s.replace(/\s*\([^()]*\)/g, ""); } while (s !== was); return s.replace(/\s{2,}/g, " ").trim(); }; // F-Q19: a prompt aside holds asides of its own
const questionIn = (s) => s.match(/^[^?]*?([^.!?]*\?)/)?.[1]?.trim() || null;
const placeOf = (where) => (where?.includes("›") ? plain(where).replace(/\s*›\s*/g, ", ") : null);
// SNAP-R180 (F-Q20): a critic's row asks its finding: the worst note's first sentence ("Kuroe's eyewear is spectacles, not
// the Cast's monocle: keep it anyway?"), every note under the picture with where it was born, in words a person reads
const RANK = { high: 0, medium: 1, low: 2 }, SEVERITY = { high: "Serious", medium: "Worth fixing", low: "Small" };
export const notesOf = (r) => [...(CR.get(r.result?.critique ?? r.critiques?.at(-1))?.notes ?? [])].sort((a, b) => (RANK[a.severity] ?? 3) - (RANK[b.severity] ?? 3));
const PIXELS = /\s*\((?:[^()]*\b[xy]\s*[~=]?\s*\d[^()]*|[\d\s.,~×x–-]+)\)/g; // "(x~660-735, y~385-400)", "(980-1060, 695-715)": the box on the picture says where
const said_ = (text) => plain(String(text ?? "").replace(PIXELS, ""));
const headline = (text) => bare(noAsides(said_(text)).split(/(?<=[.!?])\s+|:\s+|;\s+/)[0] ?? "").replace(/[,:;\s]+$/, "");
export function bornIn(o) {
  if (!o || typeof o !== "object") return "this picture itself";
  const name = (ref) => { try { return W.get(ref)?.version.body.name ?? null; } catch { return null; } };
  if (o.ref?.startsWith("cast:")) return `${name(o.ref) ?? "the Cast"}'s Cast pictures`;
  if (o.ref?.startsWith("location:")) {
    const place = name(o.ref) ?? "the place", part = o.part ?? "";
    if (part === "marks") return o.plate ? `the camera height typed for ${place}'s plate ${o.plate}` : `the camera heights typed for ${place}`;
    if (part.startsWith("plate ")) return `${place}'s ${part}`;
    return { master: `${place}'s master picture`, plan: `${place}'s plan`, notes: `${place}'s notes`, map: `${place}'s camera map` }[part] ?? `${place}, somewhere`;
  }
  if (o.what === "board") return plain(o.label ?? "the board it was drawn from");
  if (o.what === "prompt") return "the words it was made from";
  return "this picture itself";
}
export function ask(r) {
  if (r.source === "blind_pair") return { q: "Which is better, A or B?" };
  if (r.source === "critique") { const top = notesOf(r)[0], head = top && headline(top.text); return { q: head ? `${cap(head)}: keep it anyway?` : r.run ? ask(r.run).q : "The critic found nothing wrong here: keep it?" }; }
  const p = r.source === "proposal" ? P.get(r.proposal) : null, book = p?.book ? W.get(p.book)?.version.body : null;
  const w = words(r.title, book?.name), own = questionIn(w), more = own ? null : asides(w).join("; ") || null, said = noAsides(w);
  if (own) return { q: own };
  if (r.source === "proposal") {
    const a = p?.args ?? {}, who = a.entity ? plain(a.entity) : null;
    if (p?.tool === "add_change" && who && who !== "it") { // a story change as the state it makes, in words
      const thing = (v) => (v == null ? "nothing" : String(v).startsWith("prop:") ? plain(String(v).replace(/^prop:/, "the ")) : plain(String(v)));
      const then = a.op === "remove" ? `${who} no longer ${/^carried\.(right|left)_hand$/.test(a.path) ? "holds" : /^(wardrobe|carried\.worn)$/.test(a.path) ? "wears" : "has"} ${thing(a.value)}` : bare(B.stateSentence({ beats: [], props: [] }, who, a.path, a.op === "add" ? [a.value] : a.value) ?? `${who} ${a.path.replace(/[._]/g, " ")} ${thing(a.value)}`);
      return { q: `From ${a.beat ?? "this beat"} on, ${then}: shall I add that to the story?`, more };
    }
    if (p?.tool === "add_beat" && a.text) return { q: `Shall I add a beat: ${bare(plain(a.text))}?`, more };
    return { q: said ? `Shall I ${VERB.test(said) ? bare(low(said)) : `go ahead with ${bare(low(said))}`}?` : "Shall I go ahead?", more };
  }
  if (r.source === "decision") {
    if (r.question) { const w = words(r.question), own = questionIn(w); if (own || w) return { q: own ?? `${bare(cap(noAsides(w)))}?` }; } // F-Q21: the agent's own question for its candidates
    const d = C.get(r.decision), t = d?.take ? T.get(d.take) : null, place = placeOf(r.where), of = t ? ` of take ${t.number}` : "";
    const q = { edit: `Which edit${of} do you keep?`, rerun: `Which re-run${of} do you keep?`, plate: `Which picture is the ${d?.camera ?? "camera"} plate?`, sheet: `Which character sheet of ${plain(d?.target ?? "") || "them"} do you keep?` }[d?.kind] ?? `Which ${d?.kind === "view" ? "new view" : "one"} do you keep${place ? ` for ${place}` : ""}?`;
    return { q };
  }
  const n = r.result?.number ?? (r.result?.take ? T.get(r.result.take)?.number : null);
  return { q: `Do you keep ${said && !SNAP_TITLE.test(said) ? bare(low(said)) : n ? `take ${n}` : "it"}?` };
}

// what waits for the person, newest first: the docket's rows the Room can ask about. A take a critic has read is asked
// once, on the critic's row (its picture and notes), with the run's own question when the run had one (SNAP-R180)
const asks = () => {
  const list = A.all().filter((r) => r.zone === "landed" && ((r.source === "proposal") || (r.source === "decision" && r.state === "waiting") || r.source === "blind_pair" || (r.state === "done" && r.result?.take)));
  const runs = new Map(list.filter((r) => r.source === "prompt" && r.result?.take).map((r) => [r.result.take, r])), read = new Set(list.filter((r) => r.source === "critique" && r.result?.take).map((r) => r.result.take));
  return list.filter((r) => !(r.source === "prompt" && read.has(r.result?.take))).map((r) => (r.source === "critique" && runs.has(r.result?.take) ? { ...r, run: runs.get(r.result.take) } : r));
};
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
    const why = sentence(), { q: asked, more } = ask(r);
    const place = r.where && !/^(?:a scratch tab|set )/.test(r.where) ? plain(r.where) : null; // a place, never the Work card's "a scratch tab"
    const where = place ? h("p", { className: "snap-room-where", textContent: place }) : null;
    const said = more ? h("p", { className: "snap-room-where", textContent: more }) : null;
    if (r.source === "proposal") {
      const p = P.get(r.proposal);
      return h("section", { className: "snap-room-q" }, h("h2", { textContent: asked }), said, where,
        p?.plan?.eta_s ? h("p", { className: "snap-room-stakes", textContent: `About ${Math.max(1, Math.round(p.plan.eta_s / 60))} minute${Math.round(p.plan.eta_s / 60) > 1 ? "s" : ""} on the GPU.` }) : null, why,
        h("div", { className: "snap-room-verdict" },
          h("button", { className: "snap-primary", textContent: "Yes", onclick: act(async () => { const out = await P.decide(r.proposal, true, run); await answered(asked, out?.status === "accepted" ? `Done: ${plain(typeof out.result === "object" ? out.result?.said ?? asked : asked)}.` : `It couldn't be done: ${plain(out?.result ?? "answered elsewhere")}.`); }) }),
          h("button", { className: "snap-link", textContent: "No", onclick: act(async () => { await P.decide(r.proposal, false, run, { because: why.value.trim() }); await answered(asked, `Left as it is${why.value.trim() ? `: ${why.value.trim()}` : ""}.`); }) })));
    }
    if (r.source === "blind_pair") {
      const side = (s) => { const v = h("video", { src: T.blindUrl(r.pair, s), controls: true, loop: true, muted: true, playsInline: true, className: "snap-room-pic" }); v.addEventListener("error", () => v.replaceWith(h("img", { src: T.blindUrl(r.pair, s), className: "snap-room-pic", alt: "" })), { once: true }); return h("figure", {}, v, h("figcaption", { textContent: s })); };
      const pick = (s) => act(async () => { const out = await T.judgeBlind(r.pair, s, why.value.trim()); await answered(asked, s === "tie" ? "Noted: the same to you." : `Noted: ${s} was take ${T.get(out.labels[s])?.number ?? "?"}.`); });
      return h("section", { className: "snap-room-q" }, h("h2", { textContent: asked }), h("div", { className: "snap-room-pics two" }, side("A"), side("B")), why,
        h("div", { className: "snap-room-verdict" }, h("button", { className: "snap-primary", textContent: "A", onclick: pick("A") }), h("button", { className: "snap-primary", textContent: "B", onclick: pick("B") }), h("button", { className: "snap-link", textContent: "The same", onclick: pick("tie") })));
    }
    if (r.source === "decision") {
      const d = C.get(r.decision), ready = d?.candidates.filter((c) => c.state === "ready") ?? [];
      return h("section", { className: "snap-room-q" }, h("h2", { textContent: asked }), where,
        h("div", { className: "snap-room-pics" }, ready.map((c) => h("figure", {}, pictureOf(c.pictures?.[0]?.media ?? T.get(c.take)?.media?.[0]),
          h("button", { className: "snap-primary", textContent: "This one", onclick: act(async () => { await C.apply(d.id, c.id, "person"); await answered(asked, `Picked: it's in ${place ?? "its place"} now.`); }) })))), why,
        h("div", { className: "snap-room-verdict" }, h("button", { className: "snap-link", textContent: "Neither, same problem", onclick: act(async () => { for (const c of ready) await C.reject(d.id, c.id, "person", { because: why.value.trim() || "neither: the same problem" }); await answered(asked, "None of them: they'll be made again with that in mind."); }) })));
    }
    const t = T.get(r.result.take), notes = r.source === "critique" ? notesOf(r) : [], crit = notes.length ? CR.get(r.result.critique) : null;
    // the boxes go on the picture only where the note was drawn on it (a still's own pixels, not a context picture)
    const boxed = notes.map((n, i) => [n, i + 1]).filter(([n]) => n.region && (!n.take || n.take === t?.id) && ["subject", "tile", undefined].includes(crit?.packet?.pictures?.[n.picture ?? 0]?.role));
    const media = t ? t.media.find((m) => m.kind === "video") ?? t.media[0] : null;
    const pic = media && boxed.length && media.kind !== "video" ? h("div", { className: "snap-room-mark" }, h("img", { src: url(media), className: "snap-room-pic", alt: "" }),
      boxed.map(([n, k]) => h("i", { className: `snap-room-box ${n.severity ?? ""}`, style: `left:${n.region[0] * 100}%;top:${n.region[1] * 100}%;width:${n.region[2] * 100}%;height:${n.region[3] * 100}%` }, h("b", { textContent: String(k) })))) : pictureOf(media);
    const list = notes.length ? h("ol", { className: "snap-room-notes" }, notes.map((n) => h("li", { className: n.severity ?? "" },
      h("p", {}, h("strong", { textContent: `${SEVERITY[n.severity] ?? "A note"}: ` }), said_(n.text)),
      h("p", { className: "snap-room-where", textContent: `It comes from ${bornIn(n.owner)}.${n.fix ? ` What would fix it: ${said_(n.fix).replace(/[.\s]+$/, "")}.` : ""}` }))))
      : r.source === "critique" && r.run ? h("p", { className: "snap-room-where", textContent: "The critic found nothing wrong." }) : null;
    const judge = (v, said) => act(async () => { await T.setVerdict(t, v, { because: why.value.trim() }); await A.opened(t.id); await answered(asked, said, async () => { await T.setVerdict(t, null, { reason: "changed_mind" }); }); });
    return h("section", { className: "snap-room-q" }, h("h2", { textContent: asked }), where, h("div", { className: "snap-room-pics one" }, pic), list, why,
      h("div", { className: "snap-room-verdict" }, h("button", { className: "snap-primary", textContent: "Keep it", onclick: judge("keep", `Kept${place ? `: ${place} can use it` : ""}.`) }),
        h("button", { className: "snap-link", textContent: "Not this one", onclick: judge("reject", "Set aside, with your reason.") }),
        h("button", { className: "snap-link", textContent: "Neither, same problem", onclick: judge("neither", "Noted: the same problem as the others.") })));
  }

  function draw() {
    if (off) return;
    const list = asks();
    if (top && !list.some((r) => r.id === top)) top = null;
    // F-S11 (SNAP-R179 amended): a question asked in the same words as one above waits behind it, so 35 picks of one
    // shot read as one line; the next comes up when that one is answered
    const first = list.find((r) => r.id === top) ?? list[0], seen = new Set(first ? [ask(first).q] : []);
    const rest = list.filter((r) => { if (r === first) return false; const q = ask(r).q; return !seen.has(q) && !!seen.add(q); });
    const now = JSON.stringify([reply, earlier.length, first?.id, first?.state, rest.map((r) => r.id)]);
    if (now === sig || room.matches(":hover") && room.querySelector(".snap-room-why:focus")) return; // SNAP-R7: never under a typing hand
    sig = now;
    replyEl.textContent = reply;
    body.replaceChildren(...[ // filtered: a null child prints "null"
      first ? question(first) : h("section", { className: "snap-room-q quiet" }, h("h2", { textContent: "Nothing waits for you." })),
      rest.length ? h("section", { className: "snap-room-next" }, h("h3", { textContent: "Then" }), rest.map((r) => h("button", { className: "snap-room-line", textContent: ask(r).q, onclick: () => { top = r.id; sig = ""; draw(); } }))) : null,
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
