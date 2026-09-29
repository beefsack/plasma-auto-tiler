import { startPlanAdapterEntry } from "./plan-adapter-entry";
import { TrayPublisher } from "./tray-publisher";

// Production entry: the single bounded DescribePlan adapter owns all
// KWin observation and actuation. Only normal windows are observed with
// stable opaque ids, frame rectangles, output, workspace, and focus; Rust
// owns every tiling, order, membership, and rejection decision through the
// stateless DescribePlan route and the adapter applies the complete reply
// geometries in the shared canonical order. Directional focus/move and
// direction-plus-mode resize shortcuts issue parameterized plan commands,
// and window/scope signals feed one debounced fresh-snapshot resync.

const trayTimers = new Set<QTimer>();

// The plan adapter owns session workspace tiling state; the tray snapshot
// projects its current scope/tiled/default. The tray invokes the keyless
// toggle over KGlobalAccel; the menu waits for the next published state.
const trayHolder: { current: TrayPublisher | null } = { current: null };
const planHandle = startPlanAdapterEntry({
    owner: "kwin-plan-adapter",
    generation: "plan-1",
    onWorkspaceTilingChanged: () => {
        try {
            trayHolder.current?.notifyWorkspaceChanged();
        } catch (error) {
            void error;
        }
    },
});

const trayPublisher = new TrayPublisher({
    isEnabled: () => true,
    log: (message) => console.log(message),
    getScope: () => planHandle?.getWorkspaceTilingSnapshot().scope ?? "",
    isTiled: () => planHandle?.getWorkspaceTilingSnapshot().tiled ?? true,
    getDefaultTiled: () => planHandle?.getWorkspaceTilingSnapshot().defaultTiled ?? true,
    publishSnapshot: (schema, generation, revision, enabled, currentScope, tiled, defaultTiled) => {
        callDBus(
            "org.plasmaautotiler.Tray",
            "/org/plasmaautotiler/Tray",
            "org.plasmaautotiler.Tray1",
            "PublishSnapshot",
            schema,
            generation,
            revision,
            enabled,
            currentScope,
            tiled,
            defaultTiled,
        );
    },
    scheduleOnce: (delayMs, callback) => {
        const timer = new QTimer();
        trayTimers.add(timer);
        timer.interval = delayMs;
        timer.singleShot = true;
        timer.timeout.connect(() => {
            try {
                callback();
            } finally {
                trayTimers.delete(timer);
            }
        });
        timer.start();
        return () => {
            timer.stop();
            trayTimers.delete(timer);
        };
    },
});

trayPublisher.start();
trayHolder.current = trayPublisher;

// Drag-verdict route: the plan adapter owns the single finished-handler
// LastVerdict pull and routes exactly one strict pointer-resize after a
// non-cancelled verdict. Cancelled verdicts are a strict no-op; derive
// failures fail closed with exact bounded reasons. No push, retry, or fallback.
void planHandle;
