# Contributing

Thanks for contributing to AI Context Hub.

## Getting started

```bash
git clone <repo-url> && cd ai-context-hub
node src/cli.js --version
```

There are **zero dependencies** — no `npm install` needed.

## Running tests

```bash
node --test tests/*.test.js
```

Each test suite creates an isolated temp directory, so tests don't touch your real data.

## Code style

- Pure Node.js built-in modules only — no third-party dependencies, ever
- ES modules (`import`/`export`)
- Functions use async/await
- File I/O uses the helpers in `src/utils/fsx.js` (atomic writes, file locking)

## Conventions

- New CLI commands go in `src/core/<name>.js`, wired into `src/cli.js`
- Commands that modify state follow `--dry-run` (default) / `--apply` pattern
- Use `writeTextAtomic()` for writes, `withLock()` for guarded critical sections

## Opening a PR

1. Run the full test suite and ensure all pass
2. Use the PR template
3. Keep changes focused — one concern per PR
