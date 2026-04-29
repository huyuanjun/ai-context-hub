import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { exists } from "../utils/fsx.js";

const execFileAsync = promisify(execFile);

export async function snapshotHub(root, message = null) {
  const gitDir = path.join(root, ".git");
  const initialized = !(await exists(gitDir));
  if (initialized) {
    await git(root, ["init"]);
  }

  await git(root, ["add", "-A"]);
  const status = await git(root, ["status", "--porcelain"]);
  if (!status.stdout.trim()) {
    return { status: "clean", initialized: false, commit: null };
  }

  const commitMessage = message || `ai-context snapshot ${new Date().toISOString()}`;
  await git(root, [
    "-c",
    "user.name=ai-context-hub",
    "-c",
    "user.email=ai-context-hub@local",
    "commit",
    "-m",
    commitMessage
  ]);
  const rev = await git(root, ["rev-parse", "--short", "HEAD"]);

  return {
    status: "committed",
    initialized,
    commit: rev.stdout.trim(),
    message: commitMessage
  };
}

export async function snapshotHistory(root, limit = 20) {
  const gitDir = path.join(root, ".git");
  if (!(await exists(gitDir))) {
    return { status: "no-history", commits: [] };
  }

  const result = await git(root, [
    "log",
    `--max-count=${limit}`,
    "--pretty=format:%h%x09%aI%x09%s"
  ]);

  const commits = result.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [commit, date, ...messageParts] = line.split("\t");
      return { commit, date, message: messageParts.join("\t") };
    });

  return { status: "ok", commits };
}

export async function restoreHub(root, commit, options = {}) {
  if (!commit) throw new Error("restore requires --to <commit>");
  const gitDir = path.join(root, ".git");
  if (!(await exists(gitDir))) {
    throw new Error(`no git history found in hub: ${root}`);
  }

  await git(root, ["rev-parse", "--verify", `${commit}^{commit}`]);
  const current = (await git(root, ["rev-parse", "--short", "HEAD"])).stdout.trim();
  const target = (await git(root, ["rev-parse", "--short", commit])).stdout.trim();
  const status = (await git(root, ["status", "--porcelain"])).stdout.trim().split(/\r?\n/).filter(Boolean);
  const stat = (await git(root, ["diff", "--stat", `${commit}..HEAD`])).stdout.trim();
  const apply = Boolean(options.apply);

  if (!apply) {
    return {
      mode: "dry-run",
      current,
      target,
      dirtyFiles: status,
      diffStat: stat || "No committed diff between target and HEAD.",
      note: "Run restore --to <commit> --apply to reset the hub to this commit."
    };
  }

  if (status.length > 0 && !options.force) {
    return {
      mode: "blocked",
      current,
      target,
      dirtyFiles: status,
      note: "Hub has uncommitted changes. Run snapshot first or pass --force to discard them."
    };
  }

  await git(root, ["reset", "--hard", commit]);
  const restored = (await git(root, ["rev-parse", "--short", "HEAD"])).stdout.trim();
  return {
    mode: "apply",
    previous: current,
    restored,
    target
  };
}

async function git(cwd, args) {
  try {
    return await execFileAsync("git", ["-c", "safe.directory=*", ...args], { cwd, windowsHide: true });
  } catch (error) {
    const stderr = error.stderr ? String(error.stderr).trim() : "";
    const stdout = error.stdout ? String(error.stdout).trim() : "";
    throw new Error(`git ${args.join(" ")} failed${stderr || stdout ? `: ${stderr || stdout}` : ""}`);
  }
}
