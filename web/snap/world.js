// World state (U87, DESIGN_U86_U87_CAST_VERSIONS §4.3): the records a take depends on (Cast, set snapshots, locations
// (SNAP-R84), the person's own Library cards) each live in one file, snap/<kind>/<id>.json in ComfyUI's per-user data, with every
// version inside: {n, hash, at, by, note, body}. Saving is versioning: a body equal to the head makes no new version,
// any other body is appended as n + 1 and becomes the head; no version is ever edited. A set keeps its editor's working
// copy as `draft` and its camera plates as `plates`, outside the versions (a plate belongs to a camera, not a state).
// A reference is kind:id@n (a pinned version) or kind:id (the head). Archiving moves the file to snap/_archived/; it
// still resolves, so a take that pins it can still be re-made as it was. Model and LoRA files are pinned by name only.
// The server (snap_world.py) does every write and hashes the bodies; `sha` here only hashes pack cards (version 0).
// migrate() wraps the cards of snap/cards/ (from before records) once, and parks the originals in snap/_migrated/cards/.
// Another writer (a page, an agent, a script) is heard two ways (F-D01): the server tells every open page of each write
// it makes (`snap_world`: the page reads again and says who wrote), and before a tool reads anything the page asks the
// server's fingerprint of the record files (`stale`), which catches a script or a hand edit too.
// SNAP-R60 world versions and pins · SNAP-R17 by · SNAP-R18 local only · SNAP-R93/R94 instruction and skill records ·
// SNAP-R116 a page never works from records another writer changed · see docs/snap/SNAP_RULES.md
import { api } from "../../../scripts/api.js";

export const KINDS = ["cast", "card", "set_snapshot", "location", "instruction", "skill", "book", "story", "look", "production"]; // SNAP-R67: the Book, its story, its production style; SNAP-R223: the production above Books // scenes version their authored fields in their own documents (scenes.js)
const fileOf = (kind, id) => `snap/${kind}/${id}.json`, archivedOf = (kind, id) => `snap/_archived/${kind}/${id}.json`;
const key = (kind, id) => `${kind}:${id}`;
let records = new Map(), loading = null, rev = null;
const listeners = new Set(), written = new Set();
export const onChange = (fn) => listeners.add(fn);
const changed = () => { for (const fn of listeners) fn(); };
// another writer's write, once the records are read again: {ref, by, count} (count: writes heard in that read)
export const onWritten = (fn) => written.add(fn);
const revNow = () => api.fetchApi("/mainodes/snap/world/rev").then((r) => r.json()).then((r) => r.rev);

// a body hashes the same however it was built: keys sorted at every depth
const canonical = (x) => JSON.stringify(x, (k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((x) => [x, v[x]])) : v));
export const sha = async (x) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(x))))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const short = (hash) => hash?.slice(0, 12) ?? null;
// today's pack cards (version 0 of their references): ref -> {hash, name, id}, set by the Library when it loads the
// pack; null until then, so nothing reads as moved or missing before it is known
let packCards = null;
export const setPack = (map) => { packCards = map; changed(); };
export const packCard = (ref) => packCards?.get(ref) ?? null;
export const packKnown = () => packCards != null;

export function parse(ref) {
  const m = /^([a-z_]+):([^@\s]+?)(?:@(\d+))?$/.exec(ref ?? "");
  if (!m) throw new Error(`"${ref}" isn't a world reference: kind:id for the newest version, kind:id@n for one version (e.g. cast:cast-k7f2x9@2)`);
  return { kind: m[1], id: m[2], n: m[3] == null ? null : +m[3] };
}
export const refOf = (kind, id, n) => `${kind}:${id}${n == null ? "" : `@${n}`}`;

async function read(path) {
  const r = await api.getUserData(path);
  if (r.status === 404) return null;
  if (r.status !== 200) throw new Error(`${path} unreadable (${r.status})`);
  return r.json();
}
async function readDir(dir) {
  const files = (await api.listUserDataFullInfo(dir)).filter((f) => f.path.endsWith(".json") && !f.path.includes("/"));
  return (await Promise.all(files.map((f) => read(`${dir}/${f.path}`)))).filter((r) => r?.versions);
}

export function load() {
  loading ??= (async () => {
    await migrate();
    rev = await revNow();
    const found = (await Promise.all(KINDS.flatMap((kind) => [readDir(`snap/${kind}`), readDir(`snap/_archived/${kind}`)]))).flat();
    records = new Map(found.map((r) => [key(r.kind, r.id), r]));
    changed();
    return records;
  })().catch((e) => { loading = null; throw e; });
  return loading;
}
export const all = (kind, { archived = false } = {}) => [...records.values()].filter((r) => (!kind || r.kind === kind) && (archived || !r.archived));
export const record = (kind, id) => records.get(key(kind, id)) ?? null;
export const headOf = (r) => r?.versions.find((v) => v.n === r.head) ?? null;
// a reference as {record, version}: the version it pins, or the head; null when the record or that version isn't here
export function get(ref) {
  const { kind, id, n } = typeof ref === "string" ? parse(ref) : ref, r = record(kind, id);
  if (!r) return null;
  const version = n == null ? headOf(r) : r.versions.find((v) => v.n === n) ?? null;
  return version ? { record: r, version } : null;
}

