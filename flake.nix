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
          ./src
          ./tests
          ./test-fixtures
          ./assets/icons/plasma-auto-tiler.svg
          ./home-manager-module.nix
          ./scripts/route-diag-follow.sh
        ];
      };

      plannerDbusServiceSource = pkgs: pkgs.lib.fileset.toSource {
        root = ./.;
        fileset = ./nix/org.plasmaautotiler.Planner.service;
      };

      nativeEffectSource = pkgs: pkgs.lib.fileset.toSource {
        root = ./.;
        fileset = pkgs.lib.fileset.unions [
          ./kwin/native-effect/CMakeLists.txt
          ./kwin/native-effect/validate-metadata.cmake
          ./kwin/native-effect/metadata.json
          ./kwin/native-effect/activewindowborder.h
          ./kwin/native-effect/activewindowborder.cpp
          ./kwin/native-effect/activeborderlogic.h
          ./kwin/native-effect/activeborderconfig_module.json
          ./kwin/native-effect/activeborderconfig_module.h
          ./kwin/native-effect/activeborderconfig_module.cpp
          ./kwin/native-effect/activeborderconfig.ui
          ./kwin/native-effect/activeborderconfig.kcfg
          ./kwin/native-effect/activeborderconfig.kcfgc
          ./kwin/native-effect/shortcutreconciler.h
          ./kwin/native-effect/shortcutreconciler.cpp
        ];
      };

      mkNativeEffect =
        { pkgs
        , kwin ? pkgs.kdePackages.kwin
        }:
        let
          kde = pkgs.kdePackages;
          kwinDev = kwin.dev;
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
            kde.extra-cmake-modules
          ];
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
            "-DBUILD_TESTING=OFF"
            "-DKDE_INSTALL_PLUGINDIR=lib/qt-6/plugins"
            "-DKWin_DIR=${kwinDev}/lib/cmake/KWin"
          ];

          doInstallCheck = true;
          installCheckPhase = ''
            runHook preInstallCheck
            test -f "$out/lib/qt-6/plugins/kwin/effects/plugins/plasma-auto-tiler-active-border.so"
            test -f "$out/lib/qt-6/plugins/kwin/effects/configs/plasma-auto-tiler-active-border_config.so"
            runHook postInstallCheck
          '';
        };

      mkKwinScript =
        { pkgs }:
        pkgs.buildNpmPackage {
          pname = "plasma-auto-tiler-kwin";
          version = "0.1.0";
          src = kwinScriptSource pkgs;
          sourceRoot = "source/kwin";
          npmDepsHash = "sha256-IWhNnM3IfAVLFQBOC+l9XssLOcIUcGCEa4RHv6BZ3cM=";
          npmBuildScript = "build";

          installPhase = ''
            runHook preInstall
            installRoot="$out/share/kwin/scripts/plasma-auto-tiler-kwin"
            mkdir -p "$installRoot"
            cp -a metadata.json contents "$installRoot/"
            runHook postInstall
          '';
        };

      mkTray =
        { pkgs }:
        pkgs.rustPlatform.buildRustPackage {
          pname = "plasma-auto-tiler";
          version = "0.1.0";
          src = traySource pkgs;
          cargoLock.lockFile = ./Cargo.lock;
          buildInputs = [ pkgs.kdePackages.kcmutils ];
          dontWrapQtApps = true;
          env.PLASMA_AUTO_TILER_KCMSHELL6 =
            "${pkgs.kdePackages.kcmutils}/bin/kcmshell6";
          preCheck = ''
            export HOME="$NIX_BUILD_TOP"
          '';
          postInstall = ''
            mkdir -p "$out/share/icons/hicolor/scalable/apps"
            cp ${./assets/icons/plasma-auto-tiler.svg} "$out/share/icons/hicolor/scalable/apps/plasma-auto-tiler.svg"
            mkdir -p "$out/share/dbus-1/services"
            substitute "${plannerDbusServiceSource pkgs}/nix/org.plasmaautotiler.Planner.service" "$out/share/dbus-1/services/org.plasmaautotiler.Planner.service" --replace-fail "@out@" "$out"
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
          kwinScript = self.lib.mkKwinScript { inherit pkgs; };
          nativeEffect = self.lib.mkNativeEffect { inherit pkgs; };
        };

      homeManagerModules.default = { config, lib, pkgs, ... }:
        import ./home-manager-module.nix {
          inherit config lib pkgs;
          trayPackage = self.lib.mkTray { inherit pkgs; };
        };

      checks = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          kwinScript = self.lib.mkKwinScript { inherit pkgs; };
          nativeEffect = self.lib.mkNativeEffect { inherit pkgs; };
          tray = self.lib.mkTray { inherit pkgs; };
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
          autostart = enabledHome.config.home.file.".config/autostart/plasma-auto-tiler.desktop".text;
          desktopFile = ".config/autostart/plasma-auto-tiler.desktop";
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
        assert nixpkgs.lib.hasInfix "Exec=/nix/store/" autostart;
        assert nixpkgs.lib.hasInfix "/bin/plasma-auto-tiler tray-managed\n" autostart;
        assert !(nixpkgs.lib.hasInfix (toString ./. ) autostart);
        assert !(nixpkgs.lib.hasInfix "Planner" autostart);
        assert !(nixpkgs.lib.hasInfix "planner-service" autostart);
        assert builtins.hasAttr desktopFile enabledHome.config.home.file;
        assert !(builtins.hasAttr desktopFile disabledHome.config.home.file);
        assert !(builtins.hasAttr "activation" enabledHome.config.home);
        assert !(builtins.hasAttr ".config/autostart/plasma-auto-tiler-planner.desktop" enabledHome.config.home.file);
        assert !(builtins.hasAttr ".config/autostart/plasma-auto-tiler-planner.desktop" disabledHome.config.home.file);
        assert autostart == ''
          [Desktop Entry]
          Type=Application
          Name=Plasma Auto Tiler Tray
          Comment=Shows Plasma Auto Tiler status in the system tray
          Exec=${tray}/bin/plasma-auto-tiler tray-managed
          TryExec=${tray}/bin/plasma-auto-tiler
          Icon=${tray}/share/icons/hicolor/scalable/apps/plasma-auto-tiler.svg
          X-KDE-autostart-phase=1
          X-GNOME-Autostart-enabled=true
        '';
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
        assert builtins.attrNames plannerUnit.Service == [ "BusName" "ExecStart" "Restart" "Type" ];
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
        });

      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          kwinScript = mkKwinScript { inherit pkgs; };
          tray = mkTray { inherit pkgs; };
        in
        {
          default = tray;
          kwin-script = kwinScript;
          native-effect = mkNativeEffect { inherit pkgs; };
          tray = tray;
        });
    };
}
