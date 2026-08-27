# Visual QA

- Runtime captures: `docs/screenshots/dashboard-demo.png`, `docs/screenshots/dashboard-live-sanitized.png`
- Comparison viewport: 1069 × 869
- Console errors or warnings: none observed

## Visual checks

- Simple top-down office metaphor, dark floor, rectangular rooms, contrasting doors, and small employee markers are preserved.
- Project state, employee state, collaboration table, connection freshness, and recent activity remain legible.
- Responsive breakpoints avoid visible clipping and broken room layouts.
- The repository screenshot uses public demo data and contains no user project, machine, account, or network identifiers.

## Interaction checks

- Project filters update room count, active employee count, and recent activity.
- Live, demo, disconnected, and stale states render distinctly.
- The browser polls the local API every 1.5 seconds.

Final result: passed.
