use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};

/// Filesystem-safe key derived from a document path, used to name its
/// recovery file. Not cryptographic — just needs to be stable and
/// collision-unlikely for the number of files someone realistically has open.
pub fn recovery_key(path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    path.hash(&mut hasher);
    format!("{:016x}.recovery", hasher.finish())
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
}
