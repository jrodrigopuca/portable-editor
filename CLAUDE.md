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
npm run tauri dev      # correr la app (compila Rust; la lanza el dev, no el agente)
npm run tauri build    # bundle de producción
```

La lógica pura (recientes, prefs, paths) vive en módulos sin DOM ni Tauri (`src/recent.ts`, `src/prefs.ts`, `src/paths.ts`) con tests al lado (`*.test.ts`). Lógica nueva testeable va ahí, no dentro de `main.ts`.

## Mapa rápido

| Quiero tocar...                  | Archivo                                 |
| -------------------------------- | ---------------------------------------- |
| Acciones, atajos, status bar     | `src/main.ts`                            |
| Comportamiento del editor        | `src/editor.ts` (único que importa CodeMirror) |
| Temas                            | `src/themes.ts` (agregar paleta + entrada en `THEMES`) |
| IO, IPC, eventos del OS          | `src-tauri/src/lib.rs`                   |
| Permisos IPC                     | `src-tauri/capabilities/default.json`    |
| Ventana, bundle, file assoc.     | `src-tauri/tauri.conf.json`              |

## Invariantes críticos (romperlos = bug)

1. `tauri-plugin-single-instance` se registra PRIMERO en el Builder.
2. `write_file` es atómico (temp en mismo directorio + rename, preservando permisos). No simplificarlo a `fs::write`.
3. Toda apertura de archivo del frontend pasa por `openFile()` (guard de dirty + recientes). Excepciones deliberadas: `restoreSession()` y `reloadFromDisk()`.
4. Tras cada guardado se llama `refreshMtime()`; sin eso el polling detecta el propio guardado como cambio externo.
5. `setText` (archivo nuevo, resetea undo) ≠ `replaceText` (mismo archivo recargado, preserva undo/cursor).
6. `RunEvent::Opened` va con `#[cfg(target_os = "macos")]`; sin el guard no compila en Linux.
7. Atajos que dependen de la tecla física usan `event.code` (en macOS, Alt+letra muta `event.key`).
8. Claves de localStorage con prefijo `portable-editor:`; validar siempre lo que se lee (ver `isRecentEntry`).

## Al terminar un cambio

1. `npm run lint`, `npm run typecheck` y `npm run test` en verde. Si tocaste Rust: `cargo fmt` (clippy corre en CI).
2. Si tocaste Rust o config de Tauri, avisar que `tauri dev` recompila (no buildear automáticamente).
3. Actualizar `README.md` (features/atajos), `docs/ARCHITECTURE.md` (flujos/invariantes) y `CHANGELOG.md` si el cambio los altera.
