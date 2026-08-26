//! What to open when the app starts (or when the OS hands us a file while
//! it's running): CLI argument resolution and the macOS "Open with..."
//! stash. Pure logic — the `RunEvent::Opened` handler and the
//! `startup_file` command in `lib.rs` are thin wrappers over this.

use serde::Serialize;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;

/// A path to open on startup or via "Open with...", plus whether it already
/// exists — `false` means "create a new file here" (e.g. `portable-editor
/// notes.md` where notes.md doesn't exist yet, same as vim/nano/code) — and
/// how many OTHER files handed to us at the same time were dropped, since
/// portable-editor only ever opens one (see `merge_opened`).
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub struct StartupTarget {
    pub path: String,
    pub exists: bool,
    pub extra_ignored: usize,
}

/// File received via the OS "Open with..." (macOS Opened event) before the
/// frontend is ready to listen for it. Holds the full `StartupTarget` (not
/// just the path) so `extra_ignored` survives the trip to `startup_file()`.
///
/// `frontend_ready` flips to `true` the first time `startup_file()` runs —
/// from then on the frontend has its `open-file` listener registered and
/// every later `Opened` event must be emitted directly, never stashed in
/// `slot` (nobody would ever poll it again).
pub struct PendingFile {
    pub slot: Mutex<Option<StartupTarget>>,
    pub frontend_ready: AtomicBool,
}

impl PendingFile {
    pub fn new() -> Self {
        Self {
            slot: Mutex::new(None),
            frontend_ready: AtomicBool::new(false),
        }
    }
}

impl Default for PendingFile {
    fn default() -> Self {
        Self::new()
    }
}

/// Resolves a CLI argument to an absolute path relative to `base_dir`,
/// without requiring the file to exist. Plain `canonicalize()` fails (and
/// used to be silently swallowed here) for a file that doesn't exist yet —
/// the normal "create a new file at this path" flow every terminal editor
/// supports — so this falls back to `std::path::absolute` in that case.
pub fn resolve_open_arg(base_dir: &Path, arg: &str) -> Option<StartupTarget> {
    let candidate = base_dir.join(arg);
    if let Ok(canon) = candidate.canonicalize() {
        return Some(StartupTarget {
            path: canon.to_string_lossy().into_owned(),
            exists: true,
            extra_ignored: 0,
        });
    }
    let absolute = std::path::absolute(&candidate).ok()?;
    Some(StartupTarget {
        path: absolute.to_string_lossy().into_owned(),
        exists: false,
        extra_ignored: 0,
    })
}

