{ config, lib, trayPackage, ... }:

let
  cfg = config.programs.plasma-auto-tiler.tray;
in
{
  options.programs.plasma-auto-tiler.tray = {
    enable = lib.mkEnableOption "the Plasma Auto Tiler tray session item";

    package = lib.mkOption {
      type = lib.types.package;
      default = trayPackage;
      description = "Immutable tray package whose binary is launched for the user session.";
    };
  };

  config = lib.mkIf cfg.enable {
    home.file.".config/autostart/plasma-auto-tiler.desktop".text = ''
      [Desktop Entry]
      Type=Application
      Name=Plasma Auto Tiler Tray
      Comment=Shows Plasma Auto Tiler status in the system tray
      Exec=${cfg.package}/bin/plasma-auto-tiler tray-managed
      TryExec=${cfg.package}/bin/plasma-auto-tiler
      X-KDE-autostart-phase=1
      X-GNOME-Autostart-enabled=true
    '';
  };
}
