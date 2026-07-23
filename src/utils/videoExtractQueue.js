// Caps how many <video> elements are simultaneously allowed to eagerly
// buffer a full source file for client-side poster-frame extraction
// (VideoThumb's fallback path in MediaCard.jsx). Without this, scrolling a
// library where many videos still lack a cached poster (e.g. right after a
// bulk import, before background thumbnail generation catches up) makes
// every visible card start loading its full original video file at once,
// which is what actually freezes the webview — not backend work.
const MAX_CONCURRENT = 3;
let active = 0;
const waiters = [];

export function acquireExtractSlot() {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

export function releaseExtractSlot() {
  const next = waiters.shift();
  if (next) {
    next();
  } else {
    active = Math.max(0, active - 1);
  }
}
