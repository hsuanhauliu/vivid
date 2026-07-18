import { invoke } from '@tauri-apps/api/core';
import { relaunch } from '@tauri-apps/plugin-process';

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
