import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import App from './App';
import WorkspacePicker from './components/pages/WorkspacePicker';
import FirstRunWorkspaceChoice from './components/pages/FirstRunWorkspaceChoice';

/**
 * Resolves which workspace to open *before* the real app — and its startup
 * effects, which assume a workspace's DB is already open on the backend —
 * ever mounts. With exactly 1 registered workspace there's nothing to
 * choose, so the backend already loaded it during its own `.setup()` (see
 * `initialize_workspace` in lib.rs) and this renders `<App/>` right away.
 * With 0 (a fresh install — see `WorkspaceRegistry::default()`, deliberately
 * empty rather than auto-seeding Vivid's managed library) or 2+, the backend
 * deliberately holds off loading anything until this shows a picker and the
 * user actually chooses — the workspace is genuinely not loaded yet, not
 * just hidden behind a confirmation dialog on top of an already-loaded one.
 */
export default function WorkspaceGate() {
  const [state, setState] = useState(null); // null | 'ready' | 'first-run' | { workspaces, activeId }

  useEffect(() => {
    (async () => {
      try {
        const registry = await invoke('list_workspaces');

        if (registry.workspaces.length === 0) {
          setState('first-run'); // fresh install — nothing registered, nothing to load
          return;
        }
        if (registry.workspaces.length === 1) {
          setState('ready'); // nothing to choose — backend's fast path already loaded it
          return;
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
  if (state === 'first-run') return <FirstRunWorkspaceChoice onDone={() => setState('ready')} />;

  return (
    <WorkspacePicker
      mode="startup"
      workspaces={state.workspaces}
      runningId={state.activeId}
      onDismiss={() => setState('ready')}
    />
  );
}
