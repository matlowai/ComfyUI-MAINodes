// SNAP-R4 outcome-oriented entry · SNAP-R6 explicit close · SNAP-R19 same tools as agents. · SNAP-R272 native planning.
// Small progressive-disclosure UI; no render button, new queue, hidden graph, HTML injection or remote assets.
let active = null;
const el = (tag, text, className) => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};
const css = `
.snap-director { color:var(--input-text,#ddd); background:var(--comfy-menu-bg,#222); border:1px solid var(--border-color,#666); border-radius:10px; width:min(1040px,94vw); max-height:90vh; padding:0; }
.snap-director::backdrop { background:rgba(0,0,0,.5); }
.snap-director .sd-head,.snap-director .sd-actions { display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:14px 18px; }
.snap-director .sd-head { justify-content:space-between; border-bottom:1px solid var(--border-color,#555); }
.snap-director h2,.snap-director h3 { margin:0; font-size:1.1em; }
.snap-director .sd-body { padding:16px 18px; overflow:auto; max-height:70vh; }
.snap-director .sd-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(235px,1fr)); gap:12px; }
.snap-director label { display:flex; flex-direction:column; gap:5px; margin:10px 0; }
.snap-director input,.snap-director select,.snap-director textarea { box-sizing:border-box; width:100%; color:inherit; background:var(--comfy-input-bg,#161616); border:1px solid var(--border-color,#666); border-radius:4px; padding:8px; font:inherit; }
.snap-director textarea { min-height:85px; resize:vertical; font-family:monospace; }
.snap-director button { cursor:pointer; color:inherit; background:var(--comfy-input-bg,#333); border:1px solid var(--border-color,#777); border-radius:5px; padding:8px 12px; }
.snap-director button:disabled { opacity:.5; cursor:default; }
.snap-director button:focus-visible,.snap-director input:focus-visible,.snap-director textarea:focus-visible,.snap-director select:focus-visible { outline:2px solid Highlight; outline-offset:2px; }
.snap-director details { margin:14px 0; padding:10px; border:1px solid var(--border-color,#555); border-radius:6px; }
.snap-director summary { cursor:pointer; }
.snap-director pre { white-space:pre-wrap; overflow-wrap:anywhere; font-size:.88em; }
.snap-director .sd-status { white-space:pre-wrap; margin:12px 0; padding:10px; border-left:3px solid currentColor; }
.snap-director .sd-muted { opacity:.8; line-height:1.45; }
.snap-director .sd-stage { margin:10px 0; padding:12px; border:1px solid var(--border-color,#555); border-radius:5px; }
.snap-director .sd-stage p { margin:6px 0; }
`;
function field(parent, title, tag = "input", value = "") {
  const label = el("label", title), input = el(tag);
  input.value = value; label.append(input); parent.append(label); return input;
}
function details(parent, title) { const node = el("details"), summary = el("summary", title); node.append(summary); parent.append(node); return node; }
function parse(text, name) {
  try { return JSON.parse(text || "{}"); } catch (error) { throw new Error(`${name}: ${error.message}`); }
}
function button(parent, title, action) { const b = el("button", title); b.type = "button"; b.addEventListener("click", action); parent.append(b); return b; }

