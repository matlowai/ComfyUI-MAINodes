// Snap view: a lego-style face over the real graph. Bricks snap together into ordinary nodes and links; the graph stays
// one toggle away (Alt+S, the Snap button, or "Toggle Snap view" in the command palette). Design and numbers:
// the Snap study notes, UX_SPEC.md.
import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import * as engine from "./snap/engine.js";
import { createView } from "./snap/view.js";
import { createSwitch } from "./snap/switch.js";
import { STYLE } from "./snap/style.js";

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
  const wf = app.graph.serialize();
  wf.extra.linearData = engine.appData();
  wf.extra.linearMode = true;
  sw.toGraph();
  await app.loadGraphData(wf, true, true, app.extensionManager.workflow.activeWorkflow);
  await app.extensionManager.command.execute("Comfy.ToggleLinear");
}

function toggle() {
  sw.toggle();
  if (sw.showing) announce();
}

app.registerExtension({
  name: "MAINodes.Snap",
  commands: [{ id: "MAINodes.Snap.Toggle", label: "Toggle Snap view", icon: "icon-[lucide--blocks]", function: () => toggle() }],
  keybindings: [{ combo: { key: "s", alt: true }, commandId: "MAINodes.Snap.Toggle" }],
  actionBarButtons: [{ icon: "icon-[lucide--blocks]", label: "Snap", tooltip: "Snap view (Alt+S)", onClick: () => toggle() }],
  setup() {
    document.head.append(Object.assign(document.createElement("style"), { textContent: STYLE }));
    view = createView({ onSwitch: (key) => sw.toGraph(key), onMakeApp: makeApp });
    document.body.append(view.root);
    sw = createSwitch(view);
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
