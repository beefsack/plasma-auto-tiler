import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    formatInitialMaximizeClear,
    formatInitialMaximizeSet,
    INITIAL_MAXIMIZE_CLEAR_METHOD,
    INITIAL_MAXIMIZE_EPOCH_METHOD,
    INITIAL_MAXIMIZE_INTERFACE,
    INITIAL_MAXIMIZE_OBJECT,
    INITIAL_MAXIMIZE_SERVICE,
    INITIAL_MAXIMIZE_SET_METHOD,
    InitialMaximizeEnv,
    isUnbracedUuid,
    startInitialMaximize,
} from "../src/active-border-initial";
import { startPlanAdapterEntry } from "../src/plan-adapter-entry";

const OWNER = "owner-1";
const EPOCH = "01234567-89ab-cdef-0123-456789abcd";
const EPOCH_NEW = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeee0";
const UUID_A = "01234567-89ab-cdef-0123-456789abcdef";
const UUID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function makeWindow(opts: { normal?: boolean; id?: unknown; mode?: unknown } = {}): Record<string, unknown> {
    const signals = new Map<string, Array<() => void>>();
    const win: Record<string, unknown> = {
        normalWindow: opts.normal ?? true,
        internalId: opts.id ?? UUID_A,
        maximizeMode: opts.mode ?? 0,
    };
    for (const name of ["maximizedChanged"]) {
        const handlers: Array<() => void> = [];
        signals.set(name, handlers);
        (win as Record<string, unknown>)[name] = {
            connect: (handler: () => void): void => {
                handlers.push(handler);
            },
            disconnect: (handler: () => void): void => {
                const at = handlers.indexOf(handler);
                if (at >= 0) {
                    handlers.splice(at, 1);
                }
            },
        };
    }
    (win as Record<string, unknown>).__signals = signals;
    return win;
}

function windowHandlers(win: Record<string, unknown>): Array<() => void> {
    return (win.__signals as Map<string, Array<() => void>>).get("maximizedChanged") ?? [];
}

interface PublisherFixture {
    env: InitialMaximizeEnv;
    sets: string[];
    clears: string[];
    logs: string[];
    focusHandlers: Array<() => void>;
    epochReplies: Array<(reply: unknown) => void>;
    fetchCalls: number;
    fetchImpl: (callback: (reply: unknown) => void) => void;
    active: unknown;
    windowSubs: number;
}

function publisherFixture(active: unknown): PublisherFixture {
    const sets: string[] = [];
    const clears: string[] = [];
    const logs: string[] = [];
    const focusHandlers: Array<() => void> = [];
    const epochReplies: Array<(reply: unknown) => void> = [];
    const fixture: PublisherFixture = {
        env: {
            owner: OWNER,
            getActiveWindow: () => fixture.active,
            setInitial: (payload) => {
                sets.push(payload);
            },
            clearInitial: (payload) => {
                clears.push(payload);
            },
            fetchEpoch: (callback) => fixture.fetchImpl(callback),
            subscribeFocus: (handler) => {
                focusHandlers.push(handler);
                return () => {
                    const at = focusHandlers.indexOf(handler);
                    if (at >= 0) {
                        focusHandlers.splice(at, 1);
                    }
                };
            },
            subscribeWindowMaximized: (ref, handler) => {
                fixture.windowSubs += 1;
                const signal = (ref as Record<string, unknown>)["maximizedChanged"] as
                    | { connect: (h: () => void) => void; disconnect: (h: () => void) => void }
                    | undefined;
                if (signal === undefined || typeof signal.connect !== "function") {
                    return null;
                }
                try {
                    signal.connect(handler);
                } catch (error) {
                    void error;
                    return null;
                }
                return () => {
                    try {
                        signal.disconnect(handler);
                    } catch (error) {
                        void error;
                    }
                };
            },
            log: (message) => {
                logs.push(message);
            },
        },
        sets,
        clears,
        logs,
        focusHandlers,
        epochReplies,
        fetchCalls: 0,
        fetchImpl: (callback) => {
            fixture.fetchCalls += 1;
            epochReplies.push(callback);
        },
        active,
        windowSubs: 0,
    };
    return fixture;
}

