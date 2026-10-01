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
                "tiler-test-window commands:\n  run --receipt PATH [--seconds N]  create owned test window\n  close HWND  post WM_CLOSE to owned window\n  inspect HWND  print owned window snapshot JSON"
            );
            return Ok(());
        }
        "run" => {
            let opts = tiler_windows::test_window::parse_helper_run_args(rest)
                .map_err(|message| (2, message))?;
            tiler_windows::test_window::sys::run_owned_window(&opts.receipt, opts.seconds)
                .map_err(|e| (1, e.to_string()))?
        }
        "close" => {
            if rest.len() != 1 {
                return Err((2, "usage: tiler-test-window close HWND".to_owned()));
            }
            let hwnd = tiler_windows::test_window::parse_hwnd(&rest[0])
                .ok_or((2, "usage: tiler-test-window close HWND".to_owned()))?;
            tiler_windows::test_window::sys::close_owned(hwnd).map_err(|e| (1, e.to_string()))?
        }
        "inspect" => {
            if rest.len() != 1 {
                return Err((2, "usage: tiler-test-window inspect HWND".to_owned()));
            }
            let hwnd = tiler_windows::test_window::parse_hwnd(&rest[0])
                .ok_or((2, "usage: tiler-test-window inspect HWND".to_owned()))?;
            tiler_windows::test_window::sys::inspect_owned(hwnd).map_err(|e| (1, e.to_string()))?
        }
        _ => {
            return Err((
                2,
                "usage: tiler-test-window run --receipt PATH [--seconds N]|close HWND|inspect HWND"
                    .to_owned(),
            ));
        }
    };
    println!("{output}");
    Ok(())
}

#[cfg(not(windows))]
fn main() {
    eprintln!("tiler-test-window is Windows-only");
    std::process::exit(2);
}
