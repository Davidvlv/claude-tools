// The edit log: one JSON line for each change the hooks make or ask for, in one file per local day.
// It lives in the Claude config folder next to mode.json, so /no-claudisms status can find it.
import fs from 'node:fs';
import path from 'node:path';
import { configDir } from './mode.mjs';

export const LOG_DAYS = 7;

export function logDir() {
  return path.join(configDir(), 'no-claudisms', 'log');
}

function dayName(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Logging must never change what a hook does, so a failure to write is ignored.
export function logEdit(entry, { dir = logDir(), now = new Date() } = {}) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${dayName(now)}.jsonl`);
    const fresh = !fs.existsSync(file);
    fs.appendFileSync(file, JSON.stringify({ time: now.toISOString(), ...entry }) + '\n');
    if (fresh) pruneLog(dir, now);
  } catch {}
}

function pruneLog(dir, now) {
  const cutoff = dayName(new Date(now.getTime() - LOG_DAYS * 86400000));
  for (const f of fs.readdirSync(dir)) {
    if (/^\d{4}-\d\d-\d\d\.jsonl$/u.test(f) && f.slice(0, 10) < cutoff) fs.rmSync(path.join(dir, f), { force: true });
  }
}

export function logCount(dir = logDir()) {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .reduce((n, f) => n + fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).length, 0);
  } catch {
    return 0;
  }
}
