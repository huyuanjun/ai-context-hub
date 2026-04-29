import path from "node:path";
import { appendText, ensureDir } from "./fsx.js";
import { hubPaths } from "../core/paths.js";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export function createLogger(root, namespace = "default") {
  let currentDate = today();

  function logFilePath() {
    return path.join(hubPaths(root).logs, `${namespace}-${currentDate}.jsonl`);
  }

  function rotate() {
    const todayStr = today();
    if (todayStr !== currentDate) {
      currentDate = todayStr;
    }
  }

  function entry(level, message, data = {}) {
    rotate();
    return JSON.stringify({
      ts: new Date().toISOString(),
      level,
      ns: namespace,
      msg: message,
      ...(Object.keys(data).length ? { data } : {})
    }) + "\n";
  }

  async function write(level, message, data) {
    try {
      await ensureDir(path.dirname(logFilePath()));
      await appendText(logFilePath(), entry(level, message, data));
    } catch {
      // Log failures must never throw
    }
  }

  return {
    debug: (msg, data) => write("debug", msg, data),
    info: (msg, data) => write("info", msg, data),
    warn: (msg, data) => write("warn", msg, data),
    error: (msg, data) => write("error", msg, data),
    flush: async () => {}
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
