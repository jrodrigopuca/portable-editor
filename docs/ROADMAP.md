# Roadmap y madurez — portable-editor

Diagnóstico honesto del estado del proyecto y plan de evolución en fases, con criterios de salida verificables. Última actualización: 2026-07-07.

## 1. Diagnóstico de madurez

| Dimensión                | Estado | Detalle                                                                 |
| ------------------------ | :----: | ----------------------------------------------------------------------- |
| Funcionalidad core       | 🟢     | Editar/abrir/guardar completo, 4 vías de apertura, temas, ~150 lenguajes |
| Robustez                 | 🟡     | Guardado atómico y cambios externos ✔; encodings y archivos enormes ✘   |
| Arquitectura             | 🟢     | Capas claras, IPC mínimo, módulos con responsabilidad única              |
| Documentación            | 🟢     | README, ARCHITECTURE, RELEASE, CLAUDE.md — por encima de la media        |
| Tests automatizados      | 🔴     | **Cero.** La única red es `tsc --noEmit` y prueba manual                 |
| CI de calidad            | 🔴     | Solo existe el workflow de release; nada valida push/PR                  |
| Lint/format              | 🔴     | Sin ESLint/Prettier/clippy/rustfmt configurados                          |
| Distribución             | 🟡     | Workflow de release escrito pero nunca ejecutado; íconos por defecto     |
| Legal/comunidad          | 🔴     | **Sin LICENSE** (blocker para publicar), sin CHANGELOG ni CONTRIBUTING   |

**Veredicto: prototipo avanzado (pre-alpha).** Core funcional y bien documentado, sin red de seguridad. La prioridad no es agregar features: es que lo que existe no se pueda romper sin que algo grite.

### Modelo de referencia

| Nivel         | Criterio de entrada                                                    | Estado |
| ------------- | ---------------------------------------------------------------------- | :----: |
| Prototipo     | Funciona en la máquina del autor                                       | ✅ acá |
| Alpha         | Red de seguridad (tests + CI + lint), licencia, release reproducible   | Fase 1-2 |
| Beta          | Robustez completa, usuarios externos reportando, feedback loop         | Fase 3 |
| 1.0           | Estable en uso real, limitaciones conocidas resueltas o documentadas   | Fase 4+ |

---

## 2. Fase 1 — Red de seguridad (antes que cualquier feature)

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

## 3. Fase 2 — Primer release público (v0.1.0)

**Objetivo:** artefactos instalables por terceros, proceso de release ejercitado de punta a punta.

1. Íconos propios (`npm run tauri icon`) — hoy está el logo de Tauri.
2. Ejecutar el workflow de release con un tag real (`v0.1.0`) y validar los cuatro artefactos en máquinas limpias (o VMs): .dmg en ambas arquitecturas, .deb, .AppImage.
3. Release notes con instrucciones Gatekeeper (mientras no haya firma de Apple).
4. Templates de issues (bug report con SO/versión/pasos) y `CONTRIBUTING.md` corto que apunte a `docs/ARCHITECTURE.md` y a las convenciones de `CLAUDE.md`.

**Criterio de salida:** una persona que no sos vos instala el editor desde GitHub Releases y edita un archivo sin ayuda.

---

## 4. Fase 3 — Robustez restante (camino a beta)

**Objetivo:** que los casos borde del mundo real no rompan la confianza.

1. **Encodings** — `read_to_string` es UTF-8 estricto: hoy un latin-1 o UTF-16 no abre. Detectar con `encoding_rs` (+ BOM), convertir al leer, mostrar encoding en la status bar. Decidir política de guardado (¿siempre UTF-8? ¿preservar original?) y documentarla.
2. **Archivos enormes** — umbral (p. ej. 10 MB): por encima, abrir sin highlighting y avisar en la status bar. Por encima de un segundo umbral, rechazar con mensaje claro antes de colgar el webview.
3. **Archivo borrado/renombrado bajo los pies** — hoy el polling lo ignora en silencio; indicar en la status bar ("deleted on disk") y tratar el próximo guardado como "save as".
4. **EOL** — detectar y mostrar LF/CRLF en la status bar; preservar al guardar.
5. **E2E mínimo** (opcional pero deseable): `tauri-driver` + WebDriver para el happy path abrir→editar→guardar. Evaluar costo/beneficio: si resulta frágil en CI, el smoke test manual de Fase 1 sigue siendo la línea de defensa.

**Criterio de salida:** el smoke test incluye los casos borde y pasa; los issues de "no abre mi archivo" tienen respuesta de producto, no excusa.

---

## 5. Fase 4 — Crecimiento (features, siempre dentro de la identidad)

Orden sugerido por relación valor/complejidad:

1. **Go to line** (`Mod+G`) — ya está en `@codemirror/search`, falta el keybinding.
2. **Indentación**: detección automática (tabs/spaces, ancho) al abrir + toggle en la status bar (`indentUnit` en un Compartment, patrón ya establecido).
3. **Búsqueda con estilo propio** — el panel de CodeMirror funciona pero desentona con los temas; tematizarlo.
4. **Settings file opcional** (`~/.config/portable-editor/settings.json`): fuente, tamaño, tema, wrap. Solo si los pedidos reales lo justifican — localStorage ya cubre el 90%.
5. **Más temas** — costo marginal casi nulo con el registro actual (paleta + entrada en `THEMES`).
6. **Command palette** (`Mod+K`) — evaluar recién cuando la cantidad de acciones lo amerite; hoy con 8 acciones sería ceremonia.

### Qué NO va a tener (guardrails de identidad)

Tabs multi-archivo, árbol de archivos, LSP/autocompletado, git integrado, terminal embebida, sistema de plugins. Cada una convierte el editor en un IDE de juguete que compite (y pierde) contra VS Code/Zed. La ventaja competitiva es abrir en milisegundos y no estorbar. **Un feature request que viole esto se cierra con gracia y un link a esta sección.**

---

## 6. Fase 5 — Distribución y alcance

En orden de esfuerzo/beneficio, y solo con tracción real (estrellas, issues, descargas):

1. **Homebrew tap propio** — cask apuntando al .dmg del release. Esfuerzo: horas.
2. **AUR** — `PKGBUILD` sobre el release. La comunidad Arch suele adoptarlo sola.
3. **Firma y notarización de Apple** (USD 99/año) — cuando las descargas de macOS justifiquen eliminar la fricción de Gatekeeper. El workflow ya la soporta vía secrets.
4. **Flathub** — mayor alcance Linux; requiere manifest y revisión. Solo con demanda concreta.
5. **Auto-updates** (`tauri-plugin-updater`) — último de la lista: para un editor mini, bajar el release nuevo alcanza durante mucho tiempo.

---

## 7. Reglas de decisión transversales

- **Robustez > features.** Un bug de pérdida de datos vale más que diez features nuevas.
- **Presupuesto de complejidad:** cada dependencia nueva (npm o crate) se justifica por escrito en el PR. El proyecto se mantiene entendible por UNA persona en una tarde.
- **Todo cambio de comportamiento actualiza** README (usuario), ARCHITECTURE.md (mantenedor) y CHANGELOG.
- **La identidad no se negocia:** un archivo, rápido, simple. En la duda, no se agrega.
