// Plasma Auto Tiler structural-feasibility proof script.
// Loaded via org.kde.kwin.Scripting.loadScript and run by org.kde.kwin.Scripting.start.
// Inert until setup() completes: if the proof desktop is missing it stays inert
// for its whole lifetime. Manages ONLY sentinel-class windows on exactly the
// proof desktop. Emits every fact through the com.plasmaAutoTiler.LogSink D-Bus
// method call, captured by the host harness with dbus-monitor.

var PROOF_DESKTOP_NAME = "plasma-auto-tiler-proof";
var SENTINEL_PREFIX = "plasma-auto-tiler-kb-";
var SENTINEL_SEQUENCE = "Meta+Ctrl+Shift+Alt+P";
var SHORTCUT_TEXT = "Plasma Auto Tiler Proof";
var WATCHDOG_MS = 300000;
var COLLAPSE_DELAY_MS = 1000;
var LOG_SERVICE = "com.plasmaAutoTiler.LogSink";
var LOG_PATH = "/com/plasmaAutoTiler/LogSink";
var LOG_IFACE = "com.plasmaAutoTiler.LogSink";
var LAYOUT_FLAGS = ["floating", "horizontal", "vertical"];

// Fail-inert: every mutable target starts __unset__ and stays inert until
// setup() arms the script.
var state = {
    proofDesktop: undefined,
    proofDesktopId: undefined,
    root: undefined,
    sentinelActionId: undefined,
    preselectArmed: undefined,
    watchdog: undefined,
    collapseTimer: undefined,
    armed: undefined,
    managed: undefined,
    drag: undefined,
    errors: undefined,
    addedHandler: undefined,
    removedHandler: undefined,
};

function log() {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) {
        parts.push(String(arguments[i]));
    }
    callDBus(LOG_SERVICE, LOG_PATH, LOG_IFACE, "append", parts.join(","));
}

function r4(v) {
    var r = Math.round(v * 10000) / 10000;
    if (r === 0) {
        r = 0;
    }
    return String(r);
}

function fmtRect(g) {
    return "F(" + r4(g.x) + "," + r4(g.y) + "," + r4(g.width) + "," + r4(g.height) + ")";
}

function dirName(d) {
    return LAYOUT_FLAGS[d] !== undefined ? LAYOUT_FLAGS[d] : String(d);
}

function tileLabel(t) {
    if (!t) {
        return "none";
    }
    if (t.isLayout) {
        return "L(" + dirName(t.layoutDirection) + ")";
    }
    return fmtRect(t.relativeGeometry);
}

function gated(window) {
    if (!state.armed) {
        return false;
    }
    if (!window) {
        return false;
    }
    var rc = window.resourceClass;
    if (rc !== "PlasmaAutoTilerTestWindow" && rc !== "plasma-auto-tiler-test") {
        return false;
    }
    if (!window.normalWindow || !window.managed) {
        return false;
    }
    var ds = window.desktops;
    if (!ds || ds.length !== 1) {
        return false;
    }
    if (!ds[0] || ds[0].id !== state.proofDesktopId) {
        return false;
    }
    return true;
}

function getProofRoot() {
    if (!state.armed) {
        return undefined;
    }
    var screens = workspace.screens;
    if (!screens || screens.length < 1) {
        return undefined;
    }
    return workspace.rootTile(screens[0], state.proofDesktop);
}

function findDefaultLeaf(root) {
    var leaves = [];
    (function walk(t) {
        if (!t) {
            return;
        }
        if (t.isLayout) {
            var kids = t.tiles;
            for (var i = 0; i < kids.length; i++) {
                walk(kids[i]);
            }
        } else {
            leaves.push(t);
        }
    })(root);
    for (var i = 0; i < leaves.length; i++) {
        if (leaves[i].windows.length === 0) {
            return leaves[i];
        }
    }
    return leaves[leaves.length - 1];
}

function findLeafSerial(root, target) {
    var serial = 0;
    var found = 0;
    (function walk(t) {
        if (found) {
            return;
        }
        if (!t) {
            return;
        }
        if (t.isLayout) {
            var kids = t.tiles;
            for (var i = 0; i < kids.length; i++) {
                walk(kids[i]);
            }
        } else {
            serial++;
            if (t === target) {
                found = serial;
            }
        }
    })(root);
    return found;
}

function tileOf(window) {
    try {
        return window.tile;
    } catch (e) {
        return undefined;
    }
}

function serializeTree(root) {
    var out = [];
    (function walk(t) {
        if (!t) {
            return;
        }
        if (t.isLayout) {
            out.push("L(" + dirName(t.layoutDirection) + ")(");
            var kids = t.tiles;
            for (var i = 0; i < kids.length; i++) {
                walk(kids[i]);
            }
            out.push(")");
        } else {
            out.push(fmtRect(t.relativeGeometry));
        }
    })(root);
    return out.join("");
}

