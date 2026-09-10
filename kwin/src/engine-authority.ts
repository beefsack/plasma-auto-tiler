// Packaged engine-authority dispatcher (mode-gated, opt-in only).
//
// Legacy default: inert. The dispatcher is never started and no adapter
// entry runs; the existing controller callbacks and the legacy pointer
// subscription remain the only authority.
//
// rust-development: exactly one dispatcher path starts the four adapter
// entries (focus, movement, keyboard resize, pointer resize) with one exact
// owner/generation binding and one shared revision holder, plus function-form
// exclusive authority predicates. All four slices advance the same holder so
// sequential commands bind the single Rust session revision. After activation
// the dispatcher invokes the resize slice's one-shot exact-three adoption,
// which seeds through the normal public plan contract for exactly three
// eligible windows and skips fail-closed otherwise. The entries use the
// normal Planner D-Bus discovery already built into the adapters; no policy
// is implemented here. Any start, service, identity, stale, or diverged loss
// leaves the Rust path disabled/refused and never invokes legacy.

import { startFocusAdapterEntry, type FocusEntryHandle } from "./focus-adapter-entry";
import { startMovementAdapterEntry, type MovementEntryHandle } from "./movement-adapter-entry";
import { startPointerResizeAdapterEntry, type PointerResizeEntryHandle } from "./pointer-resize-adapter-entry";
import { startResizeAdapterEntry, type ResizeEntryHandle } from "./resize-adapter-entry";
import { formatRouteDiag } from "./route-diag";
import type { EngineAuthorityMode } from "./controller-config";

export const ENGINE_AUTHORITY_OWNER = "plasma-auto-tiler";
export const ENGINE_AUTHORITY_GENERATION = "packaged-rust-1";
export const ENGINE_AUTHORITY_REVISION = 0;

// Shared one-session revision binding: one holder object is passed to all
// four slices so sequential commands across slices advance the same counter
// and bind the single Rust revision. Adapters read and write through it;
// the holder starts at ENGINE_AUTHORITY_REVISION so the first request still
// carries the Rust post-seed base.
export interface EngineAuthorityRevision {
    current: number;
}

export function createEngineAuthorityRevision(): EngineAuthorityRevision {
    return { current: ENGINE_AUTHORITY_REVISION };
}

export type AuthorityDirection = "left" | "right" | "up" | "down";
export type AuthorityResizeMode = "outwards" | "inwards";

