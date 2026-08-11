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

// Maintained managed-window model: internalId -> { window, output }
var managedWindows = {};

function copyRect(rect) {
    return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height
    };
}

function isManagedWindow(window) {
    return window.normalWindow &&
        window.managed &&
        !!window.output &&
        MANAGED_RESOURCE_CLASS !== MANAGED_RESOURCE_CLASS_UNSET &&
        window.resourceClass === MANAGED_RESOURCE_CLASS;
}

// Columns layout: count equal-width columns spanning the full height of the
// layout area. The layout area is the triggering window's output, captured
// into the state model at add time.
function reconcile(output) {
    var ids = Object.keys(managedWindows);
    var count = ids.length;
    if (count === 0) {
        return;
    }
    var columnWidth = Math.floor(output.width / count);
    for (var i = 0; i < count; i++) {
        var win = managedWindows[ids[i]].window;
        var rect = Object.assign({}, win.frameGeometry);
        rect.x = output.x + i * columnWidth;
        rect.y = output.y;
        rect.width = columnWidth;
        rect.height = output.height;
        win.frameGeometry = rect;
    }
}

function logEvent(eventType, internalId, output) {
    var start = Date.now();
    reconcile(output);
    var end = Date.now();

    var line = [
        eventType,
        internalId,
        String(start),
        String(end),
        String(end - start)
    ].join(",");

    callDBus(LOG_SERVICE, LOG_PATH, LOG_INTERFACE, LOG_METHOD, line);

    if (readConfig("amplify", "0") !== "0") {
        runAmplifiedReconcile(internalId, output);
    }
}

// Synthetic amplification (README, "Synthetic amplification measurement"):
// repeats reconcile() in a bounded synchronous loop and divides the loop wall
// time by the iteration count. OFF by default (readConfig("amplify", "0"));
// runs only after the real log line is emitted, never between the real
// start/end timestamps, and only when explicitly enabled for a separate
// calibration pass. reconcile() is idempotent, so repeated calls write the
// same geometry and mutate no script state.
function formatAmplifiedMs(value) {
    if (value === 0) {
        return "0";
    }
    return String(Math.round(value * 1000000) / 1000000);
}

function runAmplifiedReconcile(internalId, output) {
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
        reconcile(output);
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
        "amplified-b",
        internalId,
        String(ampIterations),
        String(ampTotal),
        formatAmplifiedMs(ampPerOp),
        ampWallCapHit ? "wallcap" : "iterationcap"
    ].join(",");
    callDBus(LOG_SERVICE, LOG_PATH, LOG_INTERFACE, LOG_METHOD, ampLine);
}

function handleWindowAdded(window) {
    if (!isManagedWindow(window)) {
        return;
    }
    var internalId = String(window.internalId);
    managedWindows[internalId] = {
        window: window,
        output: copyRect(window.output.geometry)
    };
    logEvent("windowAdded", internalId, managedWindows[internalId].output);
}

function handleWindowRemoved(window) {
    if (MANAGED_RESOURCE_CLASS === MANAGED_RESOURCE_CLASS_UNSET ||
            window.resourceClass !== MANAGED_RESOURCE_CLASS) {
        return;
    }
    var internalId = String(window.internalId);
    var entry = managedWindows[internalId];
    if (!entry) {
        return;
    }
    var output = entry.output;
    delete managedWindows[internalId];
    logEvent("windowRemoved", internalId, output);
}

function handleWatchdogFired() {
    workspace.windowAdded.disconnect(handleWindowAdded);
    workspace.windowRemoved.disconnect(handleWindowRemoved);
    watchdogTimer.stop();
    callDBus(LOG_SERVICE, LOG_PATH, LOG_INTERFACE, LOG_METHOD,
        "watchdog-b,fired," + String(Date.now() - scriptStartMs));
}

var watchdogTimer = new QTimer();
watchdogTimer.singleShot = true;
watchdogTimer.timeout.connect(handleWatchdogFired);
watchdogTimer.start(WATCHDOG_MAX_LIFETIME_MS);

workspace.windowAdded.connect(handleWindowAdded);
workspace.windowRemoved.connect(handleWindowRemoved);
