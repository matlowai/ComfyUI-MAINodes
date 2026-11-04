// The person's onboarding answers (SNAP-R25), in their ComfyUI user data `snap/profile.json`: what they want to make, SFW
// only, which tasks may use API models, whether agents read code that isn't part of their setup yet before bringing it in
// (code_review, SNAP-R28; its Settings row mirrors it), and which questions they answered or skipped, so onboarding
// resumes where it stopped. Metadata isn't kept here: its answer sets the Save metadata switch (SNAP-R20), which stays
// the one truth.
// SNAP-R18 local only · SNAP-R25 onboarding · SNAP-R28 code review is the person's setting · see docs/SNAP_RULES.md
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const FILE = "snap/profile.json";
// every task stays local until the person allows the cloud for it
export const EMPTY = { intents: [], sfw_only: false, api_tasks: [], code_review: "unknown", answered: [], done: false };
// onboarding's questions in order (the sheet's steps; set_profile's `answered` takes these ids)
export const STEPS = ["intent", "scan", "metadata", "sfw", "local", "code", "kit"];
// code_review: "always" reads every pack or script an agent brings in, "unknown" only what Snap's kits have no safety read
// for, "never" saves the tokens; every install still waits for the person's yes (SNAP-R25)
export const REVIEWS = { always: "Always read it first", unknown: "Only code Snap doesn't know (default)", never: "Never: save the tokens" };
export const REVIEW_SETTING = "MAINodes.Snap.CodeReview";
let profile = null, loading = null, found = false, notify = () => {};

export function load(again = false) {
  if (again) loading = null; // read the file once more (an agent may have written it from another page)
  loading ??= api.getUserData(FILE).then(async (r) => { found = r.ok; return (profile = r.ok ? { ...EMPTY, ...(await r.json()) } : { ...EMPTY }); }, () => (profile = { ...EMPTY }));
  return loading;
}
export const get = () => profile ?? EMPTY;
// whether the person has a profile file yet (the first Snap visit opens onboarding once, then writes one)
export const saved = () => found;
export const sfwOnly = () => !!get().sfw_only;
export const apiAllowed = (task) => get().api_tasks.includes(task);
// whether an agent reads a pack's code before it brings it in: `known` when Snap's kits carry our safety read for it
export const review = (known) => { const r = get().code_review; return r === "always" || (r === "unknown" && !known) ? "required" : "skipped (your setting)"; };

// a patch from the sheet or set_profile: known fields only, `answered` grows (a question asked once stays answered); done
// means every question was dealt with, so it answers them all (U72 F14: an agent's done: true left answered empty)
export async function set(patch) {
  await load();
  const known = Object.fromEntries(Object.entries(patch).filter(([k]) => k in EMPTY && k !== "answered"));
  profile = { ...profile, ...known, answered: [...new Set([...profile.answered, ...(patch.answered ?? []), ...(known.done ? STEPS : [])])], updated: new Date().toISOString() };
  await api.storeUserData(FILE, profile);
  found = true;
  if ("code_review" in known && app.extensionManager.setting.get(REVIEW_SETTING) !== profile.code_review) await app.extensionManager.setting.set(REVIEW_SETTING, profile.code_review);
  notify();
  return profile;
}
export const onChange = (fn) => { notify = fn; };