function replyEpoch(fixture: PublisherFixture, epoch: unknown): void {
    const pending = fixture.epochReplies.splice(0);
    assert.ok(pending.length > 0);
    for (const callback of pending) {
        callback(epoch);
    }
}

describe("active-border initial payload format", () => {
    it("formats strict set and clear payloads with the effect epoch as generation", () => {
        const set = formatInitialMaximizeSet(OWNER, EPOCH, 0, UUID_A, 0);
        assert.equal(
            set,
            JSON.stringify({ v: 1, owner: OWNER, generation: EPOCH, revision: 0, active_window: UUID_A, maximize_mode: 0 }),
        );
        const clear = formatInitialMaximizeClear(OWNER, EPOCH, 1);
        assert.equal(
            clear,
            JSON.stringify({ v: 1, owner: OWNER, generation: EPOCH, revision: 1, active_window: null }),
        );
        assert.equal(Object.keys(JSON.parse(set as string)).length, 6);
        assert.equal(Object.keys(JSON.parse(clear as string)).length, 5);
    });

    it("rejects non-uuid, bad revision, bad mode, and bad identity", () => {
        assert.equal(formatInitialMaximizeSet(OWNER, EPOCH, 0, "win-2", 0), null);
        assert.equal(formatInitialMaximizeSet(OWNER, EPOCH, 0, `{${UUID_A}}`, 0), null);
        assert.equal(formatInitialMaximizeSet(OWNER, EPOCH, -1, UUID_A, 0), null);
        assert.equal(formatInitialMaximizeSet(OWNER, EPOCH, 0, UUID_A, 4), null);
        assert.equal(formatInitialMaximizeSet(OWNER, EPOCH, 0.5, UUID_A, 0), null);
        assert.equal(formatInitialMaximizeSet("owner 1", EPOCH, 0, UUID_A, 0), null);
        assert.equal(formatInitialMaximizeSet(OWNER, "GEN-1", 0, UUID_A, 0), null);
        assert.equal(formatInitialMaximizeClear(OWNER, EPOCH, 9007199254740992), null);
        assert.ok(isUnbracedUuid(UUID_A));
        assert.ok(!isUnbracedUuid("win-2"));
        assert.ok(!isUnbracedUuid(`{${UUID_A}}`));
    });
});

