# Roadmap y madurez — portable-editor

Diagnóstico honesto del estado del proyecto y plan de evolución en fases, con criterios de salida verificables. Última actualización: 2026-08-19.

## 1. Diagnóstico de madurez

| Dimensión                | Estado | Detalle                                                                 |
| ------------------------ | :----: | ----------------------------------------------------------------------- |
| Funcionalidad core       | 🟢     | Editar/abrir/guardar completo, 4 vías de apertura, temas, ~150 lenguajes |
| Robustez                 | 🟡     | Guardado atómico y cambios externos ✔; encodings y archivos enormes ✘   |
| Arquitectura             | 🟢     | Capas claras, IPC mínimo, módulos con responsabilidad única              |
| Documentación            | 🟢     | README, ARCHITECTURE, RELEASE, CLAUDE.md — por encima de la media        |
| Tests automatizados      | 🟡     | Lógica pura con Vitest (22 tests); sin E2E todavía (smoke test manual)   |
| CI de calidad            | 🟢     | Biome, tsc, Vitest, rustfmt y clippy en cada push/PR                     |
| Lint/format              | 🟢     | Biome (frontend) + rustfmt/clippy (backend)                              |
| Distribución             | 🟢     | Íconos propios ✔; release v0.1.0 publicado y firmado/notarizado (macOS arm64+x64, .deb, .rpm, .AppImage) |
| Legal/comunidad          | 🟢     | Apache-2.0 + NOTICE, CHANGELOG, CONTRIBUTING, templates de issues        |

**Veredicto: alpha temprana.** Red de seguridad, licencia y release reproducible y firmado ya están. Falta robustez de casos borde del mundo real (encodings, archivos enormes, EOL) para beta — ver Fase 3.

### Modelo de referencia

| Nivel         | Criterio de entrada                                                    | Estado |
| ------------- | ---------------------------------------------------------------------- | :----: |
| Prototipo     | Funciona en la máquina del autor                                       | ✅ |
| Alpha         | Red de seguridad (tests + CI + lint), licencia, release reproducible   | ✅ acá |
| Beta          | Robustez completa, usuarios externos reportando, feedback loop         | Fase 3 |
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
3. **Archivo borrado/renombrado bajo los pies** — hoy el polling lo ignora en silencio; indicar en la status bar ("deleted on disk") y tratar el próximo guardado como "save as".
4. ~~**EOL**~~ ✅ 2026-08-19 — detectado (LF/CRLF) y visible en la status bar; se preserva al guardar. Mismo módulo que encodings.
5. **E2E mínimo** (opcional pero deseable): `tauri-driver` + WebDriver para el happy path abrir→editar→guardar. Evaluar costo/beneficio: si resulta frágil en CI, el smoke test manual de Fase 1 sigue siendo la línea de defensa.

**Criterio de salida:** el smoke test incluye los casos borde y pasa; los issues de "no abre mi archivo" tienen respuesta de producto, no excusa.

---

## 5. Fase 4 — Crecimiento (features, siempre dentro de la identidad)

Orden sugerido por relación valor/complejidad:

1. **Menú nativo (File/Edit/View/Window)** — hoy no hay ningún menú configurado (`tauri::menu` sin usar); el menú default de Tauri está prácticamente vacío. Resuelve dos problemas a la vez: da acceso a Open/Save/etc. sin memorizar atajos, y cada `MenuItem` muestra su atajo al lado de la etiqueta (documentación visible, gratis). Complejidad acotada pero real: construir el menú en `lib.rs` y conectar cada ítem a las funciones ya existentes de `main.ts` (mismo patrón `emit`/`listen` que `open-file`); macOS y Linux (webkit2gtk) tienen convenciones distintas que respetar (en macOS el primer menú es el nombre de la app, con Quit/Preferences ahí, no en File).
2. **Go to line** (`Mod+G`) — ya está en `@codemirror/search`, falta el keybinding.
3. **Indentación**: detección automática (tabs/spaces, ancho) al abrir + toggle en la status bar (`indentUnit` en un Compartment, patrón ya establecido).
4. **Búsqueda con estilo propio** — el panel de CodeMirror funciona pero desentona con los temas; tematizarlo.
5. **Settings file opcional** (`~/.config/portable-editor/settings.json`): fuente, tamaño, tema, wrap. Solo si los pedidos reales lo justifican — localStorage ya cubre el 90%.
6. **Más temas** — costo marginal casi nulo con el registro actual (paleta + entrada en `THEMES`).
7. **Command palette** (`Mod+K`) — evaluar recién cuando la cantidad de acciones lo amerite; con el menú nativo (ítem 1) cubriendo la discoverability, esto pierde bastante urgencia.

### Qué NO va a tener (guardrails de identidad)

Tabs multi-archivo, árbol de archivos, LSP/autocompletado, git integrado, terminal embebida, sistema de plugins. Cada una convierte el editor en un IDE de juguete que compite (y pierde) contra VS Code/Zed. La ventaja competitiva es abrir en milisegundos y no estorbar. **Un feature request que viole esto se cierra con gracia y un link a esta sección.**

---

## 6. Fase 5 — Distribución y alcance

En orden de esfuerzo/beneficio, y solo con tracción real (estrellas, issues, descargas):

1. **Homebrew tap propio** — cask apuntando al .dmg del release. Esfuerzo: horas.
2. **AUR** — `PKGBUILD` sobre el release. La comunidad Arch suele adoptarlo sola.
3. ~~**Firma y notarización de Apple**~~ — completado en Fase 2 (2026-08-19), antes de lo previsto: ya había certificado disponible.
4. **Flathub** — mayor alcance Linux; requiere manifest y revisión. Solo con demanda concreta.
5. **Auto-updates** (`tauri-plugin-updater`) — último de la lista: para un editor mini, bajar el release nuevo alcanza durante mucho tiempo.

---

## 7. Reglas de decisión transversales

- **Robustez > features.** Un bug de pérdida de datos vale más que diez features nuevas.
- **Presupuesto de complejidad:** cada dependencia nueva (npm o crate) se justifica por escrito en el PR. El proyecto se mantiene entendible por UNA persona en una tarde.
- **Todo cambio de comportamiento actualiza** README (usuario), ARCHITECTURE.md (mantenedor) y CHANGELOG.
- **La identidad no se negocia:** un archivo, rápido, simple. En la duda, no se agrega.
