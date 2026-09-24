#pragma once
#include <cstddef>
#include <cstdint>
struct DragOracleRect {
    int32_t x = 0;
    int32_t y = 0;
    int32_t w = 0;
    int32_t h = 0;
};
// Optional bounded press evidence carried atomically with the final verdict
// (see drag_oracle.rs DragPress, whose C layout this mirrors exactly).
// hasPress is 1 only for a verified resize-binding press matched to the same
// effect window and identity within the bounded monotonic age; binding is 1
// for the live configured MouseUnrestrictedResize binding, 0 for the
// Alt+Right fallback used only while the public options are unavailable.
// x/y carry the full native press position so script thirds comparisons keep
// native precision. Field order and padding match Rust repr(C) exactly.
struct DragOraclePress {
    uint8_t hasPress = 0;
    uint8_t binding = 0;
    double x = 0.0;
    double y = 0.0;
};
static_assert(sizeof(DragOraclePress) == 24, "DragOraclePress layout drift vs Rust DragPress");
static_assert(offsetof(DragOraclePress, x) == 8, "DragOraclePress layout drift vs Rust DragPress");
static_assert(offsetof(DragOraclePress, y) == 16, "DragOraclePress layout drift vs Rust DragPress");
extern "C" {
uint64_t drag_oracle_record(DragOracleRect start, DragOracleRect finish, const uint8_t *identity, size_t identityLen,
    DragOraclePress press);
const uint8_t *drag_oracle_last(size_t *outLen);
size_t drag_oracle_last_copy(uint8_t *out, size_t capacity);
} // extern "C"
