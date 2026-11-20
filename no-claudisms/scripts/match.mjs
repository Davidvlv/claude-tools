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
// with any list, quote or heading marker and a leading bold label ("**Plan:**") left outside,
// so masking or rewording keeps the markdown shape.
export function clauseSpan(text, index, end) {
  let start = index;
  while (start > 0 && !/[\n|]/u.test(text[start - 1]) && !(/[.!?]/u.test(text[start - 2] ?? '') && /\s/u.test(text[start - 1]))) start--;
  const lead = text.slice(start, index).match(/^\s*(?:(?:[-*+]|\d+[.)]|>|#{1,6})\s+)*(?:\*\*[^*\n]{1,60}\*\*\s+)?/u)[0];
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

// Hits whose clauses overlap share one group, so each sentence is reworded or masked once.
export function clauseGroups(text, hits) {
  const groups = [];
  for (const h of [...hits].sort((x, y) => x.clauseStart - y.clauseStart)) {
    const g = groups[groups.length - 1];
    if (g && h.clauseStart < g.end) {
      g.end = Math.max(g.end, h.clauseEnd);
      g.hits.push(h);
    } else {
      groups.push({ start: h.clauseStart, end: h.clauseEnd, hits: [h] });
    }
  }
  for (const g of groups) g.clause = text.slice(g.start, g.end);
  return groups;
}

// A null replacement masks its clause.
export function replaceClauses(text, groups, replacements) {
  let out = '';
  let pos = 0;
  groups.forEach((g, i) => {
    out += text.slice(pos, g.start) + (replacements[i] ?? MASK);
    pos = g.end;
  });
  return out + text.slice(pos);
}

export function mask(text, hits) {
  const groups = clauseGroups(text, hits);
  return replaceClauses(text, groups, groups.map(() => null));
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

// Numbers, paths, file names, identifiers, flags, acronyms and mid-sentence names.
const FACT = /\d+(?:[.,:]\d+)*%?|\w[\w-]*(?:[./\\:#]\w[\w-]*)+|\w*_\w+|\b[a-z]+[A-Z]\w*|\b[A-Z][A-Z0-9]+\b|(?<![\w-])--?[a-z][\w-]*|(?<=\S\s+)[A-Z][a-z]\w*/gu;
const NEGATION = /\b(?:not|no|never|none|nothing|nobody|nor|neither|without|cannot)\b|n['’]t\b/giu;

// A rewrite may change only wording: every fact of the clause outside the flagged phrases must
// survive it, and it may drop only the negations inside those phrases ("it's not X, it's Y").
// group: { start, clause, hits } from clauseGroups.
export function keepsFacts(group, rewrite) {
  let outside = group.clause;
  for (const h of group.hits) {
    const a = h.index - group.start;
    const b = h.end - group.start;
    outside = outside.slice(0, a) + ' '.repeat(b - a) + outside.slice(b);
  }
  const count = (text, s) => text.split(s).length - 1;
  for (const fact of new Set(outside.match(FACT) ?? [])) if (count(rewrite, fact) < count(outside, fact)) return false;
  const negations = (s) => (s.match(NEGATION) ?? []).length;
  const after = negations(rewrite);
  return after <= negations(group.clause) && after >= negations(outside);
}

export function hitLines(hits) {
  const shown = (h) => (h.shown ? ` (the person saw "${shorten(h.shown.replace(/\s+/gu, ' '), CLAUSE_CHARS)}")` : '');
  const lines = hits.slice(0, MAX_HITS).map((h) => `- "${h.match}" in "${clip(h)}" -> ${h.hint}${shown(h)}`);
  if (hits.length > MAX_HITS) lines.push(`- +${hits.length - MAX_HITS} more`);
  return lines.join('\n');
}

function clip(h) {
  const c = h.clause.replace(/\s+/gu, ' ');
  if (c.length <= CLAUSE_CHARS) return c;
  const at = Math.max(0, Math.min(h.index - h.clauseStart - CLAUSE_CHARS / 3, c.length - CLAUSE_CHARS));
  return (at > 0 ? '…' : '') + c.slice(at, at + CLAUSE_CHARS).trim() + (at + CLAUSE_CHARS < c.length ? '…' : '');
}
