import { TrayPublisher } from "./tray-publisher";

// Group D: the Legacy Custom Tile controller (src/controller*.ts,
// src/logic.ts, src/boundary.ts Custom Tile actuation, layout/blueprint,
// preset, topology-reset, managed-root, and the duplicated TypeScript COSMIC
// planners) has been removed. This entry is intentionally inert: it performs
// no tiling, registers no shortcuts, subscribes to no workspace or window
// signals, and never touches Custom Tiles. The Stage 4 general-N engine is
// not implemented here and no fallback is provided.

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
console.log("plasma-auto-tiler:legacy-engine-removed");
