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
const WRAP_KEY = "portable-editor:wrap";
const RECENT_KEY = "portable-editor:recent";
const FONT_DEFAULT = 14;
const FONT_MIN = 9;
const FONT_MAX = 28;
const RECENT_MAX = 8;
const MTIME_POLL_MS = 2000;

const appWindow = getCurrentWindow();

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`Missing element #${id}`);
  return node as T;
}

const el = {
  editor: byId<HTMLDivElement>("editor"),
  btnNew: byId<HTMLButtonElement>("btn-new"),
  btnOpen: byId<HTMLButtonElement>("btn-open"),
  btnSave: byId<HTMLButtonElement>("btn-save"),
  btnWrap: byId<HTMLButtonElement>("btn-wrap"),
  recentSelect: byId<HTMLSelectElement>("recent-select"),
  fileName: byId<HTMLSpanElement>("file-name"),
  dirtyDot: byId<HTMLSpanElement>("file-dirty"),
  cursorPos: byId<HTMLSpanElement>("cursor-pos"),
  language: byId<HTMLSpanElement>("language"),
  themeSelect: byId<HTMLSelectElement>("theme-select"),
};

interface DocState {
  path: string | null;
  dirty: boolean;
  mtime: number | null;
}

interface RecentEntry {
  path: string;
  line: number;
  col: number;
}

const doc: DocState = { path: null, dirty: false, mtime: null };
const lastCursor = { line: 1, col: 1 };
let fontSize = readStoredFont();
let wrapOn = localStorage.getItem(WRAP_KEY) === "true";

const editor = createEditor(el.editor, {
  onDocChanged: () => {
    if (!doc.dirty) {
      doc.dirty = true;
      updateStatus();
    }
  },
  onCursorMoved: (line, col) => {
    lastCursor.line = line;
    lastCursor.col = col;
    el.cursorPos.textContent = `Ln ${line}, Col ${col}`;
  },
});

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function fileLabel(): string {
  return doc.path === null ? "untitled" : basename(doc.path);
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
  return ask("You have unsaved changes. Discard them?", { title: APP_NAME, kind: "warning" });
}

// ---------- Recent files ----------

function isRecentEntry(value: unknown): value is RecentEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Partial<RecentEntry>;
  return (
    typeof entry.path === "string" &&
    typeof entry.line === "number" &&
    typeof entry.col === "number"
  );
}

function loadRecent(): RecentEntry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter(isRecentEntry) : [];
  } catch {
    return [];
  }
}

function saveRecent(entries: RecentEntry[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_MAX)));
}

function upsertRecent(path: string): void {
  const entries = loadRecent();
  const existing = entries.find((entry) => entry.path === path);
  const rest = entries.filter((entry) => entry.path !== path);
  rest.unshift(existing ?? { path, line: 1, col: 1 });
  saveRecent(rest);
}

function forgetRecent(path: string): void {
  saveRecent(loadRecent().filter((entry) => entry.path !== path));
  renderRecent();
}

/** Persists the current file's cursor position into its recent-files entry. */
function syncRecentCursor(): void {
  if (doc.path === null) return;
  const entries = loadRecent();
  const entry = entries.find((item) => item.path === doc.path);
  if (entry === undefined) return;
  entry.line = lastCursor.line;
  entry.col = lastCursor.col;
  saveRecent(entries);
}

function renderRecent(): void {
  const entries = loadRecent();
  el.recentSelect.hidden = entries.length === 0;
  el.recentSelect.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.textContent = "Recent";
  placeholder.value = "";
  placeholder.disabled = true;
  placeholder.selected = true;
  el.recentSelect.appendChild(placeholder);
  for (const entry of entries) {
    const option = document.createElement("option");
    option.value = entry.path;
    option.textContent = basename(entry.path);
    option.title = entry.path;
    el.recentSelect.appendChild(option);
  }
}

// ---------- Open / save ----------

async function afterFileLoaded(path: string): Promise<void> {
  doc.path = path;
  doc.dirty = false;
  updateStatus();
  upsertRecent(path);
  renderRecent();
  await applyLanguage();
  await refreshMtime();
}

async function newFile(): Promise<void> {
  if (!(await confirmDiscard())) return;
  syncRecentCursor();
  editor.setText("");
  doc.path = null;
  doc.dirty = false;
  doc.mtime = null;
  updateStatus();
  await applyLanguage();
  editor.focus();
}