function logTree() {
    var s = serializeTree(state.root);
    log("tree-snapshot," + state.proofDesktopId + "," + s);
    var serial = 0;
    (function walk(t) {
        if (!t) {
            return;
        }
        if (t.isLayout) {
            var kids = t.tiles;
            for (var i = 0; i < kids.length; i++) {
                walk(kids[i]);
            }
        } else {
            serial++;
            log("leaf-serial," + serial + "," + fmtRect(t.relativeGeometry) + "," + t.windows.length);
        }
    })(state.root);
}

function connectDrag(window) {
    var id = String(window.internalId);
    if (state.managed && state.managed[id]) {
        return;
    }
    state.managed[id] = true;
    window.interactiveMoveResizeStarted.connect(guarded("dragStarted", function () {
        if (!state.armed || !gated(window)) {
            return;
        }
        var g = window.frameGeometry;
        state.drag[id] = {
            startMs: Date.now(),
            startGeom: { x: g.x, y: g.y, width: g.width, height: g.height },
            seq: 0,
        };
        log("drag-started," + id + "," + state.drag[id].startMs + "," + fmtRect(g));
    }));
    window.interactiveMoveResizeStepped.connect(guarded("dragStepped", function (geometry) {
        if (!state.armed || !gated(window)) {
            return;
        }
        if (!state.drag[id]) {
            return;
        }
        state.drag[id].seq++;
        log("drag-stepped," + id + "," + state.drag[id].seq + "," + fmtRect(geometry));
    }));
    window.interactiveMoveResizeFinished.connect(guarded("dragFinished", function () {
        if (!state.armed || !gated(window)) {
            return;
        }
        var ds = state.drag[id];
        if (!ds) {
            return;
        }
        var g = window.frameGeometry;
        var endGeom = { x: g.x, y: g.y, width: g.width, height: g.height };
        var handlerMs = Date.now() - ds.startMs;
        var dx = Math.abs(ds.startGeom.x - endGeom.x);
        var dy = Math.abs(ds.startGeom.y - endGeom.y);
        var moved = dx > 1.0 || dy > 1.0;
        if (!moved) {
            log("drag-cancel-inferred," + id + "," + fmtRect(ds.startGeom) + "," + fmtRect(endGeom) + "," + tileLabel(tileOf(window)) + "," + tileLabel(tileOf(window)));
            delete state.drag[id];
            return;
        }
        var root = getProofRoot();
        if (!root) {
            log("error,drag-finished,no-root");
            delete state.drag[id];
            return;
        }
        var cur = workspace.cursorPos;
        var hit = root.pick(cur.x, cur.y);
        var action = "noop";
        var finalTile = tileOf(window);
        if (hit) {
            if (hit.windows.length === 0 && hit.canBeRemoved) {
                var splitResult = hit.split(1);
                var target = root.pick(cur.x, cur.y);
                if (!target) {
                    target = splitResult[0];
                }
                target.manage(window);
                action = "split";
                finalTile = tileOf(window);
            } else {
                action = "leaf-occupied";
            }
        } else {
            action = "no-hit";
        }
        log("drag-finished," + id + ",P(" + r4(cur.x) + "," + r4(cur.y) + ")," + tileLabel(hit) + "," + action + "," + tileLabel(finalTile) + "," + handlerMs);
        delete state.drag[id];
        logTree();
    }));
}

function onWindowAdded(window) {
    if (!state.armed || !gated(window)) {
        return;
    }
    // a window addition cancels any pending collapse, so the collapse only
    // fires after the last gated window has truly closed (deterministic
    // empty-branch collapse; prevents the collapse racing the T9b respawn)
    if (state.collapseTimer) {
        try {
            state.collapseTimer.stop();
        } catch (e) {
            // ignore
        }
    }
    var id = String(window.internalId);
    var root = getProofRoot();
    if (!root) {
        log("error,windowAdded,no-root");
        return;
    }
    var leaf = findDefaultLeaf(root);
    if (!leaf) {
        log("error,windowAdded,no-leaf");
        return;
    }
    var ok = leaf.manage(window);
    if (state.preselectArmed === true) {
        state.preselectArmed = false;
        log("keyboard-directed," + id + "," + findLeafSerial(root, leaf));
    } else {
        log("window-managed," + id + "," + findLeafSerial(root, leaf));
    }
    if (ok) {
        connectDrag(window);
    }
    logTree();
}

