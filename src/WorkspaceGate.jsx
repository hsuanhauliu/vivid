import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import App from './App';
import WorkspacePicker from './components/pages/WorkspacePicker';
import FirstRunWorkspaceChoice from './components/pages/FirstRunWorkspaceChoice';

/**
 * Resolves which workspace to open *before* the real app — and its startup
 * effects, which assume a workspace's DB is already open on the backend —
 * ever mounts. The backend's `.setup()` never eager-loads a workspace (see
 * lib.rs), so this always shows a landing screen first: with 0 registered
 * workspaces (a fresh install — see `WorkspaceRegistry::default()`,
 * deliberately empty rather than auto-seeding Vivid's managed library) it's
 * the first-run choice; with 1 or more it's the picker — shown even for
 * exactly one, since the user might want to add or link another workspace
 * before continuing rather than just re-opening the one they already have.
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
        setState({ workspaces: registry.workspaces, activeId: registry.active_id });
      } catch (e) {
        console.error(e);
        setState('ready'); // fail open rather than brick the app on a picker bug
      }
    })();
  }, []);

  // `list_workspaces` is a local file read, so this resolves near-instantly.
  // The picker's own busy/spinner state covers the wait while a workspace is
  // actually being opened (reconciliation runs synchronously as part of
  // `open_workspace`) — this blank frame is only ever visible for the
  // sub-second before the landing screen itself appears.
  if (state === null) return null;
  if (state === 'ready') return <App />;
  if (state === 'first-run') return <FirstRunWorkspaceChoice onDone={() => setState('ready')} />;

  return (
    <WorkspacePicker
      workspaces={state.workspaces}
      runningId={state.activeId}
      onDismiss={() => setState('ready')}
    />
  );
}
