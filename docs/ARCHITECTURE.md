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
| `src/indent.ts`                      | Lógica pura: detección de indentación (tabs/spaces, ancho), presets    |
| `src/styles.css`                     | Layout, status bar, variables CSS de fuente                            |
| `src-tauri/src/lib.rs`               | Comandos IPC, plugins, evento Opened de macOS, menú nativo (`build_menu`) |
| `src-tauri/src/text_io.rs`           | Lógica pura: detección de encoding/EOL al leer, codificación al guardar |
| `src-tauri/src/recovery.rs`          | Lógica pura: clave de recovery derivada del path (hash)                 |
| `src-tauri/src/main.rs`              | Entry point (no tocar, solo llama a `lib.rs`)                          |
| `src-tauri/tauri.conf.json`          | Ventana, bundle, asociaciones de archivo                               |
| `src-tauri/capabilities/default.json`| Permisos IPC del webview                                                |

## Superficie IPC

### Comandos (frontend → Rust, vía `invoke`)

| Comando        | Firma                                  | Notas                                                       |
| -------------- | -------------------------------------- | ----------------------------------------------------------- |
| `read_file`    | `(path: String) -> Result<DecodedFile>` | `DecodedFile = { contents, encoding, eol, mixed_eol, likely_binary }`. Chequea tamaño vía metadata primero: rechaza sin leer si supera `text_io::MAX_FILE_SIZE_BYTES` (100 MB). Detección: BOM (UTF-8/UTF-16) → UTF-8 estricto → fallback Windows-1252. `contents` siempre viene normalizado a `\n`. `eol` es mayoría de línea (no "¿aparece CRLF en algún lado?"); `mixed_eol` avisa cuando el archivo mezclaba LF y CRLF, cualquiera sea el que ganó. `likely_binary` (NUL en los primeros 8000 bytes) — ver trampa #22. |
| `write_file`   | `(path, contents, eol: String) -> Result<()>` | **Atómico**: temp + rename, preserva permisos del original. Restaura `eol` (`"LF"`/`"CRLF"`) antes de escribir. Política: **siempre UTF-8 en disco**, sin importar el encoding de origen. Escribe a través de symlinks (`resolve_symlink_target`), no los reemplaza — trampa #15. |
| `file_mtime`   | `(path) -> Result<u64>`                | Millis desde epoch; usado por el polling de cambios externos |
| `startup_file` | `() -> Option<StartupTarget>`          | `StartupTarget = { path, exists }`. Prioridad: PendingFile (macOS "Open with", `exists` siempre `true`) > argv[1] (resuelto con `resolve_open_arg`, `exists: false` si el path todavía no existe) |
| `install_cli_command` | `() -> Result<String>`          | Solo macOS (error explicativo en otras plataformas). Symlink de `current_exe()` a `/usr/local/bin/portable-editor`: intenta sin privilegios primero, si falla pide admin vía `osascript` con `quoted form of` (no interpola paths directo en el script — ver trampa #17) |
| `save_recovery` | `(path, contents) -> Result<()>`    | Dump (no atómico) a `app_data_dir()/recovery/<hash(path)>.recovery`. Llamado cada 10 s si `doc.dirty` (`AUTOSAVE_INTERVAL_MS` en `main.ts`) |
| `read_recovery` | `(path) -> Result<Option<String>>` | `None` si no hay recovery para ese path |
| `clear_recovery` | `(path) -> Result<()>`             | Best-effort (ignora si no existe); se llama tras guardar o al descartar cambios explícitamente |
| `signal_ready` | `()`                                | Imprime `PORTABLE_EDITOR_READY` a stdout (con flush explícito) al final de `init()`. Solo para benchmarking de arranque (`scripts/bench-startup.sh`) — no lo usa nada en runtime |

### Eventos (Rust → frontend, vía `emit`/`listen`)

| Evento      | Payload  | Emisores                                                            |
| ----------- | -------- | ------------------------------------------------------------------- |
| `open-file` | `StartupTarget` (`{ path, exists }`) | 1) `RunEvent::Opened` en macOS (app corriendo, `exists` siempre `true`), 2) callback de single-instance (segunda invocación CLI, vía `resolve_open_arg`) |
| `menu-action` | `string` (id del ítem: `"new"`\|`"open"`\|`"save"`\|`"save_as"`\|`"shortcuts"`) | `on_menu_event` en `build_menu()`, ante click o accelerator de un ítem del menú nativo |

