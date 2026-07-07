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

export interface ThemeDefinition {
  id: ThemeId;
  label: string;
  dark: boolean;
  extension: Extension;
}

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
  { id: THEME_ID.ONE_DARK, label: "One Dark", dark: true, extension: oneDark },
  { id: THEME_ID.NORD, label: "Nord", dark: true, extension: buildTheme(NORD, true) },
  { id: THEME_ID.PAPER, label: "Paper", dark: false, extension: buildTheme(PAPER, false) },
  {
    id: THEME_ID.SOLARIZED_LIGHT,
    label: "Solarized Light",
    dark: false,
    extension: buildTheme(SOLARIZED_LIGHT, false),
  },
];

export const DEFAULT_THEME_ID: ThemeId = THEME_ID.ONE_DARK;

export function themeById(id: string): ThemeDefinition {
  return THEMES.find((theme) => theme.id === id) ?? THEMES[0];
}
