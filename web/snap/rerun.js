// Re-run with swaps (U89, Dylan 22:45: "think Disney re-running the same animations with different movies and characters
// but same motions"). Every record a take pinned is a slot that stays pinned, or goes to the newest version, a chosen
// version, or another record of its kind. Two slots are not records and say so: the scene (a different scene brings its
// set into the recipe; where the new take lands is chosen apart) and the Setup (the take's setup pin, else read from its
// prompt). Re-generate opens the take's whole graph where it belongs, or in the shot it should land in, sends each swap
// through the record's own apply (library.swapPin, updatePin, applySet, useSetup), keeps the take's seed unless asked for
// a new one, and queues it marked extra.snap.rerun, so the new take nests under the original as "Re-run · Kon → Mara".
// A swap that changes nothing the prompt holds is said before the run: core would serve the take's own file.
// SNAP-R63 re-run with swaps · SNAP-R61 as it was / today's world · SNAP-R60 pins · SNAP-R24 where it lands · SNAP-R11
// warn, never block · SNAP-R58 every choice listed in full · see docs/SNAP_RULES.md
import * as E from "./engine.js";
import * as L from "./library.js";
import * as M from "./models.js";
import * as RT from "./retake.js";
import * as SC from "./scenes.js";
import * as T from "./takes.js";
import * as W from "./world.js";

export const ROUTES = ["regenerate"], SEEDS = RT.SEEDS;
// what a Cast version puts into a run: its lore, alias, rating and name don't reach the prompt
const INTO_RUN = ["trigger", "details", "lora", "refs"];
const recordName = (r) => (r.kind === "cast" ? W.headOf(r).body.name : L.nameOf(W.headOf(r).body));

// the take's Setup: its setup pin, else the Render Preset its workflow ran (the node's preset), else "custom"
export function setupOf(take) {
  const ref = Object.keys(take.world ?? {}).find((r) => take.world[r].setup);
  if (ref) return { name: take.world[ref].name, ref, from: "its setup pin" };
  const node = take.graph?.nodes?.find((n) => n.type === "MAIRenderPreset");
  if (!node) return null;
  return { name: node.properties?.renderPreset || "custom", from: "its settings" };
}
const setupsFor = (take) => { const fam = take.graph?.extra?.snap?.family ?? M.family(); return M.setups().filter((s) => s.family === fam); };

// the take's slots: one per pinned record (a setup pin is the Setup slot), then the scene, then the Setup
export async function slots(take) {
  await Promise.all([W.load(), L.ready(), SC.load(), M.load()]);
  const out = [];
  for (const [ref, p] of Object.entries(take.world ?? {})) {
    if (p.setup) continue;
    const { kind, id } = W.parse(ref), r = W.record(kind, id), body = r && W.get(W.refOf(kind, id, p.n))?.version.body;
    const others = W.all(kind).filter((x) => x.id !== id && (kind !== "card" || W.headOf(x).body.kind === body?.kind));
    out.push({ slot: ref, kind, name: kind === "cast" && r ? recordName(r) : p.name ?? id, n: p.n, head: p.n === 0 ? 0 : r?.head ?? null, ...(p.n && !r ? { missing: true } : {}),
      versions: r ? r.versions.map(({ n, at, note }) => ({ n, at: new Date(at).toISOString(), note })) : [], others: others.map((x) => ({ ref: W.refOf(kind, x.id), name: recordName(x), head: x.head })) });
  }
  const home = RT.shotOf(take);
  out.push({ slot: "scene", kind: "scene", name: home?.scene.name ?? null, n: null, not_a_record: "a different scene brings its set into the recipe; where the new take lands is chosen apart (land)",
    others: SC.all().filter((s) => s.id !== home?.scene.id).map((s) => ({ ref: `scene:${s.id}`, name: s.name, set: s.set ? L.get(s.set)?.title ?? s.set : null })) });
  const setup = setupOf(take);
  if (setup) out.push({ slot: "setup", kind: "setup", name: setup.name, n: null, not_a_record: `read from ${setup.from}; Re-generate only`, others: setupsFor(take).filter((s) => s.name !== setup.name).map((s) => ({ ref: s.name, name: s.name })) });
  return out;
}

