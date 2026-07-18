import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import App from './App';
import WorkspacePicker from './components/pages/WorkspacePicker';

/**
 * Resolves which workspace to open *before* the real app — and its startup
 * effects, which assume a workspace's DB is already open on the backend —
 * ever mounts. With 0 or 1 registered workspaces there's nothing to choose,
 * so the backend already loaded it during its own `.setup()` (see
 * `initialize_workspace` in lib.rs) and this renders `<App/>` right away.
 * With 2+, the backend deliberately holds off loading anything until this
 * shows a picker and the user actually chooses — the workspace is genuinely
 * not loaded yet, not just hidden behind a confirmation dialog on top of an
 * already-loaded one.
 */
export default function WorkspaceGate() {
  const [state, setState] = useState(null); // null | 'ready' | { workspaces, activeId }

  useEffect(() => {
    (async () => {
      try {
        const registry = await invoke('list_workspaces');

        // One-shot: set right before a relaunch triggered by picking a
        // workspace from within the welcome flow — that relaunch already
        // *is* the user's choice, so this skips immediately re-asking about
        // the same decision and just opens it directly.
        const skipOnce = localStorage.getItem('vivid-skip-workspace-picker-once') === 'true';
        if (skipOnce) localStorage.removeItem('vivid-skip-workspace-picker-once');

        if (registry.workspaces.length <= 1) {
          setState('ready'); // nothing to choose — backend's fast path already loaded it
          return;
        }
        if (skipOnce) {
          try {
            await invoke('open_workspace', { id: registry.active_id });
            setState('ready');
            return;
          } catch (e) {
            // The just-picked workspace's folder vanished between the pick
            // and this relaunch (e.g. an external drive ejected mid-setup)
            // — fall back to the picker instead of getting stuck, so the
            // user can choose something else.
            console.error(e);
          }
        }
        setState({ workspaces: registry.workspaces, activeId: registry.active_id });
      } catch (e) {
        console.error(e);
        setState('ready'); // fail open rather than brick the app on a picker bug
      }
    })();
  }, []);

  // `list_workspaces` is a local file read, so this resolves near-instantly
  // when there's nothing to choose. When a workspace *is* being opened
  // (reconciliation runs synchronously as part of `open_workspace`), the
  // picker's own busy/spinner state covers that wait — this blank frame is
  // only ever visible for the sub-second before that decision is made.
  if (state === null) return null;
  if (state === 'ready') return <App />;

  return (
    <WorkspacePicker
      mode="startup"
      workspaces={state.workspaces}
      runningId={state.activeId}
      onDismiss={() => setState('ready')}
    />
  );
}
