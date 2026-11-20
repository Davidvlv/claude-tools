// Finds claudisms in prose and builds the feedback the agent reads.
// The list stays on disk; only the feedback for actual hits reaches the model.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const dataDir = fileURLToPath(new URL('../data/', import.meta.url));
export const LIST_FILE = dataDir + 'claudisms.json';
export const OVERRIDES_FILE = dataDir + 'overrides.json';

const MAX_HITS = 8;
const CLAUSE_CHARS = 100;
const HINT_CHARS = 120;
export const MASK = '[rewording]';

export function loadRules(list = readJson(LIST_FILE), overrides = readJson(OVERRIDES_FILE)) {
  const terms = overrides.terms ?? {};
  const rules = [];
  for (const t of [...list.terms, ...(overrides.extra ?? [])]) {
    const o = terms[t.id] ?? {};
    if (o.off) continue;
    const sources = [...(o.aliases ?? t.aliases ?? []).map(aliasSource), ...(o.patterns ?? t.patterns ?? [])];
    if (sources.length === 0) continue;
    // Longest first, so "that's the whole game" wins over "the whole game" at the same spot.
    sources.sort((a, b) => b.length - a.length);
    rules.push({
      id: t.id,
      re: new RegExp(sources.map((s) => `(?:${s})`).join('|'), 'giu'),
      hint: o.hint ?? t.hint ?? extractHint(t.definition ?? ''),
      // One upstream entry can group different words (robust, seamless, holistic), so a phrase may need its own hint.
      phraseHints: new Map(Object.entries(o.phraseHints ?? {}).map(([k, v]) => [phraseKey(k), v])),
    });
  }
  return rules;
}

function phraseKey(s) {
  return s.toLowerCase().replace(/’/gu, "'").replace(/s+/gu, ' ').trim();
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// Upstream aliases are plain phrases with a few placeholders: "X", "[verb]", "[keep/own/decide]".
export function aliasSource(alias) {
  const a = alias.trim().replace(/(?:…|\.\.\.)$/u, '').trim();
  const parts = a.split(/(\[[^\]]+\]|\bX\b)/u).map((p) => {
    if (p === 'X') return "[\\w'-]+(?:\\s+[\\w'-]+){0,2}";
    const opts = p.match(/^\[([^\]]+)\]$/u);
    if (opts) return opts[1].includes('/') ? `(?:${opts[1].split('/').map(escape).join('|')})` : "[\\w'-]+";
    return escape(p).replace(/\s+/gu, '\\s+').replace(/['’]/gu, "['’]");
  });
  return `(?<![\\w-])${parts.join('')}(?![\\w-])`;
}

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

// Upstream definitions run 50-200 words; the hint is the sentence that says what to do instead.
export function extractHint(definition) {
  const sentences = definition
    .replace(/^\s*-\s*/u, '')
    .split(/(?<=[.!?])\s+/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const pick =
    sentences.find((s) => /^(?:replace|say|use|cut|state|name|write|just|drop|delete|lead|give|instead|show)\b/iu.test(s)) ??
    sentences.find((s) => /\binstead\b/iu.test(s)) ??
    sentences[1] ??
    sentences[0] ??
    'Say the plain thing.';
  return shorten(pick, HINT_CHARS);
}

function shorten(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(' ') > max / 2 ? cut.lastIndexOf(' ') : cut.length) + '…';
}

