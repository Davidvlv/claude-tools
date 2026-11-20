---
name: fable-prompting
description: Prompting techniques for Claude Fable 5 (model id claude-fable-5) and Claude Mythos 5, Anthropic's most autonomous, longest-horizon Claude models. Use whenever writing or tuning a system prompt, CLAUDE.md, SKILL.md, or subagent/workflow prompt that targets Fable; when choosing an effort level (low/medium/high/xhigh/max) for a Fable-backed agent; or when Fable is over-planning, over-verifying, refactoring unasked, asking permission too often, stopping early, padding responses, or fabricating progress on a long run.
---

# Prompting Claude Fable 5

Fable plans, self-verifies, and runs unsupervised for hours. Prompt it like a capable senior engineer who already has the context, not like a junior who needs every step spelled out: state the goal, the reason it matters, the boundaries, and how it can check its own work — then get out of the way.

The biggest lever is **deletion, not addition**. Step lists, tool nudges, and "always do X before Y" instructions written for weaker models now act as constraints Fable obeys even when they're wrong for the task at hand, and measurably degrade output quality. When adapting an existing prompt or skill for Fable, default to removing prescriptive instructions rather than layering on more — add back only what actually breaks without it.

## Effort is the main dial

Reach for the `effort` setting before rewording the prompt when trading off speed/cost against depth:

| Level | Use for |
|---|---|
| `max` | Genuinely frontier problems only — usually overkill |
| `xhigh` | The hardest long-horizon coding/agentic work |
| `high` (default) | Most tasks: complex reasoning, real coding, agentic work |
| `medium` | Routine work, balanced speed/cost |
| `low` | Simple/short tasks, subagents, high-volume calls |

Fable at `low` or `medium` often outperforms prior models at `xhigh`. If a task finishes correctly but takes longer than it should, or over-deliberates on something simple, step effort down before adding more prompt constraints.

## Symptom → fix

Each snippet below fixes one specific, real failure mode. Add only the ones you're actually seeing — pasting all of them defensively just reintroduces the over-specification problem this model doesn't need.

**Surveys options instead of just acting**
```
When you have enough information to act, act. Don't re-derive facts already established or re-litigate a decision already made. If you're weighing a choice, give a recommendation, not a survey.
```

**Refactors, adds validation, or builds abstractions nobody asked for**
```
Don't add features, refactors, or abstractions beyond what the task requires. Trust internal code and framework guarantees; only validate at system boundaries. Do the simplest thing that works well.
```

**Responses are accurate but hard to skim**
```
Lead with the outcome — the sentence you'd give if asked for the TLDR — then supporting detail after. Get shorter by cutting what doesn't change what the reader does next, not by compressing into fragments or arrow chains.
```

**Asks permission too often on long or autonomous runs**
```
Pause only when the work genuinely needs a human: an irreversible action, a real scope change, or input only they can give. Otherwise proceed without asking.
```

**Reports progress that didn't actually happen**
```
Before reporting progress, check each claim against an actual tool result from this session. State failures and skipped steps plainly — no hedging, no fabrication.
```

**Takes actions nobody requested** (drafts an email, makes a defensive git branch)
```
State explicitly what's in scope. When the user is describing a problem or thinking out loud rather than requesting a change, your deliverable is the assessment — don't apply a fix unasked.
```

**Under-uses subagents, or blocks on them one at a time**
```
Delegate independent subtasks to subagents and keep working while they run. Prefer checking in asynchronously over blocking until each one returns.
```

**Repeats the same mistake across sessions**
```
Keep a markdown memory file, one lesson per file. Record corrections and confirmed-good approaches alike, with why they mattered. Update an existing note instead of duplicating one; delete notes that turn out wrong.
```

**States intent but doesn't act** ("I'll now run the migration...", then stops)
```
Before ending a turn, check your last paragraph. If it's a plan, a question, or a promise of future work, do that work now instead of ending the turn.
```
A plain "continue" also unblocks this immediately if it happens.

**Suggests a new session, or trims its own work, over imagined context limits**
```
You have ample context remaining. Don't stop, summarize, or suggest a new session on account of context limits — continue the work.
```

**Final summary reads like internal shorthand** (arrow chains, jargon coined mid-task, references to reasoning the user never saw)
```
Working shorthand between tool calls is fine. The final summary is for a reader seeing this for the first time: complete sentences, terms spelled out, outcome first, nothing carried over that wasn't reintroduced.
```

## Two things that trigger refusals, not bad output

- Don't ask Fable to echo, transcribe, or explain its internal reasoning as response text. Raw chain-of-thought is never returned on Fable or Mythos, and prompting for it can trigger a reasoning-extraction refusal instead of an answer. Reasoning visibility is a `thinking.display`/summarized-thinking concern, not a prompting one.
- Fable runs safety classifiers for offensive-cyber and bio/life-sciences content that occasionally flag legitimate adjacent work (defensive security research, benign lab-methods questions). A refusal there is the classifier, not a prompt-quality problem — retrying on Opus 4.8 is the documented fallback.

## When scoping the task, not just the prompt

- Hand Fable something closer to the top of your difficulty range, not the easy end. It's tuned for problems that would take a person hours or days, and under-scoping it undersells what it can do in one pass.
- For long or high-stakes runs, ask for verification via a fresh-context subagent rather than self-review in the same context: "verify your own work against the spec with a subagent every [X]."
- Don't pre-decide things that are Fable's call to make. This includes the obvious ones — "a sensible first slice," "small enough to demo," which subagents to use where — but also the subtler slip of naming *examples* of the open decision ("future directions like X, Y, Z," "split into a first slice vs. later slices"). Naming examples or imposing a structure is still deciding the shape of the answer; it anchors Fable on your categories instead of ones it derives itself. State the goal and constraints, point at the source material, and tell it explicitly to use its own judgment on the open decisions — without sketching what that judgment should land on.
