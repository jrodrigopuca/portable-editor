# Contribuir a portable-editor

¡Gracias por el interés! Antes de escribir código, dos lecturas cortas que te van a ahorrar idas y vueltas:

1. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — cómo está armado, invariantes y trampas conocidas.
2. La sección **"Qué NO va a tener"** de [`docs/ROADMAP.md`](docs/ROADMAP.md) — la identidad del proyecto es ser mini (un archivo, rápido, simple). Features que lo conviertan en IDE no se aceptan, sin importar lo bien implementadas que estén.

## Setup

```sh
npm install          # frontend
npm run tauri dev    # requiere Rust (rustup.rs) y, en Linux, las deps de sistema de Tauri
```

## Antes de abrir un PR

```sh
npm run lint         # Biome (lint + format)
npm run typecheck    # tsc --noEmit
npm run test         # Vitest
cargo fmt            # en src-tauri/, si tocaste Rust
```

CI corre todo eso más clippy; un PR en rojo no se revisa.

## Convenciones

- **Idiomas**: código, comentarios y UI en inglés; documentación en español.
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `chore:`, `docs:`...).
- **Lógica testeable separada del wiring**: la lógica pura va en módulos sin DOM ni Tauri (ver `src/recent.ts`) con tests al lado. `main.ts` solo orquesta.
- **Dependencias nuevas se justifican en el PR**: cada crate/paquete suma superficie de mantenimiento; el default es no agregar.
- Todo cambio de comportamiento actualiza `README.md`, `CHANGELOG.md` y, si toca flujos o invariantes, `docs/ARCHITECTURE.md`.

## Reportar bugs

Usá el template de issue e incluí SO, versión de la app y pasos reproducibles. Para bugs de apertura/guardado de archivos, el tipo de archivo y su encoding ayudan muchísimo.
