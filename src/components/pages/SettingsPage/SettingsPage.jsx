import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import GeneralPane from './GeneralPane';
import AppearancePane from './AppearancePane';
import LibraryPane from './LibraryPane';
import AiPane from './AiPane';
import AboutPane from './AboutPane';
import { TABS } from './constants';
import './SettingsPage.css';

export default function SettingsPage({
  theme,
  onThemeChange,
  colorTheme,
  onColorThemeChange,
  searchHistoryEnabled,
  onSearchHistoryToggle,
  watchedFolders,
  onWatchedFoldersChange,
  trashRetentionDays,
  onTrashRetentionChange,
  multilingualInstalled,
  multilingualLoaded,
  multilingualLoading,
  onMultilingualToggle,
  onDownloadMultilingual,
  onIndexLibrary,
  indexing,
  homePage,
  onHomePageChange,
  showMoodBar,
  onShowMoodBarChange,
  showSidebarCounts,
  onShowSidebarCountsChange,
  syncConfig,
  syncStatus,
  onSaveSyncConfig,
  onRemirror,
  diskFolders = [],
  onRequestConfirm,
  onViewSystemMessages,
  onViewLog,
  onReplayWelcome,
  pinnedCollections = [],
  pinnedOrder = [],
  onReorderPins,
  allItems = [],
}) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('general');

  return (
    <div className="settings-page">
      <nav className="settings-sidebar">
        <div className="settings-sidebar-header">{t('settings.title')}</div>
        {TABS.map(({ id, labelKey, icon: Icon }) => (
          <button
            key={id}
            className={`settings-nav-item ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            <span className="settings-nav-icon">
              <Icon size={15} />
            </span>
            <span className="settings-nav-label">{t(labelKey)}</span>
          </button>
        ))}
      </nav>

      <div className="settings-content">
        <div className="settings-body">
          {activeTab === 'general' && (
            <GeneralPane
              title={t('settings.tabs.general')}
              homePage={homePage}
              onHomePageChange={onHomePageChange}
              onViewSystemMessages={onViewSystemMessages}
              onViewLog={onViewLog}
              onReplayWelcome={onReplayWelcome}
            />
          )}
          {activeTab === 'appearance' && (
            <AppearancePane
              title={t('settings.tabs.appearance')}
              theme={theme}
              onThemeChange={onThemeChange}
              colorTheme={colorTheme ?? 'blue'}
              onColorThemeChange={onColorThemeChange}
              pinnedCollections={pinnedCollections}
              pinnedOrder={pinnedOrder}
              onReorderPins={onReorderPins}
              allItems={allItems}
            />
          )}
          {activeTab === 'library' && (
            <LibraryPane
              title={t('settings.tabs.library')}
              searchHistoryEnabled={searchHistoryEnabled}
              onSearchHistoryToggle={onSearchHistoryToggle}
              watchedFolders={watchedFolders}
              onWatchedFoldersChange={onWatchedFoldersChange}
              trashRetentionDays={trashRetentionDays}
              onTrashRetentionChange={onTrashRetentionChange}
              showMoodBar={showMoodBar}
              onShowMoodBarChange={onShowMoodBarChange}
              showSidebarCounts={showSidebarCounts}
              onShowSidebarCountsChange={onShowSidebarCountsChange}
              aiEnabled={multilingualLoaded}
              onNavigateToAI={() => setActiveTab('ai')}
              syncConfig={syncConfig}
              syncStatus={syncStatus}
              onSaveSyncConfig={onSaveSyncConfig}
              onRemirror={onRemirror}
              diskFolders={diskFolders}
              onRequestConfirm={onRequestConfirm}
            />
          )}
          {activeTab === 'ai' && (
            <AiPane
              title={t('settings.tabs.ai')}
              multilingualInstalled={multilingualInstalled}
              multilingualLoaded={multilingualLoaded}
              multilingualLoading={multilingualLoading}
              onMultilingualToggle={onMultilingualToggle}
              onDownloadMultilingual={onDownloadMultilingual}
              onIndexLibrary={onIndexLibrary}
              indexing={indexing}
            />
          )}
          {activeTab === 'about' && <AboutPane />}
        </div>
      </div>
    </div>
  );
}
