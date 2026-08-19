# Smoke test manual

Checklist a correr antes de cada release (hasta que exista E2E automatizado). Tiempo estimado: 10 minutos. Correr sobre el bundle buildeado, no sobre `tauri dev`, al validar un release.

## Básicos

- [ ] La app abre y muestra el editor vacío ("untitled", Ln 1 Col 1, Plain text)
- [ ] Escribir texto → aparece el punto de sin-guardar (●) en status bar y título
- [ ] `Mod+S` en archivo nuevo → abre "Save as", guarda, desaparece el ●
- [ ] Editar y `Mod+S` → guarda directo sin diálogo
- [ ] `Mod+Shift+S` → "Save as" con el path actual como default
- [ ] `Mod+N` con cambios sin guardar → pide confirmación

## Apertura (las 4 vías)

- [ ] Botón **Open** y `Mod+O` abren el diálogo nativo
- [ ] Drag & drop de un archivo a la ventana lo abre
- [ ] Terminal: `portable-editor archivo.txt` abre el archivo
- [ ] Con la app abierta, `portable-editor otro.txt` desde otra terminal reutiliza la ventana (single instance)
- [ ] (Solo bundle instalado) "Open with..." desde Finder/file manager funciona
- [ ] Abrir un `.ts` o `.py` → highlighting correcto y lenguaje en la status bar

## Robustez

- [ ] Con un archivo abierto y SIN ediciones: modificarlo desde otra terminal (`echo x >> archivo`) → se recarga solo en ~2 s
- [ ] Con ediciones locales + cambio externo → aparece el prompt de conflicto
- [ ] Guardar un archivo con permisos de solo lectura → muestra error claro, no crashea
- [ ] Cerrar la ventana con cambios sin guardar → pide confirmación
- [ ] Abrir un `.txt` en Windows-1252 sin BOM (con tildes/ñ) → status bar muestra "Windows-1252", texto legible; editar y guardar → status bar pasa a "UTF-8"
- [ ] Abrir un `.txt` con fin de línea CRLF → status bar muestra "CRLF"; editar y guardar → el archivo conserva CRLF (no se convierte a LF)
- [ ] Abrir un archivo de ~11 MB → abre editable pero sin highlighting ("Plain text (highlighting off, large file)" en la status bar)
- [ ] Intentar abrir un archivo de más de 100 MB → rechaza con diálogo de error claro, no cuelga la app

## Preferencias y sesión

- [ ] Cambiar tema → cambia editor y status bar; sobrevive a reiniciar la app
- [ ] `Mod+=` / `Mod+-` / `Mod+0` ajustan la fuente; sobrevive a reiniciar
- [ ] `Alt+Z` y el botón Wrap conmutan el ajuste de línea; sobrevive a reiniciar
- [ ] Dropdown "Recent" lista los últimos archivos y los abre
- [ ] Reiniciar la app sin argumentos → reabre el último archivo en la misma línea/columna

## Editor

- [ ] `Mod+F` abre búsqueda y encuentra texto
- [ ] `Mod+Z` / `Mod+Shift+Z` deshacen/rehacen
- [ ] `Mod+D` selecciona la siguiente ocurrencia; `Alt+click` agrega cursor
- [ ] Números de línea visibles y línea activa resaltada
