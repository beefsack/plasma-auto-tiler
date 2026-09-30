#pragma once
// Visual-policy FFI: minimal POD C ABI into the std-only visual.rs staticlib.
#include <cstdint>
struct VisualPolicyRect {
    double x = 0.0;
    double y = 0.0;
    double w = 0.0;
    double h = 0.0;
};
struct VisualPolicyBorderState {
    uint8_t visible = 0;
    VisualPolicyRect inner;
};
static_assert(sizeof(VisualPolicyRect) == 32, "VisualPolicyRect layout drift vs Rust visual.rs");
static_assert(sizeof(VisualPolicyBorderState) == 40, "VisualPolicyBorderState layout drift vs Rust visual.rs");
extern "C" {
uint8_t visual_border_use_theme(uint8_t use_theme, uint8_t theme_valid, int32_t quantized_alpha);
uint8_t visual_border_is_maximized(uint8_t horizontal, uint8_t vertical);
VisualPolicyBorderState visual_border_state(uint8_t has_window, VisualPolicyRect frame, uint8_t deleted, uint8_t minimized,
    uint8_t fullscreen, uint8_t maximized, uint8_t excluded);
VisualPolicyRect visual_border_inner_rect(VisualPolicyRect frame, double gap);
uint8_t visual_drag_preview_rect_valid(int32_t x, int32_t y, int32_t w, int32_t h);
double visual_group_underlay_effective_extension(double extension, double border_width);
VisualPolicyRect visual_group_underlay_outer_rect(
    VisualPolicyRect union_rect, double gap, double border_width, double resolved_extension);
} // extern "C"
