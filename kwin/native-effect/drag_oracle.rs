use std::sync::{LazyLock, Mutex, atomic::{AtomicU64, Ordering}};
#[repr(C)] #[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DragRect { pub x: i32, pub y: i32, pub w: i32, pub h: i32 }
pub const DRAG_ORACLE_MAX_ID_LEN: usize = 128; pub const DRAG_ORACLE_MAX_JSON: usize = 1024;
const COORD_LIMIT: i32 = 16384;
static CORRELATION: AtomicU64 = AtomicU64::new(0);
static LAST_JSON: LazyLock<Mutex<Vec<u8>>> = LazyLock::new(|| Mutex::new(br#"{"v":1,"cancelled":true,"finalRect":{"x":0,"y":0,"w":1,"h":1},"windowIdentity":"","correlation":"drag-0","reason":"no-observation"}"#.to_vec()));
fn bad_dim(r: DragRect) -> bool { r.w <= 0 || r.h <= 0 }
fn bad_range(r: DragRect) -> bool { r.x < -COORD_LIMIT || r.x > COORD_LIMIT || r.y < -COORD_LIMIT || r.y > COORD_LIMIT || r.w > COORD_LIMIT || r.h > COORD_LIMIT }
fn identity_reason(id: &[u8]) -> Option<&'static str> {
    if id.len() > DRAG_ORACLE_MAX_ID_LEN { return Some("identity-too-long"); }
    if id.is_empty() { return Some("empty-identity"); }
    if !id.iter().all(|b| b.is_ascii_alphanumeric() || *b == b'-' || *b == b'_' || *b == b'.') { return Some("identity-invalid"); }
    None
}
pub fn build_verdict(start: DragRect, end: DragRect, id: &[u8]) -> (Vec<u8>, u64) {
    let correlation = CORRELATION.fetch_add(1, Ordering::SeqCst) + 1;
    let (cancelled, reason) = if bad_dim(start) || bad_dim(end) { (true, "geometry-invalid") } else if bad_range(start) || bad_range(end) { (true, "geometry-out-of-range") } else if let Some(why) = identity_reason(id) { (true, why) } else if start == end { (true, "no-change") } else { (false, "ok-moved") };
    let id_out = if identity_reason(id).is_none() { id } else { b"" };
    let out = format!("{{\"v\":1,\"cancelled\":{},\"finalRect\":{{\"x\":{},\"y\":{},\"w\":{},\"h\":{}}},\"windowIdentity\":\"{}\",\"correlation\":\"drag-{}\",\"reason\":\"{}\"}}", cancelled, end.x, end.y, end.w, end.h, String::from_utf8_lossy(id_out), correlation, reason);
    let mut bytes = out.into_bytes();
    debug_assert!(bytes.len() <= DRAG_ORACLE_MAX_JSON);
    bytes.truncate(DRAG_ORACLE_MAX_JSON);
    (bytes, correlation)
}
fn store_last(json: &[u8]) { if let Ok(mut guard) = LAST_JSON.lock() { guard.clear(); guard.extend_from_slice(json); } }
fn record_inner(start: DragRect, end: DragRect, id: &[u8]) -> u64 { let (json, correlation) = build_verdict(start, end, id); store_last(&json); correlation }
#[no_mangle]
pub extern "C" fn drag_oracle_record(start: DragRect, end: DragRect, id_ptr: *const u8, id_len: usize) -> u64 {
    match std::panic::catch_unwind(|| {
        let id: &[u8] = if id_len == 0 || id_ptr.is_null() { &[] } else if id_len > 4096 { return record_inner(start, end, &vec![0u8; DRAG_ORACLE_MAX_ID_LEN + 1]); } else { unsafe { std::slice::from_raw_parts(id_ptr, id_len) } };
        record_inner(start, end, id)
    }) {
        Ok(correlation) => correlation,
        Err(_) => { let _ = std::panic::catch_unwind(|| store_last(br#"{"v":1,"cancelled":true,"finalRect":{"x":0,"y":0,"w":1,"h":1},"windowIdentity":"","correlation":"drag-0","reason":"oracle-panic"}"#)); 0 }
    }
}
#[no_mangle]
pub extern "C" fn drag_oracle_last(out_len: *mut usize) -> *const u8 {
    match std::panic::catch_unwind(|| {
        if out_len.is_null() { return std::ptr::null(); }
        match LAST_JSON.lock() {
            Ok(guard) => { unsafe { *out_len = guard.len(); } guard.as_ptr() }
            Err(_) => std::ptr::null(),
        }
    }) {
        Ok(ptr) => ptr,
        Err(_) => std::ptr::null(),
    }
}
#[no_mangle]
pub extern "C" fn drag_oracle_last_copy(out: *mut u8, capacity: usize) -> usize {
    match std::panic::catch_unwind(|| {
        if out.is_null() || capacity == 0 { return 0; }
        match LAST_JSON.lock() {
            Ok(guard) => { let take = guard.len().min(capacity); unsafe { std::ptr::copy_nonoverlapping(guard.as_ptr(), out, take); } take }
            Err(_) => 0,
        }
    }) {
        Ok(take) => take,
        Err(_) => 0,
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn id(text: &str) -> Vec<u8> {
        text.as_bytes().to_vec()
    }

    fn reason_of(json: &[u8]) -> String {
        let text = std::str::from_utf8(json).expect("verdict is ASCII JSON");
        let marker = "\"reason\":\"";
        let start = text.find(marker).expect("reason field") + marker.len();
        let rest = &text[start..];
        rest[..rest.find('"').expect("reason end")].to_string()
    }

    fn cancelled_of(json: &[u8]) -> bool {
        std::str::from_utf8(json)
            .expect("verdict is ASCII JSON")
            .contains("\"cancelled\":true")
    }

    #[test]
    fn equal_geometry_reports_no_change_cancelled() {
        let r = DragRect { x: 10, y: 20, w: 300, h: 200 };
        let (json, _) = build_verdict(r, r, &id("win-1"));
        assert!(cancelled_of(&json));
        assert_eq!(reason_of(&json), "no-change");
    }

    #[test]
    fn moved_geometry_reports_ok_not_cancelled() {
        let start = DragRect { x: 10, y: 20, w: 300, h: 200 };
        let end = DragRect { x: 60, y: 20, w: 300, h: 200 };
        let (json, _) = build_verdict(start, end, &id("win-1"));
        assert!(!cancelled_of(&json));
        assert_eq!(reason_of(&json), "ok-moved");
    }

    #[test]
    fn empty_identity_has_specific_reason() {
        let start = DragRect { x: 0, y: 0, w: 100, h: 100 };
        let end = DragRect { x: 5, y: 0, w: 100, h: 100 };
        let (json, _) = build_verdict(start, end, &[]);
        assert!(cancelled_of(&json));
        assert_eq!(reason_of(&json), "empty-identity");
    }

    #[test]
    fn bad_charset_identity_has_specific_reason() {
        let start = DragRect { x: 0, y: 0, w: 100, h: 100 };
        let end = DragRect { x: 5, y: 0, w: 100, h: 100 };
        let (json, _) = build_verdict(start, end, b"win\";drop");
        assert!(cancelled_of(&json));
        assert_eq!(reason_of(&json), "identity-invalid");
    }

    #[test]
    fn oversize_identity_has_specific_reason() {
        let start = DragRect { x: 0, y: 0, w: 100, h: 100 };
        let end = DragRect { x: 5, y: 0, w: 100, h: 100 };
        let (json, _) = build_verdict(start, end, &vec![b'a'; 129]);
        assert!(cancelled_of(&json));
        assert_eq!(reason_of(&json), "identity-too-long");
    }

    #[test]
    fn degenerate_geometry_has_specific_reason() {
        let start = DragRect { x: 0, y: 0, w: 0, h: 0 };
        let end = DragRect { x: 0, y: 0, w: 100, h: 100 };
        let (json, _) = build_verdict(start, end, &id("win-1"));
        assert!(cancelled_of(&json));
        assert_eq!(reason_of(&json), "geometry-invalid");
    }

    #[test]
    fn out_of_range_geometry_has_specific_reason() {
        let start = DragRect { x: 0, y: 0, w: 100, h: 100 };
        let end = DragRect { x: 20000, y: 0, w: 100, h: 100 };
        let (json, _) = build_verdict(start, end, &id("win-1"));
        assert!(cancelled_of(&json));
        assert_eq!(reason_of(&json), "geometry-out-of-range");
    }

    #[test]
    fn verdict_carries_required_fields_and_stays_bounded() {
        let start = DragRect { x: 1, y: 2, w: 3, h: 4 };
        let end = DragRect { x: 5, y: 6, w: 7, h: 8 };
        let (json, correlation) = build_verdict(start, end, &id("win-9"));
        let text = std::str::from_utf8(&json).expect("verdict is ASCII JSON");
        assert!(text.contains("\"cancelled\":"));
        assert!(text.contains("\"finalRect\":{\"x\":5,\"y\":6,\"w\":7,\"h\":8}"));
        assert!(text.contains("\"windowIdentity\":\"win-9\""));
        assert!(text.contains(&format!("\"correlation\":\"drag-{correlation}\"")));
        assert!(json.len() <= DRAG_ORACLE_MAX_JSON);
    }

    #[test]
    fn ffi_record_and_last_round_trip_without_unwind() {
        let start = DragRect { x: 0, y: 0, w: 120, h: 90 };
        let end = DragRect { x: 10, y: 0, w: 120, h: 90 };
        let bytes = id("ffi-win_1.2");
        let correlation = drag_oracle_record(start, end, bytes.as_ptr(), bytes.len());
        assert!(correlation > 0);
        let mut len = 0usize;
        let ptr = drag_oracle_last(&mut len as *mut usize);
        assert!(!ptr.is_null() && len > 0 && len <= DRAG_ORACLE_MAX_JSON);
        // SAFETY: `ptr`/`len` borrow the oracle's last verdict for this read.
        let view = unsafe { std::slice::from_raw_parts(ptr, len) };
        assert_eq!(reason_of(view), "ok-moved");
    }

    #[test]
    fn ffi_null_identity_reports_empty_identity_reason() {
        let r = DragRect { x: 0, y: 0, w: 50, h: 50 };
        let moved = DragRect { x: 1, y: 0, w: 50, h: 50 };
        let correlation =
            drag_oracle_record(r, moved, std::ptr::null(), 0);
        assert!(correlation > 0);
        let mut len = 0usize;
        let ptr = drag_oracle_last(&mut len as *mut usize);
        assert!(!ptr.is_null());
        // SAFETY: test-only immediate read of the just-stored verdict.
        let view = unsafe { std::slice::from_raw_parts(ptr, len) };
        assert_eq!(reason_of(view), "empty-identity");
    }

    #[test]
    fn ffi_null_out_len_is_null_without_unwind() {
        assert!(drag_oracle_last(std::ptr::null_mut()).is_null());
    }

    #[test]
    fn ffi_copy_out_matches_borrowed_view_without_unwind() {
        let start = DragRect { x: 0, y: 0, w: 120, h: 90 };
        let end = DragRect { x: 11, y: 0, w: 120, h: 90 };
        let bytes = id("copy-win-1");
        assert!(drag_oracle_record(start, end, bytes.as_ptr(), bytes.len()) > 0);
        let mut len = 0usize;
        let ptr = drag_oracle_last(&mut len as *mut usize);
        assert!(!ptr.is_null() && len > 0);
        // SAFETY: immediate same-thread read of the just-stored verdict.
        let borrowed = unsafe { std::slice::from_raw_parts(ptr, len) }.to_vec();
        let mut buf = vec![0u8; DRAG_ORACLE_MAX_JSON];
        let taken = drag_oracle_last_copy(buf.as_mut_ptr(), buf.len());
        assert_eq!(taken, borrowed.len());
        assert_eq!(&buf[..taken], &borrowed[..]);
        assert_eq!(reason_of(&buf[..taken]), "ok-moved");
        assert_eq!(drag_oracle_last_copy(std::ptr::null_mut(), 64), 0);
        assert_eq!(drag_oracle_last_copy(buf.as_mut_ptr(), 0), 0);
    }
}
