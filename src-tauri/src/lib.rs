use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

mod text_io;
use text_io::DecodedFile;

/// File received via the OS "Open with..." (macOS Opened event) before the
/// frontend is ready to listen for it.
struct PendingFile(Mutex<Option<String>>);

/// Reads the whole file, detecting its encoding (BOM, else UTF-8, else
/// Windows-1252 fallback) and line ending style. See `text_io`.
#[tauri::command]
fn read_file(path: String) -> Result<DecodedFile, String> {
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    Ok(text_io::decode_file(&bytes))
}

/// Atomic write: temp file in the same directory + rename (atomic on POSIX),
/// so a crash mid-write never leaves the file corrupted. Always writes UTF-8,
/// restoring the given line ending convention (see `text_io::encode_with_eol`).
#[tauri::command]
fn write_file(path: String, contents: String, eol: String) -> Result<(), String> {
    let target = PathBuf::from(&path);
    let tmp = tmp_path(&target);
    let bytes = text_io::encode_with_eol(&contents, &eol);
    std::fs::write(&tmp, &bytes).map_err(|e| format!("Could not save {path}: {e}"))?;
    if let Ok(meta) = std::fs::metadata(&target) {
        let _ = std::fs::set_permissions(&tmp, meta.permissions());
    }
    std::fs::rename(&tmp, &target).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        format!("Could not save {path}: {e}")
    })
}

fn tmp_path(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    target.with_file_name(format!(".{name}.portable-editor.tmp"))
}

/// Mtime in milliseconds; the frontend polls it to detect external changes.
#[tauri::command]
fn file_mtime(path: String) -> Result<u64, String> {
    let modified = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())?;
    Ok(modified
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis() as u64)
}

/// File to open on startup: whatever arrived via the OS "Open with..." first,
/// otherwise the first CLI argument (`portable-editor file.txt`).
#[tauri::command]
fn startup_file(pending: tauri::State<PendingFile>) -> Option<String> {
    if let Some(path) = pending.0.lock().unwrap().take() {
        return Some(path);
    }
    let arg = std::env::args().nth(1)?;
    if arg.starts_with('-') {
        return None;
    }
    PathBuf::from(&arg)
        .canonicalize()
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered before any other plugin: a second invocation
        // focuses the existing window and forwards its file argument.
        .plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            use tauri::{Emitter, Manager};
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            if let Some(arg) = args.into_iter().nth(1).filter(|a| !a.starts_with('-')) {
                if let Ok(path) = Path::new(&cwd).join(arg).canonicalize() {
                    let _ = app.emit("open-file", path.to_string_lossy().into_owned());
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingFile(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            file_mtime,
            startup_file
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // On macOS, "Open with..." does not arrive via argv but as a native
            // event, both at startup and while the app is already running.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                use tauri::{Emitter, Manager};
                if let Some(path) = urls
                    .into_iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .next()
                {
                    let path = path.to_string_lossy().into_owned();
                    *app.state::<PendingFile>().0.lock().unwrap() = Some(path.clone());
                    let _ = app.emit("open-file", path);
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
