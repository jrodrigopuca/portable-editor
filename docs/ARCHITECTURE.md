# Arquitectura — portable-editor

Documento de referencia para mantener el proyecto. Si vas a tocar código, leé primero esto: acá están las decisiones, los invariantes y las trampas que no son obvias leyendo el código.

## Identidad del producto

Editor de escritorio (Linux/macOS) de **un archivo a la vez**. Liviano, arranca rápido, y lo suficientemente potente para uso diario de un dev. La identidad es ser mini: **no** se agregan tabs multi-archivo, árbol de archivos, LSP/autocompletado, git integrado ni sistema de plugins. Cualquier feature nueva se evalúa contra esa identidad.

Idiomas: **código, comentarios y strings de UI en inglés; documentación en español.**

## Stack y capas

```
┌────────────────────────────────────────────────┐
│ Frontend (webview)                             │
│   TypeScript vanilla + Vite                    │
│   CodeMirror 6 (motor de edición)              │
├────────────── IPC (invoke/events) ─────────────┤
│ Backend nativo (Rust)                          │
│   Tauri 2 + plugins: dialog, single-instance   │
│   IO de archivos, mtime, argv, eventos del OS  │
└────────────────────────────────────────────────┘
```

- **Sin frameworks de UI** (React, etc.): la UI es un editor y una status bar; no se justifica.
- El frontend nunca toca el filesystem directamente: todo pasa por comandos Rust.

## Archivos

| Archivo                              | Responsabilidad                                                        |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `src/main.ts`                        | Estado del documento, acciones open/save, recientes, atajos, wiring UI |
| `src/editor.ts`                      | CodeMirror encapsulado tras `EditorHandle`; único módulo que importa CodeMirror |
| `src/themes.ts`                      | Registro de temas (`THEMES`), paletas y `buildTheme()`                 |
| `src/styles.css`                     | Layout, status bar, variables CSS de fuente                            |
| `src-tauri/src/lib.rs`               | Comandos IPC, plugins, evento Opened de macOS                          |
| `src-tauri/src/main.rs`              | Entry point (no tocar, solo llama a `lib.rs`)                          |
| `src-tauri/tauri.conf.json`          | Ventana, bundle, asociaciones de archivo                               |
| `src-tauri/capabilities/default.json`| Permisos IPC del webview                                                |

## Superficie IPC

### Comandos (frontend → Rust, vía `invoke`)

| Comando        | Firma                                  | Notas                                                       |
| -------------- | -------------------------------------- | ----------------------------------------------------------- |
| `read_file`    | `(path: String) -> Result<String>`     | UTF-8 estricto; falla con otros encodings (limitación conocida) |
| `write_file`   | `(path, contents) -> Result<()>`       | **Atómico**: temp + rename, preserva permisos del original  |
| `file_mtime`   | `(path) -> Result<u64>`                | Millis desde epoch; usado por el polling de cambios externos |
| `startup_file` | `() -> Option<String>`                 | Prioridad: PendingFile (macOS "Open with") > argv[1]        |

### Eventos (Rust → frontend, vía `emit`/`listen`)

| Evento      | Payload  | Emisores                                                            |
| ----------- | -------- | ------------------------------------------------------------------- |
| `open-file` | `string` (path absoluto) | 1) `RunEvent::Opened` en macOS (app corriendo), 2) callback de single-instance (segunda invocación CLI) |

Todo camino de apertura del frontend converge en `openFile()` de `main.ts`, que aplica el guard de cambios sin guardar y actualiza recientes. **No crear caminos alternativos que llamen a `read_file` sin pasar por ahí** (única excepción: `restoreSession()` y `reloadFromDisk()`, que son deliberadamente silenciosos).

## Estado

### En memoria (`main.ts`)

- `doc: DocState` — `{ path, dirty, mtime }`. Única fuente de verdad sobre el archivo abierto.
- `lastCursor` — última posición conocida, alimentada por el callback `onCursorMoved`.

### Persistido (localStorage, prefijo `portable-editor:`)

| Key                          | Contenido                                  |
| ---------------------------- | ------------------------------------------ |
| `portable-editor:theme`      | id del tema                                |
| `portable-editor:font-size`  | tamaño de fuente (9–28)                    |
| `portable-editor:wrap`       | `"true"`/`"false"`                         |
| `portable-editor:recent`     | JSON `RecentEntry[]` (máx. 8): `{path, line, col}` |

Las entradas de recientes guardan el cursor; se sincroniza en `syncRecentCursor()` al cambiar de archivo y al cerrar la ventana. El primer elemento es el que se restaura al arrancar sin argumentos.

## Flujos clave

### Abrir archivo
`openFile()` → guard de dirty → diálogo nativo (o path directo) → `invoke read_file` → `editor.setText()` (estado nuevo: **descarta historial de undo a propósito**) → `afterFileLoaded()` (path, status, recientes, lenguaje, mtime).

