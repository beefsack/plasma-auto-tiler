//! Production DescribePlan directional cross-output integration (active route).
//!
//! `kwin/src/entry.ts -> startPlanAdapterEntry -> PlanAdapter.requestFocus /
//! requestMove -> DescribePlan -> src/planner_protocol.rs` with a bounded
//! two-domain `domains` payload: source plus the horizontally reciprocal
//! adjacent output's current logical workspace (distinct workspace ids
//! allowed). Asserts S20/S22 crossing, focus last-focus selection with no
//! layout writes, exact membership+geometry/focus shape, gap/inset coverage,
//! and stale/ambiguous/owner/visibility refusals. Up/Down never cross.

use std::collections::BTreeSet;

use tiler_protocol::planner_protocol::Planner as CorePlanner;

/// Test harness which establishes canonical per-domain state through a
/// fresh complete reconcile on each domain before exercising a directional
/// request. Production directional paths never perform this spatial
/// construction.
struct Planner {
    inner: CorePlanner,
    binding: Option<(String, String)>,
    seeded: BTreeSet<(String, String)>,
}

impl Planner {
    fn new() -> Self {
        Self {
            inner: CorePlanner::new(),
            binding: None,
            seeded: BTreeSet::new(),
        }
    }

    fn evaluate(&mut self, request: &str) -> String {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(request) else {
            return self.inner.evaluate(request);
        };
        self.seed_directional_components(&value);
        self.inner.evaluate(request)
    }

    fn seed_directional_components(&mut self, value: &serde_json::Value) {
        let Some(owner) = value.get("owner").and_then(serde_json::Value::as_str) else {
            return;
        };
        let Some(generation) = value.get("generation").and_then(serde_json::Value::as_str) else {
            return;
        };
        let binding = (owner.to_owned(), generation.to_owned());
        if self.binding.as_ref() != Some(&binding) {
            self.binding = Some(binding.clone());
            self.seeded.clear();
        }
        let Some(command) = value.get("command").and_then(serde_json::Value::as_object) else {
            return;
        };
        if !matches!(
            command.get("op").and_then(serde_json::Value::as_str),
            Some("focus" | "move")
        ) {
            return;
        }
        let Some(domains) = value.get("domains").and_then(serde_json::Value::as_array) else {
            return;
        };
        if domains.len() != 2 {
            return;
        }
        let Some(windows) = value.get("windows").and_then(serde_json::Value::as_array) else {
            return;
        };
        let focused = value
            .get("focused_window")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        for (index, domain) in domains.iter().enumerate() {
            let Some(output) = domain.get("output").and_then(serde_json::Value::as_str) else {
                return;
            };
            let Some(workspace) = domain.get("workspace").and_then(serde_json::Value::as_str)
            else {
                return;
            };
            let key = (output.to_owned(), workspace.to_owned());
            if self.seeded.contains(&key) {
                continue;
            }
            let members: Vec<serde_json::Value> = windows
                .iter()
                .filter(|window| {
                    window.get("output").and_then(serde_json::Value::as_str) == Some(output)
                        && window.get("workspace").and_then(serde_json::Value::as_str)
                            == Some(workspace)
                })
                .cloned()
                .collect();
            let Some(seed_focus) = members
                .iter()
                .find(|window| {
                    window.get("window").and_then(serde_json::Value::as_str) == Some(focused)
                })
                .or_else(|| members.last())
                .and_then(|window| window.get("window").and_then(serde_json::Value::as_str))
            else {
                continue;
            };
            let seed = serde_json::json!({
                "v": 1,
                "correlation_id": format!("canonical-seed-{index}"),
                "owner": binding.0,
                "generation": binding.1,
                "revision": 0,
                "fingerprint": 7001,
                "domain": {
                    "output": output,
                    "workspace": workspace,
                    "bounds": domain["bounds"],
                    "gap": domain["gap"],
                    "outer_gap": domain["outer_gap"],
                },
                "focused_window": seed_focus,
                "windows": members,
                "command": {
                    "op": "reconcile",
                },
            });
            let reply: serde_json::Value =
                serde_json::from_str(&self.inner.evaluate(&seed.to_string())).expect("seed reply");
            if reply.get("outcome").and_then(serde_json::Value::as_str) == Some("planned") {
                self.seeded.insert(key);
            }
        }
    }
}

fn source_domain() -> serde_json::Value {
    serde_json::json!({
        "output": "out-2",
        "workspace": "ws-b",
        "bounds": {"x": 800, "y": 0, "w": 800, "h": 600},
        "gap": 4,
        "outer_gap": 8,
    })
}

fn domains_payload() -> serde_json::Value {
    serde_json::json!([
        {
            "output": "out-2",
            "workspace": "ws-b",
            "bounds": {"x": 800, "y": 0, "w": 800, "h": 600},
            "gap": 4,
            "outer_gap": 8,
            "adjacent": {"left": "out-1"},
        },
        {
            "output": "out-1",
            "workspace": "ws-a",
            "bounds": {"x": 0, "y": 0, "w": 800, "h": 600},
            "gap": 4,
            "outer_gap": 8,
            "adjacent": {"right": "out-2"},
        },
    ])
}

// Left-hand source variant for move tests: the focused right-edge window
// moves right into the adjacent target. The reconcile seed keeps the left
// window first and the focused right window last, yielding H[left,
// focused-right] with the mover at the outward right edge (S20 mirror).
fn left_source_domain() -> serde_json::Value {
    serde_json::json!({
        "output": "out-1",
        "workspace": "ws-a",
        "bounds": {"x": 0, "y": 0, "w": 800, "h": 600},
        "gap": 4,
        "outer_gap": 8,
    })
}

fn left_domains_payload() -> serde_json::Value {
    serde_json::json!([
        {
            "output": "out-1",
            "workspace": "ws-a",
            "bounds": {"x": 0, "y": 0, "w": 800, "h": 600},
            "gap": 4,
            "outer_gap": 8,
            "adjacent": {"right": "out-2"},
        },
        {
            "output": "out-2",
            "workspace": "ws-b",
            "bounds": {"x": 800, "y": 0, "w": 800, "h": 600},
            "gap": 4,
            "outer_gap": 8,
            "adjacent": {"left": "out-1"},
        },
    ])
}

fn win(
    window: &str,
    output: &str,
    workspace: &str,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
) -> serde_json::Value {
    serde_json::json!({
        "window": window,
        "output": output,
        "workspace": workspace,
        "rect": {"x": x, "y": y, "w": w, "h": h},
    })
}

fn request(
    correlation: &str,
    focused: &str,
    windows: Vec<serde_json::Value>,
    command: serde_json::Value,
    with_domains: bool,
) -> String {
    request_with_domain(
        correlation,
        focused,
        windows,
        command,
        source_domain(),
        with_domains.then(domains_payload),
    )
}

/// Test mirror of the canonical directional fingerprint (FNV-1a 32-bit over
/// ordered domain primitives, focused id, and id-sorted windows). Must stay
/// byte-identical to `planner_protocol` derivation and the adapter's
/// `planDirectionalFingerprint`; any drift fails `fingerprint-mismatch`.
fn directional_fp(
    domains: &serde_json::Value,
    focused: &str,
    windows: &[serde_json::Value],
) -> u64 {
    fn feed(h: &mut u32, s: &str) {
        for b in s.bytes() {
            *h ^= u32::from(b);
            *h = h.wrapping_mul(16777619);
        }
    }
    fn sep(h: &mut u32, b: u8) {
        *h ^= u32::from(b);
        *h = h.wrapping_mul(16777619);
    }
    let num = |v: &serde_json::Value| v.as_i64().expect("int").to_string();
    let flag = |v: &serde_json::Value, key: &str| {
        if v.get(key)
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false)
        {
            "1"
        } else {
            "0"
        }
    };
    let mut h: u32 = 2166136261;
    for (i, d) in domains.as_array().expect("domains").iter().enumerate() {
        if i > 0 {
            sep(&mut h, 0x1e);
        }
        feed(&mut h, d["output"].as_str().expect("output"));
        sep(&mut h, 0x1f);
        feed(&mut h, d["workspace"].as_str().expect("workspace"));
        sep(&mut h, 0x1f);
        feed(&mut h, &num(&d["bounds"]["x"]));
        sep(&mut h, 0x1f);
        feed(&mut h, &num(&d["bounds"]["y"]));
        sep(&mut h, 0x1f);
        feed(&mut h, &num(&d["bounds"]["w"]));
        sep(&mut h, 0x1f);
        feed(&mut h, &num(&d["bounds"]["h"]));
        sep(&mut h, 0x1f);
        feed(&mut h, &num(&d["gap"]));
        sep(&mut h, 0x1f);
        feed(&mut h, &num(&d["outer_gap"]));
        sep(&mut h, 0x1f);
        feed(&mut h, "left");
        sep(&mut h, 0x1f);
        feed(
            &mut h,
            d["adjacent"]
                .get("left")
                .and_then(|v| v.as_str())
                .unwrap_or(""),
        );
        sep(&mut h, 0x1f);
        feed(&mut h, "right");
        sep(&mut h, 0x1f);
        feed(
            &mut h,
            d["adjacent"]
                .get("right")
                .and_then(|v| v.as_str())
                .unwrap_or(""),
        );
    }
    sep(&mut h, 0x1f);
    feed(&mut h, focused);
    let mut ordered: Vec<&serde_json::Value> = windows.iter().collect();
    ordered.sort_by(|a, b| a["window"].as_str().cmp(&b["window"].as_str()));
    for w in ordered {
        sep(&mut h, 0x1f);
        feed(&mut h, w["window"].as_str().expect("window"));
        sep(&mut h, 0x1f);
        feed(&mut h, w["output"].as_str().expect("output"));
        sep(&mut h, 0x1f);
        feed(&mut h, w["workspace"].as_str().expect("workspace"));
        sep(&mut h, 0x1f);
        feed(&mut h, &num(&w["rect"]["x"]));
        sep(&mut h, 0x1f);
        feed(&mut h, &num(&w["rect"]["y"]));
        sep(&mut h, 0x1f);
        feed(&mut h, &num(&w["rect"]["w"]));
        sep(&mut h, 0x1f);
        feed(&mut h, &num(&w["rect"]["h"]));
        sep(&mut h, 0x1f);
        feed(&mut h, flag(w, "floating"));
        sep(&mut h, 0x1f);
        feed(&mut h, flag(w, "fit_excluded"));
    }
    u64::from(h)
}

fn request_with_domain(
    correlation: &str,
    focused: &str,
    windows: Vec<serde_json::Value>,
    command: serde_json::Value,
    domain: serde_json::Value,
    domains: Option<serde_json::Value>,
) -> String {
    // Directional requests bind the full two-domain evidence in the
    // fingerprint (Rust re-derives it); legacy requests keep a constant.
    let fingerprint = match &domains {
        Some(entries) => directional_fp(entries, focused, &windows),
        None => 7001,
    };
    let mut value = serde_json::json!({
        "v": 1,
        "correlation_id": correlation,
        "owner": "owner-1",
        "generation": "gen-1",
        "revision": 0,
        "fingerprint": fingerprint,
        "domain": domain,
        "focused_window": focused,
        "windows": windows,
        "command": command,
    });
    if let Some(domains) = domains {
        value["domains"] = domains;
    }
    value.to_string()
}

