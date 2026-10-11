{ config, lib, kwinScript, nativeEffect, nativeSettings, ... }:

let
  cfg = config.programs.omnitiler;
in
{
  options.programs.omnitiler = {
    enable = lib.mkEnableOption "the OmniTiler KWin script";

    package = lib.mkOption {
      type = lib.types.package;
      default = kwinScript;
      description = "KWin Script KPackage to install for OmniTiler.";
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package nativeEffect nativeSettings ];

    # Keep KWin's global profile immutable and limit it to this script's
    # namespaced enablement key. User kwinrc remains independently owned.
    environment.etc."xdg/kwinrc".text = ''
      [Plugins]
      omnitiler-kwinEnabled=true
    '';

    environment.pathsToLink = lib.mkAfter [
      "/share"
      "/lib/qt-6/plugins/kwin/effects"
      "/lib/qt-6/plugins/kwin/scripts"
    ];
  };
}
