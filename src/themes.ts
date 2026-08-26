import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

export const THEME_ID = {
  ONE_DARK: "one-dark",
  NORD: "nord",
  PAPER: "paper",
  SOLARIZED_LIGHT: "solarized-light",
} as const;

export type ThemeId = (typeof THEME_ID)[keyof typeof THEME_ID];

/**
 * Colors of the program's chrome — status bar, search panel, shortcuts
 * panel — as opposed to the editor's content. Every theme MUST say how its
 * chrome looks: a theme isn't finished until it does. (Until 2026-08-26 the
 * chrome was dark/light binary, and Nord and Solarized wore One Dark's and
 * GitHub's bars — "two apps glued together".) Published as `--chrome-*`
 * CSS variables by `applyTheme` in main.ts; styles.css only reads them.
 */
export interface ThemeChrome {
  background: string;
  foreground: string;
  /** Between chrome and editor, and around inputs. */
  border: string;
  /** Text fields and buttons inside the chrome (search panel). */
  field: string;
  /** Focus ring of those fields. */
  accent: string;
}

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  dark: boolean;
  extension: Extension;
  chrome: ThemeChrome;
}

// One Dark's own UI colors (Atom): the values the chrome had before it was
// per-theme. The palette lives in @codemirror/theme-one-dark, so it has no
// ThemePalette here — only its chrome.
const ONE_DARK_CHROME: ThemeChrome = {
  background: "#21252b",
  foreground: "#9da5b4",
  border: "#181a1f",
  field: "#2c313a",
  accent: "#528bff",
};

// Nord's chrome is LIGHTER than its editor (nord1 over nord0), the opposite
// of One Dark — exactly what a derived "darken the editor" rule would miss.
const NORD_CHROME: ThemeChrome = {
  background: "#3b4252",
  foreground: "#d8dee9",
  border: "#434c5e",
  field: "#434c5e",
  accent: "#88c0d0",
};

// GitHub light's chrome, as before.
const PAPER_CHROME: ThemeChrome = {
  background: "#f6f8fa",
  foreground: "#57606a",
  border: "#d0d7de",
  field: "#ffffff",
  accent: "#0969da",
};

// Solarized: base2 for surfaces, base00 for text, base3 (the editor's own
// background) for inputs — warm, like the editor, not GitHub's cool grey.
const SOLARIZED_LIGHT_CHROME: ThemeChrome = {
  background: "#eee8d5",
  foreground: "#657b83",
  border: "#d9d2bd",
  field: "#fdf6e3",
  accent: "#268bd2",
};

interface ThemePalette {
  background: string;
  foreground: string;
  caret: string;
  selection: string;
  activeLine: string;
  gutterForeground: string;
  keyword: string;
  string: string;
  comment: string;
  number: string;
  functionName: string;
  typeName: string;
  tagName: string;
  attributeName: string;
  propertyName: string;
  operator: string;
  invalid: string;
}

const NORD: ThemePalette = {
  background: "#2e3440",
  foreground: "#d8dee9",
  caret: "#d8dee9",
  selection: "#434c5e",
  activeLine: "#3b4252",
  gutterForeground: "#4c566a",
  keyword: "#81a1c1",
  string: "#a3be8c",
  comment: "#616e88",
  number: "#b48ead",
  functionName: "#88c0d0",
  typeName: "#8fbcbb",
  tagName: "#81a1c1",
  attributeName: "#8fbcbb",
  propertyName: "#d8dee9",
  operator: "#81a1c1",
  invalid: "#bf616a",
};

const PAPER: ThemePalette = {
  background: "#ffffff",
  foreground: "#1f2328",
  caret: "#1f2328",
  selection: "#b4d8fe",
  activeLine: "#f6f8fa",
  gutterForeground: "#8c959f",
  keyword: "#cf222e",
  string: "#0a3069",
  comment: "#6e7781",
  number: "#0550ae",
  functionName: "#8250df",
  typeName: "#953800",
  tagName: "#116329",
  attributeName: "#0550ae",
  propertyName: "#0550ae",
  operator: "#cf222e",
  invalid: "#82071e",
};

const SOLARIZED_LIGHT: ThemePalette = {
  background: "#fdf6e3",
  foreground: "#657b83",
  caret: "#586e75",
  selection: "#eee8d5",
  activeLine: "#eee8d5",
  gutterForeground: "#93a1a1",
  keyword: "#859900",
  string: "#2aa198",
  comment: "#93a1a1",
  number: "#d33682",
  functionName: "#268bd2",
  typeName: "#b58900",
  tagName: "#268bd2",
  attributeName: "#93a1a1",
  propertyName: "#268bd2",
  operator: "#859900",
  invalid: "#dc322f",
};

function buildTheme(palette: ThemePalette, dark: boolean): Extension {
  const editorTheme = EditorView.theme(
    {
      "&": {
        backgroundColor: palette.background,
        color: palette.foreground,
      },
      ".cm-content": { caretColor: palette.caret },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: palette.caret },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection": {
        backgroundColor: palette.selection,
      },
      ".cm-activeLine": { backgroundColor: palette.activeLine },
      ".cm-gutters": {
        backgroundColor: palette.background,
        color: palette.gutterForeground,
        border: "none",
      },
      ".cm-activeLineGutter": { backgroundColor: palette.activeLine },
    },
    { dark },
  );

  const highlight = HighlightStyle.define([
    { tag: t.keyword, color: palette.keyword },
    { tag: [t.string, t.special(t.string)], color: palette.string },
    { tag: t.comment, color: palette.comment, fontStyle: "italic" },
    { tag: [t.number, t.bool, t.null, t.atom], color: palette.number },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], color: palette.functionName },
    { tag: [t.typeName, t.className, t.namespace], color: palette.typeName },
    { tag: t.tagName, color: palette.tagName },
    { tag: t.attributeName, color: palette.attributeName },
    { tag: t.propertyName, color: palette.propertyName },
    { tag: t.operator, color: palette.operator },
    { tag: t.heading, color: palette.keyword, fontWeight: "bold" },
    { tag: t.link, color: palette.functionName, textDecoration: "underline" },
    { tag: t.invalid, color: palette.invalid },
  ]);

  return [editorTheme, syntaxHighlighting(highlight)];
}

export const THEMES: readonly ThemeDefinition[] = [
  {
    id: THEME_ID.ONE_DARK,
    label: "One Dark",
    dark: true,
    extension: oneDark,
    chrome: ONE_DARK_CHROME,
  },
  {
    id: THEME_ID.NORD,
    label: "Nord",
    dark: true,
    extension: buildTheme(NORD, true),
    chrome: NORD_CHROME,
  },
  {
    id: THEME_ID.PAPER,
    label: "Paper",
    dark: false,
    extension: buildTheme(PAPER, false),
    chrome: PAPER_CHROME,
  },
  {
    id: THEME_ID.SOLARIZED_LIGHT,
    label: "Solarized Light",
    dark: false,
    extension: buildTheme(SOLARIZED_LIGHT, false),
    chrome: SOLARIZED_LIGHT_CHROME,
  },
];

export const DEFAULT_THEME_ID: ThemeId = THEME_ID.ONE_DARK;

export function themeById(id: string): ThemeDefinition {
  const found = THEMES.find((theme) => theme.id === id);
  if (found !== undefined) return found;
  const fallback = THEMES.find((theme) => theme.id === DEFAULT_THEME_ID);
  if (fallback === undefined) {
    throw new Error(`DEFAULT_THEME_ID "${DEFAULT_THEME_ID}" is missing from THEMES`);
  }
  return fallback;
}
