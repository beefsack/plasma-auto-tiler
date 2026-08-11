var LOG_SERVICE = "com.plasmaAutoTiler.LogSink";
var LOG_PATH = "/com/plasmaAutoTiler/LogSink";
var LOG_INTERFACE = "com.plasmaAutoTiler.LogSink";
var LOG_METHOD = "append";

// One-shot, load-time environment probe. It connects to no signals and
// touches no window, so it cannot capture or alter window-management state.
// The whole body is wrapped in try/catch so probing a nonexistent global
// cannot abort script load.

var facts = [];

function addFact(metric, value) {
    facts.push("clockprobe," + metric + "," + value);
}

var G = null;
try {
    G = (typeof globalThis !== "undefined") ? globalThis : this;
} catch (e) {
    G = null;
}
addFact("global_object_resolved", G === null ? "null" : "object");

function probeChain(chain) {
    try {
        var parts = chain.split(".");
        var obj = G;
        for (var i = 0; i < parts.length; i++) {
            if (obj === null || obj === undefined) {
                return "undefined";
            }
            obj = obj[parts[i]];
        }
        return typeof obj;
    } catch (e) {
        return "throws:" + e.message;
    }
}

try {
    addFact("global_typeof_globalThis", probeChain("globalThis"));

    var candidates = [
        "performance",
        "performance.now",
        "process",
        "process.hrtime",
        "console",
        "console.time",
        "console.log",
        "QTimer",
        "QTimer.singleShot",
        "Qt",
        "Date",
        "Date.now",
        "callDBus",
        "print",
        "workspace",
        "options",
        "KWin",
        "readConfig",
        "registerShortcut",
        "registerScreenEdge"
    ];
    for (var c = 0; c < candidates.length; c++) {
        addFact("global_typeof_" + candidates[c].replace(/\./g, "_"), probeChain(candidates[c]));
    }

    var names = [];
    var enumError = null;
    try {
        names = Object.getOwnPropertyNames(G);
        names.sort();
    } catch (e) {
        enumError = e.message;
    }
    if (enumError !== null) {
        addFact("globals_enum_error", enumError);
    } else {
        addFact("globals_count", names.length);
        for (var n = 0; n < names.length; n++) {
            addFact("global_name", names[n]);
        }
        var clockHits = [];
        for (var h = 0; h < names.length; h++) {
            if (/(time|clock|now|mono|hrtime|perf|nano|epoch|micro|date)/i.test(names[h])) {
                clockHits.push(names[h]);
            }
        }
        addFact("globals_clockname_hits", clockHits.length);
        for (var k = 0; k < clockHits.length; k++) {
            addFact("global_clockname", clockHits[k]);
        }
    }

    var maxIterations = 100000;
    var wallCapMs = 5000;
    var wallStart = Date.now();

    var prevValue = Date.now();
    var iterationCount = 0;
    var distinctCount = 0;
    var minStep = -1;
    var maxStep = 0;
    var runCount = 0;
    var minRun = 0;
    var maxRun = 0;
    var runLength = 1;
    var runHistogram = {};
    var sawFirstChange = false;

    while (iterationCount < maxIterations) {
        var nowValue = Date.now();
        iterationCount++;
        if (nowValue !== prevValue) {
            var step = nowValue - prevValue;
            if (sawFirstChange) {
                if (step < minStep) { minStep = step; }
                if (step > maxStep) { maxStep = step; }
            } else {
                minStep = step;
                maxStep = step;
                sawFirstChange = true;
            }
            distinctCount++;
            runCount++;
            if (runHistogram[String(runLength)] === undefined) {
                runHistogram[String(runLength)] = 0;
            }
            runHistogram[String(runLength)]++;
            if (runCount === 1 || runLength < minRun) { minRun = runLength; }
            if (runLength > maxRun) { maxRun = runLength; }
            runLength = 1;
            prevValue = nowValue;
        } else {
            runLength++;
        }
        if (iterationCount % 1024 === 0 && Date.now() - wallStart > wallCapMs) {
            addFact("datenow_bailed_wallcap", "true");
            break;
        }
    }

    runCount++;
    if (runHistogram[String(runLength)] === undefined) {
        runHistogram[String(runLength)] = 0;
    }
    runHistogram[String(runLength)]++;
    if (runCount === 1 || runLength < minRun) { minRun = runLength; }
    if (runLength > maxRun) { maxRun = runLength; }

    addFact("datenow_total_iterations", iterationCount);
    addFact("datenow_distinct_values", distinctCount);
    addFact("datenow_loop_wall_ms", Date.now() - wallStart);
    addFact("datenow_min_step_ms", sawFirstChange ? minStep : "none-seen");
    addFact("datenow_max_step_ms", sawFirstChange ? maxStep : "none-seen");
    addFact("datenow_min_run_same_value", minRun);
    addFact("datenow_max_run_same_value", maxRun);
    addFact("datenow_run_count", runCount);
    if (runCount > 0) {
        addFact("datenow_avg_iterations_per_value", Math.round(iterationCount / runCount * 100) / 100);
    }
    var runKeys = Object.keys(runHistogram).sort(function (a, b) { return Number(a) - Number(b); });
    for (var r = 0; r < runKeys.length; r++) {
        addFact("datenow_run_histogram", "len=" + runKeys[r] + " count=" + runHistogram[runKeys[r]]);
    }

    if (probeChain("performance.now") === "function") {
        addFact("perfnow_probe", "running");
        var perfPrev = performance.now();
        var perfIter = 0;
        var perfDistinct = 0;
        var perfMin = -1;
        var perfMax = 0;
        var perfChanged = false;
        while (perfIter < 100000) {
            var p = performance.now();
            perfIter++;
            if (p !== perfPrev) {
                var ps = p - perfPrev;
                if (!perfChanged) {
                    perfMin = ps;
                    perfMax = ps;
                    perfChanged = true;
                } else {
                    if (ps < perfMin) { perfMin = ps; }
                    if (ps > perfMax) { perfMax = ps; }
                }
                perfDistinct++;
                perfPrev = p;
            }
            if (perfIter % 1024 === 0 && Date.now() - wallStart > wallCapMs) {
                break;
            }
        }
        addFact("perfnow_iterations", perfIter);
        addFact("perfnow_distinct", perfDistinct);
        addFact("perfnow_min_step_ms", perfChanged ? perfMin : "none-seen");
        addFact("perfnow_max_step_ms", perfChanged ? perfMax : "none-seen");
    }

    if (probeChain("process.hrtime") === "function") {
        addFact("hrtime_probe", "running");
        var hrPrev = process.hrtime();
        var hrIter = 0;
        var hrMin = -1;
        var hrChanged = false;
        while (hrIter < 100000) {
            var hrNow = process.hrtime();
            hrIter++;
            var hrDelta = (hrNow[0] - hrPrev[0]) * 1000000000 + (hrNow[1] - hrPrev[1]);
            if (hrDelta !== 0) {
                if (!hrChanged) {
                    hrMin = hrDelta;
                    hrChanged = true;
                } else if (hrDelta < hrMin) {
                    hrMin = hrDelta;
                }
                hrPrev = hrNow;
            }
            if (hrIter % 1024 === 0 && Date.now() - wallStart > wallCapMs) {
                break;
            }
        }
        addFact("hrtime_iterations", hrIter);
        addFact("hrtime_min_nonzero_step_ns", hrChanged ? hrMin : "none-seen");
    }

    addFact("probe_complete", "true");
} catch (e) {
    addFact("probe_error", "threw:" + e.message + " line:" + e.lineNumber);
}

var emitted = 0;
var flushFailures = 0;
for (var f = 0; f < facts.length; f++) {
    var ok = false;
    try {
        if (typeof callDBus === "function") {
            callDBus(LOG_SERVICE, LOG_PATH, LOG_INTERFACE, LOG_METHOD, facts[f]);
            ok = true;
        }
    } catch (e) {
        ok = false;
    }
    if (!ok) {
        try {
            if (typeof console !== "undefined" && typeof console.log === "function") {
                console.log(facts[f]);
                ok = true;
            }
        } catch (e2) {
            ok = false;
        }
    }
    if (ok) {
        emitted++;
    } else {
        flushFailures++;
    }
}

var finalLine = "clockprobe,probe_flush,emitted=" + emitted + " failed=" + flushFailures;
try {
    if (typeof callDBus === "function") {
        callDBus(LOG_SERVICE, LOG_PATH, LOG_INTERFACE, LOG_METHOD, finalLine);
    } else if (typeof console !== "undefined" && typeof console.log === "function") {
        console.log(finalLine);
    }
} catch (e) {
    // no channel available; nothing more to do
}
