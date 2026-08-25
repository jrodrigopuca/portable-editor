use encoding_rs::{Encoding, WINDOWS_1252};
use serde::Serialize;

/// Above this, `read_file` refuses to load the file at all — checked against
/// file metadata before reading, so an oversized file never reaches memory
/// or the webview. See docs/ROADMAP.md Fase 3.
pub const MAX_FILE_SIZE_BYTES: u64 = 100 * 1024 * 1024;

pub fn size_limit_error(path: &str, size_bytes: u64) -> String {
    let mb = size_bytes as f64 / (1024.0 * 1024.0);
    let limit_mb = MAX_FILE_SIZE_BYTES / (1024 * 1024);
    format!(
        "{path} is {mb:.0} MB, larger than portable-editor's {limit_mb} MB limit. Open it with a different tool."
    )
}

/// Decoded file contents plus the metadata needed to round-trip it: the
/// encoding it was read in (display-only, save always writes UTF-8), the
/// line ending style to restore on save (majority vote — see `detect_eol`),
/// whether that file actually mixed both styles, and whether the raw bytes
/// look like binary data rather than text (see `looks_binary`).
#[derive(Serialize)]
pub struct DecodedFile {
    pub contents: String,
    pub encoding: String,
    pub eol: String,
    pub mixed_eol: bool,
    pub likely_binary: bool,
}

pub fn decode_file(bytes: &[u8]) -> DecodedFile {
    let (text, encoding) = decode_bytes(bytes);
    let (eol, mixed_eol) = detect_eol(&text);
    DecodedFile {
        contents: normalize_to_lf(&text),
        encoding: encoding.to_string(),
        eol: eol.to_string(),
        mixed_eol,
        likely_binary: looks_binary(bytes),
    }
}

/// Majority vote between CRLF- and LF-terminated lines, not "any CRLF
/// present" — that used to mean a single Windows-pasted line in an
/// otherwise-LF file flipped the WHOLE file to CRLF on save, rewriting every
/// other line's ending for a diff that should have touched one line.
/// `mixed_eol` flags when both styles are actually present, regardless of
/// which one wins the vote, so the caller can surface it instead of quietly
/// picking one. A tie (equal counts, including the empty-file 0-0 case)
/// resolves to LF.
fn detect_eol(text: &str) -> (&'static str, bool) {
    let crlf_count = text.matches("\r\n").count();
    let lf_only_count = text.matches('\n').count() - crlf_count;
    let mixed = crlf_count > 0 && lf_only_count > 0;
    let eol = if crlf_count > lf_only_count {
        "CRLF"
    } else {
        "LF"
    };
    (eol, mixed)
}

/// Same heuristic git/grep use to tell text from binary: a NUL byte can't
/// appear in any of the encodings `decode_bytes` handles, so its presence
/// means the Windows-1252 fallback is about to turn non-text data (images,
/// executables, ...) into "readable" garbage that silently corrupts the file
/// on the next save. Checked on the raw bytes, before decoding — decoding
/// itself never fails, so it can't be used to detect this.
fn looks_binary(bytes: &[u8]) -> bool {
    bytes.iter().take(8000).any(|&b| b == 0)
}

/// BOM first (covers UTF-8/UTF-16 explicitly marked files), then strict
/// UTF-8, then Windows-1252 as a last resort: it maps every byte to some
/// codepoint, so decoding never fails outright for legacy Latin-alphabet text.
fn decode_bytes(bytes: &[u8]) -> (String, &'static str) {
    if let Some((enc, bom_len)) = Encoding::for_bom(bytes) {
        let (cow, _had_errors) = enc.decode_without_bom_handling(&bytes[bom_len..]);
        return (cow.into_owned(), encoding_label(enc));
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return (text.to_owned(), "UTF-8");
    }
    let (cow, _had_errors) = WINDOWS_1252.decode_without_bom_handling(bytes);
    (cow.into_owned(), "Windows-1252")
}

