// Plan-board (BRAINSTORM P2): one set's saved states side by side, each with its plan and set block, and the
// continuity findings between neighbours on the gap, so a break shows up before any pixels. Click a state to edit it.
import { drawPlan, setBlock } from "./setsnap.js";
import { diff } from "./continuity.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null)); return el; };

export function openBoard(host, states, { onOpen }) {
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const strip = h("div", { className: "snap-board" });
  states.forEach((card, i) => {
    const s = card.brick.snapshot;
    if (i) {
      const found = diff(states[i - 1].brick.snapshot, s);
      const count = (sev) => found.filter((f) => f.severity === sev).length;
      strip.append(h("div", { className: "snap-board-gap", title: found.map((f) => `${f.severity}: ${f.what}`).join("\n") || "nothing changed" },
        ...["break", "check", "note"].filter(count).map((sev) => h("span", { className: `snap-badge ${sev}`, textContent: `${count(sev)} ${sev}` })),
        found.length ? h("span", { className: "snap-board-why", textContent: found[0].what.split(":")[0] }) : h("span", { className: "snap-badge none", textContent: "same" })));
    }
    const plan = drawPlan(s);
    plan.className = "snap-board-plan";
    strip.append(h("figure", { className: "snap-board-frame", tabIndex: 0, title: "open in the set editor", onclick: () => { close(); onOpen(card); } },
      plan, h("figcaption", {}, h("strong", { textContent: `end of ${s.shot}` }), h("span", { textContent: setBlock(s) }))));
  });
  const sheet = h("div", { className: "snap-sheet", role: "dialog", ariaLabel: "plan-board" },
    h("header", {}, h("strong", { textContent: `Plan-board · ${states[0].brick.snapshot.name}` }), h("span", { className: "snap-quiet", textContent: ` ${states.length} states · hover a gap for what changed` }),
      h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })), strip);
  sheet.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Escape") close(); });
  host.append(sheet);
  sheet.querySelector(".snap-board-frame")?.focus({ preventScroll: true });
  return sheet;
}
