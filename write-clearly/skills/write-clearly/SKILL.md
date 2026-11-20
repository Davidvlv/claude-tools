---
name: write-clearly
description: How to write, revise or review any text a reader opens without context. Covers PR and MR descriptions, commit messages, issue and review comments, Jira, Confluence and wiki pages, READMEs and runbooks, repo markdown, SKILL.md and CLAUDE.md files, memory entries, subagent and session briefs, skill and tool descriptions, and code comments. Use whenever writing or revising any of these, and when reviewing the comments or docs in a diff.
---

# Write clearly

Every reader opens the text cold. A reviewer, an on-call engineer, a future maintainer or an agent with a fresh
context has the text and the code it names, and nothing else: not the conversation, the ticket thread or the
investigation that produced it. Every rule below follows from that.

## Load the rules for the reader

The rules in this file apply to every text. Then load the file for whoever reads it:

1. If an agent reads it, read `references/for-agents.md`. That covers SKILL.md, CLAUDE.md and AGENTS.md files,
   memory entries, subagent and session briefs, skill and tool description fields, hook output, eval graders,
   and shared or library markdown that agents load.
2. If a person reads it, read `references/for-people.md`. That covers PR and MR descriptions, commit messages,
   issue and review comments, Jira issues, Confluence and wiki pages, READMEs, runbooks, release notes and Slack
   posts.
3. For a code comment, this file is enough. See § Code comments.

## Define a term the first time it appears

A word coined during the work ("the origin", "the pair", "the flip", "a Google row") means nothing to a cold
reader. On first use, say what it is in a short clause, then use the term consistently. If it is used once,
skip the term and say the plain thing.

Test: could a reader who skipped every section above this one still say what the term refers to? If not,
define it here or link to where it is defined.

## Headings say what the section covers

A heading is the reader's map. Name the subject in plain words: "How the login picks the account to return
to", not "The origin, and what beats what". Shorthand, wordplay and in-jokes from the work fail as headings.

## Precedence and decision rules are ordered steps

When several things can decide an outcome, list them as a numbered list in the order the code checks them,
one source per step, with what happens when it is absent. Close with what is never consulted, if a reader
would expect it to be, and why.

Prose like "X takes precedence over Y; on Z there is no X" makes the reader rebuild the list. Give them the
list.

## Say why a rule matters, in terms of what it prevents

A constraint without its consequence reads as arbitrary. After the rule, say what goes wrong without it, as a
concrete outcome for a customer or the system: "so an edited pair can never reach an account the identity has
no link to", not "for safety".

## One point per paragraph, lead with it

Open each paragraph with the claim, then support it. A paragraph that carries two ideas joined by a semicolon
is two paragraphs. Keep sentences short enough to read once.

## Name things by what they do before naming them by symbol

Introduce a mechanism in words, then give the symbol: "the account selector's encrypted `dbid`/`id` pair",
not a bare `dbid`/`id`. Code identifiers are for finding the code, not for explaining it.

## Write each sentence plainly

- Put a condition before the command: "If the health check fails, restart the service."
- Name who acts: "The gateway validates the token", not "The token is validated".
- Put the action in the verb: "decide", not "make a decision".
- Keep the source's certainty. "Might fail" becomes "can fail", never "fails".
- Keep a sentence to about 25 words. A sentence that carries two ideas becomes two sentences.
- Use a period or a list where a semicolon would join two clauses.

## Leave out the marks of generated text

Models copy the style of the text they are given, and people discount text that reads as generated. These
three patterns justify an edit on one sighting, in any text:

1. A contrast against something nobody claimed: "not just X, but Y", "it's not X, it's Y", "This doesn't mean
   X. It means Y." State the point. Keep a contrast only when the reader really believes X.
2. Dashes used to join clauses: em dash (U+2014), en dash (U+2013) or a spaced `--`. Use a period, comma,
   colon or parentheses instead. Leave dashes in code, commands, paths and URLs.
3. A bold label and a colon on every list item. Remove the bold, or turn the list into prose when the labels
   add nothing. Keep bold for warnings and for terms the reader must find again.

## Revise without changing the content

When you edit text that someone else wrote, or an earlier draft:

- Keep every fact. If a fact does not fit the style, change the sentence, not the fact.
- Keep numbers, names, dates, quotes and identifiers exact. "40+" stays "40+".
- Add nothing: no new facts, examples, reasons, sources or warnings.
- Leave code, commands, paths, URLs, error messages and versions as they are.
- If two statements contradict each other, keep both and say so.

## No history

