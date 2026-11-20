import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, buildPrompt, sendNames, identicalLines, trimLog, mediaType, buildInlineMessage, buildLogEntry, MAX_IMAGES, parseQuestion, parseVerdicts, aggregate, formatOutput, freshPrompt, ratedPrompt, decodePng, encodePng, crc32, diffImages, gateDecision, comparePrompt, parseCompareVerdicts, mapVerdicts, aggregateCompare, pairFolders, padBox, cropImage, ollamaRequest, stripThink, createQueue } from './look.mjs';
import { deflateSync } from 'node:zlib';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'look-test-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const make = (name, text = 'x') => {
    const path = join(dir, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
    return path;
  };
  return { dir, make };
}

test('accepts a question and images', t => {
  const { make } = fixture(t);
  const a = make('a.png');
  const b = make('b.png');
  assert.deepEqual(parseArgs(['--question', 'What?', a, b]), { question: 'What?', description: 'What?', aims: [], timeout: 300, images: [a, b], input: 'inline', runsModel: 'opus', freshModel: 'sonnet', tiebreak: 'opus' });
});

test('reads the question from a file and takes a timeout', t => {
  const { make } = fixture(t);
  const q = make('q.txt', 'Line one\nLine two\n');
  const a = make('a.png');
  const options = parseArgs(['--timeout', '12.5', '--question-file', q, a]);
  assert.equal(options.question, 'Line one\nLine two\n');
  assert.equal(options.timeout, 12.5);
});

test('rejects a missing question', t => {
  const { make } = fixture(t);
  assert.throws(() => parseArgs([make('a.png')]), /--question/);
});

test('rejects both question forms', t => {
  const { make } = fixture(t);
  const q = make('q.txt', 'Q');
  const a = make('a.png');
  assert.throws(() => parseArgs(['--question', 'Q', '--question-file', q, a]), /exactly one/);
});

test('rejects a question file that does not exist', t => {
  const { dir, make } = fixture(t);
  assert.throws(() => parseArgs(['--question-file', join(dir, 'none.txt'), make('a.png')]), /question-file/);
});

test('rejects no image', () => {
  assert.throws(() => parseArgs(['--question', 'Q']), /at least one image/);
});

test('rejects an image file that does not exist', t => {
  const { dir } = fixture(t);
  assert.throws(() => parseArgs(['--question', 'Q', join(dir, 'none.png')]), /not an existing file/);
});

test('images with the same base name are sent under their folder names', t => {
  const { make } = fixture(t);
  const before = make('before/a.png');
  const after = make('after/a.png');
  assert.deepEqual(sendNames([before, after, make('b.png')]), ['before_a.png', 'after_a.png', 'b.png']);
  assert.deepEqual(parseArgs(['--question', 'Q', before, after]).images, [before, after]);
});

test('rejects images whose folder-prefixed names still clash, naming both', t => {
  const { make } = fixture(t);
  const one = make('x/same/a.png');
  const two = make('y/same/A.png');
  assert.throws(() => parseArgs(['--question', 'Q', one, two]), error => error.message.includes(one) && error.message.includes(two));
});

test('accepts 12 images and rejects 13 with the limit', t => {
  const { make } = fixture(t);
  const paths = Array.from({ length: 13 }, (_, i) => make(`i${i}.png`));
  assert.equal(MAX_IMAGES, 12);
  assert.equal(parseArgs(['--question', 'Q', ...paths.slice(0, 12)]).images.length, 12);
  assert.throws(() => parseArgs(['--question', 'Q', ...paths]), error => error.message === 'at most 12 images per call (got 13); split the call');
});

test('--input takes inline or read only', t => {
  const { make } = fixture(t);
  const a = make('a.png');
  assert.equal(parseArgs(['--question', 'Q', '--input', 'read', a]).input, 'read');
  assert.throws(() => parseArgs(['--question', 'Q', '--input', 'x', a]), /--input/);
});

test('inline input rejects an unknown extension, read input does not', t => {
  const { make } = fixture(t);
  const a = make('a.bmp');
  assert.throws(() => parseArgs(['--question', 'Q', a]), /unsupported image type/);
  assert.equal(parseArgs(['--question', 'Q', '--input', 'read', a]).images.length, 1);
});