// what changed between two bodies, field by field, with both values whole (SNAP-R58): "lora.strength 0.8 → 0.6"
const named = (l) => Array.isArray(l) && l.length > 0 && l.every((v) => v && typeof v === "object" && typeof v.name === "string") && new Set(l.map((v) => v.name)).size === l.length;
export function diff(a, b, at = "") {
  const out = [], skip = at ? [] : ["id", "saved"]; // a card's id and save stamp are bookkeeping
  for (const k of new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})].filter((k) => !skip.includes(k)))) {
    const x = a?.[k], y = b?.[k], name = `${at}${k}`;
    if (canonical(x) === canonical(y)) continue;
    if (x && y && typeof x === "object" && typeof y === "object" && !Array.isArray(x) && !Array.isArray(y)) out.push(...diff(x, y, `${name}.`));
    else if (named(x) && named(y)) { // F-Q18: a list of named things (plates, camera marks) diffs by name and field
      const was = new Map(x.map((v) => [v.name, v])), now = new Map(y.map((v) => [v.name, v]));
      for (const n of new Set([...was.keys(), ...now.keys()])) {
        const v = was.get(n), w = now.get(n);
        if (!v) out.push(`${name}[${n}] added ${JSON.stringify(w)}`);
        else if (!w) out.push(`${name}[${n}] taken out (was ${JSON.stringify(v)})`);
        else if (canonical(v) !== canonical(w)) out.push(...diff(v, w, `${name}[${n}].`));
      }
      const order = (l) => l.map((v) => v.name).join("\u0000");
      if (order(x.filter((v) => now.has(v.name))) !== order(y.filter((v) => was.has(v.name)))) out.push(`${name} order ${JSON.stringify(x.map((v) => v.name))} → ${JSON.stringify(y.map((v) => v.name))}`);
    } else out.push(`${name} ${JSON.stringify(x) ?? "none"} → ${JSON.stringify(y) ?? "none"}`);
  }
  return out;
}
// the reference pictures that changed between two bodies, one per role ({role, was, now}; null for a picture added or
// taken out), so a person reads "front picture changed" with the two pictures; diff() keeps the full refs for agents
export function pictures(a, b) {
  const by = (x) => new Map((x?.refs ?? []).map((r, i) => [r.role || `picture ${i + 1}`, r.file]));
  const was = by(a), now = by(b);
  return [...new Set([...was.keys(), ...now.keys()])].filter((k) => was.get(k) !== now.get(k)).map((role) => ({ role, was: was.get(role) ?? null, now: now.get(role) ?? null }));
}

// writes go through the server (snap_world.py), one at a time there, so two pages saving one record keep both versions
async function post(route, q) {
  const r = await api.fetchApi(`/mainodes/snap/world/${route}`, { method: "POST", body: JSON.stringify({ ...q, client: api.clientId }) }), out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error ?? `saving ${refOf(q.kind, q.id)} failed (${r.status})`);
  records.set(key(out.record.kind, out.record.id), out.record);
  changed();
  return out;
}
// save is versioning: returns {ref, n, made, record}; made is false when the body equals the head's (if_absent: any version's)
export function save(kind, id, body, { note = "", by = "person", listed, at, if_absent, accepted_by, proposal } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`No record kind ${kind}; the kinds are ${KINDS.join(", ")}`);
  return post("save", { kind, id, body, note, by, listed, at, if_absent, accepted_by, proposal });
}
// a record's fields outside its versions (a set's working copy and plates); null clears one
export const fields = (kind, id, set, by = "person") => post("fields", { kind, id, fields: set, by });
// archiving moves the file aside; it keeps resolving for "as it was", and restore moves it back
export const archive = (kind, id) => post("archive", { kind, id, archived: true });
export const restore = (kind, id) => post("archive", { kind, id, archived: false });

