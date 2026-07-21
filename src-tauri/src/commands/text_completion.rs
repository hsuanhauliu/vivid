use serde::Deserialize;
use std::process::Command;
use std::sync::OnceLock;
use tauri::Manager;

#[derive(Deserialize)]
struct HelperComplete {
    completions: Vec<String>,
}

/// Whether the helper binary can actually run `complete` on this machine.
/// Probed once (empty-string round trip) and cached — every keystroke after
/// that just reads the cached bool instead of spawning a process to find out.
static AVAILABLE: OnceLock<bool> = OnceLock::new();

fn probe(app: &tauri::AppHandle) -> bool {
    let helper = super::helper_path(app);
    Command::new(&helper)
        .arg("complete")
        .arg("a")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Cheap, cached check the frontend calls once (e.g. on mount) to decide
/// whether to wire up tab-completion UI at all. Never errors.
#[tauri::command]
pub fn text_completion_available(app: tauri::AppHandle) -> bool {
    *AVAILABLE.get_or_init(|| probe(&app))
}

/// Word completions for `partial` from the system spell-checker (same engine
/// as Notes/TextEdit). Always returns `Ok` — any failure (helper missing,
/// bad output, spell-checker quirk) degrades to an empty list rather than
/// surfacing an error, since a missed suggestion is a non-event to the user.
#[tauri::command]
pub fn get_text_completions(app: tauri::AppHandle, partial: String) -> Vec<String> {
    let partial = partial.trim();
    if partial.is_empty() || !*AVAILABLE.get_or_init(|| probe(&app)) {
        return Vec::new();
    }
    let helper = super::helper_path(&app);
    let output = match Command::new(&helper).arg("complete").arg(partial).output() {
        Ok(o) if o.status.success() => o,
        _ => return Vec::new(),
    };
    serde_json::from_slice::<HelperComplete>(&output.stdout)
        .map(|p| p.completions)
        .unwrap_or_default()
}
