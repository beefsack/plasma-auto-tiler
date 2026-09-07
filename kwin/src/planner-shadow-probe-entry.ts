// Manually-started project-owned KWin planner shadow probe entry.
//
// This bundle is built ONLY via the manual `build:planner-probe` script and
// loaded by hand for one-shot advisory probing. It is never part of the
// ordinary production entry startup (src/entry.ts must not import it) and
// never wires to production shortcuts or actions.
//
// On load it only installs the manual trigger
// `__plasmaAutoTilerRunPlannerShadowProbeOnce` and logs readiness. Each
// manual trigger reads the actual current KWin state (active window, active
// output/current workspace, root tile, bounded <=2 direct-leaf topology),
// allocates the next load-scoped session identity (per-load generation,
// internally monotonic revision/correlation), and fires exactly one
// PlannerShadowProbe one-shot. Failures log fixed redacted reasons only.
// An absent planner service never invokes the D-Bus callback, so it surfaces
// as a one-flight shadow-timeout; no owner-loss event exists on this seam.
// Uses its own independent QTimer bookkeeping; never shares tray timers.

import {
    createShadowSession,
    normalizeShadowRequest,
    PlannerShadowProbe,
    readShadowNativeSnapshot,
    type ShadowNormalizeInput,
} from "./planner-shadow";

const PROBE_READY_LOG = "plasma-auto-tiler:planner-shadow-probe-ready";
const PROBE_TRIGGER_HANDLE = "__plasmaAutoTilerRunPlannerShadowProbeOnce";

const session = createShadowSession();

const probeTimers = new Set<QTimer>();

function scheduleProbeOnce(delayMs: number, callback: () => void): () => void {
    const timer = new QTimer();
    probeTimers.add(timer);
    timer.interval = delayMs;
    timer.singleShot = true;
    timer.timeout.connect(() => {
        try {
            callback();
        } finally {
            probeTimers.delete(timer);
        }
    });
    timer.start();
    return () => {
        try {
            timer.stop();
        } catch (error) {
            void error;
        } finally {
            probeTimers.delete(timer);
        }
    };
}

function readFreshFor(
    correlationId: string,
    generation: string,
    revision: number,
): ShadowNormalizeInput | null {
    const live = readShadowNativeSnapshot(workspace);
    if (!live.ok) {
        return null;
    }
    return {
        leaves: live.snapshot.leaves,
        focusedTile: live.snapshot.focusedTile,
        focusedWindow: live.snapshot.focusedWindow,
        direction: live.snapshot.direction,
        correlationId,
        generation,
        revision,
        root: live.snapshot.root,
        output: live.snapshot.output,
        workspace: live.snapshot.workspace,
        desktop: live.snapshot.desktop,
    };
}

function runPlannerShadowProbeOnce(): void {
    const live = readShadowNativeSnapshot(workspace);
    if (!live.ok) {
        console.log(`plasma-auto-tiler:planner-shadow:reject:${live.reason}`);
        return;
    }
    const identity = session.nextIdentity();
    const normalized = normalizeShadowRequest({
        leaves: live.snapshot.leaves,
        focusedTile: live.snapshot.focusedTile,
        focusedWindow: live.snapshot.focusedWindow,
        direction: live.snapshot.direction,
        correlationId: identity.correlationId,
        generation: identity.generation,
        revision: identity.revision,
        root: live.snapshot.root,
        output: live.snapshot.output,
        workspace: live.snapshot.workspace,
        desktop: live.snapshot.desktop,
    });
    if (!normalized.ok) {
        console.log(`plasma-auto-tiler:planner-shadow:reject:${normalized.reason}`);
        return;
    }
    const bundle = normalized.bundle;
    const probe = new PlannerShadowProbe({
        callDbus: (service, path, dbusInterface, method, payload, callback) => {
            callDBus(service, path, dbusInterface, method, payload, callback);
        },
        scheduleOnce: (delayMs, callback) => scheduleProbeOnce(delayMs, callback),
        log: (message) => console.log(message),
        readFresh: () => readFreshFor(bundle.correlationId, bundle.generation, bundle.revision),
    });
    probe.enableOnce();
    probe.runOnce(bundle);
}

function resolveProbeScope(): Record<string, unknown> | null {
    try {
        if (typeof globalThis !== "undefined") {
            return globalThis as unknown as Record<string, unknown>;
        }
    } catch (error) {
        void error;
    }
    // KWin loadScript QJSEngine has `globalThis` undefined; top-level `this`
    // is the script global object. The indirect call survives the IIFE
    // bundle (direct top-level `this` compiles to module `exports`) and
    // returns that same script global.
    try {
        const fallback = Function("return this")() as unknown;
        if (typeof fallback === "object" && fallback !== null) {
            return fallback as Record<string, unknown>;
        }
    } catch (error) {
        void error;
    }
    return null;
}

let triggerInstalled = false;
try {
    const scope = resolveProbeScope();
    if (scope !== null) {
        scope[PROBE_TRIGGER_HANDLE] = runPlannerShadowProbeOnce;
        triggerInstalled = true;
    }
} catch (error) {
    void error;
}
console.log(triggerInstalled ? PROBE_READY_LOG : "plasma-auto-tiler:planner-shadow:trigger-unavailable");
void session;
