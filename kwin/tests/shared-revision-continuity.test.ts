import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    createEngineAuthority,
    type EngineAuthorityStarts,
} from "../src/engine-authority";
import {
    FocusAdapter,
    type FocusAdapterEnv,
    type FocusObserved,
} from "../src/focus-adapter";

function makeRefs(): { a: object; b: object; c: object } {
    return { a: {}, b: {}, c: {} };
}

function makeObservedN(
    refs: { a: object; b: object; c: object },
    ids: readonly string[],
    activeId: string,
): FocusObserved {
    const byId: Record<string, object> = {
        "win-a": refs.a,
        "win-b": refs.b,
        "win-c": refs.c,
    };
    const windows = Object.freeze(
        ids.map((id) => Object.freeze({ id, ref: byId[id] as object })),
    );
    const activeRef = byId[activeId] as object;
    return {
        domainOutput: "focus-output",
        domainWorkspace: "focus-workspace",
        focusedId: activeId,
        windows,
        activeRef,
        fingerprint: "fp-1",
        revalidate: () => true,
    };
}

interface Mocks {
    readonly dbusCalls: Array<{ method: string; payload: string }>;
    readonly callbacks: Array<(reply: unknown) => void>;
    observeImpl: () => FocusObserved | null;
    env: FocusAdapterEnv;
}

function mockEnv(observeImpl: () => FocusObserved | null): Mocks {
    const state = {
        dbusCalls: [] as Array<{ method: string; payload: string }>,
        callbacks: [] as Array<(reply: unknown) => void>,
        observeImpl,
        env: null as unknown as FocusAdapterEnv,
    };
    const env: FocusAdapterEnv = {
        callDbus: (_service, _path, _iface, method, payload, callback) => {
            state.dbusCalls.push({ method, payload });
            state.callbacks.push(callback);
        },
        scheduleOnce: (_delayMs, _callback) => () => {},
        log: () => {},
        observe: () => state.observeImpl(),
        setActive: () => true,
        active: () => null,
        hasExclusiveFocusAuthority: () => true,
        subscribe: () => () => {},
    };
    (state as { env: FocusAdapterEnv }).env = env;
    return state as Mocks;
}

function plannerPayload(mocks: Mocks): Record<string, unknown> {
    const found = mocks.dbusCalls.find((call) => call.method === "DescribeFocus");
    assert.ok(found !== undefined, "focus request must reach the planner");
    return JSON.parse(found.payload) as Record<string, unknown>;
}

function fakeStarts(calls: Array<{ revision: unknown }>): EngineAuthorityStarts {
    const record = (revision: unknown): void => {
        calls.push({ revision });
    };
    return {
        startFocus: (args) => {
            record(args.revision);
            return { stop: () => {}, request: () => {} };
        },
        startMovement: (args) => {
            record(args.revision);
            return { stop: () => {}, request: () => {} };
        },
        startResize: (args) => {
            record(args.revision);
            return { stop: () => {}, request: () => {} };
        },
        startPointerResize: (args) => {
            record(args.revision);
            return { stop: () => {} };
        },
    };
}

describe("shared revision holder poisoning", () => {
    it("does not store a non-seed revision, preserving later exact-three seeding", () => {
        const refs = makeRefs();
        const holder = { current: 0 };
        // First: ineligible two-window request over the shared holder.
        const two = mockEnv(() => makeObservedN(refs, ["win-a", "win-b"], "win-a"));
        const first = new FocusAdapter(two.env);
        assert.equal(first.enable({ owner: "owner-1", generation: "gen-1", revision: holder }), true);
        first.requestFocus("right");
        // Fail-closed without poisoning: the wire still carries N=2 so Rust
        // rejects, but the shared holder stays fresh for later seeding.
        assert.equal(holder.current, 0);
        two.callbacks[0]?.(":1.7");
        assert.equal(plannerPayload(two)["revision"], 2);

        // Later: exact-three request over the same holder must still seed.
        const three = mockEnv(() => makeObservedN(refs, ["win-a", "win-b", "win-c"], "win-a"));
        const second = new FocusAdapter(three.env);
        assert.equal(second.enable({ owner: "owner-1", generation: "gen-1", revision: holder }), true);
        second.requestFocus("right");
        assert.equal(holder.current, 3);
        three.callbacks[0]?.(":1.7");
        assert.equal(plannerPayload(three)["revision"], 3);
    });

    it("stores the exact-three seed revision and preserves established binding", () => {
        const refs = makeRefs();
        const holder = { current: 0 };
        const three = mockEnv(() => makeObservedN(refs, ["win-a", "win-b", "win-c"], "win-a"));
        const adapter = new FocusAdapter(three.env);
        assert.equal(adapter.enable({ owner: "owner-1", generation: "gen-1", revision: holder }), true);
        adapter.requestFocus("right");
        assert.equal(holder.current, 3);
        three.callbacks[0]?.(":1.7");
        assert.equal(plannerPayload(three)["revision"], 3);

        // Established session: a non-zero holder is sent verbatim.
        const holder5 = { current: 5 };
        const established = mockEnv(() => makeObservedN(refs, ["win-a", "win-b", "win-c"], "win-a"));
        const adapter5 = new FocusAdapter(established.env);
        assert.equal(adapter5.enable({ owner: "owner-1", generation: "gen-1", revision: holder5 }), true);
        adapter5.requestFocus("right");
        assert.equal(holder5.current, 5);
        established.callbacks[0]?.(":1.7");
        assert.equal(plannerPayload(established)["revision"], 5);
    });
});

describe("dispatcher recreation continuity", () => {
    it("adopts the previous in-memory revision without legacy fallback", () => {
        const calls1: Array<{ revision: unknown }> = [];
        const first = createEngineAuthority("rust-development", fakeStarts(calls1), () => {});
        assert.equal(first.start(), true);
        const holder1 = calls1[0]?.revision as { current: number };
        assert.equal(holder1.current, 0);
        // Simulate an established session advancing the shared holder.
        holder1.current = 4;
        assert.equal(first.revisionSnapshot(), 4);
        first.stop();

        const calls2: Array<{ revision: unknown }> = [];
        const second = createEngineAuthority(
            "rust-development",
            fakeStarts(calls2),
            () => {},
            first.revisionSnapshot(),
        );
        assert.equal(second.start(), true);
        const holder2 = calls2[0]?.revision as { current: number };
        assert.equal(holder2.current, 4);
        // Copy, not alias: mutating the old holder must not affect the new.
        holder1.current = 99;
        assert.equal(holder2.current, 4);
        assert.equal(second.revisionSnapshot(), 4);
        // Stale/reload never causes legacy fallback: rust requests stay
        // refused/fail-closed via the dispatcher, never legacy.
        second.stop();
        assert.equal(second.isRustActive(), false);
    });

    it("fails closed to fresh on an invalid adopted revision", () => {
        for (const invalid of [-1, 1.5, Number.NaN, 1000001]) {
            const calls: Array<{ revision: unknown }> = [];
            const dispatcher = createEngineAuthority("rust-development", fakeStarts(calls), () => {}, invalid);
            assert.equal(dispatcher.start(), true);
            assert.equal((calls[0]?.revision as { current: number }).current, 0);
            assert.equal(dispatcher.revisionSnapshot(), 0);
            dispatcher.stop();
        }
    });
});
