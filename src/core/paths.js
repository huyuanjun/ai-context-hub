import os from "node:os";
import path from "node:path";

export function defaultHubRoot() {
  if (process.env.AI_CONTEXT_ROOT) return path.resolve(process.env.AI_CONTEXT_ROOT);
  return path.join(os.homedir(), ".ai-context");
}

export function resolveHubRoot(args) {
  const rootArg = valueAfter(args, "--root");
  return path.resolve(rootArg || defaultHubRoot());
}

export function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] || null;
}

export function hasFlag(args, flag) {
  return args.includes(flag);
}

export function positionalArgs(args, valueFlags = ["--root"]) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (valueFlags.includes(arg)) {
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) continue;
    result.push(arg);
  }
  return result;
}

export function hubPaths(root) {
  return {
    root,
    config: path.join(root, "config.json"),
    registry: path.join(root, "registry.json"),
    lock: path.join(root, ".sync.lock"),
    memory: {
      root: path.join(root, "memory"),
      inbox: path.join(root, "memory", "inbox"),
      canonical: path.join(root, "memory", "canonical"),
      global: path.join(root, "memory", "canonical", "global.md"),
      preferences: path.join(root, "memory", "canonical", "preferences.md"),
      tools: path.join(root, "memory", "canonical", "tools.md"),
      projects: path.join(root, "memory", "canonical", "projects"),
      graph: path.join(root, "memory", "graph"),
      graphFile: path.join(root, "memory", "graph", "memory.jsonl"),
      conflicts: path.join(root, "memory", "conflicts"),
      archive: path.join(root, "memory", "archive")
    },
    skills: path.join(root, "skills"),
    backups: path.join(root, "backups"),
    exports: path.join(root, "exports"),
    logs: path.join(root, "logs")
  };
}

export function toolTargets(cwd = process.cwd()) {
  const home = os.homedir();
  return {
    claude: {
      kind: "global",
      bootstrap: path.join(home, ".claude", "CLAUDE.md"),
      skills: path.join(home, ".claude", "skills")
    },
    codex: {
      kind: "global",
      bootstrap: path.join(home, ".codex", "AGENTS.md"),
      skills: path.join(home, ".codex", "skills")
    },
    gemini: {
      kind: "global",
      bootstrap: path.join(home, ".gemini", "GEMINI.md")
    },
    agents: {
      kind: "global",
      skills: path.join(home, ".agents", "skills")
    },
    cursor: {
      kind: "project",
      bootstrap: path.join(cwd, ".cursor", "rules", "shared-ai-context.mdc")
    },
    windsurf: {
      kind: "project",
      bootstrap: path.join(cwd, ".windsurf", "rules", "shared-ai-context.md")
    }
  };
}
