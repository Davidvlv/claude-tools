import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, frontmatter, projectEntries, run, system } from './advisor.mjs';

// Records its argv, working folder and stdin, then answers as FAKE_MODE says.
const fakeClaude = `
const { writeFileSync } = require('node:fs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  writeFileSync(process.env.FAKE_RECORD, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd(), stdin: input }));
  const mode = process.env.FAKE_MODE;
  if (mode === 'hang') return setTimeout(() => {}, 60000);
  if (mode === 'exit') { process.stderr.write('boom'); process.exit(3); }
  if (mode === 'notjson') return process.stdout.write('hello');
  if (mode === 'error') return process.stdout.write(JSON.stringify({ is_error: true, result: 'quota spent' }));
  if (mode === 'nochoice') return process.stdout.write(JSON.stringify({ result: 'I think A.' }));
  process.stdout.write(JSON.stringify({ result: 'CHOICE: Signal\\nREASON: Fewer frames wasted.', usage: { input_tokens: 5, output_tokens: 2 }, duration_ms: 10 }));
});
`;

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'advisor-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const make = (name, text = 'x') => {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
    return path;
  };
  return { dir, make };
}

// The tests run inside Claude Code sessions, whose own config folder, session id and model choice must not leak in.
function cleanEnv() {
  const env = { ...process.env };
  for (const name of ['CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_SESSION_ID', 'ADVISOR_MODEL']) delete env[name];
  return env;
}

function sink() {
  const sink = { text: '', write: chunk => { sink.text += chunk; } };
  return sink;
}

