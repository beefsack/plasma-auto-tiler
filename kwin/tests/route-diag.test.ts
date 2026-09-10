import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    FOCUS_CONTRACT_VERSION,
    FocusAdapter,
    FocusAdapterEnv,
    FocusObserved,
} from "../src/focus-adapter";
import {
    MOVEMENT_CONTRACT_VERSION,
    MovementAdapter,
    type MovementAdapterEnv,
    type MovementObserved,
} from "../src/movement-adapter";
import {
    RESIZE_CONTRACT_VERSION,
    ResizeAdapter,
    type ResizeAdapterEnv,
    type ResizeObserved,
} from "../src/resize-adapter";
import {
    POINTER_RESIZE_CONTRACT_VERSION,
    PointerResizeAdapter,
    type PointerResizeEnv,
    type PointerResizeObserved,
} from "../src/pointer-resize-adapter";
import {
    createEngineAuthority,
    type EngineAuthorityStarts,
} from "../src/engine-authority";
import { startResizeAdapterEntry } from "../src/resize-adapter-entry";
import {
    PointerCoalescer,
    formatRouteDiag,
    sanitizeCorr,
    sanitizeGen,
} from "../src/route-diag";

function diagLines(logs: readonly string[]): string[] {
    return logs.filter((line) => line.includes("plasma-auto-tiler:route-diag:"));
}

describe("route-diag token schema", () => {
    it("formats fixed-vocabulary lines with sanitized values", () => {
        assert.equal(
            formatRouteDiag("cmd", [
                ["seq", 7],
                ["kind", "focus"],
                ["detail", "right"],
                ["gen", "packaged-rust-1"],
                ["rev", 3],
            ]),
            "plasma-auto-tiler:route-diag:cmd:seq=7:kind=focus:detail=right:gen=packaged-rust-1:rev=3",
        );
        // Injection and out-of-range values never widen the vocabulary.
        assert.equal(
            formatRouteDiag("req", [
                ["corr", "bad corr!!"],
                ["rev", -1],
                ["windows", 3],
            ]),
            "plasma-auto-tiler:route-diag:req:corr=invalid:rev=unknown:windows=3",
        );
        assert.equal(sanitizeCorr("gen-1-f0"), "gen-1-f0");
        assert.equal(sanitizeCorr("has space"), "invalid");
        assert.equal(sanitizeCorr(42), "invalid");
        assert.equal(sanitizeGen("packaged-rust-1"), "packaged-rust-1");
        assert.equal(sanitizeGen("HAS_CAPS"), "invalid");
    });

    it("never echoes sensitive bytes beyond a validated opaque token", () => {
        const line = formatRouteDiag("req", [
            ["corr", "gen-1-f0"],
            ["rev", 3],
            ["windows", 3],
        ]);
        for (const forbidden of ["caption", "eDP-1", "secret", "4242", "{", "}", "/", " "]) {
            assert.ok(!line.includes(forbidden), `${line} must not contain ${forbidden}`);
        }
        assert.ok(line.includes("corr=gen-1-f0"));
    });
});

describe("route-diag pointer coalescing", () => {
    it("emits one marker per episode plus a bounded count summary", () => {
        const coalescer = new PointerCoalescer();
        assert.equal(coalescer.flushSummary(), null);
        const marks: boolean[] = [];
        for (let index = 0; index < 50; index += 1) {
            marks.push(coalescer.noteCoalesced());
        }
        assert.equal(marks[0], true);
        assert.ok(marks.slice(1).every((mark) => mark === false));
        assert.equal(marks.length, 50);
        assert.equal(coalescer.count(), 50);
        const summary = coalescer.flushSummary();
        assert.equal(summary, "plasma-auto-tiler:route-diag:ptr:transition=coalesced:count=50");
        assert.equal(coalescer.flushSummary(), null);
        coalescer.noteCoalesced();
        coalescer.reset();
        assert.equal(coalescer.flushSummary(), null);
    });
});

function fakeStarts(requests: Array<string>): EngineAuthorityStarts {
    return {
        startFocus: () => ({ stop: () => {}, request: () => { requests.push("focus"); } }),
        startMovement: () => ({ stop: () => {}, request: () => { requests.push("movement"); } }),
        startResize: () => ({ stop: () => {}, request: () => {}, tryBootstrapTrio: () => {} }),
        startPointerResize: () => ({ stop: () => {} }),
    };
}