fn parse(reply: &str) -> serde_json::Value {
    serde_json::from_str(reply).expect("reply is JSON")
}

fn focus_cmd(window: &str, direction: &str) -> serde_json::Value {
    serde_json::json!({"op": "focus", "window": window, "direction": direction})
}

fn move_cmd(window: &str, direction: &str) -> serde_json::Value {
    serde_json::json!({"op": "move", "window": window, "direction": direction})
}

fn one_each_windows() -> Vec<serde_json::Value> {
    vec![
        win("win-a", "out-2", "ws-b", 810, 10, 100, 80),
        win("win-x", "out-1", "ws-a", 10, 10, 100, 80),
    ]
}

#[test]
fn directional_fingerprint_golden_vector() {
    // Cross-language pin with the adapter's `planDirectionalFingerprint`
    // test: both derivations must emit this exact value for the same input.
    // Recompute here only by changing the canonical scheme on both sides.
    let fp = directional_fp(&domains_payload(), "win-a", &one_each_windows());
    assert_eq!(fp, 1986527274, "golden directional fingerprint");
}

#[test]
fn focus_cross_selects_target_with_exact_operation_and_full_geometry() {
    let mut planner = Planner::new();
    let reply = parse(&planner.evaluate(&request(
        "dir-focus-1",
        "win-a",
        one_each_windows(),
        focus_cmd("win-a", "left"),
        true,
    )));
    assert_eq!(reply["outcome"], "planned", "{reply}");
    // Target is the adjacent output's current workspace (ws-a, not ws-b).
    assert_eq!(reply["desired_focus"]["domain_output"], "out-1", "{reply}");
    assert_eq!(
        reply["desired_focus"]["domain_workspace"], "ws-a",
        "{reply}"
    );
    // Exact cross operation fields with explicit source binding.
    let op = &reply["operation"];
    assert_eq!(op["op"], "focus", "{reply}");
    assert_eq!(op["domain_output"], "out-1", "{reply}");
    assert_eq!(op["domain_workspace"], "ws-a", "{reply}");
    assert_eq!(op["from_window"], "win-a", "{reply}");
    assert_eq!(op["to_window"], "win-x", "{reply}");
    assert_eq!(op["direction"], "left", "{reply}");
    assert_eq!(op["cross_source_output"], "out-2", "{reply}");
    assert_eq!(op["cross_source_workspace"], "ws-b", "{reply}");
    assert_eq!(op["route"].as_array().map(Vec::len), Some(1), "{reply}");
    // Exact preconditions with the adjacent-output token.
    assert_eq!(
        reply["preconditions"],
        serde_json::json!([
            "focused-leaf-occupied-by-focused-window",
            "target-leaf-occupied",
            "focus-targets-adjacent-output",
            "adapter-must-verify-postconditions",
        ]),
        "{reply}"
    );
    // Desired geometry covers both domains (source + target).
    let geometry = reply["desired_geometry"].as_array().expect("geometry");
    assert_eq!(geometry.len(), 2, "{reply}");
    let mut outputs: Vec<(&str, &str)> = geometry
        .iter()
        .map(|g| {
            (
                g["output"].as_str().expect("output"),
                g["workspace"].as_str().expect("workspace"),
            )
        })
        .collect();
    outputs.sort();
    assert_eq!(
        outputs,
        vec![("out-1", "ws-a"), ("out-2", "ws-b")],
        "{reply}"
    );
    // Gap/inset complete coverage: every rect positive and contained in its
    // inset work area ((808,8,784,584) source, (8,8,784,584) target).
    for entry in geometry {
        let (x, y, w, h) = (
            entry["rect"]["x"].as_i64().expect("x"),
            entry["rect"]["y"].as_i64().expect("y"),
            entry["rect"]["w"].as_i64().expect("w"),
            entry["rect"]["h"].as_i64().expect("h"),
        );
        assert!(w > 0 && h > 0, "{reply}");
        let (bx, by, bw, bh) = if entry["output"] == "out-2" {
            (808, 8, 784, 584)
        } else {
            (8, 8, 784, 584)
        };
        assert!(
            x >= bx && y >= by && x + w <= bx + bw && y + h <= by + bh,
            "rect contained: {reply}"
        );
    }
}

#[test]
fn focus_up_never_crosses_and_stays_local_refusal() {
    let mut planner = Planner::new();
    // A lone root leaf has no local Up target: local Unchanged refuses, and
    // the directional route never crosses vertically.
    let reply = parse(&planner.evaluate(&request(
        "dir-focus-up-1",
        "win-a",
        one_each_windows(),
        focus_cmd("win-a", "up"),
        true,
    )));
    assert_eq!(reply["outcome"], "rejected", "{reply}");
    assert_eq!(reply["kind"], "unchanged", "{reply}");
    assert!(reply.get("operation").is_none(), "{reply}");
}

#[test]
fn move_cross_occupied_plans_r4_with_target_focus() {
    // S20 equivalent with distinct workspaces: source H[win-a, win-b] with
    // win-b focused at the right root edge moves right into occupied out-2.
    let mut planner = Planner::new();
    let windows = vec![
        win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
        win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
        win("win-x", "out-2", "ws-b", 810, 10, 100, 80),
    ];
    let reply = parse(&planner.evaluate(&request_with_domain(
        "dir-move-1",
        "win-b",
        windows,
        move_cmd("win-b", "right"),
        left_source_domain(),
        Some(left_domains_payload()),
    )));
    assert_eq!(reply["outcome"], "planned", "{reply}");
    assert_eq!(reply["detail"]["rule"], "R4", "{reply}");
    assert_eq!(reply["desired_focus"]["domain_output"], "out-2", "{reply}");
    assert_eq!(
        reply["desired_focus"]["domain_workspace"], "ws-b",
        "{reply}"
    );
    let geometry = reply["desired_geometry"].as_array().expect("geometry");
    assert_eq!(geometry.len(), 3, "{reply}");
}

#[test]
fn move_cross_empty_target_plans_r4() {
    // S22 equivalent: source H[win-a, win-b] with win-b focused moves right
    // into the empty adjacent target; the mover lands on out-2/ws-b.
    let mut planner = Planner::new();
    let windows = vec![
        win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
        win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
    ];
    let reply = parse(&planner.evaluate(&request_with_domain(
        "dir-move-empty-1",
        "win-b",
        windows,
        move_cmd("win-b", "right"),
        left_source_domain(),
        Some(left_domains_payload()),
    )));
    assert_eq!(reply["outcome"], "planned", "{reply}");
    assert_eq!(reply["detail"]["rule"], "R4", "{reply}");
    assert_eq!(reply["desired_focus"]["domain_output"], "out-2", "{reply}");
    assert_eq!(
        reply["desired_focus"]["domain_workspace"], "ws-b",
        "{reply}"
    );
    // Source collapses to win-a; the mover lands on the target.
    let geometry = reply["desired_geometry"].as_array().expect("geometry");
    assert_eq!(geometry.len(), 2, "{reply}");
    let mover = geometry
        .iter()
        .find(|g| g["window"] == "win-b")
        .expect("mover geometry");
    assert_eq!(mover["output"], "out-2", "{reply}");
    assert_eq!(mover["workspace"], "ws-b", "{reply}");
}

#[test]
fn move_up_stays_local_never_r4() {
    let mut planner = Planner::new();
    let windows = vec![
        win("win-a", "out-2", "ws-b", 810, 10, 300, 200),
        win("win-b", "out-2", "ws-b", 810, 300, 300, 200),
        win("win-x", "out-1", "ws-a", 10, 10, 100, 80),
    ];
    let reply = parse(&planner.evaluate(&request(
        "dir-move-up-1",
        "win-b",
        windows,
        move_cmd("win-b", "up"),
        true,
    )));
    assert_eq!(reply["outcome"], "planned", "{reply}");
    assert_ne!(reply["detail"]["rule"], "R4", "{reply}");
    assert_eq!(reply["desired_focus"]["domain_output"], "out-2", "{reply}");
    assert_eq!(
        reply["desired_focus"]["domain_workspace"], "ws-b",
        "{reply}"
    );
}

#[test]
fn directional_refusals_fail_closed() {
    // Ambiguous duplicate output ids.
    {
        let mut planner = Planner::new();
        let mut value: serde_json::Value = serde_json::from_str(&request(
            "dir-ref-amb-1",
            "win-a",
            one_each_windows(),
            focus_cmd("win-a", "left"),
            true,
        ))
        .expect("valid");
        value["domains"] = serde_json::json!([
            {"output": "out-2", "workspace": "ws-b",
             "bounds": {"x": 800, "y": 0, "w": 800, "h": 600}, "gap": 4, "outer_gap": 8,
             "adjacent": {"left": "out-1"}},
            {"output": "out-1", "workspace": "ws-a",
             "bounds": {"x": 0, "y": 0, "w": 800, "h": 600}, "gap": 4, "outer_gap": 8,
             "adjacent": {"right": "out-2"}},
            {"output": "out-1", "workspace": "ws-c",
             "bounds": {"x": 1600, "y": 0, "w": 800, "h": 600}, "gap": 4, "outer_gap": 8,
             "adjacent": {"right": "out-2"}},
        ]);
        let reply = parse(&planner.evaluate(&value.to_string()));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
    }
    // Non-reciprocal adjacency.
    {
        let mut planner = Planner::new();
        let mut value: serde_json::Value = serde_json::from_str(&request(
            "dir-ref-rec-1",
            "win-a",
            one_each_windows(),
            focus_cmd("win-a", "left"),
            true,
        ))
        .expect("valid");
        value["domains"] = serde_json::json!([
            {"output": "out-2", "workspace": "ws-b",
             "bounds": {"x": 800, "y": 0, "w": 800, "h": 600}, "gap": 4, "outer_gap": 8,
             "adjacent": {"left": "out-1"}},
            {"output": "out-1", "workspace": "ws-a",
             "bounds": {"x": 0, "y": 0, "w": 800, "h": 600}, "gap": 4, "outer_gap": 8,
             "adjacent": {}},
        ]);
        let reply = parse(&planner.evaluate(&value.to_string()));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
    }
    // Vertical adjacency keys never admitted.
    {
        let mut planner = Planner::new();
        let mut value: serde_json::Value = serde_json::from_str(&request(
            "dir-ref-vert-1",
            "win-a",
            one_each_windows(),
            focus_cmd("win-a", "left"),
            true,
        ))
        .expect("valid");
        value["domains"] = serde_json::json!([
            {"output": "out-2", "workspace": "ws-b",
             "bounds": {"x": 800, "y": 0, "w": 800, "h": 600}, "gap": 4, "outer_gap": 8,
             "adjacent": {"up": "out-1"}},
            {"output": "out-1", "workspace": "ws-a",
             "bounds": {"x": 0, "y": 0, "w": 800, "h": 600}, "gap": 4, "outer_gap": 8,
             "adjacent": {"down": "out-2"}},
        ]);
        let reply = parse(&planner.evaluate(&value.to_string()));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
    }
    // Missing target window: partial observation.
    {
        let mut planner = Planner::new();
        let reply = parse(&planner.evaluate(&request(
            "dir-ref-miss-1",
            "win-a",
            vec![win("win-a", "out-2", "ws-b", 810, 10, 100, 80)],
            focus_cmd("win-a", "left"),
            false,
        )));
        // Single-domain legacy path without the target: local focus has no
        // target and refuses unchanged (no cross without domains).
        assert_eq!(reply["outcome"], "rejected", "{reply}");
    }
    // Owner change across calls re-binds without poisoning: the first call
    // seeds under owner-1, the second under owner-9 plans the same cross
    // focus from a fresh seed (never a stale substitution).
    {
        let mut planner = Planner::new();
        let first = parse(&planner.evaluate(&request(
            "dir-ref-owner-1",
            "win-a",
            one_each_windows(),
            focus_cmd("win-a", "left"),
            true,
        )));
        assert_eq!(first["outcome"], "planned", "{first}");
        let mut value: serde_json::Value = serde_json::from_str(&request(
            "dir-ref-owner-2",
            "win-a",
            one_each_windows(),
            focus_cmd("win-a", "left"),
            true,
        ))
        .expect("valid");
        value["owner"] = serde_json::json!("owner-9");
        let reply = parse(&planner.evaluate(&value.to_string()));
        assert_eq!(reply["outcome"], "planned", "{reply}");
        assert_eq!(reply["desired_focus"]["domain_output"], "out-1", "{reply}");
    }
    // Duplicate window ids fail closed.
    {
        let mut planner = Planner::new();
        let mut windows = one_each_windows();
        windows.push(win("win-a", "out-1", "ws-a", 10, 10, 100, 80));
        let reply = parse(&planner.evaluate(&request(
            "dir-ref-dup-1",
            "win-a",
            windows,
            focus_cmd("win-a", "left"),
            true,
        )));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
    }
    // Focused window outside the source domain fails closed.
    {
        let mut planner = Planner::new();
        let reply = parse(&planner.evaluate(&request(
            "dir-ref-foc-1",
            "win-x",
            one_each_windows(),
            focus_cmd("win-x", "left"),
            true,
        )));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
    }
    // Domains on a non-directional op refuse.
    {
        let mut planner = Planner::new();
        let reply = parse(&planner.evaluate(&request(
            "dir-ref-op-1",
            "win-a",
            one_each_windows(),
            serde_json::json!({"op": "resize", "window": "win-a", "direction": "left", "mode": "outwards", "press_index": 0}),
            true,
        )));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
    }
}

