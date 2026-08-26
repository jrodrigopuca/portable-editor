# Guía de builds y publicación — portable-editor

Cómo generar los ejecutables para Linux y macOS, y cómo publicarlos. Hay dos caminos: **local** (para probar el bundle en tu máquina) y **CI con GitHub Actions** (el camino recomendado para publicar, porque los builds de Linux DEBEN hacerse en Linux — no hay cross-compile del webview).

---

## 0. Antes del primer release (una sola vez)

### Íconos propios

Los íconos actuales en `src-tauri/icons/` son los del scaffold de Tauri (el logo de Tauri). Antes de publicar, generá los tuyos a partir de un PNG cuadrado de al menos 1024×1024:

```sh
npm run tauri icon path/al/icono.png
```

Eso regenera todos los formatos (`.icns` para macOS, `.ico`, PNGs) en `src-tauri/icons/`.

### Identificador del bundle

Ya está configurado (`com.juan.portableeditor` en `tauri.conf.json`). No lo cambies después del primer release publicado: macOS y los gestores de paquetes lo usan como identidad de la app.

---

## 1. Versionado

La versión del bundle sale de `src-tauri/tauri.conf.json` → `"version"`. Para cada release:

1. Bump en `src-tauri/tauri.conf.json` (fuente de verdad del bundle).
2. Mantener en sincronía `package.json` y `src-tauri/Cargo.toml` (no es obligatorio, pero evita confusión).
3. Commit + tag: el tag dispara el workflow de publicación.

```sh
git commit -am "chore: bump version to X.Y.Z"
git tag vX.Y.Z
git push origin main --tags
```

---

## 2. Build local

### macOS

```sh
npm run tauri build
```

Genera para la arquitectura de tu máquina. Salidas en `src-tauri/target/release/bundle/`:

- `macos/portable-editor.app`
- `dmg/portable-editor_<version>_<arch>.dmg`

**Binario universal** (Intel + Apple Silicon en un solo artefacto):

```sh
rustup target add x86_64-apple-darwin aarch64-apple-darwin
npm run tauri build -- --target universal-apple-darwin
```

### Linux (solo desde Linux)

Prerequisitos de sistema (Debian/Ubuntu):

