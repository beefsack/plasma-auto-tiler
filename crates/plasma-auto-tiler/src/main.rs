fn main() {
    let args: Vec<_> = std::env::args().collect();
    let result = match args.as_slice() {
        [] => Err("missing executable argument".to_owned()),
        [_] => plasma_auto_tiler::tray_endpoint::run().map_err(|error| error.to_string()),
        [_, command] => match command.as_str() {
            "planner-service" => {
                plasma_auto_tiler::planner_service::run().map_err(|error| error.to_string())
            }
            "tray" => plasma_auto_tiler::tray_endpoint::run().map_err(|error| error.to_string()),
            command => Err(format!("unknown command: {command}")),
        },
        [_, command, ..] if command == "planner-service" => {
            Err("planner-service takes no arguments".to_owned())
        }
        [_, command, ..] if command == "tray" => Err("tray takes no arguments".to_owned()),
        [_, command, ..] => Err(format!("unknown command: {command}")),
    };
    if let Err(error) = result {
        eprintln!("error: {error}");
        std::process::exit(1);
    }
}
