# CI First-Run Fixes

Goal: Resolve CI failures in the KWin and shell jobs from the first push of `912e31a` without weakening the tests. No native/live KWin activity or toolchain changes.

KWin: `npm test` runs two real Planner fixture suites that spawn `cargo run --offline ... planner_eval`. A fresh KWin job has neither downloaded crates nor a built example, while the earlier local validation inherited Cargo caches. Prebuild the exact Rust example in that job, retaining the offline test contract.

Shell: The Custom Tile hermetic test keeps fixtures under the checkout, but its own preflight rejects a world-writable path ancestor (`/tmp` in a clean clone). Move the fixture into a secure home directory, independent of checkout location. Its simulated user and bus paths must follow the actual runner UID rather than assuming a fixed UID.

Acceptance and evidence (2026-09-28): Two fresh clones of `912e31a` in temporary directories initially had no checkout build artifacts. With an empty Cargo home, the exact KWin `npm test --prefix kwin` failed 20 real-Planner fixture tests (`planner_eval exited with code 101`), while prebuilding the locked example downloaded the crates and restored 788/788 passing KWin tests using the same isolated Cargo home/target. In the other clone, exact shell-job steps reproduced 17 Custom Tile fixture failures (`path component is group- or world-writable: /tmp`); moving the fixture under `$HOME` restored 131/131 Custom Tile assertions and all nine shell suites passed. The fixture now derives its simulated UID and bus address from the runner instead of hardcoding 1000. The tray private-bus suite also passes with `XDG_RUNTIME_DIR`, session-bus address, Wayland, and DISPLAY unset (29 fixture checks, 16 self-tests). YAML parses; `git diff --check` passes. Shell job now annotates the suite name if a distinct remote-only failure recurs. No live KWin/Plasma, commit, or push.

Risk: GitHub logs were unavailable, so the reproduced failures are strong local matches rather than a confirmed attribution of each remote failure. The next pushed run must confirm them.