// every choice a slot takes, written out in full for an error (SNAP-R58)
const choices = (s) => (s.kind === "scene" ? `pinned (the scene it is in), or another scene: ${s.others.map((o) => `${o.ref} (${o.name})`).join(", ") || "there are no others"}`
  : s.kind === "setup" ? `pinned (${s.name}), or another setup of this family: ${s.others.map((o) => JSON.stringify(o.ref)).join(", ") || "there are no others"}`
  : `pinned, latest${s.versions.length ? `, ${s.versions.map((v) => `@${v.n}`).join(", ")} (its versions)` : ""}, or another ${s.kind}: ${s.others.map((o) => `${o.ref} (${o.name})`).join(", ") || "there are no others"}`);

// one asked swap as {slot, to, ref, text, fields, warning, into_run}; keep: true when it leaves the slot as it was
function one(take, s, to) {
  const no = () => { throw new Error(`Take ${take.number}: swaps["${s.slot}"].to ${JSON.stringify(to)} isn't one of ${choices(s)}`); };
  if (to === "pinned" || to == null) return { slot: s.slot, to: "pinned", keep: true, text: `${s.name}${s.n ? ` v${s.n}` : ""} as it was`, into_run: false };
  if (s.kind === "scene") {
    const scene = typeof to === "string" && to.startsWith("scene:") ? SC.get(to.slice(6)) : null;
    if (!scene) no();
    const set = scene.set ? L.get(scene.set) : null;
    return set ? { slot: s.slot, to, scene: scene.id, set: set.id, text: `the set from ${scene.name}`, into_run: true }
      : { slot: s.slot, to, scene: scene.id, keep: true, text: `${scene.name} has no set: nothing in the recipe changes (where the take lands is land)`, into_run: false };
  }
  if (s.kind === "setup") return s.others.some((o) => o.ref === to) ? { slot: s.slot, to, text: `Setup ${s.name} → ${to}`, into_run: true } : no();
  const { kind, id } = W.parse(s.slot);
  let ref;
  if (to === "latest") ref = W.refOf(kind, id);
  else if (/^@\d+$/.test(to)) ref = s.versions.some((v) => v.n === +to.slice(1)) ? W.refOf(kind, id, +to.slice(1)) : no();
  else if (typeof to === "string" && to.startsWith(`${kind}:`)) { const x = W.parse(to); ref = W.get(to) && (x.id === id || s.others.some((o) => o.ref === W.refOf(kind, x.id))) ? to : no(); }
  else no();
  const now = W.get(ref), x = W.parse(ref), same = x.id === id, was = W.get(W.refOf(kind, id, s.n))?.version.body;
  if (same && now.version.n === s.n) return { slot: s.slot, to, keep: true, text: `${s.name} v${s.n} is already ${to === "latest" ? "the newest" : "that version"}`, into_run: false };
  const body = now.version.body, name = kind === "cast" ? body.name : L.nameOf(body), fields = W.diff(was, body);
  const warning = kind !== "cast" ? null : same ? L.lookWarning(was, body) : was?.refs?.length && !body.refs?.length ? `${name} has no pictures: the render draws them from words only` : null;
  return { slot: s.slot, to, ref: same ? ref : W.refOf(kind, x.id, now.version.n), text: same ? `${s.name} v${s.n} → v${now.version.n}` : `${s.name} → ${name}`, fields, ...(warning ? { warning } : {}),
    into_run: kind === "cast" ? (!same || fields.some((f) => INTO_RUN.includes(f.split(/[ .]/)[0]))) : fields.length > 0, latest: to === "latest" };
}

