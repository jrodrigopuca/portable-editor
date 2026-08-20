import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask, message, open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { createEditor, PLAIN_TEXT_LABEL } from "./editor";
import {
  detectIndent,
  type IndentInfo,
  indentLabel,
  indentUnitString,
  nextIndentPreset,
} from "./indent";
import { basename } from "./paths";
import { clampFontSize, FONT_DEFAULT, parseFontSize } from "./prefs";
import {
  addRecent,
  parseRecent,
  RECENT_MAX,
  type RecentEntry,
  removeRecent,
  withCursor,
} from "./recent";
import { DEFAULT_THEME_ID, THEMES, themeById } from "./themes";

const APP_NAME = "portable-editor";
const THEME_KEY = "portable-editor:theme";
const FONT_KEY = "portable-editor:font-size";
const WRAP_KEY = "portable-editor:wrap";
const RECENT_KEY = "portable-editor:recent";
const MTIME_POLL_MS = 2000;
// Above this, skip syntax highlighting to keep the editor responsive. See
// docs/ROADMAP.md Fase 3 — read_file itself rejects anything past 100 MB.
const HIGHLIGHT_SIZE_LIMIT = 10 * 1024 * 1024;

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
  encoding: byId<HTMLSpanElement>("encoding"),
  eol: byId<HTMLSpanElement>("eol"),
  btnIndent: byId<HTMLButtonElement>("btn-indent"),
  themeSelect: byId<HTMLSelectElement>("theme-select"),
  shortcutsPanel: byId<HTMLDivElement>("shortcuts-panel"),
  shortcutsBackdrop: byId<HTMLDivElement>("shortcuts-backdrop"),
  shortcutsList: byId<HTMLTableElement>("shortcuts-list"),
  btnCloseShortcuts: byId<HTMLButtonElement>("btn-close-shortcuts"),
};

const EOL = { LF: "LF", CRLF: "CRLF" } as const;
type Eol = (typeof EOL)[keyof typeof EOL];
const ENCODING_UTF8 = "UTF-8";

/** Shape returned by the `read_file` command; see `src-tauri/src/text_io.rs`. */
interface DecodedFile {
  contents: string;
  encoding: string;
  eol: Eol;
}

interface DocState {
  path: string | null;
  dirty: boolean;
  mtime: number | null;
  encoding: string;
  eol: Eol;
  /** True once a poll finds `path` gone (deleted or renamed elsewhere). */
  missing: boolean;
  indent: IndentInfo;
}

const doc: DocState = {
  path: null,
  dirty: false,
  mtime: null,
  encoding: ENCODING_UTF8,
  eol: EOL.LF,
  missing: false,
  indent: detectIndent(""),
};
const lastCursor = { line: 1, col: 1 };
let fontSize = parseFontSize(localStorage.getItem(FONT_KEY));
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

function fileLabel(): string {
  return doc.path === null ? "untitled" : basename(doc.path);
}

function updateStatus(): void {
  el.fileName.textContent = doc.missing ? `${fileLabel()} (deleted on disk)` : fileLabel();
  el.fileName.title = doc.path ?? "";
  el.dirtyDot.hidden = !doc.dirty;
  el.encoding.textContent = doc.encoding;
  el.eol.textContent = doc.eol;
  void appWindow.setTitle(`${doc.dirty ? "● " : ""}${fileLabel()} — ${APP_NAME}`);
}

function applyIndent(): void {
  editor.setIndentUnit(indentUnitString(doc.indent));
  el.btnIndent.textContent = indentLabel(doc.indent);
}

async function applyLanguage(): Promise<void> {
  if (editor.getText().length > HIGHLIGHT_SIZE_LIMIT) {
    editor.setPlainText();
    el.language.textContent = `${PLAIN_TEXT_LABEL} (highlighting off, large file)`;
    return;
  }
  el.language.textContent = await editor.detectLanguage(doc.path);
}

