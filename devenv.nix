{ pkgs, lib, config, inputs, ... }:

{
  languages.rust.enable = true;
  languages.javascript.enable = true;
  languages.javascript.package = pkgs.nodejs_24;

  packages = with pkgs; [
    clang-tools
    jq
    just
    python3
    zip
    kdePackages.kpackage
    weston
  ];

  enterShell = ''
    export PATH=${pkgs.clang-tools}/bin:$PATH
  '';
}