test('names byte-identical images in one line', () => {
  const lines = identicalLines([{ name: 'a.png', hash: '1' }, { name: 'b.png', hash: '2' }, { name: 'c.png', hash: '1' }, { name: 'd.png', hash: '1' }]);
  assert.deepEqual(lines, ['identical images: a.png = c.png = d.png']);
  assert.deepEqual(identicalLines([{ name: 'a.png', hash: '1' }, { name: 'b.png', hash: '2' }]), []);
});

test('maps extensions to media types', () => {
  assert.equal(mediaType('x.PNG'), 'image/png');
  assert.equal(mediaType('x.jpg'), 'image/jpeg');
  assert.equal(mediaType('x.jpeg'), 'image/jpeg');
  assert.equal(mediaType('x.webp'), 'image/webp');
  assert.equal(mediaType('x.gif'), 'image/gif');
  assert.throws(() => mediaType('x.tga'), /unsupported/);
});

test('the inline message labels each image, puts images before the question', () => {
  const message = buildInlineMessage('Why?', [{ name: 'a.png', path: 'a.png', data: 'AAA' }, { name: 'b.jpg', path: 'b.jpg', data: 'BBB' }]);
  assert.equal(message.type, 'user');
  assert.equal(message.message.role, 'user');
  assert.deepEqual(message.message.content, [
    { type: 'text', text: 'Image 1: a.png' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
    { type: 'text', text: 'Image 2: b.jpg' },
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'BBB' } },
    { type: 'text', text: 'Why?' }
  ]);
});

function entries(n) {
  return Array.from({ length: n }, (_, i) => buildLogEntry({ time: `2026-01-01T00:00:${String(i).padStart(2, '0')}.000Z`, input: 'inline', images: [{ name: 'a.png', path: 'C:/a.png' }], runs: [{ role: 'single', model: 'sonnet', prompt: 'Q', imageNames: ['a.png'], toolCalls: [], text: `## heading in report ${i}`, cost: 'c' }], cost: 'c' }));
}

