# Writing for a person

People recognise generated text and trust it less. A pattern counts in proportion to how rarely a careful
writer would use it on purpose. Patterns in the first table justify an edit on one sighting. Patterns in the
second justify one only when other patterns are near.

## Edit on one sighting

| Pattern | Watch for | Fix |
|---|---|---|
| Run-up before the point | "Here's the thing", "Let's dive in", "Honestly?", "Here's what you need to know" | Start with the point. |
| One-line closers | "That's the real win.", "Let that sink in.", a row of fragments ("No setup. No config.") | Cut a closer that repeats the paragraph. Merge fragments into one claim. |
| Sayings that sound deep | "at its core", "the real question is", "X is the language of Y" | Replace the saying with the specific claim. |
| Arguing with no one | "To be clear, I'm not saying", "A tempting approach would be", "You might think" | Cut the defence unless someone in the thread made the objection. |
| Chatbot residue | "Great question!", "I hope this helps", "Let me know if", "Would you like" | Remove the wrapper. Keep the content. |
| Inflated significance | "a pivotal moment", "reflects a broader shift", "the future looks bright" | Keep the fact. End on the last concrete fact. |
| Heading repeated in the first line | "## Security" followed by "Security is important." | Delete the line. |
| Guesses past the evidence | "likely began", "it is believed that", "while details are limited" | Say what the source does not show, or cut the sentence. |

## Edit when other patterns are near

| Pattern | Watch for | Fix |
|---|---|---|
| Forced triads | "fast, reliable, and scalable" | Keep three only when the meaning has three parts. When the list is itself a claim, such as named features, keep its content. |
| Shallow -ing riders | ", ensuring reliability", ", highlighting our commitment to" | Cut the rider unless the source supports its claim. |
| Avoiding is, are and has | "serves as", "stands as", "boasts", "features" | Use is, are or has. |
| Overused words | delve, leverage, robust, seamless, crucial, pivotal, showcase, underscore, utilize, meticulous, additionally, landscape | Use the plain word: use, strong, important, show, also. |
| Vague association | "linked to", "associated with", "tied to" | Name the relation the source gives. When it gives none, keep the vague words. |
| Narrating the layout | "the table below compares", "this section covers" | Write about the subject. |
| Stacked qualifiers | "could potentially", "might arguably" | Keep one qualifier when the source supports it. |

## Lead a reply with the decision

A reply's reader has the thread above it. Treat the thread as part of the text: restate none of it, and define
nothing it already defines. Open with the decision or the answer. Keep only the fact the reader lacks and any
link they need.

Before:

> You're right that the export times out on large lists. I looked into it and the query loads every
> subscriber before paging, so memory grows with the list. I tried it on three list sizes. So I think we
> should page in the query.

After:

> Agreed, I'll page in the query. It loads every subscriber before paging, so memory grows with the list.

## Quotation marks

In markdown, code comments and commit messages, use straight quotes (`"` and `'`). Search and diff tools
match the ASCII characters, so a curly quote around an identifier or a value hides it from a search.
