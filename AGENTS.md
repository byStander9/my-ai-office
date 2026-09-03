# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

## Durable visual direction

- Keep the office view simple and top-down, following the user's block-floor-plan reference.
- Represent each project as a rectangular room on a dark office floor with a visible door.
- Use small icon-library employee markers; when two or more employees actively collaborate, group them at one clearly labeled meeting table.
- Avoid decorative 3D/game-like scenery that competes with project status readability.
- Keep project-room positions stable during ordinary activity updates. Only project additions, removals, completion, or resumption may change room order.
- Keep completed employees in recent activity, but remove them from project rooms after a short handoff grace period. Hide employees with no activity for 30 minutes as orphan cleanup and show them again on their next event. Name employees by their functional role; avoid raw framework labels such as `default` and generic labels such as "main employee."
- Present the right-side activity feed as long-term work summaries. Group repeated tool start/finish events by employee and safe work category over a 10-minute activity gap; keep directives, assignments, handoffs, approvals, compaction, and session lifecycle events distinct.
- Show only projects that have a Codex work signal such as tool, subagent, or approval activity. Hide a project after 24 hours without work and restore it when new work arrives.
- Keep the office-map project filter separate from the right-side activity project filter. Detailed directives and collaboration messages are local opt-in data: public/default capture stays off, redaction happens before persistence and again at the API boundary, and discussion text appears only when at least two subagents collaborate.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.
