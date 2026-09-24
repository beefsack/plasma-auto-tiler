// Temporary active-group highlight offline tests through the Cargo
// workspace staticlib FFI only. Policy (parsing, ordering, focus,
// visibility, state) lives in crates/tiler-kwin-effect-ffi; this test
// drives its minimal POD C ABI, including the
// QObject/D-Bus QString-to-UTF8 boundary shape (empty payload clears). No
// KWin scene, no session bus, no timers.

#include "group_highlight_ffi.h"

#include <QByteArray>
#include <QCoreApplication>
#include <QString>

#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

// The effect holds Rust policy state by value: lock the shared POD layout
// at compile time so ABI drift fails here, not at runtime.
static_assert(sizeof(GroupHighlightState) == 560, "GroupHighlightState layout drift");
static_assert(sizeof(GroupHighlightStatus) == 56, "GroupHighlightStatus layout drift");
static_assert(offsetof(GroupHighlightState, last_revision) == 8, "GroupHighlightState layout drift");
static_assert(offsetof(GroupHighlightState, owner) == 24, "GroupHighlightState layout drift");
static_assert(offsetof(GroupHighlightState, generation) == 160, "GroupHighlightState layout drift");
static_assert(offsetof(GroupHighlightState, correlation) == 232, "GroupHighlightState layout drift");
static_assert(offsetof(GroupHighlightState, rect) == 360, "GroupHighlightState layout drift");
static_assert(offsetof(GroupHighlightState, focused) == 384, "GroupHighlightState layout drift");

