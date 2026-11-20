#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

const usage = 'Usage: node look.mjs (--question <text> | --question-file <path>) [--timeout <seconds>] [--input inline|read] [--runs-model <m>] [--fresh-model <m>] [--tiebreak <m>] (<image> [<image> ...] | --compare <dirBefore> <dirAfter> [--threshold <percent>])';
const system = 'You look at pictures for the person who made what they show. Report only what you can see in them, and say so when you are unsure.';
const oneLine = value => String(value).replace(/\s+/g, ' ').trim().slice(0, 500);
const isFile = path => existsSync(path) && statSync(path).isFile();

export const MAX_IMAGES = 12;
export const LOG_KEEP = 30;
const mediaTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export function mediaType(path) {
  const type = mediaTypes[extname(path).toLowerCase()];
  if (!type) throw new Error(`unsupported image type ${extname(path) || '(none)'}: ${path}`);
  return type;
}

// The name each image is sent as: its base name when unique, else prefixed with its folder.
export function sendNames(paths) {
  const counts = new Map();
  for (const path of paths) {
    const key = basename(path).toLowerCase();
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const names = paths.map(path => counts.get(basename(path).toLowerCase()) > 1
    ? `${basename(dirname(resolve(path)))}_${basename(path)}`
    : basename(path));
  // Windows file names are case-insensitive, so names differing in case would overwrite each other in the temp folder.
  const seen = new Map();
  names.forEach((name, index) => {
    const key = name.toLowerCase();
    if (seen.has(key)) throw new Error(`images ${paths[seen.get(key)]} and ${paths[index]} still share the name ${name} after adding the folder name`);
    seen.set(key, index);
  });
  return names;
}

export function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function identicalLines(items) {
  const groups = new Map();
  for (const { name, hash } of items) groups.set(hash, [...(groups.get(hash) || []), name]);
  return [...groups.values()].filter(names => names.length > 1).map(names => `identical images: ${names.join(' = ')}`);
}

const aimsHeading = /^##\s+aims\s*$/i;
const aimLine = /^\s*-\s*([A-Za-z0-9_-]+)\s*:\s*(\S.*?)\s*$/;

// Aims are the `- <id>: <aim>` lines under `## Aims`; the rest of the text describes the pictures.
export function parseQuestion(text) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(line => aimsHeading.test(line));
  if (start < 0) return { description: text.trim(), aims: [] };
  let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  if (end < 0) end = lines.length;
  const aims = [];
  for (const line of lines.slice(start + 1, end)) {
    const match = aimLine.exec(line);
    if (!match) continue;
    if (aims.some(aim => aim.id === match[1])) throw new Error(`duplicate aim id ${match[1]}`);
    aims.push({ id: match[1], text: match[2] });
  }
  if (!aims.length) throw new Error('the ## Aims section has no "- <id>: <aim>" line');
  return { description: [...lines.slice(0, start), ...lines.slice(end)].join('\n').trim(), aims };
}

// Pairs the image files of two folders by name, ignoring case. Returns [{name, a, b}] sorted by name.
export function pairFolders(dirA, dirB) {
  const list = dir => {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`--compare needs two existing folders: ${dir}`);
    const files = new Map();
    for (const name of readdirSync(dir)) {
      if (mediaTypes[extname(name).toLowerCase()] && isFile(join(dir, name))) files.set(name.toLowerCase(), name);
    }
    return files;
  };
  const filesA = list(dirA);
  const filesB = list(dirB);
  for (const [key, name] of filesA) if (!filesB.has(key)) throw new Error(`${name} is only in ${dirA}`);
  for (const [key, name] of filesB) if (!filesA.has(key)) throw new Error(`${name} is only in ${dirB}`);
  if (!filesA.size) throw new Error('the folders hold no image files');
  // Each pair sends two images and the crops come on top, so six pairs fill the limit before any crop.
  if (filesA.size * 2 > MAX_IMAGES) throw new Error(`at most ${MAX_IMAGES / 2} pairs per call (got ${filesA.size}); split the call`);
  return [...filesA].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(([key, name]) => ({ name, a: join(dirA, name), b: join(dirB, filesB.get(key)) }));
}

