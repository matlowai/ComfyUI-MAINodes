// Snap view: a lego-style face over the real graph. Bricks snap together into ordinary nodes and links; the graph stays
// one toggle away (Alt+S, the Snap button, or "Toggle Snap view" in the command palette). Design and numbers:
// the Snap study notes, UX_SPEC.md.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import * as engine from "./snap/engine.js";
import { createView } from "./snap/view.js";
import { createSwitch } from "./snap/switch.js";
import { STYLE } from "./snap/style.js";
import { callTool, schema, readOnly, registerWebMCP } from "./snap/tools.js";
import * as rules from "./snap/rules.js";

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

// agent calls (WebMCP in-page, or the /mainodes/snap bridge from tools/snap_mcp.py) run like user edits and show up live
async function agentCall(name, args) {
  const before = sw.showing ? new Map([...view.stack.querySelectorAll("[data-brick]")].map((el) => [el.dataset.brick, el.getBoundingClientRect()])) : null;
  const result = await callTool(name, args);
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
  if (sw.showing) announce();
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

app.registerExtension({
  name: "MAINodes.Snap",
  commands: [{ id: "MAINodes.Snap.Toggle", label: "Toggle Snap view", icon: "icon-[lucide--blocks]", function: () => toggle() }],
  keybindings: [{ combo: { key: "s", alt: true }, commandId: "MAINodes.Snap.Toggle" }],
  actionBarButtons: [{ icon: "icon-[lucide--blocks]", label: "Snap", tooltip: "Snap view (Alt+S)", onClick: () => toggle() }],
  setup() {
    document.head.append(Object.assign(document.createElement("style"), { textContent: STYLE }));
    view = createView({ onSwitch: (key) => toGraph(key), onMakeApp: makeApp, run: callTool });
    document.body.append(view.root);
    sw = createSwitch(view);
    rules.load().then((list) => engine.useRules(list), () => {}); // remembered picks; without them Snap just asks again
    app.extensionManager.registerSidebarTab({ id: TAB, icon: "icon-[lucide--blocks]", title: "Snap", tooltip: "Snap beside the graph", type: "custom",
      render: (el) => { sw.dock(el); announce(); }, destroy: () => setTimeout(() => sw.undock(), 0) });
    registerWebMCP(agentCall);
    // the bridge sends agent calls to one tab: the one registered last (this tab registers when it loads, regains
    // focus, or reconnects after a server restart)
    const register = () => api.fetchApi("/mainodes/snap/register", { method: "POST", body: JSON.stringify({ client: api.clientId, tools: schema() }) });
    if (api.clientId) register(); else api.addEventListener("status", register, { once: true }); // the id arrives with the first status
    addEventListener("focus", register);
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
    // another tab loads; undo reloads the same tab and changes nothing
    let tab = activeTab();
    // the graph is configured before the frontend marks the new tab active, so look once the switch has settled
    app.graph.events.addEventListener("configured", () => setTimeout(() => {
      if (activeTab() === tab) return;
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