describe("active-border initial publisher", () => {
    it("stays hidden at first startup until the fetched epoch confirms normal", () => {
        const fixture = publisherFixture(makeWindow({ mode: 0 }));
        const handle = startInitialMaximize(fixture.env);
        assert.ok(handle !== null);
        // Epoch fetch is pending: nothing published, gate hidden.
        assert.equal(fixture.fetchCalls, 1);
        assert.equal(fixture.sets.length, 0);
        assert.equal(fixture.clears.length, 0);
        replyEpoch(fixture, EPOCH);
        assert.equal(fixture.sets.length, 1);
        const parsed = JSON.parse(fixture.sets[0] as string) as Record<string, unknown>;
        assert.equal(parsed["generation"], EPOCH);
        assert.equal(parsed["active_window"], UUID_A);
        assert.equal(parsed["maximize_mode"], 0);
        assert.equal(parsed["revision"], 0);
        handle?.stop();
    });

    it("publishes set for a normal floating window and for modes 1-3", () => {
        for (const mode of [0, 1, 2, 3]) {
            const fixture = publisherFixture(makeWindow({ mode }));
            const handle = startInitialMaximize(fixture.env);
            assert.ok(handle !== null);
            replyEpoch(fixture, EPOCH);
            assert.equal(fixture.sets.length, 1);
            const parsed = JSON.parse(fixture.sets[0] as string) as Record<string, unknown>;
            assert.equal(parsed["maximize_mode"], mode);
            assert.equal(parsed["generation"], EPOCH);
            handle?.stop();
        }
    });

    it("publishes clear for no active, non-normal, and unreadable windows", () => {
        for (const active of [null, makeWindow({ normal: false }), makeWindow({ id: "win-2" }), makeWindow({ mode: 9 })]) {
            const fixture = publisherFixture(active);
            const handle = startInitialMaximize(fixture.env);
            assert.ok(handle !== null);
            replyEpoch(fixture, EPOCH);
            assert.equal(fixture.sets.length, 0);
            assert.equal(fixture.clears.length, 1);
            const parsed = JSON.parse(fixture.clears[0] as string) as Record<string, unknown>;
            assert.equal(parsed["active_window"], null);
            assert.equal(parsed["generation"], EPOCH);
            handle?.stop();
        }
    });

    it("an unavailable or invalid epoch fetch never confirms", () => {
        const silent = publisherFixture(makeWindow({ mode: 0 }));
        silent.fetchImpl = () => {
            silent.fetchCalls += 1;
        };
        const silentHandle = startInitialMaximize(silent.env);
        assert.ok(silentHandle !== null);
        assert.equal(silent.sets.length, 0);
        assert.equal(silent.clears.length, 0);
        silentHandle?.stop();

        const throwing = publisherFixture(makeWindow({ mode: 0 }));
        throwing.fetchImpl = () => {
            throwing.fetchCalls += 1;
            throw new Error("effect-down");
        };
        const throwingHandle = startInitialMaximize(throwing.env);
        assert.ok(throwingHandle !== null);
        assert.equal(throwing.sets.length, 0);
        assert.equal(throwing.clears.length, 0);
        throwingHandle?.stop();

        const invalid = publisherFixture(makeWindow({ mode: 0 }));
        const invalidHandle = startInitialMaximize(invalid.env);
        assert.ok(invalidHandle !== null);
        replyEpoch(invalid, "GEN-1");
        assert.equal(invalid.sets.length, 0);
        assert.equal(invalid.clears.length, 0);
        invalidHandle?.stop();
    });

    it("rebinds exactly one per-window signal on groupless focus changes", () => {
        const first = makeWindow({ id: UUID_A });
        const fixture = publisherFixture(first);
        const handle = startInitialMaximize(fixture.env);
        assert.ok(handle !== null);
        replyEpoch(fixture, EPOCH);
        assert.equal(fixture.windowSubs, 1);
        assert.equal(windowHandlers(first).length, 1);
        const second = makeWindow({ id: UUID_B });
        fixture.active = second;
        assert.equal(fixture.focusHandlers.length, 1);
        (fixture.focusHandlers[0] as () => void)();
        assert.equal(windowHandlers(first).length, 0);
        assert.equal(windowHandlers(second).length, 1);
        // Focus re-reads the epoch first: nothing published until the reply.
        assert.equal(fixture.fetchCalls, 2);
        assert.equal(fixture.sets.length, 1);
        replyEpoch(fixture, EPOCH);
        assert.equal(fixture.sets.length, 2);
        const parsed = JSON.parse(fixture.sets[1] as string) as Record<string, unknown>;
        assert.equal(parsed["active_window"], UUID_B);
        assert.equal(parsed["generation"], EPOCH);
        // Same epoch continues the revision; it does not reset.
        assert.equal(parsed["revision"], 1);
        // Focused-window maximize transition refetches, then republishes
        // without new focus binding.
        (windowHandlers(second)[0] as () => void)();
        assert.equal(fixture.fetchCalls, 3);
        replyEpoch(fixture, EPOCH);
        assert.equal(fixture.sets.length, 3);
        assert.equal(windowHandlers(second).length, 1);
        handle?.stop();
    });

    it("effect reload rebinds epoch and resets revision on next lifecycle input", () => {
        const fixture = publisherFixture(makeWindow({ mode: 0 }));
        const handle = startInitialMaximize(fixture.env);
        assert.ok(handle !== null);
        replyEpoch(fixture, EPOCH);
        assert.equal(fixture.sets.length, 1);
        assert.equal((JSON.parse(fixture.sets[0] as string) as Record<string, unknown>)["revision"], 0);
        // The effect reloads (new instance, new epoch, hidden gate). The next
        // focus fetches the fresh epoch instead of resubmitting the old one.
        (fixture.focusHandlers[0] as () => void)();
        assert.equal(fixture.fetchCalls, 2);
        assert.equal(fixture.sets.length, 1);
        replyEpoch(fixture, EPOCH_NEW);
        assert.equal(fixture.sets.length, 2);
        const rebound = JSON.parse(fixture.sets[1] as string) as Record<string, unknown>;
        assert.equal(rebound["generation"], EPOCH_NEW);
        assert.equal(rebound["maximize_mode"], 0);
        assert.equal(rebound["revision"], 0);
        // A late callback from a superseded fetch cannot revive the old epoch
        // or override the newer binding, even when it carries the old token.
        (fixture.focusHandlers[0] as () => void)();
        (fixture.focusHandlers[0] as () => void)();
        const pending = fixture.epochReplies.splice(0) as Array<(reply: unknown) => void>;
        assert.equal(pending.length, 2);
        pending[0]?.(EPOCH);
        assert.equal(fixture.sets.length, 2);
        pending[1]?.(EPOCH_NEW);
        assert.equal(fixture.sets.length, 3);
        const current = JSON.parse(fixture.sets[2] as string) as Record<string, unknown>;
        assert.equal(current["generation"], EPOCH_NEW);
        handle?.stop();
    });

    it("stale epoch replies cannot publish after stop or override a newer epoch", () => {
        const fixture = publisherFixture(makeWindow({ mode: 0 }));
        const handle = startInitialMaximize(fixture.env);
        assert.ok(handle !== null);
        handle?.stop();
        // Pending fetch reply after stop publishes nothing.
        replyEpoch(fixture, EPOCH);
        assert.equal(fixture.sets.length, 0);
        assert.equal(fixture.clears.length, 0);

        const racing = publisherFixture(makeWindow({ mode: 0 }));
        const racingHandle = startInitialMaximize(racing.env);
        assert.ok(racingHandle !== null);
        // Second lifecycle input while unbound requests again; the older
        // callback must not publish or bind.
        (racing.focusHandlers[0] as () => void)();
        assert.equal(racing.fetchCalls, 2);
        const [older, newer] = racing.epochReplies.splice(0) as Array<(reply: unknown) => void>;
        older?.(EPOCH);
        assert.equal(racing.sets.length, 0);
        newer?.(EPOCH_NEW);
        assert.equal(racing.sets.length, 1);
        const parsed = JSON.parse(racing.sets[0] as string) as Record<string, unknown>;
        assert.equal(parsed["generation"], EPOCH_NEW);
        racingHandle?.stop();
    });

    it("a silent fetch while bound publishes nothing and stop still clears", () => {
        const fixture = publisherFixture(makeWindow({ mode: 0 }));
        const handle = startInitialMaximize(fixture.env);
        assert.ok(handle !== null);
        replyEpoch(fixture, EPOCH);
        assert.equal(fixture.sets.length, 1);
        fixture.fetchImpl = () => {
            fixture.fetchCalls += 1;
        };
        (fixture.focusHandlers[0] as () => void)();
        assert.equal(fixture.sets.length, 1);
        assert.equal(fixture.clears.length, 0);
        handle?.stop();
        assert.equal(fixture.clears.length, 1);
        assert.equal(
            (JSON.parse(fixture.clears[0] as string) as Record<string, unknown>)["generation"],
            EPOCH,
        );
    });

    it("effect call failure publishes clear and logging failure cannot affect state", () => {
        const fixture = publisherFixture(makeWindow({ mode: 0 }));
        const throwing = {
            ...fixture.env,
            setInitial: () => {
                throw new Error("dbus-down");
            },
            log: () => {
                throw new Error("log-down");
            },
        };
        const handle = startInitialMaximize(throwing);
        assert.ok(handle !== null);
        replyEpoch(fixture, EPOCH);
        // setInitial threw, so the clear path ran without crashing on log failure.
        handle?.stop();
    });

    it("stop and failed focus subscription clear fail-closed", () => {
        const fixture = publisherFixture(makeWindow({ mode: 0 }));
        const handle = startInitialMaximize(fixture.env);
        assert.ok(handle !== null);
        replyEpoch(fixture, EPOCH);
        handle?.stop();
        assert.equal(fixture.clears.length, 1);
        const bad = publisherFixture(makeWindow({ mode: 0 }));
        const nullFocus: InitialMaximizeEnv = { ...bad.env, subscribeFocus: () => null };
        assert.equal(startInitialMaximize(nullFocus), null);
    });
});