test('trimLog keeps the newest 30 of 35 entries and the header', () => {
  const text = '# look log\n\n' + entries(35).join('\n');
  const trimmed = trimLog(text, 30);
  assert.ok(trimmed.startsWith('# look log\n\n'));
  assert.equal(trimmed.match(/^## 2026-/gm).length, 30);
  assert.ok(!trimmed.includes('00:00:04.000Z'));
  assert.ok(trimmed.includes('00:00:05.000Z'));
  assert.ok(trimmed.includes('00:00:34.000Z'));
  assert.equal(trimLog(text, 40), text);
});

test('a log entry shows the tool calls and the original path', () => {
  const entry = buildLogEntry({ time: '2026-01-01T00:00:00.000Z', input: 'read', images: [{ name: 'before_a.png', path: 'C:/before/a.png' }], runs: [{ role: 'single', model: 'sonnet', prompt: 'Q', imageNames: ['before_a.png'], toolCalls: ['Read', 'Read'], text: 'R', cost: 'look: 1 ms' }], cost: 'look: 1 ms' });
  assert.ok(entry.includes('- Image: before_a.png \u2190 C:/before/a.png'));
  assert.match(entry, /- Tool calls: Read x2/);
});

test('rejects a bad timeout', t => {
  const { make } = fixture(t);
  const a = make('a.png');
  for (const bad of ['0', '-3', 'abc', '']) assert.throws(() => parseArgs(['--question', 'Q', '--timeout', bad, a]), /--timeout/);
});

test('the prompt names every image and ends with the question unchanged', () => {
  const prompt = buildPrompt('What is  here?\nSecond line.', ['a.png', 'b.png']);
  assert.match(prompt, /current folder: a\.png, b\.png\. Read no other file and run no command\.\n\n/);
  assert.ok(prompt.endsWith('\n\nWhat is  here?\nSecond line.'));
});

const aims = [{ id: 'A9', text: 'the terraces do not lie parallel like the tiers of a cake' }, { id: 'A10', text: 'about one wall in ten drops vertically' }];
const ids = ['A9', 'A10'];
const rated = (model, a9, a10) => ({ model, role: 'rated', ratings: { A9: a9, A10: a10 } });

test('parseQuestion takes the aim lines out of the description', () => {
  const parsed = parseQuestion('Two shots of terrain.\n\n## Aims\n- A9: the terraces do not lie parallel\n- a_10-x: walls drop\n\n## Notes\nMore text.\n');
  assert.deepEqual(parsed.aims, [{ id: 'A9', text: 'the terraces do not lie parallel' }, { id: 'a_10-x', text: 'walls drop' }]);
  assert.ok(!parsed.description.includes('A9'));
  assert.ok(parsed.description.includes('Two shots of terrain.') && parsed.description.includes('More text.'));
  assert.deepEqual(parseQuestion('No aims here').aims, []);
});

test('parseQuestion rejects a duplicate id and an empty Aims section', () => {
  assert.throws(() => parseQuestion('D\n## Aims\n- A1: x\n- A1: y'), /duplicate aim id A1/);
  assert.throws(() => parseQuestion('D\n## aims\nnothing'), /no "- <id>: <aim>" line/);
});

test('parseVerdicts reads a good block, markdown and case', () => {
  assert.deepEqual(parseVerdicts('notes\nVERDICTS\nA9: clear\nA10: not seen\nEND', ids), { ratings: { A9: 'clear', A10: 'not seen' } });
  assert.deepEqual(parseVerdicts('**VERDICTS**\n- A9: **Clear**\n**A10:** STRONG\n**end**', ids), { ratings: { A9: 'clear', A10: 'strong' } });
});

test('parseVerdicts returns null for a missing id, an unknown rating, a repeat or no block', () => {
  assert.equal(parseVerdicts('VERDICTS\nA9: clear\nEND', ids), null);
  assert.equal(parseVerdicts('VERDICTS\nA9: clear\nA10: great\nEND', ids), null);
  assert.equal(parseVerdicts('VERDICTS\nA9: clear\nA9: faint\nA10: faint\nEND', ids), null);
  assert.equal(parseVerdicts('A9: clear\nA10: faint', ids), null);
});

test('aggregate: two runs agreeing on clear is met', () => {
  assert.deepEqual(aggregate(ids, [rated('sonnet', 'clear', 'strong'), rated('sonnet', 'clear', 'strong')]), ['A9: met — clear (2/2)', 'A10: met — strong (2/2)']);
});

test('aggregate: agreement on faint is not met', () => {
  assert.equal(aggregate(['A9'], [rated('sonnet', 'faint'), rated('sonnet', 'faint')])[0], 'A9: not met — faint (2/2)');
});

test('tie-break takes the majority and marks the line', () => {
  const runs = [rated('sonnet', 'faint', 'clear'), rated('sonnet', 'clear', 'clear'), { model: 'opus', role: 'tiebreak', ratings: { A9: 'clear', A10: 'clear' } }];
  const lines = aggregate(ids, runs);
  assert.equal(lines[0], 'A9: met — clear (2/3) (tie-break opus)');
  assert.equal(lines[1], 'A10: met — clear (3/3)');
});

test('aggregate: three different ratings are a split', () => {
  const runs = [rated('sonnet', 'faint', 'clear'), rated('sonnet', 'clear', 'clear'), { model: 'opus', role: 'tiebreak', ratings: { A9: 'strong', A10: 'clear' } }];
  assert.equal(aggregate(ids, runs)[0], 'A9: split — faint/clear/strong (1/3) (tie-break opus)');
});

test('aggregate: a missing rated run is covered by the tie-break', () => {
  const runs = [rated('sonnet', 'clear', 'clear'), { model: 'sonnet', role: 'rated', ratings: null }, { model: 'opus', role: 'tiebreak', ratings: { A9: 'clear', A10: 'faint' } }];
  assert.deepEqual(aggregate(ids, runs), ['A9: met — clear (2/2) (tie-break opus)', 'A10: split — clear/faint (1/2) (tie-break opus)']);
});

test('formatOutput keeps every verdict line and stays within 2500 characters', () => {
  const verdictLines = Array.from({ length: 5 }, (_, i) => `A${i}: met — clear (2/2)`);
  const long = Array.from({ length: 200 }, (_, i) => `- bullet number ${i} with some words`).join('\n');
  const out = formatOutput({ verdictLines, seenByBoth: long, freshEye: long });
  assert.ok(out.length <= 2500);
  for (const line of verdictLines) assert.ok(out.includes(line));
  assert.ok(out.includes('Seen by both\n') && out.includes('Fresh eye\n') && out.includes('…'));
  const short = formatOutput({ verdictLines, seenByBoth: 'x', freshEye: 'y' });
  assert.equal(short, `Verdicts\n${verdictLines.join('\n')}\n\nSeen by both\nx\n\nFresh eye\ny`);
  const squeezed = formatOutput({ verdictLines, seenByBoth: long, freshEye: 'y' }, 400);
  assert.ok(squeezed.length <= 400 && squeezed.includes('y'));
});

test('the fresh-eye prompt holds the description and no aim text', () => {
  const prompt = freshPrompt('Two shots of terrain.');
  assert.ok(prompt.includes('Two shots of terrain.'));
  for (const aim of aims) assert.ok(!prompt.includes(aim.text) && !prompt.includes(aim.id));
  assert.ok(ratedPrompt('D', aims).includes('- A9: the terraces do not lie parallel like the tiers of a cake'));
});

const solid = (width, height, channels, rgb) => {
  const data = new Uint8Array(width * height * channels);
  for (let p = 0; p < width * height; p++) {
    data.set(rgb, p * channels);
    if (channels === 4) data[p * 4 + 3] = 255;
  }
  return { width, height, channels, data };
};

function pngChunk(type, body) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'latin1');
  Buffer.from(body).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

// Wraps hand-filtered rows (filter byte first) in a PNG of the given colour type.
function rawPng(width, height, colour, rows, extra = []) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = colour;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), ...extra, pngChunk('IDAT', deflateSync(Buffer.from(rows.flat()))), pngChunk('IEND', Buffer.alloc(0))]);
}

