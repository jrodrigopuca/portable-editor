//! Filesystem primitives behind the IPC commands. Pure in the sense that
//! matters here: every function takes a `&Path` and returns `io::Result`,
//! never an `AppHandle` or a UI-facing string — `lib.rs` does the mapping.

use std::io::{self, Write};
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

/// Atomic write: temp file in the same directory + `sync_all` + rename
/// (atomic on POSIX), so neither a crash mid-write NOR a power loss right
/// after the rename leaves the file empty or torn.
///
/// Writes through symlinks instead of replacing them: `rename()` on a
/// symlink path replaces the link itself, which would silently disconnect
/// dotfiles managed with Stow/chezmoi/Nix from their real file.
/// Returns the saved file's mtime (ms): the frontend records it in the same
/// tick as `doc.dirty = false`, so the external-change poll never has a gap
/// in which it could mistake our own save for someone else's edit.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<u64> {
    let target = resolve_symlink_target(path);
    let tmp = tmp_path(&target);
    let original_perms = std::fs::metadata(&target).ok().map(|m| m.permissions());
    // A temp left behind by a crash mid-save would make `create_new` fail.
    let _ = std::fs::remove_file(&tmp);
    write_temp(&tmp, bytes, original_perms.as_ref().map(|p| p.mode()))
        .and_then(|_| {
            // `mode()` at creation is subject to umask (it can only clear
            // bits), so re-apply the exact original permissions afterwards.
            if let Some(perms) = original_perms {
                let _ = std::fs::set_permissions(&tmp, perms);
            }
            std::fs::rename(&tmp, &target)
        })
        .inspect_err(|_| {
            let _ = std::fs::remove_file(&tmp);
        })?;
    mtime_ms(&target)
}

/// Creates the temp file with the target's mode from the very first byte
/// (a 0600 `.env` never sits world-readable in its directory, not even for
/// a millisecond), writes everything and fsyncs it. Without the `sync_all`,
/// ext4/APFS may commit the rename before the temp's data, and a power cut
/// in that window leaves a zero-length "saved" file — rename alone only
/// protects against the process dying, not the kernel.
fn write_temp(tmp: &Path, bytes: &[u8], mode: Option<u32>) -> io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    if let Some(mode) = mode {
        options.mode(mode);
    }
    let mut file = options.open(tmp)?;
    file.write_all(bytes)?;
    file.sync_all()
}

/// If `path` is a symlink, resolves it to the file it ultimately points to.
/// Falls back to `path` itself otherwise: not a symlink, doesn't exist yet
/// (new file), or a broken link (`canonicalize` fails) — in the broken-link
/// case this deliberately replaces the dangling link with a real file rather
/// than erroring out.
pub fn resolve_symlink_target(path: &Path) -> PathBuf {
    match std::fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() => {
            std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
        }
        _ => path.to_path_buf(),
    }
}

/// Temp file name for an atomic write of `target`: hidden, same directory
/// (so the final `rename` stays on one filesystem and is atomic).
pub fn tmp_path(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default();
    target.with_file_name(format!(".{name}.portable-editor.tmp"))
}

/// Mtime in milliseconds since the Unix epoch.
pub fn mtime_ms(path: &Path) -> io::Result<u64> {
    mtime_of(&std::fs::metadata(path)?)
}

