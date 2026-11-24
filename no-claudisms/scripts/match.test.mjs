import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRules, findHits, addedHits, mask, hitLines, aliasSource, extractHint, keepsFacts, MASK } from './match.mjs';

const rules = loadRules();
const ids = (text, opts) => findHits(text, rules, opts).map((h) => h.id);

test('flags plain phrases case-insensitively at word boundaries', () => {
  assert.deepEqual(ids("It's worth noting that we should delve into it."), ['it-s-worth-noting-that', 'delve']);
  assert.deepEqual(ids('This beam is LOAD-BEARING.'), ['load-bearing']);
  assert.deepEqual(ids('We unpacked the archive and found a delver.'), []);
});

test('flags em dashes and spaced dashes between words, not number ranges', () => {
  assert.deepEqual(ids('The fix works — mostly.'), ['em-dashes']);
  assert.deepEqual(ids('The fix works—mostly.'), ['em-dashes']);
  assert.deepEqual(ids('The fix works -- mostly.'), ['em-dashes']);
  assert.deepEqual(ids('Pages 1–3 and Q1–Q6 are done.'), []);
  assert.deepEqual(ids('- a list item\n- another'), []);
});

test('flags negative parallelism and staccato negation', () => {
  assert.deepEqual(ids("It's not just a bug, it's a feature."), ['negative-parallelism']);
  assert.deepEqual(ids('This is not about speed. It is about trust.'), ['negative-parallelism']);
  assert.deepEqual(ids('No meetings. No email. Just code.'), ['no-x-no-y-just-z-staccato-negation']);
  assert.deepEqual(ids('This is not supported on Windows, so use WSL.'), []);
});

test('leaves literal developer and game words alone', () => {
  const plain = [
    'The function moves the file and names it after the hash.',
    'The array shape is wrong, and the physics tick takes 6 ms inside the engine.',
    'The ray code lives in one shared file; the test harness carries the fixture.',
    'Hold the key, then navigate to the realm and turn on the surface shader.',
    'The decision is settled, and the whole reply is shown.',
  ];
  for (const t of plain) assert.deepEqual(ids(t), [], t);
});

test('flags hold as a verdict and as a metaphor, but only the verb', () => {
  const matches = (text) => findHits(text, rules).map((h) => `${h.id}:${h.match}`);
  assert.deepEqual(matches('The tests hold.'), ['hold:hold']);
  assert.deepEqual(matches("So even if enabled, it wouldn't hold."), ['hold:hold']);
  assert.deepEqual(matches("The plan's measurements still hold, so we ship."), ['hold:hold']);
  assert.deepEqual(matches('This holds when the cache is warm.'), ['hold:holds when']);
  assert.deepEqual(matches('Sonnet holds up; Haiku does not.'), ['hold:holds up']);
  assert.deepEqual(matches('The rationale held up: the dry run came first.'), ['hold:held up']);
  assert.deepEqual(matches('The preconditions all hold, yet no slide.'), ['hold:hold']);
  assert.deepEqual(matches("The key rule in step 7 still holds."), ['hold:holds']);
  assert.deepEqual(matches('That guard holds the line for one hazard.'), ['hold:holds the line']);
  assert.deepEqual(matches('We keep holding both at once.'), ['hold:holding both at once']);
});

test('leaves literal hold alone', () => {
  const plain = [
    'Shift is held.',
    'Press F and hold Space.',
    'Take a Hold when a face is near.',
    'The folder holds 2 sessions.',
    'The worker finishes the request it holds.',
    'The arm held up, and the golem jumps.',
    'Hold on, the merge failed.',
    'They hold two ideas plus repeat verdicts.',
    'It climbs onto the roof on the same Hold, and back.',
    'On a still Hold, each hand rests on a face.',
  ];
  for (const t of plain) assert.deepEqual(ids(t), [], t);
});

test('flags shape and surface only in their metaphor forms', () => {
  assert.deepEqual(ids('Your answers decide the shape of the plan.'), ['shape']);
  assert.deepEqual(ids("I'll surface the design question soon."), ['surface']);
  assert.deepEqual(ids('Merging now surfaces any conflicts early.'), ['surface']);
  assert.deepEqual(ids('Two bugs surfaced only under test.'), ['surface']);
  assert.deepEqual(ids('It is worth surfacing to the team later.'), ['surface']);
  assert.deepEqual(ids('Now it surfaces the central design tension.'), ['surface']);
  assert.deepEqual(ids('Three facts from the investigation shape these questions.'), ['shape']);
  assert.deepEqual(ids('One finding shaped the whole damage design.'), ['shape']);
  assert.deepEqual(ids('The strangler was the right shape for that time.'), ['shape']);
  const literal = [
    'The shape of the mesh is wrong.',
    'The ray hits the surface it creates.',
    'Paint the surface the player stands on.',
    'Every surface that creates a task accepts the field.',
    'Tell the person which surface they are using.',
    'The test may change which shape it names.',
    'Easing shapes the motion to the next key.',
    'The clouds slowly change shape.',
  ];
  for (const t of literal) {
    assert.deepEqual(ids(t), [], t);
  }
});

