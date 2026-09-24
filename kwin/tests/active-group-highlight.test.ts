import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
    ACTIVE_GROUP_MAX_REQUEST_BYTES,
    ActiveGroupHighlight,
    ActiveGroupHighlightEnv,
    ActiveGroupObserved,
    buildActiveGroupRequest,
    formatGroupHighlightPayload,
    GROUP_HIGHLIGHT_CLEAR_METHOD,
    GROUP_HIGHLIGHT_INTERFACE,
    GROUP_HIGHLIGHT_OBJECT,
    GROUP_HIGHLIGHT_SERVICE,
    GROUP_HIGHLIGHT_SET_METHOD,
    parseActiveGroupReply,
    startActiveGroupHighlight,
} from "../src/active-group-highlight";

const OWNER = "owner-1";
const GENERATION = "gen-1";
const CORRELATION = "gen-1-g0";

function observed(): ActiveGroupObserved {
    return {
        domainOutput: "out-1",
        domainWorkspace: "ws-1",
        domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
        domainGap: 0,
        domainOuterGap: 0,
        focusedId: "win-2",
        windows: [
            { id: "win-1", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 100, h: 80 }, fullscreen: false },
            { id: "win-2", output: "out-1", workspace: "ws-1", rect: { x: 200, y: 0, w: 100, h: 80 }, fullscreen: false },
        ],
    };
}

function observedWithFullscreen(nonFocusedFullscreen: boolean): ActiveGroupObserved {
    const base = observed();
    return {
        ...base,
        windows: base.windows.map((entry) =>
            entry.id === "win-1" ? { ...entry, fullscreen: nonFocusedFullscreen } : entry,
        ),
    };
}

function activeGroupReply(correlation: string): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "active-group",
        kind: "active-group",
        base_revision: 2,
        detail: {
            kind: "active-group",
            owner: OWNER,
            generation: GENERATION,
            domain_output: "out-1",
            domain_workspace: "ws-1",
            group: "group-1",
            focused_leaf: "leaf-2",
            focused_window: "win-2",
            members: [
                { window: "win-1", leaf: "leaf-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
                { window: "win-2", leaf: "leaf-2", rect: { x: 600, y: 0, w: 600, h: 800 } },
            ],
            bounds: { x: 0, y: 0, w: 1200, h: 800 },
        },
        desired_geometry: [
            { window: "win-1", leaf: "leaf-1", output: "out-1", workspace: "ws-1", rect: { x: 0, y: 0, w: 600, h: 800 } },
            { window: "win-2", leaf: "leaf-2", output: "out-1", workspace: "ws-1", rect: { x: 600, y: 0, w: 600, h: 800 } },
        ],
        desired_focus: { domain_output: "out-1", domain_workspace: "ws-1", leaf: "leaf-2" },
    });
}

function noGroupReply(correlation: string, reason: string): string {
    return JSON.stringify({
        v: 1,
        correlation_id: correlation,
        outcome: "no-group",
        kind: "no-group",
        base_revision: 2,
        detail: { kind: "no-group", reason, owner: OWNER, generation: GENERATION },
    });
}

interface Fixture {
    env: ActiveGroupHighlightEnv;
    bridge: ActiveGroupHighlight;
    payloads: string[];
    replies: Array<(reply: unknown) => void>;
    sets: string[];
    logs: string[];
}

function fixture(observe: () => ActiveGroupObserved | null = observed): Fixture {
    const payloads: string[] = [];
    const replies: Array<(reply: unknown) => void> = [];
    const sets: string[] = [];
    const logs: string[] = [];
    const env: ActiveGroupHighlightEnv = {
        callDescribePlan: (payload, callback) => {
            payloads.push(payload);
            replies.push(callback);
        },
        setHighlight: (payload) => {
            sets.push(payload);
        },
        clearHighlight: () => {},
        observe,
        subscribe: () => () => {},
        log: (message) => {
            logs.push(message);
        },
        owner: OWNER,
        generation: GENERATION,
    };
    return { env, bridge: new ActiveGroupHighlight(env), payloads, replies, sets, logs };
}