/// Decides what to do with one `RunEvent::Opened` whose first file is
/// `first` and which carried `extra_this_event` more files (dropped by
/// design: portable-editor opens one file at a time, and `extra_ignored` is
/// how the frontend tells the user instead of silently acting on the first).
///
/// Returns `Some(target)` = emit `open-file` with it now; `None` = it was
/// stashed into (or merged into) `pending`, don't emit. The decision hinges
/// on `frontend_ready`, NOT on whether the slot is empty (docs/ARCHITECTURE.md
/// trampa #32):
///
/// - ready: the frontend polled `startup_file()` long ago and will never
///   poll again, so stashing would swallow the file (a real regression).
///   Always emit, never touch the slot.
/// - not ready, slot empty (cold start before the single poll): stash. No
///   emit — the listener isn't registered yet, and emitting AND stashing
///   opened the same file twice when the event landed between `listen()`
///   and the poll.
/// - not ready, slot occupied (a second event before the poll, e.g. two
///   near-simultaneous double-clicks in Finder): keep the first target
///   (first-come-first-served, same tiebreak as within one event) and fold
///   this whole event's files into its `extra_ignored` so the count the user
///   eventually sees isn't silently short.
// Only the macOS `Opened` handler calls this; on Linux it's dead code outside
// `cfg(test)`, and CI runs clippy with `-D warnings` there.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn merge_opened(
    pending: &mut Option<StartupTarget>,
    frontend_ready: bool,
    first: String,
    extra_this_event: usize,
) -> Option<StartupTarget> {
    let target = StartupTarget {
        path: first,
        exists: true,
        extra_ignored: extra_this_event,
    };
    if frontend_ready {
        return Some(target);
    }
    match pending.as_mut() {
        Some(existing) => existing.extra_ignored += 1 + extra_this_event,
        None => *pending = Some(target),
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    mod resolve_open_arg {
        use super::*;

        #[test]
        fn existing_relative_path_is_canonical_and_exists() {
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(dir.path().join("a.txt"), b"").unwrap();

            let target = resolve_open_arg(dir.path(), "a.txt").unwrap();

            assert!(target.exists);
            assert_eq!(target.extra_ignored, 0);
            let expected = dir.path().join("a.txt").canonicalize().unwrap();
            assert_eq!(Path::new(&target.path), expected);
        }

        #[test]
        fn existing_absolute_path_ignores_base_dir() {
            let dir = tempfile::tempdir().unwrap();
            let other = tempfile::tempdir().unwrap();
            let file = other.path().join("b.txt");
            std::fs::write(&file, b"").unwrap();

            let target = resolve_open_arg(dir.path(), file.to_str().unwrap()).unwrap();

            assert!(target.exists);
            assert_eq!(Path::new(&target.path), file.canonicalize().unwrap());
        }

        #[test]
        fn relative_path_with_dot_segments_is_normalized_when_it_exists() {
            let dir = tempfile::tempdir().unwrap();
            std::fs::create_dir(dir.path().join("sub")).unwrap();
            std::fs::write(dir.path().join("c.txt"), b"").unwrap();

            let target = resolve_open_arg(dir.path(), "sub/../c.txt").unwrap();

            assert!(target.exists);
            assert_eq!(
                Path::new(&target.path),
                dir.path().join("c.txt").canonicalize().unwrap()
            );
        }

        #[test]
        fn nonexistent_relative_path_is_absolute_under_base_dir() {
            let dir = tempfile::tempdir().unwrap();

            let target = resolve_open_arg(dir.path(), "new-notes.md").unwrap();

            assert!(!target.exists);
            assert_eq!(target.extra_ignored, 0);
            assert_eq!(Path::new(&target.path), dir.path().join("new-notes.md"));
            assert!(Path::new(&target.path).is_absolute());
        }

        #[test]
        fn nonexistent_absolute_path_is_kept_as_is() {
            let dir = tempfile::tempdir().unwrap();
            let wanted = dir.path().join("nope").join("x.txt");

            let target =
                resolve_open_arg(Path::new("/unrelated"), wanted.to_str().unwrap()).unwrap();

            assert!(!target.exists);
            assert_eq!(Path::new(&target.path), wanted);
        }

        #[test]
        fn leading_dash_is_a_filename_not_a_flag() {
            // Trampa #29: no argument parser, so `-notes.txt` is a real file.
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(dir.path().join("-notes.txt"), b"").unwrap();

            let target = resolve_open_arg(dir.path(), "-notes.txt").unwrap();

            assert!(target.exists);
            assert!(target.path.ends_with("-notes.txt"));
        }
    }

    mod merge_opened {
        use super::*;

        fn target(path: &str, extra_ignored: usize) -> StartupTarget {
            StartupTarget {
                path: path.to_string(),
                exists: true,
                extra_ignored,
            }
        }

        #[test]
        fn running_app_always_emits_and_never_touches_the_slot() {
            let mut pending = None;

            let emitted = merge_opened(&mut pending, true, "/a.txt".into(), 0);

            assert_eq!(emitted, Some(target("/a.txt", 0)));
            assert_eq!(pending, None);
        }

        #[test]
        fn running_app_emits_even_if_the_slot_is_occupied() {
            // Trampa #32: deciding by "is the slot empty?" swallowed the
            // second Open With while the app was running.
            let mut pending = Some(target("/stale.txt", 0));

            let emitted = merge_opened(&mut pending, true, "/b.txt".into(), 0);

            assert_eq!(emitted, Some(target("/b.txt", 0)));
            assert_eq!(pending, Some(target("/stale.txt", 0)));
        }

        #[test]
        fn cold_start_stashes_without_emitting() {
            let mut pending = None;

            let emitted = merge_opened(&mut pending, false, "/a.txt".into(), 0);

            assert_eq!(emitted, None);
            assert_eq!(pending, Some(target("/a.txt", 0)));
        }

        #[test]
        fn cold_start_second_event_keeps_the_first_and_counts_the_new_one() {
            let mut pending = Some(target("/first.txt", 0));

            let emitted = merge_opened(&mut pending, false, "/second.txt".into(), 0);

            assert_eq!(emitted, None);
            assert_eq!(pending, Some(target("/first.txt", 1)));
        }

        #[test]
        fn multi_select_count_is_carried_when_emitting() {
            let mut pending = None;

            let emitted = merge_opened(&mut pending, true, "/a.txt".into(), 3);

            assert_eq!(emitted, Some(target("/a.txt", 3)));
        }

        #[test]
        fn multi_select_count_is_carried_when_stashing() {
            let mut pending = None;

            merge_opened(&mut pending, false, "/a.txt".into(), 2);

            assert_eq!(pending, Some(target("/a.txt", 2)));
        }

        #[test]
        fn multi_select_counts_fold_across_cold_start_events() {
            // Event 1: 3 files (1 kept + 2 dropped). Event 2: 4 files, all
            // dropped. Event 3: 1 file, dropped. Total dropped = 2 + 4 + 1.
            let mut pending = None;

            merge_opened(&mut pending, false, "/a.txt".into(), 2);
            merge_opened(&mut pending, false, "/b.txt".into(), 3);
            merge_opened(&mut pending, false, "/c.txt".into(), 0);

            assert_eq!(pending, Some(target("/a.txt", 7)));
        }
    }
}
