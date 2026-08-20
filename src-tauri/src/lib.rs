use serde::Serialize;
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
///
/// Checks size via metadata before reading: an oversized file is rejected
/// without ever being loaded into memory, so it can't hang the webview.
#[tauri::command]
fn read_file(path: String) -> Result<DecodedFile, String> {
    let meta = std::fs::metadata(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    if meta.len() > text_io::MAX_FILE_SIZE_BYTES {
        return Err(text_io::size_limit_error(&path, meta.len()));
    }
    let bytes = std::fs::read(&path).map_err(|e| format!("Could not read {path}: {e}"))?;
    Ok(text_io::decode_file(&bytes))
}

/// Atomic write: temp file in the same directory + rename (atomic on POSIX),
/// so a crash mid-write never leaves the file corrupted. Always writes UTF-8,
/// restoring the given line ending convention (see `text_io::encode_with_eol`).
///
/// Writes through symlinks instead of replacing them: `rename()` on a
/// symlink target replaces the link itself, which would silently disconnect
/// dotfiles managed with Stow/chezmoi/Nix from their real file.
#[tauri::command]
fn write_file(path: String, contents: String, eol: String) -> Result<(), String> {
    let target = resolve_symlink_target(&PathBuf::from(&path));
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

/// If `path` is a symlink, resolves it to the file it ultimately points to.
/// Falls back to `path` itself otherwise: not a symlink, doesn't exist yet
/// (new file), or a broken link (`canonicalize` fails) — in the broken-link
/// case this deliberately replaces the dangling link with a real file rather
/// than erroring out.
fn resolve_symlink_target(path: &Path) -> PathBuf {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
        }
        _ => path.to_path_buf(),
    }
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

/// Builds the File menu (New/Open/Save/Save As), a Help menu (Keyboard
/// Shortcuts, opens the in-app panel; About, with the app version — macOS:
/// app-name menu instead). Deliberately stops there: no Quit (Tauri's
/// PredefinedMenuItem::quit bypasses onCloseRequested and skips the
/// unsaved-changes guard — see docs/ARCHITECTURE.md), no Edit (CodeMirror
/// owns undo/redo/clipboard via its own keymap, not the OS undo manager).
///
/// Each item's accelerator makes the native menu the single owner of that
/// shortcut; the equivalent keys are deliberately absent from the JS keydown
/// handler in `main.ts` to avoid double-firing (e.g. two "Save as" dialogs).
/// Click/keypress handling: `on_menu_event` re-emits the item id as
/// `menu-action`, picked up by `main.ts`.
fn build_menu(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder};
    use tauri::Emitter;

    let new_item = MenuItemBuilder::with_id("new", "New")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let open_item = MenuItemBuilder::with_id("open", "Open…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    let save_item = MenuItemBuilder::with_id("save", "Save")
        .accelerator("CmdOrCtrl+S")
        .build(app)?;
    let save_as_item = MenuItemBuilder::with_id("save_as", "Save As…")
        .accelerator("CmdOrCtrl+Shift+S")
        .build(app)?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(&new_item)
        .item(&open_item)
        .separator()
        .item(&save_item)
        .item(&save_as_item)
        .build()?;

    // Version shown in the About panel comes straight from Cargo.toml at
    // compile time — never goes stale when the version is bumped for a release.
    let about_metadata = tauri::menu::AboutMetadata {
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        ..Default::default()
    };

    let shortcuts_item = MenuItemBuilder::with_id("shortcuts", "Keyboard Shortcuts")
        .accelerator("CmdOrCtrl+/")
        .build(app)?;

    let mut menu_builder = MenuBuilder::new(app);

    // macOS convention: About lives in the app-name menu (leftmost, which is
    // always whatever submenu is added first). Everywhere else it goes in
    // Help instead, alongside Keyboard Shortcuts — Help itself is built the
    // same way on every platform.
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::PredefinedMenuItem;
        let about_item =
            PredefinedMenuItem::about(app, Some("About portable-editor"), Some(about_metadata))?;
        let app_menu = SubmenuBuilder::new(app, "portable-editor")
            .item(&about_item)
            .build()?;
        menu_builder = menu_builder.item(&app_menu);
    }

    menu_builder = menu_builder.item(&file_menu);

    let help_menu = {
        #[cfg(target_os = "macos")]
        {
            SubmenuBuilder::new(app, "Help")
                .item(&shortcuts_item)
                .build()?
        }
        #[cfg(not(target_os = "macos"))]
        {
            use tauri::menu::PredefinedMenuItem;
            let about_item = PredefinedMenuItem::about(
                app,
                Some("About portable-editor"),
                Some(about_metadata),
            )?;
            SubmenuBuilder::new(app, "Help")
                .item(&shortcuts_item)
                .separator()
                .item(&about_item)
                .build()?
        }
    };
    menu_builder = menu_builder.item(&help_menu);

    app.set_menu(menu_builder.build()?)?;

    let handle = app.handle().clone();
    app.on_menu_event(move |_app, event| {
        let _ = handle.emit("menu-action", event.id().0.as_str());
    });

    Ok(())
}

/// A path to open on startup or via "Open with...", plus whether it already
/// exists — `false` means "create a new file here" (e.g. `portable-editor
/// notes.md` where notes.md doesn't exist yet, same as vim/nano/code).
#[derive(Serialize, Clone)]
struct StartupTarget {
    path: String,
    exists: bool,
}

/// Resolves a CLI argument to an absolute path relative to `base_dir`,
/// without requiring the file to exist. Plain `canonicalize()` fails (and
/// used to be silently swallowed here) for a file that doesn't exist yet —
/// the normal "create a new file at this path" flow every terminal editor
/// supports — so this falls back to `std::path::absolute` in that case.
fn resolve_open_arg(base_dir: &Path, arg: &str) -> Option<StartupTarget> {
    let candidate = base_dir.join(arg);
    if let Ok(canon) = candidate.canonicalize() {
        return Some(StartupTarget {
            path: canon.to_string_lossy().into_owned(),
            exists: true,
        });
    }
    let absolute = std::path::absolute(&candidate).ok()?;
    Some(StartupTarget {
        path: absolute.to_string_lossy().into_owned(),
        exists: false,
    })
}

/// File to open on startup: whatever arrived via the OS "Open with..." first
/// (always an existing file — the OS wouldn't hand us one that isn't),
/// otherwise the first CLI argument (`portable-editor file.txt`), which may
/// not exist yet.
#[tauri::command]
fn startup_file(pending: tauri::State<PendingFile>) -> Option<StartupTarget> {
    if let Some(path) = pending.0.lock().unwrap().take() {
        return Some(StartupTarget { path, exists: true });
    }
    let arg = std::env::args().nth(1)?;
    if arg.starts_with('-') {
        return None;
    }
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    resolve_open_arg(&cwd, &arg)
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
                if let Some(target) = resolve_open_arg(Path::new(&cwd), &arg) {
                    let _ = app.emit("open-file", target);
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingFile(Mutex::new(None)))
        .setup(|app| {
            build_menu(app)?;
            Ok(())
        })
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
                    let _ = app.emit("open-file", StartupTarget { path, exists: true });
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
