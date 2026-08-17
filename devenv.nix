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
    (builtins.storePath /nix/store/kfacyll1bnh89q9aqbs54qjgda2c4hkm-kwin-6.7.3)
    (builtins.storePath /nix/store/483vmk08g6bjaa3bvf3abn10cwpw6ap9-kwin-6.7.3-dev)
    kdePackages.kpackage
    weston
  ];

  enterShell = ''
    export PATH=${pkgs.clang-tools}/bin:$PATH
  '';
}
