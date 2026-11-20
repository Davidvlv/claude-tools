#!/usr/bin/env node
// Waits for background jobs inside one Claude turn: sleeps up to --minutes and returns
// early once any --file is non-empty, for a job that writes its output only when it ends.
import { realpathSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const USAGE = 'usage: node wait.mjs --minutes <1-10> [--file <path>]...';
const POLL_MS = 1000;

export function parseArgs(argv) {
  let minutes;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--minutes' || arg === '--file') {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      if (arg === '--file') files.push(value);
      else minutes = Number(value);
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  if (minutes === undefined) throw new Error('--minutes is required');
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 10) throw new Error('--minutes must be from 1 to 10');
  return { minutes, files };
}

function nonEmpty(files) {
  return files.filter(file => {
    try {
      return statSync(file).size > 0;
    } catch {
      return false;
    }
  });
}

export async function wait({ minutes, files }, durationMs = minutes * 60_000) {
  const end = Date.now() + durationMs;
  for (;;) {
    const ready = nonEmpty(files);
    if (ready.length) return ready;
    const left = end - Date.now();
    if (left <= 0) return [];
    await new Promise(resolve => setTimeout(resolve, Math.min(POLL_MS, left)));
  }
}

// Real paths, because the installed skill is a symlink.
function isDirectRun() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isDirectRun()) {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stdout.write(`${e.message}\n${USAGE}\n`);
    process.exit(2);
  }
  // Lets the tests check a full sleep in seconds instead of a minute; not part of the usage.
  const testSeconds = Number(process.env.WAIT_MJS_TEST_SECONDS);
  const ready = await wait(args, testSeconds > 0 ? testSeconds * 1000 : undefined);
  process.stdout.write(ready.length ? `ready: ${ready.join(' ')}\n` : `waited ${args.minutes} min, no file ready\n`);
}
