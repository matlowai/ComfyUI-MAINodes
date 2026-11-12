// The Room (CONCEPT_PRODUCTION §11.2, step 10): the person's front door over the Work card and the docket. The newest
// question on top with its pictures full width, one verdict and a sentence ("neither, same problem" among them), the
// reply saying what that verdict moved, the next questions under it, and "earlier" with "actually, no". It is a second
// renderer of the Work card's rows (activity.js), never its own data: a verdict here is the take's verdict (by:
// person), a pick is apply_candidate, a yes is the proposal's Accept. Machinery is not rendered here (not hidden):
// no ids, file names, model names, state words, counts or progress; every text an agent wrote passes plain().
// On the person's own install the Room is the page at /?room (localhost); a phone door belongs to snap-gate.
// SNAP-R70 the Room never restricts, renders no machinery, and its verdicts are the record's · SNAP-R197 each picture says
// what it is (a still or a frame of a video, its kind and cut), in plain() words; a record change shows its pictures now
// and after (SNAP-R201) · SNAP-R209 out of date offers a re-make · SNAP-R229 either/or is one question, both outcomes side by side · SNAP-R198 Nearby opens on it · SNAP-R179 each question one
// plain sentence naming the thing · SNAP-R180 a critic's row asks its finding, with each note's words and where it was born · SNAP-R173 one verdict and why · SNAP-R174 blind pairs from the server · SNAP-R65 the Work card's rows · SNAP-R7 rebuilt only when its
// content changes, never under a pointer · SNAP-R278 an agent's chat message is built as structured DOM (markdown.mjs), links
// only to http(s) · SNAP-R279 the composer footer says the newest message's receipt state · see docs/snap/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import * as A from "./activity.js";
import * as E from "./engine.js";
import * as Chat from "./conversation.mjs";
import * as MD from "./markdown.mjs";
import { createDraftGuard } from "./draft_guard.js";
import * as D from "./dials.js";
import * as T from "./takes.js";
import * as C from "./candidates.js";
import * as P from "./proposals.js";
import * as W from "./world.js";
import * as B from "./book.js";
import * as CR from "./critiques.js";
import * as N from "./nearby.js";
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
const questionWords = (s) => { const q = questionIn(s); return q ? { q, more: words(s.slice(s.indexOf(q) + q.length)) || null } : null; };
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
  // SNAP-R179: keep the explanation after an agent question beneath its heading.
  if (own) return questionWords(w);
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
    if (r.question) { const w = words(r.question), own = questionIn(w); if (own || w) return questionWords(w) ?? { q: `${bare(cap(noAsides(w)))}?` }; } // F-Q21: the agent's own question for its candidates
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
  const out = list.filter((r) => !(r.source === "prompt" && read.has(r.result?.take))).map((r) => (r.source === "critique" && runs.has(r.result?.take) ? { ...r, run: runs.get(r.result.take) } : r));
  // SNAP-R229: proposals that are either/or (one record, one version) are one question, asked on the first of them
  const folded = new Set();
  return out.flatMap((r) => {
    if (r.source !== "proposal" || !r.either_or?.length || r.stale) return [r];
    if (folded.has(r.proposal)) return [];
    const rivals = out.filter((x) => x.source === "proposal" && r.either_or.includes(x.proposal) && !x.stale);
    for (const x of rivals) folded.add(x.proposal);
    return [rivals.length ? { ...r, rivals } : r];
  });
};
const briefRow = (r) => r.title?.startsWith("Timed trial 0") || r.title?.startsWith("Baseline ·") ? "Baseline" : r.title?.startsWith("Timed trial ") || r.title?.startsWith("Envelope trial ·") ? "Envelope trial" : r.title?.match(/^Dial preview ([+-]?[\d.]+)/)?.[0] ?? ask(r).q;
const pictureOf = (m) => m && (m.kind === "video" ? h("video", { src: url(m), controls: true, loop: true, muted: true, playsInline: true, className: "snap-room-pic" }) : h("img", { src: url(m), className: "snap-room-pic", alt: "" }));