// ---- clean-up (SNAP-R62): sizes, an export zip, an import, a delete; always the person's act (an agent's delete waits)
async function call(route, q) {
  const r = await api.fetchApi(route, q ? { method: "POST", body: JSON.stringify(q) } : undefined), out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(out.error ?? `${route} failed (${r.status})`);
  return out;
}
export const reload = async () => { loading = null; await load(); }; // the Agent library re-reads on focus (SNAP-R95)
// did anything write the record files since this page read them? (a tool asks before it reads, tools.js callTool)
export const stale = async () => (await load(), (await revNow()) !== rev);
// a burst of writes (a script saving 300 notes) is one read in flight and at most one more after it, and one "updated by"
// naming the last write and how many there were
let rereading = null, heard = [];
api.addEventListener("snap_world", ({ detail }) => {
  if (detail?.client === api.clientId) return; // this page's own write: it holds the record already
  heard.push(detail);
  rereading ??= (async () => {
    while (heard.length) {
      const got = heard; heard = [];
      await reload();
      for (const fn of written) fn({ ...got.at(-1), count: got.length });
    }
  })().catch((e) => console.warn(`Snap couldn't read the records again: ${e.message}`)).finally(() => { rereading = null; });
});
export const sizes = () => call("/mainodes/snap/sizes");
export const exportRecords = (refs, { with_takes = false, decrypt_private = false } = {}) => call("/mainodes/snap/world/export", { refs, with_takes, decrypt_private });
export async function importExport(where) { const out = await call("/mainodes/snap/world/import", where); await reload(); return out; }
// n: one version; none: the whole record file. Pins on takes keep what the record put in, so they still run as they were
export async function remove(kind, id, n) { const out = await call("/mainodes/snap/world/delete", { kind, id, client: api.clientId, ...(n != null ? { n } : {}) }); if (!out.record) records.delete(key(kind, id)); else records.set(key(kind, id), out.record); changed(); return out; }

// ---- migration: cards saved before records (one-element arrays in snap/cards/) ----------------------------------
// Each card becomes v1 of a card record; a set's states become one set_snapshot record per lineage (the user's own root
// first, then its saved states in the order they were saved; the pack's root stays the pack card, version 0), its
// "-mine" working copy the record's draft and its plates the record's plates. The original files are moved to
// snap/_migrated/cards/ (never deleted). Safe to run again, from two tabs too: a version already there (same hash) isn't
// added twice, and a file another tab moved meanwhile is skipped
const plain = ({ plates, ...body }) => body;
export async function migrate() {
  const files = (await api.listUserDataFullInfo("snap/cards")).filter((f) => f.path.endsWith(".json") && !f.path.includes("/"));
  if (!files.length) return { files: 0 };
  const found = [];
  for (const f of files) {
    const x = await read(`snap/cards/${f.path}`).catch(() => null);
    if (x) found.push({ file: f.path, cards: Array.isArray(x) ? x : [x] });
  }
  const sets = new Map(), kept = new Set(); // kept: files left in snap/cards because a card in them couldn't be saved (said in the console)
  const keep = (file) => (e) => { kept.add(file); console.warn(`Snap: ${file} stays in snap/cards: ${e.message}`); };
  for (const { file, cards } of found) for (const c of cards) {
    if (c?.kind === "set_snapshot") { const l = c.lineage ?? c.id; sets.set(l, [...(sets.get(l) ?? []), [c, file]]); }
    else if (c?.id) await save("card", c.id, c.kind === "character" ? { ...c, kind: "cast" } : c, { note: "kept from before versions", by: c.by ?? "person", at: c.saved, if_absent: true }).catch(keep(file));
  }
  for (const [lineage, pairs] of sets) {
    const list = pairs.map(([c]) => c), files = pairs.map(([, f]) => f), failed = (e) => files.forEach((f) => keep(f)(e));
    const mine = list.find((c) => c.id === `${lineage}-mine`), states = list.filter((c) => c !== mine).sort((a, b) => (a.id === lineage ? -1 : b.id === lineage ? 1 : (a.saved ?? 0) - (b.saved ?? 0)));
    try {
      for (const c of states) await save("set_snapshot", lineage, plain(c), { note: "kept from before versions", by: c.by ?? "person", listed: true, at: c.saved, if_absent: true });
      const plates = mine?.plates ?? [...states].reverse().find((c) => c.plates)?.plates;
      if (mine || plates) await fields("set_snapshot", lineage, { ...(mine ? { draft: plain(mine) } : {}), ...(plates ? { plates } : {}) });
    } catch (e) { failed(e); }
  }
  let parked = 0;
  for (const { file } of found.filter((f) => !kept.has(f.file))) {
    let res = await api.moveUserData(`snap/cards/${file}`, `snap/_migrated/cards/${file}`, { overwrite: false });
    if (res.status === 409 || res.status === 400) res = await api.moveUserData(`snap/cards/${file}`, `snap/_migrated/cards/${Date.now().toString(36)}-${file}`, { overwrite: false });
    if (res.status === 200) parked++;
  }
  return { files: found.length, parked, kept: [...kept], sets: sets.size };
}
