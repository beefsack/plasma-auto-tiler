{ config, lib, trayPackage, ... }:

let
  trayCfg = config.programs.omnitiler.tray;
  plannerCfg = config.programs.omnitiler.planner;
in
{
  options.programs.omnitiler.tray = {
    enable = lib.mkEnableOption "the OmniTiler tray session item";

    package = lib.mkOption {
      type = lib.types.package;
      default = trayPackage;
      description = "Immutable tray package whose binary is launched for the user session.";
    };
  };

  options.programs.omnitiler.planner = {
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
      systemd.user.services."omnitiler-tray" = {
        Unit = {
          Description = "OmniTiler Tray";
          PartOf = [ "graphical-session.target" ];
          After = [ "graphical-session.target" ];
        };
        Service = {
          ExecStart = "${trayCfg.package}/bin/omnitiler tray";
          Restart = "on-failure";
        };
        Install = {
          WantedBy = [ "graphical-session.target" ];
        };
      };
    })

    (lib.mkIf plannerCfg.enable {
      home.packages = [ plannerCfg.package ];

      systemd.user.services."omnitiler-planner" = {
        Unit.Description = "OmniTiler Planner (on-demand D-Bus service)";
        Service = {
          Type = "dbus";
          BusName = "com.omnitiler.Planner";
          ExecStart = "${plannerCfg.package}/bin/omnitiler planner-service";
          Restart = "no";
          # Explicitly retain stdout/stderr in the user journal. Same as the
          # systemd default; no behavior change, no new service, no activation.
          StandardOutput = "journal";
          StandardError = "journal";
        };
      };
    })
  ];
}
