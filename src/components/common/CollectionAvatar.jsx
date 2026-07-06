import { resolveCoverItem, coverSrc } from '../../utils/cover';

/**
 * The cover thumbnail for a collection (album/playlist), rendered consistently
 * everywhere it appears: sidebar pins, secondary panel, detail panel, selection
 * bar, context menus, and import pickers.
 *
 * Resolves the collection's cover image and shows it; when there's no image it
 * falls back to the collection's emoji, then a caller-supplied `fallback`, then
 * the first letter of its name. The tinted background uses the collection color.
 *
 * Sizing is driven by `size` (px) and `radius` so a single base style scales to
 * every call site. Extra props (event handlers, `draggable`, `style`, …) pass
 * through to the root element.
 *
 * @param {object}        props.group     - the collection (needs `id`, `name`, `color`, `emoji`).
 * @param {Array}         props.allItems  - the full library item list (to find the cover).
 * @param {number}        [props.size=22] - width/height in px.
 * @param {number|'round'}[props.radius]  - corner radius in px, or 'round' for a circle.
 * @param {boolean}       [props.allowAny]- allow a non-image first member as cover.
 * @param {React.ReactNode}[props.fallback]- shown when there's no image and no emoji.
 */
export default function CollectionAvatar({
  group,
  allItems,
  size = 22,
  radius,
  allowAny = false,
  fallback,
  className = '',
  style,
  ...rest
}) {
  const src = coverSrc(resolveCoverItem(group, allItems, { allowAny }));
  const cornerRadius = radius === 'round' ? '50%' : `${radius ?? Math.round(size * 0.28)}px`;

  return (
    <span
      className={`collection-avatar ${className}`.trim()}
      style={{
        width: size,
        height: size,
        borderRadius: cornerRadius,
        fontSize: Math.max(9, Math.round(size * 0.45)),
        background: src
          ? 'transparent'
          : (group.color === '#6366f1' ? null : group.color) || 'var(--accent)',
        ...style,
      }}
      {...rest}
    >
      {src ? (
        <img src={src} alt="" className="collection-avatar-img" draggable={false} />
      ) : group.emoji ? (
        <span className="collection-avatar-emoji">{group.emoji}</span>
      ) : (
        (fallback ?? group.name?.slice(0, 1).toUpperCase())
      )}
    </span>
  );
}