async function confirmDiscard(): Promise<boolean> {
  if (!doc.dirty) return true;
  return ask("You have unsaved changes. Discard them?", { title: APP_NAME, kind: "warning" });
}

// ---------- Recent files (pure logic lives in recent.ts) ----------

function loadRecent(): RecentEntry[] {
  return parseRecent(localStorage.getItem(RECENT_KEY));
}

function saveRecent(entries: RecentEntry[]): void {
  localStorage.setItem(RECENT_KEY, JSON.stringify(entries.slice(0, RECENT_MAX)));
}

function rememberRecent(path: string): void {
  saveRecent(addRecent(loadRecent(), path));
}

function forgetRecent(path: string): void {
  saveRecent(removeRecent(loadRecent(), path));
  renderRecent();
}

/** Persists the current file's cursor position into its recent-files entry. */
function syncRecentCursor(): void {
  if (doc.path === null) return;
  saveRecent(withCursor(loadRecent(), doc.path, lastCursor.line, lastCursor.col));
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
  doc.missing = false;
  updateStatus();
  rememberRecent(path);
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
  doc.encoding = ENCODING_UTF8;
  doc.eol = EOL.LF;
  doc.missing = false;
  doc.indent = detectIndent("");
  updateStatus();
  await applyLanguage();
  applyIndent();
  editor.focus();
}

async function openFile(presetPath?: string): Promise<void> {
  if (!(await confirmDiscard())) return;
  const path = presetPath ?? (await openDialog({ multiple: false, title: "Open file" }));
  if (typeof path !== "string") return;

  try {
    const file = await invoke<DecodedFile>("read_file", { path });
    syncRecentCursor();
    doc.encoding = file.encoding;
    doc.eol = file.eol;
    doc.indent = detectIndent(file.contents);
    editor.setText(file.contents);
    applyIndent();
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
    const file = await invoke<DecodedFile>("read_file", { path: last.path });
    doc.encoding = file.encoding;
    doc.eol = file.eol;
    doc.indent = detectIndent(file.contents);
    editor.setText(file.contents);
    applyIndent();
    await afterFileLoaded(last.path);
    editor.setCursor(last.line, last.col);
  } catch {
    forgetRecent(last.path);
  }
}

