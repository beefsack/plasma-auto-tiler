// Standalone signal-bound shadow projection KWin entry (opt-in only).
//
// Product-shaped but with no normal startup/builder route: ordinary
// production startup never runs this module (src/entry.ts must not import
// it), there is no builder, and nothing runs at import time. The only
// activation is the explicit exported startShadowProjectionEntry function,
// called by no production source.
//
// At start it uses the lexical KWin `workspace`, reuses the read-only
// advisory-snapshot trio capture (captureShadowProjectionObservation plus the
// non-leaking trio geometry binder) rather than duplicating
// eligibility/normalization, and produces the explicit current
// output/workspace work-area, exact-three opaque window primitive frame
// rects, active/focus binding, and a fixed 8px gap for the established
// H[A,V[B,C]] static slice. It subscribes through only the minimum stable
// signal callbacks to schedule recomputation: workspace windowActivated (the
// NOTIFY signal for the activeWindow property), windowAdded, windowRemoved,
// and frameGeometryChanged on the current observed trio. Trio geometry
// handlers are dynamically re-captured/rebound after every terminal
// recompute; any re-capture/rebind failure disables the projection and
// detaches current geometry handlers. Workspace attachments are
// disconnectable so partial setup detaches before failing and stop()
// detaches all handlers. No polling, no write/actuation/focus/tile/shortcut/workspace/
// output mutation. QTimer is used only via injected scheduling for
// coalescing. Any signal-attach or snapshot/revalidation failure fails
// closed. All logs are fixed redacted tokens.

import { ShadowProjection } from "./advisory-shadow-projection";
import {
    ADVISORY_SNAPSHOT_OUTPUT_ID,
    ADVISORY_SNAPSHOT_WORKSPACE_ID,
    attachShadowTrioGeometry,
    captureShadowProjectionObservation,
} from "./advisory-snapshot";

export const SHADOW_ENTRY_GAP = 8;
export const SHADOW_ENTRY_OWNER = "shadow-owner-1";
export const SHADOW_ENTRY_GENERATION = "shadow-gen-1";
export const SHADOW_ENTRY_MAX_REVISION = 1000000;

const SHADOW_ENTRY_LOG = "plasma-auto-tiler:shadow-entry";
const SHADOW_ENTRY_READY = `${SHADOW_ENTRY_LOG}:ready`;
const SHADOW_ENTRY_REJECT_INVALID = `${SHADOW_ENTRY_LOG}:reject:shadow-entry-invalid`;
const SHADOW_ENTRY_REJECT_SIGNAL = `${SHADOW_ENTRY_LOG}:reject:shadow-entry-signal-failed`;

export interface ShadowEntryOverrides {
    readonly workspace?: unknown;
    readonly callDbus?: (
        service: string,
        path: string,
        dbusInterface: string,
        method: string,
        payload: string,
        callback: (reply: unknown) => void,
    ) => void;
    readonly scheduleOnce?: (delayMs: number, callback: () => void) => () => void;
    readonly log?: (message: string) => void;
}

export interface ShadowEntryHandle {
    readonly stop: () => void;
    readonly requestRecompute: () => void;
}

function readProp(value: object, property: string): unknown {
    try {
        return Reflect.get(value, property);
    } catch (error) {
        void error;
        return undefined;
    }
}

function resolveLexicalWorkspace(): unknown {
    try {
        const candidate: unknown = workspace;
        if (typeof candidate === "object" && candidate !== null) {
            return candidate;
        }
    } catch (error) {
        void error;
    }
    return null;
}

function resolveCallDbus(
    override: ShadowEntryOverrides["callDbus"],
): ShadowEntryOverrides["callDbus"] {
    if (override !== undefined) {
        return override;
    }
    try {
        const native: unknown = callDBus;
        if (typeof native === "function") {
            return (service, path, dbusInterface, method, payload, callback) => {
                (native as (...args: readonly unknown[]) => void)(
                    service,
                    path,
                    dbusInterface,
                    method,
                    payload,
                    callback,
                );
            };
        }
    } catch (error) {
        void error;
    }
    return undefined;
}

