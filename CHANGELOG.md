# Changelog

## 0.1.0 (2026-04-29)

Initial release.

### Features
- Shared memory hub: inbox → canonical → graph pipeline
- Six entity relation types: works_on, depends_on, related_to, contradicts, supersedes, has_skill
- TF-IDF semantic search with cached index
- TTL-based memory lifecycle with expiration
- Entity alias resolution (e.g. Chinese name → pinyin)
- Skill management: validate, index, link, adopt across AI tools
- Cross-platform scheduler scripts (Windows Task Scheduler, cron, systemd timer)
- Git-based snapshot, restore, and history
- Six AI tool adapters: Claude Code, Codex, Gemini, Cursor, Windsurf, Agents

### Design
- Zero external dependencies — pure Node.js >= 20
- grep-first token-efficient AI tool instructions
- File-locked concurrency-safe inbox sync
- Atomic writes via temp file + rename
- Backward-compatible observation format (string → structured object)
