// SNAP-R3 explicit missing values · SNAP-R19 one tool contract · SNAP-R58 complete diagnostics. · SNAP-R272 native planning.
// Dependency-free validation for JSON data, not an evaluator or a second permission system.
export class DirectorError extends Error {
  constructor(code, message, details = []) {
    super(message); this.name = "DirectorError"; this.code = code; this.details = details;
  }
}
export const clone = (value) => structuredClone(value);
export const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const BAD_KEYS = new Set(["__proto__", "prototype", "constructor"]);
export function jsonSafe(value, path = "$", seen = new Set()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (typeof value !== "object") throw new DirectorError("NOT_JSON", `${path}: expected JSON data`);
  if (seen.has(value)) throw new DirectorError("INPUT_CYCLE", `${path}: cyclic input`);
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new DirectorError("NOT_PLAIN_OBJECT", `${path}: expected a plain JSON object`);
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (BAD_KEYS.has(key)) throw new DirectorError("UNSAFE_KEY", `${path}.${key}: reserved object key`);
    jsonSafe(value[key], `${path}.${key}`, seen);
  }
  seen.delete(value);
}
export function stableJSON(value) {
  jsonSafe(value);
  const order = (v) => Array.isArray(v) ? v.map(order) : isObject(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, order(v[k])])) : v;
  return JSON.stringify(order(value));
}
export async function sha256(value) {
  const bytes = new TextEncoder().encode(stableJSON(value));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
}
export const issue = (code, message, path = "", extra = {}) => ({ code, message, path, ...extra });
const typed = (value, type) => type === "object" ? isObject(value) : type === "array" ? Array.isArray(value) : type === "null" ? value === null : type === "integer" ? Number.isSafeInteger(value) : type === "number" ? typeof value === "number" && Number.isFinite(value) : typeof value === type;
/** Deliberately small JSON Schema subset. Our schemas use only these keywords.
 * Native tool schemas are checked for required/top-level keys separately; they are not claimed fully validated. */
export function validate(value, schema, path = "$") {
  const errors = [];
  if (schema.type && !(Array.isArray(schema.type) ? schema.type : [schema.type]).some((t) => typed(value, t))) return [issue("TYPE", `expected ${[].concat(schema.type).join(" or ")}`, path)];
  if (schema.enum && !schema.enum.some((x) => stableJSON(x) === stableJSON(value))) errors.push(issue("ENUM", `expected one of ${JSON.stringify(schema.enum)}`, path));
  if (schema.const !== undefined && stableJSON(schema.const) !== stableJSON(value)) errors.push(issue("CONST", `expected ${JSON.stringify(schema.const)}`, path));
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(issue("MIN_LENGTH", `minimum length ${schema.minLength}`, path));
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(issue("MAX_LENGTH", `maximum length ${schema.maxLength}`, path));
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(issue("PATTERN", `must match ${schema.pattern}`, path));
  }
  if (typeof value === "number") {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(issue("MINIMUM", `minimum ${schema.minimum}`, path));
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(issue("MAXIMUM", `maximum ${schema.maximum}`, path));
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(issue("EXCLUSIVE_MINIMUM", `must exceed ${schema.exclusiveMinimum}`, path));
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(issue("MIN_ITEMS", `minimum ${schema.minItems} items`, path));
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(issue("MAX_ITEMS", `maximum ${schema.maxItems} items`, path));
    if (schema.uniqueItems && new Set(value.map(stableJSON)).size !== value.length) errors.push(issue("DUPLICATE", "items must be unique", path));
    if (schema.items) value.forEach((v, i) => errors.push(...validate(v, schema.items, `${path}[${i}]`)));
  }
  if (isObject(value)) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(issue("REQUIRED", `missing ${key}`, path));
    for (const [key, child] of Object.entries(value)) {
      if (Object.hasOwn(schema.properties ?? {}, key)) errors.push(...validate(child, schema.properties[key], `${path}.${key}`));
      else if (schema.additionalProperties === false) errors.push(issue("UNKNOWN_FIELD", `unknown field ${key}`, path));
      else if (isObject(schema.additionalProperties)) errors.push(...validate(child, schema.additionalProperties, `${path}.${key}`));
    }
  }
  return errors;
}
export function assertValid(value, schema, label) {
  jsonSafe(value);
  const errors = validate(value, schema);
  if (errors.length) throw new DirectorError("INVALID_INPUT", `${label}: ${errors.map((e) => `${e.path} ${e.message}`).join("; ")}`, errors);
  return value;
}
/** A stable Kahn sort. Reject missing edges and cycles rather than omitting stages. */
export function orderDAG(nodes, key = "id", after = "after") {
  const byId = new Map();
  for (const node of nodes) {
    if (byId.has(node[key])) throw new DirectorError("DUPLICATE_ID", `duplicate ${node[key]}`);
    byId.set(node[key], node);
  }
  for (const n of nodes) for (const dependency of n[after] ?? []) if (!byId.has(dependency)) throw new DirectorError("MISSING_DEPENDENCY", `${n[key]} depends on missing ${dependency}`);
  const pending = new Set(byId.keys()), done = new Set(), result = [];
  while (pending.size) {
    const id = [...pending].find((name) => (byId.get(name)[after] ?? []).every((d) => done.has(d)));
    if (id === undefined) throw new DirectorError("DEPENDENCY_CYCLE", `cycle among ${[...pending].join(", ")}`);
    pending.delete(id); done.add(id); result.push(byId.get(id));
  }
  return result;
}
/** Complete diagnostics for a prospective native invocation; no execution. */
export function checkNativeCall(tool, args, tools) {
  const entry = tools.find((t) => t.name === tool);
  if (!entry) return { exists: false, missing: [], errors: [issue("UNKNOWN_TOOL", `No native tool ${tool}`)], native: null };
  const schema = entry.inputSchema ?? { properties: {}, required: [] };
  const missing = (schema.required ?? []).filter((k) => !Object.hasOwn(args, k));
  const errors = [];
  for (const [k, v] of Object.entries(args)) {
    if (!Object.hasOwn(schema.properties ?? {}, k) && !["propose", "reason", "for_note", "if_revision"].includes(k)) errors.push(issue("UNKNOWN_ARGUMENT", `${tool} does not take ${k}`, k));
    else if (schema.properties?.[k]) errors.push(...validate(v, schema.properties[k], k));
  }
  return { exists: true, missing, errors, native: { read_only: entry.annotations?.readOnlyHint === true, consequential: entry.consequential === true, decides: entry.decides === true, own_proposals: entry.direct === true } };
}
