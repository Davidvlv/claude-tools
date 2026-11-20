import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handle } from './hook.mjs';
import { MASK } from './match.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'no-claudisms-test-'));
const session = { session_id: 's1', prompt_id: 'p1', cwd: os.tmpdir() };

test('MessageDisplay masks flagged clauses and passes clean text', async () => {
  const stateDir = tmp();
  const clean = await handle({ ...session, hook_event_name: 'MessageDisplay', delta: 'All tests pass.\n' }, { stateDir });
  assert.equal(clean, undefined);
  const out = await handle({ ...session, hook_event_name: 'MessageDisplay', delta: 'Tests pass. We delve into it.\n' }, { stateDir });
  assert.equal(out.hookSpecificOutput.hookEventName, 'MessageDisplay');
  assert.equal(out.hookSpecificOutput.displayContent, `Tests pass. ${MASK}\n`);
});

test('Stop blocks once for hits recorded by the display hook, then lets the rewrite through', async () => {
  const stateDir = tmp();
  await handle({ ...session, hook_event_name: 'MessageDisplay', delta: 'Step one is robust.\n' }, { stateDir });
  const stop = await handle({ ...session, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' }, { stateDir });
  assert.equal(stop.decision, 'block');
  assert.match(stop.reason, /"robust" in "Step one is robust\."/u);

  // The reworded message in the same turn is shown as written, even with a hit.
  const shown = await handle({ ...session, hook_event_name: 'MessageDisplay', delta: 'Still robust.\n' }, { stateDir });
  assert.equal(shown, undefined);
  const again = await handle({ ...session, hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: 'Still robust.' }, { stateDir });
  assert.equal(again, undefined);
});

test('Stop checks the final message itself when no display hook ran', async () => {
  const stop = await handle({ ...session, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'We delve into it.' }, { stateDir: tmp() });
  assert.equal(stop.decision, 'block');
});

test('Stop passes a clean turn', async () => {
  const stop = await handle({ ...session, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' }, { stateDir: tmp() });
  assert.equal(stop, undefined);
});

test('SubagentStop blocks a flagged report once', async () => {
  const input = { ...session, hook_event_name: 'SubagentStop', last_assistant_message: 'The plan is robust.' };
  assert.equal((await handle({ ...input, stop_hook_active: false }, { stateDir: tmp() })).decision, 'block');
  assert.equal(await handle({ ...input, stop_hook_active: true }, { stateDir: tmp() }), undefined);
});

const pre = (tool_name, tool_input) => ({ ...session, hook_event_name: 'PreToolUse', tool_name, tool_input });
const denied = (out) => out?.hookSpecificOutput?.permissionDecision === 'deny';

test('PreToolUse denies a markdown Write that adds hits, and allows the same hits on retry', async () => {
  const stateDir = tmp();
  const file = path.join(tmp(), 'notes.md');
  const input = pre('Write', { file_path: file, content: 'A seamless plan.' });
  const first = await handle(input, { stateDir });
  assert.ok(denied(first));
  assert.match(first.hookSpecificOutput.permissionDecisionReason, /"seamless"/u);
  assert.equal(await handle(input, { stateDir }), undefined);
});

test('PreToolUse ignores code files and hits already in the file', async () => {
  const stateDir = tmp();
  assert.equal(await handle(pre('Write', { file_path: 'x.js', content: '// robust' }), { stateDir }), undefined);
  const file = path.join(tmp(), 'old.md');
  fs.writeFileSync(file, 'An old robust line.');
  assert.equal(await handle(pre('Write', { file_path: file, content: 'An old robust line.\nNew line.' }), { stateDir }), undefined);
  assert.equal(await handle(pre('Edit', { file_path: file, old_string: 'An old robust line.', new_string: 'An old robust line!' }), { stateDir }), undefined);
  assert.ok(denied(await handle(pre('Edit', { file_path: file, old_string: 'New line.', new_string: 'A pivotal line.' }), { stateDir })));
});

test('PreToolUse checks commit and PR text, including quoted messages and body files', async () => {
  const stateDir = tmp();
  assert.ok(denied(await handle(pre('Bash', { command: 'git commit -m "Make the cache robust"' }), { stateDir })));
  assert.ok(denied(await handle(pre('PowerShell', { command: "git -C C:/x commit -m @'\nA pivotal fix.\n'@" }), { stateDir })));
  const body = path.join(tmp(), 'body.md');
  fs.writeFileSync(body, 'This PR is a seamless change.');
  assert.ok(denied(await handle(pre('Bash', { command: `gh pr create --title Fix --body-file "${body}"` }), { stateDir })));
  assert.equal(await handle(pre('Bash', { command: 'echo robust > notes.txt' }), { stateDir }), undefined);
});

test('the script prints the hook JSON and never fails on bad input', () => {
  const script = fileURLToPath(new URL('./hook.mjs', import.meta.url));
  const env = { ...process.env, CLAUDE_PLUGIN_DATA: tmp() };
  const out = execFileSync('node', [script], { input: JSON.stringify({ ...session, hook_event_name: 'SubagentStop', last_assistant_message: 'A robust plan.' }), env });
  assert.equal(JSON.parse(out).decision, 'block');
  assert.equal(execFileSync('node', [script], { input: 'not json', env, stdio: ['pipe', 'pipe', 'ignore'] }).length, 0);
});

test('a denial does not let the same hits through in a later turn', async () => {
  const stateDir = tmp();
  const file = path.join(tmp(), 'later.md');
  const write = (prompt_id) => handle({ ...pre('Write', { file_path: file, content: 'A seamless plan.' }), prompt_id }, { stateDir });
  assert.ok(denied(await write('p1')));
  // The agent reworded instead of retrying; the next turn writes the same text.
  assert.ok(denied(await write('p2')));
  assert.equal(await write('p2'), undefined);
});
