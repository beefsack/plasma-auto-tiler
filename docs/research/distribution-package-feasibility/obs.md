# Open Build Service for distribution packages

Research date: 2026-09-27. Verdict: **partial fit**. OBS is a plausible
multi-distribution build and publication service, including automatic eventual
rebuilds after build dependencies change. It cannot synchronize publication
with independent upstream KWin repositories, does not cover NixOS, and does
not itself provide a working KDE neon or Kubuntu-backports build target.
Recommendation: prove a native-effect RPM on openSUSE Tumbleweed first; treat
OBS as a candidate build hub, not as the mechanism guaranteeing uninterrupted
tiling across KWin upgrades. Keep the effect optional and validate a real
effect-absent session before committing to an 80-90% coverage claim.

## What must be built

- `kwin/` is a TypeScript/JS KWin script; `scripts/build-kpackage.sh` builds a
  four-file `.kwinscript` using npm and validates it with `kpackagetool6`.
  `kwin/package.json` requires Node >=24 to build; KWin runs the generated JS,
  not Node. A distribution package can install the built script directly, but
  how to produce/verify that bundle in OBS without Node 24 is unresolved.
- `crates/plasma-auto-tiler` supplies the Rust Planner/tray binary, communicating
  over D-Bus. `kwin/native-effect/CMakeLists.txt` builds a C++ effect linked to
  `KWin::kwin` and a Rust static library from
  `crates/tiler-kwin-effect-ffi`. It also builds **two KCM plugins**: effect
  settings and script settings. Neither KCM explicitly links `KWin::kwin`,
  but their compatibility/discovery across host updates is unverified.
  `flake.nix` already separates script, Rust binary, and native-effect outputs;
  `scripts/nix-host-kwin-build.sh` resolves the actual host KWin derivation
  rather than building the native effect against an unrelated pinned KWin.
