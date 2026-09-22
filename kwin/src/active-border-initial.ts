// Initial active-border maximize-state handoff (script side).
//
// Narrow public active-window publisher reading only activeWindow,
// normalWindow, internalId, and maximizeMode. At startup, on active focus
// changes, and on the focused window's maximizedChanged, it publishes the
// exact current active native window plus its maximize mode to the
// effect-owned ActiveBorder endpoint. Native borders stay hidden until a
// valid current confirmation says the exact active window is normal
// (maximize_mode 0); unknown/unavailable never falls back to normal.
// Fullscreen and any maximize suppress both borders natively, and native
// transition signals stay authoritative: script state never writes geometry
// and never mutates native maximize tracking.
//
// The payload `generation` carries the effect-issued per-instance epoch,
// fetched asynchronously via `GetInitialMaximizeEpoch` before any publish.
// An unavailable fetch (throw or never-calling-back) never confirms; every
// lifecycle input re-reads the epoch first, so a later-starting or reloaded
// effect still yields eventual publication. The fetched epoch replaces only
// this handoff's generation; Plan/group generation is never touched.
//
// Effect endpoint (owned by the active-border effect):
//   service   org.plasmaautotiler.ActiveBorder
//   path      /org/plasmaautotiler/ActiveBorder
//   interface org.plasmaautotiler.ActiveBorder1
//   methods   SetInitialMaximizeState(QString) / ClearInitialMaximizeState(QString)
//             GetInitialMaximizeEpoch() -> QString
//
// Set payload (exact keys): {v:1, owner, generation, revision,
//   active_window, maximize_mode}. Clear payload (exact keys):
//   {v:1, owner, generation, revision, active_window:null}. Revision is a
// per-handoff, per-epoch monotonic safe integer starting at 0, independent
// of the Planner revision and the group stream. Every bound failure
// publishes a clear fail-closed. Logging failure never affects state. No
// retry, poll, or timer.
//
// Ordering: `just dev` loads the native effect before the script, so the
// epoch fetch succeeds on the first lifecycle input. For script-first /
// effect-later startup, no polling, retry, or owner watcher is added: both
// native borders stay temporarily hidden until the next focus or maximize
// lifecycle confirmation after the effect appears (the fetch re-reads the
// epoch on every lifecycle input, so a later-starting or reloaded effect
// still yields eventual publication).

import { normalizeNativeId } from "./native-id";

export const INITIAL_MAXIMIZE_SERVICE = "org.plasmaautotiler.ActiveBorder";
export const INITIAL_MAXIMIZE_OBJECT = "/org/plasmaautotiler/ActiveBorder";
export const INITIAL_MAXIMIZE_INTERFACE = "org.plasmaautotiler.ActiveBorder1";
export const INITIAL_MAXIMIZE_SET_METHOD = "SetInitialMaximizeState";
export const INITIAL_MAXIMIZE_CLEAR_METHOD = "ClearInitialMaximizeState";
export const INITIAL_MAXIMIZE_EPOCH_METHOD = "GetInitialMaximizeEpoch";

export const INITIAL_MAXIMIZE_MAX_REVISION = 9007199254740991;
export const INITIAL_MAXIMIZE_MAX_JSON = 1024;
export const INITIAL_MAXIMIZE_MAX_OWNER_LEN = 128;
export const INITIAL_MAXIMIZE_MAX_GENERATION_LEN = 64;

const LOG_PREFIX = "plasma-auto-tiler:initial-maximize";

export interface InitialMaximizeEnv {
    readonly owner: string;
    readonly getActiveWindow: () => unknown;
    readonly setInitial: (payload: string) => void;
    readonly clearInitial: (payload: string) => void;
    readonly fetchEpoch: (callback: (epoch: unknown) => void) => void;
    readonly subscribeFocus: (handler: () => void) => (() => void) | null;
    readonly subscribeWindowMaximized: (ref: object, handler: () => void) => (() => void) | null;
    readonly log: (message: string) => void;
}

