import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import { relaunch } from '@tauri-apps/plugin-process';
import { basenameOf } from './path';

/**
 * Fetch the workspace registry and the workspace this process actually
 * started with, together — every caller that needs one needs the other
 * (the registry's `active_id` may point at a pending, not-yet-applied
 * switch; `runningId` is what's really loaded right now).
 *
 * @returns {Promise<{registry: object, active: object}>}
 */
export async function fetchWorkspaceRegistry() {
  const [registry, active] = await Promise.all([
    invoke('list_workspaces'),
    invoke('get_active_workspace'),
  ]);
  return { registry, active };
}

/**
 * Open the native folder picker for choosing a workspace folder, and suggest
 * a display name from the folder's own basename. Returns `null` if the user
 * cancelled the dialog.
 *
 * @param {string} title - dialog title.
 * @returns {Promise<{path: string, suggestedName: string} | null>}
 */
export async function pickWorkspaceFolder(title) {
  const picked = await open({ directory: true, title });
  if (!picked) return null;
  const path = typeof picked === 'string' ? picked : picked[0];
  return { path, suggestedName: basenameOf(path) };
}

/**
 * Switch the active workspace and apply it. In a bundled app this restarts
 * the process cleanly via `relaunch()`. Under `npm run tauri dev`, though,
 * the Tauri CLI is itself supervising the running binary (rebuilding and
 * relaunching it on file changes, pointing it at the Vite dev server) — the
 * app restarting *itself* collides with that supervision and the window that
 * comes back never reconnects to the dev server, landing on a blank page.
 * There's no clean fix from inside the app for that (the CLI's process
 * management isn't something we control), so in dev mode this just switches
 * the registry and leaves restarting to the developer.
 *
 * @param {string} id - workspace id to switch to.
 * @returns {Promise<{relaunched: boolean}>} whether a relaunch was attempted.
 */
export async function switchWorkspaceAndApply(id) {
  await invoke('switch_workspace', { id });
  if (import.meta.env.DEV) {
    return { relaunched: false };
  }
  await relaunch();
  return { relaunched: true };
}