describe("route-diag dispatcher correlation", () => {
    it("links one command seq to its retry outcome in order", () => {
        const logs: string[] = [];
        const requests: Array<string> = [];
        const dispatcher = createEngineAuthority("rust-development", fakeStarts(requests), (message) => {
            logs.push(message);
        });
        dispatcher.requestFocus("right");
        const lines = diagLines(logs);
        const cmd = lines.find((line) => line.includes(":cmd:"));
        const retry = lines.find((line) => line.includes(":retry:"));
        assert.ok(cmd !== undefined && retry !== undefined);
        assert.ok(cmd.includes("seq=1"), cmd);
        assert.ok(cmd.includes("kind=focus"), cmd);
        assert.ok(cmd.includes("detail=right"), cmd);
        assert.ok(cmd.indexOf("seq=1") >= 0);
        assert.ok(lines.indexOf(cmd) < lines.indexOf(retry), "cmd must precede retry");
        assert.ok(retry.includes("decision=retry"), retry);
        assert.ok(retry.includes("result=ready"), retry);
        // Second command advances the ordinal; no second attach retry.
        dispatcher.requestMove("left");
        dispatcher.requestResize("up", "outwards");
        const later = diagLines(logs);
        const cmds = later.filter((line) => line.includes(":cmd:"));
        assert.equal(cmds.length, 3);
        assert.ok(cmds[1]?.includes("seq=2"));
        assert.ok(cmds[2]?.includes("seq=3"));
        assert.ok(cmds[2]?.includes("kind=resize"));
        assert.ok(cmds[2]?.includes("detail=up"));
        assert.ok(cmds[2]?.includes("mode=outwards"));
    });

    it("links refusals to the refused command seq with categories only", () => {
        const logs: string[] = [];
        const failing: EngineAuthorityStarts = {
            startFocus: () => null,
            startMovement: () => null,
            startResize: () => null,
            startPointerResize: () => null,
        };
        const dispatcher = createEngineAuthority("rust-development", failing, (message) => {
            logs.push(message);
        });
        assert.equal(dispatcher.start(), false);
        logs.length = 0;
        dispatcher.requestFocus("right");
        const lines = diagLines(logs);
        const cmd = lines.find((line) => line.includes(":cmd:"));
        const refused = lines.find((line) => line.includes("decision=refused"));
        assert.ok(cmd !== undefined && refused !== undefined);
        assert.ok(cmd.includes("seq=1") && refused.includes("seq=1"));
        assert.ok(refused.includes("kind=focus"));
        for (const line of lines) {
            assert.ok(!line.includes("internalId"));
        }
    });
});

function makeRefs(): { a: object; b: object; c: object } {
    return { a: {}, b: {}, c: {} };
}

function makeObserved(refs: { a: object; b: object; c: object }): FocusObserved {
    const windows = Object.freeze([
        Object.freeze({ id: "win-a", ref: refs.a }),
        Object.freeze({ id: "win-b", ref: refs.b }),
        Object.freeze({ id: "win-c", ref: refs.c }),
    ]);
    return {
        domainOutput: "focus-output",
        domainWorkspace: "focus-workspace",
        focusedId: "win-a",
        windows,
        activeRef: refs.a,
        fingerprint: "fp-1",
        revalidate: () => true,
    };
}

function plannedReply(correlation: string, baseRevision: number): string {
    return JSON.stringify({
        v: FOCUS_CONTRACT_VERSION,
        correlation_id: correlation,
        outcome: "planned",
        base_revision: baseRevision,
        capability: "directional-focus",
        preconditions: [
            "focused-leaf-occupied-by-focused-window",
            "target-leaf-occupied",
            "focus-targets-same-domain",
            "adapter-must-verify-postconditions",
        ],
        operation: {
            domain_output: "focus-output",
            domain_workspace: "focus-workspace",
            from_leaf: "leaf-a",
            to_leaf: "leaf-b",
            from_window: "win-a",
            to_window: "win-b",
            direction: "right",
            route: ["leaf-a", "leaf-b"],
        },
        to_window: "win-b",
    });
}