describe("active-group reply contract", () => {
    it("accepts the exact retained active-group shape with engine-projected members", () => {
        const parsed = parseActiveGroupReply(activeGroupReply(CORRELATION), {
            correlationId: CORRELATION,
            owner: OWNER,
            generation: GENERATION,
        });
        assert.ok(parsed !== null && parsed.kind === "active-group");
        assert.equal(parsed.group, "group-1");
        assert.equal(parsed.focusedWindow, "win-2");
        assert.equal(parsed.baseRevision, 2);
        assert.deepEqual(parsed.bounds, { x: 0, y: 0, w: 1200, h: 800 });
        assert.equal(parsed.members.length, 2);
    });

    it("accepts every fixed no-group reason", () => {
        for (const reason of [
            "no-session",
            "diverged",
            "pending",
            "domain-mismatch",
            "stale-revision",
            "focus-mismatch",
            "focus-unmapped",
            "no-tree",
            "no-parent-group",
        ]) {
            const parsed = parseActiveGroupReply(noGroupReply(CORRELATION, reason), {
                correlationId: CORRELATION,
                owner: OWNER,
                generation: GENERATION,
            });
            assert.ok(parsed !== null && parsed.kind === "no-group", reason);
            assert.equal(parsed.reason, reason);
        }
    });

    it("rejects malformed and identity-mismatched replies fail-closed", () => {
        const identity = { correlationId: CORRELATION, owner: OWNER, generation: GENERATION };
        assert.equal(parseActiveGroupReply("not-json", identity), null);
        assert.equal(parseActiveGroupReply("", identity), null);
        assert.equal(parseActiveGroupReply(JSON.stringify({ v: 2 }), identity), null);
        // Correlation mismatch.
        assert.equal(parseActiveGroupReply(activeGroupReply("gen-1-g9"), identity), null);
        // Owner mismatch.
        const otherOwner = JSON.parse(activeGroupReply(CORRELATION)) as Record<string, unknown>;
        (otherOwner["detail"] as Record<string, unknown>)["owner"] = "owner-9";
        assert.equal(parseActiveGroupReply(JSON.stringify(otherOwner), identity), null);
        // Vague reason token.
        assert.equal(parseActiveGroupReply(noGroupReply(CORRELATION, "failure"), identity), null);
        assert.equal(parseActiveGroupReply(noGroupReply(CORRELATION, "unknown"), identity), null);
        // Member outside the union bounds.
        const escaped = JSON.parse(activeGroupReply(CORRELATION)) as Record<string, unknown>;
        const detail = escaped["detail"] as Record<string, unknown>;
        (detail["members"] as Array<Record<string, unknown>>)[0] = {
            window: "win-1",
            leaf: "leaf-1",
            rect: { x: 5000, y: 5000, w: 10, h: 10 },
        };
        assert.equal(parseActiveGroupReply(JSON.stringify(escaped), identity), null);
        // Duplicate member window.
        const duped = JSON.parse(activeGroupReply(CORRELATION)) as Record<string, unknown>;
        const dupDetail = duped["detail"] as Record<string, unknown>;
        const dupMembers = dupDetail["members"] as Array<unknown>;
        const firstMember = dupMembers[0];
        assert.ok(firstMember !== undefined);
        dupMembers[1] = firstMember;
        assert.equal(parseActiveGroupReply(JSON.stringify(duped), identity), null);
        // Non-ASCII opaque id.
        const unicode = JSON.parse(activeGroupReply(CORRELATION)) as Record<string, unknown>;
        const unicodeMembers = (unicode["detail"] as Record<string, unknown>)["members"] as Array<Record<string, unknown>>;
        const unicodeFirst = unicodeMembers[0];
        assert.ok(unicodeFirst !== undefined);
        unicodeFirst["window"] = "win-☃";
        assert.equal(parseActiveGroupReply(JSON.stringify(unicode), identity), null);
        // Extra detail key.
        const extra = JSON.parse(activeGroupReply(CORRELATION)) as Record<string, unknown>;
        (extra["detail"] as Record<string, unknown>)["topology"] = [];
        assert.equal(parseActiveGroupReply(JSON.stringify(extra), identity), null);
    });

    it("builds the existing DescribePlan active-group request without deriving topology", () => {
        const result = buildActiveGroupRequest(observed(), OWNER, GENERATION, CORRELATION, 0, 7);
        assert.equal(result.ok, true);
        const body = JSON.parse((result as { ok: true; payload: string }).payload) as Record<string, unknown>;
        assert.equal(body["v"], 1);
        assert.equal(body["correlation_id"], CORRELATION);
        assert.deepEqual(body["command"], { op: "active-group" });
        assert.equal(body["focused_window"], "win-2");
        const windows = body["windows"] as Array<Record<string, unknown>>;
        assert.equal(windows.length, 2);
        // Carried verbatim, never reprojected.
        const firstWindow = windows[0];
        assert.ok(firstWindow !== undefined);
        assert.deepEqual(firstWindow["rect"], { x: 0, y: 0, w: 100, h: 80 });
        // Script-only fullscreen validity never crosses the Rust contract.
        for (const entry of windows) {
            assert.ok(!Object.prototype.hasOwnProperty.call(entry, "fullscreen"));
        }
    });

    it("formats only identity plus union bounds for the effect setter", () => {
        const payload = formatGroupHighlightPayload(CORRELATION, OWNER, GENERATION, 2, "group-1", "win-2", {
            x: 0,
            y: 0,
            w: 1200,
            h: 800,
        });
        assert.ok(payload !== null);
        assert.deepEqual(JSON.parse(payload as string), {
            v: 1,
            correlation_id: CORRELATION,
            owner: OWNER,
            generation: GENERATION,
            revision: 2,
            group: "group-1",
            focused_window: "win-2",
            bounds: { x: 0, y: 0, w: 1200, h: 800 },
        });
        assert.ok((payload as string).length <= 4096);
    });
});