namespace
{

int failures = 0;

void check(bool condition, const char *expression, const char *file, int line)
{
    if (!condition) {
        std::fprintf(stderr, "FAIL: %s (%s:%d)\n", expression, file, line);
        ++failures;
    }
}

#define CHECK(expression) check(expression, #expression, __FILE__, __LINE__)

std::string validPayload(const std::string &correlation, uint64_t revision)
{
    return "{\"v\":1,\"correlation_id\":\"" + correlation
        + "\",\"owner\":\"owner-1\",\"generation\":\"gen-1\",\"revision\":" + std::to_string(revision)
        + ",\"group\":\"group-1\",\"focused_window\":\"win-2\",\"bounds\":{\"x\":0,\"y\":0,\"w\":1200,\"h\":800}}";
}

int32_t applyStr(GroupHighlightState *state, const std::string &payload, const char *active)
{
    const uint8_t *payloadPtr = payload.empty() ? nullptr : reinterpret_cast<const uint8_t *>(payload.data());
    const size_t activeLen = active == nullptr ? 0 : std::strlen(active);
    const uint8_t *activePtr = activeLen == 0 ? nullptr : reinterpret_cast<const uint8_t *>(active);
    return group_highlight_apply(state, payloadPtr, payload.size(), activePtr, activeLen);
}

void validPayloadAppliesWithUnionBounds()
{
    GroupHighlightState state{};
    CHECK(group_highlight_state_init(&state) == 0);
    CHECK(applyStr(&state, validPayload("gen-1-g0", 2), "win-2") == 1);
    GroupHighlightRect rect{};
    CHECK(group_highlight_rect(&state, &rect) == 1);
    CHECK(rect.x == 0 && rect.y == 0 && rect.w == 1200 && rect.h == 800);
    CHECK(group_highlight_is_visible(&state, 1, 1, 1, 1) == 1);
}

void qstringBoundaryEmptyClears()
{
    // QObject/D-Bus boundary shape: an empty QString forwards as an empty
    // UTF-8 range and must fail closed without resetting stream order.
    GroupHighlightState state{};
    CHECK(group_highlight_state_init(&state) == 0);
    CHECK(applyStr(&state, validPayload("gen-1-g5", 7), "win-2") == 1);
    const QString empty;
    const QByteArray emptyBytes = empty.toUtf8();
    CHECK(emptyBytes.isEmpty());
    const int32_t code = group_highlight_apply(&state, nullptr, 0, reinterpret_cast<const uint8_t *>("win-2"), 5);
    CHECK(code == 0);
    CHECK(state.has_group == 0);
    CHECK(state.order_initialized != 0);
    CHECK(state.last_revision == 7);
    CHECK(applyStr(&state, validPayload("gen-1-g5", 7), "win-2") == 2);
    CHECK(applyStr(&state, validPayload("gen-1-g6", 7), "win-2") == 1);
}

void malformedPayloadsFailClosed()
{
    GroupHighlightState state{};
    CHECK(group_highlight_state_init(&state) == 0);
    const char *cases[] = {
        "not-json",
        "{\"v\":2,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":0,\"group\":\"g\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}",
        "{\"v\":1.5,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":0,\"group\":\"g\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}",
        "{\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":0,\"group\":\"g\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1},\"topology\":[]}",
        "{\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":0,\"group\":\"g\",\"focused_window\":\"w\"}",
        "{\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":0,\"group\":\"\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}",
        "{\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"GEN-1\",\"revision\":0,\"group\":\"g\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}",
        "{\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":0,\"group\":\"g\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"y\":0,\"w\":0,\"h\":1}}",
        "{\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":0,\"group\":\"g\",\"focused_window\":\"w\",\"bounds\":{\"x\":50000,\"y\":0,\"w\":10,\"h\":10}}",
        "{\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":-1,\"group\":\"g\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}",
        "{\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":1.5,\"group\":\"g\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}",
        "{\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":9007199254740992,\"group\":\"g\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}",
        "{\"v\":1,\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":0,\"group\":\"g\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}",
        "{\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":0,\"revision\":0,\"group\":\"g\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"y\":0,\"w\":1,\"h\":1}}",
        "{\"v\":1,\"correlation_id\":\"a\",\"owner\":\"b\",\"generation\":\"gen-1\",\"revision\":0,\"group\":\"g\",\"focused_window\":\"w\",\"bounds\":{\"x\":0,\"x\":0,\"y\":0,\"w\":1,\"h\":1}}",
        nullptr,
    };
    for (size_t i = 0; cases[i] != nullptr; ++i) {
        CHECK(applyStr(&state, cases[i], "win-2") == 0);
        CHECK(state.has_group == 0);
    }
    CHECK(applyStr(&state, "", "win-2") == 0);
}

void successiveSameRevisionPassesLexicalTrap()
{
    GroupHighlightState state{};
    CHECK(group_highlight_state_init(&state) == 0);
    CHECK(applyStr(&state, validPayload("gen-1-g9", 3), "win-2") == 1);
    // Byte-lexicographic order would call g10 older than g9; the numeric
    // bridge sequence must still accept it.
    CHECK(applyStr(&state, validPayload("gen-1-g10", 3), "win-2") == 1);
    CHECK(state.last_revision == 3);
}

void staleAndOutOfOrderPreserveNewerDisplay()
{
    GroupHighlightState state{};
    CHECK(group_highlight_state_init(&state) == 0);
    CHECK(applyStr(&state, validPayload("gen-1-g0", 2), "win-2") == 1);
    CHECK(applyStr(&state, validPayload("gen-1-g0", 2), "win-2") == 2);
    CHECK(applyStr(&state, validPayload("gen-1-g1", 1), "win-2") == 2);
    CHECK(applyStr(&state, validPayload("gen-1-g2", 3), "win-2") == 1);
    CHECK(state.last_revision == 3);
    // Superseded same-revision sequence cannot erase the newer display.
    const GroupHighlightRect shown = state.rect;
    CHECK(applyStr(&state, validPayload("gen-1-g1", 3), "win-2") == 2);
    CHECK(state.has_group != 0);
    CHECK(state.rect.x == shown.x && state.rect.y == shown.y && state.rect.w == shown.w && state.rect.h == shown.h);
}

void ownerGenerationChangeResetsMonotonicComparison()
{
    GroupHighlightState state{};
    CHECK(group_highlight_state_init(&state) == 0);
    CHECK(applyStr(&state, validPayload("gen-1-g10", 50), "win-2") == 1);
    const std::string nextOwner = "{\"v\":1,\"correlation_id\":\"other-g0\",\"owner\":\"owner-2\",\"generation\":\"gen-1\",\"revision\":1,"
        "\"group\":\"group-1\",\"focused_window\":\"win-2\",\"bounds\":{\"x\":1,\"y\":2,\"w\":10,\"h\":10}}";
    CHECK(applyStr(&state, nextOwner, "win-2") == 1);
    CHECK(state.last_revision == 1);
    const std::string nextGeneration = "{\"v\":1,\"correlation_id\":\"gen-2-g0\",\"owner\":\"owner-2\",\"generation\":\"gen-2\",\"revision\":0,"
        "\"group\":\"group-1\",\"focused_window\":\"win-2\",\"bounds\":{\"x\":1,\"y\":2,\"w\":10,\"h\":10}}";
    CHECK(applyStr(&state, nextGeneration, "win-2") == 1);
}

void clearPreservesOrderWithinStream()
{
    GroupHighlightState state{};
    CHECK(group_highlight_state_init(&state) == 0);
    CHECK(applyStr(&state, validPayload("gen-1-g5", 7), "win-2") == 1);
    CHECK(group_highlight_clear(&state) == 1);
    CHECK(state.has_group == 0);
    CHECK(state.order_initialized != 0);
    CHECK(state.last_revision == 7);
    CHECK(applyStr(&state, validPayload("gen-1-g5", 7), "win-2") == 2);
    CHECK(state.has_group == 0);
    CHECK(applyStr(&state, validPayload("gen-1-g6", 7), "win-2") == 1);
    CHECK(group_highlight_clear(&state) == 1);
    CHECK(group_highlight_clear(&state) == 0);
}

void focusBindingMatchesLiveActiveOnly()
{
    CHECK(group_highlight_focus_matches(reinterpret_cast<const uint8_t *>("win-2"), 5, reinterpret_cast<const uint8_t *>("win-2"), 5) != 0);
    CHECK(group_highlight_focus_matches(reinterpret_cast<const uint8_t *>("win-2"), 5, reinterpret_cast<const uint8_t *>("win-3"), 5) == 0);
    CHECK(group_highlight_focus_matches(nullptr, 0, reinterpret_cast<const uint8_t *>("win-2"), 5) == 0);
    CHECK(group_highlight_focus_matches(reinterpret_cast<const uint8_t *>("win-2"), 5, nullptr, 0) == 0);
    GroupHighlightState state{};
    CHECK(group_highlight_state_init(&state) == 0);
    CHECK(applyStr(&state, validPayload("gen-1-g1", 3), "win-9") == 3);
    CHECK(state.has_group == 0);
    // Focus mismatch preserves order without advancing it.
    CHECK(applyStr(&state, validPayload("gen-1-g2", 3), "win-2") == 1);
}

void statusClassifiesReceiptsWithoutMutation()
{
    GroupHighlightState state{};
    CHECK(group_highlight_state_init(&state) == 0);
    CHECK(applyStr(&state, validPayload("gen-1-g0", 1), "win-2") == 1);
    CHECK(applyStr(&state, "bad", "win-2") == 0);
    CHECK(applyStr(&state, validPayload("gen-1-g1", 2), "win-9") == 3);
    CHECK(applyStr(&state, validPayload("gen-1-g0", 1), "win-2") == 2);
    CHECK(group_highlight_clear(&state) == 0);
    GroupHighlightStatus first{};
    GroupHighlightStatus second{};
    CHECK(group_highlight_status(&state, &first) == 0);
    CHECK(group_highlight_status(&state, &second) == 0);
    CHECK(first.receipts == 4);
    CHECK(first.accepted == 1);
    CHECK(first.parse_rejected == 1);
    CHECK(first.focus_mismatch == 1);
    CHECK(first.stale_ignored == 1);
    CHECK(first.clear_requests == 1);
    CHECK(first.receipts == first.accepted + first.parse_rejected + first.focus_mismatch + first.stale_ignored);
    CHECK(first.has_group == 0);
    CHECK(first.order_initialized != 0);
    CHECK(second.receipts == first.receipts);
    CHECK(second.accepted == first.accepted);
    CHECK(second.parse_rejected == first.parse_rejected);
    CHECK(second.focus_mismatch == first.focus_mismatch);
    CHECK(second.stale_ignored == first.stale_ignored);
    CHECK(second.clear_requests == first.clear_requests);
    CHECK(second.has_group == first.has_group);
    CHECK(second.order_initialized == first.order_initialized);
}

void suppressedFocusStates()
{
    CHECK(group_highlight_focus_eligible(1, 0, 0, 0, 0, 0) != 0);
    CHECK(group_highlight_focus_eligible(0, 0, 0, 0, 0, 0) == 0);
    CHECK(group_highlight_focus_eligible(1, 1, 0, 0, 0, 0) == 0);
    CHECK(group_highlight_focus_eligible(1, 0, 1, 0, 0, 0) == 0);
    CHECK(group_highlight_focus_eligible(1, 0, 0, 1, 0, 0) == 0);
    CHECK(group_highlight_focus_eligible(1, 0, 0, 0, 1, 0) == 0);
    CHECK(group_highlight_focus_eligible(1, 0, 0, 0, 0, 1) == 0);
    CHECK(group_highlight_focus_eligible(1, 0, 0, 1, 0, 1) == 0);
}

void modifierVisibilityRequiresFirstSignalAndMetaAndEligibility()
{
    GroupHighlightState state{};
    CHECK(group_highlight_state_init(&state) == 0);
    CHECK(applyStr(&state, validPayload("gen-1-g0", 1), "win-2") == 1);
    CHECK(group_highlight_is_visible(&state, 1, 0, 1, 1) == 0);
    CHECK(group_highlight_is_visible(&state, 0, 1, 1, 1) == 0);
    CHECK(group_highlight_is_visible(&state, 1, 1, 0, 1) == 0);
    CHECK(group_highlight_is_visible(&state, 1, 1, 1, 0) == 0);
    CHECK(group_highlight_is_visible(&state, 1, 1, 1, 1) == 1);
    CHECK(group_highlight_clear(&state) == 1);
    CHECK(group_highlight_is_visible(&state, 1, 1, 1, 1) == 0);
    GroupHighlightRect rect{};
    CHECK(group_highlight_rect(&state, &rect) == 0);
}

void nullStateIsUsageError()
{
    CHECK(group_highlight_state_init(nullptr) == -1);
    CHECK(group_highlight_clear(nullptr) == -1);
    CHECK(group_highlight_is_visible(nullptr, 1, 1, 1, 1) == -1);
    CHECK(group_highlight_rect(nullptr, nullptr) == -1);
}

} // namespace

int main(int argc, char **argv)
{
    // Offline hard gate: isolate from the live session bus before any Qt
    // D-Bus initialization, mirroring the native KCM tests.
    qputenv("DBUS_SESSION_BUS_ADDRESS", QByteArray("unix:path=/dev/null/plasma-auto-tiler-group-test-isolated-bus"));
    QCoreApplication app(argc, argv);

    validPayloadAppliesWithUnionBounds();
    qstringBoundaryEmptyClears();
    malformedPayloadsFailClosed();
    successiveSameRevisionPassesLexicalTrap();
    staleAndOutOfOrderPreserveNewerDisplay();
    ownerGenerationChangeResetsMonotonicComparison();
    clearPreservesOrderWithinStream();
    focusBindingMatchesLiveActiveOnly();
    suppressedFocusStates();
    modifierVisibilityRequiresFirstSignalAndMetaAndEligibility();
    statusClassifiesReceiptsWithoutMutation();
    nullStateIsUsageError();

    if (failures != 0) {
        std::fprintf(stderr, "%d check(s) failed\n", failures);
        return EXIT_FAILURE;
    }
    std::printf("all checks passed\n");
    return EXIT_SUCCESS;
}
