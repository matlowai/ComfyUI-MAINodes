// SNAP-R3 visible omissions · SNAP-R242 reference inclusion · SNAP-R270 native init stays native · SNAP-R271 scene coverage. · SNAP-R272 native planning.
// This is an inspectable reference proposal, NOT a replacement for apply_unit's final graph/socket binding.
import { assertValid, clone, DirectorError, issue, jsonSafe } from "./validation.mjs";

export const REFERENCE_ROLES = ["geometry_top", "geometry_side", "camera_plate", "location_master", "cast_identity", "cast_state", "blocking", "opening_frame", "action_key", "voice_reference", "critic_reference", "edit_canvas", "motion_reference"];
const identifier = { type: "string", minLength: 1, pattern: "^[A-Za-z0-9][A-Za-z0-9_.:/@-]*$" };
const counts = { type: "object", required: ["image", "video", "audio"], additionalProperties: false,
  properties: Object.fromEntries(["image", "video", "audio"].map((k) => [k, { type: "integer", minimum: 0 }])) };
export const REFERENCE_REQUEST_SCHEMA = {
  type: "object", required: ["references", "profile"], additionalProperties: false, properties: {
    profile: { type: "object", required: ["id", "source", "limits", "tags"], additionalProperties: false, properties: {
      id: identifier, source: { type: "string", minLength: 1 }, limits: counts,
      tags: { type: "object", required: ["image", "video", "audio"], additionalProperties: false,
        properties: Object.fromEntries(["image", "video", "audio"].map((k) => [k, { type: "string" }])) },
      first_image_role: { type: "string", enum: ["edit_canvas", "opening_frame"] },
      partial_init_supported: { type: "boolean" },
    } },
    references: { type: "array", items: { type: "object", required: ["id", "media", "roles", "source"], additionalProperties: false, properties: {
      id: identifier, media: { type: "string", enum: ["image", "video", "audio"] },
      roles: { type: "array", minItems: 1, uniqueItems: true, items: { type: "string", enum: REFERENCE_ROLES } },
      source: { type: "object", required: ["ref"], additionalProperties: false, properties: {
        ref: { type: "string", minLength: 1 }, version: { type: ["integer", "string"] }, sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
        frame: { type: "integer", minimum: 0 }, file: { type: "string" },
      } },
      use: { type: "string", enum: ["auto", "generation", "review", "context"] },
      required: { type: "boolean" }, priority: { type: "number" },
      entity: identifier, scene: identifier, viewpoint: identifier, derived_from_viewpoint: identifier,
      genuine_view: { type: "boolean" }, textured: { type: "boolean" }, available: { type: "boolean" },
      approved: { type: "boolean" }, geometry_revision: identifier, authoritative: { type: "boolean" },
    } } },
    context: { type: "object", additionalProperties: false, properties: {
      scene: identifier, geometry_required: { type: "boolean" }, ablation: { type: "boolean" }, ablation_reason: { type: "string", minLength: 1 },
      continuation: { type: "string", enum: ["none", "same_camera", "new_angle"] },
      hold: { type: "boolean" }, speakers: { type: "array", uniqueItems: true, items: identifier },
      denoise: { type: "number", minimum: 0, maximum: 1 },
      geometry_conflicts: { type: "array", items: { type: "object", required: ["refs", "observation"], additionalProperties: false, properties: {
        refs: { type: "array", minItems: 2, items: identifier }, observation: { type: "string", minLength: 1 },
      } } },
    } },
    prompt: { type: "string" },
  },
};
const hasRole = (r, role) => r.roles.includes(role);
const imageOnly = new Set(REFERENCE_ROLES.filter((r) => !["voice_reference", "critic_reference", "motion_reference"].includes(r)));

