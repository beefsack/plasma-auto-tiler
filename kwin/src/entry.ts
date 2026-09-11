import { startPlanAdapterEntry } from "./plan-adapter-entry";
import { TrayPublisher } from "./tray-publisher";

// Stage 4 production entry: the single bounded DescribePlan adapter owns all
// KWin observation and actuation. Only normal windows are observed with
// stable opaque ids, frame rectangles, output, workspace, and focus; Rust
// owns every tiling, order, membership, and rejection decision through the
// stateless DescribePlan route and the adapter applies the complete reply
// geometries in the shared canonical order. Directional focus/move and
// direction-plus-mode resize shortcuts issue parameterized plan commands,
// and window/scope signals feed one debounced fresh-snapshot resync.

const trayTimers = new Set<QTimer>();
const trayPublisher = new TrayPublisher({
    isEnabled: () => false,
    log: (message) => console.log(message),
    publishSnapshot: (schema, generation, revision, enabled) => {
        callDBus(
            "org.plasmaautotiler.Tray",
            "/org/plasmaautotiler/Tray",
            "org.plasmaautotiler.Tray1",
            "PublishSnapshot",
            schema,
            generation,
            revision,
            enabled,
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

const planHandle = startPlanAdapterEntry({ owner: "kwin-plan-adapter", generation: "plan-1" });
void planHandle;
