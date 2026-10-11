export const TRAY_SCHEMA = 2;
export const TRAY_HEARTBEAT_MS = 1000;
export const MAX_SIGNED_REVISION = 2147483647;
// Join-identity gate: mirrors the tray-bridge contract generation pattern
// ([a-z0-9-]{1,32}). Only locally owned generations matching this pattern
// are carried in diagnostics; anything else is omitted, never echoed.
const GENERATION_PATTERN = /^[a-z0-9-]{1,32}$/;

export interface TrayPublisherEnvironment {
    readonly isEnabled: () => boolean;
    readonly publishSnapshot: (
        schema: number,
        generation: string,
        revision: number,
        enabled: boolean,
        currentScope: string,
        tiled: boolean,
        defaultTiled: boolean,
    ) => void;
    readonly scheduleOnce: (delayMs: number, callback: () => void) => (() => void) | void;
    readonly createGeneration?: () => string;
    readonly getScope?: () => string;
    readonly isTiled?: () => boolean;
    readonly getDefaultTiled?: () => boolean;
    readonly log?: (message: string) => void;
}

export function processGeneration(): string {
    return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0x100000000).toString(36)}`;
}

function readScope(env: TrayPublisherEnvironment): string {
    try {
        const scope = env.getScope?.();
        return typeof scope === "string" ? scope : "";
    } catch (error) {
        void error;
        return "";
    }
}

function readTiled(env: TrayPublisherEnvironment): boolean {
    try {
        const tiled = env.isTiled?.();
        return tiled === false ? false : true;
    } catch (error) {
        void error;
        return true;
    }
}

function readDefaultTiled(env: TrayPublisherEnvironment): boolean {
    try {
        const value = env.getDefaultTiled?.();
        return value === false ? false : true;
    } catch (error) {
        void error;
        return true;
    }
}

export class TrayPublisher {
    private generation: string | undefined;
    private revision = 0;
    private enabled = false;
    private currentScope = "";
    private tiled = true;
    private defaultTiled = true;
    private started = false;
    private disposed = false;
    private cancelHeartbeat: (() => void) | undefined;
    // Change-driven bridge failure memory only: the snapshot identity key of
    // the last emitted send failure, or undefined when the last attempt
    // succeeded. Heartbeat failures for an already-reported snapshot stay
    // silent; a new snapshot identity or a recovery success emits. Schedule,
    // state, publication, and retry behavior are unchanged.
    private lastBridgeFailure: string | undefined;

    constructor(private readonly environment: TrayPublisherEnvironment) {}

    start(): void {
        if (this.started || this.disposed) {
            return;
        }
        this.started = true;
        this.generation = this.environment.createGeneration?.() ?? processGeneration();
        this.enabled = this.environment.isEnabled();
        this.currentScope = readScope(this.environment);
        this.tiled = readTiled(this.environment);
        this.defaultTiled = readDefaultTiled(this.environment);
        this.diag("tray", "started", "ok");
        this.publish(true);
        this.scheduleHeartbeat();
    }

    private scheduleHeartbeat(): void {
        if (this.disposed) {
            return;
        }
        this.cancelHeartbeat = this.environment.scheduleOnce(TRAY_HEARTBEAT_MS, () => {
            this.cancelHeartbeat = undefined;
            if (this.disposed) {
                return;
            }
            this.heartbeat();
            this.scheduleHeartbeat();
        }) ?? undefined;
    }

    notifyEnabledChanged(enabled: boolean): void {
        if (!this.started || this.disposed || enabled === this.enabled) {
            return;
        }
        this.enabled = enabled;
        this.advanceRevision();
        this.diag("tray", "enabled-changed", "ok");
        this.publish(true);
    }

    // Workspace menu state changed (scope, tiled, or default). Advances the
    // revision and publishes immediately.
    notifyWorkspaceChanged(): void {
        if (!this.started || this.disposed) {
            return;
        }
        if (!this.refreshWorkspace()) {
            return;
        }
        this.advanceRevision();
        this.diag("tray", "workspace-changed", "ok");
        this.publish(true);
    }

    private refreshWorkspace(): boolean {
        const scope = readScope(this.environment);
        const tiled = readTiled(this.environment);
        const defaultTiled = readDefaultTiled(this.environment);
        if (scope === this.currentScope && tiled === this.tiled && defaultTiled === this.defaultTiled) {
            return false;
        }
        this.currentScope = scope;
        this.tiled = tiled;
        this.defaultTiled = defaultTiled;
        return true;
    }

    private heartbeat(): void {
        // Steady-state heartbeat stays silent; scope/state/default drift
        // still advances the revision so the menu never projects stale state.
        if (this.refreshWorkspace()) {
            this.advanceRevision();
            this.diag("tray", "workspace-changed", "ok");
            this.publish(true);
            return;
        }
        this.publish(false);
    }

    private advanceRevision(): void {
        if (this.revision === MAX_SIGNED_REVISION) {
            this.generation = this.environment.createGeneration?.() ?? processGeneration();
            this.revision = 0;
        } else {
            this.revision += 1;
        }
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.diag("tray", "stopped", "ok");
        this.cancelHeartbeat?.();
        this.cancelHeartbeat = undefined;
    }

    // Bounded best-effort publication diagnostics. Fixed vocabulary only:
    // component=tray, stage=tray|bridge, lifecycle/change/send events,
    // ok/failed outcomes. Only lifecycle transitions, state-change sends, the
    // first heartbeat failure per snapshot, and heartbeat recovery emit;
    // steady-state heartbeat sends stay silent. Snapshot transport errors are
    // never logged. Bridge send lines carry the existing-protocol snapshot
    // identity (validated generation token, revision, enabled, tiled,
    // default) so one publication can be joined with the endpoint record;
    // the workspace scope id is never logged. This never implies endpoint
    // acceptance and never claims correlation or request ancestry. Logging
    // never changes behavior: sink failures are swallowed.
    private diag(comp: "tray" | "bridge", event: string, result: string, detail = ""): void {
        try {
            this.environment.log?.(
                `omnitiler:route-diag component=tray stage=${comp} event=${event} outcome=${result}${detail}`,
            );
        } catch (error) {
            void error;
        }
    }

    // Existing-protocol snapshot identity for bridge send lines. Revision,
    // enabled, tiled, and default are typed values and always safe; the
    // generation token is only carried when it matches the contract pattern,
    // otherwise omitted. The scope id is never carried (native identifier).
    private snapshotDetail(): string {
        const generation = this.generation ?? "";
        const generationPart = GENERATION_PATTERN.test(generation) ? ` generation=${generation}` : "";
        return `${generationPart} revision=${this.revision} enabled=${this.enabled} tiled=${this.tiled} defaultTiled=${this.defaultTiled}`;
    }

    // Internal dedupe key only, never logged.
    private failureKey(): string {
        return `${this.generation ?? ""}|${this.revision}|${this.enabled}|${this.currentScope}|${this.tiled}|${this.defaultTiled}`;
    }

    private publish(announce: boolean): void {
        if (this.generation === undefined) {
            return;
        }
        const key = this.failureKey();
        const detail = this.snapshotDetail();
        try {
            this.environment.publishSnapshot(
                TRAY_SCHEMA,
                this.generation,
                this.revision,
                this.enabled,
                this.currentScope,
                this.tiled,
                this.defaultTiled,
            );
            // Bridge outcome for state-change sends only; heartbeat sends
            // stay silent to avoid per-second spam, except the recovery that
            // follows a recorded failure. Payload never logged.
            // Fire-and-forget send initiation only: publishSnapshot hands the
            // snapshot to callDBus with no reply, so this record never implies
            // endpoint acceptance.
            if (announce) {
                this.lastBridgeFailure = undefined;
                this.diag("bridge", "send-initiated", "ok", detail);
            } else if (this.lastBridgeFailure !== undefined) {
                this.lastBridgeFailure = undefined;
                this.diag("bridge", "send-initiated", "ok", detail);
            }
        } catch (error) {
            void error;
            if (announce) {
                this.lastBridgeFailure = key;
                try {
                    this.diag("bridge", "send-failed", "failed", detail);
                } catch (ignored) {
                    void ignored;
                }
            } else if (key !== this.lastBridgeFailure) {
                // First heartbeat failure for this snapshot is visible;
                // identical repeats stay silent to bound 1 Hz failure spam.
                this.lastBridgeFailure = key;
                try {
                    this.diag("bridge", "send-failed", "failed", detail);
                } catch (ignored) {
                    void ignored;
                }
            }
        }
    }
}
