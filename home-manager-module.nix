{ config, lib, trayPackage, ... }:

let
  trayCfg = config.programs.plasma-auto-tiler.tray;
  plannerCfg = config.programs.plasma-auto-tiler.planner;
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

  options.programs.plasma-auto-tiler.planner = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Enable on-demand Planner D-Bus activation. Does not switch engine authority.";
    };

    package = lib.mkOption {
      type = lib.types.package;
      default = trayPackage;
      description = "Immutable Planner package providing the planner-service binary and D-Bus descriptor.";
    };
  };

  config = lib.mkMerge [
    (lib.mkIf trayCfg.enable {
      home.file.".config/autostart/plasma-auto-tiler.desktop".text = ''
        [Desktop Entry]
        Type=Application
        Name=Plasma Auto Tiler Tray
        Comment=Shows Plasma Auto Tiler status in the system tray
        Exec=${trayCfg.package}/bin/plasma-auto-tiler tray-managed
        TryExec=${trayCfg.package}/bin/plasma-auto-tiler
        Icon=${trayCfg.package}/share/icons/hicolor/scalable/apps/plasma-auto-tiler.svg
        X-KDE-autostart-phase=1
        X-GNOME-Autostart-enabled=true
      '';
    })

    (lib.mkIf plannerCfg.enable {
      home.packages = [ plannerCfg.package ];

      systemd.user.services."plasma-auto-tiler-planner" = {
        Unit.Description = "Plasma Auto Tiler Planner (on-demand D-Bus service)";
        Service = {
          Type = "dbus";
          BusName = "org.plasmaautotiler.Planner";
          ExecStart = "${plannerCfg.package}/bin/plasma-auto-tiler planner-service";
          Restart = "no";
        };
      };
    })
  ];
}
