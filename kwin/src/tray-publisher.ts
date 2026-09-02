export const TRAY_SCHEMA = 1;
export const TRAY_HEARTBEAT_MS = 1000;
export const MAX_SIGNED_REVISION = 2147483647;

export interface TrayPublisherEnvironment {
    readonly isEnabled: () => boolean;
    readonly publishSnapshot: (schema: number, generation: string, revision: number, enabled: boolean) => void;
    readonly scheduleOnce: (delayMs: number, callback: () => void) => (() => void) | void;
    readonly createGeneration?: () => string;
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
        this.publish();
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
        this.publish();
    }

    private heartbeat(): void {
        this.publish();
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
        this.cancelHeartbeat?.();
        this.cancelHeartbeat = undefined;
    }

    private publish(): void {
        if (this.generation === undefined) {
            return;
        }
        try {
            this.environment.publishSnapshot(TRAY_SCHEMA, this.generation, this.revision, this.enabled);
        } catch (error) {
            void error;
        }
    }
}