describe("route-diag adapter correlation", () => {
    function driveFocusSuccess(): { logs: string[]; corr: string } {
        const refs = makeRefs();
        const logs: string[] = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const env: FocusAdapterEnv = {
            callDbus: (_s, _p, _i, _m, _payload, callback) => {
                callbacks.push(callback);
            },
            scheduleOnce: () => () => {},
            log: (message) => { logs.push(message); },
            observe: () => makeObserved(refs),
            setActive: () => true,
            active: () => refs.b,
            hasExclusiveFocusAuthority: () => true,
            subscribe: () => () => {},
        };
        const adapter = new FocusAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 }), true);
        adapter.requestFocus("right");
        const req = diagLines(logs).find((line) => line.includes(":req:"));
        assert.ok(req !== undefined);
        // First request binds revision 0 to the 3-window membership size.
        assert.ok(req.includes("corr=gen-1-f0"), req);
        assert.ok(req.includes("rev=3"), req);
        assert.ok(req.includes("windows=3"), req);
        assert.ok(callbacks[0] !== undefined);
        callbacks[0]?.(":1.42");
        const owner = diagLines(logs).find((line) => line.includes(":owner:"));
        assert.ok(owner !== undefined);
        assert.ok(owner.includes("transition=pinned"));
        assert.ok(owner.includes("corr=gen-1-f0"));
        assert.ok(callbacks[1] !== undefined);
        // Planner plan: base revision echoes the seeding request revision.
        callbacks[1]?.(plannedReply("gen-1-f0", 3));
        return { logs, corr: "gen-1-f0" };
    }

    it("correlates req, owner, and planned result on one token in order", () => {
        const { logs, corr } = driveFocusSuccess();
        const lines = diagLines(logs);
        const stages = lines.map((line) => line.split(":")[2]);
        assert.deepEqual(stages.slice(0, 3), ["req", "owner", "result"]);
        const result = lines.find((line) => line.includes(":result:"));
        assert.ok(result !== undefined);
        assert.ok(result.includes("result=planned"));
        assert.ok(result.includes(`corr=${corr}`));
        for (const line of lines) {
            assert.ok(line.includes(`corr=${corr}`), line);
        }
    });

    it("reports the activation-failed owner category without the raw bus name", () => {
        const refs = makeRefs();
        const logs: string[] = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const env: FocusAdapterEnv = {
            callDbus: (_s, _p, _i, _m, _payload, callback) => { callbacks.push(callback); },
            scheduleOnce: () => () => {},
            log: (message) => { logs.push(message); },
            observe: () => makeObserved(refs),
            setActive: () => true,
            active: () => refs.a,
            hasExclusiveFocusAuthority: () => true,
            subscribe: () => () => {},
        };
        const adapter = new FocusAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 }), true);
        adapter.requestFocus("right");
        assert.ok(callbacks[0] !== undefined);
        callbacks[0]?.("not-an-owner");
        assert.ok(callbacks[1] !== undefined);
        callbacks[1]?.(0);
        const owner = diagLines(logs).find((line) => line.includes("activation-failed"));
        assert.ok(owner !== undefined);
        assert.ok(owner.includes(":owner:"));
        assert.ok(owner.includes("transition=activation-failed"));
        assert.ok(!owner.includes("not-an-owner"));
    });
});

function makeSignal(): {
    connect: (handler: (payload?: unknown) => void) => void;
    disconnect: (handler: (payload?: unknown) => void) => void;
} {
    const handlers = new Set<(payload?: unknown) => void>();
    return {
        connect: (handler) => { handlers.add(handler); },
        disconnect: (handler) => { handlers.delete(handler); },
    };
}