describe("active-group highlight bridge behavior", () => {
    const answer = (f: Fixture, index: number, reply: unknown): void => {
        const callback = f.replies[index];
        assert.ok(callback !== undefined);
        callback(reply);
    };

    it("dispatches DescribePlan and sets the owned effect highlight on active-group", () => {
        const f = fixture();
        f.bridge.refresh();
        assert.equal(f.payloads.length, 1);
        const firstPayload = f.payloads[0];
        assert.ok(firstPayload !== undefined);
        const body = JSON.parse(firstPayload) as Record<string, unknown>;
        assert.deepEqual(body["command"], { op: "active-group" });
        assert.equal(f.logs.length, 1);
        assert.equal(f.logs[0] as string, `plasma-auto-tiler:group-highlight:dispatch correlation=${CORRELATION}`);
        answer(f, 0, activeGroupReply(CORRELATION));
        assert.equal(f.sets.length, 1);
        const firstSet = f.sets[0];
        assert.ok(firstSet !== undefined);
        const forwarded = JSON.parse(firstSet) as Record<string, unknown>;
        assert.equal(forwarded["group"], "group-1");
        assert.deepEqual(forwarded["bounds"], { x: 0, y: 0, w: 1200, h: 800 });
        assert.ok(
            f.logs.some((line) => line === `plasma-auto-tiler:group-highlight:setter-submitted correlation=${CORRELATION} revision=2`),
        );
    });

    it("clears on no-group without calling the setter", () => {
        const f = fixture();
        f.bridge.refresh();
        answer(f, 0, noGroupReply(CORRELATION, "no-parent-group"));
        assert.equal(f.sets.length, 0);
        assert.ok(f.logs.some((line) => line === "plasma-auto-tiler:group-highlight:cleared reason=no-parent-group"));
    });

    it("clears on malformed replies and identity mismatch", () => {
        const bad = fixture();
        bad.bridge.refresh();
        answer(bad, 0, "garbage");
        assert.equal(bad.sets.length, 0);
        assert.ok(bad.logs.some((line) => line === "plasma-auto-tiler:group-highlight:cleared reason=reply-invalid"));

        const mismatch = fixture();
        mismatch.bridge.refresh();
        answer(mismatch, 0, activeGroupReply("gen-1-g9"));
        assert.equal(mismatch.sets.length, 0);
        assert.ok(mismatch.logs.some((line) => line.indexOf("cleared reason=") >= 0));
    });

    it("ignores stale flights without clearing the newer display or pending", () => {
        const f = fixture();
        let clears = 0;
        const origClear = f.env.clearHighlight;
        (f.env as unknown as Record<string, unknown>)["clearHighlight"] = (): void => {
            clears += 1;
            (origClear as () => void)();
        };
        // Rebuild bridge with counting clear to observe invalidate clear.
        const payloads: string[] = [];
        const replies: Array<(reply: unknown) => void> = [];
        const sets: string[] = [];
        const logs: string[] = [];
        let clearCount = 0;
        const bridge = new ActiveGroupHighlight({
            callDescribePlan: (payload, callback) => {
                payloads.push(payload);
                replies.push(callback);
            },
            setHighlight: (payload) => {
                sets.push(payload);
            },
            clearHighlight: () => {
                clearCount += 1;
            },
            observe: observed,
            subscribe: () => () => {},
            log: (message) => {
                logs.push(message);
            },
            owner: OWNER,
            generation: GENERATION,
        });
        bridge.refresh();
        assert.equal(payloads.length, 1);
        bridge.invalidate();
        const clearsAfterInvalidate = clearCount;
        assert.ok(clearsAfterInvalidate >= 1);
        // Dispatch the newer focus flight.
        bridge.refresh();
        assert.equal(payloads.length, 2);
        // Late old reply is dropped without an extra clear and without
        // killing the newer pending flight.
        const old = replies[0];
        assert.ok(old !== undefined);
        old(activeGroupReply("gen-1-g0"));
        assert.equal(clearCount, clearsAfterInvalidate);
        assert.ok(logs.some((line) => line === "plasma-auto-tiler:group-highlight:dropped reason=stale-dropped"));
        assert.equal(sets.length, 0);
        // Newer flight still resolves and displays.
        const current = replies[1];
        assert.ok(current !== undefined);
        const fresh = JSON.parse(activeGroupReply("gen-1-g1")) as Record<string, unknown>;
        fresh["correlation_id"] = "gen-1-g1";
        current(JSON.stringify(fresh));
        assert.equal(sets.length, 1);
        void clears;
        void f;
    });

    it("preserves a newer display when a late stale revision arrives", () => {
        const payloads: string[] = [];
        const replies: Array<(reply: unknown) => void> = [];
        const sets: string[] = [];
        const logs: string[] = [];
        let clears = 0;
        const bridge = new ActiveGroupHighlight({
            callDescribePlan: (payload, callback) => {
                payloads.push(payload);
                replies.push(callback);
            },
            setHighlight: (payload) => {
                sets.push(payload);
            },
            clearHighlight: () => {
                clears += 1;
            },
            observe: observed,
            subscribe: () => () => {},
            log: (message) => {
                logs.push(message);
            },
            owner: OWNER,
            generation: GENERATION,
        });
        bridge.refresh();
        const first = replies[0];
        assert.ok(first !== undefined);
        first(activeGroupReply("gen-1-g0"));
        assert.equal(sets.length, 1);
        assert.equal(clears, 0);
        // A fresh flight reporting an older base revision is dropped without
        // destroying the newer valid highlight.
        bridge.refresh();
        const stale = JSON.parse(activeGroupReply("gen-1-g1")) as Record<string, unknown>;
        stale["base_revision"] = 1;
        const second = replies[1];
        assert.ok(second !== undefined);
        second(JSON.stringify(stale));
        assert.equal(sets.length, 1);
        assert.equal(clears, 0);
        assert.ok(logs.some((line) => line === "plasma-auto-tiler:group-highlight:dropped reason=stale-revision"));
        void payloads;
    });

    it("accepts g10 after g9 at the same revision", () => {
        const replies: Array<(reply: unknown) => void> = [];
        const sets: string[] = [];
        const logs: string[] = [];
        const bridge = new ActiveGroupHighlight({
            callDescribePlan: (_payload, callback) => {
                replies.push(callback);
            },
            setHighlight: (payload) => {
                sets.push(payload);
            },
            clearHighlight: () => {},
            observe: observed,
            subscribe: () => () => {},
            log: (message) => {
                logs.push(message);
            },
            owner: OWNER,
            generation: GENERATION,
        });
        for (let sequence = 0; sequence <= 10; sequence += 1) {
            bridge.refresh();
            const reply = replies[sequence];
            assert.ok(reply !== undefined);
            reply(activeGroupReply(`gen-1-g${String(sequence)}`));
        }
        assert.equal(sets.length, 11);
        assert.ok(!logs.some((line) => line === "plasma-auto-tiler:group-highlight:dropped reason=out-of-order"));
    });

    it("clears when observation is invalid and when the transport throws", () => {
        const missing = fixture(() => null);
        missing.bridge.refresh();
        assert.equal(missing.payloads.length, 0);
        assert.ok(missing.logs.some((line) => line === "plasma-auto-tiler:group-highlight:cleared reason=observe-invalid"));

        const logs: string[] = [];
        let clears = 0;
        const bridge = new ActiveGroupHighlight({
            callDescribePlan: () => {
                throw new Error("no-bus");
            },
            setHighlight: () => {},
            clearHighlight: () => {
                clears += 1;
            },
            observe: observed,
            subscribe: () => () => {},
            log: (message) => {
                logs.push(message);
            },
            owner: OWNER,
            generation: GENERATION,
        });
        bridge.refresh();
        assert.equal(clears, 1);
        assert.ok(logs.some((line) => line === "plasma-auto-tiler:group-highlight:cleared reason=dbus-failed"));
    });

    it("clears on effect service loss instead of throwing", () => {
        const payloads: string[] = [];
        const replies: Array<(reply: unknown) => void> = [];
        const logs: string[] = [];
        const bridge = new ActiveGroupHighlight({
            callDescribePlan: (payload, callback) => {
                payloads.push(payload);
                replies.push(callback);
            },
            setHighlight: () => {
                throw new Error("service-lost");
            },
            clearHighlight: () => {},
            observe: observed,
            subscribe: () => () => {},
            log: (message) => {
                logs.push(message);
            },
            owner: OWNER,
            generation: GENERATION,
        });
        bridge.refresh();
        assert.equal(payloads.length, 1);
        const callback = replies[0];
        assert.ok(callback !== undefined);
        callback(activeGroupReply(CORRELATION));
        assert.ok(logs.some((line) => line === "plasma-auto-tiler:group-highlight:cleared reason=service-loss"));
    });

    it("accepts more than sixty-four members", () => {
        const members: Array<unknown> = [];
        for (let index = 0; index < 100; index += 1) {
            members.push({ window: `win-${index}`, leaf: `leaf-${index}`, rect: { x: 0, y: 0, w: 1, h: 1 } });
        }
        const reply = JSON.stringify({
            v: 1,
            correlation_id: CORRELATION,
            outcome: "active-group",
            kind: "active-group",
            base_revision: 0,
            detail: {
                kind: "active-group",
                owner: OWNER,
                generation: GENERATION,
                domain_output: "out-1",
                domain_workspace: "ws-1",
                group: "group-1",
                focused_leaf: "leaf-0",
                focused_window: "win-0",
                members,
                bounds: { x: 0, y: 0, w: 1200, h: 800 },
            },
        });
        const parsed = parseActiveGroupReply(reply, { correlationId: CORRELATION, owner: OWNER, generation: GENERATION });
        assert.ok(parsed !== null && parsed.kind === "active-group");
        assert.equal(parsed.members.length, 100);
    });

    it("builds a request for more than sixty-four observed windows", () => {
        const windows = [];
        for (let index = 0; index < 100; index += 1) {
            windows.push({
                id: `win-${String(index)}`,
                output: "out-1",
                workspace: "ws-1",
                rect: { x: 0, y: 0, w: 100, h: 80 },
                fullscreen: false,
            });
        }
        const result = buildActiveGroupRequest(
            {
                domainOutput: "out-1",
                domainWorkspace: "ws-1",
                domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
                domainGap: 0,
                domainOuterGap: 0,
                focusedId: "win-0",
                windows,
            },
            OWNER,
            GENERATION,
            CORRELATION,
            0,
            0,
        );
        assert.equal(result.ok, true, "a 100-window active-group request must build");
        assert.equal((JSON.parse((result as { ok: true; payload: string }).payload)["windows"] as Array<unknown>).length, 100);
    });

    // Exact 1MiB boundary coverage for the shared request cap: fixed-width
    // ids keep the per-window marginal size constant, so one padded id lands
    // one shared build exactly on the cap and one byte over. A single pair
    // of tests covers the boundary; no repeated giant builds elsewhere.
    function capId(index: number, pad: number): string {
        return `w${String(index).padStart(6, "0")}${"x".repeat(pad)}`;
    }

    function capObserved(count: number, pad: number): ActiveGroupObserved {
        const windows = [];
        for (let index = 0; index < count; index += 1) {
            windows.push({
                id: index === 1 ? capId(index, pad) : capId(index, 0),
                output: "out-1",
                workspace: "ws-1",
                rect: { x: 0, y: 0, w: 100, h: 80 },
                fullscreen: false,
            });
        }
        return {
            domainOutput: "out-1",
            domainWorkspace: "ws-1",
            domainBounds: { x: 0, y: 0, w: 1200, h: 800 },
            domainGap: 0,
            domainOuterGap: 0,
            focusedId: capId(0, 0),
            windows,
        };
    }

    function capPayloadLength(count: number): number {
        const result = buildActiveGroupRequest(capObserved(count, 0), OWNER, GENERATION, CORRELATION, 0, 0);
        assert.equal(result.ok, true);
        return (result as { ok: true; payload: string }).payload.length;
    }

    function capSizedPad(): { count: number; pad: number } {
        // Marginal size per window is constant for fixed-width ids; solve the
        // largest fitting count, then pad one non-focused id to the cap.
        const step = capPayloadLength(101) - capPayloadLength(100);
        const base = capPayloadLength(100) - 100 * step;
        const count = Math.max(101, Math.floor((ACTIVE_GROUP_MAX_REQUEST_BYTES - base) / step));
        const pad = ACTIVE_GROUP_MAX_REQUEST_BYTES - (base + count * step);
        assert.ok(pad >= 0 && pad < step && 7 + pad + 1 <= 128, `pad in range: ${String(pad)}`);
        return { count, pad };
    }

    it("accepts a request at exactly the 1MiB cap", () => {
        const { count, pad } = capSizedPad();
        const result = buildActiveGroupRequest(capObserved(count, pad), OWNER, GENERATION, CORRELATION, 0, 0);
        assert.equal(result.ok, true, "an exactly-at-cap request must build");
        const payload = (result as { ok: true; payload: string }).payload;
        assert.equal(payload.length, ACTIVE_GROUP_MAX_REQUEST_BYTES);
        assert.equal(Buffer.byteLength(payload, "utf8"), payload.length, "validated ASCII-only fields make length exact bytes");
    });

    it("refuses a request one byte over the cap with a correlated log and no dispatch", () => {
        const { count, pad } = capSizedPad();
        const result = buildActiveGroupRequest(capObserved(count, pad + 1), OWNER, GENERATION, CORRELATION, 0, 0);
        assert.deepEqual(result, { ok: false, reason: "request-over-cap" });
        const f = fixture(() => capObserved(count, pad + 1));
        f.bridge.refresh();
        assert.equal(f.payloads.length, 0, "an over-cap request must never dispatch");
        assert.ok(
            f.logs.some((line) => line === "plasma-auto-tiler:group-highlight:request-refused correlation=gen-1-g0 reason=request-over-cap"),
            f.logs.join("\n"),
        );
        assert.ok(f.logs.some((line) => line === "plasma-auto-tiler:group-highlight:cleared reason=request-invalid"));
    });

    it("establishes current revision from the initial snapshot", () => {
        const payloads: string[] = [];
        const replies: Array<(reply: unknown) => void> = [];
        const sets: string[] = [];
        const bridge = new ActiveGroupHighlight({
            callDescribePlan: (payload, callback) => {
                payloads.push(payload);
                replies.push(callback);
            },
            setHighlight: (payload) => {
                sets.push(payload);
            },
            clearHighlight: () => {},
            observe: observed,
            subscribe: () => () => {},
            log: () => {},
            owner: OWNER,
            generation: GENERATION,
        });
        bridge.refresh();
        assert.equal(payloads.length, 1);
        const firstPayload = JSON.parse(payloads[0] as string) as Record<string, unknown>;
        assert.equal(firstPayload["revision"], 0);
        const first = replies[0];
        assert.ok(first !== undefined);
        first(activeGroupReply(CORRELATION));
        assert.equal(sets.length, 1);
        // The returned base becomes the next request revision.
        bridge.refresh();
        assert.equal(payloads.length, 2);
        const secondPayload = JSON.parse(payloads[1] as string) as Record<string, unknown>;
        assert.equal(secondPayload["revision"], 2);
    });

    it("clears focus-switch identity mismatch without displaying", () => {
        const f = fixture();
        f.bridge.refresh();
        const mismatched = JSON.parse(activeGroupReply(CORRELATION)) as Record<string, unknown>;
        const detail = mismatched["detail"] as Record<string, unknown>;
        detail["focused_window"] = "win-9";
        answer(f, 0, JSON.stringify(mismatched));
        assert.equal(f.sets.length, 0);
        assert.ok(f.logs.some((line) => line === "plasma-auto-tiler:group-highlight:cleared reason=identity-mismatch"));
    });

    it("clears when a non-focused group member is currently fullscreen", () => {
        let clears = 0;
        const payloads: string[] = [];
        const replies: Array<(reply: unknown) => void> = [];
        const sets: string[] = [];
        const logs: string[] = [];
        const current = observedWithFullscreen(true);
        const bridge = new ActiveGroupHighlight({
            callDescribePlan: (payload, callback) => {
                payloads.push(payload);
                replies.push(callback);
            },
            setHighlight: (payload) => {
                sets.push(payload);
            },
            clearHighlight: () => {
                clears += 1;
            },
            observe: () => current,
            subscribe: () => () => {},
            log: (message) => {
                logs.push(message);
            },
            owner: OWNER,
            generation: GENERATION,
        });
        bridge.refresh();
        assert.equal(payloads.length, 1);
        // The request schema is unchanged: no fullscreen crosses to Rust even
        // though the script observation carries it.
        const body = JSON.parse(payloads[0] as string) as Record<string, unknown>;
        for (const entry of body["windows"] as Array<Record<string, unknown>>) {
            assert.ok(!Object.prototype.hasOwnProperty.call(entry, "fullscreen"));
        }
        const callback = replies[0];
        assert.ok(callback !== undefined);
        callback(activeGroupReply(CORRELATION));
        assert.equal(sets.length, 0);
        assert.ok(clears >= 1);
        assert.ok(logs.some((line) => line === "plasma-auto-tiler:group-highlight:cleared reason=fullscreen"));
    });

    it("drops a duplicate delivery without destroying the display", () => {
        const replies: Array<(reply: unknown) => void> = [];
        const sets: string[] = [];
        const logs: string[] = [];
        let clears = 0;
        const bridge = new ActiveGroupHighlight({
            callDescribePlan: (_payload, callback) => {
                replies.push(callback);
            },
            setHighlight: (payload) => {
                sets.push(payload);
            },
            clearHighlight: () => {
                clears += 1;
            },
            observe: observed,
            subscribe: () => () => {},
            log: (message) => {
                logs.push(message);
            },
            owner: OWNER,
            generation: GENERATION,
        });
        bridge.refresh();
        const first = replies[0];
        assert.ok(first !== undefined);
        first(activeGroupReply("gen-1-g0"));
        assert.equal(sets.length, 1);
        assert.equal(clears, 0);
        // Duplicate late delivery of the consumed flight is dropped without
        // an extra clear; the newer valid highlight stays up.
        first(activeGroupReply("gen-1-g0"));
        assert.equal(sets.length, 1);
        assert.equal(clears, 0);
        assert.ok(logs.some((line) => line === "plasma-auto-tiler:group-highlight:dropped reason=stale-dropped"));
    });

    it("accepts a no-group reply lacking base_revision as a conserving clear", () => {
        const parsed = parseActiveGroupReply(
            JSON.stringify({
                v: 1,
                correlation_id: CORRELATION,
                outcome: "no-group",
                kind: "no-group",
                detail: { kind: "no-group", reason: "no-parent-group", owner: OWNER, generation: GENERATION },
            }),
            { correlationId: CORRELATION, owner: OWNER, generation: GENERATION },
        );
        assert.ok(parsed !== null && parsed.kind === "no-group");
        assert.equal(parsed.baseRevision, null);
        const payloads: string[] = [];
        const replies: Array<(reply: unknown) => void> = [];
        const sets: string[] = [];
        const logs: string[] = [];
        const bridge = new ActiveGroupHighlight({
            callDescribePlan: (payload, callback) => {
                payloads.push(payload);
                replies.push(callback);
            },
            setHighlight: (payload) => {
                sets.push(payload);
            },
            clearHighlight: () => {},
            observe: observed,
            subscribe: () => () => {},
            log: (message) => {
                logs.push(message);
            },
            owner: OWNER,
            generation: GENERATION,
        });
        bridge.refresh();
        const first = replies[0];
        assert.ok(first !== undefined);
        first(
            JSON.stringify({
                v: 1,
                correlation_id: "gen-1-g0",
                outcome: "no-group",
                kind: "no-group",
                detail: { kind: "no-group", reason: "no-parent-group", owner: OWNER, generation: GENERATION },
            }),
        );
        assert.equal(sets.length, 0);
        assert.ok(logs.some((line) => line === "plasma-auto-tiler:group-highlight:cleared reason=no-parent-group"));
        // Identity preserved: next request still carries revision 0.
        bridge.refresh();
        const secondPayload = JSON.parse(payloads[1] as string) as Record<string, unknown>;
        assert.equal(secondPayload["revision"], 0);
    });
});

