var LOG_SERVICE = "com.plasmaAutoTiler.LogSink";
var LOG_PATH = "/com/plasmaAutoTiler/LogSink";
var LOG_INTERFACE = "com.plasmaAutoTiler.LogSink";
var LOG_METHOD = "append";

function emit(line) {
    try {
        callDBus(LOG_SERVICE, LOG_PATH, LOG_INTERFACE, LOG_METHOD, line);
    } catch (e) {
    }
}

try {
    var wins = workspace.windowList();
    emit("winenum,count," + wins.length);
    for (var i = 0; i < wins.length; i++) {
        var w = wins[i];
        var caption = "";
        var rc = "";
        var normal = "";
        var managed = "";
        try { caption = w.caption; } catch (e) { caption = "err"; }
        try { rc = w.resourceClass; } catch (e) { rc = "err"; }
        try { normal = String(w.normalWindow); } catch (e) { normal = "err"; }
        try { managed = String(w.managed); } catch (e) { managed = "err"; }
        emit("winenum,win," + i + ",class=" + rc + ",normal=" + normal + ",managed=" + managed +
            ",caption=" + String(caption).replace(/,/g, " "));
    }
} catch (e) {
    emit("winenum,error," + e.message);
}
emit("winenum,done,true");
