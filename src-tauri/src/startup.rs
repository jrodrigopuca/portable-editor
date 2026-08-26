//! What to open when the app starts (or when the OS hands us a file while
//! it's running): CLI argument resolution and the macOS "Open with..."
//! stash. Pure logic — the `RunEvent::Opened` handler and the
//! `startup_file` command in `lib.rs` are thin wrappers over this.

use serde::Serialize;
use std::path::{Path, PathBuf};
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

/// A file handed to us by the OS (macOS `Opened` event) or by a second CLI
/// invocation (single-instance callback) before the frontend is ready to
/// listen for it, plus the readiness flag itself. Holds the full
/// `StartupTarget` (not just the path) so `exists` and `extra_ignored`
/// survive the trip to `startup_file()`.
///
/// `frontend_ready` flips to `true` the first time `startup_file()` runs —
/// from then on the frontend has its `open-file` listener registered and
/// every later target must be emitted directly, never stashed in `slot`
/// (nobody would ever poll it again).
///
/// Both fields live under ONE mutex (`PendingFile`) so "take the slot and
/// flip the flag" is a single critical section: a target arriving while
/// `startup_file()` runs lands on exactly one side of it.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct PendingState {
    pub slot: Option<StartupTarget>,
    pub frontend_ready: bool,
    /// The cold-start argv named a file whose path isn't valid UTF-8. Kept
    /// here (not emitted: nobody is listening yet) for `startup_file()` to
    /// report. See `seed_from_argv`.
    pub startup_error: Option<NonUtf8Path>,
}

/// Tauri-managed state wrapping `PendingState`. See there.
#[derive(Default)]
pub struct PendingFile(pub Mutex<PendingState>);

impl PendingFile {
    /// The state the app starts with: the cold-start argv (if any) already
    /// sitting in the slot. That makes argv one producer among the others
    /// (`merge_opened` from a second CLI call or a macOS `Opened`): whoever
    /// came first wins, the rest are counted in `extra_ignored`. Before
    /// this, argv was read lazily by `startup_file()` only if the slot was
    /// empty — so two CLI invocations during a cold start opened the SECOND
    /// file and silently lost the first.
    pub fn from_argv(state: PendingState) -> Self {
        Self(Mutex::new(state))
    }
}

/// Initial `PendingState` for a cold start. `arg` is argv[1] as raw bytes
/// (`args_os`), resolved against `base_dir`. A non-UTF-8 result becomes
/// `startup_error` rather than a lossy target — see `utf8_path`.
pub fn seed_from_argv(base_dir: &Path, arg: Option<&Path>) -> PendingState {
    let mut state = PendingState::default();
    if let Some(arg) = arg {
        match resolve_open_arg(base_dir, arg) {
            Ok(Some(target)) => state.slot = Some(target),
            Ok(None) => {}
            Err(err) => state.startup_error = Some(err),
        }
    }
    state
}

/// A resolved path whose bytes aren't valid UTF-8, so it can't travel as a
/// JSON string without corruption. Carries the lossy rendering for the
/// error message only.
#[derive(Debug, PartialEq, Eq)]
pub struct NonUtf8Path(pub PathBuf);

impl From<NonUtf8Path> for String {
    fn from(err: NonUtf8Path) -> Self {
        format!(
            "{} isn't valid UTF-8; portable-editor can't open it",
            err.0.to_string_lossy()
        )
    }
}

/// The path as a `String` if its bytes are valid UTF-8, else the typed
/// error. The lossy alternative (`to_string_lossy`) is NOT an option here:
/// U+FFFD in the path means `read_file` looks for a file that doesn't exist
/// and reports "does not exist" for one that does.
pub fn utf8_path(path: PathBuf) -> Result<String, NonUtf8Path> {
    match path.to_str() {
        Some(s) => Ok(s.to_owned()),
        None => Err(NonUtf8Path(path)),
    }
}