test('crc32 matches the known check value', () => {
  assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
});

test('encodePng then decodePng round-trips RGB and RGBA', () => {
  for (const channels of [3, 4]) {
    const image = { width: 5, height: 3, channels, data: Uint8Array.from({ length: 5 * 3 * channels }, (_, i) => (i * 37) % 256) };
    const back = decodePng(encodePng(image));
    assert.deepEqual([back.width, back.height, back.channels], [5, 3, channels]);
    assert.deepEqual([...back.data], [...image.data]);
  }
});

test('decodePng undoes the Sub, Up, Average and Paeth filters', () => {
  const truth = [[10, 20, 30, 40, 50, 60], [15, 25, 35, 45, 70, 90], [200, 100, 50, 190, 120, 60]];
  const left = (row, i) => (i >= 3 ? row[i - 3] : 0);
  const up = (y, i) => (y ? truth[y - 1][i] : 0);
  const upLeft = (y, i) => (y && i >= 3 ? truth[y - 1][i - 3] : 0);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const predictors = {
    1: (y, i) => left(truth[y], i),
    2: (y, i) => up(y, i),
    3: (y, i) => (left(truth[y], i) + up(y, i)) >> 1,
    4: (y, i) => paeth(left(truth[y], i), up(y, i), upLeft(y, i))
  };
  for (const filter of [1, 2, 3, 4]) {
    const rows = truth.map((row, y) => [filter, ...row.map((value, i) => (value - predictors[filter](y, i)) & 255)]);
    assert.deepEqual([...decodePng(rawPng(2, 3, 2, rows)).data], truth.flat(), `filter ${filter}`);
  }
});

test('decodePng reads gray, gray+alpha and palette images as RGB or RGBA', () => {
  assert.deepEqual([...decodePng(rawPng(2, 1, 0, [[0, 7, 9]])).data], [7, 7, 7, 9, 9, 9]);
  const grayAlpha = decodePng(rawPng(1, 1, 4, [[0, 50, 128]]));
  assert.equal(grayAlpha.channels, 4);
  assert.deepEqual([...grayAlpha.data], [50, 50, 50, 128]);
  const palette = pngChunk('PLTE', Buffer.from([255, 0, 0, 0, 255, 0]));
  assert.deepEqual([...decodePng(rawPng(2, 1, 3, [[0, 1, 0]], [palette])).data], [0, 255, 0, 255, 0, 0]);
  const alpha = decodePng(rawPng(2, 1, 3, [[0, 1, 0]], [palette, pngChunk('tRNS', Buffer.from([10, 20]))]));
  assert.deepEqual([...alpha.data], [0, 255, 0, 20, 255, 0, 0, 10]);
});

test('decodePng rejects 16-bit, interlaced and non-PNG input', () => {
  const sixteen = rawPng(1, 1, 2, [[0, 1, 2, 3]]);
  sixteen[24] = 16;
  assert.throws(() => decodePng(sixteen), /unsupported PNG/);
  const interlaced = rawPng(1, 1, 2, [[0, 1, 2, 3]]);
  interlaced[28] = 1;
  assert.throws(() => decodePng(interlaced), /unsupported PNG/);
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /unsupported PNG/);
});

