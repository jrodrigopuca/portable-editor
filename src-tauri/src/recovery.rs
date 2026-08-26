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
}
