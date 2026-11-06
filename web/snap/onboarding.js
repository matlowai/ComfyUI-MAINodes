// "I'm new, help me set up" (SNAP-R25, MODEL_GRAPH_ONBOARDING §4 and §8): intent → kit. A kit (snap_cards/kits.json) names
// setups per intent; what each file is, how big, where it goes and where it comes from is the model graph's (models.js),
// what a method needs the method registry's (slots.js). The scan matches this machine's model folders and installed nodes
// against them: ready, missing, or can't load. Downloads are only proposed: exact files, sizes, sources and target folders
// for the person or their agent to fetch. Nothing here makes a request off this machine. The sheet (onboardview.js) and
// the agent tools call the same functions (SNAP-R19).
// SNAP-R3 missing stays visible · SNAP-R5 setups open in new tabs · SNAP-R11 warn, never block · SNAP-R18 local only ·
// SNAP-R19 one table · SNAP-R25 onboarding · SNAP-R28 agents read new code per the person's setting · SNAP-R39 kit files
// arrive rated · SNAP-R53 no link, not required · see docs/snap/SNAP_RULES.md
import { api } from "../../../scripts/api.js";
import * as E from "./engine.js";
import * as M from "./models.js";
import * as L from "./library.js";
import * as S from "./slots.js";
import * as PF from "./profile.js";
import { BRICKS } from "./bricks.js";

let data = null, loading = null, machine = null;
export function load() {
  loading ??= Promise.all([api.fetchApi("/mainodes/snap/kits").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`no kits on this server (${r.status}); restart ComfyUI after updating MAINodes`)))),
    PF.load(), M.load(), L.ready(), S.load()]).then(([k]) => (data = k), (e) => { loading = null; throw e; });
  return loading;
}
export const kits = () => data?.kits ?? [];
export const tasks = () => data?.tasks ?? [];
export const grade = (g) => data?.grades?.[g] ?? g;
// a measurement names where it was made ("measured on an RTX 5090 (32 GB)"), whatever machine reads it
const evidence = (e) => [grade(e?.grade), e?.on && `on ${e.on}`].filter(Boolean).join(" ");

// hardware is read, never asked: the first device /system_stats lists (a CPU-only server says so). Cards report a bit
// under their size (a 5090 gives 31.4 GiB), so the size rounds up to the card's own 32 GB
export async function hardware() {
  machine ??= api.fetchApi("/system_stats").then((r) => r.json()).then(({ devices = [], system = {} }) => {
    const d = devices[0], gpu = d && d.type !== "cpu";
    return { gpu: gpu ? d.name.replace(/^cuda:\d+\s*/, "").replace(/\s*:\s*\w+$/, "") : null, vram_gb: gpu ? Math.ceil(d.vram_total / 2 ** 30) : 0, ram_gb: Math.round((system.ram_total ?? 0) / 2 ** 30) };
  });
  return machine;
}