#[test]
fn fingerprint_tampering_fails_at_request_validation() {
    // Altered target rect, bounds, gap, or adjacency must fail here at
    // request validation (`fingerprint-mismatch` or shape refusal), not
    // only at reply revalidation downstream.
    let base_windows = one_each_windows();
    let base_domains = domains_payload();
    let tamper_window_rect = {
        let mut windows = base_windows.clone();
        windows[1]["rect"]["x"] = serde_json::json!(20);
        windows
    };
    let tamper_target_bounds = {
        let mut domains = base_domains.clone();
        domains[1]["bounds"]["w"] = serde_json::json!(700);
        domains
    };
    let tamper_gap = {
        let mut domains = base_domains.clone();
        domains[1]["gap"] = serde_json::json!(5);
        domains
    };
    // Reciprocity-breaking adjacency fails as domain-invalid at validation.
    let tamper_adjacency = {
        let mut domains = base_domains.clone();
        domains[1]["adjacent"] = serde_json::json!({});
        domains
    };
    let cases: Vec<(&str, Vec<serde_json::Value>, serde_json::Value, &str)> = vec![
        (
            "rect",
            tamper_window_rect,
            base_domains.clone(),
            "fingerprint-mismatch",
        ),
        (
            "bounds",
            base_windows.clone(),
            tamper_target_bounds,
            "fingerprint-mismatch",
        ),
        (
            "gap",
            base_windows.clone(),
            tamper_gap,
            "fingerprint-mismatch",
        ),
        (
            "adjacency",
            base_windows.clone(),
            tamper_adjacency,
            "domain-invalid",
        ),
    ];
    for (tag, windows, domains, detail) in cases {
        let mut planner = Planner::new();
        // Fingerprint computed over the UNtampered evidence would pass;
        // here the request helper binds the tampered evidence, so a stale
        // pre-tamper fingerprint must also fail. Build both variants.
        let fp_tampered = directional_fp(&domains, "win-a", &windows);
        let mut value: serde_json::Value = serde_json::from_str(&request_with_domain(
            &format!("dir-fp-{tag}-1"),
            "win-a",
            windows.clone(),
            focus_cmd("win-a", "left"),
            source_domain(),
            Some(domains.clone()),
        ))
        .expect("valid");
        // Sanity: helper-bound fingerprint matches the tampered evidence…
        assert_eq!(value["fingerprint"].as_u64().expect("fp"), fp_tampered);
        // …while the pre-tamper fingerprint does not.
        let fp_clean = directional_fp(&base_domains, "win-a", &base_windows);
        assert_ne!(fp_tampered, fp_clean, "{tag}");
        value["fingerprint"] = serde_json::json!(fp_clean);
        let reply = parse(&planner.evaluate(&value.to_string()));
        assert_eq!(reply["outcome"], "rejected", "{tag} {reply}");
        assert_eq!(reply["kind"], "snapshot-invalid", "{tag} {reply}");
        assert_eq!(reply["detail"], detail, "{tag} {reply}");
    }
}

#[test]
fn stale_adjacency_does_not_poison_retained_pair() {
    let mut planner = Planner::new();
    let first = parse(&planner.evaluate(&request(
        "dir-stale-1",
        "win-a",
        one_each_windows(),
        focus_cmd("win-a", "left"),
        true,
    )));
    assert_eq!(first["outcome"], "planned", "{first}");
    // Same windows, changed adjacency (target no longer reciprocal):
    // rejected at validation, retained pair untouched.
    let mut stale: serde_json::Value = serde_json::from_str(&request(
        "dir-stale-2",
        "win-a",
        one_each_windows(),
        focus_cmd("win-a", "left"),
        true,
    ))
    .expect("valid");
    stale["domains"][1]["adjacent"] = serde_json::json!({});
    // Rebind the fingerprint to the stale evidence so the refusal proves
    // adjacency matching, not fingerprint binding.
    stale["fingerprint"] = serde_json::json!(directional_fp(
        &stale["domains"],
        "win-a",
        &one_each_windows(),
    ));
    let refused = parse(&planner.evaluate(&stale.to_string()));
    assert_eq!(refused["outcome"], "rejected", "{refused}");
    // The original evidence still plans: no poisoning, no wedge.
    let revived = parse(&planner.evaluate(&request(
        "dir-stale-3",
        "win-a",
        one_each_windows(),
        focus_cmd("win-a", "left"),
        true,
    )));
    assert_eq!(revived["outcome"], "planned", "{revived}");
    assert_eq!(
        revived["desired_focus"]["domain_output"], "out-1",
        "{revived}"
    );
}

#[test]
fn many_pairs_plan_without_domain_cap() {
    // No retained-domain count cap: ten distinct pairs (20 domains, beyond
    // the old 16-domain bound) all establish canonical components and plan,
    // and the first pair still plans afterwards.
    let mut planner = Planner::new();
    let pair_request = |tag: &str, i: usize| {
        let out_l = format!("out-l{i}");
        let out_r = format!("out-r{i}");
        let ws = format!("ws-{i}");
        let domains = serde_json::json!([
            {"output": out_l, "workspace": ws,
             "bounds": {"x": 0, "y": 0, "w": 800, "h": 600}, "gap": 0, "outer_gap": 0,
             "adjacent": {"right": out_r}},
            {"output": out_r, "workspace": ws,
             "bounds": {"x": 800, "y": 0, "w": 800, "h": 600}, "gap": 0, "outer_gap": 0,
             "adjacent": {"left": out_l}},
        ]);
        let wins = vec![
            win("win-a", &out_l, &ws, 10, 10, 100, 80),
            win("win-x", &out_r, &ws, 810, 10, 100, 80),
        ];
        let domain = serde_json::json!({
            "output": out_l, "workspace": ws,
            "bounds": {"x": 0, "y": 0, "w": 800, "h": 600}, "gap": 0, "outer_gap": 0,
        });
        request_with_domain(
            tag,
            "win-a",
            wins,
            focus_cmd("win-a", "right"),
            domain,
            Some(domains),
        )
    };
    for i in 0..10 {
        let reply = parse(&planner.evaluate(&pair_request(&format!("dir-cap-{i}"), i)));
        assert_eq!(reply["outcome"], "planned", "pair {i}: {reply}");
    }
    // The eleventh pair also plans, then the first pair still plans.
    let extra = parse(&planner.evaluate(&pair_request("dir-cap-10", 10)));
    assert_eq!(extra["outcome"], "planned", "{extra}");
    let first_again = parse(&planner.evaluate(&pair_request("dir-cap-0b", 0)));
    assert_eq!(first_again["outcome"], "planned", "{first_again}");
    assert_eq!(
        first_again["desired_focus"]["domain_output"], "out-r0",
        "{first_again}"
    );
}

#[test]
fn move_cross_carries_exact_r4_operation() {
    let mut planner = Planner::new();
    let windows = vec![
        win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
        win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
        win("win-x", "out-2", "ws-b", 810, 10, 100, 80),
    ];
    let reply = parse(&planner.evaluate(&request_with_domain(
        "dir-move-op-1",
        "win-b",
        windows,
        move_cmd("win-b", "right"),
        left_source_domain(),
        Some(left_domains_payload()),
    )));
    assert_eq!(reply["outcome"], "planned", "{reply}");
    let op = &reply["operation"];
    assert_eq!(op["op"], "move", "{reply}");
    assert_eq!(op["rule"], "R4", "{reply}");
    assert_eq!(op["capability"], "CrossOutputTransfer", "{reply}");
    assert_eq!(op["direction"], "right", "{reply}");
    assert_eq!(op["window"], "win-b", "{reply}");
    assert_eq!(op["source_output"], "out-1", "{reply}");
    assert_eq!(op["source_workspace"], "ws-a", "{reply}");
    assert_eq!(op["target_output"], "out-2", "{reply}");
    assert_eq!(op["target_workspace"], "ws-b", "{reply}");
    assert_eq!(op["target"], "occupied", "{reply}");
    assert_eq!(
        reply["preconditions"],
        serde_json::json!([
            "focused-leaf-occupied-by-focused-window",
            "source-root-membership-and-adjacent-same-workspace-output",
            "adapter-must-verify-postconditions",
        ]),
        "{reply}"
    );
}

#[test]
fn move_cross_empty_target_operation_marks_empty() {
    let mut planner = Planner::new();
    let windows = vec![
        win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
        win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
    ];
    let reply = parse(&planner.evaluate(&request_with_domain(
        "dir-move-op-2",
        "win-b",
        windows,
        move_cmd("win-b", "right"),
        left_source_domain(),
        Some(left_domains_payload()),
    )));
    assert_eq!(reply["outcome"], "planned", "{reply}");
    assert_eq!(reply["operation"]["target"], "empty", "{reply}");
    assert_eq!(reply["operation"]["rule"], "R4", "{reply}");
}

