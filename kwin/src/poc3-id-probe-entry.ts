// Project-owned read-only nested POC3 ID/eligibility probe entry.
//
// Separately bundled IIFE built ONLY by scripts/poc3-build-id-probe.mjs into
// dist/poc3-id-probe.js (never into contents/code/main.js), loaded by hand in
// a nested instance for exactly one read-only discovery. Never part of
// production startup (src/entry.ts must not import it); never wires to
// production shortcuts, tiles, desktops, persistence, tray, KCM, the POC3
// command adapter, or the POC2 planner-shadow probe.
//
// Config is embedded at build time through POC3_ID_PROBE_CONFIG_JSON (a JSON
// string literal, never shell-evaluated). On run the entry validates the
// config, runs the read-only evaluateIdProbe against the live workspace, and
// logs exactly one private-log line:
//   success: poc3-id-probe-done:<nonce>:{"ids":[...],"owner":...,
//            "generation":...,"expected_revision":0,"nonce":...}
//   failure: poc3-id-probe-done:<nonce>:{"error":"<reason>"}
// A corrupt config logs poc3-id-probe-invalid with no identities. The
// lifecycle tool waits for the done marker in the manifest private log only
// (never the host journal) and unloads the exact script id in cleanup later.

import { evaluateIdProbe } from "./poc3-id-probe";

declare const POC3_ID_PROBE_CONFIG_JSON: string;
declare const POC3_ID_PROBE_EXPECTED_PIDS_JSON: string;

const INVALID_LOG = "plasma-auto-tiler:poc3-id-probe-invalid";

let embedded: unknown = null;
try {
    embedded = JSON.parse(POC3_ID_PROBE_CONFIG_JSON);
} catch (error) {
    void error;
    embedded = null;
}

let expectedPids: unknown = null;
try {
    expectedPids = JSON.parse(POC3_ID_PROBE_EXPECTED_PIDS_JSON);
} catch (error) {
    void error;
    expectedPids = null;
}

const result = evaluateIdProbe(workspace, embedded, expectedPids);
if (result.ok) {
    let payload = "";
    try {
        payload = JSON.stringify({
            ids: [...result.ids],
            owner: result.owner,
            generation: result.generation,
            expected_revision: result.expectedRevision,
            nonce: result.nonce,
        });
    } catch (error) {
        void error;
        payload = '{"error":"poc3-id-probe-encode"}';
    }
    console.log(`plasma-auto-tiler:poc3-id-probe-done:${result.nonce}:${payload}`);
} else if (result.reason === "poc3-id-probe-invalid") {
    console.log(INVALID_LOG);
} else {
    let nonce = "unknown";
    try {
        const candidate = (embedded as Record<string, unknown> | null) ?? null;
        const raw = candidate === null ? undefined : candidate["nonce"];
        if (typeof raw === "string" && raw.length > 0 && raw.length <= 64) {
            nonce = raw;
        }
    } catch (error) {
        void error;
        nonce = "unknown";
    }
    console.log(`plasma-auto-tiler:poc3-id-probe-done:${nonce}:${JSON.stringify({ error: result.reason })}`);
}
