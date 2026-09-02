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
    in
    {
      lib.mkNativeEffect = mkNativeEffect;

      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          kwinScript = pkgs.buildNpmPackage {
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
          tray = pkgs.rustPlatform.buildRustPackage {
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
          };
        in
        {
          default = tray;
          kwin-script = kwinScript;
          tray = tray;
        });
    };
}
