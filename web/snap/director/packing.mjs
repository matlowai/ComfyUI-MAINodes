// SNAP-R67 story stays authoritative · SNAP-R68 explain compiled decisions · SNAP-R58 full alternatives. · SNAP-R272 native planning.
// Pure top-K dynamic programming. No model-specific duration constants, network, writes or LLM calls.
import { assertValid, DirectorError, issue } from "./validation.mjs";
const positive = { type: "number", exclusiveMinimum: 0 };
const label = { type: "string", minLength: 1 };
export const PACK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["beats", "limits"],
  properties: {
    beats: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["id", "duration_s"],
      properties: { id: label, duration_s: positive, speech_s: { type: "number", minimum: 0 },
        scene: label, camera: label, subject: label, action: label, exchange: label,
        join_next: { type: "boolean" }, break_after: { type: "boolean" }, needs_previous_frame: { type: "boolean" },
        timing_source: { type: "string", enum: ["estimate", "measured"] } }
    } },
    limits: { type: "object", additionalProperties: false, required: ["fps", "min_seconds", "max_seconds"],
      properties: { fps: { type: ["number", "object"] }, min_seconds: positive, max_seconds: positive,
        frame_step: { type: "integer", minimum: 1 }, frame_offset: { type: "integer", minimum: 0 },
        allow_internal_cuts: { type: "boolean" }, descriptor_ref: label } },
    preferred_seconds: positive,
    alternatives: { type: "integer", minimum: 1 },
    weights: { type: "object", additionalProperties: false, properties: Object.fromEntries(["run", "padding", "balance", "mid_action", "mid_exchange", "previous_frame", "camera_change", "subject_change"].map((key) => [key, { type: "number", minimum: 0 }])) }
  }
};
const DEFAULT_WEIGHTS = { run: 1, padding: 2, balance: 0.1, mid_action: 6, mid_exchange: 4, previous_frame: 6, camera_change: 0.5, subject_change: 0.25 };
const ceil = (n) => Math.ceil(n - 1e-9);
const floor = (n) => Math.floor(n + 1e-9);
const rounded = (n) => Number(n.toFixed(9));
export function frameRate(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return { num: value, den: 1, value };
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).sort().join(",") === "den,num" && Number.isSafeInteger(value.num) && Number.isSafeInteger(value.den) && value.num > 0 && value.den > 0) return { num: value.num, den: value.den, value: value.num / value.den };
  throw new DirectorError("INVALID_FPS", "fps must be positive, or {num, den} with positive integer components");
}
export function packShots(input) {
  assertValid(input, PACK_SCHEMA, "shot packing");
  const { beats, limits } = input;
  const fps = frameRate(limits.fps), minFrames = ceil(limits.min_seconds * fps.value), maxFrames = floor(limits.max_seconds * fps.value);
  const step = limits.frame_step ?? 1, offset = limits.frame_offset ?? 0;
  if (limits.min_seconds > limits.max_seconds || minFrames > maxFrames || minFrames < 1) throw new DirectorError("INVALID_DURATION_BOUNDS", "duration bounds contain no positive frame window");
  if (offset >= step) throw new DirectorError("INVALID_FRAME_GRID", "frame_offset must be smaller than frame_step");
  const ids = beats.map((b) => b.id);
  if (new Set(ids).size !== ids.length) throw new DirectorError("DUPLICATE_BEAT", "Each beat id must occur once");
  if (beats.some((b) => b.join_next && b.break_after)) throw new DirectorError("CONTRADICTORY_BOUNDARY", "A beat cannot both join_next and break_after");
  if (beats.at(-1)?.join_next) throw new DirectorError("DANGLING_JOIN", "The last beat cannot join a nonexistent next beat");
  const k = input.alternatives ?? 3, weights = { ...DEFAULT_WEIGHTS, ...input.weights };
  const desired = input.preferred_seconds ?? (limits.min_seconds + limits.max_seconds) / 2;
  const align = (n) => offset + ceil((Math.max(minFrames, n) - offset) / step) * step;
  const frames = beats.map((b) => ceil(Math.max(b.duration_s, b.speech_s ?? 0) * fps.value));
  const hardBreak = (i) => {
    const a = beats[i], b = beats[i + 1];
    return !!b && (a.break_after === true || (a.scene && b.scene && a.scene !== b.scene) || (limits.allow_internal_cuts !== true && a.camera && b.camera && a.camera !== b.camera));
  };
  for (let i = 0; i < beats.length - 1; i++) if (hardBreak(i) && beats[i].join_next) throw new DirectorError("CONTRADICTORY_BOUNDARY", `${beats[i].id} must join the next beat but a scene, camera or explicit boundary requires a cut`);
  const warnings = [];
  for (const [i, b] of beats.entries()) if ((b.speech_s ?? 0) > b.duration_s) warnings.push(issue("SPEECH_FLOOR", `${b.id}: use supplied speech duration ${b.speech_s}s instead of ${b.duration_s}s`, `beats[${i}]`));
  const boundary = (i) => {
    const a = beats[i], b = beats[i + 1], costs = {};
    if (!b) return costs;
    if (a.action && a.action === b.action) costs.mid_action = weights.mid_action;
    if (a.exchange && a.exchange === b.exchange) costs.mid_exchange = weights.mid_exchange;
    if (b.needs_previous_frame) costs.previous_frame = weights.previous_frame;
    if (a.camera && b.camera && a.camera !== b.camera) costs.camera_change = -weights.camera_change;
    if (a.subject && b.subject && a.subject !== b.subject) costs.subject_change = -weights.subject_change;
    return costs;
  };
  const score = (costs) => Object.values(costs).reduce((a, b) => a + b, 0);
  const dp = Array.from({ length: beats.length + 1 }, () => []);
  dp[beats.length] = [{ score: 0, segments: [], boundaries: [] }];
  for (let start = beats.length - 1; start >= 0; start--) {
    let contentFrames = 0;
    const candidates = [];
    for (let end = start; end < beats.length; end++) {
      if (end > start && hardBreak(end - 1)) break;
      contentFrames += frames[end];
      const renderFrames = align(contentFrames);
      if (renderFrames > maxFrames) break;
      if (beats[end].join_next) continue;
      const duration = renderFrames / fps.value, padding = (renderFrames - contentFrames) / fps.value;
      const costs = { run: weights.run, padding: padding * weights.padding, balance: Math.abs(duration - desired) * weights.balance, ...boundary(end) };
      const segment = {
        first: start, last: end, beat_ids: ids.slice(start, end + 1), content_frames: contentFrames,
        render_frames: renderFrames, render_seconds: rounded(duration), padding_frames: renderFrames - contentFrames,
        timing_basis: beats.slice(start, end + 1).every((b) => b.timing_source === "measured") ? "supplied measurements" : "includes supplied estimates",
        needs_previous_frame: !!beats[start].needs_previous_frame,
        cost_breakdown: Object.fromEntries(Object.entries(costs).map(([key, n]) => [key, rounded(n)])),
        boundary_reason: end === beats.length - 1 ? "end of sequence" : hardBreak(end) ? "required scene, camera or explicit boundary" : "lowest-cost legal partition under the supplied weights"
      };
      for (const suffix of dp[end + 1]) candidates.push({ score: rounded(score(costs) + suffix.score), segments: [segment, ...suffix.segments], boundaries: [end, ...suffix.boundaries] });
    }
    candidates.sort((a, b) => a.score - b.score || a.segments.length - b.segments.length || compareArrays(a.boundaries, b.boundaries));
    const seen = new Set();
    for (const candidate of candidates) {
      const key = candidate.boundaries.join(",");
      if (!seen.has(key)) { seen.add(key); dp[start].push(candidate); }
      if (dp[start].length === k) break;
    }
  }
  const errors = [];
  if (!dp[0].length) {
    for (let i = 0; i < beats.length; i++) if (align(frames[i]) > maxFrames) errors.push(issue("BEAT_TOO_LONG", `${beats[i].id} cannot fit without splitting its content`, `beats[${i}]`, { frames: frames[i], max_frames: maxFrames }));
    if (!errors.length) errors.push(issue("NO_LEGAL_PARTITION", "No partition satisfies all joins, hard boundaries and frame-grid duration constraints"));
  }
  return {
    schema: "snap.shot-packing/v1", ok: errors.length === 0, mutates: false,
    limits: { ...limits, fps: { num: fps.num, den: fps.den }, min_frames: minFrames, max_frames: maxFrames, frame_step: step, frame_offset: offset },
    weights, preferred_seconds: desired, warnings, errors,
    alternatives: dp[0].map((candidate, i) => ({ rank: i + 1, ...candidate, total_frames: candidate.segments.reduce((n, s) => n + s.render_frames, 0) })),
    caveat: "Partitions are generation-unit proposals, not accepted Book cuts. Padding is explicit; no dialogue or action is removed. The native model graph remains the authority for admissible frame counts."
  };
}
function compareArrays(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}
