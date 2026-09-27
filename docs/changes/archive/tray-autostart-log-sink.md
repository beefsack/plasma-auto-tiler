# Tray Autostart Log Sink

## Goal

- Deliver bounded Rust tray endpoint diagnostics from repository-owned autostart
  paths to a source-defined, user-queryable logging sink.

## Scope

- Trace managed, legacy, CLI, and development launch paths; select the smallest
  existing host-native sink wiring; document its exact selector and limits.
- Preserve existing stderr diagnostics and all tray publication behavior.

## Non-Goals

- No tray lifecycle redesign, service replacement, restart behavior, persistent
  log files, daemon, dependency, or live session work.
- No changes to tray IPC, authorization, state, timers, retries, signals, or
  identity/privacy semantics.

## Acceptance

- Both repository-owned autostart paths have a fixed, queryable sink contract.
- Sink failure cannot affect tray operation, and records remain bounded/redacted.
- Offline tests prove launch/delivery wiring, exact filters, and package inputs.

## Feasibility

- The documented Linux journald native protocol accepts one `AF_UNIX` datagram
  per entry at `/run/systemd/journal/socket`. Rust `UnixDatagram` can submit a
  fixed identifier, priority, and an existing bounded diagnostic line without
  a crate, system dependency, subprocess, service, file, or retained socket.
- A nonblocking best-effort send can ignore every setup/send error and retain
  stderr fallback. Submission is not journal acknowledgement or durable
  retention.

## Pending Choice

- When stderr is already journal-connected, native submission plus stderr can
  create twin records. Either retain stderr universally and document possible
  unfiltered twins, or use the documented `$JOURNAL_STREAM` device/inode check
  to suppress stderr only after confirmed journal connection. Manual terminal
  stderr remains unchanged in either case.
