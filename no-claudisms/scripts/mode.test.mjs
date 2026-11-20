import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { modeCommand, effectiveMode, configuredMode } from './mode.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'no-claudisms-mode-'));

test('the command sets, shows and rejects modes', () => {
  const file = path.join(tmp(), 'mode.json');
  assert.equal(modeCommand('all', 'off', file), 'no-claudisms mode: off, for all sessions.');
  assert.equal(effectiveMode('all', file), 'off');
  assert.match(modeCommand('all', 'loud', file), /unknown mode "loud"/u);
  const log = tmp();
  fs.writeFileSync(path.join(log, '2026-11-20.jsonl'), '{}\n{}\n');
  const status = modeCommand('all', 'Status', file, log);
  assert.match(status, /^no-claudisms mode: off\. Edit log: 2 entries from the last 7 days in /u);
  assert.ok(status.includes(log));
  assert.equal(modeCommand('all', '', file, log), status);
  // Setting the /config value again removes the override.
  modeCommand('all', 'ALL', file);
  assert.equal(fs.existsSync(file), false);
});

test('a later /config change wins over the command', () => {
  const file = path.join(tmp(), 'mode.json');
  modeCommand('all', 'off', file);
  assert.equal(effectiveMode('chat', file), 'chat');
  assert.equal(effectiveMode('all', file), 'all');
});

test('configuredMode reads the /config value from settings.json', () => {
  const settings = path.join(tmp(), 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ pluginConfigs: { 'no-claudisms@claude-tools': { options: { mode: 'output' } } } }));
  assert.equal(configuredMode(settings), 'output');
  assert.equal(configuredMode(path.join(tmp(), 'missing.json')), undefined);
});

test('the script prints one line and uses the config folder', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ pluginConfigs: { 'no-claudisms@x': { options: { mode: 'chat' } } } }));
  const run = (...args) => execFileSync('node', [fileURLToPath(new URL('./mode.mjs', import.meta.url)), ...args], { env: { ...process.env, CLAUDE_CONFIG_DIR: dir } }).toString();
  assert.equal(run('off'), 'no-claudisms mode: off, for all sessions.\n');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'no-claudisms', 'mode.json'), 'utf8')), { mode: 'off', config: 'chat' });
  assert.match(run(), /^no-claudisms mode: off\./u);
});
