import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { reword, buildPrompt, parseReply } from './reword.mjs';

// A fake claude: prints a JSON result built from the env, after an optional delay.
const fakeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-claudisms-fake-'));
const fake = path.join(fakeDir, 'fake-claude.mjs');
fs.writeFileSync(
  fake,
  `let input = ''; for await (const c of process.stdin) input += c;
   await new Promise((r) => setTimeout(r, Number(process.env.FAKE_DELAY ?? 0)));
   if (process.env.FAKE_FAIL) process.exit(1);
   process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: process.env.FAKE_REPLY, args: process.argv.slice(2), input }));`,
);
const run = (items, env, opts = {}) => {
  Object.assign(process.env, env);
  try {
    return reword(items, { command: process.execPath, commandArgs: [fake], ...opts });
  } finally {
    for (const k of Object.keys(env)) delete process.env[k];
  }
};
const items = [
  { clause: 'A robust plan.', hits: [{ match: 'robust', hint: 'Name the property.' }] },
  { clause: 'We delve into it.', hits: [{ match: 'delve', hint: 'Use look at.' }] },
];

test('buildPrompt numbers each clause with its phrases, without the hints', () => {
  assert.equal(buildPrompt(items), '1. A robust plan.\n   Remove: "robust"\n2. We delve into it.\n   Remove: "delve"');
});

test('parseReply maps numbered lines and leaves missing ones null', () => {
  assert.deepEqual(parseReply('1. A tested plan.\nnoise\n3. extra', 2), ['A tested plan.', null]);
});

test('reword returns one rewrite per clause', async () => {
  assert.deepEqual(await run(items, { FAKE_REPLY: '1. A tested plan.\n2. We look at it.' }), ['A tested plan.', 'We look at it.']);
});

test('reword returns nulls when the run fails or times out', async () => {
  assert.deepEqual(await run(items, { FAKE_FAIL: '1' }), [null, null]);
  assert.deepEqual(await run(items, { FAKE_DELAY: '3000', FAKE_REPLY: '1. x\n2. y' }, { timeoutMs: 300 }), [null, null]);
  assert.deepEqual(await reword(items, { command: path.join(fakeDir, 'missing.exe') }), [null, null]);
});
