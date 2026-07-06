import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Plus,
  FileUp,
  FolderOpen,
  Link,
  ChevronDown,
  Apple,
  Cloud,
  Smartphone,
} from 'lucide-react';
import useDismiss from '../../hooks/useDismiss';
import './ImportMenu.css';

export default function ImportMenu({
  onImport,
  onImportFolder,
  onDownloadURL,
  onShowReceive,
  onShowICloud,
  onShowCloudSync,
  disabled,
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useDismiss(ref, () => setOpen(false), { enabled: open, escape: false });

  function pick(fn) {
    setOpen(false);
    fn();
  }

  return (
    <div className="import-menu-wrap" ref={ref}>
      <button
        className="btn btn-primary icon-btn-add"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={t('import.addMedia')}
      >
        <Plus size={15} />
        <ChevronDown size={11} style={{ marginLeft: -4 }} />
      </button>

      {open && (
        <div className="import-menu-dropdown">
          <button className="import-menu-item" onClick={() => pick(onImport)}>
            <FileUp size={14} />
            {t('import.importFiles')}
          </button>
          <button className="import-menu-item" onClick={() => pick(onImportFolder)}>
            <FolderOpen size={14} />
            {t('import.importFolder')}
          </button>
          <button className="import-menu-item" onClick={() => pick(onDownloadURL)}>
            <Link size={14} />
            {t('import.downloadUrl')}
          </button>
          <button className="import-menu-item" onClick={() => pick(onShowReceive)}>
            <Smartphone size={14} />
            {t('import.receiveFromPhone')}
          </button>
          <div className="import-menu-sep" />
          <button className="import-menu-item" onClick={() => pick(onShowICloud)}>
            <Apple size={14} />
            {t('import.fromICloud')}
          </button>
          <button className="import-menu-item" onClick={() => pick(onShowCloudSync)}>
            <Cloud size={14} />
            {t('import.fromGooglePhotos')}
          </button>
        </div>
      )}
    </div>
  );
}
