import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * Mirror-backup client. The real work lives in the Rust worker (a filesystem
 * watcher that mirrors the library to each destination in real time); this hook
 * just reflects the backend's config + live status and relays its notices.
 *
 * - `config`   — persisted: { targets: [{ id, dest, folders, pull_in }] }.
 * - `status`   — live: { targets: [{ id, state, last_sync, message, ...counts }] }.
 * - `save`     — persist a new config (triggers an immediate reconcile).
 * - `remirror` — force a destination (or all) back to a perfect mirror.
 *
 * @param {(type: string, message: string) => void} notify - toast sink.
 */
export default function useSync(notify) {
  const [config, setConfig] = useState(null);
  const [status, setStatus] = useState({ targets: [] });
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  // Initial load + live event subscriptions.
  useEffect(() => {
    let alive = true;
    Promise.all([invoke('get_sync_config'), invoke('get_sync_status')])
      .then(([cfg, st]) => {
        if (alive) {
          setConfig(cfg);
          setStatus(st);
        }
      })
      .catch(() => {
        if (alive) setConfig({ targets: [] });
      });

    const unStatus = listen('sync-status', (e) => {
      if (alive) setStatus(e.payload);
    });
    const unNotice = listen('sync-notice', (e) => {
      const { kind, name } = e.payload || {};
      const fn = notifyRef.current;
      if (!fn) return;
      if (kind === 'restored') fn('success', `Restored "${name}" in the backup (library wins)`);
      else if (kind === 'reverted')
        fn('success', `Reverted an edit to "${name}" in the backup (library wins)`);
      else if (kind === 'skipped')
        fn('error', `Couldn't import "${name}" from the backup — unsupported type`);
      else if (kind === 'error') fn('error', `Mirror backup: ${name}`);
    });

    return () => {
      alive = false;
      unStatus.then((f) => f());
      unNotice.then((f) => f());
    };
  }, []);

  const save = useCallback(async (next) => {
    const saved = await invoke('set_sync_config', { config: next });
    setConfig(saved);
    return saved;
  }, []);

  const remirror = useCallback(
    (targetId = null) =>
      invoke('sync_remirror', { targetId }).catch((e) => {
        notifyRef.current?.('error', `Re-mirror failed: ${e}`);
      }),
    [],
  );

  return { config, status, save, remirror };
}
