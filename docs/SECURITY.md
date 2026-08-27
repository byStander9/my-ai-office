# Security and Privacy

## Collected metadata

- Project display name and a hashed project key
- Timestamp and lifecycle event category
- Hashed session, turn, employee, and tool-use identifiers
- Agent role and tool name when supplied by Codex
- Derived state such as working, collaborating, waiting, idle, or stale

## Never collected by the packaged sink

- Prompt text
- Shell commands
- Tool input or output
- File contents
- Credentials, tokens, or environment values
- Full working-directory paths
- Raw session, turn, worker, or tool-use identifiers

The sink catches all internal errors and exits successfully so observability cannot block a Codex task. Local event files rotate at 20 MiB and are excluded from source control.

## Display metadata

Project folder names, role names, and tool names are intentionally displayed. Use non-sensitive project and role names if other people can view the dashboard. The local server does not implement application-level authentication.

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
