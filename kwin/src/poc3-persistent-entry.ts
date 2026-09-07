// Project-owned persistent POC3 direct-enrollment entry (initial start only).
//
// Separately bundled IIFE built ONLY by
// scripts/poc3-build-persistent-adapter.mjs into
// dist/poc3-persistent-adapter.js (never into contents/code/main.js), loaded
// by hand in a nested instance for exactly one direct-enrollment start. Never
// part of production startup (src/entry.ts must not import it); never wires
// to production shortcuts, tiles, desktops, persistence, tray, KCM, the
// one-shot poc3-manual-command route, or the POC2 planner-shadow probe.
//
// Config is embedded at build time through POC3_PERSISTENT_CONFIG_JSON (a
// JSON string literal: owner/generation/nonce plus gap plus
// expected_revision 0 plus the private planner expectations, with usable
// always absent so the adapter derives it from the observed native output),
// plus POC3_PERSISTENT_EXPECTED_PIDS_JSON (the three exact manifest-recorded
// manual PIDs, never guessed IDs or captions),
// POC3_PERSISTENT_EXPECTED_CLIENTS_JSON (per-slot pid/tick/app_id/slot/color
// evidence in slot order; color is manifest/config evidence only), and
// POC3_PERSISTENT_PLANNER_JSON (private planner session-owner plus exact
// D-Bus unique-owner/bus/service expectations; every EvaluatePoc3 request is
// routed to that exact unique name with no well-known fallback). On run the entry validates all of them, discovers the exact three internal IDs
// itself, and delegates to one Poc3Adapter start. The bundle stays loaded;
// KWin print/log lines are debugging diagnostics only and never success
// authority (status is the captured D-Bus run reply plus the service-backed
// typed EvaluatePoc3 acknowledgement to the exact unique owner plus
// adapter-side post-observation). A corrupt
// config logs poc3-persistent-invalid with no identities and no transport.
// Only initial start exists here; focus/move/status/stop stay on the legacy
// one-shot route.

import { runPersistentStart } from "./poc3-persistent-adapter";

declare const POC3_PERSISTENT_CONFIG_JSON: string;
declare const POC3_PERSISTENT_EXPECTED_PIDS_JSON: string;
declare const POC3_PERSISTENT_EXPECTED_CLIENTS_JSON: string;
declare const POC3_PERSISTENT_PLANNER_JSON: string;

const INVALID_LOG = "plasma-auto-tiler:poc3-persistent-invalid";

const persistentTimers = new Set<QTimer>();

function schedulePersistentOnce(delayMs: number, callback: () => void): () => void {
    const timer = new QTimer();
    persistentTimers.add(timer);
    timer.interval = delayMs;
    timer.singleShot = true;
    timer.timeout.connect(() => {
        try {
            callback();
        } finally {
            persistentTimers.delete(timer);
        }
    });
    timer.start();
    return () => {
        try {
            timer.stop();
        } catch (error) {
            void error;
        } finally {
            persistentTimers.delete(timer);
        }
    };
}

function nowMs(): number {
    try {
        return Date.now();
    } catch (error) {
        void error;
        return 0;
    }
}

let embedded: unknown = null;
try {
    embedded = JSON.parse(POC3_PERSISTENT_CONFIG_JSON);
} catch (error) {
    void error;
    embedded = null;
}

let expectedPids: unknown = null;
try {
    expectedPids = JSON.parse(POC3_PERSISTENT_EXPECTED_PIDS_JSON);
} catch (error) {
    void error;
    expectedPids = null;
}

let expectedClients: unknown = null;
try {
    expectedClients = JSON.parse(POC3_PERSISTENT_EXPECTED_CLIENTS_JSON);
} catch (error) {
    void error;
    expectedClients = null;
}

let expectedPlanner: unknown = null;
try {
    expectedPlanner = JSON.parse(POC3_PERSISTENT_PLANNER_JSON);
} catch (error) {
    void error;
    expectedPlanner = null;
}

const adapter = runPersistentStart(
    {
        callDbus: (service, path, dbusInterface, method, payload, callback) => {
            callDBus(service, path, dbusInterface, method, payload, callback);
        },
        scheduleOnce: (delayMs, callback) => schedulePersistentOnce(delayMs, callback),
        log: (message) => console.log(message),
        now: () => nowMs(),
        workspace,
    },
    workspace,
    embedded,
    expectedPids,
    expectedClients,
    expectedPlanner,
);
if (adapter === null) {
    console.log(INVALID_LOG);
}
void adapter;