export function parseArgs(argv) {
  let compare = null;
  let threshold = 0.5;
  let question = null;
  let questionFile = null;
  let timeout = 300;
  let input = 'inline';
  let runsModel = 'opus';
  let freshModel = 'sonnet';
  let tiebreak = 'opus';
  const images = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--compare') {
      if (argv[i + 1] === undefined || argv[i + 2] === undefined) throw new Error('--compare needs two folders');
      compare = { dirA: argv[i + 1], dirB: argv[i + 2] };
      i += 2;
    } else if (arg === '--question' || arg === '--question-file' || arg === '--timeout' || arg === '--input' || arg === '--runs-model' || arg === '--fresh-model' || arg === '--tiebreak' || arg === '--threshold') {
      if (argv[i + 1] === undefined) throw new Error(`${arg} needs a value`);
      const value = argv[++i];
      if (arg === '--timeout') timeout = value;
      else if (arg === '--input') input = value;
      else if (arg === '--runs-model') runsModel = value;
      else if (arg === '--fresh-model') freshModel = value;
      else if (arg === '--tiebreak') tiebreak = value;
      else if (arg === '--threshold') threshold = value;
      else if (question !== null || questionFile !== null) throw new Error('give exactly one of --question and --question-file, once');
      else if (arg === '--question') question = value;
      else questionFile = value;
    } else if (arg.startsWith('--')) throw new Error(`unknown option ${arg}`);
    else images.push(arg);
  }
  if (question === null && questionFile === null) throw new Error('missing --question or --question-file');
  if (questionFile !== null) {
    if (!isFile(questionFile)) throw new Error(`--question-file is not an existing file: ${questionFile}`);
    question = readFileSync(questionFile, 'utf8');
  }
  if (!question.trim()) throw new Error('the question is empty');
  // Number('') is 0 and Number(' ') is 0, so an empty value fails the positive check too.
  timeout = Number(timeout);
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2147483) throw new Error('--timeout must be positive and at most 2147483 seconds');
  if (input !== 'inline' && input !== 'read') throw new Error('--input must be inline or read');
  if (compare) {
    if (images.length) throw new Error('--compare takes two folders and no image arguments');
    const { description, aims } = parseQuestion(question);
    if (!aims.length) throw new Error('--compare needs an ## Aims section in the question');
    threshold = Number(threshold);
    if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new Error('--threshold must be a percent from 0 to 100');
    const pairs = pairFolders(compare.dirA, compare.dirB);
    return { question, description, aims, timeout, images: [], input, runsModel, freshModel, tiebreak, compare, threshold, pairs };
  }
  if (!images.length) throw new Error('give at least one image');
  if (images.length > MAX_IMAGES) throw new Error(`at most ${MAX_IMAGES} images per call (got ${images.length}); split the call`);
  for (const image of images) {
    if (!isFile(image)) throw new Error(`image is not an existing file: ${image}`);
    if (input === 'inline') mediaType(image);
  }
  sendNames(images);
  const { description, aims } = parseQuestion(question);
  return { question, description, aims, timeout, images, input, runsModel, freshModel, tiebreak };
}

export function buildPrompt(question, baseNames) {
  return `Read each of these pictures with the Read tool, which shows you the image. They are in the current folder: ${baseNames.join(', ')}. Read no other file and run no command.\n\n${question}`;
}

// Images come before the question, each labelled, so the model ties every picture to the name the report uses.
export function buildInlineMessage(question, images) {
  const content = [];
  images.forEach(({ name, path, data }, index) => {
    content.push({ type: 'text', text: `Image ${index + 1}: ${name}` });
    content.push({ type: 'image', source: { type: 'base64', media_type: mediaType(path), data } });
  });
  content.push({ type: 'text', text: question });
  return { type: 'user', message: { role: 'user', content } };
}

// Pulls the tool calls and the final result out of `--output-format stream-json` lines.
export function parseStream(out) {
  const events = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { /* A stray non-JSON line is ignored. */ }
  }
  const toolCalls = [];
  for (const event of events) {
    if (event?.type !== 'assistant' || !Array.isArray(event.message?.content)) continue;
    for (const block of event.message.content) if (block?.type === 'tool_use') toolCalls.push(block.name);
  }
  const result = events.findLast(event => event?.type === 'result') || null;
  return { parsed: events.length > 0, result, toolCalls };
}

function stopTree(child) {
  // An exited child's id may already belong to another process, which taskkill would stop.
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 20_000 });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { /* Already exited. */ }
}

