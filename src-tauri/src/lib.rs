use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;

mod fs_ops;
mod recovery;
mod startup;
mod text_io;
use startup::{resolve_open_arg, PendingFile, StartupTarget};
use text_io::DecodedFile;

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

/// Atomic save (temp + fsync + rename, through symlinks, permissions
/// preserved — see `fs_ops::write_atomic`). Always writes UTF-8, restoring
/// the given line ending convention (see `text_io::encode_with_eol`).
/// Returns the saved file's mtime (ms) so the frontend can record it in the
/// same tick as `doc.dirty = false`.
#[tauri::command]
fn write_file(path: String, contents: String, eol: String) -> Result<u64, String> {
    let bytes = text_io::encode_with_eol(&contents, &eol);
    fs_ops::write_atomic(Path::new(&path), &bytes)
        .map_err(|e| format!("Could not save {path}: {e}"))
}

fn recovery_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("recovery");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Snapshots of ANY dirty buffer land here — including a 0600 secrets
    // file the user happened to edit — outside that file's own directory,
    // so the directory has to be the user's alone. Applied on every call:
    // it also tightens a directory created by an older version.
    let _ = std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700));
    Ok(dir)
}

/// Dumps the current buffer for `path` to a recovery file, overwriting any
/// previous one — a safety net against crashes/force-quits between saves.
/// Not atomic like `write_file`: losing a recovery write mid-crash just means
/// recovering an older snapshot next time, not corrupting anything real.
#[tauri::command]
fn save_recovery(app: tauri::AppHandle, path: String, contents: String) -> Result<(), String> {
    let dir = recovery_dir(&app)?;
    // 0600 from creation, for the same reason recovery_dir() is 0700.
    std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(dir.join(recovery::recovery_key(&path)))
        .and_then(|mut f| f.write_all(contents.as_bytes()))
        .map_err(|e| e.to_string())
}

