// Dev tool for tuning data/overrides.json: node scripts/corpus.mjs <file-or-folder>...
// Counts hits per rule in markdown/text files and in the assistant text of session transcripts (.jsonl),
// and prints a few example clauses per rule, so noisy rules can be turned off or narrowed.
import fs from 'node:fs';
import path from 'node:path';
import { loadRules, findHits } from './match.mjs';

const EXAMPLES = Number(process.env.EXAMPLES ?? 3);
const rules = loadRules();
const stats = new Map();
let texts = 0;

for (const arg of process.argv.slice(2)) walk(path.resolve(arg));

function walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) {
    for (const f of fs.readdirSync(p)) if (f !== 'node_modules' && !f.startsWith('.git')) walk(path.join(p, f));
  } else if (/\.(?:md|mdx|markdown|txt)$/iu.test(p)) {
    scan(fs.readFileSync(p, 'utf8'), p);
  } else if (p.endsWith('.jsonl')) {
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type !== 'assistant' || !Array.isArray(e.message?.content)) continue;
      for (const c of e.message.content) if (c.type === 'text' && c.text) scan(c.text, p);
    }
  }
}

function scan(text, source) {
  texts++;
  for (const h of findHits(text, rules)) {
    const s = stats.get(h.id) ?? { count: 0, matches: new Map(), examples: [] };
    s.count++;
    s.matches.set(h.match.toLowerCase(), (s.matches.get(h.match.toLowerCase()) ?? 0) + 1);
    if (s.examples.length < EXAMPLES) s.examples.push(`${path.basename(source)}: ${h.clause.replace(/\s+/gu, ' ').slice(0, 160)}`);
    stats.set(h.id, s);
  }
}

console.log(`${texts} texts scanned`);
for (const [id, s] of [...stats].sort((a, b) => b[1].count - a[1].count)) {
  const top = [...s.matches].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([m, n]) => `${m}×${n}`).join(', ');
  console.log(`\n${id}: ${s.count}  (${top})`);
  for (const ex of s.examples) console.log(`    ${ex}`);
}
