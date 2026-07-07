import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { createEditor } from "./editor";
import { DEFAULT_THEME_ID, THEMES, themeById } from "./themes";

const APP_NAME = "portable-editor";
const THEME_KEY = "portable-editor:theme";
const FONT_KEY = "portable-editor:font-size";
const FONT_DEFAULT = 14;
const FONT_MIN = 9;
const FONT_MAX = 28;

const appWindow = getCurrentWindow();

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Falta el elemento #${id}`);
  return node as T;
}

const el = {
  editor: byId<HTMLDivElement>("editor"),
  btnNew: byId<HTMLButtonElement>("btn-new"),
  btnOpen: byId<HTMLButtonElement>("btn-open"),
  btnSave: byId<HTMLButtonElement>("btn-save"),
  fileName: byId<HTMLSpanElement>("file-name"),
  dirtyDot: byId<HTMLSpanElement>("file-dirty"),
  cursorPos: byId<HTMLSpanElement>("cursor-pos"),
  language: byId<HTMLSpanElement>("language"),
  themeSelect: byId<HTMLSelectElement>("theme-select"),
};

interface DocState {
  path: string | null;
  dirty: boolean;
}

const doc: DocState = { path: null, dirty: false };
let fontSize = readStoredFont();

const editor = createEditor(el.editor, {
  onDocChanged: () => {
    if (!doc.dirty) {
      doc.dirty = true;
      updateStatus();
    }
  },
  onCursorMoved: (line, col) => {
    el.cursorPos.textContent = `Ln ${line}, Col ${col}`;
  },
});

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function fileLabel(): string {
  return doc.path === null ? "sin título" : basename(doc.path);
}

function updateStatus(): void {
  el.fileName.textContent = fileLabel();
  el.fileName.title = doc.path ?? "";
  el.dirtyDot.hidden = !doc.dirty;
  void appWindow.setTitle(`${doc.dirty ? "● " : ""}${fileLabel()} — ${APP_NAME}`);
}

async function applyLanguage(): Promise<void> {
  el.language.textContent = await editor.detectLanguage(doc.path);
}

async function confirmDiscard(): Promise<boolean> {
  if (!doc.dirty) return true;
  return ask("Hay cambios sin guardar. ¿Descartarlos?", { title: APP_NAME, kind: "warning" });
}

async function newFile(): Promise<void> {
  if (!(await confirmDiscard())) return;
  editor.setText("");
  doc.path = null;
  doc.dirty = false;
  updateStatus();
  await applyLanguage();
  editor.focus();
}

async function openFile(presetPath?: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  const path = presetPath ?? (await openDialog({ multiple: false, title: "Abrir archivo" }));
  if (typeof path !== "string") return;

  try {
    const contents = await invoke<string>("read_file", { path });
    editor.setText(contents);
    doc.path = path;
    doc.dirty = false;
    updateStatus();
    await applyLanguage();
    editor.focus();
  } catch (err) {
    await message(String(err), { title: APP_NAME, kind: "error" });
  }
}

async function saveFile(): Promise<void> {
  if (doc.path === null) {
    await saveFileAs();
    return;
  }
  if (await writeTo(doc.path)) updateStatus();
}

async function saveFileAs(): Promise<void> {
  const path = await saveDialog({ title: "Guardar como", defaultPath: doc.path ?? undefined });
  if (path === null) return;
  if (await writeTo(path)) {
    doc.path = path;
    updateStatus();
    await applyLanguage();
  }
}

async function writeTo(path: string): Promise<boolean> {
  try {
    await invoke("write_file", { path, contents: editor.getText() });
    doc.dirty = false;
    return true;
  } catch (err) {
    await message(String(err), { title: APP_NAME, kind: "error" });
    return false;
  }
}

function readStoredFont(): number {
  const stored = Number(localStorage.getItem(FONT_KEY));
  return Number.isFinite(stored) && stored >= FONT_MIN && stored <= FONT_MAX
    ? stored
    : FONT_DEFAULT;
}

function applyFont(): void {
  document.documentElement.style.setProperty("--editor-font-size", `${fontSize}px`);
  localStorage.setItem(FONT_KEY, String(fontSize));
}

function adjustFont(delta: number): void {
  fontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, fontSize + delta));
  applyFont();
}

function applyTheme(id: string): void {
  const theme = themeById(id);
  editor.setTheme(theme.id);
  document.body.dataset.dark = String(theme.dark);
  localStorage.setItem(THEME_KEY, theme.id);
}

function initThemes(): void {
  for (const theme of THEMES) {
    const option = document.createElement("option");
    option.value = theme.id;
    option.textContent = theme.label;
    el.themeSelect.appendChild(option);
  }
  const initial = themeById(localStorage.getItem(THEME_KEY) ?? DEFAULT_THEME_ID);
  el.themeSelect.value = initial.id;
  applyTheme(initial.id);
  el.themeSelect.addEventListener("change", () => {
    applyTheme(el.themeSelect.value);
    editor.focus();
  });
}

window.addEventListener(
  "keydown",
  (event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();

    if (key === "o") {
      event.preventDefault();
      void openFile();
    } else if (key === "s" && event.shiftKey) {
      event.preventDefault();
      void saveFileAs();
    } else if (key === "s") {
      event.preventDefault();
      void saveFile();
    } else if (key === "n") {
      event.preventDefault();
      void newFile();
    } else if (key === "=" || key === "+") {
      event.preventDefault();
      adjustFont(1);
    } else if (key === "-") {
      event.preventDefault();
      adjustFont(-1);
    } else if (key === "0") {
      event.preventDefault();
      fontSize = FONT_DEFAULT;
      applyFont();
    }
  },
  { capture: true },
);

void appWindow.onCloseRequested(async (event) => {
  if (doc.dirty && !(await confirmDiscard())) event.preventDefault();
});

el.btnNew.addEventListener("click", () => void newFile());
el.btnOpen.addEventListener("click", () => void openFile());
el.btnSave.addEventListener("click", () => void saveFile());

// Archivos soltados sobre la ventana (el drop del webview trae paths reales)
void getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type !== "drop") return;
  const [path] = event.payload.paths;
  if (path !== undefined) void openFile(path);
});

// "Abrir con..." del sistema con la app ya corriendo (macOS emite open-file desde Rust)
void listen<string>("open-file", (event) => void openFile(event.payload));

async function init(): Promise<void> {
  applyFont();
  initThemes();
  const startup = await invoke<string | null>("startup_file");
  if (startup !== null) {
    await openFile(startup);
  } else {
    updateStatus();
    await applyLanguage();
  }
  editor.focus();
}

void init();