/// The recovered contents for `path`, if a recovery file exists for it.
#[tauri::command]
fn read_recovery(app: tauri::AppHandle, path: String) -> Result<Option<String>, String> {
    let dir = recovery_dir(&app)?;
    match std::fs::read_to_string(dir.join(recovery::recovery_key(&path))) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Deletes the recovery file for `path`, if any — called after a real save
/// or when the user explicitly discards unsaved changes. Best-effort: a
/// leftover recovery file just means a stale prompt next time, not data loss.
#[tauri::command]
fn clear_recovery(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let dir = recovery_dir(&app)?;
    let _ = std::fs::remove_file(dir.join(recovery::recovery_key(&path)));
    Ok(())
}

/// Prints a plain marker to stdout once the frontend's init() has fully run
/// (file loaded/restored, editor focused). Used only to benchmark startup
/// time from the outside (see docs/RELEASE.md) — a GUI app has no natural
/// "done" exit code the way a CLI command does, so this is the signal a
/// wrapper script waits for. Harmless to ship: it's one stdout line, nothing
/// reads or depends on it at runtime.
#[tauri::command]
fn signal_ready() {
    println!("PORTABLE_EDITOR_READY");
    // stdout is block-buffered (not line-buffered) once it's not a TTY —
    // e.g. redirected to a file by a benchmark script. Without an explicit
    // flush, a `kill -9` (no graceful shutdown) loses this line entirely.
    let _ = std::io::Write::flush(&mut std::io::stdout());
}

/// Mtime in milliseconds; the frontend polls it to detect external changes.
#[tauri::command]
fn file_mtime(path: String) -> Result<u64, String> {
    fs_ops::mtime_ms(Path::new(&path)).map_err(|e| e.to_string())
}

/// Builds the File menu (New/Open/Save/Save As), a macOS-only Edit menu
/// (Cut/Copy/Paste/Select All — see below), and a Help menu: Keyboard
/// Shortcuts (opens the in-app panel) everywhere; macOS also gets "Install
/// CLI Command" (see `install_cli_command`), with About moved to the
/// app-name menu instead (macOS convention) — other platforms get About in
/// Help, since there's no package-manager PATH gap to fix there.
///
/// No Quit item: Tauri's PredefinedMenuItem::quit bypasses onCloseRequested
/// and skips the unsaved-changes guard — see docs/ARCHITECTURE.md. No
/// Undo/Redo in Edit: CodeMirror owns those via its own state-based history,
/// not the OS undo manager.
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

    // Shift+/ (not plain Mod+/) so this doesn't steal CodeMirror's
    // defaultKeymap binding for toggleComment (Mod-/) — a menu accelerator
    // claims the key equivalent before the webview ever sees it.
    let shortcuts_item = MenuItemBuilder::with_id("shortcuts", "Keyboard Shortcuts")
        .accelerator("CmdOrCtrl+Shift+/")
        .build(app)?;

    let mut menu_builder = MenuBuilder::new(app);

    // macOS convention: About lives in the app-name menu (leftmost, which is
    // always whatever submenu is added first). Everywhere else it goes in
    // Help instead, alongside Keyboard Shortcuts.
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

    // macOS only: WKWebView resolves Cmd+C/V/X/A through AppKit's responder
    // chain, which requires a menu item claiming that key equivalent — with
    // no Edit menu at all, those shortcuts never reach the webview, not even
    // for copy/paste within the editor itself. Undo/Redo are deliberately
    // NOT here: CodeMirror owns those via its own state-based history (see
    // module docs above), and wiring PredefinedMenuItem::undo/redo would
    // route through the DOM's native undo instead, fighting CodeMirror's.
    #[cfg(target_os = "macos")]
    {
        use tauri::menu::PredefinedMenuItem;
        let edit_menu = SubmenuBuilder::new(app, "Edit")
            .item(&PredefinedMenuItem::cut(app, None)?)
            .item(&PredefinedMenuItem::copy(app, None)?)
            .item(&PredefinedMenuItem::paste(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::select_all(app, None)?)
            .build()?;
        menu_builder = menu_builder.item(&edit_menu);
    }

    let help_menu = {
        #[cfg(target_os = "macos")]
        {
            let install_cli_item =
                MenuItemBuilder::with_id("install-cli", "Install 'portable-editor' Command")
                    .build(app)?;
            SubmenuBuilder::new(app, "Help")
                .item(&shortcuts_item)
                .separator()
                .item(&install_cli_item)
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

/// File to open on startup: whatever arrived via the OS "Open with..." first
/// (always an existing file — the OS wouldn't hand us one that isn't),
/// otherwise the first CLI argument (`portable-editor file.txt`), which may
/// not exist yet.
#[tauri::command]
fn startup_file(pending: tauri::State<PendingFile>) -> Option<StartupTarget> {
    // Take the slot BEFORE flipping the flag: an `Opened` event racing this
    // call either lands in the slot (and is returned here) or sees the flag
    // and emits — never both, never neither.
    let stashed = pending.slot.lock().unwrap().take();
    pending.frontend_ready.store(true, Ordering::SeqCst);
    if let Some(target) = stashed {
        return Some(target);
    }
    let arg = std::env::args().nth(1)?;
    let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    resolve_open_arg(&cwd, &arg)
}

#[cfg(target_os = "macos")]
const CLI_TARGET: &str = "/usr/local/bin/portable-editor";

/// Symlinks the running app's executable into `/usr/local/bin` so
/// `portable-editor` works from any shell. macOS only — Linux .deb/.rpm
/// packages already put the binary on PATH via the package manager.
///
/// Tries a plain symlink first (works if `/usr/local/bin` is already
/// user-writable, e.g. on a Homebrew-managed Mac); falls back to the native
/// admin-password prompt only if that fails. The exe path is passed to
/// `osascript` as a separate argv entry (not interpolated into the script
/// text) and shell-quoted there via `quoted form of`, so a path containing
/// quotes or other shell metacharacters can't break out of the command run
/// with administrator privileges.
#[tauri::command]
fn install_cli_command() -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        Err(
            "Not needed on this platform — your package manager already put \
             portable-editor on PATH."
                .to_string(),
        )
    }

    #[cfg(target_os = "macos")]
    {
        let exe = std::env::current_exe().map_err(|e| format!("Could not locate the app: {e}"))?;
        let _ = std::fs::create_dir_all("/usr/local/bin");
        if std::os::unix::fs::symlink(&exe, CLI_TARGET).is_ok() {
            return Ok("Installed. Open a new terminal and run: portable-editor".to_string());
        }

        // AlreadyExists is the common re-run case (already installed, or the
        // app moved/updated) — not a permissions problem. If it's our own
        // old symlink, replacing it needs no more privilege than creating it
        // did, so do that instead of prompting for admin on every reinstall.
        // Anything else at CLI_TARGET (a real file, e.g. from some other
        // program) is left alone and falls through to the admin path below,
        // same as before.
        let is_stale_symlink = std::fs::symlink_metadata(CLI_TARGET)
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        if is_stale_symlink
            && std::fs::remove_file(CLI_TARGET).is_ok()
            && std::os::unix::fs::symlink(&exe, CLI_TARGET).is_ok()
        {
            return Ok("Installed. Open a new terminal and run: portable-editor".to_string());
        }

        let script = r#"on run argv
    set exePath to item 1 of argv
    set targetPath to item 2 of argv
    do shell script "mkdir -p /usr/local/bin && ln -sf " & quoted form of exePath & " " & quoted form of targetPath with administrator privileges
end run"#;

        let status = std::process::Command::new("osascript")
            .arg("-e")
            .arg(script)
            .arg(exe.to_string_lossy().as_ref())
            .arg(CLI_TARGET)
            .status()
            .map_err(|e| format!("Could not run osascript: {e}"))?;

        if status.success() {
            Ok("Installed. Open a new terminal and run: portable-editor".to_string())
        } else {
            Err("Installation was cancelled or failed.".to_string())
        }
    }
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
            if let Some(arg) = args.into_iter().nth(1) {
                if let Some(target) = resolve_open_arg(Path::new(&cwd), &arg) {
                    let _ = app.emit("open-file", target);
                }
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingFile::new())
        .setup(|app| {
            build_menu(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            file_mtime,
            startup_file,
            install_cli_command,
            save_recovery,
            read_recovery,
            clear_recovery,
            signal_ready
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // On macOS, "Open with..." does not arrive via argv but as a native
            // event, both at startup and while the app is already running.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                use tauri::{Emitter, Manager};
                // Finder's "Open With" on a multi-selection hands us every
                // URL in one event — portable-editor opens one file at a
                // time by design, so the rest are dropped, but the frontend
                // needs `extra_ignored` to tell the user instead of just
                // silently acting on the first one.
                let mut paths = urls.into_iter().filter_map(|u| u.to_file_path().ok());
                if let Some(path) = paths.next() {
                    let extra_this_event = paths.count();
                    let pending_state = app.state::<PendingFile>();
                    // Emit vs stash vs merge is decided by `frontend_ready`
                    // (trampa #32) — the whole decision lives in
                    // `startup::merge_opened`, under test. Hold the slot
                    // lock across the check so an `Opened` racing
                    // `startup_file()` lands on exactly one side of it.
                    let to_emit = {
                        let mut pending = pending_state.slot.lock().unwrap();
                        startup::merge_opened(
                            &mut pending,
                            pending_state.frontend_ready.load(Ordering::SeqCst),
                            path.to_string_lossy().into_owned(),
                            extra_this_event,
                        )
                    };
                    if let Some(target) = to_emit {
                        // App already running: emit and let openFileQueue
                        // serialize it (trampa #23).
                        let _ = app.emit("open-file", target);
                    }
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
