// SNAP-R19 shared tools · SNAP-R272 native production planning and one visible entry.
import { app } from "../../scripts/app.js";
import { callTool, checkArgs } from "./snap/tools.js";
import { openDirector } from "./snap/director/dialog.mjs";
import * as SC from "./snap/scenes.js";
import { snapOn } from "./snap/enabled.js";

const open = async () => {
  try {
    await SC.load();
    await openDirector((name, args, context = {}) => {
      checkArgs(name, args);
      return callTool(name, args, context);
    }, { book: SC.current()?.scene.book ?? "" });
  } catch (error) { console.error("SNAP production strategies", error); }
};
// part of Snap: registered with it, as the page loads or when a person turns Snap on (snap_view.js)
const DIRECTOR = {
  name: "MAINodes.Snap.Director",
  commands: [{ id: "MAINodes.Snap.Director.Open", label: "SNAP: Production strategies", icon: "icon-[lucide--clapperboard]", function: open }],
  actionBarButtons: [{ label: "Strategies", icon: "icon-[lucide--clapperboard]", tooltip: "Preview and customize a native SNAP production strategy", onClick: open }],
};
let registered = false;
export function registerDirector() { if (!registered) { registered = true; app.registerExtension(DIRECTOR); } }
if (snapOn) registerDirector();
