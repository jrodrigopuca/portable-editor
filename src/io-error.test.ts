import { describe, expect, it } from "vitest";
import { describeIoError, errorMessage, IO_ERROR_KIND, IO_OPERATION, isIoError } from "./io-error";

const MB = 1024 * 1024;

describe("isIoError", () => {
  it("accepts every variant in its wire shape", () => {
    expect(isIoError({ kind: "not_found" })).toBe(true);
    expect(isIoError({ kind: "permission_denied" })).toBe(true);
    expect(isIoError({ kind: "too_large", size: 1, limit: 2 })).toBe(true);
    expect(isIoError({ kind: "other", message: "x" })).toBe(true);
  });

  it("rejects strings, null, unknown kinds and malformed variants", () => {
    expect(isIoError("Could not read")).toBe(false);
    expect(isIoError(null)).toBe(false);
    expect(isIoError({ kind: "nope" })).toBe(false);
    expect(isIoError({ kind: "too_large", size: "1" })).toBe(false);
    expect(isIoError({ kind: "other" })).toBe(false);
  });
});

describe("describeIoError", () => {
  it("not_found names the path on read, and blames the folder on save", () => {
    expect(describeIoError({ kind: IO_ERROR_KIND.NOT_FOUND }, "/a/b.txt", IO_OPERATION.READ)).toBe(
      "/a/b.txt does not exist.",
    );
    expect(describeIoError({ kind: IO_ERROR_KIND.NOT_FOUND }, "/a/b.txt", IO_OPERATION.SAVE)).toBe(
      "Could not save /a/b.txt: its folder no longer exists.",
    );
  });

  it("permission_denied names the path", () => {
    expect(
      describeIoError({ kind: IO_ERROR_KIND.PERMISSION_DENIED }, "/etc/shadow", IO_OPERATION.SAVE),
    ).toBe(
      "Permission denied: /etc/shadow. On macOS, check System Settings → Privacy & Security → Files and Folders.",
    );
  });

  it("too_large keeps path, size and limit in MB (same info the old Rust string had)", () => {
    const msg = describeIoError(
      { kind: IO_ERROR_KIND.TOO_LARGE, size: 150 * MB, limit: 100 * MB },
      "/tmp/huge.log",
      IO_OPERATION.READ,
    );
    expect(msg).toBe(
      "/tmp/huge.log is 150 MB, larger than portable-editor's 100 MB limit. Open it with a different tool.",
    );
  });

  it("other carries the OS message and the operation verb", () => {
    const err = { kind: IO_ERROR_KIND.OTHER, message: "Is a directory (os error 21)" } as const;
    expect(describeIoError(err, "/x", IO_OPERATION.READ)).toBe(
      "Could not read /x: Is a directory (os error 21)",
    );
    expect(describeIoError(err, "/x", IO_OPERATION.SAVE)).toBe(
      "Could not save /x: Is a directory (os error 21)",
    );
  });
});

describe("errorMessage", () => {
  it("formats IoError and falls back to String() otherwise", () => {
    expect(errorMessage({ kind: "not_found" }, "/p", IO_OPERATION.READ)).toBe("/p does not exist.");
    expect(errorMessage("Installation was cancelled or failed.", "/p", IO_OPERATION.READ)).toBe(
      "Installation was cancelled or failed.",
    );
    expect(errorMessage(new Error("boom"), "/p", IO_OPERATION.SAVE)).toBe("Error: boom");
  });
});
