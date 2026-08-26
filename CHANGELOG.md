# Changelog

Todos los cambios notables de este proyecto se documentan acá.
Formato basado en [Keep a Changelog](https://keepachangelog.com/es-AR/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [Sin publicar]

### Agregado

- Nord y Solarized Light tienen su propia status bar, panel de búsqueda y panel de atajos (colores de sus paletas oficiales); antes usaban los de One Dark y de Paper y se veían "pegados" (ver ROADMAP.md sección 11, pregunta abierta → resuelta).
- Al elegir "Keep my changes" ante un cambio externo, la status bar muestra "(changed on disk)" y guardar pregunta antes de sobrescribir la versión del disco — antes el siguiente guardado la pisaba en silencio (ver ROADMAP.md sección 11, ítem 7).
- El panel de atajos toma el foco al abrirse (Tab ya no escribe en el editor detrás) y lo devuelve al cerrar (ver ROADMAP.md sección 11, ítem 8).
- Mientras se lee un archivo grande, la status bar muestra "Opening …" en vez de dejar el archivo anterior en pantalla sin aviso (ver ROADMAP.md sección 11, ítem 9).
- Al cerrar, crear o abrir con cambios sin guardar, el diálogo es **Save / Don't Save / Cancel** (Enter guarda, Esc cancela) — antes era Yes/No, y guardar al cerrar costaba tres pasos (ver ROADMAP.md sección 11, ítems 1 y 6).
- El aviso de recuperación tras un cierre abrupto tiene tres opciones: usar lo recuperado (Enter), decidir después (Esc — el snapshot se conserva) o borrarlo; antes Esc lo borraba para siempre (ver ROADMAP.md sección 11, ítem 1).
- Los demás diálogos tienen botones con verbo ("Reload from disk" / "Keep my changes", "Open anyway" / "Cancel", …) en vez de Yes/No, y el de recarga nombra el archivo (ver ROADMAP.md sección 11, ítem 1).
- Status bar: lo clickeable se distingue (subrayado punteado), el foco de teclado es visible, el punto de "sin guardar" se ve en temas claros, y el nombre del archivo tiene más peso (ver ROADMAP.md sección 11, ítem 2).
- Encoding y fin de línea solo se muestran cuando no son UTF-8 / LF — así "Windows-1252" o "(mixed)" se notan; "(mixed)" explica en el tooltip que se guardará como LF (ver ROADMAP.md sección 11, ítem 3).
- Tooltips de New/Open/Save/Wrap con el atajo de la plataforma actual; botón "?" en la status bar para abrir el panel de atajos; el panel lista además `Mod+G`, `Esc` y `Tab` (ver ROADMAP.md sección 11, ítems 4 y 5).
- Al no poder abrir un archivo porque ya no existe, el mensaje avisa que se quitó de Recientes; (macOS) cancelar el prompt de contraseña de "Install … Command" ya no muestra un error, y un fallo real trae el comando para hacerlo a mano (ver ROADMAP.md sección 11, ítem 5).
- Cerrar la ventana justo después de guardar un archivo grande espera a que el guardado termine antes de preguntar por cambios sin guardar (ver ROADMAP.md sección 10, ítem 5).
- Presionar `Mod+O` o `Mod+Shift+S` varias veces seguidas ya no abre varios diálogos en fila: mientras hay uno pendiente, los demás se ignoran (ver ROADMAP.md sección 10, ítem 7).
- Una recarga por cambio externo cuyo contenido ya coincide con el editor ya no agrega un paso de deshacer vacío ni mueve el scroll (ver ROADMAP.md sección 10, ítem 4).
- Lanzar `portable-editor a.txt` y `portable-editor b.txt` casi al mismo tiempo con la app cerrada ahora abre `a` y avisa que `b` no se abrió; antes abría `b` y perdía `a` sin aviso (ver ROADMAP.md sección 10, ítem 1).
- Un cambio externo detectado justo mientras el editor estaba ocupado (abriendo otro archivo, o esperando una respuesta) ya no puede pisar texto tipeado en ese intervalo sin preguntar, ni preguntar "¿descartar cambios?" por un cambio que era el propio guardado del editor (ver ROADMAP.md sección 10, ítem 2).
- Tipear durante un guardado ya no deja un snapshot de recuperación más viejo que el archivo guardado: se toma uno nuevo en el momento (ver ROADMAP.md sección 10, ítem 3).
- Las acciones sobre el documento (Nuevo, Abrir, Guardar, Guardar como, abrir desde terminal o Finder, recarga por cambio externo) ahora se ejecutan de a una: un diálogo de confirmación ya no puede quedar respondido sobre un archivo distinto del que preguntó, ni apilarse una segunda pregunta contradictoria encima (ver ROADMAP.md sección 9, ítem 12).
- Abrir dos archivos en rápida sucesión ya no puede dejar al segundo con la fecha de modificación del primero (lo que disparaba recargas o avisos de "cambió en disco" falsos); y un cambio externo que aterriza justo mientras se lee el archivo ya no pasa desapercibido (ver ROADMAP.md sección 9, ítem 13).
- Tipear mientras un guardado está en curso (disco lento, archivo grande) ya no marca esos caracteres como guardados: el punto de "sin guardar" se mantiene y cerrar la ventana vuelve a preguntar (ver ROADMAP.md sección 9, ítem 1).
- Invocar `portable-editor otro.txt` desde una terminal mientras la app todavía está arrancando ya no pierde ese archivo en silencio (ver ROADMAP.md sección 9, ítem 3).
- (Linux) Un archivo cuyo nombre no es UTF-8 válido ahora muestra un error claro ("isn't valid UTF-8") en vez de "does not exist" (ver ROADMAP.md sección 9, ítem 4).
- Un archivo demasiado grande, sin permiso o en un volumen no montado ya no desaparece de Recientes por eso; solo un archivo que realmente no existe se olvida (ver ROADMAP.md sección 9, ítem 5).
- Tras guardar un archivo que mezclaba fines de línea, la status bar deja de mostrar "(mixed)" (el disco ya es uniforme) (ver ROADMAP.md sección 9, ítem 6).
- Cerrar la ventana descartando cambios ya no hace que el próximo arranque ofrezca "recuperar" esos mismos cambios (ver ROADMAP.md sección 9, ítem 7).
- Un Save As o un descarte justo mientras el autosave escribía ya no puede dejar un snapshot viejo que ofrezca "recuperar" contenido ya guardado (ver ROADMAP.md sección 9, ítem 2).
- El chequeo de cambios externos (cada 2 s y al enfocar la ventana) ya no puede congelar la interfaz sobre un volumen de red colgado (ver ROADMAP.md sección 9, ítem 8).
- Al fallar un guardado porque la carpeta desapareció, el mensaje lo dice ("its folder no longer exists") en vez de "does not exist" (ver ROADMAP.md sección 9, ítem 11).
- Disponible por Homebrew (macOS): `brew tap jrodrigopuca/tap && brew install --cask portable-editor`. Tap en [`jrodrigopuca/homebrew-tap`](https://github.com/jrodrigopuca/homebrew-tap).
- Aviso al abrir un archivo que no parece texto (imagen, ejecutable, etc.): pregunta antes de cargarlo, en vez de "decodificarlo" en silencio como Windows-1252 y arriesgar corromperlo al guardar.
- Indicador "(mixed)" junto a LF/CRLF en la status bar cuando un archivo mezcla ambos estilos de fin de línea.

### Corregido

- `Mod+S` sin cambios sin guardar ya no reescribe el archivo. Antes, guardar sin haber editado nada re-encodeaba el contenido igual — inofensivo para texto normal, pero corrompía un archivo binario abierto por error (ver ROADMAP.md sección 7, ítem 1).
- Un archivo con una sola línea de fin CRLF colada entre líneas LF (típico de pegar un snippet de Windows) ya no convierte el archivo entero a CRLF al guardar. La detección de EOL ahora es por mayoría de línea, no por "¿aparece CRLF en algún lado?" (ver ROADMAP.md sección 7, ítem 2).
- Dos aperturas de archivo por CLI casi simultáneas (`portable-editor a.txt` seguido de `portable-editor b.txt` en rápida sucesión) ya no corren sus diálogos de confirmación en paralelo — se procesan en orden, uno a la vez (ver ROADMAP.md sección 7, ítem 4).
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
- (macOS) Con la app ya abierta, el segundo "Open With" desde Finder ya no se ignora en silencio: cada uno abre su archivo (o pregunta antes de reemplazar). Regresión introducida en el fix del ítem 13 (ver ROADMAP.md sección 8, ítem 1).
- (macOS) Un "Open With" que llegaba justo mientras la ventana terminaba de cargar ya no abre el mismo archivo dos veces (con un diálogo "¿reemplazar X por X?") (ver ROADMAP.md sección 8, ítem 1).
- Abrir otro archivo justo mientras el editor estaba consultando el anterior en disco (ventana angosta, más ancha con archivos grandes) ya no puede mezclar datos: el archivo nuevo no hereda la fecha de modificación del viejo, no queda marcado "(deleted on disk)" si el viejo desapareció, ni recibe el contenido del viejo en el buffer (ver ROADMAP.md sección 8, ítem 2).
- "Save As" ya no deja un recovery huérfano del archivo original: reabrirlo no ofrece "recuperar cambios" que ya se guardaron con el otro nombre (ver ROADMAP.md sección 8, ítem 3).
- Si algo fallaba al arrancar (antes de restaurar la sesión), el editor quedaba toda la sesión sin detección de cambios externos ni autosave, sin avisar. Ahora esas redes se activan primero y el error de arranque se muestra (ver ROADMAP.md sección 8, ítem 4).
- Una invocación CLI (`portable-editor x.txt`) que llegaba mientras la app todavía estaba restaurando la sesión anterior ya no corre en paralelo con esa restauración — espera su turno (ver ROADMAP.md sección 8, ítem 5).
- Guardar ahora hace `fsync` del archivo temporal antes de reemplazar el original: un corte de luz justo después de guardar ya no puede dejar el archivo vacío (ver ROADMAP.md sección 8, ítem 6).
- Al guardar un archivo con permisos restringidos (por ejemplo un `.env` 0600), el archivo temporal nace ya con esos permisos, en vez de quedar legible para todos durante unos milisegundos (ver ROADMAP.md sección 8, ítem 7).
- Los snapshots de recovery (autosave) se guardan con permisos solo para el usuario (directorio 0700, archivos 0600) — antes una copia de cualquier archivo editado quedaba legible para otros usuarios de la máquina (ver ROADMAP.md sección 8, ítem 8).

### Seguridad

- Content Security Policy activa en el webview (antes `null`): bloquea scripts inline o remotos que una dependencia comprometida pudiera inyectar (ver ROADMAP.md sección 8, ítem 9).
- Guardar ya no puede disparar, en una ventana de milisegundos, una recarga del propio archivo recién guardado (que dejaba una entrada fantasma en el historial de deshacer) (ver ROADMAP.md sección 8, ítem 12).
- Abrir o guardar un archivo muy grande, o el autosave cada 10 s, ya no congela la ventana mientras dura la operación de disco (ver ROADMAP.md sección 8, ítem 16).
- (Linux) Un archivo cuyo nombre no es UTF-8 válido (por ejemplo Latin-1 heredado) ya no hace crashear la app al arrancar con él como argumento (ver ROADMAP.md sección 8, ítem 17).
- Un archivo con fines de línea `\r` sueltos (Mac clásico) ahora muestra "(mixed)" en la status bar: al guardar se convierte a LF, y antes esa conversión era silenciosa (ver ROADMAP.md sección 8, ítem 18).
- (macOS) Help → "Install 'portable-editor' Command" ya no borra en silencio un symlink de OTRO programa que ocupe `/usr/local/bin/portable-editor`; en ese caso pide confirmación con contraseña como siempre (ver ROADMAP.md sección 8, ítem 20).
- Los snapshots de recovery de archivos que ya no existen se limpian solos a los 30 días, en vez de acumularse para siempre (ver ROADMAP.md sección 8, ítem 22).
- Los errores al abrir o guardar distinguen "no existe", "sin permiso" y "demasiado grande" con mensajes propios (ver ROADMAP.md sección 8, ítem 15).
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
