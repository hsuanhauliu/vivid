import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const AUTO_LOAD_KEY = 'vivid-multilingual-auto-load';

/**
 * Lifecycle for the optional multilingual (semantic search) model: whether it's
 * installed, loaded into memory, and currently (un)loading. Fetches status on
 * mount, auto-loads when the user left it enabled, and stays in sync with the
 * backend's `multilingual-*` events.
 *
 * Returns the status flags plus `toggle(enabled)` (load/unload + persist the
 * auto-load preference) and `download()` (fetch the model, then refresh status).
 */
export default function useMultilingual() {
  const [installed, setInstalled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    invoke('get_multilingual_status')
      .then((s) => {
        setInstalled(s.installed);
        setLoaded(s.loaded);
        setLoading(s.loading);
        // Auto-load if the model is installed and the user had it enabled last session
        if (
          s.installed &&
          !s.loaded &&
          !s.loading &&
          localStorage.getItem(AUTO_LOAD_KEY) === 'true'
        ) {
          setLoading(true);
          invoke('load_multilingual').catch(() => setLoading(false));
        }
      })
      .catch(() => {});

    const uns = [];
    listen('multilingual-ready', () => {
      setLoaded(true);
      setLoading(false);
      setInstalled(true);
    }).then((fn) => uns.push(fn));
    listen('multilingual-not-found', () => {
      setLoading(false);
      setLoaded(false);
    }).then((fn) => uns.push(fn));
    listen('multilingual-error', () => {
      setLoading(false);
    }).then((fn) => uns.push(fn));
    return () => uns.forEach((fn) => fn());
  }, []);

  const toggle = useCallback((enabled) => {
    localStorage.setItem(AUTO_LOAD_KEY, String(enabled));
    if (enabled) {
      setLoading(true);
      invoke('load_multilingual').catch(() => setLoading(false));
    } else {
      invoke('unload_multilingual')
        .then(() => setLoaded(false))
        .catch(console.warn);
    }
  }, []);

  const download = useCallback(async () => {
    await invoke('download_multilingual_model');
    const s = await invoke('get_multilingual_status');
    setInstalled(s.installed);
    setLoaded(s.loaded);
    // Auto-enable on first download so the user doesn't need to flip the toggle manually.
    if (s.installed && !s.loaded) {
      localStorage.setItem(AUTO_LOAD_KEY, 'true');
      setLoading(true);
      invoke('load_multilingual').catch(() => setLoading(false));
    }
  }, []);

  return { installed, loaded, loading, toggle, download };
}