async function openFile(presetPath?: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  const path = presetPath ?? (await openDialog({ multiple: false, title: "Open file" }));
  if (typeof path !== "string") return;

  try {
    const contents = await invoke<string>("read_file", { path });
    syncRecentCursor();
    editor.setText(contents);
    await afterFileLoaded(path);
    editor.focus();
  } catch (err) {
    await message(String(err), { title: APP_NAME, kind: "error" });
    forgetRecent(path);
  }
}

/** Reopens the last file from the previous session, at the same position. */
async function restoreSession(): Promise<void> {
  const [last] = loadRecent();
  if (last === undefined) return;
  try {
    const contents = await invoke<string>("read_file", { path: last.path });
    editor.setText(contents);
    await afterFileLoaded(last.path);
    editor.setCursor(last.line, last.col);
  } catch {
    forgetRecent(last.path);
  }
}

async function saveFile(): Promise<void> {
  if (doc.path === null) {
    await saveFileAs();
    return;
  }
  if (await writeTo(doc.path)) {
    updateStatus();
    await refreshMtime();
  }
}

async function saveFileAs(): Promise<void> {
  const path = await saveDialog({ title: "Save as", defaultPath: doc.path ?? undefined });
  if (path === null) return;
  if (await writeTo(path)) await afterFileLoaded(path);
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

// ---------- External changes (mtime polling) ----------

async function refreshMtime(): Promise<void> {
  if (doc.path === null) {
    doc.mtime = null;
    return;
  }
  try {
    doc.mtime = await invoke<number>("file_mtime", { path: doc.path });
  } catch {
    doc.mtime = null;
  }
}

async function reloadFromDisk(): Promise<void> {
  if (doc.path === null) return;
  const contents = await invoke<string>("read_file", { path: doc.path });
  editor.replaceText(contents);
  doc.dirty = false;
  updateStatus();
}

let checkingExternal = false;

async function checkExternalChange(): Promise<void> {
  if (checkingExternal || doc.path === null || doc.mtime === null) return;
  checkingExternal = true;
  try {
    const mtime = await invoke<number>("file_mtime", { path: doc.path });
    if (mtime === doc.mtime) return;
    doc.mtime = mtime; // recorded: don't prompt again for the same change
    if (!doc.dirty) {
      await reloadFromDisk();
      return;
    }
    const reload = await ask(
      "The file changed on disk and you have unsaved changes. Reload it and discard them?",
      { title: APP_NAME, kind: "warning" },
    );
    if (reload) await reloadFromDisk();
  } catch {
    // deleted or temporarily unreadable: don't nag with dialogs
  } finally {
    checkingExternal = false;
  }
}

// ---------- View preferences ----------

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

function applyWrap(): void {
  editor.setWrap(wrapOn);
  el.btnWrap.textContent = `Wrap: ${wrapOn ? "on" : "off"}`;
  localStorage.setItem(WRAP_KEY, String(wrapOn));
}

function toggleWrap(): void {
  wrapOn = !wrapOn;
  applyWrap();
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

// ---------- UI events ----------

window.addEventListener(
  "keydown",
  (event) => {
    if (event.altKey && event.code === "KeyZ") {
      event.preventDefault();
      toggleWrap();
      return;
    }
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
  syncRecentCursor();
  if (doc.dirty && !(await confirmDiscard())) event.preventDefault();
});

el.btnNew.addEventListener("click", () => void newFile());
el.btnOpen.addEventListener("click", () => void openFile());
el.btnSave.addEventListener("click", () => void saveFile());
el.btnWrap.addEventListener("click", () => {
  toggleWrap();
  editor.focus();
});

el.recentSelect.addEventListener("change", () => {
  const path = el.recentSelect.value;
  el.recentSelect.selectedIndex = 0;
  if (path !== "") void openFile(path);
});

// Files dropped onto the window (the webview drop event carries real paths)
void getCurrentWebview().onDragDropEvent((event) => {
  if (event.payload.type !== "drop") return;
  const [path] = event.payload.paths;
  if (path !== undefined) void openFile(path);
});

// "Open with..." while the app is running (macOS) or a second CLI invocation
// (single-instance): both emit open-file from Rust
void listen<string>("open-file", (event) => void openFile(event.payload));

// ---------- Init ----------

async function init(): Promise<void> {
  applyFont();
  applyWrap();
  initThemes();
  renderRecent();
  const startup = await invoke<string | null>("startup_file");
  if (startup !== null) {
    await openFile(startup);
  } else {
    updateStatus();
    await applyLanguage();
    await restoreSession();
  }
  window.setInterval(() => void checkExternalChange(), MTIME_POLL_MS);
  window.addEventListener("focus", () => void checkExternalChange());
  editor.focus();
}

void init();
