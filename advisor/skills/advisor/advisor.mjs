#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const usage = 'Usage: node advisor.mjs --question-file <file> [--project <dir>] [--timeout <seconds>]';
export const system = [
  'You stand in for the person who owns this project while they are away, and you decide the question you are given.',
  'Your working folder is the project; read it as the question needs. Read a SKILL.md from the skill index when its description fits the question.',
  'Stay consistent with the earlier decisions listed for this project. Choose the recommended option unless the facts show another is better.',
  'You decide design and implementation questions only. Never approve an irreversible or outward-facing action, such as deleting data, pushing, merging, publishing, sending a message or spending money: answer such a question with CHOICE: PARK.',
  'Answer with exactly two lines: `CHOICE: <option>` and then `REASON: <one sentence>`.'
].join(' ');
const logEntries = 20;
const oneLine = value => String(value).replace(/\s+/g, ' ').trim().slice(0, 500);
const isFile = path => existsSync(path) && statSync(path).isFile();
const isDir = path => existsSync(path) && statSync(path).isDirectory();

export function parseArgs(argv, cwd = process.cwd()) {
  let questionFile = null;
  let project = cwd;
  let timeout = 300;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== '--question-file' && arg !== '--project' && arg !== '--timeout') throw new Error(`unknown argument ${arg}`);
    if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`);
    const value = argv[++i];
    if (arg === '--question-file') {
      if (questionFile !== null) throw new Error('give --question-file once');
      questionFile = value;
    } else if (arg === '--project') project = value;
    else timeout = value;
  }
  if (questionFile === null) throw new Error('missing --question-file');
  if (!isFile(questionFile)) throw new Error(`--question-file is not an existing file: ${questionFile}`);
  const question = readFileSync(questionFile, 'utf8');
  if (!question.trim()) throw new Error('the question is empty');
  project = resolve(cwd, project);
  if (!isDir(project)) throw new Error(`--project is not an existing folder: ${project}`);
  // Number('') is 0 and Number(' ') is 0, so an empty value fails the positive check too.
  timeout = Number(timeout);
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2147483) throw new Error('--timeout must be positive and at most 2147483 seconds');
  return { question, project, timeout };
}

function unquote(value) {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

// Reads the top-level scalar fields of a YAML frontmatter block, including folded or literal block scalars.
export function frontmatter(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0].trim() !== '---') return {};
  const fields = {};
  for (let i = 1; i < lines.length && lines[i].trim() !== '---'; i++) {
    const match = /^([A-Za-z_][\w-]*):(.*)$/.exec(lines[i]);
    if (!match) continue;
    let value = match[2].trim();
    if (/^[>|][-+]?$/.test(value)) {
      const parts = [];
      while (i + 1 < lines.length && /^(\s+|$)/.test(lines[i + 1]) && lines[i + 1].trim() !== '---') parts.push(lines[++i].trim());
      value = parts.filter(Boolean).join(' ');
    }
    fields[match[1]] = unquote(value).replace(/\s+/g, ' ').trim();
  }
  return fields;
}

// prefix is `<plugin>:` for a plugin's skills, because Claude Code names them that way.
export function skillIndex(skillsDir, prefix = '') {
  if (!isDir(skillsDir)) return [];
  const index = [];
  for (const folder of readdirSync(skillsDir).sort()) {
    const path = join(skillsDir, folder, 'SKILL.md');
    if (!isFile(path)) continue;
    const fields = frontmatter(readFileSync(path, 'utf8'));
    index.push({ name: prefix + (fields.name || folder), description: fields.description || '', path });
  }
  return index;
}

// The skills folders of the user, the project and every installed plugin.
export function skillSources(configDir, project) {
  const sources = [{ dir: join(configDir, 'skills'), prefix: '' }, { dir: join(project, '.claude', 'skills'), prefix: '' }];
  let plugins = {};
  try { plugins = JSON.parse(readFileSync(join(configDir, 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {}; } catch { /* No plugins installed. */ }
  const seen = new Set();
  for (const [key, entries] of Object.entries(plugins).sort()) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (typeof entry?.installPath !== 'string' || seen.has(entry.installPath)) continue;
      seen.add(entry.installPath);
      sources.push({ dir: join(entry.installPath, 'skills'), prefix: `${key.split('@')[0]}:` });
    }
  }
  return sources.filter(source => isDir(source.dir));
}

const samePath = (a, b) => {
  const norm = p => resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

// An entry starts with `## <ISO time> | <project absolute path> | <session id>` and runs to the next such heading.
export function projectEntries(logText, project, count = logEntries) {
  const entries = [];
  let current = null;
  for (const line of logText.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const heading = /^## [^|]*\|([^|]+)\|/.exec(line);
    if (heading) {
      current = { project: heading[1].trim(), lines: [line] };
      entries.push(current);
    } else if (current) current.lines.push(line);
  }
  return entries
    .filter(entry => samePath(entry.project, project))
    .slice(-count)
    .map(entry => entry.lines.join('\n').trim());
}

