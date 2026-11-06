// Re-run with swaps (U89, the operator, 22:45: "think Disney re-running the same animations with different movies and characters
// but same motions"). Every record a take pinned is a slot that stays pinned, or goes to the newest version, a chosen
// version, or another record of its kind. Two slots are not records and say so: the scene (a different scene brings its
// set into the recipe; where the new take lands is chosen apart) and the Setup (the take's setup pin, else read from its
// prompt). Re-generate opens the take's whole graph where it belongs, or in the shot it should land in, sends each swap
// through the record's own apply (library.swapPin, updatePin, applySet, useSetup), keeps the take's seed unless asked for
// a new one, and queues it marked extra.snap.rerun, so the new take nests under the original as "Re-run · Kon → Mara".
// A swap that changes nothing the prompt holds is said before the run: core would serve the take's own file.
// The plan says the rating the re-run would have before it runs (SNAP-R39: the take's, raised to each swapped-in record's
// rating or its LoRA's), and on a signed-in install whether that is above the account's cap (the server refuses it).
// Reuse the motion keeps the take itself as the motion source: a Cast swap is a recast (Viggle Remake, painted from the
// new Cast's details line and, when it has one, its picture), a set, a scene's set or a card's words are a "Change
// something" (Remake edit); a Setup or a shot card can't be done on the take's own motion, and it says so (Re-generate
// does those). One swap starts one candidates decision; the others wait for the person's pick and are listed.
// A slot may take a list ("this shot with each of these 3 characters"): every combination is one re-run. Re-generate
// makes them one candidates decision whose candidates are the queued takes (Apply makes one the shot's active take,
// Reject marks its take rejected by whoever pressed it); Reuse the motion makes one decision per combination.
// SNAP-R63 re-run with swaps · SNAP-R61 as it was / today's world · SNAP-R60 pins · SNAP-R24 where it lands · SNAP-R11
// warn, never block · SNAP-R58 every choice listed in full · see docs/snap/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import * as ACC from "./account.js";
import * as C from "./candidates.js";
import * as E from "./engine.js";
import * as ED from "./edits.js";
import * as L from "./library.js";
import * as M from "./models.js";
import * as RT from "./retake.js";
import * as SC from "./scenes.js";
import * as T from "./takes.js";
import * as W from "./world.js";
import { setBlock } from "./setsnap.js";

export const ROUTES = ["regenerate", "reuse_motion"], SEEDS = RT.SEEDS;
// what a Cast version puts into a run: its lore, alias, rating and name don't reach the prompt
const INTO_RUN = ["trigger", "details", "lora", "refs"];
const recordName = (r) => (r.kind === "cast" ? W.headOf(r).body.name : L.nameOf(W.headOf(r).body));

// a saved file opened in Snap as a subject: the open workflow, its pins and preset; it is no take, so a run of it has no parent
export const opened = (name) => ({ id: null, title: name, world: E.state().world ?? {}, graph: app.graph.serialize(), group: app.graph.id });
const named = (take) => take.title ?? `Take ${take.number}`;

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
  const no = () => { throw new Error(`${named(take)}: swaps["${s.slot}"].to ${JSON.stringify(to)} isn't one of ${choices(s)}`); };
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
  if (to === "latest" && s.n === 0) return { slot: s.slot, to, latest: true, text: `${s.name}: today's pack card`, into_run: true }; // a pack card moves with the pack
  let ref;
  if (to === "latest") ref = W.refOf(kind, id);
  else if (/^@\d+$/.test(to)) ref = s.versions.some((v) => v.n === +to.slice(1)) ? W.refOf(kind, id, +to.slice(1)) : no();
  else if (typeof to === "string" && to.startsWith(`${kind}:`)) { const x = W.parse(to); ref = W.get(to) && (x.id === id || s.others.some((o) => o.ref === W.refOf(kind, x.id))) ? to : no(); }
  else no();
  if (!W.get(ref)) no();
  const now = W.get(ref), x = W.parse(ref), same = x.id === id, was = W.get(W.refOf(kind, id, s.n))?.version.body;
  if (same && now.version.n === s.n) return { slot: s.slot, to, keep: true, text: `${s.name} v${s.n} is already ${to === "latest" ? "the newest" : "that version"}`, into_run: false };
  const body = now.version.body, name = kind === "cast" ? body.name : L.nameOf(body), fields = W.diff(was, body), pics = W.pictures(was, body);
  const warning = kind !== "cast" ? null : same ? L.lookWarning(was, body) : was?.refs?.length && !body.refs?.length ? `${name} has no pictures: the render draws them from words only` : null;
  return { slot: s.slot, to, ref: same ? ref : W.refOf(kind, x.id, now.version.n), text: same ? `${s.name} v${s.n} → v${now.version.n}` : `${s.name} → ${name}`, fields, ...(pics.length ? { pictures: pics } : {}), ...(warning ? { warning } : {}),
    into_run: kind === "cast" ? (!same || fields.some((f) => INTO_RUN.includes(f.split(/[ .]/)[0]))) : fields.length > 0, latest: to === "latest" };
}

