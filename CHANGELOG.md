# Changelog

All notable changes to this project are documented here.

## 0.1.8 — 2026-09-03

- Improved Korean assignment sentence grammar.
- Kept Korean employee roles specific when a safe assignment name is available.

## 0.1.7 — 2026-09-03

- Linked activity summaries to the current CEO directive and a Korean work stage.
- Added project-room summaries for the current directive and recent employee assignments.
- Converted known English work topics to Korean and suppressed opaque encrypted or identifier-like text.
- Kept activity summaries, assignments, and discussions bound to the CEO directive that created them.
- Stored only Korean-safe assignment and handoff summaries instead of raw task slugs or mixed-language commands.
- Added redacted subagent handoff summaries while keeping commands, tool output, and transcripts excluded.

## 0.1.6 — 2026-09-03

- Hid lifecycle-only chat sessions and projects without activity for 24 hours.
- Added an independent per-project activity selector with optional concrete work details.
- Added local opt-in capture for redacted directives and subagent collaboration messages.
- Displayed recent discussion text only when at least two subagents are actively collaborating.

## 0.1.2 — 2026-08-27

- Kept project rooms in stable positions during ordinary activity updates.
- Appended newly started projects without moving existing rooms.
- Moved completed projects behind active rooms only when all main sessions are offline.
- Added project lifecycle and ordering regression tests.

## 0.1.1 — 2026-08-27

- Fixed CI on clean runners by building static hosting artifacts before the Sites packaging tests.

## 0.1.0 — 2026-08-27

- Added the top-down multi-project office dashboard and activity timeline.
- Added Codex hook capture with privacy-minimized, rotating JSONL storage.
- Added server-side sanitization, opaque IDs, collaboration inference, and stale-state handling.
- Added hidden Windows startup, safe hook merging, and uninstall support.
- Added English and Korean documentation, architecture, security notes, runtime screenshots, and CI.
