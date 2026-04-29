import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { ensureDir } from "../src/utils/fsx.js";
import { initHub } from "../src/core/store.js";

export async function tempHub() {
  const dir = path.join(os.tmpdir(), `ai-context-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await ensureDir(dir);
  const paths = await initHub(dir);
  return {
    root: dir,
    paths,
    async cleanup() {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
}

export async function addInboxEntry(root, tool, text, options = {}) {
  const { remember } = await import("../src/core/store.js");
  return remember(root, tool, text, options);
}
