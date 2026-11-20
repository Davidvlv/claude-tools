import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./wait.mjs', import.meta.url));

function run(args, env = {}) {
  return new Promise(resolve => {
    const started = Date.now();
    const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('close', code => resolve({ code, stdout, ms: Date.now() - started }));
  });
}

test('returns soon after a named file becomes non-empty and names it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wait-'));
  const ready = join(dir, 'ready.txt');
  const other = join(dir, 'other.txt');
  writeFileSync(ready, '');
  setTimeout(() => writeFileSync(ready, 'done\n'), 2000);
  const result = await run(['--minutes', '2', '--file', other, '--file', ready]);
  assert.equal(result.code, 0);
  assert.ok(result.ms >= 1500 && result.ms < 10_000, `took ${result.ms} ms`);
  assert.match(result.stdout, /ready\.txt/);
  assert.doesNotMatch(result.stdout, /other\.txt/);
});

test('sleeps the full duration when no file is written', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wait-'));
  const result = await run(['--minutes', '1', '--file', join(dir, 'never.txt')], { WAIT_MJS_TEST_SECONDS: '3' });
  assert.equal(result.code, 0);
  assert.ok(result.ms >= 3000 && result.ms < 8000, `took ${result.ms} ms`);
  assert.match(result.stdout, /no file ready/);
});

test('bad or missing --minutes exits 2 with a usage line', () => {
  for (const args of [[], ['--minutes', '0'], ['--minutes', '11'], ['--minutes', 'x'], ['--minutes'], ['--file', 'a']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2, `args ${args.join(' ')}`);
    assert.match(result.stdout, /usage: node wait\.mjs --minutes <1-10>/);
    assert.doesNotMatch(result.stdout, /WAIT_MJS_TEST_SECONDS/);
  }
});
