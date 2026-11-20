import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { publishedText, segments } from './command.mjs';

const files = { [path.resolve('/repo/msg.txt')]: 'From the file.', [path.resolve('/repo/sub/m.txt')]: 'Sub file.' };
const readText = (f) => files[f] ?? '';
const text = (command, shell) => publishedText(command, { shell, cwd: '/repo', readText })?.text;

test('git commit messages in every common form', () => {
  assert.equal(text('git commit -m "Fix the cache"'), 'Fix the cache');
  assert.equal(text("git commit -am 'Fix it' -m Second"), 'Fix it\n\nSecond');
  assert.equal(text('git commit --message="One" --message Two'), 'One\n\nTwo');
  assert.equal(text('git -C sub -c user.name=x commit -F m.txt'), 'Sub file.');
  assert.equal(text('git commit --file=msg.txt'), 'From the file.');
  assert.equal(text('git commit --amend --no-edit'), '');
});

test('a heredoc message, with quotes inside, through $(cat) or -F -', () => {
  const sub = 'git commit -m "$(cat <<\'EOF\'\nFix "quoted" names\n\nIt\'s done.\nEOF\n)"';
  assert.equal(text(sub), 'Fix "quoted" names\n\nIt\'s done.');
  assert.equal(text("git commit -F - <<'EOF'\nBody line.\nEOF"), 'Body line.');
});

test('PowerShell here-strings, quotes and backslash paths', () => {
  assert.equal(text("git commit -m @'\nA fix.\n'@", 'powershell'), 'A fix.');
  assert.equal(text('git commit -m "Say ""hi"" `"now`""', 'powershell'), 'Say "hi" "now"');
  const seen = [];
  publishedText('git commit -F C:\\repo\\msg.txt', { shell: 'powershell', cwd: '/repo', readText: (f) => (seen.push(f), '') });
  assert.ok(seen[0].includes('C:\\repo\\msg.txt'), seen[0]);
  assert.equal(text("git commit -m 'it''s'", 'powershell'), "it's");
});

test('gh titles, bodies and body files', () => {
  assert.equal(text('gh pr create --title "T" --body "B" --base main'), 'T\n\nB');
  assert.equal(text('gh issue comment 12 -b "Done."'), 'Done.');
  assert.equal(text('gh pr edit 3 -F msg.txt'), 'From the file.');
  assert.equal(text('gh pr review 3 --approve --body=Fine'), 'Fine');
  assert.equal(publishedText('gh pr view 3', { readText }), undefined);
});

test('kind names the first command with a message, not a label-only edit before it', () => {
  const kind = (command) => publishedText(command, { cwd: '/repo', readText })?.kind;
  assert.equal(kind('gh issue edit 3 --add-label doing && gh issue comment 3 --body "Done."'), 'gh issue comment');
  assert.equal(kind('gh issue edit 3 --add-label doing'), 'gh issue edit');
});

test('body file paths expand variables set earlier in the command, then env', () => {
  const env = { TEMP: '/repo' };
  const at = (command, shell, platform = 'linux') => publishedText(command, { shell, cwd: '/', readText, env, platform })?.text;
  assert.equal(at('SP=/repo; gh pr create -t T --body-file $SP/msg.txt'), 'T\n\nFrom the file.');
  assert.equal(at('export D=/repo/sub && git commit -F "${D}/m.txt"'), 'Sub file.');
  assert.equal(at('gh issue comment 4 -F $TEMP/msg.txt'), 'From the file.');
  assert.equal(at('$f = "/repo/msg.txt"; gh issue create -t T --body-file $f', 'powershell'), 'T\n\nFrom the file.');
  assert.equal(at('gh pr edit 3 -F $env:TEMP/msg.txt', 'powershell'), 'From the file.');
  assert.equal(at('gh pr edit 3 -F $NOPE/msg.txt'), '');
  const seen = [];
  publishedText('gh pr edit 3 -F /c/repo/msg.txt', { cwd: '/', readText: (f) => (seen.push(f), ''), platform: 'win32' });
  assert.match(seen[0], /c:[\\/]repo[\\/]msg\.txt$/iu);
});

test('code elsewhere in the command is not message text', () => {
  const command = "cat > src/a.gd <<'EOF'\n# A robust loader.\nvar x = \"seamless\"\nEOF\ngit add src/a.gd && git commit -m 'Add loader'";
  assert.equal(text(command), 'Add loader');
  assert.equal(text('grep -F pivotal notes.md && git commit -m "Fix"'), 'Fix');
  assert.equal(text('echo "git commit -m robust"'), undefined);
  assert.equal(text('# git commit -m robust\nls'), undefined);
});

test('segments split on separators and keep each command its stdin', () => {
  const segs = segments('a 1; b "2 3" | c <<< hi\nd');
  assert.deepEqual(segs.map((s) => s.words), [['a', '1'], ['b', '2 3'], ['c'], ['d']]);
  assert.deepEqual(segs[2].stdin, ['hi']);
});
