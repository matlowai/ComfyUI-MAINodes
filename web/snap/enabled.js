// Snap is off until a person turns it on (the operator, 2026-11-12: "default to off for now until its more mature",
// with "a do this to turn on type thing"). Off: no top-bar buttons (Snap, Strategies), no sidebar tab, no Alt+S, none of
// Snap's settings, and Snap's setup does not run, so prompts are queued exactly as stock ComfyUI queues them. The only
// trace is one entry in the Extensions menu and the command palette. The pack's nodes are not affected.
//
// The choice is ComfyUI setting MAINodes.Snap.Enabled (kept with the person's settings, no row of its own). With no
// choice made yet, someone who has opened Snap before stays on, so an update never takes Snap away from a person
// using it; everyone else starts off. "Opened before" is read from their userdata snap/ folder: the profile Snap writes
// on a first visit, a take, a recipe, anything but critiques/_since.json, which older versions wrote on every page load. Opening /?snap is a choice
// to turn it on. ComfyUI imports every .js file of a pack's web folder, so Snap's files are still fetched when it is
// off; none of them registers or runs anything.
import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

export const ENABLED = "MAINodes.Snap.Enabled";
const stored = () => { try { const v = app.extensionManager?.setting?.get(ENABLED); return v === true || v === false ? v : undefined; } catch { return undefined; } };
const usedBefore = () => api.fetchApi("/userdata?dir=snap&recurse=true&split=false").then((r) => (r.ok ? r.json() : []), () => []).then((list) => Array.isArray(list) && list.some((f) => !/(^|\/)critiques\/_since\.json$/.test(String(f))), () => false);
const asked = new URLSearchParams(location.search).has("snap") || new URLSearchParams(location.search).has("room");
const choice = stored();
// read once, as the page loads: what is registered then is what this page has until a person turns Snap on or off
export const snapOn = asked || (choice ?? await usedBefore());
export const save = (on) => app.extensionManager.setting.set(ENABLED, on);
// in an extension's setup (settings are certainly in): write down a choice made for the person, so it is asked once
export const settle = () => { if (stored() !== snapOn && (asked || stored() === undefined)) return save(snapOn); };
export const setting = { id: ENABLED, name: "Snap: on", type: "hidden", defaultValue: null };
