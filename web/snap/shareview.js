// The example picker, the Share… sheet and a share file's preview sheet (share.js does the work). Everything a share
// file holds reaches the page as textContent or as a validated data:image picture, never as HTML (SNAP-R289); Download
// and Copy hand the person a file or text, nothing is sent anywhere (SNAP-R18). Importing is "Add to my Library" first;
// adding it to the open recipe or opening it in a new tab are offered only after that (SNAP-R290).
// SNAP-R287 an example is the person's pick from this graph's takes · SNAP-R288 the sheet shows includes / leaves out
// before the download · SNAP-R289 untrusted text · SNAP-R290 Library first · SNAP-R5 a new tab for new work · see docs/snap/SNAP_RULES.md
import * as S from "./share.js";
import * as T from "./takes.js";
import * as L from "./library.js";
import * as R from "./recipes.js";
import * as M from "./models.js";
import { pickTake } from "./takepicker.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const lines = (list) => h("ul", { className: "snap-share-list" }, list.map((x) => h("li", { textContent: x })));
const exampleEl = (ex) => (ex && S.safeImage(ex.image) ? h("figure", { className: "snap-share-example" }, h("img", { src: ex.image, alt: ex.caption ?? "example", width: ex.w, height: ex.h }), ex.caption ? h("figcaption", { textContent: ex.caption }) : null) : null);
function sheet(host, title, body) {
  host.querySelector(".snap-share-sheet")?.remove();
  const close = () => { el.remove(); host.focus({ preventScroll: true }); };
  const el = h("div", { className: "snap-sheet snap-setup-sheet snap-share-sheet", role: "dialog", ariaLabel: title },
    h("header", {}, h("strong", { textContent: title }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })), body);
  el.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  host.append(el);
  el.tabIndex = -1; el.focus();
  return { el, close };
}

// "Use a take as the example…": this graph's takes; the press is the person's pick for this one card
export function pickExample(host, ref, { say, onDone = () => {} }) {
  const group = T.groupOf();
  return pickTake(host, { title: "Use a take as the example", only: (t) => t.group === group,
    pick: (t) => S.setExample(ref, t.id).then((out) => { say(out.said); onDone(out); }, (err) => say(err.message, true)) }).catch((err) => say(err.message, true));
}

// Share…: the card at one version (the newest without one), what the file includes and leaves out, the prompt switch,
// Download and Copy
export async function openShareSheet(host, ref, { version, say, onChange = () => {} }) {
  const c = S.cardOf(ref, version), body = h("div", { className: "snap-share-body" });
  const { close } = sheet(host, `Share ${c.title}${c.kind === "recipe" ? ` · v${c.version.n}` : ""}`, body);
  const quiet = h("input", { type: "checkbox" });
  let share = null;
  const draw = async () => {
    try { share = await S.shareOf(ref, { version, prompt: !quiet.checked }); } catch (err) { body.replaceChildren(h("div", { className: "snap-quiet", textContent: err.message })); return; }
    const ex = exampleEl(share.card.example);
    body.replaceChildren(
      ex ?? h("div", { className: "snap-share-none" }, h("span", { textContent: "No example yet: add one so people can see what it does. " }),
        h("button", { className: "snap-link", textContent: "Use a take as the example…", onclick: () => { close(); pickExample(host, c.id, { say, onDone: () => { onChange(); openShareSheet(host, c.id, { say, onChange }); } }); } })), // the example is on the newest version
      h("div", { className: "snap-rail-sub", textContent: "The file includes" }), lines(share.includes),
      h("div", { className: "snap-rail-sub", textContent: "It leaves out" }), lines(share.leaves_out),
      h("label", { className: "snap-share-check" }, quiet, " leave my prompt text out"),
      h("div", { className: "snap-share-acts" },
        h("button", { className: "snap-primary", textContent: "Download", title: `save ${S.shareFile(share)} (${Math.round(S.shareText(share).length / 1000)} KB) to your computer`, onclick: () => {
          const a = h("a", { href: URL.createObjectURL(new Blob([S.shareText(share)], { type: "application/json" })), download: S.shareFile(share) });
          a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); say(`${S.shareFile(share)} downloaded`);
        } }),
        h("button", { className: "snap-link", textContent: "Copy", title: "copy the share file's text", onclick: () => navigator.clipboard.writeText(S.shareText(share)).then(() => say(`${share.title}: share file copied`), (err) => say(err.message, true)) })),
      h("div", { className: "snap-quiet", textContent: "Nothing is sent anywhere: you hand the file to whoever you like." }));
  };
  quiet.addEventListener("change", draw);
  await draw();
}

// a dropped or chosen .snap.json: read strictly, then what it holds and what is missing here; Add to my Library, and
// after that Add to this recipe / Open in a new tab
export async function openSharePreview(host, text, { say, onApplied = () => {} }) {
  const got = S.readShare(text);
  if (!got.ok) return say(`That share file can't be opened: ${got.why}`, true);
  const share = got.share, p = await S.previewShare(share), body = h("div", { className: "snap-share-body" });
  sheet(host, `Share file: ${share.title}`, body);
  const acts = h("div", { className: "snap-share-acts" });
  const added = (out) => {
    const card = () => L.ready().then(() => L.get(out.id) ?? (() => { throw new Error(`${out.id} isn't in the Library yet: reload Snap`); })());
    const go = (fn) => async () => { try { say(await fn()); onApplied(); } catch (err) { say(err.message, true); } };
    acts.replaceChildren(h("span", { className: "snap-quiet", textContent: out.said }),
      h("button", { className: "snap-primary", textContent: "Add to this recipe", title: share.kind === "recipe" ? "rebuild its bricks and settings in this graph (one undo step)" : "add this brick to the open recipe",
        onclick: go(async () => (share.kind === "recipe" ? (await R.open(out.id, out.n, { how: "here" })).said : (await L.applyBrick(await card())).said)) }),
      h("button", { className: "snap-link", textContent: "Open in a new tab", onclick: go(async () => { if (share.kind === "recipe") return (await R.open(out.id, out.n, { how: "tab" })).said; const c = await card(); await M.freshTab(); return (await L.applyBrick(c)).said; }) }));
  };
  acts.append(h("button", { className: "snap-primary", textContent: "Add to my Library", title: p.place.said, onclick: async () => { try { added(await S.importShare(share)); onApplied(); } catch (err) { say(err.message, true); } } }));
  body.append(exampleEl(share.card.example) ?? h("div", { className: "snap-quiet", textContent: "No example picture in this file." }),
    h("div", { className: "snap-share-made", textContent: `${share.kind === "recipe" ? "Recipe" : "Brick"} · made ${R.when(Date.parse(share.made))}` }),
    h("div", { className: "snap-rail-sub", textContent: "Inside" }), lines(p.inside),
    h("div", { className: "snap-rail-sub", textContent: p.missing.length ? "Missing here" : "Missing here: nothing" }), ...(p.missing.length ? [lines(p.missing.map((m) => m.said))] : []), // spread: a null or an array child would print as text
    ...(p.leaves_out.length ? [h("div", { className: "snap-rail-sub", textContent: "Its maker left out" }), lines(p.leaves_out)] : []),
    h("div", { className: "snap-quiet", textContent: `Into your Library: ${p.place.said}. Nothing in it runs by itself.` }), acts);
}
