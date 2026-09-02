{ config, lib, kwinScript, nativeEffect, ... }:

let
  cfg = config.programs.plasma-auto-tiler;
in
{
  options.programs.plasma-auto-tiler = {
    enable = lib.mkEnableOption "the Plasma Auto Tiler KWin script";

    package = lib.mkOption {
      type = lib.types.package;
      default = kwinScript;
      description = "KWin Script KPackage to install for Plasma Auto Tiler.";
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package nativeEffect ];

    # Keep KWin's global profile immutable and limit it to this script's
    # namespaced enablement key. User kwinrc remains independently owned.
    environment.etc."xdg/kwinrc".text = ''
      [Plugins]
      plasma-auto-tiler-kwinEnabled=true
    '';

    environment.pathsToLink = lib.mkAfter [
      "/share"
      "/lib/qt-6/plugins/kwin/effects"
    ];
  };
}
