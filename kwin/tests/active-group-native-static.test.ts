import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path: string): string => readFileSync(path, "utf8");

const effectHeader = read("native-effect/activewindowborder.h");
const effectImpl = read("native-effect/activewindowborder.cpp");
const logic = read("native-effect/activeborderlogic.h");
const cmake = read("native-effect/CMakeLists.txt");
const validator = read("native-effect/validate-metadata.cmake");
const ffi = read("native-effect/group_highlight_ffi.h");
const rust = read("native-effect/group_highlight.rs");

function countMatches(body: string, pattern: RegExp): number {
    const matches = body.match(pattern);
    return matches === null ? 0 : matches.length;
}

describe("active-group native static contract", () => {
    it("exposes setter, clear, and a read-only status query through the effect-owned endpoint", () => {
        assert.equal(countMatches(effectImpl, /Q_SCRIPTABLE/g), 3);
        assert.match(effectImpl, /SetGroupHighlight/);
        assert.match(effectImpl, /ClearGroupHighlight/);
        assert.match(effectImpl, /GetGroupHighlightStatus/);
        assert.match(effectHeader, /groupHighlightStatus\(\) const/);
        assert.match(effectImpl, /Q_CLASSINFO\("D-Bus Interface", "org\.plasmaautotiler\.ActiveBorder1"\)/);
        assert.match(effectImpl, /QDBusConnection::sessionBus/);
        assert.match(effectImpl, /registerService\(QStringLiteral\("org\.plasmaautotiler\.ActiveBorder"\)\)/);
        assert.match(effectImpl, /registerObject\(QStringLiteral\("\/org\/plasmaautotiler\/ActiveBorder"\)/);
        assert.match(effectImpl, /ExportScriptableContents/);
        assert.match(effectImpl, /unregisterObject\(QStringLiteral\("\/org\/plasmaautotiler\/ActiveBorder"\)\)/);
        assert.match(effectImpl, /unregisterService\(QStringLiteral\("org\.plasmaautotiler\.ActiveBorder"\)\)/);
        // The generic effect bus cannot dispatch effect-defined setters.
        assert.doesNotMatch(effectImpl, /\/Effects/);
        assert.doesNotMatch(effectImpl, /reconfigureEffect/);
        assert.doesNotMatch(effectImpl, /org\.kde\.kwin\.Effects/);
    });

    it("keeps the existing active border and adds exactly one group outline", () => {
        assert.equal(countMatches(effectHeader, /OutlinedBorderItem/g), 2);
        assert.match(effectHeader, /m_borderItem/);
        assert.match(effectHeader, /m_groupItem/);
        assert.match(effectImpl, /m_groupItem\(RectF\(\), BorderOutline\(\)\)/);
        assert.match(effectImpl, /m_groupItem\.setParentItem\(effects->scene\(\)->overlayItem\(\)\)/);
        assert.match(effectImpl, /m_groupItem\.setOutline\(/);
        assert.match(effectImpl, /m_groupItem\.setInnerRect\(/);
        assert.match(effectImpl, /m_groupItem\.setVisible\(/);
        // Existing active-border semantics are preserved verbatim.
        assert.match(effectImpl, /m_borderItem\.setInnerRect\(activeBorderInnerRect\(state\.innerRect, gap\)\)/);
        assert.match(effectImpl, /m_borderItem\.setVisible\(state\.visible\)/);
    });

    it("gates group visibility on passive Meta observation with unknown-before-first-signal invisible", () => {
        assert.match(effectImpl, /mouseChanged/);
        assert.match(effectImpl, /Qt::MetaModifier/);
        assert.match(effectImpl, /m_firstMouseSeen/);
        assert.match(effectImpl, /m_metaHeld/);
        assert.match(effectImpl, /group_highlight_is_visible/);
        assert.match(effectImpl, /group_highlight_focus_eligible/);
        assert.match(rust, /has_group && meta_held && first_signal_seen && focus_ok && endpoint_usable/);
        // Fullscreen/minimized/hidden/deleted hide via owned tracked signals
        // without pointer movement.
        assert.match(effectImpl, /minimizedChanged/);
        assert.match(effectImpl, /windowFullScreenChanged/);
        assert.match(effectImpl, /windowClosed/);
        assert.match(effectImpl, /updateGroupVisibility/);
    });

    it("binds focus, clears on activation, and fails closed on endpoint loss", () => {
        // Accepted payload focused_window binds to the live active internalId.
        assert.match(effectImpl, /internalId/);
        assert.match(effectImpl, /WithoutBraces/);
        assert.match(effectImpl, /group_highlight_apply/);
        assert.match(effectHeader, /GroupHighlightState m_groupState/);
        // Focus activation clears immediately before async refresh.
        assert.match(effectImpl, /windowActivated/);
        assert.match(effectImpl, /clearGroupHighlight/);
        // Registration failure fails closed with no retry.
        assert.match(effectHeader, /m_groupDbusAvailable/);
        assert.match(effectImpl, /m_groupDbusAvailable/);
        assert.doesNotMatch(effectImpl, /singleShot/);
    });

    it("parses strict bounded JSON with identity ordering and renders only supplied union bounds", () => {
        assert.match(effectImpl, /toUtf8/);
        assert.match(effectImpl, /group_highlight_apply/);
        assert.match(effectImpl, /group_highlight_rect/);
        assert.match(effectImpl, /group_highlight_status/);
        assert.match(ffi, /GroupHighlightState/);
        assert.match(ffi, /group_highlight_apply/);
        assert.match(ffi, /GroupHighlightStatus/);
        assert.match(ffi, /group_highlight_status/);
        assert.match(rust, /fn parse_payload/);
        assert.match(rust, /fn correlation_is_newer/);
        assert.match(rust, /-16384/);
        assert.match(rust, /16384/);
        for (const moved of [
            /parseGroupHighlightPayload/,
            /acceptGroupHighlightOrder/,
            /shouldShowGroupHighlight/,
            /groupFocusEligible/,
            /groupFocusMatches/,
            /isGroupEndpointUsable/,
            /QJsonDocument/,
        ]) {
            assert.doesNotMatch(effectHeader, moved);
            assert.doesNotMatch(effectImpl, moved);
            assert.doesNotMatch(logic, moved);
        }
    });

    it("forbids polling, timers, grabs, interception, filters, shortcuts, and custom scene rendering", () => {
        for (const forbidden of [
            /QTimer/,
            /singleShot/,
            /startMousePolling/,
            /grabMouse/,
            /grabKeyboard/,
            /installEventFilter/,
            /installSceneFilter/,
            /registerShortcut/,
            /registerPropertyType/,
            /paintWindow/,
            /drawWindow/,
            /prePaintScreen/,
            /postPaintScreen/,
            /startTimer/,
        ]) {
            assert.doesNotMatch(effectImpl, forbidden);
            assert.doesNotMatch(effectHeader, forbidden);
        }
    });

    it("covers changed files in CMake and the source validator", () => {
        assert.match(cmake, /activebordergroup_test\.cpp/);
        assert.match(cmake, /native-effect-group-highlight/);
        assert.match(cmake, /GROUP_HEADER/);
        assert.match(cmake, /GROUP_IMPL/);
        assert.match(cmake, /GROUP_LOGIC/);
        assert.match(cmake, /GROUP_FFI/);
        assert.match(cmake, /GROUP_RUST/);
        assert.match(validator, /GROUP_HEADER/);
        assert.match(validator, /GROUP_IMPL/);
        assert.match(validator, /GROUP_LOGIC/);
        assert.match(validator, /SetGroupHighlight/);
        assert.match(validator, /ClearGroupHighlight/);
        assert.match(validator, /mouseChanged/);
        assert.match(validator, /MetaModifier/);
        assert.match(validator, /OutlinedBorderItem/);
        assert.match(validator, /group_highlight_focus_matches/);
        assert.match(validator, /group_highlight_is_visible/);
        assert.match(validator, /m_groupDbusAvailable/);
    });
});