function resolveScheduleOnce(
    override: ShadowEntryOverrides["scheduleOnce"],
): ShadowEntryOverrides["scheduleOnce"] {
    if (override !== undefined) {
        return override;
    }
    try {
        const ctor: unknown = QTimer;
        if (typeof ctor === "function") {
            return (delayMs, callback) => {
                const timer = new (ctor as new () => QTimer)();
                timer.interval = delayMs;
                timer.singleShot = true;
                timer.timeout.connect(callback);
                timer.start();
                return () => {
                    try {
                        timer.stop();
                    } catch (error) {
                        void error;
                    }
                };
            };
        }
    } catch (error) {
        void error;
    }
    return undefined;
}

function connectWorkspaceSignal(
    surface: Record<string, unknown>,
    name: "windowActivated" | "windowAdded" | "windowRemoved",
    handler: () => void,
): (() => void) | null {
    try {
        const signal = surface[name] as
            | { connect: (next: () => void) => void; disconnect: (next: () => void) => void }
            | undefined;
        if (typeof signal !== "object" || signal === null) {
            return null;
        }
        if (typeof signal.connect !== "function" || typeof signal.disconnect !== "function") {
            return null;
        }
        signal.connect(handler);
        return () => {
            try {
                signal.disconnect(handler);
            } catch (error) {
                void error;
            }
        };
    } catch (error) {
        void error;
        return null;
    }
}

