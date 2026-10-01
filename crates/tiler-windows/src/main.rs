#![cfg_attr(windows, windows_subsystem = "windows")]

#[cfg(windows)]
fn main() {
    match real_main() {
        Ok(()) => {}
        Err((code, message)) => {
            eprintln!("{message}");
            std::process::exit(code);
        }
    }
}

#[cfg(windows)]
fn real_main() -> Result<(), (i32, String)> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (command, rest) = match args.split_first() {
        Some((first, rest)) => (first.as_str(), rest),
        None => ("help", &[][..]),
    };
    let output = match command {
        "--help" | "-h" | "help" => {
            println!(
                "tiler-windows commands:\n  identity  print current process identity as JSON\n  run --seconds N [--trace] [--hide HWND]  bounded owner run\n  ready  report owner readiness as JSON\n  restore  standalone reveal of owned hidden windows and ledger cleanup after owner exit (call explicitly after stop)\n  stop  request graceful exit of verified owner only; leaves ledger/windows for standalone restore\n  emergency-stop  terminate verified owner only; leaves ledger/windows for standalone restore"
            );
            return Ok(());
        }
        "identity" => {
            if !rest.is_empty() {
                return Err((2, "usage: tiler-windows identity".to_owned()));
            }
            identity_report().map_err(|e| (1, e.to_string()))?
        }
        "run" => {
            let options =
                tiler_windows::lifecycle::parse_run_args(rest).map_err(|message| (2, message))?;
            tiler_windows::lifecycle::sys::cmd_run(
                options.seconds,
                options.trace,
                options.hide_hwnd,
            )
            .map_err(|e| (1, e.to_string()))?
        }
        "ready" => {
            if !rest.is_empty() {
                return Err((2, "usage: tiler-windows ready".to_owned()));
            }
            tiler_windows::lifecycle::sys::cmd_ready().map_err(|e| (1, e.to_string()))?
        }
        "restore" => {
            if !rest.is_empty() {
                return Err((2, "usage: tiler-windows restore".to_owned()));
            }
            tiler_windows::lifecycle::sys::cmd_restore().map_err(|e| (1, e.to_string()))?
        }
        "stop" => {
            if !rest.is_empty() {
                return Err((2, "usage: tiler-windows stop".to_owned()));
            }
            tiler_windows::lifecycle::sys::cmd_stop(false).map_err(|e| (1, e.to_string()))?
        }
        "emergency-stop" => {
            if !rest.is_empty() {
                return Err((2, "usage: tiler-windows emergency-stop".to_owned()));
            }
            tiler_windows::lifecycle::sys::cmd_stop(true).map_err(|e| (1, e.to_string()))?
        }
        _ => {
            return Err((
                2,
                "usage: tiler-windows identity|run --seconds N [--trace] [--hide HWND]|ready|restore|stop|emergency-stop"
                    .to_owned(),
            ));
        }
    };
    println!("{output}");
    Ok(())
}

#[cfg(windows)]
fn identity_report() -> Result<String, Box<dyn std::error::Error>> {
    let process = tiler_windows::native::current_identity()?;
    let integrity_level = tiler_windows::native::current_integrity_level()?;
    let ledger_directory = tiler_windows::native::ledger_directory()?;
    Ok(serde_json::json!({
        "process": process,
        "integrity_level": integrity_level,
        "ledger_directory": ledger_directory,
    })
    .to_string())
}

#[cfg(not(windows))]
fn main() {
    eprintln!("tiler-windows identity is Windows-only");
    std::process::exit(2);
}
