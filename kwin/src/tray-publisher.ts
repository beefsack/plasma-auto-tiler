export const TRAY_SCHEMA = 1;
export const TRAY_HEARTBEAT_MS = 1000;
export const MAX_SIGNED_REVISION = 2147483647;
// Join-identity gate: mirrors the tray-bridge contract generation pattern
// ([a-z0-9-]{1,32}). Only locally owned generations matching this pattern
// are carried in diagnostics; anything else is omitted, never echoed.
const GENERATION_PATTERN = /^[a-z0-9-]{1,32}$/;

export interface TrayPublisherEnvironment {
    readonly isEnabled: () => boolean;
    readonly publishSnapshot: (schema: number, generation: string, revision: number, enabled: boolean) => void;
    readonly scheduleOnce: (delayMs: number, callback: () => void) => (() => void) | void;
    readonly createGeneration?: () => string;
    readonly log?: (message: string) => void;
}

function processGeneration(): string {
    return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0x100000000).toString(36)}`;
}

export class TrayPublisher {
    private generation: string | undefined;
    private revision = 0;
    private enabled = false;
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

    private heartbeat(): void {
        // Steady-state heartbeat stays silent: only state changes, the first
        // send failure per snapshot, and the recovery that follows a recorded
        // failure emit diagnostics, never per-second spam.
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
    // identity (validated generation token, revision, enabled) so one
    // publication can be joined with the endpoint record on
    // generation/revision/enabled equality only; this never implies endpoint
    // acceptance and never claims correlation or request ancestry. Logging
    // never changes behavior: sink failures are swallowed.
    private diag(comp: "tray" | "bridge", event: string, result: string, detail = ""): void {
        try {
            this.environment.log?.(
                `plasma-auto-tiler:route-diag component=tray stage=${comp} event=${event} outcome=${result}${detail}`,
            );
        } catch (error) {
            void error;
        }
    }

    // Existing-protocol snapshot identity for bridge send lines. Revision and
    // enabled are typed values and always safe; the generation token is only
    // carried when it matches the contract pattern, otherwise omitted.
    private snapshotDetail(): string {
        const generation = this.generation ?? "";
        const generationPart = GENERATION_PATTERN.test(generation) ? ` generation=${generation}` : "";
        return `${generationPart} revision=${this.revision} enabled=${this.enabled}`;
    }

    // Internal dedupe key only, never logged.
    private failureKey(): string {
        return `${this.generation ?? ""}|${this.revision}|${this.enabled}`;
    }

    private publish(announce: boolean): void {
        if (this.generation === undefined) {
            return;
        }
        const key = this.failureKey();
        const detail = this.snapshotDetail();
        try {
            this.environment.publishSnapshot(TRAY_SCHEMA, this.generation, this.revision, this.enabled);
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