fn encoding_label(enc: &'static Encoding) -> &'static str {
    match enc.name() {
        "UTF-16LE" => "UTF-16 LE",
        "UTF-16BE" => "UTF-16 BE",
        _ => "UTF-8",
    }
}

fn normalize_to_lf(text: &str) -> String {
    if text.contains('\r') {
        text.replace("\r\n", "\n").replace('\r', "\n")
    } else {
        text.to_owned()
    }
}

/// Editor content is always `\n`-separated internally; this restores the
/// original line ending convention before writing bytes to disk. Save policy
/// is always UTF-8, regardless of the source encoding.
pub fn encode_with_eol(text: &str, eol: &str) -> Vec<u8> {
    if eol == "CRLF" {
        text.replace('\n', "\r\n").into_bytes()
    } else {
        text.as_bytes().to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_plain_utf8_with_no_bom() {
        let decoded = decode_file("héllo\n".as_bytes());
        assert_eq!(decoded.contents, "héllo\n");
        assert_eq!(decoded.encoding, "UTF-8");
        assert_eq!(decoded.eol, "LF");
    }

    #[test]
    fn strips_utf8_bom() {
        let mut bytes = vec![0xEF, 0xBB, 0xBF];
        bytes.extend_from_slice("hola".as_bytes());
        let decoded = decode_file(&bytes);
        assert_eq!(decoded.contents, "hola");
        assert_eq!(decoded.encoding, "UTF-8");
    }

    #[test]
    fn falls_back_to_windows_1252_for_invalid_utf8() {
        // 0xE9 alone is not valid UTF-8, but is "é" in Windows-1252.
        let bytes = vec![b'c', b'a', b'f', 0xE9];
        let decoded = decode_file(&bytes);
        assert_eq!(decoded.contents, "café");
        assert_eq!(decoded.encoding, "Windows-1252");
    }

    #[test]
    fn detects_and_normalizes_crlf() {
        let decoded = decode_file("line1\r\nline2\r\n".as_bytes());
        assert_eq!(decoded.contents, "line1\nline2\n");
        assert_eq!(decoded.eol, "CRLF");
    }

    #[test]
    fn detects_lf_as_default() {
        let decoded = decode_file("line1\nline2\n".as_bytes());
        assert_eq!(decoded.eol, "LF");
    }

    #[test]
    fn empty_file_defaults_to_lf() {
        let decoded = decode_file(b"");
        assert_eq!(decoded.eol, "LF");
    }

    #[test]
    fn round_trips_crlf_on_encode() {
        let bytes = encode_with_eol("line1\nline2\n", "CRLF");
        assert_eq!(bytes, b"line1\r\nline2\r\n");
    }

    #[test]
    fn keeps_lf_on_encode() {
        let bytes = encode_with_eol("line1\nline2\n", "LF");
        assert_eq!(bytes, b"line1\nline2\n");
    }

    #[test]
    fn mostly_lf_with_one_crlf_line_stays_lf_and_flags_mixed() {
        // Regression: this used to flip to CRLF on the presence of a single
        // CRLF line, rewriting every other line's ending on save.
        let decoded = decode_file("line1\nline2\nline3\r\n".as_bytes());
        assert_eq!(decoded.eol, "LF");
        assert!(decoded.mixed_eol);
    }

    #[test]
    fn mostly_crlf_with_one_lf_line_stays_crlf_and_flags_mixed() {
        let decoded = decode_file("line1\r\nline2\r\nline3\n".as_bytes());
        assert_eq!(decoded.eol, "CRLF");
        assert!(decoded.mixed_eol);
    }

    #[test]
    fn uniform_eol_is_never_flagged_mixed() {
        assert!(!decode_file("line1\nline2\n".as_bytes()).mixed_eol);
        assert!(!decode_file("line1\r\nline2\r\n".as_bytes()).mixed_eol);
        assert!(!decode_file(b"").mixed_eol);
    }

    #[test]
    fn plain_text_is_not_likely_binary() {
        let decoded = decode_file("hello\nworld\n".as_bytes());
        assert!(!decoded.likely_binary);
    }

    #[test]
    fn nul_byte_marks_content_as_likely_binary() {
        // A truncated PNG signature — not valid UTF-8, decodes via the
        // Windows-1252 fallback without error, but the NUL byte gives it away.
        let bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00];
        let decoded = decode_file(&bytes);
        assert!(decoded.likely_binary);
    }

    #[test]
    fn size_limit_error_mentions_path_and_both_sizes() {
        let msg = size_limit_error("/tmp/huge.log", 150 * 1024 * 1024);
        assert!(msg.contains("/tmp/huge.log"));
        assert!(msg.contains("150 MB"));
        assert!(msg.contains("100 MB"));
    }
}
