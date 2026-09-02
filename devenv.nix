{ pkgs, lib, config, inputs, ... }:

{
  languages.rust.enable = true;
  languages.javascript.enable = true;
  languages.javascript.package = pkgs.nodejs_24;

  packages = with pkgs; [
    cmake
    clang-tools
    ninja
    pkg-config
    python3
    zip
    kdePackages.extra-cmake-modules
    kdePackages.kcolorscheme
    kdePackages.kconfig
    kdePackages.kcmutils
    kdePackages.kwidgetsaddons
    pkgs.kdePackages.kwin
    pkgs.kdePackages.kwin.dev
    kdePackages.kpackage
    weston
  ];

  enterShell = ''
    export PATH=${pkgs.clang-tools}/bin:$PATH
    export PLASMA_AUTO_TILER_KWIN_DEV_CMAKE_DIR="${pkgs.kdePackages.kwin.dev}/lib/cmake/KWin"
  '';
}
