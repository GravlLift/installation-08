Before searching for files with Glob/Grep, check docs/sys/lookup.json — a concept-to-files index. If your search term matches a key, you already know which files to read.

## Project rules

- Use English in code comments, documentation, and commit messages. Use Go and TypeScript only.
- `third_party/` contains upstream code. Keep changes minimal, mark them, and list them in `third_party/README.md`.
- Never commit game-derived assets, anything under root `data/`, or credentials.
- Every new first-party source file starts with its SPDX header line: Go/TS/TSX/JS/MJS use `// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.`, CSS uses `/* SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md. */`, and `tools/*.ps1` scripts use `# SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.` (placed after any `#requires` line).

## Test builds

Jordan's test build is `dist\installation-08.exe` (gitignored), built from `main` and replaced in place by each build. If the app is running, move the old file aside to `installation-08.exe~` first. No zips, no per-version folders, no `.old` copies, and never `P:\documents\levelup-3d`.
