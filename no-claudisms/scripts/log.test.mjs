import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { logEdit, logCount } from './log.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'no-claudisms-log-'));

test('the log keeps one file per day and drops files older than 7 days', () => {
  const dir = tmp();
  const day = (d) => new Date(2026, 10, d, 12);
  logEdit({ event: 'a' }, { dir, now: day(1) });
  logEdit({ event: 'b' }, { dir, now: day(8) });
  logEdit({ event: 'c' }, { dir, now: day(8) });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-11-01.jsonl', '2026-11-08.jsonl']);
  assert.equal(logCount(dir), 3);
  // The first entry of a new day prunes; the 1st is then more than 7 days old.
  logEdit({ event: 'd' }, { dir, now: day(9) });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-11-08.jsonl', '2026-11-09.jsonl']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '2026-11-09.jsonl'), 'utf8')).event, 'd');
});

test('a missing log counts as empty', () => {
  assert.equal(logCount(path.join(tmp(), 'none')), 0);
});
