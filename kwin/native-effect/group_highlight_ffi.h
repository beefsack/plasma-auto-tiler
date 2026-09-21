#pragma once
// Group-highlight policy FFI: minimal POD C ABI into the std-only
// group_highlight.rs staticlib. No Qt/KWin types cross this boundary; the
// C++ effect passes UTF-8 byte ranges plus POD observer flags and receives
// integer codes plus POD rects. Field order mirrors the Rust
// GroupHighlightState layout exactly (both sides use C layout).
#include <cstddef>
#include <cstdint>
struct GroupHighlightRect {
    int32_t x = 0;
    int32_t y = 0;
    int32_t w = 0;
    int32_t h = 0;
};
struct GroupHighlightState {
    uint8_t has_group = 0;
    uint8_t order_initialized = 0;
    uint64_t last_revision = 0;
    size_t owner_len = 0;
    uint8_t owner[128] = {};
    size_t generation_len = 0;
    uint8_t generation[64] = {};
    size_t correlation_len = 0;
    uint8_t correlation[128] = {};
    GroupHighlightRect rect;
    size_t focused_len = 0;
    uint8_t focused[128] = {};
    uint64_t receipts = 0;
    uint64_t accepted = 0;
    uint64_t parse_rejected = 0;
    uint64_t focus_mismatch = 0;
    uint64_t stale_ignored = 0;
    uint64_t clear_requests = 0;
};
struct GroupHighlightStatus {
    uint64_t receipts = 0;
    uint64_t accepted = 0;
    uint64_t parse_rejected = 0;
    uint64_t focus_mismatch = 0;
    uint64_t stale_ignored = 0;
    uint64_t clear_requests = 0;
    uint8_t has_group = 0;
    uint8_t order_initialized = 0;
};
extern "C" {
// Zero-initializes the state. Returns 0 on success, -1 on null state.
int32_t group_highlight_state_init(GroupHighlightState *state);
// Applies one effect payload (already converted to UTF-8 bytes at the
// scripting boundary) plus the active-window identity bytes
// (empty range when there is no active window). Returns 1 accepted (display
// updated), 2 ignored stale/out-of-order (display preserved), 0 parse-rejected
// (display cleared), 3 focus-mismatched (display cleared), -1 on null state.
int32_t group_highlight_apply(GroupHighlightState *state, const uint8_t *payload, size_t payloadLen,
    const uint8_t *activeIdentity, size_t activeIdentityLen);
// Clears the display while preserving the order within the stream. Returns
// 1 when a group was displayed, 0 when already clear, -1 on null state.
int32_t group_highlight_clear(GroupHighlightState *state);
// Pure focus-identity match: both sides non-empty and byte-equal.
uint8_t group_highlight_focus_matches(
    const uint8_t *focused, size_t focusedLen, const uint8_t *active, size_t activeLen);
// Pure focus eligibility from POD observer flags. The trailing maximized
// flag collapses any native H/V/full maximize (matching
// activeBorderIsMaximized); fullscreen stays suppressed independently.
uint8_t group_highlight_focus_eligible(uint8_t hasWindow, uint8_t deleted, uint8_t minimized, uint8_t fullscreen,
    uint8_t hidden, uint8_t maximized);
// Visibility gate reading the display flag from state plus POD observer
// flags. Returns 1 visible, 0 hidden, -1 on null state.
int32_t group_highlight_is_visible(const GroupHighlightState *state, uint8_t metaHeld,
    uint8_t firstSignalSeen, uint8_t focusEligible, uint8_t endpointUsable);
// Copies the displayed rect. Returns 1 with *out written, 0 when clear,
// -1 on null pointers.
int32_t group_highlight_rect(const GroupHighlightState *state, GroupHighlightRect *out);
// Copies redacted receipt classification counters and display/order flags.
// Returns 0 with *out written, -1 on null pointers. Never mutates state.
int32_t group_highlight_status(const GroupHighlightState *state, GroupHighlightStatus *out);
} // extern "C"
