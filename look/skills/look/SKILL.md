---
name: look
description: Have a screenshot or any other image looked at by separate models, which rate it against your aims and report what looks wrong, so the picture never enters your own context. Use whenever a task needs someone to see an image you captured, to judge how something looks, or to compare a before and after.
---

# look

A looker is a set of model runs with nothing loaded but the pictures and your question. You work from its output and never read those pictures yourself, with the Read tool or with any tool that returns a picture. The reasons behind the rules below are in [evidence.md](evidence.md).

When the user is present and can see the result, the user judges how it looks: show them a side-by-side comparison when you can, and ask them your questions about it. Use the looker when no one is there to judge.

## Ask

```
node "${CLAUDE_PLUGIN_ROOT}/skills/look/look.mjs" --question-file <question.md> <image> [<image> ...]
node "${CLAUDE_PLUGIN_ROOT}/skills/look/look.mjs" --question-file <question.md> --compare <before-folder> <after-folder>
```

A call takes at most 12 images; split a larger set into calls of one subject each. `--compare` pairs the files with the same name in the two folders. The model flags (`--runs-model`, `--fresh-model`, `--tiebreak`, `--input`) exist for evaluating the looker itself; leave them at their defaults.

The question file has two parts:

1. **The description**: what the pictures are of, and for each file, by name, what it shows and from where (the viewpoint and its distance, or the screen and its state). Leave out your opinion of the pictures, the code and the change, and never say which set of a compare is new.
2. **`## Aims`**: one line per aim, `- <id>: <aim>`. An aim states the wanted state in the user's own words where they gave them, such as `- T1: the terraces do not lie parallel like the tiers of a cake`. State the wanted state, not the change you made.

With aims, the looker rates each aim in two independent runs, settles a disagreement with a third run, and adds a fresh-eye run that sees the description and no aims. Without aims, one run answers the question as written; use that for a gap list, asking for the differences between the pictures and the aim, widest first.

Every before/after question is a `--compare`: the looker sees the two sets as X and Y in a random order and judges which fits each aim better without knowing which is new.

## Capture

- **Views.** When the user named or showed the view they judged from, capture that exact view. Add the view a user sees first, one near view and one far view. Each picture shows one state; a compare shows the same views on both sides.
- **Detail.** Capture at 2560 × 1440 when the subject is fine detail, such as a cliff face or a texture. Crop or enlarge a subject that fills a small part of the frame.
- **Still scenes for a compare.** Hold random seeds and animation still in the capture, so the only pixels that differ between before and after are your change.
- **Motion.** A still cannot show motion, timing or direction; never ask about them from stills. Decide motion from the program's own state data (positions, velocities, contacts) recorded over time. No motion image kind (frame grid, path trail or ghosted composite) is confirmed to read motion the way the user sees it, so what the looker says about them is a candidate to check in the state data, never a verdict.
- **Numbers.** When an aim has a measurable number, such as a share of sheer walls or a spacing, measure it on the old and the new build, and report both values beside the verdict block. When you turned the user's words into a number, state that translation in one line.

## Read the output

The output starts with any `identical images:` and `change:` lines, then three sections:

- **Verdicts**: one line per aim, `<id>: met|not met|split — <ratings> (<agreeing runs>/<runs>)`. Ratings are `not seen`, `faint`, `clear`, `strong`. A line is `met` when the agreeing runs rate it `clear` or `strong`; in a compare, only when the after set is also the better one.
- **Seen by both**: what both rating runs noticed.
- **Fresh eye**: what a run that knew no aims found wrong.

How to act on it:

1. The verdict block decides. Quote it unchanged wherever you claim a visual result; never restate it in your own words.
2. `not met` or `split` means the change does not yet read as the aim. Change the build, or capture views that show the subject better, and ask again on the new pictures. Ask a new question about the same pictures only to resolve a conflict between parts of the output, and name that conflict in the question.
3. A view whose aim failed stays in the next question, or the question says why it is gone.
4. When Fresh eye names the problem an aim is about, capture another view of it before you claim the aim.
5. Exit code 3 with `change not in capture` means the before and after pictures do not differ: the change did not reach the capture or the build. Find that cause before you tune or judge anything.
6. The looker can misname what it sees. Take a wrong name as how the thing reads to a fresh eye.
7. Decisions stay with you: the looker rates and lists, and you choose.

Each call keeps its prompts and answers in a `look-log.md` beside the first image, or in the after folder for a compare.

## When the command fails

A line starting `LOOK_UNAVAILABLE:` with exit code 1 means the looker did not run. Start one subagent on Sonnet in its place, with the Agent tool and `model: sonnet`: its prompt is your question and the absolute path of each picture, and tells it to read those files and nothing else. When that fails too, or you cannot start a subagent, report "could not check the look" with the reason. A looker that failed is never a reason to read a picture yourself. Exit code 2 is a usage error: fix the call.