#[test]
fn active_adapter_capability_refuses_r4_without_staging_state() {
    let mut planner = Planner::new();
    let windows = vec![
        win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
        win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
        win("win-x", "out-2", "ws-b", 810, 10, 100, 80),
    ];
    let mut disabled: serde_json::Value = serde_json::from_str(&request_with_domain(
        "dir-r4-disabled-1",
        "win-b",
        windows.clone(),
        move_cmd("win-b", "right"),
        left_source_domain(),
        Some(left_domains_payload()),
    ))
    .expect("valid request");
    disabled["command"]["cross_output_transfer"] = serde_json::json!(false);
    let refused = parse(&planner.evaluate(&disabled.to_string()));
    assert_eq!(refused["outcome"], "rejected", "{refused}");
    assert_eq!(refused["kind"], "unsupported-capability", "{refused}");

    // The refusal did not stage a cross move: a capable follow-up starts from
    // the original source/target membership and plans normally.
    let retry = parse(&planner.evaluate(&request_with_domain(
        "dir-r4-disabled-2",
        "win-b",
        windows,
        move_cmd("win-b", "right"),
        left_source_domain(),
        Some(left_domains_payload()),
    )));
    assert_eq!(retry["outcome"], "planned", "{retry}");
    assert_eq!(retry["detail"]["rule"], "R4", "{retry}");
}

#[test]
fn s21_perpendicular_move_stays_local_r1() {
    // S21 equivalent: the source holds a perpendicular group with win-b
    // focused, and `Meta+Left` applies the local perpendicular wrap (R1)
    // instead of crossing. Step one turns the seeded H group into a V group
    // via Up (R1); step two moves Left inside that V group (R1 again).
    // Neither step crosses, carries an operation, or leaks geometry.
    let mut planner = Planner::new();
    let windows = vec![
        win("win-a", "out-2", "ws-b", 810, 10, 300, 200),
        win("win-b", "out-2", "ws-b", 1150, 10, 300, 200),
        win("win-x", "out-1", "ws-a", 10, 10, 100, 80),
    ];
    let first = parse(&planner.evaluate(&request(
        "dir-s21-1",
        "win-b",
        windows.clone(),
        move_cmd("win-b", "up"),
        true,
    )));
    assert_eq!(first["outcome"], "planned", "{first}");
    assert_eq!(first["detail"]["rule"], "R1", "{first}");
    assert!(first.get("operation").is_none(), "{first}");
    let reply = parse(&planner.evaluate(&request(
        "dir-s21-2",
        "win-b",
        windows,
        move_cmd("win-b", "left"),
        true,
    )));
    assert_eq!(reply["outcome"], "planned", "{reply}");
    assert_eq!(reply["detail"]["rule"], "R1", "{reply}");
    assert!(reply.get("operation").is_none(), "{reply}");
    assert_eq!(reply["desired_focus"]["domain_output"], "out-2", "{reply}");
    assert_eq!(
        reply["desired_focus"]["domain_workspace"], "ws-b",
        "{reply}"
    );
    // Geometry stays source-only: no cross-domain leak.
    for entry in reply["desired_geometry"].as_array().expect("geometry") {
        assert_eq!(entry["output"], "out-2", "{reply}");
        assert_eq!(entry["workspace"], "ws-b", "{reply}");
    }
}

#[test]
fn multiwindow_target_preserves_members_and_focuses_mover() {
    // Occupied multiwindow target: all target members survive with distinct
    // positive contained rects (no root collapse), the mover joins the
    // target beside the remembered leaf, the source collapses, focus follows.
    let mut planner = Planner::new();
    let windows = vec![
        win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
        win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
        win("win-x", "out-2", "ws-b", 810, 10, 200, 200),
        win("win-y", "out-2", "ws-b", 810, 300, 200, 200),
    ];
    let reply = parse(&planner.evaluate(&request_with_domain(
        "dir-mw-1",
        "win-b",
        windows,
        move_cmd("win-b", "right"),
        left_source_domain(),
        Some(left_domains_payload()),
    )));
    assert_eq!(reply["outcome"], "planned", "{reply}");
    assert_eq!(reply["detail"]["rule"], "R4", "{reply}");
    let geometry = reply["desired_geometry"].as_array().expect("geometry");
    assert_eq!(geometry.len(), 4, "{reply}");
    // Mover on the target; every target member present exactly once.
    let mut seen: Vec<&str> = geometry
        .iter()
        .map(|g| g["window"].as_str().expect("window"))
        .collect();
    seen.sort();
    assert_eq!(seen, vec!["win-a", "win-b", "win-x", "win-y"], "{reply}");
    let mover = geometry
        .iter()
        .find(|g| g["window"] == "win-b")
        .expect("mover");
    assert_eq!(mover["output"], "out-2", "{reply}");
    assert_eq!(mover["workspace"], "ws-b", "{reply}");
    // Source collapses to win-a alone.
    let source: Vec<&serde_json::Value> =
        geometry.iter().filter(|g| g["output"] == "out-1").collect();
    assert_eq!(source.len(), 1, "{reply}");
    assert_eq!(source[0]["window"], "win-a", "{reply}");
    // Complete per-domain contained geometry with gaps.
    for entry in geometry {
        let (x, y, w, h) = (
            entry["rect"]["x"].as_i64().expect("x"),
            entry["rect"]["y"].as_i64().expect("y"),
            entry["rect"]["w"].as_i64().expect("w"),
            entry["rect"]["h"].as_i64().expect("h"),
        );
        assert!(w > 0 && h > 0, "{reply}");
        let (bx, by, bw, bh) = if entry["output"] == "out-2" {
            (808, 8, 784, 584)
        } else {
            (8, 8, 784, 584)
        };
        assert!(
            x >= bx && y >= by && x + w <= bx + bw && y + h <= by + bh,
            "{reply}"
        );
    }
    assert_eq!(reply["desired_focus"]["domain_output"], "out-2", "{reply}");
}

#[test]
fn s23_cross_and_return_round_trip() {
    // S23 equivalent: cross to the target, then cross back through the
    // reverse ordered pair. Both directions plan against retained sessions
    // with the target's current workspaces.
    let mut planner = Planner::new();
    let out = parse(&planner.evaluate(&request(
        "dir-s23-1",
        "win-a",
        one_each_windows(),
        focus_cmd("win-a", "left"),
        true,
    )));
    assert_eq!(out["outcome"], "planned", "{out}");
    assert_eq!(out["desired_focus"]["domain_output"], "out-1", "{out}");
    // Reverse pair: source out-1/ws-a, target out-2/ws-b, focus win-x right.
    let reverse_domains = serde_json::json!([
        {"output": "out-1", "workspace": "ws-a",
         "bounds": {"x": 0, "y": 0, "w": 800, "h": 600}, "gap": 4, "outer_gap": 8,
         "adjacent": {"right": "out-2"}},
        {"output": "out-2", "workspace": "ws-b",
         "bounds": {"x": 800, "y": 0, "w": 800, "h": 600}, "gap": 4, "outer_gap": 8,
         "adjacent": {"left": "out-1"}},
    ]);
    let reverse_source = serde_json::json!({
        "output": "out-1", "workspace": "ws-a",
        "bounds": {"x": 0, "y": 0, "w": 800, "h": 600}, "gap": 4, "outer_gap": 8,
    });
    let back = parse(&planner.evaluate(&request_with_domain(
        "dir-s23-2",
        "win-x",
        one_each_windows(),
        focus_cmd("win-x", "right"),
        reverse_source,
        Some(reverse_domains),
    )));
    assert_eq!(back["outcome"], "planned", "{back}");
    assert_eq!(back["desired_focus"]["domain_output"], "out-2", "{back}");
    assert_eq!(back["desired_focus"]["domain_workspace"], "ws-b", "{back}");
}

#[test]
fn visibility_and_revision_fences_hold_then_recover() {
    // Unknown workspace: cross-domain mismatch, no wedge.
    {
        let mut planner = Planner::new();
        let mut windows = one_each_windows();
        windows[1]["workspace"] = serde_json::json!("ws-ghost");
        let reply = parse(&planner.evaluate(&request(
            "dir-vis-1",
            "win-a",
            windows,
            focus_cmd("win-a", "left"),
            true,
        )));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
        // Fresh valid evidence still plans afterwards.
        let revived = parse(&planner.evaluate(&request(
            "dir-vis-2",
            "win-a",
            one_each_windows(),
            focus_cmd("win-a", "left"),
            true,
        )));
        assert_eq!(revived["outcome"], "planned", "{revived}");
    }
    // Missing target member: rejected without wedge.
    {
        let mut planner = Planner::new();
        let reply = parse(&planner.evaluate(&request(
            "dir-vis-3",
            "win-a",
            vec![win("win-a", "out-2", "ws-b", 810, 10, 100, 80)],
            focus_cmd("win-a", "left"),
            true,
        )));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
    }
    // Oversize revision: rejected before planning.
    {
        let mut planner = Planner::new();
        let mut value: serde_json::Value = serde_json::from_str(&request(
            "dir-vis-4",
            "win-a",
            one_each_windows(),
            focus_cmd("win-a", "left"),
            true,
        ))
        .expect("valid");
        value["revision"] = serde_json::json!(1_000_001);
        let reply = parse(&planner.evaluate(&value.to_string()));
        assert_eq!(reply["outcome"], "rejected", "{reply}");
    }
}

#[test]
fn single_domain_legacy_unchanged_without_domains() {
    let mut planner = Planner::new();
    // No `domains` field: legacy single-domain focus plans locally.
    let windows = vec![
        win("win-a", "out-2", "ws-b", 810, 10, 300, 200),
        win("win-b", "out-2", "ws-b", 1150, 10, 300, 200),
    ];
    let reply = parse(&planner.evaluate(&request(
        "dir-legacy-1",
        "win-b",
        windows,
        focus_cmd("win-b", "left"),
        false,
    )));
    assert_eq!(reply["outcome"], "planned", "{reply}");
    assert!(reply.get("operation").is_none(), "{reply}");
    assert_eq!(reply["desired_focus"]["domain_output"], "out-2", "{reply}");
}

// R4 async lifecycle helpers: build ack/verify post-observation requests from
// a planned R4 reply. The post windows are exactly the desired geometry
// (output/workspace/rect), the correlation is reused, the revision is the
// planned base, and focus is empty (relaxed for ack/verify like the
// workspace route).
fn post_windows_from_geometry(geometry: &serde_json::Value) -> Vec<serde_json::Value> {
    geometry
        .as_array()
        .expect("desired geometry")
        .iter()
        .map(|g| {
            serde_json::json!({
                "window": g["window"],
                "output": g["output"],
                "workspace": g["workspace"],
                "rect": g["rect"],
            })
        })
        .collect()
}

fn ack_request(
    correlation: &str,
    base_revision: u64,
    post_windows: Vec<serde_json::Value>,
    outcome: &str,
) -> String {
    let mut value: serde_json::Value = serde_json::from_str(&request_with_domain(
        correlation,
        "",
        post_windows,
        serde_json::json!({"op": "directional-move-ack", "ack_outcome": outcome}),
        left_source_domain(),
        Some(left_domains_payload()),
    ))
    .expect("valid ack");
    value["correlation_id"] = serde_json::json!(correlation);
    value["revision"] = serde_json::json!(base_revision);
    // Rebind the fingerprint to the post evidence (helper already does, but
    // the empty focus plus post rects must bind exactly).
    value["fingerprint"] = serde_json::json!(directional_fp(
        &value["domains"],
        "",
        &value["windows"].as_array().cloned().unwrap_or_default(),
    ));
    value.to_string()
}

