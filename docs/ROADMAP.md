# Roadmap y madurez — portable-editor

Diagnóstico honesto del estado del proyecto y plan de evolución en fases, con criterios de salida verificables. Última actualización: 2026-08-19.

## 1. Diagnóstico de madurez

| Dimensión                | Estado | Detalle                                                                 |
| ------------------------ | :----: | ----------------------------------------------------------------------- |
| Funcionalidad core       | 🟢     | Editar/abrir/guardar completo, 4 vías de apertura, temas, ~150 lenguajes |
| Robustez                 | 🟢     | Guardado atómico, cambios externos, encodings, EOL, archivos enormes y archivo borrado — todos ✔ (Fase 3 completa) |
| Arquitectura             | 🟢     | Capas claras, IPC mínimo, módulos con responsabilidad única              |
| Documentación            | 🟢     | README, ARCHITECTURE, RELEASE, CLAUDE.md — por encima de la media        |
| Tests automatizados      | 🟡     | Lógica pura con Vitest (22 tests); sin E2E todavía (smoke test manual)   |
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

1. ~~**Abrir un archivo binario (PNG/PDF/ejecutable) y guardarlo lo corrompe, incluso sin editar nada**~~ ✅ 2026-08-25 — doble fix: (a) `saveFile()` (`main.ts`) ahora no escribe si `doc.dirty` es `false`, cierra el caso más común (reflejo de `Mod+S` sin haber editado nada); (b) `read_file` agrega `likely_binary` (heurística de git: byte NUL en los primeros 8000 bytes — el fallback a Windows-1252 nunca falla al decodificar, así que es la única señal disponible), y `openFile()` pregunta antes de cargar un archivo que da positivo. `restoreSession()` queda afuera de (b) a propósito (mismo criterio que sus otros guards), cubierta igual por (a). Documentado en `ARCHITECTURE.md` trampa #22 y `CLAUDE.md` invariante #9. Tests nuevos en `text_io.rs` (`nul_byte_marks_content_as_likely_binary`, `plain_text_is_not_likely_binary`).

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

## 8. Fase 5 — Distribución y alcance

En orden de esfuerzo/beneficio, y solo con tracción real (estrellas, issues, descargas):

1. ~~**Homebrew tap propio**~~ ✅ 2026-08-20 — [`jrodrigopuca/homebrew-tap`](https://github.com/jrodrigopuca/homebrew-tap), Cask apuntando a los `.dmg` (arm64/x64) de v0.2.0. Auditado (`brew audit --cask --online`, limpio) e **instalado de verdad** en la máquina del autor (`brew install --cask`, funcionó de punta a punta). Flujo de mantenimiento para cada release nuevo en `docs/RELEASE.md`.
2. **AUR** — `PKGBUILD` sobre el release. Guía detallada lista en `docs/AUR.md` (2026-08-20), pendiente de ejecutar en una máquina Arch real — necesita cuenta AUR + SSH key propias del autor.
3. ~~**Firma y notarización de Apple**~~ — completado en Fase 2 (2026-08-19), antes de lo previsto: ya había certificado disponible.
4. **Flathub** — mayor alcance Linux; requiere manifest y revisión. Solo con demanda concreta.
5. **Auto-updates** (`tauri-plugin-updater`) — último de la lista: para un editor mini, bajar el release nuevo alcanza durante mucho tiempo.

---

## 9. Reglas de decisión transversales

- **Robustez > features.** Un bug de pérdida de datos vale más que diez features nuevas.
- **Presupuesto de complejidad:** cada dependencia nueva (npm o crate) se justifica por escrito en el PR. El proyecto se mantiene entendible por UNA persona en una tarde.
- **Todo cambio de comportamiento actualiza** README (usuario), ARCHITECTURE.md (mantenedor) y CHANGELOG.
- **La identidad no se negocia:** un archivo, rápido, simple. En la duda, no se agrega.
