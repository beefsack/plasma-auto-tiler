fn main() {
    let result = match std::env::args().nth(1).as_deref() {
        None => plasma_auto_tiler::tray_endpoint::run().map_err(|error| error.to_string()),
        Some("tray-install") => plasma_auto_tiler::tray_lifecycle::install_command(),
        Some("tray-start") => plasma_auto_tiler::tray_lifecycle::start_command(),
        Some("tray-status") => plasma_auto_tiler::tray_lifecycle::status_command(),
        Some("tray-stop") => plasma_auto_tiler::tray_lifecycle::stop_command(),
        Some("tray-remove") => plasma_auto_tiler::tray_lifecycle::remove_command(),
        Some(command) => Err(format!("unknown command: {command}")),
    };
    if let Err(error) = result {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}