fn verify_request(
    correlation: &str,
    base_revision: u64,
    post_windows: Vec<serde_json::Value>,
    preconditions: serde_json::Value,
    operation: serde_json::Value,
) -> String {
    let mut value: serde_json::Value = serde_json::from_str(&request_with_domain(
        correlation,
        "",
        post_windows,
        serde_json::json!({
            "op": "directional-move-verify",
            "verified": true,
            "preconditions": preconditions,
            "operation": operation,
        }),
        left_source_domain(),
        Some(left_domains_payload()),
    ))
    .expect("valid verify");
    value["correlation_id"] = serde_json::json!(correlation);
    value["revision"] = serde_json::json!(base_revision);
    value["fingerprint"] = serde_json::json!(directional_fp(
        &value["domains"],
        "",
        &value["windows"].as_array().cloned().unwrap_or_default(),
    ));
    value.to_string()
}

fn plan_r4_occupied(planner: &mut Planner, correlation: &str) -> serde_json::Value {
    let windows = vec![
        win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
        win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
        win("win-x", "out-2", "ws-b", 810, 10, 100, 80),
    ];
    let reply = parse(&planner.evaluate(&request_with_domain(
        correlation,
        "win-b",
        windows,
        move_cmd("win-b", "right"),
        left_source_domain(),
        Some(left_domains_payload()),
    )));
    assert_eq!(reply["outcome"], "planned", "{reply}");
    assert_eq!(reply["detail"]["rule"], "R4", "{reply}");
    reply
}

#[test]
fn r4_stages_pending_and_blocks_until_verify() {
    let mut planner = Planner::new();
    let planned = plan_r4_occupied(&mut planner, "dir-pend-1");
    let base = planned["base_revision"].as_u64().expect("base");
    let geometry = planned["desired_geometry"].clone();
    let preconditions = planned["preconditions"].clone();
    let operation = planned["operation"].clone();

    // R4 no longer synchronously commits: ordinary focus and a second R4
    // both block as pending-exists while the pending is live.
    let blocked_focus = parse(&planner.evaluate(&request_with_domain(
        "dir-pend-2",
        "win-b",
        vec![
            win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
            win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
            win("win-x", "out-2", "ws-b", 810, 10, 100, 80),
        ],
        move_cmd("win-b", "right"),
        left_source_domain(),
        Some(left_domains_payload()),
    )));
    assert_eq!(blocked_focus["outcome"], "rejected", "{blocked_focus}");
    assert_eq!(blocked_focus["kind"], "pending-exists", "{blocked_focus}");

    let blocked_single = parse(&planner.evaluate(&request(
        "dir-pend-3",
        "win-a",
        one_each_windows(),
        focus_cmd("win-a", "left"),
        true,
    )));
    assert_eq!(blocked_single["outcome"], "rejected", "{blocked_single}");
    assert_eq!(blocked_single["kind"], "pending-exists", "{blocked_single}");

    // Ack binds the exact pending and returns acknowledged.
    let post = post_windows_from_geometry(&geometry);
    let acked =
        parse(&planner.evaluate(&ack_request("dir-pend-1", base, post.clone(), "accepted")));
    assert_eq!(acked["outcome"], "acknowledged", "{acked}");
    assert_eq!(acked["base_revision"], base, "{acked}");

    // Verify with the exact operation/preconditions plus complete post
    // observation commits once and advances by exactly one.
    let committed = parse(&planner.evaluate(&verify_request(
        "dir-pend-1",
        base,
        post,
        preconditions,
        operation,
    )));
    assert_eq!(committed["outcome"], "committed", "{committed}");
    assert_eq!(committed["base_revision"], base + 1, "{committed}");

    // Pending released: the committed canonical pair serves follow-ups.
    // Post-commit the mover lives on the target, so revive with the full
    // post membership and cross-focus the remaining source window right.
    let revive_post = post_windows_from_geometry(&geometry);
    let revived = parse(&planner.evaluate(&request_with_domain(
        "dir-pend-4",
        "win-a",
        revive_post,
        focus_cmd("win-a", "right"),
        left_source_domain(),
        Some(left_domains_payload()),
    )));
    assert_eq!(revived["outcome"], "planned", "{revived}");

    // The committed target pair remains canonical: its left-edge mover may
    // immediately reverse across the same output boundary as a fresh R4.
    let reverse = parse(&planner.evaluate(&request_with_domain(
        "dir-pend-5",
        "win-b",
        post_windows_from_geometry(&geometry),
        move_cmd("win-b", "left"),
        source_domain(),
        Some(domains_payload()),
    )));
    assert_eq!(reverse["outcome"], "planned", "{reverse}");
    assert_eq!(reverse["detail"]["rule"], "R4", "{reverse}");
    assert_eq!(reverse["operation"]["source_output"], "out-2", "{reverse}");
    assert_eq!(reverse["operation"]["target_output"], "out-1", "{reverse}");
}

#[test]
fn r4_overconstrained_post_commits_client_geometry_but_not_other_mismatches() {
    for mismatch in [false, true] {
        let mut planner = Planner::new();
        let correlation = if mismatch {
            "dir-hint-mismatch"
        } else {
            "dir-hint-success"
        };
        let mut constrained = win("win-x", "out-2", "ws-b", 810, 10, 100, 80);
        constrained["min_size"] = serde_json::json!({"w": 1, "h": 1000});
        let planned = parse(&planner.evaluate(&request_with_domain(
            correlation,
            "win-b",
            vec![
                win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
                win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
                constrained,
            ],
            move_cmd("win-b", "right"),
            left_source_domain(),
            Some(left_domains_payload()),
        )));
        assert_eq!(planned["outcome"], "planned", "{planned}");
        let geometry = planned["desired_geometry"].as_array().expect("geometry");
        assert_eq!(
            geometry
                .iter()
                .filter(|g| g["overconstrained"] == true)
                .count(),
            1,
            "{planned}"
        );
        assert_eq!(
            geometry
                .iter()
                .find(|g| g["window"] == "win-x")
                .expect("target")["overconstrained"],
            true
        );
        let mut post = post_windows_from_geometry(&planned["desired_geometry"]);
        let target = post
            .iter_mut()
            .find(|w| w["window"] == "win-x")
            .expect("target");
        target["rect"]["h"] = serde_json::json!(target["rect"]["h"].as_i64().expect("height") - 1);
        if mismatch {
            let other = post
                .iter_mut()
                .find(|w| w["window"] == "win-b")
                .expect("mover");
            other["rect"]["w"] = serde_json::json!(other["rect"]["w"].as_i64().expect("width") - 1);
        }
        let base = planned["base_revision"].as_u64().expect("base");
        let acked =
            parse(&planner.evaluate(&ack_request(correlation, base, post.clone(), "accepted")));
        assert_eq!(acked["outcome"], "acknowledged", "{acked}");
        let verified = parse(&planner.evaluate(&verify_request(
            correlation,
            base,
            post,
            planned["preconditions"].clone(),
            planned["operation"].clone(),
        )));
        assert_eq!(
            verified["outcome"],
            if mismatch { "diverged" } else { "committed" },
            "{verified}"
        );
        if mismatch {
            assert_eq!(verified["kind"], "postcondition-mismatch", "{verified}");
        }
    }
}

#[test]
fn r4_verify_without_ack_is_rejected() {
    let mut planner = Planner::new();
    let planned = plan_r4_occupied(&mut planner, "dir-noack-1");
    let base = planned["base_revision"].as_u64().expect("base");
    let post = post_windows_from_geometry(&planned["desired_geometry"]);
    let verify = parse(&planner.evaluate(&verify_request(
        "dir-noack-1",
        base,
        post,
        planned["preconditions"].clone(),
        planned["operation"].clone(),
    )));
    assert_eq!(verify["outcome"], "rejected", "{verify}");
    assert_eq!(verify["kind"], "verify-rejected", "{verify}");
}

#[test]
fn r4_refused_ack_is_terminal_diverged_without_commit() {
    let mut planner = Planner::new();
    let planned = plan_r4_occupied(&mut planner, "dir-refack-1");
    let base = planned["base_revision"].as_u64().expect("base");
    let post = post_windows_from_geometry(&planned["desired_geometry"]);
    let refused = parse(&planner.evaluate(&ack_request(
        "dir-refack-1",
        base,
        post,
        "partial-application",
    )));
    assert_eq!(refused["outcome"], "diverged", "{refused}");
    assert_eq!(refused["kind"], "partial-application", "{refused}");
    // Wedged terminal: a follow-up with fresh evidence stays diverged, never
    // commits or recovers into the pair.
    let again = parse(&planner.evaluate(&request(
        "dir-refack-2",
        "win-a",
        one_each_windows(),
        focus_cmd("win-a", "left"),
        true,
    )));
    assert_eq!(again["outcome"], "diverged", "{again}");
}

#[test]
fn r4_verify_mismatch_is_terminal_diverged() {
    // Tampered preconditions diverge without commit.
    {
        let mut planner = Planner::new();
        let planned = plan_r4_occupied(&mut planner, "dir-mis-pre-1");
        let base = planned["base_revision"].as_u64().expect("base");
        let post = post_windows_from_geometry(&planned["desired_geometry"]);
        let acked = parse(&planner.evaluate(&ack_request(
            "dir-mis-pre-1",
            base,
            post.clone(),
            "accepted",
        )));
        assert_eq!(acked["outcome"], "acknowledged", "{acked}");
        let mut preconditions = planned["preconditions"].clone();
        preconditions.as_array_mut().expect("preconditions")[0] =
            serde_json::json!("neighbor-leaf-occupied");
        let diverged = parse(&planner.evaluate(&verify_request(
            "dir-mis-pre-1",
            base,
            post,
            preconditions,
            planned["operation"].clone(),
        )));
        assert_eq!(diverged["outcome"], "diverged", "{diverged}");
    }
    // Tampered geometry (two target rects swapped: still in-bounds, but
    // mismatched) diverges without commit.
    {
        let mut planner = Planner::new();
        let planned = plan_r4_occupied(&mut planner, "dir-mis-geo-1");
        let base = planned["base_revision"].as_u64().expect("base");
        let mut post = post_windows_from_geometry(&planned["desired_geometry"]);
        // Swap the rects of the two target-homed entries while keeping each
        // window id homed: still contained, but not the desired geometry.
        let target_indices: Vec<usize> = post
            .iter()
            .enumerate()
            .filter(|(_, w)| w["output"] == "out-2")
            .map(|(i, _)| i)
            .collect();
        assert_eq!(target_indices.len(), 2, "{planned}");
        let (a, b) = (target_indices[0], target_indices[1]);
        let rect_a = post[a]["rect"].clone();
        post[a]["rect"] = post[b]["rect"].clone();
        post[b]["rect"] = rect_a;
        // Rebind fingerprint to the tampered post so the failure proves the
        // complete-observation match, not fingerprint binding.
        let verify = verify_request(
            "dir-mis-geo-1",
            base,
            post,
            planned["preconditions"].clone(),
            planned["operation"].clone(),
        );
        let ack_post = post_windows_from_geometry(&planned["desired_geometry"]);
        let acked =
            parse(&planner.evaluate(&ack_request("dir-mis-geo-1", base, ack_post, "accepted")));
        assert_eq!(acked["outcome"], "acknowledged", "{acked}");
        let diverged = parse(&planner.evaluate(&verify));
        assert_eq!(diverged["outcome"], "diverged", "{diverged}");
    }
    // Wrong correlation diverges.
    {
        let mut planner = Planner::new();
        let planned = plan_r4_occupied(&mut planner, "dir-mis-corr-1");
        let base = planned["base_revision"].as_u64().expect("base");
        let post = post_windows_from_geometry(&planned["desired_geometry"]);
        let acked = parse(&planner.evaluate(&ack_request(
            "dir-mis-corr-2",
            base,
            post.clone(),
            "accepted",
        )));
        assert_eq!(acked["outcome"], "diverged", "{acked}");
        assert_eq!(acked["kind"], "correlation-mismatch", "{acked}");
    }
}

