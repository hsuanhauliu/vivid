import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Sun, Moon } from 'lucide-react';
import CollectionAvatar from '../../common/CollectionAvatar';
import { SettingsPane, SettingsSection } from './primitives';
import { COLOR_THEMES } from './constants';

export default function AppearancePane({
  title,
  theme,
  onThemeChange,
  colorTheme,
  onColorThemeChange,
  pinnedCollections = [],
  pinnedOrder = [],
  onReorderPins,
  allItems = [],
}) {
  const { t } = useTranslation();
  const [movedId, setMovedId] = useState(null);

  const orderedPinned = (() => {
    const ordered = pinnedOrder
      .map((id) => pinnedCollections.find((g) => g.id === id))
      .filter(Boolean);
    const rest = pinnedCollections.filter((g) => !pinnedOrder.includes(g.id));
    return [...ordered, ...rest];
  })();

  function moveToPosition(idx, pos) {
    const target = Math.max(0, Math.min(orderedPinned.length - 1, pos - 1));
    if (Number.isNaN(target) || target === idx) return;
    const ids = orderedPinned.map((g) => g.id);
    const [moved] = ids.splice(idx, 1);
    ids.splice(target, 0, moved);
    onReorderPins?.(ids);
    setMovedId(moved);
    setTimeout(() => setMovedId((cur) => (cur === moved ? null : cur)), 900);
  }

  return (
    <SettingsPane title={title}>
      <SettingsSection title={t('settings.sections.theme')}>
        <div className="settings-section-body">
          <div className="theme-options">
            <label className={`theme-option ${theme === 'light' ? 'active' : ''}`}>
              <input
                type="radio"
                name="theme"
                value="light"
                checked={theme === 'light'}
                onChange={() => onThemeChange('light')}
              />
              <Sun size={20} strokeWidth={1.5} />
              <span>{t('settings.appearance.light')}</span>
            </label>
            <label className={`theme-option ${theme === 'dark' ? 'active' : ''}`}>
              <input
                type="radio"
                name="theme"
                value="dark"
                checked={theme === 'dark'}
                onChange={() => onThemeChange('dark')}
              />
              <Moon size={20} strokeWidth={1.5} />
              <span>{t('settings.appearance.dark')}</span>
            </label>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.sections.accentColor')}>
        <div className="settings-section-body">
          <div className="color-theme-options">
            {COLOR_THEMES.map(({ value, labelKey, color }) => (
              <button
                key={value}
                className={`color-theme-swatch ${colorTheme === value ? 'active' : ''}`}
                style={{ '--swatch': color }}
                title={t(labelKey)}
                onClick={() => onColorThemeChange(value)}
              >
                <span className="color-theme-dot" />
                <span className="color-theme-label">{t(labelKey)}</span>
              </button>
            ))}
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.sections.pinnedCollections')}>
        <div className="settings-section-body">
          <p className="settings-section-desc">{t('settings.appearance.pinnedDesc')}</p>
          {orderedPinned.length === 0 ? (
            <p className="settings-empty-hint">{t('settings.appearance.noPinned')}</p>
          ) : (
            <div className="watched-folder-list">
              {orderedPinned.map((g, idx) => (
                <div
                  key={g.id}
                  className={`watched-folder-row${movedId === g.id ? ' pinned-reorder-flash' : ''}`}
                >
                  <span className="pinned-reorder-pos">{idx + 1}</span>
                  <CollectionAvatar group={g} allItems={allItems} size={20} radius={5} />
                  <span className="watched-folder-path">{g.name}</span>
                  <input
                    key={`${g.id}-${idx}`}
                    type="number"
                    className="pinned-reorder-input"
                    min={1}
                    max={orderedPinned.length}
                    defaultValue={idx + 1}
                    title={t('settings.appearance.positionTitle')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                    }}
                    onBlur={(e) => {
                      const pos = parseInt(e.target.value, 10);
                      if (pos !== idx + 1) moveToPosition(idx, pos);
                    }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingsSection>
    </SettingsPane>
  );
}
