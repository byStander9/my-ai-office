# Development Story

This document records how the prototype moved from a visual idea to a reusable local product. The reference supplied during design was used only as inspiration and is not redistributed in this repository.

## Stage 1 — Define the office metaphor

**Goal:** make multi-agent work understandable at a glance.

The initial concept was reduced to four visual rules: a dark office floor, one rectangular room per project, small employee markers, and a shared table for active collaboration. Decorative game scenery was deliberately excluded so status stayed readable.

**Result:** a responsive React layout with project filters, project rooms, employee states, a meeting table, and a recent-activity panel.

## Stage 2 — Build a deterministic demo

**Goal:** make the interface reviewable before any system-level integration.

The UI received explicit demo projects and events. Demo mode is clearly labelled and is used only when the live endpoint returns no valid events. This kept visual QA independent from Codex installation state.

**Result:** the public runtime capture below was produced by the real application with non-sensitive demo data.

![Demo-mode dashboard](screenshots/dashboard-demo.png)

## Stage 3 — Add the event pipeline

**Goal:** translate Codex lifecycle hooks into stable display state.

A Python hook sink accepts one JSON event on standard input and appends an allowlisted event to `~/.codex/ai-office/events.jsonl`. A Node reducer reads the current and one rotated JSONL file, validates each record, and derives projects, employees, activity messages, and status.

**Result:** main agents and functional subagents appear in the same project room while retaining distinct identities. A 20 MiB rotation limit prevents unbounded event-file growth.

## Stage 4 — Protect the local boundary

**Goal:** make the dashboard useful without turning prompts or tool activity into a surveillance log.

The event sink omits prompts, commands, tool input/output, file contents, credentials, full paths, and raw source identifiers. The reducer applies a second allowlist and creates opaque browser-facing IDs. The HTTP server binds only to `127.0.0.1`.

**Result:** tests confirm that private paths, raw worker/session IDs, prompts, and tool payloads do not reach `/api/events`.

## Stage 5 — Model collaboration and freshness

**Goal:** show teamwork and avoid presenting old data as current.

When at least two employees in a project are actively working, compacting, or stopping, the reducer marks those employees as collaborating and the UI places them at the meeting table. A snapshot remains fresh through exactly five minutes after the last event and becomes stale after that boundary.

Project rooms retain their previous positions while activity data changes. A newly observed project is appended without moving existing rooms, and a project moves behind active rooms only when all of its main sessions are offline. This prevents the 1.5-second polling cycle from turning activity updates into distracting layout changes.

**Result:** the office shows active collaboration, approval waits, quiet transitions, disconnected state, and stale state separately.

![Sanitized live-mode dashboard](screenshots/dashboard-live-sanitized.png)

## Stage 6 — Run silently at sign-in

**Goal:** keep the dashboard available without a visible terminal.

The Windows installer builds and validates the app, installs the event sink, merges hook definitions with a backup, and creates a current-user Startup shortcut. The VBScript launcher resolves the repository location dynamically, avoids starting a second matching Node server, hides the window, and restarts the server after an unexpected exit.

**Result:** the local dashboard starts after Windows sign-in and remains recoverable with the foreground `npm run start:office` command.

## Stage 7 — Add private remote viewing

**Goal:** check the office from another personal device without exposing it publicly.

Tailscale Serve can proxy the loopback server inside a tailnet. Funnel is intentionally excluded. Static hosting remains demo-only because a hosted page cannot read the event file on a user's PC.

**Result:** local live operation and optional private remote operation have a clear security boundary. No personal tailnet address is stored in this repository.

## Stage 8 — Package for reuse

**Goal:** let another user clone, understand, install, validate, and remove the project.

The project now includes English and Korean entry documents, an MIT license, a repository map, privacy documentation, architecture notes, Windows install/uninstall scripts, staged development records, screenshots, and source-control exclusions for local data.

## Verification record

The release gate is:

```powershell
npm test
npm run build
```

Expected results:

- 24/24 Node tests pass.
- Vite production build succeeds.
- `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json` are generated.
- The local server listens only on `127.0.0.1`.
- `GET /api/events` returns HTTP 200 in live or explicit demo mode.
- A repository-wide secret/path scan finds no personal machine path, email address, tailnet hostname, event log, or raw source identifier.

## Known limitations

- The UI is Korean-first; repository documentation is bilingual.
- Project folder names and agent role names are visible display metadata.
- Hook trust must be reviewed in Codex by the user.
- The packaged automatic installer targets Windows. Foreground Node operation is portable, but background startup scripts are not yet provided for macOS or Linux.
- Static hosting is a showcase, not a live remote dashboard.
