// The Work card (SNAP-R65): one place for all open work, as a pill above the chain and a sheet. The sheet's zones are
// activity.js's queries: In flight (queued, running, checking, failed), Landed, unjudged (waiting for the person, or done
// and not opened yet), Parked (no count). Inside each zone the person's jobs, the agents' and other accounts' sit apart
// (SNAP-R17). A row reads its question, where it belongs, its state in words (ahead in the queue, the node running and
// its steps, the estimate or "no estimate yet") and a failure's own text, whole (the traceback behind "the rest of it").
// Buttons: Open (lands in context, view.js), Cancel on a queued job, "Stop the running render" on a running one (core
// stops only that prompt), Retry on a failure, Park / Unpark; a landed take takes a verdict with one key (p keep, x
// reject, n neither) and an optional sentence, the same verdict the take viewer writes.
// SNAP-R5 only a press moves the person · SNAP-R158 critiques due fold into one row, proposals first · SNAP-R7 lists rebuilt only when their content changes, never under a pointer ·
// SNAP-R17 by: person|agent · SNAP-R58 nothing cut · SNAP-R65 the Work card · see docs/snap/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as A from "./activity.js";
import * as T from "./takes.js";
import * as ACC from "./account.js";
import * as CR from "./critiques.js"; // SNAP-R101 the critic's rows and its foot line

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat(Infinity).filter((k) => k != null && k !== false)); return el; }; // F-L01: a row's buttons nest a list (Accept, Reject): a string of it printed "[object HTMLButtonElement]"
const OWNERS = [["you", "You"], ["agents", "Agents"], ["others", "Others on this server"]];
export const VERDICT_KEYS = { p: "keep", x: "reject", n: "neither" };

// a row's state in words
export function stateText(r) {
  if (r.source === "critique") return r.said;
  if (r.state === "queued") return r.ahead ? `queued · ${r.ahead} ahead` : "queued · next";
  if (r.state === "running") {
    const p = r.progress, node = p?.max > 1 ? ` · step ${p.value} of ${p.max}` : "";
    return `${r.candidates ? `painting ${r.candidates.rendering} of ${r.candidates.count}` : "running"}${node}${p?.nodes ? ` · ${p.finished} of ${p.nodes} nodes done` : ""} · ${r.eta}`;
  }
  if (r.state === "checking") return r.result?.saving ? "rendered · writing its take" : "checking each candidate (identity notes)";
  if (r.state === "waiting") return r.source === "proposal" ? `waiting for your yes${r.plan?.eta_s ? ` · about ${Math.round(r.plan.eta_s)} s of GPU` : ""}` : r.source === "blind_pair" ? "waiting for your judgment"
    : `${r.candidates.ready} candidate${r.candidates.ready === 1 ? "" : "s"} ready: pick one`;
  if (r.state === "done") return r.result?.take ? `done · take ${r.result.number}` : r.result?.applied ? `done · ${r.result.applied} applied` : r.result?.note ? `done · ${r.result.note}` : "done";
  if (r.state === "gone") return "the server has no record of it any more (restarted?)";
  return "failed";
}
// what the pill says: in flight, landed (proposals have their own part), failures in red
export function pillText(rows) {
  const due = (r) => r.source === "critique" && r.state === "queued"; // F-M01: critiques waiting for a critic are one count, not 100 rows of "in flight"
  const n = (f) => rows.filter(f).length, critiques = n((r) => r.zone === "in_flight" && due(r)), flying = n((r) => r.zone === "in_flight" && !due(r) && r.state !== "failed" && r.state !== "gone"), landed = n((r) => r.zone === "landed" && r.source !== "proposal"), failed = n((r) => r.zone === "in_flight" && (r.state === "failed" || r.state === "gone"));
  return { flying, landed, failed, critiques, text: [flying ? `${flying} in flight` : null, landed ? `${landed} landed` : null, failed ? `${failed} failed` : null, critiques ? `${critiques} critique${critiques === 1 ? "" : "s"} due` : null].filter(Boolean).join(" · ") };
}

// the actions every surface shares (the sheet, agents' tools go through the same queue routes)
export const cancel = (r) => Promise.all((r.prompts ?? [r.id]).map((id) => api.fetchApi("/queue", { method: "POST", body: JSON.stringify({ delete: [id] }) })));
export const stop = (r) => Promise.all((r.prompts ?? [r.id]).map((id) => api.fetchApi("/interrupt", { method: "POST", body: JSON.stringify({ prompt_id: id }) })));
// a failed prompt again, as it was queued (its own job stamp, a new time), under this page's id
export async function retry(r) {
  if (r.retry) return r.retry();
  const h0 = (await (await api.fetchApi(`/history/${r.id}`)).json())[r.id];
  if (!h0) throw new Error("The server has no record of this job any more: start it again from where it began");
  const [, , prompt, extra] = h0.prompt, { client_id, snap_marks, ...rest } = extra;
  const res = await api.fetchApi("/prompt", { method: "POST", body: JSON.stringify({ client_id: api.clientId, prompt, extra_data: { ...rest, snap_job: { ...rest.snap_job, at: Date.now() } } }) });
  const out = await res.json();
  if (res.status !== 200) throw new Error(`Not queued: ${out.error?.message ?? ""} ${JSON.stringify(out.node_errors ?? {})}`.trim());
  await A.park(r.id);
  return out.prompt_id;
}
// p / x / n on a landed take: the viewer's verdict, with the sentence as its note
export async function verdict(r, v, why) {
  await T.load();
  const t = T.get(r.result?.take);
  if (!t) throw new Error("This job's take isn't here yet");
  t.verdict = v;
  if (why) t.verdict_note = why;
  await T.save(t);
  await A.opened(t.id);
  return `Take ${t.number}: ${v}${why ? ` (${why})` : ""}`;
}

