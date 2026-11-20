// One entry point for every no-claudisms hook; hooks/hooks.json routes all events here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRules, findHits, addedHits, clauseGroups, replaceClauses, hitLines } from './match.mjs';
import { reword, CHILD_ENV } from './reword.mjs';
import { MODES, effectiveMode } from './mode.mjs';
import { logEdit, logDir } from './log.mjs';

const PROSE_FILE = /\.(?:md|mdx|markdown|txt)$/iu;
const PUBLISH_COMMAND = /\bgit\s+(?:-[cC]\s+\S+\s+)*commit\b|\bgh\s+(?:pr|issue)\s+(?:create|edit|comment)\b|\bgh\s+pr\s+review\b/u;
const BODY_FILE = /(?:^|\s)(?:-F|--file|--body-file)(?:\s+|=)(?:"([^"]+)"|'([^']+)'|([^\s;|&]+))/gu;
const STATE_DAYS = 2;
const EVENT_SCOPE = { MessageDisplay: 'chat', Stop: 'chat', UserPromptSubmit: 'chat', SubagentStop: 'output', PreToolUse: 'output' };
const MAX_NOTES = 8;

export async function handle(
  input,
  { rules = loadRules(), stateDir = defaultStateDir(), mode = process.env.CLAUDE_PLUGIN_OPTION_MODE, modeFile, rewordFn = reword, logTo = logDir() } = {},
) {
  // The reworder's own claude process must not run these hooks on its reply.
  if (process.env[CHILD_ENV]) return undefined;
  const scopes = MODES[effectiveMode(mode, modeFile)];
  if (!scopes.includes(EVENT_SCOPE[input.hook_event_name])) return undefined;
  const log = (event, fields) => logEdit({ session: input.session_id, cwd: input.cwd, event, ...fields }, { dir: logTo });
  switch (input.hook_event_name) {
    case 'MessageDisplay':
      return onDisplay(input, rules, stateDir, rewordFn, log);
    case 'Stop':
      return onStop(input, rules, stateDir, log);
    case 'UserPromptSubmit':
      return onPrompt(input, stateDir);
    case 'SubagentStop':
      return onSubagentStop(input, rules, log);
    case 'PreToolUse':
      return onPreToolUse(input, rules, stateDir, log);
    default:
      return undefined;
  }
}

// The display hook changes only the screen; the model and the transcript keep the original.
// Flagged sentences are reworded in place by Haiku. A sentence Haiku cannot fix is masked,
// and the Stop hook then asks the agent itself for the reworded content.
async function onDisplay(input, rules, stateDir, rewordFn, log) {
  const state = readState(stateDir, input.session_id);
  const turn = turnOf(state, input);
  const firstCall = !turn.displayed;
  turn.displayed = true;
  const text = input.delta ?? '';
  // After a rewrite request, the agent's reworded closing message is shown as written.
  const hits = turn.requested ? [] : findHits(text, rules);
  if (hits.length === 0) {
    if (firstCall) writeState(stateDir, input.session_id, state);
    return undefined;
  }
  const groups = clauseGroups(text, hits);
  const rewrites = await rewordFn(groups.map((g) => ({ clause: g.clause, hits: g.hits })));
  const replacements = groups.map((g, i) => {
    const r = rewrites[i];
    return r && findHits(r, rules).length === 0 && sameMarkup(g.clause, r) ? r : null;
  });
  groups.forEach((g, i) => {
    if (replacements[i] === null) turn.hits.push(...g.hits.map(slim));
    log(replacements[i] === null ? 'masked' : 'reworded', { clause: g.clause, replacement: replacements[i], hits: g.hits.map(brief) });
  });
  for (const h of hits) if (!state.notes.some((n) => n.match.toLowerCase() === h.match.toLowerCase())) state.notes.push(slim(h));
  state.notes = state.notes.slice(-MAX_NOTES);
  writeState(stateDir, input.session_id, state);
  return { hookSpecificOutput: { hookEventName: 'MessageDisplay', displayContent: replaceClauses(text, groups, replacements) } };
}

// Haiku sometimes drops bold, code or links; such a rewrite would change what the person reads.
function sameMarkup(before, after) {
  const marks = (s) => ['**', '`', '](', '_'].map((m) => s.split(m).length);
  return marks(before).join() === marks(after).join();
}

function slim({ id, match, clause, hint }) {
  return { id, match, clause, hint };
}

function brief({ id, match }) {
  return { id, match };
}

function onStop(input, rules, stateDir, log) {
  const state = readState(stateDir, input.session_id);
  const turn = turnOf(state, input);
  if (input.stop_hook_active || turn.requested) {
    delete state.turns[turnKey(input)];
    writeState(stateDir, input.session_id, state);
    return undefined;
  }
  // Where the display hook ran, it already reworded what it could and left only the failures.
  // Where it did not run (older clients), the final message is checked here.
  const hits = turn.displayed ? [...turn.hits] : findHits(input.last_assistant_message ?? '', rules);
  if (hits.length === 0) {
    if (state.turns[turnKey(input)]) {
      delete state.turns[turnKey(input)];
      writeState(stateDir, input.session_id, state);
    }
    return undefined;
  }
  turn.requested = true;
  log('closing-message-requested', { hits: hits.map(brief) });
  // The agent is told about these now, so the next prompt does not repeat them as a note.
  state.notes = state.notes.filter((n) => !hits.some((h) => h.match.toLowerCase() === n.match.toLowerCase()));
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

// The phrases Haiku reworded on screen are still in the agent's own transcript, so the agent
// gets them once, at the next prompt, to avoid them from then on.
function onPrompt(input, stateDir) {
  const state = readState(stateDir, input.session_id);
  if (state.notes.length === 0) return undefined;
  const notes = state.notes;
  state.notes = [];
  writeState(stateDir, input.session_id, state);
  return {
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext: 'no-claudisms: your last replies used these stock phrases, which were reworded on screen. Avoid them:\n' + hitLines(notes),
    },
  };
}

function onSubagentStop(input, rules, log) {
  if (input.stop_hook_active) return undefined;
  const hits = findHits(input.last_assistant_message ?? '', rules);
  if (hits.length === 0) return undefined;
  log('report-reword-requested', { agent: input.agent_type, hits: hits.map(brief) });
  return {
    decision: 'block',
    reason: 'no-claudisms: your report uses stock AI phrasing. Send the report again with these reworded in plain words:\n' + hitLines(hits),
  };
}

function onPreToolUse(input, rules, stateDir, log) {
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
    log('retry-allowed', { tool: input.tool_name, target: target.key, hits: hits.map(brief) });
    return undefined;
  }
  state.denied[target.key] = signature;
  writeState(stateDir, input.session_id, state);
  log('denied', { tool: input.tool_name, target: target.key, hits: hits.map(brief) });
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
  return (state.turns[turnKey(input)] ??= { hits: [], requested: false, displayed: false });
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
    return { turns: s.turns ?? {}, denied: s.denied ?? {}, notes: s.notes ?? [] };
  } catch {
    return { turns: {}, denied: {}, notes: [] };
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
