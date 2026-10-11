{ pkgs, lib, config, inputs, ... }:

{
  languages.rust.enable = true;
  languages.javascript.enable = true;
  languages.javascript.package = pkgs.nodejs_24;

  packages = with pkgs; [
    cargo-about
    cargo-deny
    clang-tools
    dbus
    gh
    jq
    just
    license_finder
    python3
    systemd
    unzip
    zip
    kdePackages.kpackage
    weston
  ];

  enterShell = ''
    export PATH=${pkgs.clang-tools}/bin:$PATH
  '';
}