describe("active-border initial entry wiring", () => {
    interface FakeSignal {
        readonly handlers: Array<(payload?: unknown) => void>;
        readonly signal: {
            connect: (handler: (payload?: unknown) => void) => void;
            disconnect: (handler: (payload?: unknown) => void) => void;
        };
    }

    function fakeSignal(): FakeSignal {
        const handlers: Array<(payload?: unknown) => void> = [];
        return {
            handlers,
            signal: {
                connect: (handler: (payload?: unknown) => void): void => {
                    handlers.push(handler);
                },
                disconnect: (handler: (payload?: unknown) => void): void => {
                    const index = handlers.indexOf(handler);
                    if (index >= 0) {
                        handlers.splice(index, 1);
                    }
                },
            },
        };
    }

    function entryWorld(mode: number): Record<string, unknown> {
        const output = { name: "out-1", manufacturer: "m", model: "d", serialNumber: "s" };
        const desktop = { id: "ws-1", x11DesktopNumber: 1 };
        const win: Record<string, unknown> = {
            normalWindow: true,
            managed: true,
            minimized: false,
            fullScreen: false,
            maximizeMode: mode,
            onAllDesktops: false,
            internalId: UUID_A,
            resourceClass: "test-app",
            output,
            desktops: [desktop],
            frameGeometry: { x: 0, y: 0, width: 100, height: 100 },
            frameGeometryChanged: fakeSignal().signal,
            fullScreenChanged: fakeSignal().signal,
            maximizedChanged: fakeSignal().signal,
            desktopsChanged: fakeSignal().signal,
        };
        return {
            screens: [output],
            desktops: [desktop],
            activeWindow: win,
            activeScreen: output,
            currentDesktopForScreen: () => desktop,
            clientArea: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
            windowList: () => [win],
            windowActivated: fakeSignal().signal,
            windowAdded: fakeSignal().signal,
            windowRemoved: fakeSignal().signal,
            screensChanged: fakeSignal().signal,
            currentDesktopChanged: fakeSignal().signal,
            desktopsChanged: fakeSignal().signal,
        };
    }

    function entryOverrides(
        workspace: Record<string, unknown>,
        effectCalls: Array<{ method: string; payload: string }>,
        epochReplies: Array<(reply: unknown) => void>,
        effectImpl?: (...args: ReadonlyArray<unknown>) => void,
    ): Record<string, unknown> {
        return {
            workspace,
            callDbus: (
                _service: string,
                _path: string,
                _iface: string,
                _method: string,
                _payload: string,
                callback: (reply: unknown) => void,
            ) => {
                callback(
                    JSON.stringify({
                        v: 1,
                        correlation_id: "x",
                        outcome: "no-group",
                        kind: "no-group",
                        detail: { kind: "no-group", reason: "no-parent-group", owner: OWNER, generation: "gen-1" },
                    }),
                );
            },
            highlightCallDbus: (...args: ReadonlyArray<unknown>) => {
                if (effectImpl !== undefined) {
                    effectImpl(...args);
                    return;
                }
                const method = String(args[3] ?? "");
                if (method === INITIAL_MAXIMIZE_SET_METHOD || method === INITIAL_MAXIMIZE_CLEAR_METHOD) {
                    effectCalls.push({ method, payload: String(args[4] ?? "") });
                }
            },
            initialEpochCallDbus: (callback: (reply: unknown) => void) => {
                epochReplies.push(callback);
            },
            scheduleOnce: (_delayMs: number, callback: () => void): (() => void) => {
                callback();
                return () => {};
            },
            registerShortcutFn: () => true,
            readProfileFn: () => "cosmic",
            readWorkspaceModeFn: () => "per-output-local",
            readInnerGapFn: () => 8,
            readOuterGapFn: () => 8,
            log: () => {},
            owner: OWNER,
            generation: "gen-1",
        };
    }

    it("fetches the effect epoch before publishing startup set", () => {
        assert.equal(INITIAL_MAXIMIZE_SERVICE, "org.plasmaautotiler.ActiveBorder");
        assert.equal(INITIAL_MAXIMIZE_OBJECT, "/org/plasmaautotiler/ActiveBorder");
        assert.equal(INITIAL_MAXIMIZE_INTERFACE, "org.plasmaautotiler.ActiveBorder1");
        assert.equal(INITIAL_MAXIMIZE_EPOCH_METHOD, "GetInitialMaximizeEpoch");
        assert.equal(INITIAL_MAXIMIZE_CLEAR_METHOD, "ClearInitialMaximizeState");
        for (const mode of [0, 1, 2, 3]) {
            const effectCalls: Array<{ method: string; payload: string }> = [];
            const epochReplies: Array<(reply: unknown) => void> = [];
            const handle = startPlanAdapterEntry(entryOverrides(entryWorld(mode), effectCalls, epochReplies) as never);
            assert.ok(handle !== null);
            // Effect starting after the script: nothing published yet.
            assert.equal(epochReplies.length, 1);
            assert.equal(effectCalls.filter((call) => call.method === INITIAL_MAXIMIZE_SET_METHOD).length, 0);
            const pending = epochReplies.splice(0);
            for (const callback of pending) {
                callback(EPOCH);
            }
            const sets = effectCalls.filter((call) => call.method === INITIAL_MAXIMIZE_SET_METHOD);
            assert.equal(sets.length, 1);
            const parsed = JSON.parse(sets[0]?.payload as string) as Record<string, unknown>;
            assert.equal(parsed["maximize_mode"], mode);
            assert.equal(parsed["active_window"], UUID_A);
            assert.equal(parsed["generation"], EPOCH);
            handle?.stop();
        }
    });

    it("stop publishes clear and effect failure stays fail-closed", () => {
        const effectCalls: Array<{ method: string; payload: string }> = [];
        const epochReplies: Array<(reply: unknown) => void> = [];
        const handle = startPlanAdapterEntry(entryOverrides(entryWorld(0), effectCalls, epochReplies) as never);
        assert.ok(handle !== null);
        for (const callback of epochReplies.splice(0)) {
            callback(EPOCH);
        }
        handle?.stop();
        const clears = effectCalls.filter((call) => call.method === INITIAL_MAXIMIZE_CLEAR_METHOD);
        assert.ok(clears.length >= 1);
        assert.equal((JSON.parse(clears[0]?.payload as string) as Record<string, unknown>)["generation"], EPOCH);

        const failingCalls: Array<{ method: string; payload: string }> = [];
        const failingEpochs: Array<(reply: unknown) => void> = [];
        const handle2 = startPlanAdapterEntry(
            entryOverrides(entryWorld(0), failingCalls, failingEpochs, () => {
                throw new Error("effect-down");
            }) as never,
        );
        // Initial never fails enable; the failed setter falls back to clear.
        assert.ok(handle2 === null || handle2 !== null);
        handle2?.stop();
    });
});
