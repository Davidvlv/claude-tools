# claude-tools

A [Claude Code](https://claude.com/claude-code) plugin marketplace. Each plugin adds one skill; `haiku-worker` adds its subagent too, and `no-claudisms` adds hooks instead of a skill.

| Plugin | What it does |
| --- | --- |
| [`fable-prompting`](fable-prompting/skills/fable-prompting/SKILL.md) | Prompting techniques for Claude Fable 5 and Mythos 5: when to change the effort level instead of the prompt, one prompt snippet per known failure mode, and how to scope work for a long autonomous run. Claude loads it when it writes or tunes a prompt, `CLAUDE.md`, skill or subagent brief that targets Fable. |
| [`look`](look/skills/look/SKILL.md) | The looker: separate Claude runs look at screenshots and rate them against aims you write, so the agent judges a visual result without the image entering its own context. Two runs rate each aim, a third settles a disagreement, and a fresh-eye run reports what looks wrong. A before/after compare is judged blind, in random order. |
| [`advisor`](advisor/skills/advisor/SKILL.md) | The advisor: a separate read-only Fable run decides a design or implementation question in the person's place and returns one choice with one reason. It sees the project, an index of the installed skills and its own earlier decisions for the project. It never approves an irreversible or outward-facing action; it answers those with `PARK`. |
| [`haiku-worker`](haiku-worker/skills/haiku-worker/SKILL.md) | Hands one mechanical job, such as a search, a code map, a digest, a build or test run, or an edit to a written spec, to a background Haiku subagent that returns only its result: `PASS` or `FAIL` with the failing lines, the paths it changed, or the facts it found. The main agent keeps every judgment and keeps the noisy output out of its context. Claude loads it whenever such a job costs more context than its brief does to write. |
| [`no-claudisms`](no-claudisms/README.md) | Hooks that catch stock AI phrasing from the [claudisms.ai](https://claudisms.ai/) list. In the main chat, Haiku rewords each flagged sentence before it shows, and the agent gets the phrases at your next prompt. They make a subagent reword its report, and they deny a markdown write, commit or PR text that adds a claudism. A `mode` setting picks chat, output, both or off. The list never enters the model's context. |
| [`write-clearly`](write-clearly/skills/write-clearly/SKILL.md) | Rules for writing, revising and reviewing any text a reader opens cold, such as a PR description, commit message, issue comment, README, runbook, SKILL.md, agent brief or code comment. The shared rules cover terms, headings, ordered decision rules, plain sentences, the marks of generated text, revising without changing content, current state only and code comments. Two reference files add rules for text that agents read and for text that people read. Claude loads it whenever it writes or revises one of these texts, or reviews the docs and comments in a diff. |

## Install

### From a Claude Code session

```
/plugin marketplace add Davidvlv/claude-tools
/plugin install fable-prompting@claude-tools
/plugin install look@claude-tools
/plugin install advisor@claude-tools
/plugin install haiku-worker@claude-tools
/plugin install write-clearly@claude-tools
/plugin install no-claudisms@claude-tools
```

### From `settings.json`

Add the marketplace and the plugins you want to `~/.claude/settings.json` (all projects) or a project's `.claude/settings.json` (everyone who works in that project):

```json
{
  "extraKnownMarketplaces": {
    "claude-tools": {
      "source": { "source": "github", "repo": "Davidvlv/claude-tools" }
    }
  },
  "enabledPlugins": {
    "fable-prompting@claude-tools": true,
    "look@claude-tools": true,
    "advisor@claude-tools": true,
    "haiku-worker@claude-tools": true,
    "write-clearly@claude-tools": true,
    "no-claudisms@claude-tools": true
  }
}
```

Claude Code fetches the marketplace and installs the enabled plugins at its next start. Restart Claude Code after an install or an update so the plugins load.

If you added the marketplace before a plugin was added to it, run `/plugin marketplace update claude-tools` before you install that plugin.

## Requirements

`fable-prompting` and `write-clearly` are text only. `no-claudisms` runs its hooks with [Node.js](https://nodejs.org) 20 or later on `PATH`, needs Claude Code 2.1.271 or later, and in chat mode calls Claude Haiku through the `claude` command. `haiku-worker` needs access to Claude Haiku; in a `claude -p` session it also runs a small wait script, which needs [Node.js](https://nodejs.org) 20 or later on `PATH`.

`look` and `advisor` run scripts that start separate `claude -p` processes, so they need:

- [Node.js](https://nodejs.org) 20 or later on `PATH`;
- the `claude` command on `PATH`, signed in;
- for `look`, access to Claude Opus and Sonnet;
- for `advisor`, access to Claude Fable. Set the environment variable `ADVISOR_MODEL` to another model name, such as `opus`, to run the advisor on that model instead.

## Where the scripts write

- `look` keeps each call's prompts and answers in a `look-log.md` beside the first image, or in the after folder of a compare.
- `no-claudisms` keeps per-session state in its plugin data folder and deletes files older than two days.
- `advisor` appends each answer to `advisor/decisions.md` in the Claude config folder (`~/.claude`, or `CLAUDE_CONFIG_DIR` when it is set). It reads the last 20 entries for the same project back into later questions, so its answers stay consistent. Delete the file to clear that history.

## Tests

```
node --test look/skills/look/look.test.mjs advisor/skills/advisor/advisor.test.mjs haiku-worker/skills/haiku-worker/wait.test.mjs no-claudisms/scripts/match.test.mjs no-claudisms/scripts/hook.test.mjs no-claudisms/scripts/reword.test.mjs
```

The `look` and `advisor` tests use a fake `claude` command; no test makes a model call.

## License

MIT
