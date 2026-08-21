# AUR — guía paso a paso (pendiente de ejecutar)

Runbook detallado para publicar `portable-editor` en el AUR (Arch User Repository). **No ejecutado todavía** — ninguno de los pasos de acá se probó en una máquina Arch real (no hay una disponible en las sesiones de trabajo hasta ahora). Tratar el PKGBUILD de abajo como un punto de partida sólido, no como algo verificado.

## Qué es el AUR, en concreto

No es el repo oficial de Arch (`core`/`extra`) — es un repositorio **comunitario de scripts de build** (`PKGBUILD`), sin revisión editorial. Cualquiera con cuenta puede subir un paquete. Los usuarios lo instalan con un AUR helper (`yay`, `paru`) que clona el PKGBUILD, lo ejecuta con `makepkg`, y arma un paquete `.pkg.tar.zst` real.

## Por qué un paquete `-bin`, no compilar desde fuente

Ya existe un artefacto pre-compilado en cada release (`portable-editor_<version>_amd64.AppImage`). Un paquete `-bin` lo descarga y lo instala tal cual — nada de compilar Rust/Tauri en la máquina del usuario. Es la opción de menor mantenimiento y la convención estándar para apps con release binarios ya publicados. El nombre de paquete en AUR, por convención, sería `portable-editor-bin`.

## Prerrequisitos (una sola vez, y son tuyos — no delegables)

1. Cuenta en [aur.archlinux.org](https://aur.archlinux.org) (gratis, con verificación de mail).
2. Una clave SSH generada y **registrada en tu perfil de AUR** (Preferencias → "My SSH Public Keys"). Si no tenés una específica para esto:
   ```sh
   ssh-keygen -t ed25519 -C "aur-portable-editor" -f ~/.ssh/aur_portable_editor
   ```
   Pegar el contenido de `~/.ssh/aur_portable_editor.pub` en el perfil de AUR.
3. (Recomendado, no obligatorio) Una VM o contenedor Arch para probar el build antes de publicarlo — publicar un PKGBUILD roto es un mal primer impresión. Opciones sin instalar Arch en la máquina real:
   ```sh
   docker run --rm -it archlinux:latest bash
   # adentro: pacman -Syu --noconfirm base-devel git
   ```

## El PKGBUILD

Punto de partida — **el `sha256sums` es un placeholder**, hay que calcularlo del artefacto real una vez que exista el release que se va a empaquetar (ver "Flujo para cada release" más abajo).

```bash
# Maintainer: Juan Rodrigo Puca <jrodrigopuca@gmail.com>
pkgname=portable-editor-bin
pkgver=0.1.0
pkgrel=1
pkgdesc="Minimalist one-file-at-a-time text editor (Tauri 2 + CodeMirror 6)"
arch=('x86_64')
url="https://github.com/jrodrigopuca/portable-editor"
license=('Apache-2.0')
provides=('portable-editor')
conflicts=('portable-editor')
# Dependencias de runtime de un webview Tauri en Linux — verificar contra una
# instalación limpia antes de publicar, esta lista es best-effort, no probada.
depends=('gtk3' 'webkit2gtk-4.1')
source=("${pkgname}-${pkgver}.AppImage::https://github.com/jrodrigopuca/portable-editor/releases/download/v${pkgver}/portable-editor_${pkgver}_amd64.AppImage")
sha256sums=('REEMPLAZAR_CON_EL_HASH_REAL')

package() {
  install -Dm755 "${srcdir}/${pkgname}-${pkgver}.AppImage" "${pkgdir}/usr/bin/portable-editor"

  # Integración con el menú de aplicaciones: extrae ícono + .desktop del
  # AppImage en vez de escribirlos a mano, así quedan consistentes con lo que
  # el propio bundle de Tauri ya generó.
  cd "${srcdir}"
  "${pkgdir}/usr/bin/portable-editor" --appimage-extract >/dev/null
  install -Dm644 squashfs-root/portable-editor.desktop \
    "${pkgdir}/usr/share/applications/portable-editor.desktop"
  install -Dm644 squashfs-root/portable-editor.png \
    "${pkgdir}/usr/share/icons/hicolor/128x128/apps/portable-editor.png"
  rm -rf squashfs-root
}
```

**Sin verificar, marcar como pendiente el día que se ejecute:**
- Que `depends` esté completo — probar `ldd` sobre el binario extraído del AppImage en un Arch limpio, o simplemente instalar el paquete en un contenedor fresh y ver qué falta.
- Que `--appimage-extract` deje los archivos con esos nombres exactos (`portable-editor.desktop`/`.png`) — depende de cómo `tauri-bundler` arma el AppImage; confirmar extrayendo uno real antes de confiar en el PKGBUILD.

## Flujo paso a paso para publicar (la primera vez)

1. Con el release ya publicado en GitHub (ver `docs/RELEASE.md`), bajar el AppImage y calcular el hash real:
   ```sh
   curl -LO https://github.com/jrodrigopuca/portable-editor/releases/download/v0.1.0/portable-editor_0.1.0_amd64.AppImage
   sha256sum portable-editor_0.1.0_amd64.AppImage
   ```
   Pegar ese hash en `sha256sums` del PKGBUILD.

2. Clonar el repo de AUR para este paquete (se crea vacío la primera vez, con la misma URL SSH):
   ```sh
   git clone ssh://aur@aur.archlinux.org/portable-editor-bin.git
   cd portable-editor-bin
   ```

3. Copiar el `PKGBUILD` final adentro, y generar el `.SRCINFO` (metadata que AUR necesita, se autogenera, **nunca se edita a mano**):
   ```sh
   makepkg --printsrcinfo > .SRCINFO
   ```

4. Probar que compila/empaqueta antes de subir nada (en la VM/contenedor Arch):
   ```sh
   makepkg -si   # -s resuelve deps, -i instala al final si todo salió bien
   ```
   Si falla acá, no se publica hasta resolverlo.

5. Commit y push:
   ```sh
   git add PKGBUILD .SRCINFO
   git commit -m "Initial import: portable-editor-bin 0.1.0"
   git push origin master
   ```

6. Verificar que aparece en https://aur.archlinux.org/packages/portable-editor-bin

## Flujo para cada release nuevo (mantenimiento)

1. Bajar el nuevo AppImage, recalcular `sha256sum`.
2. En el PKGBUILD: actualizar `pkgver` (y resetear `pkgrel=1`, salvo que sea un fix del PKGBUILD mismo sin cambio de versión del programa, en cuyo caso se sube `pkgrel`).
3. `makepkg --printsrcinfo > .SRCINFO` de nuevo.
4. `makepkg -si` para confirmar que sigue andando.
5. Commit + push, mismo repo de AUR.

Candidato a automatizar más adelante (no ahora): un paso en `release.yml` que dispare esta actualización sola cuando se publica un release — hay acciones de GitHub ya armadas para esto (`aur-publish` u similares), evaluarlo cuando el ritmo de releases lo justifique.

## Qué NO hacer

- No usar `sha256sums=('SKIP')` — es aceptable para paquetes `-git` (que compilan desde un commit específico y cambian todo el tiempo), pero para un `-bin` atado a un release fijo, saltear el checksum es saltear la única garantía de que el usuario recibe el binario que vos publicaste.
- No editar `.SRCINFO` a mano — siempre regenerarlo desde el PKGBUILD.
- No publicar sin haber corrido `makepkg -si` al menos una vez en un Arch real (o contenedor) — un PKGBUILD que no compila es la forma más rápida de perder confianza en un paquete nuevo del AUR.
