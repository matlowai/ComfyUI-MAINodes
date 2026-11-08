// SNAP-R13 capability data · SNAP-R19 typed tools · SNAP-R67 canon remains in the Book. · SNAP-R272 native planning.
export const STRATEGY_SCHEMA = "snap.production-strategy/v1";
export const PARAMETER_NOTE_SCHEMA = "snap.strategy-parameters/v1";
export const STAGE_KINDS = ["orient", "book", "story", "assets", "voices", "location", "coverage", "boards", "animatic", "generate", "critique", "sequence_review", "export", "source", "transform", "upscale", "operations"];
export const PARAMETER_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    candidate_count: { type: "integer", minimum: 1 },
    reuse_approved: { type: "boolean" },
    coverage: { type: "string", enum: ["minimal", "natural", "cinematic"] },
    review: { type: "string", enum: ["quick", "full"] },
    continuation: { type: "string", enum: ["auto", "same_camera", "new_angle", "none"] },
    edit_mode: { type: "string", enum: ["edit", "recast"] },
    edit_method: { type: "string", minLength: 1 },
    view_method: { type: "string", minLength: 1 },
    upscale_method: { type: "string", minLength: 1 },
    upscale: { type: "boolean" },
    export_cut: { type: "boolean" },
    target_seconds: { type: "number", exclusiveMinimum: 0 }
  }
};
export const DEFAULT_PARAMETERS = {
  candidate_count: 2, reuse_approved: true, coverage: "natural", review: "full",
  continuation: "auto", edit_mode: "edit", edit_method: "remake_edit",
  view_method: "inherit", upscale_method: "inherit", upscale: false, export_cut: true
};
const str = { type: "string", minLength: 1 };
export const STRATEGY_DEFINITION_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["schema", "id", "version", "name", "summary", "status"],
  properties: {
    schema: { const: STRATEGY_SCHEMA },
    id: { type: "string", pattern: "^[a-z][a-z0-9.-]*$" },
    version: { type: "string", pattern: "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$" },
    name: { type: "string", minLength: 1 },
    summary: { type: "string", minLength: 1 },
    status: { type: "string", enum: ["ready", "draft"] },
    extends: { type: "string", pattern: "^(pack:)?[a-z][a-z0-9.-]*@[0-9]+\\.[0-9]+\\.[0-9]+$" },
    parameters: PARAMETER_SCHEMA,
    skills: { type: "array", uniqueItems: true, items: str },
    stages: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["id", "kind"],
        properties: {
          id: { type: "string", pattern: "^[a-z][a-z0-9.-]*$" },
          kind: { type: "string", enum: STAGE_KINDS },
          title: { type: "string" },
          after: { type: "array", uniqueItems: true, items: str },
          enabled: { type: "boolean" },
          optional: { type: "boolean" },
          guidance: { type: "string" },
          operations: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["tool"],
              properties: { tool: str, args: { type: "object" }, bindings: { type: "object", additionalProperties: str }, why: { type: "string" } }
            }
          }
        }
      }
    }
  }
};
export const PARAMETER_NOTE_BODY_SCHEMA = {
  type: "object", additionalProperties: false, required: ["schema", "strategy", "parameters"],
  properties: { schema: { const: PARAMETER_NOTE_SCHEMA }, strategy: { type: "string", minLength: 1 }, parameters: PARAMETER_SCHEMA, definition_sha256: { type: "string", pattern: "^[a-f0-9]{64}$" } }
};
export const NATIVE_METHOD_PARAMETERS = { edit_method: "edit", view_method: "view", upscale_method: "upscale" };
