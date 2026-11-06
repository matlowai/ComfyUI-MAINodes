// "Let agents see this tab": one click shares the tab (screen capture of the current tab only), and the `screenshot`
// tool then returns what the person sees, pixels and all (the graph canvas, videos, the Snap view). Nothing is recorded
// or sent anywhere: a frame is taken only when a tool asks, and stopping the share (or closing the tab) ends it.
import { api } from "../../../scripts/api.js";
let stream = null, video = null;
// an agent's own headless page: nobody is there to press the button, so it never shares
export const HEADLESS = /HeadlessChrome/.test(navigator.userAgent);
export const HEADLESS_NOTE = "This is a headless page (an agent's own): nobody presses 'Let agents see' here, and none is needed: screenshot shows this page as Chrome renders it";
// SNAP-R83: whether this tab is in the agents' window, the visible Chrome tools/snap_agent_page.sh manages: the bridge
// finds the tab among that Chrome's DevTools pages when it registers and says so; agents see and drive such a tab
let managedTab = false;
export const managed = () => managedTab;
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const sharing = () => !!stream;
// agents see this tab: its person shares it, or it is the agents' window (screenshot then comes from its Chrome, self())
export const sees = () => managedTab || !!stream;

export async function start() {
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "browser", frameRate: 5 }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include", surfaceSwitching: "exclude" });
  video = Object.assign(document.createElement("video"), { srcObject: stream, muted: true, playsInline: true });
  await video.play();
  stream.getVideoTracks()[0].addEventListener("ended", stop);
  for (const fn of listeners) fn();
}

export function setManaged(on) { if (on === managedTab) return; managedTab = on; for (const fn of listeners) fn(); }

export function stop() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = video = null;
  for (const fn of listeners) fn();
}

// the agents' window as its Chrome renders it: the bridge asks that Chrome's DevTools (snap_agent_page.sh opened it on
// this machine) for a picture of this page, found by its client id (anime dogfood F-A01)
export async function self(maxWidth = 1600) {
  const r = await api.fetchApi("/mainodes/snap/page_shot", { method: "POST", body: JSON.stringify({ client: api.clientId, max_width: maxWidth }) });
  const out = await r.json();
  if (!r.ok) throw new Error(out.error);
  return out;
}

// the current frame as a JPEG, at most `maxWidth` wide
export function frame(maxWidth = 1600, quality = 0.85) {
  if (!video?.videoWidth) throw new Error(HEADLESS ? HEADLESS_NOTE
    : "The person hasn't let agents see this tab: ask them to press 'Let agents see' in Snap's top bar (one click; it shares only this tab)");
  const k = Math.min(1, maxWidth / video.videoWidth);
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(video.videoWidth * k), height: Math.round(video.videoHeight * k) });
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
  return { mimeType: "image/jpeg", data: c.toDataURL("image/jpeg", quality).split(",")[1], width: c.width, height: c.height };
}