export function openWork(host, { say, open, decide }) {
  for (const s of host.querySelectorAll(".snap-work-sheet")) s.remove();
  const body = h("div", { className: "snap-work-body" }), status = h("div", { className: "snap-quiet", role: "status" });
  let sig = "", pressed = false, showParked = false, showDue = false;
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const act = (fn) => async (e) => { e?.stopPropagation(); try { const said = await fn(); if (typeof said === "string") { status.textContent = said; say?.(said); } } catch (err) { status.textContent = err.message; say?.(err.message, true); } A.reconcile(); };
  const admin = () => !ACC.account() || ACC.account().role === "admin";
  function row(r) {
    const mine = r.owner !== "others", why = h("input", { className: "snap-work-why", placeholder: "why, in a sentence (optional)", ariaLabel: "verdict note" });
    const take = r.zone === "landed" && r.result?.take;
    const buttons = [
      mine && (r.result?.take || r.about?.take || r.decision || r.pair || (r.kind === "plate" && r.about?.set)) ? h("button", { className: "snap-link snap-work-open", textContent: "Open", title: "go to the result where it belongs (nothing runs)", onclick: act(() => open(r)) }) : null,
      mine && r.state === "queued" && (r.source === "prompt" || r.source === "decision") ? h("button", { className: "snap-link", textContent: "Cancel", title: "take it off the queue", onclick: act(async () => { await cancel(r); return `Cancelled: ${r.title}`; }) }) : null,
      mine && r.state === "running" && (r.owner === "you" || admin()) ? h("button", { className: "snap-link", textContent: "Stop the running render", title: "stops this job on the GPU now (only this one; the rest of the queue goes on)", onclick: act(async () => { await stop(r); return `Stopped: ${r.title}`; }) }) : null,
      mine && r.state === "failed" && (r.source === "prompt" || r.source === "refusal") ? h("button", { className: "snap-link", textContent: "Retry", onclick: act(async () => { await retry(r); return `Queued again: ${r.title}`; }) }) : null,
      mine && r.source === "proposal" ? [h("button", { className: "snap-accept", textContent: "Accept", onclick: act(() => decide(r.proposal, true)) }), h("button", { className: "snap-reject", textContent: "Reject", onclick: act(() => decide(r.proposal, false)) })] : null,
      LIVE(r) ? null : h("button", { className: "snap-link snap-quiet-btn", textContent: r.zone === "parked" ? "Unpark" : "Park", title: r.zone === "parked" ? "back where it was" : "out of the way, kept, never counted", onclick: act(() => A.park(r.id, r.zone !== "parked").then(() => "")) }),
    ];
    const el = h("div", { className: `snap-work-row ${r.state}`, tabIndex: 0, role: "listitem" },
      h("div", { className: "snap-work-line" }, h("i", { className: "snap-work-dot" }), h("strong", { className: "snap-work-title", textContent: r.title }), h("span", { className: "snap-spacer" }), buttons),
      h("div", { className: "snap-quiet snap-work-meta", textContent: [r.where, stateText(r), r.by === "agent" ? "started by an agent" : null, take ? "p keep · x reject · n neither" : null].filter(Boolean).join(" · ") }),
      r.error ? h("pre", { className: "snap-work-error", textContent: r.error }) : null,
      r.traceback?.length ? h("details", { className: "snap-work-rest" }, h("summary", { textContent: "the rest of it" }), h("pre", { className: "snap-work-error", textContent: r.traceback.join("") })) : null,
      take ? h("div", { className: "snap-set-actions snap-work-verdict" }, why, ...Object.entries(VERDICT_KEYS).map(([k, v]) => h("button", { className: "snap-link snap-quiet-btn", textContent: `${v[0].toUpperCase()}${v.slice(1)} (${k})`, onclick: act(() => verdict(r, v, why.value.trim())) }))) : null);
    el.dataset.job = r.id;
    el.addEventListener("keydown", (e) => { if (take && e.target === el && VERDICT_KEYS[e.key]) { e.preventDefault(); act(() => verdict(r, VERDICT_KEYS[e.key], why.value.trim()))(); } else if (e.key === "Enter" && e.target === el && mine) act(() => open(r))(); });
    return el;
  }
  const LIVE = (r) => ["queued", "running", "checking"].includes(r.state);
  // F-M01: the critiques due fold into one row (how many, whether a critic is on duty, the oldest's age) with an explicit
  // press that lists every one; F-L01: proposals, which wait for the person, come first in their group
  const dueRow = (list) => h("div", { className: `snap-work-row queued snap-work-due${list.some((r) => r.no_critic) ? " late" : ""}`, role: "listitem" },
    h("div", { className: "snap-work-line" }, h("i", { className: "snap-work-dot" }), h("strong", { className: "snap-work-title", textContent: `${list.length} critiques due` }), h("span", { className: "snap-spacer" }),
      h("button", { className: "snap-link", textContent: showDue ? "Fold them" : "Show them", title: "every critique row, one by one (agents read them all with list_critiques)", onclick: () => { showDue = !showDue; sig = ""; draw(); } })),
    h("div", { className: "snap-quiet snap-work-meta", textContent: `${list.some((r) => r.no_critic) ? "no critic on duty" : "waiting for a critic"} · a critic agent works them with list_critiques {state: "due"}` }));
  const rank = (r) => (r.source === "proposal" ? 0 : r.source === "critique" ? 2 : 1);
  function zone(id, rows) {
    const due = rows.filter((r) => r.source === "critique" && r.state === "queued"), fold = due.length > 1 && !showDue ? new Set(due) : null;
    const groups = OWNERS.map(([o, name]) => [name, rows.filter((r) => r.owner === o && !fold?.has(r)).sort((a, b) => rank(a) - rank(b))]).filter(([name, list]) => list.length || (fold && name === "Agents"));
    const waiting = rows.filter((r) => r.source === "proposal" && r.owner === "agents");
    return h("section", { className: `snap-work-zone ${id}` },
      h("div", { className: "snap-rail-title" }, A.ZONE_NAMES[id], id === "parked" ? null : h("span", { className: "snap-quiet", textContent: ` ${rows.length - due.length}${due.length ? ` · ${due.length} critique${due.length === 1 ? "" : "s"} due` : ""}` })),
      groups.length ? groups.map(([name, list]) => h("div", { className: "snap-work-group", role: "list" },
        h("div", { className: "snap-work-owner" }, name, name === "Agents" && waiting.length > 1 ? [h("button", { className: "snap-link snap-quiet-btn", textContent: "Accept all", onclick: act(async () => { for (const p of waiting) await decide(p.proposal, true); }) }),
          h("button", { className: "snap-link snap-quiet-btn", textContent: "Reject all", onclick: act(async () => { for (const p of waiting) await decide(p.proposal, false); }) })] : null),
        list.map(row), fold && name === "Agents" ? dueRow(due) : null, !fold && due.length > 1 && name === "Agents" ? dueRow(due) : null)) : h("div", { className: "snap-quiet", textContent: id === "in_flight" ? "Nothing is running or waiting in the queue." : "Nothing waits for you." }));
  }
  function draw() {
    const rows = A.all(), now = JSON.stringify([showParked, showDue, A.routeProblem(), rows.map((r) => [r.id, r.state, r.zone, r.ahead, r.progress, r.eta, r.error, r.result, r.candidates])]);
    if (now === sig || pressed) return;
    sig = now;
    const by = (z) => rows.filter((r) => r.zone === z), parked = by("parked");
    body.replaceChildren(...[A.routeProblem() ? h("p", { className: "snap-world-warn", textContent: A.routeProblem() }) : null, zone("in_flight", by("in_flight")), zone("landed", by("landed")),
      parked.length ? h("button", { className: "snap-link snap-quiet-btn", textContent: showParked ? "Hide parked" : "Parked", onclick: () => { showParked = !showParked; draw(); } }) : null,
      showParked && parked.length ? zone("parked", parked) : null, CR.footLine() ? h("p", { className: `snap-quiet snap-critic-foot${rows.some((r) => r.no_critic) ? " late" : ""}`, textContent: CR.footLine() }) : null].filter(Boolean));
  }
  body.addEventListener("pointerdown", () => { pressed = true; });
  addEventListener("pointerup", () => { if (pressed) { pressed = false; setTimeout(draw, 0); } });
  const sheet = h("div", { className: "snap-sheet snap-setup-sheet snap-work-sheet", role: "dialog", ariaLabel: "Work" },
    h("header", {}, h("strong", { textContent: "Work" }), h("span", { className: "snap-quiet", textContent: "everything started here or by an agent, from the server's own records" }), h("span", { className: "snap-spacer" }), h("button", { className: "snap-x", textContent: "×", title: "close (Esc)", onclick: close })),
    body, status);
  sheet.addEventListener("keydown", (e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } });
  A.onChange(() => { if (sheet.isConnected) draw(); });
  host.append(sheet);
  draw();
  A.reconcile();
  return sheet;
}
