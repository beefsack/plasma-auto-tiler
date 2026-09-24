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
const rust = read("../crates/tiler-kwin-effect-ffi/src/group_highlight.rs");

function countMatches(body: string, pattern: RegExp): number {
    const matches = body.match(pattern);
    return matches === null ? 0 : matches.length;
}

describe("active-group native static contract", () => {
    it("exposes setter, clear, and a read-only status query through the effect-owned endpoint", () => {
        assert.equal(countMatches(effectImpl, /Q_SCRIPTABLE/g), 4);
        assert.match(effectImpl, /SetGroupHighlight/);
        assert.match(effectImpl, /ClearGroupHighlight/);
        assert.match(effectImpl, /GetGroupHighlightStatus/);
        assert.match(effectImpl, /LastVerdict/);
        // No script maximize handoff: observation seeds directly from the
        // native committed maximizeMode().
        assert.doesNotMatch(effectImpl, /SetInitialMaximizeState/);
        assert.doesNotMatch(effectImpl, /ClearInitialMaximizeState/);
        assert.doesNotMatch(effectImpl, /GetInitialMaximizeEpoch/);
        assert.doesNotMatch(effectImpl, /initial_maximize_/);
        assert.doesNotMatch(effectImpl, /InitialMaximize/);
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
        // The active border is local to its target, below target contents and
        // later-stacked windows rather than a global overlay.
        assert.match(effectImpl, /m_borderItem\.setZ\(-1\)/);
        assert.match(effectImpl, /m_borderItem\.setParentItem\(m_trackedWindow->windowItem\(\)\)/);
        assert.match(effectImpl, /m_borderItem\.setParentItem\(effects->scene\(\)->overlayItem\(\)\)/);
        assert.match(effectImpl, /const QRectF innerRect = activeBorderInnerRect\(state\.innerRect, gap\)/);
        assert.match(effectImpl, /m_borderItem\.setInnerRect\(window \? window->windowItem\(\)->mapFromScene\(innerRect\) : RectF\(\)\)/);
        assert.match(effectImpl, /const bool visible = state\.visible;/);
        assert.doesNotMatch(effectImpl, /initialOk/);
        assert.match(effectImpl, /m_borderItem\.setVisible\(visible\)/);
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

    it("seeds maximize observation directly from committed mode with transitions authoritative", () => {
        // Each observed window seeds m_maximizedWindows from window()->maximizeMode().
        assert.match(effectImpl, /maximizeMode\(\)/);
        assert.match(effectImpl, /activeBorderSeedMaximized/);
        assert.match(logic, /activeBorderSeedMaximized/);
        assert.doesNotMatch(logic, /activeBorderInitialGate/);
        // Any maximize axis suppresses both borders; fullscreen stays
        // suppressed independently via live isFullScreen().
        assert.match(effectImpl, /m_maximizedWindows\.insert\(window\)/);
        assert.match(effectImpl, /observe-seed/);
        // Native transition signals stay authoritative after the seed.
        assert.match(effectImpl, /windowMaximizedStateChanged/);
        assert.match(effectImpl, /windowMaximizedStateAboutToChange/);
        assert.match(effectImpl, /updateMaximizedState/);
        // No script handoff residue anywhere in the native contract.
        assert.doesNotMatch(effectHeader, /InitialMaximizeState/);
        assert.doesNotMatch(effectHeader, /m_initialEpoch/);
        assert.doesNotMatch(effectHeader, /initialMaximizeEpoch/);
        assert.doesNotMatch(effectHeader, /clearInitialGate/);
        assert.doesNotMatch(effectHeader, /isInitialConfirmedNormal/);
        assert.doesNotMatch(effectImpl, /QUuid::createUuid/);
        assert.doesNotMatch(effectImpl, /m_initialEpoch/);
        assert.doesNotMatch(effectImpl, /clearInitialGate/);
        assert.doesNotMatch(effectImpl, /isInitialConfirmedNormal/);
        assert.doesNotMatch(effectImpl, /emitActiveBorderApply/);
        // No Qt JSON parsing: strict POD arrives through the Rust staticlib.
        assert.doesNotMatch(effectImpl, /QJsonDocument/);
        assert.doesNotMatch(ffi, /InitialMaximizeState/);
        assert.doesNotMatch(ffi, /initial_maximize_/);
        assert.doesNotMatch(rust, /initial_maximize_/);
        assert.doesNotMatch(rust, /InitialMaximize/);
        assert.doesNotMatch(rust, /maximize_mode/);
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
        assert.match(cmake, /DRAG_HEADER/);
        assert.match(cmake, /DRAG_IMPL/);
        assert.match(cmake, /DRAG_FFI/);
        assert.match(cmake, /DRAG_RUST/);
        assert.match(cmake, /validate-unified-lifecycle\.cmake/);
        assert.match(validator, /GROUP_HEADER/);
        assert.match(validator, /GROUP_IMPL/);
        assert.match(validator, /GROUP_LOGIC/);
        assert.match(validator, /SetGroupHighlight/);
        assert.match(validator, /ClearGroupHighlight/);
        assert.match(validator, /LastVerdict/);
        assert.doesNotMatch(validator, /SetInitialMaximizeState/);
        assert.doesNotMatch(validator, /ClearInitialMaximizeState/);
        assert.doesNotMatch(validator, /GetInitialMaximizeEpoch/);
        assert.doesNotMatch(validator, /initial_maximize_/);
        assert.match(validator, /mouseChanged/);
        assert.match(validator, /MetaModifier/);
        assert.match(validator, /OutlinedBorderItem/);
        assert.match(validator, /group_highlight_focus_matches/);
        assert.match(validator, /group_highlight_is_visible/);
        assert.match(validator, /m_groupDbusAvailable/);
    });

    it("folds the drag oracle into the survivor with one shared lifecycle and no second plugin", () => {
        // Oracle D-Bus endpoint and LastVerdict contract survive unchanged.
        assert.match(effectImpl, /Q_CLASSINFO\("D-Bus Interface", "org\.plasmaautotiler\.DragOracle1"\)/);
        assert.match(effectImpl, /registerService\(QStringLiteral\("org\.plasmaautotiler\.DragOracle"\)\)/);
        assert.match(effectImpl, /registerObject\(QStringLiteral\("\/org\/plasmaautotiler\/DragOracle"\)/);
        assert.match(effectImpl, /unregisterObject\(QStringLiteral\("\/org\/plasmaautotiler\/DragOracle"\)\)/);
        assert.match(effectImpl, /unregisterService\(QStringLiteral\("org\.plasmaautotiler\.DragOracle"\)\)/);
        // Copied verdict before the D-Bus return; never a borrowed view.
        assert.match(effectImpl, /drag_oracle_last_copy/);
        assert.doesNotMatch(effectImpl, /drag_oracle_last\(/);
        assert.match(effectImpl, /drag_oracle_record/);
        // Exactly one shared hookup set: single stacking-order pass and one
        // windowAdded/closed/deleted connection each driving both maximize
        // tracking and oracle start/finish state.
        assert.equal(countMatches(effectImpl, /stackingOrder/g), 1);
        assert.equal(countMatches(effectImpl, /EffectsHandler::windowAdded/g), 1);
        assert.equal(countMatches(effectImpl, /EffectsHandler::windowClosed/g), 1);
        assert.equal(countMatches(effectImpl, /EffectsHandler::windowDeleted/g), 1);
        assert.match(effectImpl, /attachOracleWindow/);
        assert.match(effectImpl, /forgetOracleWindow/);
        assert.match(effectImpl, /onOracleDragStart/);
        assert.match(effectImpl, /onOracleDragFinish/);
        assert.match(effectImpl, /windowStartUserMovedResized/);
        assert.match(effectImpl, /windowFinishUserMovedResized/);
        assert.match(effectImpl, /moveResizeGeometry/);
        assert.match(effectImpl, /oracleMoveResizeRect/);
        // The original observer was rendering-independent. The survivor must
        // attach it before the active-border-only OpenGL early return.
        const oracleSetup = effectImpl.indexOf("m_oracleDbusObject =");
        assert.ok(oracleSetup >= 0);
        assert.ok(effectImpl.indexOf("attachOracleWindow(window);", oracleSetup) < effectImpl.indexOf("m_borderItem.setZ(-1)", oracleSetup));
        // No second plugin effect or factory.
        assert.doesNotMatch(effectImpl, /DragOracleEffect/);
        assert.doesNotMatch(effectImpl, /dragoracle-metadata\.json/);
        assert.doesNotMatch(effectImpl, /plasma-auto-tiler-drag-oracle/);
        assert.doesNotMatch(effectHeader, /DragOracleEffect/);
        assert.match(effectHeader, /m_oracleDbusObject/);
        assert.match(effectHeader, /m_oracleStartRects/);
        assert.match(effectHeader, /drag_oracle_ffi\.h/);
        // Rendering untouched: still exactly two outlines.
        assert.equal(countMatches(effectHeader, /OutlinedBorderItem/g), 2);
        // Oracle Rust FFI and pull protocol surface stay intact.
        const oracleFfi = read("native-effect/drag_oracle_ffi.h");
        const oracleRust = read("../crates/tiler-kwin-effect-ffi/src/drag_oracle.rs");
        assert.match(oracleFfi, /DragOracleRect/);
        assert.match(oracleFfi, /drag_oracle_record/);
        assert.match(oracleFfi, /drag_oracle_last_copy/);
        assert.match(oracleRust, /drag_oracle_last_copy/);
        assert.match(oracleRust, /correlation/);
    });
});

describe("active-border visibility diagnostics", () => {
    function functionBody(body: string, marker: string): string {
        const start = body.indexOf(marker);
        assert.ok(start >= 0, marker);
        const end = body.indexOf("\n}\n", start);
        assert.ok(end > start, marker);
        return body.slice(start, end + 3);
    }

    it("emits bounded endpoint, observe-seed, and visible shapes from fixed sites", () => {
        assert.match(effectImpl, /Q_LOGGING_CATEGORY\(lcActiveBorder,\s*"plasmaautotiler\.activeborder"\)/);
        assert.match(effectImpl, /qCInfo\(lcActiveBorder\)\.noquote\(\)/);
        assert.match(effectImpl, /plasma-auto-tiler:active-border:endpoint available=/);
        assert.match(effectImpl, /plasma-auto-tiler:active-border:observe-seed maximized=/);
        assert.match(effectImpl, /plasma-auto-tiler:active-border:visible vis=/);
        assert.match(effectImpl, /emitActiveBorderEndpoint\(\)/);
        assert.match(effectImpl, /emitActiveBorderVisible\(visible,/);
        assert.doesNotMatch(effectImpl, /initial-apply/);
        assert.doesNotMatch(effectImpl, /emitActiveBorderApply/);
        assert.match(effectHeader, /m_borderDiagEmitted/);
        assert.match(effectHeader, /m_borderDiagVisible/);
        assert.match(effectHeader, /emitActiveBorderVisible\(bool visible, const char \*reason\)/);
        for (const token of [
            "eligible",
            "no-window",
            "deleted",
            "minimized",
            "fullscreen",
            "maximized",
            "endpoint-unavailable",
        ]) {
            assert.ok(effectImpl.includes(`"${token}"`), token);
        }
        assert.ok(!effectImpl.includes('"initial-unconfirmed"'), "initial-unconfirmed");
        // Endpoint once after registration, seed inside subscribeMaximize,
        // visible inside updateBorder.
        const ctorEndpoint = effectImpl.indexOf("emitActiveBorderEndpoint();");
        assert.ok(ctorEndpoint > effectImpl.indexOf("m_groupDbusAvailable = groupRegistered"));
        const seedLog = effectImpl.indexOf("plasma-auto-tiler:active-border:observe-seed");
        assert.ok(seedLog > effectImpl.indexOf("void ActiveWindowBorderEffect::subscribeMaximize("));
        const updateBorderBody = functionBody(effectImpl, "void ActiveWindowBorderEffect::updateBorder()");
        assert.match(updateBorderBody, /emitActiveBorderVisible\(visible,/);
    });

    it("emits visible edge-only on first evaluation and visibility flips", () => {
        assert.equal(countMatches(effectImpl, /plasma-auto-tiler:active-border:visible/g), 1);
        assert.equal(countMatches(effectImpl, /emitActiveBorderVisible/g), 2);
        const visibleBody = functionBody(effectImpl, "void ActiveWindowBorderEffect::emitActiveBorderVisible(");
        assert.match(visibleBody, /m_borderDiagEmitted/);
        assert.match(visibleBody, /m_borderDiagVisible/);
        assert.match(visibleBody, /visible == m_borderDiagVisible/);
        // updateBorder delegates edge dedup to the emitter; it must call it
        // with the computed visibility but hold no ledger itself.
        const updateBorderBody = functionBody(effectImpl, "void ActiveWindowBorderEffect::updateBorder()");
        assert.match(updateBorderBody, /emitActiveBorderVisible\(visible,/);
        assert.doesNotMatch(updateBorderBody, /m_borderDiagVisible =/);
        // No timers, polling, or new registry/transport for diagnostics.
        for (const forbidden of [/QTimer/, /singleShot/, /startTimer/, /registerService/, /registerObject/]) {
            assert.doesNotMatch(visibleBody, forbidden);
        }
    });

    it("keeps diagnostics out of paint, mouse, and group update paths", () => {
        const paintBody = functionBody(effectImpl, "void ActiveWindowBorderEffect::paintScreen(");
        assert.doesNotMatch(paintBody, /active-border:/);
        assert.doesNotMatch(paintBody, /emitActiveBorder/);
        assert.doesNotMatch(paintBody, /lcActiveBorder/);
        const mouseBody = functionBody(effectImpl, "void ActiveWindowBorderEffect::onMouseChanged(");
        assert.doesNotMatch(mouseBody, /active-border:/);
        assert.doesNotMatch(mouseBody, /emitActiveBorder/);
        assert.doesNotMatch(mouseBody, /lcActiveBorder/);
        const groupBody = functionBody(effectImpl, "void ActiveWindowBorderEffect::updateGroupVisibility()");
        assert.doesNotMatch(groupBody, /active-border:/);
        assert.doesNotMatch(groupBody, /emitActiveBorder/);
        assert.doesNotMatch(groupBody, /lcActiveBorder/);
    });

    it("uses fixed bounded fields with no identity, payload, or geometry", () => {
        const seedMarker = "plasma-auto-tiler:active-border:observe-seed";
        const seedAt = effectImpl.indexOf(seedMarker);
        assert.ok(seedAt >= 0, seedMarker);
        const subscribeBody = functionBody(effectImpl, "void ActiveWindowBorderEffect::subscribeMaximize(");
        assert.ok(subscribeBody.includes(seedMarker), seedMarker);
        assert.match(subscribeBody, /maximized=%1 fullscreen=%2/);
        const visibleBody = functionBody(effectImpl, "void ActiveWindowBorderEffect::emitActiveBorderVisible(");
        assert.match(visibleBody, /vis=%1 reason=%2/);
        const endpointBody = functionBody(effectImpl, "void ActiveWindowBorderEffect::emitActiveBorderEndpoint(");
        assert.match(endpointBody, /endpoint available=%1/);
        for (const body of [subscribeBody, visibleBody, endpointBody]) {
            for (const forbidden of [
                /internalId/,
                /WithoutBraces/,
                /payloadBytes/,
                /activeBytes/,
                /frameGeometry/,
                /windowItem/,
                /mapFromScene/,
                /maximize_mode/,
                /generation/,
                /QUuid::createUuid/,
                /QRectF/,
            ]) {
                assert.doesNotMatch(body, forbidden);
            }
        }
        // Logging failures are swallowed and never gate rendering decisions.
        const logBody = functionBody(effectImpl, "void ActiveWindowBorderEffect::logActiveBorderDiag(");
        assert.match(logBody, /catch \(\.\.\.\)/);
        assert.doesNotMatch(logBody, /setVisible/);
        assert.doesNotMatch(logBody, /addRepaintFull/);
        assert.doesNotMatch(logBody, /initial_maximize_/);
    });
});
