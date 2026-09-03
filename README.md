# My AI Office

[한국어 README](README.ko.md) · [Development story](docs/DEVELOPMENT.md) · [Architecture](docs/ARCHITECTURE.md) · [Security](docs/SECURITY.md)

My AI Office is a privacy-conscious local dashboard that turns Codex lifecycle events into a simple, top-down office. Projects become rooms, AI workers become employees, and concurrent work becomes a meeting at a shared table.

![My AI Office running with public demo data](docs/screenshots/dashboard-demo.png)

Sanitized live mode, captured from the real local API with synthetic public events:

![My AI Office live mode with synthetic public events](docs/screenshots/dashboard-live-sanitized.png)

## What you can see

- All active Codex projects in one office map
- Lifecycle-only chat sessions stay hidden; a project appears only after tool, subagent, or approval work begins
- Projects leave the office after 24 hours without activity and return automatically on later work
- Main agents and functional subagents grouped by project
- Working, collaborating, waiting-for-approval, idle, and stale states
- A long-term work-summary timeline refreshed every 1.5 seconds
- An independent project selector for the activity panel
- Automatic meeting-table grouping when two or more employees work on one project
- Functional employee names derived from safe role/tool metadata instead of framework labels such as `default`
- Completed employees leave project rooms after a 15-second handoff period while their completion remains in recent activity
- Employees with no activity for 30 minutes leave the room as orphan cleanup and return automatically on their next event
- Repeated tool start/finish events become one functional activity card per employee and category over a 10-minute work stream
- Stable project-room positions during ordinary activity; rooms move only for project lifecycle changes
- A clear demo state when no local event file exists
- Optional local-only directive and collaboration details, redacted before storage and shown at the meeting table only when two or more subagents collaborate

## Quick start on Windows

Prerequisites:

- Windows 10 or 11
- Node.js 20 or newer
- Python 3 available through the `py` launcher
- A Codex build that supports user hooks

```powershell
git clone https://github.com/byStander9/my-ai-office.git
cd my-ai-office
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
```

The installer performs a clean dependency install, runs all tests, builds the app, installs the privacy-minimized event sink, merges the AI Office hooks into the existing Codex user hook file, and adds a current-user Windows Startup shortcut. Existing hook configuration is backed up before modification.

Detailed directive and collaboration text is off by default. To enable the local opt-in while installing, add `-EnableDetailedActivity`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -EnableDetailedActivity
```

Disable future detailed capture with `-DisableDetailedActivity`. Reinstalling without either switch preserves the existing choice. Previously stored details remain in the rotating local event file until rotation or explicit data removal. For temporary runs, `AI_OFFICE_CAPTURE_DETAILS=1` also enables capture for that hook process.

Then open Codex, run `/hooks`, review the user hooks, and trust them. Hook changes may require another review. The dashboard is available at [http://127.0.0.1:4175/](http://127.0.0.1:4175/); it starts without a terminal window on future sign-ins.

## Run without installing hooks

Use the built-in demo data for UI evaluation:

```powershell
npm ci
npm run office
```

To run an already-built dashboard in the foreground:

```powershell
npm run start:office
```

## Remove the installation

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\uninstall-windows.ps1
```

Event data is preserved by default. Add `-RemoveData` only when you also want to delete the local AI Office event directory.

## Optional private remote access

The server deliberately binds to `127.0.0.1`. For your own devices, Tailscale Serve can publish that loopback service inside your tailnet without opening it to the public internet:

```powershell
tailscale serve --bg http://127.0.0.1:4175
tailscale serve status --json
tailscale funnel status --json
```

Keep Funnel disabled. Do not commit the generated `https://<device>.<tailnet>.ts.net/` URL. Tailscale HTTPS certificates can make the machine and tailnet DNS names visible in public certificate-transparency records, so choose a non-sensitive device name first.

Disable Serve with:

```powershell
tailscale serve --https=443 off
```

Static hosting can display only the demo UI; it cannot read the private event file on your PC. Live status requires the local Node server, and remote status additionally requires your PC and private network path to stay online.

## Privacy model

The event sink uses a strict allowlist. By default it does not persist prompts, commands, tool input/output, file contents, credentials, full working-directory paths, or raw session/turn/worker/tool-use identifiers. When local detailed activity is explicitly enabled, it additionally stores only short, redacted user directives and the `message` field of allowlisted subagent collaboration tools. It never stores shell or patch inputs, arbitrary tool responses, transcripts, or subagent final messages. The browser API applies a second allowlist and redaction pass.

Redaction is best effort, not a guarantee. Keep the service on localhost, and remember that any permitted Tailscale viewer can read enabled details. The capture fields are based on the [official OpenAI Codex Hooks documentation](https://learn.chatgpt.com/docs/hooks).

Project folder names and agent role names are intentionally visible in the dashboard. Treat them as user-controlled display metadata. See [Security and privacy](docs/SECURITY.md) for the full boundary.

## Development and verification

```powershell
npm test
npm run build
```

The current suite contains 38 tests covering event-sink privacy and opt-in redaction, chat/project filtering, inactive project cleanup, repeatable hook merging, event sanitization, opaque identifiers, long-term activity summaries, employee retirement, orphan cleanup and functional naming, stable project ordering, project completion and resumption, stale-state boundaries, collaboration discussions, localhost-only serving, rotated event files, and static hosting output. The complete staged build record and results are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Repository map

```text
codex/                    privacy-minimized Codex event sink
docs/                     architecture, security, build story, screenshots
scripts/                  build, hook setup, Windows install/uninstall
server/                   JSONL reducer and localhost HTTP server
src/                      React dashboard
tests/                    Node test suite
worker/                   demo-only static hosting worker
```

## License

[MIT](LICENSE)