test('diffImages gives the changed share and the bounding box', () => {
  const a = solid(10, 10, 3, [0, 0, 0]);
  const b = solid(10, 10, 4, [0, 0, 0]);
  for (const [x, y] of [[2, 3], [4, 3], [4, 6]]) b.data.set([200, 0, 0], (y * 10 + x) * 4);
  const { share, box } = diffImages(a, b);
  assert.equal(share, 0.03);
  assert.deepEqual(box, { x: 2, y: 3, w: 3, h: 4 });
});

test('diffImages ignores a change of 10 and counts one of 20', () => {
  const a = solid(4, 4, 3, [100, 100, 100]);
  assert.deepEqual(diffImages(a, solid(4, 4, 3, [110, 90, 100])), { share: 0, box: null });
  assert.equal(diffImages(a, solid(4, 4, 3, [120, 100, 100])).share, 1);
  assert.equal(diffImages(a, solid(4, 4, 3, [110, 100, 100]), 5).share, 1);
});

test('diffImages reports differing sizes as a full change', () => {
  assert.deepEqual(diffImages(solid(4, 4, 3, [0, 0, 0]), solid(5, 4, 3, [0, 0, 0])), { share: 1, box: null, note: 'sizes differ' });
});

test('padBox pads and clamps, and cropImage cuts that region', () => {
  assert.deepEqual(padBox({ x: 5, y: 5, w: 10, h: 10 }, 16, 100, 100), { x: 0, y: 0, w: 31, h: 31 });
  assert.deepEqual(padBox({ x: 90, y: 50, w: 8, h: 10 }, 16, 100, 100), { x: 74, y: 34, w: 26, h: 42 });
  const image = { width: 4, height: 3, channels: 3, data: Uint8Array.from({ length: 36 }, (_, i) => i) };
  const crop = cropImage(image, { x: 1, y: 1, w: 2, h: 2 });
  assert.deepEqual([...crop.data], [15, 16, 17, 18, 19, 20, 27, 28, 29, 30, 31, 32]);
});

test('parseCompareVerdicts reads a good block and ignores markdown and case', () => {
  const text = 'notes\n**VERDICTS**\n- C1: X Clear; Y not seen; better x\n`C2: X faint; Y strong; better Same.`\nEND';
  assert.deepEqual(parseCompareVerdicts(text, ['C1', 'C2']), { ratings: { C1: { x: 'clear', y: 'not seen', better: 'X' }, C2: { x: 'faint', y: 'strong', better: 'same' } } });
});

test('parseCompareVerdicts returns null for a missing id, unknown word or no block', () => {
  assert.equal(parseCompareVerdicts('VERDICTS\nC1: X clear; Y faint; better X\nEND', ['C1', 'C2']), null);
  assert.equal(parseCompareVerdicts('VERDICTS\nC1: X great; Y faint; better X\nEND', ['C1']), null);
  assert.equal(parseCompareVerdicts('VERDICTS\nC1: X clear; Y faint; better both\nEND', ['C1']), null);
  assert.equal(parseCompareVerdicts('C1: X clear; Y faint; better X', ['C1']), null);
});

test('comparePrompt names neither folder nor before/after and ends with the block', () => {
  const prompt = comparePrompt('Shots of a game.', [{ id: 'C1', text: 'cliffs vary' }]);
  assert.match(prompt, /set X and set Y/);
  assert.doesNotMatch(prompt, /before|after/i);
  assert.ok(prompt.includes('- C1: cliffs vary'));
  assert.ok(prompt.includes('VERDICTS\nC1: X <rating>; Y <rating>; better X|same|Y\nEND'));
});

test('the key maps X=after and X=before to the same answer', () => {
  const asked = { C1: { x: 'strong', y: 'faint', better: 'X' } };
  const swapped = { C1: { x: 'faint', y: 'strong', better: 'Y' } };
  assert.deepEqual(mapVerdicts(asked, true), { C1: { after: 'strong', before: 'faint', better: 'after' } });
  assert.deepEqual(mapVerdicts(swapped, false), { C1: { after: 'strong', before: 'faint', better: 'after' } });
  assert.equal(mapVerdicts({ C1: { x: 'clear', y: 'clear', better: 'same' } }, false).C1.better, 'same');
  assert.equal(mapVerdicts({ C1: { x: 'clear', y: 'clear', better: 'X' } }, false).C1.better, 'before');
});