const base = (f) => String(f).replace(/\\/g, "/").split("/").pop();
const filesIn = (x) => (JSON.stringify(x ?? {}).match(/[^"/\\]+\.safetensors/g) ?? []);
const method = (id) => S.slots().filter((s) => S.slot(s).kind !== "delta").flatMap(S.list).find((m) => m.id === id) ?? null;
const presetValues = async (name) => { const r = await api.fetchApi(`/mainodes/render/presets/${encodeURIComponent(name)}`); return r.ok ? r.json() : {}; };
// the VRAM swaps that apply here: a smaller file in place of the setup's own on a smaller GPU (none without a GPU)
const swaps = (s, hw) => (hw.gpu ? (s.lowvram ?? []).filter((x) => hw.vram_gb < x.below_gb) : []);

// every file a setup loads: its recipe's Models brick and preset, its card's bricks, its turbo, its method, its extras
async function filesOf(s, hw) {
  const names = [...(s.recipe === "simple" ? BRICKS.models.nodes.flatMap((n) => filesIn(n.values)) : []), ...(s.preset ? filesIn(await presetValues(s.preset)) : []),
    ...(s.card ? filesIn(L.get(s.card)?.brick) : []), ...(s.turbo ? [s.turbo] : []), ...(s.method ? filesIn(method(s.method)) : []), ...(s.files ?? [])].map(base);
  const out = [...new Set(names)];
  for (const { swap: [from, to] } of swaps(s, hw)) if (out.includes(from)) out.splice(out.indexOf(from), 1, to);
  return out;
}
// one file as the scan sees it: installed (one match by name in any sub-folder, SNAP-R3), or what it takes to get it, with
// the rating it arrives with (the model graph rates every kit file, SNAP-R39)
function fileInfo(name, installed) {
  const here = E.resolveChoice(installed, name), e = M.entry(name), folder = e.folder ?? null;
  const top = folder?.split("/")[0], target = top && data.folders[top] ? `${data.folders[top]}${folder.slice(top.length)}` : null;
  return { file: name, folder, size_gb: here ? +(M.file(here).size / 1e9).toFixed(2) : e.size_gb ?? null, installed: !!here && M.readable(here),
    ...(e.loads_in_core === false ? { cant_load: true } : {}), source: e.source_url ?? null, download: e.download ?? null, license: e.license ?? null, rating: e.rating ?? null, target, ...(e.inferred ? { unknown: true } : {}) };
}
const packsOf = (s) => {
  const nodes = method(s.method)?.packs ?? [];
  return (data.packs ?? []).filter((p) => p.nodes.some((t) => nodes.includes(t))).map((p) => ({ ...p, installed: p.nodes.every((t) => LiteGraph.registered_node_types[t]) }));
};

// a setup rated for this machine: its files and packs, ready / missing / can't load, the size still to get, VRAM fit
async function rate(s, hw) {
  const installed = [...(await M.load()).keys()], files = s.node ? [] : (await filesOf(s, hw)).map((f) => fileInfo(f, installed)), packs = packsOf(s), m = s.method ? method(s.method) : null;
  const missing = files.filter((f) => !f.installed), cant = files.filter((f) => f.cant_load);
  const card = s.card ? L.get(s.card) : null;
  return { id: s.id, tier: s.tier, title: s.title ?? card?.title ?? s.preset ?? s.id, good_at: s.good_at, local_or_api: s.node ? "api" : "local",
    state: s.node ? "api" : cant.length ? "cant_load" : missing.length || packs.some((p) => !p.installed) || (m && m.install_state !== "ready") ? "missing" : "ready",
    files, packs, missing_gb: +missing.reduce((a, f) => a + (f.size_gb ?? 0), 0).toFixed(1), downloadable: missing.every((f) => f.download),
    vram_gb: s.vram_gb ?? null, fits: !s.vram_gb || !hw.vram_gb || hw.vram_gb >= s.vram_gb || swaps(s, hw).length > 0,
    swaps: swaps(s, hw).map((x) => ({ from: x.swap[0], to: x.swap[1], evidence: x.evidence })), evidence: { ...s.evidence, label: evidence(s.evidence) },
    ...(m?.unwired ? { unwired: "not wired in Snap yet: runs from the graph" } : {}), ...(s.cost ? { cost: s.cost } : {}), ...(s.node ? { node: s.node } : {}),
    hidden: files.some((f) => M.hidden(f.file)) };
}
// the best of a tier for this machine: ready first, then one every missing file of which has a download, then any
const best = (list) => list.find((r) => r.state === "ready" && r.fits) ?? list.find((r) => r.state === "missing" && r.downloadable && r.fits) ?? list[0] ?? null;

// one intent's kit for this person: recommended for you, a fast option, the alternatives; API setups only when the
// profile allows the cloud for the kit's task; SFW only leaves out setups loading files tagged nsfw
export async function kit(intent) {
  await load();
  const k = kits().find((x) => x.intent === intent);
  if (!k) throw new Error(`No kit "${intent}"; there are: ${kits().map((x) => x.intent).join(", ")}`);
  const hw = await hardware(), rated = (await Promise.all(k.setups.map((s) => rate(s, hw)))).filter((r) => !r.hidden && (r.tier !== "api" || PF.apiAllowed(k.task)));
  const recommended = best(rated.filter((r) => r.tier === "recommended")), fast = best(rated.filter((r) => r.tier === "fast"));
  return { intent, title: k.title, blurb: k.blurb, task: k.task, recommended, fast, ...(fast ? {} : { fast_note: "no measured fast option yet" }), also: rated.filter((r) => r !== recommended && r !== fast), try_first: k.try_first,
    ...(PF.apiAllowed(k.task) ? {} : { api: `API models stay hidden: ${k.task} is local only in your profile` }) };
}

// what this machine can do now: each kit's setups with ✓ ready / missing / can't load, and the files Snap doesn't know
export async function scan() {
  await Promise.all([load(), M.reload()]); // the folders as they are now, not as the page found them
  const all = await Promise.all(kits().map((k) => kit(k.intent)));
  const unknown = [...(await M.load()).keys()].filter((n) => M.entry(n).inferred && !/^dials\//.test(n)).length;
  return { hardware: await hardware(), kits: all.map((k) => ({ intent: k.intent, title: k.title, ready: [k.recommended, k.fast, ...k.also].filter((r) => r?.state === "ready").map((r) => r.title),
    recommended: k.recommended && { title: k.recommended.title, state: k.recommended.state, missing: k.recommended.files.filter((f) => !f.installed).map((f) => f.file), cant_load: k.recommended.files.filter((f) => f.cant_load).map((f) => f.file) },
    fast: k.fast && { title: k.fast.title, state: k.fast.state } })), models_here: M.known(), unknown_files: unknown };
}

// a node pack to clone, with our safety read when the kits know it, and whether the person wants an agent to read its
// code first (SNAP-R28). `pack` is a kit pack's id, folder or repo, or any repo URL an agent wants to bring in
const key = (x) => String(x ?? "").toLowerCase().replace(/\.git$|\/+$/g, "");
function packRow(pack) {
  const p = (data.packs ?? []).find((x) => [x.id, x.folder, x.repo].some((v) => key(v) === key(pack)));
  if (!p) return { repo: pack, known: false, license: null, safety: "not read: Snap's kits don't know this pack", review: PF.review(false),
    ...(/^https?:\/\//.test(pack) ? { command: `git clone ${pack} "${data.folders.custom_nodes}/${key(pack).split("/").pop()}"`, then: "restart ComfyUI" } : {}) };
  return { id: p.id, title: p.title, author: p.author, repo: p.repo, known: true, license: p.license, unlocks: p.unlocks, safety: p.safety, checked: p.checked, review: PF.review(true),
    command: p.command ? p.command.replace("{custom_nodes}", data.folders.custom_nodes) : `git clone ${p.repo} "${data.folders.custom_nodes}/${p.folder}"`, then: "restart ComfyUI" }; // a pack that isn't a git repo of its own says how
}

// what to fetch for the kits' recommended and fast setups (or one setup): exact files with size, source, link and target
// folder, and node packs to clone; or one pack an agent wants to bring in. A proposal only: nothing is downloaded here,
// ever (SNAP-R18)
export async function proposeDownloads({ intents = PF.get().intents, setup, pack } = {}) {
  await load();
  if (pack) return { downloaded: false, files: [], packs: [packRow(pack)], total_gb: 0, note: NOTE };
  const ks = await Promise.all((setup || !intents.length ? kits().map((k) => k.intent) : intents).map(kit));
  const chosen = setup ? ks.flatMap((k) => [k.recommended, k.fast, ...k.also]).filter((r) => r?.id === setup).slice(0, 1) : ks.flatMap((k) => [k.recommended, k.fast]).filter(Boolean);
  if (setup && !chosen.length) throw new Error(`No setup "${setup}" in these kits`);
  // SNAP-R53: a file with no download link is never required: it is listed under optional, to bring your own (U72 F17)
  const files = new Map(), own = new Map(), packs = new Map();
  for (const r of chosen) {
    for (const f of r.files.filter((x) => !x.installed)) {
      const into = f.download && f.target ? files : own;
      into.set(f.file, { ...f, for: [...(into.get(f.file)?.for ?? []), r.title],
        ...(into === files ? { command: `curl -L --fail -o "${f.target}/${f.file}" --create-dirs "${f.download}"` } : { optional: true, why: `${OWN}${f.source ? ` (or look on its source page: ${f.source})` : ""}` }) });
    }
    for (const p of r.packs.filter((x) => !x.installed)) packs.set(p.id, packRow(p.id));
  }
  const list = [...files.values()];
  // add-ons the chosen recipes can use and run without (RelayVSR for the Upscale brick): apart, never in the total
  const recipes = new Set(chosen.map((r) => kits().flatMap((k) => k.setups).find((x) => x.id === r.id)?.recipe));
  const optional = [...own.values(), ...(data.extras ?? []).filter((x) => recipes.has(x.recipe) && method(x.method)?.install_state !== "ready").map(({ recipe, method: m, ...x }) => ({ ...x, optional: true }))];
  return { downloaded: false, files: list, packs: [...packs.values()], total_gb: +list.reduce((a, f) => a + (f.size_gb ?? 0), 0).toFixed(1), ...(optional.length ? { optional } : {}), note: NOTE };
}
const OWN = "no public download: bring your own file";
const NOTE = "Snap never downloads. Each file and pack needs the person's yes; run the commands yourself or have your agent do it. Safetensors only; check each license on its source. A pack's review says whether the agent reads its code first (the person's setting).";

// the recommended setup of each intent, each in a new tab (SNAP-R5: an empty tab is used, open work never is); two
// intents with the same setup share one tab
export async function open(intents = PF.get().intents) {
  await load();
  const hw = await hardware(), opened = [], seen = new Set();
  for (const intent of intents) {
    const k = await kit(intent), r = k.recommended, s = kits().find((x) => x.intent === intent).setups.find((x) => x.id === r?.id);
    if (!s || s.node) continue;
    const key = JSON.stringify([s.recipe, s.preset, s.card, s.turbo]);
    if (seen.has(key)) { opened.find((o) => o.key === key).intents.push(intent); continue; }
    seen.add(key);
    await M.freshTab();
    if (s.card) await M.applyCard(L.get(s.card), { fresh: true });
    else await E.simple();
    const notes = [];
    if (s.preset) { try { M.apply(s.preset); } catch (err) { notes.push(err.message); } }
    if (s.turbo) { try { M.setTurbo(s.turbo); } catch { notes.push(`${base(s.turbo)} isn't installed: Turbo stays off`); } }
    for (const { swap: [from, to] } of swaps(s, hw)) for (const st of M.settings().filter((x) => base(x.file) === from)) { E.setValue(st.brick, st.node, st.setting, to); notes.push(`${to} for your ${hw.vram_gb} GB card`); }
    opened.push({ key, intents: [intent], setup: r.id, title: r.title, state: r.state, notes });
  }
  return opened.map(({ key, ...o }) => o);
}
