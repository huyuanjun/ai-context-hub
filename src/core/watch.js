import { createLogger } from "../utils/logger.js";
import { syncInbox } from "./sync.js";
import { snapshotHub } from "./snapshot.js";
import { validateSkills, writeSkillIndex } from "./skills.js";

export async function runWatch(root, options = {}) {
  const intervalMs = Math.max(Number(options.intervalMs || 30000), 1000);
  const once = Boolean(options.once);
  const snapshot = Boolean(options.snapshot);
  const onResult = options.onResult || (() => {});
  const log = createLogger(root, "watch");

  do {
    const result = await runCycle(root, { snapshot });
    log.info("cycle.end", result);
    onResult(result);
    if (once) return result;
    await sleep(intervalMs);
  } while (true);
}

export async function runCycle(root, options = {}) {
  const log = createLogger(root, "watch");
  log.info("cycle.start", { at: new Date().toISOString() });
  const sync = await syncInbox(root);
  const skillIndex = await writeSkillIndex(root);
  const skillValidation = await validateSkills(root);
  const shouldSnapshot = Boolean(options.snapshot) && (sync.added > 0 || skillValidation.status !== "ok");
  const snapshot = shouldSnapshot ? await snapshotHub(root, `watch sync ${new Date().toISOString()}`) : null;

  return {
    at: new Date().toISOString(),
    sync,
    skillIndex,
    skillValidation: {
      status: skillValidation.status,
      count: skillValidation.count
    },
    snapshot
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
