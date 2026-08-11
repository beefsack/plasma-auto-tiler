var LOG_SERVICE = "com.plasmaAutoTiler.LogSink";
var LOG_PATH = "/com/plasmaAutoTiler/LogSink";
var LOG_INTERFACE = "com.plasmaAutoTiler.LogSink";
var LOG_METHOD = "append";

var AMPLIFY_GUARD_INTERVAL = 64;

// Terminal-protection scope restriction (README, "Terminal-protection scope
// restriction"): act only on windows whose resourceClass exactly matches the
// configured class. Unconfigured (sentinel "__unset__", the default) means
// inert, not permissive. Read once at top level: the config value cannot
// change during the script's lifetime.
var MANAGED_RESOURCE_CLASS_UNSET = "__unset__";
var MANAGED_RESOURCE_CLASS = readConfig("managedResourceClass", MANAGED_RESOURCE_CLASS_UNSET);

// Fail-safe watchdog (README, "Fail-safe watchdog"): self-disarm after a
// bounded lifetime even if the harness dies and never calls unloadScript.
// A script cannot unload itself (unloadScript is a Scripting D-Bus method,
// not a JS global), so "self-unload" means disconnecting the handlers.
var WATCHDOG_MAX_LIFETIME_MS = Number(readConfig("watchdogMaxLifetimeMs", "300000"));
if (!(WATCHDOG_MAX_LIFETIME_MS > 0)) {
    WATCHDOG_MAX_LIFETIME_MS = 300000;
}
var scriptStartMs = Date.now();

// Synthetic amplification (README, "Synthetic amplification measurement"):
// repeats the exact real-dispatch compute+write body in a bounded synchronous
// loop and divides the loop wall time by the iteration count to get a precise
// per-operation figure. OFF by default (readConfig("amplify", "0")); runs only
// after the real log line is emitted, never between the real start/end
// timestamps, and only when explicitly enabled for a separate calibration
// pass. The body is a verbatim copy so the real-dispatch path stays
// byte-for-byte unchanged and shares no code with this block.
function formatAmplifiedMs(value) {
    if (value === 0) {
        return "0";
    }
    return String(Math.round(value * 1000000) / 1000000);
}

function runAmplified(window, internalId) {
    var ampMaxMs = Number(readConfig("amplifyMaxMs", "20"));
    var ampMaxIterations = Number(readConfig("amplifyMaxIterations", "5000"));
    if (!(ampMaxMs > 0)) {
        ampMaxMs = 20;
    }
    if (!(ampMaxIterations > 0)) {
        ampMaxIterations = 5000;
    }

    var ampStart = Date.now();
    var ampIterations = 0;
    var ampWallCapHit = false;
    while (ampIterations < ampMaxIterations) {
        var ampArea = window.output.geometry;
        var ampRect = Object.assign({}, window.frameGeometry);
        ampRect.x = ampArea.x;
        ampRect.y = ampArea.y;
        ampRect.width = Math.floor(ampArea.width / 2);
        ampRect.height = ampArea.height;
        window.frameGeometry = ampRect;

        ampIterations++;
        if (ampIterations % AMPLIFY_GUARD_INTERVAL === 0 &&
                Date.now() - ampStart >= ampMaxMs) {
            ampWallCapHit = true;
            break;
        }
    }
    var ampTotal = Date.now() - ampStart;
    var ampPerOp = 0;
    if (ampIterations > 0 && ampTotal > 0) {
        ampPerOp = ampTotal / ampIterations;
    }
    var ampLine = [
        "amplified-a",
        internalId,
        String(ampIterations),
        String(ampTotal),
        formatAmplifiedMs(ampPerOp),
        ampWallCapHit ? "wallcap" : "iterationcap"
    ].join(",");
    callDBus(LOG_SERVICE, LOG_PATH, LOG_INTERFACE, LOG_METHOD, ampLine);
}

function handleWindowAdded(window) {
    if (MANAGED_RESOURCE_CLASS === MANAGED_RESOURCE_CLASS_UNSET ||
            window.resourceClass !== MANAGED_RESOURCE_CLASS) {
        return;
    }
    if (!window.normalWindow || !window.managed) {
        return;
    }
    if (!window.output) {
        return;
    }

    var start = Date.now();

    var area = window.output.geometry;
    var rect = Object.assign({}, window.frameGeometry);
    rect.x = area.x;
    rect.y = area.y;
    rect.width = Math.floor(area.width / 2);
    rect.height = area.height;
    window.frameGeometry = rect;

    var end = Date.now();

    var line = [
        "windowAdded",
        String(window.internalId),
        String(start),
        String(end),
        String(end - start)
    ].join(",");

    callDBus(LOG_SERVICE, LOG_PATH, LOG_INTERFACE, LOG_METHOD, line);

    if (readConfig("amplify", "0") !== "0") {
        runAmplified(window, String(window.internalId));
    }
}

function handleWatchdogFired() {
    workspace.windowAdded.disconnect(handleWindowAdded);
    watchdogTimer.stop();
    callDBus(LOG_SERVICE, LOG_PATH, LOG_INTERFACE, LOG_METHOD,
        "watchdog-a,fired," + String(Date.now() - scriptStartMs));
}

var watchdogTimer = new QTimer();
watchdogTimer.singleShot = true;
watchdogTimer.timeout.connect(handleWatchdogFired);
watchdogTimer.start(WATCHDOG_MAX_LIFETIME_MS);

workspace.windowAdded.connect(handleWindowAdded);
