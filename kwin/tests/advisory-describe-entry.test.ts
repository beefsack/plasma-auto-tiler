import assert from "node:assert/strict";
import { readFileSync as readFsFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    ADVISORY_DESCRIBE_GENERATION_RE,
    ADVISORY_DESCRIBE_INVALID_LOG,
    ADVISORY_DESCRIBE_MAX_REVISION,
    ADVISORY_DESCRIBE_NONCE_RE,
    ADVISORY_DESCRIBE_OWNER_RE,
    ADVISORY_DESCRIBE_READY_PREFIX,
    ADVISORY_DESCRIBE_RESULT_PREFIX,
    ADVISORY_DESCRIBE_RESULT_SCHEMA,
    validateDescribeInput,
} from "../src/advisory-describe-entry";

const ENTRY_SOURCE = readFsFileSync("src/advisory-describe-entry.ts", "utf8");

function validRecord(nonce: string): Record<string, unknown> {
    return {
        nonce,
        correlationId: nonce,
        owner: "adv-owner-1",
        generation: "adv-gen-1",
        revision: 3,
        snapshot: { outputs: [], windows: [] },
        intent: { direction: "down" },
        capabilities: { swap_neighbor: true },
    };
}

const TEST_NONCE = "0123456789abcdef0123456789abcdef";

