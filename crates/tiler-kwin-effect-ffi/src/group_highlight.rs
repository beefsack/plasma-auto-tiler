// Active-group highlight policy: Cargo workspace staticlib (AR10).
//
// Rust owns group payload parsing/validation, strict schema version checks,
// numeric/id validation, ordering lifecycle, focus matching/visibility
// eligibility, and the pure group effect state. The C++ effect is limited to
// the QObject/D-Bus QString-to-UTF8 boundary, Qt signal POD observation and
// native identity, plus effect lifetime/repaint/render. No Qt/KWin objects
// cross this FFI: only POD structs, byte slices, and integer codes.
//
// Payload contract (mirrors the script bridge `formatGroupHighlightPayload`
// output, which forwards the engine `base_revision` verbatim):
//   {"v":1,"correlation_id":..,"owner":..,"generation":..,"revision":..,
//    "group":..,"focused_window":..,"bounds":{"x":..,"y":..,"w":..,"h":..}}
// - Exactly these 8 root keys (any order), no unknown fields, no duplicates,
//   no trailing data; `bounds` has exactly x/y/w/h.
// - `v` is the integer number 1 written without fraction or exponent.
//   Fractional versions (e.g. 1.5) and string versions reject. This mirrors
//   serde integer decoding for the sibling DescribePlan `v: u32` field.
// - `revision` is an integer 0..=9007199254740991 (JSON-safe integer range,
//   matching the bridge `isRevision` gate and the previous native bound).
//   This is the forwarded engine `base_revision`, NOT the DescribePlan
//   request `revision` (which carries the separate 1_000_000 request bound).
//   Fractional/negative/out-of-range/non-numeric revisions reject.
// - `correlation_id`/`owner`/`group`/`focused_window` are non-empty opaque
//   ids: 1..128 bytes of ASCII alnum plus `-_.` (matches `ids.rs` owner and
//   correlation alphabets and `active_group.rs` opaque ids).
// - `generation` is 1..64 bytes of lowercase/digit/dash (matches
//   `GenerationId::parse`).
// - `bounds` integers use strict integer syntax (no fraction/exponent):
//   x/y in -16384..=16384, w/h in 1..=16384 (matches the bridge
//   `isTargetRect` gate and the planner carried-geometry bound).
// - Payload bytes are 1..=4096 (matches the bridge 4096 cap).
//
// Parsing is `serde_json` into deny-unknown-fields structs plus the same
// range/alphabet gates as before. Behavioral notes versus the retired
// hand-written parser:
// - Duplicate keys reject: serde struct deserialization reports a duplicate
//   field, preserving the previous seen-bit rejection (last-wins is NOT
//   accepted).
// - Trailing non-whitespace data rejects (`serde_json::from_slice` errors),
//   preserving the previous trailing-data rejection; surrounding whitespace
//   stays accepted.
// - Non-UTF8 bytes reject, preserving the previous UTF-8 gate.
// - Leading-zero numbers (e.g. `01`) reject at the JSON grammar level,
//   preserving the previous strict-digits rejection.
// - Float/exponent numbers for integer fields (e.g. `1.0`, `1e0`, `1.5`)
//   reject via integer deserialization, preserving the previous
//   fraction/exponent rejection.
//
// Ordering lifecycle (models the actual script bridge, not lexical order):
// - Order state is scoped by (owner, generation). A payload whose owner or
//   generation differs from the stored stream is a new stream: it accepts
//   and resets the monotonic comparison, so owner/generation rotation never
//   imposes a stale high-water mark forever.
// - Within one stream, revision is monotonic: greater accepts, lesser
//   ignores (display preserved). Same-revision ties break on correlation:
//   exact replays ignore; otherwise the trailing numeric sequence of the
//   bridge `${generation}-g<seq>` correlation compares numerically, so a
//   valid successive same-revision update g9->g10 passes while an older
//   same-revision sequence (e.g. g10 offered after g10 displayed, or g9
//   replayed after g10) cannot erase the newer display. Correlations
//   without a shared numeric tail fall back to byte-lexicographic order.
// - Only accepted payloads advance the order. Parse failures, focus
//   mismatches, and explicit clears fail closed on the display but preserve
//   (never reset, never advance) the order within the stream.

pub const GROUP_HIGHLIGHT_MAX_ID_LEN: usize = 128;
pub const GROUP_HIGHLIGHT_MAX_GENERATION_LEN: usize = 64;
pub const GROUP_HIGHLIGHT_MAX_JSON: usize = 4096;
pub const GROUP_HIGHLIGHT_COORD_MIN: i32 = -16384;
pub const GROUP_HIGHLIGHT_COORD_MAX: i32 = 16384;
pub const GROUP_HIGHLIGHT_SIZE_MAX: i32 = 16384;
pub const GROUP_HIGHLIGHT_MAX_REVISION: u64 = 9007199254740991;

