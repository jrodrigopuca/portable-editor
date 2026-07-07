# Changelog

Todos los cambios notables de este proyecto se documentan acá.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-AR/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado

- Editor de un archivo a la vez con CodeMirror 6: highlighting automático (~150 lenguajes, carga lazy), números de línea, plegado, autocierre de brackets, búsqueda/reemplazo, multi-cursor.
- 4 temas (One Dark, Nord, Paper, Solarized Light) persistidos, con status bar que acompaña.
- Fuente monoespaciada única con tamaño ajustable (`Mod+=`/`Mod+-`/`Mod+0`).
- Cuatro vías de apertura: UI (botón/`Mod+O`), drag & drop, "Open with..." del sistema (asociaciones de archivo; en macOS vía `RunEvent::Opened`), y CLI (`portable-editor archivo.txt`).
- Guardado atómico (temp + rename, preservando permisos).
- Detección de cambios externos por polling de mtime: recarga silenciosa si no hay ediciones, prompt si las hay.
- Word wrap conmutable (`Alt+Z` o status bar), persistido.
- Instancia única: una segunda invocación enfoca la ventana existente y abre el archivo pasado.
- Archivos recientes (máx. 8) con restauración de sesión en línea/columna exactas.
- Indicador de cambios sin guardar con confirmación al cerrar/abrir/crear.
- Documentación de mantenimiento: `docs/ARCHITECTURE.md`, `docs/RELEASE.md`, `docs/ROADMAP.md`, `CLAUDE.md`.
- Workflow de release (GitHub Actions + tauri-action): macOS arm64/x86_64 y Linux, draft release con artefactos.
- Fase 1 de solidez: licencia Apache-2.0 + NOTICE, Biome (lint/format), Vitest con tests de lógica pura, CI de calidad, checklist de smoke test.
