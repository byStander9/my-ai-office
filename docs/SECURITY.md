# Security and Privacy

## Collected metadata

- Project display name and a hashed project key
- Timestamp and lifecycle event category
- Hashed session, turn, employee, and tool-use identifiers
- Agent role and tool name when supplied by Codex
- Derived state such as working, collaborating, waiting, idle, or stale

## Default collection boundary

- Prompt text
- Shell commands
- Tool input or output
- File contents
- Credentials, tokens, or environment values
- Full working-directory paths
- Raw session, turn, worker, or tool-use identifiers

## Local detailed activity opt-in

Detailed activity is disabled by default. When `captureDetails` is explicitly enabled in the local settings file, the sink may additionally persist:

- A redacted `UserPromptSubmit.prompt` as a user directive, capped at 4,000 characters
- A short, redacted `tool_input.message` from the allowlisted subagent collaboration tools only
- Redacted assignment role/name metadata from an allowlisted subagent spawn request
- A short, redacted Korean-safe summary derived from `SubagentStop.last_assistant_message` as the employee's final handoff

The sink still never stores shell or patch input, arbitrary tool input or output, `tool_response`, main-agent final messages, or transcript paths/content. It removes common token patterns, authorization values, email addresses, absolute paths, English command fragments, and opaque strings before persistence; the Node API repeats that filtering. Known work topics become deterministic Korean presentation summaries, while unknown English chunks use a neutral Korean label rather than a directive placeholder. Redaction is best effort and cannot prove that every sensitive value was removed.

The UI shows a local-detail badge while recent events confirm that capture is enabled. Discussion text is returned inside a project only while at least two subagents are actively collaborating. Anyone who can reach the local service, including an allowed Tailscale peer, can read displayed details.

The Windows installer exposes `-EnableDetailedActivity` and `-DisableDetailedActivity`; using neither preserves the prior setting. `AI_OFFICE_CAPTURE_DETAILS=1` is a process-level override. Disabling capture affects future events only: already persisted details remain until the 20 MiB event-file rotation or explicit removal with the uninstall data option.

The sink catches all internal errors and exits successfully so observability cannot block a Codex task. Local event files and settings rotate or remain outside the repository and are excluded from source control.

## Display metadata

Project folder names and Korean functional role names are intentionally displayed. Raw tool names and source identifiers are not returned as descriptions. Use non-sensitive project names if other people can view the dashboard. The local server does not implement application-level authentication.

## Network boundary

- The Node server and Vite development server bind to `127.0.0.1`.
- Do not change the host to `0.0.0.0` or expose port 4175 directly.
- Tailscale Serve is optional; keep Funnel disabled and apply least-privilege tailnet access controls.
- Never commit a generated tailnet URL, account name, device name, or access log.
- Tailscale HTTPS can place device and tailnet DNS names in public certificate-transparency records.

## Hook installation

The installer preserves unrelated hooks, removes older AI Office entries before adding the current definitions, and writes a timestamped backup of the existing `~/.codex/hooks.json`. Codex may require the user to review and trust the exact hook definition through `/hooks`.

## Reporting a vulnerability

Open a GitHub security advisory for the repository owner rather than posting credentials, event logs, or private paths in a public issue. Remove sensitive values from reproduction steps.
