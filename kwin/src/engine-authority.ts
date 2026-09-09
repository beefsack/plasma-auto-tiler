// Packaged engine-authority dispatcher (mode-gated, opt-in only).
//
// Legacy default: inert. The dispatcher is never started and no adapter
// entry runs; the existing controller callbacks and the legacy pointer
// subscription remain the only authority.
//
// rust-development: exactly one dispatcher path starts the four adapter
// entries (focus, movement, keyboard resize, pointer resize) with one exact
// owner/generation/revision binding and function-form exclusive authority
// predicates. The entries use the normal Planner D-Bus discovery already
// built into the adapters; no policy is implemented here. Any start,
// service, identity, stale, or diverged loss leaves the Rust path
// disabled/refused and never invokes legacy.

import { startFocusAdapterEntry, type FocusEntryHandle } from "./focus-adapter-entry";
import { startMovementAdapterEntry, type MovementEntryHandle } from "./movement-adapter-entry";
import { startPointerResizeAdapterEntry, type PointerResizeEntryHandle } from "./pointer-resize-adapter-entry";
import { startResizeAdapterEntry, type ResizeEntryHandle } from "./resize-adapter-entry";
import type { EngineAuthorityMode } from "./controller-config";

export const ENGINE_AUTHORITY_OWNER = "plasma-auto-tiler";
export const ENGINE_AUTHORITY_GENERATION = "packaged-rust-1";
export const ENGINE_AUTHORITY_REVISION = 0;

export type AuthorityDirection = "left" | "right" | "up" | "down";
export type AuthorityResizeMode = "outwards" | "inwards";

export interface EngineAuthorityStarts {
    readonly startFocus: (args: {
        readonly owner: string;
        readonly generation: string;
        readonly revision: number;
        readonly hasExclusiveFocusAuthority: () => boolean;
    }) => FocusEntryHandle | null;
    readonly startMovement: (args: {
        readonly owner: string;
        readonly generation: string;
        readonly revision: number;
        readonly hasExclusiveMovementAuthority: () => boolean;
    }) => MovementEntryHandle | null;
    readonly startResize: (args: {
        readonly owner: string;
        readonly generation: string;
        readonly revision: number;
        readonly hasExclusiveResizeAuthority: () => boolean;
    }) => ResizeEntryHandle | null;
    readonly startPointerResize: (args: {
        readonly owner: string;
        readonly generation: string;
        readonly revision: number;
        readonly hasExclusiveResizeAuthority: () => boolean;
    }) => PointerResizeEntryHandle | null;
}

export function packagedEngineAuthorityStarts(): EngineAuthorityStarts {
    return {
        startFocus: (args) => startFocusAdapterEntry(args),
        startMovement: (args) => startMovementAdapterEntry(args),
        startResize: (args) => startResizeAdapterEntry(args),
        startPointerResize: (args) => startPointerResizeAdapterEntry(args),
    };
}

export class EngineAuthorityDispatcher {
    private focusHandle: FocusEntryHandle | null = null;
    private movementHandle: MovementEntryHandle | null = null;
    private resizeHandle: ResizeEntryHandle | null = null;
    private pointerHandle: PointerResizeEntryHandle | null = null;
    private rustAvailable = false;
    private rustResizeMode: AuthorityResizeMode | null = null;

    constructor(
        private readonly mode: EngineAuthorityMode,
        private readonly starts: EngineAuthorityStarts,
        private readonly log: (message: string) => void,
    ) {}

    hasExclusiveRustAuthority = (): boolean => this.isRustActive();

    isRustActive(): boolean {
        return this.mode === "rust-development" && this.rustAvailable;
    }

