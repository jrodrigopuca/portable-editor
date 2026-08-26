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
- [ ] `portable-editor archivo-que-no-existe.txt` abre un editor vacío con ese nombre en la status bar (no otro archivo, no error) — guardar crea el archivo en ese path sin pedir ubicación
- [ ] Con un archivo abierto y SIN cambios sin guardar: `portable-editor otro.txt` desde otra terminal pregunta antes de reemplazarlo (no lo hace en silencio)
- [ ] Dos invocaciones CLI casi simultáneas (`portable-editor a.txt & portable-editor b.txt &` en la misma línea) → los dos diálogos de confirmación aparecen uno a la vez, en orden, no superpuestos; el resultado final es consistente con las respuestas dadas (no "gana" el que resuelve más rápido)
- [ ] (macOS) Help → "Install 'portable-editor' Command" instala el symlink; `which portable-editor` lo resuelve desde una terminal nueva
- [ ] Editar un archivo sin guardar, esperar >10s, matar el proceso (`kill -9`, no cerrar normal) → reabrir el mismo archivo pregunta si recuperar; aceptar muestra el contenido editado con el punto de "sin guardar"; guardar limpia el recovery
- [ ] (Solo bundle instalado) "Open with..." desde Finder/file manager funciona
- [ ] Abrir un `.ts` o `.py` → highlighting correcto y lenguaje en la status bar

## Robustez

- [ ] Con un archivo abierto y SIN ediciones: modificarlo desde otra terminal (`echo x >> archivo`) → se recarga solo en ~2 s
- [ ] Con ediciones locales + cambio externo → aparece el prompt de conflicto
- [ ] Guardar un archivo con permisos de solo lectura → muestra error claro, no crashea
- [ ] Cerrar la ventana con cambios sin guardar → pide confirmación
- [ ] Abrir un `.txt` en Windows-1252 sin BOM (con tildes/ñ) → status bar muestra "Windows-1252", texto legible; editar y guardar → status bar pasa a "UTF-8"
- [ ] Abrir un `.txt` con fin de línea CRLF → status bar muestra "CRLF"; editar y guardar → el archivo conserva CRLF (no se convierte a LF)
- [ ] Abrir un `.txt` con mayoría de líneas LF y una sola línea CRLF → status bar muestra "LF (mixed)"; guardar sin editar nada preserva el archivo byte a byte (no convierte todo a CRLF)
- [ ] Abrir un archivo de ~11 MB → abre editable pero sin highlighting ("Plain text (highlighting off, large file)" en la status bar)
- [ ] Intentar abrir un archivo de más de 100 MB → rechaza con diálogo de error claro, no cuelga la app
- [ ] Con un archivo abierto y sin ediciones: borrarlo desde otra terminal → status bar muestra "(deleted on disk)" en ~2 s; `Mod+S` abre "Save as" en vez de guardar en silencio
- [ ] Abrir un archivo binario (ej. un `.png`) → aparece el diálogo de advertencia "doesn't look like a text file"; cancelar no lo abre, aceptar sí
- [ ] Con un archivo de texto abierto SIN ediciones, `Mod+S` → no reescribe el archivo (verificar mtime sin cambios)

## Preferencias y sesión

- [ ] Cambiar tema → cambia editor y status bar; sobrevive a reiniciar la app
- [ ] `Mod+=` / `Mod+-` / `Mod+0` ajustan la fuente; sobrevive a reiniciar
- [ ] `Alt+Z` y el botón Wrap conmutan el ajuste de línea; sobrevive a reiniciar
- [ ] Dropdown "Recent" lista los últimos archivos y los abre
- [ ] Reiniciar la app sin argumentos → reabre el último archivo en la misma línea/columna

## Editor

- [ ] `Mod+F` abre búsqueda y encuentra texto
- [ ] `Mod+Z` / `Mod+Shift+Z` deshacen/rehacen
- [ ] Guardar un archivo, escribir texto, deshacer con `Mod+Z` hasta volver exactamente al contenido guardado → el punto de "sin guardar" (●) desaparece solo
- [ ] `Mod+D` selecciona la siguiente ocurrencia; `Alt+click` agrega cursor
- [ ] Números de línea visibles y línea activa resaltada

## Menú nativo

- [ ] Menú **File** visible con New/Open…/Save/Save As…, cada uno con su atajo al lado
- [ ] Los 4 atajos del File menu funcionan y no abren nada dos veces (probar Open y Save As en particular)
- [ ] macOS: el primer menú (izquierda) muestra el nombre de la app, con "About portable-editor" adentro mostrando la versión correcta
- [ ] `Mod+Shift+/` (o Help → Keyboard Shortcuts) abre el panel de atajos; `Esc`, la ✕ y el click afuera lo cierran
- [ ] `Mod+/` con el cursor en una línea la comenta/descomenta (no abre el panel de atajos)
- [ ] Seleccionar texto en el editor, abrir el panel de atajos y cerrarlo con `Esc` → la selección sigue intacta (no se colapsa)
- [ ] (Linux) `Mod+C` / `Mod+X` / `Mod+V` / `Mod+A` funcionan dentro del editor sin necesidad de un menú Edit (no hay ninguno en Linux, a diferencia de macOS)
- [ ] `Mod+F` abre el panel de búsqueda con estilo consistente en los 4 temas (no el gris default de CodeMirror); la ✕ de cerrar se ve bien, no se superpone con otros controles
- [ ] `Mod+Alt+G` abre "ir a línea"
- [ ] Abrir un archivo con indentación de 4 espacios → botón de status bar muestra "Spaces: 4"; con tabs → "Tabs"; click cicla 2→4→8→Tabs
