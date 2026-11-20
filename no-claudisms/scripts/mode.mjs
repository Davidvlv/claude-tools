// The mode: which hooks act. /config sets it; /no-claudisms <mode> overrides it for all sessions.
// The override lives in the Claude config folder, not the plugin data folder, because the
// command's shell step and the hooks must find the same file and only hooks get CLAUDE_PLUGIN_DATA.
// Usage (from the /no-claudisms skill): node mode.mjs [<new-mode>|status]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOG_DAYS, logDir, logCount } from './log.mjs';

export const MODES = { all: ['chat', 'output'], chat: ['chat'], output: ['output'], off: [] };

export function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

export function overrideFile() {
  return path.join(configDir(), 'no-claudisms', 'mode.json');
}

// Hooks get the /config value as CLAUDE_PLUGIN_OPTION_MODE; a skill's shell step does not,
// so the command reads it where /config stores it.
export function configuredMode(settingsFile = path.join(configDir(), 'settings.json')) {
  try {
    const configs = JSON.parse(fs.readFileSync(settingsFile, 'utf8')).pluginConfigs ?? {};
    const key = Object.keys(configs).find((k) => k.startsWith('no-claudisms@'));
    return key ? configs[key]?.options?.mode : undefined;
  } catch {
    return undefined;
  }
}

function configOf(configMode) {
  return configMode in MODES ? configMode : 'all';
}

// The override remembers the /config value it replaced: when /config changes later,
// the newer /config choice wins and the override is dropped.
export function effectiveMode(configMode, file = overrideFile()) {
  const config = configOf(configMode);
  try {
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (o.mode in MODES && o.config === config) return o.mode;
    fs.unlinkSync(file);
  } catch {}
  return config;
}

export function modeCommand(configMode, wanted, file = overrideFile(), log = logDir()) {
  const usage = 'Use /no-claudisms all, chat, output, off or status.';
  const mode = wanted?.trim().toLowerCase();
  if (!mode || mode === 'status') {
    return `no-claudisms mode: ${effectiveMode(configMode, file)}. Edit log: ${logCount(log)} entries from the last ${LOG_DAYS} days in ${log}. ${usage}`;
  }
  if (!(mode in MODES)) return `no-claudisms: unknown mode "${mode}". ${usage}`;
  const config = configOf(configMode);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (mode === config) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, JSON.stringify({ mode, config }));
  return `no-claudisms mode: ${mode}, for all sessions.`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(modeCommand(configuredMode(), process.argv.slice(2).join(' ')));
}
