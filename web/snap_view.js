// Snap view: a lego-style face over the real graph. Bricks snap together into ordinary nodes and links; the graph stays
// one toggle away (Alt+S, the Snap button, or "Toggle Snap view" in the command palette). Design and numbers:
// the Snap study notes, UX_SPEC.md.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import * as engine from "./snap/engine.js";
import { createView } from "./snap/view.js";
import { createSwitch } from "./snap/switch.js";
import { STYLE } from "./snap/style.js";
import { callTool, schema, readOnly, registerWebMCP, ui, AGENTS_RUN, accepts, checkArgs } from "./snap/tools.js";
import * as T from "./snap/takes.js";
import * as J from "./snap/jobs.js";
import * as rules from "./snap/rules.js";
import * as S from "./snap/slots.js";
import * as MD from "./snap/metadata.js";
import * as PF from "./snap/profile.js";
import * as sight from "./snap/sight.js";

let view, sw;
const seen = new Set(), pending = [];

export const snap = {
  engine,
  get view() { return view; },
  get switch() { return sw; },
  toggle: () => toggle(),
};

function announce() {
  if (!pending.length) return;
  view.say(`Kept your graph wiring: ${pending.map((o) => `${o.to}.${o.role} ${o.change}`).join(", ")}`);
  pending.length = 0;
}

// App mode only reads linearData when a workflow loads, so the recipe is reloaded in place with its brick faces as the app
async function makeApp() {
  engine.tidy();
  const wf = app.graph.serialize();
  wf.extra.linearData = engine.appData();
  wf.extra.linearMode = true;
  sw.toGraph();
  await app.loadGraphData(wf, true, true, app.extensionManager.workflow.activeWorkflow);
  await app.extensionManager.command.execute("Comfy.ToggleLinear");
}

// agent calls (WebMCP in-page, or the /mainodes/snap bridge from tools/snap_mcp.py) run like user edits and show up live;
// an agent's error names what the tool takes (SNAP-R30)
async function agentCall(name, args) {
  const before = sw.showing ? new Map([...view.stack.querySelectorAll("[data-brick]")].map((el) => [el.dataset.brick, el.getBoundingClientRect()])) : null;
  let result;
  try { checkArgs(name, args ?? {}); result = await callTool(name, args); } catch (e) {
    throw new Error(schema().some((t) => t.name === name) ? `${e.message} (${name} takes: ${accepts(name)})` : e.message);
  }
  if (sw.showing && !readOnly(name)) {
    view.render(before, args?.propose ? undefined : result?.brick ?? args?.brick); // a new any-node brick gets its #n key
    const what = `${name.replaceAll("_", " ")} ${args?.brick ?? args?.card ?? ""} ${args?.name ? `${args.name} = ${JSON.stringify(args.value)}` : ""}`.trim();
    view.say(args?.propose ? `Agent proposes: ${what}` : `Agent: ${what}`);
  }
  return result;
}

const modes = new WeakMap(); // workflow (the tab's object, which survives a rename or save) -> Snap showing
const activeTab = () => app.extensionManager.workflow.activeWorkflow;
const remember = () => activeTab() && modes.set(activeTab(), sw.showing && !sw.docked);

// the full view and the docked tab are one view in two places; opening the full view closes the tab first
const TAB = "mainodes-snap";
async function toggle() {
  if (sw.docked) { await app.extensionManager.command.execute(`Workspace.ToggleSidebarTab.${TAB}`); sw.undock(true); }
  sw.toggle();
  remember();
  if (sw.showing) { announce(); view.firstVisit().catch((err) => view.say(err.message, true)); }
  else graphEntry();
}

// leaving Snap for the graph adds one history entry (same URL, the router's own state kept), so the mouse's back button,
// Alt+Left or a swipe come back to Snap and forward returns to the graph. Never more than one entry: a second trip to the
// graph from that entry reuses it
const ENTRY = "mainodes-snap-graph";
function graphEntry() {
  if (history.state?.[ENTRY]) return;
  history.pushState({ ...history.state, [ENTRY]: true }, "", location.href);
}
function toGraph(key) {
  sw.toGraph(key);
  remember();
  graphEntry();
}
addEventListener("popstate", (e) => {
  if (!sw || sw.docked) return;
  if (e.state?.[ENTRY]) { if (sw.showing) toGraph(); } // forward, onto the graph entry
  else if (!sw.showing && activeTab() && modes.has(activeTab())) toggle(); // back from the graph to Snap
});