```sh
sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

Luego:

```sh
npm install
npm run tauri build
```

Salidas en `src-tauri/target/release/bundle/`:

- `deb/*.deb` (Debian/Ubuntu — instala el binario en el PATH)
- `rpm/*.rpm` (Fedora/RHEL)
- `appimage/*.AppImage` (portable, corre en cualquier distro)

> Compatibilidad del AppImage: se hereda la glibc de la máquina donde buildeás. Buildeá en la distro **más vieja** que quieras soportar (en CI usamos ubuntu-22.04). 

El binario pelado (sin bundle) queda en `src-tauri/target/release/portable-editor` y acepta el argumento de archivo por CLI.

> **`cargo build --release` a secas NO sirve para probar el binario real.** La elección entre servidor de dev (`devUrl`) y frontend embebido (`frontendDist`) la resuelve el CLI de Tauri al invocar la compilación, no es algo que Rust decida solo por ser build de release — un `cargo build --release` corrido a mano por afuera de `tauri dev`/`tauri build` abre una ventana completamente en blanco (ni siquiera los botones de la status bar, que son HTML estático). Para un binario de producción real sin pasar por el bundle completo (DMG/firma/notarización, que tardan), usá:
> ```sh
> npm run tauri build -- --no-bundle
> ```

---

## 2.1 Medir el tiempo de arranque

`hyperfine` no puede cronometrar una app GUI directamente (mide comandos que arrancan y terminan solos; portable-editor se queda corriendo hasta que la cerrás). Por eso el comando `signal_ready` (`src-tauri/src/lib.rs`) imprime `PORTABLE_EDITOR_READY` a stdout apenas el frontend termina de inicializar — es lo que un script wrapper espera antes de matar el proceso y devolver el control, y ES ESO lo que `hyperfine` termina cronometrando.

```sh
brew install hyperfine  # si no lo tenés
npm run tauri build -- --no-bundle
hyperfine --warmup 2 --runs 15 \
  "scripts/bench-startup.sh src-tauri/target/release/portable-editor algún-archivo.txt"
```

Último resultado medido (macOS Apple Silicon, build sin firmar, 2026-08-20): **~470 ms ± 25 ms**. Está en el README, actualizarlo ahí también si se vuelve a medir.

---

## 3. Firma

### macOS — el tema Gatekeeper

Sin firma, macOS muestra "la app está dañada o proviene de un desarrollador no identificado". Opciones:

**a) Sin firmar (gratis, para amigos y early adopters).** El usuario debe abrir con click derecho → Abrir, o:

```sh
xattr -cr /Applications/portable-editor.app
```

Documentalo en las release notes; si no, vas a recibir issues de "la app está rota".

**b) Firmada y notarizada (requiere Apple Developer Program, USD 99/año).** Con el certificado "Developer ID Application", el workflow de CI firma y notariza solo si definís estos secrets en el repo (Settings → Secrets and variables → Actions):

| Secret                        | Contenido                                          |
| ----------------------------- | -------------------------------------------------- |
| `APPLE_CERTIFICATE`           | El certificado .p12 exportado, en base64            |
| `APPLE_CERTIFICATE_PASSWORD`  | Password del .p12                                   |
| `APPLE_SIGNING_IDENTITY`      | p. ej. `Developer ID Application: Tu Nombre (TEAM)` |
| `APPLE_ID`                    | Tu Apple ID                                         |
| `APPLE_PASSWORD`              | App-specific password (appleid.apple.com)           |
| `APPLE_TEAM_ID`               | El Team ID de tu cuenta                             |

Si los secrets no existen, el build sale igual pero sin firmar.

### Linux

No hay firma obligatoria. Los `.deb`/`.rpm`/`.AppImage` funcionan tal cual.

---

## 4. Publicación con GitHub Actions (recomendado)

El workflow ya está en `.github/workflows/release.yml`. Usa [`tauri-action`](https://github.com/tauri-apps/tauri-action), el action oficial. Qué hace:

1. Se dispara al pushear un tag `v*` (también se puede lanzar a mano desde la pestaña Actions).
2. Buildea en paralelo: macOS Apple Silicon, macOS Intel y Linux x86_64.
3. Crea un **GitHub Release en borrador** con todos los artefactos subidos (.dmg, .deb, .rpm, .AppImage).
4. Vos revisás el borrador, escribís/ajustás las release notes y lo publicás con un click.

Flujo completo de un release:

```sh
# 1. Verificación local
npx tsc --noEmit

# 2. Bump de versión (tauri.conf.json + package.json + Cargo.toml) y commit
git commit -am "chore: bump version to X.Y.Z"

# 3. Tag y push
git tag vX.Y.Z
git push origin main --tags

# 4. Esperar el workflow (~10-20 min), revisar el draft en GitHub → Releases → publicar
```

### Checklist previo al tag

- [ ] `npx tsc --noEmit` en verde
- [ ] La app probada con `npm run tauri dev` (abrir, editar, guardar, temas)
- [ ] Versión bumpeada en `tauri.conf.json`
- [ ] Íconos propios (solo primer release)
- [ ] `CHANGELOG.md`: mover "[Sin publicar]" a una sección `[X.Y.Z] - fecha` (los builds de macOS van firmados y notarizados: sin instrucciones de Gatekeeper)

---

## 5. Publicación manual (alternativa sin CI)

Si preferís no usar Actions (o para un hotfix rápido desde tu Mac + una VM/máquina Linux):

```sh
# En cada plataforma:
npm run tauri build

# Crear el release y subir artefactos con la CLI de GitHub:
gh release create v0.2.0 \
  src-tauri/target/release/bundle/dmg/*.dmg \
  --title "portable-editor 0.2.0" \
  --notes "Cambios: ..."

# Desde la máquina Linux, agregar sus artefactos al mismo release:
gh release upload v0.2.0 \
  src-tauri/target/release/bundle/deb/*.deb \
  src-tauri/target/release/bundle/rpm/*.rpm \
  src-tauri/target/release/bundle/appimage/*.AppImage
```

---

## 6. Canales de distribución (futuro, opcional)

Cuando el proyecto madure, en orden de esfuerzo/beneficio:

1. ~~**Homebrew tap propio**~~ ✅ 2026-08-20 — [`jrodrigopuca/homebrew-tap`](https://github.com/jrodrigopuca/homebrew-tap). `brew tap jrodrigopuca/tap && brew install --cask portable-editor`. Ver "6.1 Mantenimiento del tap" abajo para cada release nuevo.
2. **AUR** (Arch): un `PKGBUILD` que baja el release. Guía detallada, paso a paso, en [`docs/AUR.md`](AUR.md) — pendiente de ejecutar, no probado todavía en una máquina Arch real.
3. **Flathub** (Linux universal): mayor alcance, pero requiere manifest Flatpak y proceso de revisión. Encararlo solo si hay tracción.

No implementamos auto-updates: para un editor mini, "bajá la versión nueva del release" es suficiente. Si algún día hace falta, existe `tauri-plugin-updater` (requiere firmar los updates con su propio par de claves).

### 6.1 Mantenimiento del tap de Homebrew (cada release nuevo)

El Cask (`Casks/portable-editor.rb` en el repo `homebrew-tap`) fija `version` y los `sha256` de los dos `.dmg` (arm/intel) a mano — no hay auto-update. Con cada release nuevo de `portable-editor`:

```sh
# 1. Bajar los dos .dmg del release nuevo y calcular sus hashes
gh release download vX.Y.Z --repo jrodrigopuca/portable-editor -p "*.dmg"
shasum -a 256 portable-editor_X.Y.Z_aarch64.dmg portable-editor_X.Y.Z_x64.dmg

# 2. En el repo homebrew-tap, actualizar Casks/portable-editor.rb:
#    - version "X.Y.Z"
#    - sha256 arm: "...", intel: "..."  (los que salieron arriba)

# 3. Auditar antes de pushear
brew audit --cask --online jrodrigopuca/tap/portable-editor

# 4. Commit + push al repo homebrew-tap
```

Candidato a automatizar más adelante: `brew bump-cask-pr` puede armar el PR de actualización solo si se le da la URL del release nuevo — evaluarlo cuando el ritmo de releases lo justifique (mismo criterio que la automatización de AUR).
