// "Let agents see this tab": one click shares the tab (screen capture of the current tab only), and the `screenshot`
// tool then returns what the person sees, pixels and all (the graph canvas, videos, the Snap view). Nothing is recorded
// or sent anywhere: a frame is taken only when a tool asks, and stopping the share (or closing the tab) ends it.
let stream = null, video = null;
const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
export const sharing = () => !!stream;

export async function start() {
  stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: "browser", frameRate: 5 }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include", surfaceSwitching: "exclude" });
  video = Object.assign(document.createElement("video"), { srcObject: stream, muted: true, playsInline: true });
  await video.play();
  stream.getVideoTracks()[0].addEventListener("ended", stop);
  for (const fn of listeners) fn();
}

export function stop() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = video = null;
  for (const fn of listeners) fn();
}

// the current frame as a JPEG, at most `maxWidth` wide
export function frame(maxWidth = 1600, quality = 0.85) {
  if (!video?.videoWidth) throw new Error("The person hasn't let agents see this tab: ask them to press 'Let agents see' in Snap's top bar (one click; it shares only this tab)");
  const k = Math.min(1, maxWidth / video.videoWidth);
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(video.videoWidth * k), height: Math.round(video.videoHeight * k) });
  c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
  return { mimeType: "image/jpeg", data: c.toDataURL("image/jpeg", quality).split(",")[1], width: c.width, height: c.height };
}