### Guardar
`saveFile()`/`saveFileAs()` → `invoke write_file` (atómico) → `refreshMtime()`. El refresh de mtime post-guardado es **obligatorio**: sin él, el polling detectaría el propio guardado como cambio externo.

### Cambios externos
Poll cada 2 s + al enfocar la ventana (`checkExternalChange`):
- mtime distinto y **sin** cambios locales → recarga silenciosa con `editor.replaceText()` (preserva cursor e historial de undo).
- mtime distinto y **con** cambios locales → prompt. Se actualiza `doc.mtime` antes de preguntar para no repetir el prompt por el mismo cambio.

Decisión: polling en vez de watcher nativo (`notify`). Es un solo archivo; un `stat` cada 2 s es gratis y evita una dependencia y el manejo de estado del watcher.

### "Open with..." del sistema
- **Linux**: el path llega por argv → `startup_file` lo resuelve.
- **macOS**: el path NO llega por argv; llega como `RunEvent::Opened` (AppleEvent). Dos casos:
  - App arrancando: el evento llega antes de que el frontend escuche → se guarda en `PendingFile` (estado managed) y `startup_file` lo consume.
  - App corriendo: se emite `open-file` y el frontend lo abre al toque.

### Instancia única
`tauri-plugin-single-instance`: la segunda invocación no abre ventana; su callback enfoca la existente y, si hay argv de archivo, lo resuelve contra el `cwd` de la segunda invocación y emite `open-file`.

## Editor (`editor.ts`)

- CodeMirror se reconfigura en caliente con **Compartments**: `themeConfig`, `languageConfig`, `wrapConfig`. Para agregar otra opción dinámica, seguir ese patrón.
- `buildExtensions()` reconstruye las extensiones desde las variables de clausura (`currentTheme`, etc.) — necesario porque `setText` crea un `EditorState` nuevo y los Compartments vuelven a su valor inicial si no.
- `setText` vs `replaceText`: el primero resetea historial (abrir otro archivo); el segundo lo preserva (recarga del mismo archivo). No confundirlos.
- Detección de lenguaje: `LanguageDescription.matchFilename` sobre el **basename** (los regex de nombres tipo `Makefile` no matchean paths completos). La carga es lazy y hay un `languageToken` que descarta cargas que llegan tarde si el usuario cambió de archivo en el medio.
- La fuente es única y viene de variables CSS (`--editor-font`, `--editor-font-size`) aplicadas en `baseTheme`; el tamaño se cambia sin reconfigurar CodeMirror.

## Temas (`themes.ts`)

Para agregar un tema:
1. Definir una `ThemePalette` (todos los campos son obligatorios).
2. Agregar la entrada a `THEMES` con `buildTheme(palette, dark)`.
3. Nada más: el selector, la persistencia y el `data-dark` del body salen del registro.

`themeById()` es tolerante: cualquier id desconocido cae al primer tema del registro (nunca lanzar por un localStorage viejo).

## Trampas conocidas (no las "arregles" sin leer esto)

1. **Single-instance debe ser el PRIMER plugin** registrado en el Builder. Es requisito del plugin.
2. **Alt+Z usa `event.code`, no `event.key`**: en macOS `Alt+Z` produce "ω" y `event.key` no sirve.
3. **El guard `#[cfg(target_os = "macos")]` en `lib.rs`**: `RunEvent::Opened` no existe en Linux; sin el guard no compila. El `let _ = (app, event)` del branch contrario evita warnings de variables sin usar.
4. **Permisos IPC**: cualquier API nueva de `@tauri-apps/api` o de plugins puede requerir un permiso en `capabilities/default.json`. Si un `invoke` falla con "not allowed", falta el permiso ahí.
5. **El temp del guardado atómico** vive en el mismo directorio que el destino (mismo filesystem, si no `rename` no es atómico) y copia los permisos del original antes del rename.
6. **`onDocChanged` dispara también en recargas programáticas** (`replaceText` es un dispatch): el llamador debe resetear `doc.dirty = false` después, como hace `reloadFromDisk()`.
7. **`tauri dev` con argumento**: los args CLI se prueban con el binario compilado o `npm run tauri dev -- -- -- archivo.txt` (doble `--`).
8. Las **asociaciones de archivo** solo existen con la app instalada desde el bundle; en dev no funcionan.

## Limitaciones conocidas / backlog

- Encodings: `read_to_string` es UTF-8 estricto; archivos latin-1/UTF-16 no abren (candidato: `encoding_rs`).
- Archivos enormes: se lee todo a memoria y el highlighting parsea sin umbral de tamaño.
- El polling de mtime no detecta borrado del archivo (se ignora en silencio, por diseño, pero podría indicarse en la status bar).

## Verificación

- TypeScript: `npx tsc --noEmit` (obligatorio antes de dar por bueno un cambio de TS).
- Rust: compila con la primera corrida de `npm run tauri dev` (la corre el usuario/dev, no el agente).
- No hay tests automatizados todavía; si agregás lógica pura (p. ej. parsing de recientes), es buen candidato para extraer y testear con Vitest.