// the rating a re-run would carry: the take's, raised by each swapped-in record's own rating or its LoRA's (SNAP-R39)
export function ratingFor(take, asked) {
  let rating = T.ratingOf(take) ?? "pg";
  const why = [`take ${take.number} is ${T.RATING_SHOWN[rating]}`];
  for (const s of asked.filter((x) => x.ref)) {
    const b = W.get(s.ref).version.body, r = b.rating ?? (b.lora?.file && M.entry(b.lora.file)?.rating);
    if (!r) continue;
    if (T.RATINGS.indexOf(r) > T.RATINGS.indexOf(rating)) rating = r;
    why.push(`${T.RATING_SHOWN[r]}: ${b.name ?? L.nameOf(b)}'s ${b.rating ? "rating" : "LoRA"}`);
  }
  const cap = ACC.account()?.max_rating, above = cap && T.RATINGS.indexOf(rating) > T.RATINGS.indexOf(cap);
  return { would_be: rating, why, ...(above ? { above_cap: `${T.RATING_SHOWN[rating]} is above your cap (${ACC.capShown()}): the server will refuse this run` } : {}) };
}

// a swaps map whose slots may hold lists, as the single re-runs it stands for: every combination, in slot order
export function combos(swaps = {}) {
  return Object.entries(swaps ?? {}).reduce((list, [slot, ask]) => {
    const to = typeof ask === "string" || ask == null || Array.isArray(ask) ? ask : ask.to, picks = Array.isArray(to) ? to : [to]; // {to}, or the choice (or list) itself
    if (!picks.length) throw new Error(`swaps["${slot}"].to is an empty list: give one choice or several`);
    return list.flatMap((m) => picks.map((p) => ({ ...m, [slot]: { to: p } })));
  }, [{}]);
}