// Single-source gates: the FFI array bounds stay local (C layout), but the
// acceptance alphabets and geometry bounds reuse tiler-core so policy cannot
// drift from the planner.
const _: () = assert!(GROUP_HIGHLIGHT_MAX_ID_LEN == tiler_core::bounds::MAX_OPAQUE_ID_LEN);
const _: () = assert!(GROUP_HIGHLIGHT_MAX_ID_LEN == tiler_core::ids::MAX_OWNER_LEN);
const _: () = assert!(GROUP_HIGHLIGHT_MAX_ID_LEN == tiler_core::ids::MAX_CORRELATION_LEN);
const _: () = assert!(GROUP_HIGHLIGHT_MAX_GENERATION_LEN == tiler_core::ids::MAX_GENERATION_LEN);
const _: () = assert!(GROUP_HIGHLIGHT_COORD_MIN == -tiler_core::bounds::GEOMETRY_BOUND);
const _: () = assert!(GROUP_HIGHLIGHT_COORD_MAX == tiler_core::bounds::GEOMETRY_BOUND);
const _: () = assert!(GROUP_HIGHLIGHT_SIZE_MAX == tiler_core::bounds::GEOMETRY_BOUND);

use serde::Deserialize;

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GroupHighlightRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

// Pure group effect state. POD across FFI; the C++ side holds it by value
// and never inspects the byte arrays directly.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct GroupHighlightState {
    pub has_group: u8,
    pub order_initialized: u8,
    pub last_revision: u64,
    pub owner_len: usize,
    pub owner: [u8; GROUP_HIGHLIGHT_MAX_ID_LEN],
    pub generation_len: usize,
    pub generation: [u8; GROUP_HIGHLIGHT_MAX_GENERATION_LEN],
    pub correlation_len: usize,
    pub correlation: [u8; GROUP_HIGHLIGHT_MAX_ID_LEN],
    pub rect: GroupHighlightRect,
    pub focused_len: usize,
    pub focused: [u8; GROUP_HIGHLIGHT_MAX_ID_LEN],
    pub receipts: u64,
    pub accepted: u64,
    pub parse_rejected: u64,
    pub focus_mismatch: u64,
    pub stale_ignored: u64,
    pub clear_requests: u64,
}

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GroupHighlightStatus {
    pub receipts: u64,
    pub accepted: u64,
    pub parse_rejected: u64,
    pub focus_mismatch: u64,
    pub stale_ignored: u64,
    pub clear_requests: u64,
    pub has_group: u8,
    pub order_initialized: u8,
}

impl GroupHighlightState {
    fn zero() -> Self {
        Self {
            has_group: 0,
            order_initialized: 0,
            last_revision: 0,
            owner_len: 0,
            owner: [0u8; GROUP_HIGHLIGHT_MAX_ID_LEN],
            generation_len: 0,
            generation: [0u8; GROUP_HIGHLIGHT_MAX_GENERATION_LEN],
            correlation_len: 0,
            correlation: [0u8; GROUP_HIGHLIGHT_MAX_ID_LEN],
            rect: GroupHighlightRect {
                x: 0,
                y: 0,
                w: 0,
                h: 0,
            },
            focused_len: 0,
            focused: [0u8; GROUP_HIGHLIGHT_MAX_ID_LEN],
            receipts: 0,
            accepted: 0,
            parse_rejected: 0,
            focus_mismatch: 0,
            stale_ignored: 0,
            clear_requests: 0,
        }
    }

    fn owner_bytes(&self) -> &[u8] {
        &self.owner[..self.owner_len.min(GROUP_HIGHLIGHT_MAX_ID_LEN)]
    }

    fn generation_bytes(&self) -> &[u8] {
        &self.generation[..self.generation_len.min(GROUP_HIGHLIGHT_MAX_GENERATION_LEN)]
    }

    fn correlation_bytes(&self) -> &[u8] {
        &self.correlation[..self.correlation_len.min(GROUP_HIGHLIGHT_MAX_ID_LEN)]
    }

    fn clear_display(&mut self) {
        self.has_group = 0;
        self.rect = GroupHighlightRect {
            x: 0,
            y: 0,
            w: 0,
            h: 0,
        };
        self.focused_len = 0;
    }
}

// Wire shape of the script bridge payload. `deny_unknown_fields` rejects
// unknown keys, missing keys fail as missing fields, and duplicate keys fail
// as duplicate fields, preserving the exact-8-keys contract.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct GroupPayload {
    v: u32,
    correlation_id: String,
    owner: String,
    generation: String,
    revision: u64,
    group: String,
    focused_window: String,
    bounds: GroupBounds,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
struct GroupBounds {
    x: i32,
    y: i32,
    w: i32,
    h: i32,
}

