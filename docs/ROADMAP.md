# Roadmap y madurez — portable-editor

Diagnóstico honesto del estado del proyecto y plan de evolución en fases, con criterios de salida verificables. Última actualización: 2026-08-25.

## 1. Diagnóstico de madurez

| Dimensión                | Estado | Detalle                                                                 |
| ------------------------ | :----: | ----------------------------------------------------------------------- |
| Funcionalidad core       | 🟢     | Editar/abrir/guardar completo, 4 vías de apertura, temas, ~150 lenguajes |
| Robustez                 | 🟢     | Guardado atómico, cambios externos, encodings, EOL, archivos enormes y archivo borrado — todos ✔ (Fase 3 completa) |
| Arquitectura             | 🟢     | Capas claras, IPC mínimo, módulos con responsabilidad única              |
| Documentación            | 🟢     | README, ARCHITECTURE, RELEASE, CLAUDE.md — por encima de la media        |
| Tests automatizados      | 🟡     | Lógica pura con Vitest (67 tests) y `cargo test` (56); sin E2E todavía (smoke test manual)   |
| CI de calidad            | 🟢     | Biome, tsc, Vitest, rustfmt y clippy en cada push/PR                     |
| Lint/format              | 🟢     | Biome (frontend) + rustfmt/clippy (backend)                              |
| Distribución             | 🟢     | Íconos propios ✔; release v0.1.0 publicado y firmado/notarizado (macOS arm64+x64, .deb, .rpm, .AppImage) |
| Legal/comunidad          | 🟢     | Apache-2.0 + NOTICE, CHANGELOG, CONTRIBUTING, templates de issues        |

**Veredicto: alpha con robustez completa.** Fase 3 terminada — quedan resueltos todos los casos borde del mundo real que tenía identificados (encodings, EOL, archivos enormes, archivo borrado). Lo único que separa esto de beta ya no es código: es que un usuario real, que no seas vos, lo use y reporte algo.

### Modelo de referencia

| Nivel         | Criterio de entrada                                                    | Estado |
| ------------- | ---------------------------------------------------------------------- | :----: |
| Prototipo     | Funciona en la máquina del autor                                       | ✅ |
| Alpha         | Red de seguridad (tests + CI + lint), licencia, release reproducible   | ✅ |
| Beta          | Robustez completa, usuarios externos reportando, feedback loop         | ✅ acá (robustez) — falta feedback externo |
| 1.0           | Estable en uso real, limitaciones conocidas resueltas o documentadas   | Fase 4+ |

---

## 2. Fase 1 — Red de seguridad (antes que cualquier feature) ✅ 2026-07-07

**Objetivo:** que un cambio roto no pueda llegar a `main` sin ser detectado.

1. **LICENSE** — elegir y commitear. MIT si querés máxima adopción y simpleza; Apache-2.0 si te importa la protección explícita de patentes. Sin esto el repo público no es usable legalmente por terceros.
2. **ESLint + Prettier** (frontend) y **rustfmt + clippy** (backend), con config commiteada. Cero warnings como línea base.
3. **CI de calidad** (`.github/workflows/ci.yml`): en cada push/PR correr `tsc --noEmit`, ESLint, `cargo clippy -- -D warnings`, `cargo fmt --check`. En Linux, con las system deps de Tauri cacheadas.
4. **Tests unitarios de lógica pura** con Vitest. Candidatos inmediatos (extraer de `main.ts` a módulos testeables sin DOM):
   - parsing/validación de recientes (`isRecentEntry`, upsert, poda, límite)
   - clamping de fuente y de cursor
   - `basename`/detección de extensión
5. **CHANGELOG.md** (formato Keep a Changelog) — arrancarlo ahora que la historia es corta.
6. **Checklist de smoke test manual** en `docs/` (abrir/editar/guardar/temas/wrap/recientes/cambio externo/CLI) para correr antes de cada release, hasta que exista E2E.

**Criterio de salida:** un PR con un bug de tipos, lint o un test roto NO puede mergearse en verde. LICENSE en la raíz.

---

## 3. Fase 2 — Primer release público (v0.1.0) ✅ 2026-08-19

**Objetivo:** artefactos instalables por terceros, proceso de release ejercitado de punta a punta.

1. Íconos propios (`npm run tauri icon`) ✔
2. Workflow de release ejecutado con tag real (`v0.1.0`): .dmg arm64/x64, .deb, .rpm, .AppImage. Validado manualmente en macOS por el autor. ✔
3. Firma y notarización de Apple (Developer ID Application) configuradas antes del primer release — se adelantó el ítem de Fase 5 porque ya había certificado disponible. El `.dmg` no muestra advertencia de Gatekeeper; las release notes con instrucciones de `xattr -cr` quedaron sin uso. ✔
4. Templates de issues (bug report con SO/versión/pasos) y `CONTRIBUTING.md` corto que apunta a `docs/ARCHITECTURE.md` y a las convenciones de `CLAUDE.md`. ✔

**Criterio de salida:** una persona que no sos vos instala el editor desde GitHub Releases y edita un archivo sin ayuda.

> **Pendiente real:** el criterio de salida tal como está escrito requiere una instalación de un tercero, y hoy solo está validado por el autor en su propia máquina. La fase se da por cerrada porque el pipeline de distribución (build, firma, notarización, publicación) quedó probado de punta a punta — que es lo que bloqueaba avanzar — pero la validación por un tercero real sigue abierta. Vale la pena pedirle a alguien externo que instale desde el release y confirme, aunque sea informalmente.

---

## 4. Fase 3 — Robustez restante (camino a beta)

**Objetivo:** que los casos borde del mundo real no rompan la confianza.

1. ~~**Encodings**~~ ✅ 2026-08-19 — `read_file` detecta BOM (UTF-8/UTF-16), UTF-8 estricto, y cae a Windows-1252 como último recurso (nunca falla al decodificar). Política de guardado: siempre UTF-8, documentada en `docs/ARCHITECTURE.md`. Lógica en `src-tauri/src/text_io.rs`, testeada con `cargo test`.
2. ~~**Archivos enormes**~~ ✅ 2026-08-19 — `read_file` chequea el tamaño vía metadata *antes* de leer: por encima de 100 MB rechaza sin cargar nada a memoria (mensaje de error nativo, mismo patrón que cualquier otro error de lectura). Por encima de 10 MB, abre normal pero sin highlighting (status bar: "Plain text (highlighting off, large file)"). Umbrales en `text_io::MAX_FILE_SIZE_BYTES` (Rust) y `HIGHLIGHT_SIZE_LIMIT` (`main.ts`).
3. ~~**Archivo borrado/renombrado bajo los pies**~~ ✅ 2026-08-19 — el polling marca `doc.missing` cuando `file_mtime` falla; la status bar muestra "(deleted on disk)" y `Mod+S` pasa a comportarse como "Save as" en vez de reescribir un path que ya no existe. Se limpia solo si el archivo reaparece (ej. un rename ajeno en curso) o al guardar en una ubicación nueva.
4. ~~**EOL**~~ ✅ 2026-08-19 — detectado (LF/CRLF) y visible en la status bar; se preserva al guardar. Mismo módulo que encodings.
5. **E2E mínimo** (opcional pero deseable): `tauri-driver` + WebDriver para el happy path abrir→editar→guardar. Evaluar costo/beneficio: si resulta frágil en CI, el smoke test manual de Fase 1 sigue siendo la línea de defensa.