#[test]
fn r1_r3_stay_synchronous_without_pending() {
    // Local moves commit synchronously: no ack/verify round trip, no R4
    // operation, and an immediate follow-up plans (no pending-exists).
    let mut planner = Planner::new();
    let windows = vec![
        win("win-a", "out-2", "ws-b", 810, 10, 300, 200),
        win("win-b", "out-2", "ws-b", 1150, 10, 300, 200),
        win("win-x", "out-1", "ws-a", 10, 10, 100, 80),
    ];
    let first = parse(&planner.evaluate(&request(
        "dir-sync-1",
        "win-b",
        windows.clone(),
        move_cmd("win-b", "left"),
        true,
    )));
    assert_eq!(first["outcome"], "planned", "{first}");
    assert_ne!(first["detail"]["rule"], "R4", "{first}");
    assert!(first.get("operation").is_none(), "{first}");
    // Synchronous commit stored the canonical source: a legacy single-domain
    // follow-up on the source members plans immediately (no pending).
    let follow = parse(&planner.evaluate(&request_with_domain(
        "dir-sync-2",
        "win-a",
        vec![
            win("win-a", "out-2", "ws-b", 810, 10, 300, 200),
            win("win-b", "out-2", "ws-b", 1150, 10, 300, 200),
        ],
        focus_cmd("win-a", "left"),
        source_domain(),
        None,
    )));
    assert_eq!(follow["outcome"], "planned", "{follow}");
}

// R4 cancel helper: same two-domain envelope as status (rebased revision,
// rebound fingerprint) with the cancellation command carrying the
// zero-dispatch attestation and the exact dispatch-time pre-observation.
// Revision is always the original request revision (0), never a base learned
// from a stale probe.
fn cancel_request(
    correlation: &str,
    focused: &str,
    pre_windows: Vec<serde_json::Value>,
    zero_dispatch: bool,
) -> String {
    let mut value: serde_json::Value = serde_json::from_str(&request_with_domain(
        correlation,
        focused,
        pre_windows,
        serde_json::json!({"op": "directional-move-cancel", "zero_dispatch": zero_dispatch}),
        left_source_domain(),
        Some(left_domains_payload()),
    ))
    .expect("valid cancel");
    value["correlation_id"] = serde_json::json!(correlation);
    value["revision"] = serde_json::json!(0);
    value["fingerprint"] = serde_json::json!(directional_fp(
        &value["domains"],
        focused,
        &value["windows"].as_array().cloned().unwrap_or_default(),
    ));
    value.to_string()
}

fn r4_pre_windows() -> Vec<serde_json::Value> {
    vec![
        win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
        win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
        win("win-x", "out-2", "ws-b", 810, 10, 100, 80),
    ]
}

#[test]
fn directional_cancel_withdraws_unacked_pre_and_leaves_new_correlation_usable() {
    let mut planner = Planner::new();
    let planned = plan_r4_occupied(&mut planner, "dir-cancel-1");
    let base = planned["base_revision"].as_u64().expect("base");
    // Exact dispatch-time pre-image with the original request revision:
    // withdrawn, never committed.
    let cancelled = parse(&planner.evaluate(&cancel_request(
        "dir-cancel-1",
        "win-b",
        r4_pre_windows(),
        true,
    )));
    assert_eq!(cancelled["outcome"], "cancelled", "{cancelled}");
    assert_eq!(cancelled["kind"], "directional-move", "{cancelled}");
    assert_eq!(cancelled["base_revision"], base, "{cancelled}");
    assert!(cancelled.get("desired_geometry").is_none(), "{cancelled}");
    // The slot is released without a wedge: status cannot imply a commit, a
    // duplicate cancel finds no pending, and the canonical pair survived
    // (it re-stages a fresh R4 immediately under a new correlation).
    let unknown = parse(&planner.evaluate(&status_request(
        "dir-cancel-1",
        base,
        post_windows_from_geometry(&planned["desired_geometry"]),
    )));
    assert_eq!(unknown["kind"], "no-pending-unknown", "{unknown}");
    let duplicate = parse(&planner.evaluate(&cancel_request(
        "dir-cancel-1",
        "win-b",
        r4_pre_windows(),
        true,
    )));
    assert_eq!(duplicate["outcome"], "rejected", "{duplicate}");
    assert_eq!(duplicate["kind"], "no-pending", "{duplicate}");
    let second = plan_r4_occupied(&mut planner, "dir-cancel-2");
    assert_eq!(second["detail"]["rule"], "R4", "{second}");
}

#[test]
fn directional_cancel_refuses_acked_and_mismatch_without_mutation() {
    let mut planner = Planner::new();
    let planned = plan_r4_occupied(&mut planner, "dir-cancel-3");
    let base = planned["base_revision"].as_u64().expect("base");
    let post = post_windows_from_geometry(&planned["desired_geometry"]);
    let acked_reply =
        parse(&planner.evaluate(&ack_request("dir-cancel-3", base, post.clone(), "accepted")));
    assert_eq!(acked_reply["outcome"], "acknowledged", "{acked_reply}");
    // Acked plans refuse even with the exact pre-image.
    let refused = parse(&planner.evaluate(&cancel_request(
        "dir-cancel-3",
        "win-b",
        r4_pre_windows(),
        true,
    )));
    assert_eq!(refused["outcome"], "rejected", "{refused}");
    assert_eq!(refused["kind"], "cancel-refused", "{refused}");
    // Refusal mutated nothing: the ack stands and verify still commits.
    let status = parse(&planner.evaluate(&status_request("dir-cancel-3", base, post.clone())));
    assert_eq!(status["kind"], "post-acked", "{status}");
    let committed = parse(&planner.evaluate(&verify_request(
        "dir-cancel-3",
        base,
        post,
        planned["preconditions"].clone(),
        planned["operation"].clone(),
    )));
    assert_eq!(committed["outcome"], "committed", "{committed}");

    // A started write surfaces as pre-image mismatch on a live pending.
    let mut pending = Planner::new();
    let staged = plan_r4_occupied(&mut pending, "dir-cancel-4");
    let staged_base = staged["base_revision"].as_u64().expect("base");
    let staged_post = post_windows_from_geometry(&staged["desired_geometry"]);
    let mismatch = parse(&pending.evaluate(&cancel_request(
        "dir-cancel-4",
        "",
        staged_post.clone(),
        true,
    )));
    assert_eq!(mismatch["outcome"], "rejected", "{mismatch}");
    assert_eq!(mismatch["kind"], "cancel-mismatch", "{mismatch}");
    // Mismatch mutated nothing: exact ack plus verify still commit.
    let acked = parse(&pending.evaluate(&ack_request(
        "dir-cancel-4",
        staged_base,
        staged_post.clone(),
        "accepted",
    )));
    assert_eq!(acked["outcome"], "acknowledged", "{acked}");
    let committed = parse(&pending.evaluate(&verify_request(
        "dir-cancel-4",
        staged_base,
        staged_post,
        staged["preconditions"].clone(),
        staged["operation"].clone(),
    )));
    assert_eq!(committed["outcome"], "committed", "{committed}");
}

#[test]
fn directional_cancel_refuses_stale_diverged_absent_malformed() {
    let mut planner = Planner::new();
    let planned = plan_r4_occupied(&mut planner, "dir-cancel-5");
    let base = planned["base_revision"].as_u64().expect("base");
    // Wrong correlation and the staged base instead of the original request
    // revision each report stale without recording anything.
    let wrong_corr = parse(&planner.evaluate(&cancel_request(
        "dir-cancel-other",
        "win-b",
        r4_pre_windows(),
        true,
    )));
    assert_eq!(wrong_corr["outcome"], "rejected", "{wrong_corr}");
    assert_eq!(wrong_corr["kind"], "stale", "{wrong_corr}");
    let mut wrong_rev: serde_json::Value = serde_json::from_str(&cancel_request(
        "dir-cancel-5",
        "win-b",
        r4_pre_windows(),
        true,
    ))
    .expect("json");
    wrong_rev["revision"] = serde_json::json!(base);
    wrong_rev["correlation_id"] = serde_json::json!("dir-cancel-5");
    let stale_rev = parse(&planner.evaluate(&wrong_rev.to_string()));
    assert_eq!(stale_rev["outcome"], "rejected", "{stale_rev}");
    assert_eq!(stale_rev["kind"], "stale", "{stale_rev}");
    // A false attestation refuses outright.
    let attested = parse(&planner.evaluate(&cancel_request(
        "dir-cancel-5",
        "win-b",
        r4_pre_windows(),
        false,
    )));
    assert_eq!(attested["outcome"], "rejected", "{attested}");
    assert_eq!(attested["kind"], "cancel-refused", "{attested}");
    // Stale and refused probes recorded nothing: exact cancellation succeeds.
    let cancelled = parse(&planner.evaluate(&cancel_request(
        "dir-cancel-5",
        "win-b",
        r4_pre_windows(),
        true,
    )));
    assert_eq!(cancelled["outcome"], "cancelled", "{cancelled}");
    // A terminally diverged transaction reports divergence, never cancel.
    let diverged_plan = plan_r4_occupied(&mut planner, "dir-cancel-6");
    let div_base = diverged_plan["base_revision"].as_u64().expect("base");
    let div_post = post_windows_from_geometry(&diverged_plan["desired_geometry"]);
    let refused = parse(&planner.evaluate(&ack_request(
        "dir-cancel-6",
        div_base,
        div_post,
        "partial-application",
    )));
    assert_eq!(refused["outcome"], "diverged", "{refused}");
    let diverged = parse(&planner.evaluate(&cancel_request(
        "dir-cancel-6",
        "win-b",
        r4_pre_windows(),
        true,
    )));
    assert_eq!(diverged["outcome"], "diverged", "{diverged}");
    assert_eq!(diverged["kind"], "partial-application", "{diverged}");
    // Absent pending and malformed shapes fail closed with no mutation.
    let mut fresh = Planner::new();
    let absent = parse(&fresh.evaluate(&cancel_request(
        "dir-cancel-7",
        "win-b",
        r4_pre_windows(),
        true,
    )));
    assert_eq!(absent["outcome"], "rejected", "{absent}");
    assert_eq!(absent["kind"], "no-pending", "{absent}");
    let mut unknown: serde_json::Value = serde_json::from_str(&cancel_request(
        "dir-cancel-5",
        "win-b",
        r4_pre_windows(),
        true,
    ))
    .expect("json");
    unknown["command"] =
        serde_json::json!({"op": "directional-move-cancel", "zero_dispatch": true, "extra": 1});
    let unknown_reply = parse(&planner.evaluate(&unknown.to_string()));
    assert_eq!(unknown_reply["outcome"], "rejected", "{unknown_reply}");
    assert_eq!(unknown_reply["kind"], "unknown-field", "{unknown_reply}");
}

