// Metadata in saved files (SNAP-R20): the person's ComfyUI setting, on by default as core saves. Off, every prompt this
// page queues carries extra.snap_metadata false in its workflow, and the server's save gate (snap_bridge.py) swaps core's
// savers for twins that write no prompt or workflow. On, the mark is taken off again (a take's workflow run again).
// SNAP-R20 metadata switch · see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";

export const SETTING = "MAINodes.Snap.SaveMetadata";
export const on = () => app.extensionManager.setting.get(SETTING) !== false;
export const set = (value) => app.extensionManager.setting.set(SETTING, !!value);

export function mark(workflow) {
  const { snap_metadata, ...extra } = workflow?.extra ?? {};
  return { ...workflow, extra: on() ? extra : { ...extra, snap_metadata: false } };
}