export interface InitialMaximizeHandle {
    readonly stop: () => void;
    readonly publish: () => void;
}

function isOpaqueId(value: unknown, maxLen: number): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > maxLen) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        const alnum =
            (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
        if (!(alnum || code === 45 || code === 95 || code === 46)) {
            return false;
        }
    }
    return true;
}

function isGenerationId(value: unknown): value is string {
    if (typeof value !== "string" || value.length === 0 || value.length > INITIAL_MAXIMIZE_MAX_GENERATION_LEN) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (!((code >= 48 && code <= 57) || (code >= 97 && code <= 122) || code === 45)) {
            return false;
        }
    }
    return true;
}

function isRevision(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= INITIAL_MAXIMIZE_MAX_REVISION;
}

function isHex(byte: number): boolean {
    return (byte >= 48 && byte <= 57) || (byte >= 65 && byte <= 70) || (byte >= 97 && byte <= 102);
}

export function isUnbracedUuid(value: unknown): value is string {
    if (typeof value !== "string" || value.length !== 36) {
        return false;
    }
    for (let index = 0; index < 36; index += 1) {
        const code = value.charCodeAt(index);
        if (index === 8 || index === 13 || index === 18 || index === 23) {
            if (code !== 45) {
                return false;
            }
        } else if (!isHex(code)) {
            return false;
        }
    }
    return true;
}

function readProp(ref: object, property: string): unknown {
    try {
        return Reflect.get(ref, property);
    } catch (error) {
        void error;
        return undefined;
    }
}

// Formats the bounded Set QString payload. Returns null for any invalid input.
export function formatInitialMaximizeSet(
    owner: string,
    generation: string,
    revision: number,
    activeWindow: string,
    maximizeMode: number,
): string | null {
    if (!isOpaqueId(owner, INITIAL_MAXIMIZE_MAX_OWNER_LEN)) {
        return null;
    }
    if (!isGenerationId(generation)) {
        return null;
    }
    if (!isRevision(revision)) {
        return null;
    }
    if (!isUnbracedUuid(activeWindow)) {
        return null;
    }
    if (!isRevision(maximizeMode) || maximizeMode < 0 || maximizeMode > 3) {
        return null;
    }
    let payload = "";
    try {
        payload = JSON.stringify({
            v: 1,
            owner,
            generation,
            revision,
            active_window: activeWindow,
            maximize_mode: maximizeMode,
        });
    } catch (error) {
        void error;
        return null;
    }
    if (payload.length === 0 || payload.length > INITIAL_MAXIMIZE_MAX_JSON) {
        return null;
    }
    return payload;
}

// Formats the bounded Clear QString payload (active_window null). Returns
// null for any invalid input.
export function formatInitialMaximizeClear(owner: string, generation: string, revision: number): string | null {
    if (!isOpaqueId(owner, INITIAL_MAXIMIZE_MAX_OWNER_LEN)) {
        return null;
    }
    if (!isGenerationId(generation)) {
        return null;
    }
    if (!isRevision(revision)) {
        return null;
    }
    let payload = "";
    try {
        payload = JSON.stringify({
            v: 1,
            owner,
            generation,
            revision,
            active_window: null,
        });
    } catch (error) {
        void error;
        return null;
    }
    if (payload.length === 0 || payload.length > INITIAL_MAXIMIZE_MAX_JSON) {
        return null;
    }
    return payload;
}

export class InitialMaximizePublisher {
    private revision = 0;
    private boundEpoch: string | null = null;
    private fetchSeq = 0;
    private focusDetach: (() => void) | null = null;
    private windowDetach: (() => void) | null = null;
    private windowRef: object | null = null;
    private stopped = false;

    constructor(private readonly env: InitialMaximizeEnv) {}