    start(): boolean {
        if (this.mode !== "rust-development") {
            return false;
        }
        const binding = {
            owner: ENGINE_AUTHORITY_OWNER,
            generation: ENGINE_AUTHORITY_GENERATION,
            revision: ENGINE_AUTHORITY_REVISION,
        };
        const authority = this.hasExclusiveRustAuthority;
        let focus: FocusEntryHandle | null = null;
        let movement: MovementEntryHandle | null = null;
        let resize: ResizeEntryHandle | null = null;
        let pointer: PointerResizeEntryHandle | null = null;
        try {
            focus = this.starts.startFocus({ ...binding, hasExclusiveFocusAuthority: authority });
            movement = this.starts.startMovement({ ...binding, hasExclusiveMovementAuthority: authority });
            resize = this.starts.startResize({ ...binding, hasExclusiveResizeAuthority: authority });
            pointer = this.starts.startPointerResize({ ...binding, hasExclusiveResizeAuthority: authority });
        } catch (error) {
            void error;
            focus = null;
            movement = null;
            resize = null;
            pointer = null;
        }
        if (focus === null || movement === null || resize === null || pointer === null) {
            try {
                focus?.stop();
            } catch (error) {
                void error;
            }
            try {
                movement?.stop();
            } catch (error) {
                void error;
            }
            try {
                resize?.stop();
            } catch (error) {
                void error;
            }
            try {
                pointer?.stop();
            } catch (error) {
                void error;
            }
            this.focusHandle = null;
            this.movementHandle = null;
            this.resizeHandle = null;
            this.pointerHandle = null;
            this.rustAvailable = false;
            try {
                this.log("plasma-auto-tiler:engine-authority-rust-unavailable");
            } catch (error) {
                void error;
            }
            return false;
        }
        this.focusHandle = focus;
        this.movementHandle = movement;
        this.resizeHandle = resize;
        this.pointerHandle = pointer;
        this.rustAvailable = true;
        try {
            this.log("plasma-auto-tiler:engine-authority-rust-ready");
        } catch (error) {
            void error;
        }
        return true;
    }

    stop(): void {
        const focus = this.focusHandle;
        const movement = this.movementHandle;
        const resize = this.resizeHandle;
        const pointer = this.pointerHandle;
        this.focusHandle = null;
        this.movementHandle = null;
        this.resizeHandle = null;
        this.pointerHandle = null;
        this.rustAvailable = false;
        this.rustResizeMode = null;
        for (const handle of [focus, movement, resize, pointer]) {
            try {
                handle?.stop();
            } catch (error) {
                void error;
            }
        }
    }

    requestFocus(direction: AuthorityDirection): void {
        if (!this.isRustActive() || this.focusHandle === null) {
            try {
                this.log("plasma-auto-tiler:engine-authority-rust-refused");
            } catch (error) {
                void error;
            }
            return;
        }
        try {
            this.focusHandle.request(direction);
        } catch (error) {
            void error;
        }
    }

    requestMove(direction: AuthorityDirection): void {
        if (!this.isRustActive() || this.movementHandle === null) {
            try {
                this.log("plasma-auto-tiler:engine-authority-rust-refused");
            } catch (error) {
                void error;
            }
            return;
        }
        try {
            this.movementHandle.request(direction);
        } catch (error) {
            void error;
        }
    }

    requestResize(direction: AuthorityDirection, resizeMode: AuthorityResizeMode): void {
        if (!this.isRustActive() || this.resizeHandle === null) {
            try {
                this.log("plasma-auto-tiler:engine-authority-rust-refused");
            } catch (error) {
                void error;
            }
            return;
        }
        try {
            this.resizeHandle.request(direction, resizeMode);
        } catch (error) {
            void error;
        }
    }

    enterOrExitRustResizeMode(resizeMode: AuthorityResizeMode): void {
        if (!this.isRustActive()) {
            try {
                this.log("plasma-auto-tiler:engine-authority-rust-refused");
            } catch (error) {
                void error;
            }
            return;
        }
        if (this.rustResizeMode === resizeMode) {
            this.rustResizeMode = null;
            try {
                this.log("plasma-auto-tiler:engine-authority-rust-resize-exited");
            } catch (error) {
                void error;
            }
            return;
        }
        const entering = this.rustResizeMode === null;
        this.rustResizeMode = resizeMode;
        try {
            this.log(
                entering
                    ? `plasma-auto-tiler:engine-authority-rust-resize-entered:${resizeMode}`
                    : `plasma-auto-tiler:engine-authority-rust-resize-switched:${resizeMode}`,
            );
        } catch (error) {
            void error;
        }
    }

    focusOrResize(direction: AuthorityDirection): void {
        const resizeMode = this.rustResizeMode;
        if (resizeMode !== null) {
            this.requestResize(direction, resizeMode);
            return;
        }
        this.requestFocus(direction);
    }

    rustResizeModeSnapshot(): AuthorityResizeMode | null {
        return this.rustResizeMode;
    }
}

export function createEngineAuthority(
    mode: EngineAuthorityMode,
    starts: EngineAuthorityStarts,
    log: (message: string) => void,
): EngineAuthorityDispatcher {
    return new EngineAuthorityDispatcher(mode, starts, log);
}

export function createPackagedEngineAuthority(
    mode: EngineAuthorityMode,
    log: (message: string) => void,
): EngineAuthorityDispatcher {
    return new EngineAuthorityDispatcher(mode, packagedEngineAuthorityStarts(), log);
}
