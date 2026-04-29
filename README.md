# AI Context Hub

<p align="center">
  <strong>One memory. Every AI tool.</strong>
</p>

<p align="center">
  <a href="#license"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue.svg"></a>
  <a href="https://www.npmjs.com/package/ai-context-hub"><img alt="npm" src="https://img.shields.io/badge/npm-ai--context--hub-red.svg"></a>
  <a href="#"><img alt="Node" src="https://img.shields.io/badge/node-%3E%3D20-green.svg"></a>
  <a href="#"><img alt="Dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen.svg"></a>
</p>

Shared memory and skills hub for AI coding tools — **Claude Code**, **Codex**, **Gemini**, **Cursor**, **Windsurf**, and other agents. Write a fact once, every AI assistant can recall it.

- **Zero dependencies** — pure Node.js built-in modules
- **Cross-platform** — Windows, macOS, Linux
- **Token-efficient** — grep-first, never loads the full knowledge graph into context
- **Concurrency-safe** — file-locked inbox, atomic writes

---

## Demo

```bash
$ ai-context remember "HA module dual-master supports single group only" --entity ha --confidence 1.0
Wrote inbox memory: ~/ai-context/memory/inbox/manual/2026-04-29T00-00-00-000Z.jsonl

$ ai-context sync
{
  "merged": 1,
  "skipped": 0,
  "canonicalWrites": 1,
  "graphUpdates": 1
}

$ ai-context search "dual-master"
{
  "results": [
    {
      "text": "HA module dual-master supports single group only",
      "entity": "ha",
      "source": "manual",
      "confidence": 1
    }
  ],
  "count": 1,
  "mode": "keyword"
}

$ ai-context search "network partition" --semantic
{
  "results": [
    {
      "text": "HA module dual-master supports single group only",
      "entity": "ha",
      "score": 0.73
    }
  ],
  "count": 1,
  "mode": "semantic"
}

$ ai-context relate --from user --to ha --kind works_on --apply
{ "from": "user", "to": "ha", "kind": "works_on", "id": "rel-001" }

$ ai-context relations user
{ "entity": "user", "relations": [{ "to": "ha", "kind": "works_on" }] }
```

---

## Install

```bash
npm install -g ai-context-hub
```

Or run from source:

```bash
git clone https://github.com/anthropics/ai-context-hub.git
cd ai-context-hub
npm link
```

Requires Node.js >= 20.

---

## Quick Start

```bash
# Initialize the shared data directory (default: ~/.ai-context)
ai-context init

# Scan for existing AI tool configurations
ai-context scan

# Import existing bootstraps and skills
ai-context import

# Validate skills and generate token-efficient index
ai-context skills validate
ai-context skills index

# Enable shared context for all detected AI tools
ai-context enable --dry-run   # review first
ai-context enable --apply     # then apply
```

Override the data directory:

```bash
ai-context init --root /path/to/shared-hub
# or: export AI_CONTEXT_ROOT=/path/to/shared-hub
```

---

## How It Works

```text
   remember "fact"              sync                  search "fact"
         │                        │                       │
         ▼                        ▼                       ▲
   ┌──────────┐    merge    ┌───────────┐    query   ┌─────────┐
   │  inbox/  │ ──────────► │ canonical  │ ◄───────── │ search  │
   │ one file │             │ + graph    │            │ keyword │
   │ per fact │             │ (JSONL)    │            │ + TF-IDF│
   └──────────┘             └───────────┘            └─────────┘
                                   │
                                   ▼
                            ┌───────────┐
                            │ AI tools  │
                            │ read via  │
                            │ bootstrap │
                            └───────────┘
```

1. **`remember`** writes a fact as a single JSONL file into `inbox/` — no conflicts, ever
2. **`sync`** merges inbox → canonical markdown + entity-observation graph
3. **Each AI tool** discovers the hub via a bootstrap file, using `Select-String` (or `grep`) to find relevant facts **without loading the full graph**
4. **`search`** offers both keyword (fast substring) and semantic (TF-IDF cosine similarity) search

---

## AI Tool Discovery

Running `ai-context enable --apply` writes lightweight bootstrap files:

