import path from "node:path";
import { ensureDir, writeTextAtomic } from "../utils/fsx.js";
import { hubPaths } from "./paths.js";

export async function writeScheduleFiles(root, options = {}) {
  const paths = hubPaths(root);
  const outDir = path.join(paths.exports, "watch");
  const cliPath = options.cliPath || path.resolve(process.argv[1]);
  const intervalMinutes = Math.max(Number(options.intervalMinutes || 5), 1);
  const taskName = options.taskName || "AI Context Hub Watch";

  await ensureDir(outDir);

  if (process.platform === "win32") {
    return await writeWindowsSchedule(outDir, { cliPath, root, intervalMinutes, taskName });
  }
  return await writeUnixSchedule(outDir, { cliPath, root, intervalMinutes, taskName });
}

async function writeWindowsSchedule(outDir, opts) {
  const watchOnce = path.join(outDir, "watch-once.ps1");
  const installTask = path.join(outDir, "install-task.ps1");
  const uninstallTask = path.join(outDir, "uninstall-task.ps1");

  await Promise.all([
    writeTextAtomic(watchOnce, watchOncePs1(opts.cliPath, opts.root)),
    writeTextAtomic(installTask, installTaskPs1(opts.taskName, watchOnce, opts.intervalMinutes)),
    writeTextAtomic(uninstallTask, uninstallTaskPs1(opts.taskName)),
  ]);

  return {
    taskName: opts.taskName,
    intervalMinutes: opts.intervalMinutes,
    platform: "win32",
    files: [watchOnce, installTask, uninstallTask],
    note: "Review the scripts first. Run install-task.ps1 as Administrator to register the scheduled task."
  };
}

