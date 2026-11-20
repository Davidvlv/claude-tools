// One entry point for every no-claudisms hook; hooks/hooks.json routes all events here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, findHits, addedHits, mask, hitLines } from './match.mjs';

const PROSE_FILE = /\.(?:md|mdx|markdown|txt)$/iu;
const PUBLISH_COMMAND = /\bgit\s+(?:-[cC]\s+\S+\s+)*commit\b|\bgh\s+(?:pr|issue)\s+(?:create|edit|comment)\b|\bgh\s+pr\s+review\b/u;
const BODY_FILE = /(?:^|\s)(?:-F|--file|--body-file)(?:\s+|=)(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))/gu;
const STATE_DAYS = 2;

export async function handle(input, { rules = loadRules(), stateDir = defaultStateDir() } = {}) {
  switch (input.hook_event_name) {
    case 'MessageDisplay':
      return onDisplay(input, rules, stateDir);
    case 'Stop':
      return onStop(input, rules, stateDir);
    case 'SubagentStop':
      return onSubagentStop(input, rules);
    case 'PreToolUse':
      return onPreToolUse(input, rules, stateDir);
    default:
      return undefined;
  }
}

// The display hook only hides text on screen; the model never sees the masked version.
// It records what it hid so the Stop hook can ask for the reworded content.
function onDisplay(input, rules, stateDir) {
  const state = readState(stateDir, input.session_id);
  const turn = turnOf(state, input);
  if (turn.requested) return undefined;
  const hits = findHits(input.delta ?? '', rules);
  if (hits.length === 0) return undefined;
  turn.hits.push(...hits.map(({ id, match, clause, clauseStart, index, hint }) => ({ id, match, clause, clauseStart, index, hint })));
  writeState(stateDir, input.session_id, state);
  return { hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: mask(input.delta, hits) } };
}

function onStop(input, rules, stateDir) {
  const state = readState(stateDir, input.session_id);
  const turn = turnOf(state, input);
  if (input.stop_hook_active || turn.requested) {
    delete state.turns[turnKey(input)];
    writeState(stateDir, input.session_id, state);
    return undefined;
  }
  // The final message is checked here too, for clients where the display hook does not run.
  const hits = [...turn.hits];
  for (const h of findHits(input.last_assistant_message ?? '', rules)) {
    if (!hits.some((k) => k.id === h.id && k.clause === h.clause)) hits.push(h);
  }
  if (hits.length === 0) {
    if (state.turns[turnKey(input)]?.hits.length) {
      delete state.turns[turnKey(input)];
      writeState(stateDir, input.session_id, state);
    }
    return undefined;
  }
  turn.requested = true;
  writeState(stateDir, input.session_id, state);
  return {
    decision: 'block',
    reason:
      'no-claudisms: messages in this turn used stock AI phrasing, and the person saw those clauses hidden. ' +
      'Send one short closing message that says the content of the flagged sentences again in plain words. ' +
      'Do no new work, and do not mention this check.\n' +
      hitLines(hits),
  };
}

function onSubagentStop(input, rules) {
  if (input.stop_hook_active) return undefined;
  const hits = findHits(input.last_assistant_message ?? '', rules);
  if (hits.length === 0) return undefined;
  return {
    decision: 'block',
    reason: 'no-claudisms: your report uses stock AI phrasing. Send the report again with these reworded in plain words:\n' + hitLines(hits),
  };
}

function onPreToolUse(input, rules, stateDir) {
  const target = prose(input);
  if (!target) return undefined;
  const hits = addedHits(target.before, target.after, rules, { quotes: target.quotes });
  if (hits.length === 0) return undefined;
  // A retry with the same hits passes: the phrase may be a name or the only fitting word.
  // The signature includes the turn, so a denial the agent answered by rewording
  // cannot let the same hits through in a later turn.
  const state = readState(stateDir, input.session_id);
  const signature = `${turnKey(input)}#` + hits.map((h) => `${h.id}:${h.match.toLowerCase()}`).join('|');
  if (state.denied[target.key] === signature) {
    delete state.denied[target.key];
    writeState(stateDir, input.session_id, state);
    return undefined;
  }
  state.denied[target.key] = signature;
  writeState(stateDir, input.session_id, state);
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: `no-claudisms: this ${target.what} adds stock AI phrasing. Reword these in plain words and try again:\n` + hitLines(hits),
    },
  };
}

// Returns the prose a tool call adds, or undefined when the call is not checked.
// Command text is scanned with quotes included, because -m "..." carries the message itself.
export function prose(input) {
  const ti = input.tool_input ?? {};
  switch (input.tool_name) {
    case 'Write':
      if (!PROSE_FILE.test(ti.file_path ?? '')) return undefined;
      return { key: ti.file_path, what: 'file', before: readText(ti.file_path), after: ti.content ?? '', quotes: true };
    case 'Edit':
      if (!PROSE_FILE.test(ti.file_path ?? '')) return undefined;
      return { key: ti.file_path, what: 'edit', before: ti.old_string ?? '', after: ti.new_string ?? '', quotes: true };
    case 'MultiEdit':
      if (!PROSE_FILE.test(ti.file_path ?? '')) return undefined;
      return {
        key: ti.file_path,
        what: 'edit',
        before: (ti.edits ?? []).map((e) => e.old_string ?? '').join('\n'),
        after: (ti.edits ?? []).map((e) => e.new_string ?? '').join('\n'),
        quotes: true,
      };
    case 'Bash':
    case 'PowerShell': {
      const command = ti.command ?? '';
      const kind = command.match(PUBLISH_COMMAND);
      if (!kind) return undefined;
      const files = [...command.matchAll(BODY_FILE)].map((m) => m[1] ?? m[2] ?? m[3]).filter((f) => f !== '-');
      const bodies = files.map((f) => readText(path.resolve(input.cwd ?? '.', f)));
      return { key: `command:${kind[0].replace(/\s+/gu, ' ')}`, what: 'command', before: '', after: [command, ...bodies].join('\n'), quotes: false };
    }
    default:
      return undefined;
  }
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// MessageDisplay and Stop share prompt_id within one user turn, including the continuation a Stop block starts.
function turnKey(input) {
  return input.prompt_id ?? input.turn_id ?? 'turn';
}

function turnOf(state, input) {
  return (state.turns[turnKey(input)] ??= { hits: [], requested: false });
}

function defaultStateDir() {
  return process.env.CLAUDE_PLUGIN_DATA || path.join(os.tmpdir(), 'no-claudisms');
}

function stateFile(dir, sessionId) {
  return path.join(dir, `${String(sessionId ?? 'none').replace(/[^\w-]/gu, '_')}.json`);
}

function readState(dir, sessionId) {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(dir, sessionId), 'utf8'));
    return { turns: s.turns ?? {}, denied: s.denied ?? {} };
  } catch {
    return { turns: {}, denied: {} };
  }
}

function writeState(dir, sessionId, state) {
  fs.mkdirSync(dir, { recursive: true });
  const file = stateFile(dir, sessionId);
  const fresh = !fs.existsSync(file);
  fs.writeFileSync(file, JSON.stringify(state));
  if (fresh) pruneState(dir);
}

function pruneState(dir) {
  const cutoff = Date.now() - STATE_DAYS * 86400000;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      if (f.endsWith('.json') && fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p);
    } catch {}
  }
}

async function main() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  // A broken hook must never block the agent, so any failure lets the text through unchanged.
  try {
    const out = await handle(JSON.parse(raw));
    if (out) process.stdout.write(JSON.stringify(out));
  } catch (err) {
    process.stderr.write(`no-claudisms: ${err.message}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
