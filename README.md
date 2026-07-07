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

## Atajos

| Atajo (⌘ en macOS, Ctrl en Linux) | Acción              |
| --------------------------------- | ------------------- |
| `Mod + O`                         | Abrir archivo       |
| `Mod + S`                         | Guardar             |
| `Mod + Shift + S`                 | Guardar como        |
| `Mod + N`                         | Nuevo archivo       |
| `Mod + F`                         | Buscar / reemplazar |
| `Mod + Z` / `Mod + Shift + Z`     | Deshacer / rehacer  |
| `Mod + =` / `Mod + -` / `Mod + 0` | Tamaño de fuente    |

## Abrir archivos

| Vía                  | Cómo                                                                     |
| -------------------- | ------------------------------------------------------------------------ |
| Interfaz             | Botón **Abrir** en la status bar o `Mod+O`                                |
| Drag & drop          | Arrastrá el archivo a la ventana                                          |
| "Abrir con..."       | Asociaciones registradas al instalar el bundle (extensiones de código)    |
| Terminal             | `portable-editor archivo.txt`                                             |

En macOS el ejecutable vive dentro del `.app`; para tener el comando en la terminal:

```sh
sudo ln -s "/Applications/portable-editor.app/Contents/MacOS/portable-editor" /usr/local/bin/portable-editor
```

En Linux los paquetes `.deb`/`.rpm` ya instalan el binario en el PATH.

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
  main.ts       #   Estado del documento, atajos, wiring UI
  editor.ts     #   Editor encapsulado (temas y lenguaje via Compartments)
  themes.ts     #   Registro de temas
src-tauri/      # Backend nativo (Rust)
  src/lib.rs    #   Comandos: read_file, write_file, cli_file
```
