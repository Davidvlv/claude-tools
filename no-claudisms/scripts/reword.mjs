// Asks a minimal Haiku run to reword flagged sentences, so the display hook can show them in place.
// Each call is a fresh process: the prompt is too short for the prompt cache, so a kept-alive
// process would save about a second and nothing in cost, at the price of a background daemon.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const CHILD_ENV = 'NO_CLAUDISMS_CHILD';
const TIMEOUT_MS = 12_000;

const SYSTEM = [
  'You reword sentences for a chat window.',
  'Each numbered item gives a sentence and the stock phrases to remove from it.',
  'Write each sentence again with the same meaning and the same facts, names, numbers, code, links and markdown, without the listed phrases.',
  'Use plain words. Do not join clauses with dashes.',
  'Keep every fact: "not just X, it is Y" still says both X and Y.',
  'You know only what the sentence says, so never add a claim, detail or example it does not make: replace a vague phrase with a plain word of the same vagueness, or drop it.',
  'Reply with only the reworded sentences, one per line, each starting with its number and a period, in the same order.',
].join(' ');

export function buildPrompt(items) {
  return items
    .map((it, i) => `${i + 1}. ${it.clause.replace(/\s*\n\s*/gu, ' ')}\n   Remove: ${it.hits.map((h) => `"${h.match}"`).join(', ')}`)
    .join('\n');
}

export function parseReply(text, count) {
  const out = new Array(count).fill(null);
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)\.\s+(.+?)\s*$/u);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= count) out[Number(m[1]) - 1] = m[2];
  }
  return out;
}

// items: [{ clause, hits: [{ match }] }]. Returns one reworded string per item, or null for an item
// that failed. Never throws: any failure leaves the caller to mask the clause instead.
export async function reword(items, { command = 'claude', commandArgs = [], timeoutMs = TIMEOUT_MS, model = 'haiku' } = {}) {
  if (items.length === 0) return [];
  let dir;
  try {
    // An empty working folder, so the child finds no project settings or hooks to load.
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-claudisms-'));
    const args = [
      '-p', '--model', model, '--system-prompt', SYSTEM, '--tools', '',
      '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence',
      '--setting-sources', 'local', '--output-format', 'json',
    ];
    const text = await run(command, [...commandArgs, ...args], buildPrompt(items), dir, timeoutMs);
    return text === null ? items.map(() => null) : parseReply(text, items.length);
  } catch {
    return items.map(() => null);
  } finally {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run(command, args, input, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
      // Thinking is off because it doubles the time and quadruples the cost of a one-line rewrite.
      env: { ...process.env, [CHILD_ENV]: '1', MAX_THINKING_TOKENS: '0', DISABLE_PROMPT_CACHING: '1', CLAUDE_CODE_RETRY_WATCHDOG: '0' },
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    let out = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      stopTree(child);
      finish(null);
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      if (code !== 0) return finish(null);
      try {
        const j = JSON.parse(out);
        finish(j.is_error ? null : String(j.result ?? ''));
      } catch {
        finish(null);
      }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

function stopTree(child) {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 10_000 });
  else child.kill('SIGKILL');
}