// Explicit opt-in activation only; called by no production source. Returns a
// stop handle on success, null fail-closed after logging one fixed token.
export function startShadowProjectionEntry(overrides: ShadowEntryOverrides = {}): ShadowEntryHandle | null {
    const liveWorkspace: unknown =
        overrides.workspace !== undefined ? overrides.workspace : resolveLexicalWorkspace();
    const callDbus = resolveCallDbus(overrides.callDbus);
    const scheduleOnce = resolveScheduleOnce(overrides.scheduleOnce);
    const log = overrides.log ?? ((message: string): void => {
        try {
            console.log(message);
        } catch (error) {
            void error;
        }
    });
    const fail = (): null => {
        try {
            log(SHADOW_ENTRY_REJECT_INVALID);
        } catch (error) {
            void error;
        }
        return null;
    };
    if (
        typeof liveWorkspace !== "object" ||
        liveWorkspace === null ||
        callDbus === undefined ||
        scheduleOnce === undefined
    ) {
        return fail();
    }
    const surface = liveWorkspace as Record<string, unknown>;
    if (typeof readProp(surface, "windowList") !== "function") {
        return fail();
    }
    const initial = captureShadowProjectionObservation(liveWorkspace as Workspace);
    if (!initial.ok) {
        return fail();
    }
    let revision = 0;
    let lastRevalidate: (() => boolean) | null = initial.observation.revalidate;
    let trioDetach: (() => void) | null = null;
    let stopped = false;

    const projection = new ShadowProjection({
        callDbus,
        scheduleOnce,
        log: (message: string): void => {
            try {
                log(message);
            } catch (error) {
                void error;
            }
            if (
                message === "plasma-auto-tiler:shadow-projection:match" ||
                message === "plasma-auto-tiler:shadow-projection:divergence" ||
                message.indexOf("plasma-auto-tiler:shadow-projection:reject:") === 0
            ) {
                rebindTrio();
            }
        },
        provideInput: () => {
            if (stopped) {
                return null;
            }
            let captured: ReturnType<typeof captureShadowProjectionObservation> | null = null;
            try {
                captured = captureShadowProjectionObservation(liveWorkspace as Workspace);
            } catch (error) {
                void error;
                captured = null;
            }
            if (captured === null || !captured.ok) {
                return null;
            }
            if (revision < 0 || revision > SHADOW_ENTRY_MAX_REVISION) {
                return null;
            }
            const observation = captured.observation;
            lastRevalidate = observation.revalidate;
            const input = {
                correlationId: `shadow-${revision}`,
                owner: SHADOW_ENTRY_OWNER,
                generation: SHADOW_ENTRY_GENERATION,
                revision,
                output: {
                    id: ADVISORY_SNAPSHOT_OUTPUT_ID,
                    workspace: ADVISORY_SNAPSHOT_WORKSPACE_ID,
                    workArea: {
                        x: observation.output.workArea.x,
                        y: observation.output.workArea.y,
                        w: observation.output.workArea.w,
                        h: observation.output.workArea.h,
                    },
                },
                windows: observation.windows.map((entry) => ({
                    window: entry.window,
                    output: ADVISORY_SNAPSHOT_OUTPUT_ID,
                    workspace: ADVISORY_SNAPSHOT_WORKSPACE_ID,
                    rect: {
                        x: entry.rect.x,
                        y: entry.rect.y,
                        w: entry.rect.w,
                        h: entry.rect.h,
                    },
                })),
                gap: SHADOW_ENTRY_GAP,
                focusedWindow: observation.focusedWindow,
                capabilities: { shadow_projection: true },
            };
            revision += 1;
            return input;
        },
        revalidateInput: () => {
            try {
                const check = lastRevalidate;
                if (check === null) {
                    return false;
                }
                return check() === true;
            } catch (error) {
                void error;
                return false;
            }
        },
    });

    function detachTrio(): void {
        if (trioDetach !== null) {
            try {
                trioDetach();
            } catch (error) {
                void error;
            }
            trioDetach = null;
        }
    }

    function failClosedRebind(): void {
        detachTrio();
        try {
            projection.disable();
        } catch (error) {
            void error;
        }
    }

    function rebindTrio(): void {
        if (stopped) {
            return;
        }
        try {
            detachTrio();
            let current: ReturnType<typeof captureShadowProjectionObservation> | null = null;
            try {
                current = captureShadowProjectionObservation(liveWorkspace as Workspace);
            } catch (error) {
                void error;
                current = null;
            }
            if (current === null || !current.ok) {
                failClosedRebind();
                return;
            }
            const ids = current.observation.windows.map((entry) => entry.window);
            let bound: ReturnType<typeof attachShadowTrioGeometry>;
            try {
                bound = attachShadowTrioGeometry(liveWorkspace, ids, () => {
                    projection.requestRecompute();
                });
            } catch (error) {
                void error;
                failClosedRebind();
                return;
            }
            if (!bound.ok) {
                failClosedRebind();
                return;
            }
            trioDetach = bound.detach;
        } catch (error) {
            void error;
            failClosedRebind();
        }
    }

    function detachWorkspace(signals: ReadonlyArray<(() => void) | null>): void {
        for (const detach of signals) {
            if (detach === null) {
                continue;
            }
            try {
                detach();
            } catch (error) {
                void error;
            }
        }
    }

    const onWorkspaceSignal = (): void => {
        projection.requestRecompute();
    };
    const detachActivated = connectWorkspaceSignal(surface, "windowActivated", onWorkspaceSignal);
    const detachAdded = connectWorkspaceSignal(surface, "windowAdded", onWorkspaceSignal);
    const detachRemoved = connectWorkspaceSignal(surface, "windowRemoved", onWorkspaceSignal);
    if (detachActivated === null || detachAdded === null || detachRemoved === null) {
        detachWorkspace([detachActivated, detachAdded, detachRemoved]);
        try {
            log(SHADOW_ENTRY_REJECT_SIGNAL);
        } catch (error) {
            void error;
        }
        return null;
    }
    const workspaceDetaches: ReadonlyArray<() => void> = [detachActivated, detachAdded, detachRemoved];
    const initialIds = initial.observation.windows.map((entry) => entry.window);
    let initialBound: ReturnType<typeof attachShadowTrioGeometry>;
    try {
        initialBound = attachShadowTrioGeometry(liveWorkspace, initialIds, () => {
            projection.requestRecompute();
        });
    } catch (error) {
        void error;
        detachWorkspace(workspaceDetaches);
        try {
            log(SHADOW_ENTRY_REJECT_SIGNAL);
        } catch (error) {
            void error;
        }
        return null;
    }
    if (!initialBound.ok) {
        detachWorkspace(workspaceDetaches);
        try {
            log(SHADOW_ENTRY_REJECT_SIGNAL);
        } catch (error) {
            void error;
        }
        return null;
    }
    trioDetach = initialBound.detach;
    projection.enable();
    try {
        log(SHADOW_ENTRY_READY);
    } catch (error) {
        void error;
    }
    projection.requestRecompute();
    return {
        stop: () => {
            stopped = true;
            try {
                if (trioDetach !== null) {
                    trioDetach();
                }
            } catch (error) {
                void error;
            }
            trioDetach = null;
            detachWorkspace(workspaceDetaches);
            try {
                projection.disable();
            } catch (error) {
                void error;
            }
        },
        requestRecompute: () => {
            projection.requestRecompute();
        },
    };
}
