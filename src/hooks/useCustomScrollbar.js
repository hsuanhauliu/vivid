import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drives a custom, always-themed scrollbar thumb for a scroll container.
 *
 * WebKit only applies `::-webkit-scrollbar` CSS when macOS's "Show scroll
 * bars" setting is Always (classic, always-visible scrollbar). On the
 * default "Automatically based on mouse or trackpad" / "When scrolling"
 * setting, WebKit renders its own native overlay indicator instead and
 * silently ignores all scrollbar CSS — which is why a themed scrollbar can
 * look right on one Mac and revert to the OS default on another. Rendering
 * our own thumb sidesteps that entirely: the native scrollbar is hidden via
 * `.scroll-area-content` (see ScrollArea.css) and this hook drives a plain
 * absolutely-positioned div instead, so the look no longer depends on the
 * viewer's OS setting.
 *
 * @param {React.Ref} [externalRef] - an existing ref to the scroll element to
 *        reuse instead of creating a new one (e.g. a caller that already
 *        tracks scroll position via its own ref). Merged so both keep working.
 * @param {'y'|'x'} [axis] - which scroll axis to track ('y' = vertical,
 *        default; 'x' = horizontal). The returned `thumb` is always
 *        `{ size, offset, visible }` regardless of axis — ScrollArea maps
 *        `size`/`offset` onto width/translateX or height/translateY.
 */
const AUTO_HIDE_MS = 900;

export default function useCustomScrollbar(externalRef, axis = 'y') {
  const ownRef = useRef(null);
  const contentRef = externalRef ?? ownRef;
  const [thumb, setThumb] = useState({ size: 0, offset: 0, visible: false });
  const [dragging, setDragging] = useState(false);
  // Driven by JS (not just CSS :hover) so it auto-hides reliably regardless
  // of hover/pointer quirks on a given device — shown briefly on scroll or
  // drag, then faded back out, like a native overlay scrollbar.
  const [active, setActive] = useState(false);
  const dragState = useRef(null);
  const hideTimer = useRef(null);
  const isX = axis === 'x';

  const wake = useCallback(() => {
    setActive(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(false), AUTO_HIDE_MS);
  }, []);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const measure = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const scrollSize = isX ? el.scrollWidth : el.scrollHeight;
    const clientSize = isX ? el.clientWidth : el.clientHeight;
    const scrollPos = isX ? el.scrollLeft : el.scrollTop;
    if (scrollSize <= clientSize + 1) {
      setThumb((t) => (t.visible ? { size: 0, offset: 0, visible: false } : t));
      return;
    }
    const size = Math.max((clientSize / scrollSize) * clientSize, 24);
    const maxOffset = clientSize - size;
    const maxScroll = scrollSize - clientSize;
    const offset = maxOffset <= 0 || maxScroll <= 0 ? 0 : (scrollPos / maxScroll) * maxOffset;
    setThumb({ size, offset, visible: true });
  }, [contentRef, isX]);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return undefined;
    measure();
    const onScroll = () => {
      measure();
      wake();
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', onScroll);
    };
  }, [measure, wake, contentRef]);

  const onThumbMouseDown = useCallback(
    (e) => {
      const el = contentRef.current;
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      dragState.current = {
        start: isX ? e.clientX : e.clientY,
        startScroll: isX ? el.scrollLeft : el.scrollTop,
        clientSize: isX ? el.clientWidth : el.clientHeight,
        scrollSize: isX ? el.scrollWidth : el.scrollHeight,
      };
      setDragging(true);
      wake();
    },
    [wake, contentRef, isX],
  );

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => {
      const el = contentRef.current;
      const s = dragState.current;
      if (!el || !s) return;
      const thumbSize = Math.max((s.clientSize / s.scrollSize) * s.clientSize, 24);
      const maxOffset = s.clientSize - thumbSize;
      const maxScroll = s.scrollSize - s.clientSize;
      if (maxOffset <= 0 || maxScroll <= 0) return;
      const pos = isX ? e.clientX : e.clientY;
      const ratio = (pos - s.start) / maxOffset;
      if (isX) el.scrollLeft = s.startScroll + ratio * maxScroll;
      else el.scrollTop = s.startScroll + ratio * maxScroll;
    };
    const onUp = () => {
      setDragging(false);
      wake();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [dragging, contentRef, wake, isX]);

  return { contentRef, thumb, dragging, active, onThumbMouseDown };
}
