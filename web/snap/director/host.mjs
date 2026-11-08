// SNAP-R19 native contracts · SNAP-R60 existing storage · SNAP-R93 scoped instructions · SNAP-R272 native planning.
// The production host is dependency-injected so CPU tests exercise these exact adapter paths.
import { createSnapshotReader } from "./snapshot.mjs";
import { clone, DirectorError, stableJSON } from "./validation.mjs";

export function createNativeHost({ api, W, I, S, P, T, ACC, fetch, origin, catalogueURL, getTools }) {
let catalogue = null;
async function packEntries() {
  // Same-origin extension data only. No remote models, third-party URLs or installation behavior.
  catalogue ??= (async () => {
    const url = new URL(catalogueURL);
    if (url.origin !== origin) throw new DirectorError("CATALOGUE_ORIGIN", "Strategy catalogue must be served by this SNAP installation");
    const response = await fetch(url, { credentials: "same-origin", cache: "no-cache" });
    if (!response.ok) throw new DirectorError("CATALOGUE_UNREADABLE", `Strategy catalogue returned ${response.status}`);
    const data = await response.json();
    if (data.schema !== "snap.strategy-catalogue/v1" || !Array.isArray(data.strategies)) throw new DirectorError("CATALOGUE_SCHEMA", "Unrecognized strategy catalogue");
    return data.strategies.map((definition) => ({ definition, ref: `pack:${definition.id}@${definition.version}`, origin: "pack" }));
  })().catch((error) => { catalogue = null; throw error; });
  return catalogue;
}
async function readScene(id) {
  const response = await api.getUserData(`snap/scenes/${id}.json`);
  if (response.status === 404) return null;
  if (!response.ok) throw new DirectorError("SCENE_UNREADABLE", `Scene ${id} returned ${response.status}`);
  return response.json();
}
async function readTake(ref) {
  await ACC.load(); await T.reload(); await T.privacyOn();
  let take = T.find(ref);
  if (take?.kept_encrypted) { await T.reopen(); take = T.find(ref); }
  if (!take || T.aboveCap(take) || take.locked) throw new DirectorError("SOURCE_TAKE_UNAVAILABLE", "The source is missing, locked or outside this account's access; no media details are exposed");
  return { id: take.id, status: take.status, private: T.locked(take), world: clone(take.world ?? {}), hash: take.hash ?? null, seed_hash: take.seed_hash ?? null,
    story: take.story ? clone(take.story) : null,
    media: (take.media ?? []).map((m) => ({ kind: m.kind, filename: m.filename, subfolder: m.subfolder ?? "", type: m.type ?? "output" })) };
}
const snapshot = createSnapshotReader({ world: W, readScene, readTake,
  pending: async () => { await P.load(); return P.all(); } });

/** Do not dereference getTools here: tools.js is still initializing its one table. */
function host() {
  return {
    tools: getTools,
    registryEntries: async () => {
      await I.ready();
      const entries = [...await packEntries()];
      for (const record of W.all("card")) {
        // Include every immutable version, so exact references continue to resolve. No latest-version guessing.
        for (const version of record.versions ?? []) if (version.body?.kind === "production_strategy") entries.push({
          definition: version.body.strategy, ref: `card:${record.id}@${version.n}`, origin: "person",
        });
      }
      return entries;
    },
    snapshot,
    instructions: async (data, override = {}) => {
      const scene = override.scene ?? data.target.scene ?? data.source_take?.story?.unit?.scene ?? null, shot = override.shot ?? data.target.shot ?? data.source_take?.story?.unit?.shot ?? null;
      const unit = data.units.find((u) => u.scene === scene && u.shot === shot);
      const pins = unit ? [...(unit.cast ?? []), ...(unit.location ? [unit.location] : [])] : [...(data.book?.cast_refs ?? []), ...(data.book?.location_refs ?? [])];
      const context = { tool: override.tool ?? "plan_strategy", bricks: [], methods: override.method ? [override.method] : [], pins: [...new Set([...pins, ...Object.keys(data.source_take?.world ?? {})].map((r) => r.split("@")[0]))],
        scene, shot, take: data.target.source_take, book: (data.target.book ?? data.source_take?.story?.book)?.replace(/^book:/, "").split("@")[0] ?? null };
      return I.answer(context, getTools().map((t) => t.name));
    },
    methodFor: (tool, parameters, unit) => {
      if (tool === "edit_take") return parameters.edit_mode === "recast" ? "remake_swap" : parameters.edit_method;
      if (tool === "upscale_take") return parameters.upscale_method === "inherit" ? null : parameters.upscale_method;
      if (parameters.view_method !== "inherit") return parameters.view_method;
      // SNAP-R272: mirror the native board purpose selector, without reading an unrelated open recipe.
      return S.slot("view").purposes?.[unit.cast?.length ? "character" : "set"]?.method ?? S.list("view")[0]?.id ?? null;
    },
    methods: async () => { await S.load(); if (S.registryProblem()) throw new DirectorError("METHOD_REGISTRY_UNREADABLE", S.registryProblem()); return S.slots().flatMap((slot) => S.list(slot).map((method) => ({ ...method, slot }))); },
    propose: (tool, args, reason) => P.add(tool, args, reason, undefined, null),
    saveCard: async (id, body) => {
      // Normal dispatcher has refreshed world state. Content-addressed IDs make parallel identical creates converge.
      const existing = W.record("card", id);
      if (existing?.archived) throw new DirectorError("VARIANT_ARCHIVED", "An identical variant is archived. Restore it explicitly instead of silently reviving it.");
      if (existing && existing.versions.some((v) => stableJSON(v.body) !== stableJSON(body))) throw new DirectorError("VARIANT_ID_CONFLICT", "This content-addressed id contains different data; preserve it and investigate");
      return W.save("card", id, body, { note: "Saved production strategy variant; no project or permissions changed", by: I.by(), accepted_by: P.pressedBy().by, if_absent: true });
    },
  };
}

return host();
}
