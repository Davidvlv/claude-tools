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
// The hooks read the /no-claudisms override from the Claude config folder; tests use an empty one.
process.env.CLAUDE_CONFIG_DIR = tmp();
const session = { session_id: 's1', prompt_id: 'p1', cwd: os.tmpdir() };

const fails = async (items) => items.map(() => null);
const fixes = async (items) => items.map((it) => it.clause.replace(/delve into/u, 'look at').replace(/robust/u, 'tested'));

test('MessageDisplay rewords flagged clauses in place and passes clean text', async () => {
  const stateDir = tmp();
  const clean = await handle({ ...session, hook_event_name: 'MessageDisplay', delta: 'All tests pass.\n' }, { stateDir, rewordFn: fixes });
  assert.equal(clean, undefined);
  const out = await handle({ ...session, hook_event_name: 'MessageDisplay', delta: 'Tests pass. We delve into it.\n' }, { stateDir, rewordFn: fixes });
  assert.equal(out.hookSpecificOutput.hookEventName, 'MessageDisplay');
  assert.equal(out.hookSpecificOutput.displayContent, 'Tests pass. We look at it.\n');
  // Reworded in place, so the turn ends without a closing message.
  assert.equal(await handle({ ...session, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Tests pass. We delve into it.' }, { stateDir }), undefined);
});

test('the next prompt gets the reworded phrases once as a note', async () => {
  const stateDir = tmp();
  await handle({ ...session, hook_event_name: 'MessageDisplay', delta: 'We delve into it.\n' }, { stateDir, rewordFn: fixes });
  const note = await handle({ ...session, prompt_id: 'p2', hook_event_name: 'UserPromptSubmit', prompt: 'next' }, { stateDir });
  assert.equal(note.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(note.hookSpecificOutput.additionalContext, /"delve" in "We delve into it."/u);
  assert.equal(await handle({ ...session, prompt_id: 'p3', hook_event_name: 'UserPromptSubmit', prompt: 'again' }, { stateDir }), undefined);
});

test('a failed or still-flagged rewrite is masked, and Stop asks the agent once', async () => {
  const stateDir = tmp();
  const out = await handle({ ...session, hook_event_name: 'MessageDisplay', delta: 'Step one is robust.\n' }, { stateDir, rewordFn: fails });
  assert.equal(out.hookSpecificOutput.displayContent, `${MASK}
`);
  const still = await handle({ ...session, hook_event_name: 'MessageDisplay', delta: 'We delve into it.\n' }, { stateDir, rewordFn: async () => ['We dive into it.'] });
  assert.equal(still.hookSpecificOutput.displayContent, `${MASK}
`);
  const stop = await handle({ ...session, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'Done.' }, { stateDir });
  assert.equal(stop.decision, 'block');
  assert.match(stop.reason, /"robust" in "Step one is robust."/u);

  // The agent's reworded closing message in the same turn is shown as written, even with a hit.
  const shown = await handle({ ...session, hook_event_name: 'MessageDisplay', delta: 'Still robust.\n' }, { stateDir, rewordFn: fails });
  assert.equal(shown, undefined);
  const again = await handle({ ...session, hook_event_name: 'Stop', stop_hook_active: true, last_assistant_message: 'Still robust.' }, { stateDir });
  assert.equal(again, undefined);
});

test('modes choose which hooks act', async () => {
  const display = { ...session, hook_event_name: 'MessageDisplay', delta: 'We delve into it.\n' };
  const write = { ...session, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(tmp(), 'm.md'), content: 'A seamless plan.' } };
  const report = { ...session, hook_event_name: 'SubagentStop', stop_hook_active: false, last_assistant_message: 'A robust plan.' };
  const acts = async (input, mode) => (await handle(input, { stateDir: tmp(), mode, rewordFn: fixes })) !== undefined;
  assert.deepEqual([await acts(display, 'chat'), await acts(write, 'chat'), await acts(report, 'chat')], [true, false, false]);
  assert.deepEqual([await acts(display, 'output'), await acts(write, 'output'), await acts(report, 'output')], [false, true, true]);
  assert.deepEqual([await acts(display, 'off'), await acts(write, 'off'), await acts(report, 'off')], [false, false, false]);
  assert.deepEqual([await acts(display, 'all'), await acts(write, 'all'), await acts(report, undefined)], [true, true, true]);
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

test('a rewrite that drops bold, code or links is masked instead', async () => {
  const out = await handle(
    { ...session, hook_event_name: 'MessageDisplay', delta: '**Plan:** we delve into `app.log`.\n' },
    { stateDir: tmp(), rewordFn: async () => ['we look at app.log.'] },
  );
  assert.equal(out.hookSpecificOutput.displayContent, `**Plan:** ${MASK}\n`);
});

test('the /no-claudisms override decides which hooks act', async () => {
  const modeFile = path.join(tmp(), 'mode.json');
  fs.writeFileSync(modeFile, JSON.stringify({ mode: 'off', config: 'all' }));
  const display = (mode) => handle({ ...session, hook_event_name: 'MessageDisplay', delta: 'We delve into it.\n' }, { stateDir: tmp(), mode, modeFile, rewordFn: fixes });
  assert.equal(await display('all'), undefined);
  // A later /config change wins and drops the override.
  assert.notEqual(await display('chat'), undefined);
  assert.equal(fs.existsSync(modeFile), false);
});

test('each edit and request goes to the edit log', async () => {
  const stateDir = tmp();
  const logTo = tmp();
  const entries = () => fs.readdirSync(logTo).flatMap((f) => fs.readFileSync(path.join(logTo, f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)));
  await handle({ ...session, hook_event_name: 'MessageDisplay', delta: 'We delve into it. Step one is robust.\n' }, { stateDir, logTo, rewordFn: async () => ['We look at it.', null] });
  await handle({ ...session, hook_event_name: 'Stop', stop_hook_active: false, last_assistant_message: 'x' }, { stateDir, logTo });
  const input = pre('Write', { file_path: path.join(tmp(), 'log.md'), content: 'A seamless plan.' });
  await handle(input, { stateDir, logTo });
  await handle(input, { stateDir, logTo });
  const log = entries();
  assert.deepEqual(log.map((e) => e.event), ['reworded', 'masked', 'closing-message-requested', 'denied', 'retry-allowed']);
  assert.equal(log[0].clause, 'We delve into it.');
  assert.equal(log[0].replacement, 'We look at it.');
  assert.equal(log[1].replacement, null);
  assert.equal(log[0].session, 's1');
  assert.deepEqual(log[3].hits.map((h) => h.match.toLowerCase()), ['seamless']);
});
