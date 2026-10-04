{
  description = "Plasma Auto Tiler packages";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/54ba4bcec4043e72a4006d825e0d7aff5562008f";

  outputs = { self, nixpkgs }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;

      kwinScriptSource = pkgs: pkgs.lib.fileset.toSource {
        root = ./.;
        fileset = pkgs.lib.fileset.unions [
          ./kwin/metadata.json
          ./kwin/package.json
          ./kwin/package-lock.json
          ./kwin/src
          ./kwin/contents/config/main.xml
          ./kwin/contents/ui/config.ui
        ];
      };

      traySource = pkgs: pkgs.lib.fileset.toSource {
        root = ./.;
        fileset = pkgs.lib.fileset.unions [
          ./Cargo.toml
          ./Cargo.lock
          ./crates
          ./test-fixtures
          ./assets/icons/plasma-auto-tiler.svg
          ./home-manager-module.nix
        ];
      };

      plannerDbusServiceSource = pkgs: pkgs.lib.fileset.toSource {
        root = ./.;
        fileset = ./nix/org.plasmaautotiler.Planner.service;
      };

      nativeEffectSource = pkgs: pkgs.lib.fileset.toSource {
        root = ./.;
        fileset = pkgs.lib.fileset.unions [
          # Complete native-effect subtree for BUILD_TESTING (effect, KCM,
          # all test sources, validators, headers) plus the script metadata
          # referenced by discovery validation. Individual file lists drift;
          # the subtree keeps the fileset exact.
          ./kwin/native-effect
          ./kwin/metadata.json
          # All workspace manifests/targets: Cargo requires every member
          # manifest+targets to resolve the workspace even when building
          # only -p tiler-kwin-effect-ffi. Unrelated trees (kwin script
          # sources, tray assets, test-fixtures) stay excluded.
          ./Cargo.toml
          ./Cargo.lock
          ./crates/tiler-kwin-effect-ffi
          ./crates/tiler-core
          ./crates/tiler-protocol
          ./crates/plasma-auto-tiler
          ./crates/tiler-windows
        ];
      };

      mkNativeEffect =
        { pkgs
        , kwin ? pkgs.kdePackages.kwin
        , withTests ? false
        }:
        let
          kde = pkgs.kdePackages;
          kwinDev = kwin.dev;
          # Offline Cargo vendor from the workspace lockfile (caller pkgs,
          # not a pinned dev toolchain). CMake invokes cargo with
          # CARGO_NET_OFFLINE=true (see below); this vendor dir backs the
          # crates-io replacement so no network is needed at build time.
          cargoVendor = pkgs.rustPlatform.importCargoLock {
            lockFile = ./Cargo.lock;
          };
        in
        pkgs.stdenv.mkDerivation {
          pname = "plasma-auto-tiler-native-effect";
          version = "0.1.0";
          src = nativeEffectSource pkgs;
          sourceRoot = "source/kwin/native-effect";

          nativeBuildInputs = [
            pkgs.cmake
            pkgs.ninja
            pkgs.pkg-config
            pkgs.cargo
            pkgs.rustc
            kde.extra-cmake-modules
          ];
          # Cargo offline via caller pkgs vendor (no network at build time).
          # CARGO_HOME carries the vendored-sources replacement; CMake adds
          # --offline when CARGO_NET_OFFLINE=true so the lockfile/vendor
          # contract fails closed instead of hitting the network.
          env.CARGO_NET_OFFLINE = "true";
          preConfigure = ''
            export CARGO_HOME="$NIX_BUILD_TOP/cargo-home"
            mkdir -p "$CARGO_HOME"
            cat > "$CARGO_HOME/config.toml" <<EOF
            [source.crates-io]
            replace-with = "vendored-sources"
            [source.vendored-sources]
            directory = "${cargoVendor}"
            EOF
          '';
          buildInputs = [
            kwin
            kwinDev
            pkgs.qt6Packages.qtbase
            kde.kcolorscheme
            kde.kconfig
            kde.kcoreaddons
            kde.kcmutils
            kde.ki18n
            kde.kwidgetsaddons
          ];
          dontWrapQtApps = true;

          cmakeFlags = [
            "-DBUILD_TESTING=${if withTests then "ON" else "OFF"}"
            "-DKDE_INSTALL_PLUGINDIR=lib/qt-6/plugins"
            "-DKWin_DIR=${kwinDev}/lib/cmake/KWin"
          ];

          doInstallCheck = true;
          installCheckPhase = ''
            runHook preInstallCheck
            test -f "$out/lib/qt-6/plugins/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
            test -f "$out/lib/qt-6/plugins/kwin/effects/configs/plasma-auto-tiler-active-border_config.so"
            test -f "$out/lib/qt-6/plugins/kwin/scripts/configs/plasma-auto-tiler-kwin_config.so"
            test ! -e "$out/lib/qt-6/plugins/kwin/effects/plugins/plasma-auto-tiler-drag-oracle.so"
            test ! -e "$out/lib/qt-6/plugins/kwin/scripts/configs/plasma-auto-tiler-drag-oracle_config.so"
            ${if withTests then ''
              # Hermetic native gates: offscreen platform, isolated config
              # home; the test binaries isolate the session bus themselves.
              # installCheck runs with the build directory as cwd, so invoke
              # ctest directly.
              export QT_QPA_PLATFORM=offscreen
              export XDG_CONFIG_HOME="$NIX_BUILD_TOP/check-home"
              mkdir -p "$XDG_CONFIG_HOME"
              ctest --output-on-failure
            '' else ""}
            runHook postInstallCheck
          '';
        };

      mkKwinScript =
        { pkgs
        , sourceRev ? "local-dev"
        }:
        pkgs.buildNpmPackage {
          pname = "plasma-auto-tiler-kwin";
          version = "0.1.0";
          src = kwinScriptSource pkgs;
          sourceRoot = "source/kwin";
          npmDepsHash = "sha256-IWhNnM3IfAVLFQBOC+l9XssLOcIUcGCEa4RHv6BZ3cM=";
          # Installed build only; ordinary npm build stays define-free.
          npmBuildScript = "build:installed";
          # Shared compile-time identity: self.rev or local-dev.
          env.PLASMA_AUTO_TILER_SOURCE_REV = sourceRev;

          installPhase = ''
            runHook preInstall
            installRoot="$out/share/kwin/scripts/plasma-auto-tiler-kwin"
            mkdir -p "$installRoot"
            cp -a metadata.json contents "$installRoot/"
            # Static build-id marker, no paths.
            printf '%s\n' "package=plasma-auto-tiler-kwin" "version=0.1.0" "source=${sourceRev}" > "$installRoot/build-id"
            runHook postInstall
          '';

          doInstallCheck = true;
          installCheckPhase = ''
            runHook preInstallCheck
            installRoot="$out/share/kwin/scripts/plasma-auto-tiler-kwin"
            grep -Fx "package=plasma-auto-tiler-kwin" "$installRoot/build-id"
            grep -Fx "version=0.1.0" "$installRoot/build-id"
            grep -Fx "source=${sourceRev}" "$installRoot/build-id"
            # Script-only package keeps the qualified native script KCM
            # reference; the Configure page resolves only alongside the
            # companion ABI-matched native-effect delivery.
            grep -F "kwin/scripts/configs/plasma-auto-tiler-kwin_config" "$installRoot/metadata.json"
            runHook postInstallCheck
          '';
        };

      mkTray =
        { pkgs
        , sourceRev ? "local-dev"
        }:
        pkgs.rustPlatform.buildRustPackage {
          pname = "plasma-auto-tiler";
          version = "0.1.0";
          src = traySource pkgs;
          cargoLock.lockFile = ./Cargo.lock;
          cargoBuildFlags = [ "-p" "plasma-auto-tiler" ];
          buildInputs = [ pkgs.kdePackages.kcmutils ];
          dontWrapQtApps = true;
          env.PLASMA_AUTO_TILER_KCMSHELL6 =
            "${pkgs.kdePackages.kcmutils}/bin/kcmshell6";
          env.PLASMA_AUTO_TILER_KWRITECONFIG6 =
            "${pkgs.kdePackages.kconfig}/bin/kwriteconfig6";
          env.PLASMA_AUTO_TILER_KREADCONFIG6 =
            "${pkgs.kdePackages.kconfig}/bin/kreadconfig6";
          # Shared compile-time identity: self.rev or local-dev.
          env.PLASMA_AUTO_TILER_SOURCE_REV = sourceRev;
          preCheck = ''
            export HOME="$NIX_BUILD_TOP"
          '';
          postInstall = ''
            mkdir -p "$out/share/icons/hicolor/scalable/apps"
            cp ${./assets/icons/plasma-auto-tiler.svg} "$out/share/icons/hicolor/scalable/apps/plasma-auto-tiler.svg"
            mkdir -p "$out/share/dbus-1/services"
            substitute "${plannerDbusServiceSource pkgs}/nix/org.plasmaautotiler.Planner.service" "$out/share/dbus-1/services/org.plasmaautotiler.Planner.service" --replace-fail "@out@" "$out"
            # Static build-id marker, no paths.
            mkdir -p "$out/share/plasma-auto-tiler"
            printf '%s\n' "package=plasma-auto-tiler" "version=0.1.0" "source=${sourceRev}" > "$out/share/plasma-auto-tiler/build-id"
          '';
          doInstallCheck = true;
          installCheckPhase = ''
            runHook preInstallCheck
            test -s "$out/share/icons/hicolor/scalable/apps/plasma-auto-tiler.svg"
            test -s "$out/share/dbus-1/services/org.plasmaautotiler.Planner.service"
            grep -Fx "[D-BUS Service]" "$out/share/dbus-1/services/org.plasmaautotiler.Planner.service"
            grep -Fx "Name=org.plasmaautotiler.Planner" "$out/share/dbus-1/services/org.plasmaautotiler.Planner.service"
            grep -Fx "Exec=$out/bin/plasma-auto-tiler planner-service" "$out/share/dbus-1/services/org.plasmaautotiler.Planner.service"
            grep -Fx "SystemdService=plasma-auto-tiler-planner.service" "$out/share/dbus-1/services/org.plasmaautotiler.Planner.service"
            grep -Fx "package=plasma-auto-tiler" "$out/share/plasma-auto-tiler/build-id"
            grep -Fx "version=0.1.0" "$out/share/plasma-auto-tiler/build-id"
            grep -Fx "source=${sourceRev}" "$out/share/plasma-auto-tiler/build-id"
            runHook postInstallCheck
          '';
        };
    in
    {
      lib = {
        inherit mkKwinScript mkNativeEffect mkTray;
      };

      nixosModules.default = { config, lib, pkgs, ... }:
        import ./nixos-module.nix {
          inherit config lib pkgs;
          kwinScript = self.lib.mkKwinScript {
            inherit pkgs;
            sourceRev = self.rev or "local-dev";
          };
          nativeEffect = self.lib.mkNativeEffect { inherit pkgs; };
        };

      homeManagerModules.default = { config, lib, pkgs, ... }:
        import ./home-manager-module.nix {
          inherit config lib pkgs;
          trayPackage = self.lib.mkTray {
            inherit pkgs;
            sourceRev = self.rev or "local-dev";
          };
        };

      checks = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          kwinScript = self.lib.mkKwinScript {
            inherit pkgs;
            sourceRev = self.rev or "local-dev";
          };
          nativeEffect = self.lib.mkNativeEffect { inherit pkgs; };
          tray = self.lib.mkTray {
            inherit pkgs;
            sourceRev = self.rev or "local-dev";
          };
          enabledNixos = nixpkgs.lib.nixosSystem {
            inherit system;
            modules = [
              self.nixosModules.default
              { programs.plasma-auto-tiler.enable = true; }
            ];
          };
          disabledNixos = nixpkgs.lib.nixosSystem {
            inherit system;
            modules = [ self.nixosModules.default ];
          };
          homeModuleOptions = { lib, ... }: {
            config._module.args.pkgs = pkgs;
            options.home.file = lib.mkOption {
              type = lib.types.attrsOf (lib.types.submodule ({ ... }: {
                options.text = lib.mkOption {
                  type = lib.types.lines;
                  default = "";
                };
              }));
              default = { };
            };
            options.home.packages = lib.mkOption {
              type = lib.types.listOf lib.types.package;
              default = [ ];
            };
            options.systemd.user.services = lib.mkOption {
              type = lib.types.attrsOf (lib.types.submodule {
                options = {
                  Unit = lib.mkOption {
                    type = lib.types.attrs;
                    default = { };
                  };
                  Service = lib.mkOption {
                    type = lib.types.attrs;
                    default = { };
                  };
                  Install = lib.mkOption {
                    type = lib.types.attrs;
                    default = { };
                  };
                };
              });
              default = { };
            };
          };
          enabledHome = nixpkgs.lib.evalModules {
            modules = [
              homeModuleOptions
              self.homeManagerModules.default
              {
                programs.plasma-auto-tiler.tray.enable = true;
                programs.plasma-auto-tiler.planner.enable = true;
              }
            ];
          };
          disabledHome = nixpkgs.lib.evalModules {
            modules = [ homeModuleOptions self.homeManagerModules.default ];
          };
          plannerDisabledHome = nixpkgs.lib.evalModules {
            modules = [
              homeModuleOptions
              self.homeManagerModules.default
              { programs.plasma-auto-tiler.planner.enable = false; }
            ];
          };
          customPlanner = pkgs.runCommand "custom-planner-test" { } ''
            mkdir -p "$out/bin"
            touch "$out/bin/plasma-auto-tiler"
            chmod +x "$out/bin/plasma-auto-tiler"
          '';
          customPlannerHome = nixpkgs.lib.evalModules {
            modules = [
              homeModuleOptions
              self.homeManagerModules.default
              {
                programs.plasma-auto-tiler.planner.enable = true;
                programs.plasma-auto-tiler.planner.package = customPlanner;
              }
            ];
          };
          activation = enabledNixos.config.environment.etc."xdg/kwinrc".text;
          desktopFile = ".config/autostart/plasma-auto-tiler.desktop";
          trayUnit = enabledHome.config.systemd.user.services."plasma-auto-tiler-tray";
          descriptorTemplate = builtins.readFile ./nix/org.plasmaautotiler.Planner.service;
          expectedTemplate = "[D-BUS Service]\nName=org.plasmaautotiler.Planner\nExec=@out@/bin/plasma-auto-tiler planner-service\nSystemdService=plasma-auto-tiler-planner.service\n";
          expectedDescriptor = "[D-BUS Service]\nName=org.plasmaautotiler.Planner\nExec=${tray}/bin/plasma-auto-tiler planner-service\nSystemdService=plasma-auto-tiler-planner.service\n";
          plannerUnit = enabledHome.config.systemd.user.services."plasma-auto-tiler-planner";
          defaultPlannerUnit = disabledHome.config.systemd.user.services."plasma-auto-tiler-planner";
          customPlannerUnit = customPlannerHome.config.systemd.user.services."plasma-auto-tiler-planner";
        in
        assert activation == "[Plugins]\nplasma-auto-tiler-kwinEnabled=true\n";
        assert !(nixpkgs.lib.hasInfix "plasma-auto-tiler-active-borderEnabled" activation);
        assert !(nixpkgs.lib.hasInfix "Planner" activation);
        assert !(nixpkgs.lib.hasInfix "planner" activation);
        assert builtins.elem kwinScript enabledNixos.config.environment.systemPackages;
        assert builtins.elem nativeEffect enabledNixos.config.environment.systemPackages;
        assert !(builtins.elem tray enabledNixos.config.environment.systemPackages);
        assert !(builtins.hasAttr "xdg/kwinrc" disabledNixos.config.environment.etc);
        assert !(builtins.hasAttr desktopFile enabledHome.config.home.file);
        assert !(builtins.hasAttr desktopFile disabledHome.config.home.file);
        assert !(builtins.hasAttr "activation" enabledHome.config.home);
        assert !(builtins.hasAttr ".config/autostart/plasma-auto-tiler-planner.desktop" enabledHome.config.home.file);
        assert !(builtins.hasAttr ".config/autostart/plasma-auto-tiler-planner.desktop" disabledHome.config.home.file);
        assert builtins.hasAttr "plasma-auto-tiler-tray" enabledHome.config.systemd.user.services;
        assert !(builtins.hasAttr "plasma-auto-tiler-tray" disabledHome.config.systemd.user.services);
        assert trayUnit.Unit.PartOf == [ "graphical-session.target" ];
        assert trayUnit.Service.ExecStart == "${tray}/bin/plasma-auto-tiler tray";
        assert trayUnit.Service.Restart == "on-failure";
        assert trayUnit.Install.WantedBy == [ "graphical-session.target" ];
        assert descriptorTemplate == expectedTemplate;
        assert !(nixpkgs.lib.hasInfix "/nix/store" descriptorTemplate);
        assert builtins.replaceStrings [ "@out@" ] [ "${tray}" ] descriptorTemplate == expectedDescriptor;
        assert !(nixpkgs.lib.hasInfix (toString ./.) expectedDescriptor);
        assert disabledHome.config.programs.plasma-auto-tiler.planner.enable == true;
        assert enabledHome.config.programs.plasma-auto-tiler.planner.enable == true;
        assert plannerDisabledHome.config.programs.plasma-auto-tiler.planner.enable == false;
        assert builtins.hasAttr "plasma-auto-tiler-planner" enabledHome.config.systemd.user.services;
        assert builtins.hasAttr "plasma-auto-tiler-planner" disabledHome.config.systemd.user.services;
        assert !(builtins.hasAttr "plasma-auto-tiler-planner" plannerDisabledHome.config.systemd.user.services);
        assert plannerUnit.Service.Type == "dbus";
        assert plannerUnit.Service.BusName == "org.plasmaautotiler.Planner";
        assert plannerUnit.Service.ExecStart == "${tray}/bin/plasma-auto-tiler planner-service";
        assert plannerUnit.Service.Restart == "no";
        assert builtins.attrNames plannerUnit.Service == [ "BusName" "ExecStart" "Restart" "StandardError" "StandardOutput" "Type" ];
        assert !(builtins.hasAttr "ProtectSystem" plannerUnit.Service);
        assert !(builtins.hasAttr "ProtectHome" plannerUnit.Service);
        assert !(builtins.hasAttr "PrivateDevices" plannerUnit.Service);
        assert !(builtins.hasAttr "PrivateNetwork" plannerUnit.Service);
        assert !(builtins.hasAttr "ProtectKernelTunables" plannerUnit.Service);
        assert !(nixpkgs.lib.hasInfix "/bin/sh" plannerUnit.Service.ExecStart);
        assert !(nixpkgs.lib.hasInfix "sh -c" plannerUnit.Service.ExecStart);
        assert !(nixpkgs.lib.hasInfix (toString ./.) plannerUnit.Service.ExecStart);
        assert nixpkgs.lib.hasInfix "/bin/plasma-auto-tiler planner-service" plannerUnit.Service.ExecStart;
        assert plannerUnit.Unit.Description == "Plasma Auto Tiler Planner (on-demand D-Bus service)";
        assert plannerUnit.Install == { };
        assert defaultPlannerUnit.Service.ExecStart == "${tray}/bin/plasma-auto-tiler planner-service";
        assert builtins.elem tray enabledHome.config.home.packages;
        assert builtins.elem tray disabledHome.config.home.packages;
        assert plannerDisabledHome.config.home.packages == [ ];
        assert customPlannerUnit.Service.ExecStart == "${customPlanner}/bin/plasma-auto-tiler planner-service";
        assert builtins.elem customPlanner customPlannerHome.config.home.packages;
        assert !(builtins.elem tray customPlannerHome.config.home.packages);
        assert customPlannerUnit.Service.Type == "dbus";
        assert customPlannerUnit.Service.BusName == "org.plasmaautotiler.Planner";
        assert customPlannerUnit.Service.Restart == "no";
        {
          module-boundary = pkgs.runCommand "plasma-auto-tiler-module-boundary" { } ''
            touch "$out"
          '';
          native-effect = nativeEffect;
          # Test-enabled native build: compiles the KCM/effect sources
          # with BUILD_TESTING=ON and runs the full hermetic CTest suite
          # (reconciler, KCM shortcut/config, metadata validation, Rust
          # FFI) offscreen. Same inputs as the delivery derivation.
          native-effect-tests = self.lib.mkNativeEffect { inherit pkgs; withTests = true; };
        });

      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          kwinScript = mkKwinScript {
            inherit pkgs;
            sourceRev = self.rev or "local-dev";
          };
          tray = mkTray {
            inherit pkgs;
            sourceRev = self.rev or "local-dev";
          };
        in
        {
          default = tray;
          kwin-script = kwinScript;
          native-effect = mkNativeEffect { inherit pkgs; };
          tray = tray;
        });
    };
}