    start(): boolean {
        if (!isOpaqueId(this.env.owner, INITIAL_MAXIMIZE_MAX_OWNER_LEN)) {
            return false;
        }
        if (
            typeof this.env.getActiveWindow !== "function" ||
            typeof this.env.setInitial !== "function" ||
            typeof this.env.clearInitial !== "function" ||
            typeof this.env.fetchEpoch !== "function" ||
            typeof this.env.subscribeFocus !== "function" ||
            typeof this.env.subscribeWindowMaximized !== "function" ||
            typeof this.env.log !== "function"
        ) {
            return false;
        }
        let detach: (() => void) | null = null;
        try {
            detach = this.env.subscribeFocus(() => this.onFocus());
        } catch (error) {
            void error;
            detach = null;
        }
        if (typeof detach !== "function") {
            this.logToken(`${LOG_PREFIX}:cleared reason=focus-subscribe-failed`);
            return false;
        }
        this.focusDetach = detach;
        this.rebindWindow();
        this.ensureBoundAndPublish();
        return true;
    }

    publish(): void {
        this.ensureBoundAndPublish();
    }

    private ensureBoundAndPublish(): void {
        if (this.stopped) {
            return;
        }
        // Every lifecycle input re-reads the effect epoch before publishing,
        // even when already bound: a reloaded effect mints a new epoch and
        // the old one would be rejected forever. One fetch per input, publish
        // only from its callback; a silent fetch confirms nothing and the
        // gate stays hidden with no retry, poll, or timer.
        this.requestEpoch();
    }

    private requestEpoch(): void {
        if (this.stopped) {
            return;
        }
        this.fetchSeq += 1;
        const seq = this.fetchSeq;
        try {
            this.env.fetchEpoch((reply) => this.onEpochReply(reply, seq));
        } catch (error) {
            void error;
            this.logToken(`${LOG_PREFIX}:cleared reason=epoch-unavailable`);
        }
    }

    private onEpochReply(reply: unknown, seq: number): void {
        // A stale callback from a prior fetch, or any reply after stop, can
        // never publish nor override a newer bound epoch.
        if (this.stopped || seq !== this.fetchSeq) {
            return;
        }
        if (typeof reply !== "string" || !isGenerationId(reply)) {
            this.logToken(`${LOG_PREFIX}:cleared reason=epoch-invalid`);
            return;
        }
        if (this.boundEpoch !== reply) {
            // A fresh epoch starts revision safely at 0; it terminates any
            // prior per-epoch stream position held only on this side.
            this.boundEpoch = reply;
            this.revision = 0;
        }
        this.publishBound(reply);
    }

    private publishBound(epoch: string): void {
        if (this.stopped) {
            return;
        }
        if (this.revision < 0 || this.revision > INITIAL_MAXIMIZE_MAX_REVISION) {
            this.publishClearAt(epoch, this.revision, "revision-exhausted");
            return;
        }
        const revision = this.revision;
        this.revision += 1;
        let active: unknown = undefined;
        try {
            active = this.env.getActiveWindow();
        } catch (error) {
            void error;
            active = undefined;
        }
        if (typeof active !== "object" || active === null) {
            this.publishClearAt(epoch, revision, "no-active");
            return;
        }
        const ref = active as object;
        if (readProp(ref, "normalWindow") !== true) {
            this.publishClearAt(epoch, revision, "non-normal");
            return;
        }
        let native: string | null = null;
        try {
            native = normalizeNativeId(readProp(ref, "internalId"));
        } catch (error) {
            void error;
            native = null;
        }
        if (native === null || !isUnbracedUuid(native)) {
            this.publishClearAt(epoch, revision, "identity-unreadable");
            return;
        }
        const modeRaw = readProp(ref, "maximizeMode");
        if (typeof modeRaw !== "number" || !Number.isInteger(modeRaw) || modeRaw < 0 || modeRaw > 3) {
            this.publishClearAt(epoch, revision, "mode-unreadable");
            return;
        }
        const payload = formatInitialMaximizeSet(this.env.owner, epoch, revision, native, modeRaw);
        if (payload === null) {
            this.publishClearAt(epoch, revision, "payload-invalid");
            return;
        }
        try {
            this.env.setInitial(payload);
        } catch (error) {
            void error;
            this.publishClearAt(epoch, revision, "service-loss");
            return;
        }
        this.logToken(`${LOG_PREFIX}:setter-submitted revision=${String(revision)} mode=${String(modeRaw)}`);
    }

