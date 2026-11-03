// Remembered picks (BRAINSTORM O1): a "which one?" answer becomes a local rule, so the same pair binds without asking
// next time, in any workflow. Kept in the user's ComfyUI data folder; never uploaded; sharing is an explicit export.
import { api } from "../../../scripts/api.js";

const FILE = "snap/rules.json";
let rules = [];

export async function load() {
  const r = await api.getUserData(FILE);
  if (r.status === 404) return (rules = []);
  if (r.status !== 200) throw new Error(`snap rules unreadable (${r.status})`);
  return (rules = await r.json());
}

export const all = () => rules;

export async function remember(rule) {
  rules = [...rules.filter((x) => !(x.to === rule.to && x.input === rule.input)), rule];
  await api.storeUserData(FILE, rules);
}