/** Inputs attest roles/coverage; this routine does not inspect pixels, hear speech, or verify calibration. */
export function compileReferences(input) {
  assertValid(input, REFERENCE_REQUEST_SCHEMA, "reference request");
  const { profile } = input, context = input.context ?? {}, refs = clone(input.references);
  const errors = [], warnings = [], exclusions = [], ids = new Set(), review = [], agentContext = [];
  const exclude = (r, code, message) => {
    exclusions.push({ id: r.id, code, message, source: clone(r.source), requested_use: r.use ?? "auto", required: !!r.required });
    if (r.required) errors.push(issue("REQUIRED_REFERENCE_EXCLUDED", `${r.id}: ${message}`, r.id, { cause: code }));
  };
  for (const r of refs) {
    if (["constructor", "prototype", "__proto__"].includes(r.id)) throw new DirectorError("UNSAFE_REFERENCE_ID", "Use a non-reserved semantic reference id");
    if (ids.has(r.id)) throw new DirectorError("DUPLICATE_REFERENCE_ID", `Reference id ${r.id} occurs twice`);
    ids.add(r.id);
    if (r.roles.some((role) => imageOnly.has(role)) && r.media !== "image") errors.push(issue("ROLE_MEDIA_MISMATCH", `${r.id}: this role requires an image`, r.id));
    if (hasRole(r, "voice_reference") && r.media !== "audio") errors.push(issue("ROLE_MEDIA_MISMATCH", `${r.id}: a voice reference is audio`, r.id));
    if (hasRole(r, "voice_reference") && !r.entity) errors.push(issue("VOICE_OWNER_MISSING", `${r.id}: identify the speaking Cast`, r.id));
    if (r.use === "context") agentContext.push(clone(r)); else review.push(clone(r));
    if (r.source.version === undefined && !r.source.sha256 && !/@\d+$/.test(r.source.ref)) warnings.push(issue("UNPINNED_REFERENCE", `${r.id} has no immutable version or digest`, r.id));
  }
  const sceneRefs = refs.filter((r) => r.available !== false && r.approved !== false && (!context.scene || r.scene === context.scene));
  const tops = sceneRefs.filter((r) => hasRole(r, "geometry_top") && r.textured === true);
  const sides = sceneRefs.filter((r) => hasRole(r, "geometry_side") && r.genuine_view === true && r.viewpoint && !r.derived_from_viewpoint);
  const distinctSides = [...new Set(sides.map((r) => r.viewpoint))];
  const coverage = { required: !!context.geometry_required, top: tops.map((r) => r.id), sides: sides.map((r) => r.id), distinct_sides: distinctSides,
    metadata_complete: tops.length > 0 && distinctSides.length > 0, visually_verified: false,
    interpretation: "Declared viewpoint metadata only; inspect the original whole images and authoritative layout." };
  if (context.ablation && !context.ablation_reason) errors.push(issue("ABLATION_REASON_REQUIRED", "An intentional coverage ablation needs its reason", "context.ablation"));
  if (context.geometry_required && !coverage.metadata_complete) {
    const problem = issue("SCENE_COVERAGE_INCOMPLETE", "Need a textured top and a genuine side/elevation of this same scene; crops are not extra viewpoints", "coverage");
    (context.ablation && context.ablation_reason ? warnings : errors).push(problem);
  }
  if (context.geometry_required && distinctSides.length === 1) warnings.push(issue("SECOND_SIDE_RECOMMENDED", "A second distinct informative elevation improves coverage; benefit still requires visual assessment", "coverage"));
  for (const conflict of context.geometry_conflicts ?? []) {
    errors.push(issue("GEOMETRY_CONFLICT", conflict.observation, "coverage", { refs: clone(conflict.refs) }));
    for (const id of conflict.refs) if (!ids.has(id)) errors.push(issue("UNKNOWN_CONFLICT_REFERENCE", `No reference ${id}`, "coverage"));
  }
  const revisions = [...new Set(sceneRefs.filter((r) => r.authoritative && r.geometry_revision && r.roles.some((role) => ["geometry_top", "geometry_side", "location_master", "camera_plate"].includes(role))).map((r) => r.geometry_revision))];
  if (revisions.length > 1) errors.push(issue("AUTHORITATIVE_GEOMETRY_CONFLICT", "Multiple declared authoritative geometry revisions need reconciliation, not blending", "coverage", { revisions }));

  const active = refs.filter((r) => r.available !== false && r.approved !== false && !["review", "context"].includes(r.use));
  const hasOpening = active.some((r) => hasRole(r, "opening_frame"));
  const hasPlate = active.some((r) => hasRole(r, "camera_plate"));
  if (context.continuation === "same_camera" && !hasOpening) errors.push(issue("OPENING_FRAME_MISSING", "Same-camera continuation needs the selected previous out-frame", "context.continuation"));
  const proposed = [];
  for (const r of refs) {
    if (r.available === false) { exclude(r, "UNAVAILABLE", "Source is marked missing or unreadable"); continue; }
    if (r.approved === false) { exclude(r, "REJECTED_SOURCE", "Source is explicitly unapproved"); continue; }
    if (["review", "context"].includes(r.use)) { exclude(r, "NOT_CONDITIONING", `Kept for ${r.use}, not sent to the generator`); continue; }
    if (hasRole(r, "critic_reference")) { exclude(r, "CRITIC_ONLY", "Critic-only evidence cannot become conditioning implicitly; supply a distinct role assignment"); continue; }
    if (hasRole(r, "voice_reference") && !(context.speakers ?? []).includes(r.entity)) { exclude(r, "NON_SPEAKING_VOICE", "This character has no line in the supplied speaker list"); continue; }
    if (hasRole(r, "action_key") && !context.hold) { exclude(r, "ACTION_KEY_TARGET", "A peak pose can freeze action; retained for review unless this cut deliberately holds"); continue; }
    if (context.continuation === "same_camera" && r.roles.some((role) => ["camera_plate", "location_master", "geometry_top", "geometry_side", "blocking"].includes(role))) { exclude(r, "CONTINUATION_CAMERA_CONFLICT", "The prior out-frame owns this continuation's composition; keep other scene pictures for review"); continue; }
    if (hasPlate && hasRole(r, "location_master")) { exclude(r, "MASTER_WITH_PLATE", "The camera plate owns this view; the wide master stays in review"); continue; }
    if ((hasRole(r, "geometry_top") || hasRole(r, "geometry_side")) && (r.use ?? "auto") === "auto") { exclude(r, "GEOMETRY_REVIEW_DEFAULT", "Scene preparation evidence is not automatically generative conditioning"); continue; }
    proposed.push(r);
  }
  for (const media of ["image", "video", "audio"]) {
    const tag = profile.tags[media];
    if (profile.limits[media] > 0 && (tag.match(/\{n\}/g)?.length !== 1 || /[\r\n]/.test(tag))) errors.push(issue("INVALID_TAG_TEMPLATE", `${media} needs exactly one {n} and no newline`, `profile.tags.${media}`));
  }
  if (context.denoise !== undefined && context.denoise < 1 && !profile.partial_init_supported) errors.push(issue("PARTIAL_INIT_UNSUPPORTED", "The supplied descriptor does not support encoded target initialization", "context.denoise"));
  const firstRole = profile.first_image_role ?? (context.continuation === "same_camera" ? "opening_frame" : null);
  const first = firstRole ? proposed.filter((r) => r.media === "image" && hasRole(r, firstRole)) : [];
  if (firstRole && first.length !== 1) errors.push(issue("FIRST_IMAGE_AMBIGUOUS", `Exactly one conditioning image must have role ${firstRole}; found ${first.length}`, "profile.first_image_role"));
  if (context.denoise !== undefined && context.denoise < 1 && firstRole !== "edit_canvas") errors.push(issue("INIT_CANVAS_MISSING", "Partial initialization requires an explicit edit_canvas first image", "context.denoise"));
  const generation = [], bindings = {}, emittedTags = new Set();
  for (const media of ["image", "video", "audio"]) {
    const rows = proposed.filter((r) => r.media === media);
    // Selection priority never reorders surviving references: graph order remains the authored order, except the declared first image.
    const chosen = [...rows].sort((a, b) => Number(first.includes(b)) - Number(first.includes(a)) || Number(!!b.required) - Number(!!a.required) || (b.priority ?? 0) - (a.priority ?? 0) || refs.indexOf(a) - refs.indexOf(b)).slice(0, profile.limits[media]);
    const selected = rows.filter((r) => chosen.includes(r));
    if (media === "image" && first.length === 1 && selected.includes(first[0])) { selected.splice(selected.indexOf(first[0]), 1); selected.unshift(first[0]); }
    for (const r of rows.filter((r) => !selected.includes(r))) exclude(r, "REFERENCE_BUDGET", `${media} limit ${profile.limits[media]} exceeded; raise the declared budget or change the packet explicitly`);
    for (const [index, r] of selected.entries()) {
      const tag = profile.tags[media].replace("{n}", String(index + 1));
      if (emittedTags.has(tag)) errors.push(issue("AMBIGUOUS_REFERENCE_TAG", `The descriptor emits ${tag} for multiple references`, "profile.tags"));
      emittedTags.add(tag);
      const bound = { ...clone(r), index: index + 1, tag };
      generation.push(bound); bindings[r.id] = { media, index: index + 1, tag, source: clone(r.source) };
    }
  }
  if (firstRole && first.length === 1 && !generation.some((r) => r.id === first[0].id)) errors.push(issue("FIRST_IMAGE_EXCLUDED", `The ${firstRole} image must remain in conditioning; the supplied image budget excludes it`, "profile.limits.image"));
  const physical = new Map();
  for (const r of generation) {
    const key = JSON.stringify([r.media, r.source.sha256 ?? r.source.file ?? r.source.ref, r.source.version ?? null, r.source.frame ?? null]);
    if (physical.has(key)) warnings.push(issue("DUPLICATE_SOURCE", `${r.id} and ${physical.get(key)} declare the same source; both consume slots. Confirm this is intentional.`, r.id));
    else physical.set(key, r.id);
  }
  let prompt = null;
  if (input.prompt !== undefined) {
    try { prompt = bindPrompt(input.prompt, bindings); }
    catch (error) { errors.push(issue(error.code ?? "PROMPT_BINDING", error.message, "prompt", { details: error.details ?? [] })); }
  }
  return { schema: "snap.reference-plan/v1", ok: errors.length === 0, mutates: false, profile: clone(profile), profile_verified_against_live_graph: false,
    generation, review, context: agentContext, bindings, coverage, exclusions, errors, warnings, prompt,
    next: "Inspect the packet. Existing compile_unit/apply_unit or edit_from_context owns the executed graph and final socket order. Reconcile this proposal against their returned prompt before rendering." };
}