/// Resolves a CLI argument to an absolute path relative to `base_dir`,
/// without requiring the file to exist. Plain `canonicalize()` fails (and
/// used to be silently swallowed here) for a file that doesn't exist yet —
/// the normal "create a new file at this path" flow every terminal editor
/// supports — so this falls back to `std::path::absolute` in that case.
///
/// `arg` is a `Path`, not a `&str`: argv on Linux is arbitrary bytes, and
/// `std::env::args()` panics on a non-UTF-8 entry. Callers use `args_os()`
/// and keep the raw bytes all the way here. The RESULT has to travel as JSON,
/// so it's checked with `utf8_path` — after resolving, not before: a valid
/// UTF-8 argument can still canonicalize into a non-UTF-8 path (symlink
/// into a directory with a raw-bytes name).
///
/// `Ok(None)` = nothing resolvable (an empty argument).
pub fn resolve_open_arg(base_dir: &Path, arg: &Path) -> Result<Option<StartupTarget>, NonUtf8Path> {
    let candidate = base_dir.join(arg);
    let (resolved, exists) = match candidate.canonicalize() {
        Ok(canon) => (canon, true),
        Err(_) => match std::path::absolute(&candidate) {
            Ok(absolute) => (absolute, false),
            Err(_) => return Ok(None),
        },
    };
    Ok(Some(StartupTarget {
        path: utf8_path(resolved)?,
        exists,
        extra_ignored: 0,
    }))
}

/// Decides what to do with one incoming `target` — from a macOS `Opened`
/// event (`extra_ignored` = the other files of a multi-selection, dropped
/// by design: portable-editor opens one file at a time, and the count is how
/// the frontend tells the user) or from a second CLI invocation via
/// single-instance (`exists` may be `false`).
///
/// Returns `Some(target)` = emit `open-file` with it now; `None` = it was
/// stashed into (or merged into) `state.slot`, don't emit. The decision
/// hinges on `state.frontend_ready`, NOT on whether the slot is empty
/// (docs/ARCHITECTURE.md trampa #32):
///
/// - ready: the frontend polled `startup_file()` long ago and will never
///   poll again, so stashing would swallow the file (a real regression).
///   Always emit, never touch the slot.
/// - not ready, slot empty (cold start before the single poll): stash. No
///   emit — the listener isn't registered yet, and emitting AND stashing
///   opened the same file twice when the event landed between `listen()`
///   and the poll.
/// - not ready, slot occupied (a second target before the poll, e.g. two
///   near-simultaneous double-clicks in Finder, or two quick CLI calls):
///   keep the first target (first-come-first-served, same tiebreak as within
///   one event) and fold this whole event's files into its `extra_ignored`
///   so the count the user eventually sees isn't silently short.
pub fn merge_opened(state: &mut PendingState, target: StartupTarget) -> Option<StartupTarget> {
    if state.frontend_ready {
        return Some(target);
    }
    match state.slot.as_mut() {
        Some(existing) => existing.extra_ignored += 1 + target.extra_ignored,
        None => state.slot = Some(target),
    }
    None
}