// R4 status helper: same post-observation envelope as ack (empty focus,
// rebased revision, rebound fingerprint) with the read-only status command.
// Never acknowledges, verifies, or mutates the retained pending.
fn status_request(
    correlation: &str,
    base_revision: u64,
    post_windows: Vec<serde_json::Value>,
) -> String {
    let mut value: serde_json::Value = serde_json::from_str(&request_with_domain(
        correlation,
        "",
        post_windows,
        serde_json::json!({"op": "directional-move-status"}),
        left_source_domain(),
        Some(left_domains_payload()),
    ))
    .expect("valid status");
    value["correlation_id"] = serde_json::json!(correlation);
    value["revision"] = serde_json::json!(base_revision);
    value["fingerprint"] = serde_json::json!(directional_fp(
        &value["domains"],
        "",
        &value["windows"].as_array().cloned().unwrap_or_default(),
    ));
    value.to_string()
}

#[test]
fn directional_status_reports_post_unacked_then_post_acked_without_blocking_commit() {
    let mut planner = Planner::new();
    let planned = plan_r4_occupied(&mut planner, "dir-status-1");
    let base = planned["base_revision"].as_u64().expect("base");
    let post = post_windows_from_geometry(&planned["desired_geometry"]);
    // Exact planned post before any ack: unacknowledged, never committed.
    let unacked = parse(&planner.evaluate(&status_request("dir-status-1", base, post.clone())));
    assert_eq!(unacked["outcome"], "status", "{unacked}");
    assert_eq!(unacked["kind"], "post-unacked", "{unacked}");
    assert_eq!(unacked["base_revision"], base, "{unacked}");
    assert!(unacked.get("desired_geometry").is_none(), "{unacked}");
    // Read-only: the normal ack still applies afterwards.
    let acked_reply =
        parse(&planner.evaluate(&ack_request("dir-status-1", base, post.clone(), "accepted")));
    assert_eq!(acked_reply["outcome"], "acknowledged", "{acked_reply}");
    // Exact planned post after the accepted ack: acknowledged.
    let acked = parse(&planner.evaluate(&status_request("dir-status-1", base, post.clone())));
    assert_eq!(acked["outcome"], "status", "{acked}");
    assert_eq!(acked["kind"], "post-acked", "{acked}");
    assert_eq!(acked["base_revision"], base, "{acked}");
    // Read-only again: the normal verify still commits afterwards.
    let committed = parse(&planner.evaluate(&verify_request(
        "dir-status-1",
        base,
        post,
        planned["preconditions"].clone(),
        planned["operation"].clone(),
    )));
    assert_eq!(committed["outcome"], "committed", "{committed}");
    assert_eq!(committed["base_revision"], base + 1, "{committed}");
}

#[test]
fn directional_status_reports_unresolved_without_consuming_pending() {
    let mut planner = Planner::new();
    let planned = plan_r4_occupied(&mut planner, "dir-status-2");
    let base = planned["base_revision"].as_u64().expect("base");
    let post = post_windows_from_geometry(&planned["desired_geometry"]);
    // One observed rectangle diverges from the retained desired geometry.
    let mut bad = post.clone();
    bad[0]["rect"]["w"] = serde_json::json!(7);
    // Rebind the fingerprint to the tampered post so the probe exercises the
    // planned-post match rather than fingerprint binding.
    let mut bad_request: serde_json::Value =
        serde_json::from_str(&status_request("dir-status-2", base, bad)).expect("json");
    bad_request["fingerprint"] = serde_json::json!(directional_fp(
        &bad_request["domains"],
        "",
        &bad_request["windows"]
            .as_array()
            .cloned()
            .unwrap_or_default(),
    ));
    let unresolved = parse(&planner.evaluate(&bad_request.to_string()));
    assert_eq!(unresolved["outcome"], "status", "{unresolved}");
    assert_eq!(unresolved["kind"], "unresolved", "{unresolved}");
    assert_eq!(unresolved["base_revision"], base, "{unresolved}");
    // The pending survives the probe: exact ack plus verify still commit.
    let acked =
        parse(&planner.evaluate(&ack_request("dir-status-2", base, post.clone(), "accepted")));
    assert_eq!(acked["outcome"], "acknowledged", "{acked}");
    let committed = parse(&planner.evaluate(&verify_request(
        "dir-status-2",
        base,
        post,
        planned["preconditions"].clone(),
        planned["operation"].clone(),
    )));
    assert_eq!(committed["outcome"], "committed", "{committed}");
}

#[test]
fn directional_status_reports_stale_without_recording_divergence() {
    let mut planner = Planner::new();
    let planned = plan_r4_occupied(&mut planner, "dir-status-3");
    let base = planned["base_revision"].as_u64().expect("base");
    let post = post_windows_from_geometry(&planned["desired_geometry"]);
    // Wrong correlation and wrong revision each report stale.
    let wrong_corr =
        parse(&planner.evaluate(&status_request("dir-status-other", base, post.clone())));
    assert_eq!(wrong_corr["outcome"], "status", "{wrong_corr}");
    assert_eq!(wrong_corr["kind"], "stale", "{wrong_corr}");
    assert_eq!(wrong_corr["base_revision"], base, "{wrong_corr}");
    let wrong_rev =
        parse(&planner.evaluate(&status_request("dir-status-3", base + 1, post.clone())));
    assert_eq!(wrong_rev["outcome"], "status", "{wrong_rev}");
    assert_eq!(wrong_rev["kind"], "stale", "{wrong_rev}");
    // Wrong owner reports stale through the same read-only path.
    let mut wrong_owner: serde_json::Value =
        serde_json::from_str(&status_request("dir-status-3", base, post.clone())).expect("json");
    wrong_owner["owner"] = serde_json::json!("owner-9");
    let stale_owner = parse(&planner.evaluate(&wrong_owner.to_string()));
    assert_eq!(stale_owner["outcome"], "status", "{stale_owner}");
    assert_eq!(stale_owner["kind"], "stale", "{stale_owner}");
    // Stale probes record nothing: the exact query still sees the live
    // unacknowledged post, and the lifecycle still commits.
    let live = parse(&planner.evaluate(&status_request("dir-status-3", base, post.clone())));
    assert_eq!(live["kind"], "post-unacked", "{live}");
    let acked =
        parse(&planner.evaluate(&ack_request("dir-status-3", base, post.clone(), "accepted")));
    assert_eq!(acked["outcome"], "acknowledged", "{acked}");
    let committed = parse(&planner.evaluate(&verify_request(
        "dir-status-3",
        base,
        post,
        planned["preconditions"].clone(),
        planned["operation"].clone(),
    )));
    assert_eq!(committed["outcome"], "committed", "{committed}");
}

#[test]
fn directional_status_reports_diverged_after_terminal_ack() {
    let mut planner = Planner::new();
    let planned = plan_r4_occupied(&mut planner, "dir-status-4");
    let base = planned["base_revision"].as_u64().expect("base");
    let post = post_windows_from_geometry(&planned["desired_geometry"]);
    let refused = parse(&planner.evaluate(&ack_request(
        "dir-status-4",
        base,
        post.clone(),
        "partial-application",
    )));
    assert_eq!(refused["outcome"], "diverged", "{refused}");
    let diverged = parse(&planner.evaluate(&status_request("dir-status-4", base, post)));
    assert_eq!(diverged["outcome"], "diverged", "{diverged}");
    assert_eq!(diverged["kind"], "partial-application", "{diverged}");
}

#[test]
fn directional_status_no_pending_unknown_carries_no_commit_implication() {
    let mut planner = Planner::new();
    // A valid two-domain scope with no retained transaction: unknown, with no
    // base revision and no geometry that could be mistaken for a commit.
    let post = post_windows_from_geometry(&serde_json::json!([
        {"window": "win-a", "leaf": "leaf-a", "output": "out-1", "workspace": "ws-a",
         "rect": {"x": 10, "y": 10, "w": 100, "h": 80}},
        {"window": "win-b", "leaf": "leaf-b", "output": "out-1", "workspace": "ws-a",
         "rect": {"x": 400, "y": 10, "w": 100, "h": 80}},
        {"window": "win-x", "leaf": "leaf-x", "output": "out-2", "workspace": "ws-b",
         "rect": {"x": 810, "y": 10, "w": 100, "h": 80}},
    ]));
    let reply = parse(&planner.evaluate(&status_request("dir-status-5", 0, post)));
    assert_eq!(reply["outcome"], "status", "{reply}");
    assert_eq!(reply["kind"], "no-pending-unknown", "{reply}");
    assert!(reply.get("base_revision").is_none(), "{reply}");
    assert!(reply.get("desired_geometry").is_none(), "{reply}");
}

#[test]
fn directional_status_rejects_malformed_and_scope_violations() {
    let mut planner = Planner::new();
    let planned = plan_r4_occupied(&mut planner, "dir-status-6");
    let base = planned["base_revision"].as_u64().expect("base");
    let post = post_windows_from_geometry(&planned["desired_geometry"]);
    // Unknown command fields fail closed like any other route.
    let mut unknown: serde_json::Value =
        serde_json::from_str(&status_request("dir-status-6", base, post.clone())).expect("json");
    unknown["command"] = serde_json::json!({"op": "directional-move-status", "extra": 1});
    let unknown_reply = parse(&planner.evaluate(&unknown.to_string()));
    assert_eq!(unknown_reply["outcome"], "rejected", "{unknown_reply}");
    assert_eq!(unknown_reply["kind"], "unknown-field", "{unknown_reply}");
    // A status query without the two-domain scope fails closed as
    // domain-invalid, consistent with directional scope validation. The
    // windows stay homed in the single carried domain so the failure proves
    // the status-level pair requirement rather than request containment.
    let mut single: serde_json::Value = serde_json::from_str(&request_with_domain(
        "dir-status-6",
        "",
        vec![
            win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
            win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
        ],
        serde_json::json!({"op": "directional-move-status"}),
        left_source_domain(),
        None,
    ))
    .expect("json");
    single["revision"] = serde_json::json!(base);
    let single_reply = parse(&planner.evaluate(&single.to_string()));
    assert_eq!(single_reply["outcome"], "rejected", "{single_reply}");
    assert_eq!(single_reply["kind"], "snapshot-invalid", "{single_reply}");
    assert_eq!(single_reply["detail"], "domain-invalid", "{single_reply}");
}

