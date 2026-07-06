import { createPortal } from 'react-dom';
import { Music, Video, Image as ImageIcon } from 'lucide-react';
import { coverSrc } from '../../utils/cover';

const MAX_THUMBS = 5;

function FallbackIcon({ type }) {
  const Icon = type === 'video' ? Video : type === 'audio' ? Music : ImageIcon;
  return (
    <div className="cdrag-fallback">
      <Icon size={18} />
    </div>
  );
}

/**
 * Floating "gathered" pile of the dragged files, pinned to the cursor. The
 * thumbnails play a one-shot gather animation (spread → concentrate at the
 * cursor tip) via the per-thumb `--i` stagger in CSS.
 */
export default function CollectionDragGhost({ drag }) {
  if (!drag) return null;
  const thumbs = drag.items.slice(0, MAX_THUMBS);
  const total = drag.items.length;

  return createPortal(
    <div className="cdrag-ghost" style={{ left: drag.x, top: drag.y }}>
      <div className="cdrag-stack">
        {thumbs.map((item, i) => {
          const src = coverSrc(item);
          return (
            <div
              key={item.id}
              className="cdrag-thumb"
              style={{ '--i': i, zIndex: thumbs.length - i }}
            >
              {src ? (
                <img src={src} alt="" draggable={false} />
              ) : (
                <FallbackIcon type={item.media_type} />
              )}
            </div>
          );
        })}
      </div>
      {total > 1 && <span className="cdrag-count">{total}</span>}
    </div>,
    document.body,
  );
}