async function writeUnixSchedule(outDir, opts) {
  const watchOnce = path.join(outDir, "watch-once.sh");
  const installCron = path.join(outDir, "install-cron.sh");
  const uninstallCron = path.join(outDir, "uninstall-cron.sh");
  const serviceFile = path.join(outDir, "ai-context-watch.service");
  const timerFile = path.join(outDir, "ai-context-watch.timer");
  const installSystemd = path.join(outDir, "install-systemd.sh");
  const uninstallSystemd = path.join(outDir, "uninstall-systemd.sh");

  const escapedCliPath = opts.cliPath.replace(/'/g, "'\\''");
  const escapedRoot = opts.root.replace(/'/g, "'\\''");

  await Promise.all([
    writeTextAtomic(watchOnce, watchOnceSh(escapedCliPath, escapedRoot)),
    writeTextAtomic(installCron, installCronSh(watchOnce, opts.intervalMinutes)),
    writeTextAtomic(uninstallCron, uninstallCronSh()),
    writeTextAtomic(serviceFile, systemdService(escapedCliPath, escapedRoot)),
    writeTextAtomic(timerFile, systemdTimer(opts.intervalMinutes)),
    writeTextAtomic(installSystemd, installSystemdSh(opts.intervalMinutes)),
    writeTextAtomic(uninstallSystemd, uninstallSystemdSh()),
  ]);

  return {
    taskName: opts.taskName,
    intervalMinutes: opts.intervalMinutes,
    platform: process.platform,
    files: [watchOnce, installCron, uninstallCron, serviceFile, timerFile, installSystemd, uninstallSystemd],
    note: "Choose cron (simpler) or systemd (better for long-running monitoring). Review scripts before running."
  };
}

// --------------- Windows PowerShell scripts ---------------

function watchOncePs1(cliPath, root) {
  return [
    '$ErrorActionPreference = "Stop"',
    `node "${escapePs(cliPath)}" watch --once --root "${escapePs(root)}"`,
    ""
  ].join("\n");
}

const INSTALL_TASK_PS1 = [
  '$ErrorActionPreference = "Stop"',
  '$taskName = "__TASK_NAME__"',
  '$script = "__WATCH_ONCE__"',
  '$argument = \'-NoProfile -ExecutionPolicy Bypass -File "\' + $script + \'"\'',
  '$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument',
  '$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes __INTERVAL__)',
  '$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -StartWhenAvailable',
  'Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Runs ai-context-hub watch --once on an interval." -Force',
  ''
].join("\n");

function installTaskPs1(taskName, watchOnce, intervalMinutes) {
  return INSTALL_TASK_PS1
    .replace("__TASK_NAME__", escapePs(taskName))
    .replace("__WATCH_ONCE__", escapePs(watchOnce))
    .replace("__INTERVAL__", String(intervalMinutes));
}

const UNINSTALL_TASK_PS1 = [
  '$ErrorActionPreference = "Stop"',
  'Unregister-ScheduledTask -TaskName "__TASK_NAME__" -Confirm:$false',
  ''
].join("\n");

function uninstallTaskPs1(taskName) {
  return UNINSTALL_TASK_PS1.replace("__TASK_NAME__", escapePs(taskName));
}

function escapePs(value) {
  return String(value).replace(/`/g, "``").replace(/"/g, '`"');
}

// --------------- POSIX shell scripts ---------------

function watchOnceSh(cliPath, root) {
  return `#!/bin/sh
# AI CONTEXT HUB — watch-once wrapper
node '${cliPath}' watch --once --root '${root}'
`;
}

function installCronSh(watchOnce, intervalMinutes) {
  const cronEntry = `*/${intervalMinutes} * * * * ${watchOnce} # ai-context-hub`;
  return `#!/bin/sh
# Install cron job for ai-context-hub
# Removes any existing ai-context-hub cron entry first, then adds a new one.
crontab -l 2>/dev/null | grep -v '# ai-context-hub' | crontab - 2>/dev/null
(crontab -l 2>/dev/null; echo '${cronEntry}') | crontab -
echo "ai-context-hub cron job installed (every ${intervalMinutes} min)"
`;
}

function uninstallCronSh() {
  return `#!/bin/sh
# Remove ai-context-hub cron job
crontab -l 2>/dev/null | grep -v '# ai-context-hub' | crontab - 2>/dev/null
echo "ai-context-hub cron job removed (if it existed)"
`;
}

function systemdService(cliPath, root) {
  return `[Unit]
Description=AI Context Hub Watch (oneshot)
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/env node '${cliPath}' watch --once --root '${root}'
StandardOutput=journal
StandardError=journal
`;
}

function systemdTimer(intervalMinutes) {
  let intervalSec = intervalMinutes * 60;
  let onCalendar = "";
  if (intervalMinutes > 15) {
    const min = Math.floor(Math.random() * 10) + 2;
    onCalendar = `OnCalendar=*:${String(min).padStart(2, "0")}/${intervalMinutes}`;
  }
  const onUnitActive = `OnUnitActiveSec=${intervalSec}`;
  const timerLine = onCalendar ? `${onCalendar}\n${onUnitActive}` : onUnitActive;
  return `[Unit]
Description=AI Context Hub Watch Timer

[Timer]
${timerLine}
RandomizedDelaySec=${Math.min(intervalSec / 4, 180)}
Persistent=true

[Install]
WantedBy=timers.target
`;
}

function installSystemdSh(intervalMinutes) {
  return `#!/bin/sh
# Install systemd timer for ai-context-hub
# Requires: systemctl, user-level systemd (systemctl --user)
set -e
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p ~/.config/systemd/user/
cp "$SCRIPT_DIR/ai-context-watch.service" ~/.config/systemd/user/
cp "$SCRIPT_DIR/ai-context-watch.timer" ~/.config/systemd/user/

systemctl --user daemon-reload
systemctl --user enable ai-context-watch.timer
systemctl --user start ai-context-watch.timer

echo "ai-context-hub systemd timer installed (every ${intervalMinutes} min)"
echo "Check status: systemctl --user status ai-context-watch.timer"
`;
}

function uninstallSystemdSh() {
  return `#!/bin/sh
# Remove ai-context-hub systemd timer
set -e
systemctl --user stop ai-context-watch.timer 2>/dev/null || true
systemctl --user disable ai-context-watch.timer 2>/dev/null || true
rm -f ~/.config/systemd/user/ai-context-watch.service
rm -f ~/.config/systemd/user/ai-context-watch.timer
systemctl --user daemon-reload
echo "ai-context-hub systemd timer removed"
`;
}
