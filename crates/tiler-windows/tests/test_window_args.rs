use tiler_windows::test_window::{HELPER_DEFAULT_SECONDS, parse_helper_run_args, parse_hwnd};

fn strings(args: &[&str]) -> Vec<String> {
    args.iter().map(|s| (*s).to_owned()).collect()
}

#[test]
fn hwnd_forms() {
    assert_eq!(parse_hwnd("12345"), Some(12345));
    assert_eq!(parse_hwnd("0xABCD"), Some(0xABCD));
    assert_eq!(parse_hwnd("0"), None);
    assert_eq!(parse_hwnd("xyz"), None);
}

#[test]
fn helper_run_requires_receipt_and_bounds_seconds() {
    let opts = parse_helper_run_args(&strings(&["--receipt", "r.json"])).expect("defaults");
    assert_eq!(opts.seconds, HELPER_DEFAULT_SECONDS);
    assert!(parse_helper_run_args(&strings(&[])).is_err());
    assert!(parse_helper_run_args(&strings(&["--receipt", "r.json", "--seconds", "0"])).is_err());
    assert!(parse_helper_run_args(&strings(&["--receipt", "r.json", "--seconds", "601"])).is_err());
}
