---
name: no-claudisms
description: Set the no-claudisms mode for all sessions, or show it and the edit log.
argument-hint: "[all|chat|output|off|status]"
disable-model-invocation: true
allowed-tools: Bash(node *no-claudisms/scripts/mode.mjs*)
---

Reply with exactly this line and nothing else:

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/mode.mjs" $ARGUMENTS`
