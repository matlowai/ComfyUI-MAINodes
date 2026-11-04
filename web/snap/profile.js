// The person's onboarding answers (SNAP-R25), in their ComfyUI user data `snap/profile.json`: what they want to make, SFW
// only, which tasks may use API models, and which questions they answered or skipped, so onboarding resumes where it
// stopped. Metadata isn't kept here: its answer sets the Save metadata switch (SNAP-R20), which stays the one truth.
// SNAP-R18 local only · SNAP-R25 onboarding · see docs/SNAP_RULES.md
import { api } from "../../../scripts/api.js";

const FILE = "snap/profile.json";
// every task stays local until the person allows the cloud for it
export const EMPTY = { intents: [], sfw_only: false, api_tasks: [], answered: [], done: false };
let profile = null, loading = null, notify = () => {};

export function load() {
  loading ??= api.getUserData(FILE).then(async (r) => (profile = r.ok ? { ...EMPTY, ...(await r.json()) } : { ...EMPTY }), () => (profile = { ...EMPTY }));
  return loading;
}
export const get = () => profile ?? EMPTY;
export const sfwOnly = () => !!get().sfw_only;
export const apiAllowed = (task) => get().api_tasks.includes(task);

// a patch from the sheet or set_profile: known fields only, `answered` grows (a question asked once stays answered)
export async function set(patch) {
  await load();
  const known = Object.fromEntries(Object.entries(patch).filter(([k]) => k in EMPTY && k !== "answered"));
  profile = { ...profile, ...known, answered: [...new Set([...profile.answered, ...(patch.answered ?? [])])], updated: new Date().toISOString() };
  await api.storeUserData(FILE, profile);
  notify();
  return profile;
}
export const onChange = (fn) => { notify = fn; };
