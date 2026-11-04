// The onboarding sheet (SNAP-R25): one calm question per step, each with a default and Skip, saved as it goes so it
// resumes where it stopped; reopened later it asks only what's new ("add a capability"). It ends on the kit: one
// recommended setup and a fast option per intent with their evidence, what's missing with exact downloads to run, and
// "Open in new tabs". It calls onboarding.js, as the agent tools do (SNAP-R19).
// SNAP-R5 new tabs · SNAP-R18 Snap never downloads · SNAP-R20 the metadata switch · SNAP-R25 onboarding ·
// SNAP-R28 agents read new code per the person's setting · SNAP-R34 no SFW question under a cap below Adult ·
// see docs/SNAP_RULES.md
import * as OB from "./onboarding.js";
import * as PF from "./profile.js";
import * as MD from "./metadata.js";
import * as ACC from "./account.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const STATE = { ready: "✓ ready", missing: "missing", cant_load: "can't load here", api: "API" };

export async function openOnboarding(host, { say, onOpened, start }) {
  host.querySelector(".snap-onboard")?.remove();
  await OB.load();
  // a signed-in account capped below Adult never sees what SFW only would hide: the gate already keeps it out
  const STEPS = (await ACC.load()) && ACC.belowAdult() ? PF.STEPS.filter((s) => s !== "sfw") : PF.STEPS;
  const hw = await OB.hardware(), p = PF.get();
  const draft = { intents: p.intents.length ? [...p.intents] : ["video"], metadata: MD.on(), sfw_only: p.sfw_only, api_tasks: [...p.api_tasks], code_review: p.code_review };
  let at = start ? STEPS.indexOf(start) : Math.max(0, STEPS.findIndex((s) => !p.answered.includes(s))), scanned = null, showAlso = new Set(), showDownloads = false;
  if (at < 0) at = STEPS.length - 1;

  const body = h("div", { className: "snap-ob-body" }), foot = h("footer", { className: "snap-ob-foot" }), dots = h("div", { className: "snap-ob-dots" });
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const sheet = h("div", { className: "snap-sheet snap-onboard", role: "dialog", ariaLabel: "Set up Snap" },
    h("header", {}, h("strong", { textContent: "Set up Snap" }),
      h("span", { className: "snap-quiet", textContent: hw.gpu ? `${hw.gpu} · ${hw.vram_gb} GB` : "No GPU found: setups are rated for a GPU" }),
      h("span", { className: "snap-spacer" }), dots, h("button", { className: "snap-x", textContent: "×", title: "close; your answers so far are kept", onclick: close })),
    body, foot);
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });

  // answering or skipping a step saves it and moves on; a skipped step keeps its default
  async function next(answer) {
    const id = STEPS[at];
    if (answer && id === "metadata") await MD.set(draft.metadata);
    await PF.set({ ...(answer ? { intents: draft.intents, sfw_only: draft.sfw_only, api_tasks: draft.api_tasks, code_review: draft.code_review } : {}), answered: [id] });
    const rest = STEPS.findIndex((s, i) => i > 0 && !PF.get().answered.includes(s)); // after the intent, only what's new
    at = Math.min(id === "intent" ? (rest < 0 ? STEPS.length - 1 : rest) : at + 1, STEPS.length - 1);
    draw();
  }
  const choice = (on, title, line, onclick) => h("button", { className: `snap-ob-choice${on ? " on" : ""}`, ariaPressed: String(on), onclick }, h("strong", { textContent: title }), line ? h("span", { className: "snap-quiet", textContent: line }) : null);
  const question = (title, line, ...rest) => [h("h2", { textContent: title }), line ? h("p", { className: "snap-quiet", textContent: line }) : null, ...rest].filter(Boolean);
  // replaceChildren prints a null as "null": every list handed to it drops the missing parts first
  const footer = (primary, label = "Next") => foot.replaceChildren(...[h("button", { className: "snap-link", textContent: "Skip", title: "keep the default and go on", onclick: () => next(false) }),
    h("span", { className: "snap-spacer" }), at ? h("button", { className: "snap-link", textContent: "Back", onclick: () => { at -= 1; draw(); } }) : null,
    h("button", { className: "snap-primary", textContent: label, onclick: primary })].filter(Boolean));

  const steps = {
    intent: () => {
      body.replaceChildren(...question("What do you want to make?", "Pick any. You can add more later.",
        h("div", { className: "snap-ob-grid" }, OB.kits().map((k) => choice(draft.intents.includes(k.intent), k.title, k.blurb, () => {
          draft.intents = draft.intents.includes(k.intent) ? draft.intents.filter((x) => x !== k.intent) : [...draft.intents, k.intent]; draw();
        })))));
      footer(() => next(true));
    },
    scan: () => {
      const rows = scanned && scanned.kits.filter((k) => draft.intents.includes(k.intent));
      body.replaceChildren(...question("Look through your models?", "Snap matches your model folders against what each setup needs. Nothing leaves this machine.",
        rows ? h("div", { className: "snap-ob-scan" }, rows.map((k) => h("div", { className: "snap-ob-row" }, h("strong", { textContent: k.title }),
          h("span", { textContent: k.recommended?.title ?? "" }), chip(k.recommended?.state, k.recommended?.missing?.length)))) : null,
        rows ? h("p", { className: "snap-quiet", textContent: scanned.models_here ? `${scanned.models_here} model files here${scanned.unknown_files ? ` · ${scanned.unknown_files} Snap doesn't know yet (it guesses from their names)` : ""}` : "Your model folders are empty." }) : null));
      footer(rows ? () => next(true) : async () => { scanned = await OB.scan(); draw(); }, rows ? "Next" : "Look through them");
    },
    metadata: () => {
      body.replaceChildren(...question("Store metadata in your outputs?", "It keeps you organized and lets you reproduce results easily.",
        h("div", { className: "snap-ob-grid two" }, choice(draft.metadata, "Yes", "prompt and workflow saved in each file", () => { draft.metadata = true; draw(); }),
          choice(!draft.metadata, "No", "files save without them", () => { draft.metadata = false; draw(); })),
        h("p", { className: "snap-quiet", textContent: "The Save metadata switch next to Run changes it any time." })));
      footer(() => next(true));
    },
    sfw: () => {
      body.replaceChildren(...question("SFW only?", "Hides models, LoRAs, dials and Library cards tagged nsfw in your model graph.",
        h("div", { className: "snap-ob-grid two" }, choice(!draft.sfw_only, "Show everything", null, () => { draft.sfw_only = false; draw(); }),
          choice(draft.sfw_only, "SFW only", null, () => { draft.sfw_only = true; draw(); })),
        h("p", { className: "snap-quiet", textContent: "A preference filter on your own tags, not a safety guarantee." })));
      footer(() => next(true));
    },
    local: () => {
      body.replaceChildren(...question("Which tasks stay on this machine?", "All of them, unless you allow API models for some. API models cost money and send your inputs out.",
        h("div", { className: "snap-ob-tasks" }, OB.tasks().map((t) => { const cloud = draft.api_tasks.includes(t.id); return h("div", { className: "snap-ob-row" }, h("strong", { textContent: t.title }), h("span", { className: "snap-spacer" }),
          h("div", { className: "snap-seg" }, h("button", { className: cloud ? "" : "on", textContent: "Local only", onclick: () => { draft.api_tasks = draft.api_tasks.filter((x) => x !== t.id); draw(); } }),
            h("button", { className: cloud ? "on" : "", textContent: "API allowed", onclick: () => { draft.api_tasks = [...draft.api_tasks, t.id]; draw(); } }))); }))));
      footer(() => next(true));
    },
    code: () => {
      const line = { always: "every pack or script an agent brings in", unknown: "Snap's kits already carry a safety read for theirs", never: "you still say yes to every install" };
      body.replaceChildren(...question("Should agents read new code first?", "When an agent wants to add code that isn't part of your setup yet, should it read the code first? It costs tokens.",
        h("div", { className: "snap-ob-grid" }, Object.entries(PF.REVIEWS).map(([v, title]) => choice(draft.code_review === v, title, line[v], () => { draft.code_review = v; draw(); }))),
        h("p", { className: "snap-quiet", textContent: "Settings › MAINodes › Snap changes it any time." })));
      footer(() => next(true));
    },
    kit: async () => {
      const intents = PF.get().intents.length ? PF.get().intents : draft.intents;
      const ks = await Promise.all(intents.map(OB.kit)), wanted = await OB.proposeDownloads({ intents });
      body.replaceChildren(h("h2", { textContent: ks.length > 1 ? "Your setups" : "Your setup" }),
        ...ks.map((k) => h("section", { className: "snap-ob-kit" }, h("div", { className: "snap-rail-title", textContent: k.title }),
          h("div", { className: "snap-ob-cards" }, card(k.recommended, "Recommended for you"), k.fast ? card(k.fast, "Fast option") : h("div", { className: "snap-ob-card none" }, h("div", { className: "snap-ob-card-top" }, h("i", { textContent: "Fast option" })), h("span", { className: "snap-quiet", textContent: k.fast_note }))),
          k.also.length ? h("button", { className: "snap-link", textContent: showAlso.has(k.intent) ? "Hide alternatives" : `See alternatives (${k.also.length})`, onclick: () => { showAlso.has(k.intent) ? showAlso.delete(k.intent) : showAlso.add(k.intent); draw(); } }) : null,
          showAlso.has(k.intent) ? h("div", { className: "snap-ob-cards" }, k.also.map((r) => card(r, r.tier === "api" ? "API" : "Also good"))) : null,
          k.try_first ? h("p", { className: "snap-ob-try" }, h("b", { textContent: "Try this first: " }), k.try_first) : null)),
        downloads(wanted));
      foot.replaceChildren(h("button", { className: "snap-link", textContent: "Add something else", onclick: () => { at = 0; draw(); } }), h("span", { className: "snap-spacer" }),
        h("button", { className: "snap-link", textContent: "Back", onclick: () => { at -= 1; draw(); } }),
        h("button", { className: "snap-primary", textContent: `Open ${ks.filter((k) => k.recommended && k.recommended.tier !== "api").length > 1 ? "them" : "it"} in new tabs`, onclick: async (e) => {
          e.currentTarget.disabled = true;
          try {
            const opened = await OB.open(intents);
            await PF.set({ done: true, answered: ["kit"] });
            close();
            say(`Opened ${new Intl.ListFormat("en").format(opened.map((o) => o.title))}${opened.length > 1 ? ", one tab each" : ""}${opened.some((o) => o.state !== "ready") ? " · missing files show in red until they're downloaded" : ""}`);
            onOpened(opened);
          } catch (err) { say(err.message, true); e.currentTarget.disabled = false; }
        } }));
    },
  };
  const chip = (state, n) => h("em", { className: `snap-ob-state ${state ?? ""}`, textContent: state === "missing" && n ? `${n} missing` : STATE[state] ?? "" });
  function card(r, label) {
    if (!r) return null;
    const missing = r.files.filter((f) => !f.installed), packs = r.packs.filter((x) => !x.installed);
    return h("div", { className: `snap-ob-card ${r.state}` },
      h("div", { className: "snap-ob-card-top" }, h("i", { textContent: label }), chip(r.state, missing.length + packs.length)),
      h("strong", { textContent: r.title }), r.good_at ? h("span", { textContent: r.good_at }) : null,
      r.evidence?.line ? h("span", { className: "snap-quiet", textContent: `${r.evidence.label} · ${r.evidence.date}: ${r.evidence.line}` }) : null,
      r.state === "missing" ? h("span", { className: "snap-quiet", textContent: [missing.length && `${missing.length} file${missing.length > 1 ? "s" : ""} · ${r.missing_gb} GB`, packs.length && `${packs.map((x) => x.title).join(", ")} pack`, r.unwired].filter(Boolean).join(" · ") || r.unwired || "" }) : r.unwired ? h("span", { className: "snap-quiet", textContent: r.unwired }) : null,
      r.swaps.length ? h("span", { className: "snap-quiet", textContent: `for your ${hw.vram_gb} GB card: ${r.swaps.map((x) => x.to.replace(/\.safetensors$/, "")).join(", ")} instead (${OB.grade(r.swaps[0].evidence?.grade)})` }) : !r.fits ? h("span", { className: "snap-warn", textContent: `wants about ${r.vram_gb} GB of VRAM; yours has ${hw.vram_gb} GB (it offloads, slower)` }) : null,
      r.cost ? h("span", { className: "snap-quiet", textContent: r.cost }) : null);
  }
  function downloads(w) {
    if (!w.files.length && !w.packs.length) return h("p", { className: "snap-quiet", textContent: "Everything these setups need is here." });
    return h("section", { className: "snap-ob-downloads" },
      h("button", { className: "snap-link", textContent: `${showDownloads ? "▾" : "▸"} To finish: ${[w.files.length && `${w.files.length} file${w.files.length > 1 ? "s" : ""} · ${w.total_gb} GB`, w.packs.length && `${w.packs.length} node pack${w.packs.length > 1 ? "s" : ""}`].filter(Boolean).join(" · ")}`, onclick: () => { showDownloads = !showDownloads; draw(); } }),
      h("p", { className: "snap-quiet", textContent: "Snap never downloads. Run these yourself, or ask your agent (propose_downloads)." }),
      showDownloads ? h("div", { className: "snap-ob-dl" },
        w.files.map((f) => h("div", { className: "snap-ob-dl-row" }, h("strong", { textContent: f.file }),
          h("span", { className: "snap-quiet", textContent: [f.size_gb != null && `${f.size_gb} GB`, !f.command && f.target && `goes in ${f.target}`, `license: ${f.license ?? "see the source"}`].filter(Boolean).join(" · ") }),
          f.command ? h("code", { textContent: f.command }) : h("span", { className: "snap-quiet", textContent: `${f.why}${f.source ? `: ${f.source}` : ""}` }))),
        w.packs.map((x) => h("div", { className: "snap-ob-dl-row" }, h("strong", { textContent: `${x.title} (${x.author}, ${x.license})` }),
          h("span", { className: "snap-quiet", textContent: `${x.unlocks} · checked ${x.checked.date}: ${[x.safety.network_at_import ? "network at import" : "no network at import", x.safety.pickles ? "loads pickles" : "no pickles", x.safety.auto_downloads ? `auto-download: ${x.safety.auto_downloads}` : "no auto-downloads"].join(" · ")} · ${x.review === "required" ? "your agent reads its code first" : "code read skipped (your setting)"}` }),
          h("code", { textContent: `${x.command}   # then ${x.then}` })))) : null);
  }
  async function draw() {
    dots.replaceChildren(...STEPS.map((s, i) => h("i", { className: i === at ? "on" : PF.get().answered.includes(s) ? "done" : "", title: s })));
    await steps[STEPS[at]]();
    body.scrollTop = 0;
  }
  host.append(sheet);
  await draw();
  sheet.querySelector(".snap-primary")?.focus();
  return sheet;
}