// images: [{path, name}]. Returns {text, usage, costUsd, ms, toolCalls, error}; error is a reason string or null.
export async function runClaude({ model = 'sonnet', input = 'inline', images, question, timeout, command = 'claude', commandArgs = [], env = process.env }) {
  const failed = error => ({ text: '', usage: {}, costUsd: 0, ms: 0, toolCalls: [], error });
  let dir;
  let child;
  let timer;
  try {
    dir = mkdtempSync(join(tmpdir(), 'look-'));
    const args = ['-p', '--model', model, '--system-prompt', system];
    let stdin;
    // Without images there is nothing to read, so the text goes in as a plain message.
    if (input === 'read' && images.length) {
      for (const { path, name } of images) copyFileSync(path, join(dir, name));
      args.push('--tools', 'Read', '--allowedTools', 'Read');
      stdin = buildPrompt(question, images.map(image => image.name));
    } else {
      args.push('--tools', '', '--input-format', 'stream-json');
      const loaded = images.map(({ path, name }) => ({ path, name, data: readFileSync(path).toString('base64') }));
      stdin = JSON.stringify(buildInlineMessage(question, loaded)) + '\n';
    }
    args.push('--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence', '--setting-sources', 'local', '--output-format', 'stream-json', '--verbose');
    // Each run is one request that nothing reuses, so a cache write only doubles the input price.
    child = spawn(command, [...commandArgs, ...args], {
      cwd: dir, env: { ...env, CLAUDE_CODE_RETRY_WATCHDOG: '0', DISABLE_PROMPT_CACHING: '1' },
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
    child.stdin.end(stdin);
    const code = await new Promise(done => {
      let settled = false;
      const complete = value => { if (!settled) { settled = true; done(value); } };
      child.on('error', error => { spawnError = error; complete(null); });
      child.on('close', complete);
      timer = setTimeout(() => { timedOut = true; stopTree(child); complete(null); }, timeout * 1000);
    });
    clearTimeout(timer);
    if (spawnError) return failed(`cannot start claude: ${spawnError.message}`);
    if (timedOut) return failed(`timed out after ${timeout} s`);
    const { parsed, result, toolCalls } = parseStream(out);
    const text = result && typeof result.result === 'string' ? result.result.trim() : '';
    if (code !== 0) return failed(text || errTail.trim() || `claude exited with code ${code}`);
    if (!parsed || !result) return failed('claude printed output that is not JSON');
    if (result.is_error === true) return failed(text || 'claude reported an error');
    if (!text) return failed('claude returned an empty answer');
    return { text: result.result, usage: result.usage || {}, costUsd: Number(result.total_cost_usd || 0), ms: result.duration_ms ?? 0, toolCalls, error: null };
  } catch (error) {
    return failed(error.message || String(error));
  } finally {
    clearTimeout(timer);
    stopTree(child);
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

const OLLAMA_URL = 'http://localhost:11434';
const OLLAMA_PREFIX = 'ollama:';
export const isLocalModel = model => String(model).startsWith(OLLAMA_PREFIX);

// images: [{name, data}] with base64 data. Local runs always send images inline, so there is no read-tool variant.
export function ollamaRequest({ model, system: systemText = system, question, images = [] }) {
  const label = images.length ? `Images, in order: ${images.map(({ name }, index) => `Image ${index + 1}: ${name}`).join(', ')}\n\n` : '';
  const user = { role: 'user', content: label + question };
  if (images.length) user.images = images.map(({ data }) => data);
  // Ollama's default 4096-token context is too small for even one screenshot with the prompt.
  return { model: model.startsWith(OLLAMA_PREFIX) ? model.slice(OLLAMA_PREFIX.length) : model, stream: false, keep_alive: 0, options: { num_ctx: 16384 }, messages: [{ role: 'system', content: systemText }, user] };
}

// Reasoning models print their thinking first; only the answer after it is the report.
export function stripThink(text) {
  return text.replace(/^\s*<think>[\s\S]*?<\/think>\s*/, '');
}

// Runs tasks one at a time in the order given; a failed task does not block the next.
export function createQueue() {
  let tail = Promise.resolve();
  return task => {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  };
}

// The GPU holds one model at a time, so every local run in the process goes through this queue.
const localQueue = createQueue();
let startedServer = null;

function ollamaExe() {
  const found = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ollama'], { windowsHide: true, stdio: 'ignore' });
  if (found.status === 0) return 'ollama';
  const installed = join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe');
  return existsSync(installed) ? installed : 'ollama';
}

async function serverAnswers(timeoutMs) {
  try {
    return (await fetch(`${OLLAMA_URL}/api/version`, { signal: AbortSignal.timeout(timeoutMs) })).ok;
  } catch { return false; }
}

// Uses a running server as it is; otherwise starts one that stopOllama() stops at the end of the call.
async function ensureOllama() {
  if (startedServer || await serverAnswers(1000)) return;
  const child = spawn(ollamaExe(), ['serve'], { windowsHide: true, detached: process.platform !== 'win32', stdio: 'ignore' });
  let spawnError;
  child.on('error', error => { spawnError = error; });
  startedServer = child;
  for (let waited = 0; waited < 30_000; waited += 250) {
    if (spawnError) throw new Error(`cannot start ollama: ${spawnError.message}`);
    if (await serverAnswers(1000)) return;
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error('ollama serve did not answer within 30 s');
}

export function stopOllama() {
  stopTree(startedServer);
  startedServer = null;
}

// Same inputs and return shape as runClaude, plus started and ended ISO times; images: [{path, name}].
export function runOllama({ model, images = [], question, timeout }) {
  const iso = ms => new Date(ms).toISOString();
  const failed = (error, started) => ({ text: '', usage: {}, costUsd: 0, ms: Date.now() - started, toolCalls: [], error, started: iso(started), ended: iso(Date.now()) });
  return localQueue(async () => {
    const started = Date.now();
    try {
      await ensureOllama();
      const loaded = images.map(({ path, name }) => ({ name, data: readFileSync(path).toString('base64') }));
      const response = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ollamaRequest({ model, question, images: loaded })),
        signal: AbortSignal.timeout(timeout * 1000)
      });
      const body = await response.text();
      if (!response.ok) return failed(`ollama HTTP ${response.status}: ${oneLine(body)}`, started);
      let data;
      try { data = JSON.parse(body); } catch { return failed('ollama printed output that is not JSON', started); }
      const text = typeof data?.message?.content === 'string' ? stripThink(data.message.content).trim() : '';
      if (!text) return failed(data?.error ? oneLine(data.error) : 'ollama returned an empty answer', started);
      const ended = Date.now();
      return { text, usage: { input_tokens: data.prompt_eval_count || 0, output_tokens: data.eval_count || 0 }, costUsd: 0, ms: ended - started, toolCalls: [], error: null, started: iso(started), ended: iso(ended) };
    } catch (error) {
      return failed(error?.name === 'TimeoutError' ? `timed out after ${timeout} s` : (error.message || String(error)), started);
    }
  });
}

// The one entry point for a run: local models go to Ollama, anything else to claude. Both report started and ended times.
export async function runModel(args) {
  if (isLocalModel(args.model)) return runOllama(args);
  const started = new Date().toISOString();
  const result = await runClaude(args);
  return { ...result, started, ended: new Date().toISOString() };
}

export function costLine({ ms, usage, costUsd }) {
  const tokensIn = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  return `look: ${ms} ms, ${tokensIn} in, ${usage.output_tokens || 0} out, $${costUsd.toFixed(4)}`;
}

// A fence one backtick longer than any run inside, so the report or question cannot close it early.
function fence(text) {
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map(run => run.length));
  const mark = '`'.repeat(longest + 1);
  return `${mark}\n${text}\n${mark}`;
}

export function toolCallSummary(toolCalls) {
  if (!toolCalls.length) return 'none';
  const counts = new Map();
  for (const name of toolCalls) counts.set(name, (counts.get(name) || 0) + 1);
  return [...counts].map(([name, count]) => `${name} x${count}`).join(', ');
}

// runs: [{role, model, prompt, imageNames, toolCalls, text, cost}], in the order they are listed in the log.
export function buildLogEntry({ time, input, images, runs, cost, gate = [] }) {
  return [
    `## ${time}`,
    '',
    `- Input: ${input}`,
    ...images.map(({ name, path }) => `- Image: ${name} ← ${path}`),
    ...gate.map(line => `- Gate: ${line}`),
    `- Cost, all runs: ${cost}`,
    '',
    ...runs.flatMap(run => [
      `### Run: ${run.role} (${run.model})`,
      '',
      ...(run.key ? [`- key: ${run.key}`] : []),
      `- Images sent: ${run.imageNames.length ? run.imageNames.join(', ') : 'none'}`,
      `- Tool calls: ${toolCallSummary(run.toolCalls)}`,
      ...(run.started ? [`- time: ${run.started} → ${run.ended}`] : []),
      '',
      'Prompt:',
      fence(run.prompt),
      '',
      'Report:',
      fence(run.text),
      '',
      `Cost: ${run.cost}`,
      ''
    ])
  ].join('\n');
}

const entryStart = /^## \d{4}-\d\d-\d\dT/m;
// Keeps the header and the newest `max` entries; a report's own "## " headings do not start an entry.
export function trimLog(text, max) {
  const first = text.search(entryStart);
  if (first < 0) return text;
  const header = text.slice(0, first);
  const entries = [];
  let rest = text.slice(first);
  while (rest) {
    const next = rest.slice(1).search(entryStart);
    if (next < 0) { entries.push(rest); break; }
    entries.push(rest.slice(0, next + 1));
    rest = rest.slice(next + 1);
  }
  return header + entries.slice(-max).join('');
}

export function appendLog(logPath, entry, max = LOG_KEEP) {
  const old = existsSync(logPath) ? readFileSync(logPath, 'utf8') : '# look log\n\n';
  writeFileSync(logPath, trimLog(old.replace(/\n*$/, '\n\n') + entry, max));
}

export const RATINGS = ['not seen', 'faint', 'clear', 'strong'];
const MET = ['clear', 'strong'];

export function ratedPrompt(description, aims) {
  return [
    description,
    '',
    'Aims:',
    ...aims.map(({ id, text }) => `- ${id}: ${text}`),
    '',
    'Answer in this order.',
    'First, one line per image: `<image name>: subject in frame: yes|partly|no, about <n>% of the frame`.',
    'Then short notes on what you see that bears on the aims, at most 8 bullets.',
    `Then end with exactly this block, one line per aim id, each rating one of ${RATINGS.map(rating => `\`${rating}\``).join(', ')}:`,
    'VERDICTS',
    ...aims.map(({ id }) => `${id}: <rating>`),
    'END',
    '',
    "A rating says how strongly the picture shows the aim's wanted state. Rate what you see, not what the description expects. When several pictures show the aim's subject, rate by the weakest of them."
  ].join('\n');
}

export function freshPrompt(description) {
  return `${description}\n\nSay in one line per image what it shows. Then list everything that looks wrong, broken or unnatural, at most 8 bullets.`;
}

const unmark = line => line.replace(/[*`]/g, '').trim();