Todo camino de apertura del frontend converge en `openFile()` de `main.ts` (archivo existente) u `openNewFileAt()` (path que todavía no existe — CLI/"Open with..." a un archivo por crear), ambos con el guard de cambios sin guardar. **No crear caminos alternativos que llamen a `read_file` sin pasar por `openFile()`** (única excepción: `restoreSession()` y `reloadFromDisk()`, que son deliberadamente silenciosos).

## Estado

### En memoria (`main.ts`)

- `doc: DocState` — `{ path, dirty, mtime, encoding, eol, missing, indent }`. Única fuente de verdad sobre el archivo abierto. `encoding` es solo para mostrar en la status bar: tras cada guardado exitoso se resetea a `"UTF-8"` (política de guardado). `eol` sí importa funcionalmente: viaja de vuelta a `write_file` en cada guardado. `missing` lo pone `checkExternalChange()` cuando `file_mtime` falla (archivo borrado/renombrado); mientras esté en `true`, `saveFile()` se comporta como `saveFileAs()`. `indent` se re-detecta (`indent.ts`) en cada apertura/recarga; no persiste entre sesiones — es una propiedad del archivo, no una preferencia global.
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
`saveFile()`/`saveFileAs()` → `invoke write_file` (atómico, con `eol` de `doc.eol`) → `refreshMtime()`. El refresh de mtime post-guardado es **obligatorio**: sin él, el polling detectaría el propio guardado como cambio externo. `writeTo()` resetea `doc.encoding` a `"UTF-8"` al terminar: el guardado siempre reescribe el archivo en UTF-8, así que mostrar el encoding original después sería mentir.

### Cambios externos
Poll cada 2 s + al enfocar la ventana (`checkExternalChange`):
- mtime distinto y **sin** cambios locales → recarga silenciosa con `editor.replaceText()` (preserva cursor e historial de undo).
- mtime distinto y **con** cambios locales → prompt. Se actualiza `doc.mtime` antes de preguntar para no repetir el prompt por el mismo cambio.
- `file_mtime` falla (archivo borrado o renombrado) → `doc.missing = true`, status bar muestra "(deleted on disk)", sin diálogo (no hay con qué interactuar). Si una siguiente poll vuelve a leer el mtime OK, se limpia solo. Mientras esté `missing`, `saveFile()` redirige a `saveFileAs()` en vez de reescribir un path que ya no existe.

Decisión: polling en vez de watcher nativo (`notify`). Es un solo archivo; un `stat` cada 2 s es gratis y evita una dependencia y el manejo de estado del watcher.

### Recuperación de crash (autosave)
Cada 10 s (`AUTOSAVE_INTERVAL_MS`), si `doc.dirty` y `doc.path !== null` → `invoke save_recovery`. No es atómico ni crítico: perder un dump a mitad de escritura solo significa recuperar un snapshot un poco más viejo la próxima vez, no corrompe nada real (a diferencia de `write_file`).

Al abrir un archivo (`openFile`, `restoreSession`, `openNewFileAt`) se compara el contenido recién leído del disco contra un posible recovery leftover (`checkRecovery`):
- Sin recovery, o igual al disco → se usa el disco tal cual, se limpia cualquier recovery viejo.
- Distinto → pregunta antes de usarlo. Si el usuario acepta, el contenido recuperado reemplaza al del disco y `doc.dirty` se fuerza a `true` (hay que guardarlo para que persista de verdad).

El recovery se limpia (`clearRecovery`) en tres momentos: guardado exitoso (`writeTo`), el usuario elige NO recuperar, o se abandona el documento actual al abrir otro (`confirmDiscard` pasa). **Alcance deliberado**: solo documentos con `doc.path` real. Un buffer 100% untitled (`Mod+N`, nunca asociado a un path) no tiene una clave estable entre lanzamientos de la app — si se pierde antes de guardar, se pierde. Ver ROADMAP para por qué no se cubre.

