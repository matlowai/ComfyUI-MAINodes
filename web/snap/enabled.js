// One switch for all of Snap in ComfyUI (2026-11-12, a tester's ask: "disable the Snap feature ... remove all buttons
// on the topbar and sidebar"). Off: no top-bar buttons (Snap, Strategies), no sidebar tab, no Alt+S, and Snap's setup
// does not run, so prompts are queued exactly as stock ComfyUI queues them. The pack's nodes are not affected.
// Top-bar buttons and keybindings are fixed when an extension registers, so the switch is read once, as the page loads:
// from ComfyUI's settings when they are in, otherwise from this browser's copy of the last value. A change takes a reload.
import { app } from "../../../scripts/app.js";

export const ENABLED = "MAINodes.Snap.Enabled";
const stored = () => { try { return app.extensionManager?.setting?.get(ENABLED); } catch { return undefined; } };
const local = () => { try { return localStorage.getItem(ENABLED); } catch { return null; } };
const keep = (v) => { try { localStorage.setItem(ENABLED, String(v !== false)); } catch { /* private mode: the setting still holds */ } };
const first = stored();
export const snapOn = first !== undefined && first !== null ? first !== false : local() !== "false";
// once settings are certainly in (an extension's setup): true when the page must be reloaded to match the setting
export function settle() { const now = stored() !== false; keep(now); return now !== snapOn; }
export const setting = { id: ENABLED, category: ["MAINodes", "Snap", "Enabled"], name: "Snap: show it in ComfyUI (top bar buttons, sidebar tab, Alt+S)", type: "boolean", defaultValue: true,
  tooltip: "Off: Snap and Strategies leave the top bar and the sidebar, Alt+S does nothing, and Snap adds nothing to the prompts you queue. The pack's nodes keep working. Reload the page after changing this.",
  onChange: (v, old) => { keep(v); if (old !== undefined && (v !== false) !== snapOn) app.extensionManager?.toast?.add({ severity: "info", summary: "Snap", detail: `Reload the page to turn Snap ${v === false ? "off" : "on"}.`, life: 6000 }); } };
export const offNote = () => app.extensionManager?.toast?.add({ severity: "info", summary: "Snap is off", detail: "Turn it on in Settings › MAINodes › Snap, then reload the page.", life: 6000 });
