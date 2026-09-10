# Dev-Mode Override Live

Finding: a systemd runtime mask cannot prevent D-Bus activation due to the
descriptor `Exec=` fallback.

The real invariant is ownership of the well-known name
`org.plasmaautotiler.Planner` by observation.
