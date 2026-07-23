import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { open, message as dialogMessage } from '@tauri-apps/plugin-dialog';
import {
  RefreshCw,
  FolderPlus,
  Trash2,
  FolderOpen,
  Clock,
  History,
  Search,
  Loader,
} from 'lucide-react';
import Select from '../../common/Select';
import { SettingsPane, SettingsSection, SettingRow, ToggleSwitch } from './primitives';
import WorkspaceSection from './WorkspaceSection';
import { RETENTION_OPTIONS } from './constants';

export default function LibraryPane({
  title,
  searchHistoryEnabled,
  onSearchHistoryToggle,
  watchedFolders,
  onWatchedFoldersChange,
  trashRetentionDays,
  onTrashRetentionChange,
  showMoodBar,
  onShowMoodBarChange,
  showSidebarCounts,
  onShowSidebarCountsChange,
  aiEnabled,
  onNavigateToAI,
  syncConfig,
  syncStatus,
  onSaveSyncConfig,
  onRemirror,
  diskFolders = [],
  onRequestConfirm,
}) {
  const { t } = useTranslation();

  const MAX_TARGETS = 3;
  const targets = syncConfig?.targets ?? [];
  const statusById = Object.fromEntries((syncStatus?.targets ?? []).map((s) => [s.id, s]));
  const [draft, setDraft] = useState(null);
  const [folderSearch, setFolderSearch] = useState('');

  const topFolders = (diskFolders ?? [])
    .filter((f) => !f.rel_path.includes('/'))
    .sort((a, b) => a.rel_path.localeCompare(b.rel_path));
  const allRels = topFolders.map((f) => f.rel_path);
  const filteredFolders = topFolders.filter((f) =>
    f.name.toLowerCase().includes(folderSearch.trim().toLowerCase()),
  );

  const selectedFolderNames = (folders) =>
    !folders || folders.length === 0
      ? topFolders.map((f) => f.name)
      : topFolders.filter((f) => folders.includes(f.rel_path)).map((f) => f.name);

  async function pickDraftDest() {
    const picked = await open({ directory: true, title: t('settings.sync.chooseTitle') });
    if (!picked) return;
    const path = typeof picked === 'string' ? picked : picked[0];
    if (targets.some((tg) => tg.dest === path)) {
      await dialogMessage(t('settings.sync.duplicateDest'), { kind: 'warning' });
      return;
    }
    setDraft((d) => ({ ...d, dest: path }));
  }

  function toggleDraftFolder(relPath) {
    setDraft((d) => ({
      ...d,
      folders: d.folders.includes(relPath)
        ? d.folders.filter((r) => r !== relPath)
        : [...d.folders, relPath],
    }));
  }

  const draftSelected = (relPath) => !!draft && draft.folders.includes(relPath);
  const draftAllSelected =
    !!draft && allRels.length > 0 && allRels.every((r) => draft.folders.includes(r));
  const draftNoneSelected = !!draft && draft.folders.length === 0;

  async function commitDraft() {
    const folders = draftAllSelected ? [] : draft.folders;
    const target = { id: crypto.randomUUID(), dest: draft.dest, folders, pull_in: !!draft.pull_in };
    await onSaveSyncConfig?.({ targets: [...targets, target] });
    setDraft(null);
  }

  async function enableDraft() {
    if (!draft?.dest) return;
    if (topFolders.length > 0 && draft.folders.length === 0) return;
    let nonEmpty = false;
    try {
      nonEmpty = ((await invoke('list_dir_names', { path: draft.dest })) ?? []).length > 0;
    } catch {
      /* unreadable → treat as empty */
    }
    if (nonEmpty) {
      onRequestConfirm?.({
        title: t('settings.sync.nonEmptyTitle'),
        message: t('settings.sync.nonEmptyWarn'),
        confirmLabel: t('settings.sync.enableSync'),
        onConfirm: async () => {
          await commitDraft();
          onRequestConfirm(null);
        },
      });
      return;
    }
    await commitDraft();
  }

  function deleteTarget(id) {
    onRequestConfirm?.({
      title: t('settings.sync.deleteTitle'),
      message: t('settings.sync.deleteConfirm'),
      confirmLabel: t('settings.sync.delete'),
      onConfirm: async () => {
        await onSaveSyncConfig?.({ targets: targets.filter((tg) => tg.id !== id) });
        onRequestConfirm(null);
      },
    });
  }

  return (
    <SettingsPane title={title}>
      <WorkspaceSection onRequestConfirm={onRequestConfirm} />

      <SettingsSection title={t('settings.sections.libraryView')}>
        <SettingRow
          label={t('settings.general.moodBar')}
          desc={
            !aiEnabled ? (
              <>
                {t('settings.general.moodBarRequiresAI')}{' '}
                <button className="settings-inline-link" onClick={onNavigateToAI}>
                  {t('settings.general.goToAI')}
                </button>
              </>
            ) : (
              t('settings.general.moodBarDesc')
            )
          }
        >
          <ToggleSwitch
            on={showMoodBar && aiEnabled}
            onToggle={onShowMoodBarChange}
            disabled={!aiEnabled}
            title={!aiEnabled ? 'Download and enable Visual AI first' : undefined}
          />
        </SettingRow>
        <SettingRow
          label={t('settings.general.sidebarCounts')}
          desc={t('settings.general.sidebarCountsDesc')}
        >
          <ToggleSwitch on={showSidebarCounts} onToggle={onShowSidebarCountsChange} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings.sections.fileSync')}>
        <div className="settings-section-body">
          <p className="settings-section-desc">{t('settings.sync.desc', { max: MAX_TARGETS })}</p>

          {targets.length > 0 && (
            <div className="sync-target-list">
              {targets.map((tg) => {
                const st = statusById[tg.id] ?? { state: 'idle' };
                const names = selectedFolderNames(tg.folders);
                const allFolders = !tg.folders || tg.folders.length === 0;
                return (
                  <div key={tg.id} className="sync-target-row">
                    <div className="sync-target-row-head">
                      <FolderOpen size={15} className="settings-row-icon sync-target-row-icon" />
                      <span className="sync-target-dest" title={tg.dest}>
                        {tg.dest}
                      </span>
                      <span className={`sync-status-pill sync-status-${st.state}`}>
                        {st.state === 'syncing' && (
                          <Loader size={11} className="settings-indexing-spin" />
                        )}
                        {t(`settings.sync.state.${st.state}`)}
                      </span>
                      <div className="sync-target-row-actions">
                        <button
                          className="icon-btn"
                          title={t('settings.sync.remirrorBtn')}
                          onClick={() => onRemirror(tg.id)}
                          disabled={st.state === 'syncing' || st.state === 'offline'}
                        >
                          <RefreshCw size={14} />
                        </button>
                        <button
                          className="icon-btn"
                          title={t('settings.sync.delete')}
                          onClick={() => deleteTarget(tg.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    <div className="sync-target-row-body">
                      <div className="sync-target-row-meta">
                        {st.state === 'offline'
                          ? t('settings.sync.statusOffline')
                          : st.state === 'error'
                            ? st.message || t('settings.sync.statusError')
                            : st.last_sync
                              ? t('settings.sync.lastSync', {
                                  time: new Date(st.last_sync).toLocaleString(),
                                })
                              : t('settings.sync.statusIdle')}
                      </div>
                      <div className="sync-folder-chips">
                        {allFolders ? (
                          <span className="sync-folder-chip">{t('settings.sync.allFolders')}</span>
                        ) : (
                          names.map((n) => (
                            <span key={n} className="sync-folder-chip">
                              {n}
                            </span>
                          ))
                        )}
                        {tg.pull_in && (
                          <span className="sync-folder-chip sync-chip-accent">
                            {t('settings.sync.pullInChip')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {draft && (
            <div className="sync-draft">
              <div className="sync-draft-field">
                <div className="sync-draft-field-text">
                  <span className="sync-draft-label">{t('settings.sync.destination')}</span>
                  <span className="sync-draft-value">
                    {draft.dest || t('settings.sync.noDestination')}
                  </span>
                </div>
                <button
                  className="btn btn-secondary"
                  style={{ flexShrink: 0 }}
                  onClick={pickDraftDest}
                >
                  <FolderOpen size={13} />{' '}
                  {draft.dest ? t('settings.sync.changeFolder') : t('settings.sync.chooseFolder')}
                </button>
              </div>

              {draft.dest && (
                <>
                  <div className="sync-draft-field">
                    <div className="sync-draft-field-text">
                      <span className="sync-draft-label">{t('settings.sync.pullIn')}</span>
                      <span className="sync-draft-desc">{t('settings.sync.pullInDesc')}</span>
                    </div>
                    <ToggleSwitch
                      on={!!draft.pull_in}
                      onToggle={() => setDraft((d) => ({ ...d, pull_in: !d.pull_in }))}
                      style={{ flexShrink: 0 }}
                    />
                  </div>

                  {topFolders.length > 0 && (
                    <div className="sync-draft-field-col">
                      <span className="sync-draft-label">{t('settings.sync.foldersLabel')}</span>
                      <div className="sync-folder-picker">
                        <div className="sync-folder-picker-head">
                          <div className="sync-folder-search">
                            <Search size={13} />
                            <input
                              type="text"
                              placeholder={t('settings.sync.searchFolders')}
                              value={folderSearch}
                              onChange={(e) => setFolderSearch(e.target.value)}
                            />
                          </div>
                          <div className="sync-folder-bulk">
                            <button
                              className="settings-inline-link"
                              onClick={() => setDraft((d) => ({ ...d, folders: [...allRels] }))}
                              disabled={draftAllSelected}
                            >
                              {t('settings.sync.selectAll')}
                            </button>
                            <button
                              className="settings-inline-link"
                              onClick={() => setDraft((d) => ({ ...d, folders: [] }))}
                              disabled={draftNoneSelected}
                            >
                              {t('settings.sync.deselectAll')}
                            </button>
                          </div>
                        </div>
                        <div className="sync-folder-picker-list">
                          {filteredFolders.map((f) => (
                            <label key={f.id} className="sync-folder-row">
                              <input
                                type="checkbox"
                                checked={draftSelected(f.rel_path)}
                                onChange={() => toggleDraftFolder(f.rel_path)}
                              />
                              <FolderOpen size={13} className="settings-row-icon" />
                              <span className="sync-folder-name">{f.name}</span>
                            </label>
                          ))}
                          {filteredFolders.length === 0 && (
                            <p className="sync-folder-empty">{t('settings.sync.noFoldersMatch')}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="sync-draft-actions">
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    setDraft(null);
                    setFolderSearch('');
                  }}
                >
                  {t('settings.sync.cancel')}
                </button>
                <button
                  className="btn btn-primary"
                  onClick={enableDraft}
                  disabled={!draft.dest || (topFolders.length > 0 && draftNoneSelected)}
                >
                  {t('settings.sync.enableSync')}
                </button>
              </div>
            </div>
          )}

          {!draft && targets.length < MAX_TARGETS && (
            <button
              className="btn btn-secondary"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => {
                setFolderSearch('');
                setDraft({ dest: null, folders: [...allRels], pull_in: false });
              }}
            >
              <FolderPlus size={13} style={{ marginRight: 4 }} />
              {t('settings.sync.addDestination')}
            </button>
          )}
          {!draft && targets.length >= MAX_TARGETS && (
            <p style={{ fontSize: 12, color: 'var(--text-dim)', fontStyle: 'italic', margin: 0 }}>
              {t('settings.sync.maxReached', { max: MAX_TARGETS })}
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.sections.watchedFolders')}>
        <div className="settings-section-body">
          <p className="settings-section-desc">{t('settings.library.watchedFoldersDesc')}</p>
          {(watchedFolders ?? []).length > 0 && (
            <div className="watched-folder-list">
              {(watchedFolders ?? []).map((wf) => (
                <div key={wf} className="watched-folder-row">
                  <FolderOpen size={14} className="settings-row-icon" />
                  <span className="watched-folder-path">{wf}</span>
                  <button
                    className="icon-btn"
                    title={t('settings.library.removeFolder')}
                    onClick={() =>
                      onRequestConfirm?.({
                        title: t('settings.library.removeFolderTitle'),
                        message: t('settings.library.removeFolderConfirm', { folder: wf }),
                        confirmLabel: t('settings.library.removeFolder'),
                        onConfirm: () => {
                          onWatchedFoldersChange((watchedFolders ?? []).filter((f) => f !== wf));
                          onRequestConfirm(null);
                        },
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <button
            className="btn btn-secondary"
            style={{ alignSelf: 'flex-start' }}
            onClick={async () => {
              const dir = await open({ directory: true, multiple: false });
              if (dir && !(watchedFolders ?? []).includes(dir)) {
                onWatchedFoldersChange([...(watchedFolders ?? []), dir]);
              }
            }}
          >
            <FolderPlus size={13} style={{ marginRight: 4 }} />
            {t('settings.library.addFolder')}
          </button>
        </div>
      </SettingsSection>

      <SettingsSection title={t('settings.sections.locationSearch')}>
        <SettingRow
          icon={History}
          label={t('settings.library.searchHistory')}
          desc={t('settings.library.searchHistoryDesc')}
        >
          <ToggleSwitch on={searchHistoryEnabled} onToggle={onSearchHistoryToggle} />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title={t('settings.sections.trash')}>
        <SettingRow
          icon={Clock}
          label={t('settings.library.autoDelete')}
          desc={t('settings.library.autoDeleteDesc')}
        >
          <Select
            ariaLabel={t('settings.library.autoDelete')}
            menuAlign="right"
            value={trashRetentionDays}
            onChange={onTrashRetentionChange}
            options={[
              ...RETENTION_OPTIONS.map((d) => ({
                value: d,
                label: t('settings.library.retentionDays', { count: d }),
              })),
              { value: 0, label: t('settings.library.retentionNever') },
            ]}
          />
        </SettingRow>
      </SettingsSection>
    </SettingsPane>
  );
}
