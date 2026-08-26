// The one frontend module that talks to Rust. Every command in
// src-tauri/src/lib.rs gets a typed wrapper here, so a typo in a command
// name or a payload key fails once, in one place, instead of at runtime in
// whichever flow happened to call `invoke` by hand.

import { invoke } from "@tauri-apps/api/core";
import type { Eol } from "./document";

/** Shape returned by the `read_file` command; see `src-tauri/src/text_io.rs`. */
export interface DecodedFile {
  contents: string;
  encoding: string;
  eol: Eol;
  mixed_eol: boolean;
  likely_binary: boolean;
}

/** Shape of `startup_file`'s return and the `open-file` event payload. */
export interface StartupTarget {
  path: string;
  exists: boolean;
  /** Other files handed to the OS "Open with..." at once, dropped because
   * portable-editor only opens one — see notifyExtraFilesIgnored() in main.ts. */
  extra_ignored: number;
}

/**
 * Ids of the native menu items, as emitted on the `menu-action` event. Rust
 * (`build_menu` in lib.rs) is the source of truth — these must match its
 * `MenuItemBuilder::with_id(...)` strings byte for byte.
 */
export const MENU_ACTION = {
  NEW: "new",
  OPEN: "open",
  SAVE: "save",
  SAVE_AS: "save_as",
  SHORTCUTS: "shortcuts",
  INSTALL_CLI: "install-cli",
} as const;
export type MenuAction = (typeof MENU_ACTION)[keyof typeof MENU_ACTION];

const MENU_ACTION_IDS: readonly string[] = Object.values(MENU_ACTION);

export function isMenuAction(value: unknown): value is MenuAction {
  return typeof value === "string" && MENU_ACTION_IDS.includes(value);
}

export function readFile(path: string): Promise<DecodedFile> {
  return invoke<DecodedFile>("read_file", { path });
}

/** Atomic write; resolves with the file's resulting mtime (ms since epoch). */
export function writeFile(path: string, contents: string, eol: Eol): Promise<number> {
  return invoke<number>("write_file", { path, contents, eol });
}

/** Millis since epoch; rejects if the path can't be stat'ed. */
export function fileMtime(path: string): Promise<number> {
  return invoke<number>("file_mtime", { path });
}

export function startupFile(): Promise<StartupTarget | null> {
  return invoke<StartupTarget | null>("startup_file");
}

export function saveRecovery(path: string, contents: string): Promise<void> {
  return invoke<void>("save_recovery", { path, contents });
}

export function readRecovery(path: string): Promise<string | null> {
  return invoke<string | null>("read_recovery", { path });
}

export function clearRecovery(path: string): Promise<void> {
  return invoke<void>("clear_recovery", { path });
}

/** macOS only; rejects with an explanatory message elsewhere. */
export function installCliCommand(): Promise<string> {
  return invoke<string>("install_cli_command");
}

/** Startup benchmarking hook (`scripts/bench-startup.sh`); no runtime effect. */
export function signalReady(): Promise<void> {
  return invoke<void>("signal_ready");
}
