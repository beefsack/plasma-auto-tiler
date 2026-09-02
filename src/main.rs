fn main() {
    let args: Vec<_> = std::env::args().collect();
    let result = match args.as_slice() {
        [] => Err("missing executable argument".to_owned()),
        [_] => plasma_auto_tiler::tray_endpoint::run().map_err(|error| error.to_string()),
        [_, command] => match command.as_str() {
            "tray-install" => plasma_auto_tiler::tray_lifecycle::install_command(),
            "tray-start" => plasma_auto_tiler::tray_lifecycle::start_command(),
            "tray-status" => plasma_auto_tiler::tray_lifecycle::status_command(),
            "tray-stop" => plasma_auto_tiler::tray_lifecycle::stop_command(),
            "tray-remove" => plasma_auto_tiler::tray_lifecycle::remove_command(),
            command => Err(format!("unknown command: {command}")),
        },
        [_, command, ..] if command.starts_with("tray-") => {
            Err(format!("{command} takes no arguments"))
        }
        [_, command, ..] => Err(format!("unknown command: {command}")),
    };
    if let Err(error) = result {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}
