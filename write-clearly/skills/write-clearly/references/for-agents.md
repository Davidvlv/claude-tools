# Writing for an agent

An agent reads every word as an instruction and has no context beyond the text and what the text tells it to
load. Each line also costs context in every session that loads the file.

## No consumer leak

In any shared/library/config .md, classify every consumer-touching line:

1. *Data dupes are forbidden.* No caller-owned data copied into shared doc (thresholds, severity lists,
   format examples, substitution values with annotations). Reference by name only ("per caller's threshold").
2. *Delegation refs are allowed.* Pointers telling a fresh-context agent to load caller-owned definitions
   (e.g. subagent prompts that load caller SKILL). Keep when reader has no inherited context.
3. *Pure breadcrumbs: nuke.* Lines naming the consumer without functional value:
   `## Loaded by SKILL at Step 4`, `## Hand back to invoking SKILL`, "matches SKILL's naming",
   `{step_n} = N (consumer hands back here)`.

Test: does the reader of this line already have the caller's content in context? Yes → reference is optional
convenience. No → required. Neither → nuke.

## Write only the rule

State the rule and why it matters. Leave out commentary about other skills or files ("house rule",
"overrides"), the history of the rule, and source or provenance links. An agent cannot act on any of it. Put
each rule in the skill for the codebase it applies to.

## Phrase a rule as what to do

A prohibition names the behaviour it forbids, and an agent reading it weighs that name. Write the required
behaviour. When a prohibition is the clearest form, give the alternative next to it: "Build with
`dotnet build`. msbuild is not on the PATH."

## A description is a trigger

A skill or tool description decides whether an agent loads the body at all. Say when it applies: the
requests, tasks and file types that should load it. A description that summarises the body without naming
those situations means the skill never fires.

## A brief carries everything the agent needs

A subagent or session brief is that agent's only context. State the goal, what is already ruled out, the files
or area to work in, and what done looks like. Name the files to read rather than pasting their content.

## Style carries into output

An agent writes in the style of its instructions. Apply § Leave out the marks of generated text (SKILL.md) to
every file an agent reads. Text that an agent copies into output for people, such as a PR template or a
review-comment format, also gets the full list in for-people.md.
