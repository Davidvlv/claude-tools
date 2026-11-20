# no-claudisms

Hooks that catch stock AI phrasing (claudisms) in what the agent writes and ask it to reword. The phrase list comes from [claudisms.ai](https://claudisms.ai/) (CC0). The list stays on disk: the model reads only the short feedback for the phrases it actually used.

## Turn it on

The plugin has hooks and no skill, so nothing loads until it is installed and enabled. In a Claude Code session:

```
/plugin marketplace add Davidvlv/claude-tools
/plugin install no-claudisms@claude-tools
```

If the marketplace is already added, run `/plugin marketplace update claude-tools` first, so it lists `no-claudisms`. You can also enable it in `settings.json` with `"no-claudisms@claude-tools": true` under `enabledPlugins`. Restart Claude Code after the install, so the hooks load.

To try a local checkout without installing it, start the terminal CLI with `claude --plugin-dir <path-to>/no-claudisms`.

To turn it off, run `/plugin disable no-claudisms@claude-tools` and restart.

## What is checked

| Text | Hook | Result |
| --- | --- | --- |
| Each chat message of the main agent | `MessageDisplay` | Each clause with a claudism shows as `[rewording]` on screen. The model and the transcript keep the original. |
| The end of a main-agent turn | `Stop` | If any message in the turn had a claudism, the stop is blocked once, and the agent sends one closing message that restates the flagged content in plain words. |
| A subagent's final report | `SubagentStop` | The stop is blocked once, and the subagent sends its report again, reworded. |
| `Write`, `Edit` and `MultiEdit` on `.md`, `.mdx`, `.markdown` and `.txt` files | `PreToolUse` | The call is denied with the list of hits that the change adds. Hits already in the file do not count. |
| `git commit`, `gh pr` or `gh issue` `create`/`edit`/`comment`, and `gh pr review`, in `Bash` or `PowerShell` | `PreToolUse` | The same, for the command text and any file given with `-F`, `--file` or `--body-file`. |

Text in code blocks, inline code, double quotes and URLs is not checked in chat and files, so the agent can quote a phrase. Command text is checked inside quotes, because `-m "..."` carries the message.

Each piece of text gets one rewrite request. A second `Stop` in the same turn passes, and a tool call retried with the same hits passes, so a name or a phrase with no other wording cannot loop.

Feedback lists at most 8 hits. Each line gives the phrase, its clause and a one-line hint.

## Files

- `data/claudisms.json`: the upstream list, unchanged.
- `data/overrides.json`: local changes on top of it, by term id. `off` turns a term off, with the reason. `aliases` replaces the upstream phrases. `patterns` adds regular expressions (case-insensitive). `hint` sets the hint. `phraseHints` sets a hint for one phrase of the term, for terms that group different words (`robust` also covers `seamless` and `holistic`). `extra` holds terms that are not upstream, in the upstream shape plus `patterns`. A term with no hint gets one taken from its upstream definition.
- `scripts/hook.mjs`: the one entry point for every hook event.
- `scripts/match.mjs`: the matcher.
- `scripts/refresh.mjs` and `scripts/corpus.mjs`: tools for maintainers, described below.

Terms that are common words used as metaphors ("shape", "lives", "moves", "names") are off or narrowed, because their literal use in developer and game-development text is far more common. The same applies to structural tics that a phrase match cannot see (lists of bold terms, runs of short sentences) and to emojis, which some skills require.

The hooks keep per-session state in `${CLAUDE_PLUGIN_DATA}` and delete files older than two days.

## Maintenance

Refresh the list from the site, then review the report it prints:

```
node no-claudisms/scripts/refresh.mjs
```

New upstream terms are on by default. Count the hits per term in real text before you turn on or narrow a term. The tool takes markdown files, folders and session transcripts (`.jsonl`):

```
node no-claudisms/scripts/corpus.mjs <file-or-folder>...
```

## Requirements

[Node.js](https://nodejs.org) 20 or later on `PATH`. The `MessageDisplay` masking needs a Claude Code version with that hook event. Without it, the `Stop` check still runs on the final message of each turn.