// each asked swap, checked against the take's slots: refused naming the slots there are and every choice of the slot
export async function resolve(take, swaps = {}) {
  if (swaps == null || typeof swaps !== "object" || Array.isArray(swaps)) throw new Error(`swaps: an object of slot → {to}, e.g. {"cast:cast-k7f2x9": {"to": "cast:cast-m2a9"}}`);
  const list = await slots(take);
  return Object.entries(swaps).map(([slot, ask]) => {
    const s = list.find((x) => x.slot === slot);
    if (!s) throw new Error(`${named(take)} has no slot "${slot}"; its slots are ${list.map((x) => x.slot).join(", ")}`);
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

// how Reuse the motion does one swap on the take: {method, args, label, picture, world, rerun}, or {not_possible: why}
export async function motionOf(take, s, who) {
  const no = (why) => ({ slot: s.slot, text: s.text, not_possible: why, instead: "regenerate" });
  if (s.slot === "setup") return no("Viggle Remake and Ripple run their own H3 model on the take, so another Setup can't apply: Re-generate does that");
  const rerun = { slot: s.slot, to: s.ref ?? s.to, text: s.text }, base = { slot: s.slot, text: s.text, rerun, label: s.text };
  if (s.slot === "scene") return { ...base, method: "remake_edit", args: { change: `the place to: ${setBlock(L.get(s.set).brick.snapshot)}` } };
  const { kind, id } = W.parse(s.slot), was = W.get(W.refOf(kind, id, take.world[s.slot].n))?.version.body, now = W.get(s.ref).version.body;
  if (kind === "set_snapshot") return { ...base, method: "remake_edit", args: { change: `the place to: ${setBlock(now.brick.snapshot)}` } };
  if (kind === "card") return now.kind === "shot" ? no("a different shot is different motion: Re-generate does that") : { ...base, method: "remake_edit", args: { change: now.brick?.prompt_fragment ?? now.text } };
  const pics = (b) => JSON.stringify((b?.refs ?? []).map((r) => r.file)), x = W.parse(s.ref);
  if (x.id === id && pics(was) === pics(now)) return { ...base, method: "remake_edit", args: { change: `${now.name}'s look: ${now.details}` } }; // the same person in other words: a change, not a recast
  const asWho = who?.trim() || was?.details;
  if (!asWho) throw new Error(`who: say who in take ${take.number} ${now.name} replaces, in words ("the woman in the red coat") or as find_people numbers them ("person 2"): ${was?.name ?? s.slot} has no details line`);
  const becomes = now.details || now.name, v = W.get(s.ref).version;
  return { ...base, method: "remake_swap", args: { who: asWho, becomes }, ...(now.refs?.[0] ? { picture: now.refs[0].file } : {}),
    world: { [W.refOf("cast", x.id)]: { follow: true, n: v.n, hash: W.short(v.hash), name: now.name, placed: { recast: true, text: becomes }, ...(now.rating ? { rating: now.rating } : {}) } } };
}

// Reuse the motion: the first swap the take's own motion can do starts its candidates decision; the rest are listed
async function reuse(take, asked, { count = 2, who, by = "person" }) {
  const go = asked.filter((s) => !s.keep);
  if (!go.length) throw new Error(`Reuse the motion needs a swap: name a Cast, set, scene or card for take ${take.number} (rerun_slots lists them)`);
  const plan = await Promise.all(go.map((s) => motionOf(take, s, who))), can = plan.filter((p) => !p.not_possible), not_possible = plan.filter((p) => p.not_possible);
  if (!can.length) return { take: take.id, route: "reuse_motion", decisions: [], not_possible, said: `Nothing here can reuse take ${take.number}'s motion: ${not_possible.map((p) => `${p.text}: ${p.not_possible}`).join("; ")}` };
  const [first, ...waiting] = can, out = await ED.start(take, first.method, { ...first.args, count, by, rerun: first.rerun, label: first.label, picture: first.picture, world: first.world });
  return { take: take.id, route: "reuse_motion", decisions: [{ decision: out.decision, method: first.method, ...first.args, ...(first.picture ? { picture: first.picture } : {}), candidates: out.candidates }],
    ...(waiting.length ? { waiting: waiting.map((p) => ({ slot: p.slot, text: p.text, method: p.method, after: "apply a candidate, then re-run the new take with this swap" })) } : {}), ...(not_possible.length ? { not_possible } : {}),
    next: "list_candidates (look at each painted frame), then apply_candidate", said: `Take ${take.number}'s motion with ${first.text}: ${count} painted candidate${count === 1 ? "" : "s"} to pick from${waiting.length ? `; then ${waiting.map((p) => p.text).join(", ")}` : ""}${not_possible.length ? `; not on its own motion: ${not_possible.map((p) => p.text).join(", ")} (Re-generate)` : ""}` };
}

// several re-runs at once: Re-generate queues each as a take and gathers them as one decision's candidates; Reuse the
// motion opens a decision per combination
async function batch(take, all, { route, seed, land, go, count, who, by }) {
  for (const m of all) await resolve(take, m); // every combination is checked before anything opens or runs
  if (route === "reuse_motion") {
    const out = [];
    for (const m of all) out.push(await reuse(take, await resolve(take, m), { count, who, by }));
    return { take: take.id, route, decisions: out.flatMap((r) => r.decisions), runs: all.length, ...(out.some((r) => r.not_possible) ? { not_possible: out.flatMap((r) => r.not_possible ?? []) } : {}),
      next: "list_candidates (look at each painted frame), then apply_candidate", said: out.map((r) => r.said).join(" · ") };
  }
  const list = [];
  for (const m of all) { const r = await rerun(take, { swaps: m, route, seed, land, queue: go }); list.push({ prompt_id: r.run, swaps: m, text: r.said, label: (await resolve(take, m)).filter((s) => !s.keep).map((s) => s.text).join(", ") || "as it was", ...(r.new_seed != null ? { seed: r.new_seed } : {}) }); }
  if (!go) return { take: take.id, route, runs: list.length, said: `${list.length} re-runs opened one after another; the chain holds the last (${list.at(-1).label}) · nothing is queued` };
  const d = await C.create({ kind: "rerun", target: take.id, title: `Take ${take.number} with ${list.map((c) => c.label).join(" · ")}`, by, take: take.id, route, seed }, list.map(({ text, ...c }) => c));
  return { take: take.id, route, decision: d.id, runs: d.candidates.map((c) => ({ candidate: c.id, run: c.prompt_id, take: `take-${c.prompt_id}`, swaps: c.label })),
    next: "run_status each run until done, then list_candidates {kind: rerun} and apply_candidate the one to keep (it becomes the shot's active take)",
    said: `Take ${take.number} re-run ${list.length} times (${list.map((c) => c.label).join(" · ")}), one after another; they come back as candidates to pick from. The chain now holds the last one (${list.at(-1).label}): Undo in the graph puts it back` };
}

C.kind("rerun", RT.takeCandidate); // a re-run candidate is a take (retake.js)

// Re-generate: the take's recipe again with the swaps, the same seed unless `seed` is new; queue: false only opens it.
// An opened file (opened()) runs in place, unmarked
export async function rerun(take, { swaps = {}, route = "regenerate", seed = "same", land, queue: go = true, count, who, by = "person" } = {}) {
  if (!ROUTES.includes(route)) throw new Error(`route is one of ${ROUTES.join(", ")}`);
  if (!SEEDS.includes(seed)) throw new Error(`seed is one of ${SEEDS.join(", ")}`);
  const all = combos(swaps);
  if (all.length > 1) return batch(take, all, { route, seed, land, go, count, who, by });
  if (route === "reuse_motion") { if (!take.id) throw new Error("Reuse the motion needs a take (its video is the motion): this file isn't one here"); return reuse(take, await resolve(take, swaps), { count, who, by }); }
  if (!take.graph) throw new Error(`${named(take)} has no workflow saved with it`);
  const asked = await resolve(take, swaps), home = landing(land), where = take.id ? await RT.openTake(take, home) : "this tab", done = [];
  for (const s of asked.filter((x) => !x.keep)) done.push(await put(s));
  const seedKey = E.state().bricks.find((b) => E.seedMode(b.key))?.key, newSeed = seed === "new" && seedKey ? E.newSeed(seedKey) : null;
  const cached = seed === "same" && (await T.hashes(await T.live())).hash === take.hash;
  const marks = Object.fromEntries(asked.map((s) => [s.slot, { to: s.ref ?? s.to, text: s.text, ...(s.keep ? { kept: true } : {}) }]));
  const what = asked.filter((s) => !s.keep).map((s) => s.text);
  const run = go ? await RT.queue("rerun", take.id ? { take: take.id, route, swaps: marks, seed, ...(land != null ? { land } : {}) } : undefined,
    { title: `Re-run ${named(take)} ${what.length ? `with ${what.join(", ")}` : "as it was"}${seed === "new" ? ", new seed" : ""}`, by, eta_s: take.seconds ?? null }) : null;
  if (take.id) await SC.saveOpen(); // the shot's workflow as it ran: the next re-run of a batch finds nothing unsaved (SNAP-R5)
  return { take: take.id, route, seed, opened: where, swapped: done, ...(newSeed != null ? { new_seed: newSeed } : {}), run,
    ...(cached ? { cache_hit: `nothing the prompt holds changed: ComfyUI serves take ${take.number}'s own file from its cache. Re-run with seed new for a fresh render` } : {}),
    said: `${named(take)} ${go ? (take.id ? "re-run" : "running") : "opened"} ${what.length ? `with ${what.join(", ")}` : "as it was"} in ${where}${done.length ? ` · ${done.join(" · ")}` : ""}${go ? "" : " · nothing is queued"}` };
}