// each asked swap, checked against the take's slots: refused naming the slots there are and every choice of the slot
export async function resolve(take, swaps = {}) {
  if (swaps == null || typeof swaps !== "object" || Array.isArray(swaps)) throw new Error(`swaps: an object of slot → {to}, e.g. {"cast:cast-k7f2x9": {"to": "cast:cast-m2a9"}}`);
  const list = await slots(take);
  return Object.entries(swaps).map(([slot, ask]) => {
    const s = list.find((x) => x.slot === slot);
    if (!s) throw new Error(`Take ${take.number} has no slot "${slot}"; its slots are ${list.map((x) => x.slot).join(", ")}`);
    return one(take, s, typeof ask === "string" || ask == null ? ask : ask.to);
  });
}

// where the new take lands: where the take belongs (undefined), a scratch tab ("tab"), or another scene's shot
function landing(land) {
  if (land == null) return undefined;
  if (land === "tab") return null;
  const scene = SC.get(land.scene), shot = scene?.shots.find((x) => x.id === land.shot);
  if (!shot) throw new Error(`land: "tab", or {scene, shot} of ${SC.all().map((s) => `${s.id} (${s.name}: ${s.shots.map((x) => x.id).join(", ")})`).join("; ") || "no scenes yet"}`);
  return { scene, shot };
}

// one swap into the open chain: the record's own apply puts it in, the old record's pieces out (library.swapPin)
async function put(s) {
  if (s.slot === "setup") { const said = await M.useSetup(M.setups().find((x) => x.name === s.to), { keep: false }); return [said, L.picturesUnread()].filter(Boolean).join("; "); }
  if (s.slot === "scene") {
    const card = L.get(s.set), o = L.originOf(card.id), ref = o ? W.refOf(o.kind, o.id) : `set_snapshot:${card.lineage ?? card.id}`;
    const held = Object.keys(E.state().world ?? {}).find((r) => r.startsWith("set_snapshot:"));
    return held ? L.swapPin(held, ref) : L.applySet(card);
  }
  return s.latest ? L.updatePin(s.slot) : L.swapPin(s.slot, s.ref);
}

// Re-generate: the take's recipe again with the swaps, the same seed unless `seed` is new; queue: false only opens it
export async function rerun(take, { swaps = {}, route = "regenerate", seed = "same", land, queue: go = true } = {}) {
  if (!ROUTES.includes(route)) throw new Error(`route is one of ${ROUTES.join(", ")}`);
  if (!SEEDS.includes(seed)) throw new Error(`seed is one of ${SEEDS.join(", ")}`);
  if (!take.graph) throw new Error(`Take ${take.number} has no workflow saved with it`);
  const asked = await resolve(take, swaps), home = landing(land), where = await RT.openTake(take, home), done = [];
  for (const s of asked.filter((x) => !x.keep)) done.push(await put(s));
  const seedKey = E.state().bricks.find((b) => E.seedMode(b.key))?.key, newSeed = seed === "new" && seedKey ? E.newSeed(seedKey) : null;
  const cached = seed === "same" && (await T.hashes(await T.live())).hash === take.hash;
  const marks = Object.fromEntries(asked.map((s) => [s.slot, { to: s.ref ?? s.to, text: s.text, ...(s.keep ? { kept: true } : {}) }]));
  const run = go ? await RT.queue("rerun", { take: take.id, route, swaps: marks, seed, ...(land != null ? { land } : {}) }) : null;
  const what = asked.filter((s) => !s.keep).map((s) => s.text);
  return { take: take.id, route, seed, opened: where, swapped: done, ...(newSeed != null ? { new_seed: newSeed } : {}), run,
    ...(cached ? { cache_hit: `nothing the prompt holds changed: ComfyUI serves take ${take.number}'s own file from its cache. Re-run with seed new for a fresh render` } : {}),
    said: `Take ${take.number} ${go ? "re-run" : "opened"} ${what.length ? `with ${what.join(", ")}` : "as it was"} in ${where}${done.length ? ` · ${done.join(" · ")}` : ""}${go ? "" : " · nothing is queued"}` };
}
