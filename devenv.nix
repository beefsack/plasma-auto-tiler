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
    zip
    kdePackages.extra-cmake-modules
    kdePackages.kwin
    kdePackages.kwin.dev
    kdePackages.kpackage
    weston
  ];

  enterShell = ''
    export PATH=${pkgs.clang-tools}/bin:$PATH
  '';
}
