// Finds the message text a shell command publishes: git commit messages and gh pr/issue titles and bodies.
// Only those arguments are checked, so code in the same command (a heredoc that writes a script,
// a string literal in a chained step) is never mistaken for prose.
import path from 'node:path';

// A small shell reader: enough of Bash and PowerShell quoting, heredocs, here-strings and
// command substitution to split a command into words and find each command's stdin.
// Returns segments: { words: string[], stdin: string[] }.
export function segments(command, shell = 'bash') {
  return read(command, 0, shell, false).segs;
}

function read(s, start, shell, inSubst) {
  const ps = shell === 'powershell';
  const segs = [];
  let seg = { words: [], stdin: [] };
  let word = null;
  let pending = [];
  let stdinWord = false;
  let depth = 0;
  let i = start;
  const add = (t) => (word = (word ?? '') + t);
  const endWord = () => {
    if (word === null) return;
    if (stdinWord) seg.stdin.push(word);
    else seg.words.push(word);
    stdinWord = false;
    word = null;
  };
  const endSeg = () => {
    endWord();
    if (seg.words.length || seg.stdin.length) segs.push(seg);
    seg = { words: [], stdin: [] };
  };
  // A substitution's value, for message purposes, is what it prints from a heredoc, echo or printf.
  const subst = (from) => {
    const r = read(s, from, shell, true);
    const text = r.segs.flatMap((g) => [...g.stdin, ...(/^(?:echo|printf|Write-Output)$/iu.test(g.words[0] ?? '') ? g.words.slice(1) : [])]).join('\n');
    return { text, end: r.end };
  };

  while (i < s.length) {
    const c = s[i];
    if (c === '\n') {
      endWord();
      i = heredocBodies(s, i, pending);
      pending = [];
      endSeg();
      i++;
      continue;
    }
    if ((c === '\\' && !ps) || (c === '`' && ps)) {
      if (s[i + 1] === '\n') i += 2;
      else if (s[i + 1] === '\r' && s[i + 2] === '\n') i += 3;
      else {
        add(s[i + 1] ?? '');
        i += 2;
      }
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      endWord();
      i++;
      continue;
    }
    if (c === '#' && word === null) {
      while (i < s.length && s[i] !== '\n') i++;
      continue;
    }
    if (c === ';' || c === '&' || c === '|') {
      endSeg();
      i++;
      continue;
    }
    if (c === '(' && word === null) {
      depth++;
      i++;
      continue;
    }
    if (c === ')') {
      if (inSubst && depth === 0) {
        endSeg();
        return { segs, end: i + 1 };
      }
      depth = Math.max(0, depth - 1);
      endSeg();
      i++;
      continue;
    }
    if (ps && c === '@' && word === null && (s[i + 1] === "'" || s[i + 1] === '"') && /^\r?\n/u.test(s.slice(i + 2, i + 4))) {
      const q = s[i + 1];
      const bodyStart = s.indexOf('\n', i) + 1;
      const close = s.indexOf(`\n${q}@`, bodyStart - 1);
      const end = close === -1 ? s.length : close;
      add(s.slice(bodyStart, end).replace(/\r$/u, ''));
      i = close === -1 ? s.length : close + 3;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let t = '';
      while (j < s.length) {
        if (s[j] === "'" && ps && s[j + 1] === "'") {
          t += "'";
          j += 2;
        } else if (s[j] === "'") break;
        else t += s[j++];
      }
      add(t);
      i = j + 1;
      continue;
    }
    if (!ps && c === '$' && s[i + 1] === "'") {
      let j = i + 2;
      let t = '';
      while (j < s.length && s[j] !== "'") {
        if (s[j] === '\\' && j + 1 < s.length) {
          t += { n: '\n', t: '\t', "'": "'", '\\': '\\' }[s[j + 1]] ?? s[j + 1];
          j += 2;
        } else t += s[j++];
      }
      add(t);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let t = '';
      while (j < s.length && s[j] !== '"') {
        if (!ps && s[j] === '\\' && '"\\$`\n'.includes(s[j + 1] ?? '')) {
          t += s[j + 1] === '\n' ? '' : s[j + 1];
          j += 2;
        } else if (ps && s[j] === '`' && j + 1 < s.length) {
          t += s[j + 1] === 'n' ? '\n' : s[j + 1];
          j += 2;
        } else if (s[j] === '$' && s[j + 1] === '(') {
          const r = subst(j + 2);
          t += r.text;
          j = r.end;
        } else t += s[j++];
        if (ps && s[j] === '"' && s[j + 1] === '"') {
          t += '"';
          j += 2;
        }
      }
      add(t);
      i = j + 1;
      continue;
    }
    if (c === '$' && s[i + 1] === '(') {
      const r = subst(i + 2);
      add(r.text);
      i = r.end;
      continue;
    }
    if (!ps && c === '<' && s[i + 1] === '<') {
      endWord();
      if (s[i + 2] === '<') {
        stdinWord = true;
        i += 3;
        continue;
      }
      let j = i + 2;
      const strip = s[j] === '-';
      if (strip) j++;
      while (s[j] === ' ' || s[j] === '\t') j++;
      const m = s.slice(j).match(/^(?:'([^']*)'|"([^"]*)"|\\?([\w.-]+))/u);
      if (m) {
        pending.push({ delim: m[1] ?? m[2] ?? m[3], strip, into: seg.stdin });
        j += m[0].length;
      }
      i = j;
      continue;
    }
    add(c);
    i++;
  }
  endSeg();
  return { segs, end: s.length };
}

