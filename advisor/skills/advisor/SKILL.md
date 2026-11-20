---
name: advisor
description: Have a separate Fable advisor decide a design or implementation question in place of the person, and get back one choice with its reason. Use for every decision that would otherwise go to the person while they are away or have asked not to be interrupted, and when a skill hands it a choice or ranking to make.
---

# advisor

The advisor is Fable started with your question, an index of the installed skills and this project's earlier advisor decisions. It can read the project and the skills, and it changes nothing. It answers with one choice and one reason.

## Write the question file

The advisor knows only the files it reads and what the question tells it. Write in a file in your scratchpad or temporary folder:

- the goal: what the work is for, in the person's words when they gave them;
- the facts it cannot see: what you tried, what you measured, constraints from the conversation or the task;
- the options, numbered, the one you recommend first and marked recommended, each with its main cost;
- what earlier answers in this session already settled.

For a ranking, list the items and the order you recommend, and ask for the order as the choice.

## Ask

```
node "${CLAUDE_PLUGIN_ROOT}/skills/advisor/advisor.mjs" --question-file <file> --project <project folder>
```

`--project` is the folder of the work, the current folder when left out. `--timeout <seconds>` changes the 300-second limit.

## Read the answer

The output is two lines: `CHOICE: <option>` and `REASON: <one sentence>`. Act on the choice as if the person gave it, and tell the person the choice and its reason in your report. The advisor keeps its own log of answers, so later questions in this project stay consistent with them.

`CHOICE: PARK` means the question asks to approve an irreversible or outward-facing action. Do not take it: leave it for the person, carry on with the work that does not depend on it, and list it in your report with the reason.

## When the command fails

A line starting `ADVISOR_UNAVAILABLE:` with exit code 1 means the advisor did not run. Start one subagent in its place with the Agent tool and `model: fable`: its prompt is the question file's text and the instruction to answer with exactly `CHOICE: <option>` then `REASON: <one sentence>`, and to answer `CHOICE: PARK` for an irreversible or outward-facing action. When that fails too, treat the question as parked with the reason.