| Tool | Bootstrap | Skills |
|------|-----------|--------|
| Claude Code | `~/.claude/CLAUDE.md` | `~/.claude/skills/` |
| Codex | `~/.codex/AGENTS.md` | `~/.codex/skills/` |
| Gemini CLI | `~/.gemini/GEMINI.md` | — |
| Cursor | `.cursor/rules/shared-ai-context.mdc` | — |
| Windsurf | `.windsurf/rules/shared-ai-context.md` | — |
| Agents | `~/.agents/AGENTS.md` | `~/.agents/skills/` |

Each bootstrap is ~350 tokens and tells the AI: "grep the graph, never read it in full."

---

## Data Layout

```text
~/.ai-context/
  config.json
  registry.json
  memory/
    inbox/              ← staging area, one file per fact
      claude/
      codex/
      manual/
    canonical/           ← authoritative markdown facts
      global.md          ← hub usage guide for AI tools
      preferences.md     ← user preferences & constraints
      <entity>.md        ← per-entity facts
    graph/
      memory.jsonl       ← entity-observation graph (JSONL)
      .search-index.json  ← cached TF-IDF index
  skills/
    <skill-name>/
      SKILL.md
    INDEX.md              ← token-efficient skill directory
  logs/
  backups/
```

---

## Commands

| Command | Description |
|---------|-------------|
| `init` | Create the shared data directory |
| `scan` | Discover existing AI tool configs |
| `import` | Import existing bootstraps & skills |
| `enable` | Full rollout: validate → index → adopt → link → snapshot |
| `remember` | Write a durable fact to inbox |
| `sync` | Merge inbox → canonical + graph |
| `search` | Keyword or semantic (TF-IDF) search |
| `context` | Print compact context for injection into AI prompts |
| `list` | List all entities in the graph |
| `relate` | Create entity relationship |
| `relations` | View entity relationships |
| `remove-relation` | Remove a relationship by ID |
| `expire` | Archive TTL-expired observations |
| `backup create` | Create a backup snapshot |
| `backup list` | List backups |
| `mcp` | Export MCP config snippets |
| `skills validate` | Validate skill frontmatter |
| `skills index` | Generate skills INDEX.md |
| `link` | Link skills to AI tool directories |
| `adopt` | Replace unmanaged skills with managed |
| `watch` | Run sync + index + validate cycle |
| `schedule` | Generate OS scheduler scripts for background sync |
| `snapshot` | Git commit the hub state |
| `history` | List recent snapshots |
| `restore` | Restore from a previous snapshot |
| `doctor` | Health check across all subsystems |

---

## Why Not Just a Shared File?

| Approach | Multi-Tool | Relations | Semantic Search | TTL | Token-Efficient |
|----------|-----------|-----------|-----------------|-----|-----------------|
| Shared `.md` file | partial | no | no | no | no |
| Environment variables | yes | no | no | no | yes |
| MCP memory server | partial | varies | varies | no | varies |
| **AI Context Hub** | **yes** | **yes** | **yes** | **yes** | **yes** |

---

## Design

- **Zero dependencies** — `node:crypto`, `node:fs`, `node:path`, `node:os`, `node:child_process` only
- **Inbox-first writes** — tools write facts as separate files, no conflicts
- **Atomic sync** — lock → deduplicate → write canonical + graph → unlock
- **Observations as objects** — `{id, text, confidence, source, createdAt, ttl}`, backward compatible with plain strings
- **Six relation kinds** — `works_on`, `depends_on`, `related_to`, `contradicts`, `supersedes`, `has_skill`
- **TF-IDF semantic search** — zero-dependency, cached index with checksum-based staleness detection
- **Entity aliases** — map Chinese names to pinyin entities

## FAQ

**Does it work offline?** Yes. Everything is local. No network calls.

**Can I use it without `npm link`?** Yes, if you put `src/cli.js` on your PATH directly — it has no dependencies.

**Will it overwrite my existing CLAUDE.md?** `enable` backs up existing files before writing. You can also review with `--dry-run` first.

**What if multiple AI tools write the same fact?** The SHA256-based deduplication in `sync` catches duplicates automatically.

**Where are my memories stored?** `~/.ai-context/memory/` by default. Override with `--root` or `AI_CONTEXT_ROOT`.

---

## License

MIT — see [LICENSE](LICENSE).
