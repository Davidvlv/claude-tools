---
name: haiku-worker
description: Hand one unit of mechanical work to a background Haiku worker and get back only its result. Use for searches, code maps, digests, builds, test and log runs, and edits to a written spec, whenever the work costs more in your own context than the brief does to write. Keep every judgment and decision yourself.
---

# haiku-worker

A Haiku worker is the `haiku-worker` subagent: Haiku with this session's tools, whose own definition says what it may change and how it reports. You keep every judgment: choosing an approach, shaping an interface, ruling on a finding, judging whether a criterion is met, and every choice about how something looks or feels.

## Start a job

Start each job with one Agent call: `subagent_type: haiku-worker:haiku-worker` (the plugin's agent), `run_in_background: true`. Start every independent job at once. Jobs that run at the same time share no file, so one job's edits never overwrite another's.

The prompt is the worker's whole brief, because it has none of this conversation. It names:

1. the folder to work in;
2. for an edit: the files it may change, the exact change, any test you wrote that it must not edit, and the test command to run afterwards;
3. for any other job: the exact question or command, and the output to report;
4. for a job started again after an interruption: that the working tree may hold its partial changes, to be continued, not redone.

Put a long spec in a file in your scratchpad or the system temp folder, and name that file in the prompt. Start and stop long-lived servers yourself.

## Wait

A worker reports only through a notification, which arrives between your tool calls. While a job runs, do the other work your task needs; never make up work to fill a wait.

When your next step needs a job's result:

1. In a `claude -p` session, wait within the turn, because the session ends when its turn ends. Run `node "${CLAUDE_PLUGIN_ROOT}/skills/haiku-worker/wait.mjs" --minutes 2` with the Bash `timeout` at `600000`, and repeat until the notification arrives.
2. In any other session, end the turn; the notification starts your next one.

The same `wait.mjs` waits for a background Bash command of your own that writes its output file only when it ends: add `--file <its output file>`, in calls of up to `--minutes 10`. It returns as soon as any named file is non-empty.

## Check the result

1. After an edit, run `git status --short` and `git diff --stat` and compare them with the files the job could change and the paths it reported. Revert a changed path that is outside that list, that no other open job owns and that you did not edit. Check any other unexpected path by hand, so your own work and another job's are never undone.
2. Read the diff and run its test. Fix small misses yourself.
3. A `FAIL` or `ERROR` is a report, not a diagnosis: find the cause yourself.
4. When a worker fails or returns nothing usable, start the job once more with its brief corrected for what went wrong. When that fails too, do the job yourself.
