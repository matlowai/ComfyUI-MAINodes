// The right dock's decisions, pure so they are tested without a page: which tab the right column shows, and the Room's
// layout preference (docked or floating, and the floating panel's place) read from and merged into its one stored value.
// SNAP-R285 the right dock: Inspector | Conversation, a selection shows the Inspector unless the Conversation is pinned ·
// SNAP-R70 the Room docks beside the project by default and pops out as the movable panel · see docs/snap/SNAP_RULES.md

export const LAYOUT_KEY = "MAINodes.Snap.WorkspaceLayout"; // {left, top, width, height, userPosition, docked}
export const PIN_KEY = "MAINodes.Snap.DockPinned"; // "1" keeps the Conversation tab showing when a brick is selected
export const DOCK_MIN_HOST = 1100; // below this host width the Room always floats
export const DOCK_MIN_W = 420, DOCK_OPEN_W = 480; // the column's least width showing the Conversation; its width when the Room opens it

// selected: the Inspector has something to show (a brick in panel mode, or a recipe note); roomOpen: the Room is open in
// the dock; pinned: the Conversation tab is pinned; last: the tab showing now; cause: what just happened ("room-open",
// "room-show", "room-close", "select", "deselect", "click-inspector", "click-conversation", or null for a re-read).
// A person's tab click wins until the next cause; with nothing to show the column closes (null)
export function dockTab({ selected = false, roomOpen = false, pinned = false, last = null, cause = null } = {}) {
  if (!selected && !roomOpen) return null;
  if (!selected) return "conversation";
  if (!roomOpen) return "inspector";
  if (cause === "room-open" || cause === "room-show" || cause === "click-conversation") return "conversation";
  if (cause === "click-inspector") return "inspector";
  if (cause === "select") return pinned ? "conversation" : "inspector";
  return last === "inspector" || last === "conversation" ? last : pinned ? "conversation" : "inspector";
}

// the stored layout, whatever an older version or a hand left there: docked defaults to true; the floating place only
// when all four numbers are there (an older value without `docked` keeps its place and docks)
export function readLayout(text) {
  let v = null;
  try { v = JSON.parse(text); } catch { v = null; }
  if (!v || typeof v !== "object" || Array.isArray(v)) v = {};
  const floating = ["left", "top", "width", "height"].every((k) => Number.isFinite(v[k])) ? { left: v.left, top: v.top, width: v.width, height: v.height } : null;
  return { docked: v.docked !== false, floating, userPosition: floating ? v.userPosition === true : false };
}

// the stored value with `patch` laid over it: a floating move never drops `docked`, a Pop out never drops the place
export function mergeLayout(text, patch) {
  const was = readLayout(text);
  const out = { ...(was.floating ?? {}), userPosition: was.userPosition, docked: was.docked, ...patch };
  if (!was.floating && !["left", "top", "width", "height"].every((k) => Number.isFinite(out[k]))) { for (const k of ["left", "top", "width", "height", "userPosition"]) delete out[k]; }
  return JSON.stringify(out);
}