async function saveFile(): Promise<void> {
  // No known-good path to overwrite: either untitled, or the file vanished
  // from under us (deleted/renamed) — let the user pick where it goes.
  if (doc.path === null || doc.missing) {
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
    await invoke("write_file", { path, contents: editor.getText(), eol: doc.eol });
    doc.dirty = false;
    // Save policy: always UTF-8 on disk, regardless of the source encoding.
    doc.encoding = ENCODING_UTF8;
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
  const file = await invoke<DecodedFile>("read_file", { path: doc.path });
  doc.encoding = file.encoding;
  doc.eol = file.eol;
  doc.indent = detectIndent(file.contents);
  editor.replaceText(file.contents);
  applyIndent();
  doc.dirty = false;
  updateStatus();
}

let checkingExternal = false;

async function checkExternalChange(): Promise<void> {
  if (checkingExternal || doc.path === null || doc.mtime === null) return;
  checkingExternal = true;
  try {
    const mtime = await invoke<number>("file_mtime", { path: doc.path });
    if (doc.missing) {
      // Reappeared (e.g. another app's own atomic rename finished mid-poll).
      doc.missing = false;
      updateStatus();
    }
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
    // Deleted, renamed, or temporarily unreadable: don't nag with a dialog,
    // just flag it so the next save asks where to put the file instead of
    // silently writing to a path that's no longer there.
    if (!doc.missing) {
      doc.missing = true;
      updateStatus();
    }
  } finally {
    checkingExternal = false;
  }
}

// ---------- View preferences ----------

function applyFont(): void {
  document.documentElement.style.setProperty("--editor-font-size", `${fontSize}px`);
  localStorage.setItem(FONT_KEY, String(fontSize));
}

function adjustFont(delta: number): void {
  fontSize = clampFontSize(fontSize + delta);
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

// ---------- Keyboard shortcuts panel ----------

interface ShortcutEntry {
  keys: string;
  action: string;
}

// Keep in sync with the "Atajos" table in README.md.
const SHORTCUTS: readonly ShortcutEntry[] = [
  { keys: "Mod+O", action: "Open file" },
  { keys: "Mod+S", action: "Save" },
  { keys: "Mod+Shift+S", action: "Save as" },
  { keys: "Mod+N", action: "New file" },
  { keys: "Mod+F", action: "Find / replace" },
  { keys: "Mod+Alt+G", action: "Go to line" },
  { keys: "Mod+Z", action: "Undo" },
  { keys: "Mod+Shift+Z", action: "Redo" },
  { keys: "Mod+D", action: "Select next occurrence" },
  { keys: "Alt+click", action: "Add cursor" },
  { keys: "Mod+=", action: "Increase font size" },
  { keys: "Mod+-", action: "Decrease font size" },
  { keys: "Mod+0", action: "Reset font size" },
  { keys: "Alt+Z", action: "Toggle word wrap" },
  { keys: "Mod+/", action: "Show this panel" },
];

const isMac = navigator.userAgent.includes("Mac");

function formatKeys(keys: string): string {
  const symbols: Record<string, string> = {
    Mod: isMac ? "⌘" : "Ctrl",
    Alt: isMac ? "⌥" : "Alt",
    Shift: isMac ? "⇧" : "Shift",
  };
  return keys
    .split("+")
    .map((part) => symbols[part] ?? part)
    .join(isMac ? "" : "+");
}

function renderShortcuts(): void {
  el.shortcutsList.replaceChildren();
  for (const { keys, action } of SHORTCUTS) {
    const row = document.createElement("tr");
    const keysCell = document.createElement("td");
    keysCell.className = "shortcut-keys";
    keysCell.textContent = formatKeys(keys);
    const actionCell = document.createElement("td");
    actionCell.textContent = action;
    row.append(keysCell, actionCell);
    el.shortcutsList.appendChild(row);
  }
}

function openShortcuts(): void {
  el.shortcutsPanel.hidden = false;
}

function closeShortcuts(): void {
  el.shortcutsPanel.hidden = true;
}

// ---------- UI events ----------

window.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape" && !el.shortcutsPanel.hidden) {
      event.preventDefault();
      closeShortcuts();
      return;
    }
    if (event.altKey && event.code === "KeyZ") {
      event.preventDefault();
      toggleWrap();
      return;
    }
    if (!(event.metaKey || event.ctrlKey)) return;
    const key = event.key.toLowerCase();

    // New/Open/Save/Save As are handled by the native File menu (see
    // src-tauri/src/lib.rs) — not duplicated here to avoid double-firing
    // (e.g. two "Save as" dialogs).
    if (key === "=" || key === "+") {
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
el.btnIndent.addEventListener("click", () => {
  doc.indent = nextIndentPreset(doc.indent);
  applyIndent();
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

// Native File menu clicks/accelerators (see src-tauri/src/lib.rs build_menu)
void listen<string>("menu-action", (event) => {
  switch (event.payload) {
    case "new":
      void newFile();
      break;
    case "open":
      void openFile();
      break;
    case "save":
      void saveFile();
      break;
    case "save_as":
      void saveFileAs();
      break;
    case "shortcuts":
      openShortcuts();
      break;
  }
});

el.btnCloseShortcuts.addEventListener("click", () => closeShortcuts());
el.shortcutsBackdrop.addEventListener("click", () => closeShortcuts());

// ---------- Init ----------

async function init(): Promise<void> {
  applyFont();
  applyWrap();
  applyIndent();
  initThemes();
  renderRecent();
  renderShortcuts();
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
