// Run by hand: node scripts/refresh.mjs
// Replaces data/claudisms.json with the current upstream list and reports what changed,
// so new entries can be reviewed against data/overrides.json before the change is committed.
import fs from 'node:fs';
import { LIST_FILE, OVERRIDES_FILE } from './match.mjs';

const URL = 'https://claudisms.ai/claudisms.json';

const res = await fetch(URL);
if (!res.ok) throw new Error(`${URL}: HTTP ${res.status}`);
const next = await res.json();
if (!Array.isArray(next.terms) || next.terms.some((t) => !t.id || !Array.isArray(t.aliases))) {
  throw new Error(`${URL}: no terms[] with id and aliases; the format changed, so nothing was written`);
}

const prev = JSON.parse(fs.readFileSync(LIST_FILE, 'utf8'));
const overrides = JSON.parse(fs.readFileSync(OVERRIDES_FILE, 'utf8'));
const before = new Map(prev.terms.map((t) => [t.id, t]));
const after = new Map(next.terms.map((t) => [t.id, t]));

const added = next.terms.filter((t) => !before.has(t.id));
const removed = prev.terms.filter((t) => !after.has(t.id));
const changed = next.terms.filter((t) => before.has(t.id) && JSON.stringify(before.get(t.id).aliases) !== JSON.stringify(t.aliases));
const orphans = Object.keys(overrides.terms ?? {}).filter((id) => !after.has(id));

fs.writeFileSync(LIST_FILE, JSON.stringify(next, null, 2) + '\n');

const section = (title, items) => console.log(`${title}: ${items.length}${items.length ? '\n' + items.map((s) => `  ${s}`).join('\n') : ''}`);
console.log(`claudisms.json: ${prev.updated} -> ${next.updated}, ${prev.terms.length} -> ${next.terms.length} terms`);
section('New (on by default, with an extracted hint)', added.map((t) => `${t.id}: ${t.aliases.join(' / ')}`));
section('Removed', removed.map((t) => t.id));
section('Aliases changed', changed.map((t) => `${t.id}: ${t.aliases.join(' / ')}`));
section('Overrides with no upstream term (remove them, unless they are in extra)', orphans);