### "Open with..." del sistema
- **Linux**: el path llega por argv → `startup_file` lo resuelve.
- **macOS**: el path NO llega por argv; llega como `RunEvent::Opened` (AppleEvent). Dos casos:
  - App arrancando: el evento llega antes de que el frontend escuche → se guarda en `PendingFile` (estado managed) y `startup_file` lo consume.
  - App corriendo: se emite `open-file` y el frontend lo abre al toque.

### Instancia única
`tauri-plugin-single-instance`: la segunda invocación no abre ventana; su callback enfoca la existente y, si hay argv de archivo, lo resuelve contra el `cwd` de la segunda invocación y emite `open-file`.

El frontend, al recibir `open-file` (o el path de arranque en frío), llama a `openFile`/`openNewFileAt` con `external: true`. Eso activa `confirmExternalReplace()` además del `confirmDiscard()` de siempre: si hay un archivo real abierto (`doc.path !== null`), pregunta antes de reemplazarlo — **incluso sin cambios sin guardar**. Es la diferencia con una apertura in-app (botón, menú File, recientes): ahí no tiene sentido preguntar "¿reemplazar?" si no hay nada que perder, pero una apertura que llega desde afuera (otra invocación de CLI, "Open with...") puede interrumpir algo que el usuario está mirando sin haberlo pedido desde dentro de la app.