function onWindowRemoved(window) {
    if (!state.armed || !gated(window)) {
        return;
    }
    var id = String(window.internalId);
    log("window-unmanaged," + id);
    if (state.collapseTimer) {
        try {
            state.collapseTimer.stop();
        } catch (e) {
            // ignore
        }
    }
    state.collapseTimer = new QTimer();
    state.collapseTimer.interval = COLLAPSE_DELAY_MS;
    state.collapseTimer.singleShot = true;
    state.collapseTimer.timeout.connect(guarded("collapse", function () {
        if (!state.armed) {
            return;
        }
        if (!workspace.currentDesktop || workspace.currentDesktop.id !== state.proofDesktopId) {
            return;
        }
        var root = getProofRoot();
        if (!root) {
            return;
        }
        var target = undefined;
        (function walk(t) {
            if (target) {
                return;
            }
            if (!t) {
                return;
            }
            if (t.isLayout) {
                var kids = t.tiles;
                for (var i = 0; i < kids.length; i++) {
                    walk(kids[i]);
                }
            } else if (t.windows.length === 0 && t.canBeRemoved) {
                target = t;
            }
        })(root);
        if (target) {
            target.remove();
            log("collapse-done," + state.proofDesktopId);
            logTree();
        } else {
            log("collapse-skip,no-empty-removable-leaf");
        }
    }));
    state.collapseTimer.start();
}

var errorCounts = {};
var disarmedSet = {};

function disarmed(name) {
    disarmedSet[name] = true;
    if (name === "windowAdded" && state.addedHandler) {
        try {
            workspace.windowAdded.disconnect(state.addedHandler);
        } catch (e) {
            // ignore
        }
    }
    if (name === "windowRemoved" && state.removedHandler) {
        try {
            workspace.windowRemoved.disconnect(state.removedHandler);
        } catch (e) {
            // ignore
        }
    }
}

function guarded(name, fn) {
    return function () {
        if (disarmedSet[name]) {
            return;
        }
        try {
            fn.apply(this, arguments);
            errorCounts[name] = 0;
        } catch (e) {
            errorCounts[name] = (errorCounts[name] || 0) + 1;
            log("error," + name + "," + e.message);
            if (errorCounts[name] >= 5) {
                log("error-storm," + name);
                disarmed(name);
            }
        }
    };
}

function disconnectAll() {
    if (state.addedHandler) {
        try {
            workspace.windowAdded.disconnect(state.addedHandler);
        } catch (e) {
            // ignore
        }
    }
    if (state.removedHandler) {
        try {
            workspace.windowRemoved.disconnect(state.removedHandler);
        } catch (e) {
            // ignore
        }
    }
}

(function setup() {
    try {
        var desktops = workspace.desktops;
        var found = undefined;
        for (var i = 0; i < desktops.length; i++) {
            if (desktops[i].name === PROOF_DESKTOP_NAME) {
                if (found !== undefined) {
                    log("proof-desktop-missing");
                    return;
                }
                found = desktops[i];
            }
        }
        if (found === undefined) {
            log("proof-desktop-missing");
            return;
        }
        state.proofDesktop = found;
        state.proofDesktopId = found.id;
        state.managed = {};
        state.drag = {};
        state.errors = {};
        state.preselectArmed = false;

        var screens = workspace.screens;
        if (!screens || screens.length < 1) {
            log("error,setup,no-screens");
            return;
        }
        var root = workspace.rootTile(screens[0], found);
        if (!root) {
            log("error,setup,no-root");
            return;
        }
        state.root = root;

        state.sentinelActionId = SENTINEL_PREFIX + Math.random().toString(36).replace(/\./g, "").slice(2) + Math.random().toString(36).replace(/\./g, "").slice(2);
        var regOk = registerShortcut(state.sentinelActionId, SHORTCUT_TEXT, SENTINEL_SEQUENCE, guarded("shortcut", function () {
            state.preselectArmed = true;
            log("shortcut-invoked," + Date.now());
        }));
        if (regOk === false) {
            log("error,setup,register-shortcut-failed");
            return;
        }
        log("sentinel-ready," + state.sentinelActionId);

        state.addedHandler = guarded("windowAdded", onWindowAdded);
        state.removedHandler = guarded("windowRemoved", onWindowRemoved);
        workspace.windowAdded.connect(state.addedHandler);
        workspace.windowRemoved.connect(state.removedHandler);

        state.watchdog = new QTimer();
        state.watchdog.interval = WATCHDOG_MS;
        state.watchdog.singleShot = true;
        state.watchdog.timeout.connect(function () {
            state.armed = false;
            disconnectAll();
            log("watchdog-firing");
        });
        state.watchdog.start();

        state.armed = true;
        log("proof-ready");
        logTree();
    } catch (e) {
        log("error,setup," + e.message);
    }
})();
