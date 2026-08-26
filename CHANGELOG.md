# Changelog

Todos los cambios notables de este proyecto se documentan acá.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-AR/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado

- Disponible por Homebrew (macOS): `brew tap jrodrigopuca/tap && brew install --cask portable-editor`. Tap en [`jrodrigopuca/homebrew-tap`](https://github.com/jrodrigopuca/homebrew-tap).
- Aviso al abrir un archivo que no parece texto (imagen, ejecutable, etc.): pregunta antes de cargarlo, en vez de "decodificarlo" en silencio como Windows-1252 y arriesgar corromperlo al guardar.
- Indicador "(mixed)" junto a LF/CRLF en la status bar cuando un archivo mezcla ambos estilos de fin de línea.

### Corregido

- `Mod+S` sin cambios sin guardar ya no reescribe el archivo. Antes, guardar sin haber editado nada re-encodeaba el contenido igual — inofensivo para texto normal, pero corrompía un archivo binario abierto por error (ver ROADMAP.md sección 7, ítem 1).
- Un archivo con una sola línea de fin CRLF colada entre líneas LF (típico de pegar un snippet de Windows) ya no convierte el archivo entero a CRLF al guardar. La detección de EOL ahora es por mayoría de línea, no por "¿aparece CRLF en algún lado?" (ver ROADMAP.md sección 7, ítem 2).
- Dos aperturas de archivo por CLI casi simultáneas (`portable-editor a.txt` seguido de `portable-editor b.txt` en rápida sucesión) ya no corren sus diálogos de confirmación en paralelo — se procesan en orden, uno a la vez (ver ROADMAP.md sección 7, ítem 3).
- La clave del archivo de recovery ya no depende de `DefaultHasher` (Rust no garantiza su algoritmo estable entre versiones del compilador) — ahora usa FNV-1a, determinístico para siempre. Nota: un recovery ya pendiente en disco de una versión anterior a este cambio queda huérfano una única vez al actualizar (ver ROADMAP.md sección 7, ítem 5).
- Tipear justo mientras el editor recarga un archivo modificado externamente (ventana muy angosta, entre el chequeo de mtime y la lectura del contenido) ya no se pierde en silencio — si eso pasa, ahora pregunta antes de sobreescribir, igual que el resto de los conflictos de recarga (ver ROADMAP.md sección 7, ítem 6).
- El punto de "sin guardar" (●) ahora se limpia solo si deshacés (`Mod+Z`) hasta volver exactamente al contenido que ya está guardado en disco — antes se quedaba marcando "sin guardar" aunque el contenido fuera idéntico byte a byte (ver ROADMAP.md sección 7, ítem 7).
- Una carrera muy angosta entre el autosave (cada 10s) y un guardado real ya no podía dejar un recovery con contenido más viejo que lo ya guardado, ofreciendo "¿recuperar?" hacia atrás en el tiempo tras un crash (ver ROADMAP.md sección 7, ítem 8).
- Todo acceso a `localStorage` (tema, fuente, wrap, recientes) ahora tolera que el storage falle (deshabilitado, cuota llena, perfil corrupto) en vez de romper el arranque de la app (ver ROADMAP.md sección 7, ítem 9).
- `portable-editor -notes.txt` ya abre un archivo cuyo nombre empieza con guion, en vez de ignorarlo en silencio (ver ROADMAP.md sección 7, ítem 10).
- Help → "Install 'portable-editor' Command" ya no pide contraseña de administrador en cada reinstalación — solo la primera vez, o si algo que no es nuestro symlink ocupa ese lugar (ver ROADMAP.md sección 7, ítem 11).
- Seleccionar varios archivos en Finder y abrirlos con portable-editor ("Open With") ya avisa cuántos no se abrieron, en vez de descartarlos en silencio (ver ROADMAP.md sección 7, ítem 12).
- Dos "Open With" casi simultáneos durante el arranque en frío (antes de que la ventana termine de cargar) ya no pisan uno al otro en silencio — se abre el primero y se avisa que el otro no se abrió, igual que la multi-selección (ver ROADMAP.md sección 7, ítem 13).
- Copiar/cortar/pegar (`Mod+C`/`Mod+X`/`Mod+V`) no funcionaban en macOS, ni siquiera dentro del editor: faltaba un menú Edit nativo (`Cut`/`Copy`/`Paste`/`Select All`), sin el cual WKWebView no resuelve esos atajos.
- `Mod+/` abría el panel de atajos en vez de comentar la línea (chocaba con el `toggleComment` de CodeMirror en las dos plataformas). El panel ahora usa `Mod+Shift+/`.
- El fallback de tema corrupto en `localStorage` ahora usa `DEFAULT_THEME_ID` en vez de la primera entrada de la lista de temas — mismo resultado hoy, pero ya no depende del orden de esa lista (ver ROADMAP.md sección 7, ítem 14).
- `detectIndent()` ya no escanea archivos grandes línea por línea sin límite — por encima de 10 MB asume la indentación por defecto en vez de potencialmente demorar la apertura (ver ROADMAP.md sección 7, ítem 15).
- Reabrir la sesión anterior con el último archivo ya borrado o sin permisos ahora muestra un diálogo de error explicando qué pasó, en vez de un "untitled" vacío sin ninguna pista (ver ROADMAP.md sección 7, ítem 3).

## [0.2.0] - 2026-08-20

### Agregado

- Detección de encoding al abrir archivos: BOM (UTF-8/UTF-16), UTF-8 estricto, y Windows-1252 como fallback para texto legado sin BOM que no decodifica como UTF-8.
- Detección de fin de línea (LF/CRLF), visible en la status bar junto al encoding.
- Política de guardado: siempre UTF-8 en disco, preservando el estilo de fin de línea original del archivo.
- Límite de tamaño de archivo: por encima de 100 MB, `read_file` rechaza el archivo sin cargarlo a memoria (mensaje de error claro). Entre 10 y 100 MB, abre igual pero sin syntax highlighting para mantener el editor responsive.
- Indicador de archivo borrado/renombrado bajo los pies: la status bar muestra "(deleted on disk)" y el próximo guardado se comporta como "Save as" en vez de reescribir un path que ya no existe.
- Menú nativo: **File** (New/Open/Save/Save As, con sus atajos) y **Help** (Keyboard Shortcuts — abre un panel propio en el editor con la lista completa, adaptada al teclado del SO — y About, con la versión real del build).
- Panel de búsqueda/reemplazo (`Mod+F`) tematizado: antes usaba el estilo default de CodeMirror, ahora es consistente con los 4 temas del editor (incluido One Dark).
- Detección de indentación (tabs/espacios y ancho) al abrir un archivo, con botón en la status bar para cambiarla manualmente. Afecta código nuevo, no reconvierte el existente.
- `cargo test` corre ahora en CI (antes solo `fmt`/`clippy`) — los 8 tests de `text_io.rs` dejan de ser opcionales.
- Help → "Install 'portable-editor' Command" (macOS): instala el comando en `/usr/local/bin` sin que haya que correr `sudo ln -s` a mano.
- Recuperación de crash: cada 10s se guarda un snapshot del archivo (si tiene cambios sin guardar) en el directorio de datos de la app. Si portable-editor no cierra limpio (crash, force-quit, corte de luz), la próxima vez que abrís ese archivo te pregunta si querés recuperar lo perdido. Se limpia solo al guardar o al descartar. Solo para archivos con path real, no para buffers 100% nuevos sin guardar.
- Tiempo de arranque medido y publicado: ~470 ms ± 25 ms (macOS Apple Silicon). Script de benchmark en `scripts/bench-startup.sh`, metodología en `docs/RELEASE.md`.

### Corregido

- Guardar un archivo abierto a través de un symlink (dotfiles con Stow/chezmoi/Nix) ya no reemplaza el link por un archivo plano — `write_file` ahora resuelve el symlink y escribe a través de él, preservándolo.
- Abrir por CLI o "Open with..." un archivo que todavía no existe (`portable-editor nuevo.txt`) ya no se ignora en silencio — abre un editor vacío listo para guardar en ese path, como vim/nano/code.
- Una segunda invocación de CLI o "Open with..." ya no reemplaza en silencio el archivo actualmente abierto (aunque no tenga cambios sin guardar) — ahora pregunta antes, porque la instancia única significa que solo hay una ventana donde mostrarlo.

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
