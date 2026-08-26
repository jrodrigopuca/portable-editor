//! The one error type every file-IO command returns. Serialized as a tagged
//! JSON object (`{"kind": "...", ...}`) so the frontend can branch on WHAT
//! went wrong instead of substring-matching a sentence — and so the
//! user-facing wording lives with the rest of the UI strings, in TypeScript
//! (`src/io-error.ts`), not here.
//!
//! Commands that aren't file IO (`install_cli_command`, `startup_file`) keep
//! returning plain strings; the frontend falls back to `String(err)` for those.

use serde::Serialize;
use std::io;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum IoError {
    NotFound,
    PermissionDenied,
    /// Rejected before reading a byte — see `read_file`. Both values in
    /// bytes; the frontend does the "N MB" formatting.
    TooLarge {
        size: u64,
        limit: u64,
    },
    /// Anything else, carrying the OS error's own text (e.g. "Is a directory
    /// (os error 21)").
    Other {
        message: String,
    },
}

impl From<io::Error> for IoError {
    fn from(err: io::Error) -> Self {
        match err.kind() {
            io::ErrorKind::NotFound => IoError::NotFound,
            io::ErrorKind::PermissionDenied => IoError::PermissionDenied,
            _ => IoError::Other {
                message: err.to_string(),
            },
        }
    }
}

impl From<tauri::Error> for IoError {
    fn from(err: tauri::Error) -> Self {
        IoError::Other {
            message: err.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_not_found_and_permission_denied_by_kind() {
        let not_found = io::Error::new(io::ErrorKind::NotFound, "gone");
        assert_eq!(IoError::from(not_found), IoError::NotFound);
        let denied = io::Error::new(io::ErrorKind::PermissionDenied, "nope");
        assert_eq!(IoError::from(denied), IoError::PermissionDenied);
    }

    #[test]
    fn everything_else_keeps_the_os_message() {
        let err = io::Error::new(io::ErrorKind::InvalidData, "bad bytes");
        assert_eq!(
            IoError::from(err),
            IoError::Other {
                message: "bad bytes".to_string()
            }
        );
    }

    #[test]
    fn serializes_as_tagged_snake_case_objects() {
        // This IS the wire contract `src/io-error.ts` parses — change both
        // or neither.
        let json = |e: &IoError| serde_json::to_string(e).unwrap();
        assert_eq!(json(&IoError::NotFound), r#"{"kind":"not_found"}"#);
        assert_eq!(
            json(&IoError::PermissionDenied),
            r#"{"kind":"permission_denied"}"#
        );
        assert_eq!(
            json(&IoError::TooLarge {
                size: 150,
                limit: 100
            }),
            r#"{"kind":"too_large","size":150,"limit":100}"#
        );
        assert_eq!(
            json(&IoError::Other {
                message: "x".to_string()
            }),
            r#"{"kind":"other","message":"x"}"#
        );
    }
}