struct Parsed {
    correlation: String,
    owner: String,
    generation: String,
    // Retained for test introspection and contract parity with the retired
    // hand-written parser; the display policy keys on rect/focus/order only.
    #[allow(dead_code)]
    group: String,
    focused: String,
    revision: u64,
    rect: GroupHighlightRect,
}

fn parse_payload(bytes: &[u8]) -> Option<Parsed> {
    if bytes.is_empty() || bytes.len() > GROUP_HIGHLIGHT_MAX_JSON {
        return None;
    }
    let payload: GroupPayload = serde_json::from_slice(bytes).ok()?;
    if payload.v != 1 {
        return None;
    }
    if payload.revision > GROUP_HIGHLIGHT_MAX_REVISION {
        return None;
    }
    if !tiler_core::ids::is_correlation_id(&payload.correlation_id) {
        return None;
    }
    if !tiler_core::ids::is_owner_id(&payload.owner) {
        return None;
    }
    if !tiler_core::ids::is_generation_id(&payload.generation) {
        return None;
    }
    if !tiler_core::bounds::is_opaque_id(&payload.group) {
        return None;
    }
    if !tiler_core::bounds::is_opaque_id(&payload.focused_window) {
        return None;
    }
    // Carried-geometry bound: x/y in -16384..=16384, w/h in 1..=16384.
    if !tiler_core::bounds::valid_carried_rect(
        payload.bounds.x,
        payload.bounds.y,
        payload.bounds.w,
        payload.bounds.h,
    ) {
        return None;
    }
    Some(Parsed {
        correlation: payload.correlation_id,
        owner: payload.owner,
        generation: payload.generation,
        group: payload.group,
        focused: payload.focused_window,
        revision: payload.revision,
        rect: GroupHighlightRect {
            x: payload.bounds.x,
            y: payload.bounds.y,
            w: payload.bounds.w,
            h: payload.bounds.h,
        },
    })
}

// Splits a correlation into its non-numeric head and trailing decimal
// sequence (`gen-1-g10` -> (`gen-1-g`, 10)). Returns None when there is no
// trailing digit run.
fn trailing_seq(value: &[u8]) -> Option<(&[u8], u64)> {
    if value.is_empty() {
        return None;
    }
    let mut end = value.len();
    while end > 0 && value[end - 1].is_ascii_digit() {
        end -= 1;
    }
    if end == value.len() || end == 0 {
        return None;
    }
    let mut seq: u64 = 0;
    for b in &value[end..] {
        seq = seq.checked_mul(10)?.checked_add((b - b'0') as u64)?;
    }
    Some((&value[..end], seq))
}

// Same-revision tie-break modeling the `${generation}-g<seq>` bridge
// correlations: shared numeric tails compare numerically so g10 orders after
// g9. Anything else falls back to byte-lexicographic order. Exact equality
// is handled by the caller (replay ignores).
fn correlation_is_newer(new_corr: &[u8], old_corr: &[u8]) -> bool {
    match (trailing_seq(new_corr), trailing_seq(old_corr)) {
        (Some((new_head, new_seq)), Some((old_head, old_seq))) if new_head == old_head => {
            if new_seq != old_seq {
                return new_seq > old_seq;
            }
            return new_corr > old_corr;
        }
        _ => new_corr > old_corr,
    }
}

fn same_stream(state: &GroupHighlightState, parsed: &Parsed) -> bool {
    state.owner_bytes() == parsed.owner.as_bytes()
        && state.generation_bytes() == parsed.generation.as_bytes()
}

fn store_stream(state: &mut GroupHighlightState, parsed: &Parsed) {
    state.order_initialized = 1;
    state.last_revision = parsed.revision;
    state.owner_len = parsed.owner.len();
    state.owner[..parsed.owner.len()].copy_from_slice(parsed.owner.as_bytes());
    state.generation_len = parsed.generation.len();
    state.generation[..parsed.generation.len()].copy_from_slice(parsed.generation.as_bytes());
    state.correlation_len = parsed.correlation.len();
    state.correlation[..parsed.correlation.len()].copy_from_slice(parsed.correlation.as_bytes());
}

// Returns true when the payload may display: it is newer than the stored
// stream order. Never mutates; the caller stores the new stream position
// only after the payload fully accepts (parse, order, and focus match), so
// a focus-mismatched payload clears the display without advancing the
// high-water mark within the stream.
fn order_allows(state: &GroupHighlightState, parsed: &Parsed) -> bool {
    if state.order_initialized == 0 {
        return true;
    }
    if !same_stream(state, parsed) {
        return true;
    }
    if parsed.revision > state.last_revision {
        return true;
    }
    if parsed.revision < state.last_revision {
        return false;
    }
    if parsed.correlation.as_bytes() == state.correlation_bytes() {
        return false;
    }
    correlation_is_newer(parsed.correlation.as_bytes(), state.correlation_bytes())
}

