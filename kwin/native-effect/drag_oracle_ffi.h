#pragma once
#include <cstddef>
#include <cstdint>
struct DragOracleRect {
    int32_t x = 0;
    int32_t y = 0;
    int32_t w = 0;
    int32_t h = 0;
};
extern "C" {
uint64_t drag_oracle_record(DragOracleRect start, DragOracleRect finish, const uint8_t *identity, size_t identityLen);
const uint8_t *drag_oracle_last(size_t *outLen);
size_t drag_oracle_last_copy(uint8_t *out, size_t capacity);
} // extern "C"
