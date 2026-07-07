use std::path::PathBuf;
use std::sync::Mutex;

/// Archivo recibido vía "Abrir con..." del sistema (evento Opened de macOS)
/// antes de que el frontend esté listo para escucharlo.
struct PendingFile(Mutex<Option<String>>);

/// Lee el archivo completo como texto UTF-8.
#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("No se pudo leer {path}: {e}"))
}

/// Escribe el contenido al archivo (crea el archivo si no existe).
#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("No se pudo guardar {path}: {e}"))
}

/// Archivo a abrir al arrancar: primero lo que llegó por "Abrir con..." del
/// sistema, si no el primer argumento de CLI (`portable-editor archivo.txt`).
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
        .plugin(tauri_plugin_dialog::init())
        .manage(PendingFile(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![read_file, write_file, startup_file])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // En macOS, "Abrir con..." no llega por argv sino como evento nativo,
            // tanto al arrancar como con la app ya corriendo.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                use tauri::{Emitter, Manager};
                if let Some(path) = urls.into_iter().filter_map(|u| u.to_file_path().ok()).next()
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