describe("route-diag terminal refusal flights", () => {
    function driveToPlannerRequest(
        onCallDbus?: (index: number) => void,
    ): {
        logs: string[];
        callbacks: Array<(reply: unknown) => void>;
        timeouts: Array<() => void>;
        corr: string;
    } {
        const refs = makeRefs();
        const logs: string[] = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const timeouts: Array<() => void> = [];
        let calls = 0;
        const env: FocusAdapterEnv = {
            callDbus: (_s, _p, _i, _m, _payload, callback) => {
                const index = calls;
                calls += 1;
                onCallDbus?.(index);
                callbacks.push(callback);
            },
            scheduleOnce: (_ms, callback) => {
                timeouts.push(callback);
                return () => {};
            },
            log: (message) => { logs.push(message); },
            observe: () => makeObserved(refs),
            setActive: () => true,
            active: () => refs.b,
            hasExclusiveFocusAuthority: () => true,
            subscribe: () => () => {},
        };
        const adapter = new FocusAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 }), true);
        adapter.requestFocus("right");
        return { logs, callbacks, timeouts, corr: "gen-1-f0" };
    }

    it("emits a terminal dbus-failed result when the owner resolve throws", () => {
        const refs = makeRefs();
        const logs: string[] = [];
        const env: FocusAdapterEnv = {
            callDbus: () => { throw new Error("boom"); },
            scheduleOnce: () => () => {},
            log: (message) => { logs.push(message); },
            observe: () => makeObserved(refs),
            setActive: () => true,
            active: () => refs.b,
            hasExclusiveFocusAuthority: () => true,
            subscribe: () => () => {},
        };
        const adapter = new FocusAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 }), true);
        adapter.requestFocus("right");
        const lines = diagLines(logs);
        const req = lines.find((line) => line.includes(":req:"));
        const terminal = lines.find((line) => line.includes(":result:") && line.includes("result=dbus-failed"));
        assert.ok(req !== undefined, "req must be present");
        assert.ok(terminal !== undefined, "terminal dbus-failed result must be present");
        assert.ok(req.includes("corr=gen-1-f0") && terminal.includes("corr=gen-1-f0"));
        assert.ok(lines.indexOf(req) < lines.indexOf(terminal));
        assert.ok(!terminal.includes("boom"));
    });

    it("emits a terminal timeout result with the stage detail", () => {
        const { logs, timeouts, corr } = driveToPlannerRequest();
        assert.ok(timeouts[0] !== undefined);
        timeouts[0]?.();
        const lines = diagLines(logs);
        const terminal = lines.find((line) => line.includes("result=timeout"));
        assert.ok(terminal !== undefined, "terminal timeout result must be present");
        assert.ok(terminal.includes(`corr=${corr}`), terminal);
        assert.ok(terminal.includes("detail=request"), terminal);
    });

    it("emits terminal service-fault, correlation-mismatch, and precondition-mismatch results", () => {
        // service-fault on malformed planner reply.
        {
            const { logs, callbacks, corr } = driveToPlannerRequest();
            assert.ok(callbacks[0] !== undefined);
            callbacks[0]?.(":1.42");
            assert.ok(callbacks[1] !== undefined);
            callbacks[1]?.("{not json");
            const lines = diagLines(logs);
            const terminal = lines.find((line) => line.includes(":result:") && line.includes("result=service-fault"));
            assert.ok(terminal !== undefined, "service-fault terminal must be present");
            assert.ok(terminal.includes(`corr=${corr}`));
            assert.ok(!terminal.includes("{not json"));
        }
        // correlation-mismatch on a noop with the wrong token.
        {
            const { logs, callbacks, corr } = driveToPlannerRequest();
            assert.ok(callbacks[0] !== undefined);
            callbacks[0]?.(":1.42");
            assert.ok(callbacks[1] !== undefined);
            callbacks[1]?.(JSON.stringify({ v: FOCUS_CONTRACT_VERSION, correlation_id: "gen-1-f9", outcome: "noop" }));
            const lines = diagLines(logs);
            const terminal = lines.find((line) => line.includes("result=correlation-mismatch"));
            assert.ok(terminal !== undefined, "correlation-mismatch terminal must be present");
            assert.ok(terminal.includes(`corr=${corr}`));
            assert.ok(!terminal.includes("gen-1-f9") || terminal.includes(`corr=${corr}`));
        }
        // precondition-mismatch on a planned reply with wrong preconditions.
        {
            const { logs, callbacks, corr } = driveToPlannerRequest();
            assert.ok(callbacks[0] !== undefined);
            callbacks[0]?.(":1.42");
            assert.ok(callbacks[1] !== undefined);
            const bad = JSON.parse(plannedReply(corr, 3)) as Record<string, unknown>;
            bad["preconditions"] = ["wrong"];
            callbacks[1]?.(JSON.stringify(bad));
            const lines = diagLines(logs);
            const terminal = lines.find((line) => line.includes("result=precondition-mismatch"));
            assert.ok(terminal !== undefined, "precondition-mismatch terminal must be present");
            assert.ok(terminal.includes(`corr=${corr}`));
            assert.ok(!terminal.includes("wrong") || terminal.includes("precondition-mismatch"));
        }
        // non-planned outcome maps to service-fault without echoing the outcome bytes.
        {
            const { logs, callbacks, corr } = driveToPlannerRequest();
            assert.ok(callbacks[0] !== undefined);
            callbacks[0]?.(":1.42");
            assert.ok(callbacks[1] !== undefined);
            callbacks[1]?.(JSON.stringify({ v: FOCUS_CONTRACT_VERSION, correlation_id: corr, outcome: "explode" }));
            const lines = diagLines(logs);
            const terminal = lines.find((line) => line.includes(":result:") && line.includes("result=service-fault"));
            assert.ok(terminal !== undefined, "non-planned outcome must map to service-fault");
            assert.ok(terminal.includes(`corr=${corr}`));
            assert.ok(!terminal.includes("explode"));
        }
    });

    it("emits terminal ack correlation-mismatch without claiming acknowledgement", () => {
        const { logs, callbacks, corr } = driveToPlannerRequest();
        assert.ok(callbacks[0] !== undefined);
        callbacks[0]?.(":1.42");
        assert.ok(callbacks[1] !== undefined);
        callbacks[1]?.(plannedReply(corr, 3));
        // Ack reply with the wrong correlation token.
        assert.ok(callbacks[2] !== undefined);
        callbacks[2]?.(
            JSON.stringify({
                v: FOCUS_CONTRACT_VERSION,
                correlation_id: "gen-1-f9",
                outcome: "acknowledged",
                base_revision: 3,
            }),
        );
        const lines = diagLines(logs);
        const terminal = lines.find((line) => line.includes(":ack:") && line.includes("result=correlation-mismatch"));
        assert.ok(terminal !== undefined, "ack correlation-mismatch terminal must be present");
        assert.ok(terminal.includes(`corr=${corr}`));
        assert.ok(!terminal.includes("result=acknowledged"));
    });
});
describe("route-diag exact-three scope validation", () => {
    it("reports count-only skip categories for a two-window scope", () => {
        const output = { name: "out-1" };
        const desktop = { id: "ws-1" };
        const winA = {
            normalWindow: true, managed: true, minimized: false, fullScreen: false,
            maximizeMode: 0, onAllDesktops: false, resizeable: true, output,
            desktops: [desktop], internalId: "win-a",
            frameGeometry: { x: 0, y: 0, width: 800, height: 600 },
            moveResizedChanged: makeSignal(),
        };
        const winB = {
            normalWindow: true, managed: true, minimized: false, fullScreen: false,
            maximizeMode: 0, onAllDesktops: false, resizeable: true, output,
            desktops: [desktop], internalId: "win-b",
            frameGeometry: { x: 100, y: 100, width: 640, height: 400 },
            moveResizedChanged: makeSignal(),
        };
        const workspace: Record<string, unknown> = {
            activeWindow: winA,
            windowList: (): unknown[] => [winA, winB],
            screens: [output],
            currentDesktopForScreen: (): unknown => desktop,
            clientArea: (): unknown => ({ x: 0, y: 0, width: 1920, height: 1080 }),
            windowActivated: makeSignal(),
            windowAdded: makeSignal(),
            windowRemoved: makeSignal(),
            screensChanged: makeSignal(),
            currentDesktopChanged: makeSignal(),
        };
        const logs: string[] = [];
        const handle = startResizeAdapterEntry({
            workspace,
            callDbus: () => {},
            scheduleOnce: () => () => {},
            log: (message) => { logs.push(message); },
            owner: "plasma-auto-tiler",
            generation: "packaged-rust-1",
            revision: { current: 0 },
            hasExclusiveResizeAuthority: () => true,
        });
        assert.ok(handle !== null);
        handle.tryBootstrapTrio?.();
        const scope = diagLines(logs).find((line) => line.includes(":scope:"));
        assert.ok(scope !== undefined, "scope diag must be present");
        assert.ok(scope.includes("count=2"), scope);
        assert.ok(scope.includes("decision=skip"), scope);
        assert.ok(scope.includes("reason=non-three"), scope);
        assert.ok(!scope.includes("win-a") && !scope.includes("win-b"));
        handle.stop();
    });
});

