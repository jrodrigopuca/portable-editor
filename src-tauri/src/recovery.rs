use std::time::{Duration, SystemTime};

/// Filesystem-safe key derived from a document path, used to name its
/// recovery file. Not cryptographic — just needs to be stable and
/// collision-unlikely for the number of files someone realistically has open.
///
/// Hand-rolled FNV-1a, not `std::collections::hash_map::DefaultHasher`: its
/// algorithm is explicitly NOT guaranteed stable across Rust versions (see
/// its docs), so a toolchain bump between releases could silently change
/// every existing key — a crash recovery from before the update would become
/// unreadable after it, with no error to explain why. FNV-1a is just
/// arithmetic, so its output can't change under us.
fn fnv1a_64(bytes: &[u8]) -> u64 {
    const OFFSET_BASIS: u64 = 0xcbf29ce484222325;
    const PRIME: u64 = 0x100000001b3;
    let mut hash = OFFSET_BASIS;
    for &byte in bytes {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(PRIME);
    }
    hash
}

pub fn recovery_key(path: &str) -> String {
    format!("{:016x}.recovery", fnv1a_64(path.as_bytes()))
}

/// Snapshots older than this are swept on startup (`lib.rs::sweep_stale_recovery`).
/// A snapshot whose original was deleted or renamed is never cleared by
/// `clear_recovery` (nobody opens that path again), so without a sweep it
/// lives forever. 30 days is longer than any realistically abandoned
/// session and shorter than "forever".
pub const RECOVERY_MAX_AGE_DAYS: u64 = 30;

/// Whether a snapshot last modified at `modified` is old enough to sweep at
/// `now`. A `modified` in the future (clock skew, restored backup) is never
/// stale: the subtraction saturates to zero instead of panicking.
pub fn is_stale(modified: SystemTime, now: SystemTime) -> bool {
    let max_age = Duration::from_secs(RECOVERY_MAX_AGE_DAYS * 24 * 60 * 60);
    now.duration_since(modified)
        .map(|age| age > max_age)
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_path_produces_same_key() {
        assert_eq!(recovery_key("/a/b.txt"), recovery_key("/a/b.txt"));
    }

    #[test]
    fn different_paths_produce_different_keys() {
        assert_ne!(recovery_key("/a/b.txt"), recovery_key("/a/c.txt"));
    }

    #[test]
    fn key_is_a_safe_filename() {
        let key = recovery_key("/some/path with spaces/andé/ñ.txt");
        assert!(key.chars().all(|c| c.is_ascii_alphanumeric() || c == '.'));
    }

    #[test]
    fn key_matches_a_known_fnv1a_value() {
        // Locks in the exact algorithm. If this ever needs to change, it's a
        // deliberate migration (with a plan for orphaned recovery files),
        // never an accidental hash-function swap — same failure this
        // replaced DefaultHasher to avoid in the first place.
        assert_eq!(recovery_key("/a/b.txt"), "a9e007d12e02d91a.recovery");
    }

    mod is_stale {
        use super::*;

        const DAY: Duration = Duration::from_secs(24 * 60 * 60);

        #[test]
        fn fresh_snapshot_is_not_stale() {
            let now = SystemTime::UNIX_EPOCH + DAY * 100;
            assert!(!is_stale(now - DAY, now));
        }

        #[test]
        fn exactly_max_age_is_not_stale_but_one_second_more_is() {
            let now = SystemTime::UNIX_EPOCH + DAY * 100;
            let limit = DAY * RECOVERY_MAX_AGE_DAYS as u32;
            assert!(!is_stale(now - limit, now));
            assert!(is_stale(now - limit - Duration::from_secs(1), now));
        }

        #[test]
        fn future_mtime_is_never_stale() {
            let now = SystemTime::UNIX_EPOCH + DAY * 100;
            assert!(!is_stale(now + DAY, now));
        }
    }
}
