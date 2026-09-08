fn main() {
    let args: Vec<_> = std::env::args().collect();
    let result = match args.as_slice() {
        [] => Err("missing executable argument".to_owned()),
        [_] => plasma_auto_tiler::tray_endpoint::run().map_err(|error| error.to_string()),
        [_, command] => match command.as_str() {
            "planner-service" => {
                plasma_auto_tiler::planner_service::run().map_err(|error| error.to_string())
            }
            "planner-service-nested" => {
                Err("planner-service-nested requires an explicit manifest path".to_owned())
            }
            "tray-managed" => {
                plasma_auto_tiler::tray_endpoint::run_managed().map_err(|error| error.to_string())
            }
            "tray-install" => plasma_auto_tiler::tray_lifecycle::install_command(),
            "tray-start" => plasma_auto_tiler::tray_lifecycle::start_command(),
            "tray-status" => plasma_auto_tiler::tray_lifecycle::status_command(),
            "tray-stop" => plasma_auto_tiler::tray_lifecycle::stop_command(),
            "tray-remove" => plasma_auto_tiler::tray_lifecycle::remove_command(),
            command => Err(format!("unknown command: {command}")),
        },
        [_, command, flag, correlation]
            if command == "planner-service"
                && flag == plasma_auto_tiler::planner_service::ADVISORY_LOSS_CORRELATION_FLAG =>
        {
            if plasma_auto_tiler::planner_service::parse_advisory_loss_correlation(correlation)
                .is_some()
            {
                plasma_auto_tiler::planner_service::run_with_advisory_loss_correlation(correlation)
                    .map_err(|error| error.to_string())
            } else {
                Err("planner-service --advisory-loss-correlation requires a valid bounded correlation id".to_owned())
            }
        }
        [_, command, manifest] if command == "planner-service-nested" => {
            plasma_auto_tiler::planner_service::run_nested(std::path::Path::new(manifest))
                .map_err(|error| error.to_string())
        }
        [_, command, ..] if command == "planner-service" => Err(
            "planner-service takes no arguments except --advisory-loss-correlation <correlation>"
                .to_owned(),
        ),
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
