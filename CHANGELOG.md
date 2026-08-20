# Changelog

Todos los cambios notables de este proyecto se documentan acá.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-AR/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado

- Detección de encoding al abrir archivos: BOM (UTF-8/UTF-16), UTF-8 estricto, y Windows-1252 como fallback para texto legado sin BOM que no decodifica como UTF-8.
- Detección de fin de línea (LF/CRLF), visible en la status bar junto al encoding.
- Política de guardado: siempre UTF-8 en disco, preservando el estilo de fin de línea original del archivo.
- Límite de tamaño de archivo: por encima de 100 MB, `read_file` rechaza el archivo sin cargarlo a memoria (mensaje de error claro). Entre 10 y 100 MB, abre igual pero sin syntax highlighting para mantener el editor responsive.
- Indicador de archivo borrado/renombrado bajo los pies: la status bar muestra "(deleted on disk)" y el próximo guardado se comporta como "Save as" en vez de reescribir un path que ya no existe.
- Menú nativo: **File** (New/Open/Save/Save As, con sus atajos) y **Help** (Keyboard Shortcuts — abre un panel propio en el editor con la lista completa, adaptada al teclado del SO — y About, con la versión real del build).
- Panel de búsqueda/reemplazo (`Mod+F`) tematizado: antes usaba el estilo default de CodeMirror, ahora es consistente con los 4 temas del editor (incluido One Dark).
- Detección de indentación (tabs/espacios y ancho) al abrir un archivo, con botón en la status bar para cambiarla manualmente. Afecta código nuevo, no reconvierte el existente.

## [0.1.0] - 2026-08-19

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
- Fase 2: ícono propio (fuente SVG en `assets/`), templates de issues, guía de contribución.
- Firma y notarización de Apple (Developer ID Application) en el workflow de release: los bundles de macOS instalan sin advertencia de Gatekeeper.
- Primer [release público en GitHub](https://github.com/jrodrigopuca/portable-editor/releases/tag/v0.1.0): .dmg (arm64/x64) firmados y notarizados, .deb, .rpm, .AppImage.