fn slice_of(ptr: *const u8, len: usize) -> Option<&'static [u8]> {
    if len == 0 {
        return Some(&[]);
    }
    if ptr.is_null() {
        return None;
    }
    if len > GROUP_HIGHLIGHT_MAX_JSON * 4 {
        return None;
    }
    // SAFETY: caller guarantees `ptr`/`len` borrow a live byte range for
    // this call; the bound above keeps the view bounded.
    Some(unsafe { std::slice::from_raw_parts(ptr, len) })
}

fn apply_inner(state: &mut GroupHighlightState, payload: &[u8], active: &[u8]) -> i32 {
    state.receipts = state.receipts.saturating_add(1);
    let parsed = match parse_payload(payload) {
        Some(parsed) => parsed,
        None => {
            state.parse_rejected = state.parse_rejected.saturating_add(1);
            state.clear_display();
            return 0;
        }
    };
    if !order_allows(state, &parsed) {
        state.stale_ignored = state.stale_ignored.saturating_add(1);
        return 2;
    }
    if !focus_matches(parsed.focused.as_bytes(), active) {
        // Focus mismatch clears the display but preserves the order: a
        // payload that never displayed must not advance the high-water mark
        // within the stream.
        state.focus_mismatch = state.focus_mismatch.saturating_add(1);
        state.clear_display();
        return 3;
    }
    state.accepted = state.accepted.saturating_add(1);
    store_stream(state, &parsed);
    state.has_group = 1;
    state.rect = parsed.rect;
    state.focused_len = parsed.focused.len();
    state.focused[..parsed.focused.len()].copy_from_slice(parsed.focused.as_bytes());
    1
}

pub fn focus_matches(focused_window: &[u8], active_window: &[u8]) -> bool {
    if focused_window.is_empty() || active_window.is_empty() {
        return false;
    }
    focused_window == active_window
}

pub fn focus_eligible(
    has_window: bool,
    deleted: bool,
    minimized: bool,
    fullscreen: bool,
    hidden: bool,
    maximized: bool,
) -> bool {
    has_window && !deleted && !minimized && !fullscreen && !hidden && !maximized
}

pub fn should_show(
    has_group: bool,
    meta_held: bool,
    first_signal_seen: bool,
    focus_ok: bool,
    endpoint_usable: bool,
) -> bool {
    has_group && meta_held && first_signal_seen && focus_ok && endpoint_usable
}

