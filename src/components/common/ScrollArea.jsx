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
 * Pass `orientation="horizontal"` for a row that scrolls sideways (e.g. a
 * horizontal card strip) instead of the default vertical list/column.
 */
export default function ScrollArea({
  as: As = 'div',
  className = '',
  innerClassName = '',
  scrollRef,
  orientation = 'vertical',
  children,
  ...props
}) {
  const horizontal = orientation === 'horizontal';
  const { contentRef, thumb, dragging, active, onThumbMouseDown } = useCustomScrollbar(
    scrollRef,
    horizontal ? 'x' : 'y',
  );
  return (
    <div className={`scroll-area ${horizontal ? 'scroll-area-x' : ''} ${className}`}>
      <As
        ref={contentRef}
        className={`scroll-area-content ${horizontal ? 'scroll-area-content-x' : ''} ${innerClassName}`}
        {...props}
      >
        {children}
      </As>
      <div
        className={`scroll-area-thumb ${horizontal ? 'scroll-area-thumb-x' : ''} ${dragging ? 'dragging' : ''} ${active ? 'active' : ''}`}
        style={
          horizontal
            ? {
                width: thumb.size,
                transform: `translateX(${thumb.offset}px)`,
                opacity: thumb.visible ? undefined : 0,
                pointerEvents: thumb.visible ? undefined : 'none',
              }
            : {
                height: thumb.size,
                transform: `translateY(${thumb.offset}px)`,
                opacity: thumb.visible ? undefined : 0,
                pointerEvents: thumb.visible ? undefined : 'none',
              }
        }
        onMouseDown={onThumbMouseDown}
      />
    </div>
  );
}