const answer = (after, before, better) => ({ C1: { after, before, better } });
const ratedRun = (mapped, model = 'sonnet') => ({ model, role: 'rated', mapped });

test('aggregateCompare: two runs agreeing with after better and clear is met', () => {
  assert.deepEqual(aggregateCompare(['C1'], [ratedRun(answer('clear', 'faint', 'after')), ratedRun(answer('clear', 'not seen', 'after'))]),
    ['C1: met — after clear, before faint, after better (2/2)']);
});

test('aggregateCompare: after better but only faint is not met', () => {
  assert.deepEqual(aggregateCompare(['C1'], [ratedRun(answer('faint', 'not seen', 'after')), ratedRun(answer('faint', 'not seen', 'after'))]),
    ['C1: not met — after faint, before not seen, after better (2/2)']);
});

test('aggregateCompare: before better is not met even when after is strong', () => {
  assert.deepEqual(aggregateCompare(['C1'], [ratedRun(answer('strong', 'strong', 'before')), ratedRun(answer('strong', 'strong', 'before'))]),
    ['C1: not met — after strong, before strong, before better (2/2)']);
  assert.match(aggregateCompare(['C1'], [ratedRun(answer('strong', 'strong', 'same')), ratedRun(answer('strong', 'strong', 'same'))])[0], /^C1: not met — .*, same \(2\/2\)$/);
});

test('aggregateCompare: the tie-break gives the majority and is marked', () => {
  const runs = [ratedRun(answer('clear', 'faint', 'after')), ratedRun(answer('faint', 'faint', 'same')), { model: 'opus', role: 'tiebreak', mapped: answer('clear', 'faint', 'after') }];
  assert.deepEqual(aggregateCompare(['C1'], runs), ['C1: met — after clear, before faint, after better (2/3) (tie-break opus)']);
});

test('aggregateCompare: three different answers are a split that lists each run', () => {
  const runs = [ratedRun(answer('clear', 'faint', 'after')), ratedRun(answer('faint', 'faint', 'same')), { model: 'opus', role: 'tiebreak', mapped: answer('strong', 'faint', 'before') }];
  assert.deepEqual(aggregateCompare(['C1'], runs), ['C1: split — after clear/after | after faint/same | after strong/before (1/3) (tie-break opus)']);
});

test('aggregateCompare: a missing rated run is covered by the tie-break', () => {
  const runs = [ratedRun(answer('clear', 'faint', 'after')), ratedRun(null), { model: 'opus', role: 'tiebreak', mapped: answer('clear', 'faint', 'after') }];
  assert.deepEqual(aggregateCompare(['C1'], runs), ['C1: met — after clear, before faint, after better (2/2) (tie-break opus)']);
});

test('gateDecision stops when every measured pair is below the threshold', () => {
  const pairs = [{ name: 'a.png', share: 0.001, box: { x: 1, y: 1, w: 2, h: 2 } }, { name: 'b.png', share: 0, box: null }];
  assert.deepEqual(gateDecision(pairs, 0.5), { stop: true, lines: ['change not in capture', 'a.png: 0.10% changed', 'b.png: 0.00% changed'] });
});

test('gateDecision goes on with a change line when a pair reaches the threshold', () => {
  const pairs = [{ name: 'a.png', share: 0.001, box: { x: 1, y: 1, w: 2, h: 2 } }, { name: 'b.png', share: 0.2, box: { x: 4, y: 5, w: 60, h: 70 } }];
  assert.deepEqual(gateDecision(pairs, 0.5), { stop: false, lines: ['change: a.png 0.10% in box 1,1 2x2', 'change: b.png 20.00% in box 4,5 60x70'] });
  assert.equal(gateDecision(pairs, 0.05).stop, false);
});

test('gateDecision never stops while a pair is unmeasured or when none was measured', () => {
  const unmeasured = { name: 'c.jpg', share: null, reason: 'JPEG' };
  const quiet = { name: 'a.png', share: 0, box: null };
  const decision = gateDecision([quiet, unmeasured], 0.5);
  assert.equal(decision.stop, false);
  assert.equal(decision.lines[0], 'change share not measured (c.jpg: JPEG)');
  assert.equal(gateDecision([unmeasured], 0.5).stop, false);
  assert.equal(gateDecision([], 0.5).stop, false);
});

