# Vision

This is goal input for the project. It is not a governance document: active
decisions live in `docs/decisions.md`, process principles in
`docs/principles.md`.

## Purpose

Provide a faithful, jank-free auto-tiling experience for users of COSMIC,
Hyprland, bspwm, PaperWM, and similar tiling window managers when they need to
use a different OS/DE/WM, such as KDE Plasma, GNOME, Windows, or macOS.

## First-Class Requirements

Auto tiling, window and group highlights, keybinds, panels, and workspace
support are all first-class requirements. None is an optional extra.

## Configurability

Fully configurable. Users of tiling window managers generally run custom
configurations and expect to keep them.

## Faithfulness Versus Jank

Sometimes being faithful introduces jank. That trade-off is a subjective
decision owned by the project owner. Where it is inexpensive to do so, expose
the choice to the end user so they can configure towards faithfulness or
towards minimising jank.

## Reliability

Reliability is non-negotiable. The project must avoid crashing or silently
stopping working, including across:

- sleep and wake
- plugging and unplugging outputs
- resolution and scaling changes
- full-screen applications
- changes to underlying configuration that affect this project

## Gaming And Full-Screen Applications

Gaming and full-screen applications must not be impacted at all, especially by
auto tiling and border highlights. They must work unimpeded, with absolutely no
performance impact.

## Rust First

The project is Rust first, with minimal shims only where a platform makes them
unavoidable. Share and reuse code as much as possible across both the target
tiling window managers being emulated and the underlying host OS/DE/WM.