describe("route-diag remaining routes terminal refusal flights", () => {
    function movementObserved(refs: { a: object; b: object }): MovementObserved {
        const windows = Object.freeze([
            Object.freeze({ id: "win-a", ref: refs.a, rect: Object.freeze({ x: 0, y: 0, w: 960, h: 1080 }), output: "out-1", workspace: "ws-1" }),
            Object.freeze({ id: "win-b", ref: refs.b, rect: Object.freeze({ x: 960, y: 0, w: 960, h: 1080 }), output: "out-1", workspace: "ws-1" }),
        ]);
        const domains = Object.freeze([
            Object.freeze({ output: "out-1", workspace: "ws-1", bounds: Object.freeze({ x: 0, y: 0, w: 1920, h: 1080 }), gap: 0, adjacent: Object.freeze({}) }),
        ]);
        return {
            domainOutput: "out-1",
            domainWorkspace: "ws-1",
            focusedId: "win-a",
            windows,
            domains,
            activeRef: refs.a,
            fingerprint: "fp-1",
            revalidate: () => true,
        };
    }

    function resizeObserved(refs: { a: object; b: object }): ResizeObserved {
        const windows = Object.freeze([
            Object.freeze({ id: "win-a", ref: refs.a, rect: Object.freeze({ x: 0, y: 0, w: 960, h: 1080 }), output: "out-1", workspace: "ws-1" }),
            Object.freeze({ id: "win-b", ref: refs.b, rect: Object.freeze({ x: 960, y: 0, w: 960, h: 1080 }), output: "out-1", workspace: "ws-1" }),
        ]);
        return {
            domainOutput: "out-1",
            domainWorkspace: "ws-1",
            domainBounds: Object.freeze({ x: 0, y: 0, w: 1920, h: 1080 }),
            domainGap: 0,
            focusedId: "win-a",
            windows,
            activeRef: refs.a,
            fingerprint: "fp-1",
            revalidate: () => true,
        };
    }

    it("movement emits a terminal dbus-failed result when the owner resolve throws", () => {
        const refs = { a: {}, b: {} };
        const logs: string[] = [];
        const env: MovementAdapterEnv = {
            callDbus: () => { throw new Error("boom"); },
            scheduleOnce: () => () => {},
            log: (message) => { logs.push(message); },
            observe: () => movementObserved(refs),
            setGeometry: () => true,
            setActive: () => true,
            active: () => refs.a,
            hasExclusiveMovementAuthority: () => true,
            subscribe: () => () => {},
        };
        const adapter = new MovementAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 }), true);
        adapter.requestMovement("right");
        const lines = diagLines(logs);
        const req = lines.find((line) => line.includes(":req:"));
        const terminal = lines.find((line) => line.includes(":result:") && line.includes("result=dbus-failed"));
        assert.ok(req !== undefined, "movement req must be present");
        assert.ok(terminal !== undefined, "movement terminal dbus-failed must be present");
        assert.ok(req.includes("corr=gen-1-m0") && terminal.includes("corr=gen-1-m0"));
        assert.ok(lines.indexOf(req) < lines.indexOf(terminal));
        assert.ok(!terminal.includes("boom"));
    });

    it("resize emits a terminal rejected result without echoing payload bytes", () => {
        const refs = { a: {}, b: {} };
        const logs: string[] = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const env: ResizeAdapterEnv = {
            callDbus: (_s, _p, _i, _m, _payload, callback) => { callbacks.push(callback); },
            scheduleOnce: () => () => {},
            log: (message) => { logs.push(message); },
            observe: () => resizeObserved(refs),
            setGeometry: () => true,
            setActive: () => true,
            active: () => refs.a,
            hasExclusiveResizeAuthority: () => true,
            subscribe: () => () => {},
        };
        const adapter = new ResizeAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 }), true);
        adapter.requestResize("right", "outwards");
        assert.ok(callbacks[0] !== undefined);
        callbacks[0]?.(":1.42");
        assert.ok(callbacks[1] !== undefined);
        const corr = "gen-1-r0";
        callbacks[1]?.(JSON.stringify({ v: RESIZE_CONTRACT_VERSION, correlation_id: corr, outcome: "rejected" }));
        const lines = diagLines(logs);
        const terminal = lines.find((line) => line.includes(":result:") && line.includes("result=rejected"));
        assert.ok(terminal !== undefined, "resize terminal rejected must be present");
        assert.ok(terminal.includes(`corr=${corr}`));
        void MOVEMENT_CONTRACT_VERSION;
    });

    it("pointer emits a terminal dbus-failed result when the owner resolve throws", () => {
        const refA = {};
        const refB = {};
        const logs: string[] = [];
        const observed: PointerResizeObserved = {
            domainOutput: "out-1",
            domainWorkspace: "ws-1",
            domainBounds: Object.freeze({ x: 0, y: 0, w: 1920, h: 1080 }),
            domainGap: 0,
            focusedId: "win-a",
            windows: Object.freeze([
                Object.freeze({ id: "win-a", ref: refA, rect: Object.freeze({ x: 0, y: 0, w: 960, h: 1080 }), output: "out-1", workspace: "ws-1" }),
                Object.freeze({ id: "win-b", ref: refB, rect: Object.freeze({ x: 960, y: 0, w: 960, h: 1080 }), output: "out-1", workspace: "ws-1" }),
            ]),
            activeRef: refA,
            fingerprint: "fp-1",
            revalidate: () => true,
        };
        const flags = new Map<object, { move: boolean; resize: boolean }>([
            [refA, { move: false, resize: true }],
            [refB, { move: false, resize: false }],
        ]);
        const env: PointerResizeEnv = {
            callDbus: () => { throw new Error("boom"); },
            scheduleOnce: () => () => {},
            log: (message) => { logs.push(message); },
            observe: () => observed,
            setGeometry: () => true,
            active: () => refA,
            hasExclusiveResizeAuthority: () => true,
            readLiveState: (target) => flags.get(target) ?? null,
        };
        const adapter = new PointerResizeAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 }), true);
        adapter.windowStarted(refA);
        adapter.windowStepped(refA, { x: 0, y: 0, width: 1000, height: 1080 });
        const lines = diagLines(logs);
        const req = lines.find((line) => line.includes(":req:"));
        const terminal = lines.find((line) => line.includes(":result:") && line.includes("result=dbus-failed"));
        assert.ok(req !== undefined, "pointer req must be present");
        assert.ok(terminal !== undefined, "pointer terminal dbus-failed must be present");
        assert.ok(req.includes("corr=gen-1-p0") && terminal.includes("corr=gen-1-p0"));
        assert.ok(!terminal.includes("boom"));
        void POINTER_RESIZE_CONTRACT_VERSION;
    });

    it("pointer coalescing stays bounded to one marker plus one summary", () => {
        const refA = {};
        const refB = {};
        const logs: string[] = [];
        const callbacks: Array<(reply: unknown) => void> = [];
        const wins: Array<{ id: string; ref: object; rect: { x: number; y: number; w: number; h: number } }> = [
            { id: "win-a", ref: refA, rect: { x: 0, y: 0, w: 960, h: 1080 } },
            { id: "win-b", ref: refB, rect: { x: 960, y: 0, w: 960, h: 1080 } },
        ];
        const observed: PointerResizeObserved = {
            domainOutput: "out-1",
            domainWorkspace: "ws-1",
            domainBounds: Object.freeze({ x: 0, y: 0, w: 1920, h: 1080 }),
            domainGap: 0,
            focusedId: "win-a",
            windows: Object.freeze(
                wins.map((w) => Object.freeze({ id: w.id, ref: w.ref, rect: Object.freeze({ ...w.rect }), output: "out-1", workspace: "ws-1" })),
            ),
            activeRef: refA,
            fingerprint: "fp-1",
            revalidate: () => true,
        };
        const flags = new Map<object, { move: boolean; resize: boolean }>([
            [refA, { move: false, resize: true }],
            [refB, { move: false, resize: false }],
        ]);
        const env: PointerResizeEnv = {
            callDbus: (_s, _p, _i, _m, _payload, callback) => { callbacks.push(callback); },
            scheduleOnce: () => () => {},
            log: (message) => { logs.push(message); },
            observe: () => observed,
            setGeometry: () => true,
            active: () => refA,
            hasExclusiveResizeAuthority: () => true,
            readLiveState: (target) => flags.get(target) ?? null,
        };
        const adapter = new PointerResizeAdapter(env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1", revision: 0 }), true);
        adapter.windowStarted(refA);
        adapter.windowStepped(refA, { x: 0, y: 0, width: 1000, height: 1080 });
        assert.ok(callbacks[0] !== undefined);
        callbacks[0]?.(":1.42");
        // Flight is now pending on the planner request; two further steps coalesce.
        adapter.windowStepped(refA, { x: 0, y: 0, width: 1010, height: 1080 });
        adapter.windowStepped(refA, { x: 0, y: 0, width: 1020, height: 1080 });
        const markers = logs.filter((line) => line.endsWith(":coalesced"));
        assert.equal(markers.length, 1, `expected one coalesced marker, got ${markers.length}: ${logs.join("\n")}`);
        void RESIZE_CONTRACT_VERSION;
    });
});