// where a clicked brick shows its settings: ComfyUI's own setting, so it is kept with the user's settings everywhere
const OPEN_IN = "MAINodes.Snap.OpenIn", PLACES = { "Side panel": "panel", "The brick itself": "brick" };
const openIn = () => PLACES[app.extensionManager.setting.get(OPEN_IN)] ?? "panel";
const setOpenIn = (place) => app.extensionManager.setting.set(OPEN_IN, Object.keys(PLACES).find((k) => PLACES[k] === place));

app.registerExtension({
  name: "MAINodes.Snap",
  settings: [{ id: OPEN_IN, category: ["MAINodes", "Snap", "Open in"], name: "Clicking a Snap brick opens its settings in", type: "combo",
    options: Object.keys(PLACES), defaultValue: "Side panel", onChange: () => view?.openInChanged() },
    { id: AGENTS_RUN, category: ["MAINodes", "Snap", "Agents run"], name: "Let agents run renders and make dials without asking", type: "boolean", defaultValue: false,
      tooltip: "Off: an agent's run or make_dial waits as a proposal you accept. On: it starts right away (it uses GPU time)." },
    { id: MD.SETTING, category: ["MAINodes", "Snap", "Metadata"], name: "Save the prompt and workflow (metadata) in every saved picture and video", type: "boolean", defaultValue: true,
      tooltip: "On: files keep their recipe, LoRA names included, so you can reproduce them. Off: this browser's runs save without it. Also the switch next to Run in Snap.",
      onChange: () => view?.metadataChanged() },
    { id: MD.RATE_WORDS, category: ["MAINodes", "Snap", "Ratings"], name: "Rate takes from their prompt's words too (an account capped below Adult always is)", type: "boolean", defaultValue: false,
      tooltip: "Off: a take is rated from the files and takes it used. On: a prompt with a clearly sexual word also rates it Adult (SNAP-R39)." },
    // the profile's code_review (SNAP-R28) is the truth; this row and the profile follow each other (startup's call has no old value)
    { id: PF.REVIEW_SETTING, category: ["MAINodes", "Snap", "Code review"], name: "When an agent wants to add code that isn't part of your setup yet, it reads the code first", type: "combo",
      options: Object.entries(PF.REVIEWS).map(([value, text]) => ({ value, text })), defaultValue: "unknown",
      tooltip: "It costs tokens. Packs in Snap's kits already carry a safety read. Every install still waits for your yes.",
      onChange: (v, old) => { if (old !== undefined && v !== PF.get().code_review) PF.set({ code_review: v }); } }],
  commands: [{ id: "MAINodes.Snap.Toggle", label: "Toggle Snap view", icon: "icon-[lucide--blocks]", function: () => toggle() }],
  keybindings: [{ combo: { key: "s", alt: true }, commandId: "MAINodes.Snap.Toggle" }],
  actionBarButtons: [{ icon: "icon-[lucide--blocks]", label: "Snap", tooltip: "Snap view (Alt+S)", onClick: () => toggle() }],
  setup() {
    document.head.append(Object.assign(document.createElement("style"), { textContent: STYLE }));
    // SNAP-R20: every prompt this page queues (Snap's Run, the graph's, an agent's) says whether its files keep metadata;
    // SNAP-R65: and carries its job stamp, put into the POST that api.queuePrompt sends at once (its first await)
    const queuePrompt = api.queuePrompt.bind(api), fetchApi = api.fetchApi.bind(api);
    let stamp = null;
    api.fetchApi = (route, options) => {
      if (!stamp || route !== "/prompt" || options?.method !== "POST") return fetchApi(route, options);
      const body = JSON.parse(options.body);
      body.extra_data = { ...body.extra_data, snap_job: stamp };
      stamp = null;
      return fetchApi(route, { ...options, body: JSON.stringify(body) });
    };
    api.queuePrompt = (number, data, options) => {
      const job = J.sending();
      stamp = job;
      const sent = queuePrompt(number, { ...data, workflow: MD.mark(data.workflow) }, options);
      stamp = null;
      return sent.then((r) => { T.queuedRun(r?.prompt_id); J.sent(job, r?.prompt_id ?? null); return r; }, (e) => { J.sent(job, null); throw e; });
    };
    view = createView({ onSwitch: (key) => toGraph(key), onMakeApp: makeApp, run: (name, args) => callTool(name, args, { confirmed: true }), openIn, setOpenIn });
    // agents read and drive the view through the read_ui / ui tools; switching views lives here with the switch
    ui.read = () => ({ ...view.uiRead(), view: sw.showing ? (sw.docked ? "snap (docked)" : "snap") : "graph" });
    ui.act = async (action, target) => {
      if (action === "snap") { if (!sw.showing) await toggle(); return ui.read(); }
      if (action === "graph") { if (sw.showing && !sw.docked) toGraph(target); return ui.read(); }
      await view.uiAct(action, target);
      return ui.read();
    };
    document.body.append(view.root);
    sw = createSwitch(view);
    rules.load().then((list) => engine.useRules(list), () => {}); // remembered picks; without them Snap just asks again
    app.extensionManager.registerSidebarTab({ id: TAB, icon: "icon-[lucide--blocks]", title: "Snap", tooltip: "Snap beside the graph", type: "custom",
      render: (el) => { sw.dock(el); announce(); }, destroy: () => setTimeout(() => sw.undock(), 0) });
    // the tools go out once the method registry is in: their slot enum is its slots
    S.load().catch(() => {}).then(() => registerWebMCP(agentCall));
    // the bridge sends agent calls to one tab: the one registered last (this tab registers when it loads, regains
    // focus, or reconnects after a server restart)
    // U72 F20: the page says which Snap code it loaded (the server's hash of its web files when this page started), and
    // whether it is an agent's headless page, so the bridge can prefer a current page and say when one runs older code
    const loaded = api.fetchApi("/mainodes/snap/info").then((r) => (r.ok ? r.json() : {}), () => ({})).then((x) => x.code ?? null);
    // `sees`: the person turned "Let agents see" on, which is what lets agents drive this tab (the bridge sends calls to the
    // newest such tab, then to an agent's own headless page; a tab with it off is never driven)
    const register = () => Promise.all([S.load().catch(() => {}), loaded]).then(([, code]) => api.fetchApi("/mainodes/snap/register", { method: "POST", body: JSON.stringify({ client: api.clientId, tools: schema(), code, headless: sight.HEADLESS, sees: sight.sharing() }) }));
    if (api.clientId) register(); else api.addEventListener("status", register, { once: true }); // the id arrives with the first status
    addEventListener("focus", register);
    sight.onChange(register);
    api.addEventListener("reconnected", register);
    api.addEventListener("mainodes-snap-call", async ({ detail }) => {
      let reply;
      try { reply = { id: detail.id, result: await agentCall(detail.tool, detail.args) }; } catch (e) { reply = { id: detail.id, error: e.message }; }
      api.fetchApi("/mainodes/snap/result", { method: "POST", body: JSON.stringify({ client: api.clientId, ...reply }) });
    });
    // http://host/?snap opens straight into Snap once the first workflow has loaded
    if (new URLSearchParams(location.search).has("snap")) {
      const open = () => (activeTab() ? setTimeout(() => sw.showing || toggle(), 400) : setTimeout(open, 100));
      open();
    }
    // each workflow tab remembers Snap or Graph (as App mode does): recorded when the person switches, restored when
    // another tab loads; undo, or a scene's next shot loaded into the same tab, keeps the mode and only re-renders (a
    // same-tab load fires no graphChanged until the next mouseup)
    let tab = activeTab();
    // the graph is configured before the frontend marks the new tab active, so look once the switch has settled
    app.graph.events.addEventListener("configured", () => setTimeout(() => {
      if (activeTab() === tab) { if (sw.showing) view.render(null); return; }
      tab = activeTab();
      if (sw.docked) return view.render(null);
      // a tab seen before gets its mode back; an unseen one with a recipe keeps the current mode, a plain graph opens as one
      const want = modes.has(tab) ? modes.get(tab) : engine.state().bricks.length ? sw.showing : false;
      if (want && !sw.showing) sw.toSnap();
      else if (!want && sw.showing) sw.toGraph();
      else if (want) view.render(null);
    }));
    // graph edits, undo and workflow loads all land here; overrides made in the graph are announced once, in Snap
    api.addEventListener("graphChanged", () => {
      for (const o of engine.overrides()) {
        const id = `${o.to}.${o.role}.${o.change}`;
        if (!seen.has(id)) { seen.add(id); pending.push(o); }
      }
      if (sw.showing) { view.render(null); announce(); }
    });
  },
});
