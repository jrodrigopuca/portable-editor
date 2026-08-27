import { describe, expect, it } from "vitest";
import {
  describeIoError,
  errorMessage,
  IO_ERROR_KIND,
  IO_OPERATION,
  isIoError,
  isUnreachable,
  PLATFORM,
} from "./io-error";

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
    expect(
      describeIoError(
        { kind: IO_ERROR_KIND.NOT_FOUND },
        "/a/b.txt",
        IO_OPERATION.READ,
        PLATFORM.LINUX,
      ),
    ).toBe("/a/b.txt does not exist.");
    expect(
      describeIoError(
        { kind: IO_ERROR_KIND.NOT_FOUND },
        "/a/b.txt",
        IO_OPERATION.SAVE,
        PLATFORM.LINUX,
      ),
    ).toBe("Could not save /a/b.txt: its folder no longer exists.");
  });

  it("permission_denied is the plain truth on Linux", () => {
    const err = { kind: IO_ERROR_KIND.PERMISSION_DENIED } as const;
    expect(describeIoError(err, "/etc/shadow", IO_OPERATION.SAVE, PLATFORM.LINUX)).toBe(
      "Permission denied: /etc/shadow.",
    );
  });

  it("permission_denied points at TCC on macOS (Downloads/Documents/Desktop need a per-app grant)", () => {
    const err = { kind: IO_ERROR_KIND.PERMISSION_DENIED } as const;
    expect(
      describeIoError(err, "/Users/x/Downloads/a.json", IO_OPERATION.SAVE, PLATFORM.MACOS),
    ).toBe(
      "Permission denied: /Users/x/Downloads/a.json. Check System Settings → Privacy & Security → Files and Folders.",
    );
  });

  it("too_large keeps path, size and limit in MB (same info the old Rust string had)", () => {
    const msg = describeIoError(
      { kind: IO_ERROR_KIND.TOO_LARGE, size: 150 * MB, limit: 100 * MB },
      "/tmp/huge.log",
      IO_OPERATION.READ,
      PLATFORM.LINUX,
    );
    expect(msg).toBe(
      "/tmp/huge.log is 150 MB, larger than portable-editor's 100 MB limit. Open it with a different tool.",
    );
  });

  it("other carries the OS message and the operation verb", () => {
    const err = { kind: IO_ERROR_KIND.OTHER, message: "Is a directory (os error 21)" } as const;
    expect(describeIoError(err, "/x", IO_OPERATION.READ, PLATFORM.LINUX)).toBe(
      "Could not read /x: Is a directory (os error 21)",
    );
    expect(describeIoError(err, "/x", IO_OPERATION.SAVE, PLATFORM.LINUX)).toBe(
      "Could not save /x: Is a directory (os error 21)",
    );
  });
});

describe("isUnreachable", () => {
  it("a missing file is unreachable — it will never come back at this path", () => {
    expect(isUnreachable({ kind: IO_ERROR_KIND.NOT_FOUND })).toBe(true);
  });

  it("a permission-denied folder is unreachable too — on macOS, TCC doesn't clear on its own", () => {
    // Regression: restoreSession() retries the last file on EVERY launch;
    // without this, a TCC-denied folder meant a blocking dialog forever.
    expect(isUnreachable({ kind: IO_ERROR_KIND.PERMISSION_DENIED })).toBe(true);
  });

  it("too_large and other stay reachable — they can resolve without the user visiting Settings", () => {
    expect(isUnreachable({ kind: IO_ERROR_KIND.TOO_LARGE, size: 1, limit: 1 })).toBe(false);
    expect(isUnreachable({ kind: IO_ERROR_KIND.OTHER, message: "x" })).toBe(false);
  });

  it("a non-IoError is never unreachable (non-IO commands reject with plain strings)", () => {
    expect(isUnreachable("boom")).toBe(false);
    expect(isUnreachable(new Error("boom"))).toBe(false);
  });
});

describe("errorMessage", () => {
  it("formats IoError and falls back to String() otherwise", () => {
    expect(errorMessage({ kind: "not_found" }, "/p", IO_OPERATION.READ, PLATFORM.LINUX)).toBe(
      "/p does not exist.",
    );
    expect(
      errorMessage(
        "Installation was cancelled or failed.",
        "/p",
        IO_OPERATION.READ,
        PLATFORM.LINUX,
      ),
    ).toBe("Installation was cancelled or failed.");
    expect(errorMessage(new Error("boom"), "/p", IO_OPERATION.SAVE, PLATFORM.LINUX)).toBe(
      "Error: boom",
    );
  });
});