Authored text describes *current state*. Write every revision as if authored correctly from scratch, leaving
no trace a prior version existed. Applies to repo .md files, memory, *and* outward docs: PR/MR descriptions,
issue/review comments, wiki/Confluence pages. Forbidden in body:

- "Previously", "Originally", "Older revision", "Used to say X, now Y".
- "Added because of incident Z". State the constraint, not the incident.
- Self-correction traces when fixing prior content mid-conversation. Edit in place.
- Coda lines like "this memory used to say X" when refining a memory.
- Correction framing that points at an earlier draft: "one correction", "to clarify an earlier draft/version",
  "updated to reflect", "as noted above, this changed".
- Rebuttal framing that resurrects a wrong claim to deny it: "not because X, but because Y". State Y directly.

When you revise a doc mid-conversation to fix something you wrote earlier, edit it to read as the correct
version. Do not narrate the fix or contrast it with what was there before.

Exceptions (these are not history): present-tense constraints with cause, code comments documenting hidden
invariants, deprecation comments with a removal trigger, and dedicated changelog/version-history fields whose
purpose is to record change (commit messages, PR changelog entries, a doc's "version message" field).

## No phantom countermands

Never forbid, override, or contrast against an instruction the doc does not give. "Keep X as its own file
rather than pasting it into Y", "do not use Z here", "unlike the default": if no rule says otherwise, state the
requirement alone. If a rule does say otherwise, edit that rule instead of countering it from a second place.

## Code comments

Comments: only on truly non-understandable code (non-obvious why, surprising constraints, gotchas). Never
restate what the code/names already say. Default to no comment.

Comment the WHY, not the WHAT. The code already shows what it does.

- Keep: rationale the code can't show. Why a cast/guard/workaround exists, an invariant or constraint, a
  gotcha, a trade-off, a spec reference.
- Cut: anything that just re-narrates the next line. An unclear line wants a better name or type, not a
  comment.
- Cut: prose about code somewhere else, such as its consumers or callers, a paired entry in another file, or
  how another host registers it. Nothing ties that text to the code it describes, so it rots unnoticed when
  that code changes. Describe what holds at this line only. Compiler-checked references (`<see cref>`,
  `<inheritdoc cref>`, `nameof`) are fine: the build keeps them accurate. Exception: the two sides must change
  together and nothing fails at compile or test time when only one does. Then name the other symbol exactly so
  a search finds it, or better, add a test that fails when they drift.
- Rewrite or cut: a defence of the current choice that names no reason (`// Deliberately a List, not an
  array.` above a line that already declares a `List`). The code already states the choice. When the choice
  guards a hazard the code doesn't show, such as a security, thread-safety, or shared-state risk, rewrite the
  comment to name that hazard. Otherwise cut it.
- Exception: a genuinely dense stretch (a hairy regex, bit-twiddling, a non-obvious algorithm) earns a
  one-line summary of what it does.

A code comment describes the code it sits on, as that code stands. It never points outside the code: no
ticket keys, PRs, branches, people or conversations. It never promises future work: no "until X lands", "a
later change will", "not supported yet", "X is where this gets fixed".

The promise goes stale as soon as plans change, and nothing makes anyone delete it. The reader then trusts a
fix that never shipped, and a reviewer asks for proof of behaviour that the code does not have.

The one exception is a TODO that names the work, and that the change which does the work must delete. Write
it as `// TODO(<ticket>): <what to do>`, so a search for the ticket finds it.

Before: `// ZUSE-744 is where the selector learns to carry one`
After: delete the line. The comment above it already says why the error stays.

## Check before publishing

Reread the text as the cold reader. For each paragraph, ask: what would I need to already know to follow this?
Anything that is not in the text, the linked PRs or the code it names gets defined, linked or cut. Then search
the text for the three patterns in § Leave out the marks of generated text.

## Example

Before, written by someone inside the work:

> *The origin, and what beats what.* An encrypted `dbid`/`id` pair from a selector row sets the origin and
> takes precedence over the host the page was reached on; on an account's own host, the host names the
> account and there is no pair. The pair is not trusted on its own: the callback still requires the account's
> member to be linked to the identity that signed in.

After, readable cold:

> *How the login picks the account to return to.* When a Google login starts, the app records the account
> the customer started from, and the callback signs in to that account. Two things can name it, checked in
> this order:
>
> 1. A row on the account selector. Each row's button carries that account's encrypted `dbid`/`id` pair.
>    When the pair is present, it names the account.
> 2. The address the login started on. Without a pair, the host names the account.
>
> The recorded account is a request, not a permission. The callback signs in to it only when that account's
> member is linked to the Google identity that just signed in, so an edited pair can never reach an account
> the identity has no link to.
