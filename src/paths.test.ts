import { describe, expect, it } from "vitest";
import { basename } from "./paths";

describe("basename", () => {
  it("returns the last segment of an absolute path", () => {
    expect(basename("/home/user/notes.md")).toBe("notes.md");
  });

  it("returns bare filenames untouched", () => {
    expect(basename("Makefile")).toBe("Makefile");
  });

  it("handles dotfiles", () => {
    expect(basename("/home/user/.zshrc")).toBe(".zshrc");
  });
});
