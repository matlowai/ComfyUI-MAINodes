// The Work card (SNAP-R65): one place for all open work, as a pill above the chain and a sheet. The sheet's zones are
// activity.js's queries: In flight (queued, running, checking, failed), Landed, unjudged (waiting for the person, or done
// and not opened yet), Parked (no count). Inside each zone the person's jobs, the agents' and other accounts' sit apart
// (SNAP-R17). A row reads its question, where it belongs, its state in words (ahead in the queue, the node running and
// its steps, the estimate or "no estimate yet") and a failure's own text, whole (the traceback behind "the rest of it").
// Buttons: Open (lands in context, view.js), Cancel on a queued job, "Stop the running render" on a running one (core
// stops only that prompt), Retry on a failure, Park / Unpark; a landed take takes a verdict with one key (p keep, x
// reject, n neither) and an optional sentence, the same verdict the take viewer writes.
// SNAP-R5 only a press moves the person · SNAP-R7 lists rebuilt only when their content changes, never under a pointer ·
// SNAP-R17 by: person|agent · SNAP-R58 nothing cut · SNAP-R65 the Work card · see docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as A from "./activity.js";
import * as T from "./takes.js";
import * as ACC from "./account.js";

const h = (tag, props = {}, ...kids) => { const el = Object.assign(document.createElement(tag), props); el.append(...kids.flat().filter((k) => k != null && k !== false)); return el; };
const OWNERS = [["you", "You"], ["agents", "Agents"], ["others", "Others on this server"]];
export const VERDICT_KEYS = { p: "keep", x: "reject", n: "neither" };

// a row's state in words
export function stateText(r) {
  if (r.state === "queued") return r.ahead ? `queued · ${r.ahead} ahead` : "queued · next";
  if (r.state === "running") {
    const p = r.progress, node = p?.max > 1 ? ` · step ${p.value} of ${p.max}` : "";
    return `${r.candidates ? `painting ${r.candidates.rendering} of ${r.candidates.count}` : "running"}${node}${p?.nodes ? ` · ${p.finished} of ${p.nodes} nodes done` : ""} · ${r.eta}`;
  }
  if (r.state === "checking") return "checking each candidate (identity notes)";
  if (r.state === "waiting") return r.source === "proposal" ? `waiting for your yes${r.plan?.eta_s ? ` · about ${Math.round(r.plan.eta_s)} s of GPU` : ""}` : r.source === "blind_pair" ? "waiting for your judgment"
    : `${r.candidates.ready} candidate${r.candidates.ready === 1 ? "" : "s"} ready: pick one`;
  if (r.state === "done") return r.result?.take ? `done · take ${r.result.number}` : r.result?.applied ? `done · ${r.result.applied} applied` : r.result?.saving ?? "done";
  if (r.state === "gone") return "the server has no record of it any more (restarted?)";
  return "failed";
}
// what the pill says: in flight, landed (proposals have their own part), failures in red
export function pillText(rows) {
  const n = (f) => rows.filter(f).length, flying = n((r) => r.zone === "in_flight" && r.state !== "failed" && r.state !== "gone"), landed = n((r) => r.zone === "landed" && r.source !== "proposal"), failed = n((r) => r.zone === "in_flight" && (r.state === "failed" || r.state === "gone"));
  return { flying, landed, failed, text: [`${flying} in flight`, `${landed} landed`, failed ? `${failed} failed` : null].filter(Boolean).join(" · ") };
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
  let sig = "", pressed = false, showParked = false;
  const close = () => { sheet.remove(); host.focus({ preventScroll: true }); };
  const act = (fn) => async (e) => { e?.stopPropagation(); try { const said = await fn(); if (typeof said === "string") { status.textContent = said; say?.(said); } } catch (err) { status.textContent = err.message; say?.(err.message, true); } A.reconcile(); };
  const admin = () => !ACC.account() || ACC.account().role === "admin";
  function row(r) {
    const mine = r.owner !== "others", why = h("input", { className: "snap-work-why", placeholder: "why, in a sentence (optional)", ariaLabel: "verdict note" });
    const take = r.zone === "landed" && r.result?.take;
    const buttons = [
      mine && r.source !== "proposal" ? h("button", { className: "snap-link snap-work-open", textContent: "Open", title: "go to the result where it belongs (nothing runs)", onclick: act(() => open(r)) }) : null,
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
  function zone(id, rows) {
    const groups = OWNERS.map(([o, name]) => [name, rows.filter((r) => r.owner === o)]).filter(([, list]) => list.length);
    const waiting = rows.filter((r) => r.source === "proposal" && r.owner === "agents");
    return h("section", { className: `snap-work-zone ${id}` },
      h("div", { className: "snap-rail-title" }, A.ZONE_NAMES[id], id === "parked" ? null : h("span", { className: "snap-quiet", textContent: ` ${rows.length}` })),
      groups.length ? groups.map(([name, list]) => h("div", { className: "snap-work-group", role: "list" },
        h("div", { className: "snap-work-owner" }, name, name === "Agents" && waiting.length > 1 ? [h("button", { className: "snap-link snap-quiet-btn", textContent: "Accept all", onclick: act(async () => { for (const p of waiting) await decide(p.proposal, true); }) }),
          h("button", { className: "snap-link snap-quiet-btn", textContent: "Reject all", onclick: act(async () => { for (const p of waiting) await decide(p.proposal, false); }) })] : null),
        list.map(row))) : h("div", { className: "snap-quiet", textContent: id === "in_flight" ? "Nothing is running or waiting in the queue." : "Nothing waits for you." }));
  }
  function draw() {
    const rows = A.all(), now = JSON.stringify([showParked, A.routeProblem(), rows.map((r) => [r.id, r.state, r.zone, r.ahead, r.progress, r.eta, r.error, r.result, r.candidates])]);
    if (now === sig || pressed) return;
    sig = now;
    const by = (z) => rows.filter((r) => r.zone === z), parked = by("parked");
    body.replaceChildren(...[A.routeProblem() ? h("p", { className: "snap-world-warn", textContent: A.routeProblem() }) : null, zone("in_flight", by("in_flight")), zone("landed", by("landed")),
      parked.length ? h("button", { className: "snap-link snap-quiet-btn", textContent: showParked ? "Hide parked" : "Parked", onclick: () => { showParked = !showParked; draw(); } }) : null,
      showParked && parked.length ? zone("parked", parked) : null].filter(Boolean));
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