describe("advisory describe entry wiring", () => {
    it("imports only the advisory query and snapshot modules", () => {
        const imports = ENTRY_SOURCE.split("\n").filter((line) => line.startsWith("import "));
        assert.equal(imports.length, 2);
        assert.ok(imports.some((line) => line.includes('from "./advisory-plan-query"')));
        assert.ok(imports.some((line) => line.includes('from "./advisory-snapshot"')));
        assert.ok(!ENTRY_SOURCE.includes('from "./entry'));
        assert.ok(!ENTRY_SOURCE.includes('from "./controller'));
        assert.ok(!ENTRY_SOURCE.includes('from "./tray'));
        assert.ok(!ENTRY_SOURCE.includes('from "./poc3'));
        assert.ok(!ENTRY_SOURCE.includes('from "./planner-shadow'));
        assert.ok(!ENTRY_SOURCE.includes("require("));
    });

    it("delegates exactly once through AdvisoryPlanQuery with KWin seams", () => {
        assert.ok(ENTRY_SOURCE.includes("new AdvisoryPlanQuery"));
        assert.ok(ENTRY_SOURCE.includes("ADVISORY_DESCRIBE_REQUEST_JSON"));
        assert.ok(ENTRY_SOURCE.includes("callDBus(service, path, dbusInterface, method, payload, callback)"));
        assert.ok(ENTRY_SOURCE.includes("new QTimer()"));
        assert.ok(ENTRY_SOURCE.includes("query.enableOnce()"));
        assert.ok(ENTRY_SOURCE.includes("query.runOnce()"));
        assert.ok(ENTRY_SOURCE.includes(ADVISORY_DESCRIBE_READY_PREFIX));
        assert.ok(ENTRY_SOURCE.includes(ADVISORY_DESCRIBE_RESULT_PREFIX));
        assert.ok(ENTRY_SOURCE.includes(ADVISORY_DESCRIBE_INVALID_LOG));
    });

    it("requires high-entropy invocation identity bound to correlation", () => {
        assert.ok(ADVISORY_DESCRIBE_NONCE_RE.test("0123456789abcdef0123456789abcdef"));
        assert.ok(!ADVISORY_DESCRIBE_NONCE_RE.test("short"));
        assert.ok(!ADVISORY_DESCRIBE_NONCE_RE.test("0123456789ABCDEF0123456789ABCDEF"));
        assert.ok(!ADVISORY_DESCRIBE_NONCE_RE.test("zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz"));
        assert.ok(ADVISORY_DESCRIBE_OWNER_RE.test("adv-owner-1"));
        assert.ok(ADVISORY_DESCRIBE_GENERATION_RE.test("adv-gen-1"));
        assert.equal(ADVISORY_DESCRIBE_MAX_REVISION, 1000000);
        const ok = validateDescribeInput(validRecord(TEST_NONCE));
        assert.equal(ok.ok, true);
        if (ok.ok) {
            assert.equal(ok.record.correlationId, TEST_NONCE);
            assert.equal(ok.record.nonce, TEST_NONCE);
        }
        assert.equal(validateDescribeInput(validRecord("short")).ok, false);
        assert.equal(
            validateDescribeInput({ ...validRecord(TEST_NONCE), correlationId: "other" }).ok,
            false,
        );
        assert.equal(validateDescribeInput({ ...validRecord(TEST_NONCE), revision: 1000001 }).ok, false);
        assert.equal(
            validateDescribeInput({ ...validRecord(TEST_NONCE), extra: 1 }).ok,
            false,
        );
    });

    it("keeps the entry free of production and native mutation routes", () => {
        for (const forbidden of [
            "plasma-auto-tiler-kwin",
            "TileController",
            "TrayPublisher",
            "registerShortcut",
            "from \"./controller",
            "from \"./entry",
            "from \"./tray",
            "from \"./poc3",
            "from \"./planner-shadow",
            "poc3-",
            "POC3",
            "planner-shadow",
            "activeWindow",
            "rootTile",
            "frameGeometry",
            "showOutline",
            "hideOutline",
            "currentDesktop",
            "windowList",
            "clientArea",
            "createDesktop",
            "removeDesktop",
            "closeWindow",
            "CustomTile",
            "EvaluateMove",
            "PublishSnapshot",
            "Scripting",
            "loadScript",
            "unloadScript",
            "isScriptLoaded",
            "setActiveWindow",
            "desktops",
            "screens",
            "setTimeout",
            "setInterval",
        ]) {
            assert.ok(!ENTRY_SOURCE.includes(forbidden), `advisory coupling: ${forbidden}`);
        }
        assert.ok(ENTRY_SOURCE.includes("captureAdvisorySnapshot(workspace"));
        const production = readFsFileSync("src/entry.ts", "utf8");
        assert.ok(!production.includes("advisory-describe"));
        assert.ok(!production.includes("AdvisoryPlanQuery"));
    });

    it("exposes the fixed diagnostic contract", () => {
        assert.equal(ADVISORY_DESCRIBE_READY_PREFIX, "plasma-auto-tiler:advisory-describe-ready");
        assert.equal(ADVISORY_DESCRIBE_RESULT_PREFIX, "plasma-auto-tiler:advisory-describe-result");
        assert.equal(ADVISORY_DESCRIBE_RESULT_SCHEMA, "v1");
        assert.equal(ADVISORY_DESCRIBE_INVALID_LOG, "plasma-auto-tiler:advisory-describe-invalid");
        assert.ok(ENTRY_SOURCE.includes("ADVISORY_DESCRIBE_RESULT_SCHEMA"));
        assert.ok(ENTRY_SOURCE.includes("${ADVISORY_DESCRIBE_RESULT_PREFIX}:${ADVISORY_DESCRIBE_RESULT_SCHEMA}:") || ENTRY_SOURCE.includes("RESULT_SCHEMA}:"));
    });

    it("rejects array records matching builder semantics", () => {
        assert.equal(validateDescribeInput([]).ok, false);
        assert.equal(validateDescribeInput({ ...validRecord(TEST_NONCE), snapshot: [] }).ok, false);
        assert.equal(validateDescribeInput({ ...validRecord(TEST_NONCE), intent: [] }).ok, false);
        assert.equal(validateDescribeInput({ ...validRecord(TEST_NONCE), capabilities: [] }).ok, false);
        assert.ok(ENTRY_SOURCE.includes("!Array.isArray(value)"));
    });

    it("fails before ready/query when injected source shas are malformed", () => {
        assert.ok(ENTRY_SOURCE.includes("readSourceBinding"));
        assert.ok(ENTRY_SOURCE.includes("/^[0-9a-f]{64}$/"));
        const bindingPos = ENTRY_SOURCE.indexOf("const binding = readSourceBinding()");
        const recordPos = ENTRY_SOURCE.indexOf("const checked = readInjectedRecord()");
        const queryPos = ENTRY_SOURCE.indexOf("query.enableOnce()");
        assert.ok(bindingPos >= 0 && recordPos > bindingPos && queryPos > bindingPos);
        assert.ok(ENTRY_SOURCE.includes("ADVISORY_DESCRIBE_SOURCE_PREFIX"));
    });
});