**Esto es un parche al síntoma, no una resolución del límite de fondo**: sigue existiendo una sola ventana posible (ver ROADMAP, "Hallazgos de revisión externa", ítem 3). Si en el futuro se decide soportar múltiples ventanas, `confirmExternalReplace()` deja de ser necesario para el caso "segunda invocación con archivo" (abriría ventana nueva en vez de preguntar) — no lo hagas más complejo de lo que es a la espera de esa decisión.

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
7. **`tauri dev` con argumento**: los args CLI se prueban con el binario compilado o `npm run tauri dev -- -- -- archivo.txt` (doble `--`). Ojo: el binario en `target/debug/` sigue dependiendo del servidor de Vite para cargar el frontend — si lo invocás directo desde otra terminal con `npm run tauri dev` ya detenido, la ventana abre en blanco (sin editor ni status bar, solo el título). No es un bug de la app, es nomás que no hay nada que cargar. No pasa con el bundle de release (frontend embebido, sin dependencia externa).
8. Las **asociaciones de archivo** solo existen con la app instalada desde el bundle; en dev no funcionan.
9. **La detección de Windows-1252 es una heurística de último recurso**, no un chardet real: si los bytes no tienen BOM y no son UTF-8 válido, se asume Windows-1252 porque nunca falla al decodificar (mapea todo byte a algún codepoint). Para textos legado que no sean de alfabeto latino (Shift-JIS, etc.) el resultado va a ser basura legible-pero-incorrecta, no un error. Es una decisión consciente de simplicidad (ver ROADMAP), no un bug.
10. **El chequeo de tamaño en `read_file` va antes de `std::fs::read`, no después.** El orden importa: es lo que evita cargar un archivo de varios GB a memoria solo para descartarlo. No "simplificar" juntando ambos pasos.
11. **No agregar `PredefinedMenuItem::quit` al menú sin resolver esto antes**: en Tauri, Quit saltea `onCloseRequested` y llama `exit(0)` directo — el guard de "cambios sin guardar" nunca se ejecuta. Bug conocido y abierto en Tauri (issues #3124/#7586/#13511). Por eso hoy no hay Quit en el menú.
12. **Cada accelerator del menú nativo (`build_menu`) es dueño único de su atajo — y esto aplica también contra los keymaps internos de CodeMirror, no solo contra el keydown handler de `main.ts`.** `Mod+N/O/S/Shift+S` fueron sacados a propósito del keydown handler de `main.ts` (evita doble disparo, ej. dos diálogos de "Save as" a la vez). Pero un accelerator nuevo puede chocar igual con un binding que CodeMirror ya trae de fábrica en `basicSetup` (`defaultKeymap`, `searchKeymap`, `historyKeymap`, etc.) sin que nadie lo note: el menú nativo reclama la key equivalent a nivel de sistema (AppKit en macOS, accel groups en GTK) ANTES de que el evento llegue al webview, así que CodeMirror ni se entera de que existía un binding suyo para esa tecla — no hay conflicto visible, el atajo de CodeMirror simplemente deja de andar. Pasó con `Mod+/` (trampa #21). Antes de asignarle un accelerator nuevo a un ítem de menú, chequear contra el código fuente instalado de `@codemirror/commands` (no de memoria), no solo contra `main.ts`.
13. **El panel de búsqueda de CodeMirror (`Mod+F`) se tematiza en `styles.css` (`#editor .cm-panel.cm-search`), no en `themes.ts`.** Es chrome del programa, no contenido del editor — mismo criterio que la status bar. No moverlo a `buildTheme()`: haría 4 variantes ligeramente distintas en vez de una consistente, y dejaría afuera a One Dark (no pasa por `buildTheme()`). El botón de cerrar (`button[name="close"]`) viene `position: absolute` del base theme de CM6; hay que pisarlo a `static` o `margin-left: auto` no hace nada.
14. **El botón de indentación de la status bar NO reconvierte el código existente**, solo configura cómo se indenta lo que se escribe de ahora en más (`indentUnit`). Es comportamiento estándar (VS Code también lo separa en un comando aparte) — no "arreglarlo" para que reformatee el documento sin evaluar primero el riesgo de corromper líneas de alineación (ver ROADMAP Fase 4, ítem 3).
15. **`write_file` escribe A TRAVÉS de los symlinks, no sobre ellos.** `resolve_symlink_target()` resuelve el target real antes del `tmp_path`/`rename` — si no existiera ese paso, el `rename()` reemplazaría el symlink mismo por un archivo plano (rompiendo dotfiles manejados con Stow/chezmoi/Nix). No "simplificar" quitando esa resolución.
16. **`Path::canonicalize()` requiere que el archivo YA exista** — falla con `NotFound` si no. Por eso `resolve_open_arg()` no lo usa solo: intenta `canonicalize()` primero y cae a `std::path::absolute()` (no toca el filesystem, no exige existencia) si falla. No volver a un `.canonicalize().ok()` pelado para resolver argumentos de CLI — eso es exactamente el bug que tenía antes (un `portable-editor archivo-nuevo.txt` se ignoraba en silencio).
17. **`install_cli_command` pasa el path del ejecutable a `osascript` como argv, no interpolado en el texto del script.** El AppleScript lo shell-quotea con `quoted form of` antes de meterlo en `do shell script ... with administrator privileges`. No "simplificar" volviendo a un `format!("... {path} ...")` armado a mano — eso corre con privilegios de admin, y un path con comillas rompería el escaping (command injection).
18. **El recovery de autosave va a `app_data_dir()`, no a `localStorage`.** Se evaluó `localStorage` (ya se usa para tema/fuente/wrap/recientes) y se descartó a propósito: es síncrono (bloquearía el hilo de UI en cada dump) y tiene límite de tamaño (~5-10 MB típico) — justo lo que rompería para los archivos de hasta 100 MB que Fase 3 ya soporta. No migrar el recovery a `localStorage` "por consistencia" sin releer esto.
19. **`cargo build --release` a secas produce un binario con la ventana en blanco.** La elección entre `devUrl` (servidor de Vite) y `frontendDist` (assets embebidos) la resuelve el CLI de Tauri al invocar la compilación — no es un `#[cfg(debug_assertions)]` en el código. Un `cargo build --release` corrido por afuera de `tauri dev`/`tauri build` NO usa el frontend embebido correctamente: abre una ventana sin nada, ni siquiera el HTML estático (botones de la status bar). Para probar/benchmarkear un binario de producción real sin el bundle completo: `npm run tauri build -- --no-bundle`. Ver `docs/RELEASE.md`.
20. **`println!` con stdout redirigido a archivo/pipe es block-buffered, no line-buffered.** Si el proceso muere por `kill -9` (sin shutdown limpio) antes de que el buffer se vacíe, el output se pierde entero — pasó con `signal_ready` hasta que se le agregó `stdout().flush()` explícito. Cualquier print pensado para ser leído por un script externo que mate el proceso necesita flush explícito.
21. **El accelerator de "Keyboard Shortcuts" es `Mod+Shift+/`, no `Mod+/`.** `Mod+/` es `toggleComment` en el `defaultKeymap` de CodeMirror — un menú nativo con ese accelerator se lo comía sin avisar (ver trampa #12), dejando "comentar línea" inalcanzable por teclado en las dos plataformas. No volver a `Mod+/` para este ítem.
22. **`detect_eol()` decide por mayoría de línea, no por "¿aparece CRLF en algún lado?".** La versión vieja hacía `text.contains("\r\n")`: un solo `\r\n` colado en un archivo mayormente LF (típico de pegar un snippet de Windows) convertía TODO el archivo a CRLF al guardar, generando diff-churn en git por una sola línea. `mixed_eol` (`text_io.rs`, `doc.mixedEol` en `main.ts`) expone cuando el archivo realmente mezclaba ambos estilos, sin importar cuál ganó el voto — se muestra en la status bar como "LF (mixed)"/"CRLF (mixed)". No volver a "any CRLF" para decidir `eol`.
23. **Los eventos `open-file` se procesan por una cola serial (`openFileQueue`), no en paralelo.** El listener de `main.ts` disparaba `openFile()`/`openNewFileAt()` directo por cada evento, sin esperar al anterior — dos invocaciones CLI casi simultáneas (`portable-editor a.txt` seguido de `portable-editor b.txt` en rápida sucesión) corrían sus diálogos de confirmación y mutaciones de `doc` en paralelo, con el orden de resolución dependiendo de cuál diálogo cerraba primero el usuario. A diferencia de `checkingExternal` (trampa siguiente en espíritu, ver `checkExternalChange()`), acá NO se puede descartar el segundo evento si el primero sigue en curso: no hay un próximo poll que lo vuelva a intentar, así que "descartar" sería tirar en silencio un archivo que el usuario pidió abrir explícitamente. Por eso es una cola (`.then()` encadenado), no un booleano de "ocupado".
24. **`recovery_key()` usa FNV-1a a mano, no `DefaultHasher`.** `DefaultHasher` documenta explícitamente que su algoritmo NO está garantizado estable entre versiones de Rust — un cambio de toolchain entre releases podría cambiar la clave de TODOS los recovery pendientes en silencio, dejando inalcanzable el recovery de un crash anterior a la actualización, sin ningún error visible. FNV-1a es aritmética pura, no puede cambiar por debajo. Costo aceptado y único: cualquier recovery YA pendiente en disco al momento de este cambio (creado con la clave vieja de `DefaultHasher`) queda huérfano una sola vez al actualizar — se consideró preferible a dejar el riesgo abierto indefinidamente hacia adelante. El test `key_matches_a_known_fnv1a_value` fija el algoritmo exacto: si hace falta cambiarlo de nuevo, que sea a propósito (con plan de migración), no un swap accidental de función de hash.
25. **`saveFile()` no escribe si `doc.dirty` es `false`.** El fallback a Windows-1252 (trampa #9 / ROADMAP sección 7 ítem 1) nunca falla al decodificar, así que abrir un binario por error no da ningún error — y sin este guard, un `Mod+S` reflejo sin haber editado nada reescribía el archivo original como "texto" en UTF-8, corrompiéndolo. El guard va DESPUÉS del chequeo de `doc.path === null || doc.missing` (esos casos siempre necesitan `saveFileAs()`, tengan o no contenido). `confirmOpenBinary()` (basado en `likely_binary`, ver trampa #9) es la otra mitad de la defensa, pero solo corre en `openFile()` — `restoreSession()` la salta a propósito (mismo criterio que el resto de sus guards, ver invariante #3 de `CLAUDE.md`), así que el guard de `dirty` es el que también cubre reabrir un binario al reiniciar la app.

## Verificación

- Frontend: `npm run lint` (Biome), `npm run typecheck` (tsc) y `npm run test` (Vitest) — los tres en verde antes de dar por bueno un cambio.
- Rust: `cargo fmt` local; `cargo clippy -- -D warnings` y `cargo test` corren en CI (ambos compilan, así que localmente los corre el dev cuando quiere).
- CI (`.github/workflows/ci.yml`): todo lo anterior en cada push/PR a main. El workflow de release es aparte (`release.yml`).
- La lógica pura testeable vive separada del wiring: `src/recent.ts`, `src/prefs.ts`, `src/paths.ts` (sin DOM ni Tauri) con sus `*.test.ts` al lado. `main.ts` solo orquesta.
- Smoke test manual pre-release: `docs/SMOKE-TEST.md`.
