// Project-owned one-shot POC3 command entry (separately bundled IIFE).
//
// This bundle is built ONLY by the dedicated per-command build helper
// (scripts/poc3-build-command.mjs via scripts/poc3-command.sh) into dist
// (never into contents/code/main.js) and loaded by hand for exactly one
// command. It is never part of the ordinary production entry startup
// (src/entry.ts must not import it) and never wires to production shortcuts,
// actions, tiles, desktops, outputs, persistence, tray, or KCM state.
//
// A validated command config is embedded at build time through the
// `POC3_COMMAND_CONFIG_JSON` esbuild define (a JSON string literal produced
// by the helper with JSON.stringify, never shell-evaluated or hand-written).
// On run the entry validates the embedded config strictly, executes exactly
// one command (start | focus <direction> | move <direction> | status | stop)
// through Poc3Adapter.runCommand, and reports a bounded
// `poc3-command-done:<nonce>:<token>` diagnostic at the terminal outcome so
// the lifecycle tool can unload the exact script id. The nonce is a
// caller-supplied bounded token; window identities never appear in logs.
//
// Per-command guarantees (inherited from the adapter, recorded here):
// - Exactly three explicitly supplied `String(Window.internalId)` identities
//   for start/focus/move/stop, re-resolved from scratch with strict equality,
//   eligibility, and same-output/same-workspace scope before use.
// - The manually supplied bounded session token (owner/generation) plus the
//   expected revision bind the engine session; stale revisions reject.
// - `start` carries the literal `close-disposable` cleanup model only; the
//   route is closure-only and omits restore (no envelopes survive across
//   separately loaded bundles, so restore is unavailable by construction).
// - Actuation converges by bounded observation only, never by an atomic or
//   Wayland configure claim; closure is observed until all three leave the
//   window list, with residue reported as failure, never success.
// - Zero KWin signal subscriptions; single-flight; no retry/queue; no
//   generic command execution (fixed command set, fixed fields, unknown
//   fields denied); no source-text evaluation.
//
// A corrupt embedded config fails closed with `poc3-command-invalid` and no
// transport. The lifecycle tool treats a missing done diagnostic as a
// bounded-timeout failure and still unloads the exact script id.

import { Poc3Adapter, parseCommandConfig } from "./poc3-adapter";

declare const POC3_COMMAND_CONFIG_JSON: string;

const COMMAND_INVALID_LOG = "plasma-auto-tiler:poc3-command-invalid";

const commandTimers = new Set<QTimer>();

function scheduleCommandOnce(delayMs: number, callback: () => void): () => void {
    const timer = new QTimer();
    commandTimers.add(timer);
    timer.interval = delayMs;
    timer.singleShot = true;
    timer.timeout.connect(() => {
        try {
            callback();
        } finally {
            commandTimers.delete(timer);
        }
    });
    timer.start();
    return () => {
        try {
            timer.stop();
        } catch (error) {
            void error;
        } finally {
            commandTimers.delete(timer);
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
    embedded = JSON.parse(POC3_COMMAND_CONFIG_JSON);
} catch (error) {
    void error;
    embedded = null;
}

const adapter = new Poc3Adapter({
    callDbus: (service, path, dbusInterface, method, payload, callback) => {
        callDBus(service, path, dbusInterface, method, payload, callback);
    },
    scheduleOnce: (delayMs, callback) => scheduleCommandOnce(delayMs, callback),
    log: (message) => console.log(message),
    now: () => nowMs(),
    workspace,
});

if (parseCommandConfig(embedded) === null) {
    console.log(COMMAND_INVALID_LOG);
} else {
    adapter.runCommand(embedded);
}
void adapter;