describe("active-group highlight lifecycle wiring", () => {
    it("subscribes to focus/domain/tree/fullscreen, queries at startup, and re-queries after clearing", () => {
        const seen: string[] = [];
        const handlers = new Map<string, () => void>();
        let clears = 0;
        const payloads: string[] = [];
        const handle = startActiveGroupHighlight({
            callDescribePlan: (payload) => {
                payloads.push(payload);
            },
            setHighlight: () => {},
            clearHighlight: () => {
                clears += 1;
            },
            observe: observed,
            subscribe: (kind, handler) => {
                seen.push(kind);
                handlers.set(kind, handler);
                return () => {};
            },
            log: () => {},
            owner: OWNER,
            generation: GENERATION,
        });
        assert.ok(handle !== null);
        assert.deepEqual(seen, ["focus", "domain", "tree", "fullscreen"]);
        assert.equal(payloads.length, 1);
        // Focus activation clears the old group immediately before the async
        // refresh: one clear plus one new dispatch.
        const before = clears;
        (handlers.get("focus") as () => void)();
        assert.equal(payloads.length, 2);
        assert.ok(clears >= before + 1);
        // Fullscreen transition also requests/clears without pointer movement.
        const beforeFullscreen = payloads.length;
        (handlers.get("fullscreen") as () => void)();
        assert.equal(payloads.length, beforeFullscreen + 1);
        assert.ok(clears >= before + 2);
        (handle as { stop: () => void }).stop();
        assert.ok(clears >= before + 3);
    });

    it("tolerates a missing best-effort fullscreen signal without failing", () => {
        const seen: string[] = [];
        const payloads: string[] = [];
        const handle = startActiveGroupHighlight({
            callDescribePlan: (payload) => {
                payloads.push(payload);
            },
            setHighlight: () => {},
            clearHighlight: () => {},
            observe: observed,
            subscribe: (kind) => {
                seen.push(kind);
                if (kind === "fullscreen") {
                    return null as unknown as () => void;
                }
                return () => {};
            },
            log: () => {},
            owner: OWNER,
            generation: GENERATION,
        });
        assert.ok(handle !== null);
        assert.deepEqual(seen, ["focus", "domain", "tree", "fullscreen"]);
        assert.equal(payloads.length, 1);
        (handle as { stop: () => void }).stop();
    });

    it("refuses a failed subscription fail-closed with a clear", () => {
        let clears = 0;
        const handle = startActiveGroupHighlight({
            callDescribePlan: () => {
                assert.fail("must not dispatch without subscriptions");
            },
            setHighlight: () => {},
            clearHighlight: () => {
                clears += 1;
            },
            observe: observed,
            subscribe: (kind) => {
                if (kind === "domain") {
                    throw new Error("signal-failed");
                }
                return () => {};
            },
            log: () => {},
            owner: OWNER,
            generation: GENERATION,
        });
        assert.equal(handle, null);
        assert.equal(clears, 1);
    });

    it("uses the owned effect endpoint constants and the existing DescribePlan op", () => {
        assert.equal(GROUP_HIGHLIGHT_SERVICE, "org.plasmaautotiler.ActiveBorder");
        assert.equal(GROUP_HIGHLIGHT_OBJECT, "/org/plasmaautotiler/ActiveBorder");
        assert.equal(GROUP_HIGHLIGHT_INTERFACE, "org.plasmaautotiler.ActiveBorder1");
        assert.equal(GROUP_HIGHLIGHT_SET_METHOD, "SetGroupHighlight");
        assert.equal(GROUP_HIGHLIGHT_CLEAR_METHOD, "ClearGroupHighlight");
        const module = readFileSync("src/active-group-highlight.ts", "utf8");
        assert.ok(module.includes("DescribePlan") || module.includes("callDescribePlan"));
        assert.ok(module.includes("SetGroupHighlight"));
        assert.ok(module.includes("ClearGroupHighlight"));
        assert.ok(module.includes("active-group"));
        assert.ok(!module.includes("/Effects"));
        assert.ok(!module.includes("reconfigureEffect"));
        assert.ok(!module.includes("showOutline"));
        assert.ok(!module.includes("registerShortcut"));
        assert.ok(!module.includes("setTimeout"));
        assert.ok(!module.includes("setInterval"));
        assert.ok(!module.includes("QTimer"));
        // No topology derivation: the group bounds are carried verbatim from
        // Rust and never computed from members (no min/max folding, no
        // projection, no accumulation over member rectangles).
        assert.ok(!module.includes("Math.min("));
        assert.ok(!module.includes("Math.max("));
        assert.ok(!module.includes(".reduce("));
        assert.ok(!module.includes("project("));
    });
});