/// Mtime (ms) of an already-fetched `Metadata` — for callers that must not
/// stat twice (`read_file`: the size check and the mtime come from one stat).
pub fn mtime_of(meta: &std::fs::Metadata) -> io::Result<u64> {
    let since_epoch = meta
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map_err(io::Error::other)?;
    Ok(since_epoch.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    fn dir_entries(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn writes_content_and_leaves_no_temp_behind() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("notes.txt");
        std::fs::write(&target, b"old").unwrap();

        write_atomic(&target, b"new contents").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"new contents");
        assert_eq!(dir_entries(dir.path()), vec!["notes.txt"]);
    }

    #[test]
    fn creates_a_new_file_when_target_does_not_exist() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("fresh.md");

        write_atomic(&target, b"hello").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"hello");
        assert_eq!(dir_entries(dir.path()), vec!["fresh.md"]);
    }

    #[test]
    fn temp_lives_in_the_same_directory_as_the_target() {
        let target = Path::new("/some/dir/file.txt");
        let tmp = tmp_path(target);
        assert_eq!(tmp.parent(), target.parent());
        assert_eq!(
            tmp.file_name().unwrap().to_str().unwrap(),
            ".file.txt.portable-editor.tmp"
        );
    }

    #[test]
    fn preserves_original_permissions() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join(".env");
        std::fs::write(&target, b"SECRET=1").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o600)).unwrap();

        write_atomic(&target, b"SECRET=2").unwrap();

        let mode = std::fs::metadata(&target).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn writes_through_a_symlink_instead_of_replacing_it() {
        let dir = tempfile::tempdir().unwrap();
        let real = dir.path().join("real.conf");
        let link = dir.path().join("link.conf");
        std::fs::write(&real, b"before").unwrap();
        symlink(&real, &link).unwrap();

        write_atomic(&link, b"after").unwrap();

        let meta = std::fs::symlink_metadata(&link).unwrap();
        assert!(meta.file_type().is_symlink(), "the link must survive");
        assert_eq!(std::fs::read_link(&link).unwrap(), real);
        assert_eq!(std::fs::read(&real).unwrap(), b"after");
        assert_eq!(std::fs::read(&link).unwrap(), b"after");
    }

    #[test]
    fn replaces_a_broken_symlink_with_a_real_file() {
        let dir = tempfile::tempdir().unwrap();
        let link = dir.path().join("dangling.txt");
        symlink(dir.path().join("does-not-exist"), &link).unwrap();

        write_atomic(&link, b"content").unwrap();

        let meta = std::fs::symlink_metadata(&link).unwrap();
        assert!(
            meta.file_type().is_file(),
            "dangling link becomes a real file"
        );
        assert_eq!(std::fs::read(&link).unwrap(), b"content");
    }

    #[test]
    fn returned_mtime_matches_metadata() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("t.txt");

        let returned = write_atomic(&target, b"x").unwrap();

        assert_eq!(returned, mtime_ms(&target).unwrap());
    }

    #[test]
    fn fails_cleanly_when_the_directory_does_not_exist() {
        let dir = tempfile::tempdir().unwrap();
        let missing_dir = dir.path().join("missing");
        let target = missing_dir.join("file.txt");

        let err = write_atomic(&target, b"x").unwrap_err();

        assert_eq!(err.kind(), io::ErrorKind::NotFound);
        assert!(!missing_dir.exists());
        assert!(!tmp_path(&target).exists());
        assert!(dir_entries(dir.path()).is_empty());
    }

    #[test]
    fn removes_the_temp_when_the_rename_fails() {
        // Target is a non-empty directory: the temp gets written fine, then
        // `rename` refuses to replace the directory with a file.
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("i-am-a-dir");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("child"), b"").unwrap();

        assert!(write_atomic(&target, b"x").is_err());

        assert!(target.is_dir());
        assert!(!tmp_path(&target).exists());
        assert_eq!(dir_entries(dir.path()), vec!["i-am-a-dir"]);
    }

    #[test]
    fn removes_a_stale_temp_before_writing() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("doc.txt");
        std::fs::write(tmp_path(&target), b"crash leftover").unwrap();

        write_atomic(&target, b"fresh").unwrap();

        assert_eq!(std::fs::read(&target).unwrap(), b"fresh");
        assert_eq!(dir_entries(dir.path()), vec!["doc.txt"]);
    }

    #[test]
    fn resolve_symlink_target_is_identity_for_regular_paths() {
        let dir = tempfile::tempdir().unwrap();
        let plain = dir.path().join("plain.txt");
        std::fs::write(&plain, b"").unwrap();
        assert_eq!(resolve_symlink_target(&plain), plain);

        let nonexistent = dir.path().join("nope.txt");
        assert_eq!(resolve_symlink_target(&nonexistent), nonexistent);
    }
}