// Blanks out text the agent may legitimately quote, keeping offsets so hits map back to the original.
// The blank is a control character, not a space, so \s and word-boundary rules do not run across it,
// and it replaces UTF-16 units (no u flag) so emoji do not shift the offsets.
export function blankExempt(text, { quotes = true } = {}) {
  const blank = (m) => m.replace(/[^\n]/g, '\u0001');
  let t = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gmu, blank);
  t = t.replace(/`[^`\n]+`/gu, blank);
  t = t.replace(/\bhttps?:\/\/\S+/gu, blank);
  if (quotes) t = t.replace(/"[^"\n]{1,300}"|“[^”\n]{1,300}”/gu, blank);
  return t;
}

export function findHits(text, rules, opts) {
  const scan = blankExempt(text, opts);
  const hits = [];
  for (const r of rules) {
    r.re.lastIndex = 0;
    for (const m of scan.matchAll(r.re)) {
      if (m[0].length === 0) continue;
      hits.push({ id: r.id, hint: r.phraseHints.get(phraseKey(m[0])) ?? r.hint, index: m.index, end: m.index + m[0].length, match: text.slice(m.index, m.index + m[0].length) });
    }
  }
  hits.sort((a, b) => a.index - b.index || b.end - a.end);
  const kept = [];
  for (const h of hits) if (!kept.length || h.index >= kept[kept.length - 1].end) kept.push(h);
  for (const h of kept) Object.assign(h, clauseSpan(text, h.index, h.end));
  return kept;
}

// A clause is the sentence around the hit, bounded by sentence punctuation, table cells and lines,
// with any list, quote or heading marker left outside so masking keeps the markdown shape.
export function clauseSpan(text, index, end) {
  let start = index;
  while (start > 0 && !/[\n|]/u.test(text[start - 1]) && !(/[.!?]/u.test(text[start - 2] ?? '') && /\s/u.test(text[start - 1]))) start--;
  const lead = text.slice(start, index).match(/^\s*(?:(?:[-*+]|\d+[.)]|>|#{1,6})\s+)*/u)[0];
  start += Math.min(lead.length, index - start);
  let stop = end;
  while (stop < text.length && !/[\n|]/u.test(text[stop])) {
    if (/[.!?]/u.test(text[stop]) && (stop + 1 >= text.length || /\s/u.test(text[stop + 1]))) {
      stop++;
      break;
    }
    stop++;
  }
  while (stop > start && /\s/u.test(text[stop - 1])) stop--;
  return { clauseStart: start, clauseEnd: stop, clause: text.slice(start, stop) };
}

export function mask(text, hits) {
  const spans = hits.map((h) => [h.clauseStart, h.clauseEnd]).sort((a, b) => a[0] - b[0]);
  let out = '';
  let pos = 0;
  for (const [s, e] of spans) {
    if (e <= pos) continue;
    out += text.slice(pos, Math.max(s, pos)) + MASK;
    pos = e;
  }
  return out + text.slice(pos);
}

// Hits the change adds: per rule, only as many as the new text has beyond the old,
// preferring hits whose clause does not already appear in the old text.
export function addedHits(oldText, newText, rules, opts) {
  const before = new Map();
  for (const h of findHits(oldText, rules, opts)) before.set(h.id, (before.get(h.id) ?? 0) + 1);
  const byId = new Map();
  for (const h of findHits(newText, rules, opts)) byId.set(h.id, [...(byId.get(h.id) ?? []), h]);
  const added = [];
  for (const [id, hs] of byId) {
    const extra = hs.length - (before.get(id) ?? 0);
    if (extra <= 0) continue;
    const fresh = hs.filter((h) => !oldText.includes(h.clause));
    added.push(...[...fresh, ...hs.filter((h) => !fresh.includes(h))].slice(0, extra));
  }
  return added.sort((a, b) => a.index - b.index);
}

export function hitLines(hits) {
  const lines = hits.slice(0, MAX_HITS).map((h) => `- "${h.match}" in "${clip(h)}" -> ${h.hint}`);
  if (hits.length > MAX_HITS) lines.push(`- +${hits.length - MAX_HITS} more`);
  return lines.join('\n');
}

function clip(h) {
  const c = h.clause.replace(/\s+/gu, ' ');
  if (c.length <= CLAUSE_CHARS) return c;
  const at = Math.max(0, Math.min(h.index - h.clauseStart - CLAUSE_CHARS / 3, c.length - CLAUSE_CHARS));
  return (at > 0 ? '…' : '') + c.slice(at, at + CLAUSE_CHARS).trim() + (at + CLAUSE_CHARS < c.length ? '…' : '');
}