/** Explicit semantic placeholders only. Prevent a second source of numbered references in agent prose. */
export function bindPrompt(template, bindings) {
  if (typeof template !== "string") throw new DirectorError("INVALID_PROMPT", "Prompt must be text");
  jsonSafe(bindings);
  if (/<\s*(?:Picture|Audio|Video|Subject)\s*\d+\s*>|<\s*image\d+\s*>/i.test(template)) throw new DirectorError("RAW_REFERENCE_TAG", "Use {{ref:id}} instead of hard-coded numbered model tags");
  const unresolved = [];
  const text = template.replace(/\{\{ref:([^{}]+)\}\}/g, (_, id) => {
    const binding = Object.hasOwn(bindings, id) ? bindings[id] : null;
    if (!binding) { unresolved.push(id); return ""; }
    if (typeof binding.tag !== "string") throw new DirectorError("INVALID_BINDING", `Reference ${id} has no tag`);
    return binding.tag;
  });
  if (unresolved.length) throw new DirectorError("UNBOUND_REFERENCE", "Prompt cites a missing, excluded or review-only reference", [...new Set(unresolved)]);
  if (/\{\{|\}\}/.test(text)) throw new DirectorError("UNKNOWN_PLACEHOLDER", "Only exact {{ref:id}} placeholders are supported");
  return text;
}