    stop(): void {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        // Invalidate every pending epoch callback before detaching.
        this.fetchSeq += 1;
        if (this.windowDetach !== null) {
            try {
                this.windowDetach();
            } catch (error) {
                void error;
            }
            this.windowDetach = null;
            this.windowRef = null;
        }
        if (this.focusDetach !== null) {
            try {
                this.focusDetach();
            } catch (error) {
                void error;
            }
            this.focusDetach = null;
        }
        this.publishClear("stopped");
    }

    private onFocus(): void {
        if (this.stopped) {
            return;
        }
        this.rebindWindow();
        this.ensureBoundAndPublish();
    }

    private rebindWindow(): void {
        let active: unknown = undefined;
        try {
            active = this.env.getActiveWindow();
        } catch (error) {
            void error;
            active = undefined;
        }
        const nextRef = typeof active === "object" && active !== null ? (active as object) : null;
        if (nextRef === this.windowRef) {
            return;
        }
        if (this.windowDetach !== null) {
            try {
                this.windowDetach();
            } catch (error) {
                void error;
            }
            this.windowDetach = null;
            this.windowRef = null;
        }
        if (nextRef === null) {
            return;
        }
        let detach: (() => void) | null = null;
        try {
            detach = this.env.subscribeWindowMaximized(nextRef, () => this.onFocus());
        } catch (error) {
            void error;
            detach = null;
        }
        // A focused window without a connectable maximizedChanged stays
        // unbound: the current publish already fails closed to clear via the
        // mode read, and the next focus change rebinds. Never fails start.
        if (typeof detach !== "function") {
            return;
        }
        this.windowDetach = detach;
        this.windowRef = nextRef;
    }

    private publishClear(reason: string): void {
        // Unbound clears have no epoch to send with: log only. Nothing was
        // ever confirmed, so the gate is already hidden.
        if (this.boundEpoch === null) {
            this.logToken(`${LOG_PREFIX}:cleared reason=${reason}`);
            return;
        }
        if (this.revision < 0 || this.revision > INITIAL_MAXIMIZE_MAX_REVISION) {
            this.logToken(`${LOG_PREFIX}:cleared reason=${reason}`);
            return;
        }
        const revision = this.revision;
        this.revision += 1;
        this.publishClearAt(this.boundEpoch, revision, reason);
    }

    private publishClearAt(epoch: string, revision: number, reason: string): void {
        const payload = formatInitialMaximizeClear(this.env.owner, epoch, revision);
        if (payload !== null) {
            try {
                this.env.clearInitial(payload);
            } catch (error) {
                void error;
            }
        }
        this.logToken(`${LOG_PREFIX}:cleared reason=${reason}`);
    }

    private logToken(line: string): void {
        try {
            this.env.log(line);
        } catch (error) {
            void error;
        }
    }
}

export function startInitialMaximize(env: InitialMaximizeEnv): InitialMaximizeHandle | null {
    let publisher: InitialMaximizePublisher | null = null;
    try {
        publisher = new InitialMaximizePublisher(env);
    } catch (error) {
        void error;
        return null;
    }
    let started = false;
    try {
        started = publisher.start();
    } catch (error) {
        void error;
        started = false;
    }
    // A failed focus subscription still publishes its clear inside start but
    // never enables: return null fail-closed.
    if (!started) {
        return null;
    }
    const active = publisher as InitialMaximizePublisher;
    return {
        stop: (): void => {
            try {
                active.stop();
            } catch (error) {
                void error;
            }
        },
        publish: (): void => {
            try {
                active.publish();
            } catch (error) {
                void error;
            }
        },
    };
}
