export const TRAY_SCHEMA = 1;
export const TRAY_HEARTBEAT_MS = 1000;
export const MAX_SIGNED_REVISION = 2147483647;

export interface TrayPublisherEnvironment {
    readonly isEnabled: () => boolean;
    readonly publishSnapshot: (schema: number, generation: string, revision: number, enabled: boolean) => void;
    readonly scheduleOnce: (delayMs: number, callback: () => void) => void;
    readonly createGeneration?: () => string;
}

function processGeneration(): string {
    return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0x100000000).toString(36)}`;
}

export class TrayPublisher {
    private generation: string;
    private revision = 0;
    private enabled = false;
    private started = false;
    private disposed = false;

    constructor(private readonly environment: TrayPublisherEnvironment) {
        this.generation = environment.createGeneration?.() ?? processGeneration();
    }

    start(): void {
        if (this.started || this.disposed) {
            return;
        }
        this.started = true;
        this.enabled = this.environment.isEnabled();
        this.publish();
        this.scheduleHeartbeat();
    }

    private scheduleHeartbeat(): void {
        if (this.disposed) {
            return;
        }
        this.environment.scheduleOnce(TRAY_HEARTBEAT_MS, () => {
            if (this.disposed) {
                return;
            }
            this.heartbeat();
            this.scheduleHeartbeat();
        });
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
    }

    private publish(): void {
        try {
            this.environment.publishSnapshot(TRAY_SCHEMA, this.generation, this.revision, this.enabled);
        } catch (error) {
            void error;
        }
    }
}
