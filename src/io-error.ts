// The frontend half of the IPC error contract. `src-tauri/src/io_error.rs`
// serializes `IoError` as a tagged object (`{ kind, ...fields }`); this
// module is the ONLY place that knows its shape and turns it into the
// sentence the user reads. No Tauri import on purpose: pure, unit-tested.

export const IO_ERROR_KIND = {
  NOT_FOUND: "not_found",
  PERMISSION_DENIED: "permission_denied",
  TOO_LARGE: "too_large",
  OTHER: "other",
} as const;
export type IoErrorKind = (typeof IO_ERROR_KIND)[keyof typeof IO_ERROR_KIND];

export interface IoErrorNotFound {
  kind: typeof IO_ERROR_KIND.NOT_FOUND;
}

export interface IoErrorPermissionDenied {
  kind: typeof IO_ERROR_KIND.PERMISSION_DENIED;
}

/** Both values in bytes — see `MAX_FILE_SIZE_BYTES` in `text_io.rs`. */
export interface IoErrorTooLarge {
  kind: typeof IO_ERROR_KIND.TOO_LARGE;
  size: number;
  limit: number;
}

/** Any other OS error, with its own text (e.g. "Is a directory (os error 21)"). */
export interface IoErrorOther {
  kind: typeof IO_ERROR_KIND.OTHER;
  message: string;
}

export type IoError = IoErrorNotFound | IoErrorPermissionDenied | IoErrorTooLarge | IoErrorOther;

/**
 * What the caller was doing when the command failed. The enum deliberately
 * doesn't carry it (Rust doesn't know the user's intent), but the generic
 * message reads much better as "Could not save" than "Could not access".
 */
export const IO_OPERATION = {
  READ: "read",
  SAVE: "save",
} as const;
export type IoOperation = (typeof IO_OPERATION)[keyof typeof IO_OPERATION];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Structural check of what `invoke` rejected with: only a well-formed variant passes. */
export function isIoError(value: unknown): value is IoError {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case IO_ERROR_KIND.NOT_FOUND:
    case IO_ERROR_KIND.PERMISSION_DENIED:
      return true;
    case IO_ERROR_KIND.TOO_LARGE:
      return typeof value.size === "number" && typeof value.limit === "number";
    case IO_ERROR_KIND.OTHER:
      return typeof value.message === "string";
    default:
      return false;
  }
}

const BYTES_PER_MB = 1024 * 1024;

function formatMb(bytes: number): string {
  return `${Math.round(bytes / BYTES_PER_MB)} MB`;
}

/** The user-facing sentence for an IO failure on `path` during `operation`. */
export function describeIoError(err: IoError, path: string, operation: IoOperation): string {
  switch (err.kind) {
    case IO_ERROR_KIND.NOT_FOUND:
      return `${path} does not exist.`;
    case IO_ERROR_KIND.PERMISSION_DENIED:
      return `Permission denied: ${path}.`;
    case IO_ERROR_KIND.TOO_LARGE:
      return `${path} is ${formatMb(err.size)}, larger than portable-editor's ${formatMb(err.limit)} limit. Open it with a different tool.`;
    case IO_ERROR_KIND.OTHER:
      return `Could not ${operation} ${path}: ${err.message}`;
  }
}

/**
 * Message for whatever an ipc wrapper rejected with: a typed `IoError` from
 * a file-IO command gets its sentence; anything else (non-IO commands still
 * reject with plain strings, and `String(err)` covers unexpected shapes too).
 */
export function errorMessage(err: unknown, path: string, operation: IoOperation): string {
  return isIoError(err) ? describeIoError(err, path, operation) : String(err);
}