test('--compare pairs files by name, ignoring case, and names a lone file', t => {
  const { dir, make } = fixture(t);
  make('before/A.png'); make('before/b.png'); make('after/a.PNG'); make('after/b.png'); make('after/notes.txt');
  const pairs = pairFolders(join(dir, 'before'), join(dir, 'after'));
  assert.deepEqual(pairs.map(pair => pair.name), ['A.png', 'b.png']);
  make('after/extra.png');
  assert.throws(() => pairFolders(join(dir, 'before'), join(dir, 'after')), /extra\.png is only in/);
});

test('--compare needs aims, forbids images and caps pairs at six', t => {
  const { dir, make } = fixture(t);
  for (let i = 0; i < 7; i++) { make(`before/v${i}.png`); make(`after/v${i}.png`); }
  const before = join(dir, 'before');
  const after = join(dir, 'after');
  const aims = '## Aims\n- C1: cliffs vary';
  assert.throws(() => parseArgs(['--question', aims, '--compare', before, after]), /at most 6 pairs/);
  rmSync(join(before, 'v6.png')); rmSync(join(after, 'v6.png'));
  const options = parseArgs(['--question', `Shots.\n${aims}`, '--compare', before, after, '--threshold', '1']);
  assert.equal(options.pairs.length, 6);
  assert.equal(options.threshold, 1);
  assert.throws(() => parseArgs(['--question', 'No aims here', '--compare', before, after]), /Aims/);
  assert.throws(() => parseArgs(['--question', aims, '--compare', before, after, join(before, 'v0.png')]), /no image arguments/);
});

test('ollamaRequest strips the prefix, keeps images inline in order and unloads the model', () => {
  const body = ollamaRequest({ model: 'ollama:qwen3-vl:8b', system: 'S', question: 'Q?', images: [{ name: 'a.png', data: 'AAA' }, { name: 'b.png', data: 'BBB' }] });
  assert.equal(body.model, 'qwen3-vl:8b');
  assert.equal(body.stream, false);
  assert.equal(body.keep_alive, 0);
  assert.equal(body.options.num_ctx, 16384);
  assert.deepEqual(body.messages[0], { role: 'system', content: 'S' });
  assert.deepEqual(body.messages[1].images, ['AAA', 'BBB']);
  assert.equal(body.messages[1].content, 'Images, in order: Image 1: a.png, Image 2: b.png\n\nQ?');
});

test('ollamaRequest without images has no images key and no list line', () => {
  const body = ollamaRequest({ model: 'ollama:minicpm-v', system: 'S', question: 'Q?', images: [] });
  assert.equal('images' in body.messages[1], false);
  assert.equal(body.messages[1].content, 'Q?');
});

test('stripThink removes a leading think block only', () => {
  assert.equal(stripThink('<think>\nhmm\n</think>\n\nAnswer <think>x</think>'), 'Answer <think>x</think>');
  assert.equal(stripThink('Plain'), 'Plain');
});

test('the queue runs tasks one after another while unqueued tasks overlap', async () => {
  const log = [];
  const task = name => async () => {
    log.push(`start ${name}`);
    await new Promise(done => setTimeout(done, 30));
    log.push(`end ${name}`);
  };
  const queue = createQueue();
  await Promise.all([queue(task('a')), queue(task('b'))]);
  assert.deepEqual(log, ['start a', 'end a', 'start b', 'end b']);
  log.length = 0;
  await Promise.all([task('c')(), task('d')()]);
  assert.deepEqual(log, ['start c', 'start d', 'end c', 'end d']);
});

test('a failed queued task does not block the next', async () => {
  const queue = createQueue();
  const failing = queue(async () => { throw new Error('x'); });
  const next = queue(async () => 'ok');
  await assert.rejects(failing);
  assert.equal(await next, 'ok');
});

test('the log prints each run time span', () => {
  const entry = buildLogEntry({ time: 't', input: 'inline', images: [], runs: [{ role: 'rated 1', model: 'ollama:m', prompt: 'Q', imageNames: [], toolCalls: [], text: 'R', cost: 'c', started: '2026-01-01T00:00:00.000Z', ended: '2026-01-01T00:00:05.000Z' }], cost: 'c' });
  assert.match(entry, /- time: 2026-01-01T00:00:00.000Z → 2026-01-01T00:00:05.000Z/);
});