// Index range [start, end] of the last VERDICTS..END block, or null.
function findBlock(lines) {
  const start = lines.findLastIndex(line => /^[#>\s-]*verdicts\s*:?$/i.test(unmark(line)));
  if (start < 0) return null;
  const end = lines.findIndex((line, index) => index > start && /^[#>\s-]*end$/i.test(unmark(line)));
  return end < 0 ? null : [start, end];
}

export function stripVerdicts(text) {
  const lines = text.split(/\r?\n/);
  const block = findBlock(lines);
  return (block ? [...lines.slice(0, block[0]), ...lines.slice(block[1] + 1)] : lines).join('\n').trim();
}

export function parseVerdicts(text, ids) {
  const lines = text.split(/\r?\n/);
  const block = findBlock(lines);
  if (!block) return null;
  const ratings = {};
  for (const line of lines.slice(block[0] + 1, block[1])) {
    const clean = unmark(line).replace(/^-\s*/, '');
    if (!clean) continue;
    const match = /^([A-Za-z0-9_-]+)\s*:\s*(.+?)\s*\.?$/.exec(clean);
    if (!match) return null;
    const rating = match[2].trim().toLowerCase();
    if (!RATINGS.includes(rating)) return null;
    if (!ids.includes(match[1])) continue;
    if (match[1] in ratings) return null;
    ratings[match[1]] = rating;
  }
  return ids.every(id => id in ratings) ? { ratings } : null;
}

// runs: [{model, role: 'rated'|'tiebreak', ratings|null}]. Returns one verdict line per id.
export function aggregate(ids, runs) {
  const parsed = runs.filter(entry => entry.ratings);
  const tiebreak = parsed.find(entry => entry.role === 'tiebreak');
  const rated = runs.filter(entry => entry.role === 'rated');
  return ids.map(id => {
    const ratings = parsed.map(entry => entry.ratings[id]);
    const counts = new Map();
    for (const rating of ratings) counts.set(rating, (counts.get(rating) || 0) + 1);
    const [best, count] = [...counts].sort((x, y) => y[1] - x[1])[0] || [null, 0];
    const differed = rated.some(entry => !entry.ratings) || new Set(rated.map(entry => entry.ratings[id])).size > 1;
    const suffix = tiebreak && differed ? ` (tie-break ${tiebreak.model})` : '';
    if (count < 2) return `${id}: split — ${ratings.join('/') || 'no rating'} (${count}/${parsed.length})${suffix}`;
    return `${id}: ${MET.includes(best) ? 'met' : 'not met'} — ${best} (${count}/${parsed.length})${suffix}`;
  });
}

const SETS_SENTENCE = 'There are two sets of pictures of the same views, set X and set Y (file names start with X_ or Y_).';

export function comparePrompt(description, aims) {
  return [
    description,
    '',
    SETS_SENTENCE,
    '',
    'Aims:',
    ...aims.map(({ id, text }) => `- ${id}: ${text}`),
    '',
    'Answer in this order.',
    'First, one line per view: `<view name>: subject in frame: yes|partly|no, about <n>% of the frame`.',
    'Then short notes on what you see that bears on the aims, at most 8 bullets.',
    `Then end with exactly this block, one line per aim id, each rating one of ${RATINGS.map(rating => `\`${rating}\``).join(', ')}:`,
    'VERDICTS',
    ...aims.map(({ id }) => `${id}: X <rating>; Y <rating>; better X|same|Y`),
    'END',
    '',
    "A rating says how strongly that set shows the aim's wanted state. `better` says which set shows the wanted state more: X, Y, or same when neither does. Rate what you see, not what the description expects. When several views show the aim's subject, rate each set by its weakest view."
  ].join('\n');
}

export function compareFreshPrompt(description) {
  return `${freshPrompt(description)}\n\n${SETS_SENTENCE}`;
}

const compareLine = /^([A-Za-z0-9_-]+)\s*:\s*X\s+([a-z ]+?)\s*;\s*Y\s+([a-z ]+?)\s*;\s*better\s+(X|Y|same)\s*\.?$/i;

// Returns {ratings: {id: {x, y, better: 'X'|'same'|'Y'}}} or null.
export function parseCompareVerdicts(text, ids) {
  const lines = text.split(/\r?\n/);
  const block = findBlock(lines);
  if (!block) return null;
  const ratings = {};
  for (const line of lines.slice(block[0] + 1, block[1])) {
    const clean = unmark(line).replace(/^-\s*/, '');
    if (!clean) continue;
    const match = compareLine.exec(clean);
    if (!match) return null;
    const x = match[2].trim().toLowerCase();
    const y = match[3].trim().toLowerCase();
    if (!RATINGS.includes(x) || !RATINGS.includes(y)) return null;
    if (!ids.includes(match[1])) continue;
    if (match[1] in ratings) return null;
    const better = match[4].toLowerCase();
    ratings[match[1]] = { x, y, better: better === 'same' ? 'same' : better.toUpperCase() };
  }
  return ids.every(id => id in ratings) ? { ratings } : null;
}

// Turns a run's X/Y answers into before/after answers through its key.
export function mapVerdicts(ratings, xIsAfter) {
  const mapped = {};
  for (const [id, { x, y, better }] of Object.entries(ratings)) {
    mapped[id] = {
      after: xIsAfter ? x : y,
      before: xIsAfter ? y : x,
      better: better === 'same' ? 'same' : (better === 'X') === xIsAfter ? 'after' : 'before'
    };
  }
  return mapped;
}

const betterText = { after: 'after better', same: 'same', before: 'before better' };

// runs: [{model, role: 'rated'|'tiebreak', mapped: {id: {after, before, better}}|null}].
export function aggregateCompare(ids, runs) {
  const parsed = runs.filter(entry => entry.mapped);
  const tiebreak = parsed.find(entry => entry.role === 'tiebreak');
  const rated = runs.filter(entry => entry.role === 'rated');
  const key = answer => `${answer.after}|${answer.better}`;
  return ids.map(id => {
    const answers = parsed.map(entry => entry.mapped[id]);
    const groups = new Map();
    for (const answer of answers) groups.set(key(answer), [...(groups.get(key(answer)) || []), answer]);
    const agreeing = [...groups.values()].sort((x, y) => y.length - x.length)[0] || [];
    const differed = rated.some(entry => !entry.mapped) || new Set(rated.map(entry => key(entry.mapped[id]))).size > 1;
    const suffix = tiebreak && differed ? ` (tie-break ${tiebreak.model})` : '';
    if (agreeing.length < 2) {
      const shown = answers.map(answer => `after ${answer.after}/${answer.better}`).join(' | ') || 'no rating';
      return `${id}: split — ${shown} (${agreeing.length}/${parsed.length})${suffix}`;
    }
    const { after, better } = agreeing[0];
    const befores = new Map();
    for (const answer of agreeing) befores.set(answer.before, (befores.get(answer.before) || 0) + 1);
    const before = [...befores].sort((x, y) => y[1] - x[1])[0][0];
    const met = better === 'after' && MET.includes(after);
    return `${id}: ${met ? 'met' : 'not met'} — after ${after}, before ${before}, ${betterText[better]} (${agreeing.length}/${parsed.length})${suffix}`;
  });
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const rawChannels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

// Reads 8-bit, non-interlaced PNGs into RGB or RGBA bytes; throws `unsupported PNG` for anything else.
export function decodePng(buffer) {
  const fail = reason => { throw new Error(`unsupported PNG: ${reason}`); };
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) fail('bad signature');
  let header = null;
  let palette = null;
  let alphas = null;
  const parts = [];
  for (let at = 8; at + 8 <= buffer.length;) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    if (at + 12 + length > buffer.length) fail('truncated chunk');
    const body = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], colour: body[9], interlace: body[12] };
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') alphas = body;
    else if (type === 'IDAT') parts.push(body);
    else if (type === 'IEND') break;
    at += 12 + length;
  }
  if (!header) fail('no IHDR');
  const { width, height, depth, colour, interlace } = header;
  if (depth !== 8) fail(`bit depth ${depth}`);
  if (!(colour in rawChannels)) fail(`colour type ${colour}`);
  if (interlace !== 0) fail('interlaced');
  if (colour === 3 && !palette) fail('no PLTE');
  if (!width || !height) fail('empty image');
  let inflated;
  try { inflated = inflateSync(Buffer.concat(parts)); } catch { fail('bad compressed data'); }
  const bpp = rawChannels[colour];
  const stride = width * bpp;
  if (inflated.length < height * (stride + 1)) fail('truncated pixel data');
  const raw = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = inflated[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const left = i >= bpp ? raw[row + i - bpp] : 0;
      const up = y ? raw[row - stride + i] : 0;
      const upLeft = y && i >= bpp ? raw[row - stride + i - bpp] : 0;
      let predictor;
      if (filter === 0) predictor = 0;
      else if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else fail(`filter ${filter}`);
      raw[row + i] = (inflated[src + i] + predictor) & 255;
    }
  }
  if (colour === 2 || colour === 6) return { width, height, channels: bpp, data: raw };
  const hasAlpha = colour === 4 || (colour === 3 && alphas !== null);
  const channels = hasAlpha ? 4 : 3;
  const data = new Uint8Array(width * height * channels);
  for (let p = 0; p < width * height; p++) {
    let r;
    let g;
    let b;
    let a = 255;
    if (colour === 3) {
      const index = raw[p];
      if (index * 3 + 2 >= palette.length) fail('palette index out of range');
      [r, g, b] = [palette[index * 3], palette[index * 3 + 1], palette[index * 3 + 2]];
      if (alphas && index < alphas.length) a = alphas[index];
    } else {
      r = g = b = raw[p * bpp];
      if (colour === 4) a = raw[p * bpp + 1];
    }
    data[p * channels] = r;
    data[p * channels + 1] = g;
    data[p * channels + 2] = b;
    if (hasAlpha) data[p * channels + 3] = a;
  }
  return { width, height, channels, data };
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(body).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

// Writes 8-bit RGB (channels 3) or RGBA (channels 4) with filter 0 on every row.
export function encodePng({ width, height, channels, data }) {
  if (channels !== 3 && channels !== 4) throw new Error('encodePng needs 3 or 4 channels');
  const stride = width * channels;
  const rows = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(rows, y * (stride + 1) + 1);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = channels === 3 ? 2 : 6;
  return Buffer.concat([PNG_SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// A pixel is changed when any RGB channel differs by more than `tolerance`; share is changed pixels over all pixels.
export function diffImages(a, b, tolerance = 16) {
  if (a.width !== b.width || a.height !== b.height) return { share: 1, box: null, note: 'sizes differ' };
  let changed = 0;
  let x0 = a.width;
  let y0 = a.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const i = (y * a.width + x) * a.channels;
      const j = (y * b.width + x) * b.channels;
      if (Math.abs(a.data[i] - b.data[j]) > tolerance || Math.abs(a.data[i + 1] - b.data[j + 1]) > tolerance || Math.abs(a.data[i + 2] - b.data[j + 2]) > tolerance) {
        changed++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return { share: changed / (a.width * a.height), box: changed ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } : null };
}

// The box grown by `pad` on every side and clamped to the frame.
export function padBox(box, pad, width, height) {
  const x = Math.max(0, box.x - pad);
  const y = Math.max(0, box.y - pad);
  return { x, y, w: Math.min(width, box.x + box.w + pad) - x, h: Math.min(height, box.y + box.h + pad) - y };
}

export function cropImage(image, box) {
  const { channels } = image;
  const data = new Uint8Array(box.w * box.h * channels);
  for (let y = 0; y < box.h; y++) {
    const from = ((box.y + y) * image.width + box.x) * channels;
    data.set(image.data.subarray(from, from + box.w * channels), y * box.w * channels);
  }
  return { width: box.w, height: box.h, channels, data };
}

const percent = share => `${(share * 100).toFixed(2)}%`;

// pairs: [{name, share|null, box, note, reason}]; a null share means the pair was not measured, for `reason`.
// Returns {stop, lines}: stop is true when the change did not reach the pictures, so no model runs.
export function gateDecision(pairs, thresholdPct) {
  const measured = pairs.filter(pair => pair.share !== null && pair.share !== undefined);
  const unmeasured = pairs.filter(pair => !measured.includes(pair));
  const stop = measured.length > 0 && unmeasured.length === 0 && measured.every(pair => pair.share * 100 < thresholdPct);
  if (stop) return { stop, lines: ['change not in capture', ...measured.map(pair => `${pair.name}: ${percent(pair.share)} changed`)] };
  return {
    stop,
    lines: [
      ...unmeasured.map(pair => `change share not measured (${pair.name}: ${pair.reason})`),
      ...measured.map(pair => pair.box
        ? `change: ${pair.name} ${percent(pair.share)} in box ${pair.box.x},${pair.box.y} ${pair.box.w}x${pair.box.h}`
        : `change: ${pair.name} ${percent(pair.share)} (${pair.note || 'no changed pixels'})`)
    ]
  };
}

function measurePair({ name, a, b }) {
  const extensions = [extname(a).toLowerCase(), extname(b).toLowerCase()];
  if (extensions.some(extension => extension !== '.png')) return { name, share: null, reason: extensions.some(extension => extension === '.jpg' || extension === '.jpeg') ? 'JPEG' : 'not a PNG' };
  try {
    const left = decodePng(readFileSync(a));
    const right = decodePng(readFileSync(b));
    return { name, ...diffImages(left, right), frame: { width: left.width, height: left.height }, images: [left, right] };
  } catch (error) {
    return { name, share: null, reason: oneLine(error.message || error) };
  }
}

// Cuts at a line end where one fits, so a bullet is not left half-written; the result is at most max long.
function cutText(text, max) {
  if (text.length <= max) return text;
  if (max < 1) return '';
  const head = text.slice(0, max - 1);
  const lineEnd = head.lastIndexOf('\n');
  return (lineEnd > 0 ? head.slice(0, lineEnd) : head).trimEnd() + '…';
}

// The verdict lines are never cut: Fresh eye shrinks first, then Seen by both.
export function formatOutput({ verdictLines, seenByBoth, freshEye }, limit = 2500) {
  const build = (seen, fresh) => `Verdicts\n${verdictLines.join('\n')}\n\nSeen by both\n${seen}\n\nFresh eye\n${fresh}`;
  let seen = seenByBoth;
  let fresh = freshEye;
  let over = build(seen, fresh).length - limit;
  if (over > 0) {
    fresh = cutText(fresh, fresh.length - over);
    over = build(seen, fresh).length - limit;
  }
  if (over > 0) seen = cutText(seen, seen.length - over);
  return build(seen, fresh);
}

export function mergePrompt(reportOne, reportTwo) {
  return [
    'Two reviewers looked at the same pictures. Their reports follow.',
    '',
    'Report 1:',
    reportOne,
    '',
    'Report 2:',
    reportTwo,
    '',
    'Give only the observations both reports make, merged into at most 6 short bullets, with no preamble. If there are none, answer with the single line `nothing in common`.'
  ].join('\n');
}

function sumUsage(results) {
  const total = {};
  for (const { usage } of results) for (const [key, value] of Object.entries(usage || {})) if (typeof value === 'number') total[key] = (total[key] || 0) + value;
  return total;
}

// Fills `records` with every run made, in log order. Returns {output} or {unavailable}.
// With `compare` ({sides: {before, after}}), every run draws its own X/Y assignment and the answers are mapped back to before/after.
async function lookWithAims(options, images, dependencies, records, compare = null) {
  const { description, aims } = options;
  const random = dependencies.random || Math.random;
  const draw = () => ({ X: random() < 0.5 ? 'after' : 'before' });
  const otherSide = key => (key.X === 'after' ? 'before' : 'after');
  const imagesFor = key => [
    ...compare.sides[key.X].map(({ path, name }) => ({ path, name: `X_${name}` })),
    ...compare.sides[otherSide(key)].map(({ path, name }) => ({ path, name: `Y_${name}` }))
  ];
  const keyLine = key => `X = ${key.X}, Y = ${otherSide(key)}`;
  const ids = aims.map(aim => aim.id);
  const base = { input: options.input, timeout: options.timeout, command: dependencies.command, commandArgs: dependencies.commandArgs, env: dependencies.env };
  const execute = async (role, model, prompt, sendImages, key = null) => {
    const result = await runModel({ ...base, model, images: sendImages, question: prompt });
    return { role, model, prompt, key: key ? keyLine(key) : null, started: result.started, ended: result.ended, imageNames: sendImages.map(image => image.name), toolCalls: result.toolCalls, text: result.error ? `(failed: ${result.error})` : result.text, cost: costLine(result), result };
  };
  // A run whose VERDICTS block cannot be parsed is repeated once, then counts as missing.
  const rated = async (role, model) => {
    const mine = [];
    const key = compare ? draw() : null;
    const sendImages = compare ? imagesFor(key) : images;
    const prompt = compare ? comparePrompt(description, aims) : ratedPrompt(description, aims);
    const parse = answer => {
      if (!compare) return parseVerdicts(answer, ids);
      const verdicts = parseCompareVerdicts(answer, ids);
      return verdicts && { ratings: mapVerdicts(verdicts.ratings, key.X === 'after') };
    };
    let parsed = null;
    let text = null;
    let error = null;
    for (const label of [role, 'retry']) {
      const record = await execute(label, model, prompt, sendImages, key);
      mine.push(record);
      if (record.result.error) { error = record.result.error; text = null; break; }
      text = record.result.text;
      parsed = parse(text);
      if (parsed) break;
    }
    return { mine, model, ratings: parsed ? parsed.ratings : null, text, error };
  };
  const fresh = async () => {
    const key = compare ? draw() : null;
    const record = await execute('fresh', options.freshModel, compare ? compareFreshPrompt(description) : freshPrompt(description), compare ? imagesFor(key) : images, key);
    return { record, text: record.result.error ? `(fresh-eye run failed: ${oneLine(record.result.error)})` : record.result.text.trim() };
  };
  const [first, second, freshRun] = await Promise.all([rated('rated 1', options.runsModel), rated('rated 2', options.runsModel), fresh()]);
  records.push(...first.mine, ...second.mine, freshRun.record);
  if (first.error && second.error) return { unavailable: first.error };
  const asRun = (role, { model, ratings }) => (compare ? { model, role, mapped: ratings } : { model, role, ratings });
  const same = (x, y) => (compare ? x.after === y.after && x.better === y.better : x === y);
  const runs = [first, second].map(entry => asRun('rated', entry));
  const agree = first.ratings && second.ratings && ids.every(id => same(first.ratings[id], second.ratings[id]));
  // The merge needs only the two rated reports, so it runs alongside the tie-break.
  const merge = async () => {
    if (!first.text || !second.text) return { seen: '(merge failed: a rated run gave no report)' };
    const record = await execute('merge', 'haiku', mergePrompt(stripVerdicts(first.text), stripVerdicts(second.text)), []);
    return { record, seen: record.result.error ? `(merge failed: ${oneLine(record.result.error)})` : record.result.text.trim() };
  };
  const [third, merged] = await Promise.all([agree ? null : rated('tie-break', options.tiebreak), merge()]);
  if (third) {
    records.push(...third.mine);
    runs.push(asRun('tiebreak', third));
  }
  if (merged.record) records.push(merged.record);
  return { output: formatOutput({ verdictLines: (compare ? aggregateCompare : aggregate)(ids, runs), seenByBoth: merged.seen, freshEye: freshRun.text }) };
}

async function runCompare(options, dependencies, stdout, stderr) {
  const { pairs, threshold, compare } = options;
  const logPath = join(resolve(compare.dirB), 'look-log.md');
  const logImages = pairs.flatMap(({ name, a, b }) => [{ name: `${name} (before)`, path: resolve(a) }, { name: `${name} (after)`, path: resolve(b) }]);
  let cropDir;
  try {
    const started = Date.now();
    const measured = pairs.map(measurePair);
    const gate = gateDecision(measured, threshold);
    const log = (runs, cost, lines) => {
      try {
        appendLog(logPath, buildLogEntry({ time: new Date().toISOString(), input: options.input, images: logImages, runs, cost, gate: lines }));
      } catch (error) {
        stderr.write(`look: log not written: ${oneLine(error.message || error)}\n`);
      }
    };
    if (gate.stop) {
      stdout.write(gate.lines.join('\n') + '\n');
      log([], 'none (no model run)', gate.lines);
      return 3;
    }
    const sides = { before: pairs.map(({ name, a }) => ({ name, path: a })), after: pairs.map(({ name, b }) => ({ name, path: b })) };
    const lines = [...gate.lines];
    let count = pairs.length * 2;
    let skipped = false;
    for (const pair of measured) {
      if (!pair.box || pair.box.w * pair.box.h * 4 >= pair.frame.width * pair.frame.height) continue;
      if (count + 2 > MAX_IMAGES) { skipped = true; continue; }
      cropDir ||= mkdtempSync(join(tmpdir(), 'look-crop-'));
      const box = padBox(pair.box, 16, pair.frame.width, pair.frame.height);
      const stem = basename(pair.name, extname(pair.name));
      ['before', 'after'].forEach((side, index) => {
        mkdirSync(join(cropDir, side), { recursive: true });
        const path = join(cropDir, side, `crop_${stem}.png`);
        writeFileSync(path, encodePng(cropImage(pair.images[index], box)));
        sides[side].push({ name: `crop_${stem}.png`, path });
      });
      count += 2;
    }
    if (skipped) lines.push(`crops skipped: limit of ${MAX_IMAGES} images`);
    const records = [];
    const outcome = await lookWithAims(options, [], dependencies, records, { sides });
    if (outcome.unavailable) {
      stdout.write(`LOOK_UNAVAILABLE: ${oneLine(outcome.unavailable)}\n`);
      return 1;
    }
    const cost = costLine({ ms: Date.now() - started, usage: sumUsage(records.map(record => record.result)), costUsd: records.reduce((sum, record) => sum + record.result.costUsd, 0) });
    stdout.write(lines.map(line => `${line}\n`).join('') + outcome.output + '\n');
    stderr.write(cost + '\n');
    log(records, cost, lines);
    return 0;
  } catch (error) {
    stdout.write(`LOOK_UNAVAILABLE: ${oneLine(error.message || error)}\n`);
    return 1;
  } finally {
    stopOllama();
    if (cropDir) rmSync(cropDir, { recursive: true, force: true });
  }
}

export async function run(argv, dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  let options;
  let names;
  try {
    options = parseArgs(argv);
    names = sendNames(options.images);
  } catch (error) {
    stderr.write(`${usage}\n${error.message}\n`);
    return 2;
  }
  if (options.compare) return runCompare(options, dependencies, stdout, stderr);
  try {
    const started = Date.now();
    const images = options.images.map((path, index) => ({ path, name: names[index] }));
    for (const line of identicalLines(images.map(({ path, name }) => ({ name, hash: hashFile(path) })))) stdout.write(`${line}\n`);
    const records = [];
    let output;
    if (options.aims.length) {
      const outcome = await lookWithAims(options, images, dependencies, records);
      if (outcome.unavailable) {
        stdout.write(`LOOK_UNAVAILABLE: ${oneLine(outcome.unavailable)}\n`);
        return 1;
      }
      output = outcome.output;
    } else {
      const model = 'sonnet';
      const result = await runModel({ model, input: options.input, images, question: options.question, timeout: options.timeout, command: dependencies.command, commandArgs: dependencies.commandArgs, env: dependencies.env });
      if (result.error) {
        stdout.write(`LOOK_UNAVAILABLE: ${oneLine(result.error)}\n`);
        return 1;
      }
      records.push({ role: 'single', model, prompt: options.question, started: result.started, ended: result.ended, imageNames: images.map(image => image.name), toolCalls: result.toolCalls, text: result.text, cost: costLine(result), result });
      output = result.text;
    }
    const cost = costLine({ ms: Date.now() - started, usage: sumUsage(records.map(record => record.result)), costUsd: records.reduce((sum, record) => sum + record.result.costUsd, 0) });
    stdout.write(output + '\n');
    stderr.write(cost + '\n');
    try {
      const entry = buildLogEntry({ time: new Date().toISOString(), input: options.input, images: images.map(({ name, path }) => ({ name, path: resolve(path) })), runs: records, cost });
      appendLog(join(dirname(resolve(options.images[0])), 'look-log.md'), entry);
    } catch (error) {
      stderr.write(`look: log not written: ${oneLine(error.message || error)}\n`);
    }
    return 0;
  } catch (error) {
    stdout.write(`LOOK_UNAVAILABLE: ${oneLine(error.message || error)}\n`);
    return 1;
  } finally {
    stopOllama();
  }
}

// Node runs a symlinked script from its real path, so argv[1] (the link, e.g. ~/.claude/skills/...) must be resolved too.
function isMain() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (process.argv[1] && isMain()) process.exitCode = await run(process.argv.slice(2));