export function openRoom({ say } = {}) {
  for (const s of document.querySelectorAll(".snap-room")) s.dispatchEvent(new Event("snap-room-close"));
  const earlier = []; // this visit's verdicts, newest first: [what was asked, what was said, undo or null]
  let reply = "", sig = "", top = null;
  const run = async (name, args) => (await import("./tools.js")).callTool(name, args, { confirmed: true });
  const body = h("main", { className: "snap-room-body" }), replyEl = h("p", { className: "snap-room-reply", role: "status" });
  // SNAP-R70: keep the project visible around the conversation, and name the live workspace.
  const context = h("strong", { className: "snap-room-context" });
  const room = h("div", { className: "snap-room", role: "dialog", ariaLabel: "Project conversation", tabIndex: -1 },
    h("header", { className: "snap-room-head" }, h("div", { className: "snap-room-heading" }, h("span", { textContent: "Conversation", className: "snap-room-where" }), context), h("span", { className: "snap-spacer" }), h("button", { className: "snap-link", textContent: "Close", onclick: () => close() })),
    replyEl, body);
  // SNAP-R70/R7: one workspace, freely selectable views; dependency edges inform rather than restrict browsing.
  let activeTab = "decisions";
  const artifacts = h("div", { className: "snap-room-artifacts" });
  const resultList = h("div", { className: "snap-room-result-list" });
  const results = h("section", { className: "snap-room-results", role: "tabpanel" }, resultList, artifacts);
  const map = h("nav", { className: "snap-room-map", ariaLabel: "Project needs and decisions" });
  const tabs = h("div", { className: "snap-room-tabs", role: "tablist", ariaLabel: "Project workspace views" });
  const chooseTab = (name) => {
    map.style.display = name === "decisions" ? "" : "none";
    activeTab = name; body.hidden = name !== "decisions"; messages.hidden = name !== "conversation"; results.hidden = name !== "results";
    if (name === "conversation") queueMicrotask(() => { messages.scrollTop = messages.scrollHeight; });
    for (const button of tabs.children) { button.setAttribute("aria-selected", String(button.dataset.view === name)); button.tabIndex = button.dataset.view === name ? 0 : -1; }
  };
  for (const [name, label] of [["conversation", "Conversation"], ["decisions", "Decisions"], ["results", "Results"]]) {
    const button = h("button", { role: "tab", textContent: label, onclick: () => chooseTab(name) }); button.dataset.view = name; tabs.append(button);
  }
  tabs.addEventListener("keydown", (e) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return; e.preventDefault(); const choices = [...tabs.children], index = choices.findIndex((b) => b.dataset.view === activeTab), next = e.key === "Home" ? 0 : e.key === "End" ? choices.length - 1 : (index + (e.key === "ArrowRight" ? 1 : -1) + choices.length) % choices.length; chooseTab(choices[next].dataset.view); choices[next].focus(); });
  room.insertBefore(map, replyEl); room.insertBefore(tabs, body); room.append(results);
  room.addEventListener("snap-room-results", () => chooseTab("results"));
  const close = () => { removeEventListener("resize", fitWorkspace); removeEventListener("pointermove", moveGesture, true); removeEventListener("pointerup", endGesture, true); removeEventListener("pointercancel", endGesture, true); removeEventListener("blur", endGesture); unsubscribeNotes(); unsubscribeConversation(); activityListeners.delete(draw); room.remove(); off = true; };
  room.addEventListener("snap-room-close", close);
  let off = false;
  const answered = async (asked, said, undo = null) => { reply = said; earlier.unshift([asked, said, undo]); sig = ""; await A.reconcile(); draw(); };
  // SNAP-R70/R7: ordinary chat uses its durable journal; director notes and creative approvals keep their owners.
  let composerProject = app.graph.id;
  const draftKey = (project = app.graph.id) => `snap-conversation:${project}`;
  const composer = h("textarea", { className: "snap-room-why snap-note-input", rows: 2, placeholder: "Talk to your agent…", ariaLabel: "Message your agent", value: sessionStorage.getItem(draftKey()) ?? "" });
  const delivery = h("p", { className: "snap-room-where", role: "status", textContent: Chat.COMPOSE_HINT });
  delivery.sent = null; delivery.failed = null; // SNAP-R279: the last acknowledged send and a failed one; draw() says the rest from the journal
  const bodies = new Map(); // SNAP-R278: message id -> [its text, its rendered body]: only a message whose text changed is parsed again
  const messages = h("div", { className: "snap-room-messages", role: "log", ariaLabel: "Messages and agent replies" });
  const connectionStatus = h("p", { className: "snap-room-where", role: "status" });
  const disconnect = h("button", { className: "snap-link", textContent: "Disconnect agent", onclick: () => {
    Chat.disconnect(app.graph.id).catch((e) => say?.(e.message, true));
  } });
  const requests = h("div", { className: "snap-conversation-requests" });
  const requestDrafts = new Map(); let requestSig = "";
  const connectionBar = h("div", { className: "snap-conversation-connection" }, connectionStatus, disconnect);
  const drawConnection = () => {
    const c = Chat.snapshot(app.graph.id); connectionStatus.textContent = c.error ? `Conversation connection: ${c.error}` : Chat.connectionLabel(c.connection); disconnect.hidden = !c.connection;
  };
  let watchedProject = app.graph.id, unsubscribeConversation = () => {};
  let sentDraft = null, sending = false;
  const grow = () => { composer.style.height = "auto"; composer.style.height = `${composer.scrollHeight}px`; };
  const draftGuard = createDraftGuard({ read: () => composer.value, project: () => app.graph.id,
    clear: (snapshot) => { composer.value = ""; sessionStorage.removeItem(draftKey(snapshot.project)); grow(); } });
  const syncDraftProject = () => {
    if (composerProject === app.graph.id) return;
    sessionStorage.setItem(draftKey(composerProject), composer.value);
    composerProject = app.graph.id;
    unsubscribeConversation(); watchedProject = app.graph.id; unsubscribeConversation = Chat.watch(watchedProject, draw);
    composer.value = sessionStorage.getItem(draftKey()) ?? "";
    draftGuard.changed(); sentDraft = null; grow();
    for (const card of artifacts.children) card.hidden = true;
    delivery.sent = null; delivery.failed = null; bodies.clear();
  };
  const sendMessage = async ({ clear = true, wake = true } = {}) => {
    if (sending) throw new Error("Your message is still sending; wait before applying another action.");
    const snapshot = draftGuard.capture(), text = snapshot.value.trim();
    if (!text) return snapshot;
    sending = true; send.disabled = true;
    try {
      if (!sentDraft || sentDraft.snapshot.project !== snapshot.project || sentDraft.snapshot.revision !== snapshot.revision) {
        sentDraft = { id: crypto.randomUUID(), snapshot, context: { workflow: app.extensionManager.workflow.activeWorkflow?.filename,
          view: activeTab, decision: top, dial: [...artifacts.children].find((x) => !x.hidden)?.dataset.dial ?? null,
          trial: [...artifacts.children].find((x) => !x.hidden)?.snapAgentContext?.() ?? null } };
      }
      const attempt = sentDraft;
      await Chat.send(snapshot.project, text, attempt.context, attempt.id, wake);
      if (clear && sentDraft === attempt) sentDraft = null;
      delivery.sent = { id: attempt.id, wake }; delivery.failed = null;
      if (clear) draftGuard.clearIfCurrent(snapshot);
      sig = ""; draw();
      return snapshot;
    } catch (e) { delivery.failed = delivery.textContent = `Not sent yet: ${e.message}. Your text is kept; try Send again.`; throw e; }
    finally { sending = false; send.disabled = false; }
  };
  const send = h("button", { className: "snap-primary", textContent: "Send", onclick: () => sendMessage().catch(() => {}) });
  composer.addEventListener("input", () => { draftGuard.changed(); sessionStorage.setItem(draftKey(), composer.value); grow(); });
  composer.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage().catch(() => {}); }
  });
  room.append(connectionBar, requests, messages, h("div", { className: "snap-room-compose" }, composer, h("div", { className: "snap-room-compose-actions" }, delivery, send)));
  room.insertBefore(results, messages);
  chooseTab(activeTab);
  let acting = false, actionWhy = null;
  const act = (fn) => async () => {
    if (acting) return;
    acting = true;
    try {
      const snapshot = await sendMessage({ clear: false, wake: false });
      actionWhy = snapshot.value;
      await fn();
      if (draftGuard.clearIfCurrent(snapshot)) sentDraft = null;
    } catch (e) { reply = plain(e.message); sig = ""; draw(); say?.(e.message, true); }
    finally { acting = false; actionWhy = null; }
  };
  const sentence = () => ({ get value() { return actionWhy ?? composer.value; } });

  const shown = (ref, label) => { const m = ref && N.srcOf(ref); return h("figure", {}, m ? (m.kind === "video" ? h("video", { src: m.src, controls: true, playsInline: true, className: "snap-room-pic" }) : h("img", { src: m.src, className: "snap-room-pic", alt: "" })) : h("div", { className: "snap-room-pic snap-room-none", textContent: "no picture" }),
    h("figcaption", { textContent: label }), ref ? N.whatEl(ref, { room: true, words: plain, say, more: false }) : null); };
  // SNAP-R229: either/or is one question: the record as it is now, then each suggestion's "after" pictures side by side,
  // one Yes per side; the other side is withdrawn naming the one chosen
  function eitherOr(r, why) {
    const options = [r, ...r.rivals].map((x, i) => ({ row: x, p: P.get(x.proposal), n: i + 1 })).map((o) => ({ ...o, ch: N.changeOf(o.p), said: ask(o.row).q }));
    const name = options.find((o) => o.ch)?.ch?.name ?? "the same thing", now = options.find((o) => o.ch)?.ch;
    const asked = plain(`${options.length === 2 ? "Two" : options.length} suggestions for ${name}: which one?`);
    const choose = (o) => act(async () => {
      const out = await P.decide(o.row.proposal, true, run);
      if (out?.status !== "accepted") return answered(asked, `It couldn't be done: ${plain(out?.result ?? "answered elsewhere")}.`);
      const others = options.filter((x) => x !== o).map((x) => x.row.proposal);
      await P.withdraw((x) => others.includes(x.id), `either/or: the person chose ${o.row.proposal} instead`);
      await answered(asked, `Done: suggestion ${o.n} it is; the other ${others.length > 1 ? "ones are" : "one is"} set aside.`);
    });
    return h("section", { className: "snap-room-q snap-room-either" }, h("h2", { textContent: asked }),
      h("p", { className: "snap-room-stakes", textContent: "Either one or the other: they change the same thing from the same version." }),
      h("div", { className: "snap-room-pics" }, now ? h("figure", { className: "snap-room-option now" }, h("h3", { textContent: "As it is" }), h("p", { className: "snap-room-where", textContent: plain(`${name} now`) }), shown(now.pairs[0]?.before, plain(`${cap(now.pairs[0]?.part ?? "it")} now`))) : null,
        options.map((o) => h("figure", { className: "snap-room-option" },
        h("h3", { textContent: `Suggestion ${o.n}` }), h("p", { className: "snap-room-where", textContent: o.said }), ask(o.row).more ? h("p", { className: "snap-room-where", textContent: ask(o.row).more }) : null,
        (o.ch?.pairs ?? []).map((x) => shown(x.after, plain(`${cap(x.part)} after`))),
        h("button", { className: "snap-primary", textContent: `Yes to suggestion ${o.n}`, onclick: choose(o) })))),
      h("div", { className: "snap-room-verdict" }, h("button", { className: "snap-link", textContent: "Neither", onclick: act(async () => { for (const o of options) await P.decide(o.row.proposal, false, run, { because: why.value.trim() }); await answered(asked, `Left as it is${why.value.trim() ? `: ${why.value.trim()}` : ""}.`); }) })));
  }
  // one question, whole
  function question(r) {
    const why = sentence(), { q: asked, more } = ask(r);
    const place = r.where && !/^(?:a scratch tab|set )/.test(r.where) ? plain(r.where) : null; // a place, never the Work card's "a scratch tab"
    const where = place ? h("p", { className: "snap-room-where", textContent: place }) : null;
    const said = more ? h("p", { className: "snap-room-where", textContent: more }) : null;
    if (r.source === "proposal" && r.rivals) return eitherOr(r, why);
    if (r.source === "proposal") {
      const p = P.get(r.proposal), ch = N.changeOf(p); // F-Y11: a record change shows each picture now and after
      const side = (ref, label) => { const m = ref && N.srcOf(ref); return h("figure", {}, m ? (m.kind === "video" ? h("video", { src: m.src, controls: true, playsInline: true, className: "snap-room-pic" }) : h("img", { src: m.src, className: "snap-room-pic", alt: "" })) : h("div", { className: "snap-room-pic snap-room-none", textContent: "no picture" }),
        h("figcaption", { textContent: label }), ref ? N.whatEl(ref, { room: true, words: plain, say, more: false }) : null); };
      // SNAP-R209: out of date offers a re-make, never a yes; either/or says what a yes does to the other
      const moved = r.stale ? h("p", { className: "snap-room-stakes", textContent: plain(`${r.stale.name} has changed since this was asked (v${r.stale.from} → v${r.stale.to}), so it would be made again on v${r.stale.to}.`) }) : null;
      const other = !r.stale && r.either_or ? h("p", { className: "snap-room-stakes", textContent: plain(`Either this or ${r.either_or.length > 1 ? `${r.either_or.length} other suggestions` : "another suggestion"} for ${ch?.name ?? "the same thing"}: a yes to one leaves the other out of date.`) }) : null;
      return h("section", { className: "snap-room-q snap-proposal" }, h("h2", { textContent: asked }), said, where, moved, other,
        ch ? [N.whatEl(ch.ref, { room: true, words: plain, say, more: false }), ch.pairs.map((x) => h("div", { className: "snap-room-pics two" }, side(x.before, plain(`${cap(x.part)} now`)), side(x.after, plain(`${cap(x.part)} after`))))] : null,
        p?.plan?.runs ? h("p", { className: "snap-room-stakes", textContent: plain(p.plan.runs) }) : null,
        p?.plan?.eta_s ? h("p", { className: "snap-room-stakes", textContent: `About ${Math.max(1, Math.round(p.plan.eta_s / 60))} minute${Math.round(p.plan.eta_s / 60) > 1 ? "s" : ""} on the GPU.` }) : null,
        h("div", { className: "snap-room-verdict" },
          r.stale ? h("button", { className: "snap-primary", textContent: `Make it again on v${r.stale.to}`, onclick: act(async () => { await P.remake(r.proposal); await answered(asked, `It will be asked again, made on v${r.stale.to}.`); }) }) :
          h("button", { className: "snap-accept", textContent: "Accept", onclick: act(async () => { const out = await P.decide(r.proposal, true, run); await answered(asked, out?.status === "accepted" ? `Done: ${plain(typeof out.result === "object" ? out.result?.said ?? asked : asked)}.` : `It couldn't be done: ${plain(out?.result ?? "answered elsewhere")}.`); }) }),
          h("button", { className: "snap-reject", textContent: "Reject", onclick: act(async () => { await P.decide(r.proposal, false, run, { because: why.value.trim() }); await answered(asked, `Left as it is${why.value.trim() ? `: ${why.value.trim()}` : ""}.`); }) })));
    }
    if (r.source === "blind_pair") {
      const side = (s) => { const v = h("video", { src: T.blindUrl(r.pair, s), controls: true, loop: true, muted: true, playsInline: true, className: "snap-room-pic" }); v.addEventListener("error", () => v.replaceWith(h("img", { src: T.blindUrl(r.pair, s), className: "snap-room-pic", alt: "" })), { once: true }); return h("figure", {}, v, h("figcaption", { textContent: s })); };
      const pick = (s) => act(async () => { const out = await T.judgeBlind(r.pair, s, why.value.trim()); await answered(asked, s === "tie" ? "Noted: the same to you." : `Noted: ${s} was take ${T.get(out.labels[s])?.number ?? "?"}.`); });
      return h("section", { className: "snap-room-q snap-proposal" }, h("h2", { textContent: asked }), h("div", { className: "snap-room-pics two" }, side("A"), side("B")),
        h("div", { className: "snap-room-verdict" }, h("button", { className: "snap-primary", textContent: "A", onclick: pick("A") }), h("button", { className: "snap-primary", textContent: "B", onclick: pick("B") }), h("button", { className: "snap-link", textContent: "The same", onclick: pick("tie") })));
    }
    if (r.source === "decision") {
      const d = C.get(r.decision), ready = d?.candidates.filter((c) => c.state === "ready") ?? [];
      // SNAP-R197: each candidate says what it is; what they were made from is the pick's, said once above them
      const take = (c) => c.take ?? `take-${c.prompt_id}`, made = ready.find((c) => T.get(take(c)));
      return h("section", { className: "snap-room-q snap-proposal" }, h("h2", { textContent: asked }), said, where,
        made ? N.whatEl(take(made), { room: true, words: plain, line: false, button: false }) : null,
        h("div", { className: "snap-room-pics" }, ready.map((c) => h("figure", {}, pictureOf(c.pictures?.[0]?.media ?? T.get(c.take)?.media?.[0]), T.get(take(c)) ? N.whatEl(take(c), { room: true, words: plain, say, more: false }) : null,
          h("button", { className: "snap-primary", textContent: "This one", onclick: act(async () => { await C.apply(d.id, c.id, "person"); await answered(asked, `Picked: it's in ${place ?? "its place"} now.`); }) })))),
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
    return h("section", { className: "snap-room-q snap-proposal" }, h("h2", { textContent: asked }), said, where, h("div", { className: "snap-room-pics one" }, pic), t ? N.whatEl(t.id, { room: true, words: plain, say }) : null, list,
      h("div", { className: "snap-room-verdict" }, h("button", { className: "snap-primary", textContent: "Keep it", onclick: judge("keep", `Kept${place ? `: ${place} can use it` : ""}.`) }),
        h("button", { className: "snap-link", textContent: "Not this one", onclick: judge("reject", "Set aside, with your reason.") }),
        h("button", { className: "snap-link", textContent: "Neither, same problem", onclick: judge("neither", "Noted: the same problem as the others.") })));
  }

  // SNAP-R278: an agent's words as paragraphs, lists, code and links (http(s) only), built from text; a streamed message
  // re-parses only itself, the others keep their built body
  const agentBody = (m) => {
    const text = String(m.text ?? ""), was = bodies.get(m.id);
    if (was?.[0] === text) return was[1];
    const el = h("div", { className: "snap-md" }, ...MD.render(MD.parse(text), h)); bodies.set(m.id, [text, el]); return el;
  };
  function draw() {
    if (off) return;
    syncDraftProject(); drawConnection();
    context.textContent = app.extensionManager.workflow.activeWorkflow?.filename?.replace(/\.json$/, "") ?? "Open project";
    const list = asks().filter((r) => r.source !== "proposal" || !P.get(r.proposal)?.graph || P.get(r.proposal).graph === app.graph.id);
    if (top && !list.some((r) => r.id === top)) top = null;
    // F-S11 (SNAP-R179 amended): a question asked in the same words as one above waits behind it, so 35 picks of one
    // shot read as one line; the next comes up when that one is answered
    const first = list.find((r) => r.id === top) ?? list[0], seen = new Set(first ? [ask(first).q] : []);
    const rest = list.filter((r) => { if (r === first) return false; const q = ask(r).q; return !seen.has(q) && !!seen.add(q); });
    const journal = Chat.snapshot(app.graph.id), conversation = journal.messages, connection = journal.connection;
    delivery.textContent = delivery.failed ?? Chat.deliveryLine(conversation, connection, delivery.sent); // SNAP-R279: from the receipts, before the unchanged-content return
    const openMedia = (row) => {
      const take = T.get(row.result.take);
      for (const card of artifacts.children) card.hidden = true;
      let card = [...artifacts.children].find((x) => x.dataset.take === take.id);
      if (!card) { card = h("section", { className: "snap-room-media-result" }, h("h3", { textContent: briefRow(row) }), ...take.media.map(pictureOf)); card.dataset.take = take.id; artifacts.append(card); }
      card.hidden = false; chooseTab("results");
    };
    const proposals = P.all().filter((p) => !P.get(p.id)?.graph || P.get(p.id).graph === app.graph.id);
    const dialResults = proposals.filter((p) => p.status === "accepted" && p.result?.dial);
    const jobs = A.all().filter((r) => r.source === "prompt" && r.about?.group === app.graph.id);
    const landed = jobs.filter((r) => r.result?.take && T.get(r.result.take)?.media?.length);
    const now = JSON.stringify([conversation, journal.requests, journal.activities, E.notes(), connection && { id: connection.id, provider: connection.provider, online: connection.online, phase: connection.phase, error: connection.error, requests: connection.requests }, proposals, jobs, reply, earlier.length, first?.id, first?.state, first ? ask(first) : null, rest.map((r) => [r.id, ask(r)])]);
    if (now === sig) return; // SNAP-R7: never under a typing hand
    sig = now;
    replyEl.textContent = reply;
    const wasAtEnd = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 60;
    messages.replaceChildren(...conversation.map((m) => h("article", { className: "snap-room-message" },
      h("strong", { textContent: m.role === "human" ? "You" : m.agent ?? "Agent" }), m.role === "human" ? h("p", { textContent: m.text }) : agentBody(m),
      m.context?.trial ? h("p", { className: "snap-blurb", textContent: `Attached: ${m.context.trial.frames} frames · ${m.context.trial.label}` }) : null,
      m.role === "human" ? h("small", { textContent: m.error ?? ({ saved: "Saved · waiting for agent", recorded: "Recorded with your decision", sending: "Sending…", delivered: "Delivered", completed: "Replied", uncertain: "Delivery uncertain · not resent", failed: "Delivery failed", interrupted: "Interrupted" }[m.state] ?? m.state) }) : null)),
      ...(journal.activities.length ? [h("details", { className: "snap-room-message" }, h("summary", { textContent: `Agent activity (${journal.activities.length})` }),
        ...journal.activities.map((a) => h("details", {}, h("summary", { textContent: `${a.title} · ${a.state}` }), h("pre", { textContent: JSON.stringify(a.details, null, 2) }))))] : []),
      ...(E.notes().length ? [h("details", { className: "snap-room-message" }, h("summary", { textContent: "Project notes" }),
        ...E.notes().map((n) => h("section", {}, h("p", { textContent: n.text }), n.reply ? h("p", { textContent: n.reply }) : null)))] : []));
    if (wasAtEnd) messages.scrollTop = messages.scrollHeight;
    const nextRequestSig = JSON.stringify([journal.requests, connection?.epoch, connection?.online]);
    if (nextRequestSig !== requestSig) { requestSig = nextRequestSig; requests.replaceChildren(...(journal.requests ?? []).map((request) => {
      const fields = new Map();
      const respond = (response) => { try { Chat.respond(app.graph.id, request.id, response).catch((e) => say?.(e.message, true)); } catch (e) { say?.(e.message, true); } };
      return h("section", { className: "snap-room-message" }, h("h3", { textContent: request.title }),
        h("p", { textContent: request.body }),
        request.details ? h("details", {}, h("summary", { textContent: "Request details" }), h("pre", { textContent: JSON.stringify(request.details, null, 2) })) : null,
        ...(request.questions ?? []).map((q) => {
          const draftId = `${request.id}:${q.id}`, input = h("textarea", { rows: 2, ariaLabel: q.prompt, value: requestDrafts.get(draftId) ?? "" }); fields.set(q.id, input);
          input.addEventListener("input", () => requestDrafts.set(draftId, input.value));
          return h("label", {}, h("span", { textContent: q.prompt }),
            ...(q.options ?? []).map((o) => h("button", { textContent: o, onclick: () => { input.value = o; requestDrafts.set(draftId, o); } })), input);
        }),
        ...(request.choices ?? []).map((c) => h("button", { className: c.id === "accept" ? "snap-accept" : "snap-link", textContent: c.label,
          disabled: !!request.response || !connection?.online || request.controller !== connection?.epoch, onclick: () => respond({ choice: c.id }) })),
        request.questions?.length ? h("button", { textContent: "Send answer", disabled: !!request.response || !connection?.online || request.controller !== connection?.epoch,
          onclick: () => respond({ answers: Object.fromEntries([...fields].map(([id, input]) => [id, input.value])) }) }) : null,
        request.response ? h("p", { textContent: "Answer sent · waiting for agent" }) : null);
    })); }

    map.replaceChildren(h("strong", { textContent: "Project map" }),
      h("p", { className: "snap-blurb", textContent: "Explore any branch · links show recorded dependencies" }),
      ...proposals.map((p) => {
        const deps = (p.needs ?? []).map((id) => P.get(id));
        const unmet = deps.filter((d) => !d || d.status !== "accepted");
        const select = () => { if (p.status === "waiting") { top = `p:${p.id}`; sig = ""; draw(); chooseTab("decisions"); } else if (p.result?.dial) D.openResult(document.querySelector(".snap-root"), p.result).catch((e) => say?.(e.message, true)); else chooseTab("results"); };
        return h("div", { className: "snap-room-map-node snap-proposal" },
          h("button", { className: "snap-room-map-pick", textContent: `${p.status === "waiting" ? unmet.length ? "Waiting" : "Ready" : p.status === "accepted" ? "Made" : p.status} · ${p.result?.dial ? D.title(D.find(p.result.dial) ?? { dial: p.result.dial }) : p.tool === "make_dial" ? `Create ${D.title({ dial: p.args.name ?? "dial" })}` : ask({ source: "proposal", proposal: p.id, title: p.reason ?? p.tool }).q}`, onclick: select }),
          deps.length ? h("div", { className: "snap-room-map-deps" }, "↳ Needs ", deps.map((d) => h("button", { className: "snap-link", textContent: d ? `${questionWords(words(d.reason ?? d.tool))?.q ?? words(d.reason ?? d.tool)} (${d.status})` : "Unknown prerequisite", onclick: () => { if (d?.status === "waiting") { top = `p:${d.id}`; sig = ""; draw(); chooseTab("decisions"); } else if (d?.result?.dial) D.openResult(document.querySelector(".snap-root"), d.result).catch((e) => say?.(e.message, true)); } }))) : null);
      }),
      ...list.filter((r) => r.source !== "proposal").map((r) => h("button", { className: "snap-room-map-pick", textContent: `Review · ${briefRow(r)}`, onclick: () => { top = r.id; sig = ""; draw(); chooseTab("decisions"); } })),
      ...jobs.filter((r) => ["queued", "running", "failed"].includes(r.state)).map((r) => h("button", { className: "snap-room-map-pick", textContent: `${r.state} · ${plain(r.title)}`, onclick: () => chooseTab("results") })));
    resultList.replaceChildren(...dialResults.map((p) => h("button", { className: "snap-room-line", textContent: D.title(D.find(p.result.dial) ?? { dial: p.result.dial }), onclick: () => D.openResult(document.querySelector(".snap-root"), p.result).catch((e) => say?.(e.message, true)) })),
      ...landed.map((r) => h("button", { className: "snap-room-line", textContent: briefRow(r), onclick: () => openMedia(r) })));
    tabs.children[0].textContent = `Conversation (${conversation.length})`; tabs.children[1].textContent = `Decisions (${list.length})`; tabs.children[2].textContent = `Results (${dialResults.length + landed.length})`;
    body.replaceChildren(...[ // filtered: a null child prints "null"
      first ? question(first) : h("section", { className: "snap-room-q quiet" }, h("h2", { textContent: "No approval needed right now. You can still message your agent below." })),
      ...dialResults.map((p) => h("section", { className: "snap-room-message" }, h("strong", { textContent: "Dial created" }),
        h("p", { textContent: D.title(D.find(p.result.dial) ?? { dial: p.result.dial }) }),
        h("button", { className: "snap-link", textContent: "Try with project", onclick: () => D.openResult(document.querySelector(".snap-root"), p.result).catch((e) => say?.(e.message, true)) }))),
      rest.length ? h("section", { className: "snap-room-next" }, h("h3", { textContent: "Then" }), rest.map((r) => h("button", { className: "snap-room-line", textContent: briefRow(r), onclick: () => { top = r.id; sig = ""; draw(); } }))) : null,
      earlier.length ? h("section", { className: "snap-room-earlier" }, h("h3", { textContent: "Earlier" }), earlier.map(([asked, said, undo], i) => h("div", { className: "snap-room-line" }, h("span", { textContent: `${asked}: ${said}` }),
        undo ? h("button", { className: "snap-link", textContent: "actually, no", onclick: act(async () => { await undo(); earlier[i][1] = `${said} (taken back)`; earlier[i][2] = null; reply = "Taken back."; sig = ""; draw(); }) }) : null))) : null].filter(Boolean));
  }
  const activityListeners = A.onChange(draw);
  const unsubscribeNotes = E.onNotesChange(draw);
  unsubscribeConversation = Chat.watch(watchedProject, draw);
  Promise.all([T.load(), C.load(), P.load(), W.load(), N.load()]).then(() => A.reconcile()).then(draw, (e) => { reply = plain(e.message); draw(); });
  (document.querySelector(".snap-root") ?? document.body).append(room); // inside Snap's root: its colours, above its sheets
  // SNAP-R70: a single movable, resizable workspace; layout is a browser preference, not project canon.
  const layoutKey = "MAINodes.Snap.WorkspaceLayout";
  const layout = () => ({ left: room.offsetLeft, top: room.offsetTop, width: room.offsetWidth, height: room.offsetHeight });
  const fit = (value) => {
    const host = room.parentElement, maxWidth = Math.max(1, host.clientWidth - 24), maxHeight = Math.max(1, host.clientHeight - 66);
    const width = Math.min(maxWidth, Math.max(Math.min(360, maxWidth), value.width)), height = Math.min(maxHeight, Math.max(Math.min(360, maxHeight), value.height));
    Object.assign(room.style, { maxHeight: `${maxHeight}px`, width: `${width}px`, height: `${height}px`, left: `${Math.max(0, Math.min(host.clientWidth - width - 12, value.left))}px`, top: `${Math.max(54, Math.min(host.clientHeight - height - 12, value.top))}px` });
  };
  let userPosition = false;
  const defaultLeft = () => {
    const host = room.parentElement, rail = host.querySelector(".snap-rail");
    const railRight = rail ? rail.getBoundingClientRect().right - host.getBoundingClientRect().left : 0;
    return Math.max(12, Math.min(railRight + 12, host.clientWidth - room.offsetWidth - 12));
  };
  const saveLayout = () => localStorage.setItem(layoutKey, JSON.stringify({ ...layout(), userPosition }));
  const fitWorkspace = () => fit(layout());
  try {
    const stored = JSON.parse(localStorage.getItem(layoutKey));
    if (stored && ["left", "top", "width", "height"].every((k) => Number.isFinite(stored[k]))) { userPosition = stored.userPosition === true; fit(stored); }
  } catch { /* an invalid older preference leaves the default layout */ }
  if (!userPosition) fit({ ...layout(), left: defaultLeft() });
  let gesture = null;
  const startGesture = (e, edge) => {
    if (e.button !== 0) return;
    gesture = { ...layout(), x: e.clientX, y: e.clientY, edge, pointer: e.pointerId }; room.setPointerCapture(e.pointerId); e.preventDefault(); e.stopPropagation();
  };
  room.querySelector(".snap-room-head").addEventListener("pointerdown", (e) => { if (!e.target.closest("button,input,textarea,a")) startGesture(e, "move"); });
  for (const edge of ["right", "bottom", "corner"]) {
    const handle = h("div", { className: `snap-room-resize ${edge}`, role: "separator", tabIndex: 0, ariaLabel: `Resize workspace ${edge}`, title: "Drag to resize · arrow keys adjust size" });
    handle.addEventListener("pointerdown", (e) => startGesture(e, edge));
    handle.addEventListener("keydown", (e) => { if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return; e.preventDefault(); e.stopPropagation(); const value = layout(), step = e.shiftKey ? 40 : 10; if (e.key === "ArrowLeft") value.width -= step; if (e.key === "ArrowRight") value.width += step; if (e.key === "ArrowUp") value.height -= step; if (e.key === "ArrowDown") value.height += step; fit(value); saveLayout(); });
    room.append(handle);
  }
  const moveGesture = (e) => {
    if (!gesture) return;
    if (!(e.buttons & 1)) { endGesture(); return; }
    if (e.pointerId !== gesture.pointer) return;
    e.preventDefault(); e.stopPropagation();
    const dx = e.clientX - gesture.x, dy = e.clientY - gesture.y, value = { ...gesture };
    if (gesture.edge === "move") { value.left += dx; value.top += dy; }
    else { if (gesture.edge !== "bottom") value.width += dx; if (gesture.edge !== "right") value.height += dy; }
    fit(value);
  };
  const endGesture = () => { if (gesture) { if (gesture.edge === "move") userPosition = true; saveLayout(); } gesture = null; };
  room.addEventListener("lostpointercapture", (e) => { if (!(e.buttons & 1)) endGesture(); });
  addEventListener("pointermove", moveGesture, true);
  addEventListener("pointerup", endGesture, true); addEventListener("pointercancel", endGesture, true); addEventListener("blur", endGesture);
  addEventListener("resize", fitWorkspace);
  room.focus({ preventScroll: true });
  draw();
  grow();
  return room;
}
