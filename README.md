# portable-editor

Editor de texto minimalista para devs. Un archivo a la vez, liviano y al punto: syntax highlighting para ~150 lenguajes, temas, números de línea y una única fuente monoespaciada. Funciona en Linux y macOS.

Construido con [Tauri 2](https://tauri.app) (backend nativo en Rust, ~10-15 MB) y [CodeMirror 6](https://codemirror.net) como motor de edición.

## Features

- **Highlighting automático** por extensión de archivo, con carga lazy del lenguaje (`@codemirror/language-data`)
- **4 temas**: One Dark, Nord, Paper y Solarized Light (persistido entre sesiones)
- **Números de línea**, línea activa resaltada, plegado de código, autocierre de brackets
- **Búsqueda integrada** (panel de CodeMirror)
- **Fuente única** monoespaciada (Consolas / SF Mono / Menlo según plataforma), tamaño ajustable
- **Indicador de cambios sin guardar** con confirmación al cerrar, abrir o crear archivo
- **Cuatro formas de abrir un archivo**: botón/atajo en la interfaz, drag & drop a la ventana, "Abrir con..." del sistema (asociaciones de archivo) y por terminal
- **Detección de cambios externos**: si el archivo cambia en disco (un `git checkout`, otro editor), se recarga solo — y si tenés cambios sin guardar, te pregunta
- **Guardado atómico**: escribe a un temporal y renombra (POSIX), un corte a mitad de guardado nunca corrompe el archivo
- **Word wrap** conmutables con `Alt+Z` o desde la status bar
- **Instancia única**: abrir otro archivo por terminal reutiliza la ventana existente
- **Archivos recientes** y restauración de sesión: reabre el último archivo en la misma línea y columna
- **Multi-cursor** (`Alt+click`) y selección de siguiente ocurrencia (`Mod+D`), de fábrica con CodeMirror
- **Detección de encoding** (BOM UTF-8/UTF-16, o Windows-1252 como fallback para texto legado sin BOM) y de fin de línea (LF/CRLF), visibles en la status bar solo cuando NO son los defaults (UTF-8 / LF) — así "Windows-1252" o "(mixed)" se notan la vez que importa. El guardado siempre escribe UTF-8, preservando el estilo de fin de línea original
- **Detección de indentación** (tabs vs. espacios, y el ancho) al abrir un archivo; botón en la status bar para cambiarla manualmente (2/4/8 espacios o tabs)

## Instalación

**macOS**, vía [Homebrew](https://brew.sh):

```sh
brew tap jrodrigopuca/tap
brew install --cask portable-editor
```

**Linux**: bajá el `.deb`/`.rpm`/`.AppImage` de [GitHub Releases](https://github.com/jrodrigopuca/portable-editor/releases/latest) según tu distro.

**Manual (cualquier plataforma)**: descargá el artefacto correspondiente desde [GitHub Releases](https://github.com/jrodrigopuca/portable-editor/releases/latest).

## Atajos

| Atajo (⌘ en macOS, Ctrl en Linux) | Acción              |
| --------------------------------- | ------------------- |
| `Mod + O`                         | Abrir archivo       |
| `Mod + S`                         | Guardar             |
| `Mod + Shift + S`                 | Guardar como        |
| `Mod + N`                         | Nuevo archivo       |
| `Mod + F`                         | Buscar / reemplazar |
| `Mod + G` / `Mod + Shift + G`     | Siguiente / anterior coincidencia |
| `Esc`                             | Cerrar búsqueda / panel de atajos |
| `Tab` / `Shift + Tab`             | Indentar / desindentar |
| `Mod + Alt + G`                   | Ir a línea           |
| `Mod + Z` / `Mod + Shift + Z`     | Deshacer / rehacer  |
| `Mod + /`                         | Comentar / descomentar línea |
| `Mod + =` / `Mod + -` / `Mod + 0` | Tamaño de fuente    |
| `Mod + D`                         | Seleccionar siguiente ocurrencia |
| `Alt + Z`                         | Word wrap on/off    |
| `Mod + Shift + /`                 | Mostrar atajos de teclado |
| `Mod + Q`                         | Salir |

## Abrir archivos

| Vía                  | Cómo                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| Interfaz             | Botón **Open** en la status bar o `Mod+O`                                 |
| Drag & drop          | Arrastrá el archivo a la ventana                                          |
| "Abrir con..."       | Asociaciones registradas al instalar el bundle (extensiones de código)    |
| Terminal             | `portable-editor archivo.txt`                                             |

En macOS el ejecutable vive dentro del `.app`. Para tener el comando en la terminal, abrí portable-editor y andá a **Help → "Install 'portable-editor' Command"** — crea el symlink solo (puede pedir tu contraseña de admin). Alternativa manual, si preferís no usar el menú:

```sh
sudo ln -s "/Applications/portable-editor.app/Contents/MacOS/portable-editor" /usr/local/bin/portable-editor
```

En Linux los paquetes `.deb`/`.rpm` ya instalan el binario en el PATH — no hace falta ningún paso extra.

## Requisitos

- [Node.js](https://nodejs.org) 18+
- [Rust](https://rustup.rs) (toolchain estable)
- Linux: dependencias de sistema de Tauri (`webkit2gtk`, ver [docs](https://tauri.app/start/prerequisites/#linux))

## Desarrollo

```sh
npm install
npm run tauri dev
```

## Build de producción

```sh
npm run tauri build
```

Los binarios quedan en `src-tauri/target/release/bundle/` (`.app`/`.dmg` en macOS, `.deb`/`.rpm`/`.AppImage` en Linux).

## Estructura

```
src/            # Frontend (TypeScript + CodeMirror 6)
  main.ts       #   Estado del documento, atajos, recientes, wiring UI
  editor.ts     #   Editor encapsulado (temas, lenguaje y wrap via Compartments)
  themes.ts     #   Registro de temas
src-tauri/      # Backend nativo (Rust)
  src/lib.rs    #   Comandos IPC, single-instance, evento Opened de macOS
docs/           # Documentación de mantenimiento
```

## Rendimiento

Arranque medido con [`hyperfine`](https://github.com/sharkdp/hyperfine) (macOS Apple Silicon, build local sin firmar/notarizar vía `--no-bundle`, 15 corridas + 2 de warmup — [metodología completa](docs/RELEASE.md), [script reproducible](scripts/bench-startup.sh)):

| | Tiempo hasta listo para escribir |
| --- | --- |
| **portable-editor** (medido acá, 2026-08-20) | **~470 ms** (± 25 ms) |

Para tener con qué comparar — **esto NO se midió en las mismas condiciones**, son cifras de referencia pública/experiencia general, no un benchmark propio contra esas apps:

- Un editor nativo puro (Cocoa, ej. TextEdit/CotEditor) suele arrancar bien por debajo de 200 ms.
- Un IDE basado en Electron con extensiones cargadas (ej. VS Code en un workspace grande) suele reportar arranques de 1 a 3+ segundos.

Conclusión honesta: portable-editor no es instantáneo como una app nativa pura (el costo del WebView es real), pero está un orden de magnitud más rápido que un IDE Electron pesado. Si volvés a medirlo (otro hardware, con firma/notarización, otra versión), actualizá esta tabla con el dato real, no ajustes el texto a mano.

## Documentación

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — arquitectura, superficie IPC, flujos, decisiones, invariantes y trampas conocidas. **Lectura obligada antes de tocar código.**
- [`docs/RELEASE.md`](docs/RELEASE.md) — cómo generar los ejecutables (local y CI) y publicarlos en GitHub Releases.
- [`docs/AUR.md`](docs/AUR.md) — guía paso a paso para publicar en el AUR (pendiente de ejecutar).
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — diagnóstico de madurez y plan de evolución por fases, con criterios de salida.
- [`docs/SMOKE-TEST.md`](docs/SMOKE-TEST.md) — checklist manual pre-release.
- [`CHANGELOG.md`](CHANGELOG.md) — historial de cambios (Keep a Changelog).
- [`CLAUDE.md`](CLAUDE.md) — guía operativa para agentes AI y devs: convenciones, comandos, mapa rápido e invariantes.

Convención de idiomas: código, comentarios y UI en inglés; documentación en español.

## Desarrollo local

```sh
npm run lint        # Biome: lint + format
npm run typecheck   # tsc --noEmit
npm run test        # Vitest
```

CI corre lint, typecheck, tests, `cargo fmt --check` y clippy en cada push/PR.

## Licencia

[Apache-2.0](LICENSE). Podés usar, modificar y redistribuir (incluso comercialmente), pero toda redistribución debe conservar el aviso de copyright y el archivo [NOTICE](NOTICE), y marcar los archivos modificados. Ver la licencia para el detalle.
