// Shared math for "zoom to cursor + clamp to frame" image viewers
// (FileViewer, ImageEditorPage). Assumes a CSS transform of the form
// `translate(pan.x, pan.y) ...scale/rotate...` — translate outermost so
// pan always moves the content by a fixed number of screen pixels,
// regardless of any rotation/flip applied inside it.

// The transform's pivot (its own untransformed center) stays at a fixed
// screen position across zoom levels — only `pan` moves it. Given the
// element's *current* (already-transformed) bounding rect and pan, this
// recovers that fixed screen point.
export function transformOrigin(rect, pan) {
  return {
    x: rect.left + rect.width / 2 - pan.x,
    y: rect.top + rect.height / 2 - pan.y,
  };
}

// New pan so the point under (clientX, clientY) stays visually fixed while
// scale changes from oldScale to newScale.
export function panForZoomAtPoint(clientX, clientY, origin, oldScale, newScale, oldPan) {
  const dx = clientX - origin.x;
  const dy = clientY - origin.y;
  const ratio = newScale / oldScale;
  return {
    x: dx + (oldPan.x - dx) * ratio,
    y: dy + (oldPan.y - dy) * ratio,
  };
}

// Clamp a pan offset so a box of natural size (contentW × contentH), scaled
// by `scale`, never leaves a container of size (containerW × containerH) —
// content can be panned right up to its edge, but never past it.
export function clampPan(pan, scale, contentW, contentH, containerW, containerH) {
  const maxX = Math.max(0, (contentW * scale - containerW) / 2);
  const maxY = Math.max(0, (contentH * scale - containerH) / 2);
  return {
    x: Math.max(-maxX, Math.min(maxX, pan.x)),
    y: Math.max(-maxY, Math.min(maxY, pan.y)),
  };
}