export function buildPrompt({ question, skills, entries }) {
  const index = skills.length
    ? skills.map(skill => `- ${skill.name}: ${skill.description} (${skill.path})`).join('\n')
    : 'None.';
  const log = entries.length ? entries.join('\n\n') : 'None.';
  return `Installed skills, each with its description and SKILL.md path:\n${index}\n\nEarlier decisions for this project, oldest first:\n${log}\n\nThe question:\n${question}`;
}

function stopTree(child) {
  // An exited child's id may already belong to another process, which taskkill would stop.
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 20_000 });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { /* Already exited. */ }
}

export function claudeArgs(model, skillDirs) {
  return [
    '-p', '--model', model, '--system-prompt', system,
    '--tools', 'Read,Grep,Glob', '--allowedTools', 'Read', 'Grep', 'Glob',
    ...skillDirs.flatMap(dir => ['--add-dir', dir]), '--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence',
    '--setting-sources', 'local', '--output-format', 'json'
  ];
}

export function logEntry({ time, project, session, question, answer }) {
  return `## ${time} | ${project} | ${session}\nQuestion: ${oneLine(question)}\n${answer.trim()}\n\n`;
}

export async function run(argv, dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const env = dependencies.env || process.env;
  let options;
  try { options = parseArgs(argv, dependencies.cwd || process.cwd()); } catch (error) {
    stderr.write(`${usage}\n${error.message}\n`);
    return 2;
  }
  const unavailable = reason => {
    stdout.write(`ADVISOR_UNAVAILABLE: ${oneLine(reason)}\n`);
    return 1;
  };
  let child;
  let timer;
  try {
    const configDir = env.CLAUDE_CONFIG_DIR || join(dependencies.home || homedir(), '.claude');
    const logPath = join(configDir, 'advisor', 'decisions.md');
    const entries = isFile(logPath) ? projectEntries(readFileSync(logPath, 'utf8'), options.project) : [];
    const sources = skillSources(configDir, options.project);
    const skills = sources.flatMap(source => skillIndex(source.dir, source.prefix));
    const prompt = buildPrompt({ question: options.question, skills, entries });
    const args = claudeArgs(env.ADVISOR_MODEL || 'fable', sources.map(source => source.dir));
    child = spawn(dependencies.command || 'claude', [...(dependencies.commandArgs || []), ...args], {
      cwd: options.project, env: { ...env, CLAUDE_CODE_RETRY_WATCHDOG: '0' },
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe']
    });
    let out = '';
    let errTail = '';
    let spawnError;
    let timedOut = false;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { errTail = (errTail + chunk).slice(-4000); });
    child.stdin.on('error', () => { /* A dead child reports itself through exit or error. */ });
    child.stdin.end(prompt);
    const code = await new Promise(done => {
      let settled = false;
      const complete = value => { if (!settled) { settled = true; done(value); } };
      child.on('error', error => { spawnError = error; complete(null); });
      child.on('close', complete);
      timer = setTimeout(() => { timedOut = true; stopTree(child); complete(null); }, options.timeout * 1000);
    });
    clearTimeout(timer);
    if (spawnError) return unavailable(`cannot start claude: ${spawnError.message}`);
    if (timedOut) return unavailable(`timed out after ${options.timeout} s`);
    let json;
    try { json = JSON.parse(out); } catch { /* Reported below. */ }
    const isObject = json && typeof json === 'object' && !Array.isArray(json);
    const text = isObject && typeof json.result === 'string' ? json.result.trim() : '';
    if (code !== 0) return unavailable(text || errTail.trim() || `claude exited with code ${code}`);
    if (!isObject) return unavailable('claude printed output that is not JSON');
    if (json.is_error === true) return unavailable(text || 'claude reported an error');
    if (!text) return unavailable('claude returned an empty answer');
    if (!/^CHOICE:/m.test(text)) return unavailable(`the answer has no CHOICE line: ${text}`);
    const spent = json.usage || {};
    const tokensIn = (spent.input_tokens || 0) + (spent.cache_creation_input_tokens || 0) + (spent.cache_read_input_tokens || 0);
    stdout.write(text + '\n');
    try {
      mkdirSync(dirname(logPath), { recursive: true });
      appendFileSync(logPath, logEntry({ time: new Date().toISOString(), project: options.project, session: env.CLAUDE_CODE_SESSION_ID || '-', question: options.question, answer: text }));
    } catch (error) {
      stderr.write(`advisor: decision not logged: ${oneLine(error.message || error)}\n`);
    }
    stderr.write(`advisor: ${json.duration_ms ?? 0} ms, ${tokensIn} in, ${spent.output_tokens || 0} out, $${Number(json.total_cost_usd || 0).toFixed(4)}\n`);
    return 0;
  } catch (error) {
    return unavailable(error.message || error);
  } finally {
    clearTimeout(timer);
    stopTree(child);
  }
}

// Node runs a symlinked script from its real path, so argv[1] (the link, e.g. ~/.claude/skills/...) must be resolved too.
function isMain() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (process.argv[1] && isMain()) process.exitCode = await run(process.argv.slice(2));
