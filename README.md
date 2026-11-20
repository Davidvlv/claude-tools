# claude-tools

A [Claude Code](https://claude.com/claude-code) plugin marketplace. Each plugin adds one skill.

| Plugin | What it does |
| --- | --- |
| [`fable-prompting`](fable-prompting/skills/fable-prompting/SKILL.md) | Prompting techniques for Claude Fable 5 and Mythos 5: when to change the effort level instead of the prompt, one prompt snippet per known failure mode, and how to scope work for a long autonomous run. Claude loads it when it writes or tunes a prompt, `CLAUDE.md`, skill or subagent brief that targets Fable. |
| [`look`](look/skills/look/SKILL.md) | The looker: separate Claude runs look at screenshots and rate them against aims you write, so the agent judges a visual result without the image entering its own context. Two runs rate each aim, a third settles a disagreement, and a fresh-eye run reports what looks wrong. A before/after compare is judged blind, in random order. |
| [`advisor`](advisor/skills/advisor/SKILL.md) | The advisor: a separate read-only Fable run decides a design or implementation question in the person's place and returns one choice with one reason. It sees the project, an index of the installed skills and its own earlier decisions for the project. It never approves an irreversible or outward-facing action; it answers those with `PARK`. |
| [`delegate-workers`](delegate-workers/README.md) | Keeps Opus (or Fable) resident as the main thinking agent and delegates mechanical execution and noisy tool output to short-lived Sonnet or Haiku workers. Run it with `/delegate-workers`. |

## Install

### From a Claude Code session

```
/plugin marketplace add Davidvlv/claude-tools
/plugin install fable-prompting@claude-tools
/plugin install look@claude-tools
/plugin install advisor@claude-tools
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
    "delegate-workers@claude-tools": true
  }
}
```

Claude Code fetches the marketplace and installs the enabled plugins at its next start. Restart Claude Code after an install or an update so the plugins load.

## Requirements

`fable-prompting` and `delegate-workers` are text only.

`look` and `advisor` run scripts that start separate `claude -p` processes, so they need:

- [Node.js](https://nodejs.org) 20 or later on `PATH`;
- the `claude` command on `PATH`, signed in;
- for `look`, access to Claude Opus and Sonnet;
- for `advisor`, access to Claude Fable. Set the environment variable `ADVISOR_MODEL` to another model name, such as `opus`, to run the advisor on that model instead.

## Where the scripts write

- `look` keeps each call's prompts and answers in a `look-log.md` beside the first image, or in the after folder of a compare.
- `advisor` appends each answer to `advisor/decisions.md` in the Claude config folder (`~/.claude`, or `CLAUDE_CONFIG_DIR` when it is set). It reads the last 20 entries for the same project back into later questions, so its answers stay consistent. Delete the file to clear that history.

## Tests

```
node --test look/skills/look/look.test.mjs advisor/skills/advisor/advisor.test.mjs
```

The tests use a fake `claude` command and make no model calls.

## License

MIT
