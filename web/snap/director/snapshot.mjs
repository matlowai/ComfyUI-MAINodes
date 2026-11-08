// SNAP-R24 scene authority · SNAP-R60 exact records · SNAP-R67 accepted story only. · SNAP-R272 native planning.
// Read-only adapter projection. It deliberately does not call get_book, productionFor, compile_unit or frame extraction.
import { clone, DirectorError, issue, jsonSafe, sha256 } from "./validation.mjs";
const bare = (r) => typeof r === "string" ? r.split("@")[0] : r;
const safeId = (value, label) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) throw new DirectorError("INVALID_RECORD_ID", `${label} must be a native record id, not a path`);
  return value;
};
export function createSnapshotReader({ world, readScene, readTake, pending }) {
  const worldRead = (ref, kind) => {
    const parsed = world.parse(ref);
    if (parsed.kind !== kind) throw new DirectorError("WRONG_RECORD_KIND", `${ref} must name a ${kind}`);
    safeId(parsed.id, kind);
    const got = world.get(ref);
    return got ? { ref: `${kind}:${parsed.id}@${got.version.n}`, requested_ref: ref, head: got.record.head, archived: !!got.record.archived, hash: got.version.hash ?? null, body: clone(got.version.body) } : null;
  };
  return async function snapshot(request) {
    if (request.shot && !request.scene) throw new DirectorError("SCENE_REQUIRED", "A shot target needs its scene; never guess by name");
    let selectedScene = null, selectedTake = null;
    if (request.scene) {
      safeId(request.scene, "scene"); selectedScene = await readScene(request.scene);
      if (!selectedScene) throw new DirectorError("SCENE_MISSING", `No scene ${request.scene}`);
      if (selectedScene.id !== request.scene) throw new DirectorError("SCENE_ID_MISMATCH", "Scene contents do not match the requested identity");
    }
    if (request.source_take) {
      selectedTake = await readTake(request.source_take); // access/rating checks belong to this native reader
      if (!selectedTake) throw new DirectorError("SOURCE_TAKE_UNAVAILABLE", "The requested source take is unavailable");
      if (selectedTake.status !== "success" || !selectedTake.media?.some((m) => m.kind === "video")) throw new DirectorError("VIDEO_SOURCE_REQUIRED", "Transform Footage needs a successful native video take, not a still or failed run");
    }
    const inferredBook = selectedScene?.book;
    const bookTarget = request.book ?? inferredBook;
    const errors = [], warnings = [], provenance = { world: [], scenes: [], source_take: null };
    let book = null, rawBook = null;
    if (bookTarget) {
      const ref = bookTarget.includes(":") ? bookTarget : `book:${bookTarget}`;
      rawBook = worldRead(ref, "book");
      if (!rawBook) throw new DirectorError("BOOK_MISSING", `No Book ${ref}`);
      if (rawBook.archived) throw new DirectorError("BOOK_ARCHIVED", "Recover this Book through the native route before planning changes");
      if (world.parse(rawBook.ref).n !== rawBook.head) throw new DirectorError("HISTORICAL_BOOK_TARGET", "A historical Book cannot be combined with current scene files for an executable proposal; target the current version");
      if (inferredBook && bare(inferredBook) !== bare(rawBook.ref)) throw new DirectorError("TARGET_CONTEXT_MISMATCH", "The selected scene belongs to a different Book");
      if (selectedScene && !(rawBook.body.scenes ?? []).includes(selectedScene.id)) throw new DirectorError("TARGET_CONTEXT_MISMATCH", "The Book does not list the selected scene");
      if (selectedTake?.story?.book && bare(selectedTake.story.book) !== bare(rawBook.ref)) throw new DirectorError("SOURCE_CONTEXT_MISMATCH", "The source take belongs to a different Book; choose the source context explicitly rather than mixing instruction scopes");
      // Match B.storyOf: the Book points to a story identity; its current head is authoritative.
      // Style differs: B.styleOf deliberately honors a pinned look version.
      const story = rawBook.body.story ? worldRead(bare(rawBook.body.story), "story") : null;
      const style = rawBook.body.style ? worldRead(rawBook.body.style, "look") : null;
      if (rawBook.body.story && !story) errors.push(issue("STORY_MISSING", `Missing ${rawBook.body.story}`, "book.story"));
      if (rawBook.body.style && !style) errors.push(issue("STYLE_MISSING", `Missing ${rawBook.body.style}`, "book.style"));
      book = { ref: rawBook.ref, name: rawBook.body.name, cast_refs: rawBook.body.cast ?? [], location_refs: rawBook.body.locations ?? [],
        story: story ? { ref: story.ref, ...story.body } : null, style_ref: style?.ref ?? null,
        pending_proposals: (await pending()).filter((p) => p.status === "waiting" && bare(p.book) === bare(rawBook.ref)).map((p) => p.id) };
      provenance.world.push(...[rawBook, story, style].filter(Boolean).map((r) => ({ ref: r.ref, hash: r.hash })));
    } else if (selectedScene) errors.push(issue("SCENE_HAS_NO_BOOK", "This scene is not a Book production; do not silently adopt or rewrite it", "scene"));
    const sceneIds = selectedScene ? [selectedScene.id] : rawBook?.body.scenes ?? [];
    const scenes = [];
    for (const id of sceneIds) {
      safeId(id, "scene");
      const scene = selectedScene?.id === id ? selectedScene : await readScene(id);
      if (!scene) { errors.push(issue("SCENE_MISSING", `Book lists missing scene ${id}`, id)); continue; }
      if (scene.id !== id || (rawBook && bare(scene.book) !== bare(rawBook.ref))) throw new DirectorError("SCENE_OWNERSHIP_MISMATCH", `Scene ${id} does not belong to this Book`);
      jsonSafe(scene); scenes.push(scene);
      provenance.scenes.push({ id, head: scene.head ?? null, sha256: await sha256(scene) });
    }
    const units = [];
    for (const scene of scenes) {
      if (request.shot && !scene.shots.some((s) => s.id === request.shot)) throw new DirectorError("SHOT_MISSING", `${request.shot} is not in ${scene.id}`);
      for (const shot of scene.shots.filter((s) => (!request.shot || s.id === request.shot) && s.unit)) {
        safeId(shot.id, "shot");
        if (!shot.unit.cut) throw new DirectorError("CUT_ID_MISSING", `Book shot ${scene.id}/${shot.id} has no stable cut id`);
        units.push({ ...clone(shot.unit), scene: scene.id, shot: shot.id, scene_name: scene.name, active: shot.active ?? null });
      }
    }
    const told = new Map((book?.story?.beats ?? []).map((b) => [b.id, b.told ?? b.order]));
    const order = (u) => Math.min(...(u.beats ?? []).map((id) => told.get(id) ?? Infinity), Infinity);
    units.sort((a, b) => order(a) - order(b)); // stable native scene/shot order breaks equal storytelling positions
    const castRefs = [...new Set([...(rawBook?.body.cast ?? []), ...units.flatMap((u) => u.cast ?? [])])];
    const locationRefs = [...new Set([...(rawBook?.body.locations ?? []), ...units.map((u) => u.location).filter(Boolean)])];
    const readRecords = (refs, kind) => refs.map((ref) => {
      const r = worldRead(ref, kind);
      if (!r) return { ref, missing: true };
      provenance.world.push({ ref: r.ref, hash: r.hash });
      if (r.archived) warnings.push(issue("ARCHIVED_REFERENCE", `${r.ref} is archived but retained for provenance; do not replace it silently`, ref));
      return { ...r.body, ref: r.ref, missing: false };
    });
    const cast = readRecords(castRefs, "cast"), locations = readRecords(locationRefs, "location");
    if (selectedTake) provenance.source_take = { id: selectedTake.id, hash: selectedTake.hash ?? null, seed_hash: selectedTake.seed_hash ?? null };
    const target = { book: rawBook ? bare(rawBook.ref) : null, scene: request.scene ?? null, shot: request.shot ?? null, source_take: selectedTake?.id ?? null };
    const result = { target, book, units, cast, locations, source_take: selectedTake ? clone(selectedTake) : null, provenance, errors, warnings };
    jsonSafe(result); return result;
  };
}