async function runFake(t, mode, extraArgs = [], extraEnv = {}) {
  const { dir, make } = fixture(t);
  const home = join(dir, 'home');
  const project = join(dir, 'game');
  mkdirSync(project, { recursive: true });
  make('home/.claude/skills/alpha/SKILL.md', '---\nname: alpha\ndescription: Do alpha things.\n---\n\n# alpha\n');
  make('home/.claude/skills/beta/SKILL.md', '---\nname: beta\ndescription: "Quoted \\"beta\\" text."\n---\n');
  mkdirSync(join(home, '.claude', 'skills', 'empty'), { recursive: true });
  const plugin = join(dir, 'cache', 'kit', '1.0');
  make('cache/kit/1.0/skills/gamma/SKILL.md', '---\nname: gamma\ndescription: Gamma from a plugin.\n---\n');
  make('home/.claude/plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: { 'kit@market': [{ scope: 'user', installPath: plugin }] } }));
  make('home/.claude/advisor/decisions.md', [
    `## 2026-11-01T10:00:00Z | ${project.toUpperCase()} | s1`, 'Question: first', 'Choice: A', '',
    `## 2026-11-01T11:00:00Z | ${join(dir, 'other')} | s2`, 'Question: elsewhere', 'Choice: B', '',
    `## 2026-11-01T12:00:00Z | ${project} | s3`, 'Question: second', 'PARKED: push the branch', ''
  ].join('\n'));
  const question = make('q.md', 'Signal or poll?\n1. Signal (recommended)\n2. Poll');
  const fake = make('fake-claude.cjs', fakeClaude);
  const record = join(dir, 'record.json');
  const stdout = sink();
  const stderr = sink();
  const code = await run(['--question-file', question, '--project', project, ...extraArgs], {
    command: process.execPath, commandArgs: [fake], home, stdout, stderr,
    env: { ...cleanEnv(), CLAUDE_CONFIG_DIR: join(home, '.claude'), CLAUDE_CODE_SESSION_ID: 'sess-9', FAKE_MODE: mode, FAKE_RECORD: record, ...extraEnv }
  });
  const recorded = () => JSON.parse(readFileSync(record, 'utf8'));
  return { code, stdout: stdout.text, stderr: stderr.text, recorded, home, project, plugin };
}

test('accepts a question file, a project and a timeout', t => {
  const { dir, make } = fixture(t);
  const q = make('q.md', 'Line one\nLine two\n');
  assert.deepEqual(parseArgs(['--question-file', q, '--project', dir, '--timeout', '12.5']), { question: 'Line one\nLine two\n', project: dir, timeout: 12.5 });
});

test('the project defaults to the working folder and the timeout to 300 s', t => {
  const { dir, make } = fixture(t);
  const q = make('q.md', 'Q');
  assert.deepEqual(parseArgs(['--question-file', q], dir), { question: 'Q', project: dir, timeout: 300 });
});

test('rejects bad arguments', t => {
  const { dir, make } = fixture(t);
  const q = make('q.md', 'Q');
  assert.throws(() => parseArgs([]), /missing --question-file/);
  assert.throws(() => parseArgs(['--question-file']), /needs a value/);
  assert.throws(() => parseArgs(['--question-file', join(dir, 'none.md')]), /not an existing file/);
  assert.throws(() => parseArgs(['--question-file', make('blank.md', ' \n')]), /empty/);
  assert.throws(() => parseArgs(['--question-file', q, '--question-file', q]), /once/);
  assert.throws(() => parseArgs(['--question-file', q, '--project', join(dir, 'none')]), /not an existing folder/);
  assert.throws(() => parseArgs(['--question-file', q, 'extra']), /unknown argument/);
  for (const bad of ['0', '-3', 'abc', '']) assert.throws(() => parseArgs(['--question-file', q, '--timeout', bad]), /--timeout/);
});

test('an argument error exits 2 with the usage', async () => {
  const stdout = sink();
  const stderr = sink();
  assert.equal(await run([], { stdout, stderr }), 2);
  assert.equal(stdout.text, '');
  assert.match(stderr.text, /^Usage: node advisor\.mjs/);
});

test('frontmatter reads plain, quoted and folded values', () => {
  assert.deepEqual(frontmatter('---\nname: a\ndescription: >-\n  one\n  two\n---\n'), { name: 'a', description: 'one two' });
  assert.deepEqual(frontmatter("---\nname: 'it''s'\n---\n"), { name: "it's" });
  assert.deepEqual(frontmatter('# no frontmatter\n'), {});
});

test('projectEntries keeps only the last entries for the project', () => {
  const log = ['## t1 | C:\\g | s', 'Question: 1', '## t2 | C:\\h | s', 'Question: 2', '## t3 | C:\\g\\ | s', 'Question: 3'].join('\n');
  assert.deepEqual(projectEntries(log, 'C:\\g', 1), ['## t3 | C:\\g\\ | s\nQuestion: 3']);
  assert.equal(projectEntries(log, 'C:\\g').length, 2);
});

test('runs claude with the planned flags in the project folder', async t => {
  const { code, stdout, recorded, home, project, plugin } = await runFake(t, 'ok');
  assert.equal(code, 0);
  assert.equal(stdout, 'CHOICE: Signal\nREASON: Fewer frames wasted.\n');
  const { argv, cwd } = recorded();
  assert.equal(cwd.toLowerCase(), project.toLowerCase());
  const after = flag => argv[argv.indexOf(flag) + 1];
  assert.ok(argv.includes('-p'));
  assert.equal(after('--model'), 'fable');
  assert.ok(!argv.includes('--effort'));
  assert.equal(after('--system-prompt'), system);
  assert.equal(after('--tools'), 'Read,Grep,Glob');
  const allowed = argv.indexOf('--allowedTools');
  assert.deepEqual(argv.slice(allowed + 1, allowed + 4), ['Read', 'Grep', 'Glob']);
  const added = argv.flatMap((arg, i) => arg === '--add-dir' ? [argv[i + 1]] : []);
  assert.deepEqual(added, [join(home, '.claude', 'skills'), join(plugin, 'skills')]);
  for (const flag of ['--strict-mcp-config', '--disable-slash-commands', '--no-session-persistence']) assert.ok(argv.includes(flag), flag);
  assert.equal(after('--setting-sources'), 'local');
  assert.equal(after('--output-format'), 'json');
});

test('the prompt holds the skill index, the project log entries and the question', async t => {
  const { recorded, home } = await runFake(t, 'ok');
  const { stdin } = recorded();
  assert.ok(stdin.includes(`- alpha: Do alpha things. (${join(home, '.claude', 'skills', 'alpha', 'SKILL.md')})`));
  assert.ok(stdin.includes('- beta: Quoted "beta" text.'));
  assert.ok(!stdin.includes('empty'));
  assert.ok(stdin.includes('- kit:gamma: Gamma from a plugin.'));
  assert.ok(stdin.includes('Question: first') && stdin.includes('PARKED: push the branch'));
  assert.ok(!stdin.includes('elsewhere'));
  assert.ok(stdin.indexOf('Question: first') < stdin.indexOf('Question: second'));
  assert.ok(stdin.endsWith('Signal or poll?\n1. Signal (recommended)\n2. Poll'));
});

test('ADVISOR_MODEL picks the model', async t => {
  const { recorded } = await runFake(t, 'ok', [], { ADVISOR_MODEL: 'opus' });
  const { argv } = recorded();
  assert.equal(argv[argv.indexOf('--model') + 1], 'opus');
});

test('an answer is appended to the decisions log', async t => {
  const { home, project } = await runFake(t, 'ok');
  const log = readFileSync(join(home, '.claude', 'advisor', 'decisions.md'), 'utf8');
  const last = projectEntries(log, project, 1)[0];
  assert.match(last, /^## \S+ \| .+ \| sess-9\nQuestion: Signal or poll\? 1\. Signal \(recommended\) 2\. Poll\nCHOICE: Signal\nREASON: Fewer frames wasted\.$/);
});

test('a failed run logs nothing', async t => {
  const { home } = await runFake(t, 'nochoice');
  assert.ok(!readFileSync(join(home, '.claude', 'advisor', 'decisions.md'), 'utf8').includes('sess-9'));
});

test('a missing log gives no earlier decisions', async t => {
  const { dir, make } = fixture(t);
  const q = make('q.md', 'Q?');
  const record = join(dir, 'record.json');
  const code = await run(['--question-file', q, '--project', dir], {
    command: process.execPath, commandArgs: [make('fake.cjs', fakeClaude)], home: join(dir, 'nohome'), stdout: sink(), stderr: sink(),
    env: { ...cleanEnv(), FAKE_MODE: 'ok', FAKE_RECORD: record }
  });
  assert.equal(code, 0);
  const { stdin } = JSON.parse(readFileSync(record, 'utf8'));
  assert.match(stdin, /^Installed skills, each with its description and SKILL\.md path:\nNone\.\n\nEarlier decisions for this project, oldest first:\nNone\./);
});

for (const [mode, reason] of [
  ['exit', /^ADVISOR_UNAVAILABLE: boom\n$/],
  ['notjson', /^ADVISOR_UNAVAILABLE: claude printed output that is not JSON\n$/],
  ['error', /^ADVISOR_UNAVAILABLE: quota spent\n$/],
  ['nochoice', /^ADVISOR_UNAVAILABLE: the answer has no CHOICE line: I think A\.\n$/]
]) {
  test(`reports unavailable when claude gives ${mode}`, async t => {
    const { code, stdout } = await runFake(t, mode);
    assert.equal(code, 1);
    assert.match(stdout, reason);
  });
}

test('reports unavailable on a timeout', async t => {
  const { code, stdout } = await runFake(t, 'hang', ['--timeout', '1']);
  assert.equal(code, 1);
  assert.equal(stdout, 'ADVISOR_UNAVAILABLE: timed out after 1 s\n');
});

test('reports unavailable when claude cannot start', async t => {
  const { dir, make } = fixture(t);
  const stdout = sink();
  const code = await run(['--question-file', make('q.md', 'Q'), '--project', dir], { command: join(dir, 'no-such-claude.exe'), home: dir, env: cleanEnv(), stdout, stderr: sink() });
  assert.equal(code, 1);
  assert.match(stdout.text, /^ADVISOR_UNAVAILABLE: cannot start claude: /);
});
