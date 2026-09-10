import { formatLifecycleDiag } from "./route-diag";

export const TRAY_SCHEMA = 1;
export const TRAY_HEARTBEAT_MS = 1000;
export const MAX_SIGNED_REVISION = 2147483647;

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
        // Steady-state heartbeat stays silent: only state changes and
        // state-change send failures emit diagnostics, never per-second spam.
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
        this.disposed = true;
        this.diag("tray", "stopped", "ok");
        this.cancelHeartbeat?.();
        this.cancelHeartbeat = undefined;
    }

    // Best-effort lifecycle diagnostic: validated generation plus bounded
    // revision only. Never enabled state beyond the closed event, never
    // identities or payloads. Logging never changes publish decisions.
    private diag(comp: "tray" | "bridge", event: string, result: string): void {
        try {
            this.environment.log?.(
                formatLifecycleDiag(comp, event, this.generation, this.revision, result),
            );
        } catch (error) {
            void error;
        }
    }

    private publish(announce: boolean): void {
        if (this.generation === undefined) {
            return;
        }
        try {
            this.environment.publishSnapshot(TRAY_SCHEMA, this.generation, this.revision, this.enabled);
            // Bridge outcome for state-change sends only; heartbeat sends
            // stay silent to avoid per-second spam. Payload never logged.
            if (announce) {
                this.diag("bridge", "published", "ok");
            }
        } catch (error) {
            void error;
            if (!announce) {
                return;
            }
            try {
                this.diag("bridge", "send-failed", "failed");
            } catch (ignored) {
                void ignored;
            }
        }
    }
}