// Reads the heredoc bodies that start after the newline at nl, and returns the index of the
// newline that ends the last one, so the caller carries on from there.
function heredocBodies(s, nl, pending) {
  let pos = nl;
  for (const h of pending) {
    const lines = [];
    let at = pos + 1;
    while (at <= s.length) {
      const next = s.indexOf('\n', at);
      const lineEnd = next === -1 ? s.length : next;
      const line = s.slice(at, lineEnd).replace(/\r$/u, '');
      if ((h.strip ? line.replace(/^\t+/u, '') : line) === h.delim) {
        pos = lineEnd;
        break;
      }
      lines.push(h.strip ? line.replace(/^\t+/u, '') : line);
      pos = lineEnd;
      if (next === -1) break;
      at = next + 1;
    }
    h.into.push(lines.join('\n'));
  }
  return pos;
}

const GIT = /(?:^|[\\/])git(?:\.exe)?$/iu;
const GH = /(?:^|[\\/])gh(?:\.exe)?$/iu;
const GIT_VALUE_OPTS = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--exec-path', '--config-env']);

// Returns { kind, text } for the first publishing command, with the text of every message
// argument it has, or undefined when the command publishes nothing.
// readText(file) returns a file's text, or '' when it cannot be read.
export function publishedText(command, { shell = 'bash', cwd = '.', readText }) {
  let kind;
  const texts = [];
  for (const seg of segments(command, shell)) {
    const w = seg.words.slice(seg.words.findIndex((x) => !/^\w+=/u.test(x)));
    if (w[0] === '&' || w[0] === '.') w.shift();
    let found;
    if (GIT.test(w[0] ?? '')) found = gitCommit(w, cwd);
    else if (GH.test(w[0] ?? '')) found = ghText(w, cwd);
    if (!found) continue;
    kind ??= found.kind;
    texts.push(...found.messages);
    for (const f of found.files) texts.push(f === '-' ? seg.stdin.join('\n') : readText(f));
  }
  return kind ? { kind, text: texts.filter(Boolean).join('\n\n') } : undefined;
}

function gitCommit(w, cwd) {
  let j = 1;
  let dir = cwd;
  while (j < w.length && w[j].startsWith('-')) {
    if (w[j] === '-C') dir = path.resolve(dir, w[j + 1] ?? '.');
    j += GIT_VALUE_OPTS.has(w[j]) ? 2 : 1;
  }
  if (w[j] !== 'commit') return undefined;
  const messages = [];
  const files = [];
  for (let k = j + 1; k < w.length; k++) {
    const a = w[k];
    if (a === '--') break;
    const long = a.match(/^--(message|file)(?:=([\s\S]*))?$/u);
    if (long) {
      const v = long[2] ?? w[++k];
      if (v !== undefined) (long[1] === 'message' ? messages : files).push(long[1] === 'file' ? resolve(dir, v) : v);
      continue;
    }
    // Short options cluster (-am "msg"); the value of -m or -F is the rest of the cluster or the next word.
    const short = a.match(/^-([a-zA-Z]*?)([mF])([\s\S]*)$/u);
    if (short && !a.startsWith('--')) {
      const v = short[3] !== '' ? short[3] : w[++k];
      if (v !== undefined) (short[2] === 'm' ? messages : files).push(short[2] === 'F' ? resolve(dir, v) : v);
    }
  }
  return { kind: 'git commit', messages, files };
}

function ghText(w, cwd) {
  const sub = `${w[1]} ${w[2]}`;
  if (!/^(?:(?:pr|issue) (?:create|edit|comment)|pr review)$/u.test(sub)) return undefined;
  const messages = [];
  const files = [];
  for (let k = 3; k < w.length; k++) {
    const a = w[k];
    const long = a.match(/^--(title|body|body-file)(?:=([\s\S]*))?$/u);
    if (long) {
      const v = long[2] ?? w[++k];
      if (v !== undefined) (long[1] === 'body-file' ? files : messages).push(long[1] === 'body-file' ? resolve(cwd, v) : v);
      continue;
    }
    const short = a.match(/^-([tbF])([\s\S]*)$/u);
    if (short) {
      const v = short[2] !== '' ? short[2] : w[++k];
      if (v !== undefined) (short[1] === 'F' ? files : messages).push(short[1] === 'F' ? resolve(cwd, v) : v);
    }
  }
  return { kind: `gh ${sub}`, messages, files };
}

function resolve(dir, file) {
  return file === '-' ? '-' : path.resolve(dir, file);
}
