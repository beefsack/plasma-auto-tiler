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
        ];
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
          '';
          doInstallCheck = true;
          installCheckPhase = ''
            runHook preInstallCheck
            test -s "$out/share/icons/hicolor/scalable/apps/plasma-auto-tiler.svg"
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
          };
          enabledHome = nixpkgs.lib.evalModules {
            modules = [
              homeModuleOptions
              self.homeManagerModules.default
              { programs.plasma-auto-tiler.tray.enable = true; }
            ];
          };
          disabledHome = nixpkgs.lib.evalModules {
            modules = [ homeModuleOptions self.homeManagerModules.default ];
          };
          activation = enabledNixos.config.environment.etc."xdg/kwinrc".text;
          autostart = enabledHome.config.home.file.".config/autostart/plasma-auto-tiler.desktop".text;
          desktopFile = ".config/autostart/plasma-auto-tiler.desktop";
        in
        assert activation == "[Plugins]\nplasma-auto-tiler-kwinEnabled=true\n";
        assert !(nixpkgs.lib.hasInfix "plasma-auto-tiler-active-borderEnabled" activation);
        assert builtins.elem kwinScript enabledNixos.config.environment.systemPackages;
        assert builtins.elem nativeEffect enabledNixos.config.environment.systemPackages;
        assert !(builtins.hasAttr "xdg/kwinrc" disabledNixos.config.environment.etc);
        assert nixpkgs.lib.hasInfix "Exec=/nix/store/" autostart;
        assert nixpkgs.lib.hasInfix "/bin/plasma-auto-tiler tray-managed\n" autostart;
        assert !(nixpkgs.lib.hasInfix (toString ./. ) autostart);
        assert builtins.hasAttr desktopFile enabledHome.config.home.file;
        assert !(builtins.hasAttr desktopFile disabledHome.config.home.file);
        assert !(builtins.hasAttr "activation" enabledHome.config.home);
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