/** invoke(name,args,{confirmed}) is the normal SNAP callTool boundary supplied by the root extension. */
export async function openDirector(invoke, context = {}) {
  if (active?.isConnected) { active.focus(); return; }
  if (!document.getElementById("snap-director-style")) { const style = el("style", css); style.id = "snap-director-style"; document.head.append(style); }
  const dialog = el("dialog", undefined, "snap-director"), head = el("header", undefined, "sd-head"), body = el("div", undefined, "sd-body");
  const heading = el("h2", "Production strategies"); heading.id = "snap-director-heading";
  dialog.setAttribute("aria-labelledby", heading.id); head.append(heading); button(head, "Close", () => dialog.close());
  dialog.append(head, body); document.body.append(dialog); active = dialog;
  dialog.addEventListener("close", () => { dialog.remove(); if (active === dialog) active = null; });
  body.append(el("p", "Preview a filmmaking approach using the records, graphs and tools you already have. Nothing here renders, installs models, changes canon or turns on automation.", "sd-muted"));
  const select = field(body, "Strategy", "select"), summary = el("p", "Loading…", "sd-muted"); body.append(summary);
  const grid = el("div", undefined, "sd-grid"); body.append(grid);
  const book = field(grid, "Existing Book reference (optional)", "input", context.book ?? ""), source = field(grid, "Source video take (for Transform Footage)"), name = field(grid, "New production name (optional)");
  book.placeholder = "book:…"; source.placeholder = "take-…";
  const words = field(body, "Fountain screenplay or footage edit direction", "textarea");
  const params = field(body, "Parameter overrides (JSON; {} inherits existing choices)", "textarea", "{}");
  const advanced = details(body, "Advanced: target scope, duration packing and reference packet");
  const subgrid = el("div", undefined, "sd-grid"); advanced.append(subgrid);
  const scene = field(subgrid, "Scene ID (optional)"), shot = field(subgrid, "Shot ID (requires scene)");
  const who = field(subgrid, "Recast: person currently in footage"), becomes = field(subgrid, "Recast: replacement person");
  const helper = field(advanced, 'Optional helpers: {"packing": …, "reference_packet": …}', "textarea", "{}");
  advanced.append(el("p", "Reference profiles and timing estimates must be explicit. The helpers do not replace the native graph compiler. Saved parameters are preferences, never permissions.", "sd-muted"));
  const actions = el("div", undefined, "sd-actions"), status = el("p", "", "sd-status"), results = el("div");
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite"); body.append(actions, status, results);
  let current = null, lastPlan = null, lastRequest = null, stale = false, busy = false;
  const setStatus = (text) => { if (dialog.isConnected) status.textContent = text; };
  const run = async (action) => {
    if (busy) return; busy = true;
    const controls = [...dialog.querySelectorAll("button,input,select,textarea")].filter((b) => b.textContent !== "Close").map((node) => [node, node.disabled]);
    controls.forEach(([node]) => node.disabled = true);
    try { await action(); } catch (error) { setStatus(`${error.code ? `${error.code}: ` : ""}${error.message}`); }
    finally { busy = false; controls.forEach(([node, disabled]) => node.disabled = disabled); }
  };
  const markStale = () => { stale = true; if (lastPlan) setStatus("Inputs changed. The displayed plan is an older snapshot; preview again before copying it."); };
  for (const node of [book, source, name, words, params, scene, shot, who, becomes, helper]) node.addEventListener("input", markStale);
  function request() {
    const request = { strategy: select.value, parameters: parse(params.value, "Parameters") };
    for (const [key, input] of [["book", book], ["scene", scene], ["shot", shot], ["source_take", source]]) if (input.value.trim()) request[key] = input.value.trim();
    const inputs = {};
    if (name.value.trim()) inputs.name = name.value.trim();
    if (who.value.trim()) inputs.who = who.value.trim();
    if (becomes.value.trim()) inputs.becomes = becomes.value.trim();
    if (words.value.trim()) inputs[current?.definition.stages.some((s) => s.kind === "transform") ? "change" : "fountain"] = words.value;
    if (Object.keys(inputs).length) request.inputs = inputs;
    const extra = parse(helper.value, "Helpers");
    for (const key of Object.keys(extra)) if (!["packing", "reference_packet"].includes(key)) throw new Error(`Unknown helper ${key}`);
    return { ...request, ...extra };
  }
  function showPlan(plan) {
    results.replaceChildren();
    results.append(el("h3", `${plan.strategy.name}: ${plan.counts.stages} stages, ${plan.counts.operations} proposed operations`));
    results.append(el("p", "This is a plan, not an executing workflow. Resolve bindings, use normal SNAP permissions, and replan after edits or choices.", "sd-muted"));
    for (const problem of [...plan.errors, ...plan.warnings]) results.append(el("p", `${problem.code}: ${problem.message}`));
    for (const stage of plan.stages) {
      const card = el("section", undefined, "sd-stage"); card.append(el("h3", `${stage.title} — ${stage.status.replaceAll("_", " ")}`));
      for (const text of [stage.guidance, ...stage.reasons].filter(Boolean)) card.append(el("p", text));
      for (const reused of stage.reuses) card.append(el("p", `Reuse proposed: ${reused.what} (${reused.ref})`));
      for (const pre of stage.preconditions) card.append(el("p", `Check: ${pre.text}`));
      for (const operation of stage.operations) card.append(el("p", `${operation.tool}: ${operation.why}${operation.arguments_complete ? "" : " — needs actual inputs/results"}`));
      results.append(card);
    }
    const raw = details(results, "Complete plan, provenance, instructions and helper results"); raw.append(el("pre", JSON.stringify(plan, null, 2)));
  }
  button(actions, "Preview plan", () => run(async () => {
    const asked = request(); const plan = await invoke("plan_strategy", asked);
    lastPlan = plan; lastRequest = asked; stale = false; showPlan(plan);
    setStatus(`${plan.ok ? "Preview compiled" : "Preview has explicit gaps"}. ${plan.counts.unresolved_calls} calls need inputs or upstream results. No execution started.`);
  }));
  button(actions, "Open Book", () => run(async () => {
    if (!book.value.trim()) throw new Error("Enter an existing Book reference first.");
    await invoke("open_view", { view: "book", book: book.value.trim() }, { confirmed: true }); dialog.close();
  }));
  button(actions, "Copy agent handoff", () => run(async () => {
    if (!lastPlan || stale) throw new Error("Preview the current inputs before copying a handoff.");
    const text = `Read snap-core, the current resolved instructions, and snap-director. This preview grants no authority. Replan after edits; execute only existing SNAP tools within the person's authorization. Do not bypass proposals or the critic.\n\nRequest:\n${JSON.stringify(lastRequest, null, 2)}\n\nPreview:\n${JSON.stringify(lastPlan, null, 2)}`;
    try { await navigator.clipboard.writeText(text); setStatus("Copied the full request and preview locally. It can contain private project information; share deliberately."); }
    catch { const fallback = field(results, "Clipboard unavailable: select and copy this complete handoff", "textarea", text); fallback.focus(); fallback.select(); setStatus("Select and copy the handoff below. Nothing was uploaded."); }
  }));
  const preferences = details(body, "Save scoped workflow preferences through native instructions");
  const scope = field(preferences, "Scope (global, book:id, scene:id or shot:scene/shot)", "input", "global");
  let scopeEdited = false;
  const updateScope = () => {
    if (scopeEdited) return;
    const b = book.value.trim().replace(/^book:/, "").split("@")[0], s = scene.value.trim(), sh = shot.value.trim();
    scope.value = s && sh ? `shot:${s}/${sh}` : s ? `scene:${s}` : b ? `book:${b}` : "global";
  };
  scope.addEventListener("input", () => { scopeEdited = true; });
  for (const input of [book, scene, shot]) input.addEventListener("input", updateScope);
  updateScope();
  const existingNote = field(preferences, "Existing instruction reference to revise (optional)");
  const notePreview = el("pre"); preferences.append(notePreview); let noteCall = null;
  button(preferences, "Prepare note (read-only)", () => run(async () => {
    noteCall = await invoke("strategy_parameter_note", { strategy: select.value, scope: scope.value.trim(), parameters: parse(params.value, "Parameters"), ...(existingNote.value.trim() ? { instruction: existingNote.value.trim() } : {}) });
    notePreview.textContent = JSON.stringify(noteCall, null, 2); setStatus("Review the exact native instruction call below. Nothing has been saved.");
  }));
  button(preferences, "Save the reviewed note", () => run(async () => {
    if (!noteCall) throw new Error("Prepare and review the note first.");
    const out = await invoke(noteCall.tool, noteCall.args, { confirmed: true });
    setStatus(JSON.stringify(out, null, 2)); noteCall = null; markStale();
  }));
  for (const input of [scope, existingNote, params, select, book, scene, shot]) input.addEventListener("input", () => { noteCall = null; notePreview.textContent = "Settings changed: prepare a fresh note."; });
  const variant = details(body, "Customize the full strategy and save a private variant");
  variant.append(el("p", "Edit the complete resolved definition below. Use a new id/version. This saves an immutable private card; it does not activate, render, install, or change the shared preset.", "sd-muted"));
  const definition = field(variant, "Strategy definition (JSON)", "textarea"); definition.style.minHeight = "260px";
  button(variant, "Validate variant (no writes)", () => run(async () => {
    if (!current) throw new Error("Choose a strategy first.");
    const out = await invoke("save_strategy_variant", { base: current.ref, expected_base_sha256: current.definition_sha256, definition: parse(definition.value, "Variant"), dry_run: true });
    setStatus(`Variant validated without writes. Proposed reference: ${out.ref}`);
  }));
  button(variant, "Save private variant", () => run(async () => {
    if (!current) throw new Error("Choose a strategy first.");
    const out = await invoke("save_strategy_variant", { base: current.ref, expected_base_sha256: current.definition_sha256, definition: parse(definition.value, "Variant") }, { confirmed: true });
    setStatus(JSON.stringify(out, null, 2)); await refresh(out.ref);
  }));
  async function changedStrategy() {
    current = await invoke("describe_strategy", { strategy: select.value });
    summary.textContent = `${current.definition.summary} — ${current.implementation}`;
    const editable = structuredClone(current.definition); editable.id = `${editable.id}.mine`; editable.version = "1.0.0";
    definition.value = JSON.stringify(editable, null, 2); markStale(); noteCall = null;
  }
  async function refresh(prefer = select.value) {
    const list = await invoke("list_strategies", {}); select.replaceChildren();
    for (const item of list.strategies) { const option = el("option", `${item.name}${item.status === "draft" ? " (design only)" : ""} — ${item.key}`); option.value = item.ref; select.append(option); }
    if (list.strategies.some((s) => s.ref === prefer)) select.value = prefer;
    if (list.invalid.length) setStatus(`Some entries are invalid; they were not silently accepted:\n${JSON.stringify(list.invalid, null, 2)}`);
    if (list.strategies.length) await changedStrategy(); else setStatus("No valid strategies found; inspect the catalogue errors.");
  }
  select.addEventListener("change", () => run(changedStrategy));
  dialog.showModal(); await run(() => refresh());
}
