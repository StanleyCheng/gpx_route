# Repository Guidelines

## Project Structure & Module Organization

`index.html` contains the browser UI, styles, GPX/FIT import flow, and map playback logic. Reusable route processing lives in `route-core.mjs`; keep filtering and timestamp logic there so it remains testable outside the browser. `route-core.test.mjs` is the current Node test suite. `build.mjs` bundles route logic and the Garmin FIT SDK with esbuild. Static source images live in `public/`. `docs/` is generated and committed for GitHub Pages; `dist/` is generated for OpenAI hosting and ignored. Hosting metadata lives in `.openai/hosting.json`.

## Build, Test, and Development Commands

- `npm ci` installs the exact dependency versions in `package-lock.json`.
- `npm test` runs route filtering and timestamp-normalization assertions.
- `npm run build` recreates both `docs/` and `dist/`, removing their previous contents first.
- `python -m http.server 8000 --directory docs` serves the built site at `http://localhost:8000`.

Run tests before building. Rebuild after changing `index.html`, `route-core.mjs`, dependencies, or public assets, and review generated `docs/` diffs before committing. Edit source files, not generated output.

## Coding Style & Naming Conventions

Use ES modules, two-space indentation, semicolons, and single quotes in JavaScript. Prefer small functions and immutable bindings (`const`). Use `camelCase` for variables and functions, `PascalCase` for classes, `UPPER_SNAKE_CASE` for exported constants, and kebab-case for CSS classes and asset names. No formatter or linter is configured; preserve surrounding style and compatibility with the esbuild Safari 16.4 target.

## Testing Guidelines

Tests use `node:assert/strict` without an external framework. Name new test files `*.test.mjs` and update the `test` script when adding suites. Cover normal tracks and edge cases such as malformed or duplicate timestamps, GPS spikes, boundary speeds, and tracks with fewer than two usable points. No coverage threshold is configured; prioritize focused behavioral assertions. Run both `npm test` and `npm run build` before opening a pull request because browser UI logic lacks automated coverage.

## Commit & Pull Request Guidelines

History follows Conventional Commit-style subjects, primarily `feat:`, `fix:`, `refactor:`, and `chore:`. Use a concise, lowercase imperative summary, for example `fix: reject non-monotonic timestamps`. Pull requests should explain user-visible behavior, link related issues when applicable, list verification commands, and include screenshots or a short recording for UI or map changes. Include regenerated `docs/` when publishing updated build output. Never commit GPX activity files, credentials, or MapTiler API keys.
