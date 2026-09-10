//! Bounded build/source identity (portable core, compile-time only).

/// Package version shared with the KWin package.
pub const PACKAGE_VERSION: &str = env!("CARGO_PKG_VERSION");
/// Fallback for non-Nix development builds.
pub const LOCAL_DEV_FALLBACK: &str = "local-dev";

const RAW_SOURCE_REV: Option<&str> = option_env!("PLASMA_AUTO_TILER_SOURCE_REV");

/// Bounded identity: exactly `local-dev` or `[0-9a-f]{40}`.
#[must_use]
pub fn is_valid_build_identity(value: &str) -> bool {
    if value == LOCAL_DEV_FALLBACK {
        return true;
    }
    if value.len() != 40 {
        return false;
    }
    value
        .bytes()
        .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[must_use]
pub fn source_rev() -> &'static str {
    match RAW_SOURCE_REV {
        Some(raw) if is_valid_build_identity(raw) => raw,
        _ => LOCAL_DEV_FALLBACK,
    }
}

#[must_use]
pub fn startup_line() -> String {
    crate::route_diag::describe_lifecycle_with_version(
        crate::route_diag::LifecycleComp::Planner,
        crate::route_diag::LifecycleEvent::Started,
        Some(source_rev()),
        None,
        None,
        Some(crate::route_diag::LifecycleResult::Ok),
        Some(PACKAGE_VERSION),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identity_is_bounded_with_explicit_fallback() {
        assert!(is_valid_build_identity("local-dev"));
        assert!(is_valid_build_identity(
            "0123456789abcdef0123456789abcdef01234567"
        ));
        for invalid in [
            "",
            "LOCAL-DEV",
            "gen-1",
            "0.1.0",
            "0123456789abcdef0123456789abcdef0123456",
            "0123456789abcdef0123456789abcdef012345678",
            "0123456789ABCDEF0123456789abcdef01234567",
            "0123456789abcdef0123456789abcdef0123456g",
            "has space",
        ] {
            assert!(!is_valid_build_identity(invalid), "{invalid:?}");
        }
        match RAW_SOURCE_REV {
            None => assert_eq!(source_rev(), "local-dev"),
            Some(raw) if is_valid_build_identity(raw) => assert_eq!(source_rev(), raw),
            Some(_) => assert_eq!(source_rev(), "local-dev"),
        }
        assert!(is_valid_build_identity(source_rev()));
        assert_eq!(PACKAGE_VERSION, "0.1.0");
        assert!(crate::route_diag::is_valid_package_version(PACKAGE_VERSION));
        assert!(crate::route_diag::is_valid_package_version("0.1.0"));
        assert!(!crate::route_diag::is_valid_package_version("has space"));
    }

    #[test]
    fn startup_record_carries_component_version_identity() {
        let line = startup_line();
        assert_eq!(
            line,
            format!(
                "plasma-auto-tiler:route-diag:lifecycle:comp=planner:event=started:gen={}:version={}:result=ok",
                source_rev(),
                PACKAGE_VERSION
            )
        );
        assert!(!line.contains(":rev="));
        assert!(!line.contains('/'));
        assert_eq!(line, startup_line());
    }

    #[test]
    fn packages_share_identity_and_markers() {
        let flake = include_str!("../flake.nix");
        assert!(flake.contains("self.rev or \"local-dev\""));
        assert!(!flake.contains("dirtyRev"));
        assert!(flake.contains("sourceRev ? \"local-dev\""));
        assert_eq!(
            flake
                .matches("env.PLASMA_AUTO_TILER_SOURCE_REV = sourceRev")
                .count(),
            2
        );
        assert!(flake.contains("npmBuildScript = \"build:installed\""));
        assert!(flake.contains("package=plasma-auto-tiler-kwin"));
        assert!(flake.contains("\"source=${sourceRev}\""));
        assert!(flake.contains("grep -Fx \"source=${sourceRev}\""));
    }

    #[test]
    fn portable_core_has_no_runtime_deps_and_emits_once() {
        let module = include_str!("build_identity.rs");
        let body = module.split("#[cfg(test)]").next().unwrap_or(module);
        assert!(module.contains("option_env!"));
        for forbidden in [
            "std::env::var",
            "Command::new",
            "journald",
            "zbus",
            "eprintln",
        ] {
            assert!(!body.contains(forbidden), "{forbidden}");
        }
        let service = include_str!("planner_service.rs");
        // Bound each production startup path so a second emission in either
        // path cannot hide inside the other path's tail.
        let serve = service
            .split("fn serve(")
            .nth(1)
            .expect("serve present")
            .split("struct NestedPlannerEndpoint")
            .next()
            .expect("serve bounded");
        let nested = service
            .split("pub fn run_nested(")
            .nth(1)
            .expect("run_nested present")
            .split("ADVISORY_LOSS_CORRELATION_FLAG")
            .next()
            .expect("run_nested bounded");
        for path in [serve, nested] {
            assert_eq!(path.matches("emit_build_identity_startup()").count(), 1);
            let emit = path.find("emit_build_identity_startup()").unwrap();
            assert!(path[..emit].contains("request_planner_name"));
            // Emission follows name acquisition with no locks held.
            assert!(!path[..emit].contains("operation_lock"));
            assert!(!path[..emit].contains(".lock()"));
        }
    }
}