**Criterio de salida:** el smoke test incluye los casos borde y pasa; los issues de "no abre mi archivo" tienen respuesta de producto, no excusa.

---

## 5. Fase 4 — Crecimiento (features, siempre dentro de la identidad)

Orden sugerido por relación valor/complejidad:

1. ~~**Menú nativo**~~ ✅ 2026-08-19 (alcance recortado a propósito) — `build_menu()` en `lib.rs` arma **File** (New/Open…/Save/Save As…, cada uno dueño único de su accelerator) y **Help** (Keyboard Shortcuts → panel propio en el webview; About con la versión real de `Cargo.toml` vía `env!`). En macOS, About vive en el menú de la app (convención nativa), no en Help. Clicks/atajos van por `on_menu_event` → `emit("menu-action", id)` → `main.ts` escucha y despacha.
   - **Deliberadamente sin Edit ni View/Window**: `PredefinedMenuItem::quit` saltea `onCloseRequested` (bug conocido y abierto en Tauri — issues #3124/#7586/#13511), así que ningún ítem de menú puede terminar la app todavía sin arriesgar pérdida de datos silenciosa. Undo/Redo/Cut/Copy/Paste de CodeMirror corren por su propio `history()`, no por el undo manager del OS — agregar esos `PredefinedMenuItem` sin poder probarlo en vivo es arriesgar un ítem que aparenta funcionar y no hace nada.
   - **Pendiente real, no urgente**: resolver el bypass de Quit (interceptar `RunEvent::ExitRequested` + coordinar con `doc.dirty` del frontend) antes de agregar Quit al menú. Recién ahí tiene sentido evaluar Edit/View/Window.
2. ~~**Go to line**~~ ✅ 2026-08-19 (sin código) — el ítem asumía que faltaba el keybinding, pero `Mod-G` ya está tomado por `findNext` (`searchKeymap`, parte de `basicSetup`). El default de `@codemirror/search` para gotoLine es `Mod-Alt-G`, y ya funciona out of the box. Verificado por el autor. Se decidió no pisarle la tecla a `findNext` — `Mod+G` sigue siendo "buscar siguiente" (con `F3`/`Shift+F3` como alternativa).
3. ~~**Indentación**~~ ✅ 2026-08-19 — detección automática (`src/indent.ts`, heurística: tabs vs. espacios por conteo de líneas, ancho = menor indentación no-cero) al abrir, con botón en la status bar (`Spaces: 2/4/8` / `Tabs`, cicla al click) vía `indentUnit` en un Compartment de `editor.ts`. Es por-archivo, no persiste entre sesiones a propósito — la indentación es una propiedad del archivo, no una preferencia como tema/fuente.
   - **Deliberadamente fuera de alcance: reconvertir la indentación de código YA escrito.** El botón solo configura cómo se indenta código nuevo (comportamiento estándar de cualquier editor — VS Code también lo separa en un comando aparte, "Convert Indentation to..."). Reconvertir lo existente con matemática simple de whitespace corrompe líneas de alineación (parámetros multilínea, etc.) que no son indentación de bloque; hacerlo bien requiere entender la sintaxis del lenguaje — eso es un formateador tipo Prettier, no un toggle, y raya con el guardrail de "no LSP/no IDE". Si en el futuro se justifica, la versión seria a construir es conservadora: convertir solo líneas cuya indentación sea múltiplo exacto del ancho viejo, dejar el resto intacta en vez de adivinar.
4. ~~**Búsqueda con estilo propio**~~ ✅ 2026-08-19 — tematizado en `styles.css` (`#editor .cm-panel.cm-search`), no en `themes.ts`/`buildTheme()`: es chrome del programa, no contenido del editor, mismo criterio que la status bar (dark/light binario, no 4 variantes por paleta). Beneficio extra: los 4 temas quedan consistentes, incluido One Dark (que no pasa por `buildTheme()`).
5. **Settings file opcional** (`~/.config/portable-editor/settings.json`): fuente, tamaño, tema, wrap. Solo si los pedidos reales lo justifican — localStorage ya cubre el 90%.
6. **Más temas** — costo marginal casi nulo con el registro actual (paleta + entrada en `THEMES`).
7. **Command palette** (`Mod+K`) — evaluar recién cuando la cantidad de acciones lo amerite; con el menú nativo (ítem 1) cubriendo la discoverability, esto pierde bastante urgencia.

### Qué NO va a tener (guardrails de identidad)

Tabs multi-archivo, árbol de archivos, LSP/autocompletado, git integrado, terminal embebida, sistema de plugins. Cada una convierte el editor en un IDE de juguete que compite (y pierde) contra VS Code/Zed. La ventaja competitiva es abrir rápido (~470 ms medidos, no instantáneo tipo app nativa, pero un orden de magnitud más rápido que un IDE Electron con extensiones) y no estorbar. **Un feature request que viole esto se cierra con gracia y un link a esta sección.**

---

## 6. Hallazgos de revisión externa (2026-08-19)

Dos reviews independientes (agentes `architect` y `stark`) sobre el estado del proyecto post-Fase 4. Ambos convergieron, desde ángulos distintos, en el mismo patrón: fallas silenciosas alrededor de la identidad/integridad del archivo — la app hace algo distinto de lo que el usuario pidió y no lo avisa. Se decidió no esperar a feedback externo para estos: por ser fallas *invisibles*, nadie las va a reportar — quien las sufra probablemente pierda confianza y deje de usar el editor en silencio, sin avisar por qué.

1. ~~**Guardado atómico rompe symlinks**~~ ✅ 2026-08-20 (`architect`, verificado empíricamente) — `write_file` resuelve el symlink a su target real (`resolve_symlink_target()`) antes de escribir, así el `rename()` atómico reemplaza el archivo real y no el link. Verificado con un symlink real: sobrevive intacto (`test -ef` confirma mismo archivo) tras editar y guardar a través de él. Documentado en `ARCHITECTURE.md`, trampa #15.
2. ~~**CLI con archivo inexistente se ignora en silencio**~~ ✅ 2026-08-20 (`architect`, verificado) — `resolve_open_arg()` reemplaza el `.canonicalize().ok()` que descartaba el error: si el archivo no existe, cae a `std::path::absolute()` (no requiere existencia) y `startup_file`/`open-file` devuelven `{ path, exists: false }`. El frontend (`openNewFileAt()`) abre un editor vacío con `doc.path` ya seteado al path pedido — `Mod+S` guarda directo ahí, sin "Save as". Verificado por el autor: `npm run tauri dev -- -- -- archivo-nuevo.txt` abre vacío con el nombre correcto en la status bar, y guarda al path pedido.
3. **Instancia única fusiona "un documento a la vez" con "un proceso a la vez"** (`stark`) — el síntoma reportado (doble click en un segundo archivo reemplazaba el abierto sin diálogo, si no tenía cambios sin guardar) está ✅ 2026-08-20 **parcheado**: `confirmExternalReplace()` en `main.ts` pregunta antes de reemplazar un archivo real ya abierto cuando la apertura viene de afuera (evento `open-file`), incluso sin cambios sin guardar. Verificado con dos procesos reales (binario compilado invocado dos veces) — cancelar mantiene el archivo A, confirmar pasa al B.
   - **La pregunta arquitectónica de fondo sigue sin resolver, a propósito**: ¿el guardrail de identidad es "un buffer por ventana" (compatible con N ventanas simultáneas, como TextEdit/gedit) o quedó soldado a "un proceso por sistema" sin que nadie lo decidiera así explícitamente? Se evaluó la opción de multi-ventana (segunda invocación con archivo → ventana nueva) y se decidió conscientemente ir por el parche más chico primero — sigue sin poder haber 2 ventanas del editor abiertas a la vez. Retomar si el feedback real confirma que este límite molesta en la práctica.
   - **Investigación previa (2026-08-20), para no repetirla si se retoma**: crear ventanas desde el callback de `tauri-plugin-single-instance` probablemente necesita `AppHandle::run_on_main_thread()` (ese callback puede no correr en el main thread, y crear ventanas en macOS/Linux sí lo requiere). En macOS `app.set_menu()` es app-wide (una sola barra para todas las ventanas); en Linux/Windows el menú es **por ventana** (`WebviewWindow::set_menu()`) — cada ventana nueva necesita que se lo asignen a mano. **Sin confirmar**: si `MenuEvent` (el callback de `on_menu_event`) permite saber de qué ventana vino el click en Linux/Windows — si no, un click en el menú de una ventana podría despachar el evento a todas. No hay máquina Linux en este proyecto todavía para probarlo — cualquier intento de multi-ventana debería probarse ahí antes de darlo por bueno, no asumir que "funciona igual que en macOS".
4. **Fallback a Windows-1252 sin alarma fuerte** (`stark`) — para texto no latino (Shift-JIS, etc.) decodifica sin error, se ve legible-pero-incorrecto, y el guardado atómico reescribe el archivo corrompido sin aviso destacado. Relacionado con la trampa #9 ya documentada, pero el punto nuevo es que hoy no hay ninguna señal *fuerte* (más que el label discreto de la status bar) cuando la heurística cae al peor caso.

### Seguimiento: "¿me sacás del hábito instalado?" (`stark`, 2026-08-20)

Pregunta distinta a las anteriores — no arquitectura/riesgo, sino uso real: *¿elegirías portable-editor sobre vim/VS Code/Sublime para editar algo rápido en el momento?* Veredicto de stark: hoy no, y de las 4 razones que dio, la primera es la que más plata deja sobre la mesa.

1. ~~**No está en el PATH sin trabajo manual**~~ ✅ 2026-08-20 — antes el README pedía un `sudo ln -s` a mano. Ahora hay un ítem en el menú Help (solo macOS; Linux ya lo resuelve el .deb/.rpm), `install_cli_command`, que crea el symlink a `/usr/local/bin/portable-editor` — sin privilegios si puede, con el diálogo nativo de admin de macOS si hace falta. Verificado por el autor: diálogo de admin apareció, `which portable-editor` resuelve, y corre desde una terminal nueva.
2. ~~**No hay timing de arranque real y publicado**~~ ✅ 2026-08-20 — **~470 ms ± 25 ms** (macOS Apple Silicon, `hyperfine`, 15 corridas, build sin firmar vía `--no-bundle`). Metodología en `docs/RELEASE.md`, script en `scripts/bench-startup.sh`, número en el README. En el camino se encontró y arregló un bug real de la sesión de benchmarking, no del producto: `cargo build --release` corrido a mano (sin pasar por el CLI de Tauri) arma un binario con la ventana en blanco — ver `ARCHITECTURE.md` trampa #19.
3. ~~**Sin autosave/recuperación de crash**~~ ✅ 2026-08-20 — `save_recovery`/`read_recovery`/`clear_recovery` en Rust escriben a un directorio de recovery en `app_data_dir()` (NO `localStorage`: ya soportamos archivos de hasta 100 MB, y `localStorage` es síncrono y con límite de tamaño — hubiera sido contraproducente justo para los archivos grandes). Cada 10s, si `doc.dirty`, se dumpea la clave asociada al path (hash de 64 bits, `recovery.rs`). Al abrir un archivo se compara contra un posible recovery leftover; si difiere del disco, pregunta antes de usarlo. Se limpia solo al guardar o al descartar cambios explícitamente. Solo cubre archivos con path real — un buffer 100% untitled sin guardar nunca no tiene una clave estable entre lanzamientos, queda fuera de alcance a propósito. Verificado en vivo con un crash real (`kill -9` durante edición sin guardar): recuperó el contenido, mostró el diálogo, y limpió el recovery al guardar.
4. **Instancia única** — mismo hallazgo que el ítem 3 de arriba, visto desde el ángulo de "necesito mirar un segundo archivo a mitad de la tarea urgente". Ya parcheado el síntoma (confirmación antes de reemplazar); la pregunta de fondo (multi-ventana) sigue abierta.

---

## 7. Hallazgos de revisión QA (2026-08-25)

Revisión del agente `qa` sobre flujos de archivo, encoding/EOL, sincronización de estado UI, aperturas concurrentes y `localStorage` — posterior al fix de clipboard/`Mod+/` de esta misma fecha. Lo marcado "verificado" se comprobó reimplementando el algoritmo exacto de `text_io.rs` fuera de Rust (no se corrió `cargo build`/`cargo test`, reservados al dev); lo marcado "sospechado" es lectura de código sin correr la GUI. Se tachan a medida que se resuelven, mismo criterio que la sección 6.

**Crítico**

1. ~~**Abrir un archivo binario (PNG/PDF/ejecutable) y guardarlo lo corrompe, incluso sin editar nada**~~ ✅ 2026-08-25 — doble fix: (a) `saveFile()` (`main.ts`) ahora no escribe si `doc.dirty` es `false`, cierra el caso más común (reflejo de `Mod+S` sin haber editado nada); (b) `read_file` agrega `likely_binary` (heurística de git: byte NUL en los primeros 8000 bytes — el fallback a Windows-1252 nunca falla al decodificar, así que es la única señal disponible), y `openFile()` pregunta antes de cargar un archivo que da positivo. `restoreSession()` queda afuera de (b) a propósito (mismo criterio que sus otros guards), cubierta igual por (a). Documentado en `ARCHITECTURE.md` trampas #9 y #36 y `CLAUDE.md` invariante #9. Tests nuevos en `text_io.rs` (`nul_byte_marks_content_as_likely_binary`, `plain_text_is_not_likely_binary`).

**Medio-alto**

2. ~~**EOL mixto (algunas líneas LF, otras CRLF) se homogeneiza en silencio**~~ ✅ 2026-08-25 — `detect_eol()` en `text_io.rs` decide ahora por mayoría de línea, no por `contains("\r\n")`: un archivo mayormente LF con una sola línea CRLF colada ya no se convierte entero a CRLF al guardar (antes sí). Se agrega `mixed_eol`, mostrado en la status bar como "LF (mixed)"/"CRLF (mixed)" cuando el archivo realmente mezclaba ambos estilos — deja de ser silencioso incluso en el caso donde el voto mayoritario "gana" sin cambiar nada. Documentado en `ARCHITECTURE.md` trampa #22 y `CLAUDE.md` invariante #9. Tests nuevos en `text_io.rs`.
3. ~~**`restoreSession()` fallaba en silencio total**~~ ✅ 2026-08-25 — se saltó por error de numeración durante esta misma ronda de fixes (se resolvió el #4 pensando que era el #3; corregido al auditar el listado completo). Mismo diálogo de error que `openFile()` (`message(String(err), ...)`) antes de olvidar la entrada de recientes. Documentado en `ARCHITECTURE.md` trampa #35.
4. ~~**Aperturas CLI concurrentes sin lock**~~ ✅ 2026-08-25 (verificado en vivo por el autor) — el listener de `open-file` en `main.ts` disparaba `openFile()`/`openNewFileAt()` sin esperar al anterior, uno por evento. Fix: `openFileQueue`, una cola serial (`.then()` encadenado) — a diferencia de `checkingExternal`, acá no se puede descartar el segundo evento (no hay próximo poll que lo reintente), así que se encolan en vez de ignorarse. Verificado con el binario de dev real: archivo dirty en pantalla, `portable-editor a.txt` (diálogo de discard sin responder), `portable-editor b.txt` desde otra terminal mientras el primer diálogo seguía abierto. Resultado: al aceptar descartar se ve A cargado por completo y RECIÉN AHÍ aparece el diálogo de B — nunca superpuestos, nunca intercalados. Documentado en `ARCHITECTURE.md` trampa #23.
5. ~~**`DefaultHasher` (Rust) para la clave de recovery no está garantizado estable entre versiones del compilador**~~ ✅ 2026-08-25 — `recovery_key()` (`recovery.rs`) reemplaza `DefaultHasher` por FNV-1a implementado a mano (sin dependencia nueva): pura aritmética, no puede cambiar entre versiones del compilador. Costo aceptado y único: cualquier recovery ya pendiente en disco de antes de este cambio queda huérfano una sola vez al actualizar — preferible a dejar el riesgo abierto indefinidamente hacia adelante. Test `key_matches_a_known_fnv1a_value` fija el algoritmo exacto para que un cambio futuro sea deliberado, no accidental. Documentado en `ARCHITECTURE.md` trampa #24.

**Medio**

6. ~~**Race chica en `checkExternalChange()`**~~ ✅ 2026-08-25 — el guard vive en `reloadFromDisk()` (llamado desde las dos ramas de `checkExternalChange()`, es donde está el único `await` real): compara `doc.dirty` antes y después del `invoke("read_file")`; si pasó de `false` a `true` durante la espera (el usuario tipeó justo en ese gap), pregunta antes de sobreescribir en vez de perder la edición en silencio. Diálogo compartido con la rama ya-dirty vía `confirmReloadDiscard()`, sin duplicar el string ni volver a preguntar cuando el caller ya confirmó. Documentado en `ARCHITECTURE.md` trampa #25.
7. ~~**El dirty flag no se limpia al deshacer hasta el estado ya guardado**~~ ✅ 2026-08-25 — `editor.ts` distingue undo/redo de una edición normal (`tr.isUserEvent("undo"|"redo")`, anotación real de `@codemirror/commands`) y le pasa a `main.ts` el texto resultante; si un undo/redo aterriza exacto en `savedText` (contenido del último save/load), el dirty flag se limpia solo. La comparación de string solo corre en undo/redo, no en cada keystroke — no reintroduce el problema de perf que ya se evita en `detectIndent`/highlighting para archivos grandes. `savedText` es `null` para archivos sin path real (untitled): ahí no hay "guardado" al que volver. Documentado en `ARCHITECTURE.md` trampa #26.
8. ~~**Race entre `autosaveTick()` y el `clearRecovery()` fire-and-forget de `writeTo()`**~~ ✅ 2026-08-25 — `autosaveTick()` recaptura `doc.dirty` (para el mismo `path` que arrancó con, no `doc.path` releído) después de su propio `await`; si un guardado real terminó mientras esa escritura de recovery estaba en vuelo, se re-limpia el recovery en vez de dejarlo con contenido más viejo que lo ya guardado en disco. Documentado en `ARCHITECTURE.md` trampa #27.
9. ~~**`localStorage` sin `try/catch` en ningún punto de `main.ts`**~~ ✅ 2026-08-25 — dos helpers (`safeGetItem`/`safeSetItem`) centralizan el try/catch; todas las 8 llamadas directas a `localStorage.*` pasan a usarlos. Los consumidores (`parseFontSize`, `parseRecent`, `themeById`) ya toleraban `null`/basura, así que degradar a "como si la clave no existiera" no rompe nada río abajo. Documentado en `ARCHITECTURE.md` trampa #28 y `CLAUDE.md` invariante #8.

**Bajo**

10. ~~**Argumentos CLI que empiezan con `-` se ignoraban en silencio**~~ ✅ 2026-08-25 — el filtro `starts_with('-')` no protegía nada real (esta app no tiene flags propios, ni parser de argumentos). Se sacó de `startup_file()` y del callback de single-instance en `lib.rs`; el primer argumento se toma literal. Documentado en `ARCHITECTURE.md` trampa #29 (incluye la forma correcta de resolver la ambigüedad SI algún día se agregan flags reales: el separador `--`).
11. ~~**`install_cli_command` pedía contraseña de admin en toda reinstalación**~~ ✅ 2026-08-25 — `AlreadyExists` no implica falta de permiso, solo que ya se instaló antes. Si `CLI_TARGET` es nuestro propio symlink viejo, se reemplaza sin pedir nada (mismo privilegio que crearlo); solo cae a `osascript` si hay algo distinto ahí. Documentado en `ARCHITECTURE.md` trampa #30.
12. ~~**macOS "Open With" con multi-selección solo abría el primer archivo, sin avisar del resto**~~ ✅ 2026-08-25 — sigue abriendo solo uno (identidad "un archivo a la vez", sin cambios de alcance), pero ahora `StartupTarget.extra_ignored` cuenta cuántos se descartaron y `notifyExtraFilesIgnored()` lo avisa con un diálogo después de abrir el primero. `PendingFile` pasó a guardar el `StartupTarget` completo (no solo el path) para que el dato sobreviva también en el camino de arranque en frío. Documentado en `ARCHITECTURE.md` trampa #31.
13. ~~**`PendingFile` era un slot único, no una cola — un segundo `RunEvent::Opened` durante el arranque frío pisaba al primero**~~ ✅ 2026-08-25 — reutiliza la misma señal del ítem 12: si un segundo evento colisiona antes de que `startup_file()` consuma el primero, se conserva el primer target y se suma al `extra_ignored` en vez de sobreescribir en silencio. Documentado en `ARCHITECTURE.md` trampa #32.
14. ~~**Fallback de tema corrupto usaba `THEMES[0]` en vez de `DEFAULT_THEME_ID`**~~ ✅ 2026-08-25 — `themeById()` cae explícitamente a `DEFAULT_THEME_ID`; si ese id no estuviera en `THEMES` (invariante interno roto), tira un `Error` en vez de fallar en silencio. Documentado en `ARCHITECTURE.md` trampa #33.
15. ~~**`detectIndent()` no tenía guard de tamaño, a diferencia del highlighting**~~ ✅ 2026-08-25 — `DETECT_INDENT_SIZE_LIMIT` (10 MB, mismo valor que `HIGHLIGHT_SIZE_LIMIT` pero declarado aparte a propósito) hace que por encima de eso se salte el scan y use el default (2 espacios) directamente. Test nuevo en `indent.test.ts`. Documentado en `ARCHITECTURE.md` trampa #34.

## 8. Hallazgos de revisión arquitectónica (2026-08-25)

Revisión con tres lentes (Rust/IPC, frontend, QA/CI/docs) sobre HEAD `b9eaf3b`, hallazgos verificados a mano contra el código. Veredicto: dirección de dependencias correcta, TS estricto de verdad, invariantes de `CLAUDE.md` cumplidos. El problema es de otro tipo: la lógica más densa en bugs (abrir / recargar / dirty / recovery) vivía fusionada con DOM e `invoke` en `main.ts` sin cobertura, y cada flujo async reinventaba a mano la regla "¿cambió el mundo mientras esperaba?" — de ahí tres commits seguidos de `fix: race`. El plan ataca eso: primero los bugs concretos, después el lugar donde vive la regla, y recién entonces los tests que hacen que se queden arreglados.

Cada ítem se tacha (`~~...~~ ✅ fecha`) al resolverse, con la trampa/test que lo documenta, igual que en §7.

**Bloque A — Bugs concretos (arreglar primero, cada uno es chico)**

1. ~~**Regresión de `b9eaf3b`: el segundo "Open With" con la app ya corriendo se traga en silencio**~~ ✅ 2026-08-25 — con la app viva, el primer `RunEvent::Opened` encontraba `pending = None`, guardaba el target y emitía; nadie limpiaba `pending` (`startup_file()` corre una sola vez), así que el segundo caía en la rama "cold-start race", sumaba `extra_ignored` a un target que nadie iba a leer y NO emitía. Fix: `PendingFile` pasa a `{ slot, frontend_ready: AtomicBool }`; `startup_file()` hace `take()` del slot y DESPUÉS marca ready (un evento concurrente cae en el slot o ve el flag, nunca ambos ni ninguno). Con ready el handler emite siempre y no toca el slot; sin ready fusiona como antes pero ya no emite (de paso elimina el doble-open cuando el evento caía entre `listen()` y el poll). La decisión vive ahora en `startup::merge_opened()`, pura y testeada (ítem 13). Trampa #32 reescrita; línea nueva en `SMOKE-TEST.md`. Pendiente el smoke test en bundle macOS.
2. ~~**`checkExternalChange()` y `reloadFromDisk()` mutaban `doc` tras un `await` sin verificar que siguiera siendo el mismo documento**~~ ✅ 2026-08-25 — si se abría B mientras el `file_mtime` de A estaba en vuelo, B heredaba el mtime de A; si A había sido borrado, **B** quedaba marcado `missing`; `reloadFromDisk()` podía meter el contenido de A en el buffer de B. `autosaveTick()` ya lo hacía bien (recapturaba `path`). Fix: UN concepto en vez de tres parches — `doc.gen` + `beginDocument()`/`isStale()`; capturado en `checkExternalChange()` (después del stat y en el `catch`) y en `reloadFromDisk()` (después del `read_file` y del diálogo). De paso `openFile()`/`restoreSession()` dejan de mutar `doc.*` antes del `await checkRecovery()`. Documentado en `ARCHITECTURE.md` trampa #37 y `CLAUDE.md` invariante #11. La decisión de `checkExternalChange` es ahora `externalChangeDecision()` en `document.ts`, con tests (ítem 10).
3. ~~**Leak de recovery en Save As**~~ ✅ 2026-08-25 — `writeTo(pathB)` limpiaba el recovery de B, nunca el de A (escrito por `autosaveTick` mientras A estaba dirty); al reabrir A ofrecía "recuperar" contenido ya guardado como B. `saveFileAs()` captura `doc.path` antes de `writeTo()` y limpia su recovery si difiere del destino; también llama `beginDocument()`. Trampa #39.
4. ~~**`init()` sin `try/catch` alrededor de `startup_file`**~~ ✅ 2026-08-25 — si rechazaba, los `setInterval` de polling y autosave nunca se registraban: sesión entera sin red de seguridad, sin síntoma visible. Timers y listener de `focus` se registran ANTES; el bloque de apertura/restauración va en `try/catch` con el mismo diálogo de error que `openFile()`. Trampa #38.
5. ~~**Startup y cola de `open-file` no serializados**~~ ✅ 2026-08-25 — el `listen("open-file")` se registraba al evaluar el módulo y `openFileQueue` arrancaba resuelta, pero `init()` abría/restauraba fuera de la cola (un CLI single-instance durante el arranque corría concurrente con `restoreSession()`). `openFileQueue = init()` en vez de `void init()`. Trampa #38.

**Bloque B — Robustez de escritura y permisos (Rust)**

6. ~~**`write_file` no era atómico ante corte de luz / kernel panic**~~ ✅ 2026-08-25 — sin `sync_all()` antes de `rename`, en APFS/ext4 el rename puede tocar disco antes que los datos del temp → archivo vacío. `fs_ops::write_atomic()`: `write_all` + `sync_all` antes del `rename`. Trampa #40; invariante #2 de `CLAUDE.md` actualizado. Test en `fs_ops::tests`.
7. ~~**Ventana de permisos en el temp**~~ ✅ 2026-08-25 — `fs::write` creaba el temp con umask (0644) y recién después copiaba el modo: un `.env` 0600 quedaba legible en el mismo directorio unos ms. `OpenOptions::mode(original)` + `create_new` + re-`set_permissions` (el mode inicial pasa por umask); se borra un temp huérfano antes de crear. Trampa #41. Test "0600 se preserva" en `fs_ops::tests`.
8. ~~**Archivos de recovery con permisos abiertos**~~ ✅ 2026-08-25 — `save_recovery` escribía copias 0644 de cualquier buffer dirty fuera del directorio original. `recovery_dir()` aplica 0700 en cada llamada; `save_recovery` crea con `mode(0o600)`. Trampa #42. La barrida de snapshots huérfanos se desprende como ítem 22.
9. ~~**`csp: null` en `tauri.conf.json`**~~ ✅ 2026-08-25 — los comandos de path arbitrario son correctos para un editor (el diálogo del OS ES la autorización; no scopear), pero eso descansa en que el webview sea confiable, y CSP es la única defensa barata contra una dependencia npm comprometida. `csp` + `devCsp`: `default-src 'self'`, `style-src` con `'unsafe-inline'` (CodeMirror inyecta `<style>`), `connect-src` con `ipc:`/`http://ipc.localhost` y en dev el HMR de Vite. Trampa #43. **Verificar con `tauri dev` Y con bundle** (el CSP de producción no se ejercita en dev): editor renderiza, temas cambian, diálogos e IPC funcionan, consola sin errores de CSP.

**Bloque C — Seams y tests (lo que hace que A y B se queden arreglados)**

10. ~~**Extraer `src/document.ts` (estado puro del documento)**~~ ✅ 2026-08-25 — `DocState` (ahora con `savedText`, `cursor` y `gen` adentro), `emptyDoc`, `fromDisk`, `docFromFile`, `docFromRecovery`, `nextDirty`, `EXTERNAL_CHANGE` + `externalChangeDecision`. Los cinco sitios que reseteaban 5-8 campos a mano pasan por `becomeDocument(next)` (= `beginDocument()` + `Object.assign`, síncrono — invariante #11 intacto). `afterFileLoaded()` ya no fuerza `dirty = false`: lo decide `docFromFile` (recovered ≠ disk). 20 tests en `document.test.ts` (suite Vitest: 56).
11. ~~**Extraer `src/ipc.ts`**~~ ✅ 2026-08-25 — un wrapper tipado por comando, tipos `DecodedFile`/`StartupTarget`, `MENU_ACTION` const object + `isMenuAction()`; ids verificados contra `build_menu` en `lib.rs` (fuente de verdad, sin cambios). `main.ts` ya no tiene ningún `invoke` directo.
12. ~~**`write_file` devuelve el mtime resultante**~~ ✅ 2026-08-25 — `write_file -> Result<u64>` vía `mtime_ms()` (compartido con `file_mtime`); `writeTo()` asigna `doc.mtime` junto con `dirty = false`; `saveFile()` ya no llama `refreshMtime()`. Elimina el invariante viejo #4 de `CLAUDE.md` ("acordate de llamar `refreshMtime()`"): un invariante "acordate de X después de Y" es un return value que falta. Trampa #44.
13. ~~**Extraer `src-tauri/src/fs_ops.rs` y `startup.rs`**~~ ✅ 2026-08-25 — `fs_ops::write_atomic(&Path, &[u8]) -> io::Result<u64>`, `resolve_symlink_target`, `tmp_path`, `mtime_ms`; `startup::{StartupTarget, PendingFile, resolve_open_arg, merge_opened}`. `lib.rs` queda como wiring del Builder + comandos delgados; los módulos reciben `&Path`, nunca `AppHandle`. 24 tests nuevos con `tempfile` (única dep nueva, dev-only): 11 en `fs_ops` (temp en mismo dir, 0600 preservado, symlink sobrevive, symlink roto reemplazado, mtime devuelto = metadata, dir inexistente falla sin dejar temp, rename fallido limpia el temp, temp huérfano se borra) y 13 en `startup` (6 `resolve_open_arg` incl. nombre con guion inicial; 7 `merge_opened` incl. la regresión del ítem 1 y el conteo multi-evento). `cargo test`: 42.
14. ~~**Pata macOS en CI**~~ ✅ 2026-08-25 — job `rust-macos` en `ci.yml` (`macos-latest`, `cargo clippy --all-targets -D warnings` + `cargo test`, con stub de `dist/`, sin bundle ni firma): todo lo `#[cfg(target_os = "macos")]` deja de compilarse por primera vez en un tag. Además `vite build` en el job frontend (antes solo `tsc`) y `release.yml` usa `npm ci` (misma resolución de lockfile que validó CI). **Pendiente de ver correr en GitHub** — se escribió sin poder ejecutarlo localmente.

**Bloque D — Fricción menor (cuando se pase por ahí)**

15. ~~**Errores tipados en IPC**~~ ✅ 2026-08-25 — `io_error.rs` (`IoError` con `tag = "kind"`: `not_found` | `permission_denied` | `too_large { size, limit }` | `other { message }`, `From<io::Error>`/`From<tauri::Error>`); los seis comandos de IO devuelven `Result<_, IoError>`; `size_limit_error` sale de `text_io.rs`. Frontend: `src/io-error.ts` (sin Tauri) con `isIoError`/`describeIoError`/`errorMessage`, usado en `openFile`/`restoreSession`/`writeTo`. El mensaje genérico conserva el verbo ("Could not read/save") vía `IO_OPERATION` como tercer parámetro — el enum no lleva la operación porque Rust no conoce la intención del usuario. Tests: +3 cargo, +7 Vitest. Trampa #50.
16. ~~**Comandos IO síncronos bloqueaban el main thread**~~ ✅ 2026-08-25 — `read_file`, `write_file`, `save_recovery`, `read_recovery` son `async fn`; helpers de `fs_ops`/`text_io` siguen sync. Trampa #45.
17. ~~**`std::env::args()` hacía panic con argv no-UTF-8 (Linux)**~~ ✅ 2026-08-25 — `args_os()` en `startup_file()`, `resolve_open_arg(&Path, &Path)`; test con nombre no-UTF-8. El callback de single-instance no se puede blindar (el plugin entrega `Vec<String>` y llama `args()` él mismo). Trampa #46.
18. ~~**Lone `\r` (Mac clásico) se normalizaba sin contar en `detect_eol` ni marcar `mixed_eol`**~~ ✅ 2026-08-25 — CR-only cuenta: `mixed_eol = true` siempre que haya alguno; archivo 100% CR → `LF` + mixed. 3 tests. Trampa #47; invariante #9 de `CLAUDE.md` actualizado.
19. ~~**Trampa #6 era evitable**~~ ✅ 2026-08-25 — `replaceText` despacha con `userEvent: "reload"` y el update listener no llama `onDocChanged` para esas transacciones; `reloadFromDisk` ya no depende del orden `replaceText` → reset de `dirty`. Trampa #6 reescrita. Pendiente verificar en vivo: status bar limpia tras reload y Ctrl+Z tras reload.
20. ~~**`is_stale_symlink` borraba CUALQUIER symlink en `CLI_TARGET`**~~ ✅ 2026-08-25 — compara `read_link(CLI_TARGET).file_name()` con el de `current_exe()`; si no coincide cae a `osascript`. Trampa #48.
21. ~~**Docs desincronizadas tras `b9eaf3b`**~~ ✅ 2026-08-25 — tabla `startup_file` con `extra_ignored`; `themeById()` → `DEFAULT_THEME_ID`; "deliberadamente silenciosos" reescrito en `ARCHITECTURE.md` e invariante #3 de `CLAUDE.md`; `likely_binary` → trampa #9 (ARCHITECTURE y ROADMAP §7 ítem 1); conteo de tests; CHANGELOG cita ítem 4 para la concurrencia CLI. Las listas de lógica pura ya incluían `indent.ts` tras el ítem 10.
22. ~~**GC de snapshots de recovery huérfanos**~~ ✅ 2026-08-25 — `sweep_stale_recovery()` en `setup` (best-effort, solo archivos regulares); decisión pura `recovery::is_stale` con `RECOVERY_MAX_AGE_DAYS = 30`, 3 tests (mtime futuro nunca es stale). Trampa #49.

**Gusto, no hallazgo (sin acción obligatoria):** `noUncheckedIndexedAccess` apagado aunque `indent.ts` ya codea como si estuviera prendido; `applyTheme(id: string)` donde `ThemeId` existe; `byId<T>` con cast sin chequeo.

**Qué NO hacer (los tres revisores coincidieron):** event bus, store/reducer, state machine, "componentes", abstracción genérica de file-watcher, separar open/save en módulos distintos (comparten `doc` + `editor`; se termina en context objects o en un ciclo). Un descriptor de preferencias `{ key, parse, apply }` recién a la CUARTA preferencia, no antes. El producto es mini a propósito y la arquitectura lo respeta: eso es una virtud.

## 9. Segunda revisión: terminar la idea (2026-08-25, sobre `c89608f`)

Revisión de segunda opinión (`architect` + `qa`) sobre los fixes de §8, hallazgos verificados a mano contra el código. Veredicto: los fixes fueron el diseño correcto (`doc.gen` como identidad, `document.ts` como seam real, `write_file` devolviendo mtime, `replaceText` anotado, `lib.rs` como wiring; identidad mini intacta). Lo que falta es **terminar la idea**: `gen` se aplicó a los dos flujos que tenían bugs, pero el resto de la superficie async sigue confiando en una disciplina ("capturá `gen` antes de cada `await`") — la misma categoría de invariante que el `refreshMtime()` recién eliminado. La regla de raíz es otra: **todo flujo de usuario que cambia de documento pasa por la misma cola serial que ya usa `open-file`**; entonces `gen` queda solo para los flujos de fondo (poll, autosave, carga de lenguaje), que son tres y no crecen. Mismo formato tachable que §7/§8.

**Bloque A — Fixes puntuales (chicos; el 1 es urgente)**

1. ~~**Ventana de pérdida de datos abierta por el ítem 16 de §8**~~ ✅ 2026-08-25 — `afterWrite(written, current)` en `document.ts` (3 tests); `writeTo()` hace `Object.assign(doc, afterWrite(contents, editor.getText()))` y solo limpia el recovery si quedó limpio. Trampa #51.
2. ~~**Ítem 3 de §8 arreglado para el caso secuencial, no el racy**~~ ✅ 2026-08-25 — `autosaveTick()` captura `gen`; `if (isStale(gen) || !doc.dirty) clearRecovery(path)`. Trampa #52.
3. ~~**Segunda instancia CLI durante el arranque frío sigue perdiendo el archivo (ambas plataformas)**~~ ✅ 2026-08-25 — `PendingState { slot, frontend_ready }` bajo un solo `Mutex`; `take_pending` (flag + take en la misma sección crítica) y `merge_opened(&mut PendingState, StartupTarget)`; `deliver_target` en `lib.rs` usado por single-instance (con `resolve_open_arg`, `exists: false` sobrevive) y por `Opened`. `AtomicBool` eliminado. 10 tests en `startup.rs` (incluye handshake punta a punta y `exists: false` en cold start). Trampas #32 y #38 reescritas.
4. ~~**Path no-UTF-8 en Linux: ya no hace panic, pero el archivo tampoco abre y el mensaje miente**~~ ✅ 2026-08-25 — `utf8_path` sobre el path RESUELTO (un symlink puede canonicalizar a bytes crudos aunque el arg sea UTF-8) → `NonUtf8Path`; `startup_file -> Result<Option<StartupTarget>, String>`; evento nuevo `open-file-error` (payload string) emitido por single-instance y `Opened`, encolado en `openFileQueue` por `main.ts`. Test reescrito (`non_utf8_filename_is_a_typed_error_not_a_lossy_target`) + 2 de `utf8_path`. Trampa #46 reescrita.
5. ~~**`forgetRecent` en TODO error de lectura**~~ ✅ 2026-08-25 — `isGone(err)` (`isIoError && kind === NOT_FOUND`) guarda los dos `forgetRecent`. Trampa #54.
6. ~~**`writeTo()` resetea `encoding` pero no `mixedEol`**~~ ✅ 2026-08-25 — cubierto por `afterWrite` (`mixedEol: false`). Trampa #51.
7. ~~**Cerrar la ventana con "Discard" no limpia el recovery**~~ ✅ 2026-08-25 — `onCloseRequested` hace `await clearRecovery(doc.path)` tras confirmar el descarte. Trampa #53.
8. ~~**`file_mtime` y `clear_recovery` siguen sync (main thread)**~~ ✅ 2026-08-25 — `file_mtime` y `clear_recovery` → `async fn`; regla única documentada en trampa #45 (actualizada) junto con las excepciones deliberadas (`startup_file`, `signal_ready`, `install_cli_command`).
9. ~~**Ciclo type-only `document.ts` ↔ `ipc.ts`**~~ ✅ 2026-08-25 — `DecodedFile` movido a `document.ts`; `ipc.ts` lo importa. Trampa #55.
10. ~~**`saveFileAs()` es el único sitio que no usa `becomeDocument()`**~~ ✅ 2026-08-25 — `saveFileAs()` → `becomeDocument({ ...doc, path, missing: false })`; `afterFileLoaded()` ya no toca identidad. Trampa #55.
11. ~~**Fricción menor**~~ ✅ 2026-08-25 — `not_found` en SAVE dice "Could not save X: its folder no longer exists." (test); re-export de `IoError` en `ipc.ts` borrado; `http://ipc.localhost` fuera del CSP (`csp` y `devCsp`); comentario sobre el bloqueo deliberado de `osascript` en `install_cli_command`.

**Bloque B — El cambio de diseño (lo que hace que A no se repita)**

12. ~~**Cola serial para TODO flujo de usuario que cambia de documento**~~ ✅ 2026-08-25 — `exclusive(task)` / `documentQueue` en `main.ts`; entradas públicas `newFile`/`openFile`/`saveFile`/`saveFileAs` encolan y llaman a `runX`; `init()`, el listener `open-file` y `saveFile → runSaveFileAs` usan las `run*` (deadlock si no). El poll encola RELOAD y ASK con `isStale(gen)` al entrar; `reloadFromDisk()` perdió sus dos guardas de `gen` (ya no puede ser raceado). Invariante #11 de `CLAUDE.md` reescrito; trampas #23, #37, #38 reescritas; trampa #56 nueva.
13. ~~**`read_file` devuelve el mtime**~~ ✅ 2026-08-25 — `DecodedFile.mtime` tomado del MISMO `metadata` del chequeo de tamaño (stat antes del read: un cambio en el medio se detecta en el próximo poll en vez de quedar "ya visto"); `fs_ops::mtime_of(&Metadata)`; `fromDisk()` lo lleva a `doc`; `refreshMtime()` eliminado; `afterFileLoaded()` es síncrono salvo la carga de lenguaje. Test en `document.test.ts`. Trampa #44 reescrita.
14. ~~**`writeTo()` captura `gen`**~~ ✅ 2026-08-25 — cubierto por la cola: `writeTo()` solo corre desde `runSaveFile`/`runSaveFileAs`, que están encolados — el documento no puede cambiar durante el write. No se agregó `gen` (hubiera sido la disciplina que el ítem 12 elimina).

**Verificado en esta ronda y que se sostiene (no requiere acción):** los flujos de §8 ítems 1-5, 12 y 19 trazados de punta a punta; undo tras reload restaura el texto pre-reload y marca dirty (verificado con un test descartable sobre `EditorState` + `history` — vale la pena convertirlo en test real de `editor.ts`, es el único listener sin cobertura); `fromDisk` no pisa `path/mtime/missing/cursor/gen`; `From<tauri::Error>` → `Other` es correcto; `isIoError` es load-bearing (los comandos no-IO siguen rechazando strings); `AppHandle::path()` fuera del main thread es seguro; guardar sin editar un archivo CR-only NO lo convierte (`saveFile` no escribe si `!dirty`), así que el "(mixed)" es verdad en ese momento; el barrido de recovery en `setup` puede borrar un snapshot >30 días que el mismo arranque iba a ofrecer — por diseño (trampa #49).

**Sin verificar (ambos revisores):** GUI/diálogos en cualquier plataforma, CSP en bundle real, handler `Opened` en runtime, workflows de CI en GitHub.

## 10. Fase 5 — Distribución y alcance

En orden de esfuerzo/beneficio, y solo con tracción real (estrellas, issues, descargas):

1. ~~**Homebrew tap propio**~~ ✅ 2026-08-20 — [`jrodrigopuca/homebrew-tap`](https://github.com/jrodrigopuca/homebrew-tap), Cask apuntando a los `.dmg` (arm64/x64) de v0.2.0. Auditado (`brew audit --cask --online`, limpio) e **instalado de verdad** en la máquina del autor (`brew install --cask`, funcionó de punta a punta). Flujo de mantenimiento para cada release nuevo en `docs/RELEASE.md`.
2. **AUR** — `PKGBUILD` sobre el release. Guía detallada lista en `docs/AUR.md` (2026-08-20), pendiente de ejecutar en una máquina Arch real — necesita cuenta AUR + SSH key propias del autor.
3. ~~**Firma y notarización de Apple**~~ — completado en Fase 2 (2026-08-19), antes de lo previsto: ya había certificado disponible.
4. **Flathub** — mayor alcance Linux; requiere manifest y revisión. Solo con demanda concreta.
5. **Auto-updates** (`tauri-plugin-updater`) — último de la lista: para un editor mini, bajar el release nuevo alcanza durante mucho tiempo.

---

## 11. Reglas de decisión transversales

- **Robustez > features.** Un bug de pérdida de datos vale más que diez features nuevas.
- **Presupuesto de complejidad:** cada dependencia nueva (npm o crate) se justifica por escrito en el PR. El proyecto se mantiene entendible por UNA persona en una tarde.
- **Todo cambio de comportamiento actualiza** README (usuario), ARCHITECTURE.md (mantenedor) y CHANGELOG.
- **La identidad no se negocia:** un archivo, rápido, simple. En la duda, no se agrega.
