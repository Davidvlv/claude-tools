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

## Mode

The plugin has one setting, `mode`. Set it in `/config`, or type `/no-claudisms <mode>` in any session:

- `all` (the default): chat and output.
- `chat`: only the main agent's chat replies.
- `output`: only markdown files, commit and PR text, and subagent reports.
- `off`: nothing.

`/config` stores the choice under `pluginConfigs` in your `settings.json`. `/no-claudisms <mode>` sets the mode for all sessions, until you change it again with the command or in `/config`; the later change wins. `/no-claudisms status`, or `/no-claudisms` alone, shows the current mode and the number of entries in the edit log, with its folder. The command's skill runs `scripts/mode.mjs` as a shell step before the model sees it, and the model replies with the one line the script prints. Each use costs one short model turn. The skill has `disable-model-invocation: true`, so its description is not in the model's context, and it pre-approves only that script. The command's choice is stored in `no-claudisms/mode.json` in the Claude config folder (`~/.claude`, or `CLAUDE_CONFIG_DIR`).

## What is checked

| Text | Hook | Result |
| --- | --- | --- |
| Each chat message of the main agent (`chat`) | `MessageDisplay` | Haiku rewords each sentence with a claudism, and the reworded sentence shows in its place on screen. The model and the transcript keep the original. |
| The next prompt (`chat`) | `UserPromptSubmit` | The agent gets the phrases that were reworded on screen, with their hints and the sentence the person saw, so it avoids them from then on and knows what was shown. |
| The end of a main-agent turn (`chat`) | `Stop` | A sentence that Haiku could not reword shows as `[rewording]`. The stop is then blocked once, and the agent sends one closing message that says the flagged content again in plain words. |
| A subagent's final report (`output`) | `SubagentStop` | The stop is blocked once, and the subagent sends the same report again with only the flagged phrases reworded, with no tool calls and no new work. A report that is valid JSON is not checked, because code reads it. |
| `Write`, `Edit` and `MultiEdit` on `.md`, `.mdx` and `.markdown` files, and on `.txt` files named like prose (`README`, `CHANGELOG`, `CHANGES`, `HISTORY`, `NOTES`, `TODO`, `CONTRIBUTING`, `RELEASE-NOTES`) (`output`) | `PreToolUse` | The call is denied with the list of hits that the change adds. Hits already in the file do not count. Files under a `fixture`, `fixtures`, `testdata`, `test-data`, `snapshots`, `__snapshots__`, `golden`, `goldens` or `expected` folder are test data and are not checked. |
| `git commit`, `gh pr` or `gh issue` `create`/`edit`/`comment`, and `gh pr review`, in `Bash` or `PowerShell` (`output`) | `PreToolUse` | The same, for the message arguments only: `-m`/`--message` and `-F`/`--file` of `git commit`, and `-t`/`--title`, `-b`/`--body` and `-F`/`--body-file` of `gh`. `-F -` reads the heredoc the command passes on stdin. The rest of the command is not checked, so code that the same command writes or runs is never flagged. |

Text in code blocks, inline code, double quotes and URLs is not checked, so the agent can quote a phrase.

`scripts/command.mjs` reads the command with enough of Bash and PowerShell quoting to find those arguments: single and double quotes, `$'...'`, heredocs, `$(cat <<'EOF' ... EOF)`, PowerShell here-strings, and `;`, `&&`, `|` and newlines between commands.

Each piece of text gets one rewrite request. A second `Stop` in the same turn passes, and a tool call retried with the same hits passes, so a name or a phrase with no other wording cannot loop.

Feedback lists at most 8 hits. Each line gives the phrase, its clause and a one-line hint.

## The Haiku reworder

`scripts/reword.mjs` starts one `claude -p` run on Haiku for each chat message that has a claudism, with all its flagged sentences in one request. The run has its own short system prompt, thinking off, no tools, no MCP servers, no saved session and no user settings, so it loads no plugins or hooks. A flagged message appears about 3 to 4 seconds later and costs about $0.0008. Clean messages make no call.

Haiku gets only the sentence and the phrases to remove, not the hints, because the hints give examples that Haiku would state as facts. A rewrite is rejected, and its sentence masked, when the call fails or takes more than 12 seconds, when the rewrite still has a claudism, when it drops bold, code or links, or when it changes a fact. A fact is a number, path, file name, identifier, command flag, acronym or capitalized name outside the flagged phrases, and the rewrite must keep each one as written. It must also keep every negation (`not`, `no`, `never`, `n't`) outside the flagged phrases and add none, so a reworded "it's not X, it's Y" can drop only that phrase's own `not`. A masked sentence goes to the agent at `Stop`, which knows the context.

## Files

- `data/claudisms.json`: the upstream list, unchanged.
- `data/overrides.json`: local changes on top of it, by term id. `off` turns a term off, with the reason. `aliases` replaces the upstream phrases. `patterns` adds regular expressions (case-insensitive). `hint` sets the hint. `phraseHints` sets a hint for one phrase of the term, for terms that group different words (`robust` also covers `seamless` and `holistic`). `extra` holds terms that are not upstream, in the upstream shape plus `patterns`. A term with no hint gets one taken from its upstream definition.
- `scripts/hook.mjs`: the one entry point for every hook event.
- `skills/no-claudisms/SKILL.md`: the `/no-claudisms` command.
- `scripts/mode.mjs`: reads and sets the mode, for the hooks and the command.
- `scripts/log.mjs`: writes, prunes and counts the edit log.
- `scripts/match.mjs`: the matcher and the fact check for rewrites.
- `scripts/command.mjs`: finds the message arguments of a `git` or `gh` command.
- `scripts/reword.mjs`: the Haiku reworder.
- `scripts/refresh.mjs` and `scripts/corpus.mjs`: tools for maintainers, described below.

Terms that are common words used as metaphors ("shape", "lives", "moves", "names") are off or narrowed, because their literal use in developer and game-development text is far more common. The same applies to structural tics that a phrase match cannot see (lists of bold terms, runs of short sentences) and to emojis, which some skills require.

The hooks keep per-session state in `${CLAUDE_PLUGIN_DATA}` and delete files older than two days.

## Edit log

The hooks write one JSON line for each change they make or ask for, to `no-claudisms/log/<date>.jsonl` in the Claude config folder, one file per local day. When the first entry of a day is written, files older than 7 days are deleted. Each line has `time`, `session`, `cwd`, `event` and `hits` (the term id and matched phrase of each hit). The events are:

- `reworded`: Haiku reworded a sentence on screen. `clause` is the original and `replacement` is what was shown.
- `masked`: no usable rewrite came back, so the sentence showed as `[rewording]`. `replacement` is `null`.
- `closing-message-requested`: the `Stop` hook asked the agent for a reworded closing message.
- `report-reword-requested`: the `SubagentStop` hook asked a subagent to send its report again. `agent` is the subagent type.
- `denied`: a `PreToolUse` call was denied. `tool` is the tool and `target` is the file path or the command kind.
- `retry-allowed`: the same call was retried with the same hits and let through.

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

- Claude Code 2.1.271 or later, for the `mode` setting.
- [Node.js](https://nodejs.org) 20 or later on `PATH`.
- For `chat` mode: the `claude` command on `PATH`, signed in, with access to Claude Haiku. Without the `MessageDisplay` event, the `Stop` check still runs on the final message of each turn.
