import useCustomScrollbar from '../../hooks/useCustomScrollbar';
import './ScrollArea.css';

/**
 * Drop-in wrapper for a scrollable region that renders its own themed thumb
 * instead of relying on `::-webkit-scrollbar` (see useCustomScrollbar for
 * why that CSS-only approach isn't consistent across Macs).
 *
 * `className` styles the outer box (sizing/flex/layout — whatever the
 * original scrollable element used); `innerClassName` styles the inner
 * scrolling element (padding, per-item rules, etc). Both default to empty so
 * simple cases can pass just one. Pass `scrollRef` if the caller already
 * tracks the scroll element itself (e.g. to save/restore scroll position).
 */
export default function ScrollArea({
  as: As = 'div',
  className = '',
  innerClassName = '',
  scrollRef,
  children,
  ...props
}) {
  const { contentRef, thumb, dragging, active, onThumbMouseDown } = useCustomScrollbar(scrollRef);
  return (
    <div className={`scroll-area ${className}`}>
      <As ref={contentRef} className={`scroll-area-content ${innerClassName}`} {...props}>
        {children}
      </As>
      <div
        className={`scroll-area-thumb ${dragging ? 'dragging' : ''} ${active ? 'active' : ''}`}
        style={{
          height: thumb.height,
          transform: `translateY(${thumb.top}px)`,
          opacity: thumb.visible ? undefined : 0,
          pointerEvents: thumb.visible ? undefined : 'none',
        }}
        onMouseDown={onThumbMouseDown}
      />
    </div>
  );
}
