// SNAP-R19 one tool table · SNAP-R24 scene ownership · SNAP-R67 human canon · SNAP-R93 scoped guidance. · SNAP-R272 native planning.
// Pure proposal compiler. No imports from the browser, storage, jobs, or generation code.
import { assertValid, checkNativeCall, clone, DirectorError, issue, jsonSafe, orderDAG, sha256 } from "./validation.mjs";
import { PARAMETER_SCHEMA } from "./contracts.mjs";
import { resolveParameters } from "./registry.mjs";
import { PACK_SCHEMA, packShots } from "./packing.mjs";
import { REFERENCE_REQUEST_SCHEMA, compileReferences } from "./references.mjs";

const ref = { type: "string", minLength: 1 };
export const PLAN_REQUEST_SCHEMA = { type: "object", required: ["strategy"], additionalProperties: false, properties: {
  strategy: ref, book: ref, scene: ref, shot: ref, source_take: ref, parameters: PARAMETER_SCHEMA,
  inputs: { type: "object", additionalProperties: false, properties: {
    name: { type: "string", minLength: 1 }, fountain: { type: "string", minLength: 1 },
    change: { type: "string", minLength: 1 }, who: { type: "string", minLength: 1 }, becomes: { type: "string", minLength: 1 },
    frames: { type: "array", minItems: 1, uniqueItems: true, items: { type: "integer", minimum: 0 } },
    source_range: { type: "object", required: ["start_frame", "end_frame"], additionalProperties: false, properties: { start_frame: { type: "integer", minimum: 0 }, end_frame: { type: "integer", minimum: 0 } } },
    mask_requested: { type: "boolean" },
  } },
  packing: PACK_SCHEMA, reference_packet: REFERENCE_REQUEST_SCHEMA,
} };
const bare = (r) => typeof r === "string" ? r.split("@")[0] : r;
const supplied = (object) => Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null));
function cutOrder(units) {
  const ids = new Set(units.map((u) => u.cut));
  return orderDAG(units.map((u) => ({ ...u, id: u.cut, after: u.opens_on?.cut && ids.has(u.opens_on.cut) ? [u.opens_on.cut] : [] })));
}
/** Snapshot is an ephemeral projection of existing records. No plan progress is persisted here. */
export async function compilePlan({ resolved, snapshot, request, tools, methods = [], instructions = {}, scopedInstructions = {}, toolInstructions = {} }) {
  assertValid(request, PLAN_REQUEST_SCHEMA, "plan_strategy");
  jsonSafe(snapshot);
  if (resolved.definition.status !== "ready") throw new DirectorError("DRAFT_STRATEGY", `${resolved.definition.name} is a design example, not an implemented production plan`);
  const definitionDigest = await sha256(resolved.definition);
  const parameters = resolveParameters({ ...resolved, digest: definitionDigest }, instructions, request.parameters ?? {}, methods);
  const scoped = Object.fromEntries(Object.entries(scopedInstructions).map(([key, stack]) => [key, resolveParameters({ ...resolved, digest: definitionDigest }, stack, request.parameters ?? {}, methods)]));
  const toolParameters = Object.fromEntries(Object.entries(toolInstructions).map(([key, stack]) => [key, resolveParameters({ ...resolved, digest: definitionDigest }, stack, request.parameters ?? {}, methods)]));
  const localParameters = (u, tool = null) => (tool && toolParameters[`${u.scene}/${u.shot}:${tool}`]?.effective) || scoped[`${u.scene}/${u.shot}`]?.effective || parameters.effective;
  const p = parameters.effective, inputs = request.inputs ?? {}, book = snapshot.book ?? null, bookRef = book ? bare(book.ref) : null;
  const units = snapshot.units ?? [], casts = snapshot.cast ?? [], locations = snapshot.locations ?? [];
  const beats = book?.story?.beats ?? [], errors = [...parameters.errors, ...(snapshot.errors ?? [])], warnings = [...parameters.warnings, ...(snapshot.warnings ?? [])];
  for (const [scope, local] of Object.entries({ ...scoped, ...toolParameters })) {
    errors.push(...local.errors.map((e) => ({ ...e, instruction_scope: scope })));
    warnings.push(...local.warnings.map((e) => ({ ...e, instruction_scope: scope })));
  }
  const decisions = [], stages = [], tasks = [], barriers = new Map();
  const packing = request.packing ? packShots(request.packing) : null;
  const references = request.reference_packet ? compileReferences(request.reference_packet) : null;
  if (p.target_seconds && packing?.ok && packing.alternatives.length) {
    const fps = packing.limits.fps.num / packing.limits.fps.den;
    const seconds = packing.alternatives[0].total_frames / fps;
    if (seconds > p.target_seconds + 1e-6) warnings.push(issue("PRODUCTION_DURATION_EXCEEDED", `Best packing is ${seconds.toFixed(3)}s including padding, over the ${p.target_seconds}s production objective. No speech/action was dropped.`, "parameters.target_seconds"));
  }
  if (packing && !packing.ok) errors.push(...packing.errors.map((e) => ({ ...e, helper: "shot_packing" })));
  if (references && !references.ok) errors.push(...references.errors.map((e) => ({ ...e, helper: "references" })));
  if (book?.pending_proposals?.length) warnings.push(issue("CANON_PENDING", "Waiting proposals are not accepted story state; settle them and replan before dependent work", "book", { proposals: book.pending_proposals }));
  if (p.target_seconds && !packing) warnings.push(issue("DURATION_NOT_ESTIMATED", "target_seconds is a creative objective; provide explicit beat estimates and engine limits to obtain a packing proposal", "parameters.target_seconds"));
  let orderedCuts = units;
  try { orderedCuts = cutOrder(units); } catch (error) { errors.push(issue("CUT_DEPENDENCY_ERROR", error.message, "units")); }
  const scopedBeatIds = new Set(units.flatMap((u) => u.beats ?? []));
  const scopeBeats = snapshot.target?.shot || snapshot.target?.scene ? beats.filter((b) => scopedBeatIds.has(b.id)) : beats;
  const speakers = [...new Set(scopeBeats.flatMap((b) => (b.lines ?? []).map((l) => l.who)))];
  const bindingsForBook = bookRef ? {} : { book: "The create_book result, after checking its returned identity" };
  const bargs = () => bookRef ? { book: bookRef } : {};

  for (const stage of orderDAG(resolved.definition.stages)) {
    const dependencyEnds = [...new Set((stage.after ?? []).flatMap((id) => barriers.get(id) ?? []))];
    const node = { id: stage.id, kind: stage.kind, title: stage.title ?? stage.kind.replaceAll("_", " "), after: [...(stage.after ?? [])], status: "planned", reasons: [], reuses: [], preconditions: [], operations: [], guidance: stage.guidance ?? "" };
    const operations = node.operations;
    let serialAfter = dependencyEnds;
    const add = (tool, args = {}, bindings = {}, why = "", extra = {}) => {
      const governance = new Set(["set_agent_permissions", "set_autonomy", "set_profile", "save_skill", "set_instruction_status", "chrome", "request_reload", "delete_record", "export_records", "import_records", "ui", "press_button"]);
      if (governance.has(tool)) errors.push(issue("OUTSIDE_STRATEGY_AUTHORITY", `${tool} must remain a separate explicit user operation, not a production preset action`, stage.id));
      const candidate = supplied(args), check = checkNativeCall(tool, candidate, tools), descriptor = tools.find((t) => t.name === tool);
      for (const key of Object.keys(bindings)) if (!Object.hasOwn(descriptor?.inputSchema?.properties ?? {}, key)) check.errors.push(issue("UNKNOWN_BINDING", `${tool} has no argument ${key}`, key));
      for (const key of check.missing) if (!Object.hasOwn(bindings, key)) bindings[key] = `Agent must supply ${tool}.${key} from current evidence or an upstream result`;
      const operation = { id: `${stage.id}:${operations.length + 1}`, tool, args: clone(candidate), bindings: clone(bindings), after: [...serialAfter], why,
        arguments_complete: !governance.has(tool) && check.exists && !check.errors.length && !check.missing.length && !Object.keys(bindings).length,
        approval: "Re-enter the normal SNAP tool dispatcher; this plan grants no permission", contract: check, ...extra };
      operations.push(operation); tasks.push(operation); serialAfter = [operation.id];
      if (!check.exists || check.errors.length) errors.push(issue("NATIVE_CONTRACT_MISMATCH", `${operation.id}: ${tool} is unavailable or incompatible`, operation.id, { errors: check.errors }));
      return operation;
    };
    const needs = (code, text) => { node.preconditions.push({ code, text }); };
    const decision = (id, text) => { decisions.push({ id: `${stage.id}/${id}`, text, owner: "creator or authorized directing agent" }); };
    if (stage.enabled === false) {
      node.status = "skipped"; node.reasons.push("Disabled explicitly by this strategy version; not a declaration that its prerequisites are satisfied.");
    } else switch (stage.kind) {
      case "orient":
        add("describe_recipe", {}, {}, "Read the actual graph and revision without changing it");
        add("list_activity", {}, {}, "Check existing jobs before starting work; do not duplicate queued work");
        node.reasons.push("Use the supplied resolved instruction stack; re-read the target's instructions before each mutation.");
        break;
      case "book":
        if (book) { node.reuses.push({ ref: book.ref, what: "existing Book" }); node.reasons.push("Preserve this Book and its current story; do not create another production."); }
        else add("create_book", supplied({ name: inputs.name }), inputs.name ? {} : { name: "Creator's production name" }, "Create an empty native Book; screenplay and canon edits remain separate proposals");
        break;
      case "story":
        if (inputs.fountain !== undefined) {
          add("import_fountain", { ...bargs(), text: inputs.fountain }, { ...bindingsForBook }, "Import the supplied text through the existing Fountain parser and proposal route, without an agent rewrite");
          needs("WAIT_FOR_CANON", "The person accepts the story proposal; replan from the resulting Book before making cuts.");
        } else if (beats.length) {
          node.reuses.push({ ref: book.story.ref, what: "accepted beats and state changes" });
          node.reasons.push("Retain existing screenplay, story order and telling order; no automatic canon edits.");
        } else {
          add("add_beat", bargs(), { ...bindingsForBook, text: "One creator-approved story beat, preserving supplied wording" }, "Propose beats through the native Book tools");
          needs("STORY_INPUT", "Draft or supply the story, propose its state changes, then obtain the existing canon approval.");
        }
        if (bookRef) add("story_stale", { book: bookRef }, {}, "Identify affected boards/takes before deciding whether existing work can be reused");
        decision("state", "Extract handoffs, carried items, wardrobe and environment changes with snap-book; use add_change proposals, never inferred canon.");
        break;
      case "assets":
        for (const cast of casts) {
          if (cast.missing) { needs("CAST_MISSING", `Resolve ${cast.ref}; do not silently substitute a character.`); continue; }
          if (!cast.refs?.length) { needs("CAST_REFERENCE_REQUIRED", `${cast.ref}: establish an inspected primary reference with the native image/Cast workflow before asking a sheet method to transform it.`); continue; }
          if (cast.refs?.length && p.reuse_approved) { node.reuses.push({ ref: cast.ref, what: "existing Cast references; review remains necessary" }); continue; }
          add("make_character_sheet", { cast: cast.ref, count: p.candidate_count }, {}, "Prepare a missing character reference through the existing sheet methods");
        }
        if (!casts.length) decision("cast", "Identify only the people the accepted script needs. Reuse existing Cast or create records with save_cast; do not manufacture a cast for an empty scene.");
        node.reasons.push("State-specific costumes and carried items still use design_state/save_cast_state where the story requires them.");
        break;
      case "voices": {
        const speaking = casts.filter((c) => speakers.some((s) => bare(s) === bare(c.ref)));
        if (!speakers.length) { node.status = "skipped"; node.reasons.push("No speaking Cast is present in the inspected accepted beats."); break; }
        for (const who of speakers) if (!speaking.some((c) => bare(c.ref) === bare(who))) needs("SPEAKER_UNRESOLVED", `Resolve speaker ${who} to its Cast before assigning a voice.`);
        for (const cast of speaking) {
          if (cast.voice?.file) node.reuses.push({ ref: cast.ref, what: "voice reference, only on this Cast's speaking cuts" });
          else { needs("VOICE_REFERENCE_MISSING", `${cast.ref} speaks but has no reference. Follow snap-voice and save it through use_take/save_cast.`); decision(`voice-${bare(cast.ref)}`, "Prepare a clean reference on words absent from the script; compare it by listening, not ASR alone."); }
        }
        break;
      }
      case "location":
        for (const location of locations) {
          if (location.missing) { needs("LOCATION_MISSING", `Resolve ${location.ref}`); continue; }
          node.reuses.push({ ref: location.ref, what: "location, camera marks and named plates" });
          needs("SCENE_PACKET_REVIEW", `${location.ref}: inspect a textured top plus a genuine elevation, preferably two; existing fields do not certify image geometry.`);
        }
        if (!locations.length) decision("location", "Use only the locations required by this production; build missing ones through snap-location, not a side graph.");
        for (const u of units.filter((u) => u.location && !u.plate && !u.opens_on)) needs("CAMERA_PLATE_MISSING", `${u.cut}: choose or prepare its own camera-side plate, rather than conditioning every angle on the master.`);
        break;
      case "coverage":
        node.reasons.push(`Coverage preference: ${p.coverage}. It is directing guidance, not a mandate to add camera cuts or re-write existing units.`);
        if (units.length) {
          node.reuses.push(...units.map((u) => ({ ref: `${u.scene}/${u.shot}`, what: `${u.cut}: existing authored coverage` })));
          if (packing) decision("packing-existing", "Packing alternatives are suggestions only. Preserve stable cut IDs; explicitly propose any regrouping of existing units.");
        } else if (packing?.ok && packing.alternatives.length) {
          for (const segment of packing.alternatives[0].segments) {
            const known = segment.beat_ids.every((id) => beats.some((b) => b.id === id));
            const args = { ...bargs(), seconds: segment.render_seconds, ...(known ? { beats: segment.beat_ids } : {}) };
            add("add_cut", args, { ...bindingsForBook, scene_name: "Accepted scene grouping for these beats", ...(known ? {} : { beats: "Map these packing IDs to accepted Book beat IDs" }) }, "Propose the best packing's render unit; padding and boundary costs remain visible in helpers.packing");
          }
        } else {
          add("add_cut", bargs(), { ...bindingsForBook, beats: "Accepted beat IDs for this cut", scene_name: "Accepted scene name", seconds: "Duration justified by dialogue/action and the selected engine" }, "Create a native cut after choosing meaningful coverage");
          needs("COVERAGE_DECISION", "Choose cut boundaries and timing. pack_shots is available once explicit duration estimates and engine limits exist.");
        }
        break;
      case "boards":
        if (!units.length) { needs("CUTS_NOT_CREATED", "Replan after add_cut returns real scene and shot IDs."); break; }
        for (const u of units) {
          const local = localParameters(u, "make_board");
          if (local.reuse_approved && u.board?.approved && (u.board.file || u.board.take)) { node.reuses.push({ ref: `${u.scene}/${u.shot}`, what: "selected board, conditional on story_stale review" }); continue; }
          add("make_board", { scene: u.scene, shot: u.shot, count: local.candidate_count, ...(local.view_method === "inherit" ? {} : { method: local.view_method }) }, {}, `Prepare ${u.cut}'s board through snap-boards; respect the native opening/key role returned`);
          add("wait_for", { until: "waiting" }, { job: "The native board decision ID" }, "Wait for the real board candidates before inspecting or picking");
          add("candidate_frames", {}, { decision: "The board decision ID from make_board" }, "Inspect all whole frames and the native critic before choosing");
          add("set_board", { scene: u.scene, shot: u.shot, approved: true }, { take: "The inspected board candidate's take ID" }, "Recommend the board via the existing pick/proposal path; do not use apply_candidate to replace a Book cut's video", { preconditions: ["Inspect make_board.role: a key candidate stays a key; approved does not turn it into an opening board", "Replan and create an opening board separately when the cut needs one"] });
        }
        needs("BOARD_REVIEW", "Inspect the whole boards and relevant critique; existing approved assets remain unchanged until a new pick is authorized.");
        break;
      case "animatic":
        add("animatic", bargs(), { ...bindingsForBook }, "Review timing and adjacent boards before committing to video");
        needs("ANIMATIC_REVIEW", "Watch the actual animatic and inspect cut-pair issues; not just isolated stills.");
        break;
      case "generate": {
        if (!units.length) { needs("CUTS_NOT_CREATED", "Replan with real cuts and selected boards."); break; }
        const cutCompletions = new Map();
        for (let index = 0; index < orderedCuts.length; index++) {
          const u = orderedCuts[index], local = localParameters(u), target = { scene: u.scene, shot: u.shot };
          const predecessor = u.opens_on?.cut;
          if (predecessor) {
            if (cutCompletions.has(predecessor)) serialAfter = [...new Set([...serialAfter, cutCompletions.get(predecessor)])];
            needs("PREDECESSOR_PICK", `${u.cut} waits for ${predecessor}'s selected, inspected trim-out; re-picking or trimming it requires replanning.`);
          }
          if (local.reuse_approved && u.active) {
            node.reuses.push({ ref: u.active, what: `${u.cut}: selected take; not a declaration of visual correctness or freshness` });
            const inspect = add("get_take", { take: u.active }, {}, "Check current take status, provenance and critiques before reuse");
            cutCompletions.set(u.cut, inspect.id); continue;
          }
          if (local.continuation === "same_camera" && !predecessor && index > 0) {
            const previous = orderedCuts[index - 1];
            add("set_unit", { ...target, opens_on: { cut: previous.cut } }, {}, "Explicit same-camera preference: propose opening on the prior selected out-frame", { preconditions: ["Confirm these cuts continue the same action and camera; replan after the edit"] });
          } else if (["new_angle", "none"].includes(local.continuation) && predecessor) needs("CONTINUATION_CONFLICT", `${u.cut} has opens_on=${predecessor} but the request asks for ${local.continuation}. Resolve via set_unit before rendering.`);
          add("open_shot", target, {}, `Open ${u.cut} through native tab/unsaved-work safeguards`);
          add("describe_recipe", {}, {}, "Check this shot's actual graph and setup before applying anything");
          needs("RECIPE_READINESS", `${u.cut}: if empty, start_recipe through the native route and verify scene ownership; never replace a non-empty graph silently.`);
          add("compile_unit", target, {}, "Read actual story/reference lint; this existing tool can materialize reference frames");
          add("apply_unit", target, {}, "Use the existing compiler's final references, Dials, voices and graph pins");
          for (let candidate = 1; candidate <= local.candidate_count; candidate++) {
            if (candidate > 1) add("new_seed", {}, {}, `${u.cut}: draw a fresh native seed for candidate ${candidate}; do not change seed mode or create identical cached candidates`);
            add("run", {}, {}, `${u.cut}: candidate ${candidate}/${local.candidate_count}; choose seed deliberately in the real recipe, preserving provenance`, { preconditions: ["Confirm current page is this cut", "Native GPU permission", "Resolve input/graph errors", "Do not duplicate an already-running matching job"] });
            add("wait_for", {}, { job: "The run or accepted-proposal result's job ID" }, "Wait on the real Work job; a proposal ID is not a render result");
          }
          add("list_critiques", { state: "due" }, {}, `${u.cut}: complete the landed candidates' critic docket before selecting a winner`);
          const picked = add("set_active_take", target, { take: "The inspected winning video take, after critiques and authorized choice" }, "Use the existing candidate/pick policy; never make a still the active video", { preconditions: ["Complete the candidates' native critic work, including sound", "Inspect every candidate before recommending a pick", "Use the person's existing pick/proposal authority"] });
          cutCompletions.set(u.cut, picked.id);
        }
        break;
      }
      case "critique":
        add("list_critiques", { state: "due" }, {}, "Find actual due review work; claim and read with the unmodified snap-critic skill");
        decision("review", p.review === "full" ? "Inspect whole frames, tiles, counts, cross-view geometry and sound with snap-critic; fix at the earliest evidenced source." : "Prioritize high-impact checks, but do not skip permission, identity, continuity or sound evidence. The measured critic itself is unchanged.");
        if (snapshot.source_take) add("get_take", { take: snapshot.source_take.id }, {}, "Keep the original source and its lineage available for edit comparison");
        for (const u of units.filter((u) => u.active)) {
          add("get_take", { take: u.active }, {}, `${u.cut}: inspect recorded review and provenance`);
          if ((u.beats ?? []).some((id) => beats.find((b) => b.id === id)?.lines?.length)) add("check_voice", { take: u.active }, {}, "Optional native voice QA is GPU/analysis work, not proof that someone listened", { preconditions: ["Explicit authority for this check and the chosen device", "Actual listening remains necessary"] });
        }
        needs("REVIEW_BEFORE_PICK_OR_DELIVERY", "A finished job is not a quality approval. Claim, inspect and write native critiques before recommending picks or presenting the Cut.");
        break;
      case "sequence_review":
        if (bookRef) add("story_stale", { book: bookRef }, {}, "Inspect dependent changes before final assembly");
        needs("WHOLE_SEQUENCE_REVIEW", "Review assembled action phases, persistent changes, grade, sound splices and audio/video tails using SNAP-R267. Repeat after export.");
        break;
      case "export":
        if (!p.export_cut) { node.status = "skipped"; node.reasons.push("Export disabled by effective preferences."); break; }
        add("export_cut", bargs(), { ...bindingsForBook }, "Create native Cut/OTIO through existing authority; no publishing or Astrid push is enabled by a strategy");
        needs("AFTER_EXPORT_REVIEW", "Watch and listen to the actual exported file. Leave the person's Astrid push control unchanged.");
        break;
      case "source":
        if (snapshot.source_take) {
          node.reuses.push({ ref: snapshot.source_take.id, what: "original video source, never overwritten" });
          add("get_take", { take: snapshot.source_take.id }, {}, "Inspect the source's native provenance and duration");
        } else needs("VIDEO_SOURCE_REQUIRED", "Select an existing SNAP video take; import/establish external footage through a supported native route first.");
        break;
      case "transform": {
        const local = toolParameters.edit_take?.effective ?? p;
        if (inputs.source_range || inputs.mask_requested) {
          node.status = "gap"; errors.push(issue("TEMPORAL_EDIT_CAPABILITY_GAP", "This implementation cannot guarantee frame-range/mask preservation via edit_take. No whole-clip substitution is proposed.", stage.id)); break;
        }
        if (inputs.frames?.length) warnings.push(issue("ANCHORS_NOT_RANGE", "frames selects painted anchor frames, not an edit-only range. Propagation may affect the whole video.", "inputs.frames"));
        const take = snapshot.source_take?.id;
        const method = local.edit_mode === "recast" ? "remake_swap" : local.edit_method;
        if (local.edit_mode === "recast" && !methods.some((m) => m.id === method && m.slot === "recast" && m.wired !== false && !m.unwired)) errors.push(issue("METHOD_UNRESOLVED", "No wired recast/remake_swap method", "parameters.edit_mode"));
        const bind = take ? {} : { take: "The original source video take ID" };
        if (local.edit_mode === "recast") { if (!inputs.who) bind.who = "The source person to replace"; if (!inputs.becomes) bind.becomes = "The intended new person"; }
        else if (!inputs.change) bind.change = "The precise creative change; preserve everything else";
        for (let left = local.candidate_count; left > 0; left -= 3) {
          add("edit_take", supplied({ take, method, count: Math.min(3, left), frames: inputs.frames, ...(local.edit_mode === "recast" ? { who: inputs.who, becomes: inputs.becomes } : { change: inputs.change }) }), { ...bind }, "Paint candidates through the native edit path; each batch respects edit_take's maximum of three", { preconditions: ["Inspect all existing in-flight edit decisions before submitting another batch"] });
          add("wait_for", { until: "waiting" }, { job: "The native edit decision ID returned by edit_take, after any proposal is accepted" }, "Wait for painted candidates on the existing Work card before inspection");
          add("candidate_frames", {}, { decision: "The native edit decision ID after its painted candidates finish" }, "Inspect painted candidates and identity notes before propagation");
        }
        add("apply_candidate", {}, { decision: "The chosen native edit decision", candidate: "The inspected winning candidate" }, "Propagate the authorized pick as a child take; the original remains intact");
        add("wait_for", {}, { job: "The native propagation run's job ID" }, "Wait for the real propagation output, then run critique");
        break;
      }
      case "upscale": {
        const local = toolParameters.upscale_take?.effective ?? p;
        if (!local.upscale) { node.status = "skipped"; node.reasons.push("Optional upscale is off."); break; }
        add("upscale_take", local.upscale_method === "inherit" ? {} : { method: local.upscale_method }, { take: "The inspected, selected output take, not the original by accident", ...(local.upscale_method === "inherit" ? { method: "Select an installed, wired native upscale method" } : {}) }, "Use a native take-upscale method only if it supports this media; never assume every media-slot method is callable here");
        break;
      }
      case "operations":
        for (const operation of stage.operations) add(operation.tool, operation.args ?? {}, clone(operation.bindings ?? {}), operation.why ?? "An explicit strategy operation");
        break;
      default: throw new DirectorError("UNKNOWN_STAGE", `No stage implementation ${stage.kind}`);
    }
    if (inputs.fountain !== undefined && !["orient", "book", "story"].includes(stage.kind) && stage.enabled !== false) needs("REPLAN_AFTER_STORY_IMPORT", "This stage reflects the pre-import snapshot. Do not execute it after import; wait for canonical acceptance and regenerate the plan.");
    if (node.status === "planned" && node.preconditions.length) node.status = "needs_review_or_input";
    if (node.status === "planned" && !operations.length && node.reuses.length) node.status = "reuse_proposed";
    if (node.status === "planned" && !operations.length && !node.reuses.length) node.status = "agent_decision";
    barriers.set(stage.id, operations.length ? [operations.at(-1).id] : dependencyEnds);
    stages.push(node);
  }
  orderDAG(tasks);
  const provenance = { definition_sha256: definitionDigest, strategy_ref: resolved.ref, lineage: clone(resolved.lineage), parameters: parameters.provenance,
    inputs: clone(snapshot.provenance ?? {}), instruction_refs: clone(instructions.refs ?? []), instruction_hash: instructions.hash ?? null };
  const fingerprint = await sha256({ definition: resolved.definition, request, snapshot, instruction_stack: instructions, scoped_instructions: scopedInstructions, tool_instructions: toolInstructions, effective: p, operations: tasks, errors });
  return { schema: "snap.production-plan/v1", ok: errors.length === 0, mutates: false, executes: false, plan_sha256: fingerprint,
    strategy: { ref: resolved.ref, id: resolved.definition.id, version: resolved.definition.version, name: resolved.definition.name, status: "planner-implemented; live execution unverified" },
    parameters: p, scoped_parameters: scoped, tool_parameters: toolParameters, provenance, instructions: parameters.instructions, target: clone(snapshot.target ?? {}), stages, operations: tasks,
    decisions, errors, warnings, helpers: { packing, references }, skills: [...new Set(["snap-core", "snap-director", ...(resolved.definition.skills ?? [])])],
    counts: { stages: stages.length, operations: tasks.length, unresolved_calls: tasks.filter((t) => !t.arguments_complete).length },
    costs: { gpu_seconds: null, reason: "No measured run on this installation; consult each native tool's own plan before execution" },
    execution_contract: "A plan is advice, not a job or approval. Bind actual upstream results, re-check the selected page and current instructions, and invoke each ordinary SNAP tool. Inspect proposed/queued/failed results, replan after mutations, and preserve creator canon decisions.",
    provenance_limit: "Planning does not modify graphs or automatically pin this plan into takes. Persist strategy choices with strategy_parameter_note + native save_instruction to use SNAP's existing instruction pins; actual tools retain normal graph/world provenance.",
  };
}