- The native CMake build requires ECM >=6.26.0
  (`kwin/native-effect/CMakeLists.txt:8`). KDE explicitly says binary effect
  APIs are not ABI-stable: compile against the same KWin/kwineffects version
  as the host ([KWin API](https://api.kde.org/kwin-effect.html#KWIN_EFFECT_FACTORY_SUPPORTED_ENABLED)).
  Repo code has not been compiled against each distribution's KWin here.

## Targets and present-day limits

OBS target existence and availability of a distribution KWin development
package are **not** evidence that this source builds on that target. Version
snapshots below are from public upstream indexes checked on the research date;
they can change. A target may also omit updates or disable publishing unless
the *project's own* repository paths/flags are configured appropriately.

| Users / OBS base | KWin development baseline and feasibility |
| --- | --- |
| openSUSE Tumbleweed, `openSUSE:Tumbleweed` | Native OBS candidate; [Factory `kwin6` packaging](https://build.opensuse.org/package/show/openSUSE:Factory/kwin6) provides a `kwin6-devel` route (exact current version **unverified**). Verify KWin, ECM and Rust versions in the chosen snapshot and that the own project resolves the same runtime package. Rolling updates mean separate rebuilds. [OBS repository configuration](https://openbuildservice.org/help/manuals/obs-user-guide/cha-obs-concepts). |
| openSUSE Leap 16, `openSUSE:Leap:16.0` | Plasma 6 line, but older than Tumbleweed; verify `kwin6-devel`, ECM >=6.26, Rust and source API before enabling. Exact current KWin version and Leap 15.x Plasma 6 development availability **unverified**; do not count 15.x. [OBS project](https://build.opensuse.org/project/show/openSUSE:Leap:16.0). |
| Fedora 43/44, [`Fedora:43`](https://build.opensuse.org/repositories/Fedora:43) / [`Fedora:44`](https://build.opensuse.org/repositories/Fedora:44) | OBS Fedora DoD targets exist; [Fedora `kwin-devel` releases](https://packages.fedoraproject.org/pkgs/kwin/kwin-devel/) show 6.7.5 in F43/F44 **updates**, while [F43 base](https://packages.fedoraproject.org/pkgs/kwin/kwin-devel/fedora-43.html) was 6.4.5, and provide `cmake(KWin)`. Enable updates, verify ECM >=6.26 and exact KWin at build time; base-only builds differ from updated users. Fedora versions/ECM vary by release. |
| Ubuntu/Kubuntu 24.04 LTS, [`Ubuntu:24.04`](https://build.opensuse.org/repositories/Ubuntu:24.04) | **Not a stock Plasma 6 native-effect target**: [`kwin-dev` 5.27.11](https://packages.ubuntu.com/noble/kwin-dev). OBS `backports` is *Ubuntu archive backports*, not Kubuntu's separate PPA. A Kubuntu PPA needs separately verified KWin/dev and OBS DoD access. |
| Ubuntu/Kubuntu 26.04 LTS, [`Ubuntu:26.04`](https://build.opensuse.org/repositories/Ubuntu:26.04) | [`kwin-dev` 6.6.4](https://packages.ubuntu.com/resolute/kwin-dev) exists, but [`extra-cmake-modules` 6.24](https://packages.ubuntu.com/resolute/extra-cmake-modules) is below this repo's **hard 6.26 CMake requirement**. [`nodejs` 22](https://packages.ubuntu.com/resolute/nodejs) is also below this repo's build-tool floor of 24; Rust toolchain package [`rustc`](https://packages.ubuntu.com/resolute/rustc) is >=1.85. Current native-effect recipe is blocked on stock dependencies; no compatibility adjustment is assumed. |
| KDE neon User | Neon tracks a different, rolling Plasma stack on an Ubuntu base ([neon FAQ](https://neon.kde.org/faq)); **do not use** `Ubuntu:24.04` KWin for its effect. A [request for neon DoD provisioning](https://github.com/openSUSE/open-build-service/issues/19317) documents lack of a preconfigured target and an admin-rights error adding external repos. Provisioning, package versions, and a working neon target remain unverified; ask OBS administrators before promising support. |
| Debian 13 stable, [`Debian:13`](https://build.opensuse.org/repositories/Debian:13) | OBS trixie DoD includes standard, updates, security, backports. [Debian tracker](https://tracker.debian.org/pkg/kwin): stable KWin 6.3.6 and `kwin-dev` from [stable source](https://packages.debian.org/source/stable/kwin). Verify ECM >=6.26 (likely blocker, **unverified**), Rust and KWin API before promising effect builds; stable and backports must not be conflated. |
| Debian testing, [`Debian:Testing`](https://build.opensuse.org/repositories/Debian:Testing) | Separate DoD target; [tracker](https://tracker.debian.org/pkg/kwin) lists testing KWin 6.7.4, not stable's 6.3.6. OBS base project has publishing **disabled** on its own repository page; whether a dependent user project can publish its builds must be checked in that project's flags. Verify dev/ECM/Rust and DoD freshness. |
| Arch family, [`Arch:Extra`](https://build.opensuse.org/repositories/Arch:Extra) | Arch DoD target exists for x86_64; [`kwin` 6.7.5](https://archlinux.org/packages/extra/x86_64/kwin/) ships headers/library together in [`kwin`](https://archlinux.org/packages/extra/x86_64/kwin/files/) (not a separate `-dev`); [ECM 6.30](https://archlinux.org/packages/extra/any/extra-cmake-modules/) meets the CMake floor. OBS accepts PKGBUILD and can publish pacman packages; users would add an OBS pacman repository and trust its key, or use an independent AUR PKGBUILD (AUR does not distribute OBS-built binaries). Arch rolling updates can outrun OBS; base `Arch:Extra` itself has publishing disabled, so configure the own project. [OBS Arch support](https://openbuildservice.org/2012/09/10/arch-linux-support/). |
| NixOS | Outside OBS. Use the existing `flake.nix` / nixpkgs route, passing the consumer's `pkgs` and `kwin` to `mkNativeEffect`; keep the host-matched builder for installed NixOS hosts. This does not imply coverage of arbitrary separately pinned nixpkgs configurations. |

OBS's [DoD documentation](https://openbuildservice.org/help/manuals/obs-user-guide/cha-obs-concepts)
describes using external repositories for dependency resolution. A neon or
Kubuntu-PPA deb URL has the *shape* of a DoD source, but configuring it on
build.opensuse.org requires appropriate rights and an actual successful
resolver/build test. A generic Ubuntu target does not inherit third-party
KWin packages. No percentage of KDE users covered is established by these
repository listings.

## Central question: rebuilding after KWin changes

- **Designed to rebuild:** OBS schedules builds when build-environment
  packages change; its default `rebuild="transitive"` clean-build policy and
  `block="all"` prevent using an intermediate *in-OBS* dependency build.
  Declare the distro KWin development package as a real BuildRequires /
  Build-Depends / `makedepends` and point the target to the distro's actual
  updates source ([OBS scheduling](https://openbuildservice.org/help/manuals/obs-user-guide/cha-obs-build-scheduling-and-dispatching),
  [recipe formats](https://openbuildservice.org/help/manuals/obs-user-guide/cha-obs-package-formats)).
  Merely listing a runtime dependency, or linking the wrong base repository,
  is not sufficient. `linkedbuild` controls linked *sources*, not DoD polling.
- **Not atomic with an external distro update:** DoD refresh, scheduling,
  queue, build, and publication happen after the upstream metadata is seen.
  The [OBS DoD implementation](https://github.com/openSUSE/open-build-service/blob/master/src/backend/bs_dodup)
  has configurable polling intervals (code defaults: 60 minutes on success,
  10 minutes after error); actual public-instance settings, mirror lag,
  build/queue time and publish latency have **no verified bound/SLA** here.
  OBS cannot ensure a replacement effect exists before an external distro
  releases its new KWin. Dependency-driven rebuild must be demonstrated by a
  POC and monitored for failures; a GitHub push webhook is not a substitute.
- **Package-manager pins address a different failure:** an exact runtime KWin
  dependency can stop a *new install* or hold back a host KWin upgrade while
  the old effect is installed, possibly blocking essential host updates. A
  loose dependency allows the KWin upgrade but may leave a stale plugin
  present; an ABI mismatch need not fail safely. Record matching build KWin
  package version/release, check installability and upgrade transactions per
  distro. Neither policy guarantees uninterrupted tiling by itself.

## Rust and build inputs

`Cargo.toml` has a workspace and no `rust-version`; no `rust-toolchain*` file
was found. Crate manifests use Rust edition 2024, requiring rustc >=1.85
([Rust edition guide](https://doc.rust-lang.org/edition-guide/rust-2024/index.html)).
`devenv.nix` enables Rust without a pinned per-distro compiler. Actual MSRV
including locked dependencies, per-target rustc, CMake/ECM, Qt/KF6 and Node
must be checked in OBS build info; neither the Nix development shell nor a
successful source checkout proves a distro build will work.

OBS builds must obtain crates before the isolated build: the maintained
[`obs-service-cargo` `cargo_vendor` service](https://github.com/openSUSE-Rust/obs-service-cargo)
can audit and vendor the workspace lockfile to `vendor.tar.zst` for offline
Cargo builds; `cargo_audit` service is deprecated in favor of integrated
auditing. Pin/verify `Cargo.lock`, avoid unintended dependency updates
(`respect-lockfile`/`update` behavior needs POC), and configure both Rust
binary and CMake-invoked staticlib Cargo with the same offline vendor source.
The JS bundle separately needs its own reproducible npm dependency inputs,
prebuilt verified artifact, or suitably recent build toolchain. These are
packaging work, not solved by Rust vendoring alone.

## Recipes, integration, and effort

| Deliverable | Minimum recipe shape | Estimated work (inference) |
| --- | --- | --- |
| openSUSE + Fedora RPM | `plasma-auto-tiler.spec`, `.changes`, source archive and vendor archive; optional `_service` for fetching/vendoring; subpackages for core/effect | First working RPM + offline Rust/JS/CMake and runtime smoke: several developer days; Fedora adds dependency/name/path conditionals and its own validation. |
| Debian + Ubuntu deb | `.dsc`, `debian.control`, `debian.rules`, `debian.changelog`, source/vendor inputs; per-target dependency versions | Additional days per distribution family/ABI target, subject to ECM and neon/PPA resolution. |
| Arch | `PKGBUILD` + offline inputs, repo config/signing; separate AUR PKGBUILD only if AUR consumption is chosen | Additional days and upgrade-window validation. |
| SCM CI | `.obs/workflows.yml` in a future packaging change and OBS `_service`/SCM source link, or an optional GitHub Actions workflow driving `osc` | Additional setup and credentials; native OBS workflow is simpler for build status. |

Estimates are **unverified planning ranges**, not measured builds. OBS
documents [spec -> RPM, dsc -> deb, PKGBUILD -> Arch](https://openbuildservice.org/help/manuals/obs-user-guide/cha-obs-package-formats);
one spec can serve openSUSE/Fedora with conditionals, but a spec does not
natively replace Debian/Arch recipes. `debbuild` is an alternative spec-to-deb
translation ([project](https://github.com/debbuild/debbuild)), not the standard
OBS `.dsc` path; its suitability for this CMake/Rust/JS package is unverified.

OBS [SCM/CI workflows](https://openbuildservice.org/help/manuals/obs-user-guide/cha-obs-scm-ci-workflow-integration)
support `pull_request`, `push`, `tag_push`, branch/filter/build/service steps,
and per-distro/architecture GitHub commit-status reporting for builds (the
docs say tag pushes do not report status; multibuild's initial pending status
is missing). Proposed sequence for a **later** implementation: (1) user
creates OBS account/project and writable package, (2) user creates GitHub
fine-grained PAT with Contents read and Commit statuses read/write and an OBS
workflow token associated with it, (3) user configures GitHub webhook with
OBS token ID as endpoint and OBS token secret as webhook secret, (4) add
`_service` + `.obs/workflows.yml` for PR branches and push/tag source updates,
then confirm SHA/status, package contents and repo publication. `link_package`
does not run source services; use `branch_package` for PR source builds. A
GitHub Actions job can instead call [`osc`](https://openbuildservice.org/help/manuals/obs-user-guide/cha-obs-osc)
with OBS credentials stored as GitHub secrets to upload/trigger sources, but
adds credential handling and still cannot drive upstream KWin-change timing.
No accounts, tokens, workflows or remote packages were created in this research.

## Alternative build/publish paths

| Route | Versus KWin-update requirement |
| --- | --- |
| [Launchpad PPA](https://documentation.ubuntu.com/launchpad/user/explanation/packaging/packaging/) | Familiar apt path for Ubuntu derivatives; separate neon/backports KWin source targeting and update-trigger automation required. No verified default rebuild on every external KWin update. |
| [Fedora COPR](https://docs.copr.fedorainfracloud.org/user_documentation.html) | Familiar Fedora repos, source-webhook builds; external KWin-triggered rebuild needs verification or added automation. |
| [AUR](https://wiki.archlinux.org/title/Arch_User_Repository) | Local builds see the user's own Arch KWin at build time; no centrally prebuilt auto-updated effect or OBS repo, and reinstall/rebuild timing is user-dependent. |
| Existing NixOS flake / nixpkgs | `mkNativeEffect` can derive against caller KWin (repo `flake.nix`); updated nixpkgs/flake inputs rebuild through Nix dependency identity, but consumers choose when to update. |
| openSUSE-only OBS | Smallest OBS maintenance scope and same default dependency-trigger mechanism; misses other distro families. [Scheduling docs](https://openbuildservice.org/help/manuals/obs-user-guide/cha-obs-build-scheduling-and-dispatching). |
| [GitHub Actions container matrix](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/run-jobs-in-a-container) + self-published repos | Full control, but distro image/dependency refresh, rebuild triggers, apt/rpm/pacman repository indexes and signing must be operated explicitly; no automatic KWin-update coordination by default. |

## Degrade without the native effect

Recommendation: install **core** (script + Planner/tray) independently; put
the ABI-bound effect in an optional, separately upgradable package. The effect
package initially owns its effect KCM. The script KCM is currently built with
the effect CMake project and installed by `flake.nix` with the native effect;
move its ownership to an independently buildable companion/core package in a
future packaging design **only after** proving it can build and load without
the effect. Core must not hard-depend on the effect or auto-disable the KWin
script when the effect is removed/absent. `flake.nix:190-193` already records
that a script-only install leaves the Configure page unresolved; that is a
known UX limitation, not evidence that tiling itself stops.
An optional one-install meta package may recommend the effect on supported
targets, but its dependency must not make core uninstallable when the effect
is unavailable (packaging design inference).

Choose per-distro effect version constraints with a tested package-manager
upgrade transaction and a loader check; avoid strict effect -> KWin pinning as
the *only* protection because it can prevent the host update. Prefer keeping
core available through an effect build failure or temporary effect removal;
expect visual borders/drag oracle features to degrade. Static source
separation does **not** prove a stale ABI-broken effect cannot crash KWin or
that script/Planner retain working tiling. This acceptance condition requires
isolated runtime tests after a KWin bump, including missing effect, failed
load, and effect removal; no live KWin test was run here.

## Smallest POC and decisions

1. **Tumbleweed x86_64, unpublished test repo first.** User creates an OBS
   account and project/package when authorized. Check KWin-devel, ECM >=6.26,
   rustc >=1.85 and Node/build-bundle strategy in that OBS target's build
   environment. Prepare source archive, RPM spec with core/effect split,
   `_service` vendoring Cargo, and locked JS bundle inputs; verify offline
   compilation and installed plugin/script/binary paths. Start with a native
   effect RPM if end-to-end integration is too large for the first attempt.
2. Add **Fedora current supported release** as second RPM target after
   resolving its update repository and toolchain versions. Verify both builds
   against their own KWin development packages and that runtime dependencies
   identify the matching KWin version. Test a controlled **OBS-local**
   dependency-version change or observe a real KWin update; measure metadata
   detection -> queued -> succeeded -> published timestamps and failure cases.
   Neither observation alone proves no external-upgrade gap.
3. In later changes, add native OBS GitHub webhook/source-service workflow,
   then `.dsc`/Debian packaging and PKGBUILD. Prioritize Ubuntu/neon only
   after the ECM/Node/build-input and external-repository rights are resolved.
   Verify optional effect absent/broken while script + Planner tile before
   publishing; check package-manager KWin upgrade ordering on each family.

User decisions needed before POC execution: authorize/create OBS project and
GitHub/OBS tokens/webhook when ready; select initial Fedora version and whether
to pursue neon/Kubuntu PPA provisioning; decide whether effect may be omitted
temporarily rather than delaying KWin security updates; decide whether Arch
users should add an OBS pacman repository or build from AUR. Unknowns to
verify: exact target KWin/ECM/Rust versions, whether older APIs compile,
neon/PPA DoD rights, and observed recovery from a failed native effect load.