test('skips code, quotes and URLs', () => {
  assert.deepEqual(ids('Run `delve --deep` first.'), []);
  assert.deepEqual(ids('```\nlet x = 1 — 2 // delve\n```\nDone.'), []);
  assert.deepEqual(ids('The list bans "delve" and “leverage”.'), []);
  assert.deepEqual(ids('See https://example.com/delve-into-it for details.'), []);
});

test('quotes are checked when asked, as for command text', () => {
  assert.deepEqual(ids('git commit -m "Delve into the cache"', { quotes: false }), ['delve']);
});

test('emoji before a hit do not shift its offsets', () => {
  const text = '🤖 Done. We delve into it.';
  const [h] = findHits(text, rules);
  assert.equal(h.match, 'delve');
});

test('mask replaces each flagged clause and keeps list markers and other sentences', () => {
  const text = '- First point. We delve into it here. Last point.\n- Clean item.';
  assert.equal(mask(text, findHits(text, rules)), `- First point. ${MASK} Last point.\n- Clean item.`);
});

test('mask merges two hits in one clause', () => {
  const text = 'We delve into a robust plan.';
  assert.equal(mask(text, findHits(text, rules)), MASK);
});

test('addedHits counts only hits the change adds', () => {
  const old = 'Old text that is robust.';
  assert.deepEqual(addedHits(old, old + ' New clean text.', rules), []);
  assert.deepEqual(
    addedHits(old, old + ' A seamless addition.', rules).map((h) => h.match),
    ['seamless'],
  );
});

test('hitLines lists at most eight hits and counts the rest', () => {
  const text = Array.from({ length: 10 }, (_, i) => `Part ${i} is robust.`).join(' ');
  const lines = hitLines(findHits(text, rules)).split('\n');
  assert.equal(lines.length, 9);
  assert.equal(lines[8], '- +2 more');
  assert.match(lines[0], /^- "robust" in "Part 0 is robust\." -> /u);
});

test('aliasSource turns placeholders into patterns', () => {
  const re = new RegExp(aliasSource('the most X you can get'), 'iu');
  assert.ok(re.test('the most value you can get'));
  assert.ok(new RegExp(aliasSource('yours to [keep/own/decide]'), 'iu').test('yours to own'));
  assert.ok(new RegExp(aliasSource('When it comes to…'), 'iu').test('when it comes to tests'));
});

test('extractHint picks the sentence that says what to do', () => {
  assert.equal(extractHint('- filler. Sounds deep. Replace with the plain thing.'), 'Replace with the plain thing.');
  assert.ok(extractHint('- x. ' + 'word '.repeat(60)).length <= 120);
});

test('every enabled rule compiles and has a short hint', () => {
  for (const r of rules) assert.ok(r.hint.length > 0 && r.hint.length <= 120, `${r.id}: ${r.hint}`);
});

test('a phrase hint wins over its entry hint', () => {
  const [robust, seamless] = findHits('A robust and seamless plan.', rules);
  assert.equal(robust.id, 'robust');
  assert.equal(seamless.id, 'robust');
  assert.notEqual(robust.hint, seamless.hint);
  assert.equal(seamless.hint, 'Say which step the user no longer has to do.');
});

test('every phrase hint key matches a phrase of its entry', async () => {
  const fs = await import('node:fs');
  const { LIST_FILE, OVERRIDES_FILE } = await import('./match.mjs');
  const list = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
  const { terms } = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
  for (const [id, o] of Object.entries(terms)) {
    for (const phrase of Object.keys(o.phraseHints ?? {})) {
      const hits = findHits(phrase, rules).filter((h) => h.id === id && h.match.toLowerCase() === phrase.toLowerCase());
      assert.equal(hits.length, 1, `${id}: phrase hint "${phrase}" matches no phrase of the entry`);
    }
    assert.ok(id in Object.fromEntries(list.terms.map((t) => [t.id, 1])), `${id}: override for a term that is not upstream`);
  }
});

test('a leading bold label stays outside the masked clause', () => {
  const text = '**Plan:** we delve into it.';
  assert.equal(mask(text, findHits(text, rules)), `**Plan:** ${MASK}`);
});

test('keepsFacts lets a rewrite drop only the negations inside the flagged phrase', () => {
  const clause = "It's not a bug, it's a feature.";
  const hits = findHits(clause, rules);
  assert.deepEqual(hits.map((h) => h.id), ['negative-parallelism']);
  const group = { start: 0, clause, hits };
  assert.equal(keepsFacts(group, 'It is a feature.'), true);
  assert.equal(keepsFacts(group, 'It is not a feature, and never was.'), false);
});