/// The `startup_file()` half of the handshake: takes whatever was stashed
/// and marks the frontend ready, atomically with respect to `merge_opened`
/// (both run under the same lock).
pub fn take_pending(state: &mut PendingState) -> Result<Option<StartupTarget>, NonUtf8Path> {
    state.frontend_ready = true;
    let slot = state.slot.take();
    // A bad argv is reported even if a later, valid target got stashed
    // meanwhile: the user typed that argument and deserves to hear why it
    // didn't open. The stashed one is dropped with it (edge of an edge).
    match state.startup_error.take() {
        Some(err) => Err(err),
        None => Ok(slot),
    }
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

            let target = resolve_open_arg(dir.path(), Path::new("a.txt"))
                .unwrap()
                .unwrap();

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

            let target = resolve_open_arg(dir.path(), &file).unwrap().unwrap();

            assert!(target.exists);
            assert_eq!(Path::new(&target.path), file.canonicalize().unwrap());
        }

        #[test]
        fn relative_path_with_dot_segments_is_normalized_when_it_exists() {
            let dir = tempfile::tempdir().unwrap();
            std::fs::create_dir(dir.path().join("sub")).unwrap();
            std::fs::write(dir.path().join("c.txt"), b"").unwrap();

            let target = resolve_open_arg(dir.path(), Path::new("sub/../c.txt"))
                .unwrap()
                .unwrap();

            assert!(target.exists);
            assert_eq!(
                Path::new(&target.path),
                dir.path().join("c.txt").canonicalize().unwrap()
            );
        }

        #[test]
        fn nonexistent_relative_path_is_absolute_under_base_dir() {
            let dir = tempfile::tempdir().unwrap();

            let target = resolve_open_arg(dir.path(), Path::new("new-notes.md"))
                .unwrap()
                .unwrap();

            assert!(!target.exists);
            assert_eq!(target.extra_ignored, 0);
            assert_eq!(Path::new(&target.path), dir.path().join("new-notes.md"));
            assert!(Path::new(&target.path).is_absolute());
        }

        #[test]
        fn nonexistent_absolute_path_is_kept_as_is() {
            let dir = tempfile::tempdir().unwrap();
            let wanted = dir.path().join("nope").join("x.txt");

            let target = resolve_open_arg(Path::new("/unrelated"), &wanted)
                .unwrap()
                .unwrap();

            assert!(!target.exists);
            assert_eq!(Path::new(&target.path), wanted);
        }

        #[test]
        fn leading_dash_is_a_filename_not_a_flag() {
            // Trampa #29: no argument parser, so `-notes.txt` is a real file.
            let dir = tempfile::tempdir().unwrap();
            std::fs::write(dir.path().join("-notes.txt"), b"").unwrap();

            let target = resolve_open_arg(dir.path(), Path::new("-notes.txt"))
                .unwrap()
                .unwrap();

            assert!(target.exists);
            assert!(target.path.ends_with("-notes.txt"));
        }

        #[test]
        fn non_utf8_filename_is_a_typed_error_not_a_lossy_target() {
            // Linux argv is bytes; `std::env::args()` would panic on this,
            // and a lossy target (U+FFFD in the path) made `read_file` report
            // "does not exist" for a file that exists. Not created on disk:
            // APFS refuses non-UTF-8 names, so the nonexistent branch
            // (`std::path::absolute`, no fs access) runs on both platforms.
            use std::ffi::OsStr;
            use std::os::unix::ffi::OsStrExt;
            let dir = tempfile::tempdir().unwrap();
            let name = OsStr::from_bytes(b"caf\xe9.txt");

            let err = resolve_open_arg(dir.path(), Path::new(name)).unwrap_err();

            assert_eq!(err, NonUtf8Path(dir.path().join(name)));
            let message = String::from(err);
            assert!(message.contains("caf\u{FFFD}.txt"), "{message}");
            assert!(message.ends_with("isn't valid UTF-8; portable-editor can't open it"));
        }
    }

    mod utf8_path {
        use super::*;

        #[test]
        fn valid_utf8_passes_through_unchanged() {
            assert_eq!(
                utf8_path(PathBuf::from("/tmp/ñandú.txt")),
                Ok("/tmp/ñandú.txt".to_string())
            );
        }

        #[test]
        fn invalid_utf8_is_rejected_with_the_original_bytes() {
            use std::ffi::OsStr;
            use std::os::unix::ffi::OsStrExt;
            let raw = PathBuf::from(OsStr::from_bytes(b"/tmp/\xff.txt"));

            assert_eq!(utf8_path(raw.clone()), Err(NonUtf8Path(raw)));
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

        fn state(slot: Option<StartupTarget>, frontend_ready: bool) -> PendingState {
            PendingState {
                slot,
                frontend_ready,
                startup_error: None,
            }
        }

        #[test]
        fn running_app_always_emits_and_never_touches_the_slot() {
            let mut st = state(None, true);

            let emitted = merge_opened(&mut st, target("/a.txt", 0));

            assert_eq!(emitted, Some(target("/a.txt", 0)));
            assert_eq!(st, state(None, true));
        }

        #[test]
        fn running_app_emits_even_if_the_slot_is_occupied() {
            // Trampa #32: deciding by "is the slot empty?" swallowed the
            // second Open With while the app was running.
            let mut st = state(Some(target("/stale.txt", 0)), true);

            let emitted = merge_opened(&mut st, target("/b.txt", 0));

            assert_eq!(emitted, Some(target("/b.txt", 0)));
            assert_eq!(st.slot, Some(target("/stale.txt", 0)));
        }

        #[test]
        fn cold_start_stashes_without_emitting() {
            let mut st = state(None, false);

            let emitted = merge_opened(&mut st, target("/a.txt", 0));

            assert_eq!(emitted, None);
            assert_eq!(st, state(Some(target("/a.txt", 0)), false));
        }

        #[test]
        fn cold_start_second_event_keeps_the_first_and_counts_the_new_one() {
            let mut st = state(Some(target("/first.txt", 0)), false);

            let emitted = merge_opened(&mut st, target("/second.txt", 0));

            assert_eq!(emitted, None);
            assert_eq!(st.slot, Some(target("/first.txt", 1)));
        }

        #[test]
        fn cold_start_keeps_exists_false_from_a_cli_target() {
            // Single-instance path: `portable-editor new.md` during a cold
            // start must survive as "create a new file here", not be
            // rewritten as an existing one.
            let mut st = state(None, false);
            let cli = StartupTarget {
                path: "/new.md".into(),
                exists: false,
                extra_ignored: 0,
            };

            merge_opened(&mut st, cli.clone());

            assert_eq!(st.slot, Some(cli));
        }

        #[test]
        fn multi_select_count_is_carried_when_emitting() {
            let mut st = state(None, true);

            let emitted = merge_opened(&mut st, target("/a.txt", 3));

            assert_eq!(emitted, Some(target("/a.txt", 3)));
        }

        #[test]
        fn multi_select_count_is_carried_when_stashing() {
            let mut st = state(None, false);

            merge_opened(&mut st, target("/a.txt", 2));

            assert_eq!(st.slot, Some(target("/a.txt", 2)));
        }

        #[test]
        fn multi_select_counts_fold_across_cold_start_events() {
            // Event 1: 3 files (1 kept + 2 dropped). Event 2: 4 files, all
            // dropped. Event 3: 1 file, dropped. Total dropped = 2 + 4 + 1.
            let mut st = state(None, false);

            merge_opened(&mut st, target("/a.txt", 2));
            merge_opened(&mut st, target("/b.txt", 3));
            merge_opened(&mut st, target("/c.txt", 0));

            assert_eq!(st.slot, Some(target("/a.txt", 7)));
        }
    }

    mod take_pending {
        use super::*;

        fn target(path: &str) -> StartupTarget {
            StartupTarget {
                path: path.to_string(),
                exists: true,
                extra_ignored: 0,
            }
        }

        #[test]
        fn takes_the_slot_and_flips_ready_together() {
            let mut st = PendingState {
                slot: Some(target("/a.txt")),
                frontend_ready: false,
                startup_error: None,
            };

            let taken = take_pending(&mut st).unwrap();

            assert_eq!(taken, Some(target("/a.txt")));
            assert_eq!(
                st,
                PendingState {
                    slot: None,
                    frontend_ready: true,
                    startup_error: None,
                }
            );
        }

        #[test]
        fn a_target_after_take_is_emitted_not_stashed() {
            // The handshake end to end: whatever arrives after the poll can
            // never be swallowed by the slot.
            let mut st = PendingState::default();
            assert_eq!(take_pending(&mut st).unwrap(), None);

            let emitted = merge_opened(&mut st, target("/late.txt"));

            assert_eq!(emitted, Some(target("/late.txt")));
            assert_eq!(st.slot, None);
        }
    }

    mod seed_from_argv {
        use super::super::*;
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        #[test]
        fn no_argv_is_an_empty_state() {
            let state = seed_from_argv(Path::new("/tmp"), None);
            assert_eq!(state, PendingState::default());
        }

        #[test]
        fn argv_lands_in_the_slot_before_anyone_else() {
            let dir = tempfile::tempdir().unwrap();
            let state = seed_from_argv(dir.path(), Some(Path::new("new.txt")));
            let slot = state.slot.expect("argv target");
            assert!(!slot.exists);
            assert_eq!(slot.extra_ignored, 0);
            assert!(!state.frontend_ready);
        }

        #[test]
        fn a_second_cli_call_during_cold_start_is_counted_not_preferred() {
            // The round-3 regression: argv must be the FIRST target, so a
            // second invocation that lands before the frontend polls gets
            // folded into extra_ignored instead of replacing it.
            let dir = tempfile::tempdir().unwrap();
            let mut state = seed_from_argv(dir.path(), Some(Path::new("a.txt")));
            let b = StartupTarget {
                path: dir.path().join("b.txt").to_string_lossy().into_owned(),
                exists: false,
                extra_ignored: 0,
            };
            assert_eq!(merge_opened(&mut state, b), None);
            let taken = take_pending(&mut state).unwrap().expect("argv target");
            assert!(taken.path.ends_with("a.txt"));
            assert_eq!(taken.extra_ignored, 1);
        }

        #[test]
        fn non_utf8_argv_is_reported_by_take_pending() {
            let dir = tempfile::tempdir().unwrap();
            let bad = OsStr::from_bytes(b"caf\xe9.txt");
            let mut state = seed_from_argv(dir.path(), Some(Path::new(bad)));
            assert!(state.slot.is_none());
            assert!(state.startup_error.is_some());
            assert!(take_pending(&mut state).is_err());
            assert!(state.frontend_ready);
        }
    }
}
