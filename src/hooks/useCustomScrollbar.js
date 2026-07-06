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
 */
const AUTO_HIDE_MS = 900;

export default function useCustomScrollbar(externalRef) {
  const ownRef = useRef(null);
  const contentRef = externalRef ?? ownRef;
  const [thumb, setThumb] = useState({ height: 0, top: 0, visible: false });
  const [dragging, setDragging] = useState(false);
  // Driven by JS (not just CSS :hover) so it auto-hides reliably regardless
  // of hover/pointer quirks on a given device — shown briefly on scroll or
  // drag, then faded back out, like a native overlay scrollbar.
  const [active, setActive] = useState(false);
  const dragState = useRef(null);
  const hideTimer = useRef(null);

  const wake = useCallback(() => {
    setActive(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setActive(false), AUTO_HIDE_MS);
  }, []);

  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const measure = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const { scrollHeight, clientHeight, scrollTop } = el;
    if (scrollHeight <= clientHeight + 1) {
      setThumb((t) => (t.visible ? { height: 0, top: 0, visible: false } : t));
      return;
    }
    const height = Math.max((clientHeight / scrollHeight) * clientHeight, 24);
    const maxTop = clientHeight - height;
    const maxScroll = scrollHeight - clientHeight;
    const top = maxTop <= 0 || maxScroll <= 0 ? 0 : (scrollTop / maxScroll) * maxTop;
    setThumb({ height, top, visible: true });
  }, []);

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
        startY: e.clientY,
        startScrollTop: el.scrollTop,
        clientHeight: el.clientHeight,
        scrollHeight: el.scrollHeight,
      };
      setDragging(true);
      wake();
    },
    [wake],
  );

  useEffect(() => {
    if (!dragging) return undefined;
    const onMove = (e) => {
      const el = contentRef.current;
      const s = dragState.current;
      if (!el || !s) return;
      const thumbHeight = Math.max((s.clientHeight / s.scrollHeight) * s.clientHeight, 24);
      const maxTop = s.clientHeight - thumbHeight;
      const maxScroll = s.scrollHeight - s.clientHeight;
      if (maxTop <= 0 || maxScroll <= 0) return;
      const ratio = (e.clientY - s.startY) / maxTop;
      el.scrollTop = s.startScrollTop + ratio * maxScroll;
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
  }, [dragging, contentRef, wake]);

  return { contentRef, thumb, dragging, active, onThumbMouseDown };
}
