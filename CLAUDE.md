Before searching for files with Glob/Grep, check docs/sys/lookup.json — a concept-to-files index. If your search term matches a key, you already know which files to read.

## Project rules

- Use English in code comments, documentation, and commit messages. Use Go and TypeScript only.
- `third_party/` contains upstream code. Keep changes minimal, mark them, and list them in `third_party/README.md`.
- Never commit game-derived assets, anything under root `data/`, or credentials.
- Every new first-party source file starts with its SPDX header line: Go/TS/TSX/JS/MJS use `// SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.`, CSS uses `/* SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md. */`, and `tools/*.ps1` scripts use `# SPDX-License-Identifier: AGPL-3.0-only. Additional terms: see NOTICE.md.` (placed after any `#requires` line).

## Test builds

Jordan's test build is `dist\installation-08.exe` (gitignored), built from `main` and replaced in place by each build. If the app is running, move the old file aside to `installation-08.exe~` first. No zips, no per-version folders, no `.old` copies, and never `P:\documents\levelup-3d`.

## Testing: targeted only, never full

- **Never run a full package test or a "baseline" run.** No `go test ./...`, and no `go test <pkg>` without `-run`. Never write either into a brief. Run only the tests you added or touched: `go test <pkg> -run '<names>' -count=1`, plus `go build` and `go vet` on the touched packages. Frontend: `npx tsc --noEmit -p web`, and vitest on the touched files with `--maxWorkers=2`.
- Several agents share this PC. Full runs from several of them at once will crash it (Jordan, 2026-11-23: "never full. targeted.").
- Gamefiles-tagged tests: one named test per process, only inside `P:\software\infinite-library\scripts\gamefiles-slot.ps1 take` / `give`, and one at a time.
- Run builds and tests with `$env:GOMAXPROCS = '4'` at BelowNormal priority.
- No before/after A/B timing runs: no build-time comparisons, clean reruns or warm/cold pairs (Jordan, 2026-11-23). Report a speed change from the app's own setup log on a normal launch.
