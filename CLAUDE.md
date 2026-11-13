Before searching for files with Glob/Grep, check docs/sys/lookup.json — a concept-to-files index. If your search term matches a key, you already know which files to read.

## Project rules

- Use English in code comments, documentation, and commit messages. Use Go and TypeScript only.
- `third_party/` contains upstream code. Keep changes minimal, mark them, and list them in `third_party/README.md`.
- Never commit game-derived assets, anything under root `data/`, or credentials.