// Apply codes: 1 accepted (display updated), 2 ignored stale/out-of-order
// (display preserved), 0 parse-rejected (display cleared), 3 focus-mismatched
// (display cleared), -1 usage error (null state).
#[unsafe(no_mangle)]
pub extern "C" fn group_highlight_state_init(state: *mut GroupHighlightState) -> i32 {
    match std::panic::catch_unwind(|| {
        if state.is_null() {
            return -1;
        }
        // SAFETY: non-null `state` borrows a live caller struct for this call.
        unsafe {
            *state = GroupHighlightState::zero();
        }
        0
    }) {
        Ok(code) => code,
        Err(_) => -1,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn group_highlight_apply(
    state: *mut GroupHighlightState,
    payload_ptr: *const u8,
    payload_len: usize,
    active_ptr: *const u8,
    active_len: usize,
) -> i32 {
    match std::panic::catch_unwind(|| {
        if state.is_null() {
            return -1;
        }
        // SAFETY: non-null `state` borrows a live caller struct for this call.
        let state: &mut GroupHighlightState = unsafe { &mut *state };
        let payload = match slice_of(payload_ptr, payload_len) {
            Some(payload) => payload,
            None => {
                state.receipts = state.receipts.saturating_add(1);
                state.parse_rejected = state.parse_rejected.saturating_add(1);
                state.clear_display();
                return 0;
            }
        };
        let active: &[u8] = if active_len == 0 {
            &[]
        } else {
            match slice_of(active_ptr, active_len) {
                Some(active) => active,
                None => &[],
            }
        };
        apply_inner(state, payload, active)
    }) {
        Ok(code) => code,
        Err(_) => {
            let _ = std::panic::catch_unwind(|| {
                if !state.is_null() {
                    // SAFETY: best-effort fail-closed display clear after a
                    // panic; plain POD writes cannot panic.
                    unsafe {
                        (*state).has_group = 0;
                    }
                }
            });
            0
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn group_highlight_clear(state: *mut GroupHighlightState) -> i32 {
    match std::panic::catch_unwind(|| {
        if state.is_null() {
            return -1;
        }
        // SAFETY: non-null `state` borrows a live caller struct for this call.
        let state: &mut GroupHighlightState = unsafe { &mut *state };
        state.clear_requests = state.clear_requests.saturating_add(1);
        let had = if state.has_group != 0 { 1 } else { 0 };
        state.clear_display();
        had
    }) {
        Ok(code) => code,
        Err(_) => -1,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn group_highlight_focus_matches(
    focused_ptr: *const u8,
    focused_len: usize,
    active_ptr: *const u8,
    active_len: usize,
) -> u8 {
    match std::panic::catch_unwind(|| {
        let focused = match slice_of(focused_ptr, focused_len) {
            Some(focused) => focused,
            None => return 0,
        };
        let active: &[u8] = if active_len == 0 {
            &[]
        } else {
            match slice_of(active_ptr, active_len) {
                Some(active) => active,
                None => return 0,
            }
        };
        u8::from(focus_matches(focused, active))
    }) {
        Ok(value) => value,
        Err(_) => 0,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn group_highlight_focus_eligible(
    has_window: u8,
    deleted: u8,
    minimized: u8,
    fullscreen: u8,
    hidden: u8,
    maximized: u8,
) -> u8 {
    match std::panic::catch_unwind(|| {
        u8::from(focus_eligible(
            has_window != 0,
            deleted != 0,
            minimized != 0,
            fullscreen != 0,
            hidden != 0,
            maximized != 0,
        ))
    }) {
        Ok(value) => value,
        Err(_) => 0,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn group_highlight_is_visible(
    state: *const GroupHighlightState,
    meta_held: u8,
    first_signal_seen: u8,
    focus_ok: u8,
    endpoint_usable: u8,
) -> i32 {
    match std::panic::catch_unwind(|| {
        if state.is_null() {
            return -1;
        }
        // SAFETY: non-null `state` borrows a live caller struct for this call.
        let state: &GroupHighlightState = unsafe { &*state };
        i32::from(u8::from(should_show(
            state.has_group != 0,
            meta_held != 0,
            first_signal_seen != 0,
            focus_ok != 0,
            endpoint_usable != 0,
        )))
    }) {
        Ok(code) => code,
        Err(_) => 0,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn group_highlight_rect(
    state: *const GroupHighlightState,
    out: *mut GroupHighlightRect,
) -> i32 {
    match std::panic::catch_unwind(|| {
        if state.is_null() || out.is_null() {
            return -1;
        }
        // SAFETY: non-null pointers borrow live caller structs for this call.
        let state: &GroupHighlightState = unsafe { &*state };
        if state.has_group == 0 {
            return 0;
        }
        unsafe {
            *out = state.rect;
        }
        1
    }) {
        Ok(code) => code,
        Err(_) => 0,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn group_highlight_status(
    state: *const GroupHighlightState,
    out: *mut GroupHighlightStatus,
) -> i32 {
    match std::panic::catch_unwind(|| {
        if state.is_null() || out.is_null() {
            return -1;
        }
        // SAFETY: non-null pointers borrow live caller structs for this call.
        let state: &GroupHighlightState = unsafe { &*state };
        unsafe {
            *out = GroupHighlightStatus {
                receipts: state.receipts,
                accepted: state.accepted,
                parse_rejected: state.parse_rejected,
                focus_mismatch: state.focus_mismatch,
                stale_ignored: state.stale_ignored,
                clear_requests: state.clear_requests,
                has_group: state.has_group,
                order_initialized: state.order_initialized,
            };
        }
        0
    }) {
        Ok(code) => code,
        Err(_) => -1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn payload(correlation: &str, revision: u64) -> Vec<u8> {
        format!(
            "{{\"v\":1,\"correlation_id\":\"{correlation}\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"revision\":{revision},\"group\":\"group-1\",\"focused_window\":\"win-2\",\"bounds\":{{\"x\":0,\"y\":0,\"w\":1200,\"h\":800}}}}"
        )
        .into_bytes()
    }

    fn parse_ok(bytes: &[u8]) -> bool {
        parse_payload(bytes).is_some()
    }

    fn apply(state: &mut GroupHighlightState, correlation: &str, revision: u64) -> i32 {
        let bytes = payload(correlation, revision);
        let active = b"win-2";
        apply_inner(state, &bytes, active)
    }

    #[test]
    fn valid_payload_parses_with_union_bounds() {
        let bytes = payload("gen-1-g0", 2);
        let parsed = parse_payload(&bytes).expect("valid payload parses");
        assert_eq!(parsed.correlation, "gen-1-g0");
        assert_eq!(parsed.owner, "owner-1");
        assert_eq!(parsed.generation, "gen-1");
        assert_eq!(parsed.group, "group-1");
        assert_eq!(parsed.focused, "win-2");
        assert_eq!(parsed.revision, 2);
        assert_eq!(
            parsed.rect,
            GroupHighlightRect {
                x: 0,
                y: 0,
                w: 1200,
                h: 800
            }
        );
    }

    #[test]
    fn fractional_schema_version_rejected() {
        assert!(!parse_ok(
            br#"{"v":1.5,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":2,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":"1","correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1.0,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        // Exponent form of one is still a float token, not the integer 1.
        assert!(!parse_ok(
            br#"{"v":1e0,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
    }

    #[test]
    fn malformed_payloads_fail_closed() {
        assert!(!parse_ok(b"not-json"));
        assert!(!parse_ok(b""));
        assert!(!parse_ok(br#"{"v":1}"#));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1},"topology":[]}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w"}"#
        ));
        assert!(!parse_ok(
            "{\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":0,\"group\":\"gr☃up\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}"
                .as_bytes()
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"GEN-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":0,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":50000,"y":0,"w":10,"h":10}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":-1,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":1.5,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":9007199254740992,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0.5,"y":0,"w":1,"h":1}}"#
        ));
    }

    #[test]
    fn strict_number_forms_rejected() {
        // Leading zeros are not valid JSON numbers and were rejected by the
        // strict-digits gate before.
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":01,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        // Exponent-form integers decode as float, never as the integer field.
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":1e2,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        // Wrong JSON types for typed fields reject.
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":"0","group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":"0","y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":null,"bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        // Non-object roots and nested unknown keys reject.
        assert!(!parse_ok(br#"[]"#));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1,"z":0}}"#
        ));
        // Non-UTF8 bytes reject.
        assert!(!parse_ok(&[0x7b, 0x22, 0x76, 0x22, 0xff, 0x7d]));
    }

    #[test]
    fn duplicate_keys_rejected() {
        // The hand-written parser rejected duplicates via seen-bits; serde
        // must report duplicate fields instead of last-wins.
        assert!(!parse_ok(
            br#"{"v":1,"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","correlation_id":"b","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"revision":1,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"x":1,"y":0,"w":1,"h":1}}"#
        ));
        assert!(!parse_ok(
            br#"{"v":1,"correlation_id":"a","owner":"b","generation":"gen-1","revision":0,"group":"g","focused_window":"w","bounds":{"x":0,"y":0,"w":1,"w":2,"h":1}}"#
        ));
        // A duplicated payload through the FFI clears the display and counts
        // as parse-rejected, never as an accepted update.
        let mut state = GroupHighlightState::zero();
        assert_eq!(apply(&mut state, "gen-1-g1", 3), 1);
        let dup = br#"{"v":1,"correlation_id":"gen-1-g2","owner":"owner-1","generation":"gen-1","revision":4,"revision":4,"group":"group-1","focused_window":"win-2","bounds":{"x":0,"y":0,"w":1200,"h":800}}"#;
        assert_eq!(apply_inner(&mut state, dup, b"win-2"), 0);
        assert_eq!(state.has_group, 0);
        assert_eq!(state.parse_rejected, 1);
        // Order is preserved: the next valid sequence still passes.
        assert_eq!(apply(&mut state, "gen-1-g2", 4), 1);
    }

    #[test]
    fn oversize_and_trailing_data_rejected() {
        let mut big = payload("gen-1-g0", 0);
        big.extend(vec![b' '; GROUP_HIGHLIGHT_MAX_JSON]);
        assert!(!parse_ok(&big));
        let mut trailing = payload("gen-1-g0", 0);
        trailing.extend(b" ");
        trailing.extend(b"{}");
        assert!(!parse_ok(&trailing));
        // Exactly the 4096-byte cap still parses when the shape is valid.
        let mut padded = payload("gen-1-g0", 0);
        let room = GROUP_HIGHLIGHT_MAX_JSON - padded.len();
        assert!(room > 2);
        padded.pop();
        padded.extend(vec![b' '; room]);
        padded.push(b'}');
        assert_eq!(padded.len(), GROUP_HIGHLIGHT_MAX_JSON);
        assert!(parse_ok(&padded));
        // One byte over the cap rejects even with trailing whitespace only.
        padded.push(b' ');
        assert!(!parse_ok(&padded));
    }

    #[test]
    fn same_revision_successive_updates_pass_lexical_trap() {
        let mut state = GroupHighlightState::zero();
        assert_eq!(apply(&mut state, "gen-1-g9", 3), 1);
        // Lexicographic order would call g10 older than g9; the numeric
        // bridge sequence must still accept it.
        assert_eq!(apply(&mut state, "gen-1-g10", 3), 1);
        assert_eq!(state.last_revision, 3);
        assert_eq!(state.correlation_bytes(), b"gen-1-g10");
    }

    #[test]
    fn superseded_same_revision_cannot_erase_newer_display() {
        let mut state = GroupHighlightState::zero();
        assert_eq!(apply(&mut state, "gen-1-g10", 3), 1);
        let before = state.rect;
        // Older sequence at the same revision is superseded: ignored with
        // the newer display preserved.
        assert_eq!(apply(&mut state, "gen-1-g9", 3), 2);
        assert_eq!(state.has_group, 1);
        assert_eq!(state.rect, before);
        assert_eq!(state.correlation_bytes(), b"gen-1-g10");
        // Exact replay ignores as well.
        assert_eq!(apply(&mut state, "gen-1-g10", 3), 2);
        // Older revision ignores.
        assert_eq!(apply(&mut state, "gen-1-g11", 2), 2);
        assert_eq!(state.last_revision, 3);
    }

    #[test]
    fn owner_and_generation_changes_reset_monotonic_comparison() {
        let mut state = GroupHighlightState::zero();
        assert_eq!(apply(&mut state, "gen-1-g10", 50), 1);
        // New owner with a lower revision is a new stream: must accept
        // rather than applying the stale high-water mark forever.
        let bytes = b"{\"v\":1,\"correlation_id\":\"other-g0\",\"owner\":\"owner-2\",\"generation\":\"gen-1\",\"revision\":1,\"group\":\"group-1\",\"focused_window\":\"win-2\",\"bounds\":{\"x\":1,\"y\":2,\"w\":10,\"h\":10}}";
        assert_eq!(apply_inner(&mut state, bytes, b"win-2"), 1);
        assert_eq!(state.last_revision, 1);
        assert_eq!(state.owner_bytes(), b"owner-2");
        // New generation likewise resets.
        let bytes = b"{\"v\":1,\"correlation_id\":\"gen-2-g0\",\"owner\":\"owner-2\",\"generation\":\"gen-2\",\"revision\":0,\"group\":\"group-1\",\"focused_window\":\"win-2\",\"bounds\":{\"x\":1,\"y\":2,\"w\":10,\"h\":10}}";
        assert_eq!(apply_inner(&mut state, bytes, b"win-2"), 1);
        assert_eq!(state.generation_bytes(), b"gen-2");
    }

    #[test]
    fn clear_preserves_order_within_stream() {
        let mut state = GroupHighlightState::zero();
        assert_eq!(apply(&mut state, "gen-1-g5", 7), 1);
        assert_eq!(
            group_highlight_clear(&mut state as *mut GroupHighlightState),
            1
        );
        assert_eq!(state.has_group, 0);
        assert_eq!(state.order_initialized, 1);
        assert_eq!(state.last_revision, 7);
        // A stale replay after the clear must still ignore, not resurrect.
        assert_eq!(apply(&mut state, "gen-1-g5", 7), 2);
        assert_eq!(state.has_group, 0);
        // Null-equivalent empty payload clears without resetting order.
        assert_eq!(apply_inner(&mut state, b"", b"win-2"), 0);
        assert_eq!(state.order_initialized, 1);
        assert_eq!(state.last_revision, 7);
        // The next valid sequence still passes.
        assert_eq!(apply(&mut state, "gen-1-g6", 7), 1);
    }

    #[test]
    fn focus_mismatch_clears_without_advancing_order() {
        let mut state = GroupHighlightState::zero();
        assert_eq!(apply(&mut state, "gen-1-g1", 3), 1);
        let bytes = payload("gen-1-g2", 3);
        assert_eq!(apply_inner(&mut state, &bytes, b"win-9"), 3);
        assert_eq!(state.has_group, 0);
        assert_eq!(state.correlation_bytes(), b"gen-1-g1");
        assert!(focus_matches(b"win-2", b"win-2"));
        assert!(!focus_matches(b"win-2", b"win-3"));
        assert!(!focus_matches(b"", b"win-2"));
        assert!(!focus_matches(b"win-2", b""));
    }

    #[test]
    fn eligibility_and_visibility_gates() {
        assert!(focus_eligible(true, false, false, false, false, false));
        assert!(!focus_eligible(false, false, false, false, false, false));
        assert!(!focus_eligible(true, true, false, false, false, false));
        assert!(!focus_eligible(true, false, true, false, false, false));
        assert!(!focus_eligible(true, false, false, true, false, false));
        assert!(!focus_eligible(true, false, false, false, true, false));
        assert!(!focus_eligible(true, false, false, false, false, true));
        assert!(!focus_eligible(true, false, false, true, false, true));
        assert!(!should_show(true, true, false, true, true));
        assert!(!should_show(true, false, true, true, true));
        assert!(!should_show(false, true, true, true, true));
        assert!(!should_show(true, true, true, false, true));
        assert!(!should_show(true, true, true, true, false));
        assert!(should_show(true, true, true, true, true));
    }

    #[test]
    fn ffi_null_state_is_usage_error_without_unwind() {
        assert_eq!(group_highlight_state_init(std::ptr::null_mut()), -1);
        let bytes = payload("gen-1-g0", 0);
        assert_eq!(
            group_highlight_apply(
                std::ptr::null_mut(),
                bytes.as_ptr(),
                bytes.len(),
                b"win-2".as_ptr(),
                5
            ),
            -1
        );
        assert_eq!(group_highlight_clear(std::ptr::null_mut()), -1);
        assert_eq!(group_highlight_is_visible(std::ptr::null(), 1, 1, 1, 1), -1);
        assert_eq!(
            group_highlight_rect(std::ptr::null(), std::ptr::null_mut()),
            -1
        );
        assert_eq!(
            group_highlight_status(std::ptr::null(), std::ptr::null_mut()),
            -1
        );
    }

    #[test]
    fn ffi_apply_and_rect_round_trip_without_unwind() {
        let mut state = GroupHighlightState::zero();
        assert_eq!(
            group_highlight_state_init(&mut state as *mut GroupHighlightState),
            0
        );
        let bytes = payload("gen-1-g3", 4);
        let code = group_highlight_apply(
            &mut state as *mut GroupHighlightState,
            bytes.as_ptr(),
            bytes.len(),
            b"win-2".as_ptr(),
            5,
        );
        assert_eq!(code, 1);
        let mut rect = GroupHighlightRect {
            x: 0,
            y: 0,
            w: 0,
            h: 0,
        };
        assert_eq!(
            group_highlight_rect(
                &state as *const GroupHighlightState,
                &mut rect as *mut GroupHighlightRect
            ),
            1
        );
        assert_eq!(
            rect,
            GroupHighlightRect {
                x: 0,
                y: 0,
                w: 1200,
                h: 800
            }
        );
        assert_eq!(
            group_highlight_is_visible(&state as *const GroupHighlightState, 1, 1, 1, 1),
            1
        );
        assert_eq!(
            group_highlight_is_visible(&state as *const GroupHighlightState, 0, 1, 1, 1),
            0
        );
    }

    #[test]
    fn status_classifies_receipts_without_mutating_state() {
        let mut state = GroupHighlightState::zero();
        assert_eq!(apply(&mut state, "gen-1-g0", 1), 1);
        assert_eq!(apply_inner(&mut state, b"bad", b"win-2"), 0);
        let mismatch = payload("gen-1-g1", 2);
        assert_eq!(apply_inner(&mut state, &mismatch, b"win-9"), 3);
        assert_eq!(apply(&mut state, "gen-1-g0", 1), 2);
        assert_eq!(
            group_highlight_clear(&mut state as *mut GroupHighlightState),
            0
        );

        let mut first = GroupHighlightStatus {
            receipts: 0,
            accepted: 0,
            parse_rejected: 0,
            focus_mismatch: 0,
            stale_ignored: 0,
            clear_requests: 0,
            has_group: 0,
            order_initialized: 0,
        };
        assert_eq!(group_highlight_status(&state, &mut first), 0);
        let mut second = first;
        assert_eq!(group_highlight_status(&state, &mut second), 0);
        assert_eq!(first, second);
        assert_eq!(first.receipts, 4);
        assert_eq!(first.accepted, 1);
        assert_eq!(first.parse_rejected, 1);
        assert_eq!(first.focus_mismatch, 1);
        assert_eq!(first.stale_ignored, 1);
        assert_eq!(first.clear_requests, 1);
        assert_eq!(
            first.receipts,
            first.accepted + first.parse_rejected + first.focus_mismatch + first.stale_ignored
        );
        assert_eq!(first.has_group, 0);
        assert_eq!(first.order_initialized, 1);
    }

    #[test]
    fn status_counters_saturate() {
        let mut state = GroupHighlightState::zero();
        state.receipts = u64::MAX;
        state.parse_rejected = u64::MAX;
        state.clear_requests = u64::MAX;
        assert_eq!(apply_inner(&mut state, b"bad", b"win-2"), 0);
        assert_eq!(
            group_highlight_clear(&mut state as *mut GroupHighlightState),
            0
        );
        let mut status = GroupHighlightStatus {
            receipts: 0,
            accepted: 0,
            parse_rejected: 0,
            focus_mismatch: 0,
            stale_ignored: 0,
            clear_requests: 0,
            has_group: 0,
            order_initialized: 0,
        };
        assert_eq!(group_highlight_status(&state, &mut status), 0);
        assert_eq!(status.receipts, u64::MAX);
        assert_eq!(status.parse_rejected, u64::MAX);
        assert_eq!(status.clear_requests, u64::MAX);
    }

    #[test]
    fn pod_state_layout_matches_ffi_header() {
        // Locked with the C++ static_asserts in activebordergroup_test.cpp:
        // the effect holds this state by value across FFI.
        assert_eq!(std::mem::size_of::<GroupHighlightState>(), 560);
        assert_eq!(std::mem::size_of::<GroupHighlightRect>(), 16);
        assert_eq!(std::mem::size_of::<GroupHighlightStatus>(), 56);
    }
}