#[test]
fn r4_typed_codec_ack_verify_status_cancel_wire_golden() {
    // Wire golden for the tagged `SyncCommand` conversion of the directional
    // R4 phases: plan/ack/verify plus read-only status and cancel, byte-exact
    // through the in-place typed parse. The pre-binding dispatch boundary,
    // read-only status contract, and cancel withdraw effects are unchanged.
    // Literals recorded from the production `evaluate` path before the
    // switch (offline, no host mutation).
    let mut planner = Planner::new();
    let planned_str = planner.evaluate(&request_with_domain(
        "gold-r4-1",
        "win-b",
        vec![
            win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
            win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
            win("win-x", "out-2", "ws-b", 810, 10, 100, 80),
        ],
        move_cmd("win-b", "right"),
        left_source_domain(),
        Some(left_domains_payload()),
    ));
    assert_eq!(
        planned_str,
        "{\"v\":1,\"correlation_id\":\"gold-r4-1\",\"outcome\":\"planned\",\"base_revision\":1,\"detail\":{\"capability\":\"CrossOutputTransfer\",\"direction\":\"right\",\"kind\":\"move\",\"rule\":\"R4\"},\"desired_geometry\":[{\"window\":\"win-a\",\"leaf\":\"fit-l0\",\"output\":\"out-1\",\"workspace\":\"ws-a\",\"rect\":{\"x\":8,\"y\":8,\"w\":784,\"h\":584}},{\"window\":\"win-b\",\"leaf\":\"fit-l1\",\"output\":\"out-2\",\"workspace\":\"ws-b\",\"rect\":{\"x\":808,\"y\":8,\"w\":390,\"h\":584}},{\"window\":\"win-x\",\"leaf\":\"pair-target-0\",\"output\":\"out-2\",\"workspace\":\"ws-b\",\"rect\":{\"x\":1202,\"y\":8,\"w\":390,\"h\":584}}],\"desired_focus\":{\"domain_output\":\"out-2\",\"domain_workspace\":\"ws-b\",\"leaf\":\"fit-l1\"},\"preconditions\":[\"focused-leaf-occupied-by-focused-window\",\"source-root-membership-and-adjacent-same-workspace-output\",\"adapter-must-verify-postconditions\"],\"operation\":{\"capability\":\"CrossOutputTransfer\",\"direction\":\"right\",\"leaf\":\"fit-l1\",\"op\":\"move\",\"rule\":\"R4\",\"source_output\":\"out-1\",\"source_root_child_index\":1,\"source_workspace\":\"ws-a\",\"target\":\"occupied\",\"target_output\":\"out-2\",\"target_workspace\":\"ws-b\",\"window\":\"win-b\"}}",
    );
    let planned = parse(&planned_str);
    let base = planned["base_revision"].as_u64().expect("base");
    let post = post_windows_from_geometry(&planned["desired_geometry"]);
    assert_eq!(
        planner.evaluate(&status_request("gold-r4-1", base, post.clone())),
        "{\"v\":1,\"correlation_id\":\"gold-r4-1\",\"outcome\":\"status\",\"kind\":\"post-unacked\",\"base_revision\":1}",
    );
    assert_eq!(
        planner.evaluate(&ack_request("gold-r4-1", base, post.clone(), "accepted")),
        "{\"v\":1,\"correlation_id\":\"gold-r4-1\",\"outcome\":\"acknowledged\",\"kind\":\"directional-move\",\"base_revision\":1}",
    );
    assert_eq!(
        planner.evaluate(&status_request("gold-r4-1", base, post.clone())),
        "{\"v\":1,\"correlation_id\":\"gold-r4-1\",\"outcome\":\"status\",\"kind\":\"post-acked\",\"base_revision\":1}",
    );
    assert_eq!(
        planner.evaluate(&verify_request(
            "gold-r4-1",
            base,
            post,
            planned["preconditions"].clone(),
            planned["operation"].clone(),
        )),
        "{\"v\":1,\"correlation_id\":\"gold-r4-1\",\"outcome\":\"committed\",\"kind\":\"directional-move\",\"base_revision\":2}",
    );
    // Cancel withdraws a freshly staged pair pending on exact pre-image
    // proof, preserving the canonical sessions.
    let mut canceller = Planner::new();
    let staged = parse(&canceller.evaluate(&request_with_domain(
        "gold-r4-2",
        "win-b",
        vec![
            win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
            win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
            win("win-x", "out-2", "ws-b", 810, 10, 100, 80),
        ],
        move_cmd("win-b", "right"),
        left_source_domain(),
        Some(left_domains_payload()),
    )));
    assert_eq!(staged["outcome"], "planned", "{staged}");
    let mut cancel: serde_json::Value = serde_json::from_str(&request_with_domain(
        "gold-r4-2",
        "win-b",
        vec![
            win("win-a", "out-1", "ws-a", 10, 10, 100, 80),
            win("win-b", "out-1", "ws-a", 400, 10, 100, 80),
            win("win-x", "out-2", "ws-b", 810, 10, 100, 80),
        ],
        serde_json::json!({"op": "directional-move-cancel", "zero_dispatch": true}),
        left_source_domain(),
        Some(left_domains_payload()),
    ))
    .expect("cancel request");
    cancel["revision"] = serde_json::json!(0);
    assert_eq!(
        canceller.evaluate(&cancel.to_string()),
        "{\"v\":1,\"correlation_id\":\"gold-r4-2\",\"outcome\":\"cancelled\",\"kind\":\"directional-move\",\"base_revision\":1}",
    );
}

#[test]
fn r4_verify_echo_typed_boundary_wire_golden() {
    // Byte-level golden for the verify echo boundary (directional R4 route):
    // malformed nested preconditions/operation reject as `verify-invalid`
    // before any pending handling, `verified: false` diverges before echo
    // parsing, and the exact echo still commits. Literals recorded from the
    // production `evaluate` path (offline, no host mutation); the typed
    // `SyncCommand` conversion must reproduce them byte-exact.
    let mut planner = Planner::new();
    let planned = plan_r4_occupied(&mut planner, "gold-r4-verify-1");
    let base = planned["base_revision"].as_u64().expect("base");
    let post = post_windows_from_geometry(&planned["desired_geometry"]);
    let acked = parse(&planner.evaluate(&ack_request(
        "gold-r4-verify-1",
        base,
        post.clone(),
        "accepted",
    )));
    assert_eq!(acked["outcome"], "acknowledged", "{acked}");
    let good_pre = planned["preconditions"].clone();
    let good_op = planned["operation"].clone();
    // Malformed nested echoes reject as `verify-invalid` before any pending
    // handling, so the staged pending survives every probe below.
    let malformed: &[(&str, serde_json::Value, serde_json::Value, &str)] = &[
        (
            "gold-r4-verify-2",
            serde_json::json!("focused-leaf-occupied-by-focused-window"),
            good_op.clone(),
            "{\"v\":1,\"correlation_id\":\"gold-r4-verify-2\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"preconditions are invalid\"}",
        ),
        (
            "gold-r4-verify-3",
            serde_json::json!(["focused-leaf-occupied-by-focused-window", 7]),
            good_op.clone(),
            "{\"v\":1,\"correlation_id\":\"gold-r4-verify-3\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"preconditions are invalid\"}",
        ),
        (
            "gold-r4-verify-4",
            serde_json::json!(["bogus-token"]),
            good_op.clone(),
            "{\"v\":1,\"correlation_id\":\"gold-r4-verify-4\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"preconditions are invalid\"}",
        ),
        (
            "gold-r4-verify-5",
            good_pre.clone(),
            serde_json::json!({"op": "move", "rule": "R3", "capability": "CrossOutputTransfer", "direction": "right", "window": "win-b", "leaf": "fit-l1", "source_output": "out-1", "source_workspace": "ws-a", "target_output": "out-2", "target_workspace": "ws-b", "source_root_child_index": 1, "target": "occupied"}),
            "{\"v\":1,\"correlation_id\":\"gold-r4-verify-5\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"operation is invalid\"}",
        ),
        (
            "gold-r4-verify-6",
            good_pre.clone(),
            serde_json::json!({"op": "move", "rule": "R4", "capability": "CrossOutputTransfer", "direction": "right", "window": "win-b", "leaf": "fit-l1", "source_output": "out-1", "source_workspace": "ws-a", "target_output": "out-2", "target_workspace": "ws-b", "source_root_child_index": "1", "target": "occupied"}),
            "{\"v\":1,\"correlation_id\":\"gold-r4-verify-6\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"operation is invalid\"}",
        ),
        (
            "gold-r4-verify-7",
            good_pre.clone(),
            serde_json::json!({"op": "move", "rule": "R4", "capability": "CrossOutputTransfer", "direction": "right", "window": "win-b", "leaf": "fit-l1", "source_output": "out-1", "source_workspace": "ws-a", "target_output": "out-2", "target_workspace": "ws-b", "source_root_child_index": 1, "target": "midpoint"}),
            "{\"v\":1,\"correlation_id\":\"gold-r4-verify-7\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"operation is invalid\"}",
        ),
    ];
    for (cid, preconditions, operation, expected) in malformed {
        assert_eq!(
            planner.evaluate(&verify_request(
                cid,
                base,
                post.clone(),
                preconditions.clone(),
                operation.clone()
            )),
            *expected,
            "{cid}",
        );
    }
    // The `verified` flag gates before echo parsing: an unverified report
    // with garbage echoes diverges as postcondition-unverified, never
    // `verify-invalid`.
    let mut unverified: serde_json::Value = serde_json::from_str(&verify_request(
        "gold-r4-verify-8",
        base,
        post.clone(),
        serde_json::json!([7]),
        serde_json::json!([]),
    ))
    .expect("verify JSON");
    unverified["command"]["verified"] = serde_json::json!(false);
    assert_eq!(
        planner.evaluate(&unverified.to_string()),
        "{\"v\":1,\"correlation_id\":\"gold-r4-verify-8\",\"outcome\":\"diverged\",\"kind\":\"postcondition-unverified\",\"message\":\"adapter did not verify postconditions\"}",
    );
    // The exact echo still commits after every probe above: echo parsing
    // never consumed the pending.
    assert_eq!(
        planner.evaluate(&verify_request(
            "gold-r4-verify-1",
            base,
            post.clone(),
            good_pre.clone(),
            good_op.clone(),
        )),
        format!(
            "{{\"v\":1,\"correlation_id\":\"gold-r4-verify-1\",\"outcome\":\"committed\",\"kind\":\"directional-move\",\"base_revision\":{}}}",
            base + 1
        ),
    );
    // Echo parsing precedes pending checks: malformed echoes on a planner
    // with no pending report `verify-invalid`, never `no-pending`.
    let mut fresh = Planner::new();
    assert_eq!(
        fresh.evaluate(&verify_request(
            "gold-r4-verify-9",
            base,
            post.clone(),
            serde_json::json!([7]),
            good_op.clone(),
        )),
        "{\"v\":1,\"correlation_id\":\"gold-r4-verify-9\",\"outcome\":\"rejected\",\"kind\":\"verify-invalid\",\"message\":\"preconditions are invalid\"}",
    );
    // Extra fencing fields stay lenient: the exact echo plus one unknown
    // nested field still commits on a freshly staged pair.
    let mut lenient = Planner::new();
    let staged = plan_r4_occupied(&mut lenient, "gold-r4-verify-10");
    let staged_base = staged["base_revision"].as_u64().expect("base");
    let staged_post = post_windows_from_geometry(&staged["desired_geometry"]);
    let staged_ack = parse(&lenient.evaluate(&ack_request(
        "gold-r4-verify-10",
        staged_base,
        staged_post.clone(),
        "accepted",
    )));
    assert_eq!(staged_ack["outcome"], "acknowledged", "{staged_ack}");
    let mut extra_op = staged["operation"].clone();
    extra_op["bogus"] = serde_json::json!(1);
    assert_eq!(
        lenient.evaluate(&verify_request(
            "gold-r4-verify-10",
            staged_base,
            staged_post,
            staged["preconditions"].clone(),
            extra_op,
        )),
        format!(
            "{{\"v\":1,\"correlation_id\":\"gold-r4-verify-10\",\"outcome\":\"committed\",\"kind\":\"directional-move\",\"base_revision\":{}}}",
            staged_base + 1
        ),
    );
}
