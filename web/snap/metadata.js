// Metadata in saved files (SNAP-R20): the person's ComfyUI setting, on by default as core saves. Off, every prompt this
// page queues carries extra.snap_metadata false in its workflow, and the server's save gate (snap_bridge.py) swaps core's
// savers for twins that write no prompt or workflow. On, the mark is taken off again (a take's workflow run again).
// The same mark says whether the server rates a take from its prompt's words too (SNAP-R39): a user setting, off by
// default, for an account with no cap below Adult (the operator, 2026-11-04); a capped account's prompts are always rated so.
// SNAP-R20 metadata switch · SNAP-R39 ratings from how a thing was made · see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";

export const SETTING = "MAINodes.Snap.SaveMetadata", RATE_WORDS = "MAINodes.Snap.RatePromptWords";
export const on = () => app.extensionManager.setting.get(SETTING) !== false;
export const set = (value) => app.extensionManager.setting.set(SETTING, !!value);
const rateWords = () => app.extensionManager.setting.get(RATE_WORDS) === true;

export function mark(workflow) {
  const { snap_metadata, snap_rate_words, ...extra } = workflow?.extra ?? {};
  return { ...workflow, extra: { ...extra, ...(on() ? {} : { snap_metadata: false }), ...(rateWords() ? { snap_rate_words: true } : {}) } };
}
