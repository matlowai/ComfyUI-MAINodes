// SNAP-R2/R7: saved-video previews wait for dimensions and avoid automatic oversized decoding.
export function playPreview(video) {
  video.snapPreviewWanted = true;
  const play = () => {
    if (!video.snapPreviewWanted) return;
    const large = video.videoWidth > 4096 || video.videoHeight > 2160;
    video.dataset.previewPlayback = large ? 'manual' : 'automatic';
    if (large) { video.controls = true; video.pause(); return; }
    video.play().catch(() => {});
  };
  if (video.readyState >= 1) play();
  else video.onloadedmetadata = play;
}
export function pausePreview(video) {
  video.snapPreviewWanted = false;
  video.pause();
}
