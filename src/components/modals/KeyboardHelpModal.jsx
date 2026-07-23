import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import Modal from '../common/Modal';
import ScrollArea from '../common/ScrollArea';
import './KeyboardHelpModal.css';

export default function KeyboardHelpModal({ onClose }) {
  const { t } = useTranslation();

  const SECTIONS = [
    {
      title: t('keyboard.general'),
      rows: [
        [t('keyboard.doubleClick'), t('keyboard.doubleClickDesc')],
        [t('keyboard.singleClick'), t('keyboard.singleClickDesc')],
        [t('keyboard.rightClick'), t('keyboard.rightClickDesc')],
      ],
    },
    {
      title: t('keyboard.navigation'),
      rows: [
        ['← / →', t('keyboard.selectPrevNext')],
        ['Enter', t('keyboard.openSelected')],
        ['Escape', t('keyboard.escapeDesc')],
        ['?', t('keyboard.showHelp')],
      ],
    },
    {
      title: t('keyboard.viewer'),
      rows: [
        ['← / →', t('keyboard.prevNextItem')],
        ['Escape', t('keyboard.closeViewer')],
      ],
    },
    {
      title: t('keyboard.audioPlayer'),
      rows: [
        ['Space', t('keyboard.playPause')],
        ['← / →', t('keyboard.seek')],
        ['M', t('keyboard.mute')],
      ],
    },
    {
      title: t('keyboard.videoPlayer'),
      rows: [
        ['Space', t('keyboard.playPause')],
        ['← / →', t('keyboard.seekShort')],
        [', / .', t('keyboard.stepFrame')],
        ['↑ / ↓', t('keyboard.volume')],
        ['M', t('keyboard.mute')],
        ['L', t('keyboard.loop')],
        ['[ / ]', t('keyboard.speed')],
        ['+ / −', t('keyboard.zoom')],
        ['0', t('keyboard.resetView')],
        ['F', t('keyboard.fullscreen')],
      ],
    },
  ];

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <Modal className="kbd-help-modal" header={false}>
      <button className="icon-btn kbd-help-close" onClick={onClose} title="Close (Esc)">
        <X size={16} />
      </button>
      <div className="kbd-help-header">
        <h2 className="modal-title" style={{ margin: 0 }}>
          {t('keyboard.title')}
        </h2>
      </div>
      <ScrollArea className="kbd-help-body" innerClassName="kbd-help-body-inner">
        {SECTIONS.map((sec) => (
          <div key={sec.title} className="kbd-section">
            <p className="kbd-section-title">{sec.title}</p>
            {sec.rows.map(([key, desc]) => (
              <div key={key} className="kbd-row">
                <span className="kbd-key">{key}</span>
                <span className="kbd-desc">{desc}</span>
              </div>
            ))}
          </div>
        ))}
      </ScrollArea>
    </Modal>
  );
}