export interface EngineAuthorityStarts {
    readonly startFocus: (args: {
        readonly owner: string;
        readonly generation: string;
        readonly revision: EngineAuthorityRevision;
        readonly hasExclusiveFocusAuthority: () => boolean;
    }) => FocusEntryHandle | null;
    readonly startMovement: (args: {
        readonly owner: string;
        readonly generation: string;
        readonly revision: EngineAuthorityRevision;
        readonly hasExclusiveMovementAuthority: () => boolean;
    }) => MovementEntryHandle | null;
    readonly startResize: (args: {
        readonly owner: string;
        readonly generation: string;
        readonly revision: EngineAuthorityRevision;
        readonly hasExclusiveResizeAuthority: () => boolean;
    }) => ResizeEntryHandle | null;
    readonly startPointerResize: (args: {
        readonly owner: string;
        readonly generation: string;
        readonly revision: EngineAuthorityRevision;
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

// Bounded command identity for the keyboard delivery diagnostic: only the
// four cardinal directions and the two resize modes are ever named, so the
// token vocabulary stays fixed and carries no window or scope contents.
const COMMAND_DIRECTIONS: readonly AuthorityDirection[] = Object.freeze([
    "left",
    "right",
    "up",
    "down",
]);

function normalizeCommandDirection(value: unknown): AuthorityDirection | "unknown" {
    for (const direction of COMMAND_DIRECTIONS) {
        if (value === direction) {
            return direction;
        }
    }
    return "unknown";
}

function normalizeCommandResizeMode(value: unknown): AuthorityResizeMode | "unknown" {
    if (value === "outwards" || value === "inwards") {
        return value;
    }
    return "unknown";
}

// Fixed closed failed-slice attribution for attach diagnostics: exactly one
// token naming the single null slice, else the bounded `multiple` token for
// thrown or multi-null losses. Slice names only, no identities or payloads.
function describeAttachFailure(
    focus: unknown,
    movement: unknown,
    resize: unknown,
    pointer: unknown,
): string {
    const failed: string[] = [];
    if (focus === null) {
        failed.push("focus");
    }
    if (movement === null) {
        failed.push("movement");
    }
    if (resize === null) {
        failed.push("resize");
    }
    if (pointer === null) {
        failed.push("pointer");
    }
    if (failed.length === 1) {
        return failed[0] as string;
    }
    return "multiple";
}

export class EngineAuthorityDispatcher {
    private focusHandle: FocusEntryHandle | null = null;
    private movementHandle: MovementEntryHandle | null = null;
    private resizeHandle: ResizeEntryHandle | null = null;
    private pointerHandle: PointerResizeEntryHandle | null = null;
    private rustAvailable = false;
    private rustResizeMode: AuthorityResizeMode | null = null;
    private readonly revisionBinding: EngineAuthorityRevision;
    // One-shot lazy retry: a boot-time empty/ineligible-scope start loss stays
    // fail-closed until the first authority-gated production command, which
    // makes exactly one fresh all-or-nothing start() through the same shared
    // revision binding and exact-three bootstrap. Never polled, never per
    // signal, never legacy.
    private lazyRetryUsed = false;
    // Monotonic per-dispatcher command ordinal for route diagnostics: links
    // one physical command to its retry/refusal outcome. Count only.
    private cmdSeq = 0;

    constructor(
        private readonly mode: EngineAuthorityMode,
        private readonly starts: EngineAuthorityStarts,
        private readonly log: (message: string) => void,
        initialRevision?: number,
    ) {
        // Continuity across dispatcher recreation (e.g. controller reload):
        // adopt the previous in-memory revision when it is a valid revision,
        // else start fresh at ENGINE_AUTHORITY_REVISION so the first request
        // can still seed through the normal public exact-three contract.
        // No persistence, settings, or global side channel; stale values
        // simply diverge fail-closed on the service. Never touches legacy.
        if (
            typeof initialRevision === "number" &&
            Number.isInteger(initialRevision) &&
            initialRevision >= 0 &&
            initialRevision <= 1000000
        ) {
            this.revisionBinding = { current: initialRevision };
        } else {
            this.revisionBinding = createEngineAuthorityRevision();
        }
    }

    // In-memory revision handover for recreation: the controller may adopt
    // this snapshot when constructing a replacement dispatcher. No I/O.
    revisionSnapshot(): number {
        return this.revisionBinding.current;
    }

    hasExclusiveRustAuthority = (): boolean => this.isRustActive();

    isRustActive(): boolean {
        return this.mode === "rust-development" && this.rustAvailable;
    }

    start(): boolean {
        if (this.mode !== "rust-development") {
            return false;
        }
        // Idempotent: an active authority never re-attaches, so repeated
        // commands after a successful (re)try cannot duplicate callbacks.
        if (this.isRustActive()) {
            return true;
        }
        const binding = {
            owner: ENGINE_AUTHORITY_OWNER,
            generation: ENGINE_AUTHORITY_GENERATION,
            revision: this.revisionBinding,
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
            try {
                this.log(
                    formatRouteDiag("attach", [
                        ["result", "unavailable"],
                        ["slices", 4],
                        ["gen", ENGINE_AUTHORITY_GENERATION],
                        ["rev", this.revisionBinding.current],
                        ["failed", describeAttachFailure(focus, movement, resize, pointer)],
                    ]),
                );
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
        try {
            this.log(
                formatRouteDiag("attach", [
                    ["result", "ready"],
                    ["slices", 4],
                    ["gen", ENGINE_AUTHORITY_GENERATION],
                    ["rev", this.revisionBinding.current],
                ]),
            );
        } catch (error) {
            void error;
        }
        // One-shot exact-three adoption through the normal resize flight.
        // Best effort: any failure stays armed for the first user command,
        // which seeds through the same public contract. Never refuses here
        // and never touches legacy.
        try {
            this.resizeHandle.tryBootstrapTrio?.();
        } catch (error) {
            void error;
        }
        return true;
    }

    // Authority-gated lazy one-shot retry. Invoked on the first actual
    // rust-authority request after a boot-time start loss so production
    // validates the exact-three eligible scope at command time through the
    // existing adapters/bootstrap. Exactly one fresh all-or-nothing start();
    // active authorities and consumed retries never re-attach. Fail-closed
    // with no legacy route.
    ensureStarted(): boolean {
        if (this.mode !== "rust-development") {
            return false;
        }
        if (this.isRustActive()) {
            return true;
        }
        if (this.lazyRetryUsed) {
            try {
                this.log(
                    formatRouteDiag("retry", [
                        ["decision", "consumed"],
                        ["result", "refused"],
                        ["gen", ENGINE_AUTHORITY_GENERATION],
                        ["rev", this.revisionBinding.current],
                    ]),
                );
            } catch (error) {
                void error;
            }
            return false;
        }
        this.lazyRetryUsed = true;
        const retried = this.start();
        try {
            this.log(
                formatRouteDiag("retry", [
                    ["decision", "retry"],
                    ["result", retried ? "ready" : "unavailable"],
                    ["gen", ENGINE_AUTHORITY_GENERATION],
                    ["rev", this.revisionBinding.current],
                ]),
            );
        } catch (error) {
            void error;
        }
        return retried;
    }

    // Delivery diagnostic for the keyboard shortcut callback route: one
    // fixed token per routed Rust command identifying the slice and the
    // bounded direction/mode. Emitted at dispatcher entry before the one-shot
    // retry outcome, so a single Meta+Arrow attempt proves callback delivery
    // even when the retry stays fail-closed. Rust-development only; the
    // legacy mode never emits. Fixed vocabulary only, no window contents.
    // focusOrResize delegates to requestFocus/requestResize and stays silent
    // itself so each physical press logs exactly once.
    private commandReceived(kind: "focus" | "move" | "resize" | "resize-mode", detail: string): void {
        if (this.mode !== "rust-development") {
            return;
        }
        try {
            this.log(`plasma-auto-tiler:engine-authority-rust-command:${kind}:${detail}`);
        } catch (error) {
            void error;
        }
        // Correlated command line: monotonic seq plus the shared authority
        // generation/revision so one press links to its retry/refusal and to
        // the adapter correlation emitted downstream. Fixed categories and
        // counts only.
        try {
            this.cmdSeq += 1;
            const parts = detail.split(":");
            const fields: Array<readonly [string, unknown]> = [
                ["seq", this.cmdSeq],
                ["kind", kind],
                ["detail", parts[0] ?? "unknown"],
                ["gen", ENGINE_AUTHORITY_GENERATION],
                ["rev", this.revisionBinding.current],
            ];
            // Resize commands carry `direction:mode`; keep both as separate
            // fixed-category fields rather than a joined token.
            if (kind === "resize" && parts[1] !== undefined) {
                fields.push(["mode", parts[1]]);
            }
            this.log(formatRouteDiag("cmd", fields));
        } catch (error) {
            void error;
        }
    }

    private refusedDiag(kind: "focus" | "move" | "resize" | "resize-mode"): void {
        // Rust-development only: legacy stays silent (no cmd seq exists to
        // link against, so an ungated line would emit orphan seq=0).
        if (this.mode !== "rust-development") {
            return;
        }
        // Links the refusal to the command seq above. Count/category only.
        try {
            this.log(
                formatRouteDiag("retry", [
                    ["decision", "refused"],
                    ["kind", kind],
                    ["seq", this.cmdSeq],
                    ["gen", ENGINE_AUTHORITY_GENERATION],
                    ["rev", this.revisionBinding.current],
                ]),
            );
        } catch (error) {
            void error;
        }
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
        this.commandReceived("focus", normalizeCommandDirection(direction));
        this.ensureStarted();
        if (!this.isRustActive() || this.focusHandle === null) {
            try {
                this.log("plasma-auto-tiler:engine-authority-rust-refused");
            } catch (error) {
                void error;
            }
            this.refusedDiag("focus");
            return;
        }
        try {
            this.focusHandle.request(direction);
        } catch (error) {
            void error;
        }
    }

    requestMove(direction: AuthorityDirection): void {
        this.commandReceived("move", normalizeCommandDirection(direction));
        this.ensureStarted();
        if (!this.isRustActive() || this.movementHandle === null) {
            try {
                this.log("plasma-auto-tiler:engine-authority-rust-refused");
            } catch (error) {
                void error;
            }
            this.refusedDiag("move");
            return;
        }
        try {
            this.movementHandle.request(direction);
        } catch (error) {
            void error;
        }
    }

    requestResize(direction: AuthorityDirection, resizeMode: AuthorityResizeMode): void {
        this.commandReceived(
            "resize",
            `${normalizeCommandDirection(direction)}:${normalizeCommandResizeMode(resizeMode)}`,
        );
        this.ensureStarted();
        if (!this.isRustActive() || this.resizeHandle === null) {
            try {
                this.log("plasma-auto-tiler:engine-authority-rust-refused");
            } catch (error) {
                void error;
            }
            this.refusedDiag("resize");
            return;
        }
        try {
            this.resizeHandle.request(direction, resizeMode);
        } catch (error) {
            void error;
        }
    }

    enterOrExitRustResizeMode(resizeMode: AuthorityResizeMode): void {
        this.commandReceived("resize-mode", normalizeCommandResizeMode(resizeMode));
        this.ensureStarted();
        if (!this.isRustActive()) {
            try {
                this.log("plasma-auto-tiler:engine-authority-rust-refused");
            } catch (error) {
                void error;
            }
            this.refusedDiag("resize-mode");
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
    initialRevision?: number,
): EngineAuthorityDispatcher {
    return new EngineAuthorityDispatcher(mode, starts, log, initialRevision);
}

export function createPackagedEngineAuthority(
    mode: EngineAuthorityMode,
    log: (message: string) => void,
    initialRevision?: number,
): EngineAuthorityDispatcher {
    return new EngineAuthorityDispatcher(mode, packagedEngineAuthorityStarts(), log, initialRevision);
}
