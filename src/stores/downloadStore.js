import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

// Module-level store for download progress that must survive component unmount.
//
// The Rust backend keeps downloading the external CLI tools (ffmpeg / yt-dlp)
// and the multilingual model regardless of which page is mounted, and keeps
// emitting progress events. When that state lived inside ToolsManager / AiPane
// it was lost on navigation: the listener unmounted, the events went unheard,
// and returning to the page showed no progress — leaving it ambiguous whether
// the download had stopped or was still running.
//
// Keeping the state and the event listeners here (module scope) makes them
// persist for the app's lifetime, so progress is uninterrupted across
// navigation. Components read it via `useDownloadStore()`.

let state = {
  toolStatus: {}, // name -> { name, available, source }
  toolProgress: {}, // name -> { downloaded, total } | undefined
  toolDownloading: {}, // name -> true  (per-tool: tools can download concurrently)
  toolError: null, // { tool, message } | null
  modelProgress: null, // { model, file, downloaded, total } | null
  modelDownloading: false,
  modelError: null, // string | null
};

// Immutably drop a key from an object.
function without(obj, key) {
  const next = { ...obj };
  delete next[key];
  return next;
}

const subscribers = new Set();
function notify() {
  state = { ...state }; // fresh reference so useSyncExternalStore sees the change
  subscribers.forEach((cb) => cb());
}
function patch(p) {
  Object.assign(state, p);
  notify();
}

function subscribe(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}
function getSnapshot() {
  return state;
}

/** Subscribe a component to the download store. */
export function useDownloadStore() {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ── Tool status ───────────────────────────────────────────────────────────────
export async function refreshToolStatus() {
  try {
    const list = await invoke('tool_status');
    patch({ toolStatus: Object.fromEntries(list.map((t) => [t.name, t])) });
  } catch {
    /* keep previous status */
  }
}

// ── Persistent event listeners (registered once, even across HMR) ───────────────
// The guard prevents duplicate registration on dev hot-reload, which would
// otherwise double-fire progress/done events.
if (!globalThis.__vividDownloadListenersRegistered) {
  globalThis.__vividDownloadListenersRegistered = true;

  listen('tool-download-progress', ({ payload }) => {
    if (!payload?.tool) return;
    const tool = payload.tool;
    if (payload.error) {
      patch({
        toolError: { tool, message: payload.error },
        toolDownloading: without(state.toolDownloading, tool),
        toolProgress: without(state.toolProgress, tool),
      });
    } else if (payload.done) {
      patch({
        toolProgress: without(state.toolProgress, tool),
        toolDownloading: without(state.toolDownloading, tool),
      });
      refreshToolStatus();
    } else {
      patch({
        toolProgress: {
          ...state.toolProgress,
          [tool]: { downloaded: payload.downloaded, total: payload.total },
        },
      });
    }
  });

  listen('model-download-progress', ({ payload }) => {
    if (payload.error) {
      patch({ modelError: payload.error, modelDownloading: false, modelProgress: null });
      return;
    }
    if (payload.done) {
      patch({ modelDownloading: false, modelProgress: null });
      return;
    }
    patch({
      modelProgress: {
        model: payload.model,
        file: payload.file,
        downloaded: payload.downloaded,
        total: payload.total,
      },
    });
  });
}

// ── Actions ─────────────────────────────────────────────────────────────────────
export async function downloadTool(name) {
  patch({
    toolError: null,
    toolDownloading: { ...state.toolDownloading, [name]: true },
    toolProgress: without(state.toolProgress, name),
  });
  try {
    await invoke('download_tool', { name });
  } catch (e) {
    patch({
      toolError: { tool: name, message: String(e) },
      toolDownloading: without(state.toolDownloading, name),
    });
  } finally {
    refreshToolStatus();
  }
}

export function beginModelDownload() {
  patch({ modelError: null, modelDownloading: true, modelProgress: null });
}
export function endModelDownload() {
  patch({ modelDownloading: false, modelProgress: null });
}
export function failModelDownload(msg) {
  patch({ modelError: msg, modelDownloading: false });
}
