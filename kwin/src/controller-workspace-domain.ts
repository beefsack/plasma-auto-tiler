import { MAX_SEQUENTIAL_LENGTH, type OutputCapability, type WindowCapability } from "./boundary";

export interface WorkspaceDomain {
    readonly deferDesktopIntent: (window: WindowCapability) => void;
    readonly deferWorkspaceZero: (output: OutputCapability) => void;
    readonly drainPendingDesktopIntents: () => void;
    readonly drainPendingWorkspaceZero: () => void;
}

export interface WorkspaceDomainCapabilities {
    readonly isEnabled: () => boolean;
    readonly mutationDeferred: () => boolean;
    readonly finishMoveToTrailing: (window: WindowCapability) => void;
    readonly finishWorkspaceZero: (output: OutputCapability) => void;
    readonly diagnostic: (event: string) => void;
}

export function createWorkspaceDomain(capabilities: WorkspaceDomainCapabilities): WorkspaceDomain {
    const pendingDesktopIntents: WindowCapability[] = [];
    const pendingWorkspaceZeroOutputs: OutputCapability[] = [];
    const { isEnabled, mutationDeferred, finishMoveToTrailing, finishWorkspaceZero, diagnostic } = capabilities;

    const deferDesktopIntent = (window: WindowCapability): void => {
        if (pendingDesktopIntents.length < MAX_SEQUENTIAL_LENGTH) {
            pendingDesktopIntents.push(window);
        }
        diagnostic("workspace-create-deferred:move");
    };

    const deferWorkspaceZero = (output: OutputCapability): void => {
        if (pendingWorkspaceZeroOutputs.length < MAX_SEQUENTIAL_LENGTH && !pendingWorkspaceZeroOutputs.includes(output)) {
            pendingWorkspaceZeroOutputs.push(output);
        }
        diagnostic("workspace-zero-deferred");
    };

    const drainPendingWorkspaceZero = (): void => {
        if (!isEnabled() || mutationDeferred()) {
            return;
        }
        const pending = pendingWorkspaceZeroOutputs.splice(0, pendingWorkspaceZeroOutputs.length);
        for (const output of pending) {
            finishWorkspaceZero(output);
        }
    };

    const drainPendingDesktopIntents = (): void => {
        if (!isEnabled() || mutationDeferred()) {
            return;
        }
        const pending = pendingDesktopIntents.splice(0, pendingDesktopIntents.length);
        for (const window of pending) {
            finishMoveToTrailing(window);
        }
        drainPendingWorkspaceZero();
    };

    return {
        deferDesktopIntent,
        deferWorkspaceZero,
        drainPendingDesktopIntents,
        drainPendingWorkspaceZero,
    };
}
