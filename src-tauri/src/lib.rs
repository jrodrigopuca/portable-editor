use std::path::PathBuf;

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

/// Devuelve el archivo pasado como primer argumento de CLI, si existe.
/// Permite `portable-editor archivo.txt` desde la terminal.
#[tauri::command]
fn cli_file() -> Option<String> {
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
        .invoke_handler(tauri::generate_handler![read_file, write_file, cli_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
