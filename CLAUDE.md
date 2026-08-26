# CLAUDE.md — portable-editor

Guía operativa para agentes AI (y humanos apurados). La referencia completa está en `docs/ARCHITECTURE.md` — **leela antes de cambios no triviales**.

## Qué es

Editor de escritorio (Linux/macOS) de UN archivo a la vez. Tauri 2 (Rust) + CodeMirror 6 (TypeScript vanilla, sin frameworks de UI). Producto deliberadamente mini: **NO agregar** tabs, file tree, LSP, git integrado ni plugins.

## Convenciones

- Código, comentarios y strings de UI: **inglés**. Documentación (README, docs/): **español**.
- TypeScript estricto: nada de `any`; const objects + tipos derivados en vez de union types sueltos; interfaces planas.
- El frontend jamás toca el filesystem: todo IO pasa por comandos Rust (`invoke`).

## Comandos

```sh
npm install            # deps frontend
npm run lint           # Biome (lint + format check)
npm run lint:fix       # Biome con autofix
npm run typecheck      # tsc --noEmit: OBLIGATORIO tras cambios de TS
npm run test           # Vitest (tests unitarios de lógica pura)
cargo fmt              # formatear Rust (en src-tauri/; no compila nada)
cargo test             # tests unitarios de Rust (en src-tauri/; compila — lo corre el dev, no el agente)
npm run tauri dev      # correr la app (compila Rust; la lanza el dev, no el agente)
npm run tauri build    # bundle de producción
```

La lógica pura (estado del documento, recientes, prefs, paths, indentación) vive en módulos sin DOM ni Tauri (`src/document.ts`, `src/recent.ts`, `src/prefs.ts`, `src/paths.ts`, `src/indent.ts`) con tests al lado (`*.test.ts`). Lógica nueva testeable va ahí, no dentro de `main.ts`. Todo `invoke` pasa por los wrappers tipados de `src/ipc.ts` (único módulo que importa `@tauri-apps/api/core`); un comando nuevo en Rust = un wrapper nuevo ahí.

## Mapa rápido

| Quiero tocar...                  | Archivo                                 |
| -------------------------------- | ---------------------------------------- |
| Acciones, atajos, status bar     | `src/main.ts`                            |
| Estado del documento (`DocState`), dirty, decisión de cambio externo | `src/document.ts` (puro, con tests) |
| Wrappers de `invoke`, ids del menú (`MENU_ACTION`) | `src/ipc.ts`                   |
| Comportamiento del editor        | `src/editor.ts` (único que importa CodeMirror) |
| Temas                            | `src/themes.ts` (agregar paleta + entrada en `THEMES`) |
| IPC (comandos delgados), plugins, menú, eventos del OS | `src-tauri/src/lib.rs` |
| Contrato de error de IO (Rust ↔ TS) | `src-tauri/src/io_error.rs` + `src/io-error.ts` (trampa #50) |
| Escritura atómica, symlinks, mtime | `src-tauri/src/fs_ops.rs` (puro, `&Path`, testeado) |
| Qué abrir al arrancar / "Open with" (merge del `Opened`) | `src-tauri/src/startup.rs` (puro, testeado) |
| Permisos IPC                     | `src-tauri/capabilities/default.json`    |
| Ventana, bundle, file assoc.     | `src-tauri/tauri.conf.json`              |

## Invariantes críticos (romperlos = bug)

1. `tauri-plugin-single-instance` se registra PRIMERO en el Builder.
2. `write_file` es atómico (temp en mismo directorio, creado con el modo del original, + `sync_all` + rename, preservando permisos). No simplificarlo a `fs::write` ni sacar el `sync_all` (trampas #40/#41).
3. Toda apertura de archivo del frontend pasa por `openFile()` (guard de dirty + recientes). Excepciones deliberadas: `restoreSession()` y `reloadFromDisk()` se saltan los guards de confirmación (no los diálogos de error — trampa #35).
4. `write_file` devuelve el mtime resultante y `writeTo()` lo asigna a `doc.mtime` en el mismo tick que `dirty = false`. No volver a un `refreshMtime()` posterior al guardado: ese gap hacía que el polling detectara el propio guardado como cambio externo.
5. `setText` (archivo nuevo, resetea undo) ≠ `replaceText` (mismo archivo recargado, preserva undo/cursor).
6. `RunEvent::Opened` va con `#[cfg(target_os = "macos")]`; sin el guard no compila en Linux.
7. Atajos que dependen de la tecla física usan `event.code` (en macOS, Alt+letra muta `event.key`).
8. Claves de localStorage con prefijo `portable-editor:`; validar siempre lo que se lee (ver `isRecentEntry`). Acceder siempre vía `safeGetItem`/`safeSetItem` (`main.ts`), nunca `localStorage.*` directo — puede tirar (storage deshabilitado, cuota llena) y ya está guardado con try/catch ahí.
9. `read_file` devuelve `{ contents, encoding, eol, mixed_eol, likely_binary }` (no un string pelado); `write_file` recibe `eol` y **siempre escribe UTF-8**, sin importar el encoding de origen. `eol` se decide por mayoría de línea (no "¿aparece CRLF en algún lado?" — eso convertía archivos mayormente LF con una sola línea CRLF colada); `mixed_eol` avisa en la status bar cuando el archivo mezclaba ambos estilos, o tenía `\r` sueltos (Mac clásico), que se reescriben como LF (trampa #47). `likely_binary` (byte NUL en los primeros 8000 bytes, heurística de git) es la única señal de que el fallback a Windows-1252 decodificó basura no-texto — decodificar nunca falla, así que no hay otra forma de detectarlo. El frontend pregunta antes de abrir si viene en `true` (`confirmOpenBinary` en `main.ts`, solo en `openFile()`, no en `restoreSession()`). Lógica de detección/codificación en `src-tauri/src/text_io.rs` (testeada con `cargo test`).
10. `read_file` chequea el tamaño del archivo (metadata) **antes** de leerlo; por encima de 100 MB rechaza sin cargar nada a memoria. No reordenar esos dos pasos.
11. Todo flujo async que muta `doc` (`main.ts`) captura `doc.gen` antes de su `await` y aborta con `isStale(gen)` si cambió. Cambiar de documento = `beginDocument()` DESPUÉS del último `await`, con las mutaciones de `doc.*` en el mismo bloque síncrono. No inventar chequeos ad hoc por `path`/`dirty` (trampa #37).

## Al terminar un cambio

1. `npm run lint`, `npm run typecheck` y `npm run test` en verde. Si tocaste Rust: `cargo fmt` y `cargo test` (clippy y `cargo test` también corren en CI).
2. Si tocaste Rust o config de Tauri, avisar que `tauri dev` recompila (no buildear automáticamente).
3. Actualizar `README.md` (features/atajos), `docs/ARCHITECTURE.md` (flujos/invariantes) y `CHANGELOG.md` si el cambio los altera.
